import { describe, expect, it } from "vitest";
import {
  formatSegments,
  invertSegments,
  MIN_SEGMENT_S,
  normalizeSegments,
  parseSegments,
  totalSeconds,
  type Segment,
} from "../../src/core/segments";

const seg = (startS: number, endS: number): Segment => ({ startS, endS });

describe("parseSegments", () => {
  it("reads comma-separated start-end pairs", () => {
    expect(parseSegments("1.5-3.2,10-12.75")).toEqual([seg(1.5, 3.2), seg(10, 12.75)]);
  });

  it("accepts m:ss on either side, like the single-range boxes did", () => {
    expect(parseSegments("1:30-2:00")).toEqual([seg(90, 120)]);
  });

  it("tolerates spaces and trailing commas", () => {
    expect(parseSegments(" 1-2 , 3-4 ,")).toEqual([seg(1, 2), seg(3, 4)]);
  });

  it("rejects malformed input rather than guessing", () => {
    expect(parseSegments("")).toBeUndefined();
    expect(parseSegments("1")).toBeUndefined();
    expect(parseSegments("1-2-3")).toBeUndefined();
    expect(parseSegments("a-b")).toBeUndefined();
  });

  it("round-trips through formatSegments", () => {
    const text = "0.5-1.25,4-9.75";
    expect(formatSegments(parseSegments(text) ?? [])).toBe(text);
  });
});

describe("normalizeSegments", () => {
  it("sorts by start time", () => {
    expect(normalizeSegments([seg(5, 6), seg(1, 2)])).toEqual([seg(1, 2), seg(5, 6)]);
  });

  it("fuses overlapping and touching regions into one clip", () => {
    expect(normalizeSegments([seg(1, 5), seg(3, 8)])).toEqual([seg(1, 8)]);
    expect(normalizeSegments([seg(1, 3), seg(3, 6)])).toEqual([seg(1, 6)]);
  });

  it("clamps to the duration instead of failing", () => {
    expect(normalizeSegments([seg(1, 99)], 5.024)).toEqual([seg(1, 5.024)]);
  });

  it("drops regions that are too short to cut", () => {
    expect(normalizeSegments([seg(2, 2), seg(4, 4 + MIN_SEGMENT_S / 2)])).toEqual([]);
  });

  it("drops regions that start past the end of the file", () => {
    expect(normalizeSegments([seg(90, 120)], 30)).toEqual([]);
  });

  it("repairs a backwards region rather than discarding it", () => {
    expect(normalizeSegments([seg(8, 3)])).toEqual([seg(3, 8)]);
  });
});

describe("invertSegments", () => {
  it("returns the gaps around the marked regions", () => {
    expect(invertSegments([seg(10, 20)], 60)).toEqual([seg(0, 10), seg(20, 60)]);
  });

  it("keeps nothing when the whole file is marked", () => {
    expect(invertSegments([seg(0, 60)], 60)).toEqual([]);
  });

  it("keeps everything when nothing is marked", () => {
    expect(invertSegments([], 60)).toEqual([seg(0, 60)]);
  });

  it("handles a region touching each end", () => {
    expect(invertSegments([seg(0, 5), seg(55, 60)], 60)).toEqual([seg(5, 55)]);
  });

  it("normalizes before inverting, so overlaps do not produce slivers", () => {
    expect(invertSegments([seg(10, 30), seg(20, 40)], 60)).toEqual([seg(0, 10), seg(40, 60)]);
  });

  it("without a duration there is nothing to invert against", () => {
    expect(invertSegments([seg(1, 2)], 0)).toEqual([]);
  });
});

describe("totalSeconds", () => {
  it("sums the assembled output length", () => {
    expect(totalSeconds([seg(0, 10), seg(20, 25)])).toBe(15);
  });

  it("is zero for an empty selection", () => {
    expect(totalSeconds([])).toBe(0);
  });
});
