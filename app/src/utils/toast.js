const TOAST_EVENT = "vizi:toast";
const TOAST_DISMISS_EVENT = "vizi:toast:dismiss";

export function showToast(message, options = {}) {
  const text = String(message || "").trim();
  if (!text) return "";
  const id = String(options.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const rawDuration = Number(options.duration);
  const detail = {
    id,
    message: text,
    type: options.type || "info",
    duration: Number.isFinite(rawDuration) ? rawDuration : 3200,
  };
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }));
  return id;
}

export function toastSuccess(message, duration = 2600) {
  showToast(message, { type: "success", duration });
}

export function toastError(message, duration = 4200) {
  showToast(message, { type: "error", duration });
}

export function toastInfo(message, duration = 3200) {
  showToast(message, { type: "info", duration });
}

export function dismissToast(id) {
  const toastId = String(id || "").trim();
  if (!toastId) return;
  window.dispatchEvent(
    new CustomEvent(TOAST_DISMISS_EVENT, {
      detail: { id: toastId },
    })
  );
}

export function installAlertToasts() {
  if (typeof window === "undefined") return;
  if (window.__vizi_alert_toast_installed) return;
  const nativeAlert = window.alert?.bind(window);
  window.alert = (message) => {
    toastInfo(message, 3600);
    if (typeof nativeAlert === "function") {
      // keep native behavior available for debugging only
      return;
    }
  };
  window.__vizi_alert_toast_installed = true;
}

export const toastEventName = TOAST_EVENT;
export const toastDismissEventName = TOAST_DISMISS_EVENT;
