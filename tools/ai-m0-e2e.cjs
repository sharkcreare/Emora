/**
 * AI 标签系统 M0 骨架 e2e：真实 Electron 验证 IPC 链路。
 *   1. getAiModelInfo → 初始 not-installed（带版本/大小）
 *   2. requestAiModelDownload → downloading → failed（M0 占位）
 *   3. getAiAnalysisState → idle + cachedFiles
 *   4. ai:model-state 事件推送可订阅
 * 运行：cd emo/frontend && npx electron ../tools/ai-m0-e2e.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', 'frontend')

// 隔离 userData：避免上次运行持久化的模型状态影响「初始 not-installed」断言
app.setPath('userData', path.join(require('node:os').tmpdir(), `ai-m0-e2e-${Date.now()}`))

// 兜底：30 秒内必须完成，否则判失败退出（避免静默挂起）
const safety = setTimeout(() => {
  console.error('e2e 超时（30s）')
  app.exit(2)
}, 30_000)

app.whenReady().then(async () => {
  // 编译 ai 模块与 ipc（ipc 外部引用 ai，保持同一实例）
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const outAi = path.join(ROOT, 'out', 'main', 'ai', 'index.js')
  fs.mkdirSync(path.dirname(outAi), { recursive: true })
  esbuild.buildSync({
    stdin: {
      contents: fs.readFileSync(path.join(ROOT, 'electron', 'main', 'ai', 'index.ts'), 'utf8'),
      loader: 'ts',
      sourcefile: 'ai/index.ts',
      resolveDir: path.join(ROOT, 'electron', 'main', 'ai')
    },
    outfile: outAi,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron']
  })
  const aiMod = require(outAi)

  const ipcFile = path.join(ROOT, 'out', 'main', 'e2e-ai-ipc.cjs')
  esbuild.buildSync({
    stdin: {
      contents: fs.readFileSync(path.join(ROOT, 'electron', 'main', 'ipc.ts'), 'utf8'),
      loader: 'ts',
      sourcefile: 'ipc.ts',
      resolveDir: path.join(ROOT, 'electron', 'main')
    },
    outfile: ipcFile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron', './ai']
  })
  const ipcMod = require(ipcFile)
  try { fs.unlinkSync(ipcFile) } catch { /* ignore */ }

  aiMod.initAi()
  ipcMod.registerIpc({ hidePanel: () => {}, togglePanel: () => {}, getTargetWindow: () => null })

  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(ROOT, 'out', 'preload', 'index.js'), contextIsolation: true } })
  await win.loadURL('about:blank')
  await win.webContents.executeJavaScript('true')

  // 1. 初始状态
  const info0 = await win.webContents.executeJavaScript('window.api.getAiModelInfo()')
  console.log('初始模型状态:', JSON.stringify(info0))
  const ok0 = info0.state === 'not-installed' && typeof info0.version === 'string' && info0.modelId.includes('clip')

  // 2. 发起下载 → downloading → failed（M0 占位）
  await win.webContents.executeJavaScript('window.__aiStates = []')
  await win.webContents.executeJavaScript('(() => { window.api.onAiModelStateChange((i) => window.__aiStates.push(i.state)) })()')
  const info1 = await win.webContents.executeJavaScript('window.api.requestAiModelDownload()')
  await new Promise((r) => setTimeout(r, 300))
  const states = await win.webContents.executeJavaScript('window.__aiStates')
  console.log('下载状态流转:', JSON.stringify(states))
  const ok1 = states.includes('downloading') && states[states.length - 1] === 'failed'
  const infoAfter = await win.webContents.executeJavaScript('window.api.getAiModelInfo()')
  const ok1b = infoAfter.state === 'failed' && typeof infoAfter.error === 'string' && infoAfter.error.includes('M1')

  // 3. 分析状态
  const aState = await win.webContents.executeJavaScript('window.api.getAiAnalysisState()')
  console.log('分析状态:', JSON.stringify(aState))
  const ok2 = aState.running === false && aState.mode === 'idle' && typeof aState.cachedFiles === 'number'

  const allOk = ok0 && ok1 && ok1b && ok2
  clearTimeout(safety)
  console.log(allOk ? '\nAI M0 骨架 IPC 链路全部通过 ✓' : '\n存在失败项 ✗')
  app.exit(allOk ? 0 : 1)
}).catch((e) => {
  console.error('e2e 失败:', e)
  clearTimeout(safety)
  app.exit(2)
})
