import { uid } from "./ids";

export const DEFAULT_CANVAS_BG_LIGHT = "#ffffff";
export const DEFAULT_CANVAS_BG_DARK = "#0f141c";
export const LIVE_MENU_EXPANDED_WIDTH_KEY = "vizi_live_menu_expanded_width";
export const LIVE_MENU_EXPANDED_WIDTH_DEFAULT = 248;
export const LIVE_MENU_EXPANDED_WIDTH_MIN = 200;
export const LIVE_MENU_EXPANDED_WIDTH_MAX = 520;
export const LIVE_MENU_ICON_KEY_ALIASES = {
  grid: "AppsRounded",
  screen: "MonitorRounded",
  database: "StorageRounded",
  table: "TableChartRounded",
  chart: "ShowChartRounded",
  trend: "TimelineRounded",
  report: "DescriptionRounded",
  file: "InsertDriveFileRounded",
  folder: "FolderRounded",
  product: "Inventory2Rounded",
  bin: "InboxRounded",
  gear: "SettingsRounded",
  wrench: "BuildRounded",
  filter: "FilterAltRounded",
  flask: "ScienceRounded",
  bolt: "BoltRounded",
  factory: "BusinessRounded",
};

export function normalizeLiveMenuIcon(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const legacy = LIVE_MENU_ICON_KEY_ALIASES[raw.toLowerCase()];
  if (legacy) return legacy;
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(raw)) return "";
  return raw;
}

export function normalizeProjectMode(value) {
  return String(value || "").trim().toLowerCase() === "live" ? "live" : "design";
}

export function readStoredProjectMode(projectId = "") {
  if (typeof window === "undefined") return "design";
  const key = `vizi_project_mode:${String(projectId || "default")}`;
  try {
    const byProject = localStorage.getItem(key);
    if (byProject != null) return normalizeProjectMode(byProject);
    const last = localStorage.getItem("vizi_project_mode:last");
    if (last != null) return normalizeProjectMode(last);
  } catch {
    // ignore storage read errors
  }
  return "design";
}

export function readStoredActiveProjectId() {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem("vizi_active_project_id") || "").trim();
  } catch {
    return "";
  }
}

export function normalizeProjectCanvasBackground(raw) {
  const fallback = {
    light: DEFAULT_CANVAS_BG_LIGHT,
    dark: DEFAULT_CANVAS_BG_DARK,
  };
  const src = raw && typeof raw === "object" ? raw : {};
  const normalizeColor = (value, defaultColor) => {
    const text = String(value || "").trim();
    if (!text) return defaultColor;
    if (/^#[0-9a-fA-F]{6}$/.test(text) || /^#[0-9a-fA-F]{3}$/.test(text)) return text;
    return defaultColor;
  };
  return {
    light: normalizeColor(src.light, fallback.light),
    dark: normalizeColor(src.dark, fallback.dark),
  };
}

export function normalizeProjectUiPreferences(raw, fallback = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const fb = fallback && typeof fallback === "object" ? fallback : {};
  const pickBool = (key, defaultValue) => {
    if (typeof src[key] === "boolean") return src[key];
    if (typeof fb[key] === "boolean") return fb[key];
    return defaultValue;
  };
  const pickLiveMenuExpandedWidth = () => {
    const rawWidth = Number(src.liveMenuExpandedWidth);
    if (Number.isFinite(rawWidth) && rawWidth > 0) {
      return Math.max(
        LIVE_MENU_EXPANDED_WIDTH_MIN,
        Math.min(LIVE_MENU_EXPANDED_WIDTH_MAX, Math.floor(rawWidth))
      );
    }
    const fallbackWidth = Number(fb.liveMenuExpandedWidth);
    if (Number.isFinite(fallbackWidth) && fallbackWidth > 0) {
      return Math.max(
        LIVE_MENU_EXPANDED_WIDTH_MIN,
        Math.min(LIVE_MENU_EXPANDED_WIDTH_MAX, Math.floor(fallbackWidth))
      );
    }
    return LIVE_MENU_EXPANDED_WIDTH_DEFAULT;
  };
  return {
    showGrid: pickBool("showGrid", true),
    showTagPaths: pickBool("showTagPaths", false),
    showRulers: pickBool("showRulers", true),
    liveMenuCollapsed: pickBool("liveMenuCollapsed", false),
    liveMenuExpandedWidth: pickLiveMenuExpandedWidth(),
  };
}

export function defaultLiveMenuGroupsFromScreens(sourceScreens) {
  const screens = Array.isArray(sourceScreens) ? sourceScreens : [];
  const items = screens
    .filter((screen) => screen?.showInLiveMenu !== false)
    .map((screen) => ({
      id: `live-item-${uid()}`,
      type: "screen",
      screenId: String(screen?.id || ""),
      label: "",
      icon: "MonitorRounded",
      restricted: false,
      allowedRoleIds: [],
    }))
    .filter((item) => item.screenId);
  return [
    {
      id: `live-group-${uid()}`,
      name: "Main",
      items,
    },
  ];
}

export function normalizeRoleIdList(value) {
  const list = Array.isArray(value) ? value : [];
  const ids = list
    .map((x) => Number.parseInt(String(x), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Array.from(new Set(ids));
}

export function normalizeLiveMenuGroups(rawGroups, sourceScreens) {
  const screens = Array.isArray(sourceScreens) ? sourceScreens : [];
  const screenIds = new Set(screens.map((s) => String(s?.id || "")).filter(Boolean));
  const groups = Array.isArray(rawGroups) ? rawGroups : [];
  const normalized = groups
    .map((group) => {
      const name = String(group?.name ?? "");
      const items = (Array.isArray(group?.items) ? group.items : [])
        .map((item) => {
          const rawType = String(item?.type || "").toLowerCase();
          const type =
            rawType === "data"
              ? "data"
              : rawType === "reports"
              ? "reports"
              : "screen";
          if (type === "screen") {
            const screenId = String(item?.screenId || "").trim();
            if (!screenId || !screenIds.has(screenId)) return null;
            return {
              id: String(item?.id || `live-item-${uid()}`),
              type,
              screenId,
              label: String(item?.label || "").trim(),
              icon: normalizeLiveMenuIcon(item?.icon),
              restricted: Boolean(item?.restricted),
              allowedRoleIds: normalizeRoleIdList(item?.allowedRoleIds),
            };
          }
          if (type === "reports") {
            return {
              id: String(item?.id || `live-item-${uid()}`),
              type: "reports",
              label: String(item?.label || "").trim(),
              icon: normalizeLiveMenuIcon(item?.icon),
              restricted: Boolean(item?.restricted),
              allowedRoleIds: normalizeRoleIdList(item?.allowedRoleIds),
            };
          }
          return {
            id: String(item?.id || `live-item-${uid()}`),
            type: "data",
            dataTable: String(item?.dataTable || "").trim(),
            label: String(item?.label || "").trim(),
            icon: normalizeLiveMenuIcon(item?.icon),
            restricted: Boolean(item?.restricted),
            allowedRoleIds: normalizeRoleIdList(item?.allowedRoleIds),
          };
        })
        .filter(Boolean);
      return {
        id: String(group?.id || `live-group-${uid()}`),
        name,
        items,
      };
    });

  if (!normalized.length) return defaultLiveMenuGroupsFromScreens(screens);
  return normalized;
}
