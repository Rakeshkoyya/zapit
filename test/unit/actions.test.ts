import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FileInfo } from "../../src/core/action";
import type { EnginePlan } from "../../src/core/plan";
import type { MediaInfo } from "../../src/core/media";
import { NeedsOptions, PlanError } from "../../src/core/planError";
import { extractAudio } from "../../src/actions/video/extractAudio";
import { remuxMp4 } from "../../src/actions/video/remux";
import { compressVideo } from "../../src/actions/video/compress";
import { convertVideo } from "../../src/actions/video/convert";
import { videoToGif } from "../../src/actions/video/gif";
import { trimVideo } from "../../src/actions/video/trim";
import { convertAudio } from "../../src/actions/audio/convert";
import { trimAudio } from "../../src/actions/audio/trim";

function golden(name: string): EnginePlan {
  const url = new URL(`../golden/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as EnginePlan;
}

const H264_AAC: MediaInfo = {
  durationS: 5.024,
  streams: [
    { kind: "video", codec: "h264", width: 1920, height: 1080, vfr: false },
    { kind: "audio", codec: "aac", width: null, height: null, vfr: false },
  ],
};

const MP3: MediaInfo = {
  durationS: 2,
  streams: [{ kind: "audio", codec: "mp3", width: null, height: null, vfr: false }],
};

function file(path: string, media: MediaInfo | null, sizeBytes = 123): FileInfo {
  return { path, sizeBytes, media };
}

const MKV = file("C:\\clips\\video.mkv", H264_AAC);
const TONE = file("C:\\music\\tone.mp3", MP3);

describe("golden plans (V1-V6, A1-A2)", () => {
  it("V1 extract-audio stream-copies aac into m4a", () => {
    expect(extractAudio.buildPlan([MKV], {})).toEqual(golden("extract-audio"));
  });

  it("V2 remux-mp4 copies compatible streams", () => {
    expect(remuxMp4.buildPlan([MKV], {})).toEqual(golden("remux-mp4"));
  });

  it("V3 compress builds a bitrate-targeted plan for 25 MB (ADR 002)", () => {
    const big = file("C:\\clips\\video.mkv", H264_AAC, 100 * 1024 * 1024);
    expect(compressVideo.buildPlan([big], { targetMb: "25" })).toEqual(golden("compress-video"));
  });

  it("V4 convert mov->mp4 detects the remux fast path", () => {
    const mov = file("C:\\clips\\video.mov", H264_AAC);
    expect(convertVideo.buildPlan([mov], { target: "mp4" })).toEqual(golden("convert-video"));
  });

  it("V5 gif uses two-pass palettegen", () => {
    expect(videoToGif.buildPlan([MKV], {})).toEqual(golden("video-to-gif"));
  });

  it("V6 trim re-encodes precisely by default", () => {
    expect(trimVideo.buildPlan([MKV], { start: "1", end: "3" })).toEqual(golden("trim-video"));
  });

  it("A1 convert mp3->wav", () => {
    expect(convertAudio.buildPlan([TONE], { target: "wav" })).toEqual(golden("convert-audio"));
  });

  it("A2 trim mp3 cuts with stream copy", () => {
    expect(trimAudio.buildPlan([TONE], { start: "0.5", end: "1.5" })).toEqual(golden("trim-audio"));
  });
});

describe("plan guards", () => {
  it("V1 rejects videos with no audio track", () => {
    const silent = file("C:\\clips\\muted.mp4", {
      durationS: 5,
      streams: [{ kind: "video", codec: "h264", width: 640, height: 480, vfr: true }],
    });
    expect(() => extractAudio.buildPlan([silent], {})).toThrow(PlanError);
  });

  it("V2 rejects codecs mp4 cannot hold and suggests convert", () => {
    const vp9 = file("C:\\clips\\web.webm", {
      durationS: 5,
      streams: [{ kind: "video", codec: "vp9", width: 640, height: 480, vfr: false }],
    });
    expect(() => remuxMp4.buildPlan([vp9], {})).toThrow(/Convert to MP4/);
  });

  it("V3 refuses when the file is already small enough", () => {
    expect(() => compressVideo.buildPlan([MKV], { targetMb: "25" })).toThrow(/already under/);
  });

  it("V3 never downscales — resolution is Downscale's job", () => {
    const big = file("C:\\clips\\video.mkv", H264_AAC, 500 * 1024 * 1024);
    // A tight target that the old code would have answered by shrinking to 480p.
    const plan = compressVideo.buildPlan([big], { targetMb: "15" });
    const a = plan.steps[0]?.kind === "sidecar" ? plan.steps[0].args.join(" ") : "";
    expect(a).not.toContain("scale=");
    expect(a).not.toContain("-vf");
  });

  it("V3 refuses a target too small to be watchable at full resolution", () => {
    // 1080p for an hour cannot live in 15 MB without dropping resolution.
    const long = file(
      "C:\\clips\\long.mp4",
      { durationS: 3600, streams: H264_AAC.streams },
      2_000_000_000,
    );
    expect(() => compressVideo.buildPlan([long], { targetMb: "15" })).toThrow(
      /too small for this video|Downscale/,
    );
  });

  it("V3 asks for a size when the Custom preset is used", () => {
    const big = file("C:\\clips\\video.mkv", H264_AAC, 500 * 1024 * 1024);
    expect(() => compressVideo.buildPlan([big], {})).toThrow(NeedsOptions);
  });

  it("V3 quality presets scale the bitrate with the source resolution", () => {
    const hd = file("C:\\clips\\hd.mp4", H264_AAC);
    const sd = file("C:\\clips\\sd.mp4", {
      durationS: 5,
      streams: [{ kind: "video", codec: "h264", width: 640, height: 360, vfr: false }],
    });
    const bitrate = (f: FileInfo): number => {
      const plan = compressVideo.buildPlan([f], { quality: "balanced" });
      const args = plan.steps[0]?.kind === "sidecar" ? plan.steps[0].args : [];
      const i = args.indexOf("-b:v");
      return Number((args[i + 1] ?? "0").replace("k", ""));
    };
    // 1080p carries 9× the pixels of 360p, so it must get a far bigger budget.
    expect(bitrate(hd)).toBeGreaterThan(bitrate(sd) * 5);
  });

  it("V6/A2 ask for the trim window when options are missing", () => {
    expect(() => trimVideo.buildPlan([MKV], {})).toThrow(NeedsOptions);
    expect(() => trimAudio.buildPlan([TONE], {})).toThrow(NeedsOptions);
  });

  it("A1 refuses same-format conversion", () => {
    expect(() => convertAudio.buildPlan([TONE], { target: "mp3" })).toThrow(/already MP3/);
  });

  it("V6 clamps end to the duration instead of failing", () => {
    const plan = trimVideo.buildPlan([MKV], { start: "1", end: "99" });
    const args = plan.steps[0]?.kind === "sidecar" ? plan.steps[0].args : [];
    expect(args).toContain("5.024");
  });
});
