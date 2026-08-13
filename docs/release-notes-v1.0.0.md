Right-click any file on Windows 11 and instantly do the obvious thing with it — compress a
video to a size limit, squeeze a photo to an exact KB target, convert HEIC, merge or split
PDFs, extract audio. Fully offline: no uploads, no accounts, no telemetry.

### New in 1.0.0 — a redesigned interface

Every window was rebuilt on one design system, and the app now follows your Windows light
or dark setting.

- **Settings actually explains itself.** It opens on a page that tells you whether Zapit is
  in your right-click menu, walks you through reaching it — Windows 11 hides every app's
  entries behind **Show more options** — and shows you a picture of that menu.
- **Every action says what it does and where it appears.** Each one is a switch with a
  plain-English description and a tag for every file type it shows up on, grouped by
  category, with a search box and per-category on/off.
- **A choice of where results are saved**, including a folder picker for sending every
  result to one place.
- **The Trim window** is a proper editor: filmstrip, waveform, draggable cuts and a list of
  them, with Keep and Remove clearly separated.
- Every dialog — compress, resize, split, passwords, merge order, metadata — shares one
  layout, so the buttons are always where you expect them.

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

Download `Zapit_1.0.0_x64-setup.exe` below and run it. It installs for your user only, needs
no admin rights, and adds itself to the right-click menu under **Show more options**.

To turn individual actions off, or to remove the menu, launch **Zapit** from the Start menu.

### Heads-up: SmartScreen warning

This build is not code-signed, so Windows will show "Windows protected your PC" the first
time you run it. Click **More info** → **Run anyway**.

You can verify you got exactly what was published:

SHA-256: `cb6575dec7ce0d172c66e1dce9bd8104eb19a05431ed1c7c6fb1b7700e341c95`

```powershell
Get-FileHash Zapit_1.0.0_x64-setup.exe -Algorithm SHA256
```

Or build it yourself from source — instructions are in the README.

### Upgrading from 0.1.0

Run the new installer over the top; your settings are kept. If the right-click menu looks
unchanged afterwards, open Zapit and use **Remove menu** then **Add to menu** on the
Right-click menu page.

### Uninstall

Settings → Apps → Zapit, or run the uninstaller in the install folder. It removes the app
and every registry key it created, leaving the registry as it was.
