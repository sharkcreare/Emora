import { readdirSync, statSync } from 'node:fs'
import { extname, basename, join, normalize } from 'node:path'
import { createHash } from 'node:crypto'
import type { LocalFileEmoji } from './types'

/** 支持的图片扩展名（小写，无点） */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

/** 跳过这些目录名（大小写不敏感），避免扫进系统/隐藏/巨型目录 */
const SKIP_DIRS = new Set([
  'node_modules', 'venv', '.git', '.svn', '.hg', 'thumbs', 'cache',
  '$recycle.bin', 'system volume information', 'windows', 'program files'
])

/** 单次扫描文件数上限：防止超大文件夹卡死主进程 */
const MAX_FILES = 3000

/** 生成稳定唯一 ID：local_ + sha1(路径) 前 12 位 */
function localId(filePath: string): string {
  const hash = createHash('sha1').update(filePath.toLowerCase()).digest('hex')
  return `local_${hash.slice(0, 12)}`
}

/** 是否为支持的图片（按扩展名） */
export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.has(extname(filePath).slice(1).toLowerCase())
}

/**
 * 递归扫描一个文件夹下的图片文件。
 * 规则：跳过 SKIP_DIRS / 隐藏目录（. 开头）/ 忽略名单；扩展名过滤；截断到 MAX_FILES。
 * 结果按「父目录 + 文件名」排序，保证多次扫描顺序稳定。
 * 全部为同步 fs 调用（本地小目录扫描毫秒级），在 IPC 调用线程执行不阻塞窗口。
 */
export function scanFolder(folder: string, ignored: Set<string>): LocalFileEmoji[] {
  const root = normalize(folder)
  const out: LocalFileEmoji[] = []

  const walk = (dir: string): void => {
    if (out.length >= MAX_FILES) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // 无权限/已删除目录静默跳过
    }
    // 稳定排序：目录优先按名排，文件按名排
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase()) || entry.name.startsWith('.')) continue
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!isImageFile(full)) continue
      if (ignored.has(normalize(full))) continue
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (!stat.isFile() || stat.size <= 0) continue
      out.push({
        id: localId(full),
        name: basename(full, extname(full)),
        url: locallibUrl(full),
        localPath: normalize(full),
        parentDir: basename(dir),
        tags: '',
        ext: extname(full).slice(1).toLowerCase(),
        size: stat.size,
        mtime: stat.mtimeMs
      })
    }
  }

  walk(root)
  return out
}

/** 生成 locallib:// 协议地址（URL 编码绝对路径；渲染层 img src 直接用） */
export function locallibUrl(filePath: string): string {
  return `locallib://file/${encodeURIComponent(normalize(filePath))}`
}

/** 从 locallib:// 地址还原真实路径；非法地址返回 null */
export function locallibPath(url: string): string | null {
  const m = /^locallib:\/\/file\/(.+)$/.exec(url)
  if (!m) return null
  try {
    return normalize(decodeURIComponent(m[1]))
  } catch {
    return null
  }
}
