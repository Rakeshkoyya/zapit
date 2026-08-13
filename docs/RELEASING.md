# Releasing Zapit

Everything here is free. No code-signing certificate, no store fees.

The current release is **v1.0.0**. The version appears in three files that must always
agree — `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` — and it
becomes the installer's filename.

## 1. Pre-flight

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check.ps1        # must be green
powershell -ExecutionPolicy Bypass -File scripts/smoke.ps1        # must be green
powershell -ExecutionPolicy Bypass -File scripts/test-presets.ps1 # every menu entry
```

Also confirm `docs/privacy-policy.md` has no `REPLACE-WITH-` placeholders left, and that
the clean-machine checklist in `docs/TEST_MATRIX.md` has been run.

## 2. Build the installer

```powershell
# Clear the cached icon resource — Cargo does not treat icon.ico as a build
# input, so a plain rebuild can re-link the previous icon (see ARCHITECTURE.md).
Get-ChildItem src-tauri\target\release\build -Directory |
  Where-Object { $_.Name -match '^zapit-' } | Remove-Item -Recurse -Force

npm run tauri build
```

Output: `src-tauri/target/release/bundle/nsis/Zapit_<version>_x64-setup.exe`

Get the checksum to publish alongside it:

```powershell
Get-FileHash src-tauri\target\release\bundle\nsis\Zapit_1.0.0_x64-setup.exe -Algorithm SHA256
```

## 3. Tag the release

```powershell
git tag -a v1.0.0 -m "Zapit v1.0.0 - first public release"
git push origin v1.0.0
```

A tag is just a pointer; it does **not** create a release or upload anything. That is the
next step.

## 4. Publish the release

The installer is ~84 MB, which is why it is not in git — GitHub Releases hosts binaries,
the repository hosts source.

### Option A — GitHub website (no extra tools)

1. Go to `https://github.com/<you>/zapit/releases/new`
2. **Choose a tag** → pick the existing `v1.0.0`
3. **Release title**: `Zapit v1.0.0`
4. Paste the release notes (template below)
5. Drag `Zapit_1.0.0_x64-setup.exe` into the attachments box and wait for the upload bar
   to finish
6. Tick **Set as a pre-release** if you want early testers only; leave it unticked for a
   public release
7. **Publish release**

### Option B — command line

Install GitHub CLI once:

```powershell
winget install --id GitHub.cli
```

Restart the terminal, authenticate, then create the release and upload in one command:

```powershell
gh auth login
gh release create v1.0.0 `
  "src-tauri\target\release\bundle\nsis\Zapit_1.0.0_x64-setup.exe" `
  --title "Zapit v1.0.0" `
  --notes-file docs\release-notes-v1.0.0.md
```

Use `--prerelease` to mark it as a pre-release.

## Release notes template

```markdown
Right-click any file on Windows 11 and instantly do the obvious thing with it — compress a
video to a size limit, squeeze a photo to an exact KB target, convert HEIC, merge or split
PDFs, extract audio. Fully offline: no uploads, no accounts, no telemetry.

### Install
Download `Zapit_1.0.0_x64-setup.exe` below and run it. It installs for your user only, needs
no admin rights, and adds itself to the right-click menu (under **Show more options**).

### Heads-up: SmartScreen warning
This build is not code-signed, so Windows will show "Windows protected your PC" the first
time you run it. Click **More info** then **Run anyway**. You can verify you got exactly
what was published:

SHA-256: `<paste the hash here>`

```powershell
Get-FileHash Zapit_1.0.0_x64-setup.exe -Algorithm SHA256
```

Or build it yourself from source — the instructions are in the README.

### Uninstall
Settings → Apps → Zapit, or run the uninstaller in the install folder. It removes the app
and every registry key it created.
```

## After the release: WinGet (free, wider reach)

Microsoft's package manager accepts community submissions with **no signing requirement and
no fee**, and your GitHub release is a valid download source:

```powershell
winget install wingetcreate
wingetcreate new https://github.com/<you>/zapit/releases/download/v1.0.0/Zapit_1.0.0_x64-setup.exe
```

It collects the metadata, validates the manifest and opens a pull request against
`microsoft/winget-pkgs`. Once merged, anyone can run `winget install Zapit`. Later releases
are one `wingetcreate update` each.

## Automating it later (optional)

GitHub Actions is free for public repositories. A workflow on `v*` tags can run
`npm run tauri build` on a `windows-latest` runner and attach the installer automatically,
reducing a release to `git push origin v0.2.0`. The runner needs Node and Rust; the sidecars
come from `scripts/fetch-sidecars.ps1`.

## Not doing: Microsoft Store

It requires either a paid code-signing certificate (EXE/MSI submissions must be signed) or
an MSIX package. MSIX is worse than merely expensive: it virtualizes registry writes, so
Zapit's context menu — which lives in `HKCU\Software\Classes` — would silently not appear.
Supporting it means writing a signed COM shell extension, which `GOALS.md` lists as a
non-goal for v1.

To remove the SmartScreen warning later, **Azure Trusted Signing** (~$10/month) is the
cheapest route to a signed installer.
