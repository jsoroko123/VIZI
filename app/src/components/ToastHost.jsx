import { useEffect, useState } from "react";
import { toastDismissEventName, toastEventName } from "../utils/toast";

export default function ToastHost() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const timers = new Map();

    function clearToastTimer(id) {
      if (!timers.has(id)) return;
      clearTimeout(timers.get(id));
      timers.delete(id);
    }

    function dismissById(id) {
      clearToastTimer(id);
      setItems((prev) => prev.filter((t) => t.id !== id));
    }

    function onToast(evt) {
      const detail = evt?.detail || {};
      const id = String(detail.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      const message = String(detail.message || "").trim();
      if (!message) return;
      const type = String(detail.type || "info");
      const duration = Number(detail.duration);
      setItems((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx < 0) return [...prev, { id, message, type }];
        const next = [...prev];
        next[idx] = { ...next[idx], message, type };
        return next;
      });
      clearToastTimer(id);
      if (Number.isFinite(duration) && duration > 0) {
        timers.set(
          id,
          window.setTimeout(() => {
            dismissById(id);
          }, duration)
        );
      }
    }

    function onDismiss(evt) {
      const id = String(evt?.detail?.id || "").trim();
      if (!id) return;
      dismissById(id);
    }

    window.addEventListener(toastEventName, onToast);
    window.addEventListener(toastDismissEventName, onDismiss);
    return () => {
      window.removeEventListener(toastEventName, onToast);
      window.removeEventListener(toastDismissEventName, onDismiss);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        right: 20,
        bottom: 22,
        zIndex: 9999,
        display: "grid",
        gap: 10,
        pointerEvents: "none",
        maxWidth: "min(500px, calc(100vw - 24px))",
      }}
    >
      {items.map((t) => (
        (() => {
          const isError = t.type === "error";
          const isSuccess = t.type === "success";
          const accent = isError ? "#f04438" : isSuccess ? "#12b76a" : "#2b6cff";
          const bg = isError
            ? "color-mix(in srgb, #f04438 18%, var(--bg-elev) 82%)"
            : isSuccess
            ? "color-mix(in srgb, #12b76a 16%, var(--bg-elev) 84%)"
            : "color-mix(in srgb, #2b6cff 16%, var(--bg-elev) 84%)";
          const label = isError ? "Error" : isSuccess ? "Success" : "Notice";
          return (
            <div
              key={t.id}
              style={{
                background: bg,
                color: "var(--text)",
                border: `1px solid color-mix(in srgb, ${accent} 62%, var(--border) 38%)`,
                borderLeft: `6px solid ${accent}`,
                borderRadius: 12,
                boxShadow: "0 18px 34px rgba(0,0,0,0.32)",
                padding: "12px 14px",
                fontSize: 13,
                lineHeight: 1.45,
                fontWeight: 600,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                backdropFilter: "blur(6px)",
              }}
            >
              <div style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.9, marginBottom: 4 }}>
                {label}
              </div>
              {t.message}
            </div>
          );
        })()
      ))}
    </div>
  );
}
