/**
 * locallib IPC 链路 e2e：真实 preload + 真实 ipcMain handler + 真实 locallib 模块，
 * 验证 getState / ignore / unignore / rescan 的完整 IPC 通路。
 * 运行：cd emo/frontend && npx electron ../tools/locallib-ipc-e2e.cjs
 */
const { app, ipcMain, BrowserWindow } = require('electron')
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
  // 编译 locallib + ipc 真实模块
  const libFile = compileModule('main/locallib/index.ts', 'e2e-ipc-locallib.cjs')
  const lib = require(libFile)
  const ipcFile = compileModule('main/ipc.ts', 'e2e-ipc.cjs')
  const ipcMod = require(ipcFile)
  try { fs.unlinkSync(libFile) } catch { /* ignore */ }
  try { fs.unlinkSync(ipcFile) } catch { /* ignore */ }

  // 注册协议 + 初始化
  lib.registerLocallibProtocolSafe()
  lib.initLocallib()

  // 注册 ipcMain handlers（模拟 registerIpc，deps 用空实现）
  ipcMod.registerIpc({ hidePanel: () => {}, togglePanel: () => {}, getTargetWindow: () => null })

  // 准备测试目录
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emoji-assistant-locallib-ipc-'))
  fs.writeFileSync(path.join(testDir, 'a.png'), 'x')
  fs.writeFileSync(path.join(testDir, 'b.gif'), 'GIF89a\x01\x00\x01\x00\x80\x00\x00')

  // 直接通过 lib 的添加逻辑不可行（弹窗），改走 scanner 级 API：手动写配置太侵入。
  // 这里验证 IPC 通道本身：getState / ignore / unignore / rescan 都能响应。
  const getState = () => ipcMain.emit ? null : null // 占位，下面用 invoke 需要渲染进程
  // 真实方式：建一个隐藏窗口跑 preload 上下文，用 ipcRenderer.invoke
  const preloadPath = path.join(ROOT, 'out', 'preload', 'index.js')
  const win = new BrowserWindow({ show: false, webPreferences: { preload: preloadPath, contextIsolation: true } })
  await win.loadURL('about:blank')

  const results = []
  const s1 = await win.webContents.executeJavaScript('window.api.getLocallibState()')
  results.push(['getState 初始', Array.isArray(s1?.files)])

  // ignore 一个不存在的路径也应正常返回状态（幂等）
  const s2 = await win.webContents.executeJavaScript(
    `window.api.ignoreLocallibFile(${JSON.stringify(path.join(testDir, 'a.png'))})`
  )
  results.push(['ignore 后 ignored 含该文件', s2?.ignored?.includes(path.join(testDir, 'a.png'))])

  const s3 = await win.webContents.executeJavaScript(
    `window.api.unignoreLocallibFile(${JSON.stringify(path.join(testDir, 'a.png'))})`
  )
  results.push(['unignore 后 ignored 不含', !s3?.ignored?.includes(path.join(testDir, 'a.png'))])

  const s4 = await win.webContents.executeJavaScript('window.api.rescanLocallib()')
  results.push(['rescan 返回 files 数组', Array.isArray(s4?.files)])

  for (const [name, ok] of results) {
    console.log(`${ok ? '✓' : '✗'} ${name}`)
  }
  const allOk = results.every(([, ok]) => ok)
  console.log(allOk ? '\nlocallib IPC 链路全部通过 ✓' : '\n存在失败项 ✗')
  app.exit(allOk ? 0 : 1)
}).catch((e) => {
  console.error('e2e 失败:', e)
  app.exit(2)
})
