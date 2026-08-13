import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { parentPort } from 'node:worker_threads'
import { parseGIF, decompressFrames } from 'gifuct-js'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import type { GifCompressRequest, GifCompressResponse } from '../gif/types'

/**
 * GIF 压缩 worker（worker_threads 内运行，不阻塞主进程/窗口）。
 *
 * 压缩策略（画质优先，先分析体积来源再选优化手段）：
 *   1. 解码并合成全画布帧（保留透明通道）
 *   2. 分析 GIF 体积构成：高分辨率 / 高帧率 / 高色彩密度
 *   3. 按「主导体积来源优先」选择杠杆顺序，逐档渐进（任一档达标即停）：
 *      - 颜色杠杆：调色板 192 → 128 → 96 → 64 色（PNN 量化，画质损失小）
 *      - 帧率杠杆：抽帧 1/2 → 1/3（仅对高 FPS 动画有意义），delay 同步加倍保持播放速度
 *      - 尺寸杠杆：宽度 0.75 → 0.5 → 0.35（盒式滤波下采样，最后才动用，最伤细节）
 *   4. 输出到目标路径（缓存文件），返回统计供日志与提示
 */

/** 解码像素总量上限（w*h*帧数），超过直接报错回退原文件，防内存爆炸 */
const MAX_TOTAL_PIXELS = 60_000_000

/** 各杠杆档位（渐进增强） */
const COLOR_LEVELS = [192, 128, 96, 64]
const KEEP_LEVELS = [2, 3]
const SCALE_LEVELS = [0.75, 0.5, 0.35]

interface ComposedFrame {
  data: Uint8ClampedArray
  delayMs: number
  hasTransparent: boolean
}

/** 盒式滤波下采样（RGBA，RGB 按透明度加权平均，边缘不发黑） */
function scaleFrame(src: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4)
  const xr = sw / dw
  const yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const ys0 = Math.floor(y * yr)
    const ys1 = Math.min(sh - 1, Math.max(ys0, Math.ceil((y + 1) * yr) - 1))
    for (let x = 0; x < dw; x++) {
      const xs0 = Math.floor(x * xr)
      const xs1 = Math.min(sw - 1, Math.max(xs0, Math.ceil((x + 1) * xr) - 1))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let wa = 0
      for (let sy = ys0; sy <= ys1; sy++) {
        for (let sx = xs0; sx <= xs1; sx++) {
          const si = (sy * sw + sx) * 4
          const al = src[si + 3]
          r += src[si] * al
          g += src[si + 1] * al
          b += src[si + 2] * al
          a += al
          wa += al
        }
      }
      const n = (ys1 - ys0 + 1) * (xs1 - xs0 + 1)
      const di = (y * dw + x) * 4
      if (wa > 0) {
        out[di] = r / wa
        out[di + 1] = g / wa
        out[di + 2] = b / wa
      }
      out[di + 3] = a / n
    }
  }
  return out
}

/** 合成全画布帧：处理局部帧偏移 + 三种 disposal，输出逐帧全画布 RGBA（保留透明） */
function composeFrames(gif: ReturnType<typeof parseGIF>): { frames: ComposedFrame[]; width: number; height: number } {
  const w = gif.lsd.width
  const h = gif.lsd.height
  const raw = decompressFrames(gif, true)
  const canvas = new Uint8ClampedArray(w * h * 4)
  const snapshot = new Uint8ClampedArray(w * h * 4)
  let prevDisposal = 0
  let prevRect: { left: number; top: number; width: number; height: number } | null = null
  const out: ComposedFrame[] = []

  for (const f of raw) {
    // 上一帧 disposal 处理
    if (prevDisposal === 2 && prevRect) {
      clearRect(canvas, w, prevRect)
    } else if (prevDisposal === 3) {
      canvas.set(snapshot)
    }
    // 本帧若 disposal=3，先快照（用于下一帧还原）
    if (f.disposalType === 3) {
      snapshot.set(canvas)
    }
    drawPatch(canvas, w, h, f)
    prevDisposal = f.disposalType
    prevRect = f.dims
    out.push({ data: new Uint8ClampedArray(canvas), delayMs: f.delay, hasTransparent: false })
  }

  // 检测透明（GIF 为 1-bit alpha，patch alpha 0/255）
  for (const fr of out) {
    const d = fr.data
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 128) {
        fr.hasTransparent = true
        break
      }
    }
  }
  return { frames: out, width: w, height: h }
}

function clearRect(canvas: Uint8ClampedArray, canvasW: number, rect: { left: number; top: number; width: number; height: number }): void {
  for (let y = 0; y < rect.height; y++) {
    const row = (rect.top + y) * canvasW
    for (let x = 0; x < rect.width; x++) {
      const i = (row + rect.left + x) * 4
      canvas[i] = canvas[i + 1] = canvas[i + 2] = canvas[i + 3] = 0
    }
  }
}

