/**
 * 端到端验证渲染层错误上报链路：
 *   真实 ipc.ts（编译）→ registerIpc 注册 error:report → 真实 preload（out/preload/index.js）
 *   → 渲染层 window.api.reportError → 主进程写 userData/error.log（30s 聚合去重）。
 * 运行：cd emo/frontend && npx electron ../tools/error-report-e2e.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', 'frontend')

function compileIpcModule() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'ipc.ts'), 'utf8')
  const out = path.join(ROOT, '.error-report-e2e-ipc.cjs')
  esbuild.buildSync({
    stdin: { contents: src, loader: 'ts', sourcefile: 'ipc.ts', resolveDir: path.join(ROOT, 'electron', 'main') },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron']
  })
  return out
}

app.whenReady().then(async () => {
  const modFile = compileIpcModule()
  const { registerIpc } = require(modFile)
  try { fs.unlinkSync(modFile) } catch { /* ignore */ }

  const logFile = path.join(app.getPath('userData'), 'error.log')
  // 清掉本次测试前的旧行（保留文件存在性）
  const before = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
  const marker = `[e2e-${Date.now()}]`

  // 用 stub 依赖注册全部 IPC（含 error:report 处理器）
  registerIpc({
    hidePanel: () => {},
    getTargetWindow: () => ({ pid: 0, title: '' })
  })

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'out', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  await win.loadURL('about:blank')

  await win.webContents.executeJavaScript(`
    (async () => {
      if (typeof window.api?.reportError !== 'function') return 'NO-API';
      window.api.reportError('clipboard-test', '${marker} 第一次上报');
      window.api.reportError('clipboard-test', '${marker} 第一次上报'); // 30s 内重复 → 应被去重
      window.api.reportError('clipboard-test', '${marker} 第二次不同内容');
      return 'OK';
    })()
  `)

  await new Promise((r) => setTimeout(r, 1200))
  const after = fs.readFileSync(logFile, 'utf8')
  const newLines = after.split('\n').filter((l) => l.includes(marker))
  console.log('error.log 新增行数（期望 2，重复被去重）:', newLines.length)
  newLines.forEach((l) => console.log('  →', l.replace(/^.*\[renderer\] /, '[renderer] ')))
  const ok = newLines.length === 2 && newLines.every((l) => l.includes('[renderer]'))
  console.log(ok ? '错误上报链路 ✓（真实 preload → 真实 ipc → error.log，去重生效）' : '✗ 上报异常')
  app.exit(ok ? 0 : 1)
}).catch((e) => {
  console.error('测试启动失败:', e)
  app.exit(2)
})
