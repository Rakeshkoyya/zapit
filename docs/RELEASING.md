# Releasing Zapit

Everything here is free. No code-signing certificate, no store fees.

## Before the first push

1. **Fill in the placeholders** in `docs/privacy-policy.md`:
   `REPLACE-WITH-YOUR-USERNAME` (3 places) and `REPLACE-WITH-YOUR-EMAIL`.
2. **Set the version.** It is `0.1.0` in three files that must agree:
   `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
   Use `1.0.0` for the first public release.
3. **Run the clean-machine pass** in `docs/TEST_MATRIX.md`. This is the one gate that
   cannot be automated from the dev box.

## Push the code

```powershell
git add -A
git commit -m "feat: Zapit v1.0.0"
git branch -M main
git remote add origin https://github.com/<you>/zapit.git
git push -u origin main
```

Then in the repo's **Settings → Pages**: source *Deploy from a branch*, branch `main`,
folder `/docs`. Your privacy policy becomes
`https://<you>.github.io/zapit/privacy-policy`.

## Cut a release

Build a fresh installer and publish it:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check.ps1
npm run tauri build
```

The installer lands at
`src-tauri/target/release/bundle/nsis/Zapit_<version>_x64-setup.exe`.

Publish a checksum with it so people can verify the download — Zapit can compute its own:

```powershell
Get-FileHash src-tauri\target\release\bundle\nsis\Zapit_1.0.0_x64-setup.exe -Algorithm SHA256
```

Then:

```powershell
git tag -a v1.0.0 -m "Zapit v1.0.0"
git push origin v1.0.0
```

On GitHub: **Releases → Draft a new release → choose tag `v1.0.0`**, attach the
`-setup.exe`, and paste the SHA-256 into the notes. Publish.

### Release notes worth including

- What it does, in two lines.
- **The SmartScreen warning.** The build is unsigned, so Windows shows
  "Windows protected your PC" on first run. Tell people to click **More info → Run
  anyway**, and give them the SHA-256 so they can verify what they downloaded. Hiding
  this costs you trust; explaining it earns it.
- That it installs per-user, needs no admin rights, and uninstalls cleanly.

## Reach more people, still free: WinGet

Microsoft's own package manager takes community submissions with **no signing requirement
and no fee**, and your GitHub release is a valid download source. After publishing a
release:

1. Install the manifest tool: `winget install wingetcreate`
2. Generate and submit:
   ```powershell
   wingetcreate new https://github.com/<you>/zapit/releases/download/v1.0.0/Zapit_1.0.0_x64-setup.exe
   ```
   It walks you through the metadata, validates the manifest, and opens a pull request
   against `microsoft/winget-pkgs` for you.
3. Once merged, anyone can run `winget install Zapit`.

Updates are one `wingetcreate update` per release.

## Automating builds (optional)

GitHub Actions is free for public repositories. A workflow triggered on `v*` tags can run
`npm run tauri build` on a `windows-latest` runner and attach the installer to the release,
so cutting a version becomes a single `git push origin v1.1.0`. The sidecars are fetched by
`scripts/fetch-sidecars.ps1`, so the runner needs no extra setup beyond Node and Rust.

## What is deliberately not here

**Microsoft Store.** It needs either a paid code-signing certificate (EXE/MSI submissions
must be signed) or an MSIX package. MSIX is worse than merely expensive: it virtualizes
registry writes, so Zapit's context menu — which lives in `HKCU\Software\Classes` — would
silently not appear. Making it work under MSIX means writing a signed COM shell extension,
which `GOALS.md` lists as a non-goal for v1.

If you later want to remove the SmartScreen warning, **Azure Trusted Signing** is about
$10/month and is the cheapest route to a signed installer.
