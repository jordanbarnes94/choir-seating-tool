<#
  Opens the desktop app, clicks its Manual link twice and says what the manual's window showed
  each time. It is a tool, not a test: it needs Windows and a built or installed copy of the app.

    pwsh tools/desktop-manual-check.ps1 [-Exe <path to Choir Seating Tool.exe>]

  The default is the debug build (`npx tauri build --debug --no-bundle`). A downloaded
  Choir-Seating-Tool.exe or an installed copy works the same way.

  The web view is pointed at a throwaway folder, so real work is never touched. The app is
  started without CHOIR_SEATING_BROWSER_ARGS: with a remote debugging port the fault this looks
  for does not show.
#>
param([string]$Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\debug\Choir Seating Tool.exe'))

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class ChoirWindows {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  public static List<string> Titles(uint pid) {
    var found = new List<string>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) { var s = new StringBuilder(300); GetWindowText(h, s, 300); if (s.Length > 0) found.Add(s.ToString()); }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

if (-not (Test-Path $Exe)) { throw "No app at $Exe" }
$Exe = (Resolve-Path $Exe).Path

# The manual's window is the one that is neither the app's nor a console's.
function ManualWindow($id) {
  $titles = [ChoirWindows]::Titles([uint32]$id) | Where-Object { $_ -ne 'Choir Seating Tool' -and $_ -ne $Exe }
  if ($titles) { $titles -join ' || ' } else { '(no window)' }
}

$listening = [bool](Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue)
"Something is listening on port 80 here: $listening"

$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $env:TEMP ('choir-wv-' + [guid]::NewGuid().ToString('N'))
Remove-Item Env:CHOIR_SEATING_BROWSER_ARGS -ErrorAction SilentlyContinue
$app = Start-Process -FilePath $Exe -PassThru
try {
  $isManualLink = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Hyperlink)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Manual')))
  $link = $null
  for ($i = 0; $i -lt 40 -and -not $link; $i++) {
    Start-Sleep -Milliseconds 750
    $app.Refresh()
    if ($app.MainWindowHandle -eq 0) { continue }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
    $link = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $isManualLink)
  }
  if (-not $link) { throw 'The Manual link in the footer was not found' }
  $click = $link.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)

  # The first click makes the window. The second finds it there and sends it to the page.
  $click.Invoke(); Start-Sleep -Seconds 4
  $first = ManualWindow $app.Id
  $click.Invoke(); Start-Sleep -Seconds 4
  $second = ManualWindow $app.Id

  "After the first click:  $first"
  "After the second click: $second"
  if ($first -like '*Manual*') { 'The manual opened first time.' } else { 'The manual did NOT open first time.' }
} finally {
  Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
}
