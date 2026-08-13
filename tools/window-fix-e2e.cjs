/**
 * 验证最大化修复：编译真实 window.ts，调用 createPanel + toggleMaximizePanel 两次，
 * 确认 最大化→铺满工作区、还原→回到原尺寸（此前 unmaximize 不还原导致卡全屏）。
 * 运行：cd emo/frontend && npx electron ../tools/window-fix-e2e.cjs
 */
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', 'frontend')

function compileWindowModule() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'window.ts'), 'utf8')
  const out = path.join(ROOT, '.window-fix-e2e-tmp.cjs')
  esbuild.buildSync({
    stdin: { contents: src, loader: 'ts', sourcefile: 'window.ts', resolveDir: path.join(ROOT, 'electron', 'main') },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron']
  })
  return out
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  process.env.ELECTRON_RENDERER_URL = 'data:text/html,<html><body style="background:rgba(30,30,60,0.9)"><h1>panel</h1></body></html>'
  const modFile = compileWindowModule()
  const win = require(modFile)
  try { fs.unlinkSync(modFile) } catch { /* 保留便于排查 */ }

  const panel = win.createPanel()
  panel.setPosition(200, 200)
  await sleep(1500)
  const results = []

  const before = panel.getBounds()
  results.push(['最大化前', JSON.stringify(before)])

  // 第一次：最大化
  win.toggleMaximizePanel()
  await sleep(1200)
  const maxed = panel.getBounds()
  results.push(['最大化后', JSON.stringify(maxed)])
  results.push(['isPanelMaximized()', String(win.isPanelMaximized())])

  // 第二次：还原
  win.toggleMaximizePanel()
  await sleep(1200)
  const restored = panel.getBounds()
  results.push(['还原后', JSON.stringify(restored)])
  results.push(['还原尺寸正确', String(restored.width === before.width && restored.height === before.height && restored.x === before.x && restored.y === before.y)])

  // 再最大化一次（验证可反复切换）
  win.toggleMaximizePanel()
  await sleep(1000)
  results.push(['再次最大化', JSON.stringify(panel.getBounds())])
  win.toggleMaximizePanel()
  await sleep(1000)
  results.push(['再次还原', JSON.stringify(panel.getBounds())])

  // 最小化 + 热键呼出（showPanel 语义：restore + show）
  win.minimizePanel()
  await sleep(800)
  results.push(['最小化后', `minimized=${panel.isMinimized()}`])
  win.togglePanel()
  await sleep(1200)
  results.push(['热键呼出后', `minimized=${panel.isMinimized()} visible=${panel.isVisible()}`])
  console.log('=== 窗口修复验证 ===')
  for (const [k, v] of results) console.log(`[${k}] ${v}`)
  app.exit(0)
}).catch((err) => {
  console.error('测试失败:', err)
  app.exit(2)
})
