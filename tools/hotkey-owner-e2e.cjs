/**
 * 验证冲突时枚举可见进程候选：编译真实 hotkey.ts，
 * 注册一个被占用的组合，检查返回的错误消息含候选进程名。
 * 运行：cd emo/frontend && npx electron ../tools/hotkey-owner-e2e.cjs
 */
const { app, globalShortcut } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', 'frontend')

function compileHotkeyModule() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'hotkey.ts'), 'utf8')
  const out = path.join(ROOT, '.hotkey-owner-e2e-tmp.cjs')
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

  const cb = () => {}
  // 先注册一个组合占用它，再尝试设置成同一组合 → 触发冲突分支
  const occupied = 'CommandOrControl+Shift+O'
  globalShortcut.register(occupied, cb)
  await hotkey.registerGlobalHotkey(cb) // 读取默认键

  const res = await hotkey.setHotkey(occupied, cb)
  console.log('ok:', res.ok)
  console.log('accelerator:', res.accelerator)
  console.log('error:', res.error)

  const ok =
    !res.ok &&
    res.error &&
    res.error.includes('已被其他程序占用') &&
    res.error.includes('候选程序')
  console.log(ok ? '冲突候选进程提示 ✓' : '✗ 候选提示缺失')
  app.exit(ok ? 0 : 1)
}).catch((e) => {
  console.error('测试启动失败:', e)
  app.exit(2)
})
