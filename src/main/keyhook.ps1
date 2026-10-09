# LingPanel global key counter (count only, no key content)
# Low-level keyboard hook requires a message pump
param(
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Stop'

$src = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class LingKeyHook {
  private static IntPtr _hook = IntPtr.Zero;
  private static int _count;
  private static string _path = "";
  private static int _lastFlushMs;
  private delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);
  private static LowLevelProc _proc;

  private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0) {
      int msg = wParam.ToInt32();
      if (msg == 0x100 || msg == 0x104) {
        Interlocked.Increment(ref _count);
        MaybeFlush();
      }
    }
    return CallNextHookEx(_hook, nCode, wParam, lParam);
  }

  private static void MaybeFlush() {
    int now = Environment.TickCount;
    if ((now - _lastFlushMs) < 400) return;
    _lastFlushMs = now;
    Flush();
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);

  [DllImport("user32.dll")]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr GetModuleHandle(string lpModuleName);

  [StructLayout(LayoutKind.Sequential)]
  public struct NativeMessage {
    public IntPtr handle;
    public uint msg;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int ptX;
    public int ptY;
  }

  [DllImport("user32.dll")]
  private static extern int GetMessage(out NativeMessage lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

  [DllImport("user32.dll")]
  private static extern bool TranslateMessage(ref NativeMessage lpMsg);

  [DllImport("user32.dll")]
  private static extern IntPtr DispatchMessage(ref NativeMessage lpMsg);

  [DllImport("user32.dll")]
  private static extern void PostQuitMessage(int nExitCode);

  public static void Start(string path) {
    _path = path;
    // The counter must survive process restarts.
    // This hook is respawned whenever the file goes stale (e.g. after sleep),
    // and a fresh process would start at 0 and write that back to the file,
    // wiping both the running total and the reader's baseline.
    // Resume from the existing file so the count stays monotonic.
    // NOTE: keep this block ASCII-only. The C# lives in a PowerShell here-string,
    // and PowerShell 5.1 decodes BOM-less .ps1 as ANSI/GBK on zh-CN systems,
    // so non-ASCII bytes here break the compile.
    try {
      if (File.Exists(path)) {
        string raw = File.ReadAllText(path).Trim();
        int v;
        if (int.TryParse(raw, out v)) {
          _count = v;
        } else {
          // legacy shape: {"count":N}
          int idx = raw.IndexOf("\"count\"");
          if (idx >= 0) {
            int start = raw.IndexOf(':', idx) + 1;
            int end = raw.IndexOfAny(new char[] { ',', '}' }, start);
            if (start > 0 && end > start && int.TryParse(raw.Substring(start, end - start).Trim(), out v)) {
              _count = v;
            }
          }
        }
      }
    } catch {}
    _proc = HookCallback;
    using (Process cur = Process.GetCurrentProcess()) {
      using (ProcessModule m = cur.MainModule) {
        _hook = SetWindowsHookEx(13, _proc, GetModuleHandle(m.ModuleName), 0);
      }
    }
    try {
      File.WriteAllText(_path + ".status", (_hook == IntPtr.Zero ? "hook-fail" : "hook-ok"));
    } catch {}
    Flush();
  }

  public static void Pump() {
    NativeMessage msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
      TranslateMessage(ref msg);
      DispatchMessage(ref msg);
    }
  }

  public static void QuitPump() {
    PostQuitMessage(0);
  }

  public static void Flush() {
    if (string.IsNullOrEmpty(_path)) return;
    try {
      int c = Interlocked.CompareExchange(ref _count, 0, 0);
      File.WriteAllText(_path, c.ToString());
    } catch {}
  }

  public static void Stop() {
    try {
      if (_hook != IntPtr.Zero) UnhookWindowsHookEx(_hook);
    } catch {}
    Flush();
    _hook = IntPtr.Zero;
  }
}
'@

Add-Type -TypeDefinition $src -ErrorAction Stop
[LingKeyHook]::Start($OutFile)

try {
  [LingKeyHook]::Pump()
} finally {
  [LingKeyHook]::Stop()
}
