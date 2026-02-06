export const VB_W = 1600;
export const VB_H = 900;
export const GRID = 20;

export function snap(v, step) {
  return Math.round(v / step) * step;
}

export function fmt(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : "-";
}

export function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function pointsToAttr(points) {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

export function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clonePoints(points) {
  return points.map((p) => ({ x: p.x, y: p.y }));
}

export function closestPointOnSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;

  const ab2 = abx * abx + aby * aby;
  const t = ab2 === 0 ? 0 : (apx * abx + apy * aby) / ab2;
  const tt = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * tt, y: a.y + aby * tt, t: tt };
}

export function bboxOfPoints(points) {
  // ✅ guard
  if (!Array.isArray(points) || points.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const p of points) {
    if (!p) continue;
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  return {
    minX,
    minY,
    maxX,
    maxY,
    w: maxX - minX,
    h: maxY - minY,
  };
}


export function toggleIn(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
