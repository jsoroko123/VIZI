// src/components/PropertiesPanel.jsx
import { useEffect, useMemo, useRef, useState } from "react";

const closeBtnStyle = {
  border: "1px solid #e6e6e6",
  background: "white",
  borderRadius: 10,
  padding: "4px 8px",
  cursor: "pointer",
  lineHeight: 1,
  color: "#111",
};

// ✅ Shared compact control style (actual height shrink)
const controlStyle = {
  boxSizing: "border-box",
  height: 26,
  border: "1px solid #dcdcdc",
  borderRadius: 8,
  padding: "0 8px",
  fontSize: 12,
  lineHeight: "26px",
  outline: "none",
  width: "100%",
  background: "white",
  color: "#111",
};

const labelStyle = {
  color: "#808080",
  alignSelf: "center",
  fontSize: 12,
  lineHeight: "26px",
};

const btnStyle = {
  border: "1px solid #dcdcdc",
  background: "white",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  color: "#111",
  boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
};

function Row({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  showHex = false,
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
              background: "#fff",
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
          style={controlStyle}
        />
      )}
    </>
  );
}

function SelectRow({ label, value, onChange, onBlur, options }) {
  const hasGroups = options?.some((opt) => opt.group);
  const grouped = hasGroups
    ? options.reduce((acc, opt) => {
        const key = opt.group || "Other";
        if (!acc.has(key)) acc.set(key, []);
        acc.get(key).push(opt);
        return acc;
      }, new Map())
    : null;
  return (
    <>
      <div style={labelStyle}>{label}</div>
      <select
        value={value ?? options?.[0]?.value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        style={{
          ...controlStyle,
          cursor: "pointer",
          lineHeight: "normal",
        }}
      >
        {hasGroups
          ? Array.from(grouped.entries()).map(([group, opts]) => (
              <optgroup key={group} label={group}>
                {opts.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </optgroup>
            ))
          : options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
      </select>
    </>
  );
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
  applySingleFill,
  applySingleStroke,
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

  opcTags,
  duplicateOffset,
  setDuplicateOffset,
  bounds,
}) {
  const [bboxDraft, setBboxDraft] = useState({ x: "", y: "", w: "", h: "" });
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

  // keep latest fns for Apply (avoid stale closure)
  const latest = useRef({});
  latest.current = {
    applySingleId,
    applySingleTagPath,
    applySingleFill,
    applySingleStroke,
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
  };

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

  useEffect(() => {
    if (!showHUD) {
      setUserMoved(false);
    }
  }, [showHUD]);

  useEffect(() => {
    if (panelAnchorKey) setUserMoved(false);
  }, [panelAnchorKey]);

  useEffect(() => {
    if (!showHUD) return;
    if (freezePanel) return;
    if (userMoved) return;
    if (skipAutoPosRef.current) {
      skipAutoPosRef.current = false;
      return;
    }
    const rect = panelRef.current?.getBoundingClientRect();
    const panelW = rect?.width ?? 320;
    const panelH = rect?.height ?? 200;
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
  }, [panelAnchorKey, panelAnchor, panelCursor, showHUD, freezePanel]);

  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current.dragging) return;
      const rect = panelRef.current?.getBoundingClientRect();
      const minX = safeBounds.left;
      const minY = safeBounds.top;
      const maxX = rect
        ? Math.max(minX, window.innerWidth - rect.width - safeBounds.right)
        : window.innerWidth;
      const maxY = rect
        ? Math.max(minY, window.innerHeight - rect.height - safeBounds.bottom)
        : window.innerHeight;
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
  }, []);

  if (!showHUD || !selectedBBox) return null;

  const isSvg = isSingle && singleKind === "SVG";
  const isPoly = isSingle && singleKind === "Polyline";
  const isText = isSingle && singleKind === "Text";

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
  const duplicateOffsetVal = dupDraft;
  const svgTemplateOptions = (svgFiles || []).map((f) => ({
    value: f.key,
    label: f.name,
  }));

  const commitBBox = () => {
    const next = { ...hudFields, ...bboxDraft };
    setHudFields(next);
    applyBBoxFromHud(next);
  };

  const pulseButton = (key) => {
    setBtnPulse((p) => ({ ...p, [key]: true }));
    setTimeout(() => {
      setBtnPulse((p) => ({ ...p, [key]: false }));
    }, 140);
  };

  const applyAll = () => {
    if (!selectedBBox) return;

    const next = { ...hudFields, ...bboxDraft };

    // 1) commit draft state + bbox transform
    latest.current.setHudFields(next);
    latest.current.applyBBoxFromHud(next);

    if (!isSingle) return;

    // 2) apply ID first
    latest.current.applySingleId?.(next.id);

    // 3) defer remaining applies to avoid selection timing issues
    setTimeout(() => {
      const a = latest.current;

      a.applySingleTagPath?.(next.tagPath);

      if (isSvg) {
        const w = Number.parseFloat(next.w);
        const h = Number.parseFloat(next.h);
        if (Number.isFinite(w) && Number.isFinite(h)) {
          persistSvgMeta?.(w, h);
        }
        return;
      }

      if (isPoly) {
        a.applySingleStroke?.(next.stroke);
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
        left: panelPos.x,
        top: panelPos.y,
        background: "rgba(255,255,255,0.9)",
        border: "1px solid #e6e6e6",
        borderRadius: 12,
        padding: "10px 12px",
        fontSize: 13,
        lineHeight: 1.35,
        boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
        color: "#111",
        zIndex: 35,
        minWidth: 320,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "move" }}
        onMouseDown={(e) => {
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
              background: "#f7f7f7",
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
              options={tagOptions}
            />

          {/* SVG */}
          {isSvg && (
            <>
              <SelectRow
                label="Template"
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
                  label="Template Name"
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
      <div
        style={{
          marginTop: 12,
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

      <div style={{ marginTop: 8, fontSize: 12, color: "#808080" }}>
        Tip: press <b>Apply</b> to commit all fields.
      </div>
    </div>
  );
}
