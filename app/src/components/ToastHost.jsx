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
        right: 14,
        bottom: 14,
        zIndex: 9999,
        display: "grid",
        gap: 8,
        pointerEvents: "none",
        maxWidth: "min(420px, calc(100vw - 24px))",
      }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          style={{
            background: "var(--bg-elev)",
            color: "var(--text)",
            border: `1px solid ${
              t.type === "error" ? "#f04438" : t.type === "success" ? "#12b76a" : "var(--border)"
            }`,
            borderLeft: `4px solid ${
              t.type === "error" ? "#f04438" : t.type === "success" ? "#12b76a" : "#2b6cff"
            }`,
            borderRadius: 10,
            boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
            padding: "10px 12px",
            fontSize: 12,
            lineHeight: 1.35,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
