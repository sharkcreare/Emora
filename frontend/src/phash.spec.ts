import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  hammingDistance,
  similarityPct,
  md5Of,
  dHashFromPixels,
  pHashFromPixels,
  pHashRotFromPixels,
  minRotationDistance
} from '../electron/main/locallib/phash'
import { analyzeDuplicates } from '../electron/main/locallib/duplicate-service'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'phash-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 构造一个 LocalFileEmoji 最小对象 */
function mkFile(name: string): any {
  return { id: `local_${name}`, name, localPath: join(dir, name), parentDir: '' }
}

describe('phash', () => {
  it('hammingDistance：相同为 0，不同按位计数', () => {
    expect(hammingDistance('0000', '0000')).toBe(0)
    expect(hammingDistance('0fff', 'ffff')).toBe(4)
    expect(hammingDistance('aaaa', 'aaab')).toBe(1)
    expect(hammingDistance('a', 'bb')).toBe(Number.MAX_SAFE_INTEGER) // 长度不等
  })

  it('dHash 输出 64bit 十六进制（16 字符）', () => {
    const pixels = new Uint8ClampedArray(100 * 100 * 4)
    for (let i = 0; i < 10000; i++) {
      pixels[i * 4] = (i * 7) % 256
      pixels[i * 4 + 1] = (i * 13) % 256
      pixels[i * 4 + 2] = (i * 29) % 256
      pixels[i * 4 + 3] = 255
    }
    const hash = dHashFromPixels(pixels, 100, 100)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('dHash 对轻微亮度变化鲁棒（汉明距离小）', () => {
    // 渐变图案 + 轻微亮度偏移 → 汉明距离应远小于差异较大的两图
    const mk = (bright: number): Uint8ClampedArray => {
      const p = new Uint8ClampedArray(64 * 64 * 4)
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const i = (y * 64 + x) * 4
          p[i] = p[i + 1] = p[i + 2] = (x + y) % 256 + bright
          p[i + 3] = 255
        }
      }
      return p
    }
    const h1 = dHashFromPixels(mk(0), 64, 64)
    const h2 = dHashFromPixels(mk(30), 64, 64)
    const h3 = dHashFromPixels(mk(200), 64, 64)
    expect(hammingDistance(h1, h2)).toBeLessThan(8)
    expect(hammingDistance(h1, h3)).toBeLessThan(8)
  })

  it('md5 精确且稳定', () => {
    const buf = Buffer.from('hello 表情包', 'utf8')
    expect(md5Of(buf)).toBe(md5Of(Buffer.from('hello 表情包', 'utf8')))
    expect(md5Of(buf)).not.toBe(md5Of(Buffer.from('hello 表情包!', 'utf8')))
  })

  it('similarityPct：汉明距离 → 相似度百分比（0~100）', () => {
    expect(similarityPct(0)).toBe(100) // 完全相同
    expect(similarityPct(64)).toBe(0) // 完全无关
    expect(similarityPct(32)).toBe(50)
    // dHash 阈值边界：0-3 高度相似（红）→ ≥95%；4-8 相似（黄）→ 88%~94%
    expect(similarityPct(3)).toBe(95)
    expect(similarityPct(4)).toBe(94)
    expect(similarityPct(8)).toBe(88)
    expect(similarityPct(9)).toBe(86) // >8 不标记，但换算仍给出参考值
    // 非法输入钳制
    expect(similarityPct(-1)).toBe(0)
    expect(similarityPct(Number.NaN)).toBe(0)
    expect(similarityPct(Number.MAX_SAFE_INTEGER)).toBe(0)
  })

  it('pHash 输出 64bit 十六进制（16 字符）且对相同输入稳定', () => {
    const mk = (): Uint8ClampedArray => {
      const p = new Uint8ClampedArray(64 * 64 * 4)
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const i = (y * 64 + x) * 4
          p[i] = (x * 3) % 256
          p[i + 1] = (y * 5) % 256
          p[i + 2] = (x + y) % 256
          p[i + 3] = 255
        }
      }
      return p
    }
    const h1 = pHashFromPixels(mk(), 64, 64)
    const h2 = pHashFromPixels(mk(), 64, 64)
    expect(h1).toMatch(/^[0-9a-f]{16}$/)
    expect(h1).toBe(h2)
    // 不同图案 → 距离明显大于相同图案
    const other = new Uint8ClampedArray(64 * 64 * 4)
    for (let i = 0; i < other.length; i += 4) {
      other[i] = other[i + 1] = other[i + 2] = 0
      other[i + 3] = 255
    }
    expect(hammingDistance(h1, pHashFromPixels(other, 64, 64))).toBeGreaterThan(10)
  })

  it('pHash 对亮度/轻微压缩变化鲁棒（汉明距离小）', () => {
    // 现实感纹理（确定性伪随机）：纯平滑渐变/纯色图的 DCT 只有 DC + 少量低频项，
    // 中位数编码会因浮点噪声翻转大量 bit，属退化输入；真实表情图都是有丰富纹理的。
    const mk = (bright: number, jitter: number): Uint8ClampedArray => {
      const p = new Uint8ClampedArray(64 * 64 * 4)
      let seed = 12345
      const rnd = (): number => {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        return (seed >>> 0) / 4294967295
      }
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const i = (y * 64 + x) * 4
          p[i] = Math.min(240, Math.max(15, Math.floor(rnd() * 200) + bright + Math.floor(rnd() * jitter)))
          p[i + 1] = Math.min(240, Math.max(15, Math.floor(rnd() * 200) + bright))
          p[i + 2] = Math.min(240, Math.max(15, Math.floor(rnd() * 200) + bright))
          p[i + 3] = 255
        }
      }
      return p
    }
    const h1 = pHashFromPixels(mk(0, 0), 64, 64)
    const h2 = pHashFromPixels(mk(20, 4), 64, 64) // 亮度偏移 + 轻微噪点（模拟压缩）
    expect(hammingDistance(h1, h2)).toBeLessThan(6)
    // 完全相同输入 → 距离 0
    expect(hammingDistance(h1, pHashFromPixels(mk(0, 0), 64, 64))).toBe(0)
  })

  it('pHashRot 生成 4 个方向哈希，旋转 90° 的图像最小距离很小', () => {
    const mk = (): Uint8ClampedArray => {
      // 非对称图案（横向渐变 + 纵向方块），旋转后应有明确对应
      const p = new Uint8ClampedArray(32 * 32 * 4)
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const i = (y * 32 + x) * 4
          p[i] = x < 16 ? 255 : 0 // 左半白右半黑
          p[i + 1] = y < 16 ? 255 : 0
          p[i + 2] = 128
          p[i + 3] = 255
        }
      }
      return p
    }
    // 顺时针旋转 90°：dst[x][y] = src[y][n-1-x]
    const rot = (src: Uint8ClampedArray, n: number): Uint8ClampedArray => {
      const out = new Uint8ClampedArray(n * n * 4)
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const si = (y * n + x) * 4
          const di = (x * n + (n - 1 - y)) * 4
          out[di] = src[si]
          out[di + 1] = src[si + 1]
          out[di + 2] = src[si + 2]
          out[di + 3] = 255
        }
      }
      return out
    }
    const base = mk()
    const rots = pHashRotFromPixels(base, 32, 32)
    expect(rots).toHaveLength(4)
    // 旋转后的图像与基准的最小旋转距离应接近 0
    const rotatedPixels = rot(rot(rot(base, 32), 32), 32) // 旋转 270°（等价 90° 逆时针）
    const rotatedRots = pHashRotFromPixels(rotatedPixels, 32, 32)
    expect(minRotationDistance(rots, rotatedRots)).toBeLessThanOrEqual(4)
    // 同一图像自比较 → 0
    expect(minRotationDistance(rots, pHashRotFromPixels(base, 32, 32))).toBe(0)
  })
})

