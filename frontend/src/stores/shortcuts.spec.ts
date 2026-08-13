import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  useShortcuts,
  DEFAULT_SHORTCUTS,
  formatShortcutLabel,
  matchShortcut,
  matchQuickSend
} from './shortcuts'

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: '',
    isComposing: false,
    ...init
  } as KeyboardEvent
}

describe('shortcuts store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('默认值完整且可持久化', () => {
    const s = useShortcuts()
    expect(s.shortcuts.compactToggle).toBe('CommandOrControl+I')
    expect(s.shortcuts.quickSend).toBe('CommandOrControl')
    s.set('compactToggle', 'Alt+I')
    expect(useShortcuts().shortcuts.compactToggle).toBe('Alt+I') // 新实例从 localStorage 读取
  })

  it('reset 恢复默认', () => {
    const s = useShortcuts()
    s.set('sendSelected', 'Space')
    s.reset()
    expect(s.shortcuts.sendSelected).toBe(DEFAULT_SHORTCUTS.sendSelected)
  })

  it('matchShortcut 匹配修饰键+主键，大小写不敏感', () => {
    expect(matchShortcut(keyEvent({ ctrlKey: true, key: 'c' }), 'CommandOrControl+C')).toBe(true)
    expect(matchShortcut(keyEvent({ ctrlKey: true, shiftKey: true, key: 'C' }), 'CommandOrControl+C')).toBe(false)
    expect(matchShortcut(keyEvent({ key: 'Enter' }), 'Return')).toBe(true)
    expect(matchShortcut(keyEvent({ key: 'Escape' }), 'Escape')).toBe(true)
    expect(matchShortcut(keyEvent({ ctrlKey: true, key: 'i' }), 'CommandOrControl+I')).toBe(true)
  })

  it('matchShortcut 数字主键', () => {
    expect(matchShortcut(keyEvent({ ctrlKey: true, key: '1' }), 'CommandOrControl+1')).toBe(true)
    expect(matchShortcut(keyEvent({ ctrlKey: true, key: '9' }), 'CommandOrControl+1')).toBe(false)
  })

  it('matchQuickSend 只匹配修饰键前缀+数字', () => {
    expect(matchQuickSend(keyEvent({ ctrlKey: true, key: '3' }), 'CommandOrControl')).toBe(3)
    expect(matchQuickSend(keyEvent({ ctrlKey: true, shiftKey: true, key: '3' }), 'CommandOrControl')).toBe(null)
    expect(matchQuickSend(keyEvent({ key: '3' }), 'CommandOrControl')).toBe(null)
    expect(matchQuickSend(keyEvent({ altKey: true, key: '5' }), 'Alt')).toBe(5)
    // 非数字键不触发
    expect(matchQuickSend(keyEvent({ ctrlKey: true, key: 'a' }), 'CommandOrControl')).toBe(null)
    // 0 不在 1~9 范围
    expect(matchQuickSend(keyEvent({ ctrlKey: true, key: '0' }), 'CommandOrControl')).toBe(null)
  })

  it('formatShortcutLabel 人类可读', () => {
    expect(formatShortcutLabel('CommandOrControl+Shift+E')).toBe('Ctrl + Shift + E')
    expect(formatShortcutLabel('CommandOrControl')).toBe('Ctrl')
    expect(formatShortcutLabel('Return')).toBe('Enter')
    expect(formatShortcutLabel('Alt+Up')).toBe('Alt + ↑')
  })
})
