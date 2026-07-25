import { splitName, type FileInfo, type QuickAction } from "../../core/action";
import { audioStream, durationUs, videoStream } from "../../core/media";
import { NeedsOptions, PlanError } from "../../core/planError";
import { qualityKbps } from "../../core/videoMath";
// NeedsOptions is used by merge (reorder) and extract-frame (custom time).
import { h264EncodeArgs } from "../shared/h264";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

const VIDEO_EXT = ["mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "ts", "m4v", "mts", "3gp"];

function requireVideo(input: FileInfo | undefined): FileInfo {
  if (input === undefined) {
    throw new PlanError("No input file.");
  }
  if (input.media && !videoStream(input.media)) {
    throw new PlanError(`"${splitName(input.path).base}" doesn't look like a video.`);
  }
  return input;
}

/** V7: concat demuxer when streams match, normalize-then-concat otherwise (§6). */
export const mergeVideos: QuickAction = {
  id: "merge-videos",
  menuLabel: "Merge videos",
  category: "video",
  extensions: VIDEO_EXT,
  multiFile: "multi",
  edition: "free",
  tier: "extended",
  buildPlan(inputs, opts): EnginePlan {
    if (inputs.length < 2) {
      throw new PlanError("Select at least two videos to merge.");
    }
    if (opts.ordered !== "true") {
      throw new NeedsOptions("reorder");
    }
    let order = inputs.map((_, i) => i);
    if (opts.order !== undefined && opts.order !== "") {
      const parsed = opts.order.split(",").map((n) => Number(n.trim()));
      if (
        parsed.length !== inputs.length ||
        !parsed.every((n) => Number.isInteger(n) && n >= 0 && n < inputs.length) ||
        new Set(parsed).size !== parsed.length
      ) {
        throw new PlanError("The file order looks corrupted — try again.");
      }
      order = parsed;
    }

    const ordered = order.map((i) => inputs[i]).filter((f): f is FileInfo => f !== undefined);
    const first = videoStream(ordered[0]?.media);
    const uniform = ordered.every((file) => {
      const v = videoStream(file.media);
      return (
        v?.codec === first?.codec &&
        v?.width === first?.width &&
        v?.height === first?.height &&
        first !== undefined
      );
    });
    const { base } = splitName(ordered[0]?.path ?? "merged");
    const out = "{tmp}/merged.mp4";
    const steps: PlanStep[] = [];

    if (uniform) {
      // The concat demuxer needs a list file; single quotes get escaped per
      // FFmpeg's rule ' -> '\''.
      const listLines = order
        .map((i) => `file '${`{in${String(i)}}`.replace(/'/g, "'\\''")}'`)
        .join("\n");
      steps.push({ kind: "write-text", path: "{tmp}/list.txt", content: listLines });
      steps.push({
        kind: "sidecar",
        bin: "ffmpeg",
        args: ["-f", "concat", "-safe", "0", "-i", "{tmp}/list.txt", "-c", "copy", out],
      });
    } else {
      // Normalize each clip to a common h264/aac baseline, then concat filter.
      const height = Math.max(...ordered.map((f) => videoStream(f.media)?.height ?? 720));
      const kbps = qualityKbps(0.09, Math.round((height * 16) / 9), height);
      const args: string[] = [];
      for (const i of order) {
        args.push("-i", `{in${String(i)}}`);
      }
      const parts = order
        .map(
          (_, position) =>
            `[${String(position)}:v]scale=-2:${String(height)},setsar=1[v${String(position)}];` +
            `[${String(position)}:a]aresample=48000[a${String(position)}];`,
        )
        .join("");
      const refs = order.map((_, p) => `[v${String(p)}][a${String(p)}]`).join("");
      args.push(
        "-filter_complex",
        `${parts}${refs}concat=n=${String(order.length)}:v=1:a=1[v][a]`,
        "-map",
        "[v]",
        "-map",
        "[a]",
        ...h264EncodeArgs(kbps),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        out,
      );
      steps.push({ kind: "sidecar", bin: "ffmpeg", args });
    }
    return {
      steps,
      outputs: [{ from: out, baseName: `${base} (merged)`, ext: "mp4" }],
    };
  },
};

/** V8: strip the audio track, no re-encode. */
export const muteVideo: QuickAction = {
  id: "mute-video",
  menuLabel: "Mute video",
  category: "video",
  extensions: VIDEO_EXT,
  multiFile: "both",
  edition: "free",
  tier: "extended",
  buildPlan(inputs): EnginePlan {
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base, ext } = splitName(input.path);
      if (input.media && !audioStream(input.media)) {
        throw new PlanError(`"${base}" has no audio to remove.`);
      }
      const outExt = ext === "" ? "mp4" : ext;
      const temp = `{tmp}/muted-${String(i)}.${outExt}`;
      const total = durationUs(input.media);
      steps.push({
        kind: "sidecar",
        bin: "ffmpeg",
        args: ["-i", `{in${String(i)}}`, "-c", "copy", "-an", temp],
        ...(total !== undefined ? { totalUs: total } : {}),
      });
      outputs.push({ from: temp, baseName: `${base} (muted)`, ext: outExt });
    });
    return { steps, outputs };
  },
};

