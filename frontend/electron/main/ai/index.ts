import { loadAiTagCache, saveAiTagCache, aiTagCacheSize, pruneStaleAiTags } from './cache'
import {
  loadModelState,
  getModelInfo,
  requestModelDownload,
  onModelStateChange,
  resetModelState,
  MODEL_META
} from './model/manager'
import type { AiAnalysisState, ModelInfo } from './types'

export * from './types'

/**
 * AI 标签系统（Electron 主进程）。
 *
 * M0（本阶段）：模块骨架 + 标签缓存 + 模型管理基础。
 * 推理（CLIP 候选生成 / 标签融合 / 队列调度）在 M1/M2 实现，接口保持向后兼容。
 */

/** 初始化（app ready 后调用）：加载缓存 + 模型状态 + 清理旧模型版本结果 */
export function initAi(): void {
  loadAiTagCache()
  loadModelState()
  // 模型版本升级后旧缓存结果作废（未命中版本清理，避免污染）
  const removed = pruneStaleAiTags(MODEL_META.version)
  if (removed > 0) {
    console.info(`[ai] 模型版本变更，清理 ${removed} 条旧标签缓存`)
  }
}

/** 读取 AI 模型状态（未安装/下载中/已完成/失败 + 版本/大小） */
export function getAiModelInfo(): ModelInfo {
  return getModelInfo()
}

/** 发起 AI 模型下载（首次使用），返回最新状态 */
export function requestAiModelDownload(): Promise<ModelInfo> {
  return requestModelDownload()
}

/** 重置 AI 模型状态（清除失败/下载中标记，重试前置） */
export function resetAiModel(): ModelInfo {
  return resetModelState()
}

/** M0：静态分析状态（推理调度在 M2 实现，届时填充真实进度） */
export function getAiAnalysisState(): AiAnalysisState {
  return { running: false, done: 0, total: 0, mode: 'idle', cachedFiles: aiTagCacheSize() }
}

/** 订阅 AI 模型状态变化（IPC 推送设置页实时刷新） */
export function onAiModelStateChange(cb: (info: ModelInfo) => void): () => void {
  return onModelStateChange(cb)
}

/** 应用退出清理：落盘标签缓存 */
export function disposeAi(): void {
  saveAiTagCache()
}
