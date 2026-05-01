import { VB_W, VB_H } from "./geometry";

function parseViewBox(svgEl) {
  const vb = svgEl.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/[ ,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
  }
  const w = Number(svgEl.getAttribute("width"));
  const h = Number(svgEl.getAttribute("height"));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { x: 0, y: 0, w, h };
  return { x: 0, y: 0, w: VB_W, h: VB_H };
}

const ROOT_PRESENTATION_ATTRS = [
  "class",
  "style",
  "fill",
  "fill-opacity",
  "fill-rule",
  "opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "vector-effect",
  "color",
];

function preserveRootPresentation(svgEl, inner) {
  const attrs = ROOT_PRESENTATION_ATTRS
    .map((name) => {
      const value = svgEl.getAttribute(name);
      return value == null || value === "" ? null : [name, value];
    })
    .filter(Boolean);
  if (!attrs.length) return inner;

  const doc = svgEl.ownerDocument;
  const wrapper = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  attrs.forEach(([name, value]) => wrapper.setAttribute(name, value));
  wrapper.innerHTML = inner;
  return wrapper.outerHTML;
}

export function stripOuterSvg(svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) return null;

  // remove scripts
  doc.querySelectorAll("script").forEach((n) => n.remove());

  // remove on* handlers
  const all = doc.querySelectorAll("*");
  all.forEach((el) => {
    [...el.attributes].forEach((a) => {
      if (a.name.toLowerCase().startsWith("on")) el.removeAttribute(a.name);
    });
  });

  const inner = preserveRootPresentation(svgEl, svgEl.innerHTML);
  const vb = parseViewBox(svgEl);
  return { inner, vb };
}
