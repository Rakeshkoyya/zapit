/**
 * I2's resize-spec parser (§6), phrased the way government upload forms phrase
 * it: `50%` · `800x600` · `800w` / `600h` · `3.5x4.5cm@200dpi`.
 */

export interface ResizeSpec {
  /** ImageMagick geometry string; `!` forces exact WxH (aspect handled upstream). */
  readonly geometry: string;
  /** Output DPI metadata for physical (cm) specs. */
  readonly densityDpi?: number;
}

const CM_PER_INCH = 2.54;

export function parseResizeSpec(text: string): ResizeSpec | undefined {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");

  const percent = /^(\d+(?:\.\d+)?)%$/.exec(t);
  if (percent?.[1] !== undefined) {
    const value = Number(percent[1]);
    return value > 0 && value <= 1000 ? { geometry: `${String(value)}%` } : undefined;
  }

  const cm = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)cm@(\d+)dpi$/.exec(t);
  if (cm?.[1] !== undefined && cm[2] !== undefined && cm[3] !== undefined) {
    const dpi = Number(cm[3]);
    if (dpi < 30 || dpi > 1200) {
      return undefined;
    }
    const w = Math.round((Number(cm[1]) / CM_PER_INCH) * dpi);
    const h = Math.round((Number(cm[2]) / CM_PER_INCH) * dpi);
    return w > 0 && h > 0 ? { geometry: `${String(w)}x${String(h)}!`, densityDpi: dpi } : undefined;
  }

  const px = /^(\d+)x(\d+)$/.exec(t);
  if (px?.[1] !== undefined && px[2] !== undefined) {
    const w = Number(px[1]);
    const h = Number(px[2]);
    return w > 0 && h > 0 ? { geometry: `${String(w)}x${String(h)}!` } : undefined;
  }

  const oneSide = /^(\d+)([wh])$/.exec(t);
  if (oneSide?.[1] !== undefined && oneSide[2] !== undefined) {
    const n = Number(oneSide[1]);
    if (n <= 0) {
      return undefined;
    }
    // Magick geometry: `800` fits width, `x600` fits height (aspect kept).
    return { geometry: oneSide[2] === "w" ? String(n) : `x${String(n)}` };
  }

  return undefined;
}
