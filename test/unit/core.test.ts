import { describe, expect, it } from "vitest";
import { bppForBitrate, computeBudget } from "../../src/core/videoMath";
import { parseSeconds } from "../../src/core/time";
import { splitName } from "../../src/core/action";

describe("computeBudget", () => {
  it("splits the 97% budget between video and 128k audio", () => {
    const b = computeBudget(25, 5.024);
    expect(b.audioKbps).toBe(128);
    expect(b.videoKbps).toBe(39413);
  });

  it("drops audio to 96k when the video lane gets thin", () => {
    // 10 MB over 10 minutes: ~132 kbps total.
    const b = computeBudget(10, 600);
    expect(b.audioKbps).toBe(96);
  });

  it("never changes resolution — that is Downscale's job", () => {
    // Whatever the budget, the result carries no resolution instruction.
    const thin = computeBudget(10, 600);
    expect(Object.keys(thin).sort()).toEqual(["audioKbps", "videoKbps"]);
  });

  it("rejects nonsense", () => {
    expect(() => computeBudget(0, 10)).toThrow(RangeError);
    expect(() => computeBudget(10, 0)).toThrow(RangeError);
  });
});

describe("bppForBitrate", () => {
  it("computes bits per pixel at a resolution", () => {
    // 1080p30 at 6220 kbps ≈ 0.1 bpp.
    expect(bppForBitrate(6220, 1920, 1080)).toBeCloseTo(0.1, 2);
  });

  it("falls back to 720p when dimensions are unknown", () => {
    expect(bppForBitrate(2765, null, null)).toBeCloseTo(0.1, 2);
  });
});

describe("parseSeconds", () => {
  it("accepts plain seconds, m:ss and h:mm:ss.f", () => {
    expect(parseSeconds("90")).toBe(90);
    expect(parseSeconds("90.5")).toBe(90.5);
    expect(parseSeconds("1:30")).toBe(90);
    expect(parseSeconds("1:02:03.5")).toBe(3723.5);
  });

  it("rejects garbage", () => {
    expect(parseSeconds("")).toBeUndefined();
    expect(parseSeconds("1:2:3:4")).toBeUndefined();
    expect(parseSeconds("abc")).toBeUndefined();
    expect(parseSeconds("-5")).toBeUndefined();
  });
});

describe("splitName", () => {
  it("splits base and lowercased extension", () => {
    expect(splitName("C:\\a\\Video.Final.MP4")).toEqual({ base: "Video.Final", ext: "mp4" });
    expect(splitName("C:\\a\\noext")).toEqual({ base: "noext", ext: "" });
    expect(splitName("C:/fwd/slash.mkv")).toEqual({ base: "slash", ext: "mkv" });
  });
});
