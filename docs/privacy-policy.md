# Privacy Policy for Zapit

**Last updated: 25 July 2026**

## The short version

Zapit does not collect, store, transmit, or share any personal information. It makes no
network connections of any kind. Everything it does happens on your own computer.

## What data Zapit accesses

Zapit only reads the files you explicitly select in Windows Explorer before choosing a
Zapit action, and only for as long as it takes to perform that action. It writes the
resulting output file next to the source file (or to the folder you configured), and never
modifies or deletes your original file.

## What data Zapit stores on your computer

Two things, both local, both readable by you at any time:

- **Settings** — `%APPDATA%\Zapit\config.json` holds your preferences: which actions are
  enabled, and where outputs should go. No file contents and no personal information.
- **Logs** — `%APPDATA%\Zapit\logs\` records errors and completed operations to help
  diagnose problems, including the names of files that were processed. Logs stay on your
  machine, are never transmitted anywhere, and are automatically limited in size. You can
  delete them at any time, or open the folder from Zapit's Settings window.

Uninstalling Zapit removes the application and its Windows context-menu entries. If you
also want to remove your settings and logs, delete the `%APPDATA%\Zapit` folder.

## What Zapit does not do

- No internet connections, requests, or downloads while in use
- No telemetry, analytics, crash reporting, or usage statistics
- No user accounts, sign-in, or registration
- No advertising, and no data sold or shared with anyone
- No access to files you did not explicitly select

Zapit works entirely offline. You can verify this by disconnecting from the internet —
every feature continues to work — or by reading the source code, which is public.

## Children's privacy

Zapit does not collect information from anyone, including children under 13.

## Third-party components

Zapit bundles several open-source tools (FFmpeg, qpdf, ImageMagick, PDFium) that run
locally on your computer to process your files. They also make no network connections in
the way Zapit uses them. The full list, with versions and licences, is in
[THIRD_PARTY.md](https://github.com/rakeshkoyya/zapit/blob/main/docs/THIRD_PARTY.md).

## Changes to this policy

If this policy changes, the updated version will be published at this address and the date
at the top will be revised.

## Contact

Questions about this policy or about Zapit: **rakeshkoyya2024@gmail.com**

You can also open an issue at
[github.com/rakeshkoyya/zapit/issues](https://github.com/rakeshkoyya/zapit/issues).
