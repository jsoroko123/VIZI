const VIEWPORT_ZOOM_CACHE_KEY = "vizi_zoom_by_viewport";

function normalizeViewportKey(width, height) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  return `${w}x${h}`;
}

export function buildViewportZoomKey(screenW, screenH, canvasW, canvasH) {
  const sw = Math.max(1, Math.round(Number(screenW) || 0));
  const sh = Math.max(1, Math.round(Number(screenH) || 0));
  const cw = Math.max(1, Math.round(Number(canvasW) || 0));
  const ch = Math.max(1, Math.round(Number(canvasH) || 0));
  return `scr:${sw}x${sh}|svg:${cw}x${ch}`;
}

function parseViewportZoomKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const modern = raw.match(/^scr:(\d+)x(\d+)\|svg:(\d+)x(\d+)$/i);
  if (modern) {
    return {
      screenW: Number(modern[1]),
      screenH: Number(modern[2]),
      canvasW: Number(modern[3]),
      canvasH: Number(modern[4]),
      kind: "modern",
    };
  }
  const legacy = raw.match(/^(\d+)x(\d+)$/);
  if (legacy) {
    return {
      screenW: NaN,
      screenH: NaN,
      canvasW: Number(legacy[1]),
      canvasH: Number(legacy[2]),
      kind: "legacy",
    };
  }
  return null;
}

export function getViewportZoomKey(fallbackRect = null) {
  if (typeof window !== "undefined") {
    const screenW =
      Number(window.screen?.width) > 0
        ? Number(window.screen.width)
        : Number(window.innerWidth) || 0;
    const screenH =
      Number(window.screen?.height) > 0
        ? Number(window.screen.height)
        : Number(window.innerHeight) || 0;
    const canvasW =
      Number(fallbackRect?.width) > 0
        ? Number(fallbackRect.width)
        : Number(window.innerWidth) || 0;
    const canvasH =
      Number(fallbackRect?.height) > 0
        ? Number(fallbackRect.height)
        : Number(window.innerHeight) || 0;
    if (screenW > 0 && screenH > 0 && canvasW > 0 && canvasH > 0) {
      return buildViewportZoomKey(screenW, screenH, canvasW, canvasH);
    }
  }
  const w = Number(fallbackRect?.width) || 0;
  const h = Number(fallbackRect?.height) || 0;
  if (w > 0 && h > 0) return normalizeViewportKey(w, h);
  return "";
}

export function resolveZoomForViewportMap(mapValue, viewportKey) {
  const map = normalizeZoomByViewportMap(mapValue);
  const key = String(viewportKey || "").trim();
  if (!key) return NaN;
  const exact = Number(map[key]);
  if (Number.isFinite(exact)) return exact;
  const target = parseViewportZoomKey(key);
  if (!target) return NaN;
  let bestZoom = NaN;
  let bestScore = Infinity;
  for (const [k, zRaw] of Object.entries(map)) {
    const parsed = parseViewportZoomKey(k);
    const z = Number(zRaw);
    if (!parsed || !Number.isFinite(z)) continue;
    const canvasScore =
      Math.abs(parsed.canvasW - target.canvasW) + Math.abs(parsed.canvasH - target.canvasH);
    const screenScore =
      Number.isFinite(parsed.screenW) &&
      Number.isFinite(parsed.screenH) &&
      Number.isFinite(target.screenW) &&
      Number.isFinite(target.screenH)
        ? Math.abs(parsed.screenW - target.screenW) + Math.abs(parsed.screenH - target.screenH)
        : 0;
    const legacyPenalty =
      parsed.kind === "legacy" && Number.isFinite(target.screenW) && Number.isFinite(target.screenH)
        ? 250
        : 0;
    const score = canvasScore + screenScore + legacyPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestZoom = z;
    }
  }
  return Number.isFinite(bestZoom) ? bestZoom : NaN;
}

export function normalizeZoomByViewportMap(value) {
  const src = value && typeof value === "object" ? value : {};
  const out = {};
  for (const [rawKey, rawZoom] of Object.entries(src)) {
    const key = String(rawKey || "").trim();
    if (!parseViewportZoomKey(key)) continue;
    const z = Number(rawZoom);
    if (!Number.isFinite(z) || z <= 0) continue;
    out[key] = z;
  }
  return out;
}

export function readViewportZoomCache() {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(VIEWPORT_ZOOM_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeViewportZoomCache(nextCache) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VIEWPORT_ZOOM_CACHE_KEY, JSON.stringify(nextCache || {}));
  } catch {
    // ignore storage errors
  }
}

export function getViewportZoomCacheLastKey(projectId, screenId) {
  const pid = String(projectId || "").trim();
  const sid = String(screenId || "").trim();
  if (!pid || !sid) return "";
  return `${pid}|${sid}|@last`;
}

export function resolveZoomFromViewportCache(cacheValue, projectId, screenId, viewportKey) {
  const cache = cacheValue && typeof cacheValue === "object" ? cacheValue : {};
  const pid = String(projectId || "").trim();
  const sid = String(screenId || "").trim();
  const vkey = String(viewportKey || "").trim();
  if (!sid || !vkey) return NaN;
  const directKey = pid ? `${pid}|${sid}|${vkey}` : "";
  const directZoom = directKey ? Number(cache[directKey]) : NaN;
  if (Number.isFinite(directZoom)) return directZoom;
  const target = parseViewportZoomKey(vkey);
  if (!target) return NaN;
  let bestZoom = NaN;
  let bestScore = Infinity;
  for (const [cacheKeyRaw, rawZoom] of Object.entries(cache)) {
    const cacheKey = String(cacheKeyRaw || "");
    const parts = cacheKey.split("|");
    if (parts.length < 3) continue;
    const keyProjectId = String(parts[0] || "").trim();
    const keyScreenId = String(parts[1] || "").trim();
    const keyViewport = parts.slice(2).join("|");
    if (keyScreenId !== sid) continue;
    if (pid && keyProjectId && keyProjectId !== pid) continue;
    const parsed = parseViewportZoomKey(keyViewport);
    const z = Number(rawZoom);
    if (!parsed || !Number.isFinite(z)) continue;
    const canvasScore =
      Math.abs(parsed.canvasW - target.canvasW) + Math.abs(parsed.canvasH - target.canvasH);
    const screenScore =
      Number.isFinite(parsed.screenW) &&
      Number.isFinite(parsed.screenH) &&
      Number.isFinite(target.screenW) &&
      Number.isFinite(target.screenH)
        ? Math.abs(parsed.screenW - target.screenW) + Math.abs(parsed.screenH - target.screenH)
        : 0;
    const legacyPenalty =
      parsed.kind === "legacy" && Number.isFinite(target.screenW) && Number.isFinite(target.screenH)
        ? 250
        : 0;
    const score = canvasScore + screenScore + legacyPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestZoom = z;
    }
  }
  return Number.isFinite(bestZoom) ? bestZoom : NaN;
}
