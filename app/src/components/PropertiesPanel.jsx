// src/components/PropertiesPanel.jsx
import { useEffect, useMemo, useRef, useState } from "react";

const closeBtnStyle = {
  border: "1px solid var(--border)",
  background: "var(--bg-elev)",
  borderRadius: 10,
  padding: "4px 8px",
  cursor: "pointer",
  lineHeight: 1,
  color: "var(--text)",
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

  const hasGroups = filteredOptions?.some((opt) => opt.group);
  const grouped = hasGroups
    ? filteredOptions.reduce((acc, opt) => {
        const key = opt.group || "Other";
        if (!acc.has(key)) acc.set(key, []);
        acc.get(key).push(opt);
        return acc;
      }, new Map())
    : null;

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

export default function PropertiesPanel({
  showHUD,
  setShowHUD,
  selectedBBox,
  selCount,
  isSingle,
  singleKind,
  selectedIds,
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
  applySingleEType,
  applySingleFill,
  applySingleStroke,
  applySingleSvgStrokeWidth,
  applySingleFaultSim,
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
  duplicateOffset,
  setDuplicateOffset,
  bounds,
  docked = false,
  dockLeft = 0,
  dockTop = 0,
  dockBottom = 0,
  dockWidth = 360,
}) {
  const [bboxDraft, setBboxDraft] = useState({ x: "", y: "", w: "", h: "" });
  const [bboxAspectLocked, setBboxAspectLocked] = useState(true);
  const [panelPos, setPanelPos] = useState({ x: 16, y: 16 });
  const [userMoved, setUserMoved] = useState(false);
  const [btnPulse, setBtnPulse] = useState({ apply: false, convert: false });
  const [dupDraft, setDupDraft] = useState(String(duplicateOffset ?? 20));
  const [templateNameDraft, setTemplateNameDraft] = useState(svgTemplateName || "");
  const dragRef = useRef({ dragging: false, ox: 0, oy: 0 });
  const panelRef = useRef(null);
  const skipAutoPosRef = useRef(false);
  const safeBounds = useMemo(() => {
    const left = Number.isFinite(bounds?.left) ? bounds.left : 8;
    const top = Number.isFinite(bounds?.top) ? bounds.top : 8;
    const right = Number.isFinite(bounds?.right) ? bounds.right : 8;
    const bottom = Number.isFinite(bounds?.bottom) ? bounds.bottom : 8;
    return { left, top, right, bottom };
  }, [bounds]);

  const tagOptions = useMemo(() => {
    const options = [];
    options.push({ value: "", label: "Select tag" });
    (opcTags || []).forEach((tag) => {
      const topic = String(tag?.topic || "Default");
      const raw = String(tag?.tagPath || tag?.name || "").trim();
      if (!raw) return;
      const name = String(tag?.name || raw).trim();
      const group = topic;
      options.push({ value: raw, label: name || raw, group });
    });
    if (hudFields.tagPath && !options.some((opt) => opt.value === hudFields.tagPath)) {
      options.push({ value: hudFields.tagPath, label: hudFields.tagPath, group: "Custom" });
    }
    return options;
  }, [opcTags, hudFields.tagPath]);

  const svgTagGroupOptions = useMemo(() => {
    const options = [{ value: "", label: "Select tag group" }];
    const seen = new Set();

    (opcTags || []).forEach((tag) => {
      const topic = String(tag?.topic || "Default").trim() || "Default";
      const groupName = inferGroupNameFromTag(tag);
      if (!groupName) return;
      const value = `${topic}.${groupName}`;
      const dedupe = value.toLowerCase();
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      options.push({ value, label: groupName, group: topic });
    });

    if (hudFields.tagPath && !options.some((opt) => opt.value === hudFields.tagPath)) {
      options.push({ value: hudFields.tagPath, label: hudFields.tagPath, group: "Custom" });
    }
    return options;
  }, [opcTags, hudFields.tagPath]);

  const svgBindingOptions = useMemo(() => {
    return Array.isArray(svgTagGroupOptions) ? [...svgTagGroupOptions] : [];
  }, [svgTagGroupOptions]);

  // keep latest fns for Apply (avoid stale closure)
  const latest = useRef({});
  latest.current = {
    applySingleId,
    applySingleTagPath,
    applySingleEType,
    applySingleFill,
    applySingleStroke,
    applySingleSvgStrokeWidth,
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
      if (e.key === "Escape") setShowHUD(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHUD, setShowHUD]);

  // Click-away closes panel
  useEffect(() => {
    if (!showHUD) return;
    const onPointerDown = (e) => {
      const panelEl = panelRef.current;
      const target = e.target;
      if (!panelEl || !target) return;
      if (panelEl.contains(target)) return;
      setShowHUD(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [showHUD, setShowHUD]);

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

    if (panelCursor) {
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

    const gap = 16;
    let x = sel.x + sel.w + gap;
    let y = sel.y;

    x = Math.min(Math.max(minX, x), maxX);
    y = Math.min(Math.max(minY, y), maxY);

    setPanelPos({ x, y });
  }, [panelAnchorKey, panelAnchor, panelCursor, showHUD, freezePanel, docked]);

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

  const isSvg = isSingle && singleKind === "SVG";
  const isWidget = isSingle && singleKind === "Widget";
  const isPoly = isSingle && singleKind === "Polyline";
  const isText = isSingle && singleKind === "Text";
  const isShapeGroup = !isSingle && (Array.isArray(selectedIds) ? selectedIds.length : 0) > 0;

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
  const widgetMinVal = String(hudFields?.widgetMin ?? "0");
  const widgetMaxVal = String(hudFields?.widgetMax ?? "100");
  const widgetDecimalsVal = String(hudFields?.widgetDecimals ?? "0");
  const widgetUnitVal = String(hudFields?.widgetUnit || "");
  const widgetHistoryPointsVal = String(hudFields?.widgetHistoryPoints ?? "40");
  const widgetRowCountVal = String(hudFields?.widgetRowCount ?? "4");
  const widgetRangeFromVal = String(hudFields?.widgetRangeFrom || "");
  const widgetRangeToVal = String(hudFields?.widgetRangeTo || "");
  const widgetWindowMinutesVal = String(hudFields?.widgetWindowMinutes ?? "60");
  const widgetDurationPresetVal = String(hudFields?.widgetDurationPreset ?? "1h");
  const widgetMaxPointsVal = String(hudFields?.widgetMaxPoints ?? "500");
  const widgetLineTensionVal = String(hudFields?.widgetLineTension ?? "0.34");
  const widgetShowPointsVal = String(hudFields?.widgetShowPoints ?? "true");
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
  const chartMinMaxDisabled = isTrendChartKind && widgetAxisModeVal !== "manual";
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

    if (!isSingle) return;

    // 2) apply ID first
    latest.current.applySingleId?.(next.id);

    // 3) defer remaining applies to avoid selection timing issues
    setTimeout(() => {
      const a = latest.current;

      a.applySingleTagPath?.(next.tagPath);

      if (isSvg) {
        a.applySingleEType?.(next.eType);
        a.applySingleSvgStrokeWidth?.(next.strokeWidth);
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
      style={{
        position: "fixed",
        left: docked ? Math.max(0, Number(dockLeft) || 0) : panelPos.x,
        top: docked ? Math.max(0, Number(dockTop) || 0) : panelPos.y,
        bottom: docked ? Math.max(0, Number(dockBottom) || 0) : undefined,
        width: docked ? Math.max(280, Number(dockWidth) || 360) : undefined,
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
        minWidth: 320,
        minHeight: docked ? 0 : MIN_PANEL_HEIGHT,
        maxHeight: docked
          ? "100%"
          : `min(${MAX_PANEL_HEIGHT}px, calc(100vh - ${safeBounds.top + safeBounds.bottom + 16}px))`,
        overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
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
        <div style={{ fontWeight: 800 }}>
          Selected: {selCount === 1 ? singleKind : `Group (${selCount})`}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
              setShowHUD(false);
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
            {isWidget ? (
              <div style={{ gridColumn: "2 / 3", fontSize: 10, color: "var(--text-muted)", marginTop: -2 }}>
                Use tag path for OPC binding or `db:table.column` for database binding.
              </div>
            ) : isSvg ? (
              <div style={{ gridColumn: "2 / 3", fontSize: 10, color: "var(--text-muted)", marginTop: -2 }}>
                SVGs use tag-group bindings like `Topic.GroupName`.
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
                <SelectRow
                  label="UDT"
                  value={svgTemplateKey || svgTemplateOptions?.[0]?.value || ""}
                  onChange={(v) => {
                    if (!singleOverlayId) return;
                    swapSvgTemplate?.(singleOverlayId, v);
                  }}
                  onBlur={() => {}}
                  options={svgTemplateOptions}
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
                  onBlur={() => {}}
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
                    Bind an OPC tag in Tag Path. This widget reads live value and supports PLC writes.
                  </div>
                ) : null}
                {widgetKindVal === "countdownBar" ? (
                  <div style={{ gridColumn: "2 / 3", fontSize: 10, color: "var(--text-muted)", marginTop: -2 }}>
                    Bind timer PRE and ACC tags. Countdown shows PRE-ACC and percent complete.
                  </div>
                ) : null}
                {(widgetKindVal === "lineChart" || widgetKindVal === "areaChart") && (
                  <SelectRow
                    label="Duration"
                    value={widgetDurationPresetVal}
                    onChange={(v) => {
                      const presetToMinutes = {
                        "15m": "15",
                        "30m": "30",
                        "1h": "60",
                        "2h": "120",
                        "6h": "360",
                        "12h": "720",
                        "24h": "1440",
                        "7d": "10080",
                      };
                      const minutes = presetToMinutes[v] || "60";
                      const next = {
                        ...hudFields,
                        widgetDurationPreset: v,
                        widgetWindowMinutes: minutes,
                        widgetRangeFrom: "",
                        widgetRangeTo: "",
                      };
                      setHudFields(next);
                      applySingleWidgetSettings?.(next);
                    }}
                    onBlur={() => applySingleWidgetSettings?.(hudFields)}
                    options={[
                      { value: "15m", label: "15 min" },
                      { value: "30m", label: "30 min" },
                      { value: "1h", label: "1 hour" },
                      { value: "2h", label: "2 hours" },
                      { value: "6h", label: "6 hours" },
                      { value: "12h", label: "12 hours" },
                      { value: "24h", label: "24 hours" },
                      { value: "7d", label: "7 days" },
                    ]}
                  />
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
            {(isSvg || isPoly) && (
              <Row
                label="Stroke"
                type="color"
                showHex
                value={hudFields.stroke}
                onChange={(v) => setHudFields((p) => ({ ...p, stroke: v }))}
                onBlur={() => {
                  if (!isSvg) applySingleStroke(hudFields.stroke);
                }}
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
                onBlur={() => {}}
                placeholder=""
              />
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
