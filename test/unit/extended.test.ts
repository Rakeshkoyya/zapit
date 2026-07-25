import { describe, expect, it } from "vitest";
import type { FileInfo } from "../../src/core/action";
import type { MediaInfo } from "../../src/core/media";
import type { PlanStep } from "../../src/core/plan";
import { NeedsOptions, PlanError } from "../../src/core/planError";
import {
  downscaleVideo,
  editingFriendly,
  extractFrame,
  gifToVideo,
  mergeVideos,
  muteVideo,
} from "../../src/actions/video/extended";
import { boostVolume, mergeAudio, normalizeAudio } from "../../src/actions/audio/extended";
import { imagesToPdf, svgToPng, viewMetadata } from "../../src/actions/image/extended";
import { convertImage } from "../../src/actions/image/convert";
import { pdfExtractText, pdfToImages, protectPdf, unlockPdf } from "../../src/actions/pdf/extended";
import { checksum } from "../../src/actions/general/checksum";
import { actions } from "../../src/actions/registry";

const H264: MediaInfo = {
  durationS: 5,
  streams: [
    { kind: "video", codec: "h264", width: 1920, height: 1080, vfr: false },
    { kind: "audio", codec: "aac", width: null, height: null, vfr: false },
  ],
};
const VP9: MediaInfo = {
  durationS: 5,
  streams: [{ kind: "video", codec: "vp9", width: 1280, height: 720, vfr: false }],
};
const MP3: MediaInfo = {
  durationS: 3,
  streams: [{ kind: "audio", codec: "mp3", width: null, height: null, vfr: false }],
};

function file(path: string, media: MediaInfo | null = null, sizeBytes = 1024): FileInfo {
  return { path, sizeBytes, media };
}

const A = file("C:\\v\\a.mp4", H264);
const B = file("C:\\v\\b.mp4", H264);
const WEB = file("C:\\v\\c.webm", VP9);
const TONE = file("C:\\a\\tone.mp3", MP3);
const TONE2 = file("C:\\a\\tone2.mp3", MP3);
const PHOTO = file("C:\\i\\photo.jpg");
const DOC = file("C:\\d\\report.pdf", null, 5 * 1024 * 1024);

function args(step: PlanStep | undefined): readonly string[] {
  return step?.kind === "sidecar" ? step.args : [];
}

describe("V7 merge videos", () => {
  it("uses the concat demuxer when streams match", () => {
    const plan = mergeVideos.buildPlan([A, B], { ordered: "true" });
    expect(plan.steps[0]?.kind).toBe("write-text");
    expect(args(plan.steps[1])).toContain("concat");
    expect(args(plan.steps[1])).toContain("copy");
  });

  it("falls back to the concat filter for mismatched clips", () => {
    const plan = mergeVideos.buildPlan([A, WEB], { ordered: "true" });
    expect(plan.steps).toHaveLength(1);
    expect(args(plan.steps[0]).join(" ")).toContain("concat=n=2:v=1:a=1");
  });

  it("needs the reorder window and at least two files", () => {
    expect(() => mergeVideos.buildPlan([A, B], {})).toThrow(NeedsOptions);
    expect(() => mergeVideos.buildPlan([A], { ordered: "true" })).toThrow(/at least two/);
  });
});

