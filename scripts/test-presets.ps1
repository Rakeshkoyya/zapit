# Exercises EVERY context-menu entry the user can actually click.
#
# It installs the menu, reads the real command lines back out of the registry,
# and runs each one headlessly against a test file of the matching type. This
# is the closest thing to "right-click everything and check it works" that can
# run unattended - and it caught the bug where "Compress video" silently
# targeted 25 MB because no menu entry ever passed an option.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/test-presets.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $repoRoot "src-tauri\target\release\zapit.exe"
$assets = Join-Path $repoRoot "test\assets"
$outRoot = Join-Path $env:TEMP "zapit-preset-sweep"

if (-not (Test-Path $exe)) { throw "Build first: npm run tauri build" }
if (-not (Test-Path (Join-Path $assets "tiny.mp4"))) {
    throw "Test fixtures missing. Run: powershell -File scripts/make-test-assets.ps1"
}
if (Test-Path $outRoot) { Remove-Item -Recurse -Force $outRoot -Confirm:$false }
New-Item -ItemType Directory -Force $outRoot | Out-Null

# One representative source file per registered extension.
$sampleFor = @{
    "mp4" = "tiny.mp4"; "mkv" = "tiny-vfr.mkv"; "mov" = "tiny.mp4"; "avi" = "tiny.mp4"
    "webm" = "tiny.mp4"; "wmv" = "tiny.mp4"; "flv" = "tiny.mp4"; "ts" = "tiny.mp4"
    "m4v" = "tiny.mp4"; "mts" = "tiny.mp4"; "3gp" = "tiny.mp4"; "gif" = "sample.gif"
    "mp3" = "tone.mp3"; "wav" = "tone.wav"; "flac" = "tone.flac"; "m4a" = "tone.m4a"
    "aac" = "tone.m4a"; "ogg" = "tone.ogg"; "opus" = "tone.opus"; "wma" = "tone.mp3"
    "png" = "alpha.png"; "jpg" = "photo.jpg"; "jpeg" = "photo.jpg"; "webp" = "photo.webp"
    "bmp" = "photo.bmp"; "tiff" = "photo.tiff"; "heic" = "sample.heic"; "heif" = "sample.heic"
    "svg" = "vector.svg"; "pdf" = "mixed.pdf"; "" = "tiny.mp4"
}

# Derive the extra fixtures the sweep needs from the ones we already generate.
$ff = Join-Path $repoRoot "src-tauri\sidecars\ffmpeg.exe"
$magick = Join-Path $repoRoot "src-tauri\sidecars\magick.exe"
$derived = Join-Path $outRoot "_fixtures"
New-Item -ItemType Directory -Force $derived | Out-Null
function Need($name, $build) {
    $path = Join-Path $assets $name
    if (-not (Test-Path $path)) { & $build $path }
    return $path
}
Need "tone.wav"  { param($p) & $ff -hide_banner -loglevel error -y -i (Join-Path $assets "tone.mp3") -c:a pcm_s16le $p } | Out-Null
Need "tone.m4a"  { param($p) & $ff -hide_banner -loglevel error -y -i (Join-Path $assets "tone.mp3") -c:a aac $p } | Out-Null
Need "tone.ogg"  { param($p) & $ff -hide_banner -loglevel error -y -i (Join-Path $assets "tone.mp3") -c:a libvorbis $p } | Out-Null
Need "tone.opus" { param($p) & $ff -hide_banner -loglevel error -y -i (Join-Path $assets "tone.mp3") -c:a libopus $p } | Out-Null
Need "photo.webp" { param($p) & $magick (Join-Path $assets "photo.jpg") -resize 800x $p } | Out-Null
Need "photo.bmp"  { param($p) & $magick (Join-Path $assets "photo.jpg") -resize 400x $p } | Out-Null
Need "photo.tiff" { param($p) & $magick (Join-Path $assets "photo.jpg") -resize 400x $p } | Out-Null
Need "sample.gif" { param($p) & $ff -hide_banner -loglevel error -y -i (Join-Path $assets "tiny.mp4") -vf "fps=8,scale=160:-2" -t 2 $p } | Out-Null

Write-Host "installing menu to read real command lines ..."
Start-Process $exe -ArgumentList "install-menu" -Wait -WindowStyle Hidden

# Walk every verb key we own and collect (extension, label, commandline).
#
# Items sit directly under the file-class verb: `…\shell\Zapit` carries
# `SubCommands=""` plus its own `shell` subkey. That is the ONLY cascading form
# Explorer honours under SystemFileAssociations — `ExtendedSubCommandsKey` is
# silently ignored there. Exactly one verb per action and no preset children: a
# preset used to be a verb too, and Explorer honours only ~16 per class, which
# truncated the menu after four entries. See src-tauri/src/registry_menu.rs.
$entries = New-Object System.Collections.Generic.List[object]

function CollectVerb($verbPath, $extension) {
    $shellPath = Join-Path $verbPath "shell"
    foreach ($item in @(Get-ChildItem -LiteralPath $shellPath -ErrorAction SilentlyContinue)) {
        $label = (Get-ItemProperty -LiteralPath $item.PSPath -ErrorAction SilentlyContinue).MUIVerb
        $cmd = (Get-ItemProperty -LiteralPath (Join-Path $item.PSPath "command") -ErrorAction SilentlyContinue)."(default)"
        if ($cmd) { $entries.Add([PSCustomObject]@{ Ext = $extension; Label = $label; Cmd = $cmd }) }
    }
}

