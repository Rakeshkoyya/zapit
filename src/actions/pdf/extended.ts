import { splitName, type QuickAction } from "../../core/action";
import { NeedsOptions, PlanError } from "../../core/planError";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

/** P4: one PNG per page at a chosen DPI (outputs are appended at runtime). */
export const pdfToImages: QuickAction = {
  id: "pdf-to-images",
  menuLabel: "PDF → images",
  category: "pdf",
  extensions: ["pdf"],
  multiFile: "both",
  edition: "free",
  tier: "extended",
  presets: [
    { label: "Screen (72 dpi)", options: { dpi: "72" } },
    { label: "Standard (150 dpi)", options: { dpi: "150" } },
    { label: "Print (300 dpi)", options: { dpi: "300" } },
  ],
  buildPlan(inputs, opts): EnginePlan {
    const dpi = Number(opts.dpi ?? "150");
    if (![72, 150, 300].includes(dpi)) {
      throw new PlanError("Choose 72, 150 or 300 DPI.");
    }
    const steps: PlanStep[] = inputs.map((_, i) => ({
      kind: "pdf-render",
      input: `{in${String(i)}}`,
      outPattern: `{tmp}/page-${String(i)}-{n}.png`,
      dpi,
    }));
    // Page count is unknown until pdfium opens the file, so the runner appends
    // the real outputs; the plan declares none.
    return { steps, outputs: [] };
  },
};

/** P5: text layer → .txt; scanned PDFs get an honest "no text here" message. */
export const pdfExtractText: QuickAction = {
  id: "pdf-extract-text",
  menuLabel: "Extract text",
  category: "pdf",
  extensions: ["pdf"],
  multiFile: "both",
  edition: "free",
  tier: "extended",
  buildPlan(inputs): EnginePlan {
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base } = splitName(input.path);
      const temp = `{tmp}/text-${String(i)}.txt`;
      steps.push({ kind: "pdf-text", input: `{in${String(i)}}`, out: temp });
      outputs.push({ from: temp, baseName: base, ext: "txt" });
    });
    return { steps, outputs };
  },
};

/** P6a: add a password (qpdf AES-256). Not a cracker — see P6b. */
export const protectPdf: QuickAction = {
  id: "protect-pdf",
  menuLabel: "Protect with password…",
  category: "pdf",
  extensions: ["pdf"],
  multiFile: "both",
  edition: "free",
  tier: "extended",
  buildPlan(inputs, opts): EnginePlan {
    const password = opts.password;
    if (password === undefined || password === "") {
      throw new NeedsOptions("prompt-password-set");
    }
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base } = splitName(input.path);
      const temp = `{tmp}/locked-${String(i)}.pdf`;
      steps.push({
        kind: "sidecar",
        bin: "qpdf",
        // Same user and owner password: one password to open, no false sense
        // of "owner-only" restrictions (every reader ignores those anyway).
        args: ["--encrypt", password, password, "256", "--", `{in${String(i)}}`, temp],
      });
      outputs.push({ from: temp, baseName: `${base} (protected)`, ext: "pdf" });
    });
    return { steps, outputs };
  },
};

/** P6b: remove a password you already know (qpdf --decrypt). */
export const unlockPdf: QuickAction = {
  id: "unlock-pdf",
  menuLabel: "Unlock PDF…",
  category: "pdf",
  extensions: ["pdf"],
  multiFile: "both",
  edition: "free",
  tier: "extended",
  buildPlan(inputs, opts): EnginePlan {
    const password = opts.password;
    if (password === undefined || password === "") {
      throw new NeedsOptions("prompt-password");
    }
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base } = splitName(input.path);
      const temp = `{tmp}/unlocked-${String(i)}.pdf`;
      steps.push({
        kind: "sidecar",
        bin: "qpdf",
        args: [`--password=${password}`, "--decrypt", `{in${String(i)}}`, temp],
      });
      outputs.push({ from: temp, baseName: `${base} (unlocked)`, ext: "pdf" });
    });
    return { steps, outputs };
  },
};
