/**
 * 文件夹自动监听（预留）。
 *
 * 第一版本不实现 fs.watch：添加文件夹 / 扫描 / 手动刷新 / 打开面板自动扫描已覆盖主要场景，
 * 自动监听（拖入新图即时入库）留待后续迭代。
 *
 * 未来接入点：
 *  - fs.watch(recursive) 监听托管文件夹
 *  - 防抖 300ms 后触发 rescanLocallib() + duplicate 重分析
 *  - 推送 locallib:changed 事件让渲染层刷新
 */
export function initWatcher(_folders: string[]): void {
  // 预留：本阶段不启动监听
}

export function stopWatcher(): void {
  // 预留
}
