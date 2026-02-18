let activeDialogCount = 0;

function el(tag, style = {}) {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  return node;
}

export function showConfirmDialog({
  title = "Confirm",
  message = "Are you sure?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false,
} = {}) {
  if (typeof document === "undefined") return Promise.resolve(false);

  return new Promise((resolve) => {
    activeDialogCount += 1;
    const zIndex = 5000 + activeDialogCount;

    const overlay = el("div", {
      position: "fixed",
      inset: "0",
      zIndex: String(zIndex),
      background: "rgba(15, 23, 42, 0.42)",
      display: "grid",
      placeItems: "center",
      padding: "20px",
    });

    const dialog = el("div", {
      width: "min(440px, calc(100vw - 32px))",
      border: "1px solid var(--border)",
      borderRadius: "12px",
      background: "var(--bg-elev)",
      color: "var(--text)",
      boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
      padding: "14px",
      display: "grid",
      gap: "10px",
      fontFamily: "inherit",
    });

    const heading = el("div", {
      fontSize: "15px",
      fontWeight: "800",
      letterSpacing: "0.01em",
    });
    heading.textContent = String(title || "Confirm");

    const body = el("div", {
      fontSize: "13px",
      lineHeight: "1.45",
      color: "var(--text-muted)",
      whiteSpace: "pre-wrap",
    });
    body.textContent = String(message || "");

    const actions = el("div", {
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
      marginTop: "2px",
    });

    const cancelBtn = el("button", {
      border: "1px solid var(--border)",
      background: "var(--bg-elev)",
      color: "var(--text)",
      borderRadius: "8px",
      padding: "8px 12px",
      fontSize: "12px",
      fontWeight: "700",
      cursor: "pointer",
    });
    cancelBtn.textContent = String(cancelText || "Cancel");

    const confirmBtn = el("button", {
      border: danger ? "1px solid var(--danger)" : "1px solid var(--accent)",
      background: danger
        ? "linear-gradient(180deg, var(--danger) 0%, var(--danger-strong) 100%)"
        : "linear-gradient(180deg, var(--accent) 0%, var(--accent-strong) 100%)",
      color: danger ? "var(--danger-text)" : "var(--accent-text)",
      borderRadius: "8px",
      padding: "8px 12px",
      fontSize: "12px",
      fontWeight: "700",
      cursor: "pointer",
    });
    confirmBtn.textContent = String(confirmText || "Confirm");

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(heading);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let settled = false;
    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      activeDialogCount = Math.max(0, activeDialogCount - 1);
      resolve(Boolean(result));
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        cleanup(true);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup(false);
    });
    cancelBtn.addEventListener("click", () => cleanup(false));
    confirmBtn.addEventListener("click", () => cleanup(true));
    confirmBtn.focus();
  });
}
