// Generates the §13 PDF test assets with pdf-lib. Run: node scripts/make-test-pdfs.mjs
// mixed.pdf is deliberately image-heavy (~10 MB) — it is the M4 gate input.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const assets = new URL("../test/assets/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const magick = new URL("../src-tauri/sidecars/magick.exe", import.meta.url).pathname.replace(
  /^\/(\w:)/,
  "$1",
);

function makeJpeg(dir, name, size, extra = []) {
  const out = join(dir, name);
  execFileSync(magick, ["-size", size, ...extra, "plasma:fractal", "-quality", "97", out]);
  return readFileSync(out);
}

async function textPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= 12; p++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Zapit test document — page ${p}`, {
      x: 60,
      y: 780,
      size: 18,
      font,
    });
    for (let line = 0; line < 40; line++) {
      page.drawText(
        `Line ${line + 1}: the quick brown fox jumps over the lazy dog, ${p}·${line}.`,
        { x: 60, y: 740 - line * 16, size: 11, font, color: rgb(0.15, 0.15, 0.15) },
      );
    }
  }
  writeFileSync(join(assets, "text.pdf"), await doc.save());
}

async function imagePdf(fileName, pages, jpegSize, targetLabel) {
  const work = mkdtempSync(join(tmpdir(), "qt-pdf-"));
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const jpegBytes = makeJpeg(work, `pg${p}.jpg`, jpegSize);
    const jpeg = await doc.embedJpg(jpegBytes);
    const page = doc.addPage([595, 842]);
    page.drawImage(jpeg, { x: 0, y: 120, width: 595, height: 722 });
    if (targetLabel === "mixed") {
      page.drawText(`Mixed content page ${p + 1} — selectable text below the scan.`, {
        x: 40,
        y: 60,
        size: 12,
        font,
      });
    }
  }
  writeFileSync(join(assets, fileName), await doc.save());
  rmSync(work, { recursive: true, force: true });
}

await textPdf();
if (process.argv.includes("--heavy")) {
  // The M4 gate input: a big image-heavy mixed PDF (>10 MB), not committed.
  await imagePdf("heavy/mixed-big.pdf", 8, "1653x2339", "mixed");
} else {
  await imagePdf("scanned.pdf", 2, "827x1169", "scanned");
  await imagePdf("mixed.pdf", 3, "1000x1414", "mixed");
}
console.log("PDF assets written");
