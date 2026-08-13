/**
 * 真实源码 E2E：编译 electron/main/clipboard.ts（项目实际代码），
 * 在 Electron 主进程运行时调用 writeImageToClipboard，
 * 覆盖 本地 PNG / 本地 GIF / 网络 BAIDU / 网络 BQB 四类图片，
 * 逐个打印解码与写入结果，定位「无法读取图片」的具体来源。
 * 运行：cd emo/frontend && npx electron ../tools/clipboard-format-e2e.cjs
 */
const { app, clipboard } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', 'frontend')

function compileClipboardModule() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'clipboard.ts'), 'utf8')
  const out = path.join(ROOT, '.clipboard-format-e2e-tmp.cjs')
  esbuild.buildSync({
    stdin: {
      contents: src,
      loader: 'ts',
      sourcefile: 'clipboard.ts',
      resolveDir: path.join(ROOT, 'electron', 'main')
    },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron']
  })
  return out
}

// 先用后端拿一条 BAIDU 与一条 BQB 的真实 URL
function fetchNetworkUrls() {
  return new Promise((resolve) => {
    const http = require('node:http')
    http.get('http://127.0.0.1:18080/api/emoji/search?keyword=' + encodeURIComponent('猫') + '&page=1&size=200', (r) => {
      let d = ''
      r.on('data', (c) => (d += c))
      r.on('end', () => {
        const recs = (JSON.parse(d).data?.records) || []
        const baidu = recs.find((e) => e.source === 'BAIDU')
        const bqb = recs.find((e) => e.source === 'BQB')
        resolve({ baidu: baidu?.url, bqb: bqb?.url })
      })
    }).on('error', () => resolve({}))
  })
}

app.whenReady().then(async () => {
  const modFile = compileClipboardModule()
  const { writeImageToClipboard } = require(modFile)
  try { fs.unlinkSync(modFile) } catch { /* 保留便于排查 */ }

  const BASE = 'http://127.0.0.1:18080'
  const { baidu, bqb } = await fetchNetworkUrls()
  console.log('BAIDU 样例:', (baidu || '').slice(0, 80))
  console.log('BQB   样例:', (bqb || '').slice(0, 80))

  const cases = [
    { label: '本地PNG', url: BASE + '/static/emojis/emoji-01.png' },
    { label: '本地GIF', url: BASE + '/static/emojis/real/bqb-01.gif' },
    ...(baidu ? [{ label: '网络BAIDU', url: baidu }] : []),
    ...(bqb ? [{ label: '网络BQB', url: bqb }] : [])
  ]

  let allOk = true
  for (const c of cases) {
    try {
      console.log(`\n=== ${c.label}`)
      await writeImageToClipboard(c.url)
      const img = clipboard.readImage()
      const formats = clipboard.availableFormats()
      const hasImageFormat = formats.some((f) => /image|png|dib|bitmap/i.test(f))
      console.log(`  readImage: ${img.getSize().width}x${img.getSize().height} isEmpty=${img.isEmpty()}`)
      console.log(`  格式: ${JSON.stringify(formats.slice(0, 8))}`)
      if (img.isEmpty() || !hasImageFormat) {
        allOk = false
        console.log(`  ${c.label} ✗ 剪贴板没有图片数据！`)
      } else {
        console.log(`  ${c.label} ✓ 剪贴板含图片`)
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
