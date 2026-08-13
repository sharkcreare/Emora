import { contextBridge, ipcRenderer } from 'electron'
import type {
  EmojiAssistantApi,
  EmojiPayload,
  GifCompressConfig,
  LocalFileEmoji,
  LocalLibraryAnalysisState,
  NetworkSearchConfig,
  ScopeAnalysisItem,
  ScopeAnalysisMark,
  AiModelInfo,
  AiAnalysisState
} from '../shared/types'

const api: EmojiAssistantApi = {
  sendEmoji: (emoji: EmojiPayload) => ipcRenderer.invoke('emoji:send', emoji),
  copyEmoji: (emoji: EmojiPayload) => ipcRenderer.invoke('emoji:copy', emoji),
  hidePanel: () => ipcRenderer.send('panel:hide'),
  getAutoLaunch: () => ipcRenderer.invoke('app:getAutoLaunch'),
  setAutoLaunch: (enable: boolean) => ipcRenderer.invoke('app:setAutoLaunch', enable),
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  getApiBase: () => ipcRenderer.invoke('app:getApiBase'),
  ensureBackend: () => ipcRenderer.invoke('backend:ensure'),
  getNetworkSearchConfig: () => ipcRenderer.invoke('config:get'),
  setNetworkSearchConfig: (cfg: NetworkSearchConfig) => ipcRenderer.invoke('config:set', cfg),
  restartBackend: () => ipcRenderer.invoke('backend:restart'),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  setPanelMode: (mode: 'full' | 'compact') => ipcRenderer.send('panel:set-mode', mode),
  closeWindow: () => ipcRenderer.send('window:close'),
  setZoom: (factor: number) => ipcRenderer.invoke('panel:set-zoom', factor),
  beginResize: (dir: string) => ipcRenderer.send('panel:begin-resize', dir),
  endResize: () => ipcRenderer.send('panel:end-resize'),
  reportError: (tag: string, message: string) => ipcRenderer.send('error:report', tag, message),
  getHotkey: () => ipcRenderer.invoke('hotkey:get'),
  setHotkey: (accelerator: string) => ipcRenderer.invoke('hotkey:set', accelerator),
  pauseHotkey: () => ipcRenderer.send('hotkey:pause'),
  resumeHotkey: () => ipcRenderer.send('hotkey:resume'),
  onPanelShown: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('panel:shown', listener)
    return () => ipcRenderer.removeListener('panel:shown', listener)
  },
  onMaximizedChanged: (cb: (maximized: boolean) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, maximized: boolean): void => cb(maximized)
    ipcRenderer.on('window:maximized-changed', listener)
    return () => ipcRenderer.removeListener('window:maximized-changed', listener)
  },
  onOpenSettings: (cb: (tab: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, tab: string): void => cb(tab)
    ipcRenderer.on('settings:open', listener)
    return () => ipcRenderer.removeListener('settings:open', listener)
  },
  getGifConfig: () => ipcRenderer.invoke('gif:getConfig'),
  setGifConfig: (cfg: GifCompressConfig) => ipcRenderer.invoke('gif:setConfig', cfg),
  getLocallibState: () => ipcRenderer.invoke('locallib:getState'),
  addLocallibFolder: () => ipcRenderer.invoke('locallib:addFolder'),
  removeLocallibFolder: (folder: string) => ipcRenderer.invoke('locallib:removeFolder', folder),
  rescanLocallib: () => ipcRenderer.invoke('locallib:rescan'),
  ignoreLocallibFile: (localPath: string) => ipcRenderer.invoke('locallib:ignore', localPath),
  ignoreLocallibFiles: (paths: string[]) => ipcRenderer.invoke('locallib:ignoreFiles', paths),
  unignoreLocallibFile: (localPath: string) => ipcRenderer.invoke('locallib:unignore', localPath),
  reanalyzeLocallib: () => ipcRenderer.invoke('locallib:reanalyze'),
  setLocallibHashType: (type: 'dHash' | 'pHash') => ipcRenderer.invoke('locallib:setHashType', type),
  getLocallibAnalysisState: () => ipcRenderer.invoke('locallib:analysis-state'),
  analyzeLocallibScope: (scope: 'upload' | 'favorite', items: ScopeAnalysisItem[]) =>
    ipcRenderer.invoke('locallib:analyzeScope', scope, items),
  onLocallibAnalysisProgress: (cb: (s: LocalLibraryAnalysisState) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, s: LocalLibraryAnalysisState): void => cb(s)
    ipcRenderer.on('locallib:analysis-progress', listener)
    return () => ipcRenderer.removeListener('locallib:analysis-progress', listener)
  },
  onLocallibAnalyzed: (cb: (files: LocalFileEmoji[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { files: LocalFileEmoji[] }): void => cb(payload.files)
    ipcRenderer.on('locallib:analyzed', listener)
    return () => ipcRenderer.removeListener('locallib:analyzed', listener)
  },
  getAiModelInfo: () => ipcRenderer.invoke('ai:model-info'),
  requestAiModelDownload: () => ipcRenderer.invoke('ai:model-download'),
  resetAiModel: () => ipcRenderer.invoke('ai:model-reset'),
  getAiAnalysisState: () => ipcRenderer.invoke('ai:analysis-state'),
  onAiModelStateChange: (cb: (info: AiModelInfo) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, info: AiModelInfo): void => cb(info)
    ipcRenderer.on('ai:model-state', listener)
    return () => ipcRenderer.removeListener('ai:model-state', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
