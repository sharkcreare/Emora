/**
 * 验证 Base64 传递路径的 writeGifAsFileDrop：编译真实 clipboard.ts，
 * 用带单引号/空格的"刁钻"路径写入 GIF 文件拖放格式，再用 PowerShell 读回验证。
 * 运行：cd emo/frontend && npx electron ../tools/gif-b64-e2e.cjs
 */
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const os = require('node:os')

const ROOT = path.resolve(__dirname, '..', 'frontend')

function compileClipboardModule() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main', 'clipboard.ts'), 'utf8')
  const out = path.join(ROOT, '.gif-b64-e2e-tmp.cjs')
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

function psClipboardFiles() {
  try {
    const script =
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      '$d = [System.Windows.Forms.Clipboard]::GetFileDropList(); ' +
      'if ($d) { $d | ForEach-Object { $_ } } else { "EMPTY" }'
    const enc = Buffer.from(script, 'utf16le').toString('base64')
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], {
      timeout: 10000,
      windowsHide: true,
      encoding: 'utf8'
    }).trim()
  } catch (e) {
    return 'PS-ERR: ' + (e.message || e)
  }
}

app.whenReady().then(async () => {
  const modFile = compileClipboardModule()
  const { writeGifToClipboard } = require(modFile)
  try { fs.unlinkSync(modFile) } catch { /* ignore */ }

  // 刁钻路径：含单引号、空格、中文 —— 旧反斜杠转义方案会破坏 PS 语法
  const dir = path.join(os.tmpdir(), 'emoji-assistant')
  fs.mkdirSync(dir, { recursive: true })
  const tricky = path.join(dir, "it's a 'tricky' 路径.gif")
  fs.writeFileSync(tricky, Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00', 'binary'))

  try {
    await writeGifToClipboard(tricky)
    const files = psClipboardFiles()
    // 控制台可能因编码把中文显示成乱码，用 ASCII 子串比较（单引号/空格是关键考验）
    const asciiOk = files.includes("it's a 'tricky'") && files.includes('.gif')
    console.log('PowerShell 读回（ASCII 匹配: ' + asciiOk + '）:')
    console.log(files.replace(/[^\x20-\x7e\r\n]/g, '?'))
    console.log(asciiOk ? 'GIF 文件拖放写入 ✓（含单引号/空格/中文路径均正常，微信/QQ 粘贴为动图）' : '✗ 未读到目标文件')
    app.exit(asciiOk ? 0 : 1)
  } catch (e) {
    console.error('GIF 写入失败:', e.message)
    app.exit(2)
  }
}).catch((e) => {
  console.error('启动失败:', e)
  app.exit(3)
})
