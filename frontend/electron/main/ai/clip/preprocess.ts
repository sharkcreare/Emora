import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { thumbFileName } from '../../locallib/thumb-util'

/**
 * 图片预处理（Chinese-CLIP 官方 image_transform 的纯 JS 实现）。
 *
 * 流程：RGBA → 双线性缩放（短边=224）→ 中心裁剪 224×224 → (x/255-μ)/σ → NCHW float32 tensor。
 * 全部为纯函数（preprocessPixels），可直接单测；解码部分复用现有 jimp，
 * 且优先使用 locallib 缩略图缓存（200px），避免每次读取超大原图。
 */

/** CLIP 输入尺寸（ViT-B/16 input_resolution） */
export const INPUT_SIZE = 224
/** ImageNet 归一化参数（官方 image_transform 一致） */
export const MEAN: readonly [number, number, number] = [0.48145, 0.45782, 0.40821]
export const STD: readonly [number, number, number] = [0.26862, 0.26130, 0.27578]

/** 双线性缩放 RGBA → RGB（Float32，避免中间转整数损失精度） */
function resizeBilinear(
  src: Uint8Array | Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): Float32Array {
  const out = new Float32Array(dw * dh * 3)
  const xr = sw / dw
  const yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = y * yr
    const y0 = Math.min(sh - 1, Math.floor(sy))
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = x * xr
      const x0 = Math.min(sw - 1, Math.floor(sx))
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = sx - x0
      const i00 = (y0 * sw + x0) * 4
      const i01 = (y0 * sw + x1) * 4
      const i10 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      const di = (y * dw + x) * 3
      for (let c = 0; c < 3; c++) {
        out[di + c] =
          src[i00 + c] * (1 - fx) * (1 - fy) +
          src[i01 + c] * fx * (1 - fy) +
          src[i10 + c] * (1 - fx) * fy +
          src[i11 + c] * fx * fy
      }
    }
  }
  return out
}

/**
 * 纯函数：RGBA 像素 → NCHW float32 tensor [1,3,size,size]。
 * @param rgba  RGBA 像素（长度 = width*height*4）
 * @param width  原图宽
 * @param height 原图高
 * @param size   目标尺寸（默认 224）
 */
export function preprocessPixels(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  size = INPUT_SIZE
): Float32Array {
  if (width <= 0 || height <= 0) throw new Error(`非法图片尺寸 ${width}x${height}`)
  // 1. 双线性缩放：短边 = size，保持比例（与 torchvision Resize(size) 一致）
  const scale = size / Math.min(width, height)
  const tw = Math.max(size, Math.round(width * scale))
  const th = Math.max(size, Math.round(height * scale))
  const rgb = resizeBilinear(rgba, width, height, tw, th)
  // 2. 中心裁剪 size×size
  const ox = Math.floor((tw - size) / 2)
  const oy = Math.floor((th - size) / 2)
  // 3. 归一化 + NCHW（channel-major: [C,H,W]）
  const out = new Float32Array(3 * size * size)
  const plane = size * size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const si = ((oy + y) * tw + (ox + x)) * 3
      const idx = y * size + x
      out[idx] = (rgb[si] / 255 - MEAN[0]) / STD[0]
      out[plane + idx] = (rgb[si + 1] / 255 - MEAN[1]) / STD[1]
      out[2 * plane + idx] = (rgb[si + 2] / 255 - MEAN[2]) / STD[2]
    }
  }
  return out
}

/** 解码图片为 RGBA（jimp，支持 png/jpg/gif/webp；GIF 取首帧） */
export async function decodeImageToRGBA(
  imagePath: string
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const jimpMod = await import('jimp')
  const Jimp: any = (jimpMod as any).default ?? jimpMod
  const img = await Jimp.read(imagePath)
  const { data, width, height } = img.bitmap
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height }
}

/**
 * 优先复用缩略图缓存（locallib 命名规则），不存在则回退原图。
 * thumbDir 由主进程在创建 worker 时传入（userData/thumbnails）；
 * 缺失时直接读原图（功能不受影响，仅少一层缓存加速）。
 */
export function resolveDecodeSource(imagePath: string, thumbDir?: string): string {
  if (thumbDir) {
    try {
      const thumb = join(thumbDir, thumbFileName(imagePath))
      if (existsSync(thumb) && statSync(thumb).size > 0) return thumb
    } catch {
      /* 缩略图不可用则回退原图 */
    }
  }
  return imagePath
}

/** 完整预处理：缩略图优先 → 解码 → tensor [1,3,224,224] */
export async function preprocessImageFile(imagePath: string, thumbDir?: string): Promise<Float32Array> {
  const src = resolveDecodeSource(imagePath, thumbDir)
  const { data, width, height } = await decodeImageToRGBA(src)
  return preprocessPixels(data, width, height)
}
