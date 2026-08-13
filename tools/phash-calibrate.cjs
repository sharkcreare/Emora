/**
 * pHash 阈值校准：用真实 GIF 测量 pHash 汉明距离分布。
 *  - 同图复制（字节相同）→ 距离应为 0（md5 已强制 high，这里看 pHash）
 *  - 旋转 90° 的副本 → 旋转集合比较应接近 0
 *  - 不同 GIF → 距离应远大于相似阈值
 * 运行：cd emo/frontend && npx electron ../tools/phash-calibrate.cjs
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const ROOT = path.resolve(__dirname, '..', 'frontend')
const GIFS = path.join(os.tmpdir(), 'gifs')

function compilePhash() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'locallib', 'phash.ts'), 'utf8')
  const out = path.join(ROOT, 'out', 'main', 'e2e-phash.cjs')
  esbuild.buildSync({
    stdin: { contents: src, loader: 'ts', sourcefile: 'phash.ts', resolveDir: path.join(ROOT, 'electron', 'main', 'locallib') },
    outfile: out, bundle: true, format: 'cjs', platform: 'node'
  })
  return out
}

/** 用 jimp 解码 GIF 首帧 → RGBA；再生成旋转 90° 的副本 */
async function decodeFirstFrame(file) {
  const Jimp = (await import('jimp')).default
  const img = await Jimp.read(file)
  return { data: new Uint8ClampedArray(img.bitmap.data.buffer.slice(0)), width: img.bitmap.width, height: img.bitmap.height }
}

function rotate90({ data, width, height }) {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4
      const di = (x * width + (height - 1 - y)) * 4
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = 255
    }
  }
  return { data: out, width: height, height: width }
}

app.whenReady().then(async () => {
  const phashFile = compilePhash()
  const { pHashFromPixels, pHashRotFromPixels, minRotationDistance, hammingDistance } = require(phashFile)
  try { fs.unlinkSync(phashFile) } catch {}

  const files = fs.existsSync(GIFS) ? fs.readdirSync(GIFS).filter((f) => f.endsWith('.gif')) : []
  if (files.length < 2) {
    console.error('未找到测试 GIF（/tmp/gifs 下应有多个）')
    app.exit(2)
    return
  }

  // 1. 逐对计算 0° pHash 距离（不同图基线）
  const hashes = []
  for (const f of files) {
    try {
      const px = await decodeFirstFrame(path.join(GIFS, f))
      hashes.push({ f, h0: pHashFromPixels(px.data, px.width, px.height), rot: pHashRotFromPixels(px.data, px.width, px.height) })
    } catch { console.log('解码失败跳过:', f) }
  }

  // 不同图距离分布
  const diffs = []
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      diffs.push(hammingDistance(hashes[i].h0, hashes[j].h0))
    }
  }
  diffs.sort((a, b) => a - b)
  const pct = (p) => diffs[Math.floor(diffs.length * p)]
  console.log(`不同图 pHash 距离分布（${diffs.length} 对）: min=${diffs[0]} p25=${pct(0.25)} p50=${pct(0.5)} p75=${pct(0.75)} max=${diffs[diffs.length - 1]}`)

  // 2. 同图复制 → 距离 0
  const selfDist = hammingDistance(hashes[0].h0, hashes[0].h0)
  console.log('同图自比较:', selfDist)

  // 3. 旋转鲁棒：每张图旋转 90° 后与原图旋转集合比较
  let minRot = Infinity, maxRot = -Infinity
  for (const h of hashes) {
    const px = await decodeFirstFrame(path.join(GIFS, h.f))
    const r = rotate90(px)
    const rotHashes = pHashRotFromPixels(r.data, r.width, r.height)
    const d = minRotationDistance(h.rot, rotHashes)
    minRot = Math.min(minRot, d)
    maxRot = Math.max(maxRot, d)
  }
  console.log(`旋转 90° 后最小旋转距离: min=${minRot} max=${maxRot}`)

  // 4. 同内容不同尺寸（用 jimp 缩放一份）→ 应小于不同图基线
  const px = await decodeFirstFrame(path.join(GIFS, hashes[0].f))
  const Jimp = (await import('jimp')).default
  const img = await Jimp.read(path.join(GIFS, hashes[0].f))
  const scaled = img.clone().resize(Math.max(1, Math.floor(img.getWidth() * 0.6)), Jimp.AUTO)
  const s0 = pHashFromPixels(new Uint8ClampedArray(scaled.bitmap.data.buffer.slice(0)), scaled.bitmap.width, scaled.bitmap.height)
  console.log(`同图缩放 60% 后 0° 距离: ${hammingDistance(hashes[0].h0, s0)}（应远小于不同图基线）`)

  app.exit(0)
}).catch((e) => {
  console.error('校准失败:', e)
  app.exit(2)
})
