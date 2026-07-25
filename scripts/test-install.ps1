# M7 gate: silently install the built NSIS package, prove the installed copy
# works (bundled sidecars, unicode filenames), then uninstall and prove nothing
# is left behind - app files or registry keys (GOALS.md DoD items 6 and 8).
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/test-install.ps1
#
# Note: this runs on the DEV machine. The Definition of Done also requires a
# pass on a clean Windows 11 machine - see docs/TEST_MATRIX.md.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$setup = Get-ChildItem (Join-Path $repoRoot "src-tauri\target\release\bundle\nsis") -Filter "*-setup.exe" |
    Select-Object -First 1
if (-not $setup) { throw "Build the installer first: npm run tauri build" }

# NSIS remembers where it last installed, so the location is NOT guaranteed to
# be %LOCALAPPDATA%\Zapit. Read it back from the uninstall entry instead of
# assuming, or the test fails on any machine that installed elsewhere before.
function Get-InstallDir {
    $key = Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue |
        Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like "Zapit*" } |
        Select-Object -First 1
    if ($key) {
        $loc = (Get-ItemProperty $key.PSPath).InstallLocation
        if ($loc) { return $loc.Trim('"') }
    }
    return (Join-Path $env:LOCALAPPDATA "Zapit")
}

$installDir = Get-InstallDir
$work = Join-Path $env:TEMP "zapit-install-test"
if (Test-Path $work) { Remove-Item -Recurse -Force $work -Confirm:$false }
New-Item -ItemType Directory -Force $work | Out-Null

$failures = 0
function Check($name, $ok, $detail = "") {
    if ($ok) { Write-Host "PASS  $name" -ForegroundColor Green }
    else { Write-Host "FAIL  $name $detail" -ForegroundColor Red; $script:failures++ }
}

Write-Host ("installer size: {0:N1} MB" -f ($setup.Length / 1MB))
Check "installer <= 100 MB (GOALS.md release target)" ($setup.Length -le 100MB)

if (Test-Path $installDir) {
    Write-Host "removing a previous install first ..."
    $old = Join-Path $installDir "uninstall.exe"
    if (Test-Path $old) { Start-Process $old -ArgumentList "/S" -Wait; Start-Sleep -Seconds 4 }
}

& reg.exe export "HKCU\Software\Classes" (Join-Path $work "before.reg") /y *> $null

Write-Host "installing silently ..."
$p = Start-Process $setup.FullName -ArgumentList "/S" -PassThru -Wait
Check "installer exits 0" ($p.ExitCode -eq 0) "(exit $($p.ExitCode))"
Start-Sleep -Seconds 4

# Re-read: a fresh install may have landed somewhere other than where we looked.
$installDir = Get-InstallDir
Write-Host "installed to: $installDir"
$exe = Join-Path $installDir "zapit.exe"
Check "app installed per-user (no admin)" (Test-Path $exe)
Check "sidecars bundled" (Test-Path (Join-Path $installDir "sidecars\ffmpeg.exe"))
Check "context menu registered by the installer hook" `
    (Test-Path "HKCU:\Software\Classes\SystemFileAssociations\.mp4\shell\Zapit")

# Exercise the installed copy: unicode filename + a sidecar-heavy action.
$assets = Join-Path $repoRoot "test\assets"
$unicodeSource = (Get-ChildItem $assets -Filter "*(final) 2.mp4" | Select-Object -First 1).FullName
Copy-Item $unicodeSource (Join-Path $work "clip.mp4") -Force
$unicodeName = Split-Path $unicodeSource -Leaf
Copy-Item $unicodeSource (Join-Path $work $unicodeName) -Force
Copy-Item (Join-Path $assets "photo.jpg") (Join-Path $work "photo.jpg") -Force

function Run-Installed($name, $arguments, $expected) {
    $p = Start-Process $exe -ArgumentList $arguments -PassThru -Wait `
        -RedirectStandardOutput (Join-Path $work "$name.out") `
        -RedirectStandardError (Join-Path $work "$name.err")
    $found = @(Get-ChildItem $work -Filter $expected -ErrorAction SilentlyContinue)
    Check $name (($p.ExitCode -eq 0) -and ($found.Count -gt 0)) "(exit $($p.ExitCode))"
}

Run-Installed "installed-extract-audio-unicode" `
    @("smoke", "extract-audio", "--file", "`"$work\$unicodeName`"", "--out", "`"$work`"") "*(final) 2.m4a"
Run-Installed "installed-compress-image" `
    @("smoke", "compress-image", "--file", "`"$work\photo.jpg`"", "--opt", "targetKb=50", "--out", "`"$work`"") "photo (50KB).jpg"

# Collision safety: the same job twice must not overwrite.
Run-Installed "installed-no-overwrite" `
    @("smoke", "extract-audio", "--file", "`"$work\clip.mp4`"", "--out", "`"$work`"") "clip.m4a"
Run-Installed "installed-no-overwrite-2" `
    @("smoke", "extract-audio", "--file", "`"$work\clip.mp4`"", "--out", "`"$work`"") "clip (2).m4a"

Check "no temp garbage left behind" `
    (@(Get-ChildItem (Join-Path $env:TEMP "zapit") -Directory -ErrorAction SilentlyContinue).Count -eq 0)

Write-Host "uninstalling silently ..."
$u = Start-Process (Join-Path $installDir "uninstall.exe") -ArgumentList "/S" -PassThru -Wait
Check "uninstaller exits 0" ($u.ExitCode -eq 0)
Start-Sleep -Seconds 5

Check "app directory removed" (-not (Test-Path $installDir))
Check "menu keys removed" (-not (Test-Path "HKCU:\Software\Classes\SystemFileAssociations\.mp4\shell\Zapit"))
Check "any-file key removed" (-not (Test-Path "HKCU:\Software\Classes\*\shell\Zapit"))

& reg.exe export "HKCU\Software\Classes" (Join-Path $work "after.reg") /y *> $null
function Read-Filtered($path) {
    # Skip HKCU\...\Local Settings\: Windows churns per-app usage timestamps
    # there on its own schedule (see scripts/test-menu.ps1).
    $kept = New-Object System.Collections.Generic.List[string]
    $skip = $false
    foreach ($line in (Get-Content $path -Encoding Unicode)) {
        if ($line -match '^\[') { $skip = $line -like '*\Local Settings\*' }
        if (-not $skip) { $kept.Add($line) }
    }
    return $kept
}
$diff = @(Compare-Object (Read-Filtered (Join-Path $work "before.reg")) (Read-Filtered (Join-Path $work "after.reg")))
Check "registry identical to before the install" ($diff.Count -eq 0) "($($diff.Count) lines)"
if ($diff.Count -gt 0) {
    $diff | Select-Object -First 15 | ForEach-Object { "    $($_.SideIndicator) $($_.InputObject)" } | Write-Host
}

if ($failures -gt 0) {
    Write-Host "$failures failure(s)" -ForegroundColor Red
    exit 1
}
Write-Host "install/uninstall: all green" -ForegroundColor Green
