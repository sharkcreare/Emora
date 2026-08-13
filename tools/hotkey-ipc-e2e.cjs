/**
 * 真实 IPC 链路验证：编译真实 ipc.ts 注册 hotkey:get/set，用真实 preload 从渲染层调用。
 * 运行：cd emo/frontend && npx electron ../tools/hotkey-ipc-e2e.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', 'frontend')

function compileIpcModule() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'ipc.ts'), 'utf8')
  const out = path.join(ROOT, '.hotkey-ipc-e2e-tmp.cjs')
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

  const hotkeyFile = path.join(app.getPath('userData'), 'hotkey.json')
  try { fs.unlinkSync(hotkeyFile) } catch { /* ignore */ }

  registerIpc({
    hidePanel: () => {},
    togglePanel: () => {},
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

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const get1 = await window.api.getHotkey();
      out.push('get 默认=' + get1);
      const set = await window.api.setHotkey('CommandOrControl+Alt+H');
      out.push('set ok=' + set.ok + ' acc=' + set.accelerator + (set.error ? ' err=' + set.error : ''));
      const get2 = await window.api.getHotkey();
      out.push('get 更新后=' + get2);
      const setConflict = await window.api.setHotkey('CommandOrControl+Shift+E');
      out.push('冲突 set ok=' + setConflict.ok + ' acc=' + setConflict.accelerator + (setConflict.error ? ' err=' + setConflict.error : ''));
      const get3 = await window.api.getHotkey();
      out.push('冲突后 get=' + get3);
      return out;
    })()
  `)
  results.forEach((r) => console.log(r))

  const persisted = JSON.parse(fs.readFileSync(hotkeyFile, 'utf8'))
  console.log('持久化文件:', JSON.stringify(persisted))

  const ok =
    results[0].includes('CommandOrControl+Shift+E') &&
    results[1].includes('ok=true') &&
    results[2].includes('CommandOrControl+Alt+H') &&
    results[3].includes('ok=false') &&
    results[4].includes('CommandOrControl+Alt+H') &&
    persisted.accelerator === 'CommandOrControl+Alt+H'
  console.log(ok ? 'IPC 快捷键链路 ✓' : '✗ 链路异常')
  app.exit(ok ? 0 : 1)
}).catch((e) => {
  console.error('测试启动失败:', e)
  app.exit(2)
})
