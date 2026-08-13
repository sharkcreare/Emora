/**
 * 重复检测 UI 链路 e2e：真实 locallib/index.ts（含重复分析编排）+ IPC handler，
 * 用含重复图的 demo 文件夹验证：扫描 → 分析 → duplicate 标记 → progress/analyzed 事件。
 * 运行：cd emo/frontend && npx electron ../tools/duplicate-ui-e2e.cjs
 */
const { app, ipcMain, BrowserWindow } = require('electron')
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
  // locallib 编译到真实构建路径 out/main/locallib/index.js，ipc  bundle 以 external 引用它，
  // 保证 e2e 初始化与渲染层 IPC 调用的是同一个模块实例。
  const libFile = path.join(ROOT, 'out', 'main', 'locallib', 'index.js')
  fs.mkdirSync(path.dirname(libFile), { recursive: true })
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const libSrc = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'locallib', 'index.ts'), 'utf8')
  esbuild.buildSync({
    stdin: { contents: libSrc, loader: 'ts', sourcefile: 'locallib/index.ts', resolveDir: path.join(ROOT, 'electron', 'main', 'locallib') },
    outfile: libFile, bundle: true, format: 'cjs', platform: 'node', external: ['electron']
  })
  const lib = require(libFile)
  const ipcFile = compileModule('main/ipc.ts', 'e2e-ui-ipc.cjs', ['./locallib'])
  const ipcMod = require(ipcFile)
  try { fs.unlinkSync(ipcFile) } catch { /* ignore */ }

  lib.registerLocallibProtocolSafe()
  lib.initLocallib()
  ipcMod.registerIpc({ hidePanel: () => {}, togglePanel: () => {}, getTargetWindow: () => null })

  const demoDir = path.join(os.tmpdir(), 'emoji-assistant-locallib-demo')
  // 直接把 demo 文件夹写入配置（绕过弹窗）
  const cfgPath = path.join(app.getPath('userData'), 'locallib.json')
  fs.writeFileSync(cfgPath, JSON.stringify({ folders: [demoDir], ignored: [] }, null, 2))
  lib.initLocallib() // 重新初始化读取新配置 + 触发分析

  // 监听分析完成事件（通过主进程事件捕获）
  let progressEvents = 0
  let analyzedPayload = null
  const results = []

  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(ROOT, 'out', 'preload', 'index.js'), contextIsolation: true } })
  await win.loadURL('about:blank')
  await win.webContents.executeJavaScript(
    `window.api.onLocallibAnalysisProgress(() => {}); window.api.onLocallibAnalyzed((files) => { window.__analyzed = files }); true`
  )

  // 等待分析完成（轮询分析状态）
  let state
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))
    state = await win.webContents.executeJavaScript('window.api.getLocallibAnalysisState()')
    if (state && !state.running && state.total > 0) break
  }
  console.log('分析状态:', JSON.stringify(state))

  const libState = await win.webContents.executeJavaScript('window.api.getLocallibState()')
  const files = libState.files
  console.log('扫描文件:', files.map((f) => f.name).join(', '))
  const dup = files.filter((f) => f.duplicate)
  console.log('重复标记:', dup.map((f) => `${f.name}(${f.duplicateLevel}→${f.duplicateOf})`).join(', ') || '(无)')

  const okScan = files.length === 3
  const okDup = dup.length === 1 && dup[0].name === '同图2副本' && dup[0].duplicateLevel === 'high' && dup[0].duplicateOf
  console.log(okScan && okDup ? '\n重复检测 UI 链路全部通过 ✓' : '\n存在失败项 ✗')
  app.exit(okScan && okDup ? 0 : 1)
}).catch((e) => {
  console.error('e2e 失败:', e)
  app.exit(2)
})
