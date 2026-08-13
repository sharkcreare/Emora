/**
 * 真实源码 E2E 测试：编译 electron/main/clipboard.ts（项目实际代码），
 * 在 Electron 主进程运行时调用 writeImageToClipboard，
 * 验证 PNG 与 GIF 写入后剪贴板里都存在图片数据（而非只有文件列表）。
 * 运行：cd emo/frontend && npx electron ../tools/clipboard-real-e2e.cjs
 */
const { app, clipboard } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', 'frontend')

function compileClipboardModule() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'clipboard.ts'), 'utf8')
  // 产物放在 frontend/ 目录内，保证 import('jimp') 能沿 node_modules 向上解析（与真实 app 一致）
  const out = path.join(ROOT, '.clipboard-e2e-tmp.cjs')
  esbuild.buildSync({
    stdin: { contents: src, loader: 'ts', sourcefile: 'clipboard.ts' },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron']
  })
  return out
}

app.whenReady().then(async () => {
  const modFile = compileClipboardModule()
  const { writeImageToClipboard } = require(modFile)
  try { fs.unlinkSync(modFile) } catch { /* 保留便于排查 */ }

  const BASE = 'http://127.0.0.1:18080'
  const cases = [
    { label: 'PNG', url: BASE + '/static/emojis/emoji-01.png' },
    { label: 'GIF', url: BASE + '/static/emojis/real/bqb-01.gif' }
  ]

  let allOk = true
  for (const c of cases) {
    try {
      console.log(`\n=== ${c.label}: ${c.url}`)
      await writeImageToClipboard(c.url)
      const img = clipboard.readImage()
      const formats = clipboard.availableFormats()
      const hasImageFormat = formats.some((f) => /image|png|dib|bitmap/i.test(f))
      console.log(`  readImage 尺寸: ${img.getSize().width}x${img.getSize().height}, isEmpty=${img.isEmpty()}`)
      console.log(`  剪贴板格式: ${JSON.stringify(formats)}`)
      console.log(`  含图片格式: ${hasImageFormat}`)
      if (img.isEmpty() || !hasImageFormat) {
        allOk = false
        console.log(`  ${c.label} ✗ 剪贴板没有图片数据！`)
      } else {
        console.log(`  ${c.label} ✓ 剪贴板含图片数据`)
      }
    } catch (err) {
      allOk = false
      console.log(`  ${c.label} ✗ 异常: ${err.message}`)
    }
  }

  console.log(`\n=== 总结: ${allOk ? '全部通过 ✓' : '存在失败 ✗'}`)
  app.exit(allOk ? 0 : 1)
}).catch((err) => {
  console.error('测试启动失败:', err)
  app.exit(2)
})
