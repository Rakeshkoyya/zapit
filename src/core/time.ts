/** Timestamp parsing for trim inputs: `90`, `90.5`, `1:30`, `1:02:03.5`. */
export function parseSeconds(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") {
    return undefined;
  }
  const parts = trimmed.split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p))) {
    return undefined;
  }
  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + Number(part);
  }
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** Seconds → FFmpeg-friendly `S.mmm` string (never locale formatted). */
export function formatSeconds(seconds: number): string {
  return (Math.round(seconds * 1000) / 1000).toString();
}
