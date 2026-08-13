import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import { statSync } from 'node:fs'

/**
 * 缩略图文件名纯函数（不依赖 electron，可在 worker_thread 内安全引用）。
 * locallib（主进程）与 AI worker 共用同一命名规则，保证缩略图缓存互通。
 * 命名：sha1(小写路径|mtime|size) + 扩展名（gif 保留动图扩展，其余 png）。
 */
export function thumbFileName(localPath: string): string {
  const stat = statSync(localPath, { throwIfNoEntry: false })
  const mtime = stat?.mtimeMs ?? 0
  const hash = createHash('sha1').update(`${localPath.toLowerCase()}|${mtime}|${stat?.size ?? 0}`).digest('hex')
  const ext = extname(localPath).slice(1).toLowerCase()
  return `${hash}.${ext === 'gif' ? 'gif' : 'png'}`
}
