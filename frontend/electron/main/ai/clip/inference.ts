import { INPUT_SIZE } from './preprocess'

/**
 * Chinese-CLIP 图像编码器推理（onnxruntime-node）。
 *
 * M1-A：只做「图片 → 512 维 embedding」。
 * - session 抽象（SessionLike）：真实 onnxruntime 与测试 fake 共用，保证可单测
 * - 动态识别输入/输出名：官方导出用 `image`/`unnorm_image_features`，
 *   社区 HF 导出用 `pixel_values`/`image_embeds`——绝不硬编码
 * - 输出统一 L2 归一化（官方要求；已归一化则幂等）
 * - 标签匹配（cosine/Top-N）在 M1-B 接入，本模块不依赖 categories.json
 */

/** 最小 tensor 形状（真实 onnxruntime Tensor 与测试 fake 共用） */
export interface TensorLike {
  data: Float32Array | number[] | number[][][] | number[][]
  dims: readonly number[]
}

/** 最小 session 接口 */
export interface SessionLike {
  readonly inputNames: string[]
  readonly outputNames: string[]
  run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>>
}

/** embedding 结果 */
export interface EmbeddingResult {
  success: boolean
  embedding?: number[]
  dimension?: number
  modelVersion: string
  error?: string
}

/** 识别图片输入名（官方 image / HF pixel_values；排除 text/label） */
export function detectInputName(names: readonly string[]): string {
  const hit = names.find((n) => /pixel|image|input/i.test(n) && !/text|label|mask|ids/i.test(n))
  return hit ?? names[0] ?? ''
}

/** 识别 embedding 输出名（优先 embed/feature 类，排除 text/label） */
export function detectOutputName(names: readonly string[]): string {
  const hit = names.find((n) => /embed|feature/i.test(n) && !/text|label/i.test(n))
  return hit ?? names[0] ?? ''
}

/** L2 归一化（零向量返回原样） */
export function normalizeVector(vec: number[]): number[] {
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm)
  if (norm <= 1e-12) return vec
  const out = new Array<number>(vec.length)
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm
  return out
}

/**
 * 从模型输出提取 embedding 向量（统一转 number[]）：
 * - [1, D]      → 直接取
 * - [1, seq, D] → 取 CLS 位置（[0,0,:]）
 * - 其余形状    → null
 */
export function extractEmbedding(t: TensorLike): number[] | null {
  const dims = Array.isArray(t.dims) ? [...t.dims] : []
  const flat = Array.from(t.data as ArrayLike<number>)
  if (dims.length === 1 && dims[0] > 0) return flat.slice(0, dims[0])
  if (dims.length === 2 && dims[0] === 1) return flat.slice(0, dims[1])
  if (dims.length === 3 && dims[0] === 1 && dims[2] > 0) return flat.slice(0, dims[2])
  return null
}

/**
 * 真实 onnxruntime 会话适配器。
 * 模型文件不存在/损坏时 create 直接抛错（上层转成明确的失败状态）。
 */
export async function createOnnxSession(modelPath: string): Promise<SessionLike> {
  const ort = await import('onnxruntime-node')
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all'
  })
  return {
    inputNames: session.inputNames as string[],
    outputNames: session.outputNames as string[],
    async run(feeds: Record<string, TensorLike>) {
      const ortInputs: Record<string, InstanceType<typeof ort.Tensor>> = {}
      for (const [k, v] of Object.entries(feeds)) {
        ortInputs[k] = new ort.Tensor('float32', v.data as Float32Array, [...v.dims])
      }
      const result = await session.run(ortInputs)
      const out: Record<string, TensorLike> = {}
      for (const [k, v] of Object.entries(result)) {
        const t = v as { data: Float32Array; dims: readonly number[] }
        out[k] = { data: t.data as Float32Array, dims: [...t.dims] }
      }
      return out
    }
  }
}

/**
 * 对预处理后的 tensor 执行推理，返回归一化 embedding。
 * 任何异常（模型/输入/输出异常）都转为 { success:false, error }，绝不抛出。
 */
export async function computeEmbedding(
  session: SessionLike,
  tensor: Float32Array,
  modelVersion: string
): Promise<EmbeddingResult> {
  try {
    const inName = detectInputName(session.inputNames)
    if (!inName) return { success: false, modelVersion, error: '模型没有可用输入' }
    const feeds: Record<string, TensorLike> = {
      [inName]: { data: tensor, dims: [1, 3, INPUT_SIZE, INPUT_SIZE] }
    }
    const outputs = await session.run(feeds)
    const outName = detectOutputName(session.outputNames)
    const raw = outputs[outName]
    const embedding = raw ? extractEmbedding(raw) : null
    if (!embedding) {
      return { success: false, modelVersion, error: `无法从输出 ${outName} 提取 embedding` }
    }
    return { success: true, embedding: normalizeVector(embedding), dimension: embedding.length, modelVersion }
  } catch (err) {
    return { success: false, modelVersion, error: err instanceof Error ? err.message : String(err) }
  }
}
