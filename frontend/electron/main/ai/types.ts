/**
 * AI 标签系统类型（Electron 主进程侧）。
 *
 * M0：骨架 + 缓存 + 模型管理；推理（CLIP 候选生成 + 标签融合）在后续阶段实现。
 * 融合信号设计（M2 起用）：CLIP 内容理解 / 文件名关键词 / 目录名关键词 / 相似图标签继承。
 */

/** AI 标签来源（融合信号） */
export type AiTagSource = 'clip' | 'filename' | 'parentdir' | 'inherited'

/** 单条标签明细（含来源与相似度，供展示与调试） */
export interface AiTagItem {
  /** 标签池 id（英文，如 emo_speechless） */
  id: string
  tag: string
  source: AiTagSource
  /** CLIP cosine 相似度 0~1（不是概率，因此不叫 confidence） */
  similarity: number
}

/**
 * 单文件 AI 分析结果（ai-tags.json 缓存条目值）。
 * 缓存绑定：文件指纹（mtime+size，图片变化即失效）+ modelVersion（模型升级即作废）。
 * userTags 由前端单独持久化，永不写入本结构（用户修改优先、不被 AI 覆盖）。
 */
export interface AiTagResult {
  /** 计算时文件指纹（mtime + size） */
  fingerprint: { mtime: number; size: number }
  /** 图片内容哈希（继承机制用：相似图已打标则直接继承标签，不做推理） */
  contentHash: string
  /** 模型版本（缓存绑定键之一） */
  modelVersion: string
  /** 标签池版本（缓存绑定键之二：标签池变化即作废旧结果） */
  labelVersion: string
  /** 融合后的最终 AI 标签（CLIP + 文件名 + 目录名 + 相似图继承） */
  aiTags: string[]
  /** 映射后的分类（现有分类 code：funny / animal / emoji / custom） */
  categories: string[]
  /** 综合置信度 0~1 */
  confidence: number
  /** 一句话语义描述（后续可喂给后端语义搜索语料） */
  description: string
  /** 标签明细（来源/分数） */
  details: AiTagItem[]
  /** 是否继承自相似图（未做推理） */
  inherited: boolean
  analyzedAt: number
}

/** 模型安装状态：未安装 / 下载中 / 已完成 / 失败 */
export type ModelState = 'not-installed' | 'downloading' | 'ready' | 'failed'

/** 模型信息（设置页展示：状态 + 版本 + 大小） */
export interface ModelInfo {
  state: ModelState
  /** 模型标识（如 chinese-clip-vit-b-16-int8-v1） */
  modelId: string
  version: string
  /** 模型总大小（字节） */
  sizeBytes: number
  /** 已下载大小（下载中实时更新） */
  downloadedBytes: number
  error?: string
}

/** AI 分析整体状态（设置页进度 / 暂停继续用；M2 推理调度后填充真实值） */
export interface AiAnalysisState {
  running: boolean
  done: number
  total: number
  mode: 'idle' | 'running' | 'paused' | 'canceled'
  /** 已缓存的标签文件数 */
  cachedFiles: number
}
