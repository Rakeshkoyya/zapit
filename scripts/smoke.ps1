# Headless smoke harness (section 12): runs real conversions over test/assets through
# the release exe and asserts outputs exist and probe cleanly.
#
# Usage:
#   powershell -File scripts/smoke.ps1            # quick suite (small assets)
#   powershell -File scripts/smoke.ps1 -Heavy     # + >2 GB stream-copy and cancel tests
#
# Requires: a built release exe (npm run tauri build) and fetched sidecars.

param([switch]$Heavy)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $repoRoot "src-tauri\target\release\zapit.exe"
$ffprobe = Join-Path $repoRoot "src-tauri\sidecars\ffprobe.exe"
$assets = Join-Path $repoRoot "test\assets"
$outRoot = Join-Path $env:TEMP "zapit-smoke"

if (-not (Test-Path $exe)) { throw "Build first: npm run tauri build" }
if (-not (Test-Path (Join-Path $assets "tiny.mp4"))) {
    throw "Test fixtures missing. Run: powershell -File scripts/make-test-assets.ps1"
}
if (Test-Path $outRoot) { Remove-Item -Recurse -Force $outRoot -Confirm:$false }
New-Item -ItemType Directory -Force $outRoot | Out-Null

$script:failures = 0

function Invoke-Smoke {
    param([string]$Name, [string[]]$Arguments, [string[]]$ExpectOutputs, [switch]$ExpectFail)
    $out = Join-Path $outRoot $Name
    New-Item -ItemType Directory -Force $out | Out-Null
    $quoted = $Arguments + @("--out", "`"$out`"")
    $stdout = Join-Path $out "stdout.txt"
    $p = Start-Process -FilePath $exe -ArgumentList $quoted -PassThru -Wait `
        -RedirectStandardOutput $stdout -RedirectStandardError (Join-Path $out "stderr.txt")
    $ok = $true
    if ($ExpectFail) {
        if ($p.ExitCode -eq 0) { $ok = $false; Write-Host "  expected failure but exit 0" }
    } else {
        if ($p.ExitCode -ne 0) {
            $ok = $false
            Write-Host "  exit $($p.ExitCode):"; Get-Content $stdout | ForEach-Object { "    $_" } | Write-Host
        }
        foreach ($expected in $ExpectOutputs) {
            # Wildcards allowed (unicode names can't live as literals in a ps1).
            $found = @(Get-ChildItem -Path $out -Filter $expected -ErrorAction SilentlyContinue)
            if ($found.Count -eq 0) {
                $ok = $false; Write-Host "  missing output: $expected"
            } elseif ($found[0].Length -eq 0) {
                $ok = $false; Write-Host "  empty output: $expected"
            } elseif ($found[0].Name -match "\.(mp4|mkv|gif|m4a|mp3|wav|flac)$") {
                & $ffprobe -v error $found[0].FullName 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) { $ok = $false; Write-Host "  ffprobe rejects: $expected" }
            }
        }
    }
    if ($ok) { Write-Host "PASS  $Name" -ForegroundColor Green }
    else { Write-Host "FAIL  $Name" -ForegroundColor Red; $script:failures++ }
}

$tiny = Join-Path $assets "tiny.mp4"
$vfrMkv = Join-Path $assets "tiny-vfr.mkv"
$noAudio = Join-Path $assets "tiny-noaudio.mp4"
# The unicode-named asset is found by pattern - PS 5.1 reads ps1 files as ANSI,
# so a Devanagari literal here would silently mojibake.
$unicode = (Get-ChildItem $assets -Filter "*(final) 2.mp4" | Select-Object -First 1).FullName
if ($null -eq $unicode) { throw "unicode test asset missing" }
$tone = Join-Path $assets "tone.mp3"

