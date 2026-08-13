/**
 * Small typed builders for the bits of markup the windows assemble at runtime.
 *
 * They exist so no window has to reach for `innerHTML` to draw an icon, which
 * keeps every string in the UI text rather than markup.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** `el("span", "chip", "mp4")` — class and text are both optional. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/** A stroked 24×24-viewBox icon, rendered at `size` and inheriting colour. */
export function icon(paths: readonly string[], size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

export interface Toggle {
  readonly root: HTMLLabelElement;
  readonly input: HTMLInputElement;
}

/**
 * The pill switch from theme.css. `label` is the accessible name, since the
 * visible text sits in a sibling column rather than inside the control.
 */
export function toggle(checked: boolean, label: string): Toggle {
  const root = el("label", "switch");
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  input.setAttribute("aria-label", label);
  const track = el("span", "switch__track");
  root.append(input, track);
  return { root, input };
}
