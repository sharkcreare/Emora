import { createHash } from 'node:crypto'

/**
 * 感知哈希（Perceptual Hash）计算。
 *
 * 哈希类型（hashType 配置，用于相似度比较）：
 *  - md5  ：字节级精确哈希（完全相同判定，代价最低，始终计算）
 *  - dHash：差异哈希（缩放/亮度/压缩鲁棒，比较快）
 *  - pHash：DCT 感知哈希（对压缩更鲁棒；配 4 方向旋转哈希，对 90° 旋转鲁棒）
 *
 * 统一输出 64 位十六进制字符串（md5 截断为 64 位以保持等长可比对）。
 */

export type HashType = 'md5' | 'dHash' | 'pHash'

/** 单个文件的哈希快照（写入 cache.ts 的 phash-cache.json） */
export interface FileHashes {
  /** 各类型哈希（十六进制，统一 64 bit） */
  md5?: string
  dHash?: string
  /** DCT pHash：0° 方向的基准哈希（pHashRot[0]） */
  pHash?: string
  /** DCT pHash 的 4 个旋转方向（0°/90°/180°/270°），用于旋转鲁棒比较 */
  pHashRot?: string[]
  /** 计算时的文件指纹（mtime + size），用于缓存失效判断 */
  mtime: number
  size: number
}

/** 文件字节 md5（64 bit 截断），用于精确重复判定 */
export function md5Of(buffer: Buffer): string {
  return createHash('md5').update(buffer).digest('hex').slice(0, 16)
}

/** 汉明距离：两个等长十六进制哈希逐位差异数（0 = 完全相同） */
export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      dist += x & 1
      x >>= 1
    }
  }
  return dist
}

/**
 * 计算 dHash：将图像缩放到 9×8 灰度，逐像素与右邻比较生成 64 bit。
 * 输入为 RGBA 像素数据（长度 = w*h*4）与宽高。
 * 对缩放、亮度、JPEG 压缩鲁棒；对旋转不敏感（符合表情包相似场景）。
 */
export function dHashFromPixels(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): string {
  // 缩放到 9×8
  const SW = 9
  const SH = 8
  const gray = new Uint8Array(SW * SH)
  const xs = width / SW
  const ys = height / SH
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      // 取采样块中心像素（邻近采样，避免整图逐像素遍历）
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * xs))
      const sy = Math.min(height - 1, Math.floor((y + 0.5) * ys))
      const i = (sy * width + sx) * 4
      // 亮度加权（Rec.601）
      gray[y * SW + x] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2])
    }
  }
  // 每行 9 个灰度，比较相邻 8 对 → 每行 8 bit，共 8 行 64 bit
  let bits = ''
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW - 1; x++) {
      bits += gray[y * SW + x] > gray[y * SW + x + 1] ? '1' : '0'
    }
  }
  // 64 bit → 16 位十六进制
  let hex = ''
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  }
  return hex
}

/* ---------------- DCT pHash ---------------- */

/** DCT 输入尺寸（32×32）与保留的低频块（8×8） */
const PHASH_N = 32
const PHASH_M = 8

/** 一维 DCT-II（length = n），O(n²)，n=32 时足够快 */
function dct1d(input: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n)
  const scale0 = Math.sqrt(1 / n)
  const scale = Math.sqrt(2 / n)
  for (let u = 0; u < n; u++) {
    const cu = u === 0 ? scale0 : scale
    let sum = 0
    for (let x = 0; x < n; x++) {
      sum += input[x] * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n))
    }
    out[u] = cu * sum
  }
  return out
}

/** 二维 DCT-II（分离式：先行后列），返回 n×n 系数矩阵 */
function dct2d(matrix: Float64Array, n: number): Float64Array {
  const rows = new Float64Array(n * n)
  for (let y = 0; y < n; y++) {
    const row = dct1d(matrix.subarray(y * n, y * n + n), n)
    rows.set(row, y * n)
  }
  const out = new Float64Array(n * n)
  for (let x = 0; x < n; x++) {
    const col = new Float64Array(n)
    for (let y = 0; y < n; y++) col[y] = rows[y * n + x]
    const dct = dct1d(col, n)
    for (let y = 0; y < n; y++) out[y * n + x] = dct[y]
  }
  return out
}

