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

  const inner = svgEl.innerHTML;
  const vb = parseViewBox(svgEl);
  return { inner, vb };
}
