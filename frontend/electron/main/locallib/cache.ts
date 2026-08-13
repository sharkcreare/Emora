import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { thumbFileName } from './thumb-util'
import type { FileHashes } from './phash'

/**
 * 本地文件夹哈希缓存（userData/phash-cache.json）与缩略图路径工具。
 * 缓存键：文件绝对路径；命中条件：mtime + size 完全一致（文件未变）。
 * 重扫时未变文件零计算，只有新增/修改的文件才重新计算哈希。
 */

/** 缩略图目录（userData/thumbnails/，渲染层显示与 dHash 解码共用；单测环境无 electron 则落到系统临时目录） */
export const THUMB_DIR = (): string => {
  try {
    return join(app.getPath('userData'), 'thumbnails')
  } catch {
    return join(tmpdir(), 'emoji-assistant-thumbs')
  }
}

interface CacheFile {
  hashes: FileHashes
}

let cache: Record<string, FileHashes> = {}

function cacheFile(): string {
  try {
    return join(app.getPath('userData'), 'phash-cache.json')
  } catch {
    return join(tmpdir(), 'emoji-assistant-phash-cache.json')
  }
}

/** 加载缓存（应用启动时调用一次） */
export function loadHashCache(): void {
  try {
    const raw = readFileSync(cacheFile(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, CacheFile>
    cache = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (v && v.hashes) cache[k] = v.hashes
    }
  } catch {
    cache = {}
  }
}

/** 保存缓存（增量更新后落盘） */
export function saveHashCache(): void {
  try {
    const out: Record<string, CacheFile> = {}
    for (const [k, v] of Object.entries(cache)) {
      out[k] = { hashes: v }
    }
    writeFileSync(cacheFile(), JSON.stringify(out, null, 2), 'utf8')
  } catch (err) {
    console.warn('[locallib] 保存哈希缓存失败:', err)
  }
}

/** 读取单文件哈希快照；文件不存在/已变化返回 null（需重新计算） */
export function getCachedHashes(localPath: string): FileHashes | null {
  const entry = cache[localPath]
  if (!entry) return null
  let stat
  try {
    stat = statSync(localPath)
  } catch {
    return null
  }
  // mtime + size 指纹不一致 → 文件已变，缓存失效
  if (entry.mtime !== stat.mtimeMs || entry.size !== stat.size) {
    delete cache[localPath]
    return null
  }
  return entry
}

/** 写入单文件哈希快照 */
export function setCachedHashes(localPath: string, hashes: FileHashes): void {
  cache[localPath] = hashes
}

/** 清空全部缓存（「重新分析」时调用，强制全量重算） */
export function clearHashCache(): void {
  cache = {}
  saveHashCache()
}

/** 缩略图文件路径（与渲染层显示共用命名规则，dHash 解码直接复用缩略图） */
export function thumbPathOf(localPath: string): string {
  return join(THUMB_DIR(), thumbFileName(localPath))
}
