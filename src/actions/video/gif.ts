import { splitName, type QuickAction } from "../../core/action";
import { durationUs, videoStream } from "../../core/media";
import { PlanError } from "../../core/planError";
import type { EnginePlan } from "../../core/plan";

/** V5: two-pass palettegen/paletteuse for good colors at sane sizes (§6). */
export const videoToGif: QuickAction = {
  id: "video-to-gif",
  menuLabel: "Video → GIF",
  category: "video",
  extensions: ["mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "ts", "m4v", "3gp"],
  multiFile: "single",
  edition: "free",
  tier: "core",
  presets: [
    { label: "Small (320 px, 10 fps)", options: { width: "320", fps: "10" } },
    { label: "Medium (480 px, 15 fps)", options: { width: "480", fps: "15" } },
    { label: "Large (640 px, 24 fps)", options: { width: "640", fps: "24" } },
  ],
  buildPlan(inputs, opts): EnginePlan {
    const input = inputs[0];
    if (input === undefined) {
      throw new PlanError("No input file.");
    }
    const { base } = splitName(input.path);
    if (!videoStream(input.media)) {
      throw new PlanError(`"${base}" doesn't look like a video.`);
    }
    const fps = opts.fps ?? "15";
    const width = opts.width ?? "480";
    if (!/^\d+$/.test(fps) || !/^\d+$/.test(width)) {
      throw new PlanError("GIF fps and width must be whole numbers.");
    }
    // `\,` keeps the comma inside min() from splitting the filter chain.
    const filters = `fps=${fps},scale=min(${width}\\,iw):-2:flags=lanczos`;
    const total = durationUs(input.media);
    const temp = "{tmp}/out.gif";
    return {
      steps: [
        {
          kind: "sidecar",
          bin: "ffmpeg",
          args: [
            "-i",
            "{in0}",
            "-vf",
            `${filters},palettegen=stats_mode=diff`,
            "{tmp}/palette.png",
          ],
        },
        {
          kind: "sidecar",
          bin: "ffmpeg",
          args: [
            "-i",
            "{in0}",
            "-i",
            "{tmp}/palette.png",
            "-lavfi",
            `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4`,
            temp,
          ],
          ...(total !== undefined ? { totalUs: total } : {}),
        },
      ],
      outputs: [{ from: temp, baseName: base, ext: "gif" }],
    };
  },
};
