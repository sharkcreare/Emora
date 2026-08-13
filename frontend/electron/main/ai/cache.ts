import { app } from 'electron'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AiTagResult } from './types'

/**
 * AI 标签缓存（userData/ai-tags.json）。
 *
 * 键：文件绝对路径；条目绑定「文件指纹(mtime+size) + 模型版本」——
 * 图片变化或模型升级后旧结果自动作废，避免污染（图片 hash 绑定由指纹承担，
 * 继承机制所需的 contentHash 存于条目内，供相似图标签继承直接复用）。
 * 单测环境无 electron app 时自动落到系统临时目录（与 locallib/cache 同范式）。
 */

/** 测试钩子：指定缓存文件路径 */
let cacheFileOverride = ''

export function setAiCacheFileForTests(file: string): void {
  cacheFileOverride = file
}

function cacheFile(): string {
  if (cacheFileOverride) return cacheFileOverride
  try {
    return join(app.getPath('userData'), 'ai-tags.json')
  } catch {
    return join(tmpdir(), 'emoji-assistant-ai-tags.json')
  }
}

let cache: Record<string, AiTagResult> = {}

/** 加载缓存（应用启动时调用一次） */
export function loadAiTagCache(): void {
  try {
    const raw = readFileSync(cacheFile(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, AiTagResult>
    cache = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cache = {}
  }
}

/** 保存缓存（增量更新后落盘） */
export function saveAiTagCache(): void {
  try {
    writeFileSync(cacheFile(), JSON.stringify(cache, null, 2), 'utf8')
  } catch (err) {
    console.warn('[ai] 保存标签缓存失败:', err)
  }
}

/**
 * 读取缓存；文件指纹 / 模型版本 / 标签池版本任一不匹配 → 删除该条并返回 null。
 * @param labelVersion 标签池版本（可选，缺省不做标签池校验，兼容旧条目）
 */
export function getCachedAiTags(
  localPath: string,
  modelVersion: string,
  labelVersion?: string
): AiTagResult | null {
  const entry = cache[localPath]
  if (!entry) return null
  // 模型版本不符：模型升级后的旧结果作废
  if (entry.modelVersion !== modelVersion) {
    delete cache[localPath]
    return null
  }
  // 标签池版本不符：标签池变化后的旧结果作废
  if (labelVersion !== undefined && entry.labelVersion !== labelVersion) {
    delete cache[localPath]
    return null
  }
  // 文件指纹不符：图片已变化
  let stat
  try {
    stat = statSync(localPath)
  } catch {
    delete cache[localPath]
    return null
  }
  if (entry.fingerprint.mtime !== stat.mtimeMs || entry.fingerprint.size !== stat.size) {
    delete cache[localPath]
    return null
  }
  return entry
}

/** 写入单文件分析结果 */
export function setCachedAiTags(localPath: string, result: AiTagResult): void {
  cache[localPath] = result
}

/** 清空全部缓存（「重新分析」强制全量重算用），并落盘 */
export function clearAiTagCache(): void {
  cache = {}
  saveAiTagCache()
}

/** 仅清空内存缓存（测试用：模拟「已保存后重启再加载」），不落盘 */
export function resetAiTagCacheMemory(): void {
  cache = {}
}

/** 清理模型版本不符的旧结果（模型升级后调用），返回清理条数 */
export function pruneStaleAiTags(modelVersion: string): number {
  let removed = 0
  for (const [k, v] of Object.entries(cache)) {
    if (v.modelVersion !== modelVersion) {
      delete cache[k]
      removed++
    }
  }
  if (removed) saveAiTagCache()
  return removed
}

/** 已缓存条数（M0 供 AI 分析状态展示） */
export function aiTagCacheSize(): number {
  return Object.keys(cache).length
}