function drawPatch(canvas: Uint8ClampedArray, canvasW: number, canvasH: number, frame: { dims: { left: number; top: number; width: number; height: number }; patch: Uint8ClampedArray }): void {
  const { left, top, width, height } = frame.dims
  const patch = frame.patch
  for (let y = 0; y < height; y++) {
    const cy = top + y
    if (cy < 0 || cy >= canvasH) continue
    for (let x = 0; x < width; x++) {
      const cx = left + x
      if (cx < 0 || cx >= canvasW) continue
      const si = (y * width + x) * 4
      if (patch[si + 3] === 0) continue
      const di = (cy * canvasW + cx) * 4
      canvas[di] = patch[si]
      canvas[di + 1] = patch[si + 1]
      canvas[di + 2] = patch[si + 2]
      canvas[di + 3] = patch[si + 3]
    }
  }
}

/**
 * 分析体积主要来源，返回杠杆优先顺序（画质优先：伤害最小的先试）。
 *  - 尺寸杠杆最伤细节 → 只有高分辨率动画才优先
 *  - 帧率杠杆只对「帧多且帧间隔短」的高 FPS 动画有意义
 *  - 颜色杠杆（PNN 量化）画质损失最小 → 默认优先
 */
function analyzeSizeSource(frames: ComposedFrame[], w: number, h: number, size: number): ('colors' | 'frames' | 'scale')[] {
  const pixels = w * h
  const frameCount = frames.length
  const avgDelay = frames.reduce((a, f) => a + f.delayMs, 0) / Math.max(1, frameCount)
  const density = size / Math.max(1, pixels * frameCount) // 每像素帧字节数
  const dimHeavy = pixels >= 250_000 // ~500x500 以上
  const frameHeavy = frameCount >= 24 && avgDelay < 100 // 帧多且 >10fps
  const colorHeavy = density >= 2.0 || frameCount <= 12
  if (dimHeavy && !frameHeavy) return ['scale', 'colors', 'frames']
  if (frameHeavy) return ['frames', 'colors', 'scale']
  if (colorHeavy) return ['colors', 'frames', 'scale']
  return ['colors', 'scale', 'frames']
}

/** 采样所有帧像素构建全局调色板（单帧局部调色板会重复写表，压缩率差） */
function buildPalette(frames: ComposedFrame[], maxColors: number, hasAlpha: boolean): { pal: number[][]; transIndex: number } {
  // 目标样本量 ~12 万像素
  const targetSamples = 120_000
  let total = 0
  for (const f of frames) total += f.data.length / 4
  const step = Math.max(1, Math.floor(total / targetSamples))
  const samples = new Uint8Array(Math.ceil(total / step) * 4)
  let n = 0
  for (const f of frames) {
    const d = f.data
    for (let i = 0; i < d.length; i += step * 4) {
      samples[n++] = d[i]
      samples[n++] = d[i + 1]
      samples[n++] = d[i + 2]
      samples[n++] = d[i + 3]
    }
  }
  const pal = quantize(samples.subarray(0, n), hasAlpha ? maxColors - 1 : maxColors, { format: 'rgb565' })
  let transIndex = -1
  if (hasAlpha) {
    transIndex = pal.length
    pal.push([0, 0, 0]) // 透明槽（写表时 RGB 无关紧要）
  }
  return { pal, transIndex }
}

interface EncodeParams {
  colors: number
  keep: number
  scale: number
}

/** 按参数编码：抽帧 → 缩放 → 全局调色板量化 → 逐帧编码为自包含全帧（dispose=1） */
function encodeGif(frames: ComposedFrame[], w: number, h: number, params: EncodeParams, hasAlpha: boolean, basePal: number[][], baseTransIndex: number): Buffer {
  const sw = Math.max(1, Math.round(w * params.scale))
  const sh = Math.max(1, Math.round(h * params.scale))
  // 颜色档位低于基础调色板时，重新量化到目标色数
  let pal = basePal
  let transIndex = baseTransIndex
  if (params.colors < 256 && basePal.length - (hasAlpha ? 1 : 0) > params.colors) {
    const rebuilt = buildPalette(frames, params.colors, hasAlpha)
    pal = rebuilt.pal
    transIndex = rebuilt.transIndex
  }

  const enc = GIFEncoder()
  let first = true
  let kept = 0
  for (let i = 0; i < frames.length; i += params.keep) {
    const f = frames[i]
    const data = params.scale !== 1 ? scaleFrame(f.data, w, h, sw, sh) : f.data
    let idx = applyPalette(data, pal, 'rgb565')
    if (hasAlpha && f.hasTransparent) {
      const p = data
      for (let k = 3; k < p.length; k += 4) {
        if (p[k] < 128) idx[(k - 3) >> 2] = transIndex
      }
    }
    const opts = {
      delay: Math.round(f.delayMs * params.keep),
      dispose: 1,
      // 每帧都声明透明（GIF 的透明标志在 GCE 扩展中逐帧写入，只写首帧会导致后续帧透明背景被当普通颜色）
      transparent: hasAlpha,
      transparentIndex: hasAlpha ? transIndex : 0
    }
    if (first) {
      enc.writeFrame(idx, sw, sh, {
        ...opts,
        palette: pal
      })
      first = false
    } else {
      enc.writeFrame(idx, sw, sh, opts)
    }
    kept++
  }
  enc.finish()
  return Buffer.from(enc.bytes())
}

