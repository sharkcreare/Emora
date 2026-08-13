import { net } from 'electron'

/** 后端服务地址（与渲染进程 axios 的 baseURL 保持一致） */
export const API_BASE = 'http://127.0.0.1:18080'

/**
 * 通知后端某表情被使用：累加热度、写入最近使用（失败静默，不影响发送主流程）。
 */
export function notifyEmojiUsed(id: number): void {
  net
    .fetch(`${API_BASE}/api/emoji/${id}/use`, { method: 'POST' })
    .catch((err) => console.warn('[backend] 上报使用记录失败:', err))
}
