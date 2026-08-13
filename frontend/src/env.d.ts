/// <reference types="vite/client" />

import type { EmojiAssistantApi } from '../electron/shared/types'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

declare global {
  interface Window {
    /** preload 通过 contextBridge 暴露的 API（开发模式为 undefined 时可走 fallback） */
    api?: EmojiAssistantApi
  }
}

export {}