/** V9: a single frame at a timestamp, or a 4×4 contact sheet (§6). */
export const extractFrame: QuickAction = {
  id: "extract-frame",
  menuLabel: "Extract frame",
  category: "video",
  extensions: VIDEO_EXT,
  multiFile: "single",
  edition: "free",
  tier: "extended",
  // Fixed timestamps like "at 30 s" fail on anything shorter, so the presets
  // are all relative to the clip's own length.
  presets: [
    { label: "First frame", options: { at: "0" } },
    { label: "Middle frame", options: { mode: "middle" } },
    { label: "Contact sheet (4x4)", options: { mode: "sheet" } },
    { label: "At a time…", options: {} },
  ],
  buildPlan(inputs, opts): EnginePlan {
    const input = requireVideo(inputs[0]);
    const { base } = splitName(input.path);
    if (opts.mode === "sheet") {
      const out = "{tmp}/sheet.png";
      const duration = input.media?.durationS;
      if (typeof duration !== "number" || duration <= 0) {
        throw new PlanError(`Couldn't read the duration of "${base}".`);
      }
      // 16 frames spread evenly across the video, tiled 4×4.
      const rate = 16 / duration;
      return {
        steps: [
          {
            kind: "sidecar",
            bin: "ffmpeg",
            args: [
              "-i",
              "{in0}",
              "-vf",
              `fps=${rate.toFixed(6)},scale=320:-2,tile=4x4`,
              "-frames:v",
              "1",
              out,
            ],
          },
        ],
        outputs: [{ from: out, baseName: `${base} (contact sheet)`, ext: "png" }],
      };
    }
    const duration = input.media?.durationS;
    let at: string;
    let label: string;
    if (opts.mode === "middle") {
      if (typeof duration !== "number" || duration <= 0) {
        throw new PlanError(`Couldn't read the duration of "${base}".`);
      }
      at = (duration / 2).toFixed(3);
      label = "middle";
    } else {
      const raw = opts.at;
      if (raw === undefined || raw.trim() === "") {
        throw new NeedsOptions("prompt-frame-time");
      }
      if (!/^\d+(\.\d+)?$/.test(raw)) {
        throw new PlanError("The timestamp must be a number of seconds, e.g. 12 or 12.5.");
      }
      // Seeking past the end leaves FFmpeg with nothing to write, and the job
      // would fail later with a confusing "output missing" message.
      if (typeof duration === "number" && duration > 0 && Number(raw) >= duration) {
        throw new PlanError(
          `"${base}" is only ${duration.toFixed(1)} s long — pick a time before that.`,
        );
      }
      at = raw;
      label = `${at}s`;
    }
    const out = "{tmp}/frame.png";
    return {
      steps: [
        {
          kind: "sidecar",
          bin: "ffmpeg",
          args: ["-ss", at, "-i", "{in0}", "-frames:v", "1", "-q:v", "2", out],
        },
      ],
      outputs: [{ from: out, baseName: `${base} (frame ${label})`, ext: "png" }],
    };
  },
};

