/**
 * 真实 Electron 验证全局快捷键自定义：
 *   registerGlobalHotkey（默认）→ setHotkey 切换 → 冲突回滚 → 持久化文件 → pause/resume。
 * 编译真实 hotkey.ts（含 electron 依赖），在真实 app 环境运行。
 * 运行：cd emo/frontend && npx electron ../tools/hotkey-e2e.cjs
 */
const { app, globalShortcut } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', 'frontend')

function compileHotkeyModule() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'hotkey.ts'), 'utf8')
  const out = path.join(ROOT, '.hotkey-e2e-tmp.cjs')
  esbuild.buildSync({
    stdin: { contents: src, loader: 'ts', sourcefile: 'hotkey.ts', resolveDir: path.join(ROOT, 'electron', 'main') },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron']
  })
  return out
}

app.whenReady().then(async () => {
  const modFile = compileHotkeyModule()
  const hotkey = require(modFile)
  try { fs.unlinkSync(modFile) } catch { /* ignore */ }

  const hotkeyFile = path.join(app.getPath('userData'), 'hotkey.json')
  try { fs.unlinkSync(hotkeyFile) } catch { /* ignore */ }

  const cb = () => {}
  const results = []
  const check = (name, cond, detail = '') => {
    results.push({ name, ok: !!cond, detail })
    console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
  }

  // 1. 默认值逻辑（dev 实例可能占用 Ctrl+Shift+E，注册成败取决于环境，仅验证读取）
  hotkey.registerGlobalHotkey(cb)
  check('默认值正确', hotkey.getHotkey() === 'CommandOrControl+Shift+E', hotkey.getHotkey())

  // 2. 切换新快捷键（不冲突的组合）
  const set1 = hotkey.setHotkey('CommandOrControl+Alt+K', cb)
  check('切换到 Ctrl+Alt+K 成功', set1.ok, set1.accelerator)
  check('新快捷键已生效', hotkey.getHotkey() === 'CommandOrControl+Alt+K')
  check('旧快捷键已注销', !globalShortcut.isRegistered('CommandOrControl+Shift+E'))
  check('新快捷键已注册', globalShortcut.isRegistered('CommandOrControl+Alt+K'))
  const persisted2 = JSON.parse(fs.readFileSync(hotkeyFile, 'utf8'))
  check('持久化更新为新值', persisted2.accelerator === 'CommandOrControl+Alt+K')

  // 3. 冲突检测：注册一个被占用的组合（先手动占一个，再尝试设置成它）
  const occupied = 'CommandOrControl+Shift+O'
  globalShortcut.register(occupied, cb)
  const setConflict = hotkey.setHotkey(occupied, cb)
  check('冲突组合返回失败', !setConflict.ok && !!setConflict.error, setConflict.error || '')
  check('冲突后回滚为原快捷键', hotkey.getHotkey() === 'CommandOrControl+Alt+K', hotkey.getHotkey())
  check('冲突后原快捷键仍注册', globalShortcut.isRegistered('CommandOrControl+Alt+K'))

  // 4. 非法输入
  const setBad = hotkey.setHotkey('E', cb)
  check('裸键被拒绝', !setBad.ok && !!setBad.error, setBad.error || '')

  // 5. pause/resume
  hotkey.pauseGlobalHotkey()
  check('暂停后未注册', !globalShortcut.isRegistered('CommandOrControl+Alt+K'))
  hotkey.resumeGlobalHotkey(cb)
  check('恢复后重新注册', globalShortcut.isRegistered('CommandOrControl+Alt+K'))

  // 6. 重启模拟：重新 registerGlobalHotkey 应从持久化恢复
  hotkey.unregisterGlobalHotkey()
  hotkey.registerGlobalHotkey(cb)
  check('重启后从持久化恢复自定义键', hotkey.getHotkey() === 'CommandOrControl+Alt+K', hotkey.getHotkey())

  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ${failed.length === 0 ? '全部通过 ✓' : failed.length + ' 项失败 ✗'} ===`)
  app.exit(failed.length === 0 ? 0 : 1)
}).catch((e) => {
  console.error('测试启动失败:', e)
  app.exit(2)
})
