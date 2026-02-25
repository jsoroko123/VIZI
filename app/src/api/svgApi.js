import { requestJson, requestText } from "./http";

export function listSvgCatalog() {
  return requestJson("/api/svg/catalog", { fallbackError: "Failed to load SVG catalog." });
}

export function saveSvgMeta(payloadOrWidth, height) {
  const payload =
    payloadOrWidth && typeof payloadOrWidth === "object"
      ? payloadOrWidth
      : { width: payloadOrWidth, height };
  return requestJson("/__vizi__/set-svg-meta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    fallbackError: "Failed to set SVG meta.",
  });
}

export function readSvgRaw(reqUrl, forceFresh = false) {
  return requestText(reqUrl, forceFresh ? { cache: "no-store" } : undefined);
}
