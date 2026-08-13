import { Worker } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { GifCompressConfig } from '../../../shared/types'
import type { GifCompressRequest, GifCompressResponse } from './types'
import { logGifCompress } from '../utils/logger'

/**
 * GIF 压缩调度（主进程）。
 * 职责：读内存配置 → 判断是否需要压缩 → hash 缓存命中检测 → 派发 worker → 结果处理 → 日志 → 回退。
 * worker 只负责解析/压缩/输出文件，主进程绝不执行耗时计算。
 */

/** 缓存目录（位于现有临时下载目录内，应用退出时随 cleanupTempFiles 一起清理） */
const CACHE_DIR = join(tmpdir(), 'emoji-assistant', 'gif-cache')
/** 超大 GIF 保护：超过该大小跳过压缩（解码内存爆炸风险），直接发送 */
const MAX_INPUT_BYTES = 50 * 1024 * 1024
/** 压缩超时（worker 卡死保护） */
const WORKER_TIMEOUT_MS = 60_000

/** 配置内存缓存（renderer 启动/变更时通过 IPC 同步，发送时零 IPC 直读） */
let cachedConfig: GifCompressConfig = { enabled: false, mode: 'wechat' }

export function getGifConfig(): GifCompressConfig {
  return { ...cachedConfig, customThresholdBytes: cachedConfig.customThresholdBytes }
}

export function setGifConfig(cfg: GifCompressConfig): void {
  cachedConfig = {
    enabled: Boolean(cfg?.enabled),
    mode: cfg?.mode === 'qq' || cfg?.mode === 'custom' ? cfg.mode : 'wechat',
    customThresholdBytes:
      cfg?.mode === 'custom' && typeof cfg?.customThresholdBytes === 'number' && cfg.customThresholdBytes > 0
        ? cfg.customThresholdBytes
        : undefined
  }
}

/** 阈值解析（可扩展：新增平台只加一行常量） */
export function resolveGifThreshold(cfg: GifCompressConfig = cachedConfig): number {
  if (cfg.mode === 'qq') return 5 * 1024 * 1024
  if (cfg.mode === 'custom' && cfg.customThresholdBytes) return cfg.customThresholdBytes
  return 1 * 1024 * 1024
}

export interface GifCompressOutcome {
  /** 实际写入剪贴板的路径（压缩成功时为缓存文件，否则原文件） */
  path: string
  /** 是否真的走了压缩 */
  compressed: boolean
  /** 超大 GIF 且未开启压缩（供渲染层首次提示开启） */
  hint: boolean
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
}

/** 单例 worker：串行处理（压缩低频，无需池化）；崩溃/退出后重建 */
let worker: Worker | null = null
let workerBroken = false

function getWorker(): Worker {
  if (worker && !workerBroken) return worker
  workerBroken = false
  worker = new Worker(join(__dirname, 'gif-worker.js'))
  worker.on('error', (err) => {
    console.error('[media/compressor] worker 错误:', err)
    workerBroken = true
  })
  worker.on('exit', (code) => {
    if (code !== 0) {
      console.warn('[media/compressor] worker 异常退出:', code)
      workerBroken = true
    }
    worker = null
  })
  return worker
}

function runWorker(req: GifCompressRequest): Promise<GifCompressResponse> {
  return new Promise((resolve, reject) => {
    const w = getWorker()
    let settled = false
    const cleanup = (): void => {
      w.off('message', onMessage)
      w.off('error', onError)
      clearTimeout(timer)
    }
    const onMessage = (msg: GifCompressResponse): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(msg)
    }
    const onError = (err: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('GIF 压缩超时'))
    }, WORKER_TIMEOUT_MS)
    w.on('message', onMessage)
    w.on('error', onError)
    w.postMessage(req)
  })
}

/**
 * GIF 发送前压缩入口（写剪贴板前调用）。
 * 铁律：任何压缩异常都不得让发送失败——失败一律回退原文件。
 */
export async function compressGifIfNeeded(inputPath: string): Promise<GifCompressOutcome> {
  const cfg = cachedConfig
  const target = resolveGifThreshold(cfg)
  let size = 0
  try {
    size = statSync(inputPath).size
  } catch {
    return { path: inputPath, compressed: false, hint: false }
  }

  // 未开启：超限时给 hint（渲染层首次提示是否开启），不压缩
  if (!cfg.enabled) {
    return { path: inputPath, compressed: false, hint: size > target }
  }
  // 达标 / 超大保护：不压缩
  if (size <= target) return { path: inputPath, compressed: false, hint: false }
  if (size > MAX_INPUT_BYTES) {
    logGifCompress({ ok: false, mode: cfg.mode, targetBytes: target, originalBytes: size, compressedBytes: 0, ratio: 100, elapsedMs: 0, method: 'skipped-too-large', error: 'input > 50MB' })
    return { path: inputPath, compressed: false, hint: false }
  }

  // 文件 hash 缓存：相同 GIF + 相同目标阈值避免重复压缩
  const hash = sha256File(inputPath)
  const cachePath = join(CACHE_DIR, `${hash}-${target}.gif`)
  try {
    if (existsSync(cachePath) && statSync(cachePath).size <= target) {
      return { path: cachePath, compressed: true, hint: false }
    }
  } catch {
    /* 缓存失效则重新压缩 */
  }

  const t0 = Date.now()
  try {
    const resp = await runWorker({ inputPath, outputPath: cachePath, targetBytes: target })
    const elapsed = Date.now() - t0
    if (resp.ok && resp.compressedBytes < size) {
      logGifCompress({
        ok: true,
        mode: cfg.mode,
        targetBytes: target,
        originalBytes: resp.originalBytes,
        compressedBytes: resp.compressedBytes,
        ratio: (resp.compressedBytes / resp.originalBytes) * 100,
        elapsedMs: elapsed,
        method: resp.method
      })
      return { path: resp.outputPath, compressed: true, hint: false }
    }
    // 压缩失败或产物未变小：清掉无效缓存，回退原文件
    try {
      rmSync(cachePath, { force: true })
    } catch {
      /* 忽略 */
    }
    logGifCompress({
      ok: false,
      mode: cfg.mode,
      targetBytes: target,
      originalBytes: resp.originalBytes || size,
      compressedBytes: resp.compressedBytes,
      ratio: resp.compressedBytes ? (resp.compressedBytes / (resp.originalBytes || size)) * 100 : 100,
      elapsedMs: elapsed,
      method: resp.method || 'worker-failed',
      error: resp.error ?? (resp.compressedBytes >= size ? 'compressed-not-smaller' : 'unknown')
    })
    return { path: inputPath, compressed: false, hint: false }
  } catch (err) {
    logGifCompress({
      ok: false,
      mode: cfg.mode,
      targetBytes: target,
      originalBytes: size,
      compressedBytes: 0,
      ratio: 100,
      elapsedMs: Date.now() - t0,
      method: 'scheduler-error',
      error: err instanceof Error ? err.message : String(err)
    })
    return { path: inputPath, compressed: false, hint: false }
  }
}

/** 应用退出时清理：worker 关闭 + 压缩缓存（临时目录由 clipboard.cleanupTempFiles 统一清） */
export function disposeCompressor(): void {
  if (worker) {
    try {
      worker.terminate()
    } catch {
      /* 忽略 */
    }
    worker = null
  }
}