/** 将图像缩放到 N×N 灰度矩阵（双线性近似：块中心采样，Rec.601 亮度加权） */
function grayMatrix(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Float64Array {
  const g = new Float64Array(PHASH_N * PHASH_N)
  const xs = width / PHASH_N
  const ys = height / PHASH_N
  for (let y = 0; y < PHASH_N; y++) {
    for (let x = 0; x < PHASH_N; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * xs))
      const sy = Math.min(height - 1, Math.floor((y + 0.5) * ys))
      const i = (sy * width + sx) * 4
      g[y * PHASH_N + x] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
    }
  }
  return g
}

/** 顺时针旋转 90°（N×N 灰度矩阵） */
function rotate90(g: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n * n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // (x,y) → (n-1-y, x)
      out[x * n + (n - 1 - y)] = g[y * n + x]
    }
  }
  return out
}

/**
 * 由 DCT 系数矩阵生成 64 bit pHash：取左上 8×8 低频块，按中位数阈值逐位编码。
 * 中位数在 63 个 AC 系数上计算（剔除 DC 分量），使哈希对整体亮度变化鲁棒
 * （亮度偏移只影响 DC 项，不影响 AC 中位数 → 最多翻转 1 bit）。
 */
function hashFromDct(dct: Float64Array, n: number): string {
  const coeffs: number[] = []
  for (let v = 0; v < PHASH_M; v++) {
    for (let u = 0; u < PHASH_M; u++) {
      coeffs.push(dct[v * n + u])
    }
  }
  // 剔除 DC（索引 0），在 AC 系数上取中位数 → 亮度无关
  const ac = coeffs.slice(1)
  const sorted = [...ac].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  let bits = ''
  for (const c of coeffs) bits += c > median ? '1' : '0'
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

/**
 * 计算 DCT pHash（0° 方向基准哈希）。
 * 对 JPEG/缩放等压缩更鲁棒（DCT 低频分量稳定）；配合旋转方向数组可抗 90° 旋转。
 */
export function pHashFromPixels(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): string {
  const gray = grayMatrix(rgba, width, height)
  const dct = dct2d(gray, PHASH_N)
  return hashFromDct(dct, PHASH_N)
}

/**
 * 计算 4 个旋转方向（0°/90°/180°/270°）的 DCT pHash，用于旋转鲁棒比较。
 * 返回 [0°, 90°, 180°, 270°] 对应的 64 bit 哈希数组。
 */
export function pHashRotFromPixels(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): string[] {
  let gray = grayMatrix(rgba, width, height)
  const hashes: string[] = []
  for (let k = 0; k < 4; k++) {
    const dct = dct2d(gray, PHASH_N)
    hashes.push(hashFromDct(dct, PHASH_N))
    gray = rotate90(gray, PHASH_N)
  }
  return hashes
}

/**
 * 两个旋转哈希数组之间的最小汉明距离（跨全部 4×4 方向组合取最小）。
 * 用于 pHash 旋转鲁棒比较：只要任一方向对齐，距离就小。
 */
export function minRotationDistance(a: string[], b: string[]): number {
  if (!a || !b || !a.length || !b.length) return Number.MAX_SAFE_INTEGER
  let min = Number.MAX_SAFE_INTEGER
  for (const ha of a) {
    for (const hb of b) {
      const d = hammingDistance(ha, hb)
      if (d < min) min = d
    }
  }
  return min
}

/** 哈希位宽（dHash / pHash 均为 64 bit） */
export const HASH_BITS = 64

/**
 * 汉明距离 → 相似度百分比（0~100，四舍五入）。
 * 64 bit 哈希：dist=0 → 100%（完全相同），dist=64 → 0%（完全无关）。
 * 用于在重复角标 / 对比面板直接展示「两张图有多像」。
 */
export function similarityPct(dist: number): number {
  if (!Number.isFinite(dist) || dist < 0) return 0
  const pct = (1 - Math.min(dist, HASH_BITS) / HASH_BITS) * 100
  return Math.round(Math.max(0, Math.min(100, pct)))
}
