import { globalShortcut, app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

/** PowerShell 脚本编码为 UTF-16LE Base64（与 active-window.ts 一致） */
function encodePs(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/** 默认全局快捷键：Ctrl+Shift+E */
export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+E'

/** 快捷键注册结果 */
export interface HotkeyResult {
  ok: boolean
  /** 当前生效的快捷键 */
  accelerator: string
  error?: string
}

/** 当前生效的全局快捷键（进程内缓存，避免每次读盘） */
let currentAccelerator = DEFAULT_HOTKEY

/** 常见注册全局热键的软件（候选列表排序时优先展示） */
const HOTKEY_PRONE = [
  'wechat', 'weixin', 'wechatappex', 'qq', 'tim', 'dingtalk', 'feishu', 'lark',
  'obs64', 'obs32', 'teamviewer', 'sunloginclient', 'powertoys', 'powertoy',
  'neteasecloudmusic', 'cloudmusic', 'qqmusic', 'ximalaya', 'potplayer',
  'snipaste', 'bandicam', 'bandicam64', 'capture2text', 'quicker'
]

/**
 * 枚举当前所有可见顶层窗口的进程名（去重，排除本应用与系统桌面）。
 * Windows 无公开 API 可精确查询全局热键占用者，这是业界通用的启发式方案：
 * 冲突时列出可见程序供用户排查，微信/QQ 等常见热键软件一眼可辨。
 */
async function listVisibleProcessNames(): Promise<string[]> {
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class HotkeyWinEnum {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr lp);
  public static string List() {
    var names = new List<string>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      try {
        var p = System.Diagnostics.Process.GetProcessById((int)pid);
        string n = p.ProcessName;
        if (!string.IsNullOrEmpty(n) && !names.Contains(n)) names.Add(n);
      } catch { }
      return true;
    }, IntPtr.Zero);
    return string.Join(",", names.ToArray());
  }
}
"@
[HotkeyWinEnum]::List()
`
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePs(script)],
      { timeout: 6000, windowsHide: true }
    )
    const self = (app.getName() || '').toLowerCase()
    return stdout
      .split(/[,\r\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((n) => n.toLowerCase() !== 'explorer' && n.toLowerCase() !== self)
  } catch (err) {
    console.warn('[hotkey] 枚举可见进程失败:', err)
    return []
  }
}

/** 常见热键软件优先 + 其余按字母序 */
function sortProcessNames(names: string[]): string[] {
  const inList = names.filter((n) => HOTKEY_PRONE.includes(n.toLowerCase()))
  const rest = names.filter((n) => !HOTKEY_PRONE.includes(n.toLowerCase())).sort()
  return [...inList, ...rest]
}

/** 持久化文件：userData/hotkey.json */
function hotkeyFile(): string {
  return join(app.getPath('userData'), 'hotkey.json')
}

function readPersisted(): string {
  try {
    const file = hotkeyFile()
    if (!existsSync(file)) return DEFAULT_HOTKEY
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { accelerator?: string }
    if (typeof raw.accelerator === 'string' && raw.accelerator.trim()) {
      return raw.accelerator.trim()
    }
    return DEFAULT_HOTKEY
  } catch {
    return DEFAULT_HOTKEY
  }
}

function persist(accelerator: string): void {
  try {
    const file = hotkeyFile()
    mkdirSync(join(app.getPath('userData')), { recursive: true })
    writeFileSync(file, JSON.stringify({ accelerator }, null, 2), 'utf8')
  } catch (err) {
    console.error('[hotkey] 持久化失败:', err)
  }
}

/** 读取当前生效的全局快捷键 */
export function getHotkey(): string {
  return currentAccelerator
}

/**
 * 注册全局快捷键（使用已持久化的自定义值；启动时调用）。
 * @returns 是否注册成功；失败返回 false（被其他程序占用等）
 */
export function registerGlobalHotkey(callback: () => void): boolean {
  const acc = readPersisted()
  currentAccelerator = acc
  const ok = globalShortcut.register(acc, callback)
  if (!ok) {
    console.warn('[hotkey] 注册失败，可能被其他程序占用:', acc)
  } else {
    console.log('[hotkey] 已注册:', acc)
  }
  return ok
}

/** 基本格式校验：至少一个修饰键 + 一个主键（避免误设成裸按键抢占系统） */
function validateAccelerator(acc: string): string | null {
  if (!acc || !acc.includes('+')) {
    return '快捷键需包含修饰键（Ctrl / Shift / Alt）'
  }
  const parts = acc.split('+').map((s) => s.trim())
  const modifiers = new Set(['CommandOrControl', 'Command', 'Control', 'Ctrl', 'Alt', 'Option', 'Shift', 'Super', 'Meta'])
  const hasModifier = parts.slice(0, -1).some((p) => modifiers.has(p))
  if (!hasModifier) {
    return '快捷键需包含修饰键（Ctrl / Shift / Alt）'
  }
  return null
}

/**
 * 设置并重新注册全局快捷键。
 * 先注销旧的，再尝试注册新的；注册失败（冲突）时回滚为旧快捷键，保持可用。
 */
export async function setHotkey(accelerator: string, callback: () => void): Promise<HotkeyResult> {
  const acc = (accelerator || '').trim()
  const invalid = validateAccelerator(acc)
  if (invalid) {
    return { ok: false, accelerator: currentAccelerator, error: invalid }
  }
  const prev = currentAccelerator
  try {
    // 先注销旧快捷键，释放占用
    globalShortcut.unregister(prev)
    const ok = globalShortcut.register(acc, callback)
    if (!ok) {
      // 注册失败（被占用）：回滚旧快捷键
      const rollback = globalShortcut.register(prev, callback)
      currentAccelerator = rollback ? prev : prev
      console.warn('[hotkey] 新快捷键注册失败（可能被占用），已回滚:', acc)
      // 枚举可见进程作为候选占用者（Windows 无精确查询 API，启发式提示）
      const names = sortProcessNames(await listVisibleProcessNames())
      const candidate = names.length > 0 ? names.slice(0, 12).join('、') : ''
      const hint = candidate
        ? `。当前运行的候选程序：${candidate}（Windows 无法精确定位占用者，请逐个关闭排查）`
        : ''
      return {
        ok: false,
        accelerator: currentAccelerator,
        error: `快捷键 ${formatAccelerator(acc)} 已被其他程序占用，已保留原快捷键${hint}`
      }
    }
    currentAccelerator = acc
    persist(acc)
    console.log('[hotkey] 已切换为:', acc)
    return { ok: true, accelerator: acc }
  } catch (err) {
    console.error('[hotkey] 设置快捷键异常:', err)
    return { ok: false, accelerator: currentAccelerator, error: '设置快捷键失败' }
  }
}

/** 把 Electron accelerator 转成人类可读形式（Ctrl+Shift+E） */
export function formatAccelerator(acc: string): string {
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
        default:
          return p
      }
    })
    .join(' + ')
}

/**
 * 暂停全局呼出快捷键（设置面板录制新组合键时调用，避免按下旧组合触发面板切换）。
 */
export function pauseGlobalHotkey(): void {
  try {
    globalShortcut.unregister(currentAccelerator)
    console.log('[hotkey] 已暂停:', currentAccelerator)
  } catch (err) {
    console.error('[hotkey] 暂停失败:', err)
  }
}

/**
 * 恢复全局呼出快捷键（录制结束/取消后调用）。
 * @returns 是否恢复成功（可能因冲突失败）
 */
export function resumeGlobalHotkey(callback: () => void): boolean {
  const ok = globalShortcut.register(currentAccelerator, callback)
  if (!ok) {
    console.warn('[hotkey] 恢复注册失败:', currentAccelerator)
  }
  return ok
}

export function unregisterGlobalHotkey(): void {
  globalShortcut.unregisterAll()
}
