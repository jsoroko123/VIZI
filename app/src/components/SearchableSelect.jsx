import { useEffect, useMemo, useRef, useState } from "react";

function normalizeOptions(options) {
  return (Array.isArray(options) ? options : [])
    .map((opt) => {
      if (opt == null) return null;
      if (typeof opt === "string" || typeof opt === "number") {
        const value = String(opt);
        return { value, label: value };
      }
      const value = String(opt?.value ?? "");
      if (!value) return null;
      const label = String(opt?.label ?? value);
      return { value, label };
    })
    .filter(Boolean);
}

export default function SearchableSelect({
  value = "",
  onChange,
  options = [],
  placeholder = "Search...",
  disabled = false,
  style = {},
  title = "",
  ariaLabel = "",
}) {
  const normalized = useMemo(() => normalizeOptions(options), [options]);
  const selectedValue = String(value ?? "");
  const selected = useMemo(
    () => normalized.find((opt) => String(opt.value) === selectedValue) || null,
    [normalized, selectedValue]
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const borderRadius = Number(style.borderRadius) || 10;
  const fontSize = Number(style.fontSize) || 12;
  const fontWeight = Number(style.fontWeight) || 600;
  const height = Number(style.height) || 30;
  const borderColor = String(style.borderColor || "var(--border)");
  const background = String(style.background || "var(--bg-elev)");
  const color = String(style.color || "var(--text)");

  const q = String(query || "").trim().toLowerCase();
  const filtered = !q
    ? normalized
    : normalized.filter((opt) => String(opt?.label || "").toLowerCase().includes(q));
  const inputValue = open ? query : selected?.label || "";

  const pickValue = (nextValue) => {
    const v = String(nextValue || "");
    const match = normalized.find((opt) => String(opt.value) === v) || null;
    setQuery(match?.label || "");
    setOpen(false);
    onChange?.(v);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      const root = rootRef.current;
      const target = event?.target;
      if (root && target instanceof Node && root.contains(target)) return;
      setOpen(false);
      setQuery(selected?.label || "");
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open, selected]);

  return (
    <div
      ref={rootRef}
      title={title}
      aria-label={ariaLabel || title || placeholder}
      style={{ position: "relative", width: "100%", minWidth: 0 }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          alignItems: "center",
          minHeight: height,
          height,
          borderRadius,
          border: `1px solid ${borderColor}`,
          background,
          color,
          fontSize,
          fontWeight,
          overflow: "hidden",
        }}
      >
        <input
          type="text"
          value={inputValue}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setOpen(false);
              setQuery(selected?.label || "");
            }, 120);
          }}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            color,
            fontSize,
            fontWeight,
            padding: "0 8px",
          }}
        />
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setQuery("");
            onChange?.("");
            setOpen(false);
          }}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--text-muted)",
            width: 24,
            height: "100%",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
          aria-label="Clear"
          title="Clear"
        >
          ×
        </button>
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setOpen((v) => {
              const next = !v;
              if (next) setQuery("");
              return next;
            });
          }}
          style={{
            border: "none",
            borderLeft: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text)",
            width: 30,
            height: "100%",
            cursor: disabled ? "not-allowed" : "pointer",
            display: "grid",
            placeItems: "center",
            padding: 0,
          }}
          aria-label="Toggle options"
          title="Toggle options"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {open && !disabled ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: height + 2,
            maxHeight: 280,
            overflow: "auto",
            zIndex: 100,
            background,
            border: "1px solid var(--border)",
            borderRadius,
            boxShadow: "0 8px 22px rgba(2, 6, 23, 0.18)",
          }}
        >
          {filtered.length ? (
            filtered.map((opt) => {
              const active = String(opt.value) === selectedValue;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickValue(opt.value);
                  }}
                  style={{
                    width: "100%",
                    border: "none",
                    textAlign: "left",
                    padding: "8px 10px",
                    background: active ? "var(--bg-soft)" : "var(--bg-elev)",
                    color,
                    fontSize,
                    fontWeight,
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })
          ) : (
            <div style={{ padding: "8px 10px", fontSize, color: "var(--text-muted)" }}>No matches</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
