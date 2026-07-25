# M6 gate: install the context menu, verify the keys, uninstall, and prove the
# registry ends up exactly as it started (GOALS.md DoD item 6).
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/test-menu.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $repoRoot "src-tauri\target\release\zapit.exe"
$work = Join-Path $env:TEMP "zapit-menu-test"
if (-not (Test-Path $exe)) { throw "Build first: npm run tauri build" }
New-Item -ItemType Directory -Force $work | Out-Null

$failures = 0
function Check($name, $ok, $detail = "") {
    if ($ok) { Write-Host "PASS  $name" -ForegroundColor Green }
    else { Write-Host "FAIL  $name $detail" -ForegroundColor Red; $script:failures++ }
}

function Export-Classes($path) {
    # reg.exe writes UTF-16; comparison happens on the parsed text.
    & reg.exe export "HKCU\Software\Classes" $path /y *> $null
    $lines = Get-Content $path -Encoding Unicode
    # Drop HKCU\Software\Classes\Local Settings\...: Windows keeps per-app
    # usage timestamps ("PCT") there and rewrites them on its own schedule, so
    # they churn between two exports regardless of what Zapit does.
    $kept = New-Object System.Collections.Generic.List[string]
    $skip = $false
    foreach ($line in $lines) {
        if ($line -match '^\[') { $skip = $line -like '*\Local Settings\*' }
        if (-not $skip) { $kept.Add($line) }
    }
    return $kept
}

# Start from a known state: if Zapit's menu is already registered (the installer
# registers it automatically), the baseline would include it and the final
# comparison would report our own correct cleanup as a difference.
Write-Host "clearing any existing menu first ..."
Start-Process $exe -ArgumentList "uninstall-menu" -Wait -WindowStyle Hidden

Write-Host "exporting baseline registry ..."
$before = Export-Classes (Join-Path $work "before.reg")

Write-Host "installing menu ..."
$p = Start-Process $exe -ArgumentList "install-menu" -PassThru -Wait `
    -RedirectStandardOutput (Join-Path $work "install.txt") `
    -RedirectStandardError (Join-Path $work "install-err.txt")
Check "install-menu exits 0" ($p.ExitCode -eq 0) "(exit $($p.ExitCode))"

# Spot-check a representative extension and the any-file class.
$mp4 = "HKCU:\Software\Classes\SystemFileAssociations\.mp4\shell\Zapit"
Check "video verb exists" (Test-Path $mp4)
if (Test-Path $mp4) {
    $props = Get-ItemProperty $mp4
    Check "MUIVerb is set" ($props.MUIVerb -eq "Zapit")
    Check "SubCommands present (flyout)" ($null -ne $props.SubCommands)
    $items = @(Get-ChildItem "$mp4\shell" -ErrorAction SilentlyContinue)
    Check "video actions registered" ($items.Count -ge 6) "(found $($items.Count))"
    $first = $items | Sort-Object Name | Select-Object -First 1
    if ($first) {
        $cmd = (Get-ItemProperty "$($first.PSPath)\command")."(default)"
        Check "command uses run <id> --file" ($cmd -match 'run [a-z0-9-]+ --file "%1"') "($cmd)"
        $msm = (Get-ItemProperty $first.PSPath -ErrorAction SilentlyContinue).MultiSelectModel
        Check "MultiSelectModel=Player on a multi-file action" ($msm -eq "Player")
    }
}
Check "any-file verb exists (checksum)" (Test-Path "HKCU:\Software\Classes\*\shell\Zapit")

# Preset flyouts (section 7.3): compress must offer choices, not silently pick one.
$compress = @(Get-ChildItem "$mp4\shell" -ErrorAction SilentlyContinue |
    Where-Object { $_.PSChildName -like "*compress-video" }) | Select-Object -First 1
if ($compress) {
    $sub = (Get-ItemProperty $compress.PSPath -ErrorAction SilentlyContinue).SubCommands
    Check "compress-video is a nested flyout" ($null -ne $sub)
    $choices = @(Get-ChildItem "$($compress.PSPath)\shell" -ErrorAction SilentlyContinue)
    Check "compress-video offers >= 6 presets" ($choices.Count -ge 6) "(found $($choices.Count))"
    $cmds = $choices | ForEach-Object { (Get-ItemProperty "$($_.PSPath)\command")."(default)" }
    Check "a size preset passes --opt targetMb" (($cmds -match '--opt targetMb=25').Count -ge 1)
    Check "a quality preset passes --opt quality" (($cmds -match '--opt quality=').Count -ge 1)
    Check "custom entry passes no options" (($cmds | Where-Object { $_ -notmatch '--opt' }).Count -ge 1)
    Check "every preset command ends with the file argument" `
        (($cmds | Where-Object { $_ -notmatch '--file "%1"$' }).Count -eq 0)
} else {
    Check "compress-video entry exists" $false
}

Write-Host "re-installing (idempotency) ..."
$p2 = Start-Process $exe -ArgumentList "install-menu" -PassThru -Wait `
    -RedirectStandardOutput (Join-Path $work "install2.txt") -RedirectStandardError (Join-Path $work "install2-err.txt")
Check "second install-menu exits 0" ($p2.ExitCode -eq 0)
$afterTwice = Export-Classes (Join-Path $work "twice.reg")

Write-Host "uninstalling menu ..."
$p3 = Start-Process $exe -ArgumentList "uninstall-menu" -PassThru -Wait `
    -RedirectStandardOutput (Join-Path $work "uninstall.txt") -RedirectStandardError (Join-Path $work "uninstall-err.txt")
Check "uninstall-menu exits 0" ($p3.ExitCode -eq 0)
Check "video verb removed" (-not (Test-Path $mp4))
Check "any-file verb removed" (-not (Test-Path "HKCU:\Software\Classes\*\shell\Zapit"))

Write-Host "uninstalling again (idempotency) ..."
$p4 = Start-Process $exe -ArgumentList "uninstall-menu" -PassThru -Wait `
    -RedirectStandardOutput (Join-Path $work "uninstall2.txt") -RedirectStandardError (Join-Path $work "uninstall2-err.txt")
Check "second uninstall-menu exits 0" ($p4.ExitCode -eq 0)

$after = Export-Classes (Join-Path $work "after.reg")
$diff = @(Compare-Object $before $after)
Check "registry diff is empty" ($diff.Count -eq 0) "($($diff.Count) differing lines)"
if ($diff.Count -gt 0) {
    $diff | Select-Object -First 20 | ForEach-Object { "    $($_.SideIndicator) $($_.InputObject)" } | Write-Host
}

if ($failures -gt 0) {
    Write-Host "$failures failure(s)" -ForegroundColor Red
    exit 1
}
Write-Host "menu: all green" -ForegroundColor Green
