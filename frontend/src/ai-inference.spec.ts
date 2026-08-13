import { describe, expect, it } from 'vitest'
import {
  detectInputName,
  detectOutputName,
  normalizeVector,
  extractEmbedding,
  computeEmbedding,
  createOnnxSession,
  type SessionLike,
  type TensorLike
} from '../electron/main/ai/clip/inference'

/** 确定性 fake session：输入任意，返回固定输出 */
function fakeSession(outputs: Record<string, TensorLike>): SessionLike {
  return {
    inputNames: ['pixel_values'],
    outputNames: ['image_embeds'],
    async run() {
      return outputs
    }
  }
}

describe('动态输入/输出识别（官方与社区导出兼容）', () => {
  it('官方导出：image / unnorm_image_features', () => {
    expect(detectInputName(['image'])).toBe('image')
    expect(detectOutputName(['unnorm_image_features'])).toBe('unnorm_image_features')
  })

  it('社区 HF 导出：pixel_values / image_embeds', () => {
    expect(detectInputName(['pixel_values', 'input_ids'])).toBe('pixel_values')
    expect(detectOutputName(['image_embeds', 'last_hidden_state'])).toBe('image_embeds')
  })

  it('文本侧输入被排除', () => {
    expect(detectInputName(['input_ids', 'attention_mask'])).toBe('input_ids')
  })
})

describe('embedding 提取', () => {
  it('[1,512] 直接取', () => {
    const data = Array.from({ length: 512 }, (_, i) => i % 7)
    const emb = extractEmbedding({ data, dims: [1, 512] })
    expect(emb?.length).toBe(512)
  })

  it('[1,seq,D] 取 CLS（首行）', () => {
    const data = Array.from({ length: 197 * 768 }, (_, i) => i % 13)
    const emb = extractEmbedding({ data, dims: [1, 197, 768] })
    expect(emb?.length).toBe(768)
  })

  it('非法形状返回 null', () => {
    expect(extractEmbedding({ data: [1, 2, 3], dims: [2, 512] })).toBeNull()
    expect(extractEmbedding({ data: [1, 2, 3], dims: [0] })).toBeNull()
  })

  it('normalizeVector：L2 归一化为单位向量', () => {
    const n = normalizeVector([3, 4])
    expect(n[0]).toBeCloseTo(0.6, 6)
    expect(n[1]).toBeCloseTo(0.8, 6)
    // 零向量不除零
    expect(normalizeVector([0, 0])).toEqual([0, 0])
  })
})

describe('computeEmbedding', () => {
  it('推理成功：返回归一化 embedding 与维度/版本', async () => {
    const sess = fakeSession({ image_embeds: { data: new Float32Array([3, 4]), dims: [1, 2] } })
    const res = await computeEmbedding(sess, new Float32Array(3 * 224 * 224), 'v1')
    expect(res.success).toBe(true)
    expect(res.dimension).toBe(2)
    expect(res.embedding![0]).toBeCloseTo(0.6, 6)
    expect(res.modelVersion).toBe('v1')
  })

  it('推理异常 → success:false + error（不抛出）', async () => {
    const bad: SessionLike = {
      inputNames: ['pixel_values'],
      outputNames: ['image_embeds'],
      async run() {
        throw new Error('推理崩溃')
      }
    }
    const res = await computeEmbedding(bad, new Float32Array(3 * 224 * 224), 'v1')
    expect(res.success).toBe(false)
    expect(res.error).toContain('推理崩溃')
  })

  it('输出无法提取 → 明确错误', async () => {
    const sess = fakeSession({ image_embeds: { data: [1, 2], dims: [2, 1] } })
    const res = await computeEmbedding(sess, new Float32Array(3 * 224 * 224), 'v1')
    expect(res.success).toBe(false)
    expect(res.error).toContain('embedding')
  })

  it('模型文件不存在 → create 明确失败（模型缺失提示）', async () => {
    await expect(createOnnxSession('Z:/definitely-not-exist/model.onnx')).rejects.toThrow()
  })
})
