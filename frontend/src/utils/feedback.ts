import { ElMessage } from 'element-plus'

/**
 * 统一错误提示：先展示给用户，再异步上报主进程 error.log（主进程按标签+内容聚合去重）。
 * 所有业务错误提示都应走这里，保证线上问题可排查。
 */
export function showError(tag: string, message: string): void {
  ElMessage.error(message)
  try {
    window.api?.reportError(tag, message)
  } catch {
    /* 上报失败不影响用户提示 */
  }
}

/**
 * 静默上报（不打扰用户，仅记录）：适合后台操作失败等场景。
 */
export function reportError(tag: string, message: string): void {
  try {
    window.api?.reportError(tag, message)
  } catch {
    /* 上报失败静默 */
  }
}
