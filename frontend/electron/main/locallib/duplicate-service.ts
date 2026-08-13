import { readFileSync, existsSync, statSync } from 'node:fs'
import type { LocalFileEmoji } from './types'
import { md5Of, dHashFromPixels, pHashRotFromPixels, hammingDistance, minRotationDistance, similarityPct, type HashType } from './phash'
import { getCachedHashes, setCachedHashes, thumbPathOf } from './cache'

/**
 * 重复检测服务（duplicate-service）。
 *
 * scope 参数支持 folder / upload / favorite：
 *   - folder   本地文件夹托管（locallib 扫描结果）
 *   - upload   自定义上传表情（渲染层传条目，主进程解析磁盘路径）
 *   - favorite 收藏列表（可解析的上传/文件夹项，种子 LOCAL 在 jar 内不可解析则跳过）
 * 核心哈希/分组逻辑与 scope 无关，调用方只需喂入带 id/localPath 的文件列表。
 *
 * 相似度判定（汉明距离，阈值按 hashType 区分）：
 *   dHash：0-3 高度相似（红）/ 4-8 相似（黄）/ >8 不处理
 *   pHash：0-4 高度相似（红）/ 5-10 相似（黄）/ >10 不处理
 *          （DCT 系数经中位数阈值编码，相似图的汉明距离普遍比 dHash 略大）
 *
 * 精确重复：md5 相同 = 高度相似（白名单优先，不依赖感知哈希阈值）。
 */

/** 检测范围（folder / upload / favorite） */
export type DuplicateScope = 'folder' | 'upload' | 'favorite'

/** 分析进度回调（done/total，主进程据此推送渲染层进度条） */
export type AnalyzeProgress = (done: number, total: number) => void

/** 相似度等级（前端角标用：红=高度相似，黄=相似） */
export type DuplicateLevel = 'high' | 'similar'

/** 各 hashType 的相似度阈值：{ high: 高度相似上限, similar: 相似上限 } */
export const HASH_THRESHOLDS: Record<Exclude<HashType, 'md5'>, { high: number; similar: number }> = {
  dHash: { high: 3, similar: 8 },
  pHash: { high: 4, similar: 10 }
}

/** 默认相似度算法（与旧版本行为一致） */
export const DEFAULT_HASH_TYPE: Exclude<HashType, 'md5'> = 'dHash'

/**
 * 单文件哈希计算（缓存命中直接复用）。
 * 始终同时计算 md5 + dHash + pHash(4 方向)：一次解码、成本接近，
 * 切换 hashType 时无需重算（缓存已含全部类型）。
 * 解码优先用缩略图（更小更快）。
 */
async function computeHashes(localPath: string, hasThumb: boolean): Promise<{ md5?: string; dHash?: string; pHashRot?: string[] } | null> {
  try {
    const cached = getCachedHashes(localPath)
    if (cached && cached.md5 && cached.dHash && cached.pHashRot && cached.pHashRot.length === 4) {
      return { md5: cached.md5, dHash: cached.dHash, pHashRot: cached.pHashRot }
    }
    const buf = readFileSync(localPath)
    const md5 = md5Of(buf)
    let dHash: string | undefined
    let pHashRot: string[] | undefined
    // 缩略图已生成则解码缩略图（更小更快）；否则解码原图
    const thumbPath = hasThumb ? thumbPathOf(localPath) : null
    const src = thumbPath && existsSync(thumbPath) ? thumbPath : localPath
    try {
      const jimpMod = await import('jimp')
      const Jimp: any = (jimpMod as any).default ?? jimpMod
      const img = await Jimp.read(src)
      const { data, width, height } = img.bitmap
      dHash = dHashFromPixels(data, width, height)
      pHashRot = pHashRotFromPixels(data, width, height)
    } catch {
      // 解码失败（损坏文件）：仅保留 md5
    }
    const stat = statSync(localPath, { throwIfNoEntry: false })
    const hashes = {
      md5,
      dHash,
      pHash: pHashRot?.[0],
      pHashRot,
      mtime: stat?.mtimeMs ?? 0,
      size: stat?.size ?? 0
    }
    setCachedHashes(localPath, hashes)
    return { md5, dHash, pHashRot }
  } catch (err) {
    console.warn('[locallib] 计算哈希失败:', localPath, err)
    return null
  }
}

/** 计算两个文件哈希的相似度距离（按激活的 hashType 选择算法） */
function similarityDistance(
  a: { dHash?: string; pHashRot?: string[] },
  b: { dHash?: string; pHashRot?: string[] },
  hashType: Exclude<HashType, 'md5'>
): number {
  if (hashType === 'pHash') {
    return a.pHashRot && b.pHashRot ? minRotationDistance(a.pHashRot, b.pHashRot) : Number.MAX_SAFE_INTEGER
  }
  return a.dHash && b.dHash ? hammingDistance(a.dHash, b.dHash) : Number.MAX_SAFE_INTEGER
}

