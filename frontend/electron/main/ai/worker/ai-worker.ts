import { parentPort, workerData } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { preprocessImageFile } from '../clip/preprocess'
import { createOnnxSession, computeEmbedding, type SessionLike } from '../clip/inference'
import { matchLabels, type ClipTagMatch, type LabelEmbedding } from '../clip/matcher'

/**
 * AI 推理 worker（worker_threads）。
 *
 * 铁律：模型只加载一次（单例 session），主进程/调用方绝不重复加载；
 * 解码、预处理、ONNX 推理全部在本线程完成，主进程零耗时。
 * 任何错误都通过消息返回，不抛出、不退出——错误图片不会导致 worker 崩溃。
 *
 * 请求协议：
 *   { id, type: 'ping' }                        → { id, success: true }
 *   { id, type: 'load' }                        → { id, success, error? }（显式重试加载）
 *   { id, type: 'embedding', imagePath }        → { id, success, embedding?, dimension?, error? }
 *   { id, type: 'tag', embedding: number[] }    → { id, success, tags?: ClipTagMatch[], error? }
 */

/** workerData：模型路径/版本、缩略图目录、标签向量路径由主进程创建 worker 时传入 */
interface WorkerInitData {
  modelPath?: string
  modelVersion: string
  thumbDir?: string
  labelEmbeddingsPath?: string
}

interface WorkerRequest {
  id: string
  type: string
  imagePath?: string
  embedding?: number[]
}

interface WorkerResponse {
  id: string
  success: boolean
  embedding?: number[]
  dimension?: number
  tags?: ClipTagMatch[]
  error?: string | null
}

const init = (workerData ?? {}) as WorkerInitData

let session: SessionLike | null = null
let loadError: string | null = null

/** 标签向量池（启动/首个 tag 请求时单例加载） */
let labelEmbeddings: LabelEmbedding[] | null = null
let labelEmbeddingsError: string | null = null

/** 单例加载标签向量池：只加载一次；失败缓存错误，可显式 'load' 重试 */
function ensureLabelEmbeddings(): LabelEmbedding[] | null {
  if (labelEmbeddings) return labelEmbeddings
  if (labelEmbeddingsError) return null
  if (!init.labelEmbeddingsPath) {
    labelEmbeddingsError = '标签向量文件路径未配置'
    return null
  }
  try {
    const raw = JSON.parse(readFileSync(init.labelEmbeddingsPath, 'utf8')) as {
      version?: string
      dimension?: number
      labels: LabelEmbedding[]
    }
    if (!Array.isArray(raw.labels) || raw.labels.length === 0) {
      throw new Error('标签向量文件为空')
    }
    labelEmbeddings = raw.labels
    console.info(`[ai-worker] 标签向量池加载成功: ${raw.labels.length} 个标签 (v${raw.version ?? '?'})`)
    return labelEmbeddings
  } catch (err) {
    labelEmbeddingsError = err instanceof Error ? err.message : String(err)
    console.error('[ai-worker] 标签向量池加载失败:', labelEmbeddingsError)
    return null
  }
}

/** 单例加载：首次加载复用；失败缓存错误避免反复尝试（可显式 'load' 重试） */
async function ensureSession(): Promise<SessionLike | null> {
  if (session) return session
  if (loadError) return null
  if (!init.modelPath) {
    loadError = '模型路径未配置（模型未下载）'
    return null
  }
  try {
    session = await createOnnxSession(init.modelPath)
    console.info(`[ai-worker] 模型加载成功: ${init.modelPath}`)
    return session
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err)
    console.error('[ai-worker] 模型加载失败:', loadError)
    return null
  }
}

parentPort?.on('message', async (req: WorkerRequest) => {
  const respond = (r: Omit<WorkerResponse, 'id'>): void => {
    parentPort?.postMessage({ id: req?.id ?? '', ...r } satisfies WorkerResponse)
  }
  try {
    switch (req?.type) {
      case 'ping':
        respond({ success: true, error: null })
        return
      case 'load': {
        // 显式重试加载：清空错误缓存重新尝试
        loadError = null
        session = null
        labelEmbeddingsError = null
        const s = await ensureSession()
        const l = ensureLabelEmbeddings()
        respond({ success: !!s && !!l, error: s && l ? null : (loadError ?? labelEmbeddingsError) })
        return
      }
      case 'embedding': {
        const s = await ensureSession()
        if (!s) {
          respond({ success: false, error: loadError ?? '模型未加载' })
          return
        }
        if (!req.imagePath) {
          respond({ success: false, error: '缺少 imagePath' })
          return
        }
        const tensor = await preprocessImageFile(req.imagePath, init.thumbDir)
        const res = await computeEmbedding(s, tensor, init.modelVersion)
        respond({ success: res.success, embedding: res.embedding, dimension: res.dimension, error: res.error ?? null })
        return
      }
      case 'tag': {
        const s = await ensureSession()
        if (!s) {
          respond({ success: false, error: loadError ?? '模型未加载' })
          return
        }
        const labels = ensureLabelEmbeddings()
        if (!labels) {
          respond({ success: false, error: labelEmbeddingsError ?? '标签向量池未加载' })
          return
        }
        if (!req.embedding || !Array.isArray(req.embedding) || req.embedding.length === 0) {
          respond({ success: false, error: '缺少 embedding' })
          return
        }
        const tags = matchLabels(req.embedding, labels)
        respond({ success: true, tags, error: null })
        return
      }
      default:
        respond({ success: false, error: `未知请求类型: ${String(req?.type)}` })
    }
  } catch (err) {
    // 任何异常（解码失败/坏图等）都作为错误响应返回，worker 保持存活
    respond({ success: false, error: err instanceof Error ? err.message : String(err) })
  }
})
