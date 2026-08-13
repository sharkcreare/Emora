/**
 * GIF 动图粘贴验证：编译真实 clipboard.ts，调用 writeGifToClipboard（GIF → 文件拖放格式），
 * 用 PowerShell 验证剪贴板出现 FileDrop/FileNameW/FileName（微信/QQ 识别为文件 → 保留动画）。
 * 运行：cd emo/frontend && npx electron ../tools/gif-file-e2e.cjs
 */
const { app } = require('electron')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs')
const path = require('node:path')

const execFileAsync = promisify(execFile)
const ROOT = path.resolve(__dirname, '..', 'frontend')

function compileClipboardModule() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'clipboard.ts'), 'utf8')
  const out = path.join(ROOT, '.gif-file-e2e-tmp.cjs')
  esbuild.buildSync({
    stdin: { contents: src, loader: 'ts', sourcefile: 'clipboard.ts', resolveDir: path.join(ROOT, 'electron', 'main') },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron']
  })
  return out
}

async function runPs(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const { stdout } = await execFileAsync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout: 20000, windowsHide: true })
  return stdout.trim()
}

app.whenReady().then(async () => {
  const modFile = compileClipboardModule()
  const { writeGifToClipboard, writeImageToClipboard } = require(modFile)
  try { fs.unlinkSync(modFile) } catch { /* 保留便于排查 */ }

  const gifUrl = 'http://127.0.0.1:18080/static/emojis/real/bqb-01.gif'
  const pngUrl = 'http://127.0.0.1:18080/static/emojis/emoji-01.png'
  const results = []

  // GIF → 文件格式
  try {
    await writeGifToClipboard(gifUrl)
    const check = await runPs(`
Add-Type -AssemblyName System.Windows.Forms
$d = [System.Windows.Forms.Clipboard]::GetDataObject()
$formats = $d.GetFormats() -join ','
$f = $d.GetData([System.Windows.Forms.DataFormats]::FileDrop)
"FORMATS|" + $formats + "|COUNT|" + $(if ($f) { $f.Count } else { 0 }) + "|FILE|" + $(if ($f -and $f.Count -gt 0) { $f[0] } else { 'NONE' })
`)
    const hasFileDrop = /FileDrop/.test(check)
    const hasFileNameW = /FileNameW/.test(check)
    const hasGif = /\.gif/i.test(check)
    results.push(['GIF-文件格式', `${check.slice(0, 160)}  => ${hasFileDrop && hasFileNameW && hasGif ? '✓ 微信/QQ 可识别为动图文件' : '✗ 缺少文件格式'}`])
  } catch (e) {
    results.push(['GIF-文件格式', '异常: ' + e.message])
  }

  // PNG → 仍是图片格式（回归）
  try {
    await writeImageToClipboard(pngUrl)
    const check = await runPs(`
Add-Type -AssemblyName System.Windows.Forms
$d = [System.Windows.Forms.Clipboard]::GetDataObject()
$formats = $d.GetFormats() -join ','
$f = $d.GetData([System.Windows.Forms.DataFormats]::FileDrop)
$img = $d.GetDataPresent([System.Windows.Forms.DataFormats]::Bitmap)
"FORMATS|" + $formats + "|HAS_IMG|" + $img + "|FILECOUNT|" + $(if ($f) { $f.Count } else { 0 })
`)
    const hasImg = /HAS_IMG\|True/.test(check)
    const noFile = /FILECOUNT\|0/.test(check)
    results.push(['PNG-图片格式', `${check.slice(0, 140)}  => ${hasImg && noFile ? '✓ 仍为图片格式（回归通过）' : '✗'}`])
  } catch (e) {
    results.push(['PNG-图片格式', '异常: ' + e.message])
  }

  console.log('=== GIF 动图剪贴板验证 ===')
  for (const [k, v] of results) console.log(`[${k}] ${v}`)
  app.exit(0)
}).catch((err) => {
  console.error('测试失败:', err)
  app.exit(2)
})
