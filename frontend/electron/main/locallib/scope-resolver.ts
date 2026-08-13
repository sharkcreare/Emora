import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 上传/收藏去重的磁盘路径解析（纯函数，可单测）。
 *
 * 上传表情在本地模式存于 ~/.emoji-assistant/uploads/（与后端 AppProperties 默认一致），
 * URL 为 /uploads/yyyy/MM/uuid.ext。收藏里的 UPLOAD 记录同样以该 URL 引用。
 * 种子 LOCAL 表情（/static/emojis/...）在 jar 内、网络表情为 http(s) 地址，
 * 均不可解析为本地文件 → 返回 null（去重时跳过，不标记）。
 */

/** 上传表情本地根目录（与后端默认 upload-dir 一致） */
export function uploadRoot(): string {
  return join(homedir(), '.emoji-assistant', 'uploads')
}

/**
 * 把 emoji 的 url 解析为本地磁盘绝对路径：
 *   - /uploads/yyyy/MM/xx.ext → <uploadRoot>/yyyy/MM/xx.ext
 *   - 已是本地绝对路径（Windows 盘符）→ 原样返回（本地文件夹收藏复用）
 *   - 其余（/static/...、http(s)://...、空）→ null（不可解析，跳过）
 */
export function resolveEmojiLocalPath(url: string): string | null {
  if (!url) return null
  const m = /^\/uploads\/(.+)$/.exec(url)
  if (m) {
    return join(uploadRoot(), ...m[1].split('/').filter(Boolean))
  }
  if (/^[a-zA-Z]:[\\/]/.test(url)) {
    return url
  }
  return null
}
