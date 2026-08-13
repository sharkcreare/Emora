/**
 * 重复检测 e2e：编译真实 duplicate-service + cache + phash，
 * 用真实图片文件验证：同图复制 → 高度相似；不同图 → 不标记；进度回调。
 * 运行：cd emo/frontend && npx electron ../tools/duplicate-e2e.cjs
 */
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const ROOT = path.resolve(__dirname, '..', 'frontend')

function compileModule(rel, outName) {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', rel), 'utf8')
  const out = path.join(ROOT, 'out', 'main', outName)
  esbuild.buildSync({
    stdin: { contents: src, loader: 'ts', sourcefile: rel, resolveDir: path.join(ROOT, 'electron', path.dirname(rel)) },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron']
  })
  return out
}

app.whenReady().then(async () => {
  const dupFile = compileModule('main/locallib/duplicate-service.ts', 'e2e-duplicate-service.cjs')
  const { analyzeDuplicates } = require(dupFile)
  try { fs.unlinkSync(dupFile) } catch { /* ignore */ }

  // 用真实 GIF 动图（同图复制 = md5 精确重复；另一张不同 GIF = 不标记）
  const srcGifs = 'C:/Users/pan/AppData/Local/Temp/gifs'
  const gifA = fs.readFileSync(path.join(srcGifs, 'g448862.gif')) // 480x480 小 GIF
  const gifB = fs.readFileSync(path.join(srcGifs, 'ga358b2.gif')) // 500x281 不同 GIF

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emoji-dup-e2e-'))
  // 3 张：A=GIF1, A复制=GIF1 副本（字节相同）, B=GIF2（不同内容）
  fs.writeFileSync(path.join(dir, 'A.gif'), gifA)
  fs.writeFileSync(path.join(dir, 'A-copy.gif'), gifA)
  fs.writeFileSync(path.join(dir, 'B.gif'), gifB)

  const files = [
    { id: 'local_A', name: 'A', localPath: path.join(dir, 'A.gif'), parentDir: '' },
    { id: 'local_Acopy', name: 'A-copy', localPath: path.join(dir, 'A-copy.gif'), parentDir: '' },
    { id: 'local_B', name: 'B', localPath: path.join(dir, 'B.gif'), parentDir: '' }
  ]

  let lastProgress = 0
  const result = await analyzeDuplicates(files, 'folder', (done, total) => {
    lastProgress = done
  })

  const byName = Object.fromEntries(result.map((f) => [f.name, f]))
  const dupNames = result.filter((f) => f.duplicate).map((f) => f.name)
  console.log('进度回调最终值:', lastProgress, '=', result.length)
  console.log('标记为重复的:', dupNames.join(', ') || '(无)')

  // A 与 A-copy 字节相同 → md5 相同 → A-copy 标记 high
  const copyMarked = byName['A-copy'].duplicate === true && byName['A-copy'].duplicateLevel === 'high'
  console.log('A-copy 高度相似标记:', copyMarked ? '✓' : '✗ ' + JSON.stringify(byName['A-copy']))
  // B 与 A 内容不同 → 不应被误标
  const bClean = !byName['B'].duplicate
  console.log('B 未被误标:', bClean ? '✓' : '✗ ' + JSON.stringify(byName['B']))
  // 组代表：A-copy.duplicateOf 指向 A 的 id
  const repOk = byName['A-copy'].duplicateOf === 'local_A'
  console.log('组代表指向 A:', repOk ? '✓' : '✗ ' + byName['A-copy'].duplicateOf)

  const ok = copyMarked && bClean && repOk && lastProgress === result.length
  console.log(ok ? '\n重复检测 e2e 全部通过 ✓' : '\n存在失败项 ✗')
  app.exit(ok ? 0 : 1)
}).catch((e) => {
  console.error('e2e 失败:', e)
  app.exit(2)
})
