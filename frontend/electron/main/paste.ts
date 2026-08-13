import {
  activateWindowByPid,
  activateChatWindowByProcessName,
  getProcessName,
  getWindowRect
} from './active-window'
import type { ActiveWindowInfo } from '../shared/types'

/** 常见聊天软件进程名（目标不是聊天窗口时也走兜底，避免粘贴到 IDE/浏览器） */
const CHAT_PROCESS_NAMES = ['weixin', 'wechat', 'wechatappex', 'qq', 'tim', 'wxwork']

/**
 * 模拟鼠标点击聊天窗口底部输入框区域（微信/QQ 输入框都在窗口底部），
 * 让输入框获得焦点。这一步对自绘控件（微信）必不可少——
 * SetForegroundWindow 只把窗口置前，不会自动把焦点给输入框。
 */
async function clickInputArea(pid: number): Promise<void> {
  try {
    const rect = await getWindowRect(pid)
    if (!rect) {
      console.log('[paste] 无法获取窗口矩形，跳过点击输入框')
      return
    }
    const { left, top, right, bottom } = rect
    const width = right - left
    const height = bottom - top
    if (width <= 0 || height <= 0) return
    // 输入框大约在窗口底部 1/5 高度的中间偏左位置
    const x = Math.round(left + width * 0.5)
    const y = Math.round(bottom - height * 0.12)
    const { mouse, Button } = await import('@nut-tree/nut-js')
    await mouse.setPosition({ x, y })
    await mouse.click(Button.LEFT)
    console.log('[paste] 已点击输入框区域 (' + x + ',' + y + ')')
  } catch (err) {
    console.error('[paste] 点击输入框失败:', err)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 窗口激活后、按键前的等待时间（毫秒） */
const ACTIVATE_DELAY_MS = 350

/** nut.js 动态加载：原生二进制缺失时不影响应用启动 */
async function sendCtrlVWithNutJs(): Promise<boolean> {
  try {
    const { keyboard, Key } = await import('@nut-tree/nut-js')
    await keyboard.pressKey(Key.LeftControl, Key.V)
    await keyboard.releaseKey(Key.LeftControl, Key.V)
    return true
  } catch (err) {
    console.error('[paste] nut.js 不可用，切换 PowerShell 兜底:', err)
    return false
  }
}

/** PowerShell SendKeys 兜底方案 */
async function sendCtrlVWithPowerShell(): Promise<void> {
  const { runPowerShell } = await import('./active-window')
  await runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^v')`,
    5000
  )
}

/**
 * 模拟 Ctrl+V 粘贴到目标窗口（呼出面板时记录的前台聊天窗口）。
 * 流程：激活目标窗口 → 短暂等待窗口获得焦点 → 发送 Ctrl+V。
 * 返回激活与粘贴结果；激活失败时返回 activated=false（调用方提示手动粘贴）。
 */
export async function pasteToWindow(
  target: ActiveWindowInfo | null
): Promise<{ activated: boolean; pasted: boolean }> {
  let activated = false
  let activePid = 0
  if (target && target.pid > 0) {
    console.log('[paste] 目标窗口: pid=' + target.pid + ' title=' + target.title)
    const procName = await getProcessName(target.pid)
    const isChat = CHAT_PROCESS_NAMES.includes(procName)
    console.log('[paste] 目标进程名:', procName, '是否聊天软件:', isChat)
    if (isChat) {
      activated = await activateWindowByPid(target.pid)
      activePid = activated ? target.pid : 0
      console.log('[paste] 窗口激活结果:', activated)
    } else {
      console.log('[paste] 目标非聊天窗口（' + procName + '），跳过直接激活')
    }
  } else {
    console.log('[paste] 无目标窗口（target 为空），跳过激活')
  }
  // 兜底：目标窗口激活失败或目标不是聊天软件时，按进程名查找微信/QQ 聊天窗口
  if (!activated) {
    console.log('[paste] 尝试按进程名兜底查找聊天窗口...')
    activePid = await activateChatWindowByProcessName()
    activated = activePid > 0
    console.log('[paste] 兜底激活结果:', activated, 'pid:', activePid)
  }
  // 点击输入框区域让焦点进入输入框（微信等自绘控件必须）
  if (activated && activePid > 0) {
    await clickInputArea(activePid)
  }
  await sleep(ACTIVATE_DELAY_MS)

  const ok = await sendCtrlVWithNutJs()
  console.log('[paste] nut.js 结果:', ok)
  if (!ok) {
    console.log('[paste] 使用 PowerShell 兜底')
    try {
      await sendCtrlVWithPowerShell()
    } catch (err) {
      console.error('[paste] PowerShell 兜底失败:', err)
      return { activated, pasted: false }
    }
  }
  console.log('[paste] Ctrl+V 发送完成')
  return { activated, pasted: true }
}