describe("V8-V12", () => {
  it("V8 mute strips audio without re-encoding", () => {
    const plan = muteVideo.buildPlan([A], {});
    expect(args(plan.steps[0])).toEqual(expect.arrayContaining(["-c", "copy", "-an"]));
  });

  it("V8 refuses a video that has no audio", () => {
    const silent = file("C:\\v\\s.mp4", {
      durationS: 5,
      streams: [{ kind: "video", codec: "h264", width: 640, height: 480, vfr: false }],
    });
    expect(() => muteVideo.buildPlan([silent], {})).toThrow(/no audio/);
  });

  it("V9 refuses a timestamp past the end of the clip", () => {
    // A 5 s clip cannot yield a frame at 30 s; FFmpeg would exit 0 writing
    // nothing and the job would fail with a baffling "output missing".
    expect(() => extractFrame.buildPlan([A], { at: "30" })).toThrow(/only 5.0 s long/);
  });

  it("V9 middle-frame preset seeks to half the duration", () => {
    const a = args(extractFrame.buildPlan([A], { mode: "middle" }).steps[0]);
    expect(a[a.indexOf("-ss") + 1]).toBe("2.500");
  });

  it("V9 renders one frame or a tiled sheet", () => {
    expect(args(extractFrame.buildPlan([A], { at: "2" }).steps[0])).toContain("-frames:v");
    const sheet = args(extractFrame.buildPlan([A], { mode: "sheet" }).steps[0]).join(" ");
    expect(sheet).toContain("tile=4x4");
    // 16 frames across a 5 s clip.
    expect(sheet).toContain("fps=3.200000");
  });

  it("V9 rejects a non-numeric timestamp", () => {
    expect(() => extractFrame.buildPlan([A], { at: "later" })).toThrow(PlanError);
  });

  it("V9 asks for a time when the custom preset is used", () => {
    expect(() => extractFrame.buildPlan([A], {})).toThrow(NeedsOptions);
  });

  it("I1 takes the first frame when converting an animated GIF", () => {
    const gif = file("C:\\i\\anim.gif", { durationS: 2, streams: [] });
    const a = args(convertImage.buildPlan([gif], { target: "png" }).steps[0]);
    expect(a).toEqual(expect.arrayContaining(["-frames:v", "1", "-update", "1"]));
  });

  it("V10 forces CFR, all-intra and PCM audio", () => {
    const a = args(editingFriendly.buildPlan([A], {}).steps[0]);
    expect(a).toEqual(expect.arrayContaining(["-vf", "fps=60", "-g", "1", "-bf", "0"]));
    expect(a).toContain("pcm_s16le");
  });

  it("V11 downscales and refuses upscaling", () => {
    expect(args(downscaleVideo.buildPlan([A], { height: "720" }).steps[0])).toContain(
      "scale=-2:720",
    );
    expect(() => downscaleVideo.buildPlan([A], { height: "1080" })).toThrow(/already/);
    expect(() => downscaleVideo.buildPlan([A], { height: "4000" })).toThrow(PlanError);
  });

  it("V12 keeps GIF dimensions even for yuv420p", () => {
    const gif = file("C:\\v\\anim.gif", { durationS: 2, streams: [] });
    expect(args(gifToVideo.buildPlan([gif], {}).steps[0]).join(" ")).toContain(
      "scale=trunc(iw/2)*2",
    );
  });
});

describe("A3-A5", () => {
  it("A3 emits the two-pass loudnorm step", () => {
    const plan = normalizeAudio.buildPlan([TONE], {});
    expect(plan.steps[0]?.kind).toBe("loudnorm");
  });

  it("A4 concat-copies matching codecs", () => {
    const plan = mergeAudio.buildPlan([TONE, TONE2], { ordered: "true" });
    expect(plan.steps[0]?.kind).toBe("write-text");
    expect(args(plan.steps[1])).toContain("concat");
  });

  it("A5 validates the gain factor", () => {
    expect(args(boostVolume.buildPlan([TONE], { factor: "2" }).steps[0])).toContain("volume=2");
    expect(() => boostVolume.buildPlan([TONE], { factor: "9" })).toThrow(PlanError);
    expect(() => boostVolume.buildPlan([TONE], { factor: "0.5" })).toThrow(PlanError);
  });
});

describe("I5-I7", () => {
  it("I1 'Convert to > PDF' reaches the images-to-pdf builder", () => {
    // The discoverable path: people look for PDF among the other formats.
    const plan = convertImage.buildPlan([PHOTO], { target: "pdf" });
    expect(plan.outputs[0]?.ext).toBe("pdf");
    expect(plan.steps.at(-1)?.kind).toBe("js");
  });

  it("I5 flattens each image then builds one PDF", () => {
    const plan = imagesToPdf.buildPlan([PHOTO, file("C:\\i\\b.png")], { ordered: "true" });
    expect(plan.steps.filter((s) => s.kind === "sidecar")).toHaveLength(2);
    expect(plan.steps.at(-1)?.kind).toBe("js");
  });

  it("I5 skips the reorder window for a single image", () => {
    expect(() => imagesToPdf.buildPlan([PHOTO], {})).not.toThrow();
  });

  it("I6 opens the metadata window, then strips with -map_metadata -1", () => {
    expect(() => viewMetadata.buildPlan([PHOTO], {})).toThrow(NeedsOptions);
    const plan = viewMetadata.buildPlan([PHOTO], { strip: "true" });
    expect(args(plan.steps[0])).toEqual(
      expect.arrayContaining(["-map_metadata", "-1", "-c", "copy"]),
    );
  });

  it("I7 rasterizes SVG at a validated width", () => {
    expect(args(svgToPng.buildPlan([file("C:\\i\\v.svg")], { width: "512" }).steps[0])).toContain(
      "512x",
    );
    expect(() => svgToPng.buildPlan([file("C:\\i\\v.svg")], { width: "0" })).toThrow(PlanError);
  });
});