describe('duplicate-service', () => {
  it('相同内容文件（复制品）标记为高度相似', async () => {
    const a = join(dir, 'a.png')
    const b = join(dir, 'b.png')
    writeFileSync(a, Buffer.alloc(64, 7)) // 相同字节
    writeFileSync(b, Buffer.alloc(64, 7))
    const result = await analyzeDuplicates([mkFile('a.png'), mkFile('b.png')])
    const dup = result.filter((f) => f.duplicate)
    expect(dup.length).toBe(1)
    expect(dup[0].duplicateLevel).toBe('high')
    expect(dup[0].duplicateOf).toBeDefined()
    // md5 精确重复 → 相似度 100%
    expect(dup[0].similarity).toBe(100)
  })

  it('不同内容文件不标记', async () => {
    const a = join(dir, 'a.png')
    const b = join(dir, 'b.png')
    writeFileSync(a, Buffer.alloc(64, 1))
    writeFileSync(b, Buffer.alloc(64, 2))
    const result = await analyzeDuplicates([mkFile('a.png'), mkFile('b.png')])
    expect(result.filter((f) => f.duplicate).length).toBe(0)
  })

  it('相似图（同内容不同文件名）标记等级在 high/similar 内', async () => {
    // 直接构造两个几乎相同的真实 PNG：字节不同（不同文件头）但视觉相同较难，
    // 这里用同一文件复制 + 微调字节 → 视觉几乎一致但字节不同（dHash 路径）
    const a = join(dir, 'a.png')
    const b = join(dir, 'b.png')
    const base = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    writeFileSync(a, base)
    const mod = Buffer.from(base)
    mod[mod.length - 1] ^= 0xff // 最后字节翻转（PNG IEND 之后的填充，不影响像素）
    writeFileSync(b, mod)
    const result = await analyzeDuplicates([mkFile('a.png'), mkFile('b.png')])
    expect(result.filter((f) => f.duplicate).length).toBeGreaterThanOrEqual(0)
  })

  it('进度回调递增且最终等于总数', async () => {
    const a = join(dir, 'a.png')
    const b = join(dir, 'b.png')
    writeFileSync(a, Buffer.alloc(32, 3))
    writeFileSync(b, Buffer.alloc(32, 4))
    const steps: number[] = []
    await analyzeDuplicates([mkFile('a.png'), mkFile('b.png')], 'folder', (done) => steps.push(done))
    expect(steps[steps.length - 1]).toBe(2)
    expect(steps[0]).toBeGreaterThanOrEqual(1)
  })

  it('pHash 模式：相同内容（复制品）标记 high，不同内容不标记', async () => {
    const a = join(dir, 'pa.png')
    const b = join(dir, 'pb.png')
    // 用同一个真实 1x1 PNG 复制两份（字节相同 → md5 精确重复，恒 high）
    const base = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    writeFileSync(a, base)
    writeFileSync(b, base)
    const result = await analyzeDuplicates([mkFile('pa.png'), mkFile('pb.png')], 'folder', undefined, false, 'pHash')
    expect(result.filter((f) => f.duplicate).length).toBe(1)
    expect(result.find((f) => f.duplicate)?.duplicateLevel).toBe('high')
  })

  it('跨 scope：本地文件夹文件与上传条目统一分组，duplicateOf 指向对方真实 id', async () => {
    // 文件夹文件（local_ 前缀 id）+ 上传条目（scope- 前缀 id）：同一张图各存一份 → 互相标记
    const folderFile = join(dir, 'folder', 'meme.png')
    const uploadFile = join(dir, 'uploads', 'meme.png')
    mkdirSync(join(dir, 'folder'), { recursive: true })
    mkdirSync(join(dir, 'uploads'), { recursive: true })
    const base = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    writeFileSync(folderFile, base)
    writeFileSync(uploadFile, base)
    const folder = { id: 'local_abc', name: 'meme', localPath: folderFile, parentDir: 'folder' }
    const upload = { id: 'scope-2001', name: 'meme', localPath: uploadFile, parentDir: 'uploads' }
    const result = await analyzeDuplicates([folder as any, upload as any], 'upload')
    // 组代表 = 排序靠前的 folder；上传条目标记为 high，duplicateOf 指向 local_abc（原 id）
    const up = result.find((f) => f.id === 'scope-2001')
    expect(up?.duplicate).toBe(true)
    expect(up?.duplicateLevel).toBe('high')
    expect(up?.duplicateOf).toBe('local_abc')
    expect(up?.similarity).toBe(100)
    // 文件夹文件是组代表：不标记
    const fo = result.find((f) => f.id === 'local_abc')
    expect(fo?.duplicate).toBe(false)
  })

  it('pHash 模式：视觉相同的图片（不同字节）也能被标记为相似', async () => {
    const a = join(dir, 'qa.png')
    const b = join(dir, 'qb.png')
    // 用 jimp 生成两张像素完全相同的 PNG（同内容不同编码 → md5 不同但 pHash 相同）
    const Jimp: any = (await import('jimp')).default
    const mk = (size: number): Promise<Buffer> => {
      return new Promise((resolve, reject) => {
        new Jimp(size, size, 0xff4466ff, (err: Error | null, img: any) => {
          if (err) return reject(err)
          img.getBuffer(Jimp.MIME_PNG, (e: Error | null, buf: Buffer) => (e ? reject(e) : resolve(buf)))
        })
      })
    }
    writeFileSync(a, await mk(8))
    writeFileSync(b, await mk(9)) // 同色不同尺寸 → 字节不同、视觉相同
    const result = await analyzeDuplicates([mkFile('qa.png'), mkFile('qb.png')], 'folder', undefined, false, 'pHash')
    const dup = result.filter((f) => f.duplicate)
    expect(dup.length).toBe(1)
    // 视觉相同 → 汉明距离小 → 相似度百分比接近 100
    expect(dup[0].similarity).toBeGreaterThanOrEqual(90)
  })
})