foreach ($assoc in @(Get-ChildItem "HKCU:\Software\Classes\SystemFileAssociations" -ErrorAction SilentlyContinue)) {
    $verb = Join-Path $assoc.PSPath "shell\Zapit"
    if (-not (Test-Path -LiteralPath $verb)) { continue }
    CollectVerb $verb ($assoc.PSChildName.TrimStart("."))
}
# `*` is a literal key name here, not a wildcard, hence -LiteralPath throughout.
# Same verb name as the per-extension classes on purpose: Explorer dedupes by
# key name, and a distinct name puts two "Zapit" entries in the menu.
$anyVerb = "HKCU:\Software\Classes\*\shell\Zapit"
if (Test-Path -LiteralPath $anyVerb) { CollectVerb $anyVerb "" }

Write-Host "found $($entries.Count) clickable menu entries`n"

# A sweep that finds nothing must never report success. The registry layout has
# already moved once under this script (items went into their own classes to
# dodge the per-class verb ceiling), and the previous version cheerfully printed
# "all green" having tested exactly zero entries.
if ($entries.Count -eq 0) {
    Start-Process $exe -ArgumentList "uninstall-menu" -Wait -WindowStyle Hidden
    throw "No menu entries found. The registry layout this script walks has changed - fix the walk before trusting this sweep."
}

# Actions that combine several files can't be driven with a single %1.
$multiOnly = @("merge-pdf", "merge-videos", "merge-audio", "images-to-pdf")

$pass = 0; $fail = 0; $skipped = 0
$failures = New-Object System.Collections.Generic.List[string]

foreach ($e in $entries) {
    if ($e.Cmd -notmatch 'run\s+([a-z0-9-]+)') { continue }
    $actionId = $Matches[1]
    $opts = [regex]::Matches($e.Cmd, '--opt\s+(\S+)') | ForEach-Object { $_.Groups[1].Value }

    $sampleName = $sampleFor[$e.Ext]
    $sample = if ($sampleName) { Join-Path $assets $sampleName } else { $null }
    if (-not $sample -or -not (Test-Path $sample)) {
        Write-Host "SKIP  [$($e.Ext)] $($e.Label) - no sample file" -ForegroundColor DarkGray
        $skipped++; continue
    }
    if ($multiOnly -contains $actionId) {
        Write-Host "SKIP  [$($e.Ext)] $($e.Label) - needs multiple files" -ForegroundColor DarkGray
        $skipped++; continue
    }
    if ($opts.Count -eq 0 -and $actionId -in @("compress-video","compress-image","compress-pdf","resize-image","split-pdf","trim-video","trim-audio","protect-pdf","unlock-pdf","view-metadata","extract-frame")) {
        # The "Custom..."/window entries: correct behaviour is to prompt, which
        # cannot happen unattended. Verified separately by the unit tests.
        Write-Host "SKIP  [$($e.Ext)] $($e.Label) - opens a window by design" -ForegroundColor DarkGray
        $skipped++; continue
    }

    $out = Join-Path $outRoot ("{0}_{1}" -f $e.Ext, ($actionId + "_" + ($opts -join "_"))).Replace("=", "-")
    New-Item -ItemType Directory -Force $out | Out-Null
    $argv = @("smoke", $actionId)
    foreach ($o in $opts) { $argv += @("--opt", $o) }
    $argv += @("--file", "`"$sample`"", "--out", "`"$out`"")

    # Capture logs under names no action can produce, so a legitimate .txt
    # output (Extract text) is not mistaken for our own log file.
    $logOut = Join-Path $out "_sweep-stdout.log"
    $p = Start-Process $exe -ArgumentList $argv -PassThru -Wait `
        -RedirectStandardOutput $logOut -RedirectStandardError (Join-Path $out "_sweep-stderr.log")
    $produced = @(Get-ChildItem $out -File | Where-Object { $_.Name -notlike "_sweep-*" -and $_.Length -gt 0 })
    $stdout = (Get-Content $logOut -Raw -ErrorAction SilentlyContinue)

    # -Raw usually yields one string, but not always; joining first keeps this
    # total, because a .Trim() on an Object[] aborts the whole sweep.
    $reason = ((@($stdout) -join " ") -replace "`r`n", " ").Trim()
    $label = "[$($e.Ext)] $($e.Label)"

    # Checksum's whole output IS the hash on stdout - it writes no file, so
    # "produced nothing" is success for it and failure for everything else.
    $reportsOnStdout = $actionId -eq "checksum"

    if ($p.ExitCode -eq 0 -and ($produced.Count -gt 0 -or $reportsOnStdout)) {
        Write-Host "PASS  $label" -ForegroundColor Green
        $pass++
    } elseif ($reason -match "already |has no audio|No text found|doesn't look like|too small|can't be remuxed|Choose ") {
        # A deliberate, explained refusal is correct behaviour for this sample.
        Write-Host "OK-REFUSED  $label" -ForegroundColor DarkYellow
        $pass++
    } else {
        Write-Host "FAIL  $label" -ForegroundColor Red
        Write-Host "        $reason" -ForegroundColor Red
        $failures.Add("$label :: $reason")
        $fail++
    }
}

Write-Host "`nremoving the test menu ..."
Start-Process $exe -ArgumentList "uninstall-menu" -Wait -WindowStyle Hidden

Write-Host "`n$pass passed, $fail failed, $skipped skipped (of $($entries.Count) entries)"
if ($fail -gt 0) {
    Write-Host "`nFailures:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    exit 1
}
Write-Host "presets: all green" -ForegroundColor Green
