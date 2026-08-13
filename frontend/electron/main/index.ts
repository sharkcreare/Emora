import { app, dialog, protocol } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPanel, togglePanel, hidePanel, getTargetWindow, openSettingsFromTray } from './window'
import { createTray } from './tray'
import { registerGlobalHotkey, unregisterGlobalHotkey } from './hotkey'
import { registerIpc } from './ipc'
import { ensureBackend, stopBackend } from './backend-runner'
import { cleanupTempFiles } from './clipboard'
import { disposeCompressor } from './media'
import { initLocallib, registerLocallibProtocolSafe } from './locallib'
import { initAi, disposeAi } from './ai'

// locallib:// 自定义协议：渲染层 <img> 直接显示本地文件夹图片。
// registerSchemesAsPrivileged 必须在 app ready 之前调用。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'locallib',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false }
  }
])

/** 未捕获异常落盘（Windows GUI 无 console，写文件便于排查闪退/崩溃） */
function logError(tag: string, err: unknown): void {
  try {
    const stack = err instanceof Error ? (err.stack ?? err.message) : String(err)
    appendFileSync(join(app.getPath('userData'), 'error.log'), `[${new Date().toISOString()}] ${tag}: ${stack}\n`)
  } catch {
    /* 日志失败不影响主流程 */
  }
  console.error(`[${tag}]`, err)
}
process.on('uncaughtException', (err) => logError('uncaughtException', err))
process.on('unhandledRejection', (reason) => logError('unhandledRejection', reason))

// 单实例：重复启动时提示用户（而不是默默退出，避免"闪退"错觉）
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type: 'info',
      title: '表情包助手',
      message: '表情包助手已在运行',
      detail: '请按 Ctrl+Shift+E 呼出面板，或在系统托盘中点击 😀 图标。'
    })
    app.quit()
  })
} else {
  app.on('second-instance', () => togglePanel())

  app.whenReady().then(() => {
    registerIpc({ hidePanel, togglePanel, getTargetWindow })

    // 本地文件夹托管：注册协议 + 加载配置 + 启动首扫（打开「自定义」分类即可见本地表情）
    registerLocallibProtocolSafe()
    initLocallib()
    // AI 标签系统（M0：加载标签缓存 + 模型状态；推理后续阶段接入）
    initAi()

    createPanel()
    createTray({
      togglePanel,
      openSettingsHotkey: () => openSettingsFromTray('hotkey'),
      quit: () => {
        unregisterGlobalHotkey()
        app.quit()
      }
    })

    registerGlobalHotkey(togglePanel)

    // 常驻后台时预启动内置后端，保证首次呼出即可用（18080 已有自建后端则自动复用）
    void ensureBackend()

    // 开发模式（npm run dev）：启动后自动弹出面板，让用户立刻看到界面，而不是以为没反应
    if (process.env['ELECTRON_RENDERER_URL']) {
      setTimeout(togglePanel, 1200)
    }

    // 常驻后台：关闭所有窗口不退出
    app.on('window-all-closed', () => {
      /* 保持托盘驻留 */
    })
  })

  app.on('before-quit', stopBackend)
  app.on('will-quit', () => {
    unregisterGlobalHotkey()
    stopBackend()
    disposeCompressor()
    disposeAi()
    // 清理复制图片时产生的临时文件（含 GIF 压缩缓存目录）
    void cleanupTempFiles()
  })
}
