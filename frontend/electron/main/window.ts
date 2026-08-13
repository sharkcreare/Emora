import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { getActiveWindow } from './active-window'
import type { ActiveWindowInfo } from '../shared/types'

const PANEL_WIDTH = 460
const PANEL_HEIGHT = 640
/** 输入法候选窗模式尺寸：小窗 + 高密度候选网格 */
const COMPACT_WIDTH = 380
const COMPACT_HEIGHT = 320
/** 面板与鼠标光标的间距 */
const CURSOR_OFFSET_Y = 14

/** 当前面板模式（full=完整面板，compact=输入法候选窗） */
let panelMode: 'full' | 'compact' = 'full'

function sizeFor(mode: 'full' | 'compact'): [number, number] {
  return mode === 'compact' ? [COMPACT_WIDTH, COMPACT_HEIGHT] : [PANEL_WIDTH, PANEL_HEIGHT]
}

/** 浏览器式缩放范围与步进（Ctrl+滚轮 / Ctrl+±） */
const ZOOM_MIN = 0.6
const ZOOM_MAX = 1.8
const ZOOM_STEP = 0.1

/** 边缘拖动调整窗口大小：最小尺寸（与 BrowserWindow minWidth/minHeight 一致） */
const MIN_PANEL_W = 300
const MIN_PANEL_H = 240

/**
 * 手动维护的最大化状态。
 * 为什么不用 panel.isMaximized()：Windows 上 transparent + frame:false 窗口
 * 调用 maximize() 后 isMaximized() 恒为 false（系统不把透明窗口当作可最大化窗口），
 * 导致 unmaximize() 不还原尺寸、toggle 分支永远走进 maximize()，窗口卡死全屏无法还原。
 * 因此最大化/还原完全手动实现：记录还原点 bounds，用 setBounds 铺满工作区。
 */
let maximized = false
let preMaximizeBounds: { x: number; y: number; width: number; height: number } | null = null

function notifyMaximized(v: boolean): void {
  maximized = v
  panel?.webContents.send('window:maximized-changed', v)
}

/** 铺满当前所在显示器的工作区（保留任务栏） */
function applyMaximizeBounds(): void {
  if (!panel) return
  const display = screen.getDisplayMatching(panel.getBounds())
  const { x, y, width, height } = display.workArea
  panel.setBounds({ x, y, width, height })
}

/** 最大化：记录当前 bounds 作为还原点，然后铺满工作区 */
export function maximizePanel(): void {
  if (!panel || panel.isDestroyed()) return
  if (maximized) return
  const b = panel.getBounds()
  preMaximizeBounds = { x: b.x, y: b.y, width: b.width, height: b.height }
  applyMaximizeBounds()
  notifyMaximized(true)
}

/** 还原：回到最大化前的位置与尺寸 */
export function unmaximizePanel(): void {
  if (!panel || panel.isDestroyed()) return
  if (!maximized || !preMaximizeBounds) return
  panel.setBounds(preMaximizeBounds)
  notifyMaximized(false)
}

/** 当前是否处于（手动）最大化状态 */
export function isPanelMaximized(): boolean {
  return maximized
}

/** 边缘拖动状态：记录起点鼠标位置与窗口矩形，拖动期间按位移增量计算新矩形 */
interface ResizeState {
  dir: string
  mouseX: number
  mouseY: number
  x: number
  y: number
  w: number
  h: number
}

let resizeState: ResizeState | null = null
let resizeTimer: ReturnType<typeof setInterval> | undefined

/** 开始边缘拖动：记录起点，启动 16ms 轮询（鼠标移出窗口后仍可跟手调整） */
export function beginResize(dir: string): void {
  if (!panel || panel.isDestroyed() || maximized) return
  const [x, y] = panel.getPosition()
  const [w, h] = panel.getSize()
  const p = screen.getCursorScreenPoint()
  resizeState = { dir, mouseX: p.x, mouseY: p.y, x, y, w, h }
  clearInterval(resizeTimer)
  resizeTimer = setInterval(applyResizeTick, 16)
}

/** 根据鼠标位移计算新窗口矩形（n/w 侧拖动时位置同步左移/上移） */
function applyResizeTick(): void {
  if (!panel || panel.isDestroyed() || !resizeState) return
  const p = screen.getCursorScreenPoint()
  const s = resizeState
  const dx = p.x - s.mouseX
  const dy = p.y - s.mouseY
  let { x, y, w, h } = s
  if (s.dir.includes('e')) w = s.w + dx
  if (s.dir.includes('s')) h = s.h + dy
  if (s.dir.includes('w')) {
    w = s.w - dx
    x = s.x + dx
  }
  if (s.dir.includes('n')) {
    h = s.h - dy
    y = s.y + dy
  }
  if (w < MIN_PANEL_W) {
    if (s.dir.includes('w')) x = s.x + s.w - MIN_PANEL_W
    w = MIN_PANEL_W
  }
  if (h < MIN_PANEL_H) {
    if (s.dir.includes('n')) y = s.y + s.h - MIN_PANEL_H
    h = MIN_PANEL_H
  }
  panel.setBounds({ x, y, width: w, height: h })
}

/** 结束边缘拖动 */
export function endResize(): void {
  clearInterval(resizeTimer)
  resizeTimer = undefined
  resizeState = null
}

let panel: BrowserWindow | null = null

/** 呼出面板时记录的目标聊天窗口（点击表情后粘贴到它） */
let targetWindow: ActiveWindowInfo | null = null

export function getTargetWindow(): ActiveWindowInfo | null {
  return targetWindow
}

