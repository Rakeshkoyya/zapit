# Generates the test fixtures in test/assets (section 13). They are NOT committed: every
# one is deterministically generated from the pinned sidecars, so shipping ~10 MB
# of binaries in the repo would be pure weight. Run this once after cloning.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/make-test-assets.ps1
#
# Prerequisite: scripts/fetch-sidecars.ps1 (needs ffmpeg + magick).

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $repoRoot "test\assets"
$sidecars = Join-Path $repoRoot "src-tauri\sidecars"
$ffmpeg = Join-Path $sidecars "ffmpeg.exe"
$magick = Join-Path $sidecars "magick.exe"

if (-not (Test-Path $ffmpeg)) { throw "Run scripts/fetch-sidecars.ps1 first." }
New-Item -ItemType Directory -Force $assets | Out-Null

function FF { & $ffmpeg -hide_banner -loglevel error -y @args }

Write-Host "video ..."
FF -f lavfi -i "testsrc2=duration=5:size=640x360:rate=30" -f lavfi -i "sine=frequency=440:duration=5" `
   -c:v libopenh264 -b:v 800k -pix_fmt yuv420p -c:a aac -shortest (Join-Path $assets "tiny.mp4")
FF -f lavfi -i "testsrc2=duration=5:size=640x360:rate=30" `
   -c:v libopenh264 -b:v 800k -pix_fmt yuv420p -an (Join-Path $assets "tiny-noaudio.mp4")
FF -f lavfi -i "testsrc2=duration=3:size=1280x720:rate=30" -f lavfi -i "sine=frequency=440:duration=3" `
   -c:v libopenh264 -b:v 1200k -pix_fmt yuv420p -c:a aac -shortest (Join-Path $assets "tiny-720p.mp4")
# Variable frame rate: dropping frames unevenly makes avg_frame_rate != r_frame_rate.
FF -i (Join-Path $assets "tiny.mp4") -vf "select=not(mod(n\,3))+not(mod(n\,2))" -fps_mode vfr `
   -c:v libopenh264 -b:v 500k -pix_fmt yuv420p -c:a copy (Join-Path $assets "tiny-vfr.mp4")
FF -i (Join-Path $assets "tiny-vfr.mp4") -c copy (Join-Path $assets "tiny-vfr.mkv")
# Unicode + spaces + parentheses in one filename (DoD item 2).
Copy-Item (Join-Path $assets "tiny.mp4") (Join-Path $assets ([char]0x092E + [char]0x0947 + [char]0x0930 + [char]0x093E + " " + [char]0x0935 + [char]0x0940 + [char]0x0921 + [char]0x093F + [char]0x092F + [char]0x094B + " (final) 2.mp4")) -Force

Write-Host "audio ..."
FF -f lavfi -i "sine=frequency=440:duration=2" -c:a libmp3lame -q:a 4 (Join-Path $assets "tone.mp3")
FF -f lavfi -i "sine=frequency=440:duration=2" -c:a flac (Join-Path $assets "tone.flac")

Write-Host "images ..."
& $magick -size 2400x1800 plasma:fractal -quality 95 (Join-Path $assets "photo.jpg")
& $magick -size 800x600 gradient:red-transparent (Join-Path $assets "alpha.png")

Write-Host "pdfs ..."
node (Join-Path $repoRoot "scripts\make-test-pdfs.mjs")

Write-Host "sample.heic (downloaded, not generated) ..."
$heic = Join-Path $assets "sample.heic"
if (-not (Test-Path $heic)) {
    # Not committed: redistribution terms for this public test image are unclear
    # (ADR 003), so each machine fetches its own copy.
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest "https://github.com/nokiatech/heif/raw/gh-pages/content/images/autumn_1440x960.heic" -OutFile $heic
}

Write-Host "test assets ready in $assets" -ForegroundColor Green
