/**
 * 对比面板「移出本地库」链路 e2e：真实 locallib + IPC，验证：
 *   1. 批量忽略 ignoreLocallibFiles 生效（重扫后文件从列表消失，磁盘文件保留）
 *   2. 保留组过滤：buildDupGroup / applyDupKeep 已在单测覆盖，这里验证主进程数据链路
 * 运行：cd emo/frontend && npx electron ../tools/dupkeep-ipc-e2e.cjs
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
  const ipcFile = compileModule('main/ipc.ts', 'e2e-dupkeep-ipc.cjs', ['./locallib'])
  const ipcMod = require(ipcFile)
  try { fs.unlinkSync(ipcFile) } catch { /* ignore */ }

  lib.registerLocallibProtocolSafe()
  ipcMod.registerIpc({ hidePanel: () => {}, togglePanel: () => {}, getTargetWindow: () => null })
  const demoDir = path.join(os.tmpdir(), 'emoji-assistant-dupkeep-demo')
  fs.mkdirSync(demoDir, { recursive: true })
  // 3 个文件：同图两份 + 一张不同图（避免 1x1 全同误判，用真实 GIF）
  const gifDir = path.join(os.tmpdir(), 'gifs')
  const srcGif = path.join(gifDir, 'dog.gif')
  if (!fs.existsSync(srcGif)) {
    // 生成一张简单真实 PNG 作为素材
    const { writeFileSync } = fs
    writeFileSync(path.join(demoDir, 'x.png'), Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
    writeFileSync(path.join(demoDir, 'y.png'), fs.readFileSync(path.join(demoDir, 'x.png')))
    writeFileSync(path.join(demoDir, 'z.png'), Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
  } else {
    fs.copyFileSync(srcGif, path.join(demoDir, 'dog.gif'))
    fs.copyFileSync(srcGif, path.join(demoDir, 'dog2.gif'))
  }

  const cfgPath = path.join(app.getPath('userData'), 'locallib.json')
  fs.writeFileSync(cfgPath, JSON.stringify({ folders: [demoDir], ignored: [] }, null, 2))
  lib.initLocallib()

  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(ROOT, 'out', 'preload', 'index.js'), contextIsolation: true } })
  await win.loadURL('about:blank')
  await win.webContents.executeJavaScript('true')

  // 等待分析完成
  let state
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400))
    state = await win.webContents.executeJavaScript('window.api.getLocallibAnalysisState()')
    if (state && !state.running && state.total > 0) break
  }

  const before = await win.webContents.executeJavaScript('window.api.getLocallibState()')
  const files = before.files
  console.log('扫描文件:', files.map((f) => f.name).join(', '))
  const dup = files.filter((f) => f.duplicate)
  console.log('重复标记:', dup.map((f) => `${f.name}(${f.duplicateLevel})`).join(', ') || '(无)')

  // 1. 批量忽略所有重复文件（模拟「移出本地库」）
  const dupPaths = dup.map((f) => f.localPath)
  const after = await win.webContents.executeJavaScript(
    `window.api.ignoreLocallibFiles(${JSON.stringify(dupPaths)}).then(s => ({ files: s.files.map(f => f.name), ignored: s.ignored }))`
  )
  console.log('忽略后文件:', after.files.join(', ') || '(空)')
  console.log('忽略名单:', after.ignored.length, '条')

  // 2. 磁盘文件仍在
  const onDisk = dupPaths.every((p) => fs.existsSync(p))
  const okIgnore = after.files.length === files.length - dup.length && after.ignored.length === dup.length
  const okDisk = onDisk
  const okDup = dup.length >= 1

  console.log(okIgnore && okDisk && okDup ? '\n批量忽略链路全部通过 ✓' : '\n存在失败项 ✗')
  app.exit(okIgnore && okDisk && okDup ? 0 : 1)
}).catch((e) => {
  console.error('e2e 失败:', e)
  app.exit(2)
})
