import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ModelInfo, ModelState } from '../types'

/**
 * 模型管理（M0：状态机 + 持久化 + 版本/大小；M1 补真实下载）。
 *
 * 状态流转：not-installed → downloading → ready / failed
 * 持久化：userData/models/download.json（模型文件放 userData/models/<modelId>/）
 * 下载失败不阻塞任何功能——AI 标签缺失时现有搜索/去重/发送照常。
 */

/** 模型元数据（M1-A：图像编码器，fp32 资产；下载与 int8 量化在 M1-B/C） */
export const MODEL_META = {
  modelId: 'chinese-clip-vit-base-patch16',
  version: 'v1',
  /** fp32 图像编码器 ONNX 体积（约 330MB；int8 量化后约 85MB，后续优化） */
  sizeBytes: 340 * 1024 * 1024,
  /** CLIP 输入尺寸 */
  inputResolution: 224,
  /** 输出特征维度 */
  featureDim: 512,
  /** 图像编码器 ONNX 文件名（worker 加载用） */
  files: ['model.onnx']
}

/** 测试钩子：指定模型目录（无 electron app 时默认落到系统临时目录） */
let modelDirOverride = ''

export function setModelDirForTests(dir: string): void {
  modelDirOverride = dir
}

function modelDir(): string {
  if (modelDirOverride) return modelDirOverride
  try {
    return join(app.getPath('userData'), 'models')
  } catch {
    return join(tmpdir(), 'emoji-assistant-models')
  }
}

function stateFile(): string {
  return join(modelDir(), 'download.json')
}

interface PersistedModelState {
  modelId: string
  version: string
  state: ModelState
  downloadedBytes: number
  error?: string
  updatedAt: number
}

let persisted: PersistedModelState | null = null
const listeners = new Set<(info: ModelInfo) => void>()

/** 订阅模型状态变化（IPC 推送到设置页） */
export function onModelStateChange(cb: (info: ModelInfo) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit(): void {
  const info = getModelInfo()
  for (const cb of listeners) {
    try {
      cb(info)
    } catch {
      /* 忽略单个监听器异常 */
    }
  }
}

function loadPersisted(): void {
  try {
    const raw = readFileSync(stateFile(), 'utf8')
    persisted = JSON.parse(raw) as PersistedModelState
  } catch {
    persisted = null
  }
}

function savePersisted(): void {
  try {
    mkdirSync(modelDir(), { recursive: true })
    writeFileSync(stateFile(), JSON.stringify(persisted, null, 2), 'utf8')
  } catch (err) {
    console.warn('[ai/model] 保存模型状态失败:', err)
  }
}

/** 模型文件目录（userData/models/<modelId>/） */
export function modelFileDir(): string {
  return join(modelDir(), MODEL_META.modelId)
}

/** 图像编码器 ONNX 文件路径（worker 加载用；下载未完成则文件不存在） */
export function imageEncoderPath(): string {
  return join(modelFileDir(), MODEL_META.files[0] ?? 'model.onnx')
}

/** 模型文件是否齐全（可加载推理） */
export function isModelReady(): boolean {
  return MODEL_META.files.length > 0 && MODEL_META.files.every((f) => existsSync(join(modelFileDir(), f)))
}

/** 模型文件是否齐全（M1 下载完成后判定） */
function modelFilesPresent(): boolean {
  return isModelReady()
}

/** 加载持久化状态（应用启动时调用一次） */
export function loadModelState(): void {
  loadPersisted()
}

/** 读取当前模型状态（状态 + 版本 + 大小） */
export function getModelInfo(): ModelInfo {
  if (!persisted) {
    return {
      state: 'not-installed',
      modelId: MODEL_META.modelId,
      version: MODEL_META.version,
      sizeBytes: MODEL_META.sizeBytes,
      downloadedBytes: 0
    }
  }
  // 持久化为 ready 但模型文件丢失 → 视为失败（M0 files 为空时不判定，M1 生效）
  let state = persisted.state
  if (state === 'ready' && !modelFilesPresent() && MODEL_META.files.length > 0) {
    state = 'failed'
  }
  return {
    state,
    modelId: persisted.modelId || MODEL_META.modelId,
    version: persisted.version || MODEL_META.version,
    sizeBytes: MODEL_META.sizeBytes,
    downloadedBytes: persisted.downloadedBytes ?? 0,
    error: persisted.error
  }
}

/**
 * 发起模型下载：not-installed / failed → downloading →（M1 真实下载）→ ready。
 * M0 阶段下载逻辑未实现，占位抛错 → 状态置 failed，保证状态机完整可验证、
 * 设置页可展示四种状态。M1 替换 downloadModelFiles 为真实断点续传下载。
 */
export async function requestModelDownload(): Promise<ModelInfo> {
  if (getModelInfo().state === 'ready') return getModelInfo()
  persisted = {
    modelId: MODEL_META.modelId,
    version: MODEL_META.version,
    state: 'downloading',
    downloadedBytes: 0,
    updatedAt: Date.now()
  }
  savePersisted()
  emit()
  try {
    await downloadModelFiles()
    persisted = {
      ...persisted!,
      state: 'ready',
      downloadedBytes: MODEL_META.sizeBytes,
      error: undefined,
      updatedAt: Date.now()
    }
  } catch (err) {
    persisted = {
      ...persisted!,
      state: 'failed',
      error: err instanceof Error ? err.message : String(err),
      updatedAt: Date.now()
    }
  }
  savePersisted()
  emit()
  return getModelInfo()
}

/**
 * M1 实现：下载模型文件（断点续传 + 完整性校验 + 进度回调）。
 * M0 占位抛错，保持状态机可验证。
 */
async function downloadModelFiles(): Promise<void> {
  // TODO(M1): 从 HuggingFace 镜像下载 MODEL_META.files 到 modelDir()，
  //   逐文件写入临时文件 → 校验大小/完整性 → 原子重命名；下载进度更新 persisted.downloadedBytes。
  throw new Error('模型下载将在 M1 阶段实现（M0 仅完成状态机与缓存骨架）')
}

/** 重置模型状态（清除失败/下载中标记，重试前置；已下载文件保留） */
export function resetModelState(): ModelInfo {
  persisted = null
  try {
    mkdirSync(modelDir(), { recursive: true })
    writeFileSync(stateFile(), 'null', 'utf8')
  } catch {
    /* 忽略 */
  }
  emit()
  return getModelInfo()
}
