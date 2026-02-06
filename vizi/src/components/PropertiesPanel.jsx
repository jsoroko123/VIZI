// src/components/PropertiesPanel.jsx
import { useEffect, useRef, useState } from "react";

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

function Row({ label, value, onChange, onBlur, placeholder }) {
  return (
    <>
      <div style={labelStyle}>{label}</div>
      <input
        type="text"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onBlur?.();
            e.currentTarget.blur();
          }
        }}
        style={controlStyle}
      />
    </>
  );
}

function SelectRow({ label, value, onChange, onBlur, options }) {
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
        {options.map((opt) => (
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

  // ✅ NEW (text)
  applySingleTextValue,
  applySingleFontSize,
  applySingleFontFamily,
  applySingleTextAlign,
}) {
  const [bboxDraft, setBboxDraft] = useState({ x: "", y: "", w: "", h: "" });

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

  // ESC closes panel
  useEffect(() => {
    if (!showHUD) return;
    const onKey = (e) => {
      if (e.key === "Escape") setShowHUD(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHUD, setShowHUD]);

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

  const arrowStartVal = hudFields?.arrowStart ?? "none";
  const arrowEndVal = hudFields?.arrowEnd ?? "none";
  const lineStyleVal = hudFields?.lineStyle ?? "solid";

  const textAlignVal = hudFields?.textAlign ?? hudFields?.anchor ?? "start";
  const fontSizeVal = hudFields?.fontSize ?? "24";
  const fontFamilyVal = hudFields?.fontFamily ?? "system-ui";
  const textVal = hudFields?.text ?? "Text";
  const textFillVal = hudFields?.fill ?? "#111111"; // ✅ text uses fill

  const commitBBox = () => {
    const next = { ...hudFields, ...bboxDraft };
    setHudFields(next);
    applyBBoxFromHud(next);
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
        a.applySingleFill?.(next.fill);
        a.applySingleStroke?.(next.stroke);
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
        a.applySingleFill?.(next.fill); // ✅ text color
        a.applySingleTextAlign?.(next.textAlign ?? "start");
      }
    }, 0);
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        top: 16,
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 800 }}>
          Selected: {selCount === 1 ? singleKind : `Group (${selCount})`}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button title="Apply" onClick={applyAll} style={btnStyle}>
            Apply
          </button>
          <button title="Close" onClick={() => setShowHUD(false)} style={closeBtnStyle}>
            ✕
          </button>
        </div>
      </div>

      {isSingle && (
        <div
          style={{
            marginTop: 10,
            display: "grid",
            gridTemplateColumns: "92px 1fr",
            columnGap: 8,
            rowGap: 6,
          }}
        >
          <Row
            label="ID"
            value={hudFields.id}
            onChange={(v) => setHudFields((p) => ({ ...p, id: v }))}
            onBlur={() => applySingleId(hudFields.id)}
            placeholder="Element ID"
          />

          <Row
            label="Tag Path"
            value={hudFields.tagPath}
            onChange={(v) => setHudFields((p) => ({ ...p, tagPath: v }))}
            onBlur={() => applySingleTagPath(hudFields.tagPath)}
            placeholder="e.g. Area/Equip/Device"
          />

          {/* SVG */}
          {isSvg && (
            <Row
              label="Fill"
              value={hudFields.fill}
              onChange={(v) => setHudFields((p) => ({ ...p, fill: v }))}
              onBlur={() => applySingleFill(hudFields.fill)}
              placeholder="#ffffff"
            />
          )}

          {/* Stroke (SVG + Polyline) */}
          {(isSvg || isPoly) && (
            <Row
              label="Stroke"
              value={hudFields.stroke}
              onChange={(v) => setHudFields((p) => ({ ...p, stroke: v }))}
              onBlur={() => applySingleStroke(hudFields.stroke)}
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
                label="Align"
                value={textAlignVal}
                onChange={(v) => setHudFields((p) => ({ ...p, textAlign: v }))}
                onBlur={() => applySingleTextAlign?.(hudFields.textAlign)}
                options={textAlignOptions}
              />
            </>
          )}
        </div>
      )}

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
