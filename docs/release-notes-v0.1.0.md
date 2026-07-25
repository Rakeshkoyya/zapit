Right-click any file on Windows 11 and instantly do the obvious thing with it — compress a
video to a size limit, squeeze a photo to an exact KB target, convert HEIC, merge or split
PDFs, extract audio. Fully offline: no uploads, no accounts, no telemetry.

### What's in it

**Video** — extract audio · remux to MP4 · compress (quality presets or a 15/25/50 MB
target, resolution always preserved) · convert MP4/MKV/WebM/MOV · video → GIF · trim ·
merge · mute · extract frame or contact sheet · make editing-friendly · downscale · GIF → MP4

**Audio** — convert MP3/WAV/FLAC/M4A/OGG · trim · normalize loudness (EBU R128) · merge ·
boost volume

**Image** — convert PNG/JPG/WebP/ICO · resize to an exact spec (`50%`, `800x600`,
`3.5x4.5cm@200dpi`) · compress to an exact KB target · HEIC → JPG · images → PDF · view and
remove EXIF/GPS · SVG → PNG

**PDF** — merge · split by page ranges (`1-3,7,9-`) · compress by quality or to a target
size · PDF → images · extract text · password protect · unlock

**Any file** — SHA-256 / MD5 checksum with paste-to-compare

### Install

Download `Zapit_0.1.0_x64-setup.exe` below and run it. It installs for your user only, needs
no admin rights, and adds itself to the right-click menu under **Show more options**.

To turn individual actions off, or to remove the menu, launch **Zapit** from the Start menu.

### Heads-up: SmartScreen warning

This build is not code-signed, so Windows will show "Windows protected your PC" the first
time you run it. Click **More info** → **Run anyway**.

You can verify you got exactly what was published:

SHA-256: `20799901d65308f8fc9470a732020fdb5fc239366494a8c9538fb1e48897ea5b`

```powershell
Get-FileHash Zapit_0.1.0_x64-setup.exe -Algorithm SHA256
```

Or build it yourself from source — instructions are in the README.

### Uninstall

Settings → Apps → Zapit, or run the uninstaller in the install folder. It removes the app
and every registry key it created, leaving the registry as it was.

### Notes

First public release. It has been tested extensively on the development machine — including
a 2.2 GB video, a 48-megapixel photo, a 29 MB PDF, and an automated sweep of all 561
right-click menu entries — but not yet on a wide range of machines. Please open an issue if
anything misbehaves.
