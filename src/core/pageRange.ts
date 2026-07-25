/**
 * P2's range grammar (§6): `1-3,7,9-` — 1-indexed, comma-separated groups,
 * open end means "to the last page". Each group becomes one output PDF.
 */

export interface PageGroup {
  readonly from: number;
  /** undefined = open end ("9-"). */
  readonly to: number | undefined;
  /** The spec as typed, for output naming: "pages 1-3". */
  readonly label: string;
}

export function parsePageRanges(text: string): PageGroup[] | undefined {
  const groups: PageGroup[] = [];
  for (const part of text.split(",")) {
    const t = part.trim();
    if (t === "") {
      return undefined;
    }
    const single = /^(\d+)$/.exec(t);
    const range = /^(\d+)-(\d*)$/.exec(t);
    if (single?.[1] !== undefined) {
      const n = Number(single[1]);
      if (n < 1) {
        return undefined;
      }
      groups.push({ from: n, to: n, label: `page ${String(n)}` });
    } else if (range?.[1] !== undefined && range[2] !== undefined) {
      const from = Number(range[1]);
      const to = range[2] === "" ? undefined : Number(range[2]);
      if (from < 1 || (to !== undefined && to < from)) {
        return undefined;
      }
      groups.push({
        from,
        to,
        label:
          to === undefined ? `pages ${String(from)}-end` : `pages ${String(from)}-${String(to)}`,
      });
    } else {
      return undefined;
    }
  }
  return groups.length > 0 ? groups : undefined;
}
