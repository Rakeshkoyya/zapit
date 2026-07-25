import { splitName, type FileInfo, type QuickAction } from "../../core/action";
import { NeedsOptions, PlanError } from "../../core/planError";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

const RASTER_EXT = ["png", "jpg", "jpeg", "webp", "bmp", "tiff", "heic", "heif"];

/** I5: multi-select images → one PDF, page order from the Reorder window. */
export const imagesToPdf: QuickAction = {
  id: "images-to-pdf",
  menuLabel: "Images → PDF",
  category: "image",
  extensions: RASTER_EXT,
  multiFile: "multi",
  edition: "free",
  tier: "extended",
  buildPlan(inputs, opts): EnginePlan {
    if (inputs.length === 0) {
      throw new PlanError("No images selected.");
    }
    if (inputs.length > 1 && opts.ordered !== "true") {
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
        throw new PlanError("The page order looks corrupted — try again.");
      }
      order = parsed;
    }
    const ordered = order.map((i) => inputs[i]).filter((f): f is FileInfo => f !== undefined);
    const { base } = splitName(ordered[0]?.path ?? "images");
    const out = "{tmp}/images.pdf";
    // Normalize every page to JPEG first: pdf-lib embeds JPEG directly, and
    // this also gives HEIC/TIFF inputs a decoder that pdf-lib lacks.
    const steps: PlanStep[] = order.map((originalIndex, position) => ({
      kind: "sidecar",
      bin: "magick",
      args: [
        `{in${String(originalIndex)}}`,
        "-auto-orient",
        "-background",
        "white",
        "-flatten",
        "-quality",
        "88",
        `{tmp}/page-${String(position)}.jpg`,
      ],
    }));
    steps.push({
      kind: "js",
      engine: "images-to-pdf",
      params: {
        pages: order.map((_, position) => `{tmp}/page-${String(position)}.jpg`),
        out,
      },
    });
    return { steps, outputs: [{ from: out, baseName: `${base} (images)`, ext: "pdf" }] };
  },
};

/**
 * I6: the Metadata window reads EXIF itself and either closes (cancel) or
 * submits `strip=true`, which turns into a metadata-free copy.
 */
export const viewMetadata: QuickAction = {
  id: "view-metadata",
  menuLabel: "View & remove metadata",
  category: "image",
  extensions: ["jpg", "jpeg", "png", "webp", "tiff", "heic", "heif"],
  multiFile: "single",
  edition: "free",
  tier: "extended",
  buildPlan(inputs, opts): EnginePlan {
    const input = inputs[0];
    if (input === undefined) {
      throw new PlanError("No input file.");
    }
    if (opts.strip !== "true") {
      throw new NeedsOptions("metadata");
    }
    const { base, ext } = splitName(input.path);
    const outExt = ext === "jpeg" ? "jpg" : ext === "" ? "jpg" : ext;
    const temp = `{tmp}/clean.${outExt}`;
    return {
      // -c copy keeps the pixels bit-identical; only the metadata goes.
      steps: [
        {
          kind: "sidecar",
          bin: "ffmpeg",
          args: ["-i", "{in0}", "-map_metadata", "-1", "-c", "copy", temp],
        },
      ],
      outputs: [{ from: temp, baseName: `${base} (no metadata)`, ext: outExt }],
    };
  },
};

/** I7: rasterize SVG at a chosen width (ImageMagick renders it — ADR 003). */
export const svgToPng: QuickAction = {
  id: "svg-to-png",
  menuLabel: "SVG → PNG",
  category: "image",
  extensions: ["svg"],
  multiFile: "both",
  edition: "free",
  tier: "extended",
  presets: [
    { label: "512 px wide", options: { width: "512" } },
    { label: "1024 px wide", options: { width: "1024" } },
    { label: "2048 px wide", options: { width: "2048" } },
  ],
  buildPlan(inputs, opts): EnginePlan {
    const width = opts.width ?? "1024";
    if (!/^\d+$/.test(width) || Number(width) < 16 || Number(width) > 8192) {
      throw new PlanError("The width must be a number between 16 and 8192 pixels.");
    }
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base } = splitName(input.path);
      const temp = `{tmp}/svg-${String(i)}.png`;
      steps.push({
        kind: "sidecar",
        bin: "magick",
        args: ["-background", "none", `{in${String(i)}}`, "-resize", `${width}x`, temp],
      });
      outputs.push({ from: temp, baseName: base, ext: "png" });
    });
    return { steps, outputs };
  },
};
