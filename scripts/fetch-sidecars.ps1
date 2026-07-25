# Downloads the pinned sidecar binaries into src-tauri/sidecars/.
# Binaries are never committed to git; this script is the only way they enter the tree.
# Every release is pinned by exact URL + SHA-256. Bumping a pin requires updating
# docs/THIRD_PARTY.md in the same commit.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/fetch-sidecars.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$sidecarDir = Join-Path $repoRoot "src-tauri\sidecars"
$cacheDir = Join-Path $env:TEMP "zapit-sidecar-cache"

# name: archive basename used for the cache file
# url / sha256: the pin
# extract: archive-internal paths -> sidecar file names
$pins = @(
    @{
        name    = "ffmpeg-n8.1.2-31-win64-lgpl.zip"
        url     = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-24-13-32/ffmpeg-n8.1.2-31-g8c9502e9b0-win64-lgpl-8.1.zip"
        sha256  = "972C57498DFF104FFF2D53B8B0CB3641F45B8FF1E7CC1B00257C9E34435FE853"
        extract = @{
            "ffmpeg-n8.1.2-31-g8c9502e9b0-win64-lgpl-8.1/bin/ffmpeg.exe"  = "ffmpeg.exe"
            "ffmpeg-n8.1.2-31-g8c9502e9b0-win64-lgpl-8.1/bin/ffprobe.exe" = "ffprobe.exe"
        }
    },
    @{
        name    = "qpdf-12.3.2-msvc64.zip"
        url     = "https://github.com/qpdf/qpdf/releases/download/v12.3.2/qpdf-12.3.2-msvc64.zip"
        sha256  = "8941870A604E7C87ED24566B038D46C24CE76616254D2383C578F60C0677F202"
        # qpdf.exe is dynamically linked: it needs its own DLL plus the VC++
        # runtime DLLs shipped in the release (target machines may lack the redist).
        extract = @{
            "qpdf-12.3.2-msvc64/bin/qpdf.exe"                    = "qpdf.exe"
            "qpdf-12.3.2-msvc64/bin/qpdf30.dll"                  = "qpdf30.dll"
            "qpdf-12.3.2-msvc64/bin/concrt140.dll"               = "concrt140.dll"
            "qpdf-12.3.2-msvc64/bin/msvcp140.dll"                = "msvcp140.dll"
            "qpdf-12.3.2-msvc64/bin/msvcp140_1.dll"              = "msvcp140_1.dll"
            "qpdf-12.3.2-msvc64/bin/msvcp140_2.dll"              = "msvcp140_2.dll"
            "qpdf-12.3.2-msvc64/bin/msvcp140_atomic_wait.dll"    = "msvcp140_atomic_wait.dll"
            "qpdf-12.3.2-msvc64/bin/msvcp140_codecvt_ids.dll"    = "msvcp140_codecvt_ids.dll"
            "qpdf-12.3.2-msvc64/bin/vcruntime140.dll"            = "vcruntime140.dll"
            "qpdf-12.3.2-msvc64/bin/vcruntime140_1.dll"          = "vcruntime140_1.dll"
        }
    },
    @{
        # P3/P4: PDF rasterization via pdfium-render (dynamic binding).
        name    = "pdfium-win-x64-7961.tgz"
        url     = "https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F7961/pdfium-win-x64.tgz"
        sha256  = "88276459349B291C41F10422DAD0210F007C04D919C8FA56472B6B7C6406ADF4"
        sevenZip = $true
        extract = @{
            "bin/pdfium.dll" = "pdfium.dll"
        }
    },
    @{
        # ADR 003: HEIC decode + DPI-aware resize + size-search encoder.
        # .7z archive - extracted with bsdtar (ships with Windows 10+).
        name    = "ImageMagick-7.1.2-27-portable-Q16-x64.7z"
        url     = "https://github.com/ImageMagick/ImageMagick/releases/download/7.1.2-27/ImageMagick-7.1.2-27-portable-Q16-x64.7z"
        sha256  = "BB8B519EA4A387C7F138B0D5CBAB30CB525850F9FB0E91765947FB8E3BA69EF5"
        sevenZip = $true
        extract = @{
            "magick.exe" = "magick.exe"
        }
    }
)

New-Item -ItemType Directory -Force $sidecarDir | Out-Null
New-Item -ItemType Directory -Force $cacheDir | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem

foreach ($pin in $pins) {
    $archive = Join-Path $cacheDir $pin.name

    $cached = (Test-Path $archive) -and
        ((Get-FileHash $archive -Algorithm SHA256).Hash -eq $pin.sha256)
    if (-not $cached) {
        Write-Host "Downloading $($pin.name) ..."
        $ProgressPreference = "SilentlyContinue"
        Invoke-WebRequest -Uri $pin.url -OutFile $archive
        $actual = (Get-FileHash $archive -Algorithm SHA256).Hash
        if ($actual -ne $pin.sha256) {
            Remove-Item $archive -Force -Confirm:$false
            throw "SHA-256 mismatch for $($pin.url): expected $($pin.sha256), got $actual"
        }
    } else {
        Write-Host "Cache hit: $($pin.name)"
    }

    if ($pin.sevenZip) {
        # bsdtar handles both .7z and .tgz.
        $work = Join-Path $cacheDir ([System.IO.Path]::GetFileNameWithoutExtension($pin.name))
        New-Item -ItemType Directory -Force $work | Out-Null
        Push-Location $work
        try {
            foreach ($entryPath in $pin.extract.Keys) {
                tar -xf $archive $entryPath
                if ($LASTEXITCODE -ne 0) { throw "tar failed extracting '$entryPath' from $($pin.name)" }
                $dest = Join-Path $sidecarDir $pin.extract[$entryPath]
                Move-Item (Join-Path $work $entryPath) $dest -Force
                Write-Host "  -> $dest"
            }
        } finally {
            Pop-Location
        }
        continue
    }
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
    try {
        foreach ($entryPath in $pin.extract.Keys) {
            $entry = $zip.GetEntry($entryPath)
            if ($null -eq $entry) { throw "Entry '$entryPath' not found in $($pin.name)" }
            $dest = Join-Path $sidecarDir $pin.extract[$entryPath]
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
            Write-Host "  -> $dest"
        }
    } finally {
        $zip.Dispose()
    }
}

Write-Host "Sidecars ready in $sidecarDir"
