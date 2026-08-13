/**
 * GIF 文件拖放剪贴板三种写入方式对比，用 Win32 DragQueryFile 直接读回验证：
 *  A. Electron writeBuffer + 手写 CF_HDROP 结构
 *  B. PowerShell Clipboard.SetFileDropList（系统标准）
 *  C. PowerShell DataObject：FileDrop + Bitmap 双格式
 * 运行：cd emo/frontend && npx electron ../tools/gif-clipboard-e2e.cjs
 */
const { app, clipboard } = require('electron')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const execFileAsync = promisify(execFile)

function buildHDrop(filePaths) {
  const utf16 = (s) => Buffer.from(s + '\0', 'utf16le')
  const parts = filePaths.map(utf16)
  let size = 20
  for (const b of parts) size += b.length
  size += 2
  const buf = Buffer.alloc(size)
  buf.writeUInt32LE(20, 0)
  buf.writeUInt32LE(0, 4)
  buf.writeUInt32LE(0, 8)
  buf.writeUInt32LE(0, 12)
  buf.writeUInt32LE(1, 16)
  let off = 20
  for (const b of parts) { b.copy(buf, off); off += b.length }
  return buf
}

async function runPs(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const { stdout } = await execFileAsync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout: 20000, windowsHide: true })
  return stdout.trim()
}

const CHECK_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class DropCheck {
  [DllImport("user32.dll")] public static extern bool OpenClipboard(IntPtr h);
  [DllImport("user32.dll")] public static extern bool CloseClipboard();
  [DllImport("user32.dll")] public static extern IntPtr GetClipboardData(uint f);
  [DllImport("user32.dll")] public static extern uint RegisterClipboardFormat(string n);
  [DllImport("shell32.dll")] public static extern uint DragQueryFile(IntPtr h, uint i, StringBuilder f, uint c);
  public static string Check() {
    uint fmt = RegisterClipboardFormat("CF_HDROP");
    if (!OpenClipboard(IntPtr.Zero)) return "OPEN_FAIL";
    IntPtr h = GetClipboardData(fmt);
    if (h == IntPtr.Zero) { CloseClipboard(); return "NO_HDROP"; }
    uint n = DragQueryFile(h, 0xFFFFFFFF, null, 0);
    var sb = new StringBuilder(512);
    if (n > 0) DragQueryFile(h, 0, sb, 512);
    CloseClipboard();
    return "COUNT=" + n + "|FILE=" + sb.ToString();
  }
}
"@
[DropCheck]::Check()
`

app.whenReady().then(async () => {
  const gifPath = path.join(os.tmpdir(), 'emoji-assistant', 'test-anim.gif')
  fs.mkdirSync(path.dirname(gifPath), { recursive: true })
  const http = require('node:http')
  await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:18080/static/emojis/real/bqb-01.gif', (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => { fs.writeFileSync(gifPath, Buffer.concat(chunks)); resolve() })
    }).on('error', reject)
  })
  const gp = gifPath.replace(/\\/g, '\\\\')

  const results = []

  // A. Electron writeBuffer + 手写 CF_HDROP
  clipboard.writeBuffer('CF_HDROP', buildHDrop([gifPath]))
  results.push(['A-手写CF_HDROP', await runPs(CHECK_PS)])

  // B. PowerShell SetFileDropList（系统标准）
  await runPs(`
Add-Type -AssemblyName System.Windows.Forms
$c = New-Object System.Collections.Specialized.StringCollection
$c.Add('${gp}')
[System.Windows.Forms.Clipboard]::SetFileDropList($c)
`)
  results.push(['B-SetFileDropList', await runPs(CHECK_PS)])

  // C. DataObject 双格式（FileDrop + Bitmap）
  await runPs(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$d = New-Object System.Windows.Forms.DataObject
$c = New-Object System.Collections.Specialized.StringCollection
$c.Add('${gp}')
$d.SetFileDropList($c)
$bmp = New-Object System.Drawing.Bitmap(120, 120)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::Magenta)
$d.SetData([System.Windows.Forms.DataFormats]::Bitmap, $bmp)
[System.Windows.Forms.Clipboard]::SetDataObject($d, $true)
$g.Dispose()
`)
  results.push(['C-双格式(FileDrop+Bitmap)', await runPs(CHECK_PS)])

  // 校验 C 的格式列表
  const fmt = await runPs(`
Add-Type -AssemblyName System.Windows.Forms
$d = [System.Windows.Forms.Clipboard]::GetDataObject()
($d.GetFormats() -join ',')
`)
  results.push(['C-格式列表', fmt.slice(0, 150)])

  console.log('=== GIF 剪贴板验证 ===')
  for (const [k, v] of results) console.log(`[${k}] ${v}`)
  app.exit(0)
}).catch((err) => {
  console.error('测试失败:', err)
  app.exit(2)
})
