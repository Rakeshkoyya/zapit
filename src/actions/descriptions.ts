/**
 * Plain-English descriptions of what each action does, shown in the Settings
 * window next to its toggle.
 *
 * These live beside the registry rather than on `QuickAction` so the action
 * modules stay purely about building plans (§5.1). `descriptions.test.ts`
 * fails the build if a menuable action is missing one, so the two cannot drift.
 *
 * Voice: what the user gets, not how it is done. No jargon, no ffmpeg.
 */
export const ACTION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  // ---- Video ----
  "extract-audio": "Save the soundtrack of a video as a separate audio file.",
  "remux-mp4": "Repackage into an MP4 without re-encoding — fast, and no quality is lost.",
  "compress-video": "Shrink a video down to a file size you choose.",
  "convert-video": "Change a video into another format, such as MP4 or WebM.",
  "video-to-gif": "Turn a short clip into an animated GIF.",
  "trim-video": "Open a preview window and cut out the parts you want to keep or remove.",
  "merge-videos": "Join several videos end to end into a single file.",
  "mute-video": "Strip the sound out and keep the picture.",
  "extract-frame": "Save one frame of a video as a still image.",
  "editing-friendly": "Re-encode into a format that video editors scrub through smoothly.",
  "downscale-video": "Lower the resolution — 4K down to 1080p, for example.",
  "gif-to-video": "Convert an animated GIF into an MP4, which is far smaller.",

  // ---- Audio ----
  "convert-audio": "Change audio into another format, such as MP3 or WAV.",
  "trim-audio": "Open a preview window and cut out the parts you want to keep or remove.",
  "normalize-audio": "Even out the loudness to a broadcast-standard level.",
  "merge-audio": "Join several audio files end to end into one.",
  "boost-volume": "Make a quiet recording louder without distorting it.",

  // ---- Image ----
  "convert-image": "Change an image into another format, such as JPG, PNG or WebP.",
  "resize-image": "Change an image's width and height.",
  "compress-image": "Shrink an image down to a file size you choose.",
  "heic-convert": "Turn iPhone HEIC photos into JPGs that anything can open.",
  "images-to-pdf": "Combine several images into a single PDF.",
  "view-metadata": "See the hidden EXIF data — camera, date, location — and strip it out.",
  "svg-to-png": "Render a vector SVG into a PNG at the size you pick.",

  // ---- PDF ----
  "merge-pdf": "Combine several PDFs into one, in an order you choose.",
  "split-pdf": "Pull a range of pages out into its own PDF.",
  "compress-pdf": "Shrink a PDF to a smaller file size.",
  "pdf-to-images": "Save every page of a PDF as a separate image.",
  "pdf-extract-text": "Pull the text out of a PDF into a plain .txt file.",
  "protect-pdf": "Lock a PDF so it can only be opened with a password.",
  "unlock-pdf": "Remove the password from a PDF you can already open.",

  // ---- Any file ----
  checksum: "Work out a file's SHA-256 fingerprint, to check a download arrived intact.",
};

/** Falls back to an empty string so a missing entry degrades quietly in the UI. */
export function describeAction(id: string): string {
  return ACTION_DESCRIPTIONS[id] ?? "";
}
