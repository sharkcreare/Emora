import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preprocessPixels, decodeImageToRGBA, preprocessImageFile, resolveDecodeSource, INPUT_SIZE, MEAN, STD } from '../electron/main/ai/clip/preprocess'
import { thumbFileName } from '../electron/main/locallib/thumb-util'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ai-preprocess-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 生成纯色 RGBA 像素 */
function solidRgba(width: number, height: number, r: number, g: number, b: number): Uint8ClampedArray {
  const p = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    p[i * 4] = r
    p[i * 4 + 1] = g
    p[i * 4 + 2] = b
    p[i * 4 + 3] = 255
  }
  return p
}

describe('preprocessPixels', () => {
  it('输出 NCHW float32 tensor [1,3,224,224]（长度 3*224*224）', () => {
    const t = preprocessPixels(solidRgba(300, 200, 100, 150, 200), 300, 200)
    expect(t).toBeInstanceOf(Float32Array)
    expect(t.length).toBe(3 * INPUT_SIZE * INPUT_SIZE)
  })

  it('NCHW 通道分离：纯红图 → R 通道高、G/B 通道为负', () => {
    const t = preprocessPixels(solidRgba(64, 64, 255, 0, 0), 64, 64)
    const plane = INPUT_SIZE * INPUT_SIZE
    const r = (255 / 255 - MEAN[0]) / STD[0]
    const g = (0 / 255 - MEAN[1]) / STD[1]
    const b = (0 / 255 - MEAN[2]) / STD[2]
    expect(t[0]).toBeCloseTo(r, 4)
    expect(t[plane]).toBeCloseTo(g, 4)
    expect(t[2 * plane]).toBeCloseTo(b, 4)
  })

  it('中心裁剪：左黑右白 8x4 → 裁剪区起点 x=2（黑），右端 x=5（白）', () => {
    // size=4：min(w,h)=4 → scale=1 → tw=8, th=4 → ox=(8-4)/2=2, oy=0
    const p = new Uint8ClampedArray(8 * 4 * 4)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) {
        const i = (y * 8 + x) * 4
        const v = x < 4 ? 0 : 255
        p[i] = p[i + 1] = p[i + 2] = v
        p[i + 3] = 255
      }
    }
    const t = preprocessPixels(p, 8, 4, 4)
    // 裁剪后坐标 0 ↔ 原图 x=2（黑）；坐标 3 ↔ 原图 x=5（白）
    expect(t[0]).toBeCloseTo((0 - MEAN[0]) / STD[0], 4)
    expect(t[3]).toBeCloseTo((1 - MEAN[0]) / STD[0], 4)
  })

  it('非法尺寸抛错', () => {
    expect(() => preprocessPixels(new Uint8ClampedArray(0), 0, 0)).toThrow()
  })
})

describe('图片解码与缩略图优先', () => {
  it('真实 PNG 解码 → tensor 长度正确', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    const file = join(dir, 'a.png')
    writeFileSync(file, png)
    const t = await preprocessImageFile(file)
    expect(t.length).toBe(3 * INPUT_SIZE * INPUT_SIZE)
  })

  it('缩略图存在时优先用缩略图（resolveDecodeSource）', () => {
    const file = join(dir, 'b.png')
    writeFileSync(file, Buffer.from('fake-img'))
    const thumbDir = join(dir, 'thumbs')
    const thumb = join(thumbDir, thumbFileName(file))
    mkdirSync(require('node:path').dirname(thumb), { recursive: true })
    writeFileSync(thumb, Buffer.from('thumb-png'))
    expect(resolveDecodeSource(file, thumbDir)).toBe(thumb)
    rmSync(thumb)
    expect(resolveDecodeSource(file, thumbDir)).toBe(file)
    expect(resolveDecodeSource(file)).toBe(file)
  })

  it('decodeImageToRGBA 返回 RGBA 与尺寸', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    const file = join(dir, 'c.png')
    writeFileSync(file, png)
    const { data, width, height } = await decodeImageToRGBA(file)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    expect(data.length).toBe(width * height * 4)
  })

  it('损坏图片抛错（worker 层转错误响应）', async () => {
    const bad = join(dir, 'bad.png')
    writeFileSync(bad, Buffer.from('not-an-image'))
    await expect(preprocessImageFile(bad)).rejects.toThrow()
  })
})
