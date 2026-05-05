// src/components/PropertiesPanel.jsx
import { useEffect, useMemo, useRef, useState } from "react";

const closeBtnStyle = {
  border: "1px solid var(--border)",
  background: "var(--bg-elev)",
  borderRadius: 10,
  padding: "6px 9px",
  cursor: "pointer",
  lineHeight: 1,
  color: "var(--text)",
  minHeight: 30,
  whiteSpace: "nowrap",
};

// ✅ Shared compact control style (actual height shrink)
const controlStyle = {
  boxSizing: "border-box",
  height: 26,
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "0 8px",
  fontSize: 12,
  lineHeight: "26px",
  outline: "none",
  width: "100%",
  background: "var(--bg-elev)",
  color: "var(--text)",
};

const labelStyle = {
  color: "var(--text-muted)",
  alignSelf: "center",
  fontSize: 12,
  lineHeight: "26px",
};

const btnStyle = {
  border: "1px solid var(--border)",
  background: "var(--bg-elev)",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  color: "var(--text)",
  boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
  minHeight: 30,
  whiteSpace: "nowrap",
};
const MIN_PANEL_HEIGHT = 280;
const MAX_PANEL_HEIGHT = 500;

function Row({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  showHex = false,
  disabled = false,
}) {
  const textValue = value ?? "";
  const isColor = type === "color";

  const commit = () => onBlur?.();
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      e.currentTarget.blur();
    }
  };

  return (
    <>
      <div style={labelStyle}>{label}</div>
      {isColor && showHex ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="color"
            value={textValue || "#000000"}
            onChange={(e) => onChange(e.target.value)}
            onBlur={commit}
            style={{
              width: 44,
              height: 34,
              padding: 0,
              borderRadius: 10,
              border: "1px solid #d6d6d6",
              background: "var(--bg-elev)",
              cursor: "pointer",
            }}
          />
          <input
            type="text"
            value={textValue}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            style={controlStyle}
          />
        </div>
      ) : (
        <input
          type={type}
          value={textValue}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          style={controlStyle}
        />
      )}
    </>
  );
}

function SelectRow({
  label,
  value,
  onChange,
  onBlur,
  options,
  searchable = false,
  searchPlaceholder = "Search tags...",
}) {
  const [query, setQuery] = useState("");
  const safeOptions = Array.isArray(options) ? options : [];

  const filteredOptions = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!searchable || !q) return safeOptions;

    const filtered = safeOptions.filter((opt) =>
      `${opt?.group || ""} ${opt?.label || ""} ${opt?.value || ""}`.toLowerCase().includes(q)
    );

    const selectedValue = value ?? safeOptions?.[0]?.value ?? "";
    if (
      selectedValue !== "" &&
      !filtered.some((opt) => String(opt.value) === String(selectedValue))
    ) {
      const selected = safeOptions.find((opt) => String(opt.value) === String(selectedValue));
      if (selected) return [selected, ...filtered];
    }

    return filtered;
  }, [query, safeOptions, searchable, value]);

  const hasGroups = useMemo(() => filteredOptions?.some((opt) => opt.group), [filteredOptions]);
  const grouped = useMemo(
    () =>
      hasGroups
        ? filteredOptions.reduce((acc, opt) => {
            const key = opt.group || "Other";
            if (!acc.has(key)) acc.set(key, []);
            acc.get(key).push(opt);
            return acc;
          }, new Map())
        : null,
    [hasGroups, filteredOptions]
  );

  return (
    <>
      <div style={labelStyle}>{label}</div>
      <div style={{ display: "grid", gap: 6 }}>
        {searchable && (
          <input
            type="text"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            style={controlStyle}
          />
        )}
        <select
          value={value ?? safeOptions?.[0]?.value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          style={{
            ...controlStyle,
            cursor: "pointer",
            lineHeight: "normal",
          }}
        >
          {filteredOptions.length === 0 ? (
            <option value="" disabled>
              No matches
            </option>
          ) : hasGroups ? (
            Array.from(grouped.entries()).map(([group, opts]) => (
              <optgroup key={group} label={group}>
                {opts.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </optgroup>
            ))
          ) : (
            filteredOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          )}
        </select>
      </div>
    </>
  );
}

function splitSeriesTags(value) {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
}

function inferGroupNameFromTag(tag) {
  const explicit = String(tag?.groupName || "").trim();
  if (explicit) return explicit;
  const rawPath = String(tag?.tagPath || tag?.name || "").trim();
  if (!rawPath) return "";
  const dot = rawPath.indexOf(".");
  if (dot > 0) return rawPath.slice(0, dot).trim();
  return "";
}

function cleanTypeDisplayName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutProvider = raw.replace(/^\[[^\]]+\]/, "").trim();
  const parts = withoutProvider.split(/[\\/]/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : withoutProvider;
}

const NON_UDT_TYPE_IDS = new Set([
  "atomic",
  "client",
  "derived",
  "document",
  "expression",
  "folder",
  "memory",
  "opc",
  "query",
  "reference",
  "system",
]);

function isUdtTypeCandidate(typeId, objectType) {
  const cleaned = cleanTypeDisplayName(typeId);
  if (!cleaned) return false;
  const objectText = String(objectType || "").trim().toLowerCase();
  if (objectText.includes("udt")) return true;
  return !NON_UDT_TYPE_IDS.has(cleaned.toLowerCase());
}

function getTagTypeDisplayName(tag) {
  const explicit = cleanTypeDisplayName(tag?.udtName || tag?.udtType || tag?.templateName || "");
  if (explicit) return explicit;
  const typeId = cleanTypeDisplayName(tag?.typeId || "");
  if (isUdtTypeCandidate(typeId, tag?.objectType)) return typeId;
  return cleanTypeDisplayName(
    tag?.dataType ||
      tag?.plcType ||
      tag?.uaType ||
      typeId ||
      ""
  );
}

function normalizeTypeMatchToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[[^\]]+\]/, "")
    .replace(/\.(svg|json)$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function collectTypeMatchTokens(...values) {
  const tokens = new Set();
  values.forEach((value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    const whole = normalizeTypeMatchToken(raw);
    if (whole) tokens.add(whole);
    raw
      .replace(/^\[[^\]]+\]/, "")
      .split(/[\s._:/\\|()[\]{}<>-]+/)
      .map(normalizeTypeMatchToken)
      .filter(Boolean)
      .forEach((token) => {
        tokens.add(token);
        if (token.startsWith("udt") && token.length > 3) {
          tokens.add(token.slice(3));
        }
      });
  });
  return tokens;
}

function isDiverterTypeToken(value) {
  const token = normalizeTypeMatchToken(value);
  return token.includes("diverter") || token.includes("twoway");
}

function usesTwoWayUdtTypeToken(value) {
  const token = normalizeTypeMatchToken(value);
  return isDiverterTypeToken(token) || token === "gate";
}

function tagMatchesEType(tag, eType) {
  const filterToken = normalizeTypeMatchToken(eType);
  if (!filterToken) return true;
  const typeTokens = collectTypeMatchTokens(
    tag?.udtName,
    tag?.udtType,
    tag?.templateName,
    tag?.typeId,
    tag?.dataType,
    tag?.plcType,
    tag?.uaType
  );
  if (!typeTokens.size) return false;
  if (typeTokens.has(filterToken)) return true;
  if (usesTwoWayUdtTypeToken(filterToken)) {
    for (const token of typeTokens) {
      if (usesTwoWayUdtTypeToken(token)) return true;
    }
  }
  for (const token of typeTokens) {
    if (filterToken.length >= 3 && token.endsWith(filterToken)) return true;
    if (token.length >= 3 && filterToken.endsWith(token)) return true;
  }
  return false;
}

