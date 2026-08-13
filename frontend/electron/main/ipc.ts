import { app, ipcMain, BrowserWindow } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeImageToClipboard, writeGifToClipboard } from './clipboard'
import { getAutoLaunch, setAutoLaunch } from './autostart'
import { API_BASE, notifyEmojiUsed } from './backend'
import { ensureBackend, stopBackend } from './backend-runner'
import { getNetworkSearchConfig, setNetworkSearchConfig, type NetworkSearchConfig } from './config'
import { minimizePanel, toggleMaximizePanel, setZoom, setPanelMode, beginResize, endResize } from './window'
import { getHotkey, setHotkey, pauseGlobalHotkey, resumeGlobalHotkey } from './hotkey'
import { refreshTrayMenu } from './tray'
import { getGifConfig, setGifConfig } from './media'
import {
  getLocallibState,
  addLocallibFolder,
  removeLocallibFolder,
  rescanLocallib,
  ignoreLocallibFile,
  ignoreLocallibFiles,
  unignoreLocallibFile,
  reanalyzeLocallib,
  getLocallibAnalysisState,
  setLocallibHashType,
  analyzeScope
} from './locallib'
import { getAiModelInfo, requestAiModelDownload, resetAiModel, getAiAnalysisState, onAiModelStateChange } from './ai'
import type { EmojiPayload, GifCompressConfig } from '../shared/types'

/**
 * 渲染进程错误上报：按「标签 + 内容」聚合去重后写入 userData/error.log。
 * 相同错误在 30 秒内重复出现只记一次，避免高频错误刷屏日志。
 */
const lastErrorReport = new Map<string, number>()
const ERROR_DEDUP_MS = 30_000
ipcMain.on('error:report', (_event, tag: unknown, message: unknown) => {
  const t = typeof tag === 'string' ? tag : 'unknown'
  const m = typeof message === 'string' ? message : String(message ?? '未知错误')
  const key = `${t}|${m}`
  const now = Date.now()
  const last = lastErrorReport.get(key) ?? 0
  if (now - last < ERROR_DEDUP_MS) return
  lastErrorReport.set(key, now)
  try {
    appendFileSync(join(app.getPath('userData'), 'error.log'), `[${new Date().toISOString()}] [renderer] ${t}: ${m}\n`)
  } catch (err) {
    console.error('[ipc] 写入 error.log 失败:', err)
  }
})

interface IpcDeps {
  hidePanel: () => void
  togglePanel: () => void
  getTargetWindow: () => { pid: number; title: string } | null
}