function describeMethod(params: EncodeParams, w: number, h: number, framesBefore: number): string {
  const parts: string[] = []
  if (params.colors < 256) parts.push(`colors${params.colors}`)
  if (params.keep > 1) parts.push(`frames1/${params.keep}`)
  if (params.scale < 1) parts.push(`scale${params.scale}`)
  parts.push(`${w}x${h}->${Math.round(w * params.scale)}x${Math.round(h * params.scale)}`)
  parts.push(`${framesBefore}->${Math.ceil(framesBefore / params.keep)}f`)
  return parts.join('+') || 'reencode'
}

/** 渐进压缩：先纯重编码，再按杠杆顺序逐档增强，任一档达标即停 */
function compress(input: Buffer, targetBytes: number): { out: Buffer; method: string; framesBefore: number; framesAfter: number; width: number; height: number } {
  const ab = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
  const gif = parseGIF(ab)
  const { frames, width, height } = composeFrames(gif)
  const framesBefore = frames.length
  const totalPixels = width * height * framesBefore
  if (totalPixels > MAX_TOTAL_PIXELS) {
    throw new Error(`GIF 帧数据量过大（${totalPixels} 像素），跳过压缩`)
  }
  if (framesBefore === 0) {
    throw new Error('GIF 无有效帧')
  }
  const hasAlpha = frames.some((f) => f.hasTransparent)
  const order = analyzeSizeSource(frames, width, height, input.length)
  const basePal = buildPalette(frames, 256, hasAlpha)

  const params: EncodeParams = { colors: 256, keep: 1, scale: 1 }
  let bestOut: Buffer = Buffer.alloc(0)
  let bestMethod = ''

  const finish = (out: Buffer, method: string) => ({
    out,
    method,
    framesBefore,
    framesAfter: Math.ceil(framesBefore / params.keep),
    width,
    height
  })

  // 记录最优 + 命中目标即返回 true
  const remember = (out: Buffer, method: string): boolean => {
    if (bestOut.length === 0 || out.length < bestOut.length) {
      bestOut = out
      bestMethod = method
    }
    return out.length <= targetBytes
  }

  // 第 0 档：纯重编码（不降画质，仅整理调色板/帧结构）
  let cur = encodeGif(frames, width, height, params, hasAlpha, basePal.pal, basePal.transIndex)
  let method = describeMethod(params, width, height, framesBefore)
  if (remember(cur, method)) return finish(cur, method)
  for (const lever of order) {
    const levels = lever === 'colors' ? COLOR_LEVELS : lever === 'frames' ? KEEP_LEVELS : SCALE_LEVELS
    for (const lv of levels) {
      if (lever === 'colors') params.colors = lv
      else if (lever === 'frames') params.keep = lv
      else params.scale = lv
      cur = encodeGif(frames, width, height, params, hasAlpha, basePal.pal, basePal.transIndex)
      method = describeMethod(params, width, height, framesBefore)
      if (remember(cur, method)) return finish(cur, method)
    }
  }
  if (bestOut.length === 0) {
    throw new Error('压缩后无有效输出')
  }
  return finish(bestOut, bestMethod)
}

/** worker 入口：接收请求 → 压缩 → 写缓存文件 → 回传结果 */
const pp = parentPort
if (pp) {
  pp.on('message', (req: GifCompressRequest) => {
    const t0 = Date.now()
    let resp: GifCompressResponse
    try {
      const input = readFileSync(req.inputPath)
      if (input.length === 0) throw new Error('输入文件为空')
      const result = compress(input, req.targetBytes)
      const outDir = dirname(req.outputPath)
      mkdirSync(outDir, { recursive: true })
      writeFileSync(req.outputPath, result.out)
      resp = {
        ok: true,
        outputPath: req.outputPath,
        originalBytes: input.length,
        compressedBytes: result.out.length,
        method: result.method,
        elapsedMs: Date.now() - t0,
        error: undefined
      }
    } catch (err) {
      resp = {
        ok: false,
        outputPath: req.outputPath,
        originalBytes: 0,
        compressedBytes: 0,
        method: '',
        elapsedMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
    pp.postMessage(resp)
  })
}
