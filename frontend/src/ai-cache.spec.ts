import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadAiTagCache,
  saveAiTagCache,
  getCachedAiTags,
  setCachedAiTags,
  clearAiTagCache,
  resetAiTagCacheMemory,
  pruneStaleAiTags,
  aiTagCacheSize,
  setAiCacheFileForTests
} from '../electron/main/ai/cache'
import type { AiTagResult } from '../electron/main/ai/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ai-cache-test-'))
  setAiCacheFileForTests(join(dir, 'ai-tags.json'))
  // 模块级内存缓存跨测试累积，先重置
  resetAiTagCacheMemory()
})

afterEach(() => {
  setAiCacheFileForTests('')
  rmSync(dir, { recursive: true, force: true })
})

function mkResult(version: string, mtime: number, size: number): AiTagResult {
  return {
    fingerprint: { mtime, size },
    contentHash: 'dhash-abc123',
    modelVersion: version,
    labelVersion: 'lv1',
    aiTags: ['狗头', '搞笑'],
    categories: ['animal'],
    confidence: 0.92,
    description: '一个狗头表情',
    details: [{ id: 'meme_doghead', tag: '狗头', source: 'clip', similarity: 0.92 }],
    inherited: false,
    analyzedAt: Date.now()
  }
}

describe('ai-cache', () => {
  it('set/get 往返：指纹与模型版本一致时命中', () => {
    const file = join(dir, 'a.png')
    writeFileSync(file, Buffer.from('img1'))
    const st = statSync(file)
    setCachedAiTags(file, mkResult('v1', st.mtimeMs, st.size))

    const hit = getCachedAiTags(file, 'v1')
    expect(hit).not.toBeNull()
    expect(hit?.aiTags).toEqual(['狗头', '搞笑'])
    expect(hit?.modelVersion).toBe('v1')
  })

  it('图片变化（mtime/size 指纹不符）→ 缓存失效返回 null', () => {
    const file = join(dir, 'a.png')
    writeFileSync(file, Buffer.from('img1'))
    const st = statSync(file)
    setCachedAiTags(file, mkResult('v1', st.mtimeMs, st.size))

    // 内容变化（size 不同）
    writeFileSync(file, Buffer.from('img1-much-longer-content'))
    expect(getCachedAiTags(file, 'v1')).toBeNull()
  })

  it('模型版本不符 → 旧结果作废返回 null 并删除', () => {
    const file = join(dir, 'a.png')
    writeFileSync(file, Buffer.from('img1'))
    const st = statSync(file)
    setCachedAiTags(file, mkResult('v0', st.mtimeMs, st.size))

    expect(getCachedAiTags(file, 'v1')).toBeNull()
    expect(aiTagCacheSize()).toBe(0)
  })

  it('标签池版本不符 → 旧结果作废返回 null 并删除', () => {
    const file = join(dir, 'a.png')
    writeFileSync(file, Buffer.from('img1'))
    const st = statSync(file)
    setCachedAiTags(file, mkResult('v1', st.mtimeMs, st.size))

    // 模型版本一致但标签池版本从 lv1 升到 lv2 → 作废
    expect(getCachedAiTags(file, 'v1', 'lv2')).toBeNull()
    expect(aiTagCacheSize()).toBe(0)
  })

  it('标签池版本一致 → 命中', () => {
    const file = join(dir, 'a.png')
    writeFileSync(file, Buffer.from('img1'))
    const st = statSync(file)
    setCachedAiTags(file, mkResult('v1', st.mtimeMs, st.size))

    expect(getCachedAiTags(file, 'v1', 'lv1')).not.toBeNull()
    // 不传 labelVersion（旧调用方）→ 不校验标签池，仍命中
    expect(getCachedAiTags(file, 'v1')).not.toBeNull()
  })

  it('文件已删除 → 返回 null', () => {
    const file = join(dir, 'gone.png')
    writeFileSync(file, Buffer.from('img1'))
    const st = statSync(file)
    setCachedAiTags(file, mkResult('v1', st.mtimeMs, st.size))
    rmSync(file)

    expect(getCachedAiTags(file, 'v1')).toBeNull()
  })

  it('save/load 落盘往返', () => {
    const file = join(dir, 'a.png')
    writeFileSync(file, Buffer.from('img1'))
    const st = statSync(file)
    setCachedAiTags(file, mkResult('v1', st.mtimeMs, st.size))
    saveAiTagCache()

    // 清内存后重载
    resetAiTagCacheMemory()
    expect(aiTagCacheSize()).toBe(0)
    loadAiTagCache()
    expect(aiTagCacheSize()).toBe(1)
    expect(getCachedAiTags(file, 'v1')?.aiTags).toEqual(['狗头', '搞笑'])
  })

  it('pruneStaleAiTags：只清理旧模型版本条目并返回条数', () => {
    const a = join(dir, 'a.png')
    const b = join(dir, 'b.png')
    writeFileSync(a, Buffer.from('img-a'))
    writeFileSync(b, Buffer.from('img-b'))
    setCachedAiTags(a, mkResult('v0', statSync(a).mtimeMs, statSync(a).size))
    setCachedAiTags(b, mkResult('v1', statSync(b).mtimeMs, statSync(b).size))

    const removed = pruneStaleAiTags('v1')
    expect(removed).toBe(1)
    expect(aiTagCacheSize()).toBe(1)
    expect(getCachedAiTags(b, 'v1')).not.toBeNull()
    expect(getCachedAiTags(a, 'v1')).toBeNull()
  })

  it('clearAiTagCache 清空并落盘', () => {
    const file = join(dir, 'a.png')
    writeFileSync(file, Buffer.from('img1'))
    const st = statSync(file)
    setCachedAiTags(file, mkResult('v1', st.mtimeMs, st.size))
    clearAiTagCache()
    expect(aiTagCacheSize()).toBe(0)
  })
})