describe("P4-P6", () => {
  it("P4 renders pages at a valid DPI and declares no static outputs", () => {
    const plan = pdfToImages.buildPlan([DOC], { dpi: "300" });
    expect(plan.steps[0]?.kind).toBe("pdf-render");
    expect(plan.outputs).toHaveLength(0);
    expect(() => pdfToImages.buildPlan([DOC], { dpi: "500" })).toThrow(PlanError);
  });

  it("P5 emits a pdf-text step per input", () => {
    expect(pdfExtractText.buildPlan([DOC], {}).steps[0]?.kind).toBe("pdf-text");
  });

  it("P6 protect and unlock prompt for a password first", () => {
    expect(() => protectPdf.buildPlan([DOC], {})).toThrow(NeedsOptions);
    expect(() => unlockPdf.buildPlan([DOC], {})).toThrow(NeedsOptions);
    expect(args(protectPdf.buildPlan([DOC], { password: "s3cret" }).steps[0])).toContain(
      "--encrypt",
    );
    expect(args(unlockPdf.buildPlan([DOC], { password: "s3cret" }).steps[0])).toContain(
      "--decrypt",
    );
  });
});

describe("G1 checksum", () => {
  it("defaults to sha256 and validates the algorithm", () => {
    const plan = checksum.buildPlan([PHOTO], {});
    const step = plan.steps[0];
    expect(step?.kind).toBe("checksum");
    if (step?.kind === "checksum") {
      expect(step.algorithm).toBe("sha256");
    }
    expect(plan.outputs).toHaveLength(0);
    expect(() => checksum.buildPlan([PHOTO], { algorithm: "crc32" })).toThrow(PlanError);
  });
});

describe("registry integrity", () => {
  // 15 Core + 17 Extended (P6 ships as protect + unlock) + the noop canary.
  it("registers all 33 v1 actions with unique kebab-case ids", () => {
    expect(actions).toHaveLength(33);
    const ids = actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("has no Pro actions (ADR 001)", () => {
    expect(actions.every((a) => a.edition === "free")).toBe(true);
  });
});

describe("menu presets (§7.3 — clicks beat dialogs)", () => {
  /**
   * Every action that reads an option must either offer presets or open a
   * window; otherwise a right-click silently picks a default the user never
   * chose. That bug shipped once — compress always targeted 25 MB.
   */
  const NEEDS_CHOICE = [
    "compress-video",
    "convert-video",
    "convert-audio",
    "convert-image",
    "downscale-video",
    "extract-frame",
  ];

  it.each(NEEDS_CHOICE)("%s offers a preset submenu", (id) => {
    const action = actions.find((a) => a.id === id);
    expect(action?.presets?.length ?? 0).toBeGreaterThan(1);
  });

  it("preset labels are unique per action and non-empty", () => {
    for (const action of actions) {
      const labels = (action.presets ?? []).map((p) => p.label);
      expect(new Set(labels).size).toBe(labels.length);
      for (const label of labels) {
        expect(label.trim()).not.toBe("");
      }
    }
  });

  it("every preset produces a usable plan or a clear prompt", () => {
    const sample: Record<string, FileInfo> = {
      "compress-video": file("C:\\v\\a.mp4", H264, 500 * 1024 * 1024),
      "convert-video": file("C:\\v\\a.mkv", H264),
      "convert-audio": file("C:\\a\\a.wav", MP3),
      "convert-image": file("C:\\i\\a.jpg"),
      "downscale-video": file("C:\\v\\a.mp4", {
        durationS: 5,
        streams: [{ kind: "video", codec: "h264", width: 3840, height: 2160, vfr: false }],
      }),
      "extract-frame": file("C:\\v\\a.mp4", H264),
    };
    for (const [id, input] of Object.entries(sample)) {
      const action = actions.find((a) => a.id === id);
      for (const preset of action?.presets ?? []) {
        try {
          const plan = action?.buildPlan([input], preset.options);
          expect(plan?.steps.length ?? 0).toBeGreaterThan(0);
        } catch (err) {
          if (err instanceof NeedsOptions) {
            // A preset with no options is the "ask me" entry — correct.
            expect(Object.keys(preset.options)).toHaveLength(0);
          } else {
            // The only other acceptable refusal is "the file is already that
            // format/size" — anything else means the preset is broken.
            expect(err).toBeInstanceOf(PlanError);
            expect((err as PlanError).message).toMatch(/already/);
          }
        }
      }
    }
  });
});
