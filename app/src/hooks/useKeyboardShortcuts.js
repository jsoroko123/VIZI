import { useEffect } from "react";

export function useKeyboardShortcuts({
  drawing,
  editingId,
  importOpen,
  selCount,

  duplicateSelected,
  cancelPolyline,
  exitEditMode,
  toggleEditMode,
  setTool,
  closeImport,
  clearSelection,
  selectAll,
  clearImportAnchor,
  deleteSelected,
}) {
  useEffect(() => {
    function isTypingTarget(target) {
      if (!target) return false;
      const tag = (target.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || target.isContentEditable;
    }

    function onKeyDown(e) {
      // Don’t hijack shortcuts while typing
      if (isTypingTarget(e.target)) return;

      const key = (e.key || "").toLowerCase();
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // ESC
      if (key === "escape") {
        e.preventDefault();

        if (importOpen) {
          closeImport?.();
          return;
        }

        if (drawing) {
          cancelPolyline?.();
          return;
        }

        if (editingId) {
          exitEditMode?.();
          return;
        }

        if (clearImportAnchor) {
          clearImportAnchor();
        }
        clearSelection?.();
        return;
      }

      // DELETE / BACKSPACE (delete selected)
      if (key === "delete" || key === "backspace") {
        if (selCount > 0) {
          e.preventDefault();
          deleteSelected?.();
        }
        return;
      }

      // ✅ DUPLICATE: Ctrl/Cmd + D (GLOBAL, works repeatedly without clicking)
      if (mod && key === "d") {
        // stop browser “bookmark” / other default behavior
        e.preventDefault();
        e.stopPropagation();
        duplicateSelected?.();
        return;
      }

      // ✅ MOVE TOOL: Ctrl/Cmd + M
      if (mod && key === "m") {
        e.preventDefault();
        e.stopPropagation();
        if (drawing) cancelPolyline?.();
        exitEditMode?.();
        setTool?.("select");
        return;
      }

      // ✅ EDIT MODE: Ctrl/Cmd + E
      if (mod && key === "e") {
        e.preventDefault();
        e.stopPropagation();
        toggleEditMode?.();
        return;
      }

      // ✅ POLYLINE TOOL: Ctrl/Cmd + P
      if (mod && key === "p") {
        e.preventDefault();
        e.stopPropagation();
        if (drawing) cancelPolyline?.();
        exitEditMode?.();
        setTool?.("polyline");
        return;
      }

      // ✅ TEXT TOOL: Alt + T
      if (e.altKey && key === "t") {
        e.preventDefault();
        e.stopPropagation();
        if (drawing) cancelPolyline?.();
        exitEditMode?.();
        setTool?.("text");
        return;
      }

      // Ctrl/Cmd + A => Select all
      if (mod && key === "a") {
        e.preventDefault();
        e.stopPropagation();
        selectAll?.();
      }
    }

    // ✅ Capture=true so we get the shortcut even if something else is listening
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    drawing,
    editingId,
    importOpen,
    selCount,
    duplicateSelected,
    cancelPolyline,
    exitEditMode,
    toggleEditMode,
    setTool,
    closeImport,
    clearSelection,
    selectAll,
    deleteSelected,
  ]);
}
