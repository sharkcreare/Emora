/**
 * 上传库/收藏夹去重链路 e2e：真实 locallib + analyzeScope，验证：
 *   1. /uploads/ URL → 磁盘路径解析（~/.emoji-assistant/uploads）
 *   2. scope=upload 对上传库重复文件返回标记（含 duplicateOf 换回原 id）
 *   3. scope=favorite 对不可解析的种子/网络条目自动跳过
 * 运行：cd emo/frontend && npx electron ../tools/scope-e2e.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const ROOT = path.resolve(__dirname, '..', 'frontend')

function compileModule(rel, outName, extraExternal = []) {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', rel), 'utf8')
  const out = path.join(ROOT, 'out', 'main', outName)
  esbuild.buildSync({
    stdin: { contents: src, loader: 'ts', sourcefile: rel, resolveDir: path.join(ROOT, 'electron', path.dirname(rel)) },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron', ...extraExternal]
  })
  return out
}

app.whenReady().then(async () => {
  const libFile = path.join(ROOT, 'out', 'main', 'locallib', 'index.js')
  fs.mkdirSync(path.dirname(libFile), { recursive: true })
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const libSrc = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'locallib', 'index.ts'), 'utf8')
  esbuild.buildSync({
    stdin: { contents: libSrc, loader: 'ts', sourcefile: 'locallib/index.ts', resolveDir: path.join(ROOT, 'electron', 'main', 'locallib') },
    outfile: libFile, bundle: true, format: 'cjs', platform: 'node', external: ['electron']
  })
  const lib = require(libFile)
  const ipcFile = compileModule('main/ipc.ts', 'e2e-scope-ipc.cjs', ['./locallib'])
  const ipcMod = require(ipcFile)
  try { fs.unlinkSync(ipcFile) } catch { /* ignore */ }

  lib.registerLocallibProtocolSafe()
  ipcMod.registerIpc({ hidePanel: () => {}, togglePanel: () => {}, getTargetWindow: () => null })

  // 在上传目录下建 e2e 专属子目录（测试后清理）
  const uploadRoot = path.join(os.homedir(), '.emoji-assistant', 'uploads')
  const e2eDir = path.join(uploadRoot, 'e2e-scope-test')
  fs.rmSync(e2eDir, { recursive: true, force: true })
  fs.mkdirSync(e2eDir, { recursive: true })
  // 本地文件夹托管目录：放与上传 a 完全一致的副本（跨库重复场景）
  const folderDir = path.join(os.tmpdir(), 'emoji-assistant-scope-folder')
  fs.rmSync(folderDir, { recursive: true, force: true })
  fs.mkdirSync(folderDir, { recursive: true })
  // 用 jimp 生成真实图案（1x1 纯色图 dHash 全 0 会误判相似，必须用带纹理的图）
  const Jimp = require(path.join(ROOT, 'node_modules', 'jimp'))
  async function makePng(file, checkerSize, flip) {
    const img = new Jimp(32, 32, 0xffffffff)
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const cell = Math.floor(x / checkerSize) + Math.floor(y / checkerSize)
        const on = (cell % 2 === 0) !== flip
        img.setPixelColor(on ? 0xff3366ff : 0xffddeeff, x, y)
      }
    }
    const buf = await img.getBufferAsync(Jimp.MIME_PNG)
    fs.writeFileSync(file, buf)
  }
  await makePng(path.join(e2eDir, 'a.png'), 4, false)
  await makePng(path.join(e2eDir, 'a-copy.png'), 4, false) // 与 a 完全一致 → md5 精确重复
  await makePng(path.join(e2eDir, 'b.png'), 8, true) // 不同纹理 → 不相似
  // 文件夹里的 a.png 与上传 a.png 字节完全一致 → 跨库重复
  await makePng(path.join(folderDir, 'a.png'), 4, false)

  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(ROOT, 'out', 'preload', 'index.js'), contextIsolation: true } })
  await win.loadURL('about:blank')
  await win.webContents.executeJavaScript('true')

  const url = (f) => `/uploads/e2e-scope-test/${f}`
  // 上传库：a 与 a-copy 应标记为重复（md5 相同 → high），b 不标记
  const uploadMarks = await win.webContents.executeJavaScript(
    `window.api.analyzeLocallibScope('upload', [
      { id: 1001, name: 'a', url: ${JSON.stringify(url('a.png'))} },
      { id: 1002, name: 'a-copy', url: ${JSON.stringify(url('a-copy.png'))} },
      { id: 1003, name: 'b', url: ${JSON.stringify(url('b.png'))} }
    ])`
  )
  console.log('upload marks:', JSON.stringify(uploadMarks))
  const markIds = new Map(uploadMarks.map((m) => [String(m.id), m]))
  const okUpload =
    markIds.has('1002') && markIds.get('1002').duplicate && markIds.get('1002').duplicateOf === '1001' &&
    !markIds.has('1001') && !markIds.has('1003')

  // 收藏夹：种子 LOCAL（/static）与网络（http）不可解析 → 跳过；上传项仍标记
  const favMarks = await win.webContents.executeJavaScript(
    `window.api.analyzeLocallibScope('favorite', [
      { id: 1, name: '种子', url: '/static/emojis/emoji-01.png' },
      { id: 2, name: '网络', url: 'https://example.com/a.png' },
      { id: 1001, name: 'a', url: ${JSON.stringify(url('a.png'))} },
      { id: 1002, name: 'a-copy', url: ${JSON.stringify(url('a-copy.png'))} }
    ])`
  )
  console.log('favorite marks:', JSON.stringify(favMarks))
  const favIds = new Set(favMarks.map((m) => String(m.id)))
  const okFavorite = favIds.has('1002') && !favIds.has('1') && !favIds.has('2')

  // 跨库去重：把文件夹托管起来（locallib.json 指向 folderDir）→ 重新分析 → 上传记录应被标记为与文件夹文件重复
  const userData = app.getPath('userData')
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(
    path.join(userData, 'locallib.json'),
    JSON.stringify({ folders: [folderDir], ignored: [], hashType: 'dHash' })
  )
  lib.initLocallib()
  // 等文件夹分析（enqueue 串行）完成后再跑跨库分析
  await new Promise((r) => setTimeout(r, 300))
  const crossMarks = await win.webContents.executeJavaScript(
    `window.api.analyzeLocallibScope('upload', [
      { id: 1001, name: 'a', url: ${JSON.stringify(url('a.png'))} },
      { id: 1002, name: 'a-copy', url: ${JSON.stringify(url('a-copy.png'))} },
      { id: 1003, name: 'b', url: ${JSON.stringify(url('b.png'))} }
    ])`
  )
  console.log('cross-scope marks:', JSON.stringify(crossMarks))
  const crossIds = new Map(crossMarks.map((m) => [String(m.id), m]))
  const crossRep = crossIds.get('1001')?.duplicateOf
  // 1001 / 1002 均标记为与文件夹文件重复（duplicateOf = local_ id，非上传 id）；1003 不标记
  const okCross =
    crossIds.has('1001') && crossIds.get('1001').duplicate && crossIds.get('1001').duplicateOf === crossRep &&
    crossIds.has('1002') && crossIds.get('1002').duplicate && crossIds.get('1002').duplicateOf === crossRep &&
    typeof crossRep === 'string' && crossRep.startsWith('local_') &&
    !crossIds.has('1003')
  // 文件夹侧：getLocallibState 的 files 已写回跨库标记（a.png 是组代表 → 不标记）
  const folderState = lib.getLocallibState()
  const folderA = folderState.files.find((f) => f.name === 'a')
  const okFolderSide = !!folderA && !folderA.duplicate && folderState.files.length === 1
  // 分析状态：scope + 各范围统计（收藏页/设置页统一可见的进度与去重结果）
  const astate = lib.getLocallibAnalysisState()
  const okStats =
    astate.scope === 'upload' &&
    astate.scopes.upload?.duplicates === 2 &&
    astate.scopes.upload?.total === 3 &&
    astate.scopes.folder?.duplicates === 0 &&
    astate.scopes.folder?.total === 1 &&
    astate.scopes.favorite?.duplicates === 1 &&
    astate.scopes.favorite?.total === 2

  // 清理
  fs.rmSync(e2eDir, { recursive: true, force: true })
  fs.rmSync(folderDir, { recursive: true, force: true })
  fs.rmSync(path.join(userData, 'locallib.json'), { force: true })

  const allOk = okUpload && okFavorite && okCross && okFolderSide && okStats
  console.log(
    allOk
      ? `\n上传库/收藏夹去重 + 跨库互相去重链路全部通过 ✓\n分析状态 scope=${astate.scope} scopes=${JSON.stringify(astate.scopes)}`
      : '\n存在失败项 ✗'
  )
  app.exit(allOk ? 0 : 1)
}).catch((e) => {
  console.error('e2e 失败:', e)
  app.exit(2)
})
