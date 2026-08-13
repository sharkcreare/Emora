// 诊断版：完整链路 + 剪贴板读回 + 前台 PID 全程跟踪
const { app, BrowserWindow, clipboard } = require('electron')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)

const TEST_TEXT = 'DIAG-PASTE-' + Date.now()

async function runPs(script, timeoutMs = 8000) {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: timeoutMs, windowsHide: true }
  )
  return stdout.trim()
}

const ACTIVATE_SCRIPT = (pid) => `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinActivate {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
  const byte VK_MENU = 0x12;
  static EnumWindowsProc _proc;
  static IntPtr _found;
  static IntPtr FindByPidOnce(uint targetPid) {
    _found = IntPtr.Zero;
    _proc = delegate (IntPtr h, IntPtr l) {
      uint wpid;
      GetWindowThreadProcessId(h, out wpid);
      if (wpid == targetPid && IsWindowVisible(h)) { _found = h; return false; }
      return true;
    };
    EnumWindows(_proc, IntPtr.Zero);
    return _found;
  }
  public static bool Activate(uint targetPid) {
    IntPtr target = FindByPidOnce(targetPid);
    if (target == IntPtr.Zero) return false;
    for (int attempt = 0; attempt < 3; attempt++) {
      IntPtr fg = GetForegroundWindow();
      if (fg == target) return true;
      uint fgThread = 0, tgtThread = 0;
      if (fg != IntPtr.Zero) GetWindowThreadProcessId(fg, out fgThread);
      GetWindowThreadProcessId(target, out tgtThread);
      if (IsIconic(target)) ShowWindow(target, 9);
      bool attached = fgThread != 0 && fgThread != tgtThread && AttachThreadInput(fgThread, tgtThread, true);
      keybd_event(VK_MENU, 0, KEYEVENTF_EXTENDEDKEY, UIntPtr.Zero);
      keybd_event(VK_MENU, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, UIntPtr.Zero);
      SetForegroundWindow(target);
      ShowWindow(target, 5);
      if (attached) AttachThreadInput(fgThread, tgtThread, false);
      if (GetForegroundWindow() == target) return true;
      System.Threading.Thread.Sleep(150);
    }
    return GetForegroundWindow() == target;
  }
}
"@
if ([WinActivate]::Activate([uint32]${pid})) { "OK" } else { "FAIL" }
`

const FG_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  public static string Get() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "NONE";
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    return pid.ToString();
  }
}
"@
[Fg]::Get()
`

app.whenReady().then(async () => {
  let win = null
  try {
    win = new BrowserWindow({
      width: 500,
      height: 300,
      title: 'E2E-CHAT-WINDOW',
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    })
    await win.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="margin:0;background:#fff"><textarea id="box" style="width:100%;height:100%;border:none;font-size:16px"></textarea></body>'
        )
    )
    win.show()
    win.focus()
    await new Promise((r) => setTimeout(r, 1500))
    console.log('[diag] 目标窗口已创建, PID:', process.pid)

    clipboard.writeText(TEST_TEXT)
    console.log('[diag] 剪贴板已写入:', TEST_TEXT)

    await win.webContents.executeJavaScript("document.getElementById('box').focus()")
    await new Promise((r) => setTimeout(r, 300))

    const act = await runPs(ACTIVATE_SCRIPT(process.pid), 5000)
    console.log('[diag] 激活结果:', act)
    await new Promise((r) => setTimeout(r, 400))
    console.log('[diag] 激活后前台 PID:', await runPs(FG_SCRIPT), '目标:', process.pid)

    const cbBefore = clipboard.readText()
    console.log('[diag] 粘贴前剪贴板:', JSON.stringify(cbBefore))

    await runPs(
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')",
      5000
    )
    console.log('[diag] Ctrl+V 已发送')
    await new Promise((r) => setTimeout(r, 800))

    const val = await win.webContents.executeJavaScript("document.getElementById('box').value")
    console.log('[diag] 目标窗口内容:', JSON.stringify(val))
    console.log('[diag] 粘贴后前台 PID:', await runPs(FG_SCRIPT))
    if (val && val.includes(TEST_TEXT)) {
      console.log('[diag] RESULT: OK - 内容到达目标窗口')
    } else {
      console.log('[diag] RESULT: FAIL - 内容未到达, 期望:', TEST_TEXT)
    }
  } catch (e) {
    console.log('[diag] RESULT: FAIL -', e.message)
  } finally {
    try { win?.destroy() } catch { /* ignore */ }
    setTimeout(() => app.exit(0), 300)
  }
})
