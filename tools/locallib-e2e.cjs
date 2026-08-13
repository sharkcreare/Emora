/**
 * 本地文件夹托管 e2e：编译真实 locallib + ipc 相关模块，
 * 验证：扫描 → locallib:// 协议读取 → 点击复制（本地路径分支）→ 忽略名单。
 * 运行：cd emo/frontend && npx electron ../tools/locallib-e2e.cjs
 */
const { app, protocol } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', 'frontend')

function compileModule(rel, outName) {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const src = fs.readFileSync(path.join(ROOT, 'electron', rel), 'utf8')
  const out = path.join(ROOT, 'out', 'main', outName)
  // resolveDir 用文件所在目录，保证相对导入（./scanner 等）解析正确
  esbuild.buildSync({
    stdin: { contents: src, loader: 'ts', sourcefile: rel, resolveDir: path.join(ROOT, 'electron', path.dirname(rel)) },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron']
  })
  return out
}

/** PowerShell 读剪贴板文件列表（验证 FileDrop） */
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
  // 编译真实模块（必须带 initLocallib 的配置读写 + 协议注册）
  const libFile = compileModule('main/locallib/index.ts', 'e2e-locallib.cjs')
  const lib = require(libFile)
  try { fs.unlinkSync(libFile) } catch { /* ignore */ }

  // 准备测试文件夹：根目录 + 子目录 + 忽略测试文件 + 非图片
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emoji-assistant-locallib-e2e-'))
  fs.writeFileSync(path.join(testDir, '狗头.png'), 'not-really-png-buffer')
  fs.writeFileSync(path.join(testDir, '熊猫.gif'), 'GIF89a\x01\x00\x01\x00\x80\x00\x00')
  fs.mkdirSync(path.join(testDir, '子目录'))
  fs.writeFileSync(path.join(testDir, '子目录', '震惊猫.jpg'), 'fake-jpg')
  fs.writeFileSync(path.join(testDir, 'readme.txt'), 'not an image')
  fs.writeFileSync(path.join(testDir, '要忽略.png'), 'x')

  // 1. 编译 scanner 独立模块
  const scanFile = compileModule('main/locallib/scanner.ts', 'e2e-locallib-scanner.cjs')
  const { scanFolder, locallibUrl, locallibPath } = require(scanFile)
  try { fs.unlinkSync(scanFile) } catch { /* ignore */ }

  // 2. 协议注册（真实注册 locallib://）
  lib.registerLocallibProtocolSafe()

  // 3. 扫描
  const ignored = new Set([path.join(testDir, '要忽略.png')])
  const files = scanFolder(testDir, ignored)
  const names = files.map((f) => f.name).sort()
  console.log('扫描结果:', names.join(', '))
  const scanOk = names.includes('狗头') && names.includes('熊猫') && names.includes('震惊猫') && !names.includes('readme') && !names.includes('要忽略')
  console.log(scanOk ? '扫描/过滤/忽略 ✓' : '✗ 扫描异常')

  // 4. locallib:// 协议读取（真实协议 handler：fetch locallib:// 应返回图片内容）
  const imgFile = files.find((f) => f.name === '熊猫')
  const url = imgFile.url
  console.log('协议地址:', url)
  const decodedPath = locallibPath(url)
  console.log('还原路径:', decodedPath === imgFile.localPath ? '✓' : '✗ ' + decodedPath)
  let protoOk = decodedPath === imgFile.localPath
  try {
    const { net } = require('electron')
    const res = await net.fetch(url, { bypassCustomProtocolHandlers: false })
    const buf = Buffer.from(await res.arrayBuffer())
    const ok = res.status === 200 && buf.length > 0 && buf.slice(0, 6).toString('ascii') === 'GIF89a'
    console.log('协议读取:', ok ? `✓ 200, ${buf.length}B, GIF 魔数正确` : `✗ HTTP ${res.status} ${buf.length}B`)
    protoOk = protoOk && ok
  } catch (e) {
    console.log('协议读取: ✗ ' + e.message)
    protoOk = false
  }

  // 5. 点击复制（本地路径分支 → GIF FileDrop）
  //    中文路径 PowerShell 回读会乱码，用 ASCII 文件名的 GIF 验证复制链路
  const asciiGif = path.join(testDir, 'ascii-copy-test.gif')
  fs.writeFileSync(asciiGif, 'GIF89a\x01\x00\x01\x00\x80\x00\x00')
  const clipboardMod = compileModule('main/clipboard.ts', 'e2e-locallib-clipboard.cjs')
  const { writeGifToClipboard } = require(clipboardMod)
  try { fs.unlinkSync(clipboardMod) } catch { /* ignore */ }
  await writeGifToClipboard(asciiGif)
  const clip = psClipboardFiles()
  const clipOk = clip.includes('ascii-copy-test.gif')
  console.log('剪贴板 FileDrop 读回:', clipOk ? '✓ 包含目标文件' : '✗ ' + clip.replace(/[^\x20-\x7e]/g, '?'))

  // 6. 忽略名单 + 状态
  const state1 = lib.getLocallibState()
  console.log('初始状态: folders=' + state1.folders.length + ' files=' + state1.files.length)

  const allOk = scanOk && protoOk && clipOk
  console.log(allOk ? '\n本地文件夹托管 e2e 全部通过 ✓' : '\n存在失败项 ✗')
  app.exit(allOk ? 0 : 1)
}).catch((e) => {
  console.error('e2e 失败:', e)
  app.exit(2)
})