Invoke-Smoke "v1-extract-audio" @("smoke", "extract-audio", "--file", "`"$tiny`"") @("tiny.m4a")
Invoke-Smoke "v1-unicode" @("smoke", "extract-audio", "--file", "`"$unicode`"") @("*(final) 2.m4a")
Invoke-Smoke "v1-no-audio-fails" @("smoke", "extract-audio", "--file", "`"$noAudio`"") @() -ExpectFail
Invoke-Smoke "v2-remux-vfr" @("smoke", "remux-mp4", "--file", "`"$vfrMkv`"") @("tiny-vfr.mp4")
Invoke-Smoke "v3-compress-quality" @("smoke", "compress-video", "--file", "`"$tiny`"", "--opt", "quality=low") @("tiny (compressed).mp4")
Invoke-Smoke "v4-convert-mkv" @("smoke", "convert-video", "--file", "`"$tiny`"", "--opt", "target=mkv") @("tiny.mkv")
Invoke-Smoke "v5-gif" @("smoke", "video-to-gif", "--file", "`"$tiny`"", "--opt", "fps=10", "--opt", "width=320") @("tiny.gif")
Invoke-Smoke "v6-trim" @("smoke", "trim-video", "--file", "`"$tiny`"", "--opt", "start=1", "--opt", "end=3") @("tiny (trimmed).mp4")
Invoke-Smoke "a1-convert-wav" @("smoke", "convert-audio", "--file", "`"$tone`"", "--opt", "target=wav") @("tone.wav")
Invoke-Smoke "a2-trim-copy" @("smoke", "trim-audio", "--file", "`"$tone`"", "--opt", "start=0.5", "--opt", "end=1.5") @("tone (trimmed).mp3")

# --- image suite (M3) ---
$photo = Join-Path $assets "photo.jpg"
$alpha = Join-Path $assets "alpha.png"
# sample.heic is fetched, not committed (ADR 003 - unclear redistribution terms).
$heic = Join-Path $assets "sample.heic"
if (-not (Test-Path $heic)) {
    Write-Host "fetching sample.heic ..."
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest "https://github.com/nokiatech/heif/raw/gh-pages/content/images/autumn_1440x960.heic" -OutFile $heic
}

Invoke-Smoke "i1-convert-png-jpg" @("smoke", "convert-image", "--file", "`"$alpha`"", "--opt", "target=jpg") @("alpha.jpg")
Invoke-Smoke "i1-convert-ico" @("smoke", "convert-image", "--file", "`"$alpha`"", "--opt", "target=ico") @("alpha.ico")
Invoke-Smoke "i2-resize-cm-dpi" @("smoke", "resize-image", "--file", "`"$photo`"", "--opt", "spec=3.5x4.5cm@200dpi") @("photo (resized).jpg")
Invoke-Smoke "i3-compress-50kb" @("smoke", "compress-image", "--file", "`"$photo`"", "--opt", "targetKb=50") @("photo (50KB).jpg")
Invoke-Smoke "i4-heic-jpg" @("smoke", "heic-convert", "--file", "`"$heic`"") @("sample.jpg")

# --- pdf suite (M4) ---
$textPdf = Join-Path $assets "text.pdf"
$mixedPdf = Join-Path $assets "mixed.pdf"
$scannedPdf = Join-Path $assets "scanned.pdf"
$qpdfExe = Join-Path $repoRoot "src-tauri\sidecars\qpdf.exe"
$encPdf = Join-Path $outRoot "encrypted.pdf"
& $qpdfExe --encrypt user owner 256 -- $textPdf $encPdf

Invoke-Smoke "p1-merge" @("smoke", "merge-pdf", "--file", "`"$textPdf`"", "--file", "`"$mixedPdf`"", "--opt", "ordered=true") @("text (merged).pdf")
Invoke-Smoke "p1-merge-encrypted-fails" @("smoke", "merge-pdf", "--file", "`"$textPdf`"", "--file", "`"$encPdf`"", "--opt", "ordered=true") @() -ExpectFail
Invoke-Smoke "p2-split" @("smoke", "split-pdf", "--file", "`"$textPdf`"", "--opt", "ranges=1-3,7,9-") @("text (pages 1-3).pdf", "text (page 7).pdf", "text (pages 9-end).pdf")
Invoke-Smoke "p3-compress" @("smoke", "compress-pdf", "--file", "`"$mixedPdf`"", "--opt", "targetKb=1000") @("mixed (1000KB).pdf")
Invoke-Smoke "p3-encrypted-fails" @("smoke", "compress-pdf", "--file", "`"$encPdf`"", "--opt", "targetKb=100") @() -ExpectFail

$p3out = Get-ChildItem (Join-Path $outRoot "p3-compress") -Filter "mixed (1000KB).pdf" -ErrorAction SilentlyContinue
if ($p3out) {
    if ($p3out.Length -gt 1000KB) {
        Write-Host "FAIL  p3-under-target ($([math]::Round($p3out.Length/1KB)) KB)" -ForegroundColor Red; $script:failures++
    } else {
        & $qpdfExe --check $p3out.FullName *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "PASS  p3-under-target-and-valid ($([math]::Round($p3out.Length/1KB)) KB)" -ForegroundColor Green
        } else {
            Write-Host "FAIL  p3-output-invalid" -ForegroundColor Red; $script:failures++
        }
    }
}

# --- extended actions (M5) ---
$vfrMp4 = Join-Path $assets "tiny-vfr.mp4"
$gifOut = Join-Path $outRoot "v5-gif\tiny.gif"
$svg = Join-Path $assets "vector.svg"
$tone2 = Join-Path $assets "tone.flac"

Invoke-Smoke "v7-merge-uniform" @("smoke", "merge-videos", "--file", "`"$tiny`"", "--file", "`"$noAudio`"", "--opt", "ordered=true") @("tiny (merged).mp4")
Invoke-Smoke "v8-mute" @("smoke", "mute-video", "--file", "`"$tiny`"") @("tiny (muted).mp4")
Invoke-Smoke "v9-frame" @("smoke", "extract-frame", "--file", "`"$tiny`"", "--opt", "at=2") @("tiny (frame 2s).png")
Invoke-Smoke "v9-sheet" @("smoke", "extract-frame", "--file", "`"$tiny`"", "--opt", "mode=sheet") @("tiny (contact sheet).png")
Invoke-Smoke "v10-editing" @("smoke", "editing-friendly", "--file", "`"$vfrMp4`"") @("tiny-vfr (editing).mov")
$hd = Join-Path $assets "tiny-720p.mp4"
Invoke-Smoke "v11-downscale" @("smoke", "downscale-video", "--file", "`"$hd`"", "--opt", "height=480") @("tiny-720p (480p).mp4")
Invoke-Smoke "v11-refuses-upscale" @("smoke", "downscale-video", "--file", "`"$tiny`"", "--opt", "height=480") @() -ExpectFail
if (Test-Path $gifOut) {
    Invoke-Smoke "v12-gif-to-mp4" @("smoke", "gif-to-video", "--file", "`"$gifOut`"") @("tiny.mp4")
}
Invoke-Smoke "a3-normalize" @("smoke", "normalize-audio", "--file", "`"$tone`"") @("tone (normalized).mp3")
Invoke-Smoke "a4-merge-audio" @("smoke", "merge-audio", "--file", "`"$tone`"", "--file", "`"$tone2`"", "--opt", "ordered=true") @("tone (merged).mp3")
Invoke-Smoke "a5-boost" @("smoke", "boost-volume", "--file", "`"$tone`"", "--opt", "factor=2") @("tone (2x).mp3")
Invoke-Smoke "i5-images-to-pdf" @("smoke", "images-to-pdf", "--file", "`"$photo`"", "--file", "`"$alpha`"", "--opt", "ordered=true") @("photo (images).pdf")
Invoke-Smoke "i6-strip-metadata" @("smoke", "view-metadata", "--file", "`"$photo`"", "--opt", "strip=true") @("photo (no metadata).jpg")
Invoke-Smoke "i7-svg-png" @("smoke", "svg-to-png", "--file", "`"$svg`"", "--opt", "width=512") @("vector.png")
Invoke-Smoke "p4-pdf-images" @("smoke", "pdf-to-images", "--file", "`"$mixedPdf`"", "--opt", "dpi=72") @("mixed (page 1).png")
Invoke-Smoke "p5-extract-text" @("smoke", "pdf-extract-text", "--file", "`"$textPdf`"") @("text.txt")
Invoke-Smoke "p5-scanned-fails" @("smoke", "pdf-extract-text", "--file", "`"$scannedPdf`"") @() -ExpectFail
Invoke-Smoke "p6-protect" @("smoke", "protect-pdf", "--file", "`"$textPdf`"", "--opt", "password=s3cret") @("text (protected).pdf")
$protected = Get-ChildItem (Join-Path $outRoot "p6-protect") -Filter "text (protected).pdf" -ErrorAction SilentlyContinue
if ($protected) {
    Invoke-Smoke "p6-unlock" @("smoke", "unlock-pdf", "--file", "`"$($protected.FullName)`"", "--opt", "password=s3cret") @("text (protected) (unlocked).pdf")
    Invoke-Smoke "p6-wrong-password-fails" @("smoke", "unlock-pdf", "--file", "`"$($protected.FullName)`"", "--opt", "password=wrong") @() -ExpectFail
}

# I3 must actually be under target
$sized = Get-ChildItem (Join-Path $outRoot "i3-compress-50kb") -Filter "photo (50KB).jpg" -ErrorAction SilentlyContinue
if ($sized -and $sized.Length -gt 50KB) {
    Write-Host "FAIL  i3-under-target ($([math]::Round($sized.Length/1KB,1)) KB > 50 KB)" -ForegroundColor Red
    $script:failures++
} elseif ($sized) {
    Write-Host "PASS  i3-under-target ($([math]::Round($sized.Length/1KB,1)) KB)" -ForegroundColor Green
}

if ($Heavy) {
    Write-Host "--- heavy suite ---"
    $heavyDir = Join-Path $assets "heavy"
    New-Item -ItemType Directory -Force $heavyDir | Out-Null
    $big = Join-Path $heavyDir "big.mp4"
    if (-not (Test-Path $big) -or (Get-Item $big).Length -lt 2GB) {
        Write-Host "generating >2 GB file (stream-copy loop)..."
        $ffmpeg = Join-Path $repoRoot "src-tauri\sidecars\ffmpeg.exe"
        & $ffmpeg -hide_banner -loglevel error -y -stream_loop 4200 -i "`"$tiny`"" -c copy "`"$big`""
        Write-Host ("big.mp4: {0:N1} GB" -f ((Get-Item $big).Length / 1GB))
    }
    Invoke-Smoke "heavy-v1-2gb" @("smoke", "extract-audio", "--file", "`"$big`"") @("big.m4a")

    # P3 gate: the big (>10 MB) mixed PDF must land under 1 MB and stay valid.
    $bigPdf = Join-Path $heavyDir "mixed-big.pdf"
    if (-not (Test-Path $bigPdf)) {
        node (Join-Path $repoRoot "scripts\make-test-pdfs.mjs") --heavy 2>$null | Out-Null
    }
    Invoke-Smoke "heavy-p3-big-mixed" @("smoke", "compress-pdf", "--file", "`"$bigPdf`"", "--opt", "targetKb=1000") @("mixed-big (1000KB).pdf")
    $bigOut = Get-ChildItem (Join-Path $outRoot "heavy-p3-big-mixed") -Filter "mixed-big (1000KB).pdf" -ErrorAction SilentlyContinue
    if ($bigOut) {
        $qc = Join-Path $repoRoot "src-tauri\sidecars\qpdf.exe"
        & $qc --check $bigOut.FullName *> $null
        if ($bigOut.Length -le 1000KB -and $LASTEXITCODE -eq 0) {
            Write-Host "PASS  heavy-p3-under-1mb-valid ($([math]::Round($bigOut.Length/1KB)) KB)" -ForegroundColor Green
        } else {
            Write-Host "FAIL  heavy-p3-under-1mb-valid" -ForegroundColor Red; $script:failures++
        }
    }

    # I3 gate: 5 diverse photos incl. a 48 MP one, all <= 50 KB.
    $m = Join-Path $repoRoot "src-tauri\sidecars\magick.exe"
    $p48 = Join-Path $heavyDir "photo-48mp.jpg"
    if (-not (Test-Path $p48)) {
        Write-Host "generating diverse photo set (incl. 48 MP)..."
        & $m -size 8000x6000 plasma:fractal -quality 92 $p48
        & $m -size 3000x2000 gradient:blue-yellow -quality 95 (Join-Path $heavyDir "photo-gradient.jpg")
        & $m -size 2000x3000 radial-gradient:white-black -quality 95 (Join-Path $heavyDir "photo-portrait.jpg")
        & $m -size 2551x3579 plasma: -quality 98 (Join-Path $heavyDir "photo-odd-dims.jpg")
        & $m -size 4000x4000 plasma:fractal-blue -quality 90 (Join-Path $heavyDir "photo-square.jpg")
    }
    foreach ($photoFile in @("photo-48mp.jpg", "photo-gradient.jpg", "photo-portrait.jpg", "photo-odd-dims.jpg", "photo-square.jpg")) {
        $src = Join-Path $heavyDir $photoFile
        $caseName = "heavy-i3-" + $photoFile.Replace(".jpg", "")
        $expect = $photoFile.Replace(".jpg", " (50KB).jpg")
        Invoke-Smoke $caseName @("smoke", "compress-image", "--file", "`"$src`"", "--opt", "targetKb=50") @($expect)
        $result = Get-ChildItem (Join-Path $outRoot $caseName) -Filter $expect -ErrorAction SilentlyContinue
        if ($result -and $result.Length -gt 50KB) {
            Write-Host "FAIL  $caseName over target" -ForegroundColor Red; $script:failures++
        }
    }

    # Cancel mid-encode: run-mode compress on the big file, then close the
    # progress window (close == cancel). Expect: no output, temp cleaned.
    Write-Host "cancel test: starting run-mode compress..."
    $before = @(Get-ChildItem $heavyDir).Name
    Start-Process -FilePath $exe -ArgumentList @("run", "compress-video", "--file", "`"$big`"") | Out-Null
    Start-Sleep -Seconds 12   # aggregation window + probe of a 2 GB file + encode spin-up
    $procs = @(Get-Process zapit -ErrorAction SilentlyContinue)
    if ($procs.Count -eq 0) {
        Write-Host "FAIL  cancel (app not running)" -ForegroundColor Red; $script:failures++
    } else {
        foreach ($p in $procs) { $p.CloseMainWindow() | Out-Null }
        Start-Sleep -Seconds 8
        Get-Process zapit -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
        $after = @(Get-ChildItem $heavyDir).Name
        $tempJobs = @(Get-ChildItem (Join-Path $env:TEMP "zapit") -Directory -ErrorAction SilentlyContinue)
        $newFiles = @($after | Where-Object { $_ -notin $before })
        if ($newFiles.Count -eq 0 -and $tempJobs.Count -eq 0) {
            Write-Host "PASS  cancel-cleans-up" -ForegroundColor Green
        } else {
            Write-Host "FAIL  cancel-cleans-up (new: $($newFiles -join ', '); temp: $($tempJobs.Count))" -ForegroundColor Red
            $script:failures++
        }
    }
}

if ($script:failures -gt 0) {
    Write-Host "$script:failures failure(s)" -ForegroundColor Red
    exit 1
}
Write-Host "smoke: all green" -ForegroundColor Green