export default function PropertiesPanel({
  showHUD,
  setShowHUD,
  selectedBBox,
  selCount,
  isSingle,
  singleKind,
  selectedIds,
  selectedOverlayIds,
  singleOverlayId,
  svgFiles,
  svgTemplateKey,
  swapSvgTemplate,
  svgTemplateName,
  isGeneratedTemplate,
  renameSvgTemplate,
  persistSvgMeta,
  panelAnchor,
  panelAnchorKey,
  panelCursor,
  freezePanel,
  hudFields,
  setHudFields,
  applySingleId,
  applySingleTagPath,
  applyOverlayGroupTagPath,
  applySingleBinBinding,
  applySingleEType,
  applySinglePopupParamsJson,
  applySingleDiverterMode,
  applySingleFill,
  applySingleStroke,
  applySingleSvgStrokeWidth,
  applySingleSvgStatic,
  applySingleSvgFlip,
  applySingleSvgRotation,
  applySingleFaultSim,
  applyOverlaySpacing,
  applyBBoxFromHud,

  applySingleArrowStart,
  applySingleArrowEnd,

  // polyline
  applySingleLineStyle,
  convertPolylinesToSvg,

  // ✅ NEW (text)
  applySingleTextValue,
  applySingleFontSize,
  applySingleFontFamily,
  applySingleFontWeight,
  applySingleTextAlign,
  applySingleWidgetSettings,

  opcTags,
  svgETypeOptions,
  svgBinOptions,
  duplicateOffset,
  setDuplicateOffset,
  bounds,
  docked = false,
  dockLeft = 0,
  dockTop = 0,
  dockBottom = 0,
  dockWidth = 360,
  dockMinWidth = 280,
  dockMaxWidth = 640,
  resizableDocked = true,
  onDockWidthChange,
}) {
  const [bboxDraft, setBboxDraft] = useState({ x: "", y: "", w: "", h: "" });
  const [bboxAspectLocked, setBboxAspectLocked] = useState(true);
  const [panelPos, setPanelPos] = useState({ x: 16, y: 16 });
  const [userMoved, setUserMoved] = useState(false);
  const [btnPulse, setBtnPulse] = useState({ apply: false, convert: false });
  const [dupDraft, setDupDraft] = useState(String(duplicateOffset ?? 20));
  const [spacingDraft, setSpacingDraft] = useState("20");
  const [templateNameDraft, setTemplateNameDraft] = useState(svgTemplateName || "");
  const dragRef = useRef({ dragging: false, ox: 0, oy: 0 });
  const dockResizeRef = useRef({ resizing: false, startX: 0, startWidth: 0 });
  const panelRef = useRef(null);
  const skipAutoPosRef = useRef(false);
  const onDockWidthChangeRef = useRef(onDockWidthChange);
  const isSvgHud = isSingle && singleKind === "SVG";
  const safeBounds = useMemo(() => {
    const left = Number.isFinite(bounds?.left) ? bounds.left : 8;
    const top = Number.isFinite(bounds?.top) ? bounds.top : 8;
    const right = Number.isFinite(bounds?.right) ? bounds.right : 8;
    const bottom = Number.isFinite(bounds?.bottom) ? bounds.bottom : 8;
    return { left, top, right, bottom };
  }, [bounds]);
  const resolvedDockMinWidth = Math.max(240, Number(dockMinWidth) || 280);
  const resolvedDockMaxWidth = Math.max(
    resolvedDockMinWidth,
    Number(dockMaxWidth) || 640
  );
  const resolvedDockWidth = Math.min(
    resolvedDockMaxWidth,
    Math.max(resolvedDockMinWidth, Number(dockWidth) || 360)
  );
  const dockCanResize = docked && resizableDocked && typeof onDockWidthChange === "function";
  const [dockResizing, setDockResizing] = useState(false);

  useEffect(() => {
    onDockWidthChangeRef.current = onDockWidthChange;
  }, [onDockWidthChange]);

  const baseTagOptions = useMemo(() => {
    const options = [{ value: "", label: "Select tag" }];
    const seen = new Set([""]);
    (opcTags || []).forEach((tag) => {
      const topic = String(tag?.topic || "Default");
      const raw = String(tag?.tagPath || tag?.name || "").trim();
      if (!raw) return;
      const dedupe = raw.toLowerCase();
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      const name = String(tag?.name || raw).trim();
      const typeName = getTagTypeDisplayName(tag);
      const group = typeName || topic || "Tags";
      const label = typeName && typeName !== name ? `${name || raw} (${typeName})` : name || raw;
      options.push({ value: raw, label, group, udtName: typeName });
    });
    return options;
  }, [opcTags]);

  const baseTagOptionValueSet = useMemo(
    () =>
      new Set(
        baseTagOptions
          .map((opt) => String(opt?.value || "").trim().toLowerCase())
          .filter(Boolean)
      ),
    [baseTagOptions]
  );

  const tagOptions = useMemo(() => {
    const current = String(hudFields?.tagPath || "").trim();
    if (!current || baseTagOptionValueSet.has(current.toLowerCase())) return baseTagOptions;
    return [...baseTagOptions, { value: current, label: current, group: "Custom" }];
  }, [baseTagOptionValueSet, baseTagOptions, hudFields?.tagPath]);

  const baseSvgTagGroupOptions = useMemo(() => {
    const eType = String(hudFields?.eType || "").trim();
    const emptyLabel = eType ? `Select ${eType} tag` : "Select tag group";
    const options = [{ value: "", label: emptyLabel }];
    const seen = new Set([""]);
    (opcTags || []).forEach((tag) => {
      if (!tagMatchesEType(tag, eType)) return;
      const topic = String(tag?.topic || "Default").trim() || "Default";
      const groupName = inferGroupNameFromTag(tag);
      if (!groupName) return;
      const value = `${topic}.${groupName}`;
      const dedupe = value.toLowerCase();
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      const typeName = getTagTypeDisplayName(tag);
      const label = typeName && typeName !== groupName ? `${groupName} (${typeName})` : groupName;
      options.push({ value, label, group: typeName || topic, udtName: typeName });
    });
    return options;
  }, [hudFields?.eType, opcTags]);

  const baseSvgTagGroupValueSet = useMemo(
    () =>
      new Set(
        baseSvgTagGroupOptions
          .map((opt) => String(opt?.value || "").trim().toLowerCase())
          .filter(Boolean)
      ),
    [baseSvgTagGroupOptions]
  );

  const svgTagGroupOptions = useMemo(() => {
    const current = String(hudFields?.tagPath || "").trim();
    if (!current || baseSvgTagGroupValueSet.has(current.toLowerCase())) {
      return baseSvgTagGroupOptions;
    }
    return [...baseSvgTagGroupOptions, { value: current, label: current, group: "Custom" }];
  }, [baseSvgTagGroupOptions, baseSvgTagGroupValueSet, hudFields?.tagPath]);

  const svgBindingOptions = useMemo(() => {
    return Array.isArray(svgTagGroupOptions) ? [...svgTagGroupOptions] : [];
  }, [svgTagGroupOptions]);

  // keep latest fns for Apply (avoid stale closure)
  const latest = useRef({});
  latest.current = {
    applySingleId,
    applySingleTagPath,
    applyOverlayGroupTagPath,
    applySingleBinBinding,
    applySingleEType,
    applySinglePopupParamsJson,
    applySingleDiverterMode,
    applySingleFill,
    applySingleStroke,
    applySingleSvgStrokeWidth,
    applySingleSvgStatic,
    applySingleSvgFlip,
    applySingleFaultSim,
    applySingleArrowStart,
    applySingleArrowEnd,
    applySingleLineStyle,
    applyBBoxFromHud,
    setHudFields,

    // text
    applySingleTextValue,
    applySingleFontSize,
    applySingleFontFamily,
    applySingleFontWeight,
    applySingleTextAlign,
    applySingleWidgetSettings,
  };

  const svgETypeSelectOptions = useMemo(() => {
    const values = Array.isArray(svgETypeOptions) ? svgETypeOptions : [];
    const seen = new Set();
    const out = [{ value: "", label: "Select eType" }];
    for (const raw of values) {
      const value = String(raw || "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value, label: value });
    }
    const current = String(hudFields?.eType || "").trim();
    if (current && !seen.has(current.toLowerCase())) {
      out.push({ value: current, label: current });
    }
    return out;
  }, [svgETypeOptions, hudFields?.eType]);

  // ✅ refresh bbox draft when hudFields x/y/w/h update
  useEffect(() => {
    if (!showHUD || !selectedBBox) return;
    setBboxDraft({
      x: hudFields?.x ?? "",
      y: hudFields?.y ?? "",
      w: hudFields?.w ?? "",
      h: hudFields?.h ?? "",
    });
  }, [showHUD, selectedBBox, hudFields?.x, hudFields?.y, hudFields?.w, hudFields?.h]);

  useEffect(() => {
    setTemplateNameDraft(svgTemplateName || "");
  }, [svgTemplateName]);

  useEffect(() => {
    setDupDraft(String(duplicateOffset ?? 20));
  }, [duplicateOffset, showHUD]);

  // ESC closes panel
  useEffect(() => {
    if (!showHUD) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !isSvgHud) setShowHUD(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHUD, setShowHUD, isSvgHud]);

  useEffect(() => {
    if (!showHUD) {
      setUserMoved(false);
    }
  }, [showHUD]);

  useEffect(() => {
    if (panelAnchorKey) setUserMoved(false);
  }, [panelAnchorKey]);

  useEffect(() => {
    if (docked) return;
    if (!showHUD) return;
    if (freezePanel) return;
    if (userMoved) return;
    if (skipAutoPosRef.current) {
      skipAutoPosRef.current = false;
      return;
    }
    const rect = panelRef.current?.getBoundingClientRect();
    const panelW = rect?.width ?? 320;
    const panelH = Math.max(rect?.height ?? MIN_PANEL_HEIGHT, MIN_PANEL_HEIGHT);
    const minX = safeBounds.left;
    const minY = safeBounds.top;
    const maxX = Math.max(minX, window.innerWidth - panelW - safeBounds.right);
    const maxY = Math.max(minY, window.innerHeight - panelH - safeBounds.bottom);

    if (panelCursor && !(isSvgHud && panelAnchor)) {
      setPanelPos({
        x: Math.min(Math.max(minX, panelCursor.x), maxX),
        y: Math.min(Math.max(minY, panelCursor.y), maxY),
      });
      return;
    }

    if (!panelAnchor) return;

    const sel = {
      x: panelAnchor.x,
      y: panelAnchor.y,
      w: Math.max(panelAnchor.w ?? 0, 40),
      h: Math.max(panelAnchor.h ?? 0, 40),
    };

    const gap = isSvgHud ? 4 : 12;
    const anchorRect = {
      left: sel.x,
      right: sel.x + sel.w,
      top: sel.y,
      bottom: sel.y + sel.h,
    };
    const anchorCenterX = (anchorRect.left + anchorRect.right) / 2;
    const anchorCenterY = (anchorRect.top + anchorRect.bottom) / 2;
    const candidates = [
      { side: "right", x: anchorRect.right + gap, y: anchorCenterY - panelH / 2, order: 0 },
      { side: "left", x: anchorRect.left - panelW - gap, y: anchorCenterY - panelH / 2, order: 1 },
      { side: "below", x: anchorCenterX - panelW / 2, y: anchorRect.bottom + gap, order: 2 },
      { side: "above", x: anchorCenterX - panelW / 2, y: anchorRect.top - panelH - gap, order: 3 },
    ];
    const rectDistance = (a, b) => {
      const dx = Math.max(a.left - b.right, b.left - a.right, 0);
      const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
      return Math.hypot(dx, dy);
    };
    const edgeGap = (side, panelRect) => {
      if (side === "right") return Math.abs(panelRect.left - anchorRect.right);
      if (side === "left") return Math.abs(anchorRect.left - panelRect.right);
      if (side === "below") return Math.abs(panelRect.top - anchorRect.bottom);
      return Math.abs(anchorRect.top - panelRect.bottom);
    };
    const best = candidates
      .map((candidate) => {
        const x = Math.min(Math.max(minX, candidate.x), maxX);
        const y = Math.min(Math.max(minY, candidate.y), maxY);
        const panelRect = {
          left: x,
          right: x + panelW,
          top: y,
          bottom: y + panelH,
        };
        const overlaps = !(
          panelRect.right <= anchorRect.left ||
          panelRect.left >= anchorRect.right ||
          panelRect.bottom <= anchorRect.top ||
          panelRect.top >= anchorRect.bottom
        );
        const clampDistance = Math.hypot(x - candidate.x, y - candidate.y);
        const sidePreference = candidate.side === "right" || candidate.side === "left" ? 0 : 80;
        return {
          x,
          y,
          score:
            edgeGap(candidate.side, panelRect) * 24 +
            sidePreference +
            rectDistance(anchorRect, panelRect) * 0.15 +
            (overlaps ? 10000 : 0) +
            clampDistance * 0.4 +
            candidate.order * 0.01,
        };
      })
      .sort((left, right) => left.score - right.score)[0];

    setPanelPos({ x: best?.x ?? minX, y: best?.y ?? minY });
  }, [panelAnchorKey, panelAnchor, panelCursor, showHUD, freezePanel, docked, isSvgHud]);

  useEffect(() => {
    if (docked) return;
    function onMove(e) {
      if (!dragRef.current.dragging) return;
      const rect = panelRef.current?.getBoundingClientRect();
      const minX = safeBounds.left;
      const minY = safeBounds.top;
      const maxX = rect
        ? Math.max(minX, window.innerWidth - rect.width - safeBounds.right)
        : window.innerWidth;
      const panelH = Math.max(rect?.height ?? MIN_PANEL_HEIGHT, MIN_PANEL_HEIGHT);
      const maxY = Math.max(minY, window.innerHeight - panelH - safeBounds.bottom);
      setPanelPos({
        x: Math.min(Math.max(minX, e.clientX - dragRef.current.ox), maxX),
        y: Math.min(Math.max(minY, e.clientY - dragRef.current.oy), maxY),
      });
    }
    function onUp() {
      dragRef.current.dragging = false;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [docked, safeBounds.bottom, safeBounds.left, safeBounds.right, safeBounds.top]);

  useEffect(() => {
    if (!docked) return undefined;
    const clampWidth = (value) =>
      Math.min(resolvedDockMaxWidth, Math.max(resolvedDockMinWidth, Number(value) || resolvedDockMinWidth));
    const endResize = () => {
      if (!dockResizeRef.current.resizing) return;
      dockResizeRef.current.resizing = false;
      setDockResizing(false);
    };
    function onMove(e) {
      if (!dockResizeRef.current.resizing) return;
      const nextWidth = clampWidth(
        dockResizeRef.current.startWidth + (Number(e.clientX) - dockResizeRef.current.startX)
      );
      onDockWidthChangeRef.current?.(nextWidth);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") endResize();
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", endResize);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);
    window.addEventListener("blur", endResize);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mouseleave", endResize);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", endResize);
      window.removeEventListener("pointerup", endResize);
      window.removeEventListener("pointercancel", endResize);
      window.removeEventListener("blur", endResize);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mouseleave", endResize);
      endResize();
    };
  }, [docked, resolvedDockMaxWidth, resolvedDockMinWidth]);

  useEffect(() => {
    if (!dockResizing || typeof document === "undefined") return undefined;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor === "col-resize" ? "" : previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dockResizing]);

  const isSvg = isSvgHud;
  const isWidget = isSingle && singleKind === "Widget";
  const isPoly = isSingle && singleKind === "Polyline";
  const isText = isSingle && singleKind === "Text";
  const isStaticSvg = isSvg && Boolean(hudFields?.static || hudFields?.isStatic || hudFields?.staticSvg);
  const isBinSvg = isSvg && String(hudFields?.eType || "").trim().toLowerCase().startsWith("bin");
  const isDiverterSvg = isSvg && isDiverterTypeToken(hudFields?.eType);
  const isShapeGroup = !isSingle && (Array.isArray(selectedIds) ? selectedIds.length : 0) > 0;
  const isOverlayGroup = !isSingle && (Array.isArray(selectedOverlayIds) ? selectedOverlayIds.length : 0) > 0;
  const isStrokeGroup = !isSingle && (isShapeGroup || isOverlayGroup);

  const arrowOptions = [
    { value: "none", label: "None" },
    { value: "out", label: "Outward" },
    { value: "in", label: "Inward" },
  ];

  const lineStyleOptions = [
    { value: "solid", label: "Solid" },
    { value: "dashed", label: "Dashed" },
    { value: "dotted", label: "Dotted" },
    { value: "wavy", label: "Wavy" },
  ];

  const textAlignOptions = [
    { value: "start", label: "Left" },
    { value: "middle", label: "Center" },
    { value: "end", label: "Right" },
  ];

  const textWeightOptions = [
    { value: "300", label: "Light" },
    { value: "400", label: "Regular" },
    { value: "500", label: "Medium" },
    { value: "600", label: "SemiBold" },
    { value: "700", label: "Bold" },
  ];

  const arrowStartVal = hudFields?.arrowStart ?? "none";
  const arrowEndVal = hudFields?.arrowEnd ?? "none";
  const lineStyleVal = hudFields?.lineStyle ?? "solid";

  const textAlignVal = hudFields?.textAlign ?? hudFields?.anchor ?? "start";
  const fontSizeVal = hudFields?.fontSize ?? "24";
  const fontFamilyVal = hudFields?.fontFamily ?? "system-ui";
  const fontWeightVal = hudFields?.fontWeight ?? "400";
  const textVal = hudFields?.text ?? "Text";
  const textFillVal = hudFields?.fill ?? "#808080"; // ✅ text uses fill
  const widgetKindVal = String(hudFields?.widgetKind || "");
  const widgetTitleVal = String(hudFields?.widgetTitle || "");
  const widgetTextColorVal = String(hudFields?.widgetTextColor || "");
  const widgetButtonTextColorVal = String(hudFields?.widgetButtonTextColor || "");
  const widgetWriteModeVal = String(hudFields?.widgetWriteMode || "ignition").trim().toLowerCase() === "view"
    ? "view"
    : String(hudFields?.widgetWriteMode || "ignition").trim().toLowerCase() === "opc"
    ? "opc"
    : "ignition";
  const widgetViewPathVal = String(hudFields?.widgetViewPath || "");
  const widgetViewParamsJsonVal = String(hudFields?.widgetViewParamsJson || "{}");
  const widgetLocationVal = String(hudFields?.widgetLocation || "");
  const widgetMinVal = String(hudFields?.widgetMin ?? "0");
  const widgetMaxVal = String(hudFields?.widgetMax ?? "100");
  const widgetDecimalsVal = String(hudFields?.widgetDecimals ?? "0");
  const widgetUnitVal = String(hudFields?.widgetUnit || "");
  const widgetHistoryPointsVal = String(hudFields?.widgetHistoryPoints ?? "40");
  const widgetRowCountVal = String(hudFields?.widgetRowCount ?? "4");
  const widgetRangeFromVal = String(hudFields?.widgetRangeFrom || "");
  const widgetRangeToVal = String(hudFields?.widgetRangeTo || "");
  const widgetWindowMinutesVal = String(hudFields?.widgetWindowMinutes ?? "60");
  const widgetMaxPointsVal = String(hudFields?.widgetMaxPoints ?? "500");
  const widgetLineTensionVal = String(hudFields?.widgetLineTension ?? "0.34");
  const widgetShowPointsVal = String(hudFields?.widgetShowPoints ?? "true");
  const widgetShowLegendVal = String(hudFields?.widgetShowLegend ?? "true");
  const widgetShowGridVal = String(hudFields?.widgetShowGrid ?? "true");
  const widgetMarkSpotsVal = String(hudFields?.widgetMarkSpots ?? "true");
  const widgetMarkerSizeVal = String(hudFields?.widgetMarkerSize ?? "4.2");
  const widgetLineWidthVal = String(hudFields?.widgetLineWidth ?? "2.4");
  const widgetLineStyleVal =
    String(hudFields?.widgetLineStyle || "").trim().toLowerCase() === "step" ? "step" : "smooth";
  const widgetYAxisSideVal =
    String(hudFields?.widgetYAxisSide || "").trim().toLowerCase() === "right" ? "right" : "left";
  const widgetSeriesTagsVal = String(hudFields?.widgetSeriesTags ?? "");
  const widgetAxisModeVal = String(hudFields?.widgetAxisMode ?? "auto");
  const widgetTimerPreTagVal = String(hudFields?.widgetTimerPreTag || "");
  const widgetTimerAccTagVal = String(hudFields?.widgetTimerAccTag || "");
  const widgetBarSourceModeRaw = String(hudFields?.widgetBarSourceMode || "table").toLowerCase();
  const widgetBarSourceModeVal =
    widgetBarSourceModeRaw === "query"
      ? "query"
      : widgetBarSourceModeRaw === "tags"
      ? "tags"
      : "table";
  const widgetBarTableVal = String(hudFields?.widgetBarTable || "");
  const widgetBarFieldVal = String(hudFields?.widgetBarField || "");
  const widgetBarLabelFieldVal = String(hudFields?.widgetBarLabelField || "");
  const widgetBarQueryVal = String(hudFields?.widgetBarQuery || "");
  const widgetBarQueryValueFieldVal = String(hudFields?.widgetBarQueryValueField || "");
  const widgetBarQueryLabelFieldVal = String(hudFields?.widgetBarQueryLabelField || "");
  const [seriesSearch, setSeriesSearch] = useState("");
  const [seriesPick, setSeriesPick] = useState("");
  const selectedSeriesTags = useMemo(() => splitSeriesTags(widgetSeriesTagsVal), [widgetSeriesTagsVal]);
  const selectableSeriesTagOptions = useMemo(() => {
    const selected = new Set(selectedSeriesTags.map((x) => x.toLowerCase()));
    const q = String(seriesSearch || "").trim().toLowerCase();
    return (tagOptions || [])
      .filter((opt) => String(opt?.value || "").trim() !== "")
      .filter((opt) => {
        const v = String(opt?.value || "").trim();
        if (!v) return false;
        if (selected.has(v.toLowerCase())) return false;
        if (!q) return true;
        return `${opt?.label || ""} ${v} ${opt?.group || ""}`.toLowerCase().includes(q);
      });
  }, [tagOptions, selectedSeriesTags, seriesSearch]);
  const timerTagOptions = useMemo(() => {
    const filtered = (tagOptions || []).filter((opt) => {
      const value = String(opt?.value || "").trim().toLowerCase();
      if (!value) return true;
      return !value.startsWith("db:") && !value.startsWith("dbq:");
    });
    return filtered.length ? filtered : [{ value: "", label: "Select tag" }];
  }, [tagOptions]);
  const dbTableFieldMap = useMemo(() => {
    const map = new Map();
    (tagOptions || []).forEach((opt) => {
      const raw = String(opt?.value || "").trim();
      if (!raw.toLowerCase().startsWith("db:")) return;
      const expr = raw.slice(3).trim();
      const dot = expr.indexOf(".");
      if (dot <= 0 || dot >= expr.length - 1) return;
      const table = expr.slice(0, dot).trim();
      const field = expr.slice(dot + 1).trim();
      if (!table || !field) return;
      if (!map.has(table)) map.set(table, new Set());
      map.get(table).add(field);
    });
    return map;
  }, [tagOptions]);
  const barTableOptions = useMemo(
    () => Array.from(dbTableFieldMap.keys()).sort((a, b) => a.localeCompare(b)).map((t) => ({ value: t, label: t })),
    [dbTableFieldMap]
  );
  const barFieldOptions = useMemo(
    () =>
      Array.from(dbTableFieldMap.get(widgetBarTableVal) || [])
        .sort((a, b) => a.localeCompare(b))
        .map((f) => ({ value: f, label: f })),
    [dbTableFieldMap, widgetBarTableVal]
  );
  const isTrendChartKind =
    widgetKindVal === "lineChart" || widgetKindVal === "areaChart" || widgetKindVal === "barChart";
  const widgetSupportsWriteTarget =
    widgetKindVal === "displayBox" || widgetKindVal === "pushButton" || widgetKindVal === "onOffButton";
  const widgetSupportsOpenView =
    widgetKindVal === "pushButton" || widgetKindVal === "onOffButton";
  const widgetSupportsButtonTextColor =
    widgetKindVal === "displayBox" || widgetKindVal === "pushButton" || widgetKindVal === "onOffButton";
  const widgetUsesSeriesTagBinding =
    isWidget &&
    (widgetKindVal === "lineChart" ||
      (widgetKindVal === "barChart" && widgetBarSourceModeVal === "tags"));
  const chartMinMaxDisabled = isTrendChartKind && widgetAxisModeVal !== "manual";
  const svgBinSelectOptions = useMemo(() => {
    const base = Array.isArray(svgBinOptions) ? [...svgBinOptions] : [];
    const current = String(hudFields?.binBindingKey || "").trim();
    if (current && !base.some((opt) => String(opt?.value || "") === current)) {
      base.push({ value: current, label: current, group: "Custom" });
    }
    return base.length ? base : [{ value: "", label: "Auto-match (Tag Path/Name)" }];
  }, [svgBinOptions, hudFields?.binBindingKey]);
  const duplicateOffsetVal = dupDraft;
  const svgTemplateOptions = (svgFiles || []).map((f) => ({
    value: f.key,
    label: f.name,
  }));

  const commitBBox = () => {
    const next = { ...hudFields, ...bboxDraft };
    setHudFields(next);
    applyBBoxFromHud(next, { aspectLocked: bboxAspectLocked });
  };

  const pulseButton = (key) => {
    setBtnPulse((p) => ({ ...p, [key]: true }));
    setTimeout(() => {
      setBtnPulse((p) => ({ ...p, [key]: false }));
    }, 140);
  };

  useEffect(() => {
    if (!selectableSeriesTagOptions.length) {
      setSeriesPick("");
      return;
    }
    const current = String(seriesPick || "").trim();
    if (current && selectableSeriesTagOptions.some((opt) => String(opt.value) === current)) return;
    setSeriesPick(String(selectableSeriesTagOptions[0]?.value || ""));
  }, [selectableSeriesTagOptions, seriesPick]);

  if (!showHUD || !selectedBBox) return null;

  const commitSeriesTags = (nextTags) => {
    const text = splitSeriesTags(Array.isArray(nextTags) ? nextTags.join("\n") : nextTags).join("\n");
    const nextHud = { ...hudFields, widgetSeriesTags: text };
    setHudFields(nextHud);
    applySingleWidgetSettings?.({ ...nextHud, __seriesTagsEdited: true });
  };

  const addSeriesTag = () => {
    const pick = String(seriesPick || "").trim();
    if (!pick) return;
    commitSeriesTags([...selectedSeriesTags, pick]);
  };

  const removeSeriesTag = (value) => {
    const target = String(value || "").trim().toLowerCase();
    if (!target) return;
    commitSeriesTags(selectedSeriesTags.filter((t) => String(t).trim().toLowerCase() !== target));
  };

  const applyAll = () => {
    if (!selectedBBox) return;

    const next = { ...hudFields, ...bboxDraft };

    // 1) commit draft state + bbox transform
    latest.current.setHudFields(next);
    latest.current.applyBBoxFromHud(next, { aspectLocked: bboxAspectLocked });

    if (!isSingle) {
      latest.current.applySingleStroke?.(next.stroke);
      latest.current.applySingleFill?.(next.fill);
      return;
    }

    // 2) apply ID first
    latest.current.applySingleId?.(next.id);

    // 3) defer remaining applies to avoid selection timing issues
    setTimeout(() => {
      const a = latest.current;

      const isSeriesDrivenWidget =
        isWidget &&
        (String(next.widgetKind || "").trim() === "lineChart" ||
          (String(next.widgetKind || "").trim() === "barChart" &&
            String(next.widgetBarSourceMode || "table").trim().toLowerCase() === "tags"));
      if (!isSeriesDrivenWidget && !(isSvg && Boolean(next.static))) {
        a.applySingleTagPath?.(next.tagPath);
      }

      if (isSvg) {
        a.applySingleSvgStatic?.(Boolean(next.static));
        a.applySingleFill?.(next.fill);
        a.applySingleStroke?.(next.stroke);
        a.applySingleEType?.(next.eType);
        a.applySinglePopupParamsJson?.(next.popupParamsJson);
        a.applySingleDiverterMode?.(next.diverterMode);
        a.applySingleBinBinding?.(next.binBindingKey);
        a.applySingleSvgStrokeWidth?.(next.strokeWidth);
        a.applySingleSvgFlip?.("x", Boolean(next.flipX));
        a.applySingleSvgFlip?.("y", Boolean(next.flipY));
        a.applySingleFaultSim?.(Boolean(next.faultSimulated));
        const w = Number.parseFloat(next.w);
        const h = Number.parseFloat(next.h);
        if (Number.isFinite(w) && Number.isFinite(h)) {
          persistSvgMeta?.(w, h);
        }
        return;
      }

      if (isWidget) {
        a.applySingleWidgetSettings?.(next);
        return;
      }

      if (isPoly) {
        a.applySingleStroke?.(next.stroke);
        a.applySingleFill?.(next.fill);
        a.applySingleArrowStart?.(next.arrowStart ?? "none");
        a.applySingleArrowEnd?.(next.arrowEnd ?? "none");
        a.applySingleLineStyle?.(next.lineStyle ?? "solid");
        return;
      }

      if (isText) {
        a.applySingleTextValue?.(next.text ?? "");
        a.applySingleFontSize?.(next.fontSize);
        a.applySingleFontFamily?.(next.fontFamily);
        a.applySingleFontWeight?.(next.fontWeight);
        a.applySingleFill?.(next.fill); // ✅ text color
        a.applySingleTextAlign?.(next.textAlign ?? "start");
      }
    }, 0);
  };

  return (
    <div
      ref={panelRef}
      data-vizi-properties-panel="1"
      style={{
        position: "fixed",
        left: docked ? Math.max(0, Number(dockLeft) || 0) : panelPos.x,
        top: docked ? Math.max(0, Number(dockTop) || 0) : panelPos.y,
        bottom: docked ? Math.max(0, Number(dockBottom) || 0) : undefined,
        width: docked ? resolvedDockWidth : undefined,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        background: "color-mix(in srgb, var(--bg-elev) 92%, transparent)",
        border: "1px solid var(--border)",
        borderRadius: docked ? 0 : 12,
        padding: "10px 12px",
        fontSize: 13,
        lineHeight: 1.35,
        boxShadow: docked ? "24px 0 40px rgba(0,0,0,0.22)" : "0 6px 18px rgba(0,0,0,0.10)",
        color: "var(--text)",
        zIndex: 35,
        minWidth: docked ? resolvedDockMinWidth : 320,
        maxWidth: docked ? resolvedDockMaxWidth : undefined,
        minHeight: docked ? 0 : MIN_PANEL_HEIGHT,
        maxHeight: docked
          ? "100%"
          : `min(${MAX_PANEL_HEIGHT}px, calc(100vh - ${safeBounds.top + safeBounds.bottom + 16}px))`,
        overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (dockResizeRef.current.resizing) {
          dockResizeRef.current.resizing = false;
          setDockResizing(false);
        }
      }}
      onWheelCapture={(e) => {
        e.stopPropagation();
        if (dockResizeRef.current.resizing) {
          dockResizeRef.current.resizing = false;
          setDockResizing(false);
        }
      }}
    >
      {dockCanResize && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize properties panel"
          title="Resize properties panel"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            dockResizeRef.current = {
              resizing: true,
              startX: e.clientX,
              startWidth: resolvedDockWidth,
            };
            setDockResizing(true);
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dockResizeRef.current.resizing = false;
            setDockResizing(false);
          }}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: 10,
            cursor: "col-resize",
            zIndex: 2,
            background: dockResizing
              ? "color-mix(in srgb, var(--accent, #3b82f6) 55%, transparent)"
              : "transparent",
          }}
        />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          cursor: docked ? "default" : "move",
        }}
        onMouseDown={(e) => {
          if (docked) return;
          e.preventDefault();
          e.stopPropagation();
          dragRef.current.dragging = true;
          dragRef.current.ox = e.clientX - panelPos.x;
          dragRef.current.oy = e.clientY - panelPos.y;
          setUserMoved(true);
        }}
      >
        <div style={{ fontWeight: 800, minWidth: 0, paddingTop: 4, flex: "1 1 auto" }}>
          Selected: {selCount === 1 ? singleKind : `Group (${selCount})`}
        </div>

        <div
          style={{
            flex: "0 1 72%",
            display: "flex",
            gap: 6,
            rowGap: 6,
            alignItems: "center",
            justifyContent: "flex-end",
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          <button
            title="Apply"
            onClick={() => {
              skipAutoPosRef.current = true;
              setUserMoved(true);
              pulseButton("apply");
              applyAll();
            }}
            style={{
              ...btnStyle,
              transform: btnPulse.apply ? "scale(0.97)" : "scale(1)",
              boxShadow: btnPulse.apply ? "0 3px 10px rgba(0,0,0,0.12)" : btnStyle.boxShadow,
              transition: "transform 120ms ease, box-shadow 120ms ease",
            }}
          >
            Apply
          </button>
          <button
            title="Apply and Close"
            onClick={() => {
              skipAutoPosRef.current = true;
              setUserMoved(true);
              pulseButton("apply");
              applyAll();
              if (!isSvgHud) setShowHUD(false);
            }}
            style={{
              ...btnStyle,
              background: "var(--bg-soft)",
            }}
          >
            Apply & Close
          </button>
          {selectedIds?.length > 0 && (
            <button
              title="Convert to SVG"
              onClick={() => {
                pulseButton("convert");
                convertPolylinesToSvg();
              }}
              style={{
                ...btnStyle,
                transform: btnPulse.convert ? "scale(0.97)" : "scale(1)",
                boxShadow: btnPulse.convert ? "0 3px 10px rgba(0,0,0,0.12)" : btnStyle.boxShadow,
                transition: "transform 120ms ease, box-shadow 120ms ease",
              }}
            >
              {selectedIds.length > 1 ? "Convert Selected" : "Convert"}
            </button>
          )}
          <button title="Close" onClick={() => setShowHUD(false)} style={closeBtnStyle}>
            ✕
          </button>
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          flex: "1 1 auto",
          minHeight: 0,
          maxHeight: "100%",
          overflowY: "auto",
          overflowX: "hidden",
          paddingRight: 4,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "92px 1fr",
            columnGap: 8,
            rowGap: 6,
          }}
        >
          {isSingle && (
            <>
              <Row
                label="ID"
                value={hudFields.id}
                onChange={(v) => setHudFields((p) => ({ ...p, id: v }))}
                onBlur={() => applySingleId(hudFields.id)}
                placeholder="Element ID"
              />

            {isSvg && (
              <>
                <div style={labelStyle}>Static</div>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 26,
                    cursor: "pointer",
                    color: "var(--text)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isStaticSvg}
                    onChange={(e) => {
                      const checked = Boolean(e.target.checked);
                      setHudFields((p) => ({ ...p, static: checked }));
                      applySingleSvgStatic?.(checked);
                    }}
                  />
                  Static
                </label>
              </>
            )}

            {(!isSvg || (!isBinSvg && !isStaticSvg)) && !widgetUsesSeriesTagBinding && (
              <SelectRow
                label="Tag Path"
                value={hudFields.tagPath}
                onChange={(v) => {
                  setHudFields((p) => ({ ...p, tagPath: v }));
                  applySingleTagPath(v);
                }}
                onBlur={() => {}}
                options={isSvg ? svgBindingOptions : tagOptions}
                searchable
                searchPlaceholder={isSvg ? "Search tag groups..." : "Search tags or db binding..."}
              />
            )}
            {isWidget ? (
              <div style={{ gridColumn: "2 / 3", fontSize: 10, color: "var(--text-muted)", marginTop: -2 }}>
                {widgetUsesSeriesTagBinding
                  ? "This widget uses Series Tags below for binding."
                  : "Use tag path for OPC binding or `db:table.column` for database binding."}
              </div>
            ) : isSvg && !isBinSvg && !isStaticSvg ? (
              <div style={{ gridColumn: "2 / 3", fontSize: 10, color: "var(--text-muted)", marginTop: -2 }}>
                SVGs use tag-group bindings like `Topic.GroupName`.
              </div>
              ) : isBinSvg ? (
              <div style={{ gridColumn: "2 / 3", fontSize: 10, color: "var(--text-muted)", marginTop: -2 }}>
                Bin SVGs are database-driven. Use Bin Row binding, not Tag Path.
              </div>
              ) : null}

            {/* SVG */}
            {isSvg && (
              <>
                <SelectRow
                  label="eType"
                  value={hudFields.eType ?? ""}
                  onChange={(v) => {
                    setHudFields((p) => ({ ...p, eType: v }));
                    applySingleEType?.(v);
                  }}
                  onBlur={() => {}}
                  options={svgETypeSelectOptions}
                  searchable
                  searchPlaceholder="Search eType..."
                />
                {!isStaticSvg && (
                  <Row
                    label="Popup Params"
                    value={hudFields.popupParamsJson ?? "{}"}
                    onChange={(v) => setHudFields((p) => ({ ...p, popupParamsJson: v }))}
                    onBlur={() => applySinglePopupParamsJson?.(hudFields.popupParamsJson)}
                    placeholder='{"area":"Mill"}'
                  />
                )}
                {isDiverterSvg && (
                  <>
                    <div style={labelStyle}>Mode</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {[
                        { value: "straight", label: "Straight" },
                        { value: "divert", label: "Divert" },
                      ].map((opt) => {
                        const active =
                          String(hudFields?.diverterMode || "straight").trim().toLowerCase() === opt.value;
                        return (
                          <button
                            key={`diverter-mode-${opt.value}`}
                            type="button"
                            onClick={() => {
                              setHudFields((p) => ({ ...p, diverterMode: opt.value }));
                              applySingleDiverterMode?.(opt.value);
                            }}
                            style={{
                              ...btnStyle,
                              minHeight: 26,
                              padding: "0 10px",
                              borderRadius: 8,
                              boxShadow: "none",
                              background: active ? "var(--selected-bg)" : "var(--bg-elev)",
                              border: `1px solid ${active ? "var(--selected-border)" : "var(--border)"}`,
                              color: active ? "var(--selected-text)" : "var(--text)",
                              fontWeight: active ? 700 : 600,
                            }}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                {isBinSvg && (
                  <SelectRow
                    label="Bin Row"
                    value={String(hudFields?.binBindingKey || "")}
                    onChange={(v) => {
                      const nextValue = String(v || "");
                      setHudFields((p) => ({ ...p, binBindingKey: nextValue }));
                      applySingleBinBinding?.(nextValue);
                    }}
                    onBlur={() => {}}
                    options={svgBinSelectOptions}
                    searchable
                    searchPlaceholder="Search bins..."
                  />
                )}
                <SelectRow
                  label="SVG"
                  value={svgTemplateKey || svgTemplateOptions?.[0]?.value || ""}
                  onChange={(v) => {
                    if (!singleOverlayId) return;
                    swapSvgTemplate?.(singleOverlayId, v);
                  }}
                  onBlur={() => {}}
                  options={svgTemplateOptions}
                  searchable
                  searchPlaceholder="Search SVG library..."
                />
                {isGeneratedTemplate && (
                  <Row
                    label="UDT Name"
                    value={templateNameDraft}
                    onChange={(v) => setTemplateNameDraft(v)}
                    onBlur={() => {
                      const next = String(templateNameDraft || "").trim();
                      if (!next) {
                        setTemplateNameDraft(svgTemplateName || "");
                        return;
                      }
                      renameSvgTemplate?.(svgTemplateKey, next);
                    }}
                    placeholder="Generated.svg"
                  />
                )}
                <Row
                  label="Fill"
                  type="color"
                  showHex
                  value={hudFields.fill}
                  onChange={(v) => setHudFields((p) => ({ ...p, fill: v }))}
                  onBlur={() => applySingleFill?.(hudFields.fill)}
                  placeholder="#ffffff"
                />
              </>
              )}

            {/* Widget */}
            {isWidget && (
              <>
                <Row
                  label="Widget Type"
                  value={widgetKindVal}
                  onChange={() => {}}
                  onBlur={() => {}}
                  placeholder=""
                  disabled
                />
                <Row
                  label="Title"
                  value={widgetTitleVal}
                  onChange={(v) => setHudFields((p) => ({ ...p, widgetTitle: v }))}
                  onBlur={() => applySingleWidgetSettings?.(hudFields)}
                  placeholder="Optional title"
                />
                <Row
                  label="Text Color"
                  type="color"
                  showHex
                  value={widgetTextColorVal || "#e2e8f0"}
                  onChange={(v) => setHudFields((p) => ({ ...p, widgetTextColor: v }))}
                  onBlur={() => applySingleWidgetSettings?.(hudFields)}
                  placeholder="#e2e8f0"
                />
                {widgetSupportsButtonTextColor ? (
                  <Row
                    label="Button Text"
                    type="color"
                    showHex
                    value={widgetButtonTextColorVal || "#ffffff"}
                    onChange={(v) => setHudFields((p) => ({ ...p, widgetButtonTextColor: v }))}
                    onBlur={() => applySingleWidgetSettings?.(hudFields)}
                    placeholder="#ffffff"
                  />
                ) : null}
                {widgetSupportsWriteTarget ? (
                  <SelectRow
                    label="Action"
                    value={widgetWriteModeVal}
                    onChange={(v) => {
                      const nextMode = String(v || "").trim().toLowerCase() === "view"
                        ? "view"
                        : String(v || "").trim().toLowerCase() === "opc"
                        ? "opc"
                        : "ignition";
                      const next = { ...hudFields, widgetWriteMode: nextMode };
                      setHudFields(next);
                      applySingleWidgetSettings?.(next);
                    }}
                    onBlur={() => applySingleWidgetSettings?.(hudFields)}
                    options={[
                      { value: "ignition", label: "Ignition Tag" },
                      { value: "opc", label: "Direct OPC" },
                      ...(widgetSupportsOpenView ? [{ value: "view", label: "Open View" }] : []),
                    ]}
                  />
                ) : null}
                {widgetSupportsOpenView && widgetWriteModeVal === "view" ? (
                  <>
                    <Row
                      label="View Path"
                      value={widgetViewPathVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetViewPath: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="Views/MyPopup"
                    />
                    <div style={labelStyle}>View Params</div>
                    <textarea
                      value={widgetViewParamsJsonVal}
                      onChange={(e) => setHudFields((p) => ({ ...p, widgetViewParamsJson: e.target.value }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder='{"tagPath":"[default]MyTag"}'
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "6px 8px",
                        fontSize: 12,
                        minHeight: 72,
                        resize: "vertical",
                        background: "var(--bg-elev)",
                        color: "var(--text)",
                      }}
                    />
                  </>
                ) : null}
                {widgetKindVal === "weather" && (
                  <Row
                    label="Location"
                    value={widgetLocationVal}
                    onChange={(v) => setHudFields((p) => ({ ...p, widgetLocation: v }))}
                    onBlur={() => applySingleWidgetSettings?.(hudFields)}
                    placeholder="City, ST (e.g. Chicago, IL)"
                  />
                )}
                {(widgetKindVal === "gauge" || widgetKindVal === "kpi" || widgetKindVal === "lineChart" || widgetKindVal === "areaChart" || widgetKindVal === "barChart") && (
                  <>
                    {isTrendChartKind ? (
                      <SelectRow
                        label="Axis Mode"
                        value={widgetAxisModeVal}
                        onChange={(v) => {
                          setHudFields((p) => ({ ...p, widgetAxisMode: v }));
                          applySingleWidgetSettings?.({ ...hudFields, widgetAxisMode: v });
                        }}
                        onBlur={() => applySingleWidgetSettings?.(hudFields)}
                        options={[
                          { value: "auto", label: "Auto" },
                          { value: "manual", label: "Manual" },
                        ]}
                      />
                    ) : null}
                    <Row
                      label="Min"
                      type="number"
                      value={widgetMinVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetMin: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="0"
                      disabled={chartMinMaxDisabled}
                    />
                    <Row
                      label="Max"
                      type="number"
                      value={widgetMaxVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetMax: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="100"
                      disabled={chartMinMaxDisabled}
                    />
                  </>
                )}
                {(widgetKindVal === "kpi" || widgetKindVal === "gauge" || widgetKindVal === "lineChart" || widgetKindVal === "areaChart" || widgetKindVal === "barChart" || widgetKindVal === "displayBox") && (
                  <>
                    <Row
                      label="Decimals"
                      type="number"
                      value={widgetDecimalsVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetDecimals: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="0"
                    />
                    <Row
                      label="Unit"
                      value={widgetUnitVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetUnit: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="%, psi, C"
                    />
                  </>
                )}
                {widgetKindVal === "countdownBar" && (
                  <>
                    <SelectRow
                      label="PRE Tag"
                      value={widgetTimerPreTagVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetTimerPreTag: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      options={timerTagOptions}
                      searchable
                    />
                    <SelectRow
                      label="ACC Tag"
                      value={widgetTimerAccTagVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetTimerAccTag: v, tagPath: v || p.tagPath }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      options={timerTagOptions}
                      searchable
                    />
                    <Row
                      label="Decimals"
                      type="number"
                      value={widgetDecimalsVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetDecimals: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="1"
                    />
                    <Row
                      label="Unit"
                      value={widgetUnitVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetUnit: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="s, ms"
                    />
                  </>
                )}
                {widgetKindVal === "statusTable" && (
                  <>
                    <Row
                      label="History"
                      type="number"
                      value={widgetHistoryPointsVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetHistoryPoints: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="40"
                    />
                  </>
                )}
                {(widgetKindVal === "displayBox" || widgetKindVal === "pushButton" || widgetKindVal === "onOffButton") ? (
                  <div style={{ gridColumn: "2 / 3", fontSize: 10, color: "var(--text-muted)", marginTop: -2 }}>
                    {widgetWriteModeVal === "view"
                      ? "Clicking this widget opens the Perspective view path above."
                      : "Bind an Ignition tag or OPC item path. This widget reads live value and supports writes."}
                  </div>
                ) : null}
                {widgetKindVal === "countdownBar" ? (
                  <div style={{ gridColumn: "2 / 3", fontSize: 10, color: "var(--text-muted)", marginTop: -2 }}>
                    Bind timer PRE and ACC tags. Countdown shows PRE-ACC and percent complete.
                  </div>
                ) : null}
                {(widgetKindVal === "lineChart" || widgetKindVal === "areaChart") && (
                  <>
                    <Row
                      label="From"
                      type="datetime-local"
                      value={widgetRangeFromVal}
                      onChange={(v) =>
                        setHudFields((p) => ({
                          ...p,
                          widgetRangeFrom: v,
                          widgetDurationPreset: "",
                        }))
                      }
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder=""
                    />
                    <Row
                      label="To"
                      type="datetime-local"
                      value={widgetRangeToVal}
                      onChange={(v) =>
                        setHudFields((p) => ({
                          ...p,
                          widgetRangeTo: v,
                          widgetDurationPreset: "",
                        }))
                      }
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder=""
                    />
                  </>
                )}
                {isTrendChartKind && (
                  <>
                    <Row
                      label="Window (min)"
                      type="number"
                      value={widgetWindowMinutesVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetWindowMinutes: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="60"
                    />
                    <Row
                      label="Max Points"
                      type="number"
                      value={widgetMaxPointsVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetMaxPoints: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="500"
                    />
                  </>
                )}
                {widgetKindVal === "barChart" && (
                  <>
                    <SelectRow
                      label="Data Source"
                      value={widgetBarSourceModeVal}
                      onChange={(v) => {
                        const raw = String(v || "").toLowerCase();
                        const mode = raw === "query" ? "query" : raw === "tags" ? "tags" : "table";
                        const next = { ...hudFields, widgetBarSourceMode: mode };
                        setHudFields(next);
                        applySingleWidgetSettings?.(next);
                      }}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      options={[
                        { value: "table", label: "Table" },
                        { value: "query", label: "Query" },
                        { value: "tags", label: "Tags" },
                      ]}
                    />
                    {widgetBarSourceModeVal === "table" ? (
                      <>
                        <SelectRow
                          label="Table"
                          value={widgetBarTableVal}
                          onChange={(v) => {
                            const table = String(v || "");
                            const fieldSet = Array.from(dbTableFieldMap.get(table) || []);
                            const keepField = fieldSet.includes(widgetBarFieldVal) ? widgetBarFieldVal : (fieldSet[0] || "");
                            const keepLabel = widgetBarLabelFieldVal && fieldSet.includes(widgetBarLabelFieldVal)
                              ? widgetBarLabelFieldVal
                              : "";
                            const next = {
                              ...hudFields,
                              widgetBarTable: table,
                              widgetBarField: keepField,
                              widgetBarLabelField: keepLabel,
                            };
                            setHudFields(next);
                            applySingleWidgetSettings?.(next);
                          }}
                          onBlur={() => applySingleWidgetSettings?.(hudFields)}
                          options={barTableOptions.length ? barTableOptions : [{ value: "", label: "No DB tables" }]}
                        />
                        <SelectRow
                          label="Value Col"
                          value={widgetBarFieldVal}
                          onChange={(v) => {
                            const next = { ...hudFields, widgetBarField: String(v || "") };
                            setHudFields(next);
                            applySingleWidgetSettings?.(next);
                          }}
                          onBlur={() => applySingleWidgetSettings?.(hudFields)}
                          options={barFieldOptions.length ? barFieldOptions : [{ value: "", label: "No fields" }]}
                        />
                        <SelectRow
                          label="Label Col"
                          value={widgetBarLabelFieldVal}
                          onChange={(v) => {
                            const next = { ...hudFields, widgetBarLabelField: String(v || "") };
                            setHudFields(next);
                            applySingleWidgetSettings?.(next);
                          }}
                          onBlur={() => applySingleWidgetSettings?.(hudFields)}
                          options={[{ value: "", label: "(Auto)" }, ...barFieldOptions]}
                        />
                      </>
                    ) : widgetBarSourceModeVal === "query" ? (
                      <>
                        <div style={labelStyle}>SQL Query</div>
                        <textarea
                          value={widgetBarQueryVal}
                          onChange={(e) => setHudFields((p) => ({ ...p, widgetBarQuery: e.target.value }))}
                          onBlur={() => applySingleWidgetSettings?.(hudFields)}
                          placeholder="SELECT category, total FROM your_view LIMIT 20"
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: "6px 8px",
                            fontSize: 12,
                            minHeight: 72,
                            resize: "vertical",
                            background: "var(--bg-elev)",
                            color: "var(--text)",
                          }}
                        />
                        <Row
                          label="Value Col"
                          value={widgetBarQueryValueFieldVal}
                          onChange={(v) => setHudFields((p) => ({ ...p, widgetBarQueryValueField: v }))}
                          onBlur={() => applySingleWidgetSettings?.(hudFields)}
                          placeholder="(Auto first numeric)"
                        />
                        <Row
                          label="Label Col"
                          value={widgetBarQueryLabelFieldVal}
                          onChange={(v) => setHudFields((p) => ({ ...p, widgetBarQueryLabelField: v }))}
                          onBlur={() => applySingleWidgetSettings?.(hudFields)}
                          placeholder="(Auto first text)"
                        />
                      </>
                    ) : (
                      <div style={{ gridColumn: "2 / 3", fontSize: 11, color: "var(--text-muted)" }}>
                        Use Series Tags below. Each tag renders one bar with its live value.
                      </div>
                    )}
                    <div style={{ gridColumn: "2 / 3", fontSize: 10, color: "var(--text-muted)", marginTop: -2 }}>
                      Choose table/query dataset or use multiple live OPC tags.
                    </div>
                  </>
                )}
                {(widgetKindVal === "lineChart" || widgetKindVal === "areaChart") && (
                  <>
                    <Row
                      label="Line Smooth"
                      type="number"
                      value={widgetLineTensionVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetLineTension: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="0.34"
                    />
                    <SelectRow
                      label="Show Points"
                      value={widgetShowPointsVal}
                      onChange={(v) => {
                        setHudFields((p) => ({ ...p, widgetShowPoints: v }));
                        applySingleWidgetSettings?.({ ...hudFields, widgetShowPoints: v });
                      }}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      options={[
                        { value: "true", label: "Yes" },
                        { value: "false", label: "No" },
                      ]}
                    />
                    <SelectRow
                      label="Mark Spots"
                      value={widgetMarkSpotsVal}
                      onChange={(v) => {
                        setHudFields((p) => ({ ...p, widgetMarkSpots: v }));
                        applySingleWidgetSettings?.({ ...hudFields, widgetMarkSpots: v });
                      }}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      options={[
                        { value: "true", label: "Yes" },
                        { value: "false", label: "No" },
                      ]}
                    />
                    <Row
                      label="Spot Size"
                      type="number"
                      value={widgetMarkerSizeVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetMarkerSize: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="4.2"
                    />
                    <Row
                      label="Line Width"
                      type="number"
                      value={widgetLineWidthVal}
                      onChange={(v) => setHudFields((p) => ({ ...p, widgetLineWidth: v }))}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      placeholder="2.4"
                    />
                    <SelectRow
                      label="Line Style"
                      value={widgetLineStyleVal}
                      onChange={(v) => {
                        const mode = String(v || "").trim().toLowerCase() === "step" ? "step" : "smooth";
                        setHudFields((p) => ({ ...p, widgetLineStyle: mode }));
                        applySingleWidgetSettings?.({ ...hudFields, widgetLineStyle: mode });
                      }}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      options={[
                        { value: "smooth", label: "Smooth" },
                        { value: "step", label: "Step" },
                      ]}
                    />
                  </>
                )}
                {isTrendChartKind && (
                  <>
                    <SelectRow
                      label="Show Legend"
                      value={widgetShowLegendVal}
                      onChange={(v) => {
                        setHudFields((p) => ({ ...p, widgetShowLegend: v }));
                        applySingleWidgetSettings?.({ ...hudFields, widgetShowLegend: v });
                      }}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      options={[
                        { value: "true", label: "Yes" },
                        { value: "false", label: "No" },
                      ]}
                    />
                    <SelectRow
                      label="Show Grid"
                      value={widgetShowGridVal}
                      onChange={(v) => {
                        setHudFields((p) => ({ ...p, widgetShowGrid: v }));
                        applySingleWidgetSettings?.({ ...hudFields, widgetShowGrid: v });
                      }}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      options={[
                        { value: "true", label: "Yes" },
                        { value: "false", label: "No" },
                      ]}
                    />
                    <SelectRow
                      label="Y Axis Side"
                      value={widgetYAxisSideVal}
                      onChange={(v) => {
                        const side = String(v || "").trim().toLowerCase() === "right" ? "right" : "left";
                        setHudFields((p) => ({ ...p, widgetYAxisSide: side }));
                        applySingleWidgetSettings?.({ ...hudFields, widgetYAxisSide: side });
                      }}
                      onBlur={() => applySingleWidgetSettings?.(hudFields)}
                      options={[
                        { value: "left", label: "Left" },
                        { value: "right", label: "Right" },
                      ]}
                    />
                  </>
                )}
                {(widgetKindVal === "lineChart" || (widgetKindVal === "barChart" && widgetBarSourceModeVal === "tags")) && (
                  <>
                    <div style={labelStyle}>{widgetKindVal === "barChart" ? "Bar Tags" : "Series Tags"}</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {selectedSeriesTags.length === 0 ? (
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>No series tags selected.</span>
                        ) : (
                          selectedSeriesTags.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => removeSeriesTag(tag)}
                              title="Remove series"
                              style={{
                                border: "1px solid #f04438",
                                background: "#f04438",
                                borderRadius: 999,
                                padding: "2px 8px",
                                fontSize: 11,
                                color: "#ffffff",
                                cursor: "pointer",
                              }}
                            >
                              {tag} x
                            </button>
                          ))
                        )}
                      </div>
                      <input
                        type="text"
                        value={seriesSearch}
                        onChange={(e) => setSeriesSearch(e.target.value)}
                        placeholder="Search tags to add..."
                        style={controlStyle}
                      />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                        <select
                          value={seriesPick}
                          onChange={(e) => setSeriesPick(e.target.value)}
                          style={{ ...controlStyle, lineHeight: "normal" }}
                        >
                          {selectableSeriesTagOptions.length === 0 ? (
                            <option value="">No tags available</option>
                          ) : (
                            selectableSeriesTagOptions.map((opt) => (
                              <option key={`${opt.group || "g"}:${opt.value}`} value={opt.value}>
                                {opt.group ? `${opt.group} | ` : ""}{opt.label}
                              </option>
                            ))
                          )}
                        </select>
                        <button
                          type="button"
                          onClick={addSeriesTag}
                          style={{
                            border: "1px solid #2b6cff",
                            background: "#2b6cff",
                            color: "white",
                            borderRadius: 8,
                            padding: "0 10px",
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                          disabled={!seriesPick}
                        >
                          Add
                        </button>
                      </div>
                      <textarea
                        value={widgetSeriesTagsVal}
                        onChange={(e) => setHudFields((p) => ({ ...p, widgetSeriesTags: e.target.value }))}
                        onBlur={() => applySingleWidgetSettings?.({ ...hudFields, __seriesTagsEdited: true })}
                        placeholder="TagA,TagB or one tag per line"
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          padding: "6px 8px",
                          fontSize: 12,
                          minHeight: 54,
                          resize: "vertical",
                          background: "var(--bg-elev)",
                          color: "var(--text)",
                        }}
                      />
                    </div>
                    <div style={{ gridColumn: "2 / 3", fontSize: 10, color: "var(--text-muted)", marginTop: -2 }}>
                      {widgetKindVal === "barChart"
                        ? "Add tags with search or edit manually. One line = one bar."
                        : "Add tags with search or edit manually. One line = one series."}
                    </div>
                  </>
                )}
                {widgetKindVal === "statusTable" && (
                  <Row
                    label="Rows"
                    type="number"
                    value={widgetRowCountVal}
                    onChange={(v) => setHudFields((p) => ({ ...p, widgetRowCount: v }))}
                    onBlur={() => applySingleWidgetSettings?.(hudFields)}
                    placeholder="4"
                  />
                )}
              </>
            )}

            {/* Stroke (SVG + Polyline) */}
            {(isSvg || isPoly || isStrokeGroup) && (
              <Row
                label="Stroke"
                type="color"
                showHex
                value={hudFields.stroke}
                onChange={(v) => setHudFields((p) => ({ ...p, stroke: v }))}
                onBlur={() => applySingleStroke?.(hudFields.stroke)}
                placeholder="#111111"
              />
            )}

            {(isPoly || isShapeGroup) && (
              <Row
                label="Fill"
                type="color"
                showHex
                value={hudFields.fill}
                onChange={(v) => setHudFields((p) => ({ ...p, fill: v }))}
                onBlur={() => applySingleFill?.(hudFields.fill)}
                placeholder="#111111"
              />
            )}

            {isSvg && (
              <Row
                label="Stroke W"
                type="number"
                value={hudFields.strokeWidth}
                onChange={(v) => setHudFields((p) => ({ ...p, strokeWidth: v }))}
                onBlur={() => applySingleSvgStrokeWidth?.(hudFields.strokeWidth)}
                placeholder=""
              />
            )}

            {isSvg && (
              <Row
                label="Rotation"
                type="number"
                value={hudFields.rotation}
                onChange={(v) => setHudFields((p) => ({ ...p, rotation: v }))}
                onBlur={() => applySingleSvgRotation?.(hudFields.rotation)}
                placeholder="0"
              />
            )}

            {isSvg && (
              <>
                <div style={labelStyle}>Flip</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    ["x", "Flip H", "flipX"],
                    ["y", "Flip V", "flipY"],
                  ].map(([axis, label, field]) => {
                    const active = Boolean(hudFields?.[field]);
                    return (
                      <button
                        key={field}
                        type="button"
                        onClick={() => {
                          const next = !active;
                          setHudFields((p) => ({ ...p, [field]: next }));
                          applySingleSvgFlip?.(axis, next);
                        }}
                        style={{
                          ...btnStyle,
                          minHeight: 26,
                          padding: "3px 8px",
                          boxShadow: "none",
                          background: active ? "var(--selected-bg)" : "var(--bg-elev)",
                          border: `1px solid ${active ? "var(--selected-border)" : "var(--border)"}`,
                          color: active ? "var(--selected-text)" : "var(--text)",
                          fontWeight: active ? 700 : 600,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {isSvg && (
              <>
                <div style={labelStyle}>Fault Sim</div>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 26,
                    cursor: "pointer",
                    color: "var(--text)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(hudFields.faultSimulated)}
                    onChange={(e) => {
                      const checked = Boolean(e.target.checked);
                      setHudFields((p) => ({ ...p, faultSimulated: checked }));
                      applySingleFaultSim?.(checked);
                    }}
                  />
                  Flash red
                </label>
              </>
            )}

            {/* Polyline controls */}
            {isPoly && (
              <>
                <SelectRow
                  label="Line Style"
                  value={lineStyleVal}
                  onChange={(v) => setHudFields((p) => ({ ...p, lineStyle: v }))}
                  onBlur={() => applySingleLineStyle?.(lineStyleVal)}
                  options={lineStyleOptions}
                />

                <SelectRow
                  label="Arrow Start"
                  value={arrowStartVal}
                  onChange={(v) => setHudFields((p) => ({ ...p, arrowStart: v }))}
                  onBlur={() => applySingleArrowStart?.(arrowStartVal)}
                  options={arrowOptions}
                />

                <SelectRow
                  label="Arrow End"
                  value={arrowEndVal}
                  onChange={(v) => setHudFields((p) => ({ ...p, arrowEnd: v }))}
                  onBlur={() => applySingleArrowEnd?.(arrowEndVal)}
                  options={arrowOptions}
                />
              </>
            )}

            {/* ✅ Text controls */}
            {isText && (
              <>
                <Row
                  label="Text"
                  value={textVal}
                  onChange={(v) => setHudFields((p) => ({ ...p, text: v }))}
                  onBlur={() => applySingleTextValue?.(hudFields.text)}
                  placeholder="Label"
                />

                <Row
                  label="Font Size"
                  value={String(fontSizeVal ?? "")}
                  onChange={(v) => setHudFields((p) => ({ ...p, fontSize: v }))}
                  onBlur={() => applySingleFontSize?.(hudFields.fontSize)}
                  placeholder="24"
                />

                <Row
                  label="Color"
                  type="color"
                  showHex
                  value={textFillVal}
                  onChange={(v) => setHudFields((p) => ({ ...p, fill: v }))}
                  onBlur={() => applySingleFill?.(hudFields.fill)}
                  placeholder="#111111"
                />

                <Row
                  label="Font"
                  value={fontFamilyVal}
                  onChange={(v) => setHudFields((p) => ({ ...p, fontFamily: v }))}
                  onBlur={() => applySingleFontFamily?.(hudFields.fontFamily)}
                  placeholder="system-ui"
                />

                <SelectRow
                  label="Weight"
                  value={fontWeightVal}
                  onChange={(v) => setHudFields((p) => ({ ...p, fontWeight: v }))}
                  onBlur={() => applySingleFontWeight?.(hudFields.fontWeight)}
                  options={textWeightOptions}
                />

                <SelectRow
                  label="Align"
                  value={textAlignVal}
                  onChange={(v) => setHudFields((p) => ({ ...p, textAlign: v }))}
                  onBlur={() => applySingleTextAlign?.(hudFields.textAlign)}
                  options={textAlignOptions}
                />
              </>
            )}
            </>
          )}

          {isOverlayGroup && (
            <>
              <SelectRow
                label="Tag Path"
                value={hudFields.tagPath}
                onChange={(v) => {
                  setHudFields((p) => ({ ...p, tagPath: v }));
                  applyOverlayGroupTagPath?.(v);
                }}
                onBlur={() => {}}
                options={svgBindingOptions}
                searchable
                searchPlaceholder="Search tag groups..."
              />
              <div style={{ gridColumn: "2 / 3", fontSize: 10, color: "var(--text-muted)", marginTop: -2 }}>
                Applies to selected non-static SVG overlays.
              </div>
              <Row
                label="Spacing"
                type="number"
                value={spacingDraft}
                onChange={setSpacingDraft}
                onBlur={() => {}}
                placeholder="20"
              />
              <div style={labelStyle}>Space</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => applyOverlaySpacing?.("x", spacingDraft)}
                  style={{
                    ...btnStyle,
                    minHeight: 26,
                    padding: "0 10px",
                    borderRadius: 8,
                    boxShadow: "none",
                  }}
                >
                  Space X
                </button>
                <button
                  type="button"
                  onClick={() => applyOverlaySpacing?.("y", spacingDraft)}
                  style={{
                    ...btnStyle,
                    minHeight: 26,
                    padding: "0 10px",
                    borderRadius: 8,
                    boxShadow: "none",
                  }}
                >
                  Space Y
                </button>
              </div>
            </>
          )}

          {/* Duplicate Offset (always visible, including groups) */}
          <Row
            label="Dup Offset"
            value={duplicateOffsetVal}
            onChange={(v) => {
              setDupDraft(v);
              const n = Number(v);
              if (Number.isFinite(n)) setDuplicateOffset?.(n);
            }}
            onBlur={() => {
              const n = Math.max(0, Number(duplicateOffsetVal) || 0);
              setDupDraft(String(n));
              setDuplicateOffset?.(n);
            }}
            placeholder="20"
          />
        </div>

        {/* bbox always visible */}
        {(isSvg || isWidget) && (
          <div style={{ marginTop: 10, marginBottom: 6, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              title={bboxAspectLocked ? "Aspect ratio locked" : "Aspect ratio unlocked"}
              onClick={() => setBboxAspectLocked((v) => !v)}
              style={{
                ...btnStyle,
                height: 24,
                padding: "0 8px",
                fontSize: 11,
                background: bboxAspectLocked ? "#2b6cff" : "var(--bg-soft)",
                color: bboxAspectLocked ? "#fff" : "var(--text)",
              }}
            >
              {bboxAspectLocked ? "Lock Ratio" : "Free W/H"}
            </button>
          </div>
        )}
        <div
          style={{
            marginTop: 6,
            display: "grid",
            gridTemplateColumns: "22px 1fr 22px 1fr",
            columnGap: 8,
            rowGap: 6,
          }}
        >
          {["x", "y", "w", "h"].map((k) => (
            <span key={k} style={{ display: "contents" }}>
              <div style={{ ...labelStyle, lineHeight: "26px" }}>{k.toUpperCase()}</div>
              <input
                type="text"
                value={bboxDraft[k] ?? ""}
                onChange={(e) => setBboxDraft((p) => ({ ...p, [k]: e.target.value }))}
                onBlur={commitBBox}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitBBox();
                    e.currentTarget.blur();
                  }
                }}
                style={controlStyle}
              />
            </span>
          ))}
        </div>

        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
          Tip: press <b>Apply</b> to commit all fields.
        </div>
      </div>
    </div>
  );
}
