/**
 * AI M1-A 推理核心 e2e：真实 Electron 主进程里运行 ai-worker。
 *   1. ping → worker 存活
 *   2. embedding（真实表情图）→ success + 512 维向量（若模型就绪）
 *   3. embedding（损坏文件）→ success:false，且 worker 不崩溃（后续 ping 仍通）
 *   4. 模型缺失 → embedding 返回明确错误，不阻塞
 * 运行：cd emo/frontend && npx electron ../tools/ai-m1a-e2e.cjs
 * 环境变量 AI_MODEL_PATH 指定模型文件（默认自动探测 /tmp 下载目录）。
 */
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { Worker } = require('node:worker_threads')

const ROOT = path.resolve(__dirname, '..', 'frontend')
const safety = setTimeout(() => {
  console.error('e2e 超时（90s）')
  app.exit(2)
}, 90_000)

// 真实表情测试图（后端种子资源）
const TEST_IMG = path.join(__dirname, '..', 'backend', 'src', 'main', 'resources', 'static', 'emojis', 'emoji-01.png')
// 损坏文件（不可解码）
const CORRUPT_IMG = path.join(__dirname, 'ai-m1a-corrupt.bin')

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

function spawnWorker(model) {
  return new Worker(path.join(ROOT, 'out', 'main', 'ai-worker.js'), {
    workerData: { modelPath: model, modelVersion: 'v1' }
  })
}

function send(worker, msg, timeoutMs = 30_000) {
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
  fs.writeFileSync(CORRUPT_IMG, Buffer.from('not an image at all'))
  const model = modelPath()
  console.log('模型路径:', model ?? '（未找到 → 验证缺失报错路径）')
  console.log('测试图片存在:', fs.existsSync(TEST_IMG))

  const worker = spawnWorker(model)
  worker.on('error', (e) => console.error('[worker error]', e.message))

  // 1. ping
  const p = await send(worker, { id: 'p1', type: 'ping' })
  console.log('ping:', JSON.stringify(p))
  const okPing = p.success === true

  // 2. embedding（模型就绪才可能成功；缺失 → 明确错误）
  const e = await send(worker, { id: 'e1', type: 'embedding', imagePath: TEST_IMG }, 60_000)
  console.log('embedding 返回:', JSON.stringify({ success: e.success, dimension: e.dimension, len: e.embedding?.length, error: e.error }))
  let okEmbed = false
  if (model) {
    okEmbed = e.success === true && e.dimension === 512 && Array.isArray(e.embedding) && e.embedding.length === 512 &&
      e.embedding.every((v) => typeof v === 'number' && Number.isFinite(v))
    // 向量非全零（归一化后应有内容）
    const norm = Math.sqrt(e.embedding.reduce((s, v) => s + v * v, 0))
    console.log('向量 L2 范数:', norm.toFixed(4))
    okEmbed = okEmbed && norm > 0.5
  } else {
    okEmbed = e.success === false && typeof e.error === 'string' && e.error.length > 0
    console.log('（模型缺失路径验证 ✓ 若 error 非空）')
  }

  // 3. 损坏图片 → 错误响应且 worker 存活
  const bad = await send(worker, { id: 'e2', type: 'embedding', imagePath: CORRUPT_IMG }, 60_000)
  console.log('损坏图片返回:', JSON.stringify({ success: bad.success, error: bad.error }))
  const okCorrupt = bad.success === false && typeof bad.error === 'string'
  const p2 = await send(worker, { id: 'p2', type: 'ping' })
  console.log('崩溃后 ping:', JSON.stringify(p2))
  const okAlive = p2.success === true

  // 4. 请求无 imagePath → 明确错误
  const noPath = await send(worker, { id: 'e3', type: 'embedding' })
  const okNoPath = noPath.success === false

  // 5. 未知类型 → 明确错误
  const unk = await send(worker, { id: 'u1', type: 'bogus' })
  const okUnknown = unk.success === false && typeof unk.error === 'string'

  await worker.terminate()
  try { fs.unlinkSync(CORRUPT_IMG) } catch { /* ignore */ }

  const allOk = okPing && okEmbed && okCorrupt && okAlive && okNoPath && okUnknown
  clearTimeout(safety)
  console.log(allOk ? '\nAI M1-A 推理核心（worker）全部通过 ✓' : '\n存在失败项 ✗')
  console.log(JSON.stringify({ okPing, okEmbed, okCorrupt, okAlive, okNoPath, okUnknown }))
  app.exit(allOk ? 0 : 1)
}).catch((e) => {
  console.error('e2e 失败:', e)
  clearTimeout(safety)
  app.exit(2)
})
