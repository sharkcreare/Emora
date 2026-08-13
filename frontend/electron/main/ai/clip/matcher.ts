/**
 * M1-B 阶段3：标签匹配（纯函数，无 electron / IO / worker 依赖）。
 *
 * 输入图片 embedding（512 维，L2 归一化）+ 标签向量池（label-embeddings.json），
 * 输出匹配的 AiTagItem[]（按 similarity 降序，Top5）。
 *
 * 流程：
 *   1. cosine 相似度
 *   2. 排序（降序）
 *   3. 阈值过滤：similarity < minSimilarity 删除（默认 0.22，标签级可覆盖）
 *   4. 分层限制：同 layer 最多取 3 个（防近义标签霸榜）
 *   5. 返回 Top5
 */

/** 标签向量（label-embeddings.json 的 labels 条目） */
export interface LabelEmbedding {
  id: string
  name: string
  layer: string
  category: string
  embedding: number[]
  /** 标签级阈值（可选，缺省用 matchLabels 的 defaultMinSimilarity） */
  minSimilarity?: number
}

/** 匹配结果（AiTagItem 的 clip 来源形态，按用户要求不含 confidence） */
export interface ClipTagMatch {
  id: string
  tag: string
  source: 'clip'
  similarity: number
}

/** 默认阈值：相似度低于此值的标签不返回 */
export const DEFAULT_MIN_SIMILARITY = 0.22
/** 同 layer 最多返回数量（防近义标签霸榜） */
export const MAX_PER_LAYER = 3
/** 最终返回数量上限 */
export const TOP_N = 5

/** 余弦相似度：dot(a,b) / (||a|| × ||b||)。向量已归一化时即点积，此处按公式稳妥计算。 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  if (denom <= 1e-12) return 0
  return dot / denom
}

/**
 * 标签匹配主函数。
 * @param imageEmbedding 图片 embedding（512 维）
 * @param labels         标签向量池（含阈值）
 * @param defaultMinSimilarity 默认阈值（缺省 0.22）
 * @returns 按 similarity 降序的 Top5 标签
 */
export function matchLabels(
  imageEmbedding: readonly number[],
  labels: readonly LabelEmbedding[],
  defaultMinSimilarity = DEFAULT_MIN_SIMILARITY
): ClipTagMatch[] {
  // 1+2. 计算 cosine 并排序（降序）
  const scored = labels
    .map((l) => ({
      id: l.id,
      tag: l.name,
      source: 'clip' as const,
      similarity: cosineSimilarity(imageEmbedding, l.embedding)
    }))
    .sort((a, b) => b.similarity - a.similarity)

  // 3. 阈值过滤（标签级阈值优先）
  const thresholdOf = new Map(labels.map((l) => [l.id, l.minSimilarity ?? defaultMinSimilarity]))
  const passed = scored.filter((s) => s.similarity >= thresholdOf.get(s.id)!)

  // 4. 分层限制：同 layer 最多 MAX_PER_LAYER 个（按分数降序取）
  const layerOf = new Map(labels.map((l) => [l.id, l.layer]))
  const perLayer = new Map<string, number>()
  const deduped: ClipTagMatch[] = []
  for (const s of passed) {
    const layer = layerOf.get(s.id) ?? ''
    const count = perLayer.get(layer) ?? 0
    if (count >= MAX_PER_LAYER) continue
    perLayer.set(layer, count + 1)
    deduped.push(s)
  }

  // 5. Top5
  return deduped.slice(0, TOP_N)
}