/** 生成缩略图（复用 index.ts 的协议逻辑前，先确认缩略图是否已存在；不存在则返回 false 表示需解码原图） */
async function thumbExists(localPath: string): Promise<boolean> {
  const p = thumbPathOf(localPath)
  if (existsSync(p) && statSync(p).size > 0) {
    return true
  }
  // 缩略图尚未生成：异步生成一次（复用 jimp），失败返回 false
  try {
    const jimpMod = await import('jimp')
    const Jimp: any = (jimpMod as any).default ?? jimpMod
    const img = await Jimp.read(localPath)
    const max = 200
    if (img.getWidth() > max || img.getHeight() > max) {
      if (img.getWidth() >= img.getHeight()) img.resize(max, Jimp.AUTO)
      else img.resize(Jimp.AUTO, max)
    }
    const png = await img.getBufferAsync(Jimp.MIME_PNG)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { dirname } = await import('node:path')
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, png)
    return true
  } catch {
    return false
  }
}

/**
 * 分析文件列表并标记重复。
 * @param files  待检测文件（已含 id/localPath）
 * @param scope  检测范围（预留扩展）
 * @param onProgress 进度回调
 * @param force  强制重算（忽略缓存；当前由上层清缓存实现）
 * @param hashType 相似度算法（dHash / pHash，阈值随类型变化）
 */
export async function analyzeDuplicates(
  files: LocalFileEmoji[],
  scope: DuplicateScope = 'folder',
  onProgress?: AnalyzeProgress,
  force = false,
  hashType: Exclude<HashType, 'md5'> = DEFAULT_HASH_TYPE
): Promise<LocalFileEmoji[]> {
  const { high: HIGH_MAX, similar: SIMILAR_MAX } = HASH_THRESHOLDS[hashType]
  const total = files.length
  // 1. 计算所有文件哈希（并发上限 4，避免解码风暴）
  const hashes = new Map<string, { md5?: string; dHash?: string; pHashRot?: string[] }>()
  let done = 0
  const queue = [...files]
  const workers = Array.from({ length: Math.min(4, Math.max(1, total)) }, async () => {
    while (queue.length) {
      const f = queue.shift()
      if (!f) continue
      const h = await computeHashes(f.localPath, true)
      if (h) hashes.set(f.localPath, h)
      done++
      onProgress?.(done, total)
    }
  })
  await Promise.all(workers)

  // 2. 分组：md5 精确重复（强制 high）+ 感知哈希相似
  //    组代表 = 组内排序最靠前的文件 id；其余标记 duplicate + duplicateOf（代表 id）
  const levelByPath = new Map<string, DuplicateLevel>()
  const representativeByPath = new Map<string, string>()
  const similarityByPath = new Map<string, number>()
  const idByPath = new Map<string, string>()
  for (const f of files) {
    idByPath.set(f.localPath, f.id)
  }
  const md5Groups = new Map<string, string[]>()
  for (const f of files) {
    const md5 = hashes.get(f.localPath)?.md5
    if (md5) {
      const group = md5Groups.get(md5) ?? []
      group.push(f.localPath)
      md5Groups.set(md5, group)
    }
  }
  // 3. 先处理 md5 精确重复（组代表 = 排序最靠前的文件 id；字节完全相同 → 相似度 100%）
  for (const group of md5Groups.values()) {
    if (group.length <= 1) continue
    const rep = idByPath.get(group[0]) ?? group[0]
    for (const p of group.slice(1)) {
      levelByPath.set(p, 'high')
      representativeByPath.set(p, rep)
      similarityByPath.set(p, 100)
    }
  }
  // 4. 感知哈希相似分组（O(n²) 比较，仅在未标记的路径间进行）
  const paths = files.map((f) => f.localPath)
  for (let i = 0; i < paths.length; i++) {
    const a = paths[i]
    if (levelByPath.has(a)) continue // 已被 md5 标记
    const ha = hashes.get(a)
    if (!ha) continue
    for (let j = i + 1; j < paths.length; j++) {
      const b = paths[j]
      if (levelByPath.has(b)) continue
      const hb = hashes.get(b)
      if (!hb) continue
      const dist = similarityDistance(ha, hb, hashType)
      if (dist <= SIMILAR_MAX) {
        // 以 a 为代表（排序靠前），b 标记（duplicateOf = a 的 id）；相似度 = 汉明距离换算的百分比
        const level: DuplicateLevel = dist <= HIGH_MAX ? 'high' : 'similar'
        levelByPath.set(b, level)
        representativeByPath.set(b, idByPath.get(a) ?? a)
        similarityByPath.set(b, similarityPct(dist))
      }
    }
  }

  // 5. 写回
  return files.map((f) => {
    const level = levelByPath.get(f.localPath)
    const rep = representativeByPath.get(f.localPath)
    const similarity = similarityByPath.get(f.localPath)
    return {
      ...f,
      duplicate: level ? true : false,
      duplicateLevel: level,
      duplicateOf: rep,
      similarity
    }
  })
}

export type { HashType }
