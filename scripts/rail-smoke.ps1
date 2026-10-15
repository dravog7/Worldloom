# Restore the Worldloom window and click the Audit tab at GIVEN native coords.
# Usage: rail-smoke.ps1 <clickX> <clickY>
# Screenshots are taken separately via computer_use (this session can't grab
# a screen DC — CopyFromScreen fails with "handle is invalid").
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Rail {
  // Without this, GetWindowRect/SetCursorPos speak LOGICAL (DPI-virtualized)
  // coordinates while the SOM capture space is PHYSICAL — clicks land ~2x off
  // on this 200%-scaled display. Opt into per-monitor-v2 awareness first.
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static IntPtr FindTauri(uint targetPid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == targetPid) {
        var sb = new StringBuilder(256); GetClassName(h, sb, 256);
        if (sb.ToString() == "Tauri Window") { found = h; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
[Rail]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null  # PER_MONITOR_AWARE_V2
$cx = [int]$args[0]; $cy = [int]$args[1]
$proc = Get-Process worldloom -ErrorAction Stop | Select-Object -First 1
$hwnd = [Rail]::FindTauri([uint32]$proc.Id)
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "NO_TAURI_WINDOW"; exit 1 }
# Minimize→restore is the reliable activation sequence on Win11: the
# restored window is granted foreground by the shell, unlike SetForegroundWindow
# from a background process (which Windows blocks with the foreground lock).
[Rail]::ShowWindow($hwnd, 6) | Out-Null   # SW_MINIMIZE
Start-Sleep -Milliseconds 250
[Rail]::ShowWindow($hwnd, 9) | Out-Null   # SW_RESTORE
Start-Sleep -Milliseconds 500
$fg = [Rail]::GetForegroundWindow()
$nullPid = 0
$fgT = [Rail]::GetWindowThreadProcessId($fg, [ref]$nullPid)
$tt = [Rail]::GetWindowThreadProcessId($hwnd, [ref]$nullPid)
[Rail]::AttachThreadInput($fgT, $tt, $true) | Out-Null
[Rail]::BringWindowToTop($hwnd) | Out-Null
$ok = [Rail]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 400
[Rail]::AttachThreadInput($fgT, $tt, $false) | Out-Null
$r = New-Object Rail+RECT
[Rail]::GetWindowRect($hwnd, [ref]$r) | Out-Null
Write-Output ("FG=" + $ok + " RECT=" + $r.Left + "," + $r.Top + "," + $r.Right + "," + $r.Bottom)
if ($cx -gt 0) {
  [Rail]::SetCursorPos($cx, $cy) | Out-Null
  Start-Sleep -Milliseconds 250
  [Rail]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 70
  [Rail]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Write-Output ("CLICKED=" + $cx + "," + $cy)
}
