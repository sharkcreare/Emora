import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ActiveWindowInfo } from '../shared/types'

const execFileAsync = promisify(execFile)

/** PowerShell 脚本编码为 UTF-16LE Base64，避免引号转义问题 */
function encodePs(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/** 运行一段 PowerShell，返回 stdout（去除首尾空白） */
export async function runPowerShell(script: string, timeoutMs = 8000): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePs(script)],
    { timeout: timeoutMs, windowsHide: true, windowsVerbatimArguments: false }
  )
  return stdout.trim()
}

/** 获取当前前台窗口的 PID 与标题；失败返回 null */
export async function getActiveWindow(): Promise<ActiveWindowInfo | null> {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinInfo {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  public static string Get() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "";
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    var sb = new StringBuilder(256);
    GetWindowText(h, sb, 256);
    return pid + "|" + sb.ToString();
  }
}
"@
[WinInfo]::Get()
`
  try {
    const out = await runPowerShell(script)
    const sep = out.indexOf('|')
    if (sep <= 0) return null
    const pid = Number(out.slice(0, sep))
    const title = out.slice(sep + 1)
    if (!Number.isFinite(pid) || pid <= 0) return null
    return { pid, title }
  } catch (err) {
    console.error('[active-window] 获取前台窗口失败:', err)
    return null
  }
}

/** 常见聊天软件进程名（激活目标不可见时按此兜底查找） */
const CHAT_PROCESS_NAMES = ['weixin', 'wechat', 'wechatappex', 'qq', 'tim', 'wxwork']

/** 查询指定 PID 的进程名（小写）；失败返回空串 */
export async function getProcessName(pid: number): Promise<string> {
  if (!Number.isFinite(pid) || pid <= 0) return ''
  try {
    const out = await runPowerShell(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName`)
    return (out || '').toLowerCase()
  } catch {
    return ''
  }
}

/** 获取指定 PID 主窗口的屏幕矩形（left/top/right/bottom）；找不到返回 null */
export async function getWindowRect(
  pid: number
): Promise<{ left: number; top: number; right: number; bottom: number } | null> {
  if (!Number.isFinite(pid) || pid <= 0) return null
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinRect {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
  static EnumWindowsProc _proc;
  static RECT _r;
  static bool _found;
  public static string Get(uint targetPid) {
    _found = false;
    _proc = delegate (IntPtr h, IntPtr l) {
      uint wpid;
      GetWindowThreadProcessId(h, out wpid);
      if (wpid == targetPid && IsWindowVisible(h)) {
        GetWindowRect(h, out _r);
        _found = true;
        return false;
      }
      return true;
    };
    EnumWindows(_proc, IntPtr.Zero);
    if (!_found) return "NONE";
    return _r.Left + "," + _r.Top + "," + _r.Right + "," + _r.Bottom;
  }
}
"@
[WinRect]::Get([uint32]${pid})
`
  try {
    const out = await runPowerShell(script, 5000)
    if (out === 'NONE' || !out.includes(',')) return null
    const [left, top, right, bottom] = out.split(',').map(Number)
    if (![left, top, right, bottom].every(Number.isFinite)) return null
    return { left, top, right, bottom }
  } catch (err) {
    console.error('[active-window] 获取窗口矩形失败:', err)
    return null
  }
}

/** 按进程名查找第一个可见主窗口并激活；成功返回其 PID，失败返回 0 */
export async function activateChatWindowByProcessName(): Promise<number> {
  const namesLiteral = CHAT_PROCESS_NAMES.map((n) => `"${n}"`).join(',')
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ChatFind {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder t, int c);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
  public static string[] NAMES = new string[] { ${namesLiteral} };
  public static string FindAndActivate() {
    IntPtr best = IntPtr.Zero;
    string bestInfo = "";
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      var proc = System.Diagnostics.Process.GetProcessById((int)pid);
      if (proc == null) return true;
      string pname = proc.ProcessName.ToLowerInvariant();
      for (int i = 0; i < NAMES.Length; i++) {
        if (pname == NAMES[i]) {
          var sb = new StringBuilder(256);
          GetWindowText(h, sb, 256);
          // 优先选有标题的（主窗口），其次任意可见窗口
          if (sb.Length > 0 || best == IntPtr.Zero) {
            best = h;
            bestInfo = pname + "|" + pid + "|" + sb.ToString();
          }
          break;
        }
      }
      return true;
    }, IntPtr.Zero);
    if (best == IntPtr.Zero) return "NONE";
    SetForegroundWindow(best);
    ShowWindow(best, 9); // SW_RESTORE：如果最小化则还原
    System.Threading.Thread.Sleep(200);
    return "OK|" + bestInfo;
  }
}
"@
[ChatFind]::FindAndActivate()
`
  try {
    const out = await runPowerShell(script, 8000)
    console.log('[active-window] 兜底查找聊天窗口:', out)
    if (!out.startsWith('OK')) return 0
    // 格式: OK|进程名|pid|标题
    const parts = out.split('|')
    const pid = Number(parts[2])
    return Number.isFinite(pid) ? pid : 0
  } catch (err) {
    console.error('[active-window] 兜底查找失败:', err)
    return 0
  }
}

/** 激活指定 PID 的窗口；成功返回 true（并校验前台窗口确实切换过去） */
export async function activateWindowByPid(pid: number): Promise<boolean> {
  if (!Number.isFinite(pid) || pid <= 0) return false
  // AttachThreadInput 把本线程挂到前台线程 + 模拟一次 ALT 键（解除 Windows 前台锁），
  // 否则 PowerShell 子进程调用 SetForegroundWindow 会被系统静默拒绝。最多重试 3 次。
  const script = `
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
      // ALT 键技巧：模拟一次 ALT 按键，让系统认为有用户输入，解除前台锁
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
  try {
    const out = await runPowerShell(script, 8000)
    console.log('[active-window] 激活结果:', out)
    return out === 'OK'
  } catch (err) {
    console.error('[active-window] 激活窗口失败:', err)
    return false
  }
}
