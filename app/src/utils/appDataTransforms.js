export function normalizeProjectPlcEntries(raw, options = {}) {
  const includeRawText = options?.includeRawText !== false;
  const maxRawText =
    Number.isFinite(Number(options?.maxRawText)) && Number(options.maxRawText) > 0
      ? Math.floor(Number(options.maxRawText))
      : null;
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item, idx) => {
      const analysis = item?.analysis && typeof item.analysis === "object" ? item.analysis : null;
      const rawText = includeRawText ? String(item?.rawText || "") : "";
      const normalizedRaw = maxRawText == null ? rawText : rawText.slice(0, maxRawText);
      return {
        id: String(item?.id || `plc-${idx + 1}`),
        name: String(item?.name || "").trim(),
        size: Number.isFinite(Number(item?.size)) ? Number(item.size) : 0,
        uploadedAt: Number.isFinite(Number(item?.uploadedAt)) ? Number(item.uploadedAt) : Date.now(),
        debugSessionId: String(item?.debugSessionId || "").trim(),
        rawText: normalizedRaw,
        analysis,
        chatHistory: Array.isArray(item?.chatHistory)
          ? item.chatHistory
              .map((msg) => ({
                role: String(msg?.role || "").toLowerCase() === "assistant" ? "assistant" : "user",
                content: String(msg?.content || "").slice(0, 8000),
              }))
              .filter((msg) => String(msg.content || "").trim())
              .slice(-80)
          : [],
        opcPlan: item?.opcPlan && typeof item.opcPlan === "object" ? item.opcPlan : null,
      };
    })
    .filter((item) => item.name || item.rawText);
}

export function getFolderFromKey(key) {
  const parts = String(key).split("/");
  const i = parts.findIndex((p) => p === "SVG_Files" || p === "SVG Files");
  if (i >= 0) {
    const rest = parts.slice(i + 1);
    if (rest.length <= 1) return "Root";
    return rest.slice(0, -1).join(" / ");
  }
  if (parts.length <= 2) return "Root";
  return parts.slice(0, -1).slice(-1)[0] || "Root";
}

export function tokenizeSvgCatalogText(value) {
  return Array.from(
    new Set(
      String(value || "")
        .replace(/[_/.-]+/g, " ")
        .replace(/\.svg$/i, "")
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean)
    )
  );
}

export function normalizeTagValue(value) {
  return String(value || "")
    .replace(/\r?\n/g, "")
    .trim();
}

export function normalizeTableDisplayName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function normalizeAlarmOperatorValue(value) {
  const op = String(value || "").trim();
  return ["==", "!=", ">", ">=", "<", "<="].includes(op) ? op : "==";
}

export function isTruthyFlag(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const raw = String(value).trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}
