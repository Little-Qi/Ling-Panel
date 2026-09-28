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
