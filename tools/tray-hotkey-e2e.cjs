/**
 * 验证托盘菜单：① 显示当前全局快捷键信息行；② 「修改快捷键…」入口存在；
 * ③ openSettingsFromTray 会向渲染进程发送 settings:open 事件（打开设置快捷键页）。
 * 运行：cd emo/frontend && npx electron ../tools/tray-hotkey-e2e.cjs
 */
const { app, Tray, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', 'frontend')

function compile(name, outName) {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main', name), 'utf8')
  // 输出到 out/main：与真实构建一致，__dirname 下的 ../../resources 能解析到图标
  const out = path.join(ROOT, 'out', 'main', outName)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  esbuild.buildSync({
    stdin: { contents: src, loader: 'ts', sourcefile: name, resolveDir: path.join(ROOT, 'electron', 'main') },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron']
  })
  return out
}

app.whenReady().then(async () => {
  // 拦截 loadFile/loadURL：e2e 无渲染产物，避免加载失败产生未处理拒绝
  const origLoadFile = BrowserWindow.prototype.loadFile
  const origLoadURL = BrowserWindow.prototype.loadURL
  BrowserWindow.prototype.loadFile = function () { return Promise.resolve() }
  BrowserWindow.prototype.loadURL = function () { return Promise.resolve() }

  // 捕获托盘菜单实例（Tray 不暴露模板，patch setContextMenu）
  let lastMenu = null
  const origSet = Tray.prototype.setContextMenu
  Tray.prototype.setContextMenu = function (menu) {
    lastMenu = menu
    return origSet.call(this, menu)
  }

  const trayFile = compile('tray.ts', '.tray-e2e-tmp.cjs')
  const trayMod = require(trayFile)
  const winFile = compile('window.ts', '.window-e2e-tmp.cjs')
  const winMod = require(winFile)

  const calls = []
  trayMod.createTray({
    togglePanel: () => calls.push('toggle'),
    openSettingsHotkey: () => calls.push('open-settings'),
    quit: () => calls.push('quit')
  })
  await new Promise((r) => setTimeout(r, 300))

  const labels = lastMenu ? lastMenu.items.map((i) => i.label || (i.type === 'separator' ? '---' : `[${i.type}]`)) : []
  console.log('托盘菜单项:')
  labels.forEach((l, i) => console.log(`  [${i}] ${l}`))
  const hasHotkeyRow = labels.some((l) => typeof l === 'string' && l.startsWith('快捷键：') && l.includes('Ctrl'))
  const hasModify = labels.includes('修改快捷键…')
  const hasRecent = labels.some((l) => l === '最近使用')

  // 模拟快捷键变更后的刷新（getHotkey 返回值不变时菜单重建路径也已覆盖）
  trayMod.refreshTrayMenu()
  await new Promise((r) => setTimeout(r, 100))

  // 验证 openSettingsFromTray 发送 settings:open(hotkey)
  const panel = winMod.createPanel()
  const sent = []
  panel.webContents.send = (ch, ...args) => { sent.push([ch, ...args]) }
  winMod.openSettingsFromTray('hotkey')
  await new Promise((r) => setTimeout(r, 300))
  const settingsEvent = sent.find(([ch]) => ch === 'settings:open')
  const ok1 = hasHotkeyRow && hasModify && hasRecent
  const ok2 = settingsEvent && settingsEvent[1] === 'hotkey'
  console.log(`\n快捷键信息行: ${hasHotkeyRow ? '✓' : '✗'} | 修改入口: ${hasModify ? '✓' : '✗'} | 最近使用: ${hasRecent ? '✓' : '✗'}`)
  console.log(`settings:open 事件: ${ok2 ? '✓' : '✗'} (${JSON.stringify(settingsEvent)})`)

  try {
    fs.unlinkSync(trayFile)
    fs.unlinkSync(winFile)
  } catch { /* ignore */ }
  app.exit(ok1 && ok2 ? 0 : 1)
}).catch((e) => {
  console.error('测试启动失败:', e)
  app.exit(2)
})
