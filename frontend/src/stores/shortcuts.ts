import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 面板内快捷键（渲染进程本地生效，无需主进程 globalShortcut）。
 * 存储格式为 Electron accelerator（如 CommandOrControl+I / Return）。
 * quickSend 特殊：只存修饰键前缀（如 CommandOrControl），配合数字键 1~9 使用。
 */
export interface PanelShortcuts {
  /** 切换输入法候选窗模式 */
  compactToggle: string
  /** 复制选中表情到剪贴板 */
  copySelected: string
  /** 发送选中表情 */
  sendSelected: string
  /** 快速发送第 N 个（修饰键 + 1~9） */
  quickSend: string
}

export type PanelShortcutKey = keyof PanelShortcuts

export const PANEL_SHORTCUT_KEYS: PanelShortcutKey[] = ['compactToggle', 'copySelected', 'sendSelected', 'quickSend']

export const DEFAULT_SHORTCUTS: PanelShortcuts = {
  compactToggle: 'CommandOrControl+I',
  copySelected: 'CommandOrControl+C',
  sendSelected: 'Return',
  quickSend: 'CommandOrControl'
}

/** 快捷键项的展示信息（设置面板列表用） */
export const PANEL_SHORTCUT_ITEMS: { key: PanelShortcutKey; label: string }[] = [
  { key: 'compactToggle', label: '输入法候选窗切换' },
  { key: 'copySelected', label: '复制选中表情' },
  { key: 'sendSelected', label: '发送选中表情' },
  { key: 'quickSend', label: '快速发送第 N 个' }
]

const STORAGE_KEY = 'emoji-assistant-panel-shortcuts'

function load(): PanelShortcuts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SHORTCUTS }
    const parsed = JSON.parse(raw) as Partial<PanelShortcuts>
    return { ...DEFAULT_SHORTCUTS, ...parsed }
  } catch {
    return { ...DEFAULT_SHORTCUTS }
  }
}

/** Electron accelerator → 人类可读（Ctrl + Shift + E） */
export function formatShortcutLabel(acc: string): string {
  return acc
    .split('+')
    .map((p) => {
      switch (p) {
        case 'CommandOrControl':
        case 'Command':
        case 'Control':
        case 'Ctrl':
          return 'Ctrl'
        case 'Option':
          return 'Alt'
        case 'Shift':
          return 'Shift'
        case 'Super':
        case 'Meta':
          return 'Win'
        case 'Return':
          return 'Enter'
        case 'Up':
          return '↑'
        case 'Down':
          return '↓'
        case 'Left':
          return '←'
        case 'Right':
          return '→'
        default:
          return p
      }
    })
    .join(' + ')
}

/** 判断按键事件是否匹配某个 accelerator（修饰键 + 主键） */
export function matchShortcut(e: KeyboardEvent, acc: string): boolean {
  const parts = acc.split('+').map((p) => p.trim())
  const modifiers = parts.slice(0, -1)
  const key = parts[parts.length - 1]
  const wantCtrl = modifiers.some((m) => ['CommandOrControl', 'Command', 'Control', 'Ctrl'].includes(m))
  const wantAlt = modifiers.some((m) => ['Alt', 'Option'].includes(m))
  const wantShift = modifiers.some((m) => m === 'Shift')
  if (wantCtrl !== e.ctrlKey || wantAlt !== e.altKey || wantShift !== e.shiftKey) return false
  return keyEventMatches(e.key, key)
}

/** 主键匹配（字母不区分大小写） */
function keyEventMatches(k: string, target: string): boolean {
  if (/^[a-zA-Z]$/.test(target)) return k.toLowerCase() === target.toLowerCase()
  if (/^[0-9]$/.test(target)) return k === target
  switch (target) {
    case 'Return':
      return k === 'Enter'
    case 'Up':
      return k === 'ArrowUp'
    case 'Down':
      return k === 'ArrowDown'
    case 'Left':
      return k === 'ArrowLeft'
    case 'Right':
      return k === 'ArrowRight'
    case 'Space':
      return k === ' '
    case 'Escape':
      return k === 'Escape'
    case 'Tab':
      return k === 'Tab'
    case 'Home':
      return k === 'Home'
    case 'End':
      return k === 'End'
    case 'PageUp':
      return k === 'PageUp'
    case 'PageDown':
      return k === 'PageDown'
    case 'Backspace':
      return k === 'Backspace'
    case 'Delete':
      return k === 'Delete'
    default:
      if (/^F([1-9]|1[0-9]|2[0-4])$/.test(target)) return k === target
      return k === target
  }
}

/** 快速发送：匹配修饰键前缀 + 数字 1~9，返回数字（未命中返回 null） */
export function matchQuickSend(e: KeyboardEvent, modifierPrefix: string): number | null {
  if (!/^[1-9]$/.test(e.key)) return null
  const mods = modifierPrefix.split('+').map((p) => p.trim())
  const wantCtrl = mods.some((m) => ['CommandOrControl', 'Command', 'Control', 'Ctrl'].includes(m))
  const wantAlt = mods.some((m) => ['Alt', 'Option'].includes(m))
  const wantShift = mods.some((m) => m === 'Shift')
  if (wantCtrl !== e.ctrlKey || wantAlt !== e.altKey || wantShift !== e.shiftKey) return null
  return Number(e.key)
}

export const useShortcuts = defineStore('shortcuts', () => {
  const shortcuts = ref<PanelShortcuts>(load())
  /** 设置弹窗正在录制快捷键（App.vue 全局按键处理据此跳过，避免录制时误触发面板操作） */
  const panelRecording = ref(false)

  /** 保存某个快捷键并持久化 */
  function set(key: PanelShortcutKey, acc: string): void {
    shortcuts.value = { ...shortcuts.value, [key]: acc }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts.value))
  }

  /** 恢复全部默认值 */
  function reset(): void {
    shortcuts.value = { ...DEFAULT_SHORTCUTS }
    localStorage.removeItem(STORAGE_KEY)
  }

  return { shortcuts, panelRecording, set, reset }
})
