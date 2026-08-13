import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** 压缩日志：userData/gif-compress.log，结构化单行记录，便于排查线上问题 */

let logFile: string | null = null
function ensureLogFile(): string {
  if (!logFile) {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'gif-compress.log')
  }
  return logFile
}

export interface GifCompressLogEntry {
  ok: boolean
  /** 配置模式（wechat/qq/custom） */
  mode: string
  /** 目标字节数 */
  targetBytes: number
  originalBytes: number
  compressedBytes: number
  /** 压缩比例（0-100，越小越好） */
  ratio: number
  elapsedMs: number
  method: string
  error?: string
}

/** 追加一条压缩日志（JSON 单行，字段名稳定便于后续解析） */
export function logGifCompress(e: GifCompressLogEntry): void {
  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      ok: e.ok,
      mode: e.mode,
      target: e.targetBytes,
      original: e.originalBytes,
      compressed: e.compressedBytes,
      ratio: Number(e.ratio.toFixed(1)),
      elapsedMs: e.elapsedMs,
      method: e.method,
      ...(e.error ? { error: e.error } : {})
    })
    appendFileSync(ensureLogFile(), entry + '\n')
  } catch (err) {
    console.warn('[media/logger] 写 GIF 压缩日志失败:', err)
  }
}
