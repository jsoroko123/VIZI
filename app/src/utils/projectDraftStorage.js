export const PROJECT_DRAFT_KEY_PREFIX = "vizi_project_draft:";
export const PROJECT_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function getProjectDraftStorageKey(projectId) {
  return `${PROJECT_DRAFT_KEY_PREFIX}${String(projectId || "").trim()}`;
}

export function clearProjectDraft(projectId) {
  if (typeof window === "undefined") return;
  const id = String(projectId || "").trim();
  if (!id) return;
  try {
    localStorage.removeItem(getProjectDraftStorageKey(id));
  } catch {
    // ignore
  }
}
