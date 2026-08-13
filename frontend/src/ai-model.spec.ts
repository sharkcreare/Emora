import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadModelState,
  getModelInfo,
  requestModelDownload,
  resetModelState,
  onModelStateChange,
  setModelDirForTests,
  MODEL_META
} from '../electron/main/ai/model/manager'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ai-model-test-'))
  setModelDirForTests(dir)
})

afterEach(() => {
  setModelDirForTests('')
  rmSync(dir, { recursive: true, force: true })
})

describe('ai-model-manager', () => {
  it('初始状态：未安装（带模型标识/版本/大小）', () => {
    loadModelState()
    const info = getModelInfo()
    expect(info.state).toBe('not-installed')
    expect(info.modelId).toBe(MODEL_META.modelId)
    expect(info.version).toBe(MODEL_META.version)
    expect(typeof info.sizeBytes).toBe('number')
  })

  it('发起下载：M0 占位 → downloading → failed（错误信息含 M1）', async () => {
    loadModelState()
    expect(getModelInfo().state).toBe('not-installed')

    const info = await requestModelDownload()
    expect(info.state).toBe('failed')
    expect(info.error).toContain('M1')

    // 状态已持久化：重载后仍为 failed
    loadModelState()
    expect(getModelInfo().state).toBe('failed')
  })

  it('状态变化事件：下载失败会推送新状态', async () => {
    loadModelState()
    const states: string[] = []
    const off = onModelStateChange((info) => states.push(info.state))

    await requestModelDownload()

    expect(states.length).toBeGreaterThanOrEqual(1)
    expect(states[0]).toBe('downloading')
    expect(states[states.length - 1]).toBe('failed')
    off()
  })

  it('已持久化 ready 状态 → 读取为已完成', () => {
    // M1-A：ready 状态需要模型文件实际存在（文件丢失 → 视为 failed）
    mkdirSync(join(dir, MODEL_META.modelId), { recursive: true })
    writeFileSync(join(dir, MODEL_META.modelId, 'model.onnx'), 'fake-onnx-bytes')
    writeFileSync(
      join(dir, 'download.json'),
      JSON.stringify({
        modelId: MODEL_META.modelId,
        version: 'v1',
        state: 'ready',
        downloadedBytes: MODEL_META.sizeBytes,
        updatedAt: Date.now()
      })
    )
    loadModelState()
    expect(getModelInfo().state).toBe('ready')
    expect(getModelInfo().version).toBe('v1')
  })

  it('失败后 reset → 回到未安装（可重试）', async () => {
    loadModelState()
    await requestModelDownload()
    expect(getModelInfo().state).toBe('failed')

    const info = resetModelState()
    expect(info.state).toBe('not-installed')
    // 持久化已重置
    loadModelState()
    expect(getModelInfo().state).toBe('not-installed')
  })

  it('已完成状态下再次请求下载 → 直接返回 ready，不再触发下载', async () => {
    mkdirSync(join(dir, MODEL_META.modelId), { recursive: true })
    writeFileSync(join(dir, MODEL_META.modelId, 'model.onnx'), 'fake-onnx-bytes')
    writeFileSync(
      join(dir, 'download.json'),
      JSON.stringify({
        modelId: MODEL_META.modelId,
        version: 'v1',
        state: 'ready',
        downloadedBytes: MODEL_META.sizeBytes,
        updatedAt: Date.now()
      })
    )
    loadModelState()
    const info = await requestModelDownload()
    expect(info.state).toBe('ready')
  })
})
