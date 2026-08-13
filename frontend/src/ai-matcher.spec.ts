import { describe, expect, it } from 'vitest'
import {
  cosineSimilarity,
  matchLabels,
  DEFAULT_MIN_SIMILARITY,
  MAX_PER_LAYER,
  TOP_N,
  type LabelEmbedding
} from '../electron/main/ai/clip/matcher'

/** 构造单位向量：第 idx 位为 1 */
function unit(idx: number, dim = 8): number[] {
  const v = new Array<number>(dim).fill(0)
  v[idx] = 1
  return v
}

function label(id: string, name: string, layer: string, idx: number, extra?: Partial<LabelEmbedding>): LabelEmbedding {
  return { id, name, layer, category: 'custom', embedding: unit(idx), ...extra }
}

describe('cosineSimilarity', () => {
  it('相同方向 → 1，正交 → 0，相反 → -1', () => {
    expect(cosineSimilarity(unit(0), unit(0))).toBeCloseTo(1, 6)
    expect(cosineSimilarity(unit(0), unit(1))).toBeCloseTo(0, 6)
    expect(cosineSimilarity(unit(0), unit(0).map((v) => -v))).toBeCloseTo(-1, 6)
  })

  it('长度不一致 → 0；空向量 → 0', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('matchLabels 排序与阈值', () => {
  const image = unit(2) // 与 idx=2 的标签最相似
  const labels: LabelEmbedding[] = [
    label('a', '标签A', 'L1', 2), // cosine=1
    label('b', '标签B', 'L1', 3), // cosine=0
    label('c', '标签C', 'L1', 7) // cosine=0
  ]

  it('按 cosine 降序返回，id/name/source/similarity 齐全', () => {
    const res = matchLabels(image, labels)
    expect(res[0]).toEqual({ id: 'a', tag: '标签A', source: 'clip', similarity: 1 })
    expect(res).toHaveLength(1) // b/c 相似度 0 < 阈值被过滤
  })

  it('阈值过滤：低于默认 0.22 的标签被删除', () => {
    // 图片是 unit(2)，与任意归一化向量 v 的 cosine = v[2]
    // near: v[2]=0.3536 (>0.22 通过)；far: v[2]=0.1 (<0.22 被过滤)
    const near = label('n', '接近', 'L1', 2, {
      embedding: [0, 0, 0.3536, Math.sqrt(1 - 0.3536 ** 2), 0, 0, 0, 0]
    })
    const far = label('f', '很远', 'L1', 2, {
      embedding: [0, 0, 0.1, Math.sqrt(1 - 0.1 ** 2), 0, 0, 0, 0]
    })
    const res = matchLabels(image, [label('hit', '命中', 'L1', 2), near, far])
    expect(res.map((r) => r.id)).toEqual(['hit', 'n']) // far(0.1) 低于阈值被过滤；hit(1.0)/near(0.35) 通过
  })

  it('标签级 minSimilarity 覆盖默认阈值', () => {
    // 标签与图片同向(unit(2))：cosine=1；设标签级 0.8 → 通过；设 1.5 → 被过滤
    const pass = label('s', '严格', 'L1', 2, { minSimilarity: 0.8 })
    expect(matchLabels(image, [pass]).map((r) => r.id)).toEqual(['s'])
    const reject = label('r', '更高', 'L1', 2, { minSimilarity: 1.5 })
    expect(matchLabels(image, [reject])).toHaveLength(0)
    // 默认阈值下 cosine=1 通过（默认 0.22）
    expect(matchLabels(image, [label('d', '默认', 'L1', 2)]).map((r) => r.id)).toEqual(['d'])
  })
})

describe('matchLabels 分层限制', () => {
  it('同 layer 最多 MAX_PER_LAYER 个', () => {
    // 构造 4 个 L1 标签，cosine 都 ≥0.5（均过阈值）
    const make = (id: string, i: number, c: number): LabelEmbedding => ({
      id,
      name: id,
      layer: 'L1',
      category: 'custom',
      embedding: [Math.sqrt(c), Math.sqrt(1 - c), ...new Array<number>(6).fill(0)],
      minSimilarity: 0.22
    })
    const labels = [make('l1a', 0, 0.9), make('l1b', 1, 0.8), make('l1c', 2, 0.7), make('l1d', 3, 0.6)]
    const res = matchLabels([1, 0, 0, 0, 0, 0, 0, 0], labels)
    expect(res).toHaveLength(MAX_PER_LAYER)
    expect(res.map((r) => r.id)).toEqual(['l1a', 'l1b', 'l1c'])
  })

  it('不同 layer 不受彼此数量限制', () => {
    const labels: LabelEmbedding[] = [
      label('a1', 'A1', 'L1', 0),
      label('a2', 'A2', 'L1', 1),
      label('a3', 'A3', 'L1', 2),
      label('b1', 'B1', 'L2', 3),
      label('b2', 'B2', 'L2', 4),
      label('b3', 'B3', 'L2', 5),
      label('b4', 'B4', 'L2', 6)
    ]
    // 图片与所有标签都不正交：用 [1,1,1,1,1,1,1,1]/√8，每个 cosine=1/√8≈0.354 > 0.22
    const image = new Array<number>(8).fill(1 / Math.sqrt(8))
    const res = matchLabels(image, labels)
    // 分层后 L1×3 + L2×3 = 6，但最终 slice(0, TOP_N)=5 → [a1,a2,a3,b1,b2]
    expect(res).toHaveLength(5)
    const l1 = res.filter((r) => r.id.startsWith('a')).length
    const l2 = res.filter((r) => r.id.startsWith('b')).length
    expect(l1).toBe(3) // L1 同层上限 3 生效
    expect(l2).toBe(2) // TOP_N=5 截断（b3 被挤出）
  })
})

describe('matchLabels TopN 与边界', () => {
  it('返回数量不超过 TOP_N', () => {
    // 3 层 × 各 7 个共 21 个标签，全部接近图片（cosine 均 >0.22）
    const labels: LabelEmbedding[] = []
    for (let layer = 1; layer <= 3; layer++) {
      for (let i = 0; i < 7; i++) {
        const t = (i * 0.05) / 2
        labels.push({
          id: `m${layer}-${i}`,
          name: `梗${layer}-${i}`,
          layer: `L${layer}`,
          category: 'funny',
          embedding: [Math.cos(t), Math.sin(t), ...new Array<number>(6).fill(0)]
        })
      }
    }
    const res = matchLabels([1, 0, 0, 0, 0, 0, 0, 0], labels)
    expect(res.length).toBeLessThanOrEqual(TOP_N)
    expect(res).toHaveLength(TOP_N) // 分层限制后 9 个 → slice 到 5
  })

  it('空标签池 → 空结果', () => {
    expect(matchLabels(unit(0), [])).toEqual([])
  })

  it('图片 embedding 维度不匹配 → cosine=0 → 全部过滤', () => {
    const labels = [label('a', 'A', 'L1', 0)]
    const res = matchLabels([1, 0], labels) // 图片 2 维 vs 标签 8 维
    expect(res).toEqual([])
  })

  it('默认阈值常量校验', () => {
    expect(DEFAULT_MIN_SIMILARITY).toBe(0.22)
    expect(MAX_PER_LAYER).toBe(3)
    expect(TOP_N).toBe(5)
  })
})
