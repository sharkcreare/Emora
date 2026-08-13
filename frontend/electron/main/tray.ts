import { Tray, Menu, nativeImage } from 'electron'
import { join } from 'node:path'
import { getAutoLaunch, setAutoLaunch } from './autostart'
import { writeImageToClipboard, writeGifToClipboard } from './clipboard'
import { API_BASE } from './backend'
import { getHotkey, formatAccelerator } from './hotkey'

let tray: Tray | null = null

/** 托盘菜单处理器（createTray 时注入，重建菜单时复用） */
interface TrayHandlers {
  togglePanel: () => void
  /** 托盘「修改快捷键…」：显示面板并跳转设置快捷键页 */
  openSettingsHotkey: () => void
  quit: () => void
}

let handlers: TrayHandlers | null = null

/** 最近使用的表情（托盘子菜单，点击直接复制到剪贴板） */
interface RecentItem {
  id: number
  name: string
  url: string
}

/** 拉取最近使用列表（失败返回空数组，托盘菜单静默降级） */
async function fetchRecent(): Promise<RecentItem[]> {
  try {
    const res = await fetch(`${API_BASE}/api/emoji/recent?limit=8`, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return []
    const json = (await res.json()) as { code: number; data?: RecentItem[] }
    if (json.code !== 0 || !Array.isArray(json.data)) return []
    return json.data
  } catch {
    return []
  }
}

/** 点击托盘最近项：复制到剪贴板（GIF 走文件格式保留动画） */
async function copyRecent(item: RecentItem): Promise<void> {
  try {
    const url = item.url.startsWith('http') ? item.url : `${API_BASE}${item.url}`
    if (/\\.gif($|\\?)/i.test(url)) {
      await writeGifToClipboard(url)
    } else {
      await writeImageToClipboard(url)
    }
    // 复制成功同步热度/最近使用
    if (item.id > 0) {
      fetch(`${API_BASE}/api/emoji/${item.id}/use`, { method: 'POST' }).catch(() => undefined)
    }
  } catch (err) {
    console.error('[tray] 复制最近表情失败:', err)
  }
}

/**
 * 构建托盘菜单模板（快捷键信息 + 修改入口 + 最近使用 + 开机启动 + 退出）。
 * 快捷键行实时读取当前值——快捷键在设置里修改后，refreshTrayMenu 重建即更新。
 */
function buildTemplate(recentItems: RecentItem[]): Electron.MenuItemConstructorOptions[] {
  const h = handlers
  if (!h) return []
  const recentSubmenu =
    recentItems.length > 0
      ? recentItems.map((it) => ({
          label: it.name || `表情 #${it.id}`,
          click: () => void copyRecent(it)
        }))
      : [{ label: '暂无最近使用', enabled: false }]
  return [
    { label: '显示表情面板', click: h.togglePanel },
    { type: 'separator' },
    // 当前全局呼出快捷键：信息行 + 直接跳转设置修改入口
    { label: `快捷键：${formatAccelerator(getHotkey())}`, enabled: false },
    { label: '修改快捷键…', click: h.openSettingsHotkey },
    { type: 'separator' },
    { label: '最近使用', submenu: recentSubmenu },
    { type: 'separator' },
    {
      label: '开机启动',
      type: 'checkbox',
      checked: getAutoLaunch(),
      click: (item) => {
        const ok = setAutoLaunch(item.checked)
        item.checked = ok
        refreshTrayMenu()
      }
    },
    { type: 'separator' },
    { label: '退出', click: h.quit }
  ]
}

/** 用最新数据重建托盘菜单（快捷键变更 / 开机启动切换 / 最近使用加载完成后调用） */
export function refreshTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate(buildTemplate([])))
  // 异步填充最近使用（不阻塞菜单弹出；完成后重建一次）
  void fetchRecent().then((items) => {
    if (tray) {
      tray.setContextMenu(Menu.buildFromTemplate(buildTemplate(items)))
    }
  })
}

export function createTray(h: TrayHandlers): void {
  handlers = h
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon-32.png'))
  tray = new Tray(icon)
  tray.setToolTip(`表情包助手 - ${formatAccelerator(getHotkey())} 呼出`)
  tray.on('double-click', h.togglePanel)
  refreshTrayMenu()
}
