import type { QuickAction } from "../core/action";
import { noop } from "./general/noop";
import { checksum } from "./general/checksum";
import { extractAudio } from "./video/extractAudio";
import { remuxMp4 } from "./video/remux";
import { compressVideo } from "./video/compress";
import { convertVideo } from "./video/convert";
import { videoToGif } from "./video/gif";
import { trimVideo } from "./video/trim";
import {
  downscaleVideo,
  editingFriendly,
  extractFrame,
  gifToVideo,
  mergeVideos,
  muteVideo,
} from "./video/extended";
import { convertAudio } from "./audio/convert";
import { trimAudio } from "./audio/trim";
import { boostVolume, mergeAudio, normalizeAudio } from "./audio/extended";
import { convertImage } from "./image/convert";
import { resizeImage } from "./image/resize";
import { compressImage } from "./image/compressToSize";
import { heicConvert } from "./image/heic";
import { imagesToPdf, svgToPng, viewMetadata } from "./image/extended";
import { mergePdf } from "./pdf/merge";
import { splitPdf } from "./pdf/split";
import { compressPdf } from "./pdf/compress";
import { pdfExtractText, pdfToImages, protectPdf, unlockPdf } from "./pdf/extended";

/**
 * The ordered action list — menu order follows array order, grouped by
 * category with Core items first. Adding an action is one module under
 * `src/actions/<category>/` plus one entry here (§5.1).
 */
export const actions: readonly QuickAction[] = [
  // Video
  extractAudio,
  remuxMp4,
  compressVideo,
  convertVideo,
  videoToGif,
  trimVideo,
  mergeVideos,
  muteVideo,
  extractFrame,
  editingFriendly,
  downscaleVideo,
  gifToVideo,
  // Audio
  convertAudio,
  trimAudio,
  normalizeAudio,
  mergeAudio,
  boostVolume,
  // Image
  convertImage,
  resizeImage,
  compressImage,
  heicConvert,
  imagesToPdf,
  viewMetadata,
  svgToPng,
  // PDF
  mergePdf,
  splitPdf,
  compressPdf,
  pdfToImages,
  pdfExtractText,
  protectPdf,
  unlockPdf,
  // General
  checksum,
  noop,
];

export function findAction(id: string): QuickAction | undefined {
  return actions.find((a) => a.id === id);
}

/**
 * Actions eligible for the context menu.
 * - `noop` is a test canary, never shown.
 * - `images-to-pdf` is reachable as "Convert to ▸ PDF", which is where people
 *   look for it; a second top-level entry for the same thing is just clutter.
 *   It stays registered so scripts and tests can still invoke it by id.
 */
const HIDDEN_FROM_MENU = ["noop", "images-to-pdf"];

export const menuableActions: readonly QuickAction[] = actions.filter(
  (a) => !HIDDEN_FROM_MENU.includes(a.id),
);

export function findMenuActions(disabled: readonly string[]): readonly QuickAction[] {
  return menuableActions.filter((a) => !disabled.includes(a.id));
}
