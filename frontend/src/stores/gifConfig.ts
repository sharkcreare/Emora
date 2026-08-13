import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GifCompressConfig } from '../../electron/shared/types'

/**
 * GIF 压缩配置 store。
 * 持久化：localStorage（渲染层为配置唯一权威来源）
 * 同步：应用启动与每次变更时通过 IPC 同步到主进程内存缓存（发送 GIF 时主进程零 IPC 直读）
 */

const STORAGE_KEY = 'emoji-assistant-gif-config'
/** 首次大 GIF 提示「本次不开启」的免打扰标记 */
const PROMPT_DISMISS_KEY = 'emoji-assistant-gif-prompt-dismissed'

const DEFAULT_CONFIG: GifCompressConfig = { enabled: false, mode: 'wechat' }

function load(): GifCompressConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    const p = JSON.parse(raw) as Partial<GifCompressConfig>
    return {
      enabled: Boolean(p.enabled),
      mode: p.mode === 'qq' || p.mode === 'custom' ? p.mode : 'wechat',
      customThresholdBytes:
        p.mode === 'custom' && typeof p.customThresholdBytes === 'number' && p.customThresholdBytes > 0
          ? p.customThresholdBytes
          : undefined
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export const useGifConfig = defineStore('gifConfig', () => {
  const config = ref<GifCompressConfig>(load())

  /** 应用启动时同步一次到主进程（发送时主进程零 IPC 直读内存缓存） */
  async function init(): Promise<void> {
    try {
      await window.api?.setGifConfig(config.value)
    } catch {
      /* 主进程不可用时忽略 */
    }
  }

  /** 更新并持久化 + 同步主进程 */
  async function set(patch: Partial<GifCompressConfig>): Promise<void> {
    const next: GifCompressConfig = {
      enabled: patch.enabled ?? config.value.enabled,
      mode: patch.mode ?? config.value.mode,
      customThresholdBytes: patch.mode === 'custom' ? (patch.customThresholdBytes ?? config.value.customThresholdBytes) : undefined
    }
    config.value = next
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    try {
      await window.api?.setGifConfig(next)
    } catch {
      /* 忽略 */
    }
  }

  /** 标记「本次不开启」（不再重复打扰，下次启动重新提示） */
  function dismissPrompt(): void {
    localStorage.setItem(PROMPT_DISMISS_KEY, '1')
  }

  function shouldPrompt(): boolean {
    return localStorage.getItem(PROMPT_DISMISS_KEY) !== '1'
  }

  return { config, init, set, dismissPrompt, shouldPrompt }
})