/** V10: CFR + all-intra + PCM in MOV — screen recordings editors can scrub. */
export const editingFriendly: QuickAction = {
  id: "editing-friendly",
  menuLabel: "Make editing-friendly",
  category: "video",
  extensions: VIDEO_EXT,
  multiFile: "both",
  edition: "free",
  tier: "extended",
  buildPlan(inputs): EnginePlan {
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base } = splitName(input.path);
      const stream = videoStream(input.media);
      const temp = `{tmp}/edit-${String(i)}.mov`;
      const total = durationUs(input.media);
      steps.push({
        kind: "sidecar",
        bin: "ffmpeg",
        args: [
          "-i",
          `{in${String(i)}}`,
          "-vf",
          "fps=60",
          // 0.3 bpp + every-frame-a-keyframe: big files, but that is the point.
          ...h264EncodeArgs(qualityKbps(0.3, stream?.width, stream?.height, 60)),
          "-g",
          "1",
          "-bf",
          "0",
          "-c:a",
          "pcm_s16le",
          temp,
        ],
        ...(total !== undefined ? { totalUs: total } : {}),
      });
      outputs.push({ from: temp, baseName: `${base} (editing)`, ext: "mov" });
    });
    return { steps, outputs };
  },
};

/** V11: downscale to a standard height, audio copied. */
export const downscaleVideo: QuickAction = {
  id: "downscale-video",
  menuLabel: "Downscale to",
  category: "video",
  extensions: VIDEO_EXT,
  multiFile: "both",
  edition: "free",
  tier: "extended",
  presets: [
    { label: "1080p", options: { height: "1080" } },
    { label: "720p", options: { height: "720" } },
    { label: "480p", options: { height: "480" } },
  ],
  buildPlan(inputs, opts): EnginePlan {
    const height = Number(opts.height ?? "720");
    if (![1080, 720, 480].includes(height)) {
      throw new PlanError("Choose 1080p, 720p or 480p.");
    }
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base } = splitName(input.path);
      const stream = videoStream(input.media);
      if (stream?.height !== undefined && stream.height !== null && stream.height <= height) {
        throw new PlanError(`"${base}" is already ${String(stream.height)}p or smaller.`);
      }
      const temp = `{tmp}/small-${String(i)}.mp4`;
      const total = durationUs(input.media);
      steps.push({
        kind: "sidecar",
        bin: "ffmpeg",
        args: [
          "-i",
          `{in${String(i)}}`,
          "-vf",
          `scale=-2:${String(height)}`,
          ...h264EncodeArgs(qualityKbps(0.1, Math.round((height * 16) / 9), height)),
          "-c:a",
          "copy",
          temp,
        ],
        ...(total !== undefined ? { totalUs: total } : {}),
      });
      outputs.push({ from: temp, baseName: `${base} (${String(height)}p)`, ext: "mp4" });
    });
    return { steps, outputs };
  },
};

/** V12: GIF → MP4/WebM — big GIFs become small videos. */
export const gifToVideo: QuickAction = {
  id: "gif-to-video",
  menuLabel: "GIF → video",
  category: "video",
  extensions: ["gif"],
  multiFile: "both",
  edition: "free",
  tier: "extended",
  presets: [
    { label: "MP4", options: { target: "mp4" } },
    { label: "WebM", options: { target: "webm" } },
  ],
  buildPlan(inputs, opts): EnginePlan {
    const target = opts.target ?? "mp4";
    if (target !== "mp4" && target !== "webm") {
      throw new PlanError("GIFs convert to mp4 or webm.");
    }
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base } = splitName(input.path);
      const stream = videoStream(input.media);
      const temp = `{tmp}/vid-${String(i)}.${target}`;
      // Odd GIF dimensions break yuv420p encoders; trunc keeps them even.
      const scale = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
      const codec =
        target === "webm"
          ? ["-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0"]
          : [...h264EncodeArgs(qualityKbps(0.1, stream?.width, stream?.height))];
      steps.push({
        kind: "sidecar",
        bin: "ffmpeg",
        args: [
          "-i",
          `{in${String(i)}}`,
          "-movflags",
          "+faststart",
          "-pix_fmt",
          "yuv420p",
          "-vf",
          scale,
          ...codec,
          temp,
        ],
      });
      outputs.push({ from: temp, baseName: base, ext: target });
    });
    return { steps, outputs };
  },
};