export function registerIpc(deps: IpcDeps): void {
  /** GIF 动图（URL 以 .gif 结尾）：以文件拖放格式写入，微信/QQ 粘贴保留动画 */
  const isGifUrl = (url: string): boolean => /\.gif($|\?)/i.test(url)

  // 点击表情：仅复制图片到系统剪贴板（用户自行切到微信/QQ/浏览器按 Ctrl+V 粘贴）。
  // 面板保持打开，可连续复制。不做自动粘贴——目标窗口识别/焦点处理不可靠。
  ipcMain.handle('emoji:send', async (_event, emoji: EmojiPayload) => {
    if (!emoji || typeof emoji.url !== 'string' || !emoji.url) {
      return { ok: false, error: '表情数据无效' }
    }
    try {
      console.log('[ipc] emoji:send 收到, id:', emoji.id, 'url:', emoji.url)
      let hint = false
      if (isGifUrl(emoji.url)) {
        const r = await writeGifToClipboard(emoji.url)
        hint = Boolean(r.hint)
      } else {
        await writeImageToClipboard(emoji.url)
      }
      console.log('[ipc] 剪贴板写入完成')
      // 上报使用记录（异步，失败不影响复制）；网络图库表情 id 为合成负值、本地文件为字符串 id，跳过
      if (typeof emoji.id === 'number' && emoji.id > 0) {
        notifyEmojiUsed(emoji.id)
      }
      return { ok: true, hint }
    } catch (err) {
      console.error('[ipc] 复制表情失败:', err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.on('panel:hide', () => deps.hidePanel())

  // 仅复制到剪贴板（Ctrl+C），不激活目标窗口也不自动粘贴
  ipcMain.handle('emoji:copy', async (_event, emoji: EmojiPayload) => {
    if (!emoji || typeof emoji.url !== 'string' || !emoji.url) {
      return { ok: false, error: '表情数据无效' }
    }
    try {
      let hint = false
      if (isGifUrl(emoji.url)) {
        const r = await writeGifToClipboard(emoji.url)
        hint = Boolean(r.hint)
      } else {
        await writeImageToClipboard(emoji.url)
      }
      return { ok: true, hint }
    } catch (err) {
      console.error('[ipc] 复制表情失败:', err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 窗口控制：最小化 / 最大化切换 / 关闭（关闭=隐藏到托盘，常驻后台）
  ipcMain.on('window:minimize', () => minimizePanel())
  ipcMain.on('window:toggle-maximize', () => toggleMaximizePanel())
  ipcMain.on('window:close', () => deps.hidePanel())

  // 面板模式切换（full=完整面板 / compact=输入法候选小窗），由渲染进程发起
  ipcMain.on('panel:set-mode', (_event, mode: string) => setPanelMode(mode === 'compact' ? 'compact' : 'full'))

  // 浏览器式缩放（Ctrl+滚轮 / Ctrl+± 由渲染进程发起，内容与窗口尺寸联动）
  ipcMain.handle('panel:set-zoom', (_event, factor: number) => setZoom(Number(factor) || 1))

  // 边缘拖动调整窗口大小（渲染进程手柄触发，主进程轮询鼠标位置）
  ipcMain.on('panel:begin-resize', (_event, dir: string) => beginResize(String(dir || '')))
  ipcMain.on('panel:end-resize', () => endResize())

  // 渲染进程请求确保后端可用（自动拉起内置后端，幂等）
  ipcMain.handle('backend:ensure', () => ensureBackend())

  ipcMain.handle('app:getAutoLaunch', () => getAutoLaunch())
  ipcMain.handle('app:setAutoLaunch', (_event, enable: boolean) => setAutoLaunch(enable))
  ipcMain.handle('app:getInfo', () => ({ version: app.getVersion(), platform: process.platform }))
  ipcMain.handle('app:getApiBase', () => API_BASE)

  // 全局快捷键：读取 / 自定义（设置面板录制组合键，主进程检测冲突并持久化）
  ipcMain.handle('hotkey:get', () => getHotkey())
  ipcMain.handle('hotkey:set', async (_event, accelerator: string) => {
    const res = await setHotkey(accelerator, deps.togglePanel)
    // 快捷键变更后刷新托盘菜单（显示当前快捷键的信息行）
    if (res.ok) refreshTrayMenu()
    return res
  })
  // 录制期间暂停/恢复全局呼出快捷键（避免按下旧组合触发面板切换）
  ipcMain.on('hotkey:pause', () => pauseGlobalHotkey())
  ipcMain.on('hotkey:resume', () => resumeGlobalHotkey(deps.togglePanel))

  // 设置：读取/写回外部配置（Giphy/Tenor API Key 等），重启后端使其生效
  ipcMain.handle('config:get', () => getNetworkSearchConfig())
  ipcMain.handle('config:set', (_event, cfg: NetworkSearchConfig) => setNetworkSearchConfig(cfg))
  ipcMain.handle('backend:restart', async () => {
    stopBackend()
    await new Promise((resolve) => setTimeout(resolve, 800))
    return ensureBackend()
  })

  // GIF 压缩配置：renderer 启动/变更时同步到主进程内存缓存（发送时零 IPC 直读）
  ipcMain.handle('gif:getConfig', () => getGifConfig())
  ipcMain.handle('gif:setConfig', (_event, cfg: GifCompressConfig) => {
    setGifConfig(cfg)
  })

  // 本地表情文件夹托管（纯本地：扫描/忽略/协议/重复分析，不涉及后端与数据库）
  ipcMain.handle('locallib:getState', () => getLocallibState())
  ipcMain.handle('locallib:addFolder', () => addLocallibFolder())
  ipcMain.handle('locallib:removeFolder', (_event, folder: string) => removeLocallibFolder(String(folder || '')))
  ipcMain.handle('locallib:rescan', () => rescanLocallib())
  ipcMain.handle('locallib:ignore', (_event, localPath: string) => ignoreLocallibFile(String(localPath || '')))
  ipcMain.handle('locallib:ignoreFiles', (_event, paths: string[]) => ignoreLocallibFiles(Array.isArray(paths) ? paths : []))
  ipcMain.handle('locallib:unignore', (_event, localPath: string) => unignoreLocallibFile(String(localPath || '')))
  ipcMain.handle('locallib:reanalyze', () => reanalyzeLocallib())
  ipcMain.handle('locallib:setHashType', (_event, type: string) => setLocallibHashType(type === 'pHash' ? 'pHash' : 'dHash'))
  ipcMain.handle('locallib:analysis-state', () => getLocallibAnalysisState())
  // 上传库/收藏夹去重：渲染层传入条目（id/name/url），主进程解析磁盘路径后分析并返回标记
  ipcMain.handle('locallib:analyzeScope', (_event, scope: string, items: unknown[]) =>
    analyzeScope(scope === 'favorite' ? 'favorite' : 'upload', Array.isArray(items) ? items as never[] : [])
  )

  // AI 标签系统（M0：模型状态 + 分析状态；推理在后续阶段接入）
  ipcMain.handle('ai:model-info', () => getAiModelInfo())
  ipcMain.handle('ai:model-download', () => requestAiModelDownload())
  ipcMain.handle('ai:model-reset', () => resetAiModel())
  ipcMain.handle('ai:analysis-state', () => getAiAnalysisState())
  // 模型状态变化推送（下载中进度 / 完成 / 失败 → 设置页实时刷新）
  onAiModelStateChange((info) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('ai:model-state', info)
      }
    }
  })
}