/** 在光标附近计算面板位置（限制在所在显示器工作区内） */
function positionNearCursor(): void {
  if (!panel) return
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width, height } = display.workArea
  const [w, h] = sizeFor(panelMode)
  let px = Math.round(cursor.x - w / 2)
  let py = Math.round(cursor.y + CURSOR_OFFSET_Y)
  px = Math.max(x, Math.min(px, x + width - w))
  py = Math.max(y, Math.min(py, y + height - h))
  panel.setPosition(px, py)
}

/**
 * 切换面板模式：full=完整面板 / compact=输入法候选小窗。
 * 切换时保持窗口位置附近的相对定位，并把窗口缩放到对应尺寸。
 */
export function setPanelMode(mode: 'full' | 'compact'): void {
  panelMode = mode
  if (!panel || panel.isDestroyed() || maximized || panel.isFullScreen()) return
  const [w, h] = sizeFor(mode)
  panel.setMinimumSize(300, 240)
  panel.setSize(w, h)
  positionNearCursor()
}

/** 显示悬浮窗：先定位并聚焦（立即响应热键），目标窗口异步记录（PowerShell 可能慢，不阻塞显示） */
export async function showPanel(): Promise<void> {
  if (!panel) return
  // 最大化状态下隐藏再呼出：保持铺满，不被光标定位逻辑移走
  if (maximized) {
    applyMaximizeBounds()
  } else {
    positionNearCursor()
  }
  // 最小化时 show() 不会真正还原（Windows 透明窗口特性），先 restore 再 show
  if (panel.isMinimized()) {
    panel.restore()
  }
  panel.show()
  panel.focus()
  panel.webContents.send('panel:shown')
  getActiveWindow()
    .then((w) => {
      targetWindow = w
      console.log('[window] showPanel 记录目标窗口:', JSON.stringify(w))
    })
    .catch((err) => console.warn('[window] 记录目标窗口失败:', err))
}

export function hidePanel(): void {
  if (panel?.isVisible()) {
    panel.hide()
  }
}

/**
 * 托盘菜单「修改快捷键…」入口：显示面板并通知渲染进程打开设置 → 快捷键页。
 * 面板隐藏时先呼出（用户能看到设置弹窗），再发送打开指令。
 */
export function openSettingsFromTray(tab: string): void {
  if (!panel || panel.isDestroyed()) return
  void showPanel()
  panel.webContents.send('settings:open', tab)
}

export function togglePanel(): void {
  if (!panel) return
  if (panel.isVisible()) {
    hidePanel()
  } else {
    void showPanel()
  }
}

/** 最小化到任务栏 */
export function minimizePanel(): void {
  panel?.minimize()
}

/** 最大化 / 还原切换（手动状态管理，见 maximized 注释） */
export function toggleMaximizePanel(): void {
  if (!panel || panel.isDestroyed()) return
  if (maximized) {
    unmaximizePanel()
  } else {
    maximizePanel()
  }
}

export function createPanel(): BrowserWindow {
  panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    minWidth: 300,
    minHeight: 240,
    icon: join(__dirname, '../../resources/icon.png'),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: false,
    show: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 注意：不在这里做"失焦自动隐藏"——Windows 前台锁会让弹出窗口 1-2 秒内被夺回焦点，
  // 自动隐藏会表现为"面板闪一下就消失"（用户误以为闪退）。
  // 面板的关闭时机：发送表情后（ipc）、Esc、再次按热键、托盘菜单，均已覆盖。

  // 最大化状态变化通知渲染进程（切换图标、去掉圆角留白）。
  // 正常路径走手动 maximize/unmaximize（见 maximized 注释）；此处同步系统级触发
  // （如 Win+↑ 快捷键）对透明窗口可能触发的原生 maximize 事件，保持状态一致。
  panel.on('maximize', () => notifyMaximized(true))
  panel.on('unmaximize', () => notifyMaximized(false))

  // 从任务栏还原时按"呼出"处理：刷新数据 + 聚焦搜索框
  panel.on('restore', () => panel?.webContents.send('panel:shown'))

  /** 渲染进程崩溃/无响应时自动恢复（避免悬浮窗"凭空消失"却无托盘入口提示） */
  if (panel) {
    panel.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason !== 'clean-exit') {
        console.error('[window] renderer gone:', details.reason)
        setTimeout(() => {
          if (panel && !panel.isDestroyed()) {
            void panel.webContents.reload()
          }
        }, 300)
      }
    })
  }

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void panel.loadURL(devUrl)
  } else {
    void panel.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return panel
}

/**
 * 浏览器式缩放：内容按 factor 缩放，窗口尺寸联动放大/缩小（保持左上角不动）。
 * 窗口尺寸受显示器工作区约束（缩放过大时截断到工作区边缘）。
 * 返回实际生效的缩放比；当前窗口最大化时不调整尺寸（仅内容缩放）。
 */
export async function setZoom(factor: number): Promise<number> {
  if (!panel || panel.isDestroyed()) return 1
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor))
  const rounded = Math.round(clamped * 10) / 10
  panel.webContents.setZoomFactor(rounded)
  try {
    if (maximized || panel.isFullScreen()) {
      return rounded
    }
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const work = display.workArea
    const [baseW, baseH] = sizeFor(panelMode)
    let w = Math.round(baseW * rounded)
    let h = Math.round(baseH * rounded)
    const [x, y] = panel.getPosition()
    // 窗口不能超出工作区（保留 8px 边距防止超出）
    w = Math.min(w, work.width - 8)
    h = Math.min(h, work.height - 8)
    panel.setSize(w, h)
    const [, ny] = panel.getPosition()
    if (ny + h > work.y + work.height - 8) {
      panel.setPosition(x, work.y + work.height - 8 - h)
    }
  } catch {
    /* 缩放窗口失败不影响内容缩放 */
  }
  return rounded
}
