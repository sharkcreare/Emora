import axios from 'axios'

/** 默认后端地址（与主进程 backend.ts 保持一致） */
const DEFAULT_BASE = 'http://127.0.0.1:18080'

export const http = axios.create({
  baseURL: DEFAULT_BASE,
  timeout: 8000
})

// 优先从主进程读取后端地址（打包后可配置），异步设置，默认值兜底
if (typeof window !== 'undefined' && window.api?.getApiBase) {
  void window.api
    .getApiBase()
    .then((base) => {
      if (base) http.defaults.baseURL = base
    })
    .catch(() => undefined)
}

/** 解析图片完整地址：相对路径拼上后端地址；locallib:// 本地协议 / 绝对路径原样返回 */
export function resolveImageUrl(url: string): string {
  if (!url) return ''
  if (/^(https?:\/\/|locallib:\/\/)/i.test(url)) return url
  // Windows 绝对路径（C:\xxx）或 UNC 路径原样返回
  if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('\\')) return url
  return `${http.defaults.baseURL}${url.startsWith('/') ? '' : '/'}${url}`
}
