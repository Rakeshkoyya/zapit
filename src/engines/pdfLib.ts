/**
 * pdf-lib engine (§5.1 "js:" steps): merge and split run here in the webview.
 * File IO goes through the Rust bridge commands — pdf-lib only sees bytes.
 */
import { PDFDocument } from "pdf-lib";
import { invoke } from "@tauri-apps/api/core";

async function readBytes(path: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("read_file_bytes", { path });
  return new Uint8Array(buf);
}

async function writeBytes(path: string, data: Uint8Array): Promise<void> {
  // Base64 through a normal argument: raw IPC bodies proved unreliable on this
  // webview (arrive JSON-typed), and correctness beats the encoding overhead.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  await invoke("write_file_bytes", { path, dataB64: btoa(binary) });
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

async function loadPdf(path: string): Promise<PDFDocument> {
  const bytes = await readBytes(path);
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("encrypt")) {
      throw new Error(
        `"${baseName(path)}" is password-protected — unlock it first (right-click → Unlock PDF).`,
        { cause: err },
      );
    }
    throw new Error(`"${baseName(path)}" couldn't be read as a PDF.`, { cause: err });
  }
}

export interface MergeParams {
  readonly inputs: readonly string[];
  readonly out: string;
}

export async function pdfMerge(params: MergeParams): Promise<void> {
  const merged = await PDFDocument.create();
  for (const input of params.inputs) {
    const doc = await loadPdf(input);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }
  await writeBytes(params.out, await merged.save());
}

export interface ImagesToPdfParams {
  readonly pages: readonly string[];
  readonly out: string;
}

/** I5: each JPEG becomes one page sized to the image at 72 dpi, capped to A4. */
export async function imagesToPdf(params: ImagesToPdfParams): Promise<void> {
  const A4_WIDTH = 595;
  const doc = await PDFDocument.create();
  for (const page of params.pages) {
    const jpeg = await doc.embedJpg(await readBytes(page));
    const scale = jpeg.width > A4_WIDTH ? A4_WIDTH / jpeg.width : 1;
    const width = jpeg.width * scale;
    const height = jpeg.height * scale;
    doc.addPage([width, height]).drawImage(jpeg, { x: 0, y: 0, width, height });
  }
  await writeBytes(params.out, await doc.save());
}

export interface SplitGroup {
  readonly from: number;
  readonly to: number | null;
  readonly out: string;
}

export interface SplitParams {
  readonly input: string;
  readonly groups: readonly SplitGroup[];
}

export async function pdfSplit(params: SplitParams): Promise<void> {
  const doc = await loadPdf(params.input);
  const pageCount = doc.getPageCount();
  for (const group of params.groups) {
    const to = group.to ?? pageCount;
    if (group.from > pageCount) {
      throw new Error(
        `Page ${String(group.from)} doesn't exist — this PDF has ${String(pageCount)} pages.`,
      );
    }
    const end = Math.min(to, pageCount);
    const indices = [];
    for (let p = group.from; p <= end; p++) {
      indices.push(p - 1);
    }
    const part = await PDFDocument.create();
    const pages = await part.copyPages(doc, indices);
    for (const page of pages) {
      part.addPage(page);
    }
    await writeBytes(group.out, await part.save());
  }
}
