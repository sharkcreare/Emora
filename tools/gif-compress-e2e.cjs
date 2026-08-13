/**
 * GIF 压缩全链路 e2e：编译真实 compressor.ts（bundle worker 引用），
 * 用 11 个真实 GIF（小/大/高清/快速动画/长停顿文字GIF）逐一压缩，
 * 验证：压缩比例 / 产物有效性（可解析、动图帧保留）/ 透明通道 / 回退。
 * 运行：cd emo/frontend && npx electron ../tools/gif-compress-e2e.cjs
 */
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', 'frontend')
const GIF_DIR = 'C:/Users/pan/AppData/Local/Temp/gifs'

function compileCompressor() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'media', 'gif', 'compressor.ts'), 'utf8')
  const out = path.join(ROOT, 'out', 'main', 'e2e-compressor.cjs')
  esbuild.buildSync({
    stdin: { contents: src, loader: 'ts', sourcefile: 'compressor.ts', resolveDir: path.join(ROOT, 'electron', 'main', 'media', 'gif') },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron']
  })
  return out
}

/** 用 gifuct 验证产物是有效动图：可解析、帧数 > 1、透明保留 */
function verifyGif(filePath) {
  const { parseGIF, decompressFrames } = require(path.join(ROOT, 'node_modules', 'gifuct-js'))
  const buf = fs.readFileSync(filePath)
  try {
    const gif = parseGIF(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    const frames = decompressFrames(gif, true)
    return { ok: true, frames: frames.length, width: gif.lsd.width, height: gif.lsd.height, transparent: frames.some((f) => f.transparentIndex !== undefined) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

app.whenReady().then(async () => {
  const modFile = compileCompressor()
  const { compressGifIfNeeded, setGifConfig, getGifConfig } = require(modFile)
  try { fs.unlinkSync(modFile) } catch { /* ignore */ }

  setGifConfig({ enabled: true, mode: 'wechat' })
  console.log('配置:', JSON.stringify(getGifConfig()), '阈值:', 1 * 1024 * 1024)

  const files = fs.readdirSync(GIF_DIR).filter((f) => f.endsWith('.gif'))
  console.log(`共 ${files.length} 个真实 GIF\n`)

  let pass = 0
  let fail = 0
  let totalRatio = 0
  let compressedCount = 0

  for (const f of files.sort()) {
    const src = path.join(GIF_DIR, f)
    const size = fs.statSync(src).size
    const outcome = await compressGifIfNeeded(src)
    const outSize = fs.statSync(outcome.path).size
    const ratio = ((outSize / size) * 100).toFixed(1)
    const v = verifyGif(outcome.path)

    const line = `${f.padEnd(12)} ${String(size).padStart(9)}B -> ${String(outSize).padStart(9)}B (${ratio}%)  compressed=${outcome.compressed}  ${v.ok ? `frames=${v.frames} ${v.width}x${v.height} transp=${v.transparent}` : 'INVALID: ' + v.error}`
    console.log(line)

    const exceeds = size > 1 * 1024 * 1024 // 超过微信 1MB 阈值才需要压缩
    let ok
    if (exceeds) {
      // 大 GIF：必须压缩且产物有效（帧保留、可解析）
      ok =
        outcome.compressed === true &&
        outSize < size &&
        v.ok === true &&
        v.frames >= 2
      if (ok) { pass++; totalRatio += Number(ratio); compressedCount++ }
    } else {
      // 小 GIF：不压缩直接走原文件 = 正确行为（零开销）
      ok = outcome.compressed === false && outcome.path === src && v.ok === true
      if (ok) pass++
    }
    if (!ok) fail++
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败 (压缩 ${compressedCount} 个, 平均压缩至 ${(totalRatio / Math.max(1, compressedCount)).toFixed(1)}%)`)

  // 回退测试：损坏文件不得抛错
  const badPath = path.join(os.tmpdir(), 'emoji-assistant', 'bad-e2e.gif')
  fs.mkdirSync(path.dirname(badPath), { recursive: true })
  fs.writeFileSync(badPath, Buffer.from('NOTAGIF', 'binary'))
  try {
    const r = await compressGifIfNeeded(badPath)
    console.log('损坏文件回退:', r.path === badPath && r.compressed === false ? '✓ 回退原文件' : '✗ ' + JSON.stringify(r))
  } catch (e) {
    console.log('损坏文件回退: ✗ 抛异常 ' + e.message)
    fail++
  }

  // 缓存命中测试：用第一个被压缩的大 GIF，二次调用应直接命中缓存
  const big = files.find((f) => fs.statSync(path.join(GIF_DIR, f)).size > 1 * 1024 * 1024)
  const src = path.join(GIF_DIR, big)
  const r1 = await compressGifIfNeeded(src)
  const r2 = await compressGifIfNeeded(src)
  console.log('缓存命中:', r1.compressed && r1.path === r2.path ? '✓ 二次调用复用缓存' : '✗ 未命中缓存')

  // 透明背景保真：custom 模式低阈值强制压缩透明 GIF，验证透明全帧保留
  setGifConfig({ enabled: true, mode: 'custom', customThresholdBytes: 300 * 1024 })
  const transPath = path.join(GIF_DIR, 'transparent-test.gif')
  const tr = await compressGifIfNeeded(transPath)
  const tv = verifyGif(tr.path)
  const transpOk = tr.compressed && tr.path !== transPath && tv.ok && tv.transparent
  console.log('透明背景:', transpOk ? `✓ 压缩后 ${tv.frames} 帧透明保留` : '✗ ' + JSON.stringify({ tr: tr.compressed, tv }))
  if (!transpOk) fail++

  app.exit(fail === 0 ? 0 : 1)
}).catch((e) => {
  console.error('测试启动失败:', e)
  app.exit(2)
})
