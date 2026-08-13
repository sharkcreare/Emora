/**
 * AI M1-B 标签匹配 e2e：真实 Electron + 真实 Chinese-CLIP 模型 + 真实 label-embeddings.json。
 *   1. ping → worker 存活
 *   2. embedding（真实表情图）→ 512 维向量
 *   3. tag（真实 embedding）→ 返回 Top-N 标签（含 id/tag/source/similarity）
 *   4. tag 缺 embedding → 明确错误
 *   5. 标签向量文件缺失 → 明确错误且 worker 不崩溃（后续 ping 仍通）
 * 运行：cd emo/frontend && npx electron ../tools/ai-m1b-e2e.cjs
 */
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { Worker } = require('node:worker_threads')

const ROOT = path.resolve(__dirname, '..', 'frontend')
const safety = setTimeout(() => {
  console.error('e2e 超时（120s）')
  app.exit(2)
}, 120_000)

const TEST_IMG = path.join(__dirname, '..', 'backend', 'src', 'main', 'resources', 'static', 'emojis', 'emoji-01.png')
const LABEL_EMB = path.join(ROOT, 'electron', 'main', 'ai', 'label-embeddings.json')

function modelPath() {
  if (process.env.AI_MODEL_PATH && fs.existsSync(process.env.AI_MODEL_PATH)) return process.env.AI_MODEL_PATH
  const candidates = [
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.emoji-assistant', 'models', 'chinese-clip-vit-base-patch16', 'cn_clip_vision.onnx'),
    path.join(process.env.TEMP || '/tmp', 'emoji-assistant-models', 'chinese-clip-vit-base-patch16', 'cn_clip_vision.onnx'),
    '/tmp/emoji-assistant-models/chinese-clip-vit-base-patch16/cn_clip_vision.onnx'
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

function spawnWorker(model, labelEmb) {
  return new Worker(path.join(ROOT, 'out', 'main', 'ai-worker.js'), {
    workerData: { modelPath: model, modelVersion: 'v1', labelEmbeddingsPath: labelEmb }
  })
}

function send(worker, msg, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`请求超时: ${msg.type}`)), timeoutMs)
    const onMsg = (r) => {
      if (r && r.id === msg.id) {
        clearTimeout(t)
        worker.off('message', onMsg)
        resolve(r)
      }
    }
    worker.on('message', onMsg)
    worker.postMessage(msg)
  })
}

app.whenReady().then(async () => {
  const model = modelPath()
  console.log('模型路径:', model ?? '（未找到）')
  console.log('标签向量文件存在:', fs.existsSync(LABEL_EMB))

  const worker = spawnWorker(model, LABEL_EMB)
  worker.on('error', (e) => console.error('[worker error]', e.message))

  // 1. ping
  const p = await send(worker, { id: 'p1', type: 'ping' })
  const okPing = p.success === true
  console.log('ping:', JSON.stringify(p))

  // 2. embedding → 3. tag（全链路）
  let okTag = false
  if (model) {
    const e = await send(worker, { id: 'e1', type: 'embedding', imagePath: TEST_IMG }, 90_000)
    console.log('embedding:', JSON.stringify({ success: e.success, dimension: e.dimension, len: e.embedding?.length }))
    if (e.success === true && e.embedding && e.embedding.length === 512) {
      const t = await send(worker, { id: 't1', type: 'tag', embedding: e.embedding }, 60_000)
      console.log('tag 返回:', JSON.stringify(t.tags?.slice(0, 3)))
      okTag =
        t.success === true &&
        Array.isArray(t.tags) &&
        t.tags.length > 0 &&
        t.tags.length <= 5 &&
        t.tags.every(
          (x) =>
            typeof x.id === 'string' &&
            typeof x.tag === 'string' &&
            x.source === 'clip' &&
            typeof x.similarity === 'number' &&
            x.similarity >= 0 &&
            x.similarity <= 1
        )
      // 分数降序
      const sorted = t.tags.every((x, i) => i === 0 || t.tags[i - 1].similarity >= x.similarity)
      okTag = okTag && sorted
      console.log('标签数:', t.tags.length, '| 分数降序:', sorted)
    }
  } else {
    console.log('（模型缺失 → 跳过 tag 全链路，验证错误路径）')
  }

  // 4. tag 缺 embedding → 明确错误
  const noEmb = await send(worker, { id: 't2', type: 'tag' })
  const okNoEmb = noEmb.success === false && typeof noEmb.error === 'string'
  console.log('缺 embedding:', JSON.stringify({ success: noEmb.success, error: noEmb.error }))

  // 5. 标签向量文件缺失 → 错误且不崩溃（换一个坏路径 worker 或直接改 workerData 重建）
  const badWorker = spawnWorker(model, path.join(ROOT, 'out', 'main', 'no-such-label-embeddings.json'))
  const t3 = await send(badWorker, { id: 't3', type: 'tag', embedding: new Array(512).fill(0.1) })
  const okMissing = t3.success === false && typeof t3.error === 'string' && t3.error.length > 0
  console.log('标签文件缺失:', JSON.stringify({ success: t3.success, error: t3.error }))
  await badWorker.terminate()

  // 6. worker 未崩溃（tag 错误后仍可 ping）
  const p2 = await send(worker, { id: 'p2', type: 'ping' })
  const okAlive = p2.success === true

  await worker.terminate()

  const allOk = okPing && okTag && okNoEmb && okMissing && okAlive
  clearTimeout(safety)
  console.log(allOk ? '\nAI M1-B 标签匹配（worker）全部通过 ✓' : '\n存在失败项 ✗')
  console.log(JSON.stringify({ okPing, okTag, okNoEmb, okMissing, okAlive }))
  app.exit(allOk ? 0 : 1)
}).catch((e) => {
  console.error('e2e 失败:', e)
  clearTimeout(safety)
  app.exit(2)
})
