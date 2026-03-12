// src/App.jsx
import { Fragment, Suspense, lazy, useMemo, useRef, useState, useEffect, useLayoutEffect } from "react";
import PropertiesPanel from "./components/PropertiesPanel";
import ImportModal from "./components/ImportModal";
import WidgetSelectorModal from "./components/WidgetSelectorModal";
import CanvasSvg from "./components/CanvasSvg";
import ViewBoxModal from "./components/ViewBoxModal";
import TopBarRightControls from "./components/TopBarRightControls";
import LiveAlarmBar from "./components/live/LiveAlarmBar";
import LiveEquipmentConnectorLayer from "./components/live/LiveEquipmentConnectorLayer";
import TeamChatPanel from "./components/app/TeamChatPanel";
import { useAuth } from "./components/AuthContext.jsx";

import { uid } from "./utils/ids";
import { stripOuterSvg } from "./utils/svgSanitize";
import {
  VB_W,
  VB_H,
  GRID,
  snap,
  fmt,
  numOrNull,
  dist2,
  distance,
  clonePoints,
  closestPointOnSegment,
  bboxOfPoints,
  toggleIn,
} from "./utils/geometry";

import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLiveMenuAccess } from "./hooks/useLiveMenuAccess";
import { useTeamChat } from "./hooks/useTeamChat";
import { exportToIgnitionJson, downloadIgnitionJson } from "./utils/ignitionExport";
import { toastError, toastSuccess } from "./utils/toast";
import { clearProjectDraft, getProjectDraftStorageKey } from "./utils/projectDraftStorage";
import {
  DEFAULT_CANVAS_BG_DARK,
  DEFAULT_CANVAS_BG_LIGHT,
  LIVE_MENU_EXPANDED_WIDTH_DEFAULT,
  LIVE_MENU_EXPANDED_WIDTH_KEY,
  LIVE_MENU_EXPANDED_WIDTH_MAX,
  LIVE_MENU_EXPANDED_WIDTH_MIN,
  defaultLiveMenuGroupsFromScreens,
  normalizeLiveMenuGroups,
  normalizeProjectCanvasBackground,
  normalizeProjectMode,
  normalizeProjectUiPreferences,
  normalizeRoleIdList,
  readStoredActiveProjectId,
  readStoredProjectMode,
} from "./utils/projectHelpers";
import {
  getViewportZoomKey,
  getViewportZoomCacheLastKey,
  normalizeZoomByViewportMap,
  readViewportZoomCache,
  resolveZoomForViewportMap,
  resolveZoomFromViewportCache,
  writeViewportZoomCache,
} from "./utils/viewportZoom";
import {
  getFolderFromKey,
  isTruthyFlag,
  normalizeAlarmOperatorValue,
  normalizeProjectPlcEntries,
  normalizeTableDisplayName,
  normalizeTagValue,
  tokenizeSvgCatalogText,
} from "./utils/appDataTransforms";
import {
  MAIN_DRAWER_WIDTH_VIEW_KEYS,
  evaluateAlarmCondition,
  getMainDrawerWidthForView,
  inferETypeFromFileKey,
  isBinEType,
  isMotorEType,
  isOverlayETypeAutoManaged,
  isRouteIdTagKey,
  isStateTagKey,
  isSvgMarkup,
  normalizeMainDrawerWidthViewKey,
  normalizeRouteTagKey,
  normalizeSeriesTagsValue,
  parseDbTagPath,
  readFirstInnerSvgText,
  readStoredDrawerFullscreen,
  resolveOverlayEType,
  toDatetimeLocalInput,
  writeFirstInnerSvgText,
} from "./utils/appUiHelpers";
import { defaultWidgetSettings, widgetTemplate } from "./utils/widgetTemplates";
import {
  fetchBatchFirstValues,
  getTableMeta,
  insertTableRow,
  listActiveAlarms,
  listAllEquipment,
  listAllRoutes,
  listDbTables,
  listEquipmentByProject,
  listEquipmentTypes,
  listRoutesByProject,
  listTableRecords,
  listTableRecordsUnscoped,
  updateTableRow,
} from "./api/dbApi";
import { getOpcConfig, getOpcMappingSets, getOpcStatus, getOpcTagMappings, getOpcTemplates, writeOpcValue } from "./api/opcApi";
import {
  deleteProjectById,
  getProjectById,
  listProjectCursors,
  listProjects,
  pingUserPresence,
  upsertProjectWithStatus,
  upsertProjectCursor,
} from "./api/projectApi";
import { listSecurityRoles } from "./api/securityApi";
import { listSvgCatalog, readSvgRaw as readSvgRawApi, saveSvgMeta } from "./api/svgApi";
import { checkPlcDebugSession } from "./api/aiApi";
import appLogo from "./assets/Images/logo.png";

const HelpPanel = lazy(() => import("./components/HelpPanel"));
const OpcConfig = lazy(() => import("./components/OpcConfig"));
const DataBrowser = lazy(() => import("./components/DataBrowser"));
const DatasetBuilder = lazy(() => import("./components/DatasetBuilder"));
const DatabaseConfigPanel = lazy(() => import("./components/DatabaseConfigPanel"));
const SqlDesigner = lazy(() => import("./components/SqlDesigner"));
const AutomationRulesPanel = lazy(() => import("./components/AutomationRulesPanel"));
const PlcAnalyzer = lazy(() => import("./components/PlcAnalyzer"));
const ServerDiagnosticsPanel = lazy(() => import("./components/ServerDiagnosticsPanel"));
const LoggerPanel = lazy(() => import("./components/LoggerPanel"));
const SecurityManager = lazy(() => import("./components/SecurityManager"));
const THEME_KEY = "vizi_theme";
const SHOW_GRID_KEY = "vizi_show_grid";
const SHOW_TAG_PATHS_KEY = "vizi_show_tag_paths";
const SHOW_RULERS_KEY = "vizi_show_rulers";
const DRAWER_SIZES_KEY = "vizi_drawer_sizes";
const DRAWER_FULLSCREEN_KEY = "vizi_drawer_fullscreen";
const SVG_RAW_CACHE_MAX = 96;
const LIVE_ALARM_BAR_H = 34;
const LIVE_ALARM_MARQUEE_DURATION_SEC = 30;
const LIVE_EQUIPMENT_Z_BASE = 12000;
const POLYLINE_OVERLAY_SNAP_RADIUS_PX = 7;
const POLYLINE_CONNECTION_SNAP_THRESHOLD = 10;
const POLYLINE_ENDPOINT_SNAP_THRESHOLD = 9;
const SCREEN_SIZE_PRESETS = [
  { value: "1280x720", label: "HD 1280x720", w: 1280, h: 720 },
  { value: "1600x900", label: "HD+ 1600x900", w: 1600, h: 900 },
  { value: "1920x1080", label: "Full HD 1920x1080", w: 1920, h: 1080 },
  { value: "2560x1440", label: "QHD 2560x1440", w: 2560, h: 1440 },
  { value: "3440x1440", label: "UWQHD 3440x1440", w: 3440, h: 1440 },
  { value: "3840x2160", label: "4K 3840x2160", w: 3840, h: 2160 },
];

export default function App() {
  const { user, logout, updateProfile, changePassword, refresh } = useAuth();
  const initialStoredProjectId = readStoredActiveProjectId();
  const [tool, setTool] = useState("select"); // "select" | "polyline" | "rect" | "circle"
  useEffect(() => {
    // Warm-load PLC/Code Gen chunk so opening drawer feels instant.
    import("./components/PlcAnalyzer").catch(() => {});
  }, []);
  const DEFAULT_STROKE = "#808080";
  const DEFAULT_FILL = "#CCCCCC";
  const [shapes, setShapes] = useState([]); // polyline | rect | circle | text

  // Multi-selection
  const [selectedIds, setSelectedIds] = useState([]); // polyline ids
  const [selectedOverlayIds, setSelectedOverlayIds] = useState([]); // overlay ids
  const [selectionMode, setSelectionMode] = useState("all"); // "all" | "svg" | "polyline"

  // drawing = { mode:"draw-poly"|"draw-rect"|"draw-circle", id, start?:{x,y} }
  const [drawing, setDrawing] = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null); // { id, value, kind: "shape" | "overlay" }

  // unified drag for moving ALL selected items
  // { startWorld, polylines:[{id, origPoints}], overlays:[{id, origTx, origTy}] }
  const [dragAll, setDragAll] = useState(null);
  const [canvasPanDrag, setCanvasPanDrag] = useState(null); // { startClient:{x,y}, startPan:{x,y}, moved:boolean }

  // editing a polyline
  const [editingId, setEditingId] = useState(null); // double-click line to edit
  const [dragHandle, setDragHandle] = useState(null); // { id, index }
  const [selectedSegment, setSelectedSegment] = useState(null); // { id, index, kind: "point" }

  // Import picker UI
  const [importOpen, setImportOpen] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [lastContextPoint, setLastContextPoint] = useState(null);
  const [panelCursor, setPanelCursor] = useState(null);
  const [contextImportQuery, setContextImportQuery] = useState("");
  const [contextSvgTagQuery, setContextSvgTagQuery] = useState("");
  const [contextSvgMenuOpen, setContextSvgMenuOpen] = useState(false);
  const [contextSvgMenuPos, setContextSvgMenuPos] = useState({ x: 0, y: 0 });
  const contextSvgMenuTimerRef = useRef(null);
  const svgMenuInputRef = useRef(null);
  const [duplicateOffset, setDuplicateOffset] = useState(20);
  const duplicateOffsetRef = useRef(20);
  const mouseMoveRafRef = useRef(0);
  const pendingMouseMoveRef = useRef(null);
  const dragPointerSmoothingRef = useRef({ mode: "", x: NaN, y: NaN });
  const [polyHandleMenu, setPolyHandleMenu] = useState(null);

  // SVG overlays (imported files): { id, name, inner, tx, ty, scale, fill, stroke, tagPath }
  const [svgOverlays, setSvgOverlays] = useState([]);

  // overlay resize
  const [overlayResize, setOverlayResize] = useState(null); // single: { id, anchorLocal, anchorWorld, startDist, origScaleX, origScaleY } | group: { kind:"group", anchorWorld, startDist, overlays:[{id, tx, ty, sx, sy}] }
  const [shapeResize, setShapeResize] = useState(null); // { corner, anchor:{x,y} }

  // ? Export settings (dynamic)
  const [exportVB, setExportVB] = useState({ x: 0, y: 0, w: 1600, h: 900 });
  const [exportBasis, setExportBasis] = useState({ w: 1600, h: 900 }); // affects Perspective "basis"
  const [showZoom, setShowZoom] = useState(true);
  const [designDockExpanded, setDesignDockExpanded] = useState(false);
  const [showGrid, setShowGrid] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem(SHOW_GRID_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [showTagPaths, setShowTagPaths] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(SHOW_TAG_PATHS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [showRulers, setShowRulers] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem(SHOW_RULERS_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [hiddenTagBubbleIds, setHiddenTagBubbleIds] = useState([]);
  const [liveEquipmentOverlayIds, setLiveEquipmentOverlayIds] = useState([]);
  const [liveEquipmentDockSideById, setLiveEquipmentDockSideById] = useState({});
  const [liveEquipmentFloatingById, setLiveEquipmentFloatingById] = useState({});
  const [liveEquipmentConnectFxById, setLiveEquipmentConnectFxById] = useState({});
  const [liveEquipmentLiveDataCollapsedByOverlay, setLiveEquipmentLiveDataCollapsedByOverlay] = useState({});
  const MAX_LIVE_EQUIPMENT_POPUPS = 120;
  const prevLiveEquipmentOverlayIdsRef = useRef([]);
  const liveEquipmentConnectFxTimersRef = useRef(new Map());
  const liveEquipmentCardRefs = useRef(new Map());
  const liveEquipmentDragRef = useRef(null);
  const liveEquipmentModeToggleHintRef = useRef({});
  const liveEquipmentZCounterRef = useRef(0);
  const [liveEquipmentZById, setLiveEquipmentZById] = useState({});
  const [liveEquipmentDockTick, setLiveEquipmentDockTick] = useState(0);
  const [liveEquipmentDrawerOverlayId, setLiveEquipmentDrawerOverlayId] = useState("");
  const [liveEquipmentWriteBusyByOverlay, setLiveEquipmentWriteBusyByOverlay] = useState({});
  const [liveEquipmentWriteErrorByOverlay, setLiveEquipmentWriteErrorByOverlay] = useState({});
  const liveEquipmentDockScrollRafRef = useRef(0);
  const liveAlarmMarqueeViewportRef = useRef(null);
  const liveAlarmMarqueeTrackRef = useRef(null);
  const [marquee, setMarquee] = useState(null);

  const [vbW, setVbW] = useState(1600);
  const [vbH, setVbH] = useState(900);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [viewBoxOpen, setViewBoxOpen] = useState(false);

  const [importAnchor, setImportAnchor] = useState(null);

  const [opcTags, setOpcTags] = useState([]);
  const [opcTemplates, setOpcTemplates] = useState([]);
  const [opcLiveValues, setOpcLiveValues] = useState({});
  const [opcLiveUpdatedAt, setOpcLiveUpdatedAt] = useState(0);
  const [opcLiveLastError, setOpcLiveLastError] = useState("");
  const [opcTagMappings, setOpcTagMappings] = useState([]);
  const [opcMappingSets, setOpcMappingSets] = useState([]);
  const [widgetDbValues, setWidgetDbValues] = useState({});
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden
  );


  const overlayRefs = useRef(new Map()); // id -> <g> element containing imported inner
  const svgRef = useRef(null);
  const clipboardRef = useRef({ shapes: [], overlays: [], pasteCount: 0 });
  const motorHmiStateByOverlayRef = useRef(new Map());

  const shapesRef = useRef(shapes);
  const overlaysRef = useRef(svgOverlays);
  const selPolyRef = useRef(selectedIds);
  const selOverRef = useRef(selectedOverlayIds);
  const projectFileRef = useRef(null);
  const splitNormalizeInFlightRef = useRef(false);
  const skipNextSplitNormalizeRef = useRef(false);
  const svgRawCacheRef = useRef(new Map());
  const [projectHandle, setProjectHandle] = useState(null);
  const [projectName, setProjectName] = useState("Untitled");
  const [projectNameDraft, setProjectNameDraft] = useState("Untitled");
  const [projectNameEditing, setProjectNameEditing] = useState(false);
  const [projectModeDraft, setProjectModeDraft] = useState("design");
  const [screenSizeDrafts, setScreenSizeDrafts] = useState({});
  const [autoFitCanvasOnResize, setAutoFitCanvasOnResize] = useState(true);
  const [projectCanvasBackground, setProjectCanvasBackground] = useState(() =>
    normalizeProjectCanvasBackground(null)
  );
  const [projectCanvasBackgroundDraft, setProjectCanvasBackgroundDraft] = useState(() =>
    normalizeProjectCanvasBackground(null)
  );
  const [projectPlcs, setProjectPlcs] = useState([]);
  const [screens, setScreens] = useState([
    {
      id: "screen-1",
      name: "Screen 1",
      shapes: [],
      svgOverlays: [],
      vbW: 1600,
      vbH: 900,
      pan: { x: 0, y: 0 },
      zoom: 1,
      showInLiveMenu: true,
      routeId: "",
    },
  ]);
  const [activeScreenId, setActiveScreenId] = useState("screen-1");
  const [screenName, setScreenName] = useState("Screen 1");
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(() => initialStoredProjectId);
  const [projectRouteRows, setProjectRouteRows] = useState([]);
  const [projectEquipmentRows, setProjectEquipmentRows] = useState([]);
  const [projectBinRows, setProjectBinRows] = useState([]);
  const [projectBinTableName, setProjectBinTableName] = useState("");
  const [projectProductRows, setProjectProductRows] = useState([]);
  const [projectProductTableName, setProjectProductTableName] = useState("");
  const [liveBinProductDraftByOverlay, setLiveBinProductDraftByOverlay] = useState({});
  const [liveBinProductSaveBusyByOverlay, setLiveBinProductSaveBusyByOverlay] = useState({});
  const [liveBinProductSaveErrorByOverlay, setLiveBinProductSaveErrorByOverlay] = useState({});
  const [liveBinLevelDraftByOverlay, setLiveBinLevelDraftByOverlay] = useState({});
  const [liveBinLevelSaveBusyByOverlay, setLiveBinLevelSaveBusyByOverlay] = useState({});
  const [liveBinLevelSaveErrorByOverlay, setLiveBinLevelSaveErrorByOverlay] = useState({});
  const [projectStatus, setProjectStatus] = useState("");
  const [projectIdentityReady, setProjectIdentityReady] = useState(() => !initialStoredProjectId);
  const [lastProjectSaveAt, setLastProjectSaveAt] = useState("");
  const [lastProjectSaveKind, setLastProjectSaveKind] = useState(""); // "auto" | "manual" | ""
  const [hasPendingAutoSave, setHasPendingAutoSave] = useState(false);
  const [activeProjectUpdatedAt, setActiveProjectUpdatedAt] = useState("");
  const [activeProjectUpdatedBy, setActiveProjectUpdatedBy] = useState("");
  const [projectCursors, setProjectCursors] = useState([]);
  const [livePresenceUsers, setLivePresenceUsers] = useState([]);
  const [showProjectNameInput, setShowProjectNameInput] = useState(false);
  const [showProjectDrawer, setShowProjectDrawer] = useState(false);
  const [projectMode, setProjectMode] = useState(() => readStoredProjectMode(initialStoredProjectId));
  const isLiveMode = projectMode === "live";
  const [liveMenuCollapsed, setLiveMenuCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("vizi_live_menu_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [liveMenuHoverItemId, setLiveMenuHoverItemId] = useState("");
  const [liveMenuExpandedWidth, setLiveMenuExpandedWidth] = useState(() => {
    if (typeof window === "undefined") return LIVE_MENU_EXPANDED_WIDTH_DEFAULT;
    try {
      const stored = Number(localStorage.getItem(LIVE_MENU_EXPANDED_WIDTH_KEY));
      if (Number.isFinite(stored) && stored > 0) {
        return Math.max(
          LIVE_MENU_EXPANDED_WIDTH_MIN,
          Math.min(LIVE_MENU_EXPANDED_WIDTH_MAX, Math.floor(stored))
        );
      }
    } catch {
      // ignore storage read errors
    }
    return LIVE_MENU_EXPANDED_WIDTH_DEFAULT;
  });
  const [mainDrawerFullscreen, setMainDrawerFullscreen] = useState(() => readStoredDrawerFullscreen("main"));
  const [userDrawerFullscreen, setUserDrawerFullscreen] = useState(() => readStoredDrawerFullscreen("user"));
  const [projectDrawerFullscreen, setProjectDrawerFullscreen] = useState(() => readStoredDrawerFullscreen("project"));
  const [projectDrawerTab, setProjectDrawerTab] = useState("project");
  const [databaseEmbeddedPath, setDatabaseEmbeddedPath] = useState("");
  const [databaseEmbeddedRouteId, setDatabaseEmbeddedRouteId] = useState("");
  const [databaseEmbeddedRouteName, setDatabaseEmbeddedRouteName] = useState("");
  const [databaseDataOnlyMode, setDatabaseDataOnlyMode] = useState(false);
  const [databaseTablesForMenu, setDatabaseTablesForMenu] = useState([]);
  const [svgETypeOptions, setSvgETypeOptions] = useState([]);
  const [securityRolesForMenu, setSecurityRolesForMenu] = useState([]);
  const [showTeamChat, setShowTeamChat] = useState(false);
  const {
    teamChatMessages,
    teamChatDraft,
    setTeamChatDraft,
    teamChatLoading,
    teamChatSending,
    teamChatUnreadCount,
    teamChatBodyRef,
    chatContextDocs,
    chatContextUploading,
    sendTeamChatMessage,
    uploadL5xContextFile,
    clearL5xContextDocs,
  } = useTeamChat({
    userId: user?.id,
    isPageVisible,
    showTeamChat,
    onAiAction: handleTeamChatAiAction,
    canAskAi: true,
    canApplyAiAction: !isLiveMode,
    chatMode: isLiveMode ? "live" : "design",
  });
  const [liveActiveAlarmsDb, setLiveActiveAlarmsDb] = useState([]);
  const [liveActiveAlarmsDbLoaded, setLiveActiveAlarmsDbLoaded] = useState(false);
  const [svgCatalogFiles, setSvgCatalogFiles] = useState([]);
  const [canvasViewportScrollTarget, setCanvasViewportScrollTarget] = useState({ x: 0, y: 0 });
  const [liveMenuGroups, setLiveMenuGroups] = useState(() =>
    defaultLiveMenuGroupsFromScreens([
      { id: "screen-1", name: "Screen 1", showInLiveMenu: true },
    ])
  );
  const [collapsedLiveGroupIds, setCollapsedLiveGroupIds] = useState([]);
  const lastProjectSignatureRef = useRef("");
  const projectSaveInFlightRef = useRef(false);
  const autoSaveTimerRef = useRef(null);
  const pendingSilentSaveRef = useRef(false);
  const queuedSaveAfterFlightRef = useRef(null); // null | save options
  const liveDragSyncRef = useRef({ at: 0 });
  const liveDragSyncTimerRef = useRef(null);
  const liveDragSyncQueuedRef = useRef(false);
  const uiPreferenceAutosaveReadyRef = useRef(false);
  const projectHydrationReadyRef = useRef(false);
  const opcStatusFailureCountRef = useRef(0);
  const opcStatusNextAttemptAtRef = useRef(0);
  const lastOpcToastErrorRef = useRef("");
  const autoFitInitRef = useRef(false);
  const zoomHoldTimeoutRef = useRef(null);
  const zoomHoldIntervalRef = useRef(null);
  const rememberedButtonZoomRef = useRef(1);
  const isInteractingRef = useRef(false);
  const lastCursorSentRef = useRef({ at: 0, x: NaN, y: NaN });
  const cursorPublishInFlightRef = useRef(false);
  const queuedCursorPointRef = useRef(null);
  const projectNameRef = useRef(projectName);
  const showGridRef = useRef(showGrid);
  const showTagPathsRef = useRef(showTagPaths);
  const showRulersRef = useRef(showRulers);
  const liveMenuCollapsedRef = useRef(liveMenuCollapsed);
  const liveMenuExpandedWidthRef = useRef(liveMenuExpandedWidth);
  const projectCanvasBackgroundRef = useRef(projectCanvasBackground);
  const projectPlcsRef = useRef(projectPlcs);
  const screensRef = useRef(screens);
  const liveMenuGroupsRef = useRef(liveMenuGroups);
  const canvasViewportScrollRef = useRef({ x: 0, y: 0 });
  const activeProjectIdRef = useRef(activeProjectId);
  const activeProjectUpdatedAtRef = useRef(activeProjectUpdatedAt);
  const projectModeRef = useRef(projectMode);
  const activeScreenIdRef = useRef(activeScreenId);
  const screenNameRef = useRef(screenName);
  const vbWRef = useRef(vbW);
  const vbHRef = useRef(vbH);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const projectModeStorageKey = useMemo(
    () => `vizi_project_mode:${String(activeProjectId || "default")}`,
    [activeProjectId]
  );
  const projectDraftStorageKey = useMemo(
    () => getProjectDraftStorageKey(activeProjectId),
    [activeProjectId]
  );

  useEffect(() => {
    projectNameRef.current = projectName;
    showGridRef.current = showGrid;
    showTagPathsRef.current = showTagPaths;
    showRulersRef.current = showRulers;
    liveMenuCollapsedRef.current = liveMenuCollapsed;
    liveMenuExpandedWidthRef.current = liveMenuExpandedWidth;
    projectCanvasBackgroundRef.current = projectCanvasBackground;
    projectPlcsRef.current = projectPlcs;
    screensRef.current = screens;
    liveMenuGroupsRef.current = liveMenuGroups;
    activeProjectIdRef.current = activeProjectId;
    activeProjectUpdatedAtRef.current = activeProjectUpdatedAt;
    projectModeRef.current = projectMode;
    activeScreenIdRef.current = activeScreenId;
    screenNameRef.current = screenName;
    vbWRef.current = vbW;
    vbHRef.current = vbH;
    panRef.current = pan;
    zoomRef.current = zoom;
  }, [projectName, showGrid, showTagPaths, showRulers, liveMenuCollapsed, liveMenuExpandedWidth, projectCanvasBackground, projectPlcs, screens, liveMenuGroups, activeProjectId, activeProjectUpdatedAt, projectMode, activeScreenId, screenName, vbW, vbH, pan, zoom]);

  useLayoutEffect(() => {
    panRef.current = pan;
    zoomRef.current = zoom;
  }, [pan, zoom]);

  useEffect(() => {
    setSvgOverlays((prev) => {
      let changed = false;
      const next = prev.map((o) => {
        const kind = String(o?.widget?.kind || "").trim();
        const bb = o?.bbox;
        if (kind !== "countdownBar" || !bb) return o;
        const width = Number(bb.width);
        const height = Number(bb.height);
        // One-time migration for legacy countdown widgets created from the old 320x180 template.
        if (
          Number.isFinite(width) &&
          Number.isFinite(height) &&
          Math.abs(width - 320) <= 1 &&
          Math.abs(height - 180) <= 1
        ) {
          changed = true;
          return {
            ...o,
            bbox: {
              ...bb,
              height: 72,
            },
          };
        }
        return o;
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (projectNameEditing) return;
    setProjectNameDraft(projectName || "");
    setProjectModeDraft(normalizeProjectMode(projectMode));
    setProjectCanvasBackgroundDraft(normalizeProjectCanvasBackground(projectCanvasBackground));
  }, [projectName, projectMode, projectCanvasBackground, projectNameEditing]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("vizi_live_menu_collapsed", liveMenuCollapsed ? "1" : "0");
    } catch {
      // ignore storage write errors
    }
  }, [liveMenuCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        LIVE_MENU_EXPANDED_WIDTH_KEY,
        String(
          Math.max(
            LIVE_MENU_EXPANDED_WIDTH_MIN,
            Math.min(LIVE_MENU_EXPANDED_WIDTH_MAX, Math.floor(Number(liveMenuExpandedWidth) || LIVE_MENU_EXPANDED_WIDTH_DEFAULT))
          )
        )
      );
    } catch {
      // ignore storage write errors
    }
  }, [liveMenuExpandedWidth]);

  useEffect(() => {
    const nextMode = readStoredProjectMode(activeProjectId || "");
    setProjectMode(nextMode);
  }, [activeProjectId]);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    async function loadDbTablesForMenu() {
      const retries = [0, 250, 700];
      for (let i = 0; i < retries.length; i += 1) {
        if (retries[i] > 0) {
          await sleep(retries[i]);
        }
        try {
          const data = await listDbTables();
          if (!alive) return;
          const tables = Array.isArray(data?.tables)
            ? data.tables.map((t) => String(t || "").trim()).filter(Boolean)
            : [];
          setDatabaseTablesForMenu(tables);
          return;
        } catch {
          if (!alive) return;
        }
      }
      if (alive) setDatabaseTablesForMenu([]);
    }
    loadDbTablesForMenu();
    return () => {
      alive = false;
    };
  }, [isPageVisible]);

  useEffect(() => {
    let alive = true;
    async function loadSvgETypeOptions() {
      try {
        const data = await listEquipmentTypes(200);
        if (!alive) return;
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        const seen = new Set();
        const out = [];
        for (const row of rows) {
          const value = String(
            row?.name ?? row?.etype ?? row?.type ?? row?.value ?? row?.label ?? ""
          ).trim();
          if (!value) continue;
          const key = value.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(value);
        }
        if (alive) setSvgETypeOptions(out);
      } catch {
        if (alive) setSvgETypeOptions([]);
      }
    }
    loadSvgETypeOptions();
    return () => {
      alive = false;
    };
  }, [isPageVisible]);

  useEffect(() => {
    if (!isLiveMode) {
      setLiveActiveAlarmsDb([]);
      setLiveActiveAlarmsDbLoaded(false);
      return undefined;
    }
    let cancelled = false;
    let timer = 0;
    const pollMs = isPageVisible ? 2000 : 6000;
    const fetchActiveAlarms = async () => {
      try {
        const data = await listActiveAlarms();
        if (cancelled) return;
        const rows = Array.isArray(data?.active) ? data.active : [];
        setLiveActiveAlarmsDb(
          rows.map((row, idx) => {
            const occurredAt = Number(new Date(row?.first_triggered_at || 0).getTime() || 0);
            return {
              id: String(row?.alarm_key || `${row?.topic || "alarm"}.${row?.label || idx}.${idx}`),
              label: String(row?.label || row?.tag_path || `Alarm ${idx + 1}`),
              topic: String(row?.topic || ""),
              operator: String(row?.operator || ""),
              threshold: String(row?.threshold ?? ""),
              value: row?.last_value == null || row?.last_value === "" ? "-" : String(row?.last_value),
              occurredAt,
            };
          })
        );
        setLiveActiveAlarmsDbLoaded(true);
      } catch {
        if (cancelled) return;
        setLiveActiveAlarmsDb([]);
        setLiveActiveAlarmsDbLoaded(true);
      } finally {
        if (cancelled) return;
        timer = window.setTimeout(fetchActiveAlarms, pollMs);
      }
    };
    fetchActiveAlarms();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [isLiveMode, isPageVisible]);

  useEffect(() => {
    let alive = true;
    async function loadSvgCatalog() {
      try {
        const data = await listSvgCatalog();
        if (!alive) return;
        const files = Array.isArray(data?.files)
          ? data.files
              .map((f) => ({
                key: String(f?.key || "").trim(),
                name: String(f?.name || "").trim(),
                url: String(f?.url || "").trim(),
              }))
              .filter((f) => f.key && f.name && f.url)
          : [];
        setSvgCatalogFiles(files);
      } catch {
        if (alive) setSvgCatalogFiles([]);
      }
    }
    loadSvgCatalog();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!importOpen) return undefined;
    let alive = true;
    async function loadSvgCatalogOnOpen() {
      try {
        const data = await listSvgCatalog();
        if (!alive) return;
        const files = Array.isArray(data?.files)
          ? data.files
              .map((f) => ({
                key: String(f?.key || "").trim(),
                name: String(f?.name || "").trim(),
                url: String(f?.url || "").trim(),
              }))
              .filter((f) => f.key && f.name && f.url)
          : [];
        if (files.length) setSvgCatalogFiles(files);
      } catch {
        // keep existing catalog if refresh fails
      }
    }
    loadSvgCatalogOnOpen();
    return () => {
      alive = false;
    };
  }, [importOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(projectModeStorageKey, normalizeProjectMode(projectMode));
      localStorage.setItem("vizi_project_mode:last", normalizeProjectMode(projectMode));
    } catch {
      // ignore storage write errors
    }
  }, [projectMode, projectModeStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = String(activeProjectId || "").trim();
    if (!id) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          projectDraftStorageKey,
          JSON.stringify({ savedAt: Date.now(), payload: getProjectPayloadFromRefs() })
        );
      } catch {
        // ignore draft persistence failures
      }
    }, 180);
    return () => clearTimeout(t);
  }, [
    activeProjectId,
    projectDraftStorageKey,
    projectMode,
    projectName,
    projectCanvasBackground,
    projectPlcs,
    screens,
    activeScreenId,
    screenName,
    vbW,
    vbH,
    pan,
    zoom,
    shapes,
    svgOverlays,
    liveMenuGroups,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onBeforeUnload = (event) => {
      const id = String(activeProjectIdRef.current || "").trim();
      if (!id) return;
      try {
        const rect = svgRef.current?.getBoundingClientRect?.();
        const viewportKey = getViewportZoomKey(rect);
        const screenId = String(activeScreenIdRef.current || "");
        const z = Number(zoomRef.current);
        if (viewportKey && screenId && Number.isFinite(z) && z > 0) {
          const cache = readViewportZoomCache();
          cache[`${id}|${screenId}|${viewportKey}`] = z;
          const lastKey = getViewportZoomCacheLastKey(id, screenId);
          if (lastKey) cache[lastKey] = z;
          writeViewportZoomCache(cache);
        }
      } catch {
        // ignore viewport zoom cache persistence failures
      }
      try {
        localStorage.setItem(
          getProjectDraftStorageKey(id),
          JSON.stringify({ savedAt: Date.now(), payload: getProjectPayloadFromRefs() })
        );
      } catch {
        // ignore
      }
      const shouldWarn =
        pendingSilentSaveRef.current ||
        projectSaveInFlightRef.current ||
        !!queuedSaveAfterFlightRef.current ||
        hasUnsavedProjectChangesFromRefs();
      if (shouldWarn) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [projectMode, liveMenuGroups]);

  useEffect(() => {
    isInteractingRef.current = Boolean(dragAll || dragHandle || overlayResize || shapeResize || marquee || drawing);
  }, [dragAll, dragHandle, overlayResize, shapeResize, marquee, drawing]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVis = () => setIsPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    let alive = true;
    let configNextAttemptAt = 0;
    const wait = (ms) =>
      new Promise((resolve) => {
        window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
      });
    async function loadConfig() {
      if (Date.now() < configNextAttemptAt) return;
      const retryDelaysMs = [0, 300, 900];
      for (let i = 0; i < retryDelaysMs.length; i += 1) {
        if (!alive) return;
        if (retryDelaysMs[i] > 0) {
          await wait(retryDelaysMs[i]);
          if (!alive) return;
        }
        try {
          const data = await getOpcConfig();
          if (!alive) return;
          const tags = Array.isArray(data?.tags) ? data.tags : [];
          setOpcTags(tags);
          configNextAttemptAt = 0;
          return;
        } catch {
          if (i === retryDelaysMs.length - 1) {
            // back off failed config calls so proxy logs are not spammed during restarts
            configNextAttemptAt = Date.now() + 15000;
          }
        }
      }
    }
    async function loadTemplates() {
      try {
        const data = await getOpcTemplates();
        if (!alive) return;
        setOpcTemplates(data.templates || []);
      } catch {
        // ignore
      }
    }
    async function loadTagMappings() {
      try {
        const data = await getOpcTagMappings();
        if (!alive) return;
        setOpcTagMappings(data.mappings || []);
      } catch {
        // ignore
      }
    }
    async function loadMappingSets() {
      try {
        const data = await getOpcMappingSets();
        if (!alive) return;
        setOpcMappingSets(data.sets || []);
      } catch {
        // ignore
      }
    }
    loadConfig();
    loadTemplates();
    loadTagMappings();
    loadMappingSets();
    const configPollMs = isPageVisible ? (isLiveMode ? 8000 : 12000) : 60000;
    const metaPollMs = isPageVisible ? 20000 : 180000;
    const configId = setInterval(loadConfig, configPollMs);
    const templateId = setInterval(loadTemplates, metaPollMs);
    const mappingId = setInterval(loadTagMappings, metaPollMs);
    const mappingSetId = setInterval(loadMappingSets, metaPollMs);
    return () => {
      alive = false;
      clearInterval(configId);
      clearInterval(templateId);
      clearInterval(mappingId);
      clearInterval(mappingSetId);
    };
  }, [isPageVisible, isLiveMode]);

  useEffect(() => {
    let alive = true;
    async function pollStatus() {
      if (!isPageVisible) return;
      if (Date.now() < Number(opcStatusNextAttemptAtRef.current || 0)) return;
      try {
        const data = await getOpcStatus();
        if (!alive) return;
        setOpcLiveValues(data.values || {});
        const atMs =
          Number(new Date(data?.at || 0).getTime() || 0) || Date.now();
        setOpcLiveUpdatedAt(atMs);
        opcStatusFailureCountRef.current = 0;
        opcStatusNextAttemptAtRef.current = 0;
        const connectedFlag =
          typeof data?.connected === "boolean" ? data.connected : null;
        const staleFlag = data?.stale === true;
        if (connectedFlag === false) {
          setOpcLiveLastError(
            staleFlag ? "OPC disconnected (status stale)." : "OPC disconnected."
          );
        } else {
          setOpcLiveLastError("");
        }
      } catch {
        if (!alive) return;
        const fails = Number(opcStatusFailureCountRef.current || 0) + 1;
        opcStatusFailureCountRef.current = fails;
        // Grace period for transient restarts; only surface after repeated failures.
        if (fails >= 3) setOpcLiveLastError("OPC status unavailable");
        const backoffMs = Math.min(30000, 2000 * fails);
        opcStatusNextAttemptAtRef.current = Date.now() + backoffMs;
      }
    }
    pollStatus();
    const id = setInterval(
      pollStatus,
      isPageVisible ? (isLiveMode ? 350 : 2000) : 8000
    );
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [isPageVisible, isLiveMode]);

  useEffect(() => {
    const msg = String(opcLiveLastError || "").trim();
    if (!msg) {
      lastOpcToastErrorRef.current = "";
      return;
    }
    if (lastOpcToastErrorRef.current === msg) return;
    lastOpcToastErrorRef.current = msg;
    toastError(msg);
  }, [opcLiveLastError]);

  useEffect(() => {
    let alive = true;
    const pollSessionKeepAlive = async () => {
      if (!alive) return;
      const sessionIds = Array.from(
        new Set(
          (Array.isArray(projectPlcs) ? projectPlcs : [])
            .map((plc) => String(plc?.debugSessionId || "").trim())
            .filter(Boolean)
        )
      );
      if (!sessionIds.length) return;
      const staleIds = new Set();
      await Promise.all(
        sessionIds.map(async (id) => {
          try {
            const res = await checkPlcDebugSession(id);
            if (res.status === 404) staleIds.add(id);
          } catch {
            // keepalive is best-effort only
          }
        })
      );
      if (staleIds.size && alive) {
        setProjectPlcs((prev) =>
          (Array.isArray(prev) ? prev : []).map((plc) => {
            const sessionId = String(plc?.debugSessionId || "").trim();
            if (!sessionId || !staleIds.has(sessionId)) return plc;
            return { ...plc, debugSessionId: "" };
          })
        );
      }
    };
    void pollSessionKeepAlive();
    const id = setInterval(pollSessionKeepAlive, isPageVisible ? 12000 : 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [projectPlcs, isPageVisible]);

  useEffect(() => {
    let alive = true;
    async function pollWidgetDbValues() {
      if (!isPageVisible) return;
      const overlays = Array.isArray(svgOverlays) ? svgOverlays : [];
      const widgetBindings = overlays
        .map((o) => ({
          id: String(o?.id || ""),
          tagPath: String(o?.tagPath || "").trim(),
          isWidget: !!o?.widget,
        }))
        .filter((x) => x.isWidget && x.id && x.tagPath.toLowerCase().startsWith("db:"));
      if (!widgetBindings.length) {
        if (alive) setWidgetDbValues({});
        return;
      }
      const bindings = widgetBindings
        .map((b) => {
          const expr = b.tagPath.slice(3).trim();
          const dot = expr.indexOf(".");
          if (dot <= 0 || dot === expr.length - 1) return null;
          const table = expr.slice(0, dot).trim();
          const field = expr.slice(dot + 1).trim();
          if (!table || !field) return null;
          return { overlayId: b.id, table, field };
        })
        .filter(Boolean);
      if (!bindings.length) {
        if (alive) setWidgetDbValues({});
        return;
      }
      let next = {};
      try {
        const data = await fetchBatchFirstValues(bindings);
        if (data?.values && typeof data.values === "object") {
          next = data.values;
        }
      } catch {
        // ignore batch errors
      }
      if (!alive) return;
      setWidgetDbValues(next);
    }
    pollWidgetDbValues();
    const id = setInterval(
      pollWidgetDbValues,
      isPageVisible ? (isLiveMode ? 4000 : 7000) : 15000
    );
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [svgOverlays, isPageVisible, isLiveMode]);

  const opcTemplateMap = useMemo(() => {
    const map = new Map();
    (opcTemplates || []).forEach((t) => map.set(t.name, t));
    return map;
  }, [opcTemplates]);

  const opcTagMappingMap = useMemo(() => {
    const map = new Map();
    (opcTagMappings || []).forEach((m) => {
      const key = String(m.tag_key || "").trim();
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({
        field: String(m.field ?? ""),
        state: String(m.state ?? ""),
        color: String(m.color ?? ""),
      });
    });
    return map;
  }, [opcTagMappings]);

  const opcMappingSetMap = useMemo(() => {
    const map = new Map();
    (opcMappingSets || []).forEach((set) => {
      const name = String(set?.name || "").trim();
      if (!name) return;
      map.set(name, set);
    });
    return map;
  }, [opcMappingSets]);

  const resolveTemplateStateMappings = (name) => {
    const visited = new Set();
    const map = new Map();
    function walk(n) {
      if (!n || visited.has(n)) return;
      visited.add(n);
      const tmpl = opcTemplateMap.get(n);
      if (!tmpl) return;
      if (tmpl.parent_name) {
        walk(tmpl.parent_name);
      }
      if (Array.isArray(tmpl.state_mappings)) {
        tmpl.state_mappings.forEach((m) => {
          const fieldVal = String(m?.field ?? "").trim();
          const stateVal = String(m?.state ?? "").trim();
          if (!stateVal) return;
          const key = `${fieldVal}::${stateVal}`;
          map.set(key, String(m?.color || "").trim());
        });
      }
    }
    walk(name);
    return Array.from(map.entries()).map(([key, color]) => {
      const [field, state] = key.split("::");
      return { field, state, color };
    });
  };

  const tagStateColorsByPath = useMemo(() => {
    const map = new Map();
    const live = opcLiveValues || {};

    const inferGroupName = (tag) => {
      const explicit = normalizeTagValue(tag?.groupName || "");
      if (explicit) return explicit;
      const rawPath = normalizeTagValue(tag?.tagPath || tag?.name || "");
      if (!rawPath.includes(".")) return "";
      return normalizeTagValue(rawPath.slice(0, rawPath.indexOf(".")));
    };

    const readLiveTagValue = (tag, topicName, groupName) => {
      const candidates = [
        topicName && groupName && tag?.tagPath ? `${topicName}.${groupName}.${tag.tagPath}` : "",
        topicName && groupName && tag?.name ? `${topicName}.${groupName}.${tag.name}` : "",
        topicName && tag?.tagPath ? `${topicName}.${tag.tagPath}` : "",
        topicName && tag?.name ? `${topicName}.${tag.name}` : "",
        groupName && tag?.tagPath ? `${groupName}.${tag.tagPath}` : "",
        groupName && tag?.name ? `${groupName}.${tag.name}` : "",
        tag?.tagPath || "",
        tag?.name || "",
      ]
        .map((x) => normalizeTagValue(x))
        .filter(Boolean);
      for (const k of candidates) {
        if (live[k] != null && live[k] !== "") return live[k];
        const lower = k.toLowerCase();
        if (live[lower] != null && live[lower] !== "") return live[lower];
      }
      return null;
    };

    (opcTags || []).forEach((tag) => {
      const tagPath = normalizeTagValue(tag?.tagPath || "");
      const tagName = normalizeTagValue(tag?.name || "");
      const topicName = normalizeTagValue(tag?.topic || "");
      const groupName = inferGroupName(tag);
      const keyCandidates = [
        tagPath,
        topicName && tagName ? `${topicName}.${tagName}` : "",
        topicName && tagPath ? `${topicName}.${tagPath}` : "",
        groupName,
        topicName && groupName ? `${topicName}.${groupName}` : "",
      ].filter(Boolean);
      if (!keyCandidates.length) return;
      const rawValue = readLiveTagValue(tag, topicName, groupName);
      const scale = Number.isFinite(Number(tag?.scale)) ? Number(tag.scale) : 1;
      const value =
        rawValue != null && rawValue !== "" && !Number.isNaN(Number(rawValue))
          ? Number(rawValue) * scale
          : rawValue;
      const templateName = String(tag?.plcType || "").trim();
      const mappingSetName = String(tag?.mappingSet || "").trim();
      if (value == null || value === "") return;
      const mappingKeys = [
        topicName && tagName ? `${topicName}.${tagName}` : "",
        topicName && tagPath ? `${topicName}.${tagPath}` : "",
        tagName,
        tagPath,
      ]
        .map((x) => normalizeTagValue(x))
        .filter(Boolean);
      const tagMappings =
        mappingKeys.map((k) => opcTagMappingMap.get(k)).find((rows) => Array.isArray(rows) && rows.length) ||
        [];
      const setMappings = mappingSetName
        ? (opcMappingSetMap.get(mappingSetName)?.mappings || [])
        : [];
      const normalizedSetMappings = (setMappings || []).map((m) => ({
        field: String(m?.field ?? ""),
        state: String(m?.state ?? ""),
        color: String(m?.color ?? ""),
      }));
      const mappings = tagMappings.length
        ? tagMappings
        : normalizedSetMappings.length
        ? normalizedSetMappings
        : resolveTemplateStateMappings(templateName);
      if (!mappings.length) return;
      const fieldName = String(tag?.name || "").trim();
      const valStr = String(value).trim();
      const valNum = Number(value);
      const valLower = valStr.toLowerCase();
      const valBool =
        valLower === "true" || valLower === "1"
          ? true
          : valLower === "false" || valLower === "0"
          ? false
          : null;
      const match = mappings.find((m) => {
        const stateStr = String(m?.state ?? "").trim();
        if (!stateStr) return false;
        const stateLower = stateStr.toLowerCase();
        const numeric = Number(stateStr);
        if (Number.isFinite(valNum) && Number.isFinite(numeric) && numeric === valNum) return true;
        const stateBool =
          stateLower === "true" || stateLower === "1"
            ? true
            : stateLower === "false" || stateLower === "0"
            ? false
            : null;
        if (valBool !== null && stateBool !== null && valBool === stateBool) return true;
        return stateLower === valLower;
      });
      if (match?.color) {
        const color = String(match.color);
        keyCandidates.forEach((k) => map.set(k, color));
      }
    });
    return map;
  }, [opcTags, opcLiveValues, opcTemplateMap, opcTagMappingMap, opcMappingSetMap]);

  const routeColorsBySvgKey = useMemo(() => {
    const map = new Map();
    const pickRouteColor = (row) => {
      if (!row || typeof row !== "object") return "";
      const direct =
        row?.routecolor ??
        row?.route_color ??
        row?.routeColor ??
        row?.color ??
        "";
      const directColor = normalizeTagValue(direct);
      if (directColor) return directColor;
      for (const [field, value] of Object.entries(row)) {
        const f = String(field || "").toLowerCase();
        if (!f.includes("color")) continue;
        const c = normalizeTagValue(value);
        if (c) return c;
      }
      return "";
    };

    const addKey = (raw, color) => {
      const key = normalizeTagValue(raw);
      if (!key || !color) return;
      map.set(key, color);
      map.set(key.toLowerCase(), color);
      const base = key.split("/").pop() || "";
      const baseTrim = normalizeTagValue(base);
      if (baseTrim) {
        map.set(baseTrim, color);
        map.set(baseTrim.toLowerCase(), color);
        const noExt = baseTrim.replace(/\.svg$/i, "");
        if (noExt && noExt !== baseTrim) {
          map.set(noExt, color);
          map.set(noExt.toLowerCase(), color);
        }
      }
    };

    const addRowKeys = (row, color) => {
      if (!row || typeof row !== "object") return;
      Object.entries(row).forEach(([field, value]) => {
        const fieldKey = String(field || "").toLowerCase();
        if (!fieldKey) return;
        if (fieldKey.includes("color")) return;
        if (fieldKey === "project_id" || fieldKey === "projectid") return;
        if (value == null) return;
        if (typeof value === "string" || typeof value === "number") {
          addKey(value, color);
        }
      });
    };

    (projectRouteRows || []).forEach((row) => {
      const color = pickRouteColor(row);
      if (!color) return;

      addKey(row?.tag_path, color);
      addKey(row?.tagPath, color);
      addKey(row?.svg_tag_path, color);
      addKey(row?.svgTagPath, color);
      addKey(row?.svg_path, color);
      addKey(row?.svgPath, color);
      addKey(row?.svg_name, color);
      addKey(row?.svgName, color);
      addKey(row?.route, color);
      addKey(row?.route_name, color);
      addKey(row?.routeName, color);
      addKey(row?.name, color);
      addKey(row?.path, color);
      addKey(row?.id, color);
      addRowKeys(row, color);
    });

    return map;
  }, [projectRouteRows]);

  const routeColorByRouteNumber = useMemo(() => {
    const map = new Map();
    const pickRouteColor = (row) => {
      if (!row || typeof row !== "object") return "";
      const direct =
        row?.routecolor ??
        row?.route_color ??
        row?.routeColor ??
        row?.color ??
        "";
      const directColor = normalizeTagValue(direct);
      if (directColor) return directColor;
      for (const [field, value] of Object.entries(row)) {
        if (!String(field || "").toLowerCase().includes("color")) continue;
        const c = normalizeTagValue(value);
        if (c) return c;
      }
      return "";
    };
    const pickRouteNumber = (row) => {
      if (!row || typeof row !== "object") return "";
      const direct =
        row?.["Route Number"] ??
        row?.route_number ??
        row?.routeNumber ??
        row?.routenumber ??
        "";
      const d = normalizeTagValue(direct);
      if (d) return d;
      for (const [field, value] of Object.entries(row)) {
        const f = String(field || "").toLowerCase();
        if (!f.includes("route")) continue;
        if (!f.includes("number") && f !== "route" && f !== "routeid") continue;
        const v = normalizeTagValue(value);
        if (v) return v;
      }
      return "";
    };

    (projectRouteRows || []).forEach((row) => {
      const routeNum = pickRouteNumber(row);
      const color = pickRouteColor(row);
      if (!routeNum || !color) return;
      map.set(routeNum, color);
      map.set(routeNum.toLowerCase(), color);
    });
    return map;
  }, [projectRouteRows]);

  const routeStrokeColorByGroupPath = useMemo(() => {
    const map = new Map();
    const live = opcLiveValues || {};

    const readLiveTagValue = (tag, topic) => {
      const group = normalizeTagValue(tag?.groupName || "");
      const cands = [
        topic && group && tag?.name ? `${topic}.${group}.${tag.name}` : "",
        topic && group && tag?.tagPath ? `${topic}.${group}.${tag.tagPath}` : "",
        topic && tag?.name ? `${topic}.${tag.name}` : "",
        topic && tag?.tagPath ? `${topic}.${tag.tagPath}` : "",
        group && tag?.name ? `${group}.${tag.name}` : "",
        group && tag?.tagPath ? `${group}.${tag.tagPath}` : "",
        tag?.name || "",
        tag?.tagPath || "",
      ]
        .map((x) => normalizeTagValue(x))
        .filter(Boolean);
      for (const k of cands) {
        if (Object.prototype.hasOwnProperty.call(live, k)) return live[k];
        const lower = k.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(live, lower)) return live[lower];
      }
      return null;
    };

    (opcTags || []).forEach((tag) => {
      const topic = normalizeTagValue(tag?.topic || "");
      const group = normalizeTagValue(tag?.groupName || "");
      if (!topic || !group) return;

      const tagKeyA = tag?.name || "";
      const tagKeyB = tag?.tagPath || "";
      if (!isRouteIdTagKey(tagKeyA) && !isRouteIdTagKey(tagKeyB)) return;

      const routeValueRaw = readLiveTagValue(tag, topic);
      const routeValue = normalizeTagValue(routeValueRaw);
      if (!routeValue) return;
      const color =
        routeColorByRouteNumber.get(routeValue) ||
        routeColorByRouteNumber.get(routeValue.toLowerCase()) ||
        "";
      if (!color) return;

      const groupPath = `${topic}.${group}`;
      map.set(groupPath, color);
      map.set(groupPath.toLowerCase(), color);
      map.set(group, color);
      map.set(group.toLowerCase(), color);
    });

    return map;
  }, [opcTags, opcLiveValues, routeColorByRouteNumber]);

  const svgLiveValuesByGroupPath = useMemo(() => {
    const map = new Map();
    const live = opcLiveValues || {};

    const readLiveTagValue = (tag, topic) => {
      const group = normalizeTagValue(tag?.groupName || "");
      const candidates = [
        topic && group && tag?.tagPath ? `${topic}.${group}.${tag.tagPath}` : "",
        topic && group && tag?.name ? `${topic}.${group}.${tag.name}` : "",
        topic && tag?.tagPath ? `${topic}.${tag.tagPath}` : "",
        topic && tag?.name ? `${topic}.${tag.name}` : "",
        group && tag?.tagPath ? `${group}.${tag.tagPath}` : "",
        group && tag?.name ? `${group}.${tag.name}` : "",
        tag?.tagPath || "",
        tag?.name || "",
      ]
        .map((x) => normalizeTagValue(x))
        .filter(Boolean);

      for (const key of candidates) {
        if (live[key] != null && live[key] !== "") return live[key];
        const lower = key.toLowerCase();
        if (live[lower] != null && live[lower] !== "") return live[lower];
      }
      return "";
    };

    const groups = new Map();
    (opcTags || []).forEach((tag) => {
      const topic = normalizeTagValue(tag?.topic || "Default") || "Default";
      const group = normalizeTagValue(tag?.groupName || "");
      if (!group) return;

      const groupPath = `${topic}.${group}`;
      const routeKeyA = tag?.name || "";
      const routeKeyB = tag?.tagPath || "";
      const value = normalizeTagValue(readLiveTagValue(tag, topic));
      if (!value) return;

      const entry = groups.get(groupPath) || { routeId: "", state: "" };
      if (!entry.routeId && (isRouteIdTagKey(routeKeyA) || isRouteIdTagKey(routeKeyB))) {
        entry.routeId = value;
      }
      if (!entry.state && (isStateTagKey(routeKeyA) || isStateTagKey(routeKeyB))) {
        entry.state = value;
      }
      groups.set(groupPath, entry);
    });

    groups.forEach((entry, groupPath) => {
      if (!entry?.routeId && !entry?.state) return;
      const group = normalizeTagValue(groupPath.split(".").slice(1).join("."));
      map.set(groupPath, entry);
      map.set(groupPath.toLowerCase(), entry);
      if (group) {
        map.set(group, entry);
        map.set(group.toLowerCase(), entry);
      }
    });

    return map;
  }, [opcTags, opcLiveValues]);

  const liveActiveAlarmsComputed = useMemo(() => {
    const live = opcLiveValues || {};
    const alarms = [];
    const buildTestAlarmValue = (operator, thresholdRaw) => {
      const thresholdNum = Number(thresholdRaw);
      if (Number.isFinite(thresholdNum)) {
        if (operator === ">") return thresholdNum + 1;
        if (operator === ">=") return thresholdNum;
        if (operator === "<") return thresholdNum - 1;
        if (operator === "<=") return thresholdNum;
        if (operator === "!=") return thresholdNum + 1;
        return thresholdNum;
      }
      const thresholdText = normalizeTagValue(thresholdRaw || "");
      if (operator === "!=") return thresholdText ? `${thresholdText}_test` : "1";
      return thresholdText || "1";
    };
    (opcTags || []).forEach((tag, idx) => {
      if (!isTruthyFlag(tag?.alarmEnabled)) return;
      const threshold = normalizeTagValue(tag?.alarmValue || "");
      if (!threshold) return;
      const topic = normalizeTagValue(tag?.topic || "");
      const group = normalizeTagValue(tag?.groupName || "");
      const tagPath = normalizeTagValue(tag?.tagPath || "");
      const name = normalizeTagValue(tag?.name || tagPath || `Tag ${idx + 1}`);
      const candidates = [
        topic && group && tagPath ? `${topic}.${group}.${tagPath}` : "",
        topic && group && name ? `${topic}.${group}.${name}` : "",
        topic && tagPath ? `${topic}.${tagPath}` : "",
        topic && name ? `${topic}.${name}` : "",
        group && tagPath ? `${group}.${tagPath}` : "",
        group && name ? `${group}.${name}` : "",
        tagPath,
        name,
      ]
        .map((x) => normalizeTagValue(x))
        .filter(Boolean);
      let liveValue = "";
      for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(live, key)) {
          liveValue = live[key];
          break;
        }
        const lower = key.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(live, lower)) {
          liveValue = live[lower];
          break;
        }
      }
      const operator = normalizeAlarmOperatorValue(tag?.alarmOperator);
      if ((liveValue == null || liveValue === "") && isTruthyFlag(tag?.alarmTest)) {
        liveValue = buildTestAlarmValue(operator, threshold);
      }
      if (!evaluateAlarmCondition(liveValue, operator, threshold)) return;
      alarms.push({
        id: `${topic}.${name}.${idx}`,
        label: name,
        topic,
        operator,
        threshold,
        value: liveValue == null || liveValue === "" ? "-" : String(liveValue),
      });
    });
    return alarms;
  }, [opcTags, opcLiveValues]);
  const liveTestAlarms = useMemo(
    () => [
      {
        id: "test.alarm.high_pressure",
        label: "TEST High Pressure",
        topic: "TEST",
        operator: ">",
        threshold: "120",
        value: "128",
        occurredAt: Date.now() - 60_000,
      },
      {
        id: "test.alarm.motor_fault",
        label: "TEST Motor Fault",
        topic: "TEST",
        operator: "==",
        threshold: "1",
        value: "1",
        occurredAt: Date.now() - 15_000,
      },
    ],
    []
  );
  const liveActiveAlarms = useMemo(() => {
    const source = liveActiveAlarmsDbLoaded ? liveActiveAlarmsDb : liveActiveAlarmsComputed;
    if (Array.isArray(source) && source.length) return source;
    return liveTestAlarms;
  }, [liveActiveAlarmsDbLoaded, liveActiveAlarmsDb, liveActiveAlarmsComputed, liveTestAlarms]);
  const findLiveTagPathMatch = (candidates) => {
    const live = opcLiveValues || {};
    const keys = Object.keys(live);
    for (const raw of candidates || []) {
      const cand = String(raw || "").trim();
      if (!cand) continue;
      if (Object.prototype.hasOwnProperty.call(live, cand)) return cand;
      const lower = cand.toLowerCase();
      const direct = keys.find((k) => String(k || "").toLowerCase() === lower);
      if (direct) return direct;
      const suffix = `.${lower}`;
      const suffixMatch = keys.find((k) => String(k || "").toLowerCase().endsWith(suffix));
      if (suffixMatch) return suffixMatch;
    }
    return "";
  };
  const findOpcConfiguredTagPathMatch = (overlay, candidates) => {
    const tagPath = normalizeTagValue(overlay?.tagPath || "");
    const rawParts = tagPath.split(".").map((x) => String(x || "").trim()).filter(Boolean);
    const groupHints = [];
    if (rawParts.length > 1) groupHints.push(rawParts.slice(0, -1).join("."));
    if (rawParts.length > 2) groupHints.push(rawParts.slice(1, -1).join("."));
    if (rawParts.length > 0) groupHints.push(rawParts[0]);
    const groupHintKeys = Array.from(new Set(groupHints.map((g) => String(g || "").toLowerCase()).filter(Boolean)));
    const desired = (candidates || [])
      .map((c) => normalizeTagValue(c))
      .filter(Boolean);
    const desiredLoose = desired.map((d) => String(d || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (!desired.length) return "";
    const tags = Array.isArray(opcTags) ? opcTags : [];
    for (const tag of tags) {
      const topic = normalizeTagValue(tag?.topic || "");
      const group = normalizeTagValue(tag?.groupName || "");
      if (groupHintKeys.length) {
        const gl = group.toLowerCase();
        const groupMatch = groupHintKeys.some(
          (g) => gl === g || gl.endsWith(`.${g}`) || g.endsWith(`.${gl}`)
        );
        if (!groupMatch) continue;
      }
      const members = [
        normalizeTagValue(tag?.tagPath || ""),
        normalizeTagValue(tag?.name || ""),
      ].filter(Boolean);
      for (const member of members) {
        const fulls = [
          topic && group ? `${topic}.${group}.${member}` : "",
          topic ? `${topic}.${member}` : "",
          group ? `${group}.${member}` : "",
          member,
        ]
          .map((x) => normalizeTagValue(x))
          .filter(Boolean);
        for (const f of fulls) {
          const fl = f.toLowerCase();
          if (desired.some((d) => fl === d.toLowerCase() || fl.endsWith(`.${d.toLowerCase()}`))) {
            return f;
          }
          const loose = fl.replace(/[^a-z0-9]/g, "");
          if (desiredLoose.some((d) => d && loose.endsWith(d))) {
            return f;
          }
        }
      }
    }
    return "";
  };
  const resolveMotorCommandTagPath = (overlay, aliases = [], options = {}) => {
    const strictOnly = options?.strict === true;
    const tagPath = String(overlay?.tagPath || "").trim();
    const parts = tagPath.split(".").filter(Boolean);
    const parents = [];
    if (parts.length > 1) parents.push(parts.slice(0, -1).join("."));
    if (parts.length > 2) parents.push(parts.slice(1, -1).join("."));
    if (parts.length > 0) parents.push(parts.join("."));
    const seen = new Set();
    const candidates = [];
    for (const p of parents) {
      for (const a of aliases) {
        const base = String(p || "").trim();
        const member = String(a || "").trim();
        const dotPath = `${base}.${member}`;
        const dotKey = dotPath.toLowerCase();
        if (!seen.has(dotKey)) {
          seen.add(dotKey);
          candidates.push(dotPath);
        }
        const slashPath = `${base}/${member}`;
        const slashKey = slashPath.toLowerCase();
        if (!seen.has(slashKey)) {
          seen.add(slashKey);
          candidates.push(slashPath);
        }
      }
    }
    if (tagPath && aliases.length) {
      const direct = `${tagPath}.${String(aliases[0] || "").trim()}`;
      const key = direct.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(direct);
      }
    }
    const inferOverlayTopic = () => {
      const overlayPath = normalizeTagValue(tagPath).toLowerCase();
      if (!overlayPath) return "";
      const counts = new Map();
      const tags = Array.isArray(opcTags) ? opcTags : [];
      for (const t of tags) {
        const topic = normalizeTagValue(t?.topic || "").trim();
        if (!topic) continue;
        const group = normalizeTagValue(t?.groupName || "").toLowerCase();
        const member = normalizeTagValue(t?.tagPath || t?.name || "").toLowerCase();
        const groupMatch =
          !!group &&
          (group === overlayPath ||
            group.endsWith(`.${overlayPath}`) ||
            overlayPath.endsWith(`.${group}`));
        const memberMatch =
          !!member &&
          (member === overlayPath ||
            member.startsWith(`${overlayPath}.`) ||
            member.endsWith(`.${overlayPath}`));
        if (!groupMatch && !memberMatch) continue;
        counts.set(topic, Number(counts.get(topic) || 0) + 1);
      }
      let bestTopic = "";
      let bestCount = 0;
      for (const [topic, count] of counts.entries()) {
        if (count > bestCount) {
          bestTopic = topic;
          bestCount = count;
        }
      }
      return bestTopic;
    };
    const inferredTopic = inferOverlayTopic();
    const scopedCandidates = inferredTopic
      ? candidates.map((c) => `${inferredTopic}.${String(c || "").trim()}`).filter(Boolean)
      : [];
    const strictMatch =
      findLiveTagPathMatch(scopedCandidates) ||
      findOpcConfiguredTagPathMatch(overlay, scopedCandidates) ||
      findLiveTagPathMatch(candidates) ||
      findOpcConfiguredTagPathMatch(overlay, candidates) ||
      "";
    if (strictMatch) return strictMatch;
    const anchorPaths = Array.isArray(options?.anchorPaths) ? options.anchorPaths : [];
    if (anchorPaths.length) {
      const siblingCandidates = [];
      const siblingSeen = new Set();
      for (const anchor of anchorPaths) {
        const raw = String(anchor || "").trim();
        if (!raw) continue;
        const dotIdx = raw.lastIndexOf(".");
        const slashIdx = raw.lastIndexOf("/");
        const cut = Math.max(dotIdx, slashIdx);
        if (cut <= 0) continue;
        const parent = raw.slice(0, cut).trim();
        if (!parent) continue;
        for (const a of aliases) {
          const alias = String(a || "").trim();
          if (!alias) continue;
          const dotPath = `${parent}.${alias}`;
          const slashPath = `${parent}/${alias}`;
          const dk = dotPath.toLowerCase();
          const sk = slashPath.toLowerCase();
          if (!siblingSeen.has(dk)) {
            siblingSeen.add(dk);
            siblingCandidates.push(dotPath);
          }
          if (!siblingSeen.has(sk)) {
            siblingSeen.add(sk);
            siblingCandidates.push(slashPath);
          }
        }
      }
      const anchoredMatch =
        findLiveTagPathMatch(siblingCandidates) ||
        findOpcConfiguredTagPathMatch(overlay, siblingCandidates) ||
        "";
      if (anchoredMatch) return anchoredMatch;
    }
    if (strictOnly) return "";

    // Scoped fallback: tolerate naming differences like HMI_Control vs HMIControl and
    // dot/slash separators, but keep matches inside this overlay's parent path.
    const normalizeLoose = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    const looseParents = Array.from(
      new Set(
        [tagPath, ...parents]
          .map((p) => normalizeLoose(p))
          .filter(Boolean)
      )
    );
    const looseAliases = Array.from(
      new Set((aliases || []).map((a) => normalizeLoose(a)).filter(Boolean))
    );
    if (!looseParents.length || !looseAliases.length) return "";
    const matchesAliasBoundary = (looseKey, looseAlias) =>
      !!(
        looseAlias &&
        (looseKey.endsWith(looseAlias) || looseKey.includes(`${looseAlias}`))
      );
    const parentScore = (looseKey) => {
      let best = -1;
      for (const p of looseParents) {
        if (!p) continue;
        if (looseKey.includes(p)) best = Math.max(best, p.length);
      }
      return best;
    };
    const aliasScore = (looseKey) => {
      let best = -1;
      for (const a of looseAliases) {
        if (!a) continue;
        if (matchesAliasBoundary(looseKey, a)) best = Math.max(best, a.length);
      }
      return best;
    };
    const chooseBest = (items, keyGetter) => {
      let bestItem = "";
      let bestParent = -1;
      let bestAlias = -1;
      for (const item of items) {
        const rawKey = String(keyGetter(item) || "").trim();
        if (!rawKey) continue;
        if (
          inferredTopic &&
          typeof rawKey === "string" &&
          !rawKey.toLowerCase().startsWith(`${inferredTopic.toLowerCase()}.`)
        ) {
          continue;
        }
        const key = normalizeLoose(rawKey);
        if (!key) continue;
        const pScore = parentScore(key);
        if (pScore < 0) continue;
        const aScore = aliasScore(key);
        if (aScore < 0) continue;
        if (
          pScore > bestParent ||
          (pScore === bestParent && aScore > bestAlias)
        ) {
          bestParent = pScore;
          bestAlias = aScore;
          bestItem = String(item || "").trim();
        }
      }
      return bestItem;
    };

    const liveKeys = Object.keys(opcLiveValues || {});
    const bestLive = chooseBest(liveKeys, (k) => k);
    if (bestLive) return bestLive;

    const tags = Array.isArray(opcTags) ? opcTags : [];
    const configuredFulls = [];
    for (const t of tags) {
      const topic = normalizeTagValue(t?.topic || "");
      if (inferredTopic && topic && topic.toLowerCase() !== inferredTopic.toLowerCase()) continue;
      const group = normalizeTagValue(t?.groupName || "");
      const member = normalizeTagValue(t?.tagPath || t?.name || "");
      const fullCandidates = [
        topic && group && member ? `${topic}.${group}.${member}` : "",
        topic && member ? `${topic}.${member}` : "",
        group && member ? `${group}.${member}` : "",
        member,
      ]
        .map((x) => normalizeTagValue(x))
        .filter(Boolean);
      configuredFulls.push(...fullCandidates);
    }
    const bestConfigured = chooseBest(configuredFulls, (k) => k);
    if (bestConfigured) return bestConfigured;
    return "";
  };
  const writeLiveEquipmentTag = async (overlay, commandTagPath, value, options = {}) => {
    const overlayId = String(overlay?.id || "").trim();
    const actionLabel = String(options?.actionLabel || "Command").trim();
    const writeStateKey = String(
      options?.writeStateKey || `${overlayId}::${normalizeRouteTagKey(actionLabel || "command")}`
    ).trim();
    const tagPath = String(commandTagPath || "").trim();
    if (!overlayId) return;
    if (!tagPath) {
      const fallbackPath = String(overlay?.tagPath || "").trim() || "selected equipment";
      const message = `${actionLabel} tag not found for ${fallbackPath}.`;
      setLiveEquipmentWriteErrorByOverlay((prev) => ({ ...(prev || {}), [writeStateKey || overlayId]: message }));
      toastError(message);
      return;
    }
    const normalizedPath = normalizeTagValue(tagPath);
    const normalizeUaTypeForWrite = (tag) => {
      const uaTypeRaw = String(tag?.uaType || "").trim().toLowerCase();
      if (uaTypeRaw) return uaTypeRaw;
      const plcType = String(tag?.plcType || "").trim().toUpperCase();
      if (plcType === "BOOL") return "boolean";
      if (["SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT"].includes(plcType)) return "int32";
      if (["REAL", "LREAL"].includes(plcType)) return "double";
      if (plcType === "STRING") return "string";
      return "";
    };
    const matchOpcTagForPath = (path) => {
      const target = normalizeTagValue(path).toLowerCase();
      if (!target) return null;
      const tags = Array.isArray(opcTags) ? opcTags : [];
      for (const t of tags) {
        const topic = normalizeTagValue(t?.topic || "");
        const group = normalizeTagValue(t?.groupName || "");
        const name = normalizeTagValue(t?.name || "");
        const memberPath = normalizeTagValue(t?.tagPath || name);
        const candidates = [
          topic && group && memberPath ? `${topic}.${group}.${memberPath}` : "",
          topic && memberPath ? `${topic}.${memberPath}` : "",
          group && memberPath ? `${group}.${memberPath}` : "",
          memberPath,
          name,
        ]
          .map((x) => normalizeTagValue(x))
          .filter(Boolean);
        const matched = candidates.some((c) => {
          const cl = c.toLowerCase();
          return cl === target || cl.endsWith(`.${target}`) || target.endsWith(`.${cl}`);
        });
        if (matched) return t;
      }
      return null;
    };
    const matchedTag = matchOpcTagForPath(normalizedPath);
    const configuredTopic = normalizeTagValue(matchedTag?.topic || "");
    const configuredMemberPath = normalizeTagValue(matchedTag?.tagPath || matchedTag?.name || "");
    const configuredName = normalizeTagValue(matchedTag?.name || "");
    const canonicalTagKey = configuredTopic && configuredMemberPath
      ? `${configuredTopic}.${configuredMemberPath}`
      : configuredMemberPath || "";
    const canonicalLegacyTagKey = configuredTopic && configuredName
      ? `${configuredTopic}.${configuredName}`
      : configuredName || "";
    const tagKey = normalizeTagValue(canonicalTagKey || normalizedPath);
    const legacyTagKey = normalizeTagValue(canonicalLegacyTagKey || configuredName);
    const uaType = normalizeUaTypeForWrite(matchedTag);
    const isPulse = options?.pulse === true;
    const pulseResetValue = Object.prototype.hasOwnProperty.call(options || {}, "pulseResetValue")
      ? options.pulseResetValue
      : 0;
    const applyOptimisticOpcValue = (nextValue) => {
      const keys = [tagKey, legacyTagKey]
        .map((entry) => String(entry || "").trim())
        .filter(Boolean);
      if (!keys.length) return;
      setOpcLiveValues((prev) => {
        const out = { ...(prev || {}) };
        keys.forEach((entry) => {
          out[entry] = nextValue;
          out[entry.toLowerCase()] = nextValue;
        });
        return out;
      });
      setOpcLiveUpdatedAt(Date.now());
    };
    try {
      setLiveEquipmentWriteBusyByOverlay((prev) => ({ ...(prev || {}), [writeStateKey || overlayId]: true }));
      setLiveEquipmentWriteErrorByOverlay((prev) => ({ ...(prev || {}), [writeStateKey || overlayId]: "" }));
      await writeOpcValue({ tagKey, legacyTagKey, value, uaType });
      applyOptimisticOpcValue(value);
      if (isPulse) {
        window.setTimeout(async () => {
          try {
            await writeOpcValue({ tagKey, legacyTagKey, value: pulseResetValue, uaType });
            applyOptimisticOpcValue(pulseResetValue);
          } catch {
            // ignore pulse reset errors
          }
        }, 180);
      }
      toastSuccess(`Wrote ${String(value)} to ${tagKey}`);
    } catch (err) {
      setLiveEquipmentWriteErrorByOverlay((prev) => ({
        ...(prev || {}),
        [writeStateKey || overlayId]: err?.message || "Write failed.",
      }));
      toastError(err?.message || "Write failed.");
    } finally {
      setLiveEquipmentWriteBusyByOverlay((prev) => ({
        ...(prev || {}),
        [writeStateKey || overlayId]: false,
      }));
    }
  };
  const renderLiveMotorControls = (overlay, compact = false) => {
    const overlayId = String(overlay?.id || "").trim();
    if (!overlayId) return null;
    const eType = String(resolveOverlayEType(overlay) || "").trim();
    if (!isMotorEType(eType)) return null;
    const writeStateKeyFor = (action) =>
      `${overlayId}::${normalizeRouteTagKey(String(action || "command"))}`;
    const isActionBusy = (action) => liveEquipmentWriteBusyByOverlay?.[writeStateKeyFor(action)] === true;
    const startBusy = isActionBusy("Start");
    const stopBusy = isActionBusy("Stop");
    const resetBusy = isActionBusy("Fault Reset");
    const autoBusy = isActionBusy("Automatic");
    const manualBusy = isActionBusy("Manual");
    const maintenanceBusy = isActionBusy("Maintenance");
    const writeError = [
      "Start",
      "Stop",
      "Fault Reset",
      "Automatic",
      "Manual",
      "Maintenance",
    ]
      .map((action) => String(liveEquipmentWriteErrorByOverlay?.[writeStateKeyFor(action)] || "").trim())
      .find(Boolean) || "";
    const normalizeCommandPathKey = (path) =>
      String(path || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    const isHmiControlPath = (path) => normalizeCommandPathKey(path).endsWith("hmicontrol");
    const modeStatusPath = resolveMotorCommandTagPath(overlay, ["Mode_Status", "ModeStatus", "Control_Status", "ControlStatus", "i_ModeStatus", "o_ModeStatus", "StsMode", "HMI_ModeStatus"], { strict: true });
    const hmiStatePath = resolveMotorCommandTagPath(overlay, ["HMI_State", "HMIState", "i_HMIState", "o_HMIState", "State"], { strict: true });
    const manualStatePath = resolveMotorCommandTagPath(overlay, ["i_ManualMode", "o_ManualMode", "ManualMode", "StsManual", "ManualActive"], { strict: true });
    const autoStatePath = resolveMotorCommandTagPath(overlay, ["i_AutoMode", "o_AutoMode", "AutoMode", "StsAuto", "AutoActive"], { strict: true });
    const maintenanceStatePath = resolveMotorCommandTagPath(overlay, ["i_MaintenanceMode", "o_MaintenanceMode", "MaintenanceMode", "MaintMode", "StsMaint", "MaintActive"], { strict: true });
    const commandAnchorPaths = [modeStatusPath, hmiStatePath, manualStatePath, autoStatePath, maintenanceStatePath].filter(Boolean);
    const rawHmiControlPath = resolveMotorCommandTagPath(
      overlay,
      ["HMI_Control", "hmi_control", "HMIControl", "hmiControl", "hmicontrol"],
      { strict: true, anchorPaths: commandAnchorPaths }
    );
    const hmiControlPath = String(rawHmiControlPath || "").trim();
    const usesHmiControl = isHmiControlPath(hmiControlPath);
    const startPath = hmiControlPath;
    const stopPath = hmiControlPath;
    const resetPath = hmiControlPath;
    const manualPath = hmiControlPath;
    const autoPath = hmiControlPath;
    const maintenancePath = hmiControlPath;
    const startWriteValue = usesHmiControl ? 16 : 1;
    const stopWriteValue = usesHmiControl ? 32 : 1;
    const manualWriteValue = usesHmiControl ? 4 : 1;
    const autoWriteValue = usesHmiControl ? 2 : 1;
    const maintenanceWriteValue = usesHmiControl ? 8 : 1;
    const resetWriteValue = 1;
    const commandWriteOptions = usesHmiControl ? { pulse: true, pulseResetValue: 0 } : {};
    const triggerMotorCommand = (actionLabel, path, value, options = {}) =>
      writeLiveEquipmentTag(overlay, path, value, {
        ...(options || {}),
        actionLabel,
        writeStateKey: writeStateKeyFor(actionLabel),
      });
    const readLiveRaw = (path) => {
      const resolved = findLiveTagPathMatch([path]);
      if (!resolved) return null;
      return opcLiveValues?.[resolved];
    };
    const readLiveBool = (path) => {
      const raw = readLiveRaw(path);
      if (raw == null || raw === "") return null;
      if (typeof raw === "boolean") return raw;
      if (Number.isFinite(Number(raw))) return Number(raw) !== 0;
      const text = String(raw || "").trim().toLowerCase();
      if (!text) return null;
      if (["true", "on", "yes"].includes(text)) return true;
      if (["false", "off", "no"].includes(text)) return false;
      return null;
    };
    const modeStatusRaw = readLiveRaw(modeStatusPath);
    const hmiStateRaw = readLiveRaw(hmiStatePath);
    const hmiStateLabel = (() => {
      if (hmiStateRaw == null || hmiStateRaw === "") return "";
      const text = String(hmiStateRaw || "").trim();
      const lower = text.toLowerCase();
      if (lower.includes("starting")) return "Starting";
      if (lower.includes("started")) return "Started";
      if (lower.includes("stopping")) return "Stopping";
      if (lower.includes("stop")) return "Stopped";
      const num = Number(text);
      if (Number.isFinite(num)) {
        if (num === 1) return "Stopped";
        if (num === 2) return "Starting";
        if (num === 4) return "Started";
        if (num === 6) return "Stopping";
      }
      return text;
    })();
    const parsedModeFromStatus = (() => {
      if (modeStatusRaw == null || modeStatusRaw === "") return "";
      const text = String(modeStatusRaw || "").trim();
      const lower = text.toLowerCase();
      if (lower.includes("manual")) return "manual";
      if (lower.includes("auto")) return "auto";
      if (lower.includes("maint")) return "maintenance";
      const num = Number(text);
      if (Number.isFinite(num)) {
        if (num === 2) return "auto";
        if (num === 4) return "manual";
        if (num === 8) return "maintenance";
      }
      return "";
    })();
    const modeStatusLabel = (() => {
      if (modeStatusRaw == null || modeStatusRaw === "") return "";
      if (parsedModeFromStatus === "manual") return "Manual";
      if (parsedModeFromStatus === "auto") return "Auto";
      if (parsedModeFromStatus === "maintenance") return "Maintenance";
      const text = String(modeStatusRaw || "").trim();
      const lower = text.toLowerCase();
      if (lower.includes("local")) return "Local";
      if (lower.includes("remote")) return "Remote";
      return text;
    })();
    const manualActive = readLiveBool(manualStatePath);
    const autoActive = readLiveBool(autoStatePath);
    const maintenanceActive = readLiveBool(maintenanceStatePath);
    const modeHint = String(liveEquipmentModeToggleHintRef.current?.[overlayId] || "").trim().toLowerCase();
    const activeMode =
      maintenanceActive === true
        ? "maintenance"
        : manualActive === true
        ? "manual"
        : autoActive === true
          ? "auto"
          : parsedModeFromStatus === "manual" || parsedModeFromStatus === "auto" || parsedModeFromStatus === "maintenance"
            ? parsedModeFromStatus
          : modeHint === "manual" || modeHint === "auto" || modeHint === "maintenance"
            ? modeHint
            : "";
    const reverseDisableOnHmiControl = usesHmiControl;
    const modeBlocksStartStop = reverseDisableOnHmiControl
      ? activeMode === "auto" || activeMode === "maintenance"
      : activeMode === "manual" || activeMode === "maintenance";
    const hmiStateCode = (() => {
      const text = String(hmiStateRaw ?? "").trim();
      if (!text) return NaN;
      const num = Number(text);
      if (Number.isFinite(num)) return num;
      const lower = text.toLowerCase();
      if (lower.includes("starting")) return 2;
      if (lower.includes("started")) return 4;
      if (lower.includes("stopping")) return 6;
      if (lower.includes("stop")) return 1;
      return NaN;
    })();
    const startBlockedByState = hmiStateCode === 2 || hmiStateCode === 4;
    const stopBlockedByState = hmiStateCode === 1 || hmiStateCode === 6;
    const startDisabled = startBusy || modeBlocksStartStop || startBlockedByState || !startPath;
    const stopDisabled = stopBusy || modeBlocksStartStop || stopBlockedByState || !stopPath;
    const modeDisabledTitle = modeBlocksStartStop
      ? reverseDisableOnHmiControl
        ? "disabled while in Auto mode"
        : "disabled while in Manual mode"
      : "";
    const startDisabledTitle = modeDisabledTitle
      ? modeDisabledTitle
      : startBlockedByState
      ? "disabled when motor is Started/Starting"
      : !startPath
      ? "requires HMI_Control tag"
      : "";
    const stopDisabledTitle = modeDisabledTitle
      ? modeDisabledTitle
      : stopBlockedByState
      ? "disabled when motor is Stopped/Stopping"
      : !stopPath
      ? "requires HMI_Control tag"
      : "";
    const iconCommon = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: 1,
    };
    const manualIcon = (
      <span style={iconCommon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={compact ? 13 : 15} height={compact ? 13 : 15} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.5 12.8V6.6a1.2 1.2 0 0 1 2.4 0v4.5" />
          <path d="M9.9 11.7V5.8a1.2 1.2 0 0 1 2.4 0v5.3" />
          <path d="M12.3 11.4V6.5a1.2 1.2 0 0 1 2.4 0v5.1" />
          <path d="M14.7 12V8.2a1.2 1.2 0 0 1 2.4 0v6.1c0 3-2.2 5.1-5.2 5.1h-1.8c-3.2 0-5.6-2.3-5.6-5.4v-2.2a1.2 1.2 0 0 1 2.4 0v1" />
        </svg>
      </span>
    );
    const autoIcon = (
      <span style={iconCommon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={compact ? 13 : 15} height={compact ? 13 : 15} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12a8 8 0 0 1-14 5.3" />
          <path d="M4 12a8 8 0 0 1 14-5.3" />
          <path d="M6 18H3.5v-2.5" />
          <path d="M18 6h2.5v2.5" />
        </svg>
      </span>
    );
    const onSetManualMode = () => {
      liveEquipmentModeToggleHintRef.current = {
        ...(liveEquipmentModeToggleHintRef.current || {}),
        [overlayId]: "manual",
      };
      return void triggerMotorCommand("Manual", manualPath, manualWriteValue, commandWriteOptions);
    };
    const onSetAutoMode = () => {
      liveEquipmentModeToggleHintRef.current = {
        ...(liveEquipmentModeToggleHintRef.current || {}),
        [overlayId]: "auto",
      };
      return void triggerMotorCommand("Automatic", autoPath, autoWriteValue, commandWriteOptions);
    };
    const maintenanceIcon = (
      <span style={iconCommon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={compact ? 13 : 15} height={compact ? 13 : 15} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 3.5 14.2 10.3" />
          <path d="M10.2 14.3 3.5 21l-1.5-1.5 6.8-6.8" />
          <path d="M14.8 7.2a4.1 4.1 0 0 1-5.6 5.6l-2.6 2.6a1.8 1.8 0 0 0 2.5 2.5l2.6-2.6a4.1 4.1 0 0 1 5.6-5.6l3.2-3.2-2.5-2.5-3.2 3.2Z" />
        </svg>
      </span>
    );
    const onSetMaintenanceMode = () => {
      liveEquipmentModeToggleHintRef.current = {
        ...(liveEquipmentModeToggleHintRef.current || {}),
        [overlayId]: "maintenance",
      };
      return void triggerMotorCommand("Maintenance", maintenancePath, maintenanceWriteValue, commandWriteOptions);
    };
    const buttonStyle = {
      border: "1px solid color-mix(in srgb, var(--border) 86%, #2b6cff 14%)",
      background: "color-mix(in srgb, var(--bg) 92%, #1d4ed8 8%)",
      color: "var(--text)",
      borderRadius: 6,
      fontSize: compact ? 9 : 10,
      fontWeight: 700,
      height: compact ? 26 : 30,
      padding: compact ? "0 6px" : "0 8px",
      cursor: "pointer",
      opacity: 1,
      transition: "transform 90ms ease, filter 120ms ease, border-color 120ms ease",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      width: "100%",
      minWidth: 0,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      lineHeight: 1.1,
    };
    const disabledButtonStyle = {
      border: "1px solid color-mix(in srgb, var(--border) 94%, #94a3b8 6%)",
      background: "color-mix(in srgb, var(--bg) 98%, #64748b 2%)",
      color: "color-mix(in srgb, var(--text-muted) 88%, var(--text) 12%)",
      cursor: "not-allowed",
      opacity: 0.62,
      filter: "saturate(0.45)",
      boxShadow: "none",
      transform: "none",
    };
    const withDisabledStyle = (isDisabled) => (isDisabled ? { ...buttonStyle, ...disabledButtonStyle } : buttonStyle);
    const autoDisabled = autoBusy || activeMode === "auto" || !autoPath;
    const manualDisabled = manualBusy || activeMode === "manual" || !manualPath;
    const maintenanceDisabled = maintenanceBusy || activeMode === "maintenance" || !maintenancePath;
    const resetDisabled = resetBusy || !resetPath;
    return (
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, display: "grid", gap: 5 }}>
        <div style={{ fontSize: compact ? 10 : 11, fontWeight: 700, color: "var(--text)" }}>Motor Controls</div>
        <div style={{ fontSize: compact ? 9 : 10, color: "var(--text-muted)" }}>
          Status: {modeStatusLabel || (activeMode === "manual" ? "Manual" : activeMode === "auto" ? "Auto" : activeMode === "maintenance" ? "Maintenance" : "Unknown")}
        </div>
        <div style={{ fontSize: compact ? 9 : 10, color: "var(--text-muted)" }}>
          HMI State: {hmiStateLabel || "-"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4 }}>
          <button
            type="button"
            style={withDisabledStyle(startDisabled)}
            disabled={startDisabled}
            onClick={() =>
              void triggerMotorCommand("Start", startPath, startWriteValue, commandWriteOptions)
            }
            aria-label="Start"
            title={startDisabledTitle ? `Start ${startDisabledTitle}` : startPath || "Start tag not found"}
          >
            <span style={iconCommon} aria-hidden="true">
              <svg viewBox="0 0 24 24" width={compact ? 9 : 11} height={compact ? 9 : 11} fill="currentColor">
                <path d="M8 6v12l10-6-10-6Z" />
              </svg>
            </span>
            <span>Start</span>
          </button>
          <button
            type="button"
            style={withDisabledStyle(stopDisabled)}
            disabled={stopDisabled}
            onClick={() =>
              void triggerMotorCommand("Stop", stopPath, stopWriteValue, commandWriteOptions)
            }
            aria-label="Stop"
            title={stopDisabledTitle ? `Stop ${stopDisabledTitle}` : stopPath || "Stop tag not found"}
          >
            <span style={iconCommon} aria-hidden="true">
              <svg viewBox="0 0 24 24" width={compact ? 9 : 11} height={compact ? 9 : 11} fill="currentColor">
                <path d="M7 7h10v10H7z" />
              </svg>
            </span>
            <span>Stop</span>
          </button>
          <button
            type="button"
            style={
              resetDisabled
                ? withDisabledStyle(true)
                : {
                    ...buttonStyle,
                    border: "1px solid color-mix(in srgb, #f59e0b 78%, var(--border) 22%)",
                    background: "linear-gradient(180deg, #f59e0b 0%, #ea580c 100%)",
                    color: "#fff7ed",
                    textShadow: "0 1px 1px rgba(0,0,0,0.22)",
                  }
            }
            disabled={resetDisabled}
            onClick={() =>
              void triggerMotorCommand("Fault Reset", resetPath, resetWriteValue, commandWriteOptions)
            }
            aria-label="Fault Reset"
            title={resetPath || "HMI_Control tag not found"}
          >
            <span style={iconCommon} aria-hidden="true">
              <svg viewBox="0 0 24 24" width={compact ? 10 : 12} height={compact ? 10 : 12} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3.5 21 19H3L12 3.5Z" />
                <path d="M12 9v5.2" />
                <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span>Fault Reset</span>
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4 }}>
          <button
            type="button"
            style={withDisabledStyle(autoDisabled)}
            disabled={autoDisabled}
            onClick={onSetAutoMode}
            aria-label="Set Auto"
            title={
              !autoPath
                ? "HMI_Control tag not found"
                : activeMode === "auto"
                  ? "Already in Auto mode"
                  : autoPath
            }
          >
            {autoIcon}
            <span>Auto</span>
          </button>
          <button
            type="button"
            style={withDisabledStyle(manualDisabled)}
            disabled={manualDisabled}
            onClick={onSetManualMode}
            aria-label="Set Manual"
            title={
              !manualPath
                ? "HMI_Control tag not found"
                : activeMode === "manual"
                  ? "Already in Manual mode"
                  : manualPath
            }
          >
            {manualIcon}
            <span>Manual</span>
          </button>
          <button
            type="button"
            style={withDisabledStyle(maintenanceDisabled)}
            disabled={maintenanceDisabled}
            onClick={onSetMaintenanceMode}
            aria-label="Set Maintenance"
            title={
              !maintenancePath
                ? "HMI_Control tag not found"
                : activeMode === "maintenance"
                  ? "Already in Maintenance mode"
                  : maintenancePath
            }
          >
            {maintenanceIcon}
            <span>Maint</span>
          </button>
        </div>
        {writeError ? (
          <div style={{ fontSize: compact ? 9 : 10, color: "var(--danger)" }}>{writeError}</div>
        ) : null}
      </div>
    );
  };
  const renderLiveDiverterControls = (overlay, compact = false) => {
    const overlayId = String(overlay?.id || "").trim();
    if (!overlayId) return null;
    const eType = String(resolveOverlayEType(overlay) || "").trim().toLowerCase();
    if (!eType.includes("diverter")) return null;
    const writeStateKeyFor = (action) =>
      `${overlayId}::${normalizeRouteTagKey(String(action || "command"))}`;
    const isActionBusy = (action) => liveEquipmentWriteBusyByOverlay?.[writeStateKeyFor(action)] === true;
    const resetBusy = isActionBusy("Fault Reset");
    const autoBusy = isActionBusy("Automatic");
    const manualBusy = isActionBusy("Manual");
    const maintenanceBusy = isActionBusy("Maintenance");
    const straightBusy = isActionBusy("Straight");
    const divertBusy = isActionBusy("Divert");
    const writeError = [
      "Fault Reset",
      "Automatic",
      "Manual",
      "Maintenance",
      "Straight",
      "Divert",
    ]
      .map((action) => String(liveEquipmentWriteErrorByOverlay?.[writeStateKeyFor(action)] || "").trim())
      .find(Boolean) || "";
    const normalizeCommandPathKey = (path) =>
      String(path || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    const isHmiControlPath = (path) => normalizeCommandPathKey(path).endsWith("hmicontrol");
    const modeStatusPath = resolveMotorCommandTagPath(
      overlay,
      ["Mode_Status", "ModeStatus", "Control_Status", "ControlStatus", "i_ModeStatus", "o_ModeStatus", "StsMode", "HMI_ModeStatus"],
      { strict: true }
    );
    const hmiStatePath = resolveMotorCommandTagPath(
      overlay,
      ["HMI_State", "HMIState", "i_HMIState", "o_HMIState", "State"],
      { strict: true }
    );
    const manualStatePath = resolveMotorCommandTagPath(
      overlay,
      ["i_ManualMode", "o_ManualMode", "ManualMode", "StsManual", "ManualActive"],
      { strict: true }
    );
    const autoStatePath = resolveMotorCommandTagPath(
      overlay,
      ["i_AutoMode", "o_AutoMode", "AutoMode", "StsAuto", "AutoActive"],
      { strict: true }
    );
    const maintenanceStatePath = resolveMotorCommandTagPath(
      overlay,
      ["i_MaintenanceMode", "o_MaintenanceMode", "MaintenanceMode", "MaintMode", "StsMaint", "MaintActive"],
      { strict: true }
    );
    const anchorPaths = [modeStatusPath, hmiStatePath, manualStatePath, autoStatePath, maintenanceStatePath].filter(Boolean);
    const rawHmiControlPath = resolveMotorCommandTagPath(
      overlay,
      ["HMI_Control", "hmi_control", "HMIControl", "hmiControl", "hmicontrol"],
      { strict: true, anchorPaths }
    );
    const hmiControlPath = String(rawHmiControlPath || "").trim();
    const usesHmiControl = isHmiControlPath(hmiControlPath);
    const resetPath =
      resolveMotorCommandTagPath(
        overlay,
        ["i_FaultReset", "FaultReset", "CmdFaultReset", "i_CmdFaultReset", "HMI_EquipmentReset"],
        { strict: true, anchorPaths: [...anchorPaths, hmiControlPath].filter(Boolean) }
      ) || hmiControlPath;
    const autoPath = hmiControlPath;
    const manualPath = hmiControlPath;
    const maintenancePath = hmiControlPath;
    const straightPath = hmiControlPath;
    const divertPath = hmiControlPath;
    const autoWriteValue = usesHmiControl ? 2 : 1;
    const manualWriteValue = usesHmiControl ? 4 : 1;
    const maintenanceWriteValue = usesHmiControl ? 8 : 1;
    const straightWriteValue = usesHmiControl ? 16 : 1;
    const divertWriteValue = usesHmiControl ? 32 : 1;
    const resetWriteValue =
      usesHmiControl && normalizeCommandPathKey(resetPath) === normalizeCommandPathKey(hmiControlPath)
        ? 2048
        : 1;
    const commandWriteOptions = { pulse: true, pulseResetValue: 0 };
    const triggerDiverterCommand = (actionLabel, path, value, options = {}) =>
      writeLiveEquipmentTag(overlay, path, value, {
        ...(options || {}),
        actionLabel,
        writeStateKey: writeStateKeyFor(actionLabel),
      });
    const readLiveRaw = (path) => {
      const resolved = findLiveTagPathMatch([path]);
      if (!resolved) return null;
      return opcLiveValues?.[resolved];
    };
    const readLiveBool = (path) => {
      const raw = readLiveRaw(path);
      if (raw == null || raw === "") return null;
      if (typeof raw === "boolean") return raw;
      if (Number.isFinite(Number(raw))) return Number(raw) !== 0;
      const text = String(raw || "").trim().toLowerCase();
      if (!text) return null;
      if (["true", "on", "yes"].includes(text)) return true;
      if (["false", "off", "no"].includes(text)) return false;
      return null;
    };
    const modeStatusRaw = readLiveRaw(modeStatusPath);
    const hmiStateRaw = readLiveRaw(hmiStatePath);
    const parsedModeFromStatus = (() => {
      if (modeStatusRaw == null || modeStatusRaw === "") return "";
      const text = String(modeStatusRaw || "").trim();
      const lower = text.toLowerCase();
      if (lower.includes("manual")) return "manual";
      if (lower.includes("auto")) return "auto";
      if (lower.includes("maint")) return "maintenance";
      const num = Number(text);
      if (Number.isFinite(num)) {
        if (num === 2) return "auto";
        if (num === 4) return "manual";
        if (num === 8) return "maintenance";
      }
      return "";
    })();
    const modeStatusLabel = (() => {
      if (parsedModeFromStatus === "manual") return "Manual";
      if (parsedModeFromStatus === "auto") return "Auto";
      if (parsedModeFromStatus === "maintenance") return "Maintenance";
      return String(modeStatusRaw || "").trim() || "";
    })();
    const manualActive = readLiveBool(manualStatePath);
    const autoActive = readLiveBool(autoStatePath);
    const maintenanceActive = readLiveBool(maintenanceStatePath);
    const activeMode =
      maintenanceActive === true
        ? "maintenance"
        : manualActive === true
          ? "manual"
          : autoActive === true
            ? "auto"
            : parsedModeFromStatus === "manual" ||
                parsedModeFromStatus === "auto" ||
                parsedModeFromStatus === "maintenance"
              ? parsedModeFromStatus
              : "";
    const hmiStateCode = (() => {
      const text = String(hmiStateRaw ?? "").trim();
      if (!text) return NaN;
      const num = Number(text);
      if (Number.isFinite(num)) return num;
      return NaN;
    })();
    const positionLabel =
      hmiStateCode === 1
        ? "Straight"
        : hmiStateCode === 2
          ? "Divert"
          : hmiStateCode === 4
            ? "No Position"
            : hmiStateCode === 8
              ? "Moving Straight"
              : hmiStateCode === 16
                ? "Moving Divert"
                : hmiStateCode === 32
                  ? "Fault"
                  : String(hmiStateRaw || "").trim() || "-";
    const autoDisabled = autoBusy || activeMode === "auto" || !autoPath;
    const manualDisabled = manualBusy || activeMode === "manual" || !manualPath;
    const maintenanceDisabled = maintenanceBusy || activeMode === "maintenance" || !maintenancePath;
    const modeBlocksPositionCommands = activeMode === "auto";
    const straightDisabled = straightBusy || modeBlocksPositionCommands || !straightPath;
    const divertDisabled = divertBusy || modeBlocksPositionCommands || !divertPath;
    const resetDisabled = resetBusy || !resetPath;
    const iconCommon = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: 1,
    };
    const autoIcon = (
      <span style={iconCommon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={compact ? 13 : 15} height={compact ? 13 : 15} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12a8 8 0 0 1-14 5.3" />
          <path d="M4 12a8 8 0 0 1 14-5.3" />
          <path d="M6 18H3.5v-2.5" />
          <path d="M18 6h2.5v2.5" />
        </svg>
      </span>
    );
    const manualIcon = (
      <span style={iconCommon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={compact ? 13 : 15} height={compact ? 13 : 15} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.5 12.8V6.6a1.2 1.2 0 0 1 2.4 0v4.5" />
          <path d="M9.9 11.7V5.8a1.2 1.2 0 0 1 2.4 0v5.3" />
          <path d="M12.3 11.4V6.5a1.2 1.2 0 0 1 2.4 0v5.1" />
          <path d="M14.7 12V8.2a1.2 1.2 0 0 1 2.4 0v6.1c0 3-2.2 5.1-5.2 5.1h-1.8c-3.2 0-5.6-2.3-5.6-5.4v-2.2a1.2 1.2 0 0 1 2.4 0v1" />
        </svg>
      </span>
    );
    const maintenanceIcon = (
      <span style={iconCommon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={compact ? 13 : 15} height={compact ? 13 : 15} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 3.5 14.2 10.3" />
          <path d="M10.2 14.3 3.5 21l-1.5-1.5 6.8-6.8" />
          <path d="M14.8 7.2a4.1 4.1 0 0 1-5.6 5.6l-2.6 2.6a1.8 1.8 0 0 0 2.5 2.5l2.6-2.6a4.1 4.1 0 0 1 5.6-5.6l3.2-3.2-2.5-2.5-3.2 3.2Z" />
        </svg>
      </span>
    );
    const straightIcon = (
      <span style={iconCommon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={compact ? 11 : 13} height={compact ? 11 : 13} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h13" />
          <path d="m13 8 4 4-4 4" />
        </svg>
      </span>
    );
    const divertIcon = (
      <span style={iconCommon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={compact ? 11 : 13} height={compact ? 11 : 13} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h6" />
          <path d="M10 12 18 18" />
          <path d="m15 18 3 0 0-3" />
        </svg>
      </span>
    );
    const buttonStyle = {
      border: "1px solid color-mix(in srgb, var(--border) 86%, #2b6cff 14%)",
      background: "color-mix(in srgb, var(--bg) 92%, #1d4ed8 8%)",
      color: "var(--text)",
      borderRadius: 6,
      fontSize: compact ? 9 : 10,
      fontWeight: 700,
      height: compact ? 26 : 30,
      padding: compact ? "0 6px" : "0 8px",
      cursor: "pointer",
      opacity: 1,
      transition: "transform 90ms ease, filter 120ms ease, border-color 120ms ease",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      width: "100%",
      minWidth: 0,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      lineHeight: 1.1,
    };
    const disabledButtonStyle = {
      border: "1px solid color-mix(in srgb, var(--border) 94%, #94a3b8 6%)",
      background: "color-mix(in srgb, var(--bg) 98%, #64748b 2%)",
      color: "color-mix(in srgb, var(--text-muted) 88%, var(--text) 12%)",
      cursor: "not-allowed",
      opacity: 0.62,
      filter: "saturate(0.45)",
      boxShadow: "none",
      transform: "none",
    };
    const withDisabledStyle = (isDisabled) => (isDisabled ? { ...buttonStyle, ...disabledButtonStyle } : buttonStyle);
    return (
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, display: "grid", gap: 5 }}>
        <div style={{ fontSize: compact ? 10 : 11, fontWeight: 700, color: "var(--text)" }}>Diverter Controls</div>
        <div style={{ fontSize: compact ? 9 : 10, color: "var(--text-muted)" }}>
          UDT: TwoWay_DiscreteV2
        </div>
        <div style={{ fontSize: compact ? 9 : 10, color: "var(--text-muted)" }}>
          Status: {modeStatusLabel || (activeMode === "manual" ? "Manual" : activeMode === "auto" ? "Auto" : activeMode === "maintenance" ? "Maintenance" : "-")}
        </div>
        <div style={{ fontSize: compact ? 9 : 10, color: "var(--text-muted)" }}>
          HMI State: {positionLabel}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4 }}>
          <button
            type="button"
            style={withDisabledStyle(straightDisabled)}
            disabled={straightDisabled}
            onClick={() => void triggerDiverterCommand("Straight", straightPath, straightWriteValue, commandWriteOptions)}
            title={
              modeBlocksPositionCommands
                ? "disabled while in Auto mode"
                : straightPath || "HMI_Control tag not found"
            }
          >
            {straightIcon}
            <span>Straight</span>
          </button>
          <button
            type="button"
            style={withDisabledStyle(divertDisabled)}
            disabled={divertDisabled}
            onClick={() => void triggerDiverterCommand("Divert", divertPath, divertWriteValue, commandWriteOptions)}
            title={
              modeBlocksPositionCommands
                ? "disabled while in Auto mode"
                : divertPath || "HMI_Control tag not found"
            }
          >
            {divertIcon}
            <span>Divert</span>
          </button>
          <button
            type="button"
            style={
              resetDisabled
                ? withDisabledStyle(true)
                : {
                    ...buttonStyle,
                    border: "1px solid color-mix(in srgb, #f59e0b 78%, var(--border) 22%)",
                    background: "linear-gradient(180deg, #f59e0b 0%, #ea580c 100%)",
                    color: "#fff7ed",
                    textShadow: "0 1px 1px rgba(0,0,0,0.22)",
                  }
            }
            disabled={resetDisabled}
            onClick={() => void triggerDiverterCommand("Fault Reset", resetPath, resetWriteValue, commandWriteOptions)}
            title={resetPath || "Fault reset tag not found"}
          >
            <span style={iconCommon} aria-hidden="true">
              <svg viewBox="0 0 24 24" width={compact ? 10 : 12} height={compact ? 10 : 12} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3.5 21 19H3L12 3.5Z" />
                <path d="M12 9v5.2" />
                <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span>Fault Reset</span>
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4 }}>
          <button
            type="button"
            style={withDisabledStyle(autoDisabled)}
            disabled={autoDisabled}
            onClick={() => void triggerDiverterCommand("Automatic", autoPath, autoWriteValue, commandWriteOptions)}
            title={!autoPath ? "HMI_Control tag not found" : activeMode === "auto" ? "Already in Auto mode" : autoPath}
          >
            {autoIcon}
            <span>Auto</span>
          </button>
          <button
            type="button"
            style={withDisabledStyle(manualDisabled)}
            disabled={manualDisabled}
            onClick={() => void triggerDiverterCommand("Manual", manualPath, manualWriteValue, commandWriteOptions)}
            title={!manualPath ? "HMI_Control tag not found" : activeMode === "manual" ? "Already in Manual mode" : manualPath}
          >
            {manualIcon}
            <span>Manual</span>
          </button>
          <button
            type="button"
            style={withDisabledStyle(maintenanceDisabled)}
            disabled={maintenanceDisabled}
            onClick={() => void triggerDiverterCommand("Maintenance", maintenancePath, maintenanceWriteValue, commandWriteOptions)}
            title={!maintenancePath ? "HMI_Control tag not found" : activeMode === "maintenance" ? "Already in Maintenance mode" : maintenancePath}
          >
            {maintenanceIcon}
            <span>Maint</span>
          </button>
        </div>
        {writeError ? (
          <div style={{ fontSize: compact ? 9 : 10, color: "var(--danger)" }}>{writeError}</div>
        ) : null}
      </div>
    );
  };
  const buildLiveEquipmentDetails = (overlay) => {
    if (!overlay) return [];
    const path = String(overlay.tagPath || "").trim();
    const eType = resolveOverlayEType(overlay);
    const rows = [];
    const seenKeys = new Set();
    const pushRow = (key, value) => {
      const label = String(key || "").trim();
      if (!label) return;
      const lk = label.toLowerCase();
      if (seenKeys.has(lk)) return;
      seenKeys.add(lk);
      rows.push({ key: label, value: value == null || value === "" ? "-" : String(value) });
    };
    if (eType) {
      const rawEType = String(eType || "").trim().toLowerCase();
      rows.push({ key: "UDT", value: rawEType.includes("diverter") ? "TwoWay_DiscreteV2" : eType });
    }
    const popupTagValueEnabled = (() => {
      if (!path) return true;
      const target = normalizeTagValue(path).toLowerCase();
      if (!target) return true;
      const tags = Array.isArray(opcTags) ? opcTags : [];
      for (const t of tags) {
        const topic = normalizeTagValue(t?.topic || "");
        const group = normalizeTagValue(t?.groupName || "");
        const name = normalizeTagValue(t?.name || "");
        const memberPath = normalizeTagValue(t?.tagPath || name);
        const candidates = [
          topic && group && memberPath ? `${topic}.${group}.${memberPath}` : "",
          topic && memberPath ? `${topic}.${memberPath}` : "",
          group && memberPath ? `${group}.${memberPath}` : "",
          memberPath,
          name,
        ]
          .map((x) => normalizeTagValue(x))
          .filter(Boolean);
        const matched = candidates.some((c) => {
          const cl = c.toLowerCase();
          return cl === target || cl.endsWith(`.${target}`) || target.endsWith(`.${cl}`);
        });
        if (matched) return t?.showPopupTagValue !== false;
      }
      return true;
    })();
    if (path && popupTagValueEnabled) {
      const resolvedPath =
        findLiveTagPathMatch([path]) ||
        findOpcConfiguredTagPathMatch(overlay, [path]) ||
        "";
      if (resolvedPath) {
        const liveValue =
          Object.prototype.hasOwnProperty.call(opcLiveValues || {}, resolvedPath)
            ? opcLiveValues[resolvedPath]
            : opcLiveValues?.[String(resolvedPath).toLowerCase()];
        if (liveValue != null && liveValue !== "") {
          pushRow("Tag Value", liveValue);
        }
      }
    }
    const groupLive = path
      ? svgLiveValuesByGroupPath.get(path) || svgLiveValuesByGroupPath.get(path.toLowerCase()) || null
      : null;
    if (groupLive?.routeId) pushRow("Route", groupLive.routeId);
    if (groupLive?.state) pushRow("State", groupLive.state);
    const inferGroupName = (tag) => {
      const explicit = normalizeTagValue(tag?.groupName || "");
      if (explicit) return explicit;
      const rawPath = normalizeTagValue(tag?.tagPath || tag?.name || "");
      if (!rawPath.includes(".")) return "";
      return normalizeTagValue(rawPath.slice(0, rawPath.indexOf(".")));
    };
    const readLiveTagValue = (tag, topic, group) => {
      const candidates = [
        topic && group && tag?.tagPath ? `${topic}.${group}.${tag.tagPath}` : "",
        topic && group && tag?.name ? `${topic}.${group}.${tag.name}` : "",
        topic && tag?.tagPath ? `${topic}.${tag.tagPath}` : "",
        topic && tag?.name ? `${topic}.${tag.name}` : "",
        group && tag?.tagPath ? `${group}.${tag.tagPath}` : "",
        group && tag?.name ? `${group}.${tag.name}` : "",
        tag?.tagPath || "",
        tag?.name || "",
      ]
        .map((x) => normalizeTagValue(x))
        .filter(Boolean);
      const live = opcLiveValues || {};
      for (const k of candidates) {
        if (Object.prototype.hasOwnProperty.call(live, k)) return live[k];
        const lower = k.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(live, lower)) return live[lower];
      }
      return "";
    };
    const normalizeLoose = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    if (path) {
      const normalizedPath = normalizeTagValue(path);
      const pathLower = normalizedPath.toLowerCase();
      const pathLoose = normalizeLoose(normalizedPath);
      (Array.isArray(opcTags) ? opcTags : []).forEach((tag) => {
        const topic = normalizeTagValue(tag?.topic || "");
        const group = inferGroupName(tag);
        const member = normalizeTagValue(tag?.tagPath || tag?.name || "");
        const scopeCandidates = [
          topic && group ? `${topic}.${group}` : "",
          group,
          topic && member ? `${topic}.${member}` : "",
          member,
        ]
          .map((x) => normalizeTagValue(x))
          .filter(Boolean);
        const match = scopeCandidates.some((c) => {
          const cl = c.toLowerCase();
          if (cl === pathLower || cl.endsWith(`.${pathLower}`) || pathLower.endsWith(`.${cl}`)) return true;
          const loose = normalizeLoose(c);
          return !!(loose && pathLoose && (loose.includes(pathLoose) || pathLoose.includes(loose)));
        });
        if (!match) return;
        const rawMember = String(tag?.tagPath || tag?.name || "").trim();
        const groupPrefix = String(group || "").trim();
        let label = rawMember || `Tag ${rows.length + 1}`;
        if (groupPrefix && label.toLowerCase().startsWith(`${groupPrefix.toLowerCase()}.`)) {
          label = label.slice(groupPrefix.length + 1);
        }
        pushRow(label, readLiveTagValue(tag, topic, group));
      });
    }
    if (path) {
      const lowerPath = path.toLowerCase();
      const direct = Object.entries(opcLiveValues || {}).filter(([k]) => {
        const key = String(k || "").toLowerCase();
        return key === lowerPath || key.endsWith(`.${lowerPath}`) || key.includes(`${lowerPath}.`);
      });
      direct.slice(0, 12).forEach(([k, v]) => {
        const label = String(k || "").split(".").pop() || String(k || "");
        pushRow(label, v);
      });
    }
    return rows;
  };
  const getOverlayPopupTagName = (overlay) => {
    const rawPath = String(overlay?.tagPath || "").trim();
    if (rawPath) {
      const normalized = rawPath.replace(/\//g, ".");
      const parts = normalized.split(".").map((x) => String(x || "").trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
      return rawPath;
    }
    const rawName = String(overlay?.name || "").trim();
    if (!rawName) return "Equipment";
    return rawName.replace(/\.svg$/i, "").trim() || "Equipment";
  };
  const getOverlayEquipmentDescription = (overlay) => {
    const path = normalizeTagValue(overlay?.tagPath || "");
    if (!path) return "";
    const pathLower = path.toLowerCase();
    const normalizeLoose = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    const pathLoose = normalizeLoose(path);
    const rows = Array.isArray(projectEquipmentRows) ? projectEquipmentRows : [];
    for (const row of rows) {
      const description = String(
        row?.description ?? row?.Description ?? row?.equipment_description ?? row?.equipmentDescription ?? ""
      ).trim();
      if (!description) continue;
      const keys = [
        row?.tag_path,
        row?.tagPath,
        row?.svg_tag_path,
        row?.svgTagPath,
        row?.path,
        row?.Path,
        row?.name,
        row?.Name,
      ]
        .map((v) => normalizeTagValue(v))
        .filter(Boolean);
      const matched = keys.some((k) => {
        const kl = k.toLowerCase();
        if (kl === pathLower || kl.endsWith(`.${pathLower}`) || pathLower.endsWith(`.${kl}`)) return true;
        const loose = normalizeLoose(k);
        return !!(loose && pathLoose && (loose.includes(pathLoose) || pathLoose.includes(loose)));
      });
      if (matched) return description;
    }
    return "";
  };
  const getProjectBinBindingKey = (row) => {
    const id = String(
      row?.id ??
        row?.bin_id ??
        row?.binId ??
        row?.bin_index ??
        row?.binIndex ??
        row?.tbl_index ??
        ""
    ).trim();
    if (id) return `id:${id}`;
    const path = normalizeTagValue(
      row?.tag_path ?? row?.tagPath ?? row?.svg_tag_path ?? row?.svgTagPath ?? row?.path ?? row?.Path ?? ""
    ).toLowerCase();
    if (path) return `path:${path}`;
    const name = normalizeTagValue(row?.bin_name ?? row?.binName ?? row?.name ?? row?.Name ?? "").toLowerCase();
    if (name) return `name:${name}`;
    return "";
  };
  const getProjectBinRowId = (row) =>
    String(
      row?.id ?? row?.tbl_index ?? row?.bin_id ?? row?.binId ?? row?.bin_index ?? row?.binIndex ?? ""
    ).trim();
  const getProjectBinName = (row) =>
    normalizeTagValue(row?.bin_name ?? row?.binName ?? row?.name ?? row?.Name ?? "");
  const getProjectBinPath = (row) =>
    normalizeTagValue(row?.tag_path ?? row?.tagPath ?? row?.svg_tag_path ?? row?.svgTagPath ?? row?.path ?? row?.Path ?? "");
  const extractBinNumber = (input) => {
    const raw = String(input || "").trim();
    if (!raw) return null;
    const explicit = raw.match(/\bbin\s*0*(\d+)\b/i);
    if (explicit?.[1]) {
      const n = Number(explicit[1]);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
    const fallback = raw.match(/\b0*(\d+)\b/);
    if (!fallback?.[1]) return null;
    const n = Number(fallback[1]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };
  const toCanonicalBinName = (input) => {
    const n = extractBinNumber(input);
    if (n == null) return "";
    return `Bin${n}`;
  };
  const resolveBinTableColumns = async (tableName) => {
    const table = String(tableName || "bin").trim() || "bin";
    try {
      const meta = await getTableMeta(table);
      const cols = Array.isArray(meta?.columns) ? meta.columns : [];
      const names = new Set(
        cols
          .map((c) => String(c?.column_name || "").trim().toLowerCase())
          .filter(Boolean)
      );
      return names;
    } catch {
      return new Set();
    }
  };
  const buildBinInsertPayload = (binName, tableColumns) => {
    const cols = tableColumns instanceof Set ? tableColumns : new Set();
    const payload = {};
    if (cols.has("name")) payload.name = binName;
    if (cols.has("bin_name")) payload.bin_name = binName;
    if (cols.has("description")) payload.description = `${binName} (AI)`;
    if (cols.has("tag_path")) payload.tag_path = binName;
    if (cols.has("project_id") && String(activeProjectId || "").trim()) {
      payload.project_id = String(activeProjectId || "").trim();
    }
    return payload;
  };
  const ensureAiBinsExist = async (items) => {
    const requested = (Array.isArray(items) ? items : [])
      .map((item) => {
        const label = String(item?.label || "").trim();
        const path = String(item?.tagPath || "").trim();
        const byLabel = toCanonicalBinName(label);
        const byPath = toCanonicalBinName(path);
        const canonicalName = byLabel || byPath;
        if (!canonicalName) return null;
        return { ...item, canonicalName };
      })
      .filter(Boolean);
    if (!requested.length) return new Map();

    const rows = Array.isArray(projectBinRows) ? projectBinRows : [];
    const byName = new Map();
    rows.forEach((row) => {
      const rowName = toCanonicalBinName(getProjectBinName(row) || getProjectBinPath(row));
      if (!rowName) return;
      const rowId = getProjectBinRowId(row);
      const key = getProjectBinBindingKey(row) || (rowId ? `id:${rowId}` : "");
      if (!key) return;
      byName.set(rowName.toLowerCase(), { row, key });
    });

    const missing = [];
    requested.forEach((item) => {
      const k = item.canonicalName.toLowerCase();
      if (!byName.has(k)) missing.push(item.canonicalName);
    });
    const uniqueMissing = Array.from(new Set(missing));
    if (uniqueMissing.length) {
      const table = String(projectBinTableName || "bin").trim() || "bin";
      const cols = await resolveBinTableColumns(table);
      const createdRows = [];
      for (const binName of uniqueMissing) {
        const payload = buildBinInsertPayload(binName, cols);
        if (!Object.keys(payload).length) continue;
        try {
          const data = await insertTableRow(table, payload);
          const created = data?.row && typeof data.row === "object" ? data.row : null;
          if (!created) continue;
          createdRows.push(created);
          const rowId = getProjectBinRowId(created);
          const key = getProjectBinBindingKey(created) || (rowId ? `id:${rowId}` : "");
          if (key) byName.set(binName.toLowerCase(), { row: created, key });
        } catch {
          // Keep layout flow running even if one insert fails.
        }
      }
      if (createdRows.length) {
        setProjectBinRows((prev) => [...(Array.isArray(prev) ? prev : []), ...createdRows]);
      }
    }

    const bindings = new Map();
    requested.forEach((item) => {
      const hit = byName.get(item.canonicalName.toLowerCase());
      if (!hit?.key) return;
      bindings.set(item.id, {
        binBindingKey: hit.key,
        canonicalName: item.canonicalName,
      });
    });
    return bindings;
  };
  const getProjectBinLevelFieldName = (row) => {
    if (!row || typeof row !== "object") return "";
    const candidates = [
      "level",
      "Level",
      "current_level",
      "currentLevel",
      "qty",
      "quantity",
      "Quantity",
    ];
    for (const key of candidates) {
      if (Object.prototype.hasOwnProperty.call(row, key)) return key;
    }
    return "level";
  };
  const getProjectBinLevelValue = (row) => {
    if (!row || typeof row !== "object") return null;
    const key = getProjectBinLevelFieldName(row);
    const raw = row?.[key];
    if (raw == null || String(raw).trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const getProjectBinBindingCandidates = (raw) => {
    const text = String(raw || "").trim();
    if (!text) return [];
    const lower = text.toLowerCase();
    const out = new Set([lower]);
    const normalizedText = normalizeTagValue(text).toLowerCase();
    if (normalizedText) out.add(normalizedText);
    const colon = lower.indexOf(":");
    if (colon > 0) {
      const prefix = lower.slice(0, colon).trim();
      const rest = lower.slice(colon + 1).trim();
      if ((prefix === "id" || prefix === "path" || prefix === "name") && rest) out.add(rest);
    } else {
      if (/^\d+$/.test(lower)) out.add(`id:${lower}`);
      if (normalizedText) {
        out.add(`path:${normalizedText}`);
        out.add(`name:${normalizedText}`);
      }
      const paired = text.match(/^(.*?)\s*\((.+)\)\s*$/);
      if (paired) {
        const left = normalizeTagValue(paired[1]).toLowerCase();
        const right = normalizeTagValue(paired[2]).toLowerCase();
        if (left) {
          out.add(left);
          out.add(`name:${left}`);
        }
        if (right) {
          out.add(right);
          out.add(`path:${right}`);
        }
      }
    }
    return Array.from(out).filter(Boolean);
  };
  const getBinRowIdFromBindingKey = (raw) => {
    const candidates = getProjectBinBindingCandidates(raw);
    for (const token of candidates) {
      const t = String(token || "").trim().toLowerCase();
      if (!t) continue;
      if (t.startsWith("id:")) {
        const id = t.slice(3).trim();
        if (id) return id;
      }
      if (/^\d+$/.test(t)) return t;
    }
    return "";
  };
  const getProjectRowId = (row) =>
    String(
      row?.id ??
        row?.tbl_index ??
        row?.bin_id ??
        row?.binId ??
        row?.bin_index ??
        row?.binIndex ??
        row?.product_id ??
        row?.productId ??
        ""
    ).trim();
  const getProjectProductName = (row) =>
    normalizeTagValue(row?.name ?? row?.product_name ?? row?.productName ?? row?.Name ?? "") || "(Unnamed)";
  const productNameById = useMemo(() => {
    const map = new Map();
    const rows = Array.isArray(projectProductRows) ? projectProductRows : [];
    rows.forEach((row) => {
      const id = getProjectRowId(row);
      if (!id) return;
      const name = getProjectProductName(row);
      map.set(id, name);
    });
    return map;
  }, [projectProductRows]);
  const saveBinProductAssignment = async (overlay, row, nextProductIdRaw) => {
    const overlayId = String(overlay?.id || "").trim();
    const rowId = getProjectBinRowId(row) || getBinRowIdFromBindingKey(overlay?.binBindingKey);
    const table = String(projectBinTableName || "bin").trim();
    if (!overlayId || !rowId || !table) return;
    const valueText = String(nextProductIdRaw || "").trim();
    const numeric = /^\d+$/.test(valueText) ? Number(valueText) : valueText;
    const value = valueText ? numeric : null;
    setLiveBinProductSaveBusyByOverlay((prev) => ({ ...(prev || {}), [overlayId]: true }));
    setLiveBinProductSaveErrorByOverlay((prev) => ({ ...(prev || {}), [overlayId]: "" }));
    try {
      const data = await updateTableRow(table, rowId, { product_id: value });
      const updatedRow = data?.row && typeof data.row === "object" ? data.row : null;
      if (updatedRow) {
        setProjectBinRows((prev) =>
          (Array.isArray(prev) ? prev : []).map((r) => {
            const id = getProjectBinRowId(r);
            return id && id === rowId ? { ...r, ...updatedRow } : r;
          })
        );
      }
      setLiveBinProductDraftByOverlay((prev) => ({ ...(prev || {}), [overlayId]: valueText }));
      toastSuccess("Bin product updated.");
    } catch (err) {
      const msg = String(err?.message || "Failed to assign product.");
      setLiveBinProductSaveErrorByOverlay((prev) => ({ ...(prev || {}), [overlayId]: msg }));
      toastError(msg);
    } finally {
      setLiveBinProductSaveBusyByOverlay((prev) => ({ ...(prev || {}), [overlayId]: false }));
    }
  };
  const saveBinLevelChange = async (overlay, row, mode, draftRaw) => {
    const overlayId = String(overlay?.id || "").trim();
    const rowId = getProjectBinRowId(row) || getBinRowIdFromBindingKey(overlay?.binBindingKey);
    const table = String(projectBinTableName || "bin").trim();
    const levelField = getProjectBinLevelFieldName(row);
    const currentLevel = getProjectBinLevelValue(row) ?? 0;
    const draftText = String(draftRaw || "").trim();
    const parsed = Number(draftText);
    if (!overlayId || !rowId || !table || !levelField) return;
    if (!Number.isFinite(parsed)) {
      const msg = "Enter a numeric level value.";
      setLiveBinLevelSaveErrorByOverlay((prev) => ({ ...(prev || {}), [overlayId]: msg }));
      return;
    }
    const nextValue = String(mode || "").trim().toLowerCase() === "register" ? currentLevel + parsed : parsed;
    setLiveBinLevelSaveBusyByOverlay((prev) => ({ ...(prev || {}), [overlayId]: true }));
    setLiveBinLevelSaveErrorByOverlay((prev) => ({ ...(prev || {}), [overlayId]: "" }));
    try {
      const data = await updateTableRow(table, rowId, { [levelField]: nextValue });
      const updatedRow = data?.row && typeof data.row === "object" ? data.row : null;
      if (updatedRow) {
        setProjectBinRows((prev) =>
          (Array.isArray(prev) ? prev : []).map((r) => {
            const id = getProjectBinRowId(r);
            return id && id === rowId ? { ...r, ...updatedRow } : r;
          })
        );
      } else {
        setProjectBinRows((prev) =>
          (Array.isArray(prev) ? prev : []).map((r) => {
            const id = getProjectBinRowId(r);
            return id && id === rowId ? { ...r, [levelField]: nextValue } : r;
          })
        );
      }
      setLiveBinLevelDraftByOverlay((prev) => ({ ...(prev || {}), [overlayId]: "" }));
      toastSuccess(String(mode || "").trim().toLowerCase() === "register" ? "Bin level registered." : "Bin level updated.");
    } catch (err) {
      const msg = String(err?.message || "Failed to update bin level.");
      setLiveBinLevelSaveErrorByOverlay((prev) => ({ ...(prev || {}), [overlayId]: msg }));
      toastError(msg);
    } finally {
      setLiveBinLevelSaveBusyByOverlay((prev) => ({ ...(prev || {}), [overlayId]: false }));
    }
  };
  const findProjectBinRowForOverlay = (overlay) => {
    if (!overlay) return null;
    const bindingCandidates = getProjectBinBindingCandidates(overlay?.binBindingKey);
    if (bindingCandidates.length) {
      const candidateSet = new Set(bindingCandidates);
      const rows = Array.isArray(projectBinRows) ? projectBinRows : [];
      const direct = rows.find((row) => {
        const rowKey = String(getProjectBinBindingKey(row) || "").trim().toLowerCase();
        const rowId = getProjectBinRowId(row).toLowerCase();
        const rowPath = getProjectBinPath(row).toLowerCase();
        const rowName = getProjectBinName(row).toLowerCase();
        const rowKeys = [
          rowKey,
          rowId,
          rowPath,
          rowName,
          rowId ? `id:${rowId}` : "",
          rowPath ? `path:${rowPath}` : "",
          rowName ? `name:${rowName}` : "",
        ].filter(Boolean);
        return rowKeys.some((k) => candidateSet.has(k));
      });
      if (direct) return direct;
    }
    const normalizeLoose = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    const overlayTagPath = normalizeTagValue(overlay?.tagPath || "");
    const overlayName = normalizeTagValue(getOverlayPopupTagName(overlay) || overlay?.name || "");
    const pathLower = overlayTagPath.toLowerCase();
    const nameLower = overlayName.toLowerCase();
    const pathLoose = normalizeLoose(overlayTagPath);
    const nameLoose = normalizeLoose(overlayName);
    const rows = Array.isArray(projectBinRows) ? projectBinRows : [];
    let best = null;
    let bestScore = -1;
    for (const row of rows) {
      const fields = [
        row?.tag_path,
        row?.tagPath,
        row?.svg_tag_path,
        row?.svgTagPath,
        row?.bin_name,
        row?.binName,
        row?.name,
        row?.Name,
        row?.path,
        row?.Path,
      ]
        .map((v) => normalizeTagValue(v))
        .filter(Boolean);
      if (!fields.length) continue;
      let score = 0;
      for (const raw of fields) {
        const lower = raw.toLowerCase();
        const loose = normalizeLoose(raw);
        if (pathLower && (lower === pathLower || lower.endsWith(`.${pathLower}`) || pathLower.endsWith(`.${lower}`))) score = Math.max(score, 100);
        if (nameLower && lower === nameLower) score = Math.max(score, 90);
        if (pathLoose && loose && (loose === pathLoose || loose.includes(pathLoose) || pathLoose.includes(loose))) score = Math.max(score, 70);
        if (nameLoose && loose && (loose === nameLoose || loose.includes(nameLoose) || nameLoose.includes(loose))) score = Math.max(score, 60);
      }
      if (score > bestScore) {
        best = row;
        bestScore = score;
      }
    }
    return bestScore > 0 ? best : null;
  };
  const getOverlayBinProductName = (overlay) => {
    const row = findProjectBinRowForOverlay(overlay);
    if (!row) return "";
    const productId = normalizeTagValue(
      row?.product_id ?? row?.productId ?? row?.product_index ?? row?.productIndex ?? ""
    );
    if (productId) {
      const fromMap = String(productNameById.get(productId) || "").trim();
      if (fromMap) return fromMap;
    }
    return normalizeTagValue(
      row?.product_name ?? row?.productName ?? row?.product ?? row?.Product ?? row?.material ?? row?.Material ?? ""
    );
  };
  const getOverlayPopupTitle = (overlay) => {
    const eType = String(resolveOverlayEType(overlay) || "").trim();
    if (isBinEType(eType)) {
      const row = findProjectBinRowForOverlay(overlay);
      const name = getProjectBinName(row);
      if (name) return name;
    }
    return getOverlayPopupTagName(overlay);
  };
  const getOverlayPopupSubline = (overlay) => {
    const eType = String(resolveOverlayEType(overlay) || "").trim();
    if (!isBinEType(eType)) return "";
    const row = findProjectBinRowForOverlay(overlay);
    return getProjectBinPath(row);
  };
  const renderLiveBinDetails = (overlay, compact = false) => {
    const eType = String(resolveOverlayEType(overlay) || "").trim();
    if (!isBinEType(eType)) return null;
    const row = findProjectBinRowForOverlay(overlay);
    const readField = (keys) => {
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(row || {}, key)) {
          const value = row?.[key];
          if (value != null && String(value).trim() !== "") return String(value).trim();
        }
      }
      return "";
    };
    const overlayId = String(overlay?.id || "").trim();
    const name = readField(["bin_name", "binName", "name", "Name"]) || "-";
    const tagPath = readField(["tag_path", "tagPath", "svg_tag_path", "svgTagPath", "path", "Path"]);
    const material = readField(["material", "Material", "product", "Product", "product_name", "productName"]);
    const currentProductName = String(getOverlayBinProductName(overlay) || material || "-");
    const capacity = readField(["capacity", "Capacity", "max_capacity", "maxCapacity", "max_qty", "maxQty"]);
    const level = readField(["level", "Level", "current_level", "currentLevel", "qty", "quantity", "Quantity"]);
    const status = readField(["status", "Status", "state", "State"]);
    const rows = [
      { key: "Bin", value: name },
      { key: "Tag Path", value: tagPath || "-" },
      { key: "Product", value: currentProductName || "-" },
      { key: "Level", value: level || "-" },
      { key: "Capacity", value: capacity || "-" },
      { key: "Status", value: status || "-" },
    ];
    const productOptions = (Array.isArray(projectProductRows) ? projectProductRows : [])
      .map((p) => ({ id: getProjectRowId(p), name: getProjectProductName(p) }))
      .filter((p) => p.id);
    const currentProductId = normalizeTagValue(
      row?.product_id ?? row?.productId ?? row?.product_index ?? row?.productIndex ?? ""
    );
    const draftProductId = String(liveBinProductDraftByOverlay?.[overlayId] ?? currentProductId ?? "").trim();
    const saveBusy = liveBinProductSaveBusyByOverlay?.[overlayId] === true;
    const saveError = String(liveBinProductSaveErrorByOverlay?.[overlayId] || "").trim();
    const currentLevelNumber = getProjectBinLevelValue(row);
    const levelDraft = String(liveBinLevelDraftByOverlay?.[overlayId] ?? "").trim();
    const levelBusy = liveBinLevelSaveBusyByOverlay?.[overlayId] === true;
    const levelError = String(liveBinLevelSaveErrorByOverlay?.[overlayId] || "").trim();
    const fallbackRowId = getBinRowIdFromBindingKey(overlay?.binBindingKey);
    const canSave = !!(getProjectBinRowId(row) || fallbackRowId);
    return (
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: compact ? 5 : 6 }}>
        <div
          style={{
            fontSize: compact ? 10 : 11,
            fontWeight: 700,
            marginBottom: compact ? 4 : 6,
            color: "var(--text)",
          }}
        >
          Bin Details
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            columnGap: compact ? 8 : 10,
            rowGap: compact ? 3 : 4,
            alignContent: "start",
            alignItems: "center",
            fontSize: compact ? 10 : 11,
          }}
        >
          {rows.map((entry) => (
            <Fragment key={`live-bin-detail-${String(overlay?.id || "")}-${entry.key}`}>
              <div style={{ color: "var(--text-muted)" }}>{entry.key}</div>
              <div style={{ color: "var(--text)", fontWeight: 700, textAlign: "right" }}>{entry.value}</div>
            </Fragment>
          ))}
        </div>
        <div style={{ display: "grid", gap: 6, marginTop: compact ? 6 : 8 }}>
          <div style={{ fontSize: compact ? 10 : 11, color: "var(--text-muted)" }}>Assign Product</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select
              value={draftProductId}
              onChange={(e) => {
                const value = String(e.target.value || "");
                setLiveBinProductDraftByOverlay((prev) => ({ ...(prev || {}), [overlayId]: value }));
              }}
              style={{
                flex: "1 1 auto",
                minWidth: 0,
                height: compact ? 24 : 26,
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--text)",
                borderRadius: 7,
                padding: "0 8px",
                fontSize: compact ? 10 : 11,
              }}
              disabled={saveBusy}
            >
              <option value="">None</option>
              {productOptions.map((opt) => (
                <option key={`bin-product-opt-${opt.id}`} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                saveBinProductAssignment(
                  overlay,
                  row || (fallbackRowId ? { id: fallbackRowId, tbl_index: fallbackRowId } : null),
                  draftProductId
                )
              }
              disabled={!canSave || saveBusy}
              style={{
                border: "1px solid var(--border)",
                background: "var(--accent)",
                color: "var(--accent-text)",
                borderRadius: 7,
                height: compact ? 24 : 26,
                minWidth: compact ? 54 : 60,
                padding: compact ? "0 8px" : "0 10px",
                fontSize: compact ? 10 : 11,
                fontWeight: 700,
                cursor: !canSave || saveBusy ? "not-allowed" : "pointer",
                opacity: !canSave || saveBusy ? 0.7 : 1,
              }}
            >
              {saveBusy ? "Saving" : "Save"}
            </button>
          </div>
          {saveError ? (
            <div style={{ fontSize: compact ? 9 : 10, color: "var(--danger)" }}>{saveError}</div>
          ) : null}
        </div>
        <div style={{ display: "grid", gap: 6, marginTop: compact ? 6 : 8 }}>
          <div style={{ fontSize: compact ? 10 : 11, color: "var(--text-muted)" }}>Level</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="number"
              value={levelDraft}
              onChange={(e) => {
                const value = String(e.target.value || "");
                setLiveBinLevelDraftByOverlay((prev) => ({ ...(prev || {}), [overlayId]: value }));
              }}
              placeholder={currentLevelNumber != null ? String(currentLevelNumber) : "0"}
              style={{
                flex: "1 1 110px",
                minWidth: compact ? 72 : 90,
                height: compact ? 24 : 26,
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--text)",
                borderRadius: 7,
                padding: "0 8px",
                fontSize: compact ? 10 : 11,
              }}
              disabled={levelBusy}
            />
            <button
              type="button"
              onClick={() => saveBinLevelChange(overlay, row || (fallbackRowId ? { id: fallbackRowId, tbl_index: fallbackRowId } : null), "register", levelDraft)}
              disabled={!canSave || levelBusy}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-soft)",
                color: "var(--text)",
                borderRadius: 7,
                height: compact ? 24 : 26,
                minWidth: compact ? 62 : 72,
                padding: compact ? "0 8px" : "0 10px",
                fontSize: compact ? 10 : 11,
                fontWeight: 700,
                cursor: !canSave || levelBusy ? "not-allowed" : "pointer",
                opacity: !canSave || levelBusy ? 0.7 : 1,
              }}
              title="Add this value to current level"
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => saveBinLevelChange(overlay, row || (fallbackRowId ? { id: fallbackRowId, tbl_index: fallbackRowId } : null), "set", levelDraft)}
              disabled={!canSave || levelBusy}
              style={{
                border: "1px solid var(--border)",
                background: "var(--accent)",
                color: "var(--accent-text)",
                borderRadius: 7,
                height: compact ? 24 : 26,
                minWidth: compact ? 68 : 80,
                padding: compact ? "0 8px" : "0 10px",
                fontSize: compact ? 10 : 11,
                fontWeight: 700,
                cursor: !canSave || levelBusy ? "not-allowed" : "pointer",
                opacity: !canSave || levelBusy ? 0.7 : 1,
              }}
              title="Set exact level"
            >
              Set Level
            </button>
          </div>
          {levelError ? (
            <div style={{ fontSize: compact ? 9 : 10, color: "var(--danger)" }}>{levelError}</div>
          ) : null}
        </div>
      </div>
    );
  };
  const liveEquipmentOverlays = useMemo(() => {
    const byId = new Map((svgOverlays || []).map((o) => [String(o.id || ""), o]));
    return (liveEquipmentOverlayIds || [])
      .map((id) => byId.get(String(id || "")))
      .filter(Boolean)
      .map((overlay) => ({
        overlay,
        details: buildLiveEquipmentDetails(overlay),
      }));
  }, [svgOverlays, liveEquipmentOverlayIds, svgLiveValuesByGroupPath, opcLiveValues, opcTags]);
  const binProductLabelByOverlayId = useMemo(() => {
    const out = {};
    (Array.isArray(svgOverlays) ? svgOverlays : []).forEach((overlay) => {
      const id = String(overlay?.id || "").trim();
      if (!id) return;
      const eType = String(resolveOverlayEType(overlay) || "").trim();
      if (!isBinEType(eType)) return;
      const label = String(getOverlayBinProductName(overlay) || "").trim();
      if (label) out[id] = label;
    });
    return out;
  }, [svgOverlays, projectBinRows, productNameById]);
  const binNameLabelByOverlayId = useMemo(() => {
    const out = {};
    (Array.isArray(svgOverlays) ? svgOverlays : []).forEach((overlay) => {
      const id = String(overlay?.id || "").trim();
      if (!id) return;
      const eType = String(resolveOverlayEType(overlay) || "").trim();
      if (!isBinEType(eType)) return;
      const row = findProjectBinRowForOverlay(overlay);
      const name = String(getProjectBinName(row) || "").trim();
      if (name) out[id] = name;
    });
    return out;
  }, [svgOverlays, projectBinRows]);
  const binLevelRatioByOverlayId = useMemo(() => {
    const out = {};
    const readCapacityValue = (row) => {
      if (!row || typeof row !== "object") return null;
      const candidates = [
        "capacity",
        "Capacity",
        "max_capacity",
        "maxCapacity",
        "max_qty",
        "maxQty",
      ];
      for (const key of candidates) {
        if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
        const raw = row?.[key];
        if (raw == null || String(raw).trim() === "") continue;
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
      }
      return null;
    };
    (Array.isArray(svgOverlays) ? svgOverlays : []).forEach((overlay) => {
      const id = String(overlay?.id || "").trim();
      if (!id) return;
      const row = findProjectBinRowForOverlay(overlay);
      if (!row) return;
      const level = getProjectBinLevelValue(row);
      const capacity = readCapacityValue(row);
      if (!Number.isFinite(level) || !Number.isFinite(capacity) || capacity <= 0) {
        out[id] = 0;
        return;
      }
      out[id] = Math.max(0, Math.min(1, level / capacity));
    });
    return out;
  }, [svgOverlays, projectBinRows]);
  const svgBinBindingOptions = useMemo(() => {
    const options = [{ value: "", label: "Auto-match (Tag Path/Name)" }];
    const seen = new Set();
    const rows = Array.isArray(projectBinRows) ? projectBinRows : [];
    rows.forEach((row) => {
      const value = getProjectBinBindingKey(row);
      if (!value) return;
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const name = normalizeTagValue(row?.bin_name ?? row?.binName ?? row?.name ?? row?.Name ?? "") || "(Unnamed)";
      const path = normalizeTagValue(row?.tag_path ?? row?.tagPath ?? row?.svg_tag_path ?? row?.svgTagPath ?? "");
      const label = path ? `${name} (${path})` : name;
      options.push({ value, label, group: "Bin" });
    });
    return options;
  }, [projectBinRows]);
  const isLiveEquipmentLeftDockMode = useMemo(
    () => !!String(liveEquipmentDrawerOverlayId || "").trim(),
    [liveEquipmentDrawerOverlayId]
  );
  const liveEquipmentDrawerEntries = useMemo(() => {
    if (!isLiveEquipmentLeftDockMode) return [];
    return liveEquipmentOverlays;
  }, [isLiveEquipmentLeftDockMode, liveEquipmentOverlays]);
  const liveEquipmentDockEntries = useMemo(() => {
    if (isLiveEquipmentLeftDockMode) return [];
    return liveEquipmentOverlays;
  }, [isLiveEquipmentLeftDockMode, liveEquipmentOverlays]);
  const liveEquipmentTopDockEntries = useMemo(
    () =>
      liveEquipmentDockEntries.filter(
        (entry) =>
          !liveEquipmentFloatingById[String(entry?.overlay?.id || "")] &&
          liveEquipmentDockSideById[String(entry?.overlay?.id || "")] === "top"
      ),
    [liveEquipmentDockEntries, liveEquipmentDockSideById, liveEquipmentFloatingById]
  );
  const liveEquipmentBottomDockEntries = useMemo(
    () =>
      liveEquipmentDockEntries.filter(
        (entry) =>
          !liveEquipmentFloatingById[String(entry?.overlay?.id || "")] &&
          liveEquipmentDockSideById[String(entry?.overlay?.id || "")] !== "top"
      ),
    [liveEquipmentDockEntries, liveEquipmentDockSideById, liveEquipmentFloatingById]
  );
  const liveEquipmentFloatingEntries = useMemo(
    () =>
      liveEquipmentDockEntries.filter(
        (entry) => !!liveEquipmentFloatingById[String(entry?.overlay?.id || "")]
      ),
    [liveEquipmentDockEntries, liveEquipmentFloatingById]
  );
  const liveEquipmentConnectorLines = useMemo(() => {
    if (!isLiveMode || !svgRef.current || !liveEquipmentDockEntries.length) return [];
    const svgRect = svgRef.current.getBoundingClientRect();
    const z = zoom || 1;
    const lines = [];
    for (const entry of liveEquipmentDockEntries) {
      const overlay = entry?.overlay;
      if (!overlay) continue;
      const lane = liveEquipmentDockSideById[String(overlay.id || "")] === "top" ? "top" : "bottom";
      const isFloating = !!liveEquipmentFloatingById[String(overlay.id || "")];
      const sourceFromTop = lane === "top" && !isFloating;
      let fromX = NaN;
      let fromY = NaN;
      let overlayNode = null;
      try {
        const rawId = String(overlay.id || "");
        const escapedId =
          typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(rawId)
            : rawId.replace(/"/g, '\\"');
        overlayNode = document.querySelector(`[data-overlay-id="${escapedId}"]`);
      } catch {
        overlayNode = null;
      }
      if (overlayNode && typeof overlayNode.getBoundingClientRect === "function") {
        const r = overlayNode.getBoundingClientRect();
        fromX = r.left + r.width / 2;
        fromY = sourceFromTop ? r.top : r.bottom;
      } else {
        const bb = overlayLocalBBox(overlay.id);
        if (!bb) continue;
        const wr = overlayWorldRect(overlay, bb);
        fromX = svgRect.left + (pan?.x || 0) + (wr.x + wr.w / 2) * z;
        fromY = svgRect.top + (pan?.y || 0) + (sourceFromTop ? wr.y : (wr.y + wr.h)) * z;
      }
      const cardEl = liveEquipmentCardRefs.current.get(String(overlay.id || ""));
      if (!cardEl) continue;
      const cardRect = cardEl.getBoundingClientRect();
      const toX = cardRect.left + cardRect.width / 2;
      const toY = isFloating ? cardRect.top + cardRect.height / 2 : lane === "top" ? cardRect.bottom - 2 : cardRect.top + 2;
      if (![fromX, fromY, toX, toY].every((n) => Number.isFinite(n))) continue;
      lines.push({
        id: String(overlay.id || ""),
        fromX,
        fromY,
        toX,
        toY,
      });
    }
    return lines;
  }, [isLiveMode, liveEquipmentDockEntries, liveEquipmentDockSideById, liveEquipmentFloatingById, pan, zoom, liveEquipmentDockTick]);

  const svgTagGroupMenuOptions = useMemo(() => {
    const options = [{ value: "", label: "Select tag group" }];
    const seen = new Set();
    (opcTags || []).forEach((tag) => {
      const topic = normalizeTagValue(tag?.topic || "Default") || "Default";
      const explicitGroup = normalizeTagValue(tag?.groupName || "");
      const rawPath = normalizeTagValue(tag?.tagPath || tag?.name || "");
      const inferredGroup =
        !explicitGroup && rawPath.includes(".")
          ? normalizeTagValue(rawPath.slice(0, rawPath.indexOf(".")))
          : "";
      const group = explicitGroup || inferredGroup;
      if (!group) return;
      const value = `${topic}.${group}`;
      const dedupe = value.toLowerCase();
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      options.push({ value, label: group, group: topic });
    });

    const currentOverlay =
      selectedOverlayIds.length === 1 && selectedIds.length === 0
        ? svgOverlays.find((o) => o.id === selectedOverlayIds[0]) || null
        : null;
    const current = normalizeTagValue(currentOverlay?.tagPath || "");
    if (current && !options.some((opt) => opt.value === current)) {
      options.push({ value: current, label: current, group: "Custom" });
    }
    return options;
  }, [opcTags, selectedOverlayIds, selectedIds, svgOverlays]);


  const PAN_SPEED = 0.05; // ?? adjust this to taste

  const svgTagGroupMenuFilteredOptions = useMemo(() => {
    const q = normalizeTagValue(contextSvgTagQuery).toLowerCase();
    if (!q) return svgTagGroupMenuOptions;

    const filtered = svgTagGroupMenuOptions.filter((opt) =>
      `${opt?.group || ""} ${opt?.label || ""} ${opt?.value || ""}`.toLowerCase().includes(q)
    );

    const currentOverlay =
      selectedOverlayIds.length === 1 && selectedIds.length === 0
        ? svgOverlays.find((o) => o.id === selectedOverlayIds[0]) || null
        : null;
    const current = normalizeTagValue(currentOverlay?.tagPath || "");
    if (current && !filtered.some((opt) => opt.value === current)) {
      const selected = svgTagGroupMenuOptions.find((opt) => opt.value === current);
      if (selected) return [selected, ...filtered];
    }
    return filtered;
  }, [
    contextSvgTagQuery,
    selectedOverlayIds,
    selectedIds,
    svgOverlays,
    svgTagGroupMenuOptions,
  ]);

  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { overlaysRef.current = svgOverlays; }, [svgOverlays]);
  useEffect(() => { selPolyRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { selOverRef.current = selectedOverlayIds; }, [selectedOverlayIds]);
  useEffect(() => {
    if (selectionMode === "svg" && selectedIds.length) {
      setSelectedIds([]);
      return;
    }
    if (selectionMode === "polyline" && selectedOverlayIds.length) {
      setSelectedOverlayIds([]);
    }
  }, [selectionMode, selectedIds, selectedOverlayIds]);
  useEffect(() => {
    setSvgOverlays((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      let changed = false;
      const next = list.map((o) => {
        if (!isConveyorScrewOverlay(o)) return o;
        const sx = overlayScaleX(o);
        const sy = overlayScaleY(o);
        if (Math.abs(sx - sy) < 1e-6) return o;
        changed = true;
        const uniform = Math.max(sx, sy, 0.05);
        return { ...o, scale: uniform, scaleX: uniform, scaleY: uniform };
      });
      if (!changed) return prev;
      overlaysRef.current = next;
      return next;
    });
  }, [svgOverlays]);
  useEffect(() => { duplicateOffsetRef.current = Number(duplicateOffset) || 0; }, [duplicateOffset]);
  useEffect(() => {
    if (!selectedSegment) return;
    if (!selectedIds.includes(selectedSegment.id) || editingId !== selectedSegment.id) {
      setSelectedSegment(null);
    }
  }, [selectedIds, editingId, selectedSegment]);

  // ---- Project file handle (for Save / Save As) ----
  const projectHandleRef = useRef(null);

  function normalizeScreenAutoFitMode(value, fallback = "content") {
    const v = String(value || "").trim().toLowerCase();
    if (v === "off" || v === "none") return "off";
    if (v === "height") return "height";
    if (v === "canvas" || v === "contain") return "contain";
    if (v === "content") return "content";
    return String(fallback || "content");
  }

  function normalizeScreenPayload(screen, fallback = {}) {
    const name = String(screen?.name || fallback?.name || "Screen 1").trim() || "Screen 1";
    const pan =
      screen?.pan && Number.isFinite(screen.pan.x) && Number.isFinite(screen.pan.y)
        ? { x: screen.pan.x, y: screen.pan.y }
        : fallback?.pan && Number.isFinite(fallback.pan.x) && Number.isFinite(fallback.pan.y)
        ? { x: fallback.pan.x, y: fallback.pan.y }
        : { x: 0, y: 0 };
    const zoom = Number.isFinite(screen?.zoom) ? screen.zoom : Number.isFinite(fallback?.zoom) ? fallback.zoom : 1;
    const designPan =
      screen?.designPan && Number.isFinite(screen.designPan.x) && Number.isFinite(screen.designPan.y)
        ? { x: screen.designPan.x, y: screen.designPan.y }
        : fallback?.designPan && Number.isFinite(fallback.designPan.x) && Number.isFinite(fallback.designPan.y)
        ? { x: fallback.designPan.x, y: fallback.designPan.y }
        : pan;
    const designZoom = Number.isFinite(screen?.designZoom)
      ? screen.designZoom
      : Number.isFinite(fallback?.designZoom)
      ? fallback.designZoom
      : zoom;
    const scroll =
      screen?.scroll && Number.isFinite(screen.scroll.x) && Number.isFinite(screen.scroll.y)
        ? { x: screen.scroll.x, y: screen.scroll.y }
        : fallback?.scroll && Number.isFinite(fallback.scroll.x) && Number.isFinite(fallback.scroll.y)
        ? { x: fallback.scroll.x, y: fallback.scroll.y }
        : { x: 0, y: 0 };
    const designScroll =
      screen?.designScroll && Number.isFinite(screen.designScroll.x) && Number.isFinite(screen.designScroll.y)
        ? { x: screen.designScroll.x, y: screen.designScroll.y }
        : fallback?.designScroll && Number.isFinite(fallback.designScroll.x) && Number.isFinite(fallback.designScroll.y)
        ? { x: fallback.designScroll.x, y: fallback.designScroll.y }
        : scroll;
    const routeId = String(screen?.routeId ?? fallback?.routeId ?? "").trim();
    return {
      id: String(screen?.id || fallback?.id || uid()),
      name,
      shapes: Array.isArray(screen?.shapes) ? screen.shapes : Array.isArray(fallback?.shapes) ? fallback.shapes : [],
      svgOverlays: Array.isArray(screen?.svgOverlays)
        ? screen.svgOverlays
        : Array.isArray(fallback?.svgOverlays)
        ? fallback.svgOverlays
        : [],
      vbW: Number.isFinite(screen?.vbW) ? screen.vbW : Number.isFinite(fallback?.vbW) ? fallback.vbW : 1600,
      vbH: Number.isFinite(screen?.vbH) ? screen.vbH : Number.isFinite(fallback?.vbH) ? fallback.vbH : 900,
      pan,
      zoom,
      designPan,
      designZoom,
      scroll,
      designScroll,
      showInLiveMenu:
        typeof screen?.showInLiveMenu === "boolean"
          ? screen.showInLiveMenu
          : typeof fallback?.showInLiveMenu === "boolean"
          ? fallback.showInLiveMenu
          : true,
      routeId,
      autoFitMode: normalizeScreenAutoFitMode(
        screen?.autoFitMode,
        normalizeScreenAutoFitMode(fallback?.autoFitMode, "content")
      ),
      zoomByViewport: normalizeZoomByViewportMap(screen?.zoomByViewport || fallback?.zoomByViewport),
    };
  }

  function commitCurrentScreenState(sourceScreens = screensRef.current) {
    const list = Array.isArray(sourceScreens) ? sourceScreens.map((s) => normalizeScreenPayload(s)) : [];
    const fallbackId = list[0]?.id || `screen-${Date.now()}`;
    const currentId = String(activeScreenIdRef.current || fallbackId);
    const currentScreen = list.find((s) => s.id === currentId) || {};
    const isDesignMode = normalizeProjectMode(projectModeRef.current) === "design";
    const designPan =
      isDesignMode
        ? (panRef.current && Number.isFinite(panRef.current.x) && Number.isFinite(panRef.current.y)
            ? { x: panRef.current.x, y: panRef.current.y }
            : { x: 0, y: 0 })
        : (currentScreen?.designPan && Number.isFinite(currentScreen.designPan.x) && Number.isFinite(currentScreen.designPan.y)
            ? { x: currentScreen.designPan.x, y: currentScreen.designPan.y }
            : (currentScreen?.pan && Number.isFinite(currentScreen.pan.x) && Number.isFinite(currentScreen.pan.y)
                ? { x: currentScreen.pan.x, y: currentScreen.pan.y }
                : { x: 0, y: 0 }));
    const designZoom =
      isDesignMode
        ? (Number.isFinite(zoomRef.current) ? zoomRef.current : 1)
        : (Number.isFinite(currentScreen?.designZoom)
            ? currentScreen.designZoom
            : (Number.isFinite(currentScreen?.zoom) ? currentScreen.zoom : 1));
    const currentScroll =
      canvasViewportScrollRef.current &&
      Number.isFinite(canvasViewportScrollRef.current.x) &&
      Number.isFinite(canvasViewportScrollRef.current.y)
        ? { x: canvasViewportScrollRef.current.x, y: canvasViewportScrollRef.current.y }
        : { x: 0, y: 0 };
    const designScroll =
      isDesignMode
        ? currentScroll
        : (currentScreen?.designScroll && Number.isFinite(currentScreen.designScroll.x) && Number.isFinite(currentScreen.designScroll.y)
            ? { x: currentScreen.designScroll.x, y: currentScreen.designScroll.y }
            : (currentScreen?.scroll && Number.isFinite(currentScreen.scroll.x) && Number.isFinite(currentScreen.scroll.y)
                ? { x: currentScreen.scroll.x, y: currentScreen.scroll.y }
                : { x: 0, y: 0 }));
    const rect = svgRef.current?.getBoundingClientRect?.();
    const viewportKey = getViewportZoomKey(rect);
    const zoomByViewport = normalizeZoomByViewportMap(currentScreen?.zoomByViewport);
    if (viewportKey) {
      zoomByViewport[viewportKey] = Number.isFinite(Number(zoomRef.current))
        ? Number(zoomRef.current)
        : Number.isFinite(Number(currentScreen?.zoom))
        ? Number(currentScreen.zoom)
        : 1;
    }
    const snapshot = normalizeScreenPayload(
      {
        id: currentId,
        name: screenNameRef.current,
        shapes: shapesRef.current ?? [],
        svgOverlays: overlaysRef.current ?? [],
        vbW: vbWRef.current,
        vbH: vbHRef.current,
        pan: panRef.current,
        zoom: zoomRef.current,
        designPan,
        designZoom,
        scroll: currentScroll,
        designScroll,
        zoomByViewport,
      },
      {
        ...currentScreen,
        id: currentId,
        name: screenNameRef.current || currentScreen.name || "Screen 1",
      }
    );
    const idx = list.findIndex((s) => s.id === currentId);
    if (idx >= 0) list[idx] = snapshot;
    else list.push(snapshot);
    return { list, currentId };
  }

  function hydrateScreenState(screen) {
    const next = normalizeScreenPayload(screen);
    const rect = svgRef.current?.getBoundingClientRect?.();
    const projectId =
      normalizeTagValue(activeProjectIdRef.current || activeProjectId || readStoredActiveProjectId()) || "";
    const viewportKey = getViewportZoomKey(rect);
    const mappedZoom = viewportKey ? resolveZoomForViewportMap(next?.zoomByViewport, viewportKey) : NaN;
    const cache = readViewportZoomCache();
    const cacheLastKey = getViewportZoomCacheLastKey(projectId, String(next.id || ""));
    const cachedLastZoom = cacheLastKey ? Number(cache[cacheLastKey]) : NaN;
    const cachedZoom = resolveZoomFromViewportCache(
      cache,
      projectId,
      String(next.id || ""),
      viewportKey
    );
    const resolvedZoom = Number.isFinite(cachedLastZoom)
      ? cachedLastZoom
      : Number.isFinite(mappedZoom)
      ? mappedZoom
      : Number.isFinite(cachedZoom)
      ? cachedZoom
      : Number.isFinite(Number(next?.designZoom))
      ? Number(next.designZoom)
      : Number.isFinite(Number(next?.zoom))
      ? Number(next.zoom)
      : 1;
    if (viewportKey) {
      next.zoomByViewport = normalizeZoomByViewportMap(next.zoomByViewport);
      next.zoomByViewport[viewportKey] = resolvedZoom;
    }
    activeScreenIdRef.current = next.id;
    screenNameRef.current = next.name;
    shapesRef.current = next.shapes;
    overlaysRef.current = next.svgOverlays;
    vbWRef.current = next.vbW;
    vbHRef.current = next.vbH;
    const resolvedPan =
      next.designPan && Number.isFinite(next.designPan.x) && Number.isFinite(next.designPan.y)
        ? { x: next.designPan.x, y: next.designPan.y }
        : { x: 0, y: 0 };
    panRef.current = resolvedPan;
    zoomRef.current = resolvedZoom;
    setActiveScreenId(next.id);
    setScreenName(next.name);
    setShapes(next.shapes);
    setSvgOverlays(next.svgOverlays);
    setVbW(next.vbW);
    setVbH(next.vbH);
    setPan(resolvedPan);
    setZoom(resolvedZoom);
    if (projectId && viewportKey) {
      const nextCache = readViewportZoomCache();
      nextCache[`${projectId}|${String(next.id || "")}|${viewportKey}`] = resolvedZoom;
      const lastKey = getViewportZoomCacheLastKey(projectId, String(next.id || ""));
      if (lastKey) nextCache[lastKey] = resolvedZoom;
      writeViewportZoomCache(nextCache);
    }
    const nextScroll =
      next.designScroll && Number.isFinite(next.designScroll.x) && Number.isFinite(next.designScroll.y)
        ? { x: next.designScroll.x, y: next.designScroll.y }
        : { x: 0, y: 0 };
    canvasViewportScrollRef.current = nextScroll;
    setCanvasViewportScrollTarget(nextScroll);
  }


  function getProjectPayload() {
    const committed = commitCurrentScreenState();
    const effectiveScreenId = committed.currentId || committed.list[0]?.id || "";
    const normalizedMenuGroups = normalizeLiveMenuGroups(liveMenuGroupsRef.current, committed.list);
    return {
      version: 1,
      name: projectName || "Untitled",
      canvasBackground: normalizeProjectCanvasBackground(projectCanvasBackground),
      plcs: normalizeProjectPlcEntries(projectPlcs, { includeRawText: true }),
      activeScreenId: effectiveScreenId,
      projectMode: normalizeProjectMode(projectModeRef.current),
      uiPreferences: normalizeProjectUiPreferences(
        {
          showGrid,
          showTagPaths,
          showRulers,
          liveMenuCollapsed,
          liveMenuExpandedWidth,
        },
        {
          showGrid: true,
          showTagPaths: false,
          showRulers: true,
          liveMenuCollapsed: false,
          liveMenuExpandedWidth: LIVE_MENU_EXPANDED_WIDTH_DEFAULT,
        }
      ),
      screens: committed.list,
      liveMenuGroups: normalizedMenuGroups,
      savedAt: new Date().toISOString(),

      shapes: shapesRef.current ?? [],
      svgOverlays: overlaysRef.current ?? [],

      vbW: vbWRef.current,
      vbH: vbHRef.current,
      pan: panRef.current,
      zoom: zoomRef.current,
    };
  }

  function getProjectPayloadFromRefs() {
    const committed = commitCurrentScreenState(screensRef.current);
    const effectiveScreenId = committed.currentId || committed.list[0]?.id || "";
    const normalizedMenuGroups = normalizeLiveMenuGroups(liveMenuGroupsRef.current, committed.list);
    return {
      version: 1,
      name: projectNameRef.current || "Untitled",
      canvasBackground: normalizeProjectCanvasBackground(projectCanvasBackgroundRef.current),
      plcs: normalizeProjectPlcEntries(projectPlcsRef.current, { includeRawText: true }),
      activeScreenId: effectiveScreenId,
      projectMode: normalizeProjectMode(projectModeRef.current),
      uiPreferences: normalizeProjectUiPreferences(
        {
          showGrid: showGridRef.current,
          showTagPaths: showTagPathsRef.current,
          showRulers: showRulersRef.current,
          liveMenuCollapsed: liveMenuCollapsedRef.current,
          liveMenuExpandedWidth: liveMenuExpandedWidthRef.current,
        },
        {
          showGrid: true,
          showTagPaths: false,
          showRulers: true,
          liveMenuCollapsed: false,
          liveMenuExpandedWidth: LIVE_MENU_EXPANDED_WIDTH_DEFAULT,
        }
      ),
      screens: committed.list,
      liveMenuGroups: normalizedMenuGroups,
      savedAt: new Date().toISOString(),
      shapes: shapesRef.current ?? [],
      svgOverlays: overlaysRef.current ?? [],
      vbW: vbWRef.current,
      vbH: vbHRef.current,
      pan: panRef.current,
      zoom: zoomRef.current,
    };
  }

  function projectPayloadSignature(payload) {
    if (!payload || typeof payload !== "object") return "";
    const normalizedScreens = Array.isArray(payload.screens)
      ? payload.screens.map((s) => normalizeScreenPayload(s))
      : [];
    const compact = {
      name: payload.name || "",
      canvasBackground: normalizeProjectCanvasBackground(payload.canvasBackground),
      plcs: normalizeProjectPlcEntries(payload.plcs || payload.plcLibrary, { includeRawText: false }),
      activeScreenId: payload.activeScreenId || "",
      projectMode: normalizeProjectMode(payload.projectMode),
      uiPreferences: normalizeProjectUiPreferences(payload.uiPreferences || payload.ui, {
        showGrid: true,
        showTagPaths: false,
        showRulers: true,
        liveMenuCollapsed: false,
        liveMenuExpandedWidth: LIVE_MENU_EXPANDED_WIDTH_DEFAULT,
      }),
      screens: normalizedScreens,
      liveMenuGroups: normalizeLiveMenuGroups(payload.liveMenuGroups, normalizedScreens),
      vbW: payload.vbW,
      vbH: payload.vbH,
      pan: payload.pan || { x: 0, y: 0 },
      zoom: payload.zoom,
      shapes: Array.isArray(payload.shapes) ? payload.shapes : [],
      svgOverlays: Array.isArray(payload.svgOverlays) ? payload.svgOverlays : [],
    };
    try {
      return JSON.stringify(compact);
    } catch {
      return "";
    }
  }

  function applyRemoteProjectPayload(data, options = {}) {
    setProjectCanvasBackground(
      normalizeProjectCanvasBackground(data?.canvasBackground || data?.canvasBackgroundByTheme)
    );
    setProjectPlcs(normalizeProjectPlcEntries(data?.plcs || data?.plcLibrary));
    const uiPreferences = normalizeProjectUiPreferences(data?.uiPreferences || data?.ui, {
      showGrid: showGridRef.current,
      showTagPaths: showTagPathsRef.current,
      showRulers: showRulersRef.current,
      liveMenuCollapsed: liveMenuCollapsedRef.current,
      liveMenuExpandedWidth: liveMenuExpandedWidthRef.current,
    });
    setShowGrid(uiPreferences.showGrid);
    setShowTagPaths(uiPreferences.showTagPaths);
    setShowRulers(uiPreferences.showRulers);
    setLiveMenuCollapsed(uiPreferences.liveMenuCollapsed);
    setLiveMenuExpandedWidth(uiPreferences.liveMenuExpandedWidth);
    const fallbackScreen = normalizeScreenPayload(
      {
        id: data?.activeScreenId || "screen-1",
        name: data?.screenName || "Screen 1",
        shapes: Array.isArray(data?.shapes) ? data.shapes : [],
        svgOverlays: Array.isArray(data?.svgOverlays) ? data.svgOverlays : [],
        vbW: data?.vbW,
        vbH: data?.vbH,
        pan: data?.pan,
        zoom: data?.zoom,
      },
      { id: "screen-1", name: "Screen 1" }
    );
    const incoming = Array.isArray(data?.screens) && data.screens.length
      ? data.screens.map((s) => normalizeScreenPayload(s))
      : [fallbackScreen];
    const nextActiveId = String(data?.activeScreenId || incoming[0]?.id || "screen-1");
    const active = incoming.find((s) => s.id === nextActiveId) || incoming[0];
    if (Object.prototype.hasOwnProperty.call(data || {}, "projectMode")) {
      setProjectMode(normalizeProjectMode(data?.projectMode));
    } else {
      setProjectMode(readStoredProjectMode(options?.projectId || activeProjectIdRef.current));
    }
    const normalizedGroups = normalizeLiveMenuGroups(data?.liveMenuGroups, incoming);
    liveMenuGroupsRef.current = normalizedGroups;
    setLiveMenuGroups(normalizedGroups);
    setScreens(incoming);
    hydrateScreenState(active);
    projectHydrationReadyRef.current = true;
  }

  function applyProjectPayload(data, options = {}) {
    setProjectCanvasBackground(
      normalizeProjectCanvasBackground(data?.canvasBackground || data?.canvasBackgroundByTheme)
    );
    setProjectPlcs(normalizeProjectPlcEntries(data?.plcs || data?.plcLibrary));
    const uiPreferences = normalizeProjectUiPreferences(data?.uiPreferences || data?.ui, {
      showGrid: showGridRef.current,
      showTagPaths: showTagPathsRef.current,
      showRulers: showRulersRef.current,
      liveMenuCollapsed: liveMenuCollapsedRef.current,
      liveMenuExpandedWidth: liveMenuExpandedWidthRef.current,
    });
    setShowGrid(uiPreferences.showGrid);
    setShowTagPaths(uiPreferences.showTagPaths);
    setShowRulers(uiPreferences.showRulers);
    setLiveMenuCollapsed(uiPreferences.liveMenuCollapsed);
    setLiveMenuExpandedWidth(uiPreferences.liveMenuExpandedWidth);
    const fallbackScreen = normalizeScreenPayload(
      {
        id: data?.activeScreenId || "screen-1",
        name: data?.screenName || "Screen 1",
        shapes: Array.isArray(data?.shapes) ? data.shapes : [],
        svgOverlays: Array.isArray(data?.svgOverlays) ? data.svgOverlays : [],
        vbW: data?.vbW,
        vbH: data?.vbH,
        pan: data?.pan,
        zoom: data?.zoom,
      },
      { id: "screen-1", name: "Screen 1" }
    );
    const incoming = Array.isArray(data?.screens) && data.screens.length
      ? data.screens.map((s) => normalizeScreenPayload(s))
      : [fallbackScreen];
    const nextActiveId = String(data?.activeScreenId || incoming[0]?.id || "screen-1");
    const active = incoming.find((s) => s.id === nextActiveId) || incoming[0];
    if (Object.prototype.hasOwnProperty.call(data || {}, "projectMode")) {
      setProjectMode(normalizeProjectMode(data?.projectMode));
    } else {
      setProjectMode(readStoredProjectMode(options?.projectId || activeProjectIdRef.current));
    }
    const normalizedGroups = normalizeLiveMenuGroups(data?.liveMenuGroups, incoming);
    liveMenuGroupsRef.current = normalizedGroups;
    setLiveMenuGroups(normalizedGroups);

    resetHistory();
    setScreens(incoming);
    hydrateScreenState(active);

    setSelectedIds([]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setDrawing(null);
    setDragAll(null);
    setDragHandle(null);
    setOverlayResize(null);
    setMarquee(null);
    setImportAnchor(null);
    projectHydrationReadyRef.current = true;
  }

  function downloadTextFile(filename, text, mime = "application/json;charset=utf-8") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function saveProjectAs() {
    const payload = getProjectPayload();
    const text = JSON.stringify(payload, null, 2);

    // ? Best: overwrite same file via File System Access API
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${(projectName || "project").replace(/[^\w\- ]+/g, "").trim() || "project"}.json`,
        types: [
          {
            description: "Project JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });

      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();

      projectHandleRef.current = handle;
      // update name from file (nice UX)
      if (handle?.name) setProjectName(handle.name.replace(/\.json$/i, ""));
      return;
    }

    // ? Fallback: browser can't overwrite ? downloads a new file
    downloadTextFile(`${projectName || "project"}.json`, text);
  }

  async function saveProject() {
    const payload = getProjectPayload();
    const text = JSON.stringify(payload, null, 2);

    // ? If we already have a handle, overwrite the same file
    const handle = projectHandleRef.current;
    if (handle?.createWritable) {
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return;
    }

    // otherwise do Save As
    await saveProjectAs();
  }

  async function loadProjectViaPicker() {
    // ? Best: File System Access API open picker
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Project JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });

      const file = await handle.getFile();
      const text = await file.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        alert("Invalid JSON file.");
        return;
      }

      applyProjectPayload(data);

      // ? remember this file so Save overwrites it next time
      projectHandleRef.current = handle;
      if (handle?.name) setProjectName(handle.name.replace(/\.json$/i, ""));
      return;
    }

    // ? Fallback: trigger hidden <input type=file> (your existing projectFileRef approach)
    projectFileRef.current?.click();
  }


  useEffect(() => {
    if (!user?.id) {
      setProjects([]);
      setActiveProjectId("");
      setProjectIdentityReady(true);
      return;
    }
    let alive = true;
    let bootstrappedProject = false;
    async function loadProjects() {
      try {
        const data = await listProjects();
        if (!alive) return;
        const list = Array.isArray(data.projects) ? data.projects : [];
        setProjects(list);
        if (!bootstrappedProject && list.length) {
          const stored = localStorage.getItem("vizi_active_project_id") || "";
          const preferred = list.find((p) => p?.id === stored) || list[0];
          if (preferred?.id) {
            bootstrappedProject = true;
            setProjectIdentityReady(false);
            setActiveProjectId(preferred.id);
            openProjectFromDb(preferred.id);
          }
        } else if (!bootstrappedProject && !list.length) {
          bootstrappedProject = true;
          setProjectIdentityReady(true);
          setTimeout(() => {
            saveProjectToDb({ silent: true });
          }, 0);
        }
      } catch {
        // ignore
      }
    }
    loadProjects();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      loadProjects();
    }, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [user?.id]);

  useEffect(() => {
    let alive = true;
    let inFlight = false;

    const filterRowsForActiveProject = (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      const pid = normalizeTagValue(activeProjectId);
      if (!pid) return list;
      const hasProjectField = list.some(
        (row) =>
          row &&
          typeof row === "object" &&
          (Object.prototype.hasOwnProperty.call(row, "project_id") ||
            Object.prototype.hasOwnProperty.call(row, "projectId"))
      );
      if (!hasProjectField) return list;
      return list.filter((row) => {
        const rowPid = normalizeTagValue(row?.project_id ?? row?.projectId ?? "");
        return rowPid === pid;
      });
    };

    async function loadProjectRoutes() {
      if (!activeProjectId) {
        if (alive) setProjectRouteRows([]);
        return;
      }
      try {
        const pid = normalizeTagValue(activeProjectId);
        const data = await listRoutesByProject(pid, 2000);
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        if (rows.length > 0) {
          if (alive) setProjectRouteRows(filterRowsForActiveProject(rows));
          return;
        }

        // Fallback for schemas/endpoints that do not support project_id filtering.
        const allData = await listAllRoutes(2000);
        const allRows = Array.isArray(allData?.rows) ? allData.rows : [];
        if (alive) setProjectRouteRows(filterRowsForActiveProject(allRows));
      } catch {
        if (alive) setProjectRouteRows([]);
      }
    }

    loadProjectRoutes();
    return () => {
      alive = false;
    };
  }, [activeProjectId]);

  useEffect(() => {
    let alive = true;
    let inFlight = false;

    const filterRowsForActiveProject = (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      const pid = normalizeTagValue(activeProjectId);
      if (!pid) return list;
      const hasProjectField = list.some(
        (row) =>
          row &&
          typeof row === "object" &&
          (Object.prototype.hasOwnProperty.call(row, "project_id") ||
            Object.prototype.hasOwnProperty.call(row, "projectId"))
      );
      if (!hasProjectField) return list;
      const scoped = list.filter((row) => {
        const rowPid = normalizeTagValue(row?.project_id ?? row?.projectId ?? "");
        return rowPid === pid;
      });
      if (scoped.length) return scoped;
      const globalRows = list.filter((row) => {
        const rowPid = normalizeTagValue(row?.project_id ?? row?.projectId ?? "");
        return !rowPid;
      });
      return globalRows.length ? globalRows : list;
    };

    async function loadProjectBins() {
      if (!activeProjectId) {
        if (alive) setProjectBinRows([]);
        if (alive) setProjectBinTableName("");
        return;
      }
      const pid = encodeURIComponent(normalizeTagValue(activeProjectId));
      const query = `?limit=2000&project_id=${pid}`;
      const candidateTables = ["bin"];
      for (const tableName of candidateTables) {
        try {
          const data = await listTableRecords(tableName, query);
          const rows = Array.isArray(data?.rows) ? data.rows : [];
          if (rows.length > 0) {
            if (alive) {
              setProjectBinRows(filterRowsForActiveProject(rows));
              setProjectBinTableName(tableName);
            }
            return;
          }
          const allData = await listTableRecordsUnscoped(tableName, 2000);
          const allRows = Array.isArray(allData?.rows) ? allData.rows : [];
          if (allRows.length > 0) {
            if (alive) {
              setProjectBinRows(filterRowsForActiveProject(allRows));
              setProjectBinTableName(tableName);
            }
            return;
          }
        } catch {
          // try fallback table name
        }
      }
      if (alive) {
        setProjectBinRows([]);
        setProjectBinTableName("");
      }
    }

    const refreshProjectBins = async () => {
      if (inFlight || !alive) return;
      inFlight = true;
      try {
        await loadProjectBins();
      } finally {
        inFlight = false;
      }
    };

    void refreshProjectBins();
    const pollMs = isPageVisible ? (isLiveMode ? 2500 : 6000) : 12000;
    const id = window.setInterval(() => {
      void refreshProjectBins();
    }, pollMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [activeProjectId, isLiveMode, isPageVisible]);

  useEffect(() => {
    let alive = true;
    let inFlight = false;

    const filterRowsForActiveProject = (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      const pid = normalizeTagValue(activeProjectId);
      if (!pid) return list;
      const hasProjectField = list.some(
        (row) =>
          row &&
          typeof row === "object" &&
          (Object.prototype.hasOwnProperty.call(row, "project_id") ||
            Object.prototype.hasOwnProperty.call(row, "projectId"))
      );
      if (!hasProjectField) return list;
      return list.filter((row) => {
        const rowPid = normalizeTagValue(row?.project_id ?? row?.projectId ?? "");
        return rowPid === pid;
      });
    };

    async function loadProjectProducts() {
      const pidRaw = normalizeTagValue(activeProjectId);
      const pid = encodeURIComponent(pidRaw);
      const scopedQuery = `?limit=2000&project_id=${pid}`;
      const unscopedQuery = `?limit=2000`;
      const candidateTables = ["product"];
      for (const tableName of candidateTables) {
        try {
          const data = await listTableRecords(tableName, pidRaw ? scopedQuery : unscopedQuery);
          const rows = Array.isArray(data?.rows) ? data.rows : [];
          if (rows.length > 0) {
            if (alive) {
              setProjectProductRows(filterRowsForActiveProject(rows));
              setProjectProductTableName(tableName);
            }
            return;
          }
          const allData = await listTableRecordsUnscoped(tableName, 2000);
          const allRows = Array.isArray(allData?.rows) ? allData.rows : [];
          if (allRows.length > 0) {
            if (alive) {
              setProjectProductRows(filterRowsForActiveProject(allRows));
              setProjectProductTableName(tableName);
            }
            return;
          }
        } catch {
          // try fallback table name
        }
      }
      if (alive) {
        setProjectProductRows([]);
        setProjectProductTableName("");
      }
    }

    const refreshProjectProducts = async () => {
      if (inFlight || !alive) return;
      inFlight = true;
      try {
        await loadProjectProducts();
      } finally {
        inFlight = false;
      }
    };

    void refreshProjectProducts();
    const pollMs = isPageVisible ? (isLiveMode ? 2500 : 6000) : 12000;
    const id = window.setInterval(() => {
      void refreshProjectProducts();
    }, pollMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [activeProjectId, isLiveMode, isPageVisible]);

  useEffect(() => {
    let alive = true;
    let inFlight = false;

    const filterRowsForActiveProject = (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      const pid = normalizeTagValue(activeProjectId);
      if (!pid) return list;
      const hasProjectField = list.some(
        (row) =>
          row &&
          typeof row === "object" &&
          (Object.prototype.hasOwnProperty.call(row, "project_id") ||
            Object.prototype.hasOwnProperty.call(row, "projectId"))
      );
      if (!hasProjectField) return list;
      return list.filter((row) => {
        const rowPid = normalizeTagValue(row?.project_id ?? row?.projectId ?? "");
        return rowPid === pid;
      });
    };

    async function loadProjectEquipment() {
      if (!activeProjectId) {
        if (alive) setProjectEquipmentRows([]);
        return;
      }
      try {
        const pid = normalizeTagValue(activeProjectId);
        const data = await listEquipmentByProject(pid, 2000);
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        if (rows.length > 0) {
          if (alive) setProjectEquipmentRows(filterRowsForActiveProject(rows));
          return;
        }

        const allData = await listAllEquipment(2000);
        const allRows = Array.isArray(allData?.rows) ? allData.rows : [];
        if (alive) setProjectEquipmentRows(filterRowsForActiveProject(allRows));
      } catch {
        if (alive) setProjectEquipmentRows([]);
      }
    }

    const refreshProjectEquipment = async () => {
      if (inFlight || !alive) return;
      inFlight = true;
      try {
        await loadProjectEquipment();
      } finally {
        inFlight = false;
      }
    };

    void refreshProjectEquipment();
    const pollMs = isPageVisible ? (isLiveMode ? 2500 : 6000) : 12000;
    const id = window.setInterval(() => {
      void refreshProjectEquipment();
    }, pollMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [activeProjectId, isLiveMode, isPageVisible]);

  useEffect(() => {
    if (activeProjectId) {
      localStorage.setItem("vizi_active_project_id", activeProjectId);
    } else {
      localStorage.removeItem("vizi_active_project_id");
    }
  }, [activeProjectId]);

  async function saveProjectToDb(options = {}) {
    let retryAfterConflict = null;
    let savedOk = false;
    try {
      const silent = options?.silent === true;
      const keepalive = options?.keepalive === true;
      const skipListReload = options?.skipListReload === true;
      const conflictRetried = options?._conflictRetried === true;
      const teamMerge = options?.teamMerge !== false;
      const ignoreBaseUpdatedAt = options?.ignoreBaseUpdatedAt !== false;
      if (silent && activeProjectId && !projectHydrationReadyRef.current) {
        return false;
      }
      if (projectSaveInFlightRef.current) {
        const nextQueued = {
          ...options,
          silent,
        };
        const prevQueued = queuedSaveAfterFlightRef.current;
        if (!prevQueued) {
          queuedSaveAfterFlightRef.current = nextQueued;
        } else {
          queuedSaveAfterFlightRef.current = {
            ...prevQueued,
            ...nextQueued,
            silent: prevQueued.silent === false || nextQueued.silent === false ? false : true,
            payloadOverride: nextQueued.payloadOverride ?? prevQueued.payloadOverride,
          };
        }
        if (!silent) setProjectStatus("Saving...");
        return false;
      }
      projectSaveInFlightRef.current = true;
      if (!silent) setProjectStatus("");
      const payloadBase = getProjectPayloadFromRefs();
      const override =
        options?.payloadOverride && typeof options.payloadOverride === "object"
          ? options.payloadOverride
          : null;
      const payload = override ? { ...payloadBase, ...override } : payloadBase;
      const trimmedName = String(payload?.name || "").trim();
      const effectiveName = trimmedName || "Untitled";
      if (!trimmedName && projectName !== effectiveName) {
        setProjectName(effectiveName);
      }
      const { ok, status, data } = await upsertProjectWithStatus(
        {
          id: activeProjectId || undefined,
          name: effectiveName,
          data: { ...payload, name: effectiveName },
          baseUpdatedAt: ignoreBaseUpdatedAt ? undefined : (activeProjectUpdatedAtRef.current || undefined),
          teamMerge,
        },
        { keepalive }
      );
      if (!ok) {
        if (status === 409 && String(data?.code || "") === "PROJECT_CONFLICT") {
          const remote = data?.project && typeof data.project === "object" ? data.project : null;
          if (remote?.updated_at) {
            const nextUpdatedAt = String(remote.updated_at);
            activeProjectUpdatedAtRef.current = nextUpdatedAt;
            setActiveProjectUpdatedAt(nextUpdatedAt);
          }
          setActiveProjectUpdatedBy(String(remote?.updated_by_username || ""));
          if (!conflictRetried) {
            retryAfterConflict = {
              ...options,
              _conflictRetried: true,
              teamMerge: true,
              skipListReload: true,
            };
            if (!silent) setProjectStatus("Syncing latest project state...");
            return false;
          }
          if (!silent && !ignoreBaseUpdatedAt) {
            retryAfterConflict = {
              ...options,
              _conflictRetried: true,
              teamMerge: true,
              ignoreBaseUpdatedAt: true,
              skipListReload: true,
            };
            setProjectStatus("Retrying save...");
            return false;
          }
          if (!silent) {
            const by = String(remote?.updated_by_username || "").trim();
            setProjectStatus(
              by
                ? `Save blocked: newer remote changes by ${by}. Reload project to merge.`
                : "Save blocked: newer remote changes detected. Reload project to merge."
            );
          }
          return false;
        }
        throw new Error(data?.error || "Save failed.");
      }
      const next = data.project;
      const localSig = projectPayloadSignature(payload);
      const remoteSig = next?.data ? projectPayloadSignature(next.data) : "";
      lastProjectSignatureRef.current = remoteSig && remoteSig === localSig ? remoteSig : localSig;
      if (next?.id) setActiveProjectId(next.id);
      if (next?.updated_at) {
        const nextUpdatedAt = String(next.updated_at);
        activeProjectUpdatedAtRef.current = nextUpdatedAt;
        setActiveProjectUpdatedAt(nextUpdatedAt);
      }
      setActiveProjectUpdatedBy(String(next?.updated_by_username || ""));
      setLastProjectSaveAt(String(next?.updated_at || new Date().toISOString()));
      setLastProjectSaveKind(silent ? "auto" : "manual");
      setHasPendingAutoSave(
        hasUnsavedProjectChangesFromRefs() ||
          pendingSilentSaveRef.current ||
          !!queuedSaveAfterFlightRef.current
      );
      if (!silent) {
        const by = String(next?.updated_by_username || "").trim();
        setProjectStatus(by ? `Saved (by ${by})` : "Saved");
      }
      clearProjectDraft(next?.id || activeProjectId);
      setShowProjectNameInput(false);
      projectHydrationReadyRef.current = true;
      savedOk = true;
      if (!keepalive && !skipListReload) {
        const payloadList = await listProjects();
        setProjects(payloadList.projects || []);
      }
    } catch (err) {
      const message = err?.message || "Save failed.";
      setProjectStatus(options?.silent ? `Autosave failed: ${message}` : message);
      setHasPendingAutoSave(
        hasUnsavedProjectChangesFromRefs() ||
          pendingSilentSaveRef.current ||
          !!queuedSaveAfterFlightRef.current
      );
      savedOk = false;
    } finally {
      projectSaveInFlightRef.current = false;
      if (retryAfterConflict) {
        setTimeout(() => {
          saveProjectToDb(retryAfterConflict);
        }, 0);
        return savedOk;
      }
      const queued = queuedSaveAfterFlightRef.current;
      if (queued) {
        queuedSaveAfterFlightRef.current = null;
        setTimeout(() => {
          saveProjectToDb(queued);
        }, 0);
      }
    }
    return savedOk;
  }

function flushScheduledProjectSave() {
    if (!pendingSilentSaveRef.current) return;
    if (!projectHydrationReadyRef.current) {
      pendingSilentSaveRef.current = false;
      setHasPendingAutoSave(false);
      return;
    }
    if (projectSaveInFlightRef.current) {
      autoSaveTimerRef.current = setTimeout(flushScheduledProjectSave, 350);
      return;
    }
    pendingSilentSaveRef.current = false;
    saveProjectToDb({ silent: true });
  }

  function hasUnsavedProjectChangesFromRefs() {
    const sig = projectPayloadSignature(getProjectPayloadFromRefs());
    if (!sig) return false;
    return sig !== lastProjectSignatureRef.current;
  }

  function scheduleProjectAutoSave(delayMs = 450) {
    if (!projectHydrationReadyRef.current) return;
    pendingSilentSaveRef.current = true;
    setHasPendingAutoSave(true);
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(flushScheduledProjectSave, delayMs);
  }

  function syncProjectDuringDrag() {
    if (!activeProjectIdRef.current) return;
    if (!projectHydrationReadyRef.current) return;
    liveDragSyncQueuedRef.current = true;
    if (liveDragSyncTimerRef.current) return;
    liveDragSyncTimerRef.current = setTimeout(() => {
      liveDragSyncTimerRef.current = null;
      if (!liveDragSyncQueuedRef.current) return;
      liveDragSyncQueuedRef.current = false;
      if (!activeProjectIdRef.current) return;
      if (!projectHydrationReadyRef.current) return;
      if (projectSaveInFlightRef.current) {
        syncProjectDuringDrag();
        return;
      }
      const now = Date.now();
      const lastAt = Number(liveDragSyncRef.current?.at || 0);
      if (now - lastAt < 260) {
        syncProjectDuringDrag();
        return;
      }
      liveDragSyncRef.current = { at: now };
      saveProjectToDb({ silent: true, keepalive: true, skipListReload: true, teamMerge: true });
    }, 40);
  }

  useEffect(
    () => () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (liveDragSyncTimerRef.current) clearTimeout(liveDragSyncTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const flushForLifecycle = () => {
      if (projectSaveInFlightRef.current) return;
      if (!hasUnsavedProjectChangesFromRefs()) return;
      saveProjectToDb({ silent: true, keepalive: true, skipListReload: true });
    };
    const onPageHide = () => flushForLifecycle();
    const onVisibilityChange = () => {
      if (document.hidden) flushForLifecycle();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  async function openProjectFromDb(id) {
    if (!id) return;
    try {
      setProjectIdentityReady(false);
      projectHydrationReadyRef.current = false;
      setProjectStatus("");
      const data = await getProjectById(id);
      applyProjectPayload(data?.data || {}, { projectId: data?.id || id });
      setProjectName(data?.name || "Untitled");
      setActiveProjectId(data?.id || "");
      {
        const nextUpdatedAt = String(data?.updated_at || "");
        activeProjectUpdatedAtRef.current = nextUpdatedAt;
        setActiveProjectUpdatedAt(nextUpdatedAt);
      }
      setActiveProjectUpdatedBy(String(data?.updated_by_username || ""));
      setLastProjectSaveAt(String(data?.updated_at || ""));
      setLastProjectSaveKind("");
      setHasPendingAutoSave(false);
      lastProjectSignatureRef.current = projectPayloadSignature(data?.data || {});
      projectHandleRef.current = null;
      const by = String(data?.updated_by_username || "").trim();
      setProjectStatus(by ? `Loaded (last update by ${by})` : "Loaded");
      setShowProjectNameInput(false);
      projectHydrationReadyRef.current = true;
      setProjectIdentityReady(true);
    } catch (err) {
      setProjectStatus(err?.message || "Load failed.");
      projectHydrationReadyRef.current = true;
      setProjectIdentityReady(true);
    }
  }

  async function deleteProjectFromDb(id) {
    if (!id) return;
    try {
      setProjectStatus("");
      await deleteProjectById(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      clearProjectDraft(id);
      if (activeProjectId === id) setActiveProjectId("");
      setProjectStatus("Deleted");
    } catch (err) {
      setProjectStatus(err?.message || "Delete failed.");
    }
  }

  function newProjectFromDb() {
    const defaultScreens = [
      {
        id: "screen-1",
        name: "Screen 1",
        shapes: [],
        svgOverlays: [],
        vbW: 1600,
        vbH: 900,
        pan: { x: 0, y: 0 },
        zoom: 1,
        showInLiveMenu: true,
      },
    ];
    const defaultMenuGroups = defaultLiveMenuGroupsFromScreens(defaultScreens);
    applyProjectPayload({
      projectMode: "design",
      activeScreenId: "screen-1",
      screens: defaultScreens,
      liveMenuGroups: defaultMenuGroups,
    });
    setProjectName("Untitled");
    setProjectMode("design");
    setProjectCanvasBackground(normalizeProjectCanvasBackground(null));
    setScreenName("Screen 1");
    setActiveScreenId("screen-1");
    setScreens(defaultScreens);
    canvasViewportScrollRef.current = { x: 0, y: 0 };
    setCanvasViewportScrollTarget({ x: 0, y: 0 });
    liveMenuGroupsRef.current = defaultMenuGroups;
    setLiveMenuGroups(defaultMenuGroups);
    setActiveProjectId("");
    localStorage.removeItem("vizi_active_project_id");
    setActiveProjectUpdatedAt("");
    activeProjectUpdatedAtRef.current = "";
    setActiveProjectUpdatedBy("");
    setLastProjectSaveAt("");
    setLastProjectSaveKind("");
    setHasPendingAutoSave(false);
    lastProjectSignatureRef.current = projectPayloadSignature({
      name: "Untitled",
      canvasBackground: normalizeProjectCanvasBackground(null),
      vbW: 1600,
      vbH: 900,
      pan: { x: 0, y: 0 },
      zoom: 1,
      projectMode: "design",
      activeScreenId: "screen-1",
      screens: defaultScreens,
      liveMenuGroups: defaultMenuGroups,
      shapes: [],
      svgOverlays: [],
    });
    projectHandleRef.current = null;
    setProjectStatus("");
    setShowProjectNameInput(true);
    projectHydrationReadyRef.current = true;
    setProjectIdentityReady(true);
  }

  function cancelNewProjectInput() {
    setShowProjectNameInput(false);
    if (!activeProjectId) setProjectName("Untitled");
  }

  async function saveProjectNameFromSettings() {
    if (!canEditProject) {
      toastError("You do not have permission to edit project settings.");
      return;
    }
    const nextName = String(projectNameDraft || "").trim() || "Untitled";
    const nextMode = normalizeProjectMode(projectModeDraft);
    const nextCanvasBackground = normalizeProjectCanvasBackground(projectCanvasBackgroundDraft);
    setProjectName(nextName);
    setProjectNameDraft(nextName);
    setProjectMode(nextMode);
    setProjectModeDraft(nextMode);
    setProjectCanvasBackground(nextCanvasBackground);
    setProjectCanvasBackgroundDraft(nextCanvasBackground);
    projectNameRef.current = nextName;
    projectModeRef.current = nextMode;
    projectCanvasBackgroundRef.current = nextCanvasBackground;
    const saved = await saveProjectToDb({
      teamMerge: true,
      payloadOverride: {
        name: nextName,
        projectMode: nextMode,
        canvasBackground: nextCanvasBackground,
      },
    });
    if (saved) {
      setProjectNameEditing(false);
    }
  }

  function cancelProjectNameEditFromSettings() {
    setProjectNameDraft(projectName || "");
    setProjectModeDraft(normalizeProjectMode(projectMode));
    setProjectCanvasBackgroundDraft(normalizeProjectCanvasBackground(projectCanvasBackground));
    setProjectNameEditing(false);
  }

  function beginProjectDrawerEdit() {
    if (!canEditProject) {
      toastError("You do not have permission to edit project settings.");
      return;
    }
    setProjectNameDraft(projectName || "");
    setProjectModeDraft(normalizeProjectMode(projectMode));
    setProjectCanvasBackgroundDraft(normalizeProjectCanvasBackground(projectCanvasBackground));
    setProjectNameEditing(true);
  }

  useEffect(() => {
    if (!activeProjectId) return;
    if (!projectCursors.length) return;
    let alive = true;
    async function pollProject() {
      if (!isPageVisible) return;
      if (isInteractingRef.current) return;
      try {
        const data = await getProjectById(activeProjectId);
        if (!alive) return;
        const remoteUpdatedAt = String(data?.updated_at || "");
        if (!remoteUpdatedAt || remoteUpdatedAt === activeProjectUpdatedAtRef.current) return;
        const remoteSig = projectPayloadSignature(data?.data || {});
        applyRemoteProjectPayload(data?.data || {}, { projectId: activeProjectId });
        lastProjectSignatureRef.current = remoteSig;
        activeProjectUpdatedAtRef.current = remoteUpdatedAt;
        setActiveProjectUpdatedAt(remoteUpdatedAt);
        const by = String(data?.updated_by_username || "");
        setActiveProjectUpdatedBy(by);
      } catch {
        // ignore sync failures
      }
    }
    pollProject();
    const id = setInterval(pollProject, isPageVisible ? 240 : 1200);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [activeProjectId, isPageVisible, projectCursors.length]);

  useEffect(() => {
    if (!activeProjectId || !isPageVisible) return;
    if (!projectHydrationReadyRef.current) return;
    const id = setInterval(() => {
      if (!projectHydrationReadyRef.current) return;
      const sig = projectPayloadSignature(getProjectPayload());
      if (!sig) return;
      if (sig === lastProjectSignatureRef.current) return;
      saveProjectToDb({ silent: true });
    }, 5000);
    return () => clearInterval(id);
  }, [activeProjectId, projectName, projectCanvasBackground, projectPlcs, activeScreenId, screenName, screens, liveMenuGroups, projectMode, vbW, vbH, pan, zoom, shapes, svgOverlays, isPageVisible]);

  useEffect(() => {
    if (!activeProjectId) return;
    if (!projectHydrationReadyRef.current) return;
    scheduleProjectAutoSave(160);
  }, [activeProjectId, zoom]);

  useEffect(() => {
    const projectId = normalizeTagValue(activeProjectId);
    const screenId = normalizeTagValue(activeScreenId);
    if (!projectId || !screenId) return;
    const rect = svgRef.current?.getBoundingClientRect?.();
    const viewportKey = getViewportZoomKey(rect);
    if (!viewportKey) return;
    const z = Number(zoom);
    if (!Number.isFinite(z) || z <= 0) return;
    const cache = readViewportZoomCache();
    const key = `${projectId}|${screenId}|${viewportKey}`;
    if (Number(cache[key]) === z) return;
    cache[key] = z;
    const lastKey = getViewportZoomCacheLastKey(projectId, screenId);
    if (lastKey) cache[lastKey] = z;
    writeViewportZoomCache(cache);
  }, [activeProjectId, activeScreenId, zoom, vbW, vbH]);

  useEffect(() => {
    if (!uiPreferenceAutosaveReadyRef.current) {
      uiPreferenceAutosaveReadyRef.current = true;
      return;
    }
    scheduleProjectAutoSave(180);
  }, [showGrid, showTagPaths, showRulers, liveMenuCollapsed, liveMenuExpandedWidth]);

  useEffect(() => {
    if (!activeProjectId) {
      setProjectCursors([]);
      lastCursorSentRef.current = { at: 0, x: NaN, y: NaN };
      cursorPublishInFlightRef.current = false;
      queuedCursorPointRef.current = null;
      return;
    }
    let alive = true;
    async function pollCursors() {
      if (!isPageVisible) return;
      try {
        const data = await listProjectCursors(activeProjectId);
        if (!alive) return;
        setProjectCursors(Array.isArray(data?.cursors) ? data.cursors : []);
      } catch {
        // ignore cursor polling failures
      }
    }
    pollCursors();
    const hasCollaborators = Array.isArray(projectCursors) && projectCursors.length > 0;
    const id = setInterval(pollCursors, isPageVisible ? (hasCollaborators ? 120 : 1500) : 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [activeProjectId, isPageVisible, projectCursors.length]);

  useEffect(() => {
    if (!user?.id) {
      setLivePresenceUsers([]);
      return;
    }
    let alive = true;
    const pollPresence = async () => {
      if (!isPageVisible) return;
      try {
        const data = await pingUserPresence();
        if (!alive) return;
        setLivePresenceUsers(Array.isArray(data?.users) ? data.users : []);
      } catch {
        // ignore presence polling failures
      }
    };
    pollPresence();
    const id = setInterval(pollPresence, isPageVisible ? 5000 : 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [user?.id, isPageVisible]);

  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || t.isContentEditable;
    }

    function onKeyDown(e) {
      if (isLiveMode) return;
      if (isTypingTarget(e.target)) return;
      const key = (e.key || "").toLowerCase();
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      if (key === "c") {
        e.preventDefault();
        copySelection();
      } else if (key === "v") {
        e.preventDefault();
        pasteClipboard();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isLiveMode]);

  useEffect(() => {
    function onDown() {
      if (contextMenu) setContextMenu(null);
      if (polyHandleMenu) setPolyHandleMenu(null);
    }
    function onKey(e) {
      if (e.key === "Escape") setContextMenu(null);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) {
      setContextSvgMenuOpen(false);
      setContextSvgTagQuery("");
    }
  }, [contextMenu]);

  useEffect(() => {
    function onKeyDown(e) {
      if (!contextSvgMenuOpen) return;
      const t = e.target;
      const tag = (t?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      const input = svgMenuInputRef.current;
      if (!input) return;
      if (e.key.length === 1 || e.key === "Backspace") {
        input.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contextSvgMenuOpen]);
  useEffect(() => {
    localStorage.setItem("vizi_project_name", projectName || "Untitled");
  }, [projectName]);


  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || t.isContentEditable;
    }

    function onKeyDown(e) {
      if (isLiveMode) return;
      if (isTypingTarget(e.target)) return;

      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (!mod) return;

      const k = (e.key || "").toLowerCase();

      // Undo: Cmd/Ctrl+Z
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Cmd/Ctrl+Shift+Z (common on Mac)
      if (k === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }

      // Redo: Cmd/Ctrl+Y (common on Windows)
      if (k === "y") {
        e.preventDefault();
        redo();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isLiveMode]);


  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || t.isContentEditable;
    }

    function onKeyDown(e) {
      if (isLiveMode) return;
      if (isTypingTarget(e.target)) return;

      const key = (e.key || "").toLowerCase();
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && key === "d") {
        e.preventDefault();
        e.stopPropagation();
        duplicateSelectedStable();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isLiveMode]);



  // Floating panel visibility
  const TOP_BAR_H = 56;
  const TASKBAR_H = 52;
  const RULER_SIZE = 24;
  const [zoomPos, setZoomPos] = useState({
    x: 16,
    y: TOP_BAR_H + RULER_SIZE + 140,
  });
  const [isAppFullscreen, setIsAppFullscreen] = useState(() => {
    if (typeof document === "undefined") return false;
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  });
  const zoomDragRef = useRef({ dragging: false, ox: 0, oy: 0, panelW: 64, panelH: 240 });
  const zoomPosRef = useRef(zoomPos);
  const zoomPanelRef = useRef(null);
  const canvasViewportSizeRef = useRef({ w: 0, h: 0 });
  const [showHUD, setShowHUD] = useState(false);
  const [showMainDrawer, setShowMainDrawer] = useState(false);
  const [drawerView, setDrawerView] = useState("ai");
  const [databaseTab, setDatabaseTab] = useState("data");
  const [showLiveMenuDrawer, setShowLiveMenuDrawer] = useState(false);
  const [showTaskbarZoomTools, setShowTaskbarZoomTools] = useState(false);
  const [showUserDrawer, setShowUserDrawer] = useState(false);
  const [showSecurityDrawer, setShowSecurityDrawer] = useState(false);
  const getViewportSize = () => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1400,
    h: typeof window !== "undefined" ? window.innerHeight : 900,
  });
  const getDrawerWidthBounds = (vpW) => {
    const width = Math.max(320, Number(vpW) || 0);
    const mobile = width <= 900;
    const mainMin = mobile ? 280 : 420;
    const projectMin = mobile ? 220 : 280;
    const maxMain = Math.max(mainMin, Math.floor(width * 0.96));
    const maxProject = Math.max(projectMin, Math.floor(width * 0.92));
    return { mainMin, projectMin, maxMain, maxProject };
  };
  const { w: initialVpW } = getViewportSize();
  const [drawerSizes, setDrawerSizes] = useState(() => {
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const bounds = getDrawerWidthBounds(initialVpW);
    const defaults = {
      main: { w: Math.min(900, bounds.maxMain) },
      mainByView: {},
      user: { w: Math.min(620, bounds.maxMain) },
      project: { w: Math.min(360, bounds.maxProject) },
    };
    if (typeof window === "undefined") return defaults;
    try {
      const raw = localStorage.getItem(DRAWER_SIZES_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      const mainW = clamp(Number(parsed?.main?.w) || defaults.main.w, bounds.mainMin, bounds.maxMain);
      const rawMainByView = parsed?.mainByView && typeof parsed.mainByView === "object" ? parsed.mainByView : {};
      const mainByView = {};
      for (const key of MAIN_DRAWER_WIDTH_VIEW_KEYS) {
        const parsedWidth = Number(rawMainByView?.[key]);
        if (!Number.isFinite(parsedWidth)) continue;
        mainByView[key] = clamp(parsedWidth, bounds.mainMin, bounds.maxMain);
      }
      const userW = clamp(Number(parsed?.user?.w) || defaults.user.w, bounds.mainMin, bounds.maxMain);
      const projectW = clamp(Number(parsed?.project?.w) || defaults.project.w, bounds.projectMin, bounds.maxProject);
      return {
        main: { w: mainW },
        mainByView,
        user: { w: userW },
        project: { w: projectW },
      };
    } catch {
      return defaults;
    }
  });
  const drawerResizeRef = useRef({
    active: null,
    startX: 0,
    originW: 0,
  });
  const [activeDrawerResize, setActiveDrawerResize] = useState("");
  const mainDrawerRef = useRef(null);
  const userDrawerRef = useRef(null);
  const securityDrawerRef = useRef(null);
  const projectDrawerRef = useRef(null);
  const liveMenuDrawerRef = useRef(null);
  const taskbarMenuBtnRef = useRef(null);
  const liveEquipmentDrawerRef = useRef(null);
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "dark" || stored === "light") return stored;
    } catch {
      // ignore
    }
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  });
  const [profileDraft, setProfileDraft] = useState({ username: "", display_name: "", avatar_url: "" });
  const [passwordDraft, setPasswordDraft] = useState({ current: "", next: "" });
  const [userSettingsEditing, setUserSettingsEditing] = useState(false);
  const [profileStatus, setProfileStatus] = useState("");
  const [profileError, setProfileError] = useState("");

  function resetAllDrawerSizes() {
    const vpW = typeof window !== "undefined" ? window.innerWidth : initialVpW;
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const bounds = getDrawerWidthBounds(vpW);
    const shared = clamp(Math.floor(vpW * 0.5), bounds.mainMin, Math.min(bounds.maxMain, bounds.maxProject));
    setDrawerSizes((prev) => {
      const previousByView =
        prev?.mainByView && typeof prev.mainByView === "object" ? prev.mainByView : {};
      const nextByView = {};
      for (const key of Object.keys(previousByView)) {
        nextByView[normalizeMainDrawerWidthViewKey(key)] = shared;
      }
      for (const key of MAIN_DRAWER_WIDTH_VIEW_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(nextByView, key)) nextByView[key] = shared;
      }
      return {
        main: { w: shared },
        mainByView: nextByView,
        user: { w: shared },
        project: { w: shared },
      };
    });
  }

  useEffect(() => {
    if (!showMainDrawer) return;
    setContextMenu(null);
    setPolyHandleMenu(null);
    setContextSvgMenuOpen(false);
    setContextSvgTagQuery("");
  }, [showMainDrawer, drawerView]);

  useEffect(() => {
    const msg = String(projectStatus || "").trim();
    if (!msg) return;
    if (msg.toLowerCase() === "saving...") return;
    toastSuccess(msg);
  }, [projectStatus]);

  useEffect(() => {
    const ok = String(profileStatus || "").trim();
    if (ok) toastSuccess(ok);
    const err = String(profileError || "").trim();
    if (err) toastError(err);
  }, [profileStatus, profileError]);

  function beginDrawerResize(which, e, disabled = false) {
    if (disabled) return;
    if (e.button !== 0) return;
    const current =
      which === "liveMenu"
        ? { w: liveMenuExpandedWidth }
        : which === "main"
        ? { w: getMainDrawerWidthForView(drawerSizes, drawerView) }
        : drawerSizes?.[which] || { w: 0 };
    drawerResizeRef.current = {
      active: which,
      startX: e.clientX,
      originW: Number(current.w) || 0,
    };
    setActiveDrawerResize(String(which || ""));
    e.preventDefault();
    e.stopPropagation();
  }

  useEffect(() => {
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    function onMove(e) {
      const resize = drawerResizeRef.current;
      if (resize?.active) {
        const key = resize.active;
        const vpW = window.innerWidth;
        const bounds = getDrawerWidthBounds(vpW);
        const dx = e.clientX - resize.startX;
        if (key === "liveMenu") {
          const minW = LIVE_MENU_EXPANDED_WIDTH_MIN;
          const maxW = Math.max(minW, Math.min(LIVE_MENU_EXPANDED_WIDTH_MAX, Math.floor(vpW * 0.5)));
          const nextW = clamp(resize.originW + dx, minW, maxW);
          setLiveMenuExpandedWidth(nextW);
          return;
        }
        const minW = key === "project" ? bounds.projectMin : bounds.mainMin;
        const maxW = key === "project" ? bounds.maxProject : bounds.maxMain;
        const widthDelta = key === "project" ? dx : -dx;
        const nextW = clamp(resize.originW + widthDelta, minW, maxW);
        setDrawerSizes((prev) => ({
          ...prev,
          ...(key === "main"
            ? {
                mainByView: {
                  ...(prev?.mainByView && typeof prev.mainByView === "object" ? prev.mainByView : {}),
                  [normalizeMainDrawerWidthViewKey(drawerView)]: nextW,
                },
              }
            : {}),
          [key]: { w: nextW },
        }));
      }
    }
    function onUp() {
      drawerResizeRef.current.active = null;
      setActiveDrawerResize("");
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [TOP_BAR_H, drawerView]);

  useEffect(() => {
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const onResize = () => {
      const vpW = window.innerWidth;
      const bounds = getDrawerWidthBounds(vpW);
      setDrawerSizes((prev) => ({
        main: {
          w: clamp(prev.main.w, bounds.mainMin, bounds.maxMain),
        },
        mainByView: Object.fromEntries(
          Object.entries(prev?.mainByView && typeof prev.mainByView === "object" ? prev.mainByView : {}).map(
            ([key, value]) => [
              normalizeMainDrawerWidthViewKey(key),
              clamp(Number(value) || prev.main.w, bounds.mainMin, bounds.maxMain),
            ]
          )
        ),
        user: {
          w: clamp(prev.user.w, bounds.mainMin, bounds.maxMain),
        },
        project: {
          w: clamp(prev.project.w, bounds.projectMin, bounds.maxProject),
        },
      }));
      setLiveMenuExpandedWidth((prev) =>
        clamp(
          Number(prev) || LIVE_MENU_EXPANDED_WIDTH_DEFAULT,
          LIVE_MENU_EXPANDED_WIDTH_MIN,
          Math.max(
            LIVE_MENU_EXPANDED_WIDTH_MIN,
            Math.min(LIVE_MENU_EXPANDED_WIDTH_MAX, Math.floor(vpW * 0.5))
          )
        )
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [TOP_BAR_H]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(DRAWER_SIZES_KEY, JSON.stringify(drawerSizes));
    } catch {
      // ignore storage write errors
    }
  }, [drawerSizes]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        DRAWER_FULLSCREEN_KEY,
        JSON.stringify({
          main: Boolean(mainDrawerFullscreen),
          user: Boolean(userDrawerFullscreen),
          project: Boolean(projectDrawerFullscreen),
        })
      );
    } catch {
      // ignore storage write errors
    }
  }, [mainDrawerFullscreen, userDrawerFullscreen, projectDrawerFullscreen]);

  useEffect(() => {
    const captureInitialSize = () => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      canvasViewportSizeRef.current = {
        w: Math.max(1, Number(rect.width) || 0),
        h: Math.max(1, Number(rect.height) || 0),
      };
    };

    const refreshViewportSize = () => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const nextW = Math.max(1, Number(rect.width) || 0);
      const nextH = Math.max(1, Number(rect.height) || 0);
      canvasViewportSizeRef.current = { w: nextW, h: nextH };
    };

    captureInitialSize();
    const onResize = () => window.requestAnimationFrame(refreshViewportSize);
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onResize);
    document.addEventListener("webkitfullscreenchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onResize);
      document.removeEventListener("webkitfullscreenchange", onResize);
    };
  }, []);

  const [altDown, setAltDown] = useState(false);
  useEffect(() => {
    zoomPosRef.current = zoomPos;
  }, [zoomPos]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const syncFullscreenState = () => {
      setIsAppFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    };
    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    function onMove(e) {
      if (!zoomDragRef.current.dragging) return;
      const minTop = TOP_BAR_H + RULER_SIZE + 8;
      const panelW = zoomDragRef.current.panelW || zoomPanelRef.current?.getBoundingClientRect()?.width || 64;
      const panelH = zoomDragRef.current.panelH || zoomPanelRef.current?.getBoundingClientRect()?.height || 240;
      const nextLeft = Math.max(8, e.clientX - zoomDragRef.current.ox);
      const maxLeft = Math.max(8, window.innerWidth - panelW - 8);
      const nextTop = Math.max(minTop, e.clientY - zoomDragRef.current.oy);
      const maxTop = Math.max(minTop, window.innerHeight - panelH - 8);
      setZoomPos({
        x: Math.min(nextLeft, maxLeft),
        y: Math.min(nextTop, maxTop),
      });
    }

    function onUp() {
      zoomDragRef.current.dragging = false;
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [TOP_BAR_H, RULER_SIZE]);

  function startZoomDrag(e) {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = zoomPanelRef.current?.getBoundingClientRect();
    zoomDragRef.current.dragging = true;
    zoomDragRef.current.ox = e.clientX - (zoomPosRef.current?.x ?? 16);
    zoomDragRef.current.oy = e.clientY - (zoomPosRef.current?.y ?? TOP_BAR_H + RULER_SIZE + 140);
    zoomDragRef.current.panelW = rect?.width || 64;
    zoomDragRef.current.panelH = rect?.height || 240;
  }

  useEffect(() => {
    if (!showHUD) setPanelCursor(null);
  }, [showHUD]);
  useEffect(() => {
    if (!showTagPaths && hiddenTagBubbleIds.length) {
      setHiddenTagBubbleIds([]);
    }
  }, [showTagPaths, hiddenTagBubbleIds.length]);
  const svgPropertiesStickyOpen =
    showHUD &&
    selectedIds.length === 0 &&
    selectedOverlayIds.length === 1 &&
    !!svgOverlays.find(
      (o) => String(o?.id || "") === String(selectedOverlayIds[0] || "") && !o?.widget
    );
  useEffect(() => {
    if (importOpen && !svgPropertiesStickyOpen) setShowHUD(false);
  }, [importOpen, svgPropertiesStickyOpen]);
  useEffect(() => {
    if (widgetOpen && !svgPropertiesStickyOpen) setShowHUD(false);
  }, [widgetOpen, svgPropertiesStickyOpen]);

  useEffect(() => {
    if (tool === "polyline" && !svgPropertiesStickyOpen) setShowHUD(false);
  }, [tool, svgPropertiesStickyOpen]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Alt") setAltDown(true);
    }
    function onKeyUp(e) {
      if (e.key === "Alt") setAltDown(false);
    }
    function onBlur() {
      setAltDown(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  function openDrawer(view, options = {}) {
    if (!canLeaveSaveDrawerState()) return;
    const next = view || "ai";
    const areaForView =
      next === "plc" || next === "code-gen-pro"
        ? "plc"
        : next === "opc" || next === "logs" || next === "diagnostics"
        ? "opc"
        : next === "tags"
        ? "tags"
        : next === "server"
        ? "server"
        : next === "logger"
        ? "server"
        : next === "database"
        ? "database"
        : next === "reports"
        ? "reports"
        : next === "ai"
        ? "ai"
        : next === "help"
        ? "help"
        : "";
    if (areaForView && !canViewArea(areaForView)) {
      toastError("You do not have permission to open this page.");
      return;
    }
    setShowUserDrawer(false);
    setShowSecurityDrawer(false);
    setMainDrawerFullscreen(false);
    setDrawerView(next);
    if (next === "database") {
      const forceDataOnly = options?.forceDatabaseDataTab === true && isLiveMode;
      setDatabaseDataOnlyMode(forceDataOnly);
      if (options?.forceDatabaseDataTab === true) {
        setDatabaseTab("data");
      } else {
        setDatabaseTab((prev) =>
          prev === "dataset" || prev === "config" || prev === "diagnostics" || prev === "designer"
            ? prev
            : "data"
        );
      }
      const requested = String(options?.databasePath || "").trim();
      if (requested) {
        const normalized = requested.startsWith("/data/")
          ? requested
          : `/data/${requested.replace(/^\/+/, "")}`;
        setDatabaseEmbeddedPath(normalized);
      }
      setDatabaseEmbeddedRouteId(String(options?.databaseRouteId || "").trim());
      setDatabaseEmbeddedRouteName(String(options?.databaseRouteName || "").trim());
    } else {
      setDatabaseDataOnlyMode(false);
      setDatabaseEmbeddedRouteId("");
      setDatabaseEmbeddedRouteName("");
    }
    setShowMainDrawer(true);
  }

  useEffect(() => {
    if (!user) return;
    if (userSettingsEditing) return;
    setProfileDraft({
      username: user.username || "",
      display_name: user.display_name || "",
      avatar_url: user.avatar_url || "",
    });
  }, [user, userSettingsEditing]);

  function resetUserSettingsDraftsFromUser() {
    setProfileDraft({
      username: user?.username || "",
      display_name: user?.display_name || "",
      avatar_url: user?.avatar_url || "",
    });
    setPasswordDraft({ current: "", next: "" });
  }

  function beginUserSettingsEdit() {
    resetUserSettingsDraftsFromUser();
    setProfileError("");
    setProfileStatus("");
    setUserSettingsEditing(true);
  }

  function cancelUserSettingsEdit() {
    resetUserSettingsDraftsFromUser();
    setProfileError("");
    setProfileStatus("");
    setUserSettingsEditing(false);
  }

  function hasUnsavedProjectSettingsDraft() {
    if (!projectNameEditing) return false;
    return (
      String(projectNameDraft || "") !== String(projectName || "") ||
      normalizeProjectMode(projectModeDraft) !== normalizeProjectMode(projectMode) ||
      normalizeProjectCanvasBackground(projectCanvasBackgroundDraft) !==
        normalizeProjectCanvasBackground(projectCanvasBackground)
    );
  }

  function hasUnsavedUserSettingsDraft() {
    if (!userSettingsEditing) return false;
    return (
      String(profileDraft.username || "") !== String(user?.username || "") ||
      String(profileDraft.display_name || "") !== String(user?.display_name || "") ||
      String(profileDraft.avatar_url || "") !== String(user?.avatar_url || "")
    );
  }

  function hasUnsavedSecurityDraft() {
    return (
      String(passwordDraft.current || "").trim().length > 0 ||
      String(passwordDraft.next || "").trim().length > 0
    );
  }

  function confirmDiscardDrawerChanges(message) {
    if (typeof window === "undefined") return true;
    return window.confirm(message);
  }

  function canCloseProjectDrawer() {
    if (!showProjectDrawer) return true;
    if (!hasUnsavedProjectSettingsDraft()) return true;
    return confirmDiscardDrawerChanges(
      "You have unsaved Project settings changes. Discard them and close the drawer?"
    );
  }

  function canCloseUserDrawer() {
    if (!showUserDrawer) return true;
    if (!hasUnsavedUserSettingsDraft() && !hasUnsavedSecurityDraft()) return true;
    return confirmDiscardDrawerChanges(
      "You have unsaved User/Security changes. Discard them and close the drawer?"
    );
  }

  function canLeaveSaveDrawerState() {
    if (!canCloseProjectDrawer()) return false;
    if (!canCloseUserDrawer()) return false;
    return true;
  }

  function closeProjectDrawerSafely() {
    if (!canCloseProjectDrawer()) return false;
    setShowProjectDrawer(false);
    return true;
  }

  function closeUserDrawerSafely() {
    if (!canCloseUserDrawer()) return false;
    setShowUserDrawer(false);
    return true;
  }

  function closeSecurityDrawerSafely() {
    if (hasUnsavedSecurityDraft()) {
      const ok = confirmDiscardDrawerChanges(
        "You have unsaved Security password changes. Discard them and close the drawer?"
      );
      if (!ok) return false;
    }
    setShowSecurityDrawer(false);
    return true;
  }

  function openUserDrawerSafely() {
    if (!canLeaveSaveDrawerState()) return;
    setShowMainDrawer(false);
    setShowSecurityDrawer(false);
    setShowUserDrawer(true);
  }

  function openSecurityDrawerSafely() {
    if (!canLeaveSaveDrawerState()) return;
    setShowMainDrawer(false);
    setShowUserDrawer(false);
    setShowSecurityDrawer(true);
  }

  async function saveUserSettingsEdit() {
    setProfileError("");
    setProfileStatus("");
    try {
      await updateProfile({
        username: profileDraft.username,
        display_name: profileDraft.display_name,
        avatar_url: profileDraft.avatar_url,
      });
      await refresh();
      setProfileStatus("Profile updated.");
      setUserSettingsEditing(false);
    } catch (err) {
      setProfileError(err?.message || "Profile update failed.");
    }
  }

  async function saveSecurityPassword() {
    setProfileError("");
    setProfileStatus("");
    try {
      const hasCurrentPassword = String(passwordDraft.current || "").trim().length > 0;
      const hasNextPassword = String(passwordDraft.next || "").trim().length > 0;
      if (!hasCurrentPassword || !hasNextPassword) {
        throw new Error("Enter both current and new password.");
      }
      await changePassword(passwordDraft.current, passwordDraft.next);
      setPasswordDraft({ current: "", next: "" });
      setProfileStatus("Password updated.");
    } catch (err) {
      setProfileError(err?.message || "Password update failed.");
    }
  }

  useEffect(() => {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    document.body.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(SHOW_GRID_KEY, showGrid ? "1" : "0");
    } catch {
      // ignore
    }
  }, [showGrid]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(SHOW_TAG_PATHS_KEY, showTagPaths ? "1" : "0");
    } catch {
      // ignore
    }
  }, [showTagPaths]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(SHOW_RULERS_KEY, showRulers ? "1" : "0");
    } catch {
      // ignore
    }
  }, [showRulers]);

  const avatarLabel = useMemo(() => {
    const name = String(user?.display_name || user?.username || "").trim();
    if (!name) return "U";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }, [user]);
  const canManageSecurity = useMemo(
    () => Boolean(user?.permissions?.security?.can_edit),
    [user]
  );
  const hasUserPermissions = useMemo(
    () => Boolean(user?.permissions && typeof user.permissions === "object"),
    [user]
  );
  const canViewArea = (areaKey) => {
    if (!areaKey) return true;
    if (!hasUserPermissions) return true;
    return Boolean(user?.permissions?.[areaKey]?.can_view || user?.permissions?.[areaKey]?.can_edit);
  };
  const canEditArea = (areaKey) => {
    if (!areaKey) return true;
    if (!hasUserPermissions) return true;
    return Boolean(user?.permissions?.[areaKey]?.can_edit);
  };
  const canViewScreenPages = canViewArea("project");
  const canViewDataPages = canViewArea("database");
  const canViewReportsPages = canViewArea("reports");
  const canEditProject = canEditArea("project");
  const isOpcDrawerView =
    drawerView === "opc" || drawerView === "logs" || drawerView === "diagnostics";
  const currentUserRoleIds = useMemo(
    () =>
      new Set(
        (Array.isArray(user?.roles) ? user.roles : [])
          .map((r) => Number(r?.id))
          .filter((id) => Number.isFinite(id) && id > 0)
      ),
    [user]
  );
  const isViewOnlyRole = useMemo(() => {
    const names = (Array.isArray(user?.roles) ? user.roles : [])
      .map((r) => String(r?.name || "").trim().toLowerCase())
      .filter(Boolean);
    return names.some((name) =>
      name === "viewonly" ||
      name === "view only" ||
      name === "read only" ||
      name === "readonly" ||
      name === "viewer"
    );
  }, [user]);
  const { canAccessLiveMenuItem, isLiveMenuItemRoleRestricted } = useLiveMenuAccess({
    canViewDataPages,
    canViewScreenPages,
    canViewReportsPages,
    currentUserRoleIds,
  });
  const canOpenLiveMenuItem = (item) => {
    const itemType = String(item?.type || "").trim().toLowerCase();
    if (isViewOnlyRole && itemType === "screen") return true;
    return canAccessLiveMenuItem(item);
  };
  const canInteractLiveScreens = !(isLiveMode && isViewOnlyRole);

  useEffect(() => {
    if (!canManageSecurity) {
      setSecurityRolesForMenu([]);
      return;
    }
    let cancelled = false;
    async function loadSecurityRoles() {
      try {
        const data = await listSecurityRoles();
        if (cancelled) return;
        const roles = Array.isArray(data?.roles)
          ? data.roles
              .map((r) => ({
                id: Number(r?.id),
                name: String(r?.name || "").trim(),
              }))
              .filter((r) => Number.isFinite(r.id) && r.id > 0 && r.name)
          : [];
        setSecurityRolesForMenu(roles);
      } catch {
        if (!cancelled) setSecurityRolesForMenu([]);
      }
    }
    loadSecurityRoles();
    return () => {
      cancelled = true;
    };
  }, [canManageSecurity]);


  // ? ZOOM (main svg)
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 8;
  const ZOOM_STEP = 1.01;
const ZOOM_STEP_PERCENT = 1;
const CONTENT_FIT_HEADROOM = 0.94;


  const applySingleTextValue = (v) => {
    if (!isSingle || singleKind !== "Text" || !singleId) return;
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, text: String(v ?? "") } : s)));
  };

  const applySingleFontSize = (v) => {
    if (!isSingle || singleKind !== "Text" || !singleId) return;
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n) || n <= 1) return;
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, fontSize: n } : s)));
  };

  const applySingleFontFamily = (v) => {
    if (!isSingle || singleKind !== "Text" || !singleId) return;
    setShapes((prev) =>
      prev.map((s) => (s.id === singleId ? { ...s, fontFamily: String(v ?? "").trim() } : s))
    );
  };

  const applySingleFontWeight = (v) => {
    if (!isSingle || singleKind !== "Text" || !singleId) return;
    const next = String(v ?? "").trim();
    if (!next) return;
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, fontWeight: next } : s)));
  };

  const applySingleTextAlign = (v) => {
    if (!isSingle || singleKind !== "Text" || !singleId) return;
    const a = v === "middle" || v === "end" ? v : "start";
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, anchor: a } : s)));
  };

  function lineStyleToStrokeProps(style, strokeWidth) {
    const sw = Math.max(1, Number(strokeWidth) || 1);
    switch (style) {
      case "dashed":
        return { dasharray: `${sw * 4} ${sw * 2}` };
      case "dotted":
        return { dasharray: `${sw} ${sw * 2}`, linecap: "round" };
      case "wavy":
        return { dasharray: `${sw * 1.5} ${sw * 1.5}`, linecap: "round", linejoin: "round" };
      default:
        return {};
    }
  }

  function convertSelectedPolylinesToSvg() {
    const ids = selectedIds || [];
    if (!ids.length) return;

    const selectedShapes = shapes.filter((s) => ids.includes(s.id));
    if (!selectedShapes.length) return;

    const escapeXml = (v) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const polyParts = [];
    const rectParts = [];
    const circleParts = [];
    const textParts = [];

    for (const s of selectedShapes) {
      if (s.type === "polyline" || Array.isArray(s.points)) {
        if (!Array.isArray(s.points) || s.points.length < 2) continue;
        const bb = bboxOfPoints(s.points);
        if (!bb) continue;

        minX = Math.min(minX, bb.minX);
        minY = Math.min(minY, bb.minY);
        maxX = Math.max(maxX, bb.maxX);
        maxY = Math.max(maxY, bb.maxY);

        polyParts.push(s);
        continue;
      }

      if (s.type === "rect") {
        const x = Number(s.x ?? 0);
        const y = Number(s.y ?? 0);
        const w = Math.max(0, Number(s.width ?? 0));
        const h = Math.max(0, Number(s.height ?? 0));
        if (w <= 0 || h <= 0) continue;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
        rectParts.push(s);
        continue;
      }

      if (s.type === "circle") {
        const x = Number(s.x ?? 0);
        const y = Number(s.y ?? 0);
        const w = Math.max(0, Number(s.width ?? 0));
        const h = Math.max(0, Number(s.height ?? 0));
        if (w <= 0 || h <= 0) continue;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
        circleParts.push(s);
        continue;
      }

      if (s.type === "text") {
        const fontSize = Number(s.fontSize ?? 24);
        const text = String(s.text ?? "");
        const estW = Math.max(10, text.length * fontSize * 0.6);
        const estH = Math.max(10, fontSize * 1.2);
        const anchor = s.anchor || "start";
        const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;

        minX = Math.min(minX, Number(s.x ?? 0) + ax);
        minY = Math.min(minY, Number(s.y ?? 0));
        maxX = Math.max(maxX, Number(s.x ?? 0) + ax + estW);
        maxY = Math.max(maxY, Number(s.y ?? 0) + estH);

        textParts.push({
          ...s,
          _estW: estW,
          _estH: estH,
          _anchor: anchor,
        });
      }
    }

    if ((!polyParts.length && !rectParts.length && !circleParts.length && !textParts.length) || !Number.isFinite(minX)) {
      return;
    }

    const width = maxX - minX;
    const height = maxY - minY;

    const polyInner = polyParts
      .map((s) => {
        const localPoints = s.points.map((p) => ({
          x: Number(p.x) - minX,
          y: Number(p.y) - minY,
        }));

        const pointsAttr = localPoints.map((p) => `${p.x},${p.y}`).join(" ");
        const stroke = s.stroke || DEFAULT_STROKE;
        const fill = s.fill ?? "transparent";
        const strokeWidth = Number(s.strokeWidth) || 3;
        const style = lineStyleToStrokeProps(s.lineStyle ?? "solid", strokeWidth);

        const dashAttr = style.dasharray ? ` stroke-dasharray="${style.dasharray}"` : "";
        const linecap = style.linecap ?? "round";
        const linejoin = style.linejoin ?? "round";

        return `<polyline points="${pointsAttr}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"${dashAttr} />`;
      })
      .join("");

    const rectInner = rectParts
      .map((s) => {
        const x = Number(s.x ?? 0) - minX;
        const y = Number(s.y ?? 0) - minY;
        const width = Math.max(0, Number(s.width ?? 0));
        const height = Math.max(0, Number(s.height ?? 0));
        const stroke = s.stroke || DEFAULT_STROKE;
        const fill = s.fill || "transparent";
        const strokeWidth = Number(s.strokeWidth) || 3;
        const style = lineStyleToStrokeProps(s.lineStyle ?? "solid", strokeWidth);
        const dashAttr = style.dasharray ? ` stroke-dasharray="${style.dasharray}"` : "";
        const linecap = style.linecap ?? "round";
        const linejoin = style.linejoin ?? "round";

        return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"${dashAttr} />`;
      })
      .join("");

    const textInner = textParts
      .map((t) => {
        const x = Number(t.x ?? 0) - minX;
        const y = Number(t.y ?? 0) - minY;
        const fill = t.fill || "#808080";
        const fontSize = Number(t.fontSize ?? 24);
        const fontFamily = t.fontFamily || "system-ui";
        const fontWeight = t.fontWeight || "400";
        const textAnchor = t._anchor || "start";
        const text = escapeXml(t.text ?? "");

        return `<text x="${x}" y="${y}" fill="${fill}" font-size="${fontSize}" font-family="${fontFamily}" font-weight="${fontWeight}" text-anchor="${textAnchor}" dominant-baseline="text-before-edge">${text}</text>`;
      })
      .join("");

    const circleInner = circleParts
      .map((s) => {
        const x = Number(s.x ?? 0) - minX;
        const y = Number(s.y ?? 0) - minY;
        const width = Math.max(0, Number(s.width ?? 0));
        const height = Math.max(0, Number(s.height ?? 0));
        const cx = x + width / 2;
        const cy = y + height / 2;
        const rx = width / 2;
        const ry = height / 2;
        const stroke = s.stroke || DEFAULT_STROKE;
        const fill = s.fill || "transparent";
        const strokeWidth = Number(s.strokeWidth) || 3;
        const style = lineStyleToStrokeProps(s.lineStyle ?? "solid", strokeWidth);
        const dashAttr = style.dasharray ? ` stroke-dasharray="${style.dasharray}"` : "";
        const linecap = style.linecap ?? "round";
        const linejoin = style.linejoin ?? "round";
        return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"${dashAttr} />`;
      })
      .join("");

    // Ensure text is always on top
    const inner = `${polyInner}${rectInner}${circleInner}${textInner}`;

    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${inner}</svg>`;
    const genKey = addGeneratedSvg(
      `Selection-Group-${polyParts.length + rectParts.length + circleParts.length + textParts.length}`,
      raw
    );
    const stroke = polyParts[0]?.stroke || rectParts[0]?.stroke || circleParts[0]?.stroke || DEFAULT_STROKE;
    const fill = polyParts[0]?.fill || rectParts[0]?.fill || circleParts[0]?.fill || textParts[0]?.fill || DEFAULT_FILL;
    const tagPath =
      selectedShapes.length === 1 ? (selectedShapes[0]?.tagPath || "") : "";

    const overlaysToAdd = [
      {
        id: uid(),
        sourceKey: genKey,
        name: genKey.split("/").pop() || "Selection-Group",
        inner,
        tx: minX,
        ty: minY,
        scale: 1,
        fill,
        stroke,
        tagPath,
        bbox: { x: 0, y: 0, width, height },
      },
    ];

    pushHistory();
    setShapes((prev) => prev.filter((x) => !ids.includes(x.id)));
    setSvgOverlays((prev) => [...prev, ...overlaysToAdd]);
    setSelectedIds([]);
    setSelectedOverlayIds(overlaysToAdd.map((o) => o.id));
    setEditingId(null);
  }


  const applyViewBox = ({ w, h }) => {
    setVbW(w);
    setVbH(h);
    const current = (Array.isArray(screensRef.current) ? screensRef.current : []).find(
      (s) => String(s?.id || "") === String(activeScreenIdRef.current || activeScreenId || "")
    );
    const mode = normalizeScreenAutoFitMode(current?.autoFitMode, autoFitCanvasOnResize ? "content" : "off");
    if (mode !== "off") fitViewToCanvas(w, h, mode, { preservePan: true });
    // resetView?.(); // if you want
  };

  const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  const nudgeZoomPercent = (currentZoom, deltaPercent) => {
    const currentPct = Math.round((Number(currentZoom) || 1) * 100);
    const nextPct = Math.max(
      Math.round(ZOOM_MIN * 100),
      Math.min(Math.round(ZOOM_MAX * 100), currentPct + deltaPercent)
    );
    return clampZoom(nextPct / 100);
  };
  const clampPanToViewport = (nextPanRaw, zoomValue = zoomRef.current) => {
    const el = svgRef.current;
    const z = Math.max(0.0001, Number(zoomValue) || 1);
    const worldW = Math.max(1, Number(vbW) || 1);
    const worldH = Math.max(1, Number(vbH) || 1);
    const scaledW = worldW * z;
    const scaledH = worldH * z;
    const rect = el?.getBoundingClientRect?.();
    const viewW = Math.max(1, Number(rect?.width) || 1);
    const viewH = Math.max(1, Number(rect?.height) || 1);

    const nextPan = {
      x: Number(nextPanRaw?.x) || 0,
      y: Number(nextPanRaw?.y) || 0,
    };

    if (scaledW <= viewW) {
      nextPan.x = 0;
    } else {
      const minX = viewW - scaledW;
      const maxX = 0;
      nextPan.x = Math.min(maxX, Math.max(minX, nextPan.x));
    }

    if (scaledH <= viewH) {
      nextPan.y = 0;
    } else {
      const minY = viewH - scaledH;
      const maxY = 0;
      nextPan.y = Math.min(maxY, Math.max(minY, nextPan.y));
    }

    return nextPan;
  };

  function getCanvasContentBounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;

    const items = Array.isArray(shapesRef.current) ? shapesRef.current : [];
    for (const s of items) {
      if (s?.type === "polyline" || Array.isArray(s?.points)) {
        const bb = bboxOfPoints(s.points || []);
        if (!bb) continue;
        minX = Math.min(minX, bb.minX);
        minY = Math.min(minY, bb.minY);
        maxX = Math.max(maxX, bb.maxX);
        maxY = Math.max(maxY, bb.maxY);
        count += 1;
        continue;
      }
      if (s?.type === "rect") {
        const x = Number(s.x) || 0;
        const y = Number(s.y) || 0;
        const w = Math.max(0, Number(s.width) || 0);
        const h = Math.max(0, Number(s.height) || 0);
        if (w <= 0 || h <= 0) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
        count += 1;
        continue;
      }
      if (s?.type === "text") {
        const tb = textBoxFromShape(s);
        if (!tb) continue;
        minX = Math.min(minX, tb.x);
        minY = Math.min(minY, tb.y);
        maxX = Math.max(maxX, tb.x + tb.w);
        maxY = Math.max(maxY, tb.y + tb.h);
        count += 1;
      }
    }

    const overlays = Array.isArray(overlaysRef.current) ? overlaysRef.current : [];
    for (const o of overlays) {
      const sx = overlayScaleX(o);
      const sy = overlayScaleY(o);
      const bb = o?.bbox || overlayLocalBBox(o?.id);
      if (!bb) continue;
      const left = (Number(o.tx) || 0) + sx * (Number(bb.x) || 0);
      const top = (Number(o.ty) || 0) + sy * (Number(bb.y) || 0);
      const right = left + sx * (Number(bb.width) || 0);
      const bottom = top + sy * (Number(bb.height) || 0);
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, right);
      maxY = Math.max(maxY, bottom);
      count += 1;
    }

    if (!count || !Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }
    return {
      x: minX,
      y: minY,
      w: Math.max(1, maxX - minX),
      h: Math.max(1, maxY - minY),
    };
  }

  function fitViewToCanvas(worldWOverride = null, worldHOverride = null, mode = "contain", options = {}) {
    const preservePan = options?.preservePan === true;
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewW = Math.max(1, Number(rect.width) || 0);
    const viewH = Math.max(1, Number(rect.height) || 0);
    const worldW = Math.max(
      1,
      Number.isFinite(Number(worldWOverride)) ? Number(worldWOverride) : Number(vbW) || 0
    );
    const worldH = Math.max(
      1,
      Number.isFinite(Number(worldHOverride)) ? Number(worldHOverride) : Number(vbH) || 0
    );
    const fitMode = String(mode || "contain").toLowerCase();
    let nextZoom = clampZoom(Math.min(viewW / worldW, viewH / worldH));
    let nextPan = preservePan
      ? clampPanToViewport(
          panRef.current && Number.isFinite(panRef.current.x) && Number.isFinite(panRef.current.y)
            ? panRef.current
            : { x: 0, y: 0 },
          nextZoom
        )
      : { x: 0, y: 0 };

    if (fitMode === "content") {
      const bounds = getCanvasContentBounds();
      if (bounds) {
        const padPx = 24;
        const availW = Math.max(1, viewW - padPx * 2);
        const availH = Math.max(1, viewH - padPx * 2);
        nextZoom = clampZoom(
          Math.min(availW / bounds.w, availH / bounds.h) * CONTENT_FIT_HEADROOM
        );
        if (!preservePan) {
          nextPan = {
            x: (viewW - bounds.w * nextZoom) / 2 - bounds.x * nextZoom,
            y: (viewH - bounds.h * nextZoom) / 2 - bounds.y * nextZoom,
          };
        } else {
          const currentPan =
            panRef.current && Number.isFinite(panRef.current.x) && Number.isFinite(panRef.current.y)
              ? panRef.current
              : { x: 0, y: 0 };
          const left = bounds.x * nextZoom;
          const top = bounds.y * nextZoom;
          const right = (bounds.x + bounds.w) * nextZoom;
          const bottom = (bounds.y + bounds.h) * nextZoom;
          const minPanX = padPx - left;
          const maxPanX = viewW - padPx - right;
          const minPanY = padPx - top;
          const maxPanY = viewH - padPx - bottom;
          const centerPanX = (minPanX + maxPanX) / 2;
          const centerPanY = (minPanY + maxPanY) / 2;
          nextPan = {
            x:
              minPanX <= maxPanX
                ? Math.max(minPanX, Math.min(maxPanX, Number(currentPan.x) || 0))
                : centerPanX,
            y:
              minPanY <= maxPanY
                ? Math.max(minPanY, Math.min(maxPanY, Number(currentPan.y) || 0))
                : centerPanY,
          };
        }
      }
    } else if (fitMode === "height") {
      const heightZoom = (viewH / worldH) * 0.995;
      nextZoom = clampZoom(heightZoom);
      nextPan = preservePan
        ? clampPanToViewport(
            panRef.current && Number.isFinite(panRef.current.x) && Number.isFinite(panRef.current.y)
              ? panRef.current
              : { x: 0, y: 0 },
            nextZoom
          )
        : { x: 0, y: 0 };
    }

    setZoom(nextZoom);
    setPan(nextPan);
    const nextScroll = {
      x: Number(canvasViewportScrollRef.current?.x) || 0,
      y: 0,
    };
    canvasViewportScrollRef.current = nextScroll;
    setCanvasViewportScrollTarget(nextScroll);
  }

  useEffect(() => {
    if (!autoFitInitRef.current) {
      autoFitInitRef.current = true;
      return;
    }
    if (!autoFitCanvasOnResize) return;
    fitViewToCanvas(null, null, "content");
  }, [autoFitCanvasOnResize]);

  function zoomIn() {
    setZoom((z) => {
      const next = nudgeZoomPercent(z, ZOOM_STEP_PERCENT);
      rememberedButtonZoomRef.current = next;
      setPan((p) => clampPanToViewport(p, next));
      return next;
    });
  }
  function zoomOut() {
    setZoom((z) => {
      const next = nudgeZoomPercent(z, -ZOOM_STEP_PERCENT);
      rememberedButtonZoomRef.current = next;
      setPan((p) => clampPanToViewport(p, next));
      return next;
    });
  }
  function resetZoomToSavedButtonLevel(forceActual100 = false) {
    const remembered = Number(rememberedButtonZoomRef.current);
    const nextZoom = forceActual100
      ? 1
      : clampZoom(Number.isFinite(remembered) && remembered > 0 ? remembered : Number(zoomRef.current) || 1);
    const nextPan = { x: 0, y: 0 };
    const nextScroll = { x: 0, y: 0 };
    setZoom(nextZoom);
    setPan(nextPan);
    canvasViewportScrollRef.current = nextScroll;
    setCanvasViewportScrollTarget(nextScroll);

    // Persist reset view into the active screen snapshot so refresh restores 100%.
    const activeId = String(activeScreenIdRef.current || "");
    if (activeId) {
      setScreens((prev) =>
        (Array.isArray(prev) ? prev : []).map((screen) => {
          if (String(screen?.id || "") !== activeId) return screen;
          return {
            ...screen,
            zoom: nextZoom,
            pan: nextPan,
            scroll: nextScroll,
            designZoom: nextZoom,
            designPan: nextPan,
            designScroll: nextScroll,
          };
        })
      );
    }
  }
  function zoomReset() {
    resetZoomToSavedButtonLevel(false);
    scheduleProjectAutoSave(80);
  }
  function zoomResetTo100() {
    rememberedButtonZoomRef.current = 1;
    resetZoomToSavedButtonLevel(true);
    scheduleProjectAutoSave(80);
  }

  function stopZoomHold() {
    if (zoomHoldTimeoutRef.current) {
      clearTimeout(zoomHoldTimeoutRef.current);
      zoomHoldTimeoutRef.current = null;
    }
    if (zoomHoldIntervalRef.current) {
      clearInterval(zoomHoldIntervalRef.current);
      zoomHoldIntervalRef.current = null;
    }
  }

  function startZoomHold(action, event) {
    if (typeof action !== "function") return;
    if (event?.button != null && event.button !== 0) return;
    event?.stopPropagation?.();
    event?.preventDefault?.();
    stopZoomHold();
    action();
    zoomHoldTimeoutRef.current = setTimeout(() => {
      zoomHoldIntervalRef.current = setInterval(() => {
        action();
      }, 70);
    }, 240);
  }

  useEffect(() => {
    const onRelease = () => stopZoomHold();
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", onRelease);
    window.addEventListener("blur", onRelease);
    document.addEventListener("visibilitychange", onRelease);
    return () => {
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("pointercancel", onRelease);
      window.removeEventListener("blur", onRelease);
      document.removeEventListener("visibilitychange", onRelease);
      stopZoomHold();
    };
  }, []);

  async function toggleAppFullscreen() {
    if (typeof document === "undefined") return;
    const doc = document;
    const root = doc.documentElement;
    const active = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
    try {
      if (active) {
        if (typeof doc.exitFullscreen === "function") {
          await doc.exitFullscreen();
        } else if (typeof doc.webkitExitFullscreen === "function") {
          doc.webkitExitFullscreen();
        }
      } else if (root) {
        if (typeof root.requestFullscreen === "function") {
          await root.requestFullscreen();
        } else if (typeof root.webkitRequestFullscreen === "function") {
          root.webkitRequestFullscreen();
        }
      }
    } catch {
      // ignore fullscreen errors (browser/user policy)
    }
  }

  async function onPickProjectFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      alert("Invalid JSON file.");
      return;
    }

    applyProjectPayload(data || {});
  }

  function buildProjectPayload() {
    const committed = commitCurrentScreenState();
    return {
      version: 1,
      name: projectName,
      plcs: normalizeProjectPlcEntries(projectPlcs),
      activeScreenId: committed.currentId,
      screens: committed.list,
      savedAt: new Date().toISOString(),
      vbW,
      vbH,
      pan,
      zoom,
      shapes,
      svgOverlays,
    };
  }

  function exportProjectJson() {
    const payload = buildProjectPayload();

    async function saveProjectAs() {
      const data = buildProjectPayload();
      const json = JSON.stringify(data, null, 2);

      // ? Preferred: File System Access API (real overwrite)
      if ("showSaveFilePicker" in window) {
        const handle = await window.showSaveFilePicker({
          suggestedName: `${projectName || "project"}.json`,
          types: [
            {
              description: "Mesora Project",
              accept: { "application/json": [".json"] },
            },
          ],
        });

        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();

        setProjectHandle(handle);

        // best-effort name
        if (handle?.name) setProjectName(handle.name.replace(/\.json$/i, ""));
        return;
      }

      // ?? Fallback: download (cannot overwrite same file in most browsers)
      downloadTextFile(`${projectName || "project"}.json`, json, "application/json;charset=utf-8");
    }

    async function saveProject() {
      const data = buildProjectPayload();
      const json = JSON.stringify(data, null, 2);

      // If we already have a handle, overwrite it
      if (projectHandle && "showSaveFilePicker" in window) {
        const writable = await projectHandle.createWritable();
        await writable.write(json);
        await writable.close();
        return;
      }

      // otherwise behave like Save As
      await saveProjectAs();
    }

    function newProject() {
      pushHistory();

      setShapes([]);
      setSvgOverlays([]);
      setSelectedIds([]);
      setSelectedOverlayIds([]);
      setEditingId(null);
      setDrawing(null);
      setDragAll(null);
      setDragHandle(null);
      setOverlayResize(null);
      setMarquee(null);
      setImportAnchor(null);

      setZoom(1);
      setPan({ x: 0, y: 0 });

      // �forget� current file
      setProjectHandle(null);
      setProjectName("Untitled");
    }


    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "vizi-project.json";
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  function importProjectJson() {
    const input = projectFileRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }




  function textBoxFromShape(shape, options = {}) {
    if (!shape) return null;
    const minW = Number.isFinite(Number(options.minW)) ? Number(options.minW) : 10;
    const minH = Number.isFinite(Number(options.minH)) ? Number(options.minH) : 10;
    const charWidth = Number.isFinite(Number(options.charWidth)) ? Number(options.charWidth) : 0.6;
    const fontSize = Math.max(8, Number(shape.fontSize ?? 24) || 24);
    const text = String(shape.text ?? "");
    const anchor = shape.anchor === "middle" || shape.anchor === "end" ? shape.anchor : "start";
    const w = Math.max(minW, text.length * fontSize * charWidth);
    const h = Math.max(minH, fontSize * 1.2);
    const ax = anchor === "middle" ? -w / 2 : anchor === "end" ? -w : 0;
    return {
      x: Number(shape.x ?? 0) + ax,
      y: Number(shape.y ?? 0),
      w,
      h,
      anchor,
    };
  }

  function approxTextBBox(t) {
    if (!t) return null;
    const base = textBoxFromShape(t, { minW: 8, minH: 8 });
    if (!base) return null;
    const wStored = Number(t.w);
    const hStored = Number(t.h);
    if (Number.isFinite(wStored) && Number.isFinite(hStored)) {
      return { x: base.x, y: base.y, w: wStored, h: hStored };
    }
    return { x: base.x, y: base.y, w: base.w, h: base.h };
  }


  // --- Undo / Redo -------------------------------------------------
  const historyRef = useRef({ past: [], future: [] });

  const lastRightClickRef = useRef(0);
  const RIGHT_DBL_MS = 350;

  // Use structuredClone if available (best), fallback to JSON
  function deepClone(v) {
    if (typeof structuredClone === "function") return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
  }

  function getSnapshot() {
    return {
      shapes: deepClone(shapesRef.current),
      svgOverlays: deepClone(overlaysRef.current),
      selectedIds: deepClone(selPolyRef.current),
      selectedOverlayIds: deepClone(selOverRef.current),
      editingId,
      // optional: include these if you want undo to restore them too
      // pan, zoom, vbW, vbH,
    };
  }

  function applySnapshot(snap) {
    setShapes(snap.shapes || []);
    setSvgOverlays(snap.svgOverlays || []);
    setSelectedIds(snap.selectedIds || []);
    setSelectedOverlayIds(snap.selectedOverlayIds || []);
    setEditingId(snap.editingId ?? null);
    setDrawing(null);
    setDragAll(null);
    setDragHandle(null);
    setOverlayResize(null);
    setShapeResize(null);
    setMarquee(null);
  }

  function pushHistory() {
    historyRef.current.past.push(getSnapshot());
    historyRef.current.future = []; // clear redo on new action
  }

  function resetHistory() {
    historyRef.current = { past: [], future: [] };
  }

  function undo() {
    const h = historyRef.current;
    if (!h.past.length) return;
    const current = getSnapshot();
    const prev = h.past.pop();
    h.future.push(current);
    applySnapshot(prev);
  }

  function redo() {
    const h = historyRef.current;
    if (!h.future.length) return;
    const current = getSnapshot();
    const next = h.future.pop();
    h.past.push(current);
    applySnapshot(next);
  }

  function parseLen(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number.parseFloat(s); // handles "3.8mm", "800px", "800"
    return Number.isFinite(n) ? n : null;
  }

  function extractSvgEType(rawSvg, fileKey = "") {
    try {
      const doc = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (svg) {
        const direct =
          String(svg.getAttribute("eType") || "").trim() ||
          String(svg.getAttribute("etype") || "").trim() ||
          String(svg.getAttribute("data-etype") || "").trim();
        if (direct) return direct;
        const nested = svg.querySelector("[eType],[etype],[data-etype]");
        const nestedValue =
          String(nested?.getAttribute?.("eType") || "").trim() ||
          String(nested?.getAttribute?.("etype") || "").trim() ||
          String(nested?.getAttribute?.("data-etype") || "").trim();
        if (nestedValue) return nestedValue;
      }
    } catch { }
    return inferETypeFromFileKey(fileKey);
  }

  function extractKeySize(rawSvg) {
    try {
      const doc = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg) return null;

      // ? 1) Root <svg> itself (your Inkscape files store it here)
      const rootW = parseLen(svg.getAttribute("kewidth"));
      const rootH = parseLen(svg.getAttribute("keheight"));
      if (rootW > 0 && rootH > 0) return { w: rootW, h: rootH };

      // ? 2) Any descendant element with kewidth/keheight
      const node = svg.querySelector("[kewidth][keheight]");
      if (node) {
        const w = parseLen(node.getAttribute("kewidth"));
        const h = parseLen(node.getAttribute("keheight"));
        if (w > 0 && h > 0) return { w, h };
      }

      // 3) Fallback: svg width/height (supports units via parseFloat)
      const wAttr = parseLen(svg.getAttribute("width"));
      const hAttr = parseLen(svg.getAttribute("height"));
      if (wAttr > 0 && hAttr > 0) return { w: wAttr, h: hAttr };

      // 4) Fallback: viewBox
      const vb = svg.getAttribute("viewBox");
      if (vb) {
        const parts = vb.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4) {
          const vbW = parts[2];
          const vbH = parts[3];
          if (Number.isFinite(vbW) && Number.isFinite(vbH) && vbW > 0 && vbH > 0) {
            return { w: vbW, h: vbH };
          }
        }
      }
    } catch { }
    return null;
  }



  function rectFrom2Points(a, b) {
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x, b.x);
    const y2 = Math.max(a.y, b.y);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function constrainHV(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    // lock to whichever axis is stronger
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { x: to.x, y: from.y }; // horizontal
    }
    return { x: from.x, y: to.y }; // vertical
  }


  function resetView() {
    const activeId = String(activeScreenIdRef.current || "");
    const sourceScreens = Array.isArray(screensRef.current) ? screensRef.current : [];
    const active = sourceScreens.find((s) => String(s?.id || "") === activeId) || sourceScreens[0] || null;
    const next = normalizeScreenPayload(active || {}, { id: activeId || "screen-1", name: screenNameRef.current || "Screen 1" });
    const rect = svgRef.current?.getBoundingClientRect?.();
    const projectId =
      normalizeTagValue(activeProjectIdRef.current || activeProjectId || readStoredActiveProjectId()) || "";
    const viewportKey = getViewportZoomKey(rect);
    const mappedZoom = viewportKey ? resolveZoomForViewportMap(next?.zoomByViewport, viewportKey) : NaN;
    const cache = readViewportZoomCache();
    const cacheLastKey = getViewportZoomCacheLastKey(projectId, String(next.id || ""));
    const cachedLastZoom = cacheLastKey ? Number(cache[cacheLastKey]) : NaN;
    const cachedZoom = resolveZoomFromViewportCache(
      cache,
      projectId,
      String(next.id || ""),
      viewportKey
    );
    const resolvedZoom = Number.isFinite(cachedLastZoom)
      ? cachedLastZoom
      : Number.isFinite(mappedZoom)
      ? mappedZoom
      : Number.isFinite(cachedZoom)
      ? cachedZoom
      : Number.isFinite(Number(next.designZoom))
      ? Number(next.designZoom)
      : Number.isFinite(Number(next.zoom))
      ? Number(next.zoom)
      : 1;
    setZoom(resolvedZoom);
    zoomRef.current = resolvedZoom;
    setPan(
      next.designPan && Number.isFinite(next.designPan.x) && Number.isFinite(next.designPan.y)
        ? { x: next.designPan.x, y: next.designPan.y }
        : { x: 0, y: 0 }
    );
    const nextScroll =
      next.designScroll && Number.isFinite(next.designScroll.x) && Number.isFinite(next.designScroll.y)
        ? { x: next.designScroll.x, y: next.designScroll.y }
        : { x: 0, y: 0 };
    canvasViewportScrollRef.current = nextScroll;
    setCanvasViewportScrollTarget(nextScroll);
    if (projectId && viewportKey) {
      const nextCache = readViewportZoomCache();
      nextCache[`${projectId}|${String(next.id || "")}|${viewportKey}`] = resolvedZoom;
      const lastKey = getViewportZoomCacheLastKey(projectId, String(next.id || ""));
      if (lastKey) nextCache[lastKey] = resolvedZoom;
      writeViewportZoomCache(nextCache);
    }
  }

  function rectsIntersect(a, b) {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  }

  // ? Mouse wheel zoom handler
  function onWheelZoom(e) {
    const target = e.target;
    const interactiveSelector =
      "[data-widget-control='true'],button,input,select,textarea,label,option";
    if (target && typeof target.closest === "function" && target.closest(interactiveSelector)) {
      return;
    }

    // Ctrl/Cmd + wheel is handled globally in capture phase.
    if (e.ctrlKey || e.metaKey) {
      return;
    }

    e.preventDefault();

    const factor = e.deltaMode === 1 ? 20 : 1; // line ? px

    let dx = 0;
    let dy = 0;

    if (e.shiftKey) {
      // ?? SHIFT = horizontal pan
      dx = e.deltaY * factor;
    } else {
      // normal vertical pan
      dy = e.deltaY * factor;
      dx = e.deltaX * factor; // trackpad horizontal still works
    }

    setPan((p) =>
      clampPanToViewport({
        x: p.x - dx * PAN_SPEED,
        y: p.y - dy * PAN_SPEED,
      })
    );
  };

  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const isCanvasTarget = (target) =>
      !!(target && typeof target.closest === "function" && target.closest("[data-canvas-zoom-root='true']"));

    const onWheelBlockPageZoom = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (!isCanvasTarget(e.target)) return;
      const direction = e.deltaY < 0 ? 1 : -1;
      setZoom((z) => {
        const next = nudgeZoomPercent(z, direction > 0 ? ZOOM_STEP_PERCENT : -ZOOM_STEP_PERCENT);
        setPan((p) => clampPanToViewport(p, next));
        return next;
      });
    };

    const onKeyDownBlockPageZoom = (e) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const k = String(e.key || "").toLowerCase();
      if (!["=", "+", "-", "_", "0"].includes(k)) return;
      if (isCanvasTarget(e.target)) return;
      e.preventDefault();
    };

    const onGestureBlockPageZoom = (e) => {
      if (isCanvasTarget(e.target)) return;
      e.preventDefault();
    };

    window.addEventListener("wheel", onWheelBlockPageZoom, { passive: false, capture: true });
    window.addEventListener("keydown", onKeyDownBlockPageZoom, true);
    window.addEventListener("gesturestart", onGestureBlockPageZoom, { passive: false, capture: true });
    window.addEventListener("gesturechange", onGestureBlockPageZoom, { passive: false, capture: true });
    window.addEventListener("gestureend", onGestureBlockPageZoom, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", onWheelBlockPageZoom, true);
      window.removeEventListener("keydown", onKeyDownBlockPageZoom, true);
      window.removeEventListener("gesturestart", onGestureBlockPageZoom, true);
      window.removeEventListener("gesturechange", onGestureBlockPageZoom, true);
      window.removeEventListener("gestureend", onGestureBlockPageZoom, true);
    };
  }, []);



  const [generatedSvgs, setGeneratedSvgs] = useState([]);
  const persistSvgMeta = async (w, h) => {
    if (!isSingle || singleKind !== "SVG" || !singleId) return;
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    const o = svgOverlays.find((x) => x.id === singleId);
    if (!o?.sourceKey) return;
    if (String(o.sourceKey).startsWith("__generated__/")) return;
    try {
      await saveSvgMeta({
        fileKey: o.sourceKey,
        kewidth: w,
        keheight: h,
      });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("viziGeneratedSvgs");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data)) setGeneratedSvgs(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("viziGeneratedSvgs", JSON.stringify(generatedSvgs));
    } catch {
      // ignore
    }
  }, [generatedSvgs]);

  const generatedSvgMap = useMemo(() => {
    const map = new Map();
    for (const g of generatedSvgs) {
      if (!g?.key || !g?.raw) continue;
      map.set(g.key, g.raw);
    }
    return map;
  }, [generatedSvgs]);

  const svgCatalogMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(svgCatalogFiles) ? svgCatalogFiles : []).forEach((f) => {
      const key = String(f?.key || "").trim();
      if (!key) return;
      map.set(key, {
        key,
        name: String(f?.name || key.split("/").pop() || key).trim(),
        url: String(f?.url || "").trim(),
      });
    });
    return map;
  }, [svgCatalogFiles]);

  const svgLibraryMap = useMemo(() => {
    const obj = {};
    svgCatalogMap.forEach((value, key) => {
      obj[key] = value.url;
    });
    generatedSvgMap.forEach((raw, key) => {
      obj[key] = raw;
    });
    return obj;
  }, [svgCatalogMap, generatedSvgMap]);

  const svgFiles = useMemo(() => {
    const base = Array.from(svgCatalogMap.values()).map((entry) => ({
      key: entry.key,
      name: entry.name || entry.key.split("/").pop() || entry.key,
    }));
    const generated = generatedSvgs.map((g) => ({
      key: g.key,
      name: g.name || g.key.split("/").pop() || g.key,
    }));
    return [...base, ...generated].sort((a, b) => a.name.localeCompare(b.name));
  }, [generatedSvgs, svgCatalogMap]);

  const aiSvgCatalog = useMemo(() => {
    return (Array.isArray(svgFiles) ? svgFiles : [])
      .map((file) => {
        const key = String(file?.key || "").trim();
        const name = String(file?.name || "").trim();
        if (!key || !name) return null;
        const folder = getFolderFromKey(key);
        const tags = tokenizeSvgCatalogText(`${name} ${folder}`);
        return { key, name, tags };
      })
      .filter(Boolean)
      .slice(0, 450);
  }, [svgFiles]);

  const contextGrouped = useMemo(() => {
    const q = String(contextImportQuery || "").trim().toLowerCase();
    const list = Array.isArray(svgFiles) ? svgFiles : [];

    const filtered = list.filter((f) => {
      if (!q) return true;
      const name = String(f?.name || "").toLowerCase();
      const key = String(f?.key || "").toLowerCase();
      return name.includes(q) || key.includes(q);
    });

    const map = new Map();
    for (const f of filtered) {
      const folder = getFolderFromKey(f.key);
      if (!map.has(folder)) map.set(folder, []);
      map.get(folder).push(f);
    }

    const folders = Array.from(map.keys()).sort((a, b) => {
      if (a === "Root") return -1;
      if (b === "Root") return 1;
      const da = a.split(" / ").length;
      const db = b.split(" / ").length;
      if (da !== db) return da - db;
      return a.localeCompare(b);
    });

    return folders.map((folder) => ({
      folder,
      files: map.get(folder).slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [svgFiles, contextImportQuery]);

  const selCount = selectedIds.length + selectedOverlayIds.length;
  const isSingle = selCount === 1;
  const singleSelectedOverlayId =
    selectedOverlayIds.length === 1 && selectedIds.length === 0 ? selectedOverlayIds[0] : null;
  const singleKind = useMemo(() => {
    if (!isSingle) return null;

    if (selectedIds.length === 1) {
      const id = selectedIds[0];
      const s = shapes.find((x) => x.id === id);
      if (!s) return null;

      if (s.type === "text") return "Text";
      if (s.type === "rect" || s.type === "circle") return "Polyline";
      if (s.type === "polyline" || Array.isArray(s.points)) return "Polyline";

      return "Shape";
    }

    if (selectedOverlayIds.length === 1) {
      const id = selectedOverlayIds[0];
      const o = svgOverlays.find((x) => x.id === id);
      if (o?.widget) return "Widget";
      return "SVG";
    }
    return null;
  }, [isSingle, selectedIds, selectedOverlayIds, shapes, svgOverlays]);

  const singleOverlay = useMemo(
    () => svgOverlays.find((o) => o.id === singleSelectedOverlayId),
    [svgOverlays, singleSelectedOverlayId]
  );
  const singleSvgTemplateKey =
    singleOverlay?.sourceKey ||
    svgFiles.find((f) => f.name === (singleOverlay?.name ?? ""))?.key ||
    "";
  const singleGeneratedTemplate = useMemo(
    () => generatedSvgs.find((g) => g.key === singleSvgTemplateKey),
    [generatedSvgs, singleSvgTemplateKey]
  );



  const singleId = useMemo(() => {
    if (!isSingle) return null;
    if (selectedIds.length === 1) return selectedIds[0];
    if (selectedOverlayIds.length === 1) return selectedOverlayIds[0];
    return null;
  }, [isSingle, selectedIds, selectedOverlayIds]);

  function clearSelection() {
    setSelectedIds([]);
    setSelectedOverlayIds([]);
  }

  const preserveSvgSelectionWhileHudOpen =
    showHUD &&
    selectedIds.length === 0 &&
    selectedOverlayIds.length === 1 &&
    !!svgOverlays.find(
      (o) => String(o?.id || "") === String(selectedOverlayIds[0] || "") && !o?.widget
    );

  function isShapeSelectableByMode(shape) {
    if (!shape || typeof shape !== "object") return false;
    if (selectionMode === "all") return true;
    if (selectionMode === "svg") return false;
    return String(shape?.type || "").trim().toLowerCase() === "polyline" || Array.isArray(shape?.points);
  }

  function isShapeIdSelectableByMode(id) {
    const shape = (shapesRef.current || []).find((s) => s?.id === id);
    return isShapeSelectableByMode(shape);
  }

  function areOverlaysSelectableByMode() {
    return selectionMode !== "polyline";
  }

  function selectAll() {
    const allShapeIds = (shapesRef.current || [])
      .filter((s) => isShapeSelectableByMode(s))
      .map((s) => s.id);
    const allOverlayIds = areOverlaysSelectableByMode()
      ? (overlaysRef.current || []).map((o) => o.id)
      : [];
    setSelectedIds(allShapeIds);
    setSelectedOverlayIds(allOverlayIds);
    setTool("select");
    setEditingId(null);
    setSelectedSegment(null);
  }

  function setOverlayRef(id, node) {
    if (!id) return;
    if (node) overlayRefs.current.set(id, node);
    else overlayRefs.current.delete(id);
  }

  function svgPoint(evt, options = {}) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };

    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;

    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };

    const p = pt.matrixTransform(ctm.inverse());

    let x = (p.x - (pan?.x || 0)) / (zoom || 1);
    let y = (p.y - (pan?.y || 0)) / (zoom || 1);

    if (tool === "polyline" && !evt.altKey) {
      const snapRadius = POLYLINE_OVERLAY_SNAP_RADIUS_PX / (zoom || 1);
      let best = null;
      let bestDist = Infinity;
      for (const o of svgOverlays) {
        const bb = overlayLocalBBox(o.id);
        if (!bb) continue;
        const candidates = getOverlayConnectionSnapPoints(o, bb);
        for (const c of candidates) {
          const dx = x - c.x;
          const dy = y - c.y;
          const d = Math.hypot(dx, dy);
          if (d < bestDist) {
            bestDist = d;
            best = c;
          }
        }
      }
      // Also snap to existing polyline vertices for clean joins.
      for (const s of shapesRef.current || []) {
        if (!Array.isArray(s?.points)) continue;
        for (const ptNode of s.points) {
          const px = Number(ptNode?.x);
          const py = Number(ptNode?.y);
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          const dx = x - px;
          const dy = y - py;
          const d = Math.hypot(dx, dy);
          if (d < bestDist) {
            bestDist = d;
            best = { x: px, y: py };
          }
        }
      }
      if (best && bestDist <= snapRadius) {
        x = best.x;
        y = best.y;
      }
    }

    // ? SNAP LOGIC (final)
    // - no modifier ? free
    // - Shift ? snap
    // - Alt ? never snap
    if (evt.shiftKey && !evt.altKey) {
      x = snap(x, GRID);
      y = snap(y, GRID);
    }

    const shouldClamp = options?.clampToCanvas !== false;
    if (!shouldClamp) return { x, y };
    const maxX = Math.max(0, Number(vbW) || 0);
    const maxY = Math.max(0, Number(vbH) || 0);
    return {
      x: Math.max(0, Math.min(maxX, x)),
      y: Math.max(0, Math.min(maxY, y)),
    };
  }

  function getViewportCenterWorldPoint() {
    const svg = svgRef.current;
    if (!svg || typeof svg.getBoundingClientRect !== "function") {
      return { x: vbW / 2, y: vbH / 2 };
    }
    const viewportRect = svg.closest?.(".vizi-scroll")?.getBoundingClientRect?.() || null;
    const rect = viewportRect || svg.getBoundingClientRect();
    const cx = Number(rect?.left) + Number(rect?.width) / 2;
    const cy = Number(rect?.top) + Number(rect?.height) / 2;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      return { x: vbW / 2, y: vbH / 2 };
    }
    return svgPoint({ clientX: cx, clientY: cy, altKey: true });
  }

  function startTextAt(p) {
    pushHistory();
    const id = uid();

    const t = {
      id,
      type: "text",
      x: p.x,
      y: p.y,
      text: "Text",
      fontSize: 24,
      fill: theme === "dark" ? "#ffffff" : "#808080",
      fontFamily: "system-ui",
      fontWeight: "400",
      anchor: "start", // start | middle | end
    };

    setShapes((prev) => [...prev, t]);
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setInlineEdit({ id, value: String(t.text || ""), kind: "shape" });
    setShowHUD(false);
    setTool("select");
  }

  function startRectAt(p) {
    pushHistory();
    const id = uid();
    const rect = {
      id,
      type: "rect",
      x: p.x,
      y: p.y,
      width: 0,
      height: 0,
      stroke: "#808080",
      strokeWidth: 3,
      fill: "transparent",
      lineStyle: "solid",
      tagPath: "",
    };

    setShapes((prev) => [...prev, rect]);
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setDrawing({ mode: "draw-rect", id, start: { x: p.x, y: p.y } });
    setShowHUD(false);
    scheduleProjectAutoSave();
  }


  function exitEditMode() {
    setEditingId(null);
    setDragHandle(null);
    setShapeResize(null);
  }

  function toggleEditMode() {
    if (editingId) {
      exitEditMode();
      return;
    }

    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    const s = shapes.find((x) => x.id === id);
    if (!s || (s.type !== "polyline" && !Array.isArray(s.points))) return;
    setEditingId(id);
  }

  // ---------- Overlay bbox helpers ----------
  function overlayLocalBBox(overlayId) {
    // ? FIRST: use stored bbox if present (this is your kewidth/keheight box)
    const o = svgOverlays.find((x) => x.id === overlayId);
    if (o?.bbox) return o.bbox;

    // then try live DOM bbox
    const node = overlayRefs.current.get(overlayId);
    if (node) {
      try {
        return node.getBBox();
      } catch { }
    }

    return null;
  }

  function overlayScaleX(o) {
    const sx = Number(o?.scaleX);
    if (Number.isFinite(sx) && sx > 0) return sx;
    const s = Number(o?.scale);
    return Number.isFinite(s) && s > 0 ? s : 1;
  }

  function overlayScaleY(o) {
    const sy = Number(o?.scaleY);
    if (Number.isFinite(sy) && sy > 0) return sy;
    const s = Number(o?.scale);
    return Number.isFinite(s) && s > 0 ? s : 1;
  }

  function isConveyorScrewOverlay(overlay) {
    const raw = String(resolveOverlayEType(overlay) || overlay?.eType || "").trim().toLowerCase();
    if (!raw) return false;
    const compact = raw.replace(/[^a-z0-9]/g, "");
    return compact.includes("conveyorscrew") || (compact.includes("conveyor") && compact.includes("screw"));
  }

  function overlayWorldRect(o, bb) {
    const sx = overlayScaleX(o);
    const sy = overlayScaleY(o);
    return {
      x: o.tx + sx * bb.x,
      y: o.ty + sy * bb.y,
      w: sx * bb.width,
      h: sy * bb.height,
    };
  }

  function getOverlayConnectionSnapPoints(overlay, bb) {
    if (!overlay || !bb) return [];
    const wr = overlayWorldRect(overlay, bb);
    const eType = String(resolveOverlayEType(overlay) || overlay?.eType || "").trim().toLowerCase();
    const cx = wr.x + wr.w / 2;
    const cy = wr.y + wr.h / 2;
    if (eType.startsWith("bin")) {
      return [{ x: wr.x + wr.w * 0.42, y: wr.y + wr.h }];
    }
    return [
      { x: cx, y: wr.y },
      { x: wr.x + wr.w, y: cy },
      { x: cx, y: wr.y + wr.h },
      { x: wr.x, y: cy },
    ];
  }

  function snapPointToNearestOverlayConnection(p, threshold = 24) {
    const worldPoint = {
      x: Number(p?.x) || 0,
      y: Number(p?.y) || 0,
    };
    const snapRadius = Math.max(1, Number(threshold) || 24) / Math.max(zoom || 1, 0.0001);
    let best = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const overlay of overlaysRef.current || []) {
      const bb = overlayLocalBBox(overlay?.id);
      if (!bb) continue;
      const candidates = getOverlayConnectionSnapPoints(overlay, bb);
      for (const candidate of candidates) {
        const dx = worldPoint.x - (Number(candidate?.x) || 0);
        const dy = worldPoint.y - (Number(candidate?.y) || 0);
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) {
          bestDist = dist;
          best = { x: Number(candidate?.x) || 0, y: Number(candidate?.y) || 0 };
        }
      }
    }
    if (best && bestDist <= snapRadius) return best;
    return worldPoint;
  }

  function worldFromLocal(o, lx, ly) {
    const sx = overlayScaleX(o);
    const sy = overlayScaleY(o);
    return { x: o.tx + sx * lx, y: o.ty + sy * ly };
  }

  // ---------- Multi-drag ----------
  function beginDragAll(startWorld, nextSelectedIds, nextSelectedOverlayIds) {
    const shapePayload = shapes
      .filter((s) => nextSelectedIds.includes(s.id))
      .map((s) => {
        if (s?.type === "text") {
          return { id: s.id, kind: "text", origX: Number(s.x ?? 0), origY: Number(s.y ?? 0) };
        }
        if (s?.type === "rect" || s?.type === "circle") {
          return {
            id: s.id,
            kind: s.type === "circle" ? "circle" : "rect",
            origX: Number(s.x ?? 0),
            origY: Number(s.y ?? 0),
            origW: Number(s.width ?? 0),
            origH: Number(s.height ?? 0),
          };
        }
        if (Array.isArray(s?.points)) {
          return { id: s.id, kind: "poly", origPoints: s.points.map((p) => ({ ...p })) };
        }
        return null;
      })
      .filter(Boolean);

    const overlayPayload = svgOverlays
      .filter((o) => nextSelectedOverlayIds.includes(o.id))
      .map((o) => ({ id: o.id, origTx: o.tx, origTy: o.ty }));

    if (!shapePayload.length && !overlayPayload.length) return;

    pushHistory();
    setDragAll({ startWorld, shapes: shapePayload, overlays: overlayPayload });
  }



  // ---------- Duplicate ----------
  function getDupOffset() {
    return Math.max(0, Number(duplicateOffsetRef.current) || 0);
  }

  function getSvgEntry(fileKey) {
    if (generatedSvgMap.has(fileKey)) return generatedSvgMap.get(fileKey);
    return svgCatalogMap.get(fileKey)?.url || null;
  }

  function clampOverlayTransformToCanvas(tx, ty, scaleX, scaleY, bbox, bounds = null) {
    const bb = bbox || { x: 0, y: 0, width: 1, height: 1 };
    const sx = Math.max(0.0001, Number(scaleX) || 1);
    const sy = Math.max(0.0001, Number(scaleY) || 1);
    const bw = Math.max(1, Number(bb.width) || 1);
    const bh = Math.max(1, Number(bb.height) || 1);
    const bx = Number(bb.x) || 0;
    const by = Number(bb.y) || 0;
    const canvasW = Math.max(
      1,
      Number(bounds && Number.isFinite(Number(bounds.canvasW)) ? bounds.canvasW : vbW) || 1
    );
    const canvasH = Math.max(
      1,
      Number(bounds && Number.isFinite(Number(bounds.canvasH)) ? bounds.canvasH : vbH) || 1
    );
    // Clamp in SVG world coordinates, not screen/ruler pixels.
    const boundLeft = 0;
    const boundTop = 0;
    const boundRight = Math.max(boundLeft + 1, canvasW);
    const boundBottom = Math.max(boundTop + 1, canvasH);

    let nextTx = Number(tx) || 0;
    let nextTy = Number(ty) || 0;

    const worldW = bw * sx;
    const worldH = bh * sy;

    const boundW = Math.max(1, boundRight - boundLeft);
    const boundH = Math.max(1, boundBottom - boundTop);

    if (worldW <= boundW) {
      const minTx = boundLeft - sx * bx;
      const maxTx = boundRight - sx * (bx + bw);
      nextTx = Math.min(maxTx, Math.max(minTx, nextTx));
    } else {
      // If larger than canvas, keep the overlay anchored to the left edge.
      nextTx = boundLeft - sx * bx;
    }

    if (worldH <= boundH) {
      const minTy = boundTop - sy * by;
      const maxTy = boundBottom - sy * (by + bh);
      nextTy = Math.min(maxTy, Math.max(minTy, nextTy));
    } else {
      // If larger than canvas, keep the overlay anchored to the top edge.
      nextTy = boundTop - sy * by;
    }

    return { tx: nextTx, ty: nextTy };
  }

  function clampExistingOverlaysToCanvasBounds() {
    setSvgOverlays((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (!list.length) return list;
      const canvasW = Math.max(1, Number(vbW) || 1);
      const canvasH = Math.max(1, Number(vbH) || 1);
      const svgRect = svgRef.current?.getBoundingClientRect?.();
      const pxToWorldX =
        svgRect && Number(svgRect.width) > 0 ? canvasW / Number(svgRect.width) : 1;
      const pxToWorldY =
        svgRect && Number(svgRect.height) > 0 ? canvasH / Number(svgRect.height) : 1;
      const topRulerWorld =
        !isLiveMode ? Math.max(0, Number(RULER_SIZE) || 0) * pxToWorldY : 0;
      const rightRulerWorld =
        !isLiveMode ? Math.max(0, Number(RULER_SIZE) || 0) * pxToWorldX : 0;
      const boundLeft = 0;
      const boundTop = topRulerWorld;
      const boundRight = Math.max(boundLeft + 1, canvasW - rightRulerWorld);
      const boundBottom = canvasH;
      const boundW = Math.max(1, boundRight - boundLeft);
      const boundH = Math.max(1, boundBottom - boundTop);

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const o of list) {
        const sx = Number.isFinite(Number(o?.scaleX)) && Number(o?.scaleX) > 0
          ? Number(o.scaleX)
          : Number.isFinite(Number(o?.scale)) && Number(o?.scale) > 0
          ? Number(o.scale)
          : 1;
        const sy = Number.isFinite(Number(o?.scaleY)) && Number(o?.scaleY) > 0
          ? Number(o.scaleY)
          : Number.isFinite(Number(o?.scale)) && Number(o?.scale) > 0
          ? Number(o.scale)
          : 1;
        const bb = o?.bbox || { x: 0, y: 0, width: 1, height: 1 };
        const bx = Number(bb.x) || 0;
        const by = Number(bb.y) || 0;
        const bw = Math.max(1, Number(bb.width) || 1);
        const bh = Math.max(1, Number(bb.height) || 1);
        const tx = Number(o?.tx) || 0;
        const ty = Number(o?.ty) || 0;
        const left = tx + sx * bx;
        const top = ty + sy * by;
        const right = tx + sx * (bx + bw);
        const bottom = ty + sy * (by + bh);
        minX = Math.min(minX, left);
        minY = Math.min(minY, top);
        maxX = Math.max(maxX, right);
        maxY = Math.max(maxY, bottom);
      }

      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return list;
      }

      let dx = 0;
      let dy = 0;
      const snapPad = 8;
      // Only correct when the full overlay set is outside the canvas bounds.
      // This avoids jumpy repositioning while resizing the browser.
      if (maxX < boundLeft) dx = boundLeft - maxX + snapPad;
      else if (minX > boundRight) dx = boundRight - minX - snapPad;

      if (maxY < boundTop) dy = boundTop - maxY + snapPad;
      else if (minY > boundBottom) dy = boundBottom - minY - snapPad;

      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return list;

      return list.map((o) => ({
        ...o,
        tx: (Number(o?.tx) || 0) + dx,
        ty: (Number(o?.ty) || 0) + dy,
      }));
    });
  }

  useEffect(() => {
    let resizeTimer = null;
    const handleResize = () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        clampExistingOverlaysToCanvasBounds();
      }, 260);
    };
    window.addEventListener("resize", handleResize);
    // One pass after layout settles for mode/viewbox changes.
    const t = window.setTimeout(() => clampExistingOverlaysToCanvasBounds(), 260);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeTimer) window.clearTimeout(resizeTimer);
      window.clearTimeout(t);
    };
  }, [isLiveMode, vbW, vbH]);

  function cacheSvgRawByUrl(url, raw) {
    const cache = svgRawCacheRef.current;
    if (!cache) return;
    if (cache.has(url)) cache.delete(url);
    cache.set(url, raw);
    while (cache.size > SVG_RAW_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  async function readSvgRaw(entry, options = {}) {
    if (entry == null) return null;
    const forceFresh = options?.forceFresh === true;
    let value = typeof entry === "function" ? await entry() : entry;
    if (value && typeof value === "object" && typeof value.default === "string") {
      value = value.default;
    }
    if (typeof value !== "string") return null;
    if (isSvgMarkup(value)) return value;
    const url = String(value || "").trim();
    if (!url) return null;
    const cache = svgRawCacheRef.current;
    if (!forceFresh && cache?.has(url)) {
      const hit = cache.get(url);
      cache.delete(url);
      cache.set(url, hit);
      return hit;
    }
    const reqUrl = forceFresh ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : url;
    const raw = await readSvgRawApi(reqUrl, forceFresh);
    cacheSvgRawByUrl(url, raw);
    return raw;
  }

  async function readSvgRawByKey(fileKey, options = {}) {
    return readSvgRaw(getSvgEntry(fileKey), options);
  }

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const syncETypeFromSource = async () => {
      const overlays = Array.isArray(overlaysRef.current) ? overlaysRef.current : [];
      const keys = Array.from(
        new Set(
          overlays
            .filter((o) => isOverlayETypeAutoManaged(o))
            .map((o) => String(o.sourceKey || "").trim())
            .filter(Boolean)
        )
      );
      if (!keys.length) return;
      const pairs = await Promise.all(
        keys.map(async (key) => {
          try {
            const raw = await readSvgRawByKey(key, { forceFresh: import.meta.env.DEV === true });
            const eType = typeof raw === "string" ? extractSvgEType(raw, key) : "";
            return [key, String(eType || "").trim()];
          } catch {
            return [key, ""];
          }
        })
      );
      if (cancelled) return;
      const sourceETypeByKey = new Map(
        pairs.filter(([key, val]) => String(key || "").trim() && String(val || "").trim())
      );
      if (!sourceETypeByKey.size) return;
      setSvgOverlays((prev) => {
        let changed = false;
        const next = (Array.isArray(prev) ? prev : []).map((o) => {
          if (!isOverlayETypeAutoManaged(o)) return o;
          const key = String(o?.sourceKey || "").trim();
          const sourceEType = String(sourceETypeByKey.get(key) || "").trim();
          if (!sourceEType) return o;
          if (String(o?.eType || "").trim() === sourceEType) return o;
          changed = true;
          return { ...o, eType: sourceEType, eTypeAuto: true };
        });
        return changed ? next : prev;
      });
    };
    syncETypeFromSource();
    if (import.meta.env.DEV === true) {
      timer = window.setInterval(syncETypeFromSource, 2500);
    }
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [svgFiles, generatedSvgs]);

  function ensureGeneratedKey(name) {
    const clean = String(name || "Generated.svg").replace(/[\\/:*?"<>|]/g, "_");
    const base = clean.toLowerCase().endsWith(".svg") ? clean : `${clean}.svg`;
    let key = `__generated__/${base}`;
    let i = 2;
    while (generatedSvgMap.has(key) || svgCatalogMap.has(key)) {
      const stem = base.replace(/\.svg$/i, "");
      key = `__generated__/${stem}-${i}.svg`;
      i += 1;
    }
    return key;
  }

  function addGeneratedSvg(name, raw) {
    const key = ensureGeneratedKey(name);
    setGeneratedSvgs((prev) => [
      ...prev,
      { key, name: name || key.split("/").pop(), raw, createdAt: Date.now() },
    ]);
    return key;
  }

  function renameGeneratedSvg(key, nextName) {
    const name = String(nextName || "").trim();
    if (!name) return;
    setGeneratedSvgs((prev) =>
      prev.map((g) => (g.key === key ? { ...g, name } : g))
    );
    setSvgOverlays((prev) =>
      prev.map((o) => (o.sourceKey === key ? { ...o, name } : o))
    );
  }

  async function buildOverlayFromKey(fileKey, center, targetW) {
    const entry = getSvgEntry(fileKey);
    const fallbackEType = inferETypeFromFileKey(fileKey);
    if (!entry) {
      const w = Math.max(40, Number(targetW) || 120);
      const h = Math.max(30, w * 0.6);
      const bbox = { x: 0, y: 0, width: w, height: h };
      const clamped = clampOverlayTransformToCanvas(center.x - w / 2, center.y - h / 2, 1, 1, bbox);
      return {
        id: uid(),
        sourceKey: fileKey || "__unknown__",
        name: fileKey ? fileKey.split("/").pop() || fileKey : "Unknown",
        inner: `<rect x="0" y="0" width="${w}" height="${h}" fill="${DEFAULT_FILL}" stroke="${DEFAULT_STROKE}" stroke-width="2" />`,
        tx: clamped.tx,
        ty: clamped.ty,
        scale: 1,
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        tagPath: "",
        eType: fallbackEType,
        eTypeAuto: true,
        bbox,
      };
    }

    const raw = await readSvgRaw(entry, { forceFresh: import.meta.env.DEV === true });
    if (typeof raw !== "string") {
      const w = Math.max(40, Number(targetW) || 120);
      const h = Math.max(30, w * 0.6);
      const bbox = { x: 0, y: 0, width: w, height: h };
      const clamped = clampOverlayTransformToCanvas(center.x - w / 2, center.y - h / 2, 1, 1, bbox);
      return {
        id: uid(),
        sourceKey: fileKey || "__unknown__",
        name: fileKey ? fileKey.split("/").pop() || fileKey : "Unknown",
        inner: `<rect x="0" y="0" width="${w}" height="${h}" fill="${DEFAULT_FILL}" stroke="${DEFAULT_STROKE}" stroke-width="2" />`,
        tx: clamped.tx,
        ty: clamped.ty,
        scale: 1,
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        tagPath: "",
        eType: fallbackEType,
        eTypeAuto: true,
        bbox,
      };
    }

    const parsed = stripOuterSvg(raw);
    if (!parsed) {
      const w = Math.max(40, Number(targetW) || 120);
      const h = Math.max(30, w * 0.6);
      const bbox = { x: 0, y: 0, width: w, height: h };
      const clamped = clampOverlayTransformToCanvas(center.x - w / 2, center.y - h / 2, 1, 1, bbox);
      return {
        id: uid(),
        sourceKey: fileKey || "__unknown__",
        name: fileKey ? fileKey.split("/").pop() || fileKey : "Unknown",
        inner: `<rect x="0" y="0" width="${w}" height="${h}" fill="${DEFAULT_FILL}" stroke="${DEFAULT_STROKE}" stroke-width="2" />`,
        tx: clamped.tx,
        ty: clamped.ty,
        scale: 1,
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        tagPath: "",
        eType: fallbackEType,
        eTypeAuto: true,
        bbox,
      };
    }

    const key = extractKeySize(raw);
    const eType = extractSvgEType(raw, fileKey);
    const hasKey = !!(key && key.w > 0 && key.h > 0);
    const baseVb = parsed.vb;
    let localVb = key ? { x: 0, y: 0, w: key.w, h: key.h } : baseVb;
    if (!localVb || !Number.isFinite(localVb.w) || !Number.isFinite(localVb.h) || localVb.w <= 0 || localVb.h <= 0) {
      localVb = { x: 0, y: 0, w: 100, h: 100 };
    }

    let inner = parsed.inner;
    if (key && baseVb?.w > 0 && baseVb?.h > 0) {
      const sx = key.w / baseVb.w;
      const sy = key.h / baseVb.h;
      inner = `
      <g transform="translate(${-baseVb.x},${-baseVb.y}) scale(${sx},${sy})">
        ${parsed.inner}
      </g>
    `;
    }

    const srcW = Math.max(localVb.w, 1);
    const scale = hasKey ? 1 : targetW ? Math.max(0.01, targetW / srcW) : 1;
    const srcCx = localVb.x + localVb.w / 2;
    const srcCy = localVb.y + localVb.h / 2;
    const tx = center.x - scale * srcCx;
    const ty = center.y - scale * srcCy;

    const bbox = { x: localVb.x, y: localVb.y, width: localVb.w, height: localVb.h };
    const clamped = clampOverlayTransformToCanvas(tx, ty, scale, scale, bbox);
    return {
      id: uid(),
      sourceKey: fileKey,
      name: fileKey.split("/").pop() || fileKey,
      inner,
      tx: clamped.tx,
      ty: clamped.ty,
      scale,
      fill: DEFAULT_FILL,
      stroke: DEFAULT_STROKE,
      tagPath: "",
      eType,
      eTypeAuto: true,
      bbox,
    };
  }

  function layoutPoint(p, origin, scale) {
    return { x: origin.x + p.x * scale, y: origin.y + p.y * scale };
  }

  async function autoLayoutPage1(targetRect) {
    const baseW = 1600;
    const baseH = 900;
    const scale = targetRect
      ? Math.min(targetRect.w / baseW, targetRect.h / baseH)
      : 1;
    const origin = targetRect ? { x: targetRect.x, y: targetRect.y } : { x: 0, y: 0 };

    const placements = [];
    const leftStartX = 200;
    const leftY = 360;
    const leftGap = 90;
    const leftW = 70;
    const leftBins = [
      "Terra_Bin_Skinny.svg",
      "Terra_Bin_Skinny.svg",
      "Terra_Bin_Skinny.svg",
      "Terra_Bin_Skinny.svg",
      "Terra_Bin_Skinny.svg",
      "Terra_Bin_Skinny.svg",
    ];

    leftBins.forEach((key, i) => {
      placements.push({
        key: `./assets/SVG_Files/${key}`,
        center: layoutPoint({ x: leftStartX + i * leftGap, y: leftY }, origin, scale),
        w: leftW * scale,
      });
    });

    // right top bins (51/52)
    placements.push({
      key: "./assets/SVG_Files/Terra_Bin_Skinny.svg",
      center: layoutPoint({ x: 1080, y: 260 }, origin, scale),
      w: 90 * scale,
    });
    placements.push({
      key: "./assets/SVG_Files/Terra_Bin_Skinny.svg",
      center: layoutPoint({ x: 1180, y: 260 }, origin, scale),
      w: 90 * scale,
    });

    // right bottom bank
    const rightStartX = 980;
    const rightY = 560;
    const rightGap = 70;
    const rightW = 60;
    for (let i = 0; i < 8; i++) {
      placements.push({
        key: "./assets/SVG_Files/Terra_Bin_Skinny.svg",
        center: layoutPoint({ x: rightStartX + i * rightGap, y: rightY }, origin, scale),
        w: rightW * scale,
      });
    }

    // center equipment column (approximate)
    placements.push({
      key: "./assets/SVG_Files/BlowerSimple.svg",
      center: layoutPoint({ x: 740, y: 700 }, origin, scale),
      w: 80 * scale,
    });
    placements.push({
      key: "./assets/SVG_Files/Cyclone.svg",
      center: layoutPoint({ x: 720, y: 520 }, origin, scale),
      w: 90 * scale,
    });
    placements.push({
      key: "./assets/SVG_Files/FilterBinTop.svg",
      center: layoutPoint({ x: 740, y: 420 }, origin, scale),
      w: 90 * scale,
    });

    const overlays = (await Promise.all(
      placements.map((p) => buildOverlayFromKey(p.key, p.center, p.w))
    )).filter(Boolean);

    if (!overlays.length) return;

    pushHistory();
    setSvgOverlays((prev) => [...prev, ...overlays]);
    setSelectedIds([]);
    setSelectedOverlayIds(overlays.map((o) => o.id));
    setShowHUD(false);

    const line = (pts) => ({
      id: uid(),
      type: "polyline",
      points: pts,
      stroke: DEFAULT_STROKE,
      strokeWidth: 3,
      lineStyle: "solid",
      arrowStart: "none",
      arrowEnd: "none",
    });

    const newLines = [
      line([layoutPoint({ x: 160, y: 240 }, origin, scale), layoutPoint({ x: 700, y: 240 }, origin, scale), layoutPoint({ x: 700, y: 520 }, origin, scale)]),
      line([layoutPoint({ x: 700, y: 520 }, origin, scale), layoutPoint({ x: 900, y: 520 }, origin, scale)]),
      line([layoutPoint({ x: 900, y: 520 }, origin, scale), layoutPoint({ x: 1470, y: 520 }, origin, scale)]),
      line([layoutPoint({ x: 980, y: 320 }, origin, scale), layoutPoint({ x: 1180, y: 320 }, origin, scale)]),
      line([layoutPoint({ x: 980, y: 320 }, origin, scale), layoutPoint({ x: 980, y: 500 }, origin, scale)]),
      line([layoutPoint({ x: 1180, y: 320 }, origin, scale), layoutPoint({ x: 1180, y: 500 }, origin, scale)]),
      line([layoutPoint({ x: 160, y: 300 }, origin, scale), layoutPoint({ x: 700, y: 300 }, origin, scale)]),
    ];

    setShapes((prev) => [...prev, ...newLines]);
  }


  function getSelectionBoxes(curShapes, curOverlays, selShapes, selOvers) {
    const items = [];

    for (const id of selShapes) {
      const s = curShapes.find((x) => x.id === id);
      if (!s) continue;

      if (s.type === "text") {
        const tb = textBoxFromShape(s);
        if (!tb) continue;
        items.push({
          x: tb.x,
          y: tb.y,
          w: tb.w,
          h: tb.h,
        });
        continue;
      }

      if (s.type === "rect" || s.type === "circle") {
        items.push({
          x: Number(s.x ?? 0),
          y: Number(s.y ?? 0),
          w: Math.max(0, Number(s.width ?? 0)),
          h: Math.max(0, Number(s.height ?? 0)),
        });
        continue;
      }

      if (Array.isArray(s.points)) {
        const bb = bboxOfPoints(s.points);
        if (!bb) continue;
        items.push({ x: bb.minX, y: bb.minY, w: bb.w, h: bb.h });
      }
    }

    for (const id of selOvers) {
      const o = curOverlays.find((x) => x.id === id);
      if (!o) continue;
      const bb = overlayLocalBBox(id);
      if (!bb) continue;
      const wr = overlayWorldRect(o, bb);
      items.push({
        x: wr.x,
        y: wr.y,
        w: wr.w,
        h: wr.h,
      });
    }

    return items;
  }

  function duplicateSelected() {
    const pad = getDupOffset();
    if (!selectedIds.length && !selectedOverlayIds.length) return;
    if (!selectedBBox) return;

    const items = getSelectionBoxes(shapes, svgOverlays, selectedIds, selectedOverlayIds);
    let refW = Math.max(0, selectedBBox.w);
    if (items.length) {
      const leftmost = items.reduce((a, b) => (b.x < a.x ? b : a), items[0]);
      refW = Math.max(0, leftmost.w);
    }
    const dx = refW + pad;

    pushHistory();

    const shapeDups = shapes
      .filter((s) => selectedIds.includes(s.id))
      .map((s) => {
        const id = uid();

        // text
        if (s.type === "text") {
          return { ...s, id, x: Number(s.x ?? 0) + dx, y: Number(s.y ?? 0) };
        }

        if (s.type === "rect" || s.type === "circle") {
          return { ...s, id, x: Number(s.x ?? 0) + dx, y: Number(s.y ?? 0) };
        }

        // polyline (or any shape with points)
        if (Array.isArray(s.points)) {
          return {
            ...s,
            id,
            points: clonePoints(s.points).map((p) => ({ x: p.x + dx, y: p.y })),
          };
        }

        return null;
      })
      .filter(Boolean);

    const overlayDups = svgOverlays
      .filter((o) => selectedOverlayIds.includes(o.id))
      .map((o) => {
        const id = uid();
        return { ...o, id, tx: o.tx + dx, ty: o.ty };
      });

    if (shapeDups.length) setShapes((prev) => [...prev, ...shapeDups]);
    if (overlayDups.length) setSvgOverlays((prev) => [...prev, ...overlayDups]);

    setSelectedIds(shapeDups.map((s) => s.id));
    setSelectedOverlayIds(overlayDups.map((o) => o.id));

    exitEditMode();
    setDrawing(null);
    setTool("select");
    scheduleProjectAutoSave(120);
  }


  function duplicateSelectedStable() {
    const pad = getDupOffset();

    const refShapes = Array.isArray(shapesRef.current) ? shapesRef.current : [];
    const refOverlays = Array.isArray(overlaysRef.current) ? overlaysRef.current : [];
    const refSelShapes = Array.isArray(selPolyRef.current) ? selPolyRef.current : [];
    const refSelOvers = Array.isArray(selOverRef.current) ? selOverRef.current : [];
    const curShapes = refShapes.length ? refShapes : shapes;
    const curOverlays = refOverlays.length ? refOverlays : svgOverlays;
    const curSelShapes = refSelShapes.length ? refSelShapes : selectedIds;
    const curSelOvers = refSelOvers.length ? refSelOvers : selectedOverlayIds;

    if (!curSelShapes.length && !curSelOvers.length) return;

    const boxes = getSelectionBoxes(curShapes, curOverlays, curSelShapes, curSelOvers);
    if (!boxes.length) return;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const b of boxes) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }

    const groupW = Math.max(0, maxX - minX);
    let refW = groupW;
    if (boxes.length) {
      const leftmost = boxes.reduce((a, b) => (b.x < a.x ? b : a), boxes[0]);
      refW = Math.max(0, leftmost.w);
    }

    const dx = refW + pad; // ? width of leftmost element + offset

    // build duplicates
    pushHistory();

    const shapeDups = curShapes
      .filter((s) => curSelShapes.includes(s.id))
      .map((s) => {
        const id = uid();

        // ? Text duplicate (shift right only)
        if (s.type === "text") {
          return { ...s, id, x: Number(s.x ?? 0) + dx, y: Number(s.y ?? 0) };
        }

        if (s.type === "rect" || s.type === "circle") {
          return { ...s, id, x: Number(s.x ?? 0) + dx, y: Number(s.y ?? 0) };
        }

        // ? Polyline duplicate
        if (Array.isArray(s.points)) {
          return {
            ...s,
            id,
            points: clonePoints(s.points).map((p) => ({ x: p.x + dx, y: p.y })),
          };
        }

        return null;
      })
      .filter(Boolean);

    const overlayDups = curOverlays
      .filter((o) => curSelOvers.includes(o.id))
      .map((o) => {
        const id = uid();
        return { ...o, id, tx: o.tx + dx, ty: o.ty }; // ? keep Y
      });

    if (shapeDups.length) setShapes((prev) => [...prev, ...shapeDups]);
    if (overlayDups.length) setSvgOverlays((prev) => [...prev, ...overlayDups]);

    // ? IMPORTANT: set selection AFTER state applies (so next Ctrl+D sees selection)
    queueMicrotask(() => {
      setSelectedIds(shapeDups.map((s) => s.id));
      setSelectedOverlayIds(overlayDups.map((o) => o.id));
    });

    exitEditMode();
    setDrawing(null);
    setTool("select");
    scheduleProjectAutoSave(120);
  }

  function handleDuplicate() {
    duplicateSelectedStable();
  }

  function copySelection() {
    const refShapes = Array.isArray(shapesRef.current) ? shapesRef.current : [];
    const refOverlays = Array.isArray(overlaysRef.current) ? overlaysRef.current : [];
    const refSelShapes = Array.isArray(selPolyRef.current) ? selPolyRef.current : [];
    const refSelOvers = Array.isArray(selOverRef.current) ? selOverRef.current : [];
    const curShapes = refShapes.length ? refShapes : shapes;
    const curOverlays = refOverlays.length ? refOverlays : svgOverlays;
    const curSelShapes = refSelShapes.length ? refSelShapes : selectedIds;
    const curSelOvers = refSelOvers.length ? refSelOvers : selectedOverlayIds;

    const shapesCopy = curShapes
      .filter((s) => curSelShapes.includes(s.id))
      .map((s) => deepClone(s));

    const overlaysCopy = curOverlays
      .filter((o) => curSelOvers.includes(o.id))
      .map((o) => deepClone(o));

    if (!shapesCopy.length && !overlaysCopy.length) return;

    clipboardRef.current = { shapes: shapesCopy, overlays: overlaysCopy, pasteCount: 0 };
  }

  function pasteClipboard() {
    const clip = clipboardRef.current;
    if (!clip || (!clip.shapes.length && !clip.overlays.length)) return;

    const n = (clip.pasteCount ?? 0) + 1;
    const dx = lastContextPoint ? 0 : 20 * n;
    const dy = lastContextPoint ? 0 : 20 * n;

    pushHistory();

    let offsetX = dx;
    let offsetY = dy;
    if (lastContextPoint) {
      const boxes = [];
      for (const s of clip.shapes) {
        if (s.type === "text") {
          const tb = textBoxFromShape(s);
          if (!tb) continue;
          boxes.push({
            x: tb.x,
            y: tb.y,
            w: tb.w,
            h: tb.h,
          });
        } else if (s.type === "rect" || s.type === "circle") {
          boxes.push({
            x: Number(s.x ?? 0),
            y: Number(s.y ?? 0),
            w: Math.max(0, Number(s.width ?? 0)),
            h: Math.max(0, Number(s.height ?? 0)),
          });
        } else if (Array.isArray(s.points)) {
          const bb = bboxOfPoints(s.points);
          if (bb) boxes.push({ x: bb.minX, y: bb.minY, w: bb.w, h: bb.h });
        }
      }
      for (const o of clip.overlays) {
        const bb = o.bbox || overlayLocalBBox(o.id);
        if (!bb) continue;
        const wr = overlayWorldRect(o, bb);
        boxes.push({
          x: wr.x,
          y: wr.y,
          w: wr.w,
          h: wr.h,
        });
      }
      if (boxes.length) {
        let minX = Infinity, minY = Infinity;
        for (const b of boxes) {
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
        }
        offsetX = lastContextPoint.x - minX;
        offsetY = lastContextPoint.y - minY;
      }
    }

    const shapeDups = clip.shapes
      .map((s) => {
        const id = uid();
        if (s.type === "text") {
          return { ...s, id, x: Number(s.x ?? 0) + offsetX, y: Number(s.y ?? 0) + offsetY };
        }
        if (s.type === "rect" || s.type === "circle") {
          return { ...s, id, x: Number(s.x ?? 0) + offsetX, y: Number(s.y ?? 0) + offsetY };
        }
        if (Array.isArray(s.points)) {
          return {
            ...s,
            id,
            points: clonePoints(s.points).map((p) => ({ x: p.x + offsetX, y: p.y + offsetY })),
          };
        }
        return null;
      })
      .filter(Boolean);

    const overlayDups = clip.overlays.map((o) => {
      const id = uid();
      return { ...o, id, tx: o.tx + offsetX, ty: o.ty + offsetY };
    });

    if (shapeDups.length) setShapes((prev) => [...prev, ...shapeDups]);
    if (overlayDups.length) setSvgOverlays((prev) => [...prev, ...overlayDups]);

    setSelectedIds(shapeDups.map((s) => s.id));
    setSelectedOverlayIds(overlayDups.map((o) => o.id));

    clip.pasteCount = n;
    exitEditMode();
    setDrawing(null);
    setTool("select");
  }



  // ---------- Polyline drawing/editing ----------
  function startPolylineAt(p, options = {}) {
    pushHistory();
    const disableSnap = options?.disableSnap === true;
    const startPoint = disableSnap
      ? { x: Number(p?.x) || 0, y: Number(p?.y) || 0 }
      : snapPointToNearestPolylineConnection(
          snapPointToNearestPolylineEndpoint(p, POLYLINE_ENDPOINT_SNAP_THRESHOLD),
          POLYLINE_CONNECTION_SNAP_THRESHOLD
        );
    const id = uid();
    const poly = {
      id,
      type: "polyline",
      tagPath: "", // ? NEW
      points: [startPoint, { x: startPoint.x, y: startPoint.y }], // last is preview
      stroke: "#808080",
      fill: "transparent",
      strokeWidth: 3,
      lineStyle: "solid",
    };

    setShapes((prev) => [...prev, poly]);
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setDrawing({ mode: "draw-poly", id });
    setShowHUD(false);
    scheduleProjectAutoSave();
  }

  function addPolylinePoint(p, options = {}) {
    pushHistory();
    if (!drawing || drawing.mode !== "draw-poly") return;
    const id = drawing.id;
    const disableSnap = options?.disableSnap === true;

    setShapes((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;

        const fixed = s.points.slice(0, -1);
        const lastFixed = fixed[fixed.length - 1];
        const firstFixed = fixed[0];
        const SNAP_DIST = 12;
        let nextP = { x: Number(p?.x) || 0, y: Number(p?.y) || 0 };
        if (!disableSnap) {
          nextP = snapPointToNearestPolylineConnection(nextP, POLYLINE_CONNECTION_SNAP_THRESHOLD);
          nextP = snapPointToNearestPolylineEndpoint(nextP, POLYLINE_ENDPOINT_SNAP_THRESHOLD, {
            excludeShapeId: id,
            excludeIndexes: [0, fixed.length],
          });
        }
        if (firstFixed && distance(p, firstFixed) <= SNAP_DIST) {
          nextP = { x: firstFixed.x, y: firstFixed.y };
        }

        const newFixed =
          lastFixed && lastFixed.x === nextP.x && lastFixed.y === nextP.y ? fixed : [...fixed, nextP];

        const tail = newFixed[newFixed.length - 1];
        return { ...s, points: [...newFixed, { x: tail.x, y: tail.y }] };
      })
    );
  }

  function projectPointToSegmentForSplit(pt, a, b) {
    const px = Number(pt?.x) || 0;
    const py = Number(pt?.y) || 0;
    const ax = Number(a?.x) || 0;
    const ay = Number(a?.y) || 0;
    const bx = Number(b?.x) || 0;
    const by = Number(b?.y) || 0;
    const abx = bx - ax;
    const aby = by - ay;
    const ab2 = abx * abx + aby * aby;
    if (ab2 <= 1e-9) {
      const dx = px - ax;
      const dy = py - ay;
      return { point: { x: ax, y: ay }, t: 0, dist2: dx * dx + dy * dy };
    }
    const apx = px - ax;
    const apy = py - ay;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
    const qx = ax + abx * t;
    const qy = ay + aby * t;
    const dx = px - qx;
    const dy = py - qy;
    return { point: { x: qx, y: qy }, t, dist2: dx * dx + dy * dy };
  }

  function splitConnectedPolylineSegments(shapeList, sourcePolylineId = "") {
    const list = Array.isArray(shapeList) ? shapeList : [];
    const sourceId = String(sourcePolylineId || "").trim();
    const threshold = 18 / Math.max(zoom || 1, 0.0001);
    let changed = false;
    const result = [];

    for (const shape of list) {
      if (!(String(shape?.type || "").toLowerCase() === "polyline" || Array.isArray(shape?.points))) {
        result.push(shape);
        continue;
      }
      const shapeId = String(shape?.id || "");
      const pts = Array.isArray(shape?.points) ? shape.points : [];
      if (!shapeId || pts.length < 2 || shapeId === sourceId) {
        result.push(shape);
        continue;
      }

      let bestSplit = null;
      for (const other of list) {
        const otherId = String(other?.id || "");
        if (!otherId || otherId === shapeId) continue;
        const otherPts = Array.isArray(other?.points) ? other.points : [];
        if (otherPts.length < 2) continue;
        const endpoints = [otherPts[0], otherPts[otherPts.length - 1]];
        for (const endpoint of endpoints) {
          if (!endpoint) continue;
          for (let i = 0; i < pts.length - 1; i += 1) {
            const a = pts[i];
            const b = pts[i + 1];
            const proj = projectPointToSegmentForSplit(endpoint, a, b);
            if (proj.dist2 > threshold * threshold) continue;
            if (proj.t <= 0.08 || proj.t >= 0.92) continue;
            if (!bestSplit || proj.dist2 < bestSplit.dist2) {
              bestSplit = {
                segmentIndex: i,
                point: { x: Number(proj.point?.x) || 0, y: Number(proj.point?.y) || 0 },
                dist2: proj.dist2,
              };
            }
          }
        }
      }

      if (!bestSplit) {
        result.push(shape);
        continue;
      }

      const insertAt = Math.max(0, Math.min(pts.length - 2, Number(bestSplit.segmentIndex) || 0));
      const splitPoint = bestSplit.point;
      const nextPoints = [
        ...pts.slice(0, insertAt + 1),
        splitPoint,
        ...pts.slice(insertAt + 1),
      ];
      result.push({ ...shape, points: nextPoints });
      changed = true;
    }

    return changed ? result : list;
  }

  useEffect(() => {
    if (splitNormalizeInFlightRef.current) return;
    if (skipNextSplitNormalizeRef.current) {
      skipNextSplitNormalizeRef.current = false;
      return;
    }
    if (drawing || dragHandle || dragAll || shapeResize || overlayResize) return;
    const normalized = splitConnectedPolylineSegments(shapesRef.current || []);
    if (normalized === (shapesRef.current || [])) return;
    splitNormalizeInFlightRef.current = true;
    setShapes(normalized);
    shapesRef.current = normalized;
    window.setTimeout(() => {
      splitNormalizeInFlightRef.current = false;
    }, 0);
  }, [shapes, drawing, dragHandle, dragAll, shapeResize, overlayResize]);

  function finishPolyline() {
    pushHistory();
    if (!drawing || drawing.mode !== "draw-poly") return;
    const id = drawing.id;
    // Prevent immediate background re-split pass from nudging the just-committed endpoint.
    skipNextSplitNormalizeRef.current = true;

    setShapes((prev) => {
      const finished = prev.flatMap((s) => {
        // keep everything else (including text)
        if (s.id !== id) return [s];

        // only polylines can be finished here
        if (s.type !== "polyline" || !Array.isArray(s.points)) return [s];

        const fixed = s.points.slice(0, -1);
        const preview = s.points[s.points.length - 1];
        const lastFixed = fixed[fixed.length - 1];
        const finalPoints =
          preview &&
          (!lastFixed ||
            Math.hypot(
              (Number(preview?.x) || 0) - (Number(lastFixed?.x) || 0),
              (Number(preview?.y) || 0) - (Number(lastFixed?.y) || 0)
            ) > 0.001)
            ? [...fixed, { x: Number(preview?.x) || 0, y: Number(preview?.y) || 0 }]
            : fixed;

        // if too short, drop ONLY this polyline
        if (finalPoints.length < 2) return [];

        return [{ ...s, points: finalPoints }];
      });
      const normalized = splitConnectedPolylineSegments(finished, id);
      shapesRef.current = normalized;
      return normalized;
    });

    setDrawing(null);
    clearSelection();
    scheduleProjectAutoSave();
  }


  function cancelPolyline() {
    pushHistory();
    if (!drawing || drawing.mode !== "draw-poly") return;
    const id = drawing.id;

    setShapes((prev) => prev.filter((s) => s.id !== id));
    setDrawing(null);
    clearSelection();
    setTool("select");
  }

  function deleteSelected() {
    const hasShapeSelection = selectedIds.length > 0;
    const hasOverlaySelection = selectedOverlayIds.length > 0;
    if (!hasShapeSelection && !hasOverlaySelection) return;
    pushHistory();
    if (selectedIds.length) {
      setShapes((prev) => prev.filter((s) => !selectedIds.includes(s.id)));
      if (editingId && selectedIds.includes(editingId)) setEditingId(null);
    }
    if (selectedOverlayIds.length) {
      setSvgOverlays((prev) => prev.filter((o) => !selectedOverlayIds.includes(o.id)));
    }
    clearSelection();
    exitEditMode();
    scheduleProjectAutoSave();
  }

  function onShapeMouseDown(e, id) {
    if (tool !== "select") return;
    if (!isShapeIdSelectableByMode(id)) return;
    e.stopPropagation();

    if (editingId === id) {
      if (e.shiftKey) {
        setSelectedIds((prev) => toggleIn(prev, id));
        return;
      }
      setSelectedIds([id]);
      setSelectedOverlayIds([]);
      return;
    }

    if (e.shiftKey) {
      setSelectedIds((prev) => toggleIn(prev, id));
      return;
    }

    const isAlreadySelected = selectedIds.includes(id);
    if (!isAlreadySelected) {
      setSelectedIds([id]);
      setSelectedOverlayIds([]);
      return;
    }

    const p =
      tool === "circle" && e.altKey
        ? svgPoint(e, { clampToCanvas: false })
        : svgPoint(e);
    beginDragAll(p, selectedIds, selectedOverlayIds);
  }

  function onShapeDoubleClick(e, id) {
    if (tool !== "select") return;
    if (!isShapeIdSelectableByMode(id)) return;
    e.stopPropagation();
    e.preventDefault();
    const p = svgPoint(e);

    const s = shapes.find((x) => x.id === id);
    if (s?.type === "text") {
      setSelectedIds([id]);
      setSelectedOverlayIds([]);
      setEditingId(null);
      setInlineEdit({ id, value: String(s.text || ""), kind: "shape" });
      setShowHUD(false);
      return;
    }

    // existing polyline logic...
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(id);
    setDrawing(null);
  }


  function insertPointOnPolyline(id, p) {
    setShapes((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const pts = s.points;
        if (pts.length < 2) return s;

        let best = { i: 0, d2: Infinity, cp: null };

        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const cp = closestPointOnSegment(p, a, b);
          const d = dist2(p, cp);
          if (d < best.d2) best = { i, d2: d, cp };
        }

        const insertAt = best.i + 1;
        const newPt = { x: best.cp.x, y: best.cp.y };
        const next = pts.slice(0, insertAt).concat([newPt], pts.slice(insertAt));
        return { ...s, points: next };
      })
    );
  }

  function removeVertex(id, index) {
    setShapes((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (s.points.length <= 2) return s;
        const next = s.points.slice();
        next.splice(index, 1);
        return { ...s, points: next };
      })
    );
  }

  // function onCanvasDoubleClick(e) {
  //   // don't set marker while drawing
  //   if (tool === "polyline") return;

  //   e.preventDefault();
  //   e.stopPropagation();

  //   const p = svgPoint(e);      // uses clientX/clientY ? world coords
  //   setImportAnchor(p);
  //   console.log("IMPORT MARKER SET:", p);
  // }

  function onHandleMouseDown(e, id, index) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    pushHistory();
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(id);
    setDragHandle({ id, index });
    setSelectedSegment({ id, index, kind: "point" });
  }


  function onHandleDoubleClick(e, id, index) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    removeVertex(id, index);
    setSelectedSegment(null);
  }

  function onHandleContextMenu(e, id, index) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    setPolyHandleMenu({
      x: e.clientX,
      y: e.clientY,
      id,
      index,
    });
    setContextMenu(null);
  }

  function onEditPolylineClick(e, id) {
    if (tool !== "select") return;
    if (editingId !== id) return;
    e.stopPropagation();
    const p = svgPoint(e);
    insertPointOnPolyline(id, p);
    setSelectedSegment(null);
  }

  function onSegmentMouseDown(e, id, index) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    if (e.altKey) {
      const p = svgPoint(e);
      insertPointOnPolyline(id, p);
      setSelectedSegment(null);
      return;
    }
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(id);
    setSelectedSegment({ id, index, kind: "point" });
  }

  // ---------- Overlay selection / move / resize ----------
  function onOverlayMouseDown(e, id) {
    if (tool !== "select") return;
    if (!areOverlaysSelectableByMode()) return;
    if (Number(e?.detail || 0) > 1) return; // let double-click open properties in Move mode
    const target = e.target;
    const interactiveSelector = "[data-widget-control='true'],button,input,select,textarea,label,option";
    if (isLiveMode && target && typeof target.closest === "function") {
      if (target.closest(interactiveSelector)) return;
    }
    const nativeEvent = e.nativeEvent;
    if (isLiveMode && nativeEvent && typeof nativeEvent.composedPath === "function") {
      const path = nativeEvent.composedPath();
      const hitInteractive = path.some((node) => {
        if (!node || typeof node !== "object") return false;
        const el = node;
        if (typeof el.matches === "function" && el.matches(interactiveSelector)) return true;
        return false;
      });
      if (hitInteractive) return;
    }
    e.stopPropagation();
    e.preventDefault();
    const p = svgPoint(e);

    if (e.shiftKey) {
      setSelectedOverlayIds((prev) => toggleIn(prev, id));
      exitEditMode();
      setDrawing(null);
      return;
    }

    const isAlreadySelected = selectedOverlayIds.includes(id);
    if (!isAlreadySelected) {
      setSelectedOverlayIds([id]);
      setSelectedIds([]);
      exitEditMode();
      setDrawing(null);
      beginDragAll(p, [], [id]);
      return;
    }

    exitEditMode();
    setDrawing(null);

    beginDragAll(p, selectedIds, selectedOverlayIds);
  }

  function onOverlayDoubleClick(e, id) {
    if (!areOverlaysSelectableByMode()) return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedOverlayIds([id]);
    setSelectedIds([]);
    setEditingId(null);
    setInlineEdit(null);
    setPanelCursor({ x: e.clientX, y: e.clientY });
    setShowHUD(true);
  }

  function onOverlayHandleDown(e, id, corner) {
    if (tool !== "select") return;
    if (!areOverlaysSelectableByMode()) return;
    e.stopPropagation();
    e.preventDefault();

    if (e.altKey) {
      // Alt = move overlay instead of resize
      setSelectedOverlayIds([id]);
      setSelectedIds([]);
      exitEditMode();
      setDrawing(null);

      const p = svgPoint(e);
      beginDragAll(p, [], [id]);
      return;
    }

    setSelectedOverlayIds([id]);
    setSelectedIds([]);
    exitEditMode();

    const p = svgPoint(e);
    const o = svgOverlays.find((x) => x.id === id);
    if (!o) return;

    const bb = overlayLocalBBox(id);
    if (!bb) return;

    const TL = { x: bb.x, y: bb.y };
    const TR = { x: bb.x + bb.width, y: bb.y };
    const BR = { x: bb.x + bb.width, y: bb.y + bb.height };
    const BL = { x: bb.x, y: bb.y + bb.height };

    const corners = { TL, TR, BR, BL };
    const opposite = { TL: BR, TR: BL, BR: TL, BL: TR };

    const startLocal = corners[corner];
    const anchorLocal = opposite[corner];

    const startWorld = worldFromLocal(o, startLocal.x, startLocal.y);
    const anchorWorld = worldFromLocal(o, anchorLocal.x, anchorLocal.y);

    const startDist = Math.max(1, distance(startWorld, anchorWorld));
    pushHistory(); // ? UNDO: start of overlay resize
    setOverlayResize({
      id,
      isWidget: !!o?.widget,
      anchorLocal,
      anchorWorld,
      startDist,
      origScaleX: overlayScaleX(o),
      origScaleY: overlayScaleY(o),
    });
  }

  function extractSvgSize(rawSvg) {
    try {
      const doc = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg) return null;

      // 1ï¸âƒ£ Ignition-style properties
      const kw = svg.getAttribute("kewidth");
      const kh = svg.getAttribute("keheight");

      if (kw && kh) {
        const w = parseFloat(kw);
        const h = parseFloat(kh);
        if (Number.isFinite(w) && Number.isFinite(h)) {
          return { w, h, source: "key" };
        }
      }

      // 2ï¸âƒ£ Standard width/height
      const wAttr = svg.getAttribute("width");
      const hAttr = svg.getAttribute("height");

      if (wAttr && hAttr) {
        const w = parseFloat(wAttr);
        const h = parseFloat(hAttr);
        if (Number.isFinite(w) && Number.isFinite(h)) {
          return { w, h, source: "attr" };
        }
      }

      // 3ï¸âƒ£ ViewBox fallback
      const vb = svg.getAttribute("viewBox");
      if (vb) {
        const [, , vw, vh] = vb.split(/\s+/).map(Number);
        if (Number.isFinite(vw) && Number.isFinite(vh)) {
          return { w: vw, h: vh, source: "viewBox" };
        }
      }
    } catch {
      return null;
    }

    return null;
  }



  // ? Lazy/eager compatible SVG import
  async function onPickSvg(fileKey, anchorOverride, overlayExtras = {}, rawOverride = null) {
    const entry = rawOverride ?? getSvgEntry(fileKey);
    if (!entry) return;

    const raw = await readSvgRaw(entry, { forceFresh: import.meta.env.DEV === true });
    if (typeof raw !== "string") return;

    const parsed = stripOuterSvg(raw);
    if (!parsed) return;

    pushHistory(); // ? undo import

    const pad = 40;
    const availW = vbW - pad * 2;
    const availH = vbH - pad * 2;

    const key = extractKeySize(raw);
    const parsedEType = extractSvgEType(raw, fileKey);
    const baseVb = parsed.vb; // {x,y,w,h}

    // ? If key exists, overlay local coords become 0..key.w / 0..key.h
    let localVb = key ? { x: 0, y: 0, w: key.w, h: key.h } : baseVb;
    if (!localVb || !Number.isFinite(localVb.w) || !Number.isFinite(localVb.h) || localVb.w <= 0 || localVb.h <= 0) {
      localVb = { x: 0, y: 0, w: 100, h: 100 };
    }

    // ? Normalize inner so geometry matches localVb
    let inner = parsed.inner;

    if (key && baseVb?.w > 0 && baseVb?.h > 0) {
      const sx = key.w / baseVb.w;
      const sy = key.h / baseVb.h;

      inner = `
      <g transform="translate(${-baseVb.x},${-baseVb.y}) scale(${sx},${sy})">
        ${parsed.inner}
      </g>
    `;
    }

    const srcW = Math.max(localVb.w, 1);
    const srcH = Math.max(localVb.h, 1);

    // ? If kewidth/keheight exists, import at EXACT size (1 world unit = 1 key unit)
    // Otherwise default to 350 width.
    const scale = key ? 1 : Math.min(350 / srcW, vbH / srcH);

    const srcCx = localVb.x + localVb.w / 2;
    const srcCy = localVb.y + localVb.h / 2;

    // While picking from the left import dock, default to center unless an explicit anchor was provided.
    const anchor = anchorOverride ?? (importOpen ? null : importAnchor) ?? getViewportCenterWorldPoint();

    const tx = anchor.x - scale * srcCx;
    const ty = anchor.y - scale * srcCy;

    // ? bbox must be in the SAME local coordinate system the overlay uses
    const bbox = { x: localVb.x, y: localVb.y, width: localVb.w, height: localVb.h };
    const clamped = clampOverlayTransformToCanvas(tx, ty, scale, scale, bbox);

    const normalizedInner = inner;
    const id = uid();
    setSvgOverlays((prev) => [
      ...prev,
      {
        id,
        sourceKey: fileKey,
        name: fileKey.split("/").pop() || fileKey,
        inner: normalizedInner,
        tx: clamped.tx,
        ty: clamped.ty,
        scale,
        fill: DEFAULT_FILL,
        tagPath: "",
        eType: String(overlayExtras?.eType || parsedEType || "").trim(),
        eTypeAuto: overlayExtras?.eType != null ? false : true,
        bbox,
        ...overlayExtras,
        stroke: DEFAULT_STROKE,
        strokeMode: "preserve",
      },
    ]);

    setSelectedOverlayIds([id]);
    setSelectedIds([]);
    setImportOpen(false);
    exitEditMode();
    setShowHUD(false);
    setImportAnchor(null);
    setTool("select");
    setDrawing(null);
    scheduleProjectAutoSave();
  }

  async function handleAiInsertSvg(rawSelection) {
    const selected = String(rawSelection || "").trim();
    if (!selected) return { ok: false, error: "No SVG key provided." };
    const byExactKey = (Array.isArray(svgFiles) ? svgFiles : []).find(
      (file) => String(file?.key || "").trim().toLowerCase() === selected.toLowerCase()
    );
    const byName = (Array.isArray(svgFiles) ? svgFiles : []).find(
      (file) => String(file?.name || "").trim().toLowerCase() === selected.toLowerCase()
    );
    const target = byExactKey || byName || null;
    if (!target?.key) {
      return { ok: false, error: `SVG not found: ${selected}` };
    }
    try {
      await onPickSvg(target.key);
      return { ok: true, key: target.key, name: target.name || target.key };
    } catch (err) {
      return { ok: false, error: String(err?.message || "Failed to add SVG.") };
    }
  }

  function resolveSvgSelection(rawSelection) {
    const selected = String(rawSelection || "").trim();
    if (!selected) return null;
    const entries = Array.isArray(svgFiles) ? svgFiles : [];
    const normalizeToken = (value) =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
    const byExactKey = entries.find(
      (file) => String(file?.key || "").trim().toLowerCase() === selected.toLowerCase()
    );
    const byName = entries.find(
      (file) => String(file?.name || "").trim().toLowerCase() === selected.toLowerCase()
    );
    const selectedNorm = normalizeToken(selected);
    const byFuzzy = !byExactKey && !byName
      ? entries.find((file) => {
          const keyNorm = normalizeToken(file?.key || "");
          const nameNorm = normalizeToken(file?.name || "");
          if (!selectedNorm || (!keyNorm && !nameNorm)) return false;
          return (
            keyNorm.includes(selectedNorm) ||
            nameNorm.includes(selectedNorm) ||
            selectedNorm.includes(nameNorm)
          );
        })
      : null;
    const match = byExactKey || byName || byFuzzy || null;
    if (!match?.key) return null;
    return {
      key: String(match.key),
      name: String(match.name || match.key.split("/").pop() || match.key),
    };
  }

  async function applyAiSvgLayoutPlan(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const incomingItems = Array.isArray(source.items) ? source.items : [];
    if (!incomingItems.length) {
      throw new Error("No SVG items were provided.");
    }
    const layout = source.layout && typeof source.layout === "object" ? source.layout : {};
    const normalizedItems = incomingItems
      .map((row, idx) => {
        const entry = row && typeof row === "object" ? row : {};
        const rawSvg = String(
          entry.svgKey || entry.svgName || entry.svg || entry.template || entry.key || entry.name || ""
        ).trim();
        const svgChoice = resolveSvgSelection(rawSvg);
        if (!svgChoice) return null;
        const label = String(entry.label || entry.title || `SVG ${idx + 1}`).trim() || `SVG ${idx + 1}`;
        const tagPath = normalizeTagValue(entry.tagPath || entry.tag || "");
        const x = Number(entry.x);
        const y = Number(entry.y);
        const width = Number(entry.width || entry.w || 0);
        const inferredType = inferETypeFromFileKey(svgChoice.key);
        const isLikelyBin =
          isBinEType(inferredType) ||
          /\bbin\b/i.test(String(svgChoice.key || "")) ||
          /\bbin\b/i.test(String(svgChoice.name || ""));
        const canonicalBinName = isLikelyBin ? toCanonicalBinName(label || tagPath) : "";
        return {
          id: `ai-layout-${idx}-${Math.random().toString(36).slice(2, 8)}`,
          svgKey: svgChoice.key,
          label,
          tagPath,
          x: Number.isFinite(x) ? x : null,
          y: Number.isFinite(y) ? y : null,
          width: Number.isFinite(width) && width > 0 ? width : null,
          isLikelyBin,
          canonicalBinName,
        };
      })
      .filter(Boolean);

    if (!normalizedItems.length) {
      throw new Error("No valid SVG names matched the library.");
    }

    const count = normalizedItems.length;
    const binBindings = await ensureAiBinsExist(
      normalizedItems
        .filter((item) => item?.isLikelyBin && item?.canonicalBinName)
        .map((item) => ({
          id: item.id,
          label: item.canonicalBinName,
          tagPath: item.tagPath,
        }))
    );
    const defaultCellW = Math.max(50, Number(layout.cellW) || Number(layout.targetW) || 120);
    const defaultCellH = Math.max(40, Number(layout.cellH) || Math.round(defaultCellW * 0.92));
    const gapX = Math.max(0, Number(layout.gapX) || 24);
    const gapY = Math.max(0, Number(layout.gapY) || 24);
    const hasAbsolute = normalizedItems.some(
      (item) => Number.isFinite(item?.x) && Number.isFinite(item?.y)
    );
    const columns = Math.max(
      1,
      Math.min(
        count,
        Number.isFinite(Number(layout.columns))
          ? Math.floor(Number(layout.columns))
          : Math.ceil(Math.sqrt(count))
      )
    );
    const rows = Math.max(1, Math.ceil(count / columns));
    const totalW = columns * defaultCellW + Math.max(0, columns - 1) * gapX;
    const totalH = rows * defaultCellH + Math.max(0, rows - 1) * gapY;
    const startX = Number.isFinite(Number(layout.startX))
      ? Number(layout.startX)
      : Math.max(8, Math.round((vbW - totalW) / 2));
    const startY = Number.isFinite(Number(layout.startY))
      ? Number(layout.startY)
      : Math.max(8, Math.round((vbH - totalH) / 2));

    const overlays = (
      await Promise.all(
        normalizedItems.map(async (item, idx) => {
          const col = idx % columns;
          const row = Math.floor(idx / columns);
          const center = hasAbsolute && Number.isFinite(item.x) && Number.isFinite(item.y)
            ? { x: Number(item.x), y: Number(item.y) }
            : {
                x: startX + col * (defaultCellW + gapX) + defaultCellW / 2,
                y: startY + row * (defaultCellH + gapY) + defaultCellH / 2,
              };
          const targetWidth = Math.max(50, Number(item.width || defaultCellW));
          const overlay = await buildOverlayFromKey(item.svgKey, center, targetWidth);
          const binBinding = item?.id ? binBindings.get(item.id) : null;
          return {
            ...overlay,
            name: (binBinding?.canonicalName || item.label || overlay.name),
            tagPath: item.tagPath || overlay.tagPath || "",
            binBindingKey: binBinding?.binBindingKey || "",
          };
        })
      )
    ).filter(Boolean);

    if (!overlays.length) {
      throw new Error("No overlays could be created.");
    }

    pushHistory();
    setSvgOverlays((prev) => [...prev, ...overlays]);
    setSelectedIds([]);
    setSelectedOverlayIds(overlays.map((o) => o.id));
    setTool("select");
    setDrawing(null);
    setShowHUD(false);
    scheduleProjectAutoSave();
    return { count: overlays.length };
  }

  async function handleTeamChatAiAction(aiAction) {
    const action = aiAction && typeof aiAction === "object" ? aiAction : null;
    if (!action) return { ok: false, skipped: true };
    const type = String(action.type || "").trim().toLowerCase();
    const payload =
      action.payload && typeof action.payload === "object" ? action.payload : action;
    if (type === "add_svg_layout") {
      const result = await applyAiSvgLayoutPlan(payload);
      return { ok: true, type, result };
    }
    return { ok: false, skipped: true, type };
  }

  async function applyAiTagSvgBatchPlan(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const incomingTags = Array.isArray(source.tags) ? source.tags : [];
    const incomingItems = Array.isArray(source.items) ? source.items : [];
    const normalizedItems = [];
    const pushItem = (row, idx) => {
      const rawTagPath = normalizeTagValue(
        row?.tagPath || row?.tag || row?.name || incomingTags[idx] || ""
      );
      if (!rawTagPath) return;
      const rawSvg = String(row?.svgKey || row?.svgName || source?.svgKey || source?.svgName || "").trim();
      const choice = resolveSvgSelection(rawSvg);
      if (!choice) return;
      const label = String(row?.label || row?.name || rawTagPath).trim() || `Tag ${idx + 1}`;
      normalizedItems.push({
        tagPath: rawTagPath,
        label,
        svgKey: choice.key,
      });
    };

    if (incomingItems.length) {
      incomingItems.forEach((row, idx) => pushItem(row, idx));
    } else {
      incomingTags.forEach((tag, idx) =>
        pushItem({ tagPath: tag, name: String(tag || "").trim() }, idx)
      );
    }
    if (!normalizedItems.length) {
      throw new Error("No valid tags or SVG selection provided.");
    }

    const layout = source.layout && typeof source.layout === "object" ? source.layout : {};
    const count = normalizedItems.length;
    const columns = Math.max(
      1,
      Math.min(
        count,
        Number.isFinite(Number(layout.columns))
          ? Math.floor(Number(layout.columns))
          : Math.ceil(Math.sqrt(count))
      )
    );
    const cellW = Math.max(50, Number(layout.cellW) || Number(layout.targetW) || 120);
    const cellH = Math.max(40, Number(layout.cellH) || Math.round(cellW * 0.92));
    const gapX = Math.max(0, Number(layout.gapX) || 24);
    const gapY = Math.max(0, Number(layout.gapY) || 24);
    const rows = Math.max(1, Math.ceil(count / columns));
    const totalW = columns * cellW + Math.max(0, columns - 1) * gapX;
    const totalH = rows * cellH + Math.max(0, rows - 1) * gapY;
    const startX = Number.isFinite(Number(layout.startX))
      ? Number(layout.startX)
      : Math.max(8, Math.round((vbW - totalW) / 2));
    const startY = Number.isFinite(Number(layout.startY))
      ? Number(layout.startY)
      : Math.max(8, Math.round((vbH - totalH) / 2));

    const overlays = (
      await Promise.all(
        normalizedItems.map(async (item, idx) => {
          const col = idx % columns;
          const row = Math.floor(idx / columns);
          const center = {
            x: startX + col * (cellW + gapX) + cellW / 2,
            y: startY + row * (cellH + gapY) + cellH / 2,
          };
          const overlay = await buildOverlayFromKey(item.svgKey, center, cellW);
          return {
            ...overlay,
            name: item.label || overlay.name,
            tagPath: item.tagPath,
          };
        })
      )
    ).filter(Boolean);

    if (!overlays.length) throw new Error("No overlays could be created.");

    pushHistory();
    setSvgOverlays((prev) => [...prev, ...overlays]);
    setSelectedIds([]);
    setSelectedOverlayIds(overlays.map((o) => o.id));
    setTool("select");
    setDrawing(null);
    setShowHUD(false);
    scheduleProjectAutoSave();
    return { count: overlays.length };
  }

  useEffect(() => {
    const onAiMessage = (event) => {
      if (event?.origin !== window.location.origin) return;
      const data = event?.data && typeof event.data === "object" ? event.data : null;
      if (!data || data.type !== "vizi.ai.add-tag-svgs") return;
      const requestId = String(data.requestId || "");
      Promise.resolve(applyAiTagSvgBatchPlan(data.payload || {}))
        .then((result) => {
          try {
            event.source?.postMessage(
              { type: "vizi.ai.add-tag-svgs:result", requestId, ok: true, result },
              event.origin || window.location.origin
            );
          } catch {
            // ignore postMessage response failures
          }
        })
        .catch((err) => {
          try {
            event.source?.postMessage(
              {
                type: "vizi.ai.add-tag-svgs:result",
                requestId,
                ok: false,
                error: String(err?.message || "Failed to add SVG tags."),
              },
              event.origin || window.location.origin
            );
          } catch {
            // ignore postMessage response failures
          }
        });
    };
    window.addEventListener("message", onAiMessage);
    return () => window.removeEventListener("message", onAiMessage);
  }, [applyAiTagSvgBatchPlan]);

  function finishRectDrawing(rectId) {
    if (!rectId) return;
    setShapes((prev) =>
      prev.filter((s) => {
        if (s.id !== rectId) return true;
        const w = Math.max(0, Number(s.width ?? 0));
        const h = Math.max(0, Number(s.height ?? 0));
        return w >= 2 && h >= 2;
      })
    );
    setDrawing(null);
    setTool("select");
    scheduleProjectAutoSave();
  }

  async function onPickWidget(widgetKey, anchorOverride) {
    const tmpl = widgetTemplate(widgetKey);
    const key = addGeneratedSvg(tmpl.name, tmpl.raw);
    await onPickSvg(key, anchorOverride, {
      tagPath: "",
      widget: defaultWidgetSettings(widgetKey),
    }, tmpl.raw);
    setWidgetOpen(false);
    setContextMenu(null);
    setTool("select");
    setDrawing(null);
  }

  async function swapOverlayTemplate(overlayId, fileKey) {
    const o = overlaysRef.current.find((x) => x.id === overlayId);
    if (!o) return;
    const bb = overlayLocalBBox(overlayId);
    if (!bb) return;

    const wr = overlayWorldRect(o, bb);
    const worldX = wr.x;
    const worldY = wr.y;
    const worldW = wr.w;
    const worldH = wr.h;
    const center = { x: worldX + worldW / 2, y: worldY + worldH / 2 };

    const nextOverlay = await buildOverlayFromKey(fileKey, center, worldW || undefined);
    if (!nextOverlay) return;

    setSvgOverlays((prev) =>
      prev.map((x) => {
        if (x.id !== overlayId) return x;
        return {
          ...x,
          ...nextOverlay,
          id: x.id,
          tagPath: x.tagPath,
          fill: x.fill,
          stroke: x.stroke,
        };
      })
    );
  }





  // ---------- Selected BBox (world coords, group-aware) ----------
  const selectedBBox = useMemo(() => {
    const boxes = [];

    for (const id of selectedIds) {
      const s = shapes.find((x) => x.id === id);
      if (!s) continue;

      // ? Polyline
      if (s.type === "polyline" || Array.isArray(s.points)) {
        if (!Array.isArray(s.points)) continue;
        const bb = bboxOfPoints(s.points);
        if (!bb) continue;
        boxes.push({ x: bb.minX, y: bb.minY, w: bb.w, h: bb.h });
        continue;
      }

      // ? Text
      if (s.type === "text") {
        const tb = textBoxFromShape(s);
        if (!tb) continue;
        boxes.push({
          x: tb.x,
          y: tb.y,
          w: tb.w,
          h: tb.h,
        });
        continue;
      }

      // ? Rectangle
      if (s.type === "rect" || s.type === "circle") {
        boxes.push({
          x: Number(s.x ?? 0),
          y: Number(s.y ?? 0),
          w: Math.max(0, Number(s.width ?? 0)),
          h: Math.max(0, Number(s.height ?? 0)),
        });
        continue;
      }
    }

    for (const id of selectedOverlayIds) {
      const o = svgOverlays.find((x) => x.id === id);
      if (!o) continue;
      const bb = overlayLocalBBox(id);
      if (!bb) continue;
      const wr = overlayWorldRect(o, bb);

      boxes.push({
        x: wr.x,
        y: wr.y,
        w: wr.w,
        h: wr.h,
      });
    }

    if (boxes.length === 0) return null;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const b of boxes) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }

    return {
      kind: boxes.length === 1 ? "Selected" : `Group (${boxes.length})`,
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    };
  }, [selectedIds, selectedOverlayIds, shapes, svgOverlays]);


  // ---------- Properties (ID, Tag Path, Fill, Stroke, X/Y/W/H) ----------
  const [hudFields, setHudFields] = useState({
    id: "",
    tagPath: "",
    binBindingKey: "",
    eType: "",
    diverterMode: "straight",
    fill: DEFAULT_FILL,
    stroke: DEFAULT_STROKE,
    strokeWidth: "",
    arrowStart: "none",
    arrowEnd: "none",
    lineStyle: "solid",   // ? NEW
    x: "",
    y: "",
    w: "",
    h: "",
    text: "",
    fontSize: "24",
    fontFamily: "system-ui",
    fontWeight: "400",
    textAlign: "start",
    widgetKind: "",
    widgetTitle: "",
    widgetLocation: "",
    widgetMin: "0",
    widgetMax: "100",
    widgetDecimals: "0",
    widgetUnit: "",
    widgetHistoryPoints: "40",
    widgetRowCount: "4",
    widgetRangeFrom: "",
    widgetRangeTo: "",
    widgetWindowMinutes: "60",
    widgetDurationPreset: "1h",
    widgetMaxPoints: "500",
    widgetLineTension: "0.34",
    widgetShowPoints: "true",
    widgetSeriesTags: "",
    widgetAxisMode: "auto",
    widgetTimerPreTag: "",
    widgetTimerAccTag: "",
    faultSimulated: false,
    screwAnimate: true,
    screwSpeed: "1.2",
  });


  useEffect(() => {
    if (!selectedBBox) {
      setHudFields({
        id: "",
        tagPath: "",
        binBindingKey: "",
        eType: "",
        diverterMode: "straight",
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        strokeWidth: "",
        arrowStart: "none",
        arrowEnd: "none",
        x: "",
        y: "",
        w: "",
        h: "",
        lineStyle: "solid",
        text: "",
        fontSize: "24",
        fontFamily: "system-ui",
        fontWeight: "400",
        textAlign: "start",
        widgetKind: "",
        widgetTitle: "",
        widgetLocation: "",
        widgetMin: "0",
        widgetMax: "100",
        widgetDecimals: "0",
        widgetUnit: "",
        widgetHistoryPoints: "40",
        widgetRowCount: "4",
        widgetRangeFrom: "",
        widgetRangeTo: "",
        widgetWindowMinutes: "60",
        widgetDurationPreset: "1h",
        widgetMaxPoints: "500",
        widgetLineTension: "0.34",
        widgetShowPoints: "true",
        widgetSeriesTags: "",
        widgetAxisMode: "auto",
        widgetTimerPreTag: "",
        widgetTimerAccTag: "",
        faultSimulated: false,
        screwAnimate: true,
        screwSpeed: "1.2",
      });
      return;
    }

    let idText = "";
    let tagPath = "";
    let fill = DEFAULT_FILL;
    let stroke = DEFAULT_STROKE;
    let strokeWidth = "";
    let arrowStart = "none";
    let arrowEnd = "none";
    let lineStyle = "solid"; // ? NEW

    if (isSingle && singleKind === "Polyline") {
      const s = shapes.find((x) => x.id === singleId);
      if (s) {
        idText = s.id;
        tagPath = s.tagPath || "";
        fill = s.fill || "transparent";
        stroke = s.stroke || DEFAULT_STROKE;
        arrowStart = s.arrowStart ?? "none";
        arrowEnd = s.arrowEnd ?? "none";
        lineStyle = s.lineStyle ?? "solid"; // ? NEW
      }
    } else if (isSingle && (singleKind === "SVG" || singleKind === "Widget")) {
      const o = svgOverlays.find((x) => x.id === singleId);
      if (o) {
        const w = o.widget || {};
        const overlayTagPath = String(o.tagPath || "");
        const parsedDb = parseDbTagPath(overlayTagPath);
        const parsedQuery = overlayTagPath.trim().toLowerCase().startsWith("dbq:")
          ? overlayTagPath.trim().slice(4)
          : "";
        const rawBarSourceMode = String(w.barSourceMode || "").trim().toLowerCase();
        const barSourceMode = rawBarSourceMode === "query"
          ? "query"
          : rawBarSourceMode === "tags"
          ? "tags"
          : (String(w.barQuery || parsedQuery).trim() ? "query" : "table");
        idText = o.id;
        tagPath = overlayTagPath;
        fill = !o.fill || o.fill === "none" ? DEFAULT_FILL : o.fill;
        stroke = !o.stroke || o.stroke === "none" ? DEFAULT_STROKE : o.stroke;
        strokeWidth = String(
          Number.isFinite(Number(o.strokeWidth)) && Number(o.strokeWidth) > 0
            ? Number(o.strokeWidth)
            : ""
        );
        setHudFields({
          id: idText,
          tagPath,
          binBindingKey: String(o.binBindingKey || ""),
          eType: String(o.eType || resolveOverlayEType(o) || ""),
          diverterMode: String(o.diverterMode || "straight").trim().toLowerCase() === "divert" ? "divert" : "straight",
          fill,
          stroke,
          strokeWidth,
          arrowStart: "none",
          arrowEnd: "none",
          lineStyle: "solid",
          x: String(fmt(selectedBBox.x)),
          y: String(fmt(selectedBBox.y)),
          w: String(fmt(selectedBBox.w)),
          h: String(fmt(selectedBBox.h)),
          text: "",
          fontSize: "24",
          fontFamily: "system-ui",
          fontWeight: "400",
          textAlign: "start",
          widgetKind: String(w.kind || ""),
          widgetTitle: String(w.title || ""),
          widgetLocation: String(w.location || ""),
          widgetMin: String(Number.isFinite(Number(w.min)) ? Number(w.min) : 0),
          widgetMax: String(Number.isFinite(Number(w.max)) ? Number(w.max) : 100),
          widgetDecimals: String(Number.isFinite(Number(w.decimals)) ? Number(w.decimals) : 0),
          widgetUnit: String(w.unit || ""),
          widgetHistoryPoints: String(Number.isFinite(Number(w.historyPoints)) ? Number(w.historyPoints) : 40),
          widgetRowCount: String(Number.isFinite(Number(w.rowCount)) ? Number(w.rowCount) : 4),
          widgetRangeFrom: toDatetimeLocalInput(w.rangeFrom),
          widgetRangeTo: toDatetimeLocalInput(w.rangeTo),
          widgetWindowMinutes: String(Number.isFinite(Number(w.windowMinutes)) ? Number(w.windowMinutes) : 60),
          widgetDurationPreset: String(w.durationPreset || ""),
          widgetMaxPoints: String(Number.isFinite(Number(w.maxPoints)) ? Number(w.maxPoints) : 500),
          widgetLineTension: String(Number.isFinite(Number(w.lineTension)) ? Number(w.lineTension) : 0.34),
          widgetShowPoints: String(w.showPoints !== false),
          widgetSeriesTags: normalizeSeriesTagsValue(w.seriesTags, tagPath).join("\n"),
          widgetAxisMode: String(w.axisMode === "manual" ? "manual" : "auto"),
          widgetTimerPreTag: String(w.timerPreTag || ""),
          widgetTimerAccTag: String(w.timerAccTag || ""),
          faultSimulated: Boolean(o.faultSimulated),
          screwAnimate: o.screwAnimate !== false,
          screwSpeed: String(
            Number.isFinite(Number(o.screwSpeed)) && Number(o.screwSpeed) > 0
              ? Number(o.screwSpeed)
              : 1.2
          ),
          widgetBarSourceMode: barSourceMode,
          widgetBarTable: String(w.barTable || parsedDb?.table || ""),
          widgetBarField: String(w.barField || parsedDb?.field || ""),
          widgetBarLabelField: String(w.barLabelField || ""),
          widgetBarQuery: String(w.barQuery || parsedQuery || ""),
          widgetBarQueryValueField: String(w.barQueryValueField || ""),
          widgetBarQueryLabelField: String(w.barQueryLabelField || ""),
        });
        return;
      }
    } else if (isSingle && singleKind === "Text") {
      const t = shapes.find((x) => x.id === singleId);
      if (t) {
        idText = t.id;
        tagPath = t.tagPath || "";
        fill = t.fill ?? "#808080";
        stroke = t.stroke ?? "#808080"; // optional if you support stroke on text

        setHudFields({
          id: idText,
          tagPath,
          binBindingKey: "",
          eType: "",
          diverterMode: "straight",
          fill,
          stroke,
          strokeWidth: "",
          arrowStart: "none",
          arrowEnd: "none",
          lineStyle: "solid",
          x: String(fmt(selectedBBox.x)),
          y: String(fmt(selectedBBox.y)),
          w: String(fmt(selectedBBox.w)),
          h: String(fmt(selectedBBox.h)),
          text: String(t.text ?? ""),
          fontSize: String(t.fontSize ?? 24),
          fontFamily: String(t.fontFamily ?? "system-ui"),
          fontWeight: String(t.fontWeight ?? "400"),
          textAlign: String(t.anchor ?? "start"),
          widgetKind: "",
          widgetTitle: "",
          widgetLocation: "",
          widgetMin: "0",
          widgetMax: "100",
          widgetDecimals: "0",
          widgetUnit: "",
          widgetHistoryPoints: "40",
          widgetRowCount: "4",
          widgetRangeFrom: "",
          widgetRangeTo: "",
          widgetWindowMinutes: "60",
          widgetDurationPreset: "1h",
          widgetMaxPoints: "500",
          widgetLineTension: "0.34",
          widgetShowPoints: "true",
          widgetSeriesTags: "",
          widgetAxisMode: "auto",
          widgetTimerPreTag: "",
          widgetTimerAccTag: "",
          faultSimulated: false,
          screwAnimate: true,
          screwSpeed: "1.2",
          widgetBarSourceMode: "table",
          widgetBarTable: "",
          widgetBarField: "",
          widgetBarLabelField: "",
          widgetBarQuery: "",
          widgetBarQueryValueField: "",
          widgetBarQueryLabelField: "",
        });
        return;
      }
    }


    setHudFields({
      id: idText,
      tagPath,
      binBindingKey: "",
      eType: "",
      diverterMode: "straight",
      fill,
      stroke,
      strokeWidth,
      arrowStart,
      arrowEnd,
      lineStyle, // ? NEW
      x: String(fmt(selectedBBox.x)),
      y: String(fmt(selectedBBox.y)),
      w: String(fmt(selectedBBox.w)),
      h: String(fmt(selectedBBox.h)),
      text: "",
      fontSize: "24",
      fontFamily: "system-ui",
      fontWeight: "400",
      textAlign: "start",
      widgetKind: "",
      widgetTitle: "",
      widgetLocation: "",
      widgetMin: "0",
      widgetMax: "100",
      widgetDecimals: "0",
      widgetUnit: "",
      widgetHistoryPoints: "40",
      widgetRowCount: "4",
      widgetRangeFrom: "",
      widgetRangeTo: "",
      widgetWindowMinutes: "60",
      widgetDurationPreset: "1h",
      widgetMaxPoints: "500",
      widgetLineTension: "0.34",
      widgetShowPoints: "true",
      widgetSeriesTags: "",
      widgetAxisMode: "auto",
      widgetTimerPreTag: "",
      widgetTimerAccTag: "",
      faultSimulated: false,
      screwAnimate: true,
      screwSpeed: "1.2",
      widgetBarSourceMode: "table",
      widgetBarTable: "",
      widgetBarField: "",
      widgetBarLabelField: "",
      widgetBarQuery: "",
      widgetBarQueryValueField: "",
      widgetBarQueryLabelField: "",
    });

  }, [selectedBBox, isSingle, singleKind, singleId, shapes, svgOverlays]);


  function idExistsAnywhere(id) {
    return shapes.some((s) => s.id === id) || svgOverlays.some((o) => o.id === id);
  }

  function applySingleId(nextIdRaw) {
    if (!isSingle || !singleId) return;
    const nextId = String(nextIdRaw || "").trim();
    if (!nextId) return;
    if (nextId === singleId) return;
    if (idExistsAnywhere(nextId)) return;

    if (singleKind === "Polyline" || singleKind === "Text") {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, id: nextId } : s)));
      setSelectedIds([nextId]);
    } else if (singleKind === "SVG" || singleKind === "Widget") {
      setSvgOverlays((prev) => prev.map((o) => (o.id === singleId ? { ...o, id: nextId } : o)));
      setSelectedOverlayIds([nextId]);
    }
  }

  function applySingleTagPath(nextRaw) {
    if (!isSingle || !singleId) return;
    const v = String(nextRaw ?? "").trim();

    if (singleKind === "Polyline" || singleKind === "Text") {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, tagPath: v } : s)));
    } else if (singleKind === "SVG" || singleKind === "Widget") {
      setSvgOverlays((prev) => prev.map((o) => (o.id === singleId ? { ...o, tagPath: v } : o)));
    }
    scheduleProjectAutoSave();
  }

  function applySingleFaultSim(nextValue) {
    if (!isSingle || singleKind !== "SVG" || !singleId) return;
    const enabled = Boolean(nextValue);
    setSvgOverlays((prev) =>
      prev.map((o) => (o.id === singleId ? { ...o, faultSimulated: enabled } : o))
    );
    scheduleProjectAutoSave();
  }

  function snapPointToNearestPolylineConnection(p, threshold = 24) {
    const worldPoint = {
      x: Number(p?.x) || 0,
      y: Number(p?.y) || 0,
    };
    const snapRadius = Math.max(1, Number(threshold) || 24) / Math.max(zoom || 1, 0.0001);
    let best = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const s of shapesRef.current || []) {
      if (!(String(s?.type || "").toLowerCase() === "polyline" || Array.isArray(s?.points))) continue;
      const pts = Array.isArray(s?.points) ? s.points : [];
      if (pts.length < 2) continue;
      for (const ptNode of pts) {
        const dx = worldPoint.x - (Number(ptNode?.x) || 0);
        const dy = worldPoint.y - (Number(ptNode?.y) || 0);
        const d = Math.hypot(dx, dy);
        if (d < bestDist) {
          bestDist = d;
          best = { x: Number(ptNode?.x) || 0, y: Number(ptNode?.y) || 0 };
        }
      }
      for (let i = 0; i < pts.length - 1; i += 1) {
        const a = pts[i];
        const b = pts[i + 1];
        const ax = Number(a?.x) || 0;
        const ay = Number(a?.y) || 0;
        const bx = Number(b?.x) || 0;
        const by = Number(b?.y) || 0;
        const abx = bx - ax;
        const aby = by - ay;
        const ab2 = abx * abx + aby * aby;
        let t = 0;
        if (ab2 > 1e-9) {
          t = ((worldPoint.x - ax) * abx + (worldPoint.y - ay) * aby) / ab2;
        }
        const tt = Math.max(0, Math.min(1, t));
        const qx = ax + abx * tt;
        const qy = ay + aby * tt;
        const d = Math.hypot(worldPoint.x - qx, worldPoint.y - qy);
        if (d < bestDist) {
          bestDist = d;
          best = { x: qx, y: qy };
        }
      }
    }
    if (best && bestDist <= snapRadius) return best;
    return worldPoint;
  }

  function snapPointToNearestPolylineEndpoint(p, threshold = 24, options = {}) {
    const worldPoint = {
      x: Number(p?.x) || 0,
      y: Number(p?.y) || 0,
    };
    const snapRadius = Math.max(1, Number(threshold) || 24) / Math.max(zoom || 1, 0.0001);
    const excludeShapeId = String(options?.excludeShapeId || "").trim();
    const excludeIndexes = new Set(
      (Array.isArray(options?.excludeIndexes) ? options.excludeIndexes : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
    );
    let best = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const s of shapesRef.current || []) {
      if (!(String(s?.type || "").toLowerCase() === "polyline" || Array.isArray(s?.points))) continue;
      const shapeId = String(s?.id || "");
      const pts = Array.isArray(s?.points) ? s.points : [];
      if (pts.length < 2) continue;
      const endpoints = [
        { point: pts[0], index: 0 },
        { point: pts[pts.length - 1], index: pts.length - 1 },
      ];
      for (const endpoint of endpoints) {
        if (!endpoint?.point) continue;
        if (shapeId && shapeId === excludeShapeId && excludeIndexes.has(Number(endpoint.index))) continue;
        const ex = Number(endpoint.point?.x);
        const ey = Number(endpoint.point?.y);
        if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;
        const d = Math.hypot(worldPoint.x - ex, worldPoint.y - ey);
        if (d < bestDist) {
          bestDist = d;
          best = { x: ex, y: ey };
        }
      }
    }
    if (best && bestDist <= snapRadius) return best;
    return worldPoint;
  }

  function getNearestPolylineEndpointSnap(p, threshold = 24, options = {}) {
    const worldPoint = {
      x: Number(p?.x) || 0,
      y: Number(p?.y) || 0,
    };
    const snapRadius = Math.max(1, Number(threshold) || 24) / Math.max(zoom || 1, 0.0001);
    const excludeShapeId = String(options?.excludeShapeId || "").trim();
    const excludeIndexes = new Set(
      (Array.isArray(options?.excludeIndexes) ? options.excludeIndexes : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
    );
    let bestPoint = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const s of shapesRef.current || []) {
      if (!(String(s?.type || "").toLowerCase() === "polyline" || Array.isArray(s?.points))) continue;
      const shapeId = String(s?.id || "");
      const pts = Array.isArray(s?.points) ? s.points : [];
      if (pts.length < 2) continue;
      const endpoints = [
        { point: pts[0], index: 0 },
        { point: pts[pts.length - 1], index: pts.length - 1 },
      ];
      for (const endpoint of endpoints) {
        if (!endpoint?.point) continue;
        if (shapeId && shapeId === excludeShapeId && excludeIndexes.has(Number(endpoint.index))) continue;
        const ex = Number(endpoint.point?.x);
        const ey = Number(endpoint.point?.y);
        if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;
        const d = Math.hypot(worldPoint.x - ex, worldPoint.y - ey);
        if (d < bestDist) {
          bestDist = d;
          bestPoint = { x: ex, y: ey };
        }
      }
    }
    return {
      snapped: !!bestPoint && bestDist <= snapRadius,
      point: bestPoint && bestDist <= snapRadius ? bestPoint : worldPoint,
    };
  }

  function getSnapOffsetForMovedPolylineEndpoints(polyPayloads, dx, dy, threshold = 24) {
    const payloads = Array.isArray(polyPayloads) ? polyPayloads : [];
    if (!payloads.length) return { dx: 0, dy: 0 };
    const snapRadius = Math.max(1, Number(threshold) || 24) / Math.max(zoom || 1, 0.0001);
    const excludedIds = new Set(payloads.map((item) => String(item?.id || "")).filter(Boolean));
    let best = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const payload of payloads) {
      const movedPoints = Array.isArray(payload?.origPoints)
        ? payload.origPoints.map((pt) => ({
            x: Number(pt?.x || 0) + Number(dx || 0),
            y: Number(pt?.y || 0) + Number(dy || 0),
          }))
        : [];
      if (movedPoints.length < 2) continue;
      const movedEndpoints = [movedPoints[0], movedPoints[movedPoints.length - 1]];
      for (const movedEndpoint of movedEndpoints) {
        for (const s of shapesRef.current || []) {
          if (!(String(s?.type || "").toLowerCase() === "polyline" || Array.isArray(s?.points))) continue;
          const shapeId = String(s?.id || "");
          if (excludedIds.has(shapeId)) continue;
          const pts = Array.isArray(s?.points) ? s.points : [];
          if (pts.length < 2) continue;
          const candidates = [pts[0], pts[pts.length - 1]];
          for (const candidate of candidates) {
            if (!candidate) continue;
            const cx = Number(candidate?.x);
            const cy = Number(candidate?.y);
            if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
            const dist = Math.hypot((Number(movedEndpoint.x) || 0) - cx, (Number(movedEndpoint.y) || 0) - cy);
            if (dist < bestDist) {
              bestDist = dist;
              best = {
                dx: cx - (Number(movedEndpoint.x) || 0),
                dy: cy - (Number(movedEndpoint.y) || 0),
              };
            }
          }
        }
      }
    }

    if (best && bestDist <= snapRadius) return best;
    return { dx: 0, dy: 0 };
  }

  function applySingleScrewAnimate(nextValue) {
    if (!isSingle || singleKind !== "SVG" || !singleId) return;
    const enabled = Boolean(nextValue);
    setSvgOverlays((prev) =>
      prev.map((o) => (o.id === singleId ? { ...o, screwAnimate: enabled } : o))
    );
    scheduleProjectAutoSave();
  }

  function applySingleScrewSpeed(nextRaw) {
    if (!isSingle || singleKind !== "SVG" || !singleId) return;
    const raw = Number.parseFloat(String(nextRaw || "").trim());
    const speed = Number.isFinite(raw) ? Math.max(0.2, Math.min(10, raw)) : 1.2;
    setSvgOverlays((prev) =>
      prev.map((o) => (o.id === singleId ? { ...o, screwSpeed: speed } : o))
    );
    scheduleProjectAutoSave();
  }

  function applySingleWidgetSettings(next) {
    if (!isSingle || singleKind !== "Widget" || !singleId) return;
    const source = next && typeof next === "object" ? next : {};
    const title = String(source.widgetTitle ?? "").trim();
    const location = String(source.widgetLocation ?? "").trim();
    const unit = String(source.widgetUnit ?? "").trim();
    const min = Number(source.widgetMin);
    const max = Number(source.widgetMax);
    const decimals = Number(source.widgetDecimals);
    const historyPoints = Number(source.widgetHistoryPoints);
    const rowCount = Number(source.widgetRowCount);
    const windowMinutes = Number(source.widgetWindowMinutes);
    const durationPresetRaw = String(source.widgetDurationPreset || "").trim().toLowerCase();
    const maxPoints = Number(source.widgetMaxPoints);
    const lineTension = Number(source.widgetLineTension);
    const showPoints = String(source.widgetShowPoints ?? "true").toLowerCase() !== "false";
    const axisMode = String(source.widgetAxisMode || "").trim().toLowerCase() === "manual"
      ? "manual"
      : "auto";
    const timerPreTag = String(source.widgetTimerPreTag || "").trim();
    const timerAccTag = String(source.widgetTimerAccTag || "").trim();
    const rawBarSourceMode = String(source.widgetBarSourceMode || "table").trim().toLowerCase();
    const barSourceMode = rawBarSourceMode === "query"
      ? "query"
      : rawBarSourceMode === "tags"
      ? "tags"
      : "table";
    const barTable = String(source.widgetBarTable || "").trim();
    const barField = String(source.widgetBarField || "").trim();
    const barLabelField = String(source.widgetBarLabelField || "").trim();
    const barQuery = String(source.widgetBarQuery || "").trim();
    const barQueryValueField = String(source.widgetBarQueryValueField || "").trim();
    const barQueryLabelField = String(source.widgetBarQueryLabelField || "").trim();
    const parseDateMs = (raw) => {
      const text = String(raw ?? "").trim();
      if (!text) return null;
      if (/^\d+$/.test(text)) {
        const n = Number(text);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      const ms = Date.parse(text);
      return Number.isFinite(ms) ? ms : null;
    };
    let rangeFrom = parseDateMs(source.widgetRangeFrom);
    let rangeTo = parseDateMs(source.widgetRangeTo);
    const presetToMinutes = {
      "15m": 15,
      "30m": 30,
      "1h": 60,
      "2h": 120,
      "6h": 360,
      "12h": 720,
      "24h": 1440,
      "7d": 10080,
    };
    let resolvedWindowMinutes = Number.isFinite(windowMinutes)
      ? Math.max(1, Math.min(10080, Math.round(windowMinutes)))
      : null;
    let durationPreset = durationPresetRaw;
    if (durationPreset && Object.prototype.hasOwnProperty.call(presetToMinutes, durationPreset)) {
      resolvedWindowMinutes = presetToMinutes[durationPreset];
      rangeFrom = null;
      rangeTo = null;
    } else if (!durationPreset) {
      durationPreset = "";
    }
    if (rangeFrom != null && rangeTo != null && rangeFrom > rangeTo) {
      const t = rangeFrom;
      rangeFrom = rangeTo;
      rangeTo = t;
    }
    setSvgOverlays((prev) =>
      prev.map((o) => {
        if (o.id !== singleId) return o;
        const current = o.widget || {};
        const kind = String(current.kind || "").trim();
        let nextTagPath = String(o.tagPath || "").trim();
        if (kind === "barChart") {
          if (barSourceMode === "table" && barTable && barField) {
            nextTagPath = `db:${barTable}.${barField}`;
          } else if (barSourceMode === "query" && barQuery) {
            nextTagPath = `dbq:${barQuery}`;
          }
        } else if (kind === "countdownBar" && timerAccTag) {
          nextTagPath = timerAccTag;
        }
        const sourceHasSeriesTags = Object.prototype.hasOwnProperty.call(source, "widgetSeriesTags");
        const sourceSeriesTags = normalizeSeriesTagsValue(source.widgetSeriesTags, nextTagPath);
        const currentSeriesTags = normalizeSeriesTagsValue(current.seriesTags, nextTagPath);
        const isSeriesEdit = source.__seriesTagsEdited === true;
        const allowSeriesTags =
          kind === "lineChart" || (kind === "barChart" && barSourceMode === "tags");
        const seriesTags = allowSeriesTags
          ? isSeriesEdit
            ? sourceSeriesTags
            : (currentSeriesTags.length ? currentSeriesTags : sourceSeriesTags)
          : (sourceHasSeriesTags ? sourceSeriesTags : currentSeriesTags);
        if (kind === "barChart" && barSourceMode === "tags" && seriesTags.length) {
          nextTagPath = String(seriesTags[0] || "").trim() || nextTagPath;
        }
        return {
          ...o,
          tagPath: nextTagPath,
          widget: {
            ...current,
            title,
            location,
            unit,
            min: Number.isFinite(min) ? min : Number(current.min ?? 0) || 0,
            max: Number.isFinite(max) ? max : Number(current.max ?? 100) || 100,
            decimals: Number.isFinite(decimals) ? Math.max(0, Math.round(decimals)) : Number(current.decimals ?? 0) || 0,
            historyPoints: Number.isFinite(historyPoints) ? Math.max(5, Math.min(200, Math.round(historyPoints))) : Number(current.historyPoints ?? 40) || 40,
            rowCount: Number.isFinite(rowCount) ? Math.max(1, Math.min(20, Math.round(rowCount))) : Number(current.rowCount ?? 4) || 4,
            rangeFrom,
            rangeTo,
            windowMinutes: Number.isFinite(resolvedWindowMinutes) ? resolvedWindowMinutes : Number(current.windowMinutes ?? 60) || 60,
            durationPreset,
            maxPoints: Number.isFinite(maxPoints) ? Math.max(50, Math.min(10000, Math.round(maxPoints))) : Number(current.maxPoints ?? 500) || 500,
            lineTension: Number.isFinite(lineTension) ? Math.max(0, Math.min(1, lineTension)) : Number(current.lineTension ?? 0.34),
            showPoints,
            seriesTags,
            axisMode,
            timerPreTag,
            timerAccTag,
            barSourceMode,
            barTable,
            barField,
            barLabelField,
            barQuery,
            barQueryValueField,
            barQueryLabelField,
          },
        };
      })
    );
    scheduleProjectAutoSave();
  }

  function onWidgetDurationPresetChange(overlayId, preset, minutes) {
    if (!isSingle || singleKind !== "Widget" || !singleId) return;
    if (String(singleId) !== String(overlayId)) return;
    const mins = Number.isFinite(Number(minutes)) ? Math.max(1, Math.min(10080, Math.round(Number(minutes)))) : 60;
    const presetText = String(preset || "").trim().toLowerCase();
    setHudFields((prev) => ({
      ...prev,
      widgetDurationPreset: presetText || "",
      widgetWindowMinutes: String(mins),
      widgetRangeFrom: "",
      widgetRangeTo: "",
    }));
  }

  const applySingleArrowStart = (v) => {
    if (!isSingle || singleKind !== "Polyline" || !singleId) return;
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, arrowStart: v } : s)));
  };

  const applySingleArrowEnd = (v) => {
    if (!isSingle || singleKind !== "Polyline" || !singleId) return;
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, arrowEnd: v } : s)));
  };

  const applySingleLineStyle = (v) => {
    if (!isSingle || singleKind !== "Polyline" || !singleId) return;
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, lineStyle: v } : s)));
  };

  function updateSvgInnerStroke(inner, stroke) {
    if (!inner) return inner;

    let next = inner;

    // Replace attribute form: stroke="..."
    next = next.replace(/stroke=['"][^'"]*['"]/gi, `stroke="${stroke}"`);

    // Replace style form: style="...; stroke: ...; ..."
    next = next.replace(/stroke:\s*[^;\"']+/gi, `stroke:${stroke}`);

    // If no stroke attribute present, inject into first shape element.
    if (!/stroke=['"][^'"]*['"]/i.test(next)) {
      next = next.replace(
        /<(polyline|polygon|path|rect|circle|ellipse|line)\b([^>]*)>/i,
        `<$1$2 stroke="${stroke}">`
      );
    }

    return next;
  }

  function updateSvgInnerFill(inner, fill) {
    if (!inner) return inner;

    let next = inner;

    // Replace attribute form: fill="..."
    next = next.replace(/fill=['"][^'"]*['"]/gi, `fill="${fill}"`);

    // Replace style form: style="...; fill: ...; ..."
    next = next.replace(/fill:\s*[^;\"']+/gi, `fill:${fill}`);

    // If no fill attribute present, inject into first shape element.
    if (!/fill=['"][^'"]*['"]/i.test(next)) {
      next = next.replace(
        /<(polyline|polygon|path|rect|circle|ellipse|line)\b([^>]*)>/i,
        `<$1$2 fill="${fill}">`
      );
    }

    return next;
  }

  function updateSvgInnerStrokeWidth(inner, strokeWidth) {
    if (!inner) return inner;
    const sw = Number.parseFloat(strokeWidth);
    if (!Number.isFinite(sw) || sw <= 0) return inner;
    const value = String(sw);

    let next = inner;
    next = next.replace(/stroke-width\s*=\s*['"][^'"]*['"]/gi, `stroke-width="${value}"`);
    next = next.replace(/stroke-width\s*:\s*[^;\"']+/gi, `stroke-width:${value}`);

    next = next.replace(
      /<(polyline|polygon|path|rect|circle|ellipse|line)\b([^>]*?)(\/?)>/gi,
      (match, tag, attrs, selfClose) => {
        const hasStroke = /stroke\s*=|stroke\s*:/i.test(attrs);
        const strokeIsNone = /stroke\s*=\s*['"]\s*none\s*['"]|stroke\s*:\s*none/i.test(attrs);
        if (!hasStroke || strokeIsNone) return match;
        if (/stroke-width\s*=|stroke-width\s*:/i.test(attrs)) return match;
        return `<${tag}${attrs} stroke-width="${value}"${selfClose}>`;
      }
    );

    return next;
  }

  function applySingleStroke(nextStroke) {
    const c = String(nextStroke || "").trim();
    if (!c) return;

    if (isSingle && singleKind === "Polyline" && singleId) {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, stroke: c } : s)));
      scheduleProjectAutoSave();
      return;
    }

    if (isSingle && singleKind === "SVG" && singleId) {
      setSvgOverlays((prev) =>
        prev.map((o) =>
          o.id === singleId
            ? {
                ...o,
                stroke: c,
                strokeMode: "force",
                inner: o.widget ? o.inner : updateSvgInnerStroke(o.inner, c),
              }
            : o
        )
      );
      scheduleProjectAutoSave();
      return;
    }

    const selShape = new Set((selectedIds || []).map((id) => String(id || "")).filter(Boolean));
    const selOverlay = new Set((selectedOverlayIds || []).map((id) => String(id || "")).filter(Boolean));
    if (!selShape.size && !selOverlay.size) return;

    if (selShape.size) {
      setShapes((prev) =>
        prev.map((s) => (selShape.has(String(s?.id || "")) ? { ...s, stroke: c } : s))
      );
    }
    if (selOverlay.size) {
      setSvgOverlays((prev) =>
        prev.map((o) =>
          selOverlay.has(String(o?.id || ""))
            ? {
                ...o,
                stroke: c,
                strokeMode: o?.widget ? o?.strokeMode : "force",
                inner: o?.widget ? o?.inner : updateSvgInnerStroke(o?.inner, c),
              }
            : o
        )
      );
    }
    scheduleProjectAutoSave();
  }

  function applySingleFill(nextFill) {
    const c = String(nextFill || "").trim();
    if (!c) return;

    if (isSingle && singleKind === "SVG" && singleId) {
      setSvgOverlays((prev) =>
        prev.map((o) =>
          o.id === singleId ? { ...o, fill: c, inner: updateSvgInnerFill(o.inner, c) } : o
        )
      );
    } else if (isSingle && singleKind === "Text" && singleId) {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, fill: c } : s)));
    } else if (isSingle && singleKind === "Polyline" && singleId) {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, fill: c } : s)));
    } else if (!isSingle && Array.isArray(selectedIds) && selectedIds.length) {
      const sel = new Set(selectedIds.map((id) => String(id || "")));
      setShapes((prev) =>
        prev.map((s) => (sel.has(String(s?.id || "")) ? { ...s, fill: c } : s))
      );
    }
  }

  function applySingleSvgStrokeWidth(nextStrokeWidth) {
    if (!isSingle || singleKind !== "SVG" || !singleId) return;
    const sw = Number.parseFloat(nextStrokeWidth);
    if (!Number.isFinite(sw) || sw <= 0) return;
    const clamped = Math.max(0.1, sw);

    setSvgOverlays((prev) =>
      prev.map((o) =>
        o.id === singleId
          ? {
              ...o,
              strokeWidth: clamped,
              inner: updateSvgInnerStrokeWidth(o.inner, clamped),
            }
          : o
      )
    );
    scheduleProjectAutoSave();
  }

  function bringSelectedOverlaysToFront() {
    const selIds = (selOverRef.current || selectedOverlayIds || []).map((id) => String(id || "")).filter(Boolean);
    const sel = new Set(selIds);
    if (!sel.size) return;
    const baseList = Array.isArray(overlaysRef.current) && overlaysRef.current.length ? overlaysRef.current : svgOverlays;
    const orderedSelectedIds = (Array.isArray(baseList) ? baseList : [])
      .filter((o) => sel.has(String(o?.id || "")))
      .map((o) => o.id);
    setSvgOverlays((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const selected = list.filter((o) => sel.has(String(o?.id || "")));
      if (!selected.length) return list;
      const rest = list.filter((o) => !sel.has(String(o?.id || "")));
      const next = [...rest, ...selected];
      overlaysRef.current = next;
      return next;
    });
    if (orderedSelectedIds.length) {
      setSelectedOverlayIds(orderedSelectedIds);
      selOverRef.current = orderedSelectedIds;
    }
    scheduleProjectAutoSave();
  }

  function sendSelectedOverlaysToBack() {
    const selIds = (selOverRef.current || selectedOverlayIds || []).map((id) => String(id || "")).filter(Boolean);
    const sel = new Set(selIds);
    if (!sel.size) return;
    const baseList = Array.isArray(overlaysRef.current) && overlaysRef.current.length ? overlaysRef.current : svgOverlays;
    const orderedSelectedIds = (Array.isArray(baseList) ? baseList : [])
      .filter((o) => sel.has(String(o?.id || "")))
      .map((o) => o.id);
    setSvgOverlays((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const selected = list.filter((o) => sel.has(String(o?.id || "")));
      if (!selected.length) return list;
      const rest = list.filter((o) => !sel.has(String(o?.id || "")));
      const next = [...selected, ...rest];
      overlaysRef.current = next;
      return next;
    });
    if (orderedSelectedIds.length) {
      setSelectedOverlayIds(orderedSelectedIds);
      selOverRef.current = orderedSelectedIds;
    }
    scheduleProjectAutoSave();
  }

  function applyBBoxFromHud(next, options = {}) {
    const aspectLocked = options?.aspectLocked !== false;
    const X = numOrNull(next.x);
    const Y = numOrNull(next.y);
    const W = numOrNull(next.w);
    const H = numOrNull(next.h);

    if (!selectedBBox) return;

    if (selectedOverlayIds.length === 1 && selectedIds.length === 0) {
      const id = selectedOverlayIds[0];
      const o = svgOverlays.find((x) => x.id === id);
      if (!o) return;
      const isConveyorScrew = isConveyorScrewOverlay(o);

      // use your key-based bbox first (this is {width: 25, height: 25} for your files)
      const bb = o.bbox || overlayLocalBBox(id);
      if (!bb) return;

      const targetX = X == null ? selectedBBox.x : X;
      const targetY = Y == null ? selectedBBox.y : Y;

      let nextScaleX = overlayScaleX(o);
      let nextScaleY = overlayScaleY(o);

      if (aspectLocked || isConveyorScrew) {
        let nextScale = nextScaleX;
        if (W != null && bb.width > 0) nextScale = W / bb.width;
        if (W == null && H != null && bb.height > 0) nextScale = H / bb.height;
        if (W != null && H != null && bb.width > 0 && bb.height > 0) {
          nextScale = W / bb.width;
        }
        nextScale = Math.max(0.05, nextScale);
        nextScaleX = nextScale;
        nextScaleY = nextScale;
      } else {
        if (W != null && bb.width > 0) nextScaleX = Math.max(0.05, W / bb.width);
        if (H != null && bb.height > 0) nextScaleY = Math.max(0.05, H / bb.height);
      }

      // Make top-left match targetX/targetY using per-axis scale
      const newTx = targetX - nextScaleX * bb.x;
      const newTy = targetY - nextScaleY * bb.y;

      setSvgOverlays((prev) =>
        prev.map((x) =>
          x.id === id
            ? { ...x, tx: newTx, ty: newTy, scale: nextScaleX, scaleX: nextScaleX, scaleY: nextScaleY }
            : x
        )
      );

      return; // ? stop here so old min(sx,sy) logic doesn't interfere
    }

    const base = selectedBBox;
    const baseW = Math.max(base.w, 1e-6);
    const baseH = Math.max(base.h, 1e-6);

    const targetX = X == null ? base.x : X;
    const targetY = Y == null ? base.y : Y;

    const sx = W == null ? 1 : W / baseW;
    const sy = H == null ? 1 : H / baseH;

    const dx = targetX - base.x;
    const dy = targetY - base.y;

    // Polylines: non-uniform scale
    // Shapes (polylines + text)
    if (selectedIds.length) {
      const sUni = Math.max(0.05, Math.min(sx, sy)); // useful for text/font scaling

      setShapes((prev) =>
        prev.map((s) => {
          if (!selectedIds.includes(s.id)) return s;

          // ? Polyline
          if ((s.type === "polyline" || Array.isArray(s.points)) && Array.isArray(s.points)) {
            const pts = s.points.map((p) => ({
              x: base.x + (p.x - base.x) * sx + dx,
              y: base.y + (p.y - base.y) * sy + dy,
            }));
            return { ...s, points: pts };
          }

          // ? Text
          if (s.type === "text") {
            const newX = base.x + (Number(s.x ?? 0) - base.x) * sx + dx;
            const newY = base.y + (Number(s.y ?? 0) - base.y) * sy + dy;

            // If user is resizing via W/H, scale fontSize uniformly (optional but feels right)
            const fs0 = Number(s.fontSize ?? 24);
            const newFontSize =
              Number.isFinite(fs0) ? Math.max(1, fs0 * sUni) : s.fontSize;

            return { ...s, x: newX, y: newY, fontSize: newFontSize };
          }

          if (s.type === "rect" || s.type === "circle") {
            const x0 = Number(s.x ?? 0);
            const y0 = Number(s.y ?? 0);
            const w0 = Math.max(0, Number(s.width ?? 0));
            const h0 = Math.max(0, Number(s.height ?? 0));
            const x1 = x0 + w0;
            const y1 = y0 + h0;

            const nx0 = base.x + (x0 - base.x) * sx + dx;
            const ny0 = base.y + (y0 - base.y) * sy + dy;
            const nx1 = base.x + (x1 - base.x) * sx + dx;
            const ny1 = base.y + (y1 - base.y) * sy + dy;

            return {
              ...s,
              x: Math.min(nx0, nx1),
              y: Math.min(ny0, ny1),
              width: Math.abs(nx1 - nx0),
              height: Math.abs(ny1 - ny0),
            };
          }

          // unknown shape type: just move by dx/dy
          return s;
        })
      );
    }


    // Overlays: uniform scale only
    if (selectedOverlayIds.length) {
      setSvgOverlays((prev) =>
        prev.map((o) => {
          if (!selectedOverlayIds.includes(o.id)) return o;

          const newTx = base.x + (o.tx - base.x) * sx + dx;
          const newTy = base.y + (o.ty - base.y) * sy + dy;
          const isConveyorScrew = isConveyorScrewOverlay(o);
          const baseScaleX = overlayScaleX(o);
          const baseScaleY = overlayScaleY(o);
          const uniformRatio = Math.min(Math.abs(sx), Math.abs(sy));
          const uniformScale = Math.max(0.05, Math.max(baseScaleX, baseScaleY) * uniformRatio);
          const newScaleX = isConveyorScrew ? uniformScale : Math.max(0.05, baseScaleX * sx);
          const newScaleY = isConveyorScrew ? uniformScale : Math.max(0.05, baseScaleY * sy);

          return { ...o, tx: newTx, ty: newTy, scale: newScaleX, scaleX: newScaleX, scaleY: newScaleY };
        })
      );
    }
  }

  function toggleProjectModeShortcut() {
    let nextMode = normalizeProjectMode(projectMode);
    setProjectMode((prev) => {
      nextMode = prev === "live" ? "design" : "live";
      return nextMode;
    });
    setProjectModeDraft(nextMode);
    setProjectStatus(nextMode === "live" ? "Switched to Design mode" : "Switched to Live mode");
    scheduleProjectAutoSave(120);
  }

  // ---------- Mouse / Keyboard ----------
  useKeyboardShortcuts({
    disabled: isLiveMode,
    allowModeToggleWhenDisabled: true,
    toggleProjectMode: toggleProjectModeShortcut,
    saveProject: () => saveProjectToDb({ silent: false, teamMerge: true }),
    drawing,
    editingId,
    importOpen,
    selCount,
    duplicateSelected: handleDuplicate,
    cancelPolyline,
    exitEditMode,
    toggleEditMode,
    setTool,
    closeImport: () => setImportOpen(false),
    clearSelection,
    selectAll,
    clearImportAnchor: () => setImportAnchor(null),
    deleteSelected,
  });

  useEffect(() => {
    if (!isLiveMode) return;
    setShowMainDrawer(false);
    setShowProjectDrawer(false);
    setShowHUD(false);
    setImportOpen(false);
    setWidgetOpen(false);
    setContextMenu(null);
    setContextSvgMenuOpen(false);
    setTool("select");
    setDrawing(null);
    setInlineEdit(null);
    setSelectedIds([]);
    setSelectedOverlayIds([]);
    exitEditMode();
  }, [isLiveMode]);

  useEffect(() => {
    if (isLiveMode) return;
    setLiveEquipmentOverlayIds([]);
    setLiveEquipmentDockSideById({});
    setLiveEquipmentFloatingById({});
    setLiveEquipmentZById({});
    liveEquipmentZCounterRef.current = 0;
    setLiveEquipmentDrawerOverlayId("");
  }, [isLiveMode]);

  useEffect(() => {
    const id = String(liveEquipmentDrawerOverlayId || "").trim();
    if (!id) return;
    const exists = liveEquipmentOverlays.some(
      (entry) => String(entry?.overlay?.id || "") === id
    );
    if (!exists) setLiveEquipmentDrawerOverlayId("");
  }, [liveEquipmentDrawerOverlayId, liveEquipmentOverlays]);

  useEffect(() => {
    if (!isLiveMode) return;
    if (projectDrawerTab !== "project") setProjectDrawerTab("project");
  }, [isLiveMode, projectDrawerTab]);

  useEffect(() => {
    if (isLiveMode) return;
    if (importOpen && widgetOpen) setImportOpen(false);
  }, [isLiveMode, importOpen, widgetOpen]);

  useEffect(() => {
    const prev = Array.isArray(prevLiveEquipmentOverlayIdsRef.current)
      ? prevLiveEquipmentOverlayIdsRef.current
      : [];
    const next = Array.isArray(liveEquipmentOverlayIds) ? liveEquipmentOverlayIds : [];
    const prevSet = new Set(prev.map((id) => String(id || "")));
    const added = next
      .map((id) => String(id || "").trim())
      .filter((id) => id && !prevSet.has(id));
    if (added.length) {
      setLiveEquipmentConnectFxById((cur) => {
        const out = { ...(cur || {}) };
        for (const id of added) out[id] = true;
        return out;
      });
      for (const id of added) {
        const existing = liveEquipmentConnectFxTimersRef.current.get(id);
        if (existing) window.clearTimeout(existing);
        const timer = window.setTimeout(() => {
          setLiveEquipmentConnectFxById((cur) => {
            if (!cur || !cur[id]) return cur;
            const out = { ...cur };
            delete out[id];
            return out;
          });
          liveEquipmentConnectFxTimersRef.current.delete(id);
        }, 900);
        liveEquipmentConnectFxTimersRef.current.set(id, timer);
      }
    }
    prevLiveEquipmentOverlayIdsRef.current = next.slice();
  }, [liveEquipmentOverlayIds]);

  useEffect(
    () => () => {
      for (const timer of liveEquipmentConnectFxTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      liveEquipmentConnectFxTimersRef.current.clear();
    },
    []
  );

  function onLiveOverlayMouseDown(e, id) {
    const overlay = (svgOverlays || []).find((o) => String(o?.id || "") === String(id || ""));
    if (overlay?.widget) return;
    const target = e.target;
    const interactiveSelector = "[data-widget-control='true'],button,input,select,textarea,label,option";
    if (target && typeof target.closest === "function") {
      if (target.closest(interactiveSelector)) return;
    }
    const nativeEvent = e.nativeEvent;
    if (nativeEvent && typeof nativeEvent.composedPath === "function") {
      const path = nativeEvent.composedPath();
      const hitInteractive = path.some((node) => {
        if (!node || typeof node !== "object") return false;
        const el = node;
        return typeof el.matches === "function" && el.matches(interactiveSelector);
      });
      if (hitInteractive) return;
    }
    e.stopPropagation();
    const nextId = String(id || "").trim();
    if (!nextId) return;
    bringLiveEquipmentToFront(nextId);
    const viewportRect =
      svgRef.current?.closest?.(".vizi-scroll")?.getBoundingClientRect?.() ||
      svgRef.current?.getBoundingClientRect?.() ||
      null;
    const midY = viewportRect
      ? Number(viewportRect.top || 0) + Number(viewportRect.height || 0) / 2
      : (typeof window !== "undefined" ? window.innerHeight / 2 : 0);
    const lane = Number(e?.clientY || 0) > midY ? "top" : "bottom";
    setLiveEquipmentDockSideById((prev) => ({ ...(prev || {}), [nextId]: lane }));
    setLiveEquipmentOverlayIds((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.some((x) => String(x || "") === nextId)) return list;
      const without = list.filter((x) => String(x || "") !== nextId);
      const nextList = [...without, nextId];
      if (nextList.length <= MAX_LIVE_EQUIPMENT_POPUPS) return nextList;
      return nextList.slice(nextList.length - MAX_LIVE_EQUIPMENT_POPUPS);
    });
  }

  useEffect(() => {
    setLiveEquipmentOverlayIds((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (!list.length) return list;
      const keep = list.filter((id) => {
        const overlay = (svgOverlays || []).find((o) => String(o?.id || "") === String(id || ""));
        return overlay && !overlay.widget;
      });
      const capped =
        keep.length > MAX_LIVE_EQUIPMENT_POPUPS
          ? keep.slice(keep.length - MAX_LIVE_EQUIPMENT_POPUPS)
          : keep;
      return capped.length === list.length ? list : capped;
    });
    setLiveEquipmentDockSideById((prev) => {
      const map = prev && typeof prev === "object" ? prev : {};
      const valid = new Set(
        (liveEquipmentOverlayIds || [])
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      );
      let changed = false;
      const next = {};
      for (const [id, side] of Object.entries(map)) {
        if (!valid.has(id)) {
          changed = true;
          continue;
        }
        next[id] = side === "top" ? "top" : "bottom";
      }
      return changed ? next : map;
    });
    setLiveEquipmentFloatingById((prev) => {
      const map = prev && typeof prev === "object" ? prev : {};
      const valid = new Set(
        (liveEquipmentOverlayIds || [])
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      );
      let changed = false;
      const next = {};
      for (const [id, pos] of Object.entries(map)) {
        if (!valid.has(id)) {
          changed = true;
          continue;
        }
        if (!pos || !Number.isFinite(Number(pos.x)) || !Number.isFinite(Number(pos.y))) {
          changed = true;
          continue;
        }
        next[id] = { x: Number(pos.x), y: Number(pos.y) };
      }
      return changed ? next : map;
    });
    setLiveEquipmentZById((prev) => {
      const map = prev && typeof prev === "object" ? prev : {};
      const valid = new Set(
        (liveEquipmentOverlayIds || [])
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      );
      let changed = false;
      const next = {};
      for (const [id, z] of Object.entries(map)) {
        if (!valid.has(id)) {
          changed = true;
          continue;
        }
        next[id] = Number(z) || 0;
      }
      return changed ? next : map;
    });
  }, [svgOverlays, liveEquipmentOverlayIds, liveEquipmentDrawerOverlayId, MAX_LIVE_EQUIPMENT_POPUPS]);

  function closeLiveEquipmentCard(id) {
    const nextId = String(id || "").trim();
    if (!nextId) return;
    if (String(liveEquipmentDrawerOverlayId || "") === nextId) {
      const remainingIds = (Array.isArray(liveEquipmentOverlayIds) ? liveEquipmentOverlayIds : [])
        .map((x) => String(x || "").trim())
        .filter((x) => x && x !== nextId);
      setLiveEquipmentDrawerOverlayId(remainingIds[0] || "");
    }
    setLiveEquipmentDockSideById((prev) => {
      const map = prev && typeof prev === "object" ? prev : {};
      if (!Object.prototype.hasOwnProperty.call(map, nextId)) return map;
      const next = { ...map };
      delete next[nextId];
      return next;
    });
    setLiveEquipmentFloatingById((prev) => {
      const map = prev && typeof prev === "object" ? prev : {};
      if (!Object.prototype.hasOwnProperty.call(map, nextId)) return map;
      const next = { ...map };
      delete next[nextId];
      return next;
    });
    setLiveEquipmentZById((prev) => {
      const map = prev && typeof prev === "object" ? prev : {};
      if (!Object.prototype.hasOwnProperty.call(map, nextId)) return map;
      const next = { ...map };
      delete next[nextId];
      return next;
    });
    setLiveEquipmentOverlayIds((prev) => (Array.isArray(prev) ? prev.filter((x) => String(x || "") !== nextId) : []));
  }

  function dockLiveEquipmentCard(id) {
    const nextId = String(id || "").trim();
    if (!nextId) return;
    setLiveEquipmentFloatingById((prev) => {
      const current = prev && typeof prev === "object" ? prev : {};
      if (!current[nextId]) return current;
      const next = { ...current };
      delete next[nextId];
      return next;
    });
  }

  function clampLiveEquipmentFloatingPosition(id, xRaw, yRaw) {
    const viewportRect =
      svgRef.current?.closest?.(".vizi-scroll")?.getBoundingClientRect?.() || null;
    const cardEl = liveEquipmentCardRefs.current.get(String(id || "").trim());
    const cardRect = cardEl?.getBoundingClientRect?.() || null;
    const cardW = Math.max(
      1,
      Number(cardRect?.width) ||
        Math.min(300, Math.max(180, Math.round((Number(window.innerWidth) || 0) * 0.68)))
    );
    const cardH = Math.max(
      1,
      Number(cardRect?.height) ||
        Math.min(Math.round((Number(window.innerHeight) || 0) * 0.34), 420)
    );
    const pad = 6;
    const fallbackLeft = 0;
    const fallbackTop = Math.max(0, Number(TOP_BAR_H) || 0) + (isLiveMode ? LIVE_ALARM_BAR_H : 0);
    const minX = (Number(viewportRect?.left) || fallbackLeft) + pad;
    const minY = (Number(viewportRect?.top) || fallbackTop) + pad;
    const maxRight = (Number(viewportRect?.right) || Number(window.innerWidth) || 0) - pad;
    const maxBottom = (Number(viewportRect?.bottom) || Number(window.innerHeight) || 0) - pad;
    const maxX = Math.max(minX, maxRight - cardW);
    const maxY = Math.max(minY, maxBottom - cardH);
    const nextX = Math.min(maxX, Math.max(minX, Number(xRaw) || 0));
    const nextY = Math.min(maxY, Math.max(minY, Number(yRaw) || 0));
    return { x: nextX, y: nextY };
  }

  function beginLiveEquipmentCardDrag(e, id) {
    if (e.button !== 0) return;
    const nextId = String(id || "").trim();
    if (!nextId) return;
    bringLiveEquipmentToFront(nextId);
    const pos = liveEquipmentFloatingById?.[nextId];
    if (!pos) return;
    liveEquipmentDragRef.current = {
      id: nextId,
      startX: Number(e.clientX) || 0,
      startY: Number(e.clientY) || 0,
      originX: Number(pos.x) || 0,
      originY: Number(pos.y) || 0,
    };
    e.preventDefault();
    e.stopPropagation();
  }

  function beginLiveEquipmentCardMove(e, id) {
    if (e.button !== 0) return;
    const target = e.target;
    if (target && typeof target.closest === "function") {
      if (target.closest("button,input,select,textarea,a,[data-no-card-drag='true']")) return;
    }
    const nextId = String(id || "").trim();
    if (!nextId) return;
    bringLiveEquipmentToFront(nextId);
    const existing = liveEquipmentFloatingById?.[nextId];
    let originX = Number(existing?.x);
    let originY = Number(existing?.y);
    if (!Number.isFinite(originX) || !Number.isFinite(originY)) {
      const cardEl = liveEquipmentCardRefs.current.get(nextId);
      const cardRect = cardEl?.getBoundingClientRect?.();
      const liveTopOffset = TOP_BAR_H + (isLiveMode ? LIVE_ALARM_BAR_H : 0);
      originX = Math.max(0, Number(cardRect?.left) || Math.max(16, window.innerWidth - 340));
      originY = Math.max(
        liveTopOffset + 4,
        Number(cardRect?.top) || Math.max(liveTopOffset + 20, window.innerHeight - 280)
      );
      const clampedOrigin = clampLiveEquipmentFloatingPosition(nextId, originX, originY);
      originX = clampedOrigin.x;
      originY = clampedOrigin.y;
      setLiveEquipmentFloatingById((prev) => ({
        ...(prev && typeof prev === "object" ? prev : {}),
        [nextId]: { x: originX, y: originY },
      }));
    }
    liveEquipmentDragRef.current = {
      id: nextId,
      startX: Number(e.clientX) || 0,
      startY: Number(e.clientY) || 0,
      originX,
      originY,
    };
    e.preventDefault();
    e.stopPropagation();
  }

  useEffect(() => {
    const onMove = (e) => {
      const drag = liveEquipmentDragRef.current;
      if (!drag) return;
      const dx = (Number(e.clientX) || 0) - drag.startX;
      const dy = (Number(e.clientY) || 0) - drag.startY;
      setLiveEquipmentFloatingById((prev) => {
        const map = prev && typeof prev === "object" ? prev : {};
        const cur = map[drag.id];
        if (!cur) return map;
        const clamped = clampLiveEquipmentFloatingPosition(
          drag.id,
          drag.originX + dx,
          drag.originY + dy
        );
        return {
          ...map,
          [drag.id]: { x: clamped.x, y: clamped.y },
        };
      });
      setLiveEquipmentDockTick((v) => v + 1);
    };
    const onUp = () => {
      if (!liveEquipmentDragRef.current) return;
      liveEquipmentDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [TOP_BAR_H, isLiveMode]);

  function onLiveEquipmentDockScroll() {
    if (liveEquipmentDockScrollRafRef.current) return;
    liveEquipmentDockScrollRafRef.current = window.requestAnimationFrame(() => {
      liveEquipmentDockScrollRafRef.current = 0;
      setLiveEquipmentDockTick((v) => v + 1);
    });
  }

  function bringLiveEquipmentToFront(id) {
    const nextId = String(id || "").trim();
    if (!nextId) return;
    liveEquipmentZCounterRef.current += 1;
    const nextZ = liveEquipmentZCounterRef.current;
    setLiveEquipmentZById((prev) => {
      const map = prev && typeof prev === "object" ? prev : {};
      if (Number(map[nextId] || 0) === nextZ) return map;
      return { ...map, [nextId]: nextZ };
    });
  }

  useEffect(
    () => () => {
      if (liveEquipmentDockScrollRafRef.current) {
        window.cancelAnimationFrame(liveEquipmentDockScrollRafRef.current);
        liveEquipmentDockScrollRafRef.current = 0;
      }
    },
    []
  );

  useEffect(() => {
    if (!isLiveMode || !liveEquipmentDockEntries.length) return undefined;
    const onResize = () => setLiveEquipmentDockTick((v) => v + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isLiveMode, liveEquipmentDockEntries.length]);

  useEffect(() => {
    const isTypingTarget = (target) => {
      if (!target) return false;
      const tag = String(target.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || target.isContentEditable;
    };
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (isTypingTarget(e.target)) return;
      if (!isLiveMode) return;
      if (!liveEquipmentOverlayIds.length && !String(liveEquipmentDrawerOverlayId || "").trim()) return;
      e.preventDefault();
      setLiveEquipmentOverlayIds((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        if (!list.length) return list;
        return list.slice(0, -1);
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isLiveMode, liveEquipmentOverlayIds, liveEquipmentDrawerOverlayId]);

  function onSvgMouseDown(e) {
    if (e.button === 2) return;
    if (importOpen) return;
    if (showProjectNameInput) cancelNewProjectInput();

    const p = svgPoint(e);

    if (tool === "polyline") {
      let p2 = p;

      if (e.altKey && drawing?.mode === "draw-poly") {
        const cur = shapesRef.current.find((s) => s.id === drawing.id);
        if (cur?.type === "polyline" && Array.isArray(cur.points) && cur.points.length >= 2) {
          const fixed = cur.points.slice(0, -1);
          const last = fixed[fixed.length - 1];
          if (last) p2 = constrainHV(last, p2);
        }
      }

      if (!drawing) startPolylineAt(p2, { disableSnap: !!e.altKey });
      else addPolylinePoint(p2, { disableSnap: !!e.altKey });
      return;
    }

    if (tool === "text") {
      startTextAt(p);
      return;
    }

    if (tool === "rect") {
      startRectAt(p);
      return;
    }

    if (tool === "circle") {
      startCircleAt(p);
      return;
    }

    if (tool === "select") {
      const panModifier = !!(e.altKey || e.metaKey || e.ctrlKey);
      if (panModifier) {
        setMarquee(null);
        setCanvasPanDrag({
          startClient: { x: Number(e.clientX) || 0, y: Number(e.clientY) || 0 },
          startPan:
            panRef.current && Number.isFinite(panRef.current.x) && Number.isFinite(panRef.current.y)
              ? { x: panRef.current.x, y: panRef.current.y }
              : { x: 0, y: 0 },
          moved: false,
        });
      } else {
        setCanvasPanDrag(null);
        setMarquee({ start: p, cur: p, additive: !!e.shiftKey });
      }
      exitEditMode();
      setDrawing(null);
    }
  }


  function onSvgDoubleClick(e) {
    // while drawing, dblclick finishes line
    if (tool === "polyline" && drawing) {
      e.preventDefault();
      e.stopPropagation();
      finishPolyline();
      return;
    }

    // (optional) keep your non-drawing dblclick behavior here if you want later
  }

  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || t.isContentEditable;
    }

    function onKeyDown(e) {
      if (isTypingTarget(e.target)) return;
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      if (editingId) {
        setSelectedSegment(null);
        exitEditMode();
        return;
      }
      if (!drawing) return;
      if (drawing.mode === "draw-poly") {
        // Ensure Enter commits the same point currently shown by preview even when a RAF mousemove is pending.
        const pendingEvt = pendingMouseMoveRef.current;
        if (pendingEvt) {
          pendingMouseMoveRef.current = null;
          if (mouseMoveRafRef.current) {
            window.cancelAnimationFrame(mouseMoveRafRef.current);
            mouseMoveRafRef.current = 0;
          }
          onMouseMove(pendingEvt);
        }
        finishPolyline();
        return;
      }
      if (drawing.mode === "draw-rect") {
        finishRectDrawing(drawing.id);
        return;
      }
      if (drawing.mode === "draw-circle") {
        finishCircleDrawing(drawing.id);
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [tool, drawing, editingId]);

  useEffect(() => {
    const isTypingTarget = (target) => {
      if (!target) return false;
      const tag = String(target.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || target.isContentEditable;
    };

    const onKeyDown = (e) => {
      if (isLiveMode) return;
      if (isTypingTarget(e.target)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (!Array.isArray(selectedOverlayIds) || !selectedOverlayIds.length) return;

      if (e.key === "PageUp") {
        e.preventDefault();
        e.stopPropagation();
        bringSelectedOverlaysToFront();
        return;
      }
      if (e.key === "PageDown") {
        e.preventDefault();
        e.stopPropagation();
        sendSelectedOverlaysToBack();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    isLiveMode,
    selectedOverlayIds,
    bringSelectedOverlaysToFront,
    sendSelectedOverlaysToBack,
  ]);


  function onContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    if (selectionMode === "svg") {
      setSelectedIds([]);
    } else if (selectionMode === "polyline") {
      setSelectedOverlayIds([]);
    }

    // ? While drawing: right-click removes the last SAVED segment (2 entries back)
    if (tool === "polyline" && drawing?.mode === "draw-poly") {
      const id = drawing.id;

      setShapes((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;

          // points = [...fixed, preview]
          // need at least [p0, p1, preview] to undo a segment
          if (!s.points || s.points.length < 3) return s;

          // remove last fixed + preview
          const fixedMinusLast = s.points.slice(0, -2);

          // if only one point left, keep preview at that point
          const tail = fixedMinusLast[fixedMinusLast.length - 1] ?? s.points[0];
          return { ...s, points: [...fixedMinusLast, { x: tail.x, y: tail.y }] };
        })
      );

      return;
    }

    // ? Not drawing: keep your import-marker right-double-click
    const now = performance.now();
    const dt = now - (lastRightClickRef.current || 0);
    lastRightClickRef.current = now;

    if (dt > 0 && dt < RIGHT_DBL_MS) {
      const p = svgPoint(e);
      setImportAnchor(p);
      setContextMenu(null);
      return;
    }

    if (importOpen) return;

    const p = svgPoint(e);
    function pointInRect(pt, r) {
      return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
    }

    let hit = false;
    let hitShapeId = null;
    let hitOverlayId = null;

    const shapeList = Array.isArray(shapesRef.current) ? shapesRef.current : [];
    for (let i = shapeList.length - 1; i >= 0; i -= 1) {
      const s = shapeList[i];
      if (!isShapeSelectableByMode(s)) continue;
      if (s.type === "text") {
        const tb = textBoxFromShape(s);
        if (!tb) continue;
        const pad = 8;
        const r = {
          x: tb.x - pad,
          y: tb.y - pad,
          w: Math.max(tb.w + pad * 2, 60),
          h: Math.max(tb.h + pad * 2, 28),
        };
        if (pointInRect(p, r)) { hit = true; hitShapeId = s.id; break; }
      } else if (s.type === "rect" || s.type === "circle") {
        const r = {
          x: Number(s.x ?? 0),
          y: Number(s.y ?? 0),
          w: Math.max(0, Number(s.width ?? 0)),
          h: Math.max(0, Number(s.height ?? 0)),
        };
        if (pointInRect(p, r)) { hit = true; hitShapeId = s.id; break; }
      } else if (Array.isArray(s.points)) {
        const bb = bboxOfPoints(s.points);
        if (bb) {
          const r = { x: bb.minX, y: bb.minY, w: bb.w, h: bb.h };
          if (pointInRect(p, r)) { hit = true; hitShapeId = s.id; break; }
        }
      }
    }

    if (!hit) {
      const overlayList = Array.isArray(overlaysRef.current) ? overlaysRef.current : [];
      if (areOverlaysSelectableByMode()) {
        for (let i = overlayList.length - 1; i >= 0; i -= 1) {
          const o = overlayList[i];
          const bb = o.bbox || overlayLocalBBox(o.id);
          if (!bb) continue;
          const wr = overlayWorldRect(o, bb);
          const r = {
            x: wr.x,
            y: wr.y,
            w: wr.w,
            h: wr.h,
          };
          if (pointInRect(p, r)) { hit = true; hitOverlayId = o.id; break; }
        }
      }
    }

    // ? If nothing directly hit, allow right-click on current group bbox
    if (!hit && selectedBBox) {
      const r = { x: selectedBBox.x, y: selectedBBox.y, w: selectedBBox.w, h: selectedBBox.h };
      if (pointInRect(p, r)) {
        hit = true;
      }
    }

    const curSelShapes = selPolyRef.current || [];
    const curSelOvers = selOverRef.current || [];
    const curSelCount = curSelShapes.length + curSelOvers.length;

    if (hitShapeId) {
      if (!(curSelCount > 1 && curSelShapes.includes(hitShapeId))) {
        setSelectedIds([hitShapeId]);
        setSelectedOverlayIds([]);
      }
    } else if (hitOverlayId) {
      if (!(curSelCount > 1 && curSelOvers.includes(hitOverlayId))) {
        setSelectedOverlayIds([hitOverlayId]);
        setSelectedIds([]);
      }
    }

    setContextMenu({ x: e.clientX, y: e.clientY, mode: hit ? "element" : "empty" });
    setLastContextPoint(p);
    if (!hit) setContextImportQuery("");
    setContextSvgMenuOpen(false);
  }




  function publishProjectCursor(point) {
    if (!activeProjectId || !point) return;
    const payload = { x: Number(point.x), y: Number(point.y) };
    if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
    const now = Date.now();
    const last = lastCursorSentRef.current || { at: 0, x: NaN, y: NaN };
    const dx = Math.abs(payload.x - Number(last.x));
    const dy = Math.abs(payload.y - Number(last.y));
    if (now - Number(last.at || 0) < 50 && dx < 0.25 && dy < 0.25) return;
    lastCursorSentRef.current = { at: now, x: payload.x, y: payload.y };

    if (cursorPublishInFlightRef.current) {
      queuedCursorPointRef.current = payload;
      return;
    }

    cursorPublishInFlightRef.current = true;
    (async () => {
      try {
        await upsertProjectCursor(activeProjectId, payload);
      } catch {
        // ignore cursor publish failures
      } finally {
        cursorPublishInFlightRef.current = false;
        const queued = queuedCursorPointRef.current;
        queuedCursorPointRef.current = null;
        if (queued) publishProjectCursor(queued);
      }
    })();
  }

  function onMouseMoveImmediate(e) {
    const smoothDragPointer = (rawPoint, mode) => {
      const rawX = Number(rawPoint?.x);
      const rawY = Number(rawPoint?.y);
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return rawPoint;
      const prev = dragPointerSmoothingRef.current || { mode: "", x: NaN, y: NaN };
      if (String(prev.mode || "") !== String(mode || "") || !Number.isFinite(prev.x) || !Number.isFinite(prev.y)) {
        dragPointerSmoothingRef.current = { mode, x: rawX, y: rawY };
        return { x: rawX, y: rawY };
      }
      const alpha = 0.58;
      const sx = Number(prev.x) + (rawX - Number(prev.x)) * alpha;
      const sy = Number(prev.y) + (rawY - Number(prev.y)) * alpha;
      dragPointerSmoothingRef.current = { mode, x: sx, y: sy };
      return { x: sx, y: sy };
    };

    const maybeAutoPanDuringDrag = (evt) => {
      const el = svgRef.current;
      if (!el) return false;
      const viewportEl = el.closest(".vizi-scroll");
      const rect = viewportEl?.getBoundingClientRect?.();
      if (!rect) return false;
      const edge = 56;
      const maxStep = 22;
      const gain = 0.35;
      let stepX = 0;
      let stepY = 0;
      const cx = Number(evt?.clientX) || 0;
      const cy = Number(evt?.clientY) || 0;
      const leftEdge = rect.left + edge;
      const rightEdge = rect.right - edge;
      const topEdge = rect.top + edge;
      const bottomEdge = rect.bottom - edge;
      if (cx < leftEdge) {
        const d = Math.min(edge, leftEdge - cx);
        stepX = Math.max(2, Math.min(maxStep, d * gain));
      } else if (cx > rightEdge) {
        const d = Math.min(edge, cx - rightEdge);
        stepX = -Math.max(2, Math.min(maxStep, d * gain));
      }
      if (cy < topEdge) {
        const d = Math.min(edge, topEdge - cy);
        stepY = Math.max(2, Math.min(maxStep, d * gain));
      } else if (cy > bottomEdge) {
        const d = Math.min(edge, cy - bottomEdge);
        stepY = -Math.max(2, Math.min(maxStep, d * gain));
      }
      if (!stepX && !stepY) return false;

      // Prefer moving the actual viewport scroll so horizontal scrollbar follows drag.
      if (viewportEl) {
        const cur = {
          x: Number(viewportEl.scrollLeft || 0),
          y: Number(viewportEl.scrollTop || 0),
        };
        const maxScrollX = Math.max(0, Number(viewportEl.scrollWidth || 0) - Number(viewportEl.clientWidth || 0));
        const nextX = Math.max(0, Math.min(maxScrollX, Number(cur.x || 0) - stepX));
        if (Math.abs(nextX - Number(cur.x || 0)) > 0.1) {
          const next = { x: nextX, y: Number(cur.y || 0) };
          viewportEl.scrollLeft = nextX;
          canvasViewportScrollRef.current = next;
          setCanvasViewportScrollTarget(next);
          return true;
        }
      }

      let applied = null;
      setPan((prev) => {
        const next = clampPanToViewport({
          x: Number(prev?.x || 0) + stepX,
          y: Number(prev?.y || 0) + stepY,
        });
        applied = next;
        return next;
      });
      if (applied) panRef.current = applied;
      return true;
    };

    let p =
      drawing?.mode === "draw-poly"
        ? svgPoint(e, { snapToGrid: true })
        : drawing?.mode === "draw-circle" && e.altKey
        ? svgPoint(e, { snapToGrid: false, clampToCanvas: false })
        : svgPoint(e, { snapToGrid: false });
    publishProjectCursor(p);
    if (marquee) {
      setMarquee((m) => (m ? { ...m, cur: p } : m));
      return;
    }

    if (canvasPanDrag) {
      const dx = (Number(e.clientX) || 0) - Number(canvasPanDrag.startClient?.x || 0);
      const dy = (Number(e.clientY) || 0) - Number(canvasPanDrag.startClient?.y || 0);
      const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1;
      if (moved && !canvasPanDrag.moved) {
        setCanvasPanDrag((prev) => (prev ? { ...prev, moved: true } : prev));
      }
      const nextPan = clampPanToViewport({
        x: Number(canvasPanDrag.startPan?.x || 0) + dx,
        y: Number(canvasPanDrag.startPan?.y || 0) + dy,
      });
      setPan(nextPan);
      return;
    }

    if (drawing?.mode === "draw-poly") {
      const id = drawing.id;
      const PREVIEW_SMOOTH_ALPHA = 0.45;
      const PREVIEW_MIN_MOVE = 0.35;

      setShapes((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;

          const pts = s.points.slice();
          const fixed = pts.slice(0, -1);             // points excluding preview
          const last = fixed[fixed.length - 1] || pts[0];
          const prevPreview = pts[pts.length - 1] || last;

          let nextP = svgPoint(e);

          // ? ALT = straight line (horizontal/vertical) from last fixed point
          if (e.altKey && last) {
            nextP = constrainHV(last, nextP);
          }

          const endpointSnap = e.altKey
            ? { snapped: false, point: nextP }
            : getNearestPolylineEndpointSnap(
                snapPointToNearestPolylineConnection(nextP, POLYLINE_CONNECTION_SNAP_THRESHOLD),
                POLYLINE_ENDPOINT_SNAP_THRESHOLD,
                {
                  excludeShapeId: id,
                  excludeIndexes: [0, pts.length - 1],
                }
              );
          nextP = endpointSnap.point;

          const first = fixed[0];
          const SNAP_DIST = 12;
          if (first && distance(nextP, first) <= SNAP_DIST) {
            nextP = { x: first.x, y: first.y };
          }

          // Smooth preview updates to reduce micro-jitter while drawing.
          // Keep ALT constrained mode unfiltered for precise orthogonal segments.
          if (!e.altKey && prevPreview && !endpointSnap.snapped) {
            nextP = {
              x: prevPreview.x + (nextP.x - prevPreview.x) * PREVIEW_SMOOTH_ALPHA,
              y: prevPreview.y + (nextP.y - prevPreview.y) * PREVIEW_SMOOTH_ALPHA,
            };
          }
          if (prevPreview && distance(prevPreview, nextP) < PREVIEW_MIN_MOVE) {
            return s;
          }

          pts[pts.length - 1] = { x: nextP.x, y: nextP.y };
          return { ...s, points: pts };
        })
      );
      return;
    }

    if (overlayResize) {
      if (maybeAutoPanDuringDrag(e)) {
        p = drawing?.mode === "draw-poly" ? svgPoint(e, { snapToGrid: true }) : svgPoint(e, { snapToGrid: false });
      }
      p = smoothDragPointer(p, overlayResize?.kind === "group" ? "overlay-resize-group" : "overlay-resize");
      if (overlayResize?.kind === "group") {
        const anchorWorld = overlayResize.anchorWorld || { x: 0, y: 0 };
        const startDist = Math.max(1, Number(overlayResize.startDist || 1));
        const d = Math.max(1, distance(p, anchorWorld));
        const ratio = d / startDist;
        const base = Array.isArray(overlayResize.overlays) ? overlayResize.overlays : [];
        const byId = new Map(base.map((o) => [String(o.id), o]));
        setSvgOverlays((prev) => {
          const next = prev.map((o) => {
            const rec = byId.get(String(o.id));
            if (!rec) return o;
            const isConveyorScrew = isConveyorScrewOverlay(o);
            const sxBase = Math.max(0.05, Number(rec.sx || 1) * ratio);
            const syBase = Math.max(0.05, Number(rec.sy || 1) * ratio);
            const uniform = Math.max(0.05, Math.max(Number(rec.sx || 1), Number(rec.sy || 1)) * ratio);
            const sx = isConveyorScrew ? uniform : sxBase;
            const sy = isConveyorScrew ? uniform : syBase;
            const txRaw = anchorWorld.x + (Number(rec.tx || 0) - anchorWorld.x) * ratio;
            const tyRaw = anchorWorld.y + (Number(rec.ty || 0) - anchorWorld.y) * ratio;
            const bb = o?.bbox || overlayLocalBBox(o.id);
            if (!bb) return { ...o, tx: txRaw, ty: tyRaw, scale: sx, scaleX: sx, scaleY: sy };
            const clamped = clampOverlayTransformToCanvas(txRaw, tyRaw, sx, sy, bb);
            return { ...o, tx: clamped.tx, ty: clamped.ty, scale: sx, scaleX: sx, scaleY: sy };
          });
          overlaysRef.current = next;
          return next;
        });
        syncProjectDuringDrag();
        return;
      }
      const { id, isWidget, anchorLocal, anchorWorld, startDist, origScaleX, origScaleY } = overlayResize;
      const o = svgOverlays.find((x) => x.id === id);
      if (!o) return;

      if (isWidget) {
        const minW = 80;
        const minH = 60;
        const leftRaw = Math.min(anchorWorld.x, p.x);
        const rightRaw = Math.max(anchorWorld.x, p.x);
        const topRaw = Math.min(anchorWorld.y, p.y);
        const bottomRaw = Math.max(anchorWorld.y, p.y);
        const width = Math.max(minW, rightRaw - leftRaw);
        const height = Math.max(minH, bottomRaw - topRaw);
        const clamped = clampOverlayTransformToCanvas(leftRaw, topRaw, 1, 1, {
          x: 0,
          y: 0,
          width,
          height,
        });
        setSvgOverlays((prev) => {
          const next = prev.map((x) =>
            x.id === id
              ? {
                  ...x,
                  scale: 1,
                  scaleX: 1,
                  scaleY: 1,
                  tx: clamped.tx,
                  ty: clamped.ty,
                  bbox: { x: 0, y: 0, width, height },
                }
              : x
          );
          overlaysRef.current = next;
          return next;
        });
        syncProjectDuringDrag();
        return;
      }

      const d = Math.max(1, distance(p, anchorWorld));
      const ratio = d / startDist;
      const isConveyorScrew = isConveyorScrewOverlay(o);
      const uniformScale = Math.max(0.05, Math.max(origScaleX, origScaleY) * ratio);
      const newScaleX = isConveyorScrew ? uniformScale : Math.max(0.05, origScaleX * ratio);
      const newScaleY = isConveyorScrew ? uniformScale : Math.max(0.05, origScaleY * ratio);

      const newTxRaw = anchorWorld.x - newScaleX * anchorLocal.x;
      const newTyRaw = anchorWorld.y - newScaleY * anchorLocal.y;
      const bb = o?.bbox || overlayLocalBBox(id);
      const clamped = bb
        ? clampOverlayTransformToCanvas(newTxRaw, newTyRaw, newScaleX, newScaleY, bb)
        : { tx: newTxRaw, ty: newTyRaw };

      setSvgOverlays((prev) => {
        const next = prev.map((x) =>
          x.id === id
            ? { ...x, scale: newScaleX, scaleX: newScaleX, scaleY: newScaleY, tx: clamped.tx, ty: clamped.ty }
            : x
        );
        overlaysRef.current = next;
        return next;
      });
      syncProjectDuringDrag();
      return;
    }

    if (shapeResize) {
      if (maybeAutoPanDuringDrag(e)) {
        // Recompute pointer after viewport moved.
      }
      const pointer = smoothDragPointer(svgPoint(e, { clampToCanvas: false }), "shape-resize");
      const anchor = shapeResize.anchor || { x: 0, y: 0 };
      let nextX = Math.min(anchor.x, pointer.x);
      let nextY = Math.min(anchor.y, pointer.y);
      let nextW = Math.max(1, Math.abs(pointer.x - anchor.x));
      let nextH = Math.max(1, Math.abs(pointer.y - anchor.y));
      const keepCircle = shapeResize.keepCircle === true;
      if (keepCircle) {
        const size = Math.max(nextW, nextH);
        nextW = size;
        nextH = size;
        if (pointer.x < anchor.x) nextX = anchor.x - size;
        else nextX = anchor.x;
        if (pointer.y < anchor.y) nextY = anchor.y - size;
        else nextY = anchor.y;
      }
      const startBBox = shapeResize.startBBox || { x: 0, y: 0, w: 1, h: 1 };
      const baseW = Math.max(1e-6, Number(startBBox.w || 0));
      const baseH = Math.max(1e-6, Number(startBBox.h || 0));
      const sx = nextW / baseW;
      const sy = nextH / baseH;
      const dx = nextX - Number(startBBox.x || 0);
      const dy = nextY - Number(startBBox.y || 0);
      const srcById = new Map((Array.isArray(shapeResize.originals) ? shapeResize.originals : []).map((s) => [s.id, s]));
      setShapes((prev) => {
        const next = prev.map((s) => {
          const src = srcById.get(s.id);
          if (!src) return s;
          if ((src.type === "polyline" || Array.isArray(src.points)) && Array.isArray(src.points)) {
            return {
              ...s,
              points: src.points.map((pt) => ({
                x: Number(startBBox.x || 0) + (pt.x - Number(startBBox.x || 0)) * sx + dx,
                y: Number(startBBox.y || 0) + (pt.y - Number(startBBox.y || 0)) * sy + dy,
              })),
            };
          }
          if (src.type === "text") {
            const newX = Number(startBBox.x || 0) + (Number(src.x || 0) - Number(startBBox.x || 0)) * sx + dx;
            const newY = Number(startBBox.y || 0) + (Number(src.y || 0) - Number(startBBox.y || 0)) * sy + dy;
            const uniform = Math.max(0.05, Math.min(sx, sy));
            return { ...s, x: newX, y: newY, fontSize: Math.max(1, Number(src.fontSize || 24) * uniform) };
          }
          if (src.type === "rect" || src.type === "circle") {
            const x0 = Number(src.x || 0);
            const y0 = Number(src.y || 0);
            const w0 = Math.max(0, Number(src.width || 0));
            const h0 = Math.max(0, Number(src.height || 0));
            const x1 = x0 + w0;
            const y1 = y0 + h0;
            let nx0 = Number(startBBox.x || 0) + (x0 - Number(startBBox.x || 0)) * sx + dx;
            let ny0 = Number(startBBox.y || 0) + (y0 - Number(startBBox.y || 0)) * sy + dy;
            let nx1 = Number(startBBox.x || 0) + (x1 - Number(startBBox.x || 0)) * sx + dx;
            let ny1 = Number(startBBox.y || 0) + (y1 - Number(startBBox.y || 0)) * sy + dy;
            if (src.type === "circle") {
              const size = Math.max(Math.abs(nx1 - nx0), Math.abs(ny1 - ny0));
              nx1 = nx0 + (nx1 >= nx0 ? size : -size);
              ny1 = ny0 + (ny1 >= ny0 ? size : -size);
            }
            return {
              ...s,
              x: Math.min(nx0, nx1),
              y: Math.min(ny0, ny1),
              width: Math.abs(nx1 - nx0),
              height: Math.abs(ny1 - ny0),
            };
          }
          return s;
        });
        shapesRef.current = next;
        return next;
      });
      syncProjectDuringDrag();
      return;
    }

    if (dragHandle) {
      if (maybeAutoPanDuringDrag(e)) {
        p = drawing?.mode === "draw-poly" ? svgPoint(e, { snapToGrid: true }) : svgPoint(e, { snapToGrid: false });
      }
      p = smoothDragPointer(p, "drag-handle");
      const draggedShape = shapesRef.current.find((s) => s.id === dragHandle.id);
      const draggedPointCount = Array.isArray(draggedShape?.points) ? draggedShape.points.length : 0;
      const isEndpoint = dragHandle.index === 0 || dragHandle.index === draggedPointCount - 1;
      const snappedPoint = isEndpoint
        ? snapPointToNearestPolylineEndpoint(p, POLYLINE_ENDPOINT_SNAP_THRESHOLD, {
            excludeShapeId: dragHandle.id,
            excludeIndexes: [dragHandle.index],
          })
        : p;
      setShapes((prev) => {
        const next = prev.map((s) => {
          if (s.id !== dragHandle.id) return s;
          const pts = s.points.slice();
          pts[dragHandle.index] = { x: snappedPoint.x, y: snappedPoint.y };
          return { ...s, points: pts };
        });
        shapesRef.current = next;
        return next;
      });
      syncProjectDuringDrag();
      return;
    }

    if (dragAll) {
      maybeAutoPanDuringDrag(e);
      const pointer = smoothDragPointer(svgPoint(e, { clampToCanvas: false }), "drag-all");
      const dx = pointer.x - dragAll.startWorld.x;
      const dy = pointer.y - dragAll.startWorld.y;
      const maxX = Math.max(0, Number(vbW) || 0);
      const maxY = Math.max(0, Number(vbH) || 0);
      const dragShapeById = new Map(
        (Array.isArray(dragAll.shapes) ? dragAll.shapes : []).map((item) => [String(item?.id || ""), item])
      );
      const dragOverlayById = new Map(
        (Array.isArray(dragAll.overlays) ? dragAll.overlays : []).map((item) => [String(item?.id || ""), item])
      );
      const draggedPolylinePayloads = (Array.isArray(dragAll.shapes) ? dragAll.shapes : []).filter(
        (item) => item?.kind === "poly" && Array.isArray(item?.origPoints)
      );
      const polylineSnapOffset = getSnapOffsetForMovedPolylineEndpoints(
        draggedPolylinePayloads,
        dx,
        dy,
        POLYLINE_ENDPOINT_SNAP_THRESHOLD
      );

      if (dragShapeById.size) {
        setShapes((prev) => {
          const next = prev.map((s) => {
            const rec = dragShapeById.get(String(s?.id || ""));
            if (!rec) return s;

            if (rec.kind === "text" && s.type === "text") {
              const fontSize = Number(s.fontSize ?? 24);
              const txt = String(s.text ?? "");
              const estW = Math.max(10, txt.length * fontSize * 0.6);
              const anchor = String(s.anchor || "start");
              const leftOffset = anchor === "middle" ? estW / 2 : anchor === "end" ? estW : 0;
              const minTextX = leftOffset;
              const maxTextX = maxX - Math.max(0, estW - leftOffset);
              return {
                ...s,
                x: Math.max(minTextX, Math.min(Math.max(minTextX, maxTextX), rec.origX + dx)),
                y: Math.max(0, Math.min(maxY, rec.origY + dy)),
              };
            }

            if ((rec.kind === "rect" || rec.kind === "circle") && (s.type === "rect" || s.type === "circle")) {
              const w = Math.max(0, Number(rec.origW ?? s.width ?? 0));
              const h = Math.max(0, Number(rec.origH ?? s.height ?? 0));
              const x = Math.max(0, Math.min(Math.max(0, maxX - w), rec.origX + dx));
              const y = Math.max(0, Math.min(Math.max(0, maxY - h), rec.origY + dy));
              return {
                ...s,
                x,
                y,
                width: w,
                height: h,
              };
            }

            if (rec.kind === "poly" && Array.isArray(s.points)) {
              const moved = rec.origPoints.map((pt) => ({
                x: pt.x + dx + Number(polylineSnapOffset?.dx || 0),
                y: pt.y + dy + Number(polylineSnapOffset?.dy || 0),
              }));
              const bb = bboxOfPoints(moved);
              if (!bb) return { ...s, points: moved };
              let shiftX = 0;
              let shiftY = 0;
              if (bb.minX < 0) shiftX = -bb.minX;
              if (bb.minY < 0) shiftY = -bb.minY;
              if (bb.minX + bb.w > maxX) shiftX = Math.min(shiftX, maxX - (bb.minX + bb.w));
              if (bb.minY + bb.h > maxY) shiftY = Math.min(shiftY, maxY - (bb.minY + bb.h));
              return {
                ...s,
                points: moved.map((pt) => ({ x: pt.x + shiftX, y: pt.y + shiftY })),
              };
            }

            return s;
          });
          shapesRef.current = next;
          return next;
        });
      }

    if (dragOverlayById.size) {
      let dynamicCanvasW = maxX;
      for (const o of svgOverlays) {
        const rec = dragOverlayById.get(String(o?.id || ""));
        if (!rec) continue;
        const bb = o?.bbox || overlayLocalBBox(o.id);
        if (!bb) continue;
        const sx = overlayScaleX(o);
        const bx = Number(bb.x) || 0;
        const bw = Math.max(1, Number(bb.width) || 1);
        const rawTx = Number(rec.origTx || 0) + dx;
        const right = rawTx + sx * (bx + bw);
        if (right + 8 > dynamicCanvasW) dynamicCanvasW = right + 8;
      }

      if (dynamicCanvasW > maxX + 0.5) {
        const nextW = Math.ceil(dynamicCanvasW);
        setVbW(nextW);
        vbWRef.current = nextW;
        setScreens((prev) =>
          (Array.isArray(prev) ? prev : []).map((s) =>
            String(s?.id || "") === String(activeScreenId || "")
              ? { ...s, vbW: Math.max(Number(s?.vbW) || 0, nextW) }
              : s
          )
        );
      }

      setSvgOverlays((prev) => {
        const next = prev.map((o) => {
          const rec = dragOverlayById.get(String(o?.id || ""));
          if (!rec) return o;
          const bb = o?.bbox || overlayLocalBBox(o.id);
          const sx = overlayScaleX(o);
          const sy = overlayScaleY(o);
          if (!bb) return { ...o, tx: rec.origTx + dx, ty: rec.origTy + dy };
          const clamped = clampOverlayTransformToCanvas(
            rec.origTx + dx,
            rec.origTy + dy,
            sx,
            sy,
            bb,
            { canvasW: dynamicCanvasW, canvasH: maxY }
          );
          return { ...o, tx: clamped.tx, ty: clamped.ty };
        });
        overlaysRef.current = next;
        return next;
      });
      }
      syncProjectDuringDrag();
      return;
    }

    if (drawing?.mode === "draw-rect" && drawing.id) {
      const sx = Number(drawing.start?.x ?? p.x);
      const sy = Number(drawing.start?.y ?? p.y);
      const x = Math.min(sx, p.x);
      const y = Math.min(sy, p.y);
      const width = Math.abs(p.x - sx);
      const height = Math.abs(p.y - sy);
      setShapes((prev) => {
        const next = prev.map((s) => (s.id === drawing.id ? { ...s, x, y, width, height } : s));
        shapesRef.current = next;
        return next;
      });
      return;
    }

    if (drawing?.mode === "draw-circle" && drawing.id) {
      const sx = Number(drawing.start?.x ?? p.x);
      const sy = Number(drawing.start?.y ?? p.y);
      const dx = p.x - sx;
      const dy = p.y - sy;
      // Draw circles from center for more precise placement.
      const r = Math.hypot(dx, dy);
      const x = sx - r;
      const y = sy - r;
      const width = r * 2;
      const height = r * 2;
      setShapes((prev) => {
        const next = prev.map((s) => (s.id === drawing.id ? { ...s, x, y, width, height } : s));
        shapesRef.current = next;
        return next;
      });
      return;
    }

  }

  function onMouseMove(e) {
    const eventLike = {
      clientX: Number(e?.clientX) || 0,
      clientY: Number(e?.clientY) || 0,
      altKey: !!e?.altKey,
      shiftKey: !!e?.shiftKey,
    };
    pendingMouseMoveRef.current = eventLike;
    if (mouseMoveRafRef.current) return;
    mouseMoveRafRef.current = window.requestAnimationFrame(() => {
      mouseMoveRafRef.current = 0;
      const nextEvent = pendingMouseMoveRef.current;
      pendingMouseMoveRef.current = null;
      if (!nextEvent) return;
      onMouseMoveImmediate(nextEvent);
    });
  }

  function onMouseUp() {
    dragPointerSmoothingRef.current = { mode: "", x: NaN, y: NaN };
    const hadDragHandle = !!dragHandle;
    const hadCanvasPanDrag = !!canvasPanDrag;
    const didCanvasPanMove = Boolean(canvasPanDrag?.moved);
    if (hadCanvasPanDrag) {
      setCanvasPanDrag(null);
      if (!didCanvasPanMove) {
        if (!preserveSvgSelectionWhileHudOpen) clearSelection();
      } else {
        scheduleProjectAutoSave(120);
      }
      return;
    }
    if (marquee) {
      const r = rectFrom2Points(marquee.start, marquee.cur);

      // ? Shapes (polylines + text + rect) in rect
      const hitShapeIds = shapes
        .filter((s) => {
          if (!isShapeSelectableByMode(s)) return false;
          // Polyline bbox
          if (s.type === "polyline" && Array.isArray(s.points)) {
            const bb = bboxOfPoints(s.points);
            if (!bb) return false;
            const br = { x: bb.minX, y: bb.minY, w: bb.w, h: bb.h };
            return rectsIntersect(r, br);
          }

          // Text bbox (approx)
          if (s.type === "text") {
            const tb = textBoxFromShape(s);
            if (!tb) return false;
            const br = {
              x: tb.x,
              y: tb.y,
              w: tb.w,
              h: tb.h,
            };
            return rectsIntersect(r, br);
          }

          if (s.type === "rect" || s.type === "circle") {
            const br = {
              x: Number(s.x ?? 0),
              y: Number(s.y ?? 0),
              w: Math.max(0, Number(s.width ?? 0)),
              h: Math.max(0, Number(s.height ?? 0)),
            };
            return rectsIntersect(r, br);
          }

          return false;
        })
        .map((s) => s.id);

      // ? Overlays in rect
      const hitOvers = svgOverlays
        .filter((o) => {
          if (!areOverlaysSelectableByMode()) return false;
          const bb = overlayLocalBBox(o.id);
          if (!bb) return false;
          const worldRect = overlayWorldRect(o, bb);
          return rectsIntersect(r, worldRect);
        })
        .map((o) => o.id);

      if (marquee.additive) {
        if (hitShapeIds.length || hitOvers.length) {
          setSelectedIds((prev) => Array.from(new Set([...(prev || []), ...hitShapeIds])));
          setSelectedOverlayIds((prev) => Array.from(new Set([...(prev || []), ...hitOvers])));
        }
      } else if (hitShapeIds.length || hitOvers.length) {
        setSelectedIds(hitShapeIds);
        setSelectedOverlayIds(hitOvers);
      } else {
        if (!preserveSvgSelectionWhileHudOpen) clearSelection();
      }

      setMarquee(null);
      setDragAll(null);
      setDragHandle(null);
      setOverlayResize(null);
      setShapeResize(null);
      return;
    }

    const movedSomething = !!(dragAll || dragHandle || overlayResize || shapeResize);
    setDragAll(null);
    setDragHandle(null);
    setOverlayResize(null);
    setShapeResize(null);
    if (hadDragHandle) {
      setSelectedSegment(null);
      exitEditMode();
    }
    if (movedSomething) scheduleProjectAutoSave(80);
    if (drawing?.mode === "draw-rect" && drawing.id) finishRectDrawing(drawing.id);
    if (drawing?.mode === "draw-circle" && drawing.id) finishCircleDrawing(drawing.id);
  }

  useEffect(() => {
    const isDragging =
      Boolean(dragAll) ||
      Boolean(dragHandle) ||
      Boolean(overlayResize) ||
      Boolean(shapeResize) ||
      Boolean(marquee) ||
      Boolean(canvasPanDrag) ||
      String(drawing?.mode || "") === "draw-rect" ||
      String(drawing?.mode || "") === "draw-circle";
    if (!isDragging) return;
    const handleMove = (e) => onMouseMove(e);
    const handleUp = () => onMouseUp();
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("blur", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("blur", handleUp);
    };
  }, [dragAll, dragHandle, overlayResize, shapeResize, marquee, canvasPanDrag, drawing, onMouseMove, onMouseUp]);

  useEffect(() => {
    return () => {
      if (mouseMoveRafRef.current) {
        window.cancelAnimationFrame(mouseMoveRafRef.current);
        mouseMoveRafRef.current = 0;
      }
      pendingMouseMoveRef.current = null;
    };
  }, []);



  function exportSVG() {
    const svg = svgRef.current;
    if (!svg) return;

    const serializer = new XMLSerializer();
    const svgText = serializer.serializeToString(svg);

    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "drawing.svg";
    a.click();

    URL.revokeObjectURL(url);
  }

  function exportIgnitionJson() {
    const payload = exportToIgnitionJson(
      { svgRef, shapes, svgOverlays, overlayRefs },
      { name: "Exported Drawing" }
    );

    downloadIgnitionJson(payload, "ignition-shapes.json");
  }

  function overlaySelectionUI(o) {
    const bb = overlayLocalBBox(o.id);
    if (!bb) return null;
    const wr = overlayWorldRect(o, bb);

    const x = wr.x;
    const y = wr.y;
    const w = wr.w;
    const h = wr.h;

    const corners = [
      { key: "TL", cx: x, cy: y },
      { key: "TR", cx: x + w, cy: y },
      { key: "BR", cx: x + w, cy: y + h },
      { key: "BL", cx: x, cy: y + h },
    ];

    return (
      <g>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill="none"
          stroke="#2b6cff"
          strokeWidth={2}
          strokeDasharray="6 4"
          pointerEvents="none"
        />

        {corners.map((c) => (
          <g key={c.key}>
            <circle cx={c.cx} cy={c.cy} r={3} fill="white" stroke="#2b6cff" strokeWidth={2} />
            <circle
              cx={c.cx}
              cy={c.cy}
              r={16}
              fill="transparent"
              style={{ cursor: altDown ? "move" : "nwse-resize" }}
              onMouseDown={(e) => onOverlayHandleDown(e, o.id, c.key)}
            />
          </g>
        ))}
      </g>
    );
  }

  function getSelectedOverlayGroupBBox(ids = selectedOverlayIds) {
    const list = Array.isArray(ids) ? ids : [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let hit = 0;
    for (const id of list) {
      const o = svgOverlays.find((x) => x.id === id);
      if (!o) continue;
      const bb = overlayLocalBBox(o.id);
      if (!bb) continue;
      const wr = overlayWorldRect(o, bb);
      minX = Math.min(minX, wr.x);
      minY = Math.min(minY, wr.y);
      maxX = Math.max(maxX, wr.x + wr.w);
      maxY = Math.max(maxY, wr.y + wr.h);
      hit += 1;
    }
    if (!hit || !Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function applyOverlaySpacing(axis = "x", gapRaw = 0) {
    const ids = (selOverRef.current || selectedOverlayIds || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    if (ids.length < 2) return;
    const gap = Number(gapRaw);
    if (!Number.isFinite(gap)) return;

    const items = ids
      .map((id) => {
        const o = (overlaysRef.current || []).find((x) => String(x?.id || "") === id);
        if (!o) return null;
        const bb = o?.bbox || overlayLocalBBox(o.id);
        if (!bb) return null;
        const sx = overlayScaleX(o);
        const sy = overlayScaleY(o);
        const left = Number(o.tx || 0) + sx * Number(bb.x || 0);
        const top = Number(o.ty || 0) + sy * Number(bb.y || 0);
        return {
          id: o.id,
          tx: Number(o.tx || 0),
          ty: Number(o.ty || 0),
          bb,
          sx,
          sy,
          left,
          top,
          width: Math.max(1, Math.abs(sx * Number(bb.width || 0))),
          height: Math.max(1, Math.abs(sy * Number(bb.height || 0))),
        };
      })
      .filter(Boolean);
    if (items.length < 2) return;

    const horizontal = String(axis || "x").toLowerCase() !== "y";
    const sorted = items.sort((a, b) =>
      horizontal ? a.left - b.left || a.top - b.top : a.top - b.top || a.left - b.left
    );

    let cursor = horizontal ? sorted[0].left : sorted[0].top;
    const nextById = new Map();
    sorted.forEach((item) => {
      if (horizontal) {
        const targetLeft = cursor;
        nextById.set(item.id, {
          tx: targetLeft - item.sx * Number(item.bb.x || 0),
          ty: item.ty,
        });
        cursor += item.width + gap;
      } else {
        const targetTop = cursor;
        nextById.set(item.id, {
          tx: item.tx,
          ty: targetTop - item.sy * Number(item.bb.y || 0),
        });
        cursor += item.height + gap;
      }
    });

    pushHistory();
    setSvgOverlays((prev) =>
      prev.map((o) => {
        const next = nextById.get(o.id);
        if (!next) return o;
        return { ...o, tx: next.tx, ty: next.ty };
      })
    );
    scheduleProjectAutoSave();
  }

  function onOverlayGroupHandleDown(e, corner) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    if (selectedIds.length > 0 || selectedOverlayIds.length < 2) return;

    const group = getSelectedOverlayGroupBBox(selectedOverlayIds);
    if (!group) return;
    const TL = { x: group.x, y: group.y };
    const TR = { x: group.x + group.w, y: group.y };
    const BR = { x: group.x + group.w, y: group.y + group.h };
    const BL = { x: group.x, y: group.y + group.h };
    const corners = { TL, TR, BR, BL };
    const opposite = { TL: BR, TR: BL, BR: TL, BL: TR };
    const startWorld = corners[corner];
    const anchorWorld = opposite[corner];
    if (!startWorld || !anchorWorld) return;
    const startDist = Math.max(1, distance(startWorld, anchorWorld));
    const overlays = (selectedOverlayIds || [])
      .map((id) => {
        const o = svgOverlays.find((x) => x.id === id);
        if (!o) return null;
        return {
          id: o.id,
          tx: Number(o.tx || 0),
          ty: Number(o.ty || 0),
          sx: overlayScaleX(o),
          sy: overlayScaleY(o),
        };
      })
      .filter(Boolean);
    if (!overlays.length) return;
    pushHistory();
    setOverlayResize({
      kind: "group",
      anchorWorld,
      startDist,
      overlays,
    });
  }

  function overlayGroupSelectionUI() {
    if (selectedIds.length > 0 || selectedOverlayIds.length < 2) return null;
    const group = getSelectedOverlayGroupBBox(selectedOverlayIds);
    if (!group) return null;
    const x = group.x;
    const y = group.y;
    const w = group.w;
    const h = group.h;
    const corners = [
      { key: "TL", cx: x, cy: y },
      { key: "TR", cx: x + w, cy: y },
      { key: "BR", cx: x + w, cy: y + h },
      { key: "BL", cx: x, cy: y + h },
    ];
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill="none"
          stroke="#2b6cff"
          strokeWidth={2}
          strokeDasharray="8 5"
          pointerEvents="none"
        />
        {corners.map((c) => (
          <g key={`group-resize-${c.key}`}>
            <circle cx={c.cx} cy={c.cy} r={8} fill="white" stroke="#2b6cff" strokeWidth={2} />
            <circle
              cx={c.cx}
              cy={c.cy}
              r={16}
              fill="transparent"
              style={{ cursor: "nwse-resize" }}
              onMouseDown={(e) => onOverlayGroupHandleDown(e, c.key)}
            />
          </g>
        ))}
      </g>
    );
  }

  function onShapeResizeHandleDown(e, corner) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    if (!selectedBBox || !selectedIds.length || selectedOverlayIds.length) return;
    const x = Number(selectedBBox.x || 0);
    const y = Number(selectedBBox.y || 0);
    const w = Math.max(1, Number(selectedBBox.w || 0));
    const h = Math.max(1, Number(selectedBBox.h || 0));
    const TL = { x, y };
    const TR = { x: x + w, y };
    const BR = { x: x + w, y: y + h };
    const BL = { x, y: y + h };
    const opposite = { TL: BR, TR: BL, BR: TL, BL: TR };
    const anchor = opposite[String(corner || "").toUpperCase()];
    if (!anchor) return;
    const ids = Array.isArray(selectedIds) ? selectedIds.slice() : [];
    const originals = (Array.isArray(shapesRef.current) ? shapesRef.current : [])
      .filter((s) => ids.includes(s.id))
      .map((s) => ({
        id: s.id,
        type: s.type,
        x: Number(s.x ?? 0),
        y: Number(s.y ?? 0),
        width: Number(s.width ?? 0),
        height: Number(s.height ?? 0),
        fontSize: Number(s.fontSize ?? 24),
        points: Array.isArray(s.points) ? clonePoints(s.points) : null,
      }));
    const keepCircle =
      ids.length === 1 &&
      originals.length === 1 &&
      String(originals[0]?.type || "") === "circle";
    pushHistory();
    setShapeResize({
      corner: String(corner || "").toUpperCase(),
      anchor,
      startBBox: { x, y, w, h },
      selectedIds: ids,
      originals,
      keepCircle,
    });
  }

  function shapeSelectionUI() {
    if (!selectedBBox || !selectedIds.length || selectedOverlayIds.length) return null;
    const selectedShapeItems = (Array.isArray(shapesRef.current) ? shapesRef.current : []).filter(
      (s) => (selectedIds || []).includes(s?.id)
    );
    const onlyJunctionNodesSelected =
      selectedShapeItems.length > 0 &&
      selectedShapeItems.every((s) => s?.junctionNode === true);
    if (onlyJunctionNodesSelected) return null;
    const onlyPolylinesSelected =
      selectedShapeItems.length > 0 &&
      selectedShapeItems.every(
        (s) => String(s?.type || "").toLowerCase() === "polyline" || Array.isArray(s?.points)
      );
    if (onlyPolylinesSelected) return null;
    const x = Number(selectedBBox.x || 0);
    const y = Number(selectedBBox.y || 0);
    const w = Math.max(1, Number(selectedBBox.w || 0));
    const h = Math.max(1, Number(selectedBBox.h || 0));
    const corners = [
      { key: "TL", cx: x, cy: y },
      { key: "TR", cx: x + w, cy: y },
      { key: "BR", cx: x + w, cy: y + h },
      { key: "BL", cx: x, cy: y + h },
    ];
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill="none"
          stroke="#2b6cff"
          strokeWidth={2}
          strokeDasharray="6 4"
          pointerEvents="none"
        />
        {corners.map((c) => (
          <g key={`shape-resize-${c.key}`}>
            <circle cx={c.cx} cy={c.cy} r={6} fill="white" stroke="#2b6cff" strokeWidth={2} />
            <circle
              cx={c.cx}
              cy={c.cy}
              r={14}
              fill="transparent"
              style={{ cursor: "nwse-resize" }}
              onMouseDown={(e) => onShapeResizeHandleDown(e, c.key)}
            />
          </g>
        ))}
      </g>
    );
  }

  const inlineEditPos = useMemo(() => {
    if (!inlineEdit?.id || !svgRef.current) return null;
    if (inlineEdit?.kind === "overlay") {
      const o = svgOverlays.find((x) => x.id === inlineEdit.id);
      if (!o) return null;
      const bb = overlayLocalBBox(o.id);
      if (!bb) return null;
      const wr = overlayWorldRect(o, bb);
      const rect = svgRef.current.getBoundingClientRect();
      const z = zoom || 1;
      const x = rect.left + (pan?.x || 0) + Number(wr.x || 0) * z;
      const y = rect.top + (pan?.y || 0) + Number(wr.y || 0) * z;
      const estW = Math.max(140, Number(wr.w || 0) * z - 8);
      return {
        x: x + 4,
        y: y + 4,
        fontSize: Math.max(12, 18 * z),
        fontFamily: "system-ui",
        fontWeight: "500",
        width: estW,
      };
    }
    const s = shapes.find((x) => x.id === inlineEdit.id);
    if (!s) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const z = zoom || 1;
    const x = rect.left + (pan?.x || 0) + Number(s.x ?? 0) * z;
    const y = rect.top + (pan?.y || 0) + Number(s.y ?? 0) * z;
    const fontSize = Math.max(10, Number(s.fontSize ?? 24) * z);
    const fontFamily = s.fontFamily || "system-ui";
    const fontWeight = s.fontWeight || "400";
    const anchor = s.anchor || "start";
    const text = String(s.text ?? "");
    const estW = Math.max(10, text.length * Number(s.fontSize ?? 24) * 0.6 * z);
    const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;
    return { x: x + ax, y: y + 2, fontSize, fontFamily, fontWeight, width: Math.max(120, estW + 12) };
  }, [inlineEdit?.id, inlineEdit?.kind, shapes, svgOverlays, pan, zoom]);

  const panelAnchor = useMemo(() => {
    if (!selectedBBox || !svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const z = zoom || 1;
    const px = rect.left + (pan?.x || 0) + (selectedBBox.x || 0) * z;
    const py = rect.top + (pan?.y || 0) + (selectedBBox.y || 0) * z;
    const pw = (selectedBBox.w || 0) * z;
    const ph = (selectedBBox.h || 0) * z;
    return { x: px, y: py, w: pw, h: ph };
  }, [selectedBBox, pan, zoom]);

  const panelAnchorKey = useMemo(() => {
    if (!selectedBBox) return "";
    const selShapeKey = (selectedIds || []).join(",");
    const selOverlayKey = (selectedOverlayIds || []).join(",");
    return `${selCount}-${singleKind}-${selShapeKey}-${selOverlayKey}`;
  }, [selectedBBox, selCount, singleKind, selectedIds, selectedOverlayIds]);

  const freezePanel = !!(dragAll || dragHandle || overlayResize);
  const isEmptyMenu = contextMenu?.mode === "empty";
  const menuSize = isEmptyMenu ? { w: 210, h: 260 } : { w: 190, h: 240 };
  const winW = typeof window !== "undefined" ? window.innerWidth : 0;
  const winH = typeof window !== "undefined" ? window.innerHeight : 0;
  const isMobileViewport = winW > 0 && winW <= 900;
  const isLiveMobile = isLiveMode && winW > 0 && winW <= 900;
  const showDesktopTaskbar = isLiveMode && !isLiveMobile;
  const showLiveIdentityChips = !isLiveMode || winW > 900;
  const menuLeft = contextMenu
    ? Math.min(Math.max(12, contextMenu.x), Math.max(12, winW - menuSize.w - 12))
    : 0;
  const menuTop = contextMenu
    ? Math.min(Math.max(12, contextMenu.y), Math.max(12, winH - menuSize.h - 12))
    : 0;
  const subMenuSize = { w: 260, h: 360 };
  const subMenuLeft = Math.min(
    Math.max(12, contextSvgMenuPos.x),
    Math.max(12, winW - subMenuSize.w - 12)
  );
  const subMenuTop = Math.min(
    Math.max(12, contextSvgMenuPos.y),
    Math.max(12, winH - subMenuSize.h - 12)
  );
  const contextSingleSvg =
    selectedOverlayIds.length === 1 && selectedIds.length === 0
      ? svgOverlays.find((o) => o.id === selectedOverlayIds[0]) || null
      : null;
  const topMenuTextButtonStyle = {
    border: "1px solid var(--border)",
    background: "var(--bg-elev)",
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
  const topMenuIconButtonStyle = {
    ...topMenuTextButtonStyle,
    width: 30,
    height: 28,
    padding: 0,
    display: "grid",
    placeItems: "center",
  };
  const topMenuDeleteButtonStyle = (enabled = true) => ({
    ...topMenuIconButtonStyle,
    border: "1px solid var(--danger)",
    background: enabled ? "var(--danger)" : "color-mix(in srgb, var(--danger) 55%, transparent)",
    color: "var(--danger-text)",
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.9,
  });
  const topMenuIconSize = 14;
  const topMenuModeButtonStyle = (active) => ({
    ...topMenuIconButtonStyle,
    border: active ? "1px solid var(--selected-border)" : topMenuTextButtonStyle.border,
    color: active ? "var(--selected-text)" : topMenuTextButtonStyle.color,
    background: active ? "var(--selected-bg)" : topMenuIconButtonStyle.background,
    boxShadow: active ? "var(--selected-shadow)" : "none",
  });
  const contextMenuItemStyle = (color = "var(--text)") => ({
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 12,
    lineHeight: 1.2,
    color,
  });
  const dockToolButtonStyle = (active = false) => {
    if (!designDockExpanded) return active ? topMenuModeButtonStyle(true) : topMenuIconButtonStyle;
    return {
      ...(active
        ? {
            ...topMenuTextButtonStyle,
            border: "1px solid var(--selected-border)",
            color: "var(--selected-text)",
            background: "var(--selected-bg)",
            boxShadow: "var(--selected-shadow)",
          }
        : topMenuTextButtonStyle),
      width: "100%",
      minHeight: 30,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "flex-start",
      gap: 8,
      padding: "4px 10px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      transition: "background-color 140ms ease, border-color 140ms ease, color 140ms ease",
    };
  };
  const drawerHeaderButtonSize = isMobileViewport ? 40 : 34;
  const drawerHeaderButtonStyle = {
    border: "1px solid var(--border)",
    background: "var(--bg-elev)",
    color: "var(--text)",
    borderRadius: 10,
    width: drawerHeaderButtonSize,
    height: drawerHeaderButtonSize,
    padding: 0,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 700,
    display: "grid",
    placeItems: "center",
  };
  const drawerTextSize = isMobileViewport ? 14 : 13;
  const drawerLineHeight = 1.35;
  const drawerTitleSize = isMobileViewport ? 16 : 15;
  const drawerSubtitleSize = isMobileViewport ? 12 : 11;
  const rightDrawerHeaderPadding = isMobileViewport ? "10px 10px" : "12px 14px";
  const rightDrawerBodyPadding = isMobileViewport ? 10 : 14;
  const drawerContentPadding = rightDrawerBodyPadding;
  const drawerContentShellStyle = {
    height: "100%",
    overflow: "auto",
    padding: drawerContentPadding,
    boxSizing: "border-box",
  };
  const drawerTabButtonStyle = (active) => ({
    border: "none",
    borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
    background: "transparent",
    color: active ? "var(--accent)" : "var(--text-muted)",
    borderRadius: 0,
    minWidth: 0,
    height: isMobileViewport ? 36 : 30,
    padding: isMobileViewport ? "0 12px" : "0 10px",
    fontSize: isMobileViewport ? 12 : 11,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "none",
    transition: "color 140ms ease, border-color 140ms ease, background-color 140ms ease",
  });
  const projectDrawerContentStyle = {
    flex: "1 1 auto",
    minHeight: 0,
    overflow: "auto",
    padding: "10px 14px 10px 10px",
    display: "grid",
    gap: 8,
    alignContent: "start",
  };
  const projectDrawerCardStyle = {
    display: "grid",
    gap: 8,
    padding: 10,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elev)",
  };
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );
  const activeScreen = useMemo(() => {
    if (!Array.isArray(screens) || !screens.length) return null;
    return screens.find((s) => s.id === activeScreenId) || screens[0];
  }, [screens, activeScreenId]);
  const liveMenuGroupsForRender = useMemo(
    () => normalizeLiveMenuGroups(liveMenuGroups, screens),
    [liveMenuGroups, screens]
  );
  const liveMenuGroupsVisible = useMemo(
    () =>
      (Array.isArray(liveMenuGroupsForRender) ? liveMenuGroupsForRender : [])
        .map((group) => ({ ...group, items: Array.isArray(group?.items) ? group.items : [] }))
        .filter((group) => group.items.length > 0),
    [liveMenuGroupsForRender]
  );
  const leftMenuGroupsVisible = useMemo(
    () =>
      liveMenuGroupsVisible
        .map((group) => ({
          ...group,
          items: (Array.isArray(group?.items) ? group.items : []).filter((item) => {
            const t = String(item?.type || "").trim().toLowerCase();
            return t === "data" || t === "reports";
          }),
        }))
        .filter((group) => group.items.length > 0),
    [liveMenuGroupsVisible]
  );
  const liveMenuMobileItems = useMemo(
    () =>
      leftMenuGroupsVisible.flatMap((group) =>
        (Array.isArray(group?.items) ? group.items : []).map((item) => ({
          groupName: String(group?.name || "Group"),
          item,
        }))
      ),
    [leftMenuGroupsVisible]
  );
  const activeDatabaseTable = useMemo(() => {
    const raw = String(databaseEmbeddedPath || "").trim();
    if (!raw) return "";
    const normalized = raw.startsWith("/data/") ? raw : `/data/${raw.replace(/^\/+/, "")}`;
    const m = normalized.match(/^\/data\/([^/]+)(?:\/([^/]+))?$/i);
    if (!m) return "";
    return decodeURIComponent(String(m[1] || "")).trim();
  }, [databaseEmbeddedPath]);
  const routeInfoById = useMemo(() => {
    const rows = Array.isArray(projectRouteRows) ? projectRouteRows : [];
    const map = new Map();
    rows.forEach((row) => {
      const id = String(
        row?.route_id ??
          row?.routeid ??
          row?.routeId ??
          row?.id ??
          row?.route ??
          ""
      ).trim();
      if (!id) return;
      const name = String(
        row?.name ??
          row?.route_name ??
          row?.routename ??
          row?.routeName ??
          row?.label ??
          row?.description ??
          id
      ).trim() || id;
      if (!map.has(id)) map.set(id, { id, name });
      if (!map.has(id.toLowerCase())) map.set(id.toLowerCase(), { id, name });
    });
    return map;
  }, [projectRouteRows]);
  const activeMenuLabel = useMemo(() => {
    const fallback = activeScreen?.name || screenName || "None";
    if (!isLiveMode) return fallback;
    for (const group of leftMenuGroupsVisible) {
      const items = Array.isArray(group?.items) ? group.items : [];
      for (const item of items) {
        const isData = item?.type === "data";
        if (isData) {
          const configuredTable = String(item?.dataTable || "").trim();
          const isActiveData =
            showMainDrawer &&
            drawerView === "database" &&
            (configuredTable ? configuredTable === activeDatabaseTable : true);
          if (!isActiveData) continue;
          return resolveLiveMenuItemLabel(item, null);
        }
        const screenId = String(item?.screenId || "");
        if (!screenId || screenId !== String(activeScreenId || "")) continue;
        const screen = screens.find((s) => String(s?.id || "") === screenId) || null;
        return resolveLiveMenuItemLabel(item, screen);
      }
    }
    return fallback;
  }, [
    activeDatabaseTable,
    activeScreen?.name,
    activeScreenId,
    drawerView,
    isLiveMode,
    leftMenuGroupsVisible,
    resolveLiveMenuItemLabel,
    screenName,
    screens,
    showMainDrawer,
  ]);
  const screenRouteOptions = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const route of routeInfoById.values()) {
      const value = String(route?.id || "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value, label: String(route?.name || value).trim() || value });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [routeInfoById]);
  const taskbarScreenGroupNameById = useMemo(() => {
    const map = new Map();
    for (const group of Array.isArray(liveMenuGroupsForRender) ? liveMenuGroupsForRender : []) {
      const groupName = String(group?.name || "").trim() || "Group";
      for (const item of Array.isArray(group?.items) ? group.items : []) {
        const t = String(item?.type || "").trim().toLowerCase();
        if (t !== "screen") continue;
        const screenId = String(item?.screenId || "").trim();
        if (!screenId || map.has(screenId)) continue;
        map.set(screenId, groupName);
      }
    }
    return map;
  }, [liveMenuGroupsForRender]);
  const taskbarScreenGroups = useMemo(() => {
    const byGroup = new Map();
    for (const screen of Array.isArray(screens) ? screens : []) {
      const id = String(screen?.id || "").trim();
      if (!id) continue;
      const groupName = String(taskbarScreenGroupNameById.get(id) || "Ungrouped");
      if (!byGroup.has(groupName)) byGroup.set(groupName, []);
      byGroup.get(groupName).push(screen);
    }
    return Array.from(byGroup.entries()).map(([groupName, items]) => ({ groupName, items }));
  }, [screens, taskbarScreenGroupNameById]);
  const taskbarButtonWidthCh = useMemo(() => {
    const labels = (Array.isArray(screens) ? screens : []).map((screen, index) =>
      String(screen?.name || "").trim() || `Screen ${index + 1}`
    );
    const longest = labels.reduce((m, x) => Math.max(m, String(x || "").length), 0);
    return Math.max(10, Math.min(26, longest + 2));
  }, [screens]);
  const opcLiveValueCount = useMemo(
    () => Object.keys(opcLiveValues || {}).length,
    [opcLiveValues]
  );
  const opcLiveUpdatedAtLabel = useMemo(() => {
    if (!Number.isFinite(Number(opcLiveUpdatedAt)) || Number(opcLiveUpdatedAt) <= 0) return "never";
    try {
      return new Date(Number(opcLiveUpdatedAt)).toLocaleTimeString();
    } catch {
      return "never";
    }
  }, [opcLiveUpdatedAt]);
  const opcLiveIsStale = useMemo(() => {
    const ts = Number(opcLiveUpdatedAt) || 0;
    if (!ts) return true;
    return Date.now() - ts > 10_000;
  }, [opcLiveUpdatedAt, opcLiveValues]);

  useEffect(() => {
    const valid = new Set(leftMenuGroupsVisible.map((group) => String(group.id || "")));
    setCollapsedLiveGroupIds((prev) =>
      (Array.isArray(prev) ? prev : []).filter((id) => valid.has(String(id || "")))
    );
  }, [leftMenuGroupsVisible]);

  useEffect(() => {
    if (!showMainDrawer) return;
    if (
      (drawerView === "database" && !canViewDataPages) ||
      ((drawerView === "plc" || drawerView === "code-gen-pro") && !canViewArea("plc")) ||
      ((drawerView === "opc" || drawerView === "logs" || drawerView === "diagnostics") &&
        !canViewArea("opc")) ||
      (drawerView === "tags" && !canViewArea("tags")) ||
      ((drawerView === "server" || drawerView === "logger") && !canViewArea("server")) ||
      (drawerView === "reports" && !canViewArea("reports")) ||
      (drawerView === "ai" && !canViewArea("ai")) ||
      (drawerView === "help" && !canViewArea("help"))
    ) {
      setShowMainDrawer(false);
    }
  }, [showMainDrawer, drawerView, canViewDataPages, hasUserPermissions, user]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let sending = false;
    let queue = [];
    const flush = async () => {
      if (sending || !queue.length) return;
      sending = true;
      const batch = queue.slice(0, 4);
      queue = queue.slice(batch.length);
      try {
        await Promise.all(
          batch.map((entry) =>
            fetch("/api/logs/client", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(entry),
            }).catch(() => null)
          )
        );
      } finally {
        sending = false;
        if (queue.length) window.setTimeout(flush, 30);
      }
    };
    const enqueue = (entry) => {
      queue.push(entry);
      if (queue.length > 30) queue = queue.slice(queue.length - 30);
      void flush();
    };
    const onError = (event) => {
      const err = event?.error;
      enqueue({
        level: "error",
        source: "window.error",
        message: String(err?.message || event?.message || "Unhandled window error"),
        route: `${window.location.pathname}${window.location.search}`,
        meta: {
          stack: String(err?.stack || ""),
          file: String(event?.filename || ""),
          line: Number(event?.lineno || 0) || null,
          column: Number(event?.colno || 0) || null,
        },
      });
    };
    const onRejection = (event) => {
      const reason = event?.reason;
      enqueue({
        level: "error",
        source: "window.unhandledrejection",
        message: String(reason?.message || reason || "Unhandled promise rejection"),
        route: `${window.location.pathname}${window.location.search}`,
        meta: {
          stack: String(reason?.stack || ""),
          reason: typeof reason === "string" ? reason : undefined,
        },
      });
    };
    const prevManualLog = window.viziLog;
    window.viziLog = (level, message, meta = {}) => {
      enqueue({
        level: String(level || "info"),
        source: "window.manual",
        message: String(message || "Client log"),
        route: `${window.location.pathname}${window.location.search}`,
        meta,
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      if (prevManualLog) {
        window.viziLog = prevManualLog;
      } else {
        delete window.viziLog;
      }
    };
  }, []);

  useEffect(() => {
    if (!isLiveMode) {
      motorHmiStateByOverlayRef.current = new Map();
      return;
    }
    const prevMap = motorHmiStateByOverlayRef.current || new Map();
    const nextMap = new Map();
    const overlays = Array.isArray(svgOverlays) ? svgOverlays : [];
    const normalizeMotorHmiState = (rawValue) => {
      const rawText = String(rawValue ?? "").trim();
      if (!rawText) return { key: "", label: "-" };
      const lower = rawText.toLowerCase();
      const asNumber = Number(rawText);
      if (Number.isFinite(asNumber)) {
        if (asNumber === 1) return { key: "1", label: "Stopped" };
        if (asNumber === 2) return { key: "2", label: "Starting" };
        if (asNumber === 4) return { key: "4", label: "Started" };
        if (asNumber === 6) return { key: "6", label: "Stopping" };
      }
      if (lower.includes("starting")) return { key: "starting", label: "Starting" };
      if (lower.includes("stopping")) return { key: "stopping", label: "Stopping" };
      if (lower.includes("started")) return { key: "started", label: "Started" };
      if (lower.includes("stopped")) return { key: "stopped", label: "Stopped" };
      return { key: lower, label: rawText };
    };
    for (const overlay of overlays) {
      const eType = resolveOverlayEType(overlay, { directOnly: true });
      if (!isMotorEType(eType)) continue;
      const overlayId = String(overlay?.id || "").trim();
      if (!overlayId) continue;
      const hmiStatePath = resolveMotorCommandTagPath(
        overlay,
        ["HMI_State", "HMIState", "i_HMIState", "o_HMIState", "State"],
        { strict: true }
      );
      if (!hmiStatePath) continue;
      const resolvedStatePath = findLiveTagPathMatch([hmiStatePath]) || hmiStatePath;
      const rawStateValue =
        Object.prototype.hasOwnProperty.call(opcLiveValues || {}, resolvedStatePath)
          ? opcLiveValues[resolvedStatePath]
          : opcLiveValues?.[String(resolvedStatePath || "").toLowerCase()];
      const currentState = normalizeMotorHmiState(rawStateValue);
      nextMap.set(overlayId, currentState);
      const prevState = prevMap.get(overlayId);
      if (!prevState || prevState.key === currentState.key) continue;
      if (typeof window !== "undefined" && typeof window.viziLog === "function") {
        const motorName = String(getOverlayPopupTitle(overlay) || overlay?.name || overlayId).trim() || overlayId;
        window.viziLog("info", `Motor HMI state changed: ${motorName}`, {
          source: "live.motor.hmi_state",
          overlayId,
          from: String(prevState.label || "-"),
          to: String(currentState.label || "-"),
          path: resolvedStatePath,
        });
      }
    }
    motorHmiStateByOverlayRef.current = nextMap;
  }, [isLiveMode, svgOverlays, opcLiveValues]);

  useEffect(() => {
    if (!showUserDrawer) return;
    setShowSecurityDrawer(false);
    setShowMainDrawer(false);
  }, [showUserDrawer]);

  useEffect(() => {
    if (showUserDrawer) return;
    setUserSettingsEditing(false);
    setPasswordDraft({ current: "", next: "" });
  }, [showUserDrawer]);

  useEffect(() => {
    if (!showSecurityDrawer) return;
    setShowUserDrawer(false);
    setShowMainDrawer(false);
  }, [showSecurityDrawer]);

  useEffect(() => {
    if (showSecurityDrawer) return;
    setPasswordDraft({ current: "", next: "" });
  }, [showSecurityDrawer]);

  useEffect(() => {
    function handleGlobalDrawerDoubleClick(event) {
      const target = event?.target;
      if (!(target instanceof Node)) return;
      if (showMainDrawer && !mainDrawerRef.current?.contains(target)) {
        setShowMainDrawer(false);
      }
      if (showUserDrawer && !userDrawerRef.current?.contains(target)) {
        closeUserDrawerSafely();
      }
      if (showSecurityDrawer && !securityDrawerRef.current?.contains(target)) {
        closeSecurityDrawerSafely();
      }
      if (showProjectDrawer && !projectDrawerRef.current?.contains(target)) {
        closeProjectDrawerSafely();
      }
      if (
        String(liveEquipmentDrawerOverlayId || "").trim() &&
        !liveEquipmentDrawerRef.current?.contains(target)
      ) {
        setLiveEquipmentDrawerOverlayId("");
      }
    }
    document.addEventListener("dblclick", handleGlobalDrawerDoubleClick);
    return () => document.removeEventListener("dblclick", handleGlobalDrawerDoubleClick);
  }, [
    showMainDrawer,
    showUserDrawer,
    showSecurityDrawer,
    showProjectDrawer,
    liveEquipmentDrawerOverlayId,
  ]);

  useEffect(() => {
    if (!isLiveMode || !showLiveMenuDrawer) return undefined;
    function onDocMouseDown(event) {
      const target = event?.target;
      if (!(target instanceof Node)) return;
      if (liveMenuDrawerRef.current?.contains(target)) return;
      if (taskbarMenuBtnRef.current?.contains(target)) return;
      setShowLiveMenuDrawer(false);
    }
    function onDocKeyDown(event) {
      if (event?.key === "Escape") setShowLiveMenuDrawer(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [isLiveMode, showLiveMenuDrawer]);

  function switchToScreen(nextScreenId) {
    const committed = commitCurrentScreenState();
    const target = committed.list.find((s) => s.id === nextScreenId) || committed.list[0];
    setScreens(committed.list);
    if (!target) return;
    hydrateScreenState(target);
    scheduleProjectAutoSave();
  }

  function addScreen() {
    const committed = commitCurrentScreenState();
    const existingIds = new Set(committed.list.map((s) => String(s.id || "")));
    let id = `screen-${uid()}`;
    while (existingIds.has(id)) id = `screen-${uid()}`;
    const existingNames = new Set(committed.list.map((s) => String(s.name || "").trim().toLowerCase()));
    let n = committed.list.length + 1;
    let name = `Screen ${n}`;
    while (existingNames.has(name.toLowerCase())) {
      n += 1;
      name = `Screen ${n}`;
    }
    const next = [
      ...committed.list,
      normalizeScreenPayload({
        id,
        name,
        shapes: [],
        svgOverlays: [],
        vbW: 1600,
        vbH: 900,
        pan: { x: 0, y: 0 },
        zoom: 1,
        zoomByViewport: {},
        showInLiveMenu: true,
        routeId: "",
        autoFitMode: "content",
      }),
    ];
    screensRef.current = next;
    setScreens(next);
    setLiveMenuGroups((prev) => {
      const normalized = normalizeLiveMenuGroups(prev, next);
      if (!normalized.length) return normalized;
      const firstGroup = normalized[0];
      const nextGroups = normalized.map((group, idx) =>
        idx === 0
          ? {
              ...group,
              items: [
                ...group.items,
                { id: `live-item-${uid()}`, type: "screen", screenId: id, label: "", restricted: false, allowedRoleIds: [] },
              ],
            }
          : group
      );
      liveMenuGroupsRef.current = nextGroups;
      return nextGroups;
    });
    hydrateScreenState(next[next.length - 1]);
    setProjectStatus(`Added ${name}`);
    scheduleProjectAutoSave();
  }

  function deleteActiveScreen() {
    const committed = commitCurrentScreenState();
    if (committed.list.length <= 1) return;
    const removed = committed.list.find((s) => s.id === committed.currentId);
    const filtered = committed.list.filter((s) => s.id !== committed.currentId);
    const target = filtered[0] || null;
    screensRef.current = filtered;
    if (target) {
      activeScreenIdRef.current = target.id;
      screenNameRef.current = target.name;
      shapesRef.current = target.shapes;
      overlaysRef.current = target.svgOverlays;
      vbWRef.current = target.vbW;
      vbHRef.current = target.vbH;
      panRef.current = target.pan;
      zoomRef.current = target.zoom;
    }
    setScreens(filtered);
    setLiveMenuGroups((prev) => {
      const normalized = normalizeLiveMenuGroups(prev, filtered);
      const nextGroups = normalized.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => !(item.type === "screen" && String(item.screenId || "") === String(committed.currentId))
        ),
      }));
      liveMenuGroupsRef.current = nextGroups;
      return nextGroups;
    });
    if (target) hydrateScreenState(target);
    setProjectStatus(`Deleted ${removed?.name || "screen"}`);
    scheduleProjectAutoSave();
  }

  function deleteScreenById(screenId) {
    const committed = commitCurrentScreenState();
    if (committed.list.length <= 1) return;
    const removeId = String(screenId || "");
    if (!removeId) return;
    const removed = committed.list.find((s) => s.id === removeId);
    if (!removed) return;
    const filtered = committed.list.filter((s) => s.id !== removeId);
    const target =
      removeId === committed.currentId
        ? filtered[0] || null
        : filtered.find((s) => s.id === committed.currentId) || filtered[0] || null;
    screensRef.current = filtered;
    if (removeId === committed.currentId && target) {
      activeScreenIdRef.current = target.id;
      screenNameRef.current = target.name;
      shapesRef.current = target.shapes;
      overlaysRef.current = target.svgOverlays;
      vbWRef.current = target.vbW;
      vbHRef.current = target.vbH;
      panRef.current = target.pan;
      zoomRef.current = target.zoom;
    }
    setScreens(filtered);
    setLiveMenuGroups((prev) => {
      const normalized = normalizeLiveMenuGroups(prev, filtered);
      const nextGroups = normalized.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => !(item.type === "screen" && String(item.screenId || "") === removeId)
        ),
      }));
      liveMenuGroupsRef.current = nextGroups;
      return nextGroups;
    });
    if (removeId === committed.currentId && target) {
      hydrateScreenState(target);
    }
    setProjectStatus(`Deleted ${removed?.name || "screen"}`);
    scheduleProjectAutoSave();
  }

  function renameActiveScreen(value) {
    const nextName = String(value || "").trim() || "Screen";
    setScreenName(nextName);
    setScreens((prev) =>
      (Array.isArray(prev) ? prev : []).map((s) =>
        s.id === activeScreenId ? { ...s, name: nextName } : s
      )
    );
    scheduleProjectAutoSave();
  }

  function renameScreenById(screenId, value) {
    const id = String(screenId || "");
    if (!id) return;
    const nextName = String(value ?? "");
    setScreens((prev) =>
      (Array.isArray(prev) ? prev : []).map((s) =>
        String(s?.id || "") === id ? { ...s, name: nextName } : s
      )
    );
    if (String(activeScreenId || "") === id) {
      setScreenName(nextName);
    }
    scheduleProjectAutoSave();
  }

  function clampScreenCanvasSize(value) {
    const n = Math.round(Number(value) || 0);
    if (!Number.isFinite(n)) return 100;
    return Math.max(100, Math.min(10000, n));
  }

  function getScreenAutoFitModeById(screenId) {
    const id = String(screenId || "");
    const target = (Array.isArray(screens) ? screens : []).find((s) => String(s?.id || "") === id);
    return normalizeScreenAutoFitMode(target?.autoFitMode, autoFitCanvasOnResize ? "content" : "off");
  }

  function updateScreenCanvasSizeById(screenId, widthRaw, heightRaw) {
    const id = String(screenId || "");
    if (!id) return;
    const nextW = clampScreenCanvasSize(widthRaw);
    const nextH = clampScreenCanvasSize(heightRaw);
    setScreens((prev) =>
      (Array.isArray(prev) ? prev : []).map((s) =>
        String(s?.id || "") === id ? { ...s, vbW: nextW, vbH: nextH } : s
      )
    );
    const activeId = String(activeScreenIdRef.current || activeScreenId || "");
    if (activeId === id) {
      setVbW(nextW);
      setVbH(nextH);
      vbWRef.current = nextW;
      vbHRef.current = nextH;
      const mode = getScreenAutoFitModeById(id);
      if (mode !== "off") fitViewToCanvas(nextW, nextH, mode, { preservePan: true });
    }
    scheduleProjectAutoSave();
  }

  function applySingleBinBinding(nextRaw) {
    if (!isSingle || !singleId || singleKind !== "SVG") return;
    const v = String(nextRaw ?? "").trim();
    setSvgOverlays((prev) => prev.map((o) => (o.id === singleId ? { ...o, binBindingKey: v } : o)));
    scheduleProjectAutoSave();
  }

  function finishCircleDrawing(circleId) {
    if (!circleId) return;
    setShapes((prev) =>
      prev.filter((s) => {
        if (s.id !== circleId) return true;
        const w = Math.max(0, Number(s.width ?? 0));
        const h = Math.max(0, Number(s.height ?? 0));
        return w >= 2 && h >= 2;
      })
    );
    setDrawing(null);
    setTool("select");
    scheduleProjectAutoSave();
  }

  function startCircleAt(p) {
    pushHistory();
    const id = uid();
    const circle = {
      id,
      type: "circle",
      x: p.x,
      y: p.y,
      width: 0,
      height: 0,
      stroke: "#808080",
      strokeWidth: 3,
      fill: "transparent",
      lineStyle: "solid",
      tagPath: "",
    };

    setShapes((prev) => [...prev, circle]);
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setDrawing({ mode: "draw-circle", id, start: { x: p.x, y: p.y } });
    setShowHUD(false);
    scheduleProjectAutoSave();
  }

  function applySingleEType(nextRaw) {
    if (!isSingle || !singleId || singleKind !== "SVG") return;
    const v = String(nextRaw ?? "").trim();
    setSvgOverlays((prev) =>
      prev.map((o) => (o.id === singleId ? { ...o, eType: v, eTypeAuto: false } : o))
    );
    scheduleProjectAutoSave();
  }

  function applySingleDiverterMode(nextRaw) {
    if (!isSingle || !singleId || singleKind !== "SVG") return;
    const mode = String(nextRaw || "").trim().toLowerCase() === "divert" ? "divert" : "straight";
    setSvgOverlays((prev) =>
      prev.map((o) => (o.id === singleId ? { ...o, diverterMode: mode } : o))
    );
    scheduleProjectAutoSave();
  }

  function updateScreenAutoFitModeById(screenId, modeRaw) {
    const id = String(screenId || "");
    if (!id) return;
    const mode = normalizeScreenAutoFitMode(modeRaw, "content");
    setScreens((prev) =>
      (Array.isArray(prev) ? prev : []).map((s) =>
        String(s?.id || "") === id ? { ...s, autoFitMode: mode } : s
      )
    );
    if (mode !== "off") {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const activeId = String(activeScreenIdRef.current || activeScreenId || "");
          if (activeId === id) {
            fitViewToCanvas(null, null, mode);
          }
        });
      });
    }
    scheduleProjectAutoSave();
  }

  function updateScreenRouteIdById(screenId, routeIdRaw) {
    const id = String(screenId || "");
    if (!id) return;
    const nextRouteId = String(routeIdRaw || "").trim();
    setScreens((prev) =>
      (Array.isArray(prev) ? prev : []).map((s) =>
        String(s?.id || "") === id ? { ...s, routeId: nextRouteId } : s
      )
    );
    scheduleProjectAutoSave();
  }

  function updateScreenSizeById(screenId, axis, rawValue) {
    const id = String(screenId || "");
    if (!id) return;
    const target = (Array.isArray(screens) ? screens : []).find((s) => String(s?.id || "") === id);
    const baseW = Math.max(100, Math.round(Number(target?.vbW) || 1600));
    const baseH = Math.max(100, Math.round(Number(target?.vbH) || 900));
    if (String(axis || "").toLowerCase() === "h") {
      updateScreenCanvasSizeById(id, baseW, rawValue);
      return;
    }
    updateScreenCanvasSizeById(id, rawValue, baseH);
  }

  function applyScreenSizePresetById(screenId, presetValue) {
    const id = String(screenId || "");
    const preset = SCREEN_SIZE_PRESETS.find((p) => p.value === String(presetValue || ""));
    if (!id || !preset) return;
    updateScreenCanvasSizeById(id, preset.w, preset.h);
  }

  function matchScreenToViewportById(screenId) {
    const id = String(screenId || "");
    if (!id) return;
    const rect = svgRef.current?.getBoundingClientRect?.();
    const fallbackW = typeof window !== "undefined" ? window.innerWidth : 1600;
    const fallbackH = typeof window !== "undefined" ? window.innerHeight : 900;
    const nextW = clampScreenCanvasSize(Number(rect?.width) || fallbackW);
    const nextH = clampScreenCanvasSize(Number(rect?.height) || fallbackH);
    updateScreenCanvasSizeById(id, nextW, nextH);
  }

  function beginScreenSizeDraft(screenId, axis, currentValue) {
    const id = String(screenId || "");
    if (!id) return;
    const key = axis === "h" ? "h" : "w";
    setScreenSizeDrafts((prev) => ({
      ...(prev || {}),
      [id]: {
        ...(prev?.[id] || {}),
        [key]: String(Math.max(100, Math.round(Number(currentValue) || 0))),
      },
    }));
  }

  function changeScreenSizeDraft(screenId, axis, raw) {
    const id = String(screenId || "");
    if (!id) return;
    const key = axis === "h" ? "h" : "w";
    setScreenSizeDrafts((prev) => ({
      ...(prev || {}),
      [id]: {
        ...(prev?.[id] || {}),
        [key]: String(raw ?? ""),
      },
    }));
  }

  function cancelScreenSizeDraft(screenId, axis) {
    const id = String(screenId || "");
    if (!id) return;
    const key = axis === "h" ? "h" : "w";
    setScreenSizeDrafts((prev) => {
      const map = prev && typeof prev === "object" ? prev : {};
      const cur = map[id];
      if (!cur || !Object.prototype.hasOwnProperty.call(cur, key)) return map;
      const nextEntry = { ...cur };
      delete nextEntry[key];
      if (!Object.keys(nextEntry).length) {
        const next = { ...map };
        delete next[id];
        return next;
      }
      return { ...map, [id]: nextEntry };
    });
  }

  function commitScreenSizeDraft(screenId, axis) {
    const id = String(screenId || "");
    if (!id) return;
    const key = axis === "h" ? "h" : "w";
    const raw = String(screenSizeDrafts?.[id]?.[key] ?? "").trim();
    if (!raw) {
      cancelScreenSizeDraft(id, key);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      cancelScreenSizeDraft(id, key);
      return;
    }
    updateScreenSizeById(id, key, parsed);
    cancelScreenSizeDraft(id, key);
  }

  function addLiveMenuGroup() {
    setLiveMenuGroups((prev) => {
      const normalized = normalizeLiveMenuGroups(prev, screens);
      const nextGroups = [
        ...normalized,
        {
          id: `live-group-${uid()}`,
          name: `Group ${normalized.length + 1}`,
          items: [],
        },
      ];
      liveMenuGroupsRef.current = nextGroups;
      return nextGroups;
    });
    scheduleProjectAutoSave();
  }

  function renameLiveMenuGroup(groupId, nextName) {
    const id = String(groupId || "");
    if (!id) return;
    setLiveMenuGroups((prev) => {
      const nextGroups = normalizeLiveMenuGroups(prev, screens).map((group) =>
        group.id === id ? { ...group, name: String(nextName ?? "") } : group
      );
      liveMenuGroupsRef.current = nextGroups;
      return nextGroups;
    });
    scheduleProjectAutoSave();
  }

  function deleteLiveMenuGroup(groupId) {
    const id = String(groupId || "");
    if (!id) return;
    setLiveMenuGroups((prev) => {
      const normalized = normalizeLiveMenuGroups(prev, screens);
      const remaining = normalized.filter((group) => group.id !== id);
      const nextGroups = remaining.length ? remaining : defaultLiveMenuGroupsFromScreens(screens);
      liveMenuGroupsRef.current = nextGroups;
      return nextGroups;
    });
    scheduleProjectAutoSave();
  }

  function addLiveMenuItem(groupId, type = "screen") {
    const id = String(groupId || "");
    if (!id) return;
    const normalizedType = (() => {
      const next = String(type || "").toLowerCase();
      if (next === "data") return "data";
      if (next === "reports") return "reports";
      return "screen";
    })();
    setLiveMenuGroups((prev) => {
      const nextGroups = normalizeLiveMenuGroups(prev, screens).map((group) => {
        if (group.id !== id) return group;
        const screenId = screens[0]?.id || "";
        const item =
          normalizedType === "data"
            ? {
                id: `live-item-${uid()}`,
                type: "data",
                dataTable: String(databaseTablesForMenu[0] || "").trim(),
                label: "",
                restricted: false,
                allowedRoleIds: [],
              }
            : normalizedType === "reports"
            ? {
                id: `live-item-${uid()}`,
                type: "reports",
                label: "",
                restricted: false,
                allowedRoleIds: [],
              }
            : { id: `live-item-${uid()}`, type: "screen", screenId, label: "", restricted: false, allowedRoleIds: [] };
        return { ...group, items: [...group.items, item] };
      });
      liveMenuGroupsRef.current = nextGroups;
      return nextGroups;
    });
    scheduleProjectAutoSave();
  }

  function updateLiveMenuItem(groupId, itemId, patch = {}) {
    const gId = String(groupId || "");
    const iId = String(itemId || "");
    if (!gId || !iId) return;
    setLiveMenuGroups((prev) => {
      const nextGroups = normalizeLiveMenuGroups(prev, screens).map((group) => {
        if (group.id !== gId) return group;
        return {
          ...group,
          items: group.items.map((item) => {
            if (item.id !== iId) return item;
            const nextType = (() => {
              const next = String(patch?.type || item.type || "").toLowerCase();
              if (next === "data") return "data";
              if (next === "reports") return "reports";
              return "screen";
            })();
            if (nextType === "data") {
              return {
                id: item.id,
                type: "data",
                dataTable: String(patch?.dataTable ?? item.dataTable ?? "").trim(),
                label: String(patch?.label ?? item.label ?? "").trim(),
                restricted: Boolean(patch?.restricted ?? item?.restricted),
                allowedRoleIds: normalizeRoleIdList(patch?.allowedRoleIds ?? item?.allowedRoleIds),
              };
            }
            if (nextType === "reports") {
              return {
                id: item.id,
                type: "reports",
                label: String(patch?.label ?? item.label ?? "").trim(),
                restricted: Boolean(patch?.restricted ?? item?.restricted),
                allowedRoleIds: normalizeRoleIdList(patch?.allowedRoleIds ?? item?.allowedRoleIds),
              };
            }
            const fallbackScreenId = screens[0]?.id || "";
            const screenId = String(patch?.screenId ?? item.screenId ?? fallbackScreenId);
            return {
              id: item.id,
              type: "screen",
              screenId: screens.some((s) => s.id === screenId) ? screenId : fallbackScreenId,
              label: String(patch?.label ?? item.label ?? "").trim(),
              restricted: Boolean(patch?.restricted ?? item?.restricted),
              allowedRoleIds: normalizeRoleIdList(patch?.allowedRoleIds ?? item?.allowedRoleIds),
            };
          }),
        };
      });
      liveMenuGroupsRef.current = nextGroups;
      return nextGroups;
    });
    scheduleProjectAutoSave();
  }

  function deleteLiveMenuItem(groupId, itemId) {
    const gId = String(groupId || "");
    const iId = String(itemId || "");
    if (!gId || !iId) return;
    setLiveMenuGroups((prev) => {
      const nextGroups = normalizeLiveMenuGroups(prev, screens).map((group) =>
        group.id === gId ? { ...group, items: group.items.filter((item) => item.id !== iId) } : group
      );
      liveMenuGroupsRef.current = nextGroups;
      return nextGroups;
    });
    scheduleProjectAutoSave();
  }

  function moveLiveMenuItem(groupId, itemId, delta) {
    const gId = String(groupId || "");
    const iId = String(itemId || "");
    if (!gId || !iId || !Number.isInteger(delta) || delta === 0) return;
    setLiveMenuGroups((prev) => {
      const nextGroups = normalizeLiveMenuGroups(prev, screens).map((group) => {
        if (group.id !== gId) return group;
        const index = group.items.findIndex((item) => item.id === iId);
        if (index < 0) return group;
        const target = index + delta;
        if (target < 0 || target >= group.items.length) return group;
        const nextItems = [...group.items];
        const [item] = nextItems.splice(index, 1);
        nextItems.splice(target, 0, item);
        return { ...group, items: nextItems };
      });
      liveMenuGroupsRef.current = nextGroups;
      return nextGroups;
    });
    scheduleProjectAutoSave();
  }

  function getRouteContextForScreenId(screenId) {
    const id = String(screenId || "").trim();
    if (!id) return { routeId: "", routeName: "" };
    const screen = (Array.isArray(screens) ? screens : []).find((s) => String(s?.id || "") === id) || null;
    const routeId = String(screen?.routeId || "").trim();
    if (!routeId) return { routeId: "", routeName: "" };
    const route =
      routeInfoById.get(routeId) ||
      routeInfoById.get(routeId.toLowerCase()) ||
      null;
    const routeName = String(route?.name || routeId).trim() || routeId;
    return { routeId, routeName };
  }

  function resolveLiveMenuItemLabel(item, screen = null) {
    const type = String(item?.type || "").trim().toLowerCase();
    const isData = type === "data";
    const isReports = type === "reports";
    if (isData) {
      const configuredTable = String(item?.dataTable || "").trim();
      return (
        String(item?.label || "").trim() ||
        normalizeTableDisplayName(configuredTable) ||
        "Data"
      );
    }
    if (isReports) {
      return String(item?.label || "").trim() || "Reports";
    }
    const targetScreen =
      screen ||
      (Array.isArray(screens)
        ? screens.find((s) => String(s?.id || "") === String(item?.screenId || "")) || null
        : null);
    const { routeName } = getRouteContextForScreenId(targetScreen?.id || item?.screenId);
    const explicitLabel = String(item?.label || "").trim();
    if (explicitLabel) return explicitLabel;
    const screenNameLabel = String(targetScreen?.name || "").trim();
    if (screenNameLabel) return screenNameLabel;
    if (routeName) return routeName;
    return "Screen";
  }

  function activateLiveMenuItem(item) {
    if (!item || typeof item !== "object") return;
    if (!canOpenLiveMenuItem(item)) {
      const roleRestricted = isLiveMenuItemRoleRestricted(item);
      toastError(
        roleRestricted
          ? "This menu item is locked for your role."
          : "You do not have permission to open this page."
      );
      return;
    }
    const itemType = String(item?.type || "").trim().toLowerCase();
    if (itemType === "data") {
      const table = String(item.dataTable || "").trim();
      if (table) {
        openDrawer("database", {
          forceDatabaseDataTab: true,
          databasePath: `/data/${encodeURIComponent(table)}`,
        });
        return;
      }
      openDrawer("database", { forceDatabaseDataTab: true });
      return;
    }
    if (itemType === "reports") {
      openDrawer("reports");
      return;
    }
    const screenId = String(item.screenId || "");
    if (!screenId) return;
    switchToScreen(screenId);
  }

  function openImportDock() {
    setWidgetOpen(false);
    setImportOpen(true);
  }

  function openWidgetDock() {
    setImportOpen(false);
    setWidgetOpen(true);
  }

  function openDockedJobForm(item = null) {
    if (item && !canOpenLiveMenuItem(item)) {
      const roleRestricted = isLiveMenuItemRoleRestricted(item);
      toastError(
        roleRestricted
          ? "This menu item is locked for your role."
          : "You do not have permission to open this page."
      );
      return;
    }
    if (!canViewDataPages) {
      toastError("You do not have permission to open Database pages.");
      return;
    }
    const routeCtx =
      item && String(item?.type || "").trim().toLowerCase() !== "data"
        ? getRouteContextForScreenId(item?.screenId)
        : { routeId: "", routeName: "" };
    openDrawer("database", {
      forceDatabaseDataTab: true,
      databasePath: "/data/jobs",
      databaseRouteId: routeCtx.routeId,
      databaseRouteName: routeCtx.routeName,
    });
  }

  function toggleLiveMenuGroupCollapse(groupId) {
    const id = String(groupId || "");
    if (!id) return;
    setCollapsedLiveGroupIds((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    });
  }

  const formatProjectTime = (value) => {
    const t = String(value || "").trim();
    if (!t) return "";
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  };
  const lastProjectSaveLabel = formatProjectTime(lastProjectSaveAt);
  const activeCanvasBackgroundColor =
    theme === "dark" ? projectCanvasBackground.dark : projectCanvasBackground.light;
  const projectDrawerInsetPx = showProjectDrawer && !projectDrawerFullscreen ? Math.round(drawerSizes.project.w) : 0;
  const projectDrawerInset = `${projectDrawerInsetPx}px`;
  const liveMenuIsExpanded = true;
  const liveMenuExpandedWidthClamped = Math.max(
    LIVE_MENU_EXPANDED_WIDTH_MIN,
    Math.min(
      LIVE_MENU_EXPANDED_WIDTH_MAX,
      Math.min(
        Math.max(LIVE_MENU_EXPANDED_WIDTH_MIN, Math.floor((winW || 1400) * 0.5)),
        Math.floor(Number(liveMenuExpandedWidth) || LIVE_MENU_EXPANDED_WIDTH_DEFAULT)
      )
    )
  );
  const liveMenuExpandedWidthPx = isLiveMode
    ? isLiveMobile
      ? Math.min(220, Math.max(176, Math.floor(winW * 0.62)))
      : liveMenuExpandedWidthClamped
    : 0;
  const liveMenuCollapsedWidthPx = 0;
  const liveMenuRailWidthPx = isLiveMode
    ? (isLiveMobile ? 0 : showLiveMenuDrawer ? liveMenuExpandedWidthPx : 0)
    : 0;
  const liveMenuLayoutInsetPx = isLiveMode ? (isLiveMobile ? 0 : liveMenuRailWidthPx) : 0;
  const designDockWidthPx = !isLiveMode && showZoom ? (designDockExpanded ? 228 : 44) : 0;
  const sideDockWidthPx = isMobileViewport
    ? Math.min(320, Math.max(250, Math.floor((winW || 0) * 0.86)))
    : 320;
  const svgImportDockWidthPx = !isLiveMode && importOpen ? sideDockWidthPx : 0;
  const widgetDockWidthPx = !isLiveMode && widgetOpen ? sideDockWidthPx : 0;
  const propertiesDockWidthPx = !isLiveMode && showHUD
    ? (isMobileViewport ? Math.min(340, Math.max(250, Math.floor((winW || 0) * 0.88))) : 360)
    : 0;
  const leftToolPanelWidthPx = Math.max(svgImportDockWidthPx, widgetDockWidthPx);
  const leftToolDockOffsetPx = designDockWidthPx + propertiesDockWidthPx;
  const projectDrawerLeftOffsetPx = projectDrawerFullscreen
    ? 0
    : isLiveMode
      ? liveMenuLayoutInsetPx
      : designDockWidthPx;
  const liveCanvasMenuGapPx = 0;
  const liveBottomCarouselHeightPx = isLiveMode && isLiveMobile ? 84 : 0;
  const canvasReadOnly = isLiveMode || !canEditProject;
  const liveEquipmentDrawerWidthPx =
    isLiveMode && isLiveEquipmentLeftDockMode ? 360 : 0;
  const mainDrawerAppendFromLeft =
    isLiveMode && showMainDrawer && drawerView === "database";
  const activeMainDrawerWidth = getMainDrawerWidthForView(drawerSizes, drawerView);
  const mainDrawerAppendLeftPx =
    projectDrawerInsetPx + liveMenuLayoutInsetPx + liveEquipmentDrawerWidthPx;
  const mainDrawerAppendWidthPx = mainDrawerAppendFromLeft
    ? (mainDrawerFullscreen
        ? Math.max(0, (winW || 0) - mainDrawerAppendLeftPx)
        : Math.max(0, Math.round(activeMainDrawerWidth)))
    : 0;
  const canvasLeftInsetBasePx =
    designDockWidthPx +
    propertiesDockWidthPx +
    leftToolPanelWidthPx +
    projectDrawerInsetPx +
    liveMenuLayoutInsetPx +
    liveEquipmentDrawerWidthPx +
    mainDrawerAppendWidthPx;
  const canvasLeftInsetPx = isMobileViewport && !isLiveMode
    ? Math.min(canvasLeftInsetBasePx + liveCanvasMenuGapPx, Math.max(0, (winW || 0) - 96))
    : canvasLeftInsetBasePx + liveCanvasMenuGapPx;
  const liveAlarmBarOffset = isLiveMode ? LIVE_ALARM_BAR_H : 0;
  const leftDrawerTopPx = TOP_BAR_H + (isLiveMode ? liveAlarmBarOffset : 0);
  const designRulerInsetPx = !isLiveMode && showRulers ? RULER_SIZE + 8 : 8;
  const teamChatDesktopTopPx = !isLiveMode ? TOP_BAR_H + designRulerInsetPx : undefined;
  const teamChatDesktopRightPx = !isLiveMode ? designRulerInsetPx : 20;
  const [liveAlarmOccurredAtById, setLiveAlarmOccurredAtById] = useState({});
  const liveActiveAlarmsWithOccurred = useMemo(
    () =>
      (liveActiveAlarms || []).map((alarm) => ({
        ...alarm,
        occurredAt: Number(liveAlarmOccurredAtById?.[alarm.id] || alarm?.occurredAt || 0),
      })),
    [liveActiveAlarms, liveAlarmOccurredAtById]
  );
  const hasLiveAlarms = liveActiveAlarmsWithOccurred.length > 0;
  const liveAlarmMarqueeItems = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const alarm of liveActiveAlarmsWithOccurred || []) {
      const at =
        Number(alarm?.occurredAt || 0) > 0
          ? new Date(alarm.occurredAt).toLocaleString()
          : "";
      const id = String(alarm?.id || "").trim();
      const label = `${alarm?.label || "Alarm"}: ${alarm?.value ?? "-"} ${alarm?.operator || ""} ${alarm?.threshold ?? ""}`.trim();
      const dedupeKey = id || `${alarm?.topic || ""}|${label}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        id,
        label,
        at,
        title: `${alarm.topic ? `${alarm.topic} \u2022 ` : ""}${label}${at ? ` \u2022 ${at}` : ""}`,
      });
    }
    return out;
  }, [liveActiveAlarmsWithOccurred]);
  const liveAlarmMarqueeDurationSec = LIVE_ALARM_MARQUEE_DURATION_SEC;
  const teamChatLiveUsers = useMemo(() => {
    const rows = Array.isArray(livePresenceUsers) ? livePresenceUsers : [];
    const byId = new Map();
    rows.forEach((entry) => {
      const userId = String(entry?.user_id || "").trim();
      const username =
        String(entry?.display_name || "").trim() ||
        String(entry?.username || "User").trim() ||
        "User";
      const key = userId || username.toLowerCase();
      if (!key || byId.has(key)) return;
      byId.set(key, { userId, username });
    });
    return Array.from(byId.values()).sort((a, b) => a.username.localeCompare(b.username));
  }, [livePresenceUsers]);
  const userSettingsDirty = hasUnsavedUserSettingsDraft();
  const projectSettingsDirty = hasUnsavedProjectSettingsDraft();
  const securitySettingsDirty = hasUnsavedSecurityDraft();
  const useLightLiveDataSurface = isLiveMode && databaseDataOnlyMode && theme !== "dark";
  const alarmDatabasePath = useMemo(() => {
    const list = Array.isArray(databaseTablesForMenu) ? databaseTablesForMenu : [];
    const lowered = list.map((t) => String(t || "").trim()).filter(Boolean);
    const exactOpcAlarmState = lowered.find((t) => t.toLowerCase() === "opc_alarm_state");
    if (exactOpcAlarmState) return exactOpcAlarmState;
    const exactAlarms = lowered.find((t) => t.toLowerCase() === "alarms");
    if (exactAlarms) return exactAlarms;
    const containsAlarm = lowered.find((t) => t.toLowerCase().includes("alarm"));
    if (containsAlarm) return containsAlarm;
    return "opc_alarm_state";
  }, [databaseTablesForMenu]);
  const projectDrawerTabs = isLiveMode
    ? [{ key: "project", label: "Project", title: "Project Settings" }]
    : [
        { key: "project", label: "Project", title: "Project Settings" },
        { key: "menu", label: "Menu", title: "Menu Config" },
        { key: "screens", label: "Screens", title: "Manage Screens" },
      ];

  useEffect(() => {
    if (liveMenuIsExpanded) setLiveMenuHoverItemId("");
  }, [liveMenuIsExpanded]);

  useEffect(() => {
    if (!isLiveMode) setShowLiveMenuDrawer(false);
  }, [isLiveMode]);

  useEffect(() => {
    const activeIds = new Set((liveActiveAlarms || []).map((a) => String(a?.id || "")).filter(Boolean));
    const byIdOccurred = new Map(
      (liveActiveAlarms || [])
        .map((a) => [String(a?.id || ""), Number(a?.occurredAt || 0)])
        .filter(([id]) => !!id)
    );
    const now = Date.now();
    setLiveAlarmOccurredAtById((prev) => {
      const next = {};
      let changed = false;
      activeIds.forEach((id) => {
        const existing = Number(prev?.[id] || 0);
        if (existing > 0) {
          next[id] = existing;
          return;
        }
        const fromAlarm = Number(byIdOccurred.get(id) || 0);
        if (fromAlarm > 0) {
          next[id] = fromAlarm;
          changed = true;
          return;
        }
        next[id] = now;
        changed = true;
      });
      const prevKeys = Object.keys(prev || {});
      if (!changed && prevKeys.length === Object.keys(next).length) return prev;
      return next;
    });
  }, [liveActiveAlarms]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg)",
        color: "var(--text)",
        overflow: "hidden",
        fontFamily: "system-ui",
        userSelect: "none",
        WebkitUserSelect: "none",
        paddingTop: TOP_BAR_H + liveAlarmBarOffset,
        paddingLeft: 0,
        boxSizing: "border-box",
      }}
    >
      <ViewBoxModal
        open={viewBoxOpen}
        onClose={() => setViewBoxOpen(false)}
        vbW={vbW}
        vbH={vbH}
        onApply={applyViewBox}
      />

      <PropertiesPanel
        showHUD={showHUD}
        setShowHUD={setShowHUD}
        selectedBBox={selectedBBox}
        selCount={selCount}
        isSingle={isSingle}
        singleKind={singleKind}
        selectedIds={selectedIds}
        selectedOverlayIds={selectedOverlayIds}
        singleOverlayId={singleSelectedOverlayId}
        svgFiles={svgFiles}
        svgTemplateKey={singleSvgTemplateKey}
        swapSvgTemplate={swapOverlayTemplate}
        svgTemplateName={singleGeneratedTemplate?.name || ""}
        isGeneratedTemplate={!!singleGeneratedTemplate}
        renameSvgTemplate={renameGeneratedSvg}
        persistSvgMeta={persistSvgMeta}
        panelAnchor={panelAnchor}
        panelAnchorKey={panelAnchorKey}
        panelCursor={panelCursor}
        freezePanel={freezePanel}
        hudFields={hudFields}
        setHudFields={setHudFields}
        applySingleId={applySingleId}
        applySingleTagPath={applySingleTagPath}
        applySingleBinBinding={applySingleBinBinding}
        applySingleEType={applySingleEType}
        applySingleDiverterMode={applySingleDiverterMode}
        applySingleFill={applySingleFill}
        applySingleStroke={applySingleStroke}
        applySingleSvgStrokeWidth={applySingleSvgStrokeWidth}
        applySingleFaultSim={applySingleFaultSim}
        applyOverlaySpacing={applyOverlaySpacing}
        bringSelectedOverlaysToFront={bringSelectedOverlaysToFront}
        sendSelectedOverlaysToBack={sendSelectedOverlaysToBack}
        applyBBoxFromHud={applyBBoxFromHud}
        applySingleArrowStart={applySingleArrowStart}
        applySingleArrowEnd={applySingleArrowEnd}
        applySingleLineStyle={applySingleLineStyle}
        applySingleTextValue={applySingleTextValue}
        applySingleFontSize={applySingleFontSize}
        applySingleFontFamily={applySingleFontFamily}
        applySingleFontWeight={applySingleFontWeight}
        applySingleTextAlign={applySingleTextAlign}
        applySingleWidgetSettings={applySingleWidgetSettings}
        opcTags={opcTags}
        svgETypeOptions={svgETypeOptions}
        svgBinOptions={svgBinBindingOptions}
        duplicateOffset={duplicateOffset}
        setDuplicateOffset={setDuplicateOffset}
        convertPolylinesToSvg={convertSelectedPolylinesToSvg}
        bounds={{
          top: TOP_BAR_H + RULER_SIZE + 8,
          left: RULER_SIZE + 8,
          right: RULER_SIZE + 8,
          bottom: 8,
        }}
        docked={!isLiveMode}
        dockLeft={designDockWidthPx}
        dockTop={TOP_BAR_H}
        dockBottom={0}
        dockWidth={360}
      />

      <ImportModal
        importOpen={importOpen}
        setImportOpen={setImportOpen}
        svgFiles={svgFiles}
        svgLibrary={svgLibraryMap}
        loadSvgRaw={readSvgRawByKey}
        onPickSvg={onPickSvg}
        docked={!isLiveMode}
        dockLeft={leftToolDockOffsetPx}
        dockTop={TOP_BAR_H}
        dockBottom={0}
        dockWidth={svgImportDockWidthPx || 320}
      />
      <WidgetSelectorModal
        open={widgetOpen}
        onClose={() => setWidgetOpen(false)}
        onPickWidget={(key) => onPickWidget(key)}
        docked={!isLiveMode}
        dockLeft={leftToolDockOffsetPx}
        dockTop={TOP_BAR_H}
        dockBottom={0}
        dockWidth={widgetDockWidthPx || 320}
      />

      <CanvasSvg
          svgRef={svgRef}
          theme={theme}
        canvasBackgroundColor={activeCanvasBackgroundColor}
        viewportTopOffset={TOP_BAR_H + liveAlarmBarOffset}
        viewportLeftOffset={canvasLeftInsetPx}
        viewportBottomOffset={showDesktopTaskbar ? TASKBAR_H : 0}
        viewportScrollTarget={canvasViewportScrollTarget}
        onViewportScroll={(next) => {
          const x = Number(next?.x);
          const y = Number(next?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          canvasViewportScrollRef.current = { x, y };
        }}
        liveClickable={isLiveMode && canInteractLiveScreens}
        isLiveMode={isLiveMode}
          zoom={zoom}          // ? NEW
          onWheel={onWheelZoom} // ? NEW
          vbW={vbW}
          vbH={vbH}
          tool={isLiveMode ? "select" : tool}
          shapes={shapes}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          setSelectedOverlayIds={setSelectedOverlayIds}
          inlineEditId={inlineEdit?.id || null}
          selectedSegment={selectedSegment}
          editingId={editingId}
        showTagPaths={showTagPaths}
        showGrid={projectIdentityReady && !isLiveMode && showGrid}
        showRulers={projectIdentityReady && !isLiveMode && showRulers}
        onSvgMouseDown={canvasReadOnly ? () => {} : onSvgMouseDown}
        onMouseMove={canvasReadOnly ? () => {} : onMouseMove}
        onMouseUp={canvasReadOnly ? () => {} : onMouseUp}
        onContextMenu={canvasReadOnly ? undefined : onContextMenu}
        onShapeMouseDown={canvasReadOnly ? () => {} : onShapeMouseDown}
        onShapeDoubleClick={canvasReadOnly ? () => {} : onShapeDoubleClick}
        onEditPolylineClick={canvasReadOnly ? () => {} : onEditPolylineClick}
        onHandleMouseDown={canvasReadOnly ? () => {} : onHandleMouseDown}
        onHandleDoubleClick={canvasReadOnly ? () => {} : onHandleDoubleClick}
        onHandleContextMenu={canvasReadOnly ? undefined : onHandleContextMenu}
        onSegmentMouseDown={canvasReadOnly ? () => {} : onSegmentMouseDown}
        setShapes={setShapes}
        svgOverlays={svgOverlays}
        setSvgOverlays={setSvgOverlays}
        selectedOverlayIds={selectedOverlayIds}
        singleSelectedOverlayId={singleSelectedOverlayId}
        setOverlayRef={setOverlayRef}
        onOverlayMouseDown={
          isLiveMode
            ? (canInteractLiveScreens ? onLiveOverlayMouseDown : () => {})
            : (canEditProject ? onOverlayMouseDown : () => {})
        }
        onOverlayDoubleClick={
          isLiveMode
            ? (canInteractLiveScreens ? onLiveOverlayMouseDown : () => {})
            : (canEditProject ? onOverlayDoubleClick : () => {})
        }
        overlaySelectionUI={overlaySelectionUI}
        overlayGroupSelectionUI={overlayGroupSelectionUI}
        shapeSelectionUI={shapeSelectionUI}
        overlayLocalBBox={overlayLocalBBox}
        marquee={marquee}
        pan={pan}
        importAnchor={importAnchor}
        onSvgDoubleClick={canvasReadOnly ? undefined : onSvgDoubleClick}
        tagStateColorsByPath={tagStateColorsByPath}
        routeColorsBySvgKey={routeColorsBySvgKey}
        routeStrokeColorByGroupPath={routeStrokeColorByGroupPath}
        svgLiveValuesByGroupPath={svgLiveValuesByGroupPath}
        opcLiveValues={opcLiveValues}
        opcTags={opcTags}
        widgetDbValues={widgetDbValues}
        binProductLabelByOverlayId={binProductLabelByOverlayId}
        binNameLabelByOverlayId={binNameLabelByOverlayId}
        binLevelRatioByOverlayId={binLevelRatioByOverlayId}
        onWidgetDurationPresetChange={onWidgetDurationPresetChange}
        hiddenTagBubbleIds={hiddenTagBubbleIds}
        onHideTagBubble={(id) =>
          setHiddenTagBubbleIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
        }
        collaboratorCursors={projectCursors}
      />

      {isLiveMode && isLiveEquipmentLeftDockMode && liveEquipmentDrawerEntries.length ? (
        <div
          ref={liveEquipmentDrawerRef}
          style={{
            position: "fixed",
            left: projectDrawerInsetPx + liveMenuLayoutInsetPx + 8,
            top: TOP_BAR_H + liveAlarmBarOffset + 8,
            bottom: showDesktopTaskbar ? TASKBAR_H + 8 : 8,
            width: liveEquipmentDrawerWidthPx - 16,
            zIndex: LIVE_EQUIPMENT_Z_BASE + 50,
            pointerEvents: "auto",
            border: "1px solid var(--border)",
            borderRadius: 12,
            background: "var(--bg-elev)",
            boxShadow: "0 16px 32px rgba(2,8,23,0.22)",
            display: "grid",
            gridTemplateRows: "auto 1fr",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 10px 8px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>
              Equipment Dock ({liveEquipmentDrawerEntries.length})
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => setLiveEquipmentDrawerOverlayId("")}
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  borderRadius: 7,
                  cursor: "pointer",
                  color: "var(--text)",
                  fontSize: 11,
                  width: 26,
                  height: 24,
                  display: "grid",
                  placeItems: "center",
                  padding: 0,
                }}
                title="Return to bottom dock"
                aria-label="Return to bottom dock"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 4v9m0 0-3-3m3 3 3-3M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div className="vizi-scroll" style={{ overflow: "auto", padding: "10px", display: "grid", gap: 10, alignContent: "start" }}>
            {liveEquipmentDrawerEntries.map(({ overlay, details }) => {
              const overlayId = String(overlay?.id || "");
              return (
              <div
                key={`live-equipment-drawer-card-${overlay.id}`}
                style={{
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  boxShadow: "0 8px 16px rgba(0,0,0,0.2)",
                  padding: 9,
                  display: "grid",
                  gap: 6,
                  alignContent: "start",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "grid", gap: 2 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>
                      {getOverlayPopupTitle(overlay)}
                    </div>
                    {getOverlayPopupSubline(overlay) ? (
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        {getOverlayPopupSubline(overlay)}
                      </div>
                    ) : null}
                  </div>
                  <button
                    onClick={() => closeLiveEquipmentCard(overlay?.id)}
                    style={{
                      border: "1px solid var(--border)",
                      background: "var(--bg-elev)",
                      borderRadius: 7,
                      width: 26,
                      height: 24,
                      display: "grid",
                      placeItems: "center",
                      padding: 0,
                      cursor: "pointer",
                      color: "var(--text)",
                      fontSize: 11,
                    }}
                    aria-label="Close equipment info"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Description: {getOverlayEquipmentDescription(overlay) || "-"}
                </div>
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>Live Data</div>
                  </div>
                  {Array.isArray(details) && details.length ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", columnGap: 10, rowGap: 4, alignContent: "start", alignItems: "center", fontSize: 11 }}>
                      {details.map((row, idx) => (
                        <Fragment key={`live-equipment-drawer-row-${overlay?.id}-${idx}`}>
                          <div style={{ color: "var(--text-muted)" }}>{row.key}</div>
                          <div style={{ color: "var(--text)", fontWeight: 700, textAlign: "right" }}>{row.value}</div>
                        </Fragment>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      No live values found for this equipment.
                    </div>
                  )}
                </div>
                {renderLiveMotorControls(overlay, false)}
                {renderLiveDiverterControls(overlay, false)}
                {renderLiveBinDetails(overlay, false)}
              </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {isLiveMode && liveEquipmentDockEntries.length > 0 ? (
        <>
          <LiveEquipmentConnectorLayer
            lines={liveEquipmentConnectorLines}
            connectFxById={liveEquipmentConnectFxById}
          />
          {[
            {
              key: "top",
              entries: liveEquipmentTopDockEntries,
              style: {
                top: TOP_BAR_H + liveAlarmBarOffset + 8,
                bottom: "auto",
              },
            },
            {
              key: "bottom",
              entries: liveEquipmentBottomDockEntries,
              style: {
                top: "auto",
                bottom: showDesktopTaskbar ? TASKBAR_H + 10 : 10,
              },
            },
          ].map((lane) =>
            lane.entries.length ? (
              <div
                key={`live-eq-dock-${lane.key}`}
                style={{
                  position: "fixed",
                  left: projectDrawerInsetPx + liveMenuLayoutInsetPx + liveEquipmentDrawerWidthPx + 10,
                  right: 10,
                  zIndex: LIVE_EQUIPMENT_Z_BASE,
                  pointerEvents: "none",
                  ...lane.style,
                }}
              >
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  className="vizi-live-equipment-dock vizi-scroll"
                  style={{
                    display: "flex",
                    gap: 10,
                    overflowX: "auto",
                    overflowY: "hidden",
                    paddingBottom: 2,
                    pointerEvents: "none",
                    scrollSnapType: "x mandatory",
                  }}
                  onScroll={onLiveEquipmentDockScroll}
                >
                  {lane.entries.map(({ overlay, details }) => {
                    return (
                    <div
                      key={`live-equipment-card-${overlay.id}`}
                      ref={(node) => {
                        const id = String(overlay.id || "");
                        if (!id) return;
                        if (node) liveEquipmentCardRefs.current.set(id, node);
                        else liveEquipmentCardRefs.current.delete(id);
                      }}
                      style={{
                        scrollSnapAlign: "start",
                        flex: "0 0 min(300px, 68vw)",
                        maxHeight: "none",
                        overflow: "visible",
                        borderRadius: 10,
                        border: "1px solid var(--border)",
                        background: "var(--bg-elev)",
                        boxShadow: "0 12px 26px rgba(0,0,0,0.28)",
                        padding: 9,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        pointerEvents: "auto",
                      }}
                      className="vizi-scroll"
                    >
                <div
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "move" }}
                  onMouseDown={(e) => beginLiveEquipmentCardMove(e, overlay.id)}
                >
                  <div style={{ display: "grid", gap: 2 }}>
                    <div
                      style={{ fontSize: 12, fontWeight: 800, color: "var(--text)", cursor: "move" }}
                      title="Drag to move"
                    >
                      {getOverlayPopupTitle(overlay)}
                    </div>
                    {getOverlayPopupSubline(overlay) ? (
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        {getOverlayPopupSubline(overlay)}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => closeLiveEquipmentCard(overlay.id)}
                      style={{ border: "1px solid var(--border)", background: "var(--bg)", borderRadius: 7, width: 26, height: 24, display: "grid", placeItems: "center", padding: 0, cursor: "pointer", color: "var(--text)", fontSize: 11 }}
                      aria-label="Close equipment info"
                      title="Close"
                    >
                      {"\u2715"}
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Description: {getOverlayEquipmentDescription(overlay) || "-"}
                </div>
                <div style={{ minHeight: 0, overflow: "visible", display: "grid", gap: 6, alignContent: "start" }}>
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text)" }}>Live Data</div>
                  </div>
                  {details.length ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", columnGap: 8, rowGap: 3, alignContent: "start", alignItems: "center", fontSize: 10 }}>
                      {details.map((row, idx) => (
                        <Fragment key={`live-equipment-row-${overlay.id}-${idx}`}>
                          <div style={{ color: "var(--text-muted)" }}>{row.key}</div>
                          <div style={{ color: "var(--text)", fontWeight: 700, textAlign: "right" }}>{row.value}</div>
                        </Fragment>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>No live values found for this equipment.</div>
                  )}
                </div>
                </div>
                <div style={{ marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: 6, display: "grid", gap: 6 }}>
                {renderLiveMotorControls(overlay, true)}
                {renderLiveDiverterControls(overlay, true)}
                {renderLiveBinDetails(overlay, true)}
                </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            ) : null
          )}
          {liveEquipmentFloatingEntries.map(({ overlay, details }) => {
            const id = String(overlay?.id || "");
            const pos = liveEquipmentFloatingById[id];
            if (!id || !pos) return null;
            return (
              <div
                key={`live-equipment-floating-${id}`}
                ref={(node) => {
                  if (!id) return;
                  if (node) liveEquipmentCardRefs.current.set(id, node);
                  else liveEquipmentCardRefs.current.delete(id);
                }}
                style={{
                  position: "fixed",
                  left: Number(pos.x) || 0,
                  top: Number(pos.y) || TOP_BAR_H + liveAlarmBarOffset + 10,
                  width: "min(300px, 68vw)",
                  maxHeight: "none",
                  overflow: "visible",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--bg-elev)",
                  boxShadow: "0 12px 26px rgba(0,0,0,0.28)",
                  padding: 9,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  zIndex: LIVE_EQUIPMENT_Z_BASE + 100 + Number(liveEquipmentZById?.[id] || 0),
                  pointerEvents: "auto",
                }}
                className="vizi-scroll"
                onMouseDown={(e) => {
                  bringLiveEquipmentToFront(id);
                  e.stopPropagation();
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "move" }}
                  onMouseDown={(e) => beginLiveEquipmentCardMove(e, id)}
                >
                  <div style={{ display: "grid", gap: 2 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>
                      {getOverlayPopupTitle(overlay)}
                    </div>
                    {getOverlayPopupSubline(overlay) ? (
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        {getOverlayPopupSubline(overlay)}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => dockLiveEquipmentCard(id)}
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        borderRadius: 7,
                        cursor: "pointer",
                        color: "var(--text)",
                        fontSize: 11,
                        width: 26,
                        height: 24,
                        display: "grid",
                        placeItems: "center",
                        padding: 0,
                      }}
                      title="Dock"
                      aria-label="Dock"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M4 5h16v14H4zM9 5v14M13 12h5M16 9l3 3-3 3"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => closeLiveEquipmentCard(id)}
                      style={{ border: "1px solid var(--border)", background: "var(--bg)", borderRadius: 7, width: 26, height: 24, display: "grid", placeItems: "center", padding: 0, cursor: "pointer", color: "var(--text)", fontSize: 11 }}
                      aria-label="Close equipment info"
                      title="Close"
                    >
                      {"\u2715"}
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Description: {getOverlayEquipmentDescription(overlay) || "-"}
                </div>
                <div style={{ minHeight: 0, overflow: "visible", display: "grid", gap: 6, alignContent: "start" }}>
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text)" }}>Live Data</div>
                  </div>
                  {details.length ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", columnGap: 8, rowGap: 3, alignContent: "start", alignItems: "center", fontSize: 10 }}>
                      {details.map((row, idx) => (
                        <Fragment key={`live-equipment-floating-row-${overlay.id}-${idx}`}>
                          <div style={{ color: "var(--text-muted)" }}>{row.key}</div>
                          <div style={{ color: "var(--text)", fontWeight: 700, textAlign: "right" }}>{row.value}</div>
                        </Fragment>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>No live values found for this equipment.</div>
                  )}
                </div>
                </div>
                <div style={{ marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: 6, display: "grid", gap: 6 }}>
                {renderLiveMotorControls(overlay, true)}
                {renderLiveDiverterControls(overlay, true)}
                {renderLiveBinDetails(overlay, true)}
                </div>
              </div>
            );
          })}
        </>
      ) : null}

      {!isLiveMode && inlineEdit && inlineEditPos && (
        <input
          autoFocus
          value={inlineEdit.value}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setInlineEdit((p) => ({ ...p, value: e.target.value }))}
          onBlur={() => {
            const next = inlineEdit.value;
            if (next != null) {
              pushHistory();
              if (inlineEdit.kind === "overlay") {
                setSvgOverlays((prev) =>
                  prev.map((x) =>
                    x.id === inlineEdit.id
                      ? { ...x, inner: writeFirstInnerSvgText(x.inner, String(next)) }
                      : x
                  )
                );
              } else {
                setShapes((prev) =>
                  prev.map((x) => (x.id === inlineEdit.id ? { ...x, text: String(next) } : x))
                );
              }
              scheduleProjectAutoSave();
            }
            setInlineEdit(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setInlineEdit(null);
            }
          }}
          style={{
            position: "fixed",
            left: inlineEditPos.x,
            top: inlineEditPos.y,
            transform: "translateY(0)",
            fontSize: inlineEditPos.fontSize,
            fontFamily: inlineEditPos.fontFamily,
            fontWeight: inlineEditPos.fontWeight,
            color: "var(--text)",
            border: "1px solid #2b6cff",
            borderRadius: 6,
            padding: "2px 6px",
            background: "var(--bg-elev)",
            zIndex: 200,
            outline: "none",
            minWidth: inlineEditPos.width,
          }}
        />
      )}

      <input
        ref={projectFileRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={async (e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];

          // ? allow selecting same file again later
          input.value = "";

          if (!file) return;

          const text = await file.text();

          let data;
          try {
            data = JSON.parse(text);
          } catch {
            alert("Invalid JSON file.");
            return;
          }

          const nextShapes = Array.isArray(data.shapes) ? data.shapes : [];
          const nextOverlays = Array.isArray(data.svgOverlays) ? data.svgOverlays : [];

          pushHistory(); // undo support

          setShapes(nextShapes);
          setSvgOverlays(nextOverlays);

          if (Number.isFinite(data.vbW)) setVbW(data.vbW);
          if (Number.isFinite(data.vbH)) setVbH(data.vbH);

          if (data.pan && Number.isFinite(data.pan.x) && Number.isFinite(data.pan.y)) {
            setPan({ x: data.pan.x, y: data.pan.y });
          }

          if (Number.isFinite(data.zoom)) setZoom(data.zoom);

          // ? update project metadata
          setProjectHandle(null); // loaded from download; no writable handle
          setProjectName(
            (data?.name && String(data.name)) ||
            (file.name ? file.name.replace(/\.json$/i, "") : "Untitled")
          );

          // clear transient editor state
          setSelectedIds([]);
          setSelectedOverlayIds([]);
          setEditingId(null);
          setDrawing(null);
          setDragAll(null);
          setDragHandle(null);
          setOverlayResize(null);
          setMarquee(null);
          setImportAnchor(null);
        }}
      />




      {showZoom && !isLiveMode && (
        <>
        <div
          ref={zoomPanelRef}
          style={{
            position: "fixed",
            left: isLiveMode ? undefined : 0,
            right: isLiveMode ? (isLiveMobile ? 12 : 16) : undefined,
            top: isLiveMode ? (isLiveMobile ? undefined : undefined) : TOP_BAR_H,
            bottom: isLiveMode ? (isLiveMobile ? liveBottomCarouselHeightPx + 10 : 12) : 0,
            zIndex: 80,
            boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: isLiveMode ? "row" : "column",
            gap: isLiveMode ? 3 : 4,
            padding: isLiveMode ? "4px 6px" : "3px 5px",
            background: "color-mix(in srgb, var(--bg-elev) 92%, transparent)",
            border: "1px solid var(--border)",
            borderRadius: isLiveMode ? 12 : 0,
            alignItems: isLiveMode ? "center" : "stretch",
            overflowY: isLiveMode ? "visible" : "auto",
            overflowX: "hidden",
            width: isLiveMode ? undefined : designDockExpanded ? 228 : 44,
            boxSizing: "border-box",
            transition: isLiveMode ? "none" : "width 220ms ease, padding 220ms ease",
          }}
          onMouseDown={undefined}
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {!isLiveMode ? (
            <div
              style={{
                display: "grid",
                gap: 6,
                width: "100%",
                paddingBottom: 3,
                marginBottom: 0,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <button
                title={designDockExpanded ? "Collapse Dock" : "Expand Dock"}
                onClick={() => setDesignDockExpanded((v) => !v)}
                style={{
                  ...topMenuIconButtonStyle,
                  width: designDockExpanded ? "100%" : undefined,
                  height: 28,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: designDockExpanded ? "flex-end" : "center",
                  padding: designDockExpanded ? "0 6px 0 0" : 0,
                  border: "none",
                  boxShadow: "none",
                  background: "transparent",
                  color: "var(--text)",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d={designDockExpanded ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      animation: designDockExpanded ? "none" : "live-menu-arrow-pulse 1s ease-in-out infinite",
                      transition: "transform 180ms ease",
                    }}
                  />
                </svg>
              </button>
              <button title="Export SVG" style={dockToolButtonStyle(false)} onClick={exportSVG}>
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path d="M12 3v10m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {designDockExpanded ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700 }}>Export SVG</span> : null}
              </button>
              <button title="Import SVG" onClick={openImportDock} style={dockToolButtonStyle(false)}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M14 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M12 11v6M9 14h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {designDockExpanded ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700 }}>Import SVG</span> : null}
              </button>
              <button title="Add Widget" style={dockToolButtonStyle(false)} onClick={openWidgetDock}>
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="12" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="2" />
                  <rect x="10" y="8" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
                  <rect x="17" y="5" width="4" height="15" rx="1" stroke="currentColor" strokeWidth="2" />
                </svg>
                {designDockExpanded ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700 }}>Add Widget</span> : null}
              </button>
              <div style={{ height: 1, width: "100%", background: "var(--border)", opacity: 0.7, margin: "4px 0 2px" }} />
              {designDockExpanded ? (
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", padding: "0 6px" }}>
                  Draw
                </div>
              ) : null}
              <button className="top-menu-btn" title="Move" style={dockToolButtonStyle(tool === "select")} onClick={() => { setTool("select"); setDrawing(null); }}>
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path d="M4 3l7 18 2-7 7-2L4 3z" stroke="currentColor" strokeWidth="2" />
                </svg>
                {designDockExpanded ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700 }}>Move</span> : null}
              </button>
              {designDockExpanded ? (
                <label
                  title="Selection filter"
                  style={{
                    display: "grid",
                    gap: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    padding: "0 4px",
                  }}
                >
                  <span style={{ letterSpacing: "0.04em", textTransform: "uppercase" }}>Selection</span>
                  <select
                    value={selectionMode}
                    onChange={(e) => {
                      const nextMode = String(e.target.value || "all");
                      setSelectionMode(nextMode);
                      clearSelection();
                    }}
                    style={{
                      width: "100%",
                      border: "1px solid var(--border)",
                      background: "var(--bg-elev)",
                      color: "var(--text)",
                      borderRadius: 8,
                      padding: "6px 8px",
                      height: 30,
                      fontSize: 11,
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="all">All objects</option>
                    <option value="svg">SVG only</option>
                    <option value="polyline">Polylines only</option>
                  </select>
                </label>
              ) : (
                <button
                  className="top-menu-btn"
                  title={`Selection Filter: ${selectionMode === "svg" ? "SVG only" : selectionMode === "polyline" ? "Polylines only" : "All objects"}`}
                  style={dockToolButtonStyle(selectionMode !== "all")}
                  onClick={() => {
                    const nextMode = selectionMode === "all" ? "svg" : selectionMode === "svg" ? "polyline" : "all";
                    setSelectionMode(nextMode);
                    clearSelection();
                  }}
                >
                  <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                    <path d="M5 6h14M5 12h14M5 18h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              )}
              <button
                className="top-menu-btn"
                title="Polyline"
                style={dockToolButtonStyle(tool === "polyline")}
                onClick={() => {
                  setTool("polyline");
                  setDrawing(null);
                  exitEditMode();
                  setSelectedOverlayIds([]);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path d="M5 6h5l4 6h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="5" cy="6" r="1.5" fill="currentColor" />
                  <circle cx="10" cy="6" r="1.5" fill="currentColor" />
                  <circle cx="14" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="19" cy="12" r="1.5" fill="currentColor" />
                </svg>
                {designDockExpanded ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700 }}>Polyline</span> : null}
              </button>
              <button
                className="top-menu-btn"
                title="Rectangle"
                style={dockToolButtonStyle(tool === "rect")}
                onClick={() => {
                  setTool("rect");
                  setDrawing(null);
                  exitEditMode();
                  setSelectedOverlayIds([]);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="6" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="2" />
                </svg>
                {designDockExpanded ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700 }}>Rectangle</span> : null}
              </button>
              <button
                className="top-menu-btn"
                title="Circle"
                style={dockToolButtonStyle(tool === "circle")}
                onClick={() => {
                  setTool("circle");
                  setDrawing(null);
                  exitEditMode();
                  setSelectedOverlayIds([]);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
                </svg>
                {designDockExpanded ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700 }}>Circle</span> : null}
              </button>
              <button
                className="top-menu-btn"
                title="Text"
                style={dockToolButtonStyle(tool === "text")}
                onClick={() => {
                  setTool("text");
                  setDrawing(null);
                  exitEditMode();
                  setSelectedOverlayIds([]);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path d="M4 6V4h16v2M9 20h6M12 4v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {designDockExpanded ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700 }}>Text</span> : null}
              </button>
              <div style={{ height: 1, width: "100%", background: "var(--border)", opacity: 0.7, margin: "4px 0 2px" }} />
              {designDockExpanded ? (
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", padding: "0 6px" }}>
                  Display
                </div>
              ) : null}
              <button className="top-menu-btn" title="Show TagPaths" style={dockToolButtonStyle(!!showTagPaths)} onClick={() => setShowTagPaths((v) => !v)}>
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path d="M4 12l8-8h6l2 2v6l-8 8-8-8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <circle cx="16" cy="8" r="1.5" fill="currentColor" />
                </svg>
                {designDockExpanded ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700 }}>Show TagPaths</span> : null}
              </button>
              <button className="top-menu-btn" title="Show Grid" style={dockToolButtonStyle(!!showGrid)} onClick={() => setShowGrid((v) => !v)}>
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" stroke="currentColor" strokeWidth="2" />
                </svg>
                {designDockExpanded ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700 }}>Show Grid</span> : null}
              </button>
              <button className="top-menu-btn" title="Show Ruler" style={dockToolButtonStyle(!!showRulers)} onClick={() => setShowRulers((v) => !v)}>
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path d="M4 4h16v4H4zM4 10h16v10H4z" stroke="currentColor" strokeWidth="2" />
                  <path d="M8 4v4M12 4v4M16 4v4" stroke="currentColor" strokeWidth="2" />
                </svg>
                {designDockExpanded ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700 }}>Show Ruler</span> : null}
              </button>
            </div>
          ) : null}

          {!isLiveMode ? (
            <div
              style={{
                marginTop: 8,
                display: "grid",
                gap: 4,
                width: "100%",
                borderTop: "1px solid var(--border)",
                paddingTop: 8,
              }}
            >
              <button
                title="Save Project"
                disabled={String(projectStatus || "").trim().toLowerCase() === "saving..."}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => saveProjectToDb({ silent: false, teamMerge: true })}
                style={{
                  ...dockToolButtonStyle(false),
                  width: designDockExpanded ? "100%" : topMenuIconButtonStyle.width,
                  height: topMenuIconButtonStyle.height,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: designDockExpanded ? 8 : 0,
                  padding: designDockExpanded ? "0 8px" : 0,
                  fontSize: 13,
                  fontWeight: 700,
                  lineHeight: 1,
                  opacity: String(projectStatus || "").trim().toLowerCase() === "saving..." ? 0.6 : 1,
                  cursor:
                    String(projectStatus || "").trim().toLowerCase() === "saving..."
                      ? "not-allowed"
                      : "pointer",
                  ...(hasPendingAutoSave
                    ? {
                        border: "1px solid #f59e0b",
                        background:
                          "linear-gradient(180deg, color-mix(in srgb, #f59e0b 22%, var(--bg-elev) 78%) 0%, color-mix(in srgb, #f59e0b 14%, var(--bg-elev) 86%) 100%)",
                        color: "#f59e0b",
                        boxShadow: "0 0 0 1px rgba(245,158,11,0.18), 0 8px 20px rgba(245,158,11,0.16)",
                      }
                    : {}),
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 4h11l3 3v13H5V4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M8 4v6h8V4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M9 20v-6h6v6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                </span>
                {designDockExpanded ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      lineHeight: 1,
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    Save Project
                  </span>
                ) : null}
              </button>
            </div>
          ) : null}

          <div
            style={{
              marginTop: isLiveMode ? 0 : "auto",
              marginBottom: 0,
              display: "grid",
              gap: isLiveMode ? 3 : 4,
              width: isLiveMode ? "auto" : "100%",
              gridAutoFlow: isLiveMode ? "column" : "row",
              alignItems: "center",
            }}
          >
            {/* Zoom buttons */}
            {[
              {
                icon: (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                    <path d="M11 8v6M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ),
                onClick: zoomIn,
                holdAction: zoomIn,
                title: "Zoom In",
              },
              {
                icon: (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ),
                onClick: zoomOut,
                holdAction: zoomOut,
                title: "Zoom Out",
              },
              {
                icon: (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 8a7 7 0 1 1-1 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M6 4v4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ),
                onClick: zoomReset,
                onDoubleClick: zoomResetTo100,
                title: "Reset View (dbl-click = 100%)",
              },
              {
                icon: (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M3 6h18M6 12h12M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <circle cx="8" cy="6" r="1.5" fill="currentColor" />
                    <circle cx="14" cy="12" r="1.5" fill="currentColor" />
                    <circle cx="10" cy="18" r="1.5" fill="currentColor" />
                  </svg>
                ),
                onClick: resetAllDrawerSizes,
                title: "Reset Drawer Sizes",
              },
              {
                icon: isAppFullscreen ? (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M8 8h8v8H8z" stroke="currentColor" strokeWidth="2" />
                  </svg>
                ),
                onClick: toggleAppFullscreen,
                title: isAppFullscreen ? "Exit Full Screen" : "Full Screen",
              },
            ].map((btn) => (
              <button
                key={btn.title}
                title={btn.title}
                disabled={!!btn.disabled}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  if (btn.disabled) return;
                  if (btn.holdAction) {
                    startZoomHold(btn.holdAction, e);
                    return;
                  }
                  e.stopPropagation();
                }}
                onPointerUp={() => {
                  if (btn.holdAction) stopZoomHold();
                }}
                onPointerCancel={() => {
                  if (btn.holdAction) stopZoomHold();
                }}
                onPointerLeave={() => {
                  if (btn.holdAction) stopZoomHold();
                }}
                onKeyDown={(e) => {
                  if (btn.disabled) return;
                  if (!btn.holdAction) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    btn.holdAction();
                  }
                }}
                onDoubleClick={(e) => {
                  if (typeof btn.onDoubleClick === "function") {
                    e.stopPropagation();
                    e.preventDefault();
                    btn.onDoubleClick();
                  }
                }}
                onClick={btn.holdAction ? undefined : btn.onClick}
                style={{
                  ...(isLiveMode ? {} : dockToolButtonStyle(false)),
                  ...(!isLiveMode && btn.pendingAutosave
                    ? {
                        border: "1px solid #f59e0b",
                        background:
                          "linear-gradient(180deg, color-mix(in srgb, #f59e0b 22%, var(--bg-elev) 78%) 0%, color-mix(in srgb, #f59e0b 14%, var(--bg-elev) 86%) 100%)",
                        color: "#f59e0b",
                        boxShadow: "0 0 0 1px rgba(245,158,11,0.18), 0 8px 20px rgba(245,158,11,0.16)",
                      }
                    : {}),
                  width: isLiveMode ? 26 : designDockExpanded ? "100%" : topMenuIconButtonStyle.width,
                  height: isLiveMode ? 26 : topMenuIconButtonStyle.height,
                  minHeight: isLiveMode ? 26 : undefined,
                  borderRadius: isLiveMode ? 8 : undefined,
                  border: isLiveMode ? "1px solid var(--border)" : undefined,
                  background: isLiveMode ? "var(--bg-elev)" : undefined,
                  boxShadow: isLiveMode ? "0 6px 18px rgba(0,0,0,0.10)" : undefined,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: designDockExpanded ? 8 : 0,
                  padding: designDockExpanded ? "0 8px" : 0,
                  fontSize: 13,
                  fontWeight: 700,
                  lineHeight: 1,
                  opacity: btn.disabled ? 0.6 : 1,
                  cursor: btn.disabled ? "not-allowed" : "pointer",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  {btn.icon}
                </span>
                {!isLiveMode && designDockExpanded ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      lineHeight: 1,
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    {btn.title}
                  </span>
                ) : null}
              </button>
            ))}

            {/* zoom % */}
            <div
              style={{
                fontSize: isLiveMode ? 10 : 11,
                opacity: 0.7,
                marginTop: isLiveMode ? 0 : 2,
                marginLeft: 0,
                marginRight: 0,
                width: 24,
                minWidth: 24,
                alignSelf: "center",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                userSelect: "none",
              }}
            >
              {Math.round((zoom || 1) * 100)}
            </div>
          </div>
        </div>
        </>
      )}

      {!isLiveMode && contextMenu && (
        <div
          style={{
            position: "fixed",
            left: menuLeft,
            top: menuTop,
            zIndex: 200,
            background: "var(--bg-elev)",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 8,
            boxShadow: "0 8px 18px rgba(0,0,0,0.16)",
            padding: isEmptyMenu ? 0 : "4px 0",
            minWidth: isEmptyMenu ? menuSize.w : 150,
            maxHeight: isEmptyMenu ? menuSize.h : undefined,
            overflow: isEmptyMenu ? "hidden" : "visible",
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            const target = e.target;
            const isFormControl =
              target instanceof Element &&
              !!target.closest("select, option, input, textarea, button");
            if (!isFormControl) {
              e.preventDefault();
            }
          }}
          onMouseLeave={() => {
            if (contextSvgMenuTimerRef.current) clearTimeout(contextSvgMenuTimerRef.current);
            contextSvgMenuTimerRef.current = setTimeout(() => {
              setContextSvgMenuOpen(false);
            }, 120);
          }}
        >
          {contextMenu.mode === "element" && (selectedIds.length > 0 || selectedOverlayIds.length > 0) && (
            <div
              style={contextMenuItemStyle()}
              onClick={() => {
                copySelection();
                setContextMenu(null);
              }}
            >
              Copy
            </div>
          )}

          {contextMenu.mode === "element" &&
            (clipboardRef.current.shapes.length > 0 || clipboardRef.current.overlays.length > 0) && (
            <div
              style={contextMenuItemStyle()}
              onClick={() => {
                pasteClipboard();
                setContextMenu(null);
              }}
            >
              Paste
            </div>
          )}

          {contextMenu.mode === "element" && (selectedIds.length > 0 || selectedOverlayIds.length > 0) && (
            <div
              style={contextMenuItemStyle()}
              onClick={() => {
                handleDuplicate();
                setContextMenu(null);
              }}
            >
              Duplicate
            </div>
          )}

          {contextMenu.mode === "element" && selectedOverlayIds.length > 0 && (
            <div
              style={contextMenuItemStyle()}
              onClick={() => {
                bringSelectedOverlaysToFront();
                setContextMenu(null);
              }}
            >
              Bring To Front
            </div>
          )}

          {contextMenu.mode === "element" && selectedOverlayIds.length > 0 && (
            <div
              style={contextMenuItemStyle()}
              onClick={() => {
                sendSelectedOverlaysToBack();
                setContextMenu(null);
              }}
            >
              Send To Back
            </div>
          )}

          {contextMenu.mode === "element" && selectedIds.length === 1 && (() => {
            const s = shapes.find((x) => x.id === selectedIds[0]);
            return s && (s.type === "polyline" || Array.isArray(s.points));
          })() && (
            <div
              style={contextMenuItemStyle()}
              onClick={() => {
                const id = selectedIds[0];
                setEditingId(id);
                setDrawing(null);
                setContextMenu(null);
              }}
            >
              Edit Polyline
            </div>
          )}

          {contextMenu.mode === "element" && (selectedIds.length > 0 || selectedOverlayIds.length > 0) && (
            <div
              style={contextMenuItemStyle("#f04438")}
              onClick={() => {
                deleteSelected();
                setContextMenu(null);
              }}
            >
              Delete
            </div>
          )}

          {contextMenu.mode === "empty" && (
            <>
              <div
                style={{
                  ...contextMenuItemStyle(),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
                onMouseEnter={(e) => {
                  if (contextSvgMenuTimerRef.current) {
                    clearTimeout(contextSvgMenuTimerRef.current);
                    contextSvgMenuTimerRef.current = null;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  setContextSvgMenuPos({ x: rect.right + 6, y: rect.top });
                  setContextSvgMenuOpen(true);
                }}
                onMouseLeave={() => {
                  contextSvgMenuTimerRef.current = setTimeout(() => {
                    setContextSvgMenuOpen(false);
                  }, 120);
                }}
              >
                SVG's
                <span style={{ color: "var(--text-muted)" }}>{"\u25B8"}</span>
              </div>
              {(clipboardRef.current.shapes.length > 0 || clipboardRef.current.overlays.length > 0) && (
                <div
                  style={contextMenuItemStyle()}
                  onClick={() => {
                    pasteClipboard();
                    setContextMenu(null);
                  }}
                >
                  Paste
                </div>
              )}
              <div
                style={contextMenuItemStyle()}
                onClick={() => {
                  undo();
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>{"\u21B6"}</span>
                Undo
              </div>
              <div
                style={contextMenuItemStyle()}
                onClick={() => {
                  redo();
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>{"\u21B7"}</span>
                Redo
              </div>
              <div
                style={contextMenuItemStyle()}
                onClick={() => {
                  setTool("polyline");
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>{"\uFF0F"}</span>
                Polyline
              </div>
              <div
                style={contextMenuItemStyle()}
                onClick={() => {
                  setTool("rect");
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>{"\u25AD"}</span>
                Rectangle
              </div>
              <div
                style={contextMenuItemStyle()}
                onClick={() => {
                  setTool("circle");
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>{"\u25EF"}</span>
                Circle
              </div>
              <div
                style={contextMenuItemStyle()}
                onClick={() => {
                  setTool("text");
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>T</span>
                Text
              </div>
              <div
                style={contextMenuItemStyle()}
                onClick={() => {
                  setTool("select");
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>{"\u2194"}</span>
                Move
              </div>
              
              <div
                style={contextMenuItemStyle()}
                onClick={() => {
                  openWidgetDock();
                  setContextMenu(null);
                }}
              >
                Widgets...
              </div>
            </>
          )}

          {contextMenu.mode === "element" && selectedBBox && !showHUD && (
            <div
              style={contextMenuItemStyle()}
              onClick={() => {
                setPanelCursor({ x: contextMenu.x, y: contextMenu.y });
                setShowHUD(true);
                setContextMenu(null);
              }}
            >
              Show Properties
            </div>
          )}
          {contextMenu.mode === "element" && showHUD && (
            <div
              style={contextMenuItemStyle()}
              onClick={() => {
                setShowHUD(false);
                setContextMenu(null);
              }}
            >
              Hide Properties
            </div>
          )}
          {contextMenu.mode === "element" && contextSingleSvg && !contextSingleSvg.widget && (
            <div style={{ padding: "8px 12px", display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Tag</div>
              <input
                type="text"
                value={contextSvgTagQuery}
                placeholder="Search tags..."
                onChange={(e) => setContextSvgTagQuery(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
              style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                  color: "var(--text)",
                  background: "var(--bg-elev)",
                }}
              />
              <select
                value={String(contextSingleSvg.tagPath || "")}
                onChange={(e) => {
                  const v = String(e.target.value || "").trim();
                  applySingleTagPath(v);
                  setContextMenu(null);
                }}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                  color: "var(--text)",
                  background: "var(--bg-elev)",
                  cursor: "pointer",
                }}
              >
                {svgTagGroupMenuFilteredOptions.length === 0 ? (
                  <option value="" disabled>
                    No matches
                  </option>
                ) : (
                  svgTagGroupMenuFilteredOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.group} / {opt.label}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}
          {contextMenu.mode === "element" && !selectedBBox && (
            <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--text-muted)" }}>
              No selection
            </div>
          )}
        </div>
      )}

      {polyHandleMenu && (
        <div
          style={{
            position: "fixed",
            left: polyHandleMenu.x,
            top: polyHandleMenu.y,
            zIndex: 210,
            background: "var(--bg-elev)",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 10,
            boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
            padding: "6px 0",
            minWidth: 160,
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          <div
            style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#f04438" }}
            onClick={() => {
              removeVertex(polyHandleMenu.id, polyHandleMenu.index);
              setSelectedSegment(null);
              setPolyHandleMenu(null);
            }}
          >
            Delete Segment
          </div>
          <div
            style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
            onClick={() => setPolyHandleMenu(null)}
          >
            Cancel
          </div>
        </div>
      )}

      {contextMenu && isEmptyMenu && contextSvgMenuOpen && (
        <div
          style={{
            position: "fixed",
            left: subMenuLeft,
            top: subMenuTop,
            zIndex: 210,
            width: subMenuSize.w,
            maxHeight: subMenuSize.h,
            background: "var(--bg-elev)",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 8,
            boxShadow: "0 8px 18px rgba(0,0,0,0.16)",
            overflow: "hidden",
          }}
          onMouseEnter={() => {
            if (contextSvgMenuTimerRef.current) {
              clearTimeout(contextSvgMenuTimerRef.current);
              contextSvgMenuTimerRef.current = null;
            }
            setContextSvgMenuOpen(true);
          }}
          onMouseLeave={() => {
            contextSvgMenuTimerRef.current = setTimeout(() => {
              setContextSvgMenuOpen(false);
            }, 120);
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          <div style={{ padding: "7px 9px", borderBottom: "1px solid var(--border)", background: "var(--bg-elev)" }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: "var(--text)" }}>SVG Files</div>
                <div
                  style={{ marginTop: 6, position: "relative" }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
              <input
                ref={svgMenuInputRef}
                value={contextImportQuery}
                onChange={(e) => setContextImportQuery(e.target.value)}
                placeholder="Search..."
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%",
                  border: "1px solid var(--border)",
                  background: "var(--bg-elev)",
                  borderRadius: 8,
                  padding: "7px 26px 7px 8px",
                  color: "var(--text)",
                  outline: "none",
                  fontSize: 12,
                  boxSizing: "border-box",
                }}
              />
                  {contextImportQuery && (
                    <button
                      type="button"
                      title="Clear"
                      onClick={() => setContextImportQuery("")}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 18,
                    height: 18,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    cursor: "pointer",
                    lineHeight: 1,
                    color: "var(--text)",
                    padding: 0,
                    fontSize: 11,
                  }}
                >
                      X
                    </button>
                  )}
                </div>
          </div>

          <div
            className="vizi-scroll"
            style={{
              maxHeight: subMenuSize.h - 86,
              overflow: "auto",
              padding: "8px 10px 10px",
            }}
          >
            {contextGrouped.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No matches.</div>
            ) : (
              contextGrouped.map((group) => (
                <div key={group.folder} style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 800, padding: "2px 2px" }}>
                    {group.folder}
                  </div>
                  {group.files.map((f) => (
                    <button
                      key={f.key}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onPickSvg(f.key, lastContextPoint);
                        setContextMenu(null);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid var(--border)",
                        background: "var(--bg-elev)",
                        cursor: "pointer",
                        color: "var(--text)",
                        fontSize: 12,
                      }}
                      title={f.key}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showMainDrawer && (
        <div
          style={{
            position: "fixed",
            top: leftDrawerTopPx,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 220,
            pointerEvents: mainDrawerAppendFromLeft ? "none" : "auto",
          }}
        >
          <div
            ref={mainDrawerRef}
            style={{
              position: "absolute",
              right: isMobileViewport || mainDrawerFullscreen || mainDrawerAppendFromLeft ? undefined : 0,
              left: isMobileViewport
                ? (mainDrawerAppendFromLeft ? mainDrawerAppendLeftPx : 0)
                : mainDrawerFullscreen
                ? (mainDrawerAppendFromLeft ? mainDrawerAppendLeftPx : 0)
                : mainDrawerAppendFromLeft
                ? mainDrawerAppendLeftPx
                : undefined,
              top: 0,
              height: "100%",
              width: isMobileViewport
                ? (mainDrawerAppendFromLeft ? `calc(100% - ${mainDrawerAppendLeftPx}px)` : "100%")
                : mainDrawerFullscreen
                ? (mainDrawerAppendFromLeft
                    ? `calc(100% - ${mainDrawerAppendLeftPx}px)`
                    : "100%")
                : `${Math.round(activeMainDrawerWidth)}px`,
              background: "var(--bg-soft)",
              boxShadow:
                isMobileViewport || mainDrawerFullscreen || mainDrawerAppendFromLeft
                  ? "none"
                  : "-24px 0 48px rgba(0,0,0,0.34), -8px 0 20px rgba(0,0,0,0.18)",
              display: "flex",
              flexDirection: "column",
              borderLeft: isMobileViewport || mainDrawerFullscreen || mainDrawerAppendFromLeft ? "none" : "1px solid var(--border)",
              borderRight: mainDrawerAppendFromLeft ? "1px solid var(--border)" : "none",
              color: "var(--text)",
              fontSize: drawerTextSize,
              lineHeight: drawerLineHeight,
              transform: "translate(0px, 0px)",
              animation: mainDrawerAppendFromLeft
                ? "drawer-slide-in-left 220ms ease-out"
                : "drawer-slide-in-right 220ms ease-out",
              pointerEvents: "auto",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                padding: rightDrawerHeaderPadding,
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-elev)",
                gap: 12,
                flexWrap: "wrap",
                cursor: "default",
              }}
            >
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 800, fontSize: drawerTitleSize, letterSpacing: "0.02em" }}>
                  {drawerView === "ai"
                    ? "AI"
                    : drawerView === "reports"
                    ? "Report Designer"
                    : drawerView === "code-gen-pro"
                    ? "Code Gen"
                    : drawerView === "plc"
                    ? "PLC"
                    : drawerView === "server"
                    ? "Server Diagnostics"
                    : drawerView === "logger"
                    ? "Logger"
                    : drawerView === "database"
                    ? (isLiveMode && databaseDataOnlyMode
                        ? (normalizeTableDisplayName(activeDatabaseTable) || "Data")
                        : "Database")
                    : drawerView === "automation"
                    ? "Automation"
                    : drawerView === "tags"
                    ? "Tags"
                  : drawerView === "logs"
                  ? "Logs"
                  : drawerView === "diagnostics"
                  ? "Diagnostics"
                  : drawerView === "opc"
                  ? "OPC Configuration"
                  : "Help"}
                </div>
                {isOpcDrawerView ? (
                  <div
                    title={opcLiveLastError || `Live values: ${opcLiveValueCount} \u2022 Last update: ${opcLiveUpdatedAtLabel}`}
                    style={{
                      border: `1px solid ${
                        opcLiveLastError
                          ? "#f04438"
                          : opcLiveIsStale
                          ? "#f59e0b"
                          : "color-mix(in srgb, #22c55e 60%, var(--border) 40%)"
                      }`,
                      background: opcLiveLastError
                        ? "color-mix(in srgb, #f04438 14%, var(--bg-elev) 86%)"
                        : opcLiveIsStale
                        ? "color-mix(in srgb, #f59e0b 14%, var(--bg-elev) 86%)"
                        : "color-mix(in srgb, #22c55e 14%, var(--bg-elev) 86%)",
                      color: "var(--text)",
                      borderRadius: 999,
                      padding: "4px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      whiteSpace: "nowrap",
                      width: "fit-content",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: opcLiveLastError ? "#f04438" : opcLiveIsStale ? "#f59e0b" : "#22c55e",
                        boxShadow: opcLiveLastError
                          ? "0 0 0 2px rgba(240,68,56,0.22)"
                          : opcLiveIsStale
                          ? "0 0 0 2px rgba(245,158,11,0.2)"
                          : "0 0 0 2px rgba(34,197,94,0.2)",
                      }}
                    />
                    <span>OPC {opcLiveValueCount}</span>
                    <span style={{ color: "var(--text-muted)" }}>{opcLiveUpdatedAtLabel}</span>
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setMainDrawerFullscreen((v) => !v)}
                  style={drawerHeaderButtonStyle}
                  title={mainDrawerFullscreen ? "Windowed" : "Fullscreen"}
                  aria-label={mainDrawerFullscreen ? "Windowed" : "Fullscreen"}
                >
                  {mainDrawerFullscreen ? "\u2750" : "\u26F6"}
                </button>
                <button
                  onClick={() => setShowMainDrawer(false)}
                  style={drawerHeaderButtonStyle}
                  title="Close"
                  aria-label="Close"
                >
                  {"\u2715"}
                </button>
              </div>
            </div>
            <div style={{ flex: "1 1 auto", overflow: "hidden" }}>
              <Suspense
                fallback={
                  <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--text-muted)" }}>
                    Loading...
                  </div>
                }
              >
              {drawerView === "automation" ? (
                <div style={drawerContentShellStyle}>
                  <AutomationRulesPanel embedded activeProjectId={activeProjectId} />
                </div>
              ) : drawerView === "tags" ? (
                <div style={drawerContentShellStyle}>
                  <OpcConfig embedded mode="tags" />
                </div>
              ) : drawerView === "logs" ? (
                <div style={drawerContentShellStyle}>
                  <OpcConfig embedded mode="logs" onDrawerViewChange={setDrawerView} />
                </div>
              ) : drawerView === "diagnostics" ? (
                <div style={drawerContentShellStyle}>
                  <OpcConfig embedded mode="diagnostics" onDrawerViewChange={setDrawerView} />
                </div>
              ) : drawerView === "opc" ? (
                <div style={drawerContentShellStyle}>
                  <OpcConfig embedded onDrawerViewChange={setDrawerView} />
                </div>
              ) : drawerView === "help" ? (
                <div style={{ height: "100%", overflow: "hidden", padding: drawerContentPadding, boxSizing: "border-box" }}>
                  <HelpPanel inline onClose={() => setShowMainDrawer(false)} />
                </div>
              ) : drawerView === "plc" || drawerView === "code-gen-pro" ? (
                <div
                  style={{
                    ...drawerContentShellStyle,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                  }}
                >
                  <PlcAnalyzer
                    plcItems={projectPlcs}
                    onChange={setProjectPlcs}
                    initialTab={drawerView === "code-gen-pro" ? "code-gen-pro" : "overview"}
                    svgCatalog={aiSvgCatalog}
                    onInsertSvg={handleAiInsertSvg}
                  />
                </div>
              ) : drawerView === "server" ? (
                <div style={drawerContentShellStyle}>
                  <ServerDiagnosticsPanel embedded />
                </div>
              ) : drawerView === "logger" ? (
                <div style={drawerContentShellStyle}>
                  <LoggerPanel embedded canEdit={canEditArea("server")} />
                </div>
              ) : drawerView === "database" ? (
                <div
                  style={{
                    ...drawerContentShellStyle,
                    padding: drawerContentPadding,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                    }}
                  >
                    {!databaseDataOnlyMode ? (
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          padding: "2px 2px 10px",
                          borderBottom: "1px solid var(--border)",
                          marginBottom: 10,
                        }}
                      >
                        <button
                          data-preserve-style="true"
                          onClick={() => setDatabaseTab("designer")}
                          style={drawerTabButtonStyle(databaseTab === "designer")}
                          title="Designer"
                        >
                          Designer
                        </button>
                        <button
                          data-preserve-style="true"
                          onClick={() => setDatabaseTab("data")}
                          style={drawerTabButtonStyle(databaseTab === "data")}
                          title="Data"
                        >
                          Data
                        </button>
                        <button
                          data-preserve-style="true"
                          onClick={() => setDatabaseTab("dataset")}
                          style={drawerTabButtonStyle(databaseTab === "dataset")}
                          title="Dataset"
                        >
                          Dataset
                        </button>
                        <button
                          data-preserve-style="true"
                          onClick={() => setDatabaseTab("config")}
                          style={drawerTabButtonStyle(databaseTab === "config")}
                          title="Config"
                        >
                          Config
                        </button>
                        <button
                          data-preserve-style="true"
                          onClick={() => setDatabaseTab("diagnostics")}
                          style={drawerTabButtonStyle(databaseTab === "diagnostics")}
                          title="Diagnostics"
                        >
                          Diagnostics
                        </button>
                      </div>
                    ) : null}
                    <div
                      style={{
                        flex: "1 1 auto",
                        minHeight: 0,
                        overflow: "hidden",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        background: useLightLiveDataSurface ? "#ffffff" : "var(--bg-elev)",
                      }}
                    >
                      {databaseDataOnlyMode ? (
                        <DataBrowser
                          embedded
                          embeddedPath={databaseEmbeddedPath}
                          embeddedRouteId={databaseEmbeddedRouteId}
                          embeddedRouteName={databaseEmbeddedRouteName}
                          hideTableSelector={isLiveMode && databaseDataOnlyMode}
                          hideListFieldControls={isLiveMode && databaseDataOnlyMode}
                          useWhiteBackground={useLightLiveDataSurface}
                        />
                      ) : databaseTab === "dataset" ? (
                        <DatasetBuilder embedded />
                      ) : databaseTab === "designer" ? (
                        <SqlDesigner embedded selectedTableHint={activeDatabaseTable} />
                      ) : databaseTab === "diagnostics" ? (
                        <DatabaseConfigPanel embedded mode="diagnostics" />
                      ) : databaseTab === "config" ? (
                        <DatabaseConfigPanel embedded mode="config" />
                      ) : (
                        <DataBrowser
                          embedded
                          embeddedPath={databaseEmbeddedPath}
                          embeddedRouteId={databaseEmbeddedRouteId}
                          embeddedRouteName={databaseEmbeddedRouteName}
                          hideTableSelector={isLiveMode && databaseDataOnlyMode}
                          hideListFieldControls={isLiveMode && databaseDataOnlyMode}
                          useWhiteBackground={useLightLiveDataSurface}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ) : drawerView === "reports" ? (
                <div style={drawerContentShellStyle}>
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      overflow: "hidden",
                      background: "var(--bg-elev)",
                    }}
                  >
                    <iframe
                      key={`drawer-reports-${theme}`}
                      title="Report Designer"
                      src={`/report-designer?theme=${theme}`}
                      style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                    />
                  </div>
                </div>
              ) : (
                <div style={drawerContentShellStyle}>
                  <iframe
                    key={`drawer-ai-${theme}`}
                    title="AI"
                    src={`/ai?theme=${theme}`}
                    style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                  />
                </div>
              )}
              </Suspense>
            </div>
            {!mainDrawerFullscreen ? (
              <div
                onMouseDown={(e) => beginDrawerResize("main", e, mainDrawerFullscreen)}
                title="Resize"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 10,
                  cursor: "ew-resize",
                  borderRight: "1px solid var(--border)",
                  background: "color-mix(in srgb, var(--bg-elev) 90%, transparent)",
                  zIndex: 2,
                }}
              />
            ) : null}
          </div>
        </div>
      )}

      {activeDrawerResize ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999,
            cursor: "ew-resize",
            background: "transparent",
          }}
        />
      ) : null}

      {showUserDrawer && (
        <div
          style={{
            position: "fixed",
            top: TOP_BAR_H + (isLiveMode ? liveAlarmBarOffset : 0),
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 220,
          }}
        >
          <div
            ref={userDrawerRef}
            style={{
              position: "absolute",
              right: 0,
              left: isMobileViewport || userDrawerFullscreen ? 0 : undefined,
              top: 0,
              height: "100%",
              width: isMobileViewport || userDrawerFullscreen ? "100%" : `${Math.round(drawerSizes.user.w)}px`,
              background: "var(--bg-soft)",
              boxShadow: isMobileViewport ? "none" : "-24px 0 48px rgba(0,0,0,0.34), -8px 0 20px rgba(0,0,0,0.18)",
              display: "flex",
              flexDirection: "column",
              borderLeft: isMobileViewport || userDrawerFullscreen ? "none" : "1px solid var(--border)",
              color: "var(--text)",
              fontSize: drawerTextSize,
              lineHeight: drawerLineHeight,
              transform: "translate(0px, 0px)",
              animation: "drawer-slide-in-right 220ms ease-out",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: rightDrawerHeaderPadding,
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-elev)",
                gap: 10,
                cursor: "default",
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 800, fontSize: drawerTitleSize, letterSpacing: "0.02em" }}>
                  User Settings
                </div>
                <div style={{ fontSize: drawerSubtitleSize, color: "var(--text-muted)" }}>
                  Profile and session preferences
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => {
                    if (!userSettingsEditing) {
                      beginUserSettingsEdit();
                      return;
                    }
                    void saveUserSettingsEdit();
                  }}
                  style={
                    userSettingsDirty
                      ? {
                          ...drawerHeaderButtonStyle,
                          border: "1px solid #f59e0b",
                          color: "#f59e0b",
                          background:
                            "linear-gradient(180deg, color-mix(in srgb, #f59e0b 18%, var(--bg-elev) 82%) 0%, color-mix(in srgb, #f59e0b 10%, var(--bg-elev) 90%) 100%)",
                        }
                      : drawerHeaderButtonStyle
                  }
                  title={userSettingsEditing ? "Save" : "Edit"}
                  aria-label={userSettingsEditing ? "Save" : "Edit"}
                >
                  {userSettingsEditing ? "\u2713" : "\u270E"}
                </button>
                <button
                  onClick={() => setUserDrawerFullscreen((v) => !v)}
                  style={drawerHeaderButtonStyle}
                  title={userDrawerFullscreen ? "Windowed" : "Fullscreen"}
                  aria-label={userDrawerFullscreen ? "Windowed" : "Fullscreen"}
                >
                  {userDrawerFullscreen ? "\u2750" : "\u26F6"}
                </button>
                <button
                  onClick={closeUserDrawerSafely}
                  style={drawerHeaderButtonStyle}
                  title="Close"
                  aria-label="Close"
                >
                  {"\u2715"}
                </button>
              </div>
            </div>
            <div
              style={{
                flex: "1 1 auto",
                overflow: "auto",
                padding: rightDrawerBodyPadding,
                scrollbarGutter: "stable both-edges",
                display: "grid",
                gap: 12,
                alignContent: "start",
              }}
            >
              <div
                style={{
                  width: "min(100%, 920px)",
                  margin: "0 auto",
                  boxSizing: "border-box",
                  background:
                    "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 94%, white 6%) 0%, color-mix(in srgb, var(--bg-elev) 90%, black 10%) 100%)",
                  border: "1px solid color-mix(in srgb, var(--border) 82%, white 18%)",
                  borderRadius: 12,
                  padding: 14,
                  display: "grid",
                  gap: 10,
                  boxShadow: "0 8px 16px rgba(0,0,0,0.16)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>Profile</div>
                  <div
                    style={{
                      fontSize: 9,
                      color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      padding: "2px 7px",
                      background: "color-mix(in srgb, var(--bg-elev) 94%, transparent)",
                    }}
                  >
                    Public info
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
                  <label style={{ display: "grid", gap: 3, minWidth: 0, fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>
                    Display Name
                    <input
                      value={profileDraft.display_name}
                      onChange={(e) =>
                        setProfileDraft((p) => ({ ...p, display_name: e.target.value }))
                      }
                      readOnly={!userSettingsEditing}
                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                        borderRadius: 8,
                        padding: "5px 8px",
                        minHeight: 30,
                        fontSize: 11,
                        background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                        opacity: userSettingsEditing ? 1 : 0.82,
                        cursor: userSettingsEditing ? "text" : "default",
                      }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 3, minWidth: 0, fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>
                    Username
                    <input
                      value={profileDraft.username}
                      onChange={(e) => setProfileDraft((p) => ({ ...p, username: e.target.value }))}
                      readOnly={!userSettingsEditing}
                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                        borderRadius: 8,
                        padding: "5px 8px",
                        minHeight: 30,
                        fontSize: 11,
                        background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                        opacity: userSettingsEditing ? 1 : 0.82,
                        cursor: userSettingsEditing ? "text" : "default",
                      }}
                    />
                  </label>
                </div>
                <label style={{ display: "grid", gap: 3, fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>
                  Avatar URL
                  <input
                    value={profileDraft.avatar_url}
                    onChange={(e) =>
                      setProfileDraft((p) => ({ ...p, avatar_url: e.target.value }))
                    }
                    readOnly={!userSettingsEditing}
                    placeholder="https://..."
                    style={{
                      border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                      borderRadius: 8,
                      padding: "5px 8px",
                      minHeight: 30,
                      fontSize: 11,
                      background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                      color: "var(--text)",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                      opacity: userSettingsEditing ? 1 : 0.82,
                      cursor: userSettingsEditing ? "text" : "default",
                    }}
                  />
                </label>
              </div>

              <div
                style={{
                  width: "min(100%, 920px)",
                  margin: "0 auto",
                  boxSizing: "border-box",
                  background:
                    "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 94%, white 6%) 0%, color-mix(in srgb, var(--bg-elev) 90%, black 10%) 100%)",
                  border: "1px solid color-mix(in srgb, var(--border) 82%, white 18%)",
                  borderRadius: 12,
                  padding: 14,
                  display: "grid",
                  gap: 10,
                  boxShadow: "0 8px 16px rgba(0,0,0,0.16)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>Security</div>
                  <div
                    style={{
                      fontSize: 9,
                      color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      padding: "2px 7px",
                      background: "color-mix(in srgb, var(--bg-elev) 94%, transparent)",
                    }}
                  >
                    Update password
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
                  <label style={{ display: "grid", gap: 3, minWidth: 0, fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>
                    Current Password
                    <input
                      type="password"
                      value={passwordDraft.current}
                      onChange={(e) => setPasswordDraft((p) => ({ ...p, current: e.target.value }))}
                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                        borderRadius: 8,
                        padding: "5px 8px",
                        minHeight: 30,
                        fontSize: 11,
                        background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                      }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 3, minWidth: 0, fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>
                    New Password
                    <input
                      type="password"
                      value={passwordDraft.next}
                      onChange={(e) => setPasswordDraft((p) => ({ ...p, next: e.target.value }))}
                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                        borderRadius: 8,
                        padding: "5px 8px",
                        minHeight: 30,
                        fontSize: 11,
                        background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                      }}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => void saveSecurityPassword()}
                    style={{
                      border: securitySettingsDirty ? "1px solid #f59e0b" : "1px solid #2f6dff",
                      background: securitySettingsDirty
                        ? "linear-gradient(180deg, #f7b547 0%, #f59e0b 100%)"
                        : "linear-gradient(180deg, #3a7bff 0%, #2b6cff 100%)",
                      color: "white",
                      borderRadius: 8,
                      padding: "6px 12px",
                      minHeight: 30,
                      minWidth: 102,
                      fontSize: 11,
                      cursor: "pointer",
                      fontWeight: 700,
                      boxShadow: securitySettingsDirty
                        ? "0 8px 16px rgba(245,158,11,0.32)"
                        : "0 8px 16px rgba(43,108,255,0.32)",
                    }}
                  >
                    Update
                  </button>
                </div>
              </div>

            </div>
            <div
              style={{
                borderTop: "1px solid var(--border)",
                background: "var(--bg-elev)",
                padding: "12px 14px",
                display: "grid",
                gap: 10,
              }}
            >
              <div
                style={{
                  width: "min(100%, 920px)",
                  margin: "0 auto",
                  boxSizing: "border-box",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background:
                    "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 94%, #3b0b0b 6%) 0%, color-mix(in srgb, var(--bg-elev) 90%, black 10%) 100%)",
                  border: "1px solid color-mix(in srgb, #f2c6c2 75%, #f04438 25%)",
                  borderRadius: 12,
                  padding: "11px 14px",
                  boxShadow: "0 8px 16px rgba(0,0,0,0.16)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: "#b42318" }}>Sign out</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>End your current session.</div>
                </div>
                <button
                  onClick={async () => {
                    if (activeProjectId && hasUnsavedProjectChangesFromRefs()) {
                      await saveProjectToDb({ silent: false, teamMerge: true, keepalive: true });
                    }
                    await logout();
                  }}
                  style={{
                    border: "1px solid #f04438",
                    background: "linear-gradient(180deg, #f75b51 0%, #f04438 100%)",
                    color: "white",
                    borderRadius: 8,
                    padding: "6px 10px",
                    minHeight: 30,
                    minWidth: 86,
                    fontSize: 10,
                    cursor: "pointer",
                    fontWeight: 700,
                    boxShadow: "0 8px 16px rgba(240,68,56,0.35)",
                  }}
                >
                  Logout
                </button>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                {userSettingsEditing ? (
                  <button
                    onClick={cancelUserSettingsEdit}
                    style={{
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      minHeight: 32,
                      minWidth: 92,
                      fontSize: 11,
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
            {!userDrawerFullscreen ? (
              <div
                onMouseDown={(e) => beginDrawerResize("user", e, userDrawerFullscreen)}
                title="Resize"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 10,
                  cursor: "ew-resize",
                  borderRight: "1px solid var(--border)",
                  background: "color-mix(in srgb, var(--bg-elev) 90%, transparent)",
                  zIndex: 2,
                }}
              />
            ) : null}
          </div>
        </div>
      )}

      {showSecurityDrawer && (
        <div
          style={{
            position: "fixed",
            top: TOP_BAR_H + (isLiveMode ? liveAlarmBarOffset : 0),
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 220,
          }}
        >
          <div
            ref={securityDrawerRef}
            style={{
              position: "absolute",
              right: 0,
              left: isMobileViewport || userDrawerFullscreen ? 0 : undefined,
              top: 0,
              height: "100%",
              width: isMobileViewport || userDrawerFullscreen ? "100%" : `${Math.round(drawerSizes.user.w)}px`,
              background: "var(--bg-soft)",
              boxShadow: isMobileViewport ? "none" : "-24px 0 48px rgba(0,0,0,0.34), -8px 0 20px rgba(0,0,0,0.18)",
              display: "flex",
              flexDirection: "column",
              borderLeft: isMobileViewport || userDrawerFullscreen ? "none" : "1px solid var(--border)",
              color: "var(--text)",
              fontSize: drawerTextSize,
              lineHeight: drawerLineHeight,
              transform: "translate(0px, 0px)",
              animation: "drawer-slide-in-right 220ms ease-out",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: rightDrawerHeaderPadding,
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-elev)",
                gap: 10,
                cursor: "default",
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 800, fontSize: drawerTitleSize, letterSpacing: "0.02em" }}>
                  Security
                </div>
                <div style={{ fontSize: drawerSubtitleSize, color: "var(--text-muted)" }}>
                  Users, roles and access areas
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setUserDrawerFullscreen((v) => !v)}
                  style={drawerHeaderButtonStyle}
                  title={userDrawerFullscreen ? "Windowed" : "Fullscreen"}
                  aria-label={userDrawerFullscreen ? "Windowed" : "Fullscreen"}
                >
                  {userDrawerFullscreen ? "\u2750" : "\u26F6"}
                </button>
                <button
                  onClick={closeSecurityDrawerSafely}
                  style={drawerHeaderButtonStyle}
                  title="Close"
                  aria-label="Close"
                >
                  ?
                </button>
              </div>
            </div>
            <div
              style={{
                flex: "1 1 auto",
                overflow: "auto",
                padding: rightDrawerBodyPadding,
                scrollbarGutter: "stable both-edges",
                display: "grid",
                gap: 12,
              }}
            >
              <div
                style={{
                  background:
                    "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 94%, white 6%) 0%, color-mix(in srgb, var(--bg-elev) 90%, black 10%) 100%)",
                  border: "1px solid color-mix(in srgb, var(--border) 82%, white 18%)",
                  borderRadius: 12,
                  padding: 14,
                  display: "grid",
                  gap: 10,
                  alignContent: "start",
                  boxShadow: "0 8px 16px rgba(0,0,0,0.16)",
                }}
              >
                <Suspense fallback={<div style={{ color: "var(--text-muted)" }}>Loading...</div>}>
                  <SecurityManager canManage={canManageSecurity} currentUserId={user?.id} />
                </Suspense>
              </div>
            </div>
            {!userDrawerFullscreen ? (
              <div
                onMouseDown={(e) => beginDrawerResize("user", e, userDrawerFullscreen)}
                title="Resize"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 10,
                  cursor: "ew-resize",
                  borderRight: "1px solid var(--border)",
                  background: "color-mix(in srgb, var(--bg-elev) 90%, transparent)",
                  zIndex: 2,
                }}
              />
            ) : null}
          </div>
        </div>
      )}

      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 56,
          zIndex: 95,
          background: "var(--topbar-grad)",
          borderBottom: "1px solid var(--topbar-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "0 16px",
          backdropFilter: "blur(8px)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 auto" }}>
          <img
            src={appLogo}
            alt="Mesora"
            style={{ height: 34, width: "auto", display: "block", flex: "0 0 auto" }}
          />
          <div style={{ width: 1, height: 18, background: "var(--border)", flex: "0 0 auto" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "1 1 auto" }}>
            {showLiveIdentityChips ? (
              <>
                <button
                  onClick={() => {
                    if (showProjectDrawer) {
                      closeProjectDrawerSafely();
                      return;
                    }
                    if (!canLeaveSaveDrawerState()) return;
                    setShowProjectDrawer(true);
                  }}
                  aria-label={showProjectDrawer ? "Hide Project Drawer" : "Show Project Drawer"}
                  title={
                    projectIdentityReady
                      ? `${activeProject?.name || projectName || "No project selected"} (${showProjectDrawer ? "Hide" : "Show"} Project Drawer)`
                      : "Loading project..."
                  }
                  style={{
                    maxWidth: 200,
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    cursor: "pointer",
                    outline: "none",
                    flex: "0 0 auto",
                  }}
                >
                  {projectIdentityReady ? activeProject?.name || projectName || "None" : "Loading..."}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isLiveMode) return;
                    const list = Array.isArray(screens) ? screens : [];
                    if (list.length <= 1) return;
                    const currentId = String(activeScreenId || "");
                    const currentIndex = list.findIndex((s) => String(s?.id || "") === currentId);
                    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
                    const next = list[(safeIndex + 1) % list.length];
                    if (next?.id) switchToScreen(String(next.id));
                  }}
                  disabled={isLiveMode || !projectIdentityReady || (Array.isArray(screens) ? screens.length : 0) <= 1}
                  title={
                    projectIdentityReady
                      ? (isLiveMode
                          ? activeMenuLabel || "No menu selected"
                          : `${activeScreen?.name || screenName || "No screen selected"} (click to cycle screens)`)
                      : "Loading screen..."
                  }
                  style={{
                    maxWidth: 160,
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    flex: "0 0 auto",
                    cursor:
                      !isLiveMode && (Array.isArray(screens) ? screens.length : 0) > 1
                        ? "pointer"
                        : "default",
                    opacity: !isLiveMode || (Array.isArray(screens) ? screens.length : 0) > 1 ? 1 : 0.92,
                    outline: "none",
                  }}
                >
                  {projectIdentityReady
                    ? (isLiveMode ? activeMenuLabel || "None" : activeScreen?.name || screenName || "None")
                    : "Loading..."}
                </button>
              </>
            ) : null}
            {!isLiveMode && !showZoom ? (
              <>
                <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
                <div
                  className="vizi-scroll"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                    flex: "1 1 auto",
                    overflowX: "auto",
                    overflowY: "hidden",
                    whiteSpace: "nowrap",
                    scrollbarWidth: "thin",
                    paddingBottom: 1,
                  }}
                >
              <button
                title="Save Project"
                style={topMenuIconButtonStyle}
                onClick={() => saveProjectToDb({ silent: false, teamMerge: true })}
                disabled={String(projectStatus || "").trim().toLowerCase() === "saving..."}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path d="M5 4h11l3 3v13H5V4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M8 4v6h8V4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M9 20v-6h6v6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              </button>
              <button title="Export SVG" style={topMenuIconButtonStyle} onClick={exportSVG}>
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 3v10m0 0l-4-4m4 4l4-4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <button
                title="Import SVG"
                onClick={openImportDock}
                style={topMenuIconButtonStyle}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M14 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M12 11v6M9 14h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <button title="Add Widget" style={topMenuIconButtonStyle} onClick={openWidgetDock}>
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="12" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="2" />
                  <rect x="10" y="8" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
                  <rect x="17" y="5" width="4" height="15" rx="1" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Move"
                style={topMenuModeButtonStyle(tool === "select")}
                onClick={() => {
                  setTool("select");
                  setDrawing(null);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path d="M4 3l7 18 2-7 7-2L4 3z" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Polyline"
                style={topMenuModeButtonStyle(tool === "polyline")}
                onClick={() => {
                  setTool("polyline");
                  setDrawing(null);
                  exitEditMode();
                  setSelectedOverlayIds([]);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 6h5l4 6h5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="5" cy="6" r="1.5" fill="currentColor" />
                  <circle cx="10" cy="6" r="1.5" fill="currentColor" />
                  <circle cx="14" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="19" cy="12" r="1.5" fill="currentColor" />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Rectangle"
                style={topMenuModeButtonStyle(tool === "rect")}
                onClick={() => {
                  setTool("rect");
                  setDrawing(null);
                  exitEditMode();
                  setSelectedOverlayIds([]);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="6" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Circle"
                style={topMenuModeButtonStyle(tool === "circle")}
                onClick={() => {
                  setTool("circle");
                  setDrawing(null);
                  exitEditMode();
                  setSelectedOverlayIds([]);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Text"
                style={topMenuModeButtonStyle(tool === "text")}
                onClick={() => {
                  setTool("text");
                  setDrawing(null);
                  exitEditMode();
                  setSelectedOverlayIds([]);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 6V4h16v2M9 20h6M12 4v16"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <div style={{ width: 1, height: 18, background: "var(--border)", opacity: 0.7, margin: "0 2px" }} />
              <button
                className="top-menu-btn"
                title="Show TagPaths"
                style={topMenuModeButtonStyle(!!showTagPaths)}
                onClick={() => setShowTagPaths((v) => !v)}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 12l8-8h6l2 2v6l-8 8-8-8z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <circle cx="16" cy="8" r="1.5" fill="currentColor" />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Show Grid"
                style={topMenuModeButtonStyle(!!showGrid)}
                onClick={() => setShowGrid((v) => !v)}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Show Ruler"
                style={topMenuModeButtonStyle(!!showRulers)}
                onClick={() => setShowRulers((v) => !v)}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path d="M4 4h16v4H4zM4 10h16v10H4z" stroke="currentColor" strokeWidth="2" />
                  <path d="M8 4v4M12 4v4M16 4v4" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
        <TopBarRightControls
          compact={winW > 0 && winW <= 1320}
          isLiveMode={isLiveMode}
          canViewArea={canViewArea}
          drawerView={drawerView}
          showMainDrawer={showMainDrawer}
          showSecurityDrawer={showSecurityDrawer}
          theme={theme}
          setTheme={setTheme}
          setShowMainDrawer={setShowMainDrawer}
          setShowUserDrawer={setShowUserDrawer}
          setShowSecurityDrawer={setShowSecurityDrawer}
          openDrawer={openDrawer}
          openUserDrawer={openUserDrawerSafely}
          openSecurityDrawer={openSecurityDrawerSafely}
          user={user}
          avatarLabel={avatarLabel}
        />
      </div>

      <LiveAlarmBar
        visible={isLiveMode}
        hasLiveAlarms={hasLiveAlarms}
        theme={theme}
        top={TOP_BAR_H}
        left={0}
        right={0}
        height={LIVE_ALARM_BAR_H}
        alarmCount={liveActiveAlarmsWithOccurred.length}
        liveAlarmMarqueeViewportRef={liveAlarmMarqueeViewportRef}
        liveAlarmMarqueeTrackRef={liveAlarmMarqueeTrackRef}
        liveAlarmMarqueeDurationSec={liveAlarmMarqueeDurationSec}
        liveAlarmMarqueeItems={liveAlarmMarqueeItems}
        onOpenAlarms={() => {
          setShowLiveMenuDrawer(true);
          openDrawer("database", { forceDatabaseDataTab: true, databasePath: alarmDatabasePath });
        }}
      />

      {isLiveMode && isLiveMobile ? (
        <div
          style={{
            position: "fixed",
            left: projectDrawerInsetPx + 8,
            right: 8,
            bottom: 8,
            height: liveBottomCarouselHeightPx,
            zIndex: 210,
            border: "1px solid color-mix(in srgb, var(--border) 88%, #2b6cff 12%)",
            borderRadius: 12,
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 92%, #0b2448 8%) 0%, color-mix(in srgb, var(--bg) 90%, #040d1f 10%) 100%)",
            boxShadow: "0 10px 24px rgba(0,0,0,0.24)",
            overflow: "hidden",
            display: "flex",
            alignItems: "stretch",
          }}
        >
          <div
            className="vizi-scroll"
            style={{
              flex: "1 1 auto",
              overflowX: "auto",
              overflowY: "hidden",
              display: "flex",
              gap: 8,
              padding: "8px",
              scrollSnapType: "x mandatory",
            }}
          >
            {liveMenuMobileItems.length ? (
              liveMenuMobileItems.map(({ groupName, item }, idx) => {
                const itemType = String(item?.type || "").trim().toLowerCase();
                const isData = itemType === "data";
                const isReports = itemType === "reports";
                const screen = itemType === "screen" ? screens.find((s) => s.id === item.screenId) || null : null;
                const label = resolveLiveMenuItemLabel(item, screen);
                const active = isData
                  ? showMainDrawer &&
                    drawerView === "database" &&
                    (String(item?.dataTable || "").trim()
                      ? String(item?.dataTable || "").trim() === activeDatabaseTable
                      : true)
                  : isReports
                  ? showMainDrawer && drawerView === "reports"
                  : String(item?.screenId || "") === String(activeScreenId);
                const locked = !canOpenLiveMenuItem(item);
                const initials = label
                  .split(/\s+/)
                  .filter(Boolean)
                  .join(" ")
                  .replace(/[^a-zA-Z0-9]/g, "")
                  .slice(0, 3)
                  .toUpperCase() || (isData ? "DAT" : isReports ? "RPT" : "SCR");
                return (
                  <button
                    key={`live-menu-mobile-item-${item?.id || idx}`}
                    onClick={locked ? undefined : () => activateLiveMenuItem(item)}
                    disabled={locked}
                    data-preserve-style="true"
                    title={locked ? `${label} (Locked)` : label}
                    style={{
                      flex: "0 0 auto",
                      width: 172,
                      minHeight: "100%",
                      borderRadius: 10,
                      border: `1px solid ${
                        locked
                          ? "color-mix(in srgb, #f59e0b 55%, var(--border) 45%)"
                          : active
                          ? "var(--selected-border)"
                          : "var(--border)"
                      }`,
                      background: active ? "var(--selected-bg)" : "color-mix(in srgb, var(--bg) 88%, #0b1729 12%)",
                      color: active ? "var(--selected-text)" : "var(--text)",
                      boxShadow: active ? "var(--selected-shadow)" : "none",
                      padding: "8px 10px",
                      cursor: locked ? "not-allowed" : "pointer",
                      opacity: locked ? 0.78 : 1,
                      display: "grid",
                      alignContent: "space-between",
                      gap: 4,
                      textAlign: "left",
                      scrollSnapAlign: "start",
                    }}
                  >
                    <span style={{ fontSize: 9, fontWeight: 800, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      {groupName}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {label}
                    </span>
                    <span
                      style={{
                        width: 28,
                        height: 18,
                        borderRadius: 8,
                        border: "1px solid color-mix(in srgb, #ffffff 46%, var(--border) 54%)",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 9,
                        fontWeight: 900,
                        background: "rgba(255,255,255,0.12)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {initials}
                    </span>
                  </button>
                );
              })
            ) : (
              <div
                style={{
                  minWidth: "100%",
                  color: "var(--text-muted)",
                  fontSize: 12,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                No live menu items configured.
              </div>
            )}
          </div>
          <div
            style={{
              width: 58,
              borderLeft: "1px solid color-mix(in srgb, var(--border) 82%, #2b6cff 18%)",
              background: "color-mix(in srgb, var(--bg-elev) 88%, #0f274d 12%)",
              display: "grid",
              alignContent: "center",
              justifyItems: "center",
              gap: 8,
              padding: "8px 6px",
              boxSizing: "border-box",
            }}
          >
            <button
              title={showZoom ? "Hide zoom controls" : "Show zoom controls"}
              onClick={() => setShowZoom((v) => !v)}
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                border: "1px solid color-mix(in srgb, var(--border) 70%, #2b6cff 30%)",
                background: showZoom ? "var(--selected-bg)" : "var(--bg-elev)",
                color: showZoom ? "var(--selected-text)" : "var(--text)",
                boxShadow: showZoom ? "var(--selected-shadow)" : "0 6px 16px rgba(0,0,0,0.16)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                <path d="M20 20l-4.2-4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <button
              title="Team Chat"
              onClick={() => setShowTeamChat((v) => !v)}
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                border: "1px solid color-mix(in srgb, var(--border) 70%, #2b6cff 30%)",
                background: showTeamChat ? "var(--selected-bg)" : "var(--bg-elev)",
                color: showTeamChat ? "var(--selected-text)" : "var(--text)",
                boxShadow: showTeamChat ? "var(--selected-shadow)" : "0 6px 16px rgba(0,0,0,0.16)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                padding: 0,
                position: "relative",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 7.25C4 5.73 5.23 4.5 6.75 4.5h10.5C18.77 4.5 20 5.73 20 7.25v6.5c0 1.52-1.23 2.75-2.75 2.75h-5.4l-3.55 2.95c-.62.51-1.55.07-1.55-.74V16.5h0c-1.52 0-2.75-1.23-2.75-2.75v-6.5Z"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {teamChatUnreadCount > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    minWidth: 14,
                    height: 14,
                    borderRadius: 999,
                    background: "#ef4444",
                    color: "#fff",
                    fontSize: 8,
                    fontWeight: 800,
                    display: "grid",
                    placeItems: "center",
                    border: "1px solid rgba(255,255,255,0.6)",
                    padding: "0 3px",
                    boxSizing: "border-box",
                  }}
                >
                  {teamChatUnreadCount > 99 ? "99+" : String(teamChatUnreadCount)}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      ) : null}

      {isLiveMode && showLiveMenuDrawer ? (
        <div
          ref={liveMenuDrawerRef}
          style={{
            position: "fixed",
            left: isLiveMode ? 0 : projectDrawerInsetPx,
            top: leftDrawerTopPx,
            bottom: 0,
            width: liveMenuRailWidthPx,
            zIndex: 210,
            border: "1px solid var(--border)",
            borderRight: "none",
            borderRadius: 0,
            background: "var(--bg-elev)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
            backdropFilter: "blur(8px)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            transition: "width 280ms cubic-bezier(0.22, 1, 0.36, 1), left 280ms cubic-bezier(0.22, 1, 0.36, 1)",
            animation: "drawer-slide-in-left 280ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {null}
          <div
            style={{
              padding: liveMenuIsExpanded ? (isLiveMobile ? "6px 8px" : "4px 8px") : "2px 8px",
              minHeight: liveMenuIsExpanded ? (isLiveMobile ? 38 : 32) : (isLiveMobile ? 32 : 28),
              display: "flex",
              alignItems: "center",
              justifyContent: liveMenuIsExpanded ? "space-between" : "center",
              gap: 4,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>Menu</div>
            <button
              onClick={() => setShowLiveMenuDrawer(false)}
              title="Close menu"
              aria-label="Close menu"
              style={{
                width: isLiveMobile ? 32 : 28,
                height: isLiveMobile ? 32 : 28,
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "var(--text)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                flex: "0 0 auto",
                padding: 0,
                fontSize: 16,
                fontWeight: 800,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
          <div
	            style={{
	              flex: "1 1 auto",
	              minHeight: 0,
	              overflow: "auto",
	              padding: liveMenuIsExpanded ? (isLiveMobile ? "8px 10px 10px" : "6px 8px 8px") : "0 6px 6px",
	              display: "grid",
	              alignContent: "start",
	              gap: 6,
            }}
            className="vizi-scroll"
          >
            {leftMenuGroupsVisible.some((group) => Array.isArray(group.items) && group.items.length) ? (
              leftMenuGroupsVisible.map((group, groupIndex) => {
                const groupCollapsed = collapsedLiveGroupIds.includes(String(group.id || ""));
                const groupItemCount = Array.isArray(group.items) ? group.items.length : 0;
                return (
                <div
                  key={`live-menu-group-${group.id}`}
                  style={{
                    display: "grid",
                    gap: 6,
                    paddingTop: groupIndex === 0 ? 0 : 6,
                    borderTop:
                      groupIndex === 0
                        ? "none"
                        : "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
                  }}
                >
                  {liveMenuIsExpanded ? (
	                    <button
	                      onClick={() => toggleLiveMenuGroupCollapse(group.id)}
	                      title={`Toggle group ${group.name || "Group"}`}
	                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 84%, #2b6cff 16%)",
                        background: groupCollapsed
                          ? "color-mix(in srgb, var(--bg-elev) 90%, #0f274d 10%)"
                          : "color-mix(in srgb, var(--bg-elev) 82%, #2b6cff 18%)",
                        padding: "6px 8px",
                        borderRadius: 10,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        cursor: "pointer",
                        outline: "none",
                        boxShadow: "none",
                        transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span
                          style={{
                            width: 16,
                            height: 16,
                            display: "grid",
                            placeItems: "center",
                            flex: "0 0 auto",
                            color: "color-mix(in srgb, var(--text-muted) 82%, #b7cbff 18%)",
                            transform: groupCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                            transition: "transform 150ms ease",
                          }}
                          aria-hidden="true"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 900,
                            letterSpacing: "0.08em",
                            color: "color-mix(in srgb, var(--text-muted) 88%, #9fb8ff 12%)",
                            textTransform: "uppercase",
                            textAlign: "left",
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {group.name || "Group"}
                        </span>
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          color: "var(--text-muted)",
                          border: "1px solid color-mix(in srgb, var(--border) 84%, #2b6cff 16%)",
                          borderRadius: 999,
                          padding: "1px 6px",
                          lineHeight: 1.4,
                          flex: "0 0 auto",
                        }}
                      >
                        {groupItemCount}
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleLiveMenuGroupCollapse(group.id)}
                      title={`${groupCollapsed ? "Expand" : "Collapse"} group ${group.name || "Group"}`}
                      style={{
                        display: "grid",
                        justifyItems: "center",
                        gap: 3,
                        padding: "4px 0 3px",
                        width: "100%",
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          display: "grid",
                          placeItems: "center",
                          color: "color-mix(in srgb, var(--text-muted) 82%, #b7cbff 18%)",
                          transform: groupCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                          transition: "transform 150ms ease",
                        }}
                        aria-hidden="true"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 900,
                          letterSpacing: "0.08em",
                          color: "color-mix(in srgb, var(--text-muted) 62%, #c6d7ff 38%)",
                          textTransform: "uppercase",
                          lineHeight: 1,
                        }}
                      >
                        {String(group.name || "Group")
                          .split(/\s+/)
                          .filter(Boolean)
                          .join(" ")
                          .replace(/[^a-zA-Z0-9]/g, "")
                          .slice(0, 3)
                          .toUpperCase() || "GRP"}
                      </span>
                    </button>
                  )}
                  {!groupCollapsed && group.items.map((item) => {
                    const itemType = String(item?.type || "").trim().toLowerCase();
                    const isData = itemType === "data";
                    const isReports = itemType === "reports";
                    const isScreen = itemType === "screen";
                    const screen = isScreen ? screens.find((s) => s.id === item.screenId) || null : null;
                    const label = resolveLiveMenuItemLabel(item, screen);
                    const active = isData
                      ? showMainDrawer &&
                        drawerView === "database" &&
                        (String(item.dataTable || "").trim()
                          ? String(item.dataTable || "").trim() === activeDatabaseTable
                          : true)
                      : isReports
                      ? showMainDrawer && drawerView === "reports"
                      : String(item.screenId || "") === String(activeScreenId);
                    const locked = !canOpenLiveMenuItem(item);
                    const initials = label
                      .split(/\s+/)
                      .filter(Boolean)
                      .join(" ")
                      .replace(/[^a-zA-Z0-9]/g, "")
                      .slice(0, 3)
                      .toUpperCase() || (isData ? "DAT" : isReports ? "RPT" : "SCR");
                    const collapsedHover = !liveMenuIsExpanded && liveMenuHoverItemId === String(item.id || "");
                    const showJobFormBtn = liveMenuIsExpanded && isScreen;
                    return (
                      <div
                        key={`live-menu-item-${item.id}`}
                        style={{
                          width: liveMenuIsExpanded ? "100%" : 36,
                          justifySelf: liveMenuIsExpanded ? "stretch" : "center",
                          display: "grid",
                          gridTemplateColumns: showJobFormBtn ? "1fr auto" : "1fr",
                          alignItems: "center",
                          gap: showJobFormBtn ? 6 : 0,
                        }}
                      >
                        <button
                          onClick={locked ? undefined : () => activateLiveMenuItem(item)}
                          onDoubleClick={(e) => {
                            if (liveMenuIsExpanded || !isScreen) return;
                            e.preventDefault();
                            e.stopPropagation();
                            if (locked) return;
                            openDockedJobForm(item);
                          }}
                          onMouseEnter={() => {
                            if (!liveMenuIsExpanded) setLiveMenuHoverItemId(String(item.id || ""));
                          }}
                          onMouseLeave={() => {
                            if (!liveMenuIsExpanded) setLiveMenuHoverItemId("");
                          }}
                          disabled={locked}
                          data-preserve-style="true"
                          style={{
                            width: "100%",
                            minHeight: liveMenuIsExpanded
                              ? (isLiveMobile ? 34 : 26)
                              : 30,
                            borderRadius: liveMenuIsExpanded ? 10 : 10,
                            border: `1px solid ${
                              locked
                                ? "color-mix(in srgb, #f59e0b 55%, var(--border) 45%)"
                                : active
                                ? "var(--selected-border)"
                                : "var(--border)"
                            }`,
                            ...(liveMenuIsExpanded
                              ? null
                              : {
                                  borderColor: active
                                    ? "var(--selected-border)"
                                    : collapsedHover
                                    ? "color-mix(in srgb, var(--border) 72%, #2b6cff 28%)"
                                    : "transparent",
                                }),
                            background: active
                              ? isData
                                ? "var(--bg-elev)"
                                : "var(--selected-bg)"
                              : liveMenuIsExpanded
                              ? "color-mix(in srgb, var(--bg) 88%, #0b1729 12%)"
                              : collapsedHover
                              ? "color-mix(in srgb, var(--bg-elev) 90%, #0f274d 10%)"
                              : "transparent",
                            color: active
                              ? isData
                                ? "var(--selected-border)"
                                : "var(--selected-text)"
                              : "var(--text)",
                            boxShadow: active
                              ? isData
                                ? "none"
                                : "var(--selected-shadow)"
                              : collapsedHover
                              ? "0 6px 14px rgba(2,8,23,0.18)"
                              : "none",
                            padding: liveMenuIsExpanded
                              ? (isLiveMobile ? "6px 9px" : "3px 7px")
                              : 0,
                            fontSize: 11,
                            fontWeight: active ? 800 : 700,
                            textAlign: "left",
                            cursor: locked ? "not-allowed" : "pointer",
                            opacity: locked ? 0.78 : 1,
                            display: "grid",
                            gridTemplateColumns: liveMenuIsExpanded ? "22px 1fr auto" : "1fr",
                            alignItems: "center",
                            gap: liveMenuIsExpanded ? 8 : 0,
                            position: "relative",
                            transition: "background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease",
                          }}
                          title={
                            locked
                              ? `${label} (Locked)`
                              : !liveMenuIsExpanded && isScreen
                              ? `${label} (Double-click for Job Form)`
                              : label
                          }
                        >
                        <span
                          style={{
                            width: liveMenuIsExpanded ? 22 : 30,
                            height: liveMenuIsExpanded ? 18 : 22,
                            borderRadius: liveMenuIsExpanded ? 7 : 8,
                            border: liveMenuIsExpanded
                              ? active
                                ? "1px solid color-mix(in srgb, #ffffff 56%, var(--selected-border) 44%)"
                                : "1px solid var(--border)"
                              : "none",
                            background: active
                              ? "rgba(255,255,255,0.2)"
                              : liveMenuIsExpanded
                              ? "color-mix(in srgb, var(--bg-elev) 85%, transparent)"
                              : "transparent",
                            color: "inherit",
                            display: "grid",
                            placeItems: "center",
                            fontSize: liveMenuIsExpanded ? 9 : 11,
                            fontWeight: 900,
                            margin: liveMenuIsExpanded ? 0 : "0 auto",
                            letterSpacing: liveMenuIsExpanded ? "0.02em" : "0.08em",
                          }}
                        >
                          {initials}
                        </span>
                        {!liveMenuIsExpanded && liveMenuHoverItemId === String(item.id || "") ? (
                          <span
                            aria-hidden="true"
                            style={{
                              position: "absolute",
                              left: "calc(100% + 8px)",
                              top: "50%",
                              transform: "translateY(-50%)",
                              zIndex: 20,
                              border: "1px solid color-mix(in srgb, var(--border) 80%, #2b6cff 20%)",
                              background: "color-mix(in srgb, var(--bg-elev) 92%, #0b1c36 8%)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "4px 8px",
                              fontSize: 11,
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                              boxShadow: "0 8px 18px rgba(2,8,23,0.24)",
                              pointerEvents: "none",
                            }}
                          >
                            {locked ? `${label} (Locked)` : label}
                          </span>
                        ) : null}
                        {liveMenuIsExpanded ? (
                          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {label}
                          </span>
                        ) : null}
                        {liveMenuIsExpanded && locked ? (
                          <span style={{ display: "inline-grid", placeItems: "center", width: 14, height: 14, marginLeft: 4 }} aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path d="M7 10V7a5 5 0 1110 0v3" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
                              <rect x="5" y="10" width="14" height="10" rx="2" stroke="#f59e0b" strokeWidth="2" />
                            </svg>
                          </span>
                        ) : null}
                        </button>
                        {showJobFormBtn ? (
                          <button
                            type="button"
                            data-preserve-style="true"
                            onClick={(e) => {
                              e.stopPropagation();
                              openDockedJobForm(item);
                            }}
                            disabled={locked || !canViewDataPages}
                            title="Open Jobs"
                            aria-label="Open Jobs"
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 8,
                              border: "1px solid color-mix(in srgb, var(--border) 78%, #2b6cff 22%)",
                              background: "color-mix(in srgb, var(--bg-elev) 88%, #0f274d 12%)",
                              color: "var(--text)",
                              display: "grid",
                              placeItems: "center",
                              cursor: locked || !canViewDataPages ? "not-allowed" : "pointer",
                              opacity: locked || !canViewDataPages ? 0.6 : 0.95,
                              padding: 0,
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path d="M13 7l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-muted)", padding: 6, textAlign: liveMenuIsExpanded ? "left" : "center" }}>
                No live menu items configured.
              </div>
            )}
          </div>
        </div>
      ) : null}

      {showProjectDrawer && (
        <div
          ref={projectDrawerRef}
          style={{
            position: "fixed",
            top: leftDrawerTopPx,
            left: isMobileViewport ? 0 : projectDrawerLeftOffsetPx,
            right: isMobileViewport || projectDrawerFullscreen ? 0 : undefined,
            bottom: 0,
            width: isMobileViewport || projectDrawerFullscreen ? "auto" : `${Math.round(drawerSizes.project.w)}px`,
            zIndex: 220,
            borderRight: isMobileViewport || projectDrawerFullscreen ? "none" : "1px solid var(--border)",
            background: "var(--bg-soft)",
            boxShadow: isMobileViewport ? "none" : "24px 0 48px rgba(0,0,0,0.34), 8px 0 20px rgba(0,0,0,0.18)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontSize: drawerTextSize,
            lineHeight: drawerLineHeight,
            transform: "translate(0px, 0px)",
            animation: "drawer-slide-in-left 220ms ease-out",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-elev)",
              cursor: "default",
            }}
          >
            <div style={{ display: "grid" }}>
              <div style={{ fontSize: drawerTitleSize, fontWeight: 800, letterSpacing: "0.02em", color: "var(--text)" }}>
                Project
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {canEditProject && projectDrawerTab === "project" ? (
                <button
                  onClick={() => {
                    if (!projectNameEditing) {
                      beginProjectDrawerEdit();
                      return;
                    }
                    void saveProjectNameFromSettings();
                  }}
                  style={
                    projectSettingsDirty
                      ? {
                          ...drawerHeaderButtonStyle,
                          border: "1px solid #f59e0b",
                          color: "#f59e0b",
                          background:
                            "linear-gradient(180deg, color-mix(in srgb, #f59e0b 18%, var(--bg-elev) 82%) 0%, color-mix(in srgb, #f59e0b 10%, var(--bg-elev) 90%) 100%)",
                        }
                      : drawerHeaderButtonStyle
                  }
                  title={projectNameEditing ? "Save Project Changes" : "Edit Project"}
                  aria-label={projectNameEditing ? "Save Project Changes" : "Edit Project"}
                >
                  {projectNameEditing ? "\u2713" : "\u270E"}
                </button>
              ) : null}
              <button
                onClick={() => setProjectDrawerFullscreen((v) => !v)}
                style={drawerHeaderButtonStyle}
                title="Toggle Project Drawer Fullscreen"
                aria-label={projectDrawerFullscreen ? "Windowed" : "Fullscreen"}
              >
                {projectDrawerFullscreen ? "\u2750" : "\u26F6"}
              </button>
                <button
                onClick={closeProjectDrawerSafely}
                style={drawerHeaderButtonStyle}
                title="Close Project Drawer"
                aria-label="Close"
              >
                {"\u2715"}
              </button>
            </div>
          </div>
          {!projectDrawerFullscreen ? (
            <div
              onMouseDown={(e) => beginDrawerResize("project", e, projectDrawerFullscreen)}
              title="Resize"
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: 10,
                cursor: "ew-resize",
                borderLeft: "1px solid var(--border)",
                background: "color-mix(in srgb, var(--bg-elev) 90%, transparent)",
                zIndex: 2,
              }}
            />
          ) : null}

          <div
            style={
              projectDrawerTab === "screens" || projectDrawerTab === "menu"
                ? { ...projectDrawerContentStyle, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }
                : projectDrawerContentStyle
            }
            className="vizi-scroll"
          >
            <div style={{ ...projectDrawerCardStyle, padding: 6, flex: "0 0 auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${projectDrawerTabs.length}, minmax(0, 1fr))`,
                  gap: 6,
                }}
              >
                {projectDrawerTabs.map((tab) => (
                  <button
                    key={`project-tab-${tab.key}`}
                    onClick={() => setProjectDrawerTab(tab.key)}
                    style={drawerTabButtonStyle(projectDrawerTab === tab.key)}
                    title={tab.title}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {projectDrawerTab === "project" ? (
              <>
            <div style={{ ...projectDrawerCardStyle, gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>Current Project</div>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Project Name</span>
                {projectNameEditing ? (
                  <input
                    value={projectNameDraft}
                    onChange={(e) => setProjectNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveProjectNameFromSettings();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelProjectNameEditFromSettings();
                      }
                    }}
                    style={{
                      border: "1px solid var(--border)",
                      background: "#ffffff",
                      color: "#111827",
                      borderRadius: 8,
                      padding: "8px 10px",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      borderRadius: 8,
                      padding: "8px 10px",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {projectIdentityReady ? projectName || "Untitled" : "Loading..."}
                  </div>
                )}
              </label>
              <div style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Mode</span>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: projectModeDraft === "design" ? "var(--text)" : "var(--text-muted)",
                      fontWeight: 700,
                    }}
                  >
                    Design
                  </span>
                  <button
                    data-preserve-style="true"
                    onClick={() =>
                      projectNameEditing
                        ? setProjectModeDraft((current) =>
                            normalizeProjectMode(current) === "live" ? "design" : "live"
                          )
                        : undefined
                    }
                    disabled={!projectNameEditing}
                    title={projectNameEditing ? "Toggle Project Mode" : "Click Edit to change mode"}
                    aria-label="Toggle Project Mode"
                    style={{
                      width: 44,
                      height: 24,
                      borderRadius: 999,
                      border: `1px solid ${projectModeDraft === "live" ? "#2b6cff" : "var(--border)"}`,
                      background: projectModeDraft === "live" ? "#2b6cff" : "var(--bg-soft)",
                      padding: 2,
                      cursor: projectNameEditing ? "pointer" : "not-allowed",
                      position: "relative",
                      transition: "all 140ms ease",
                      opacity: projectNameEditing ? 1 : 0.55,
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 2,
                        left: projectModeDraft === "live" ? 22 : 2,
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "#ffffff",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.24)",
                        transition: "left 140ms ease",
                      }}
                    />
                  </button>
                  <span
                    style={{
                      fontSize: 11,
                      color: projectModeDraft === "live" ? "var(--text)" : "var(--text-muted)",
                      fontWeight: 700,
                    }}
                  >
                    Live
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginTop: 4 }}>
                SVG Background Colors
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "56px minmax(0, 1fr) 88px", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text)" }}>Light</div>
                <input
                  type="color"
                  value={projectCanvasBackgroundDraft.light || DEFAULT_CANVAS_BG_LIGHT}
                  onChange={(e) => {
                    const next = normalizeProjectCanvasBackground({
                      ...projectCanvasBackgroundDraft,
                      light: e.target.value,
                    });
                    setProjectCanvasBackgroundDraft(next);
                  }}
                  disabled={!projectNameEditing}
                  style={{ width: "100%", height: 32, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}
                  title="Canvas background color in light mode"
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", textAlign: "right" }}>
                  {String(projectCanvasBackgroundDraft.light || "").toUpperCase()}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "56px minmax(0, 1fr) 88px", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text)" }}>Dark</div>
                <input
                  type="color"
                  value={projectCanvasBackgroundDraft.dark || DEFAULT_CANVAS_BG_DARK}
                  onChange={(e) => {
                    const next = normalizeProjectCanvasBackground({
                      ...projectCanvasBackgroundDraft,
                      dark: e.target.value,
                    });
                    setProjectCanvasBackgroundDraft(next);
                  }}
                  disabled={!projectNameEditing}
                  style={{ width: "100%", height: 32, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}
                  title="Canvas background color in dark mode"
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", textAlign: "right" }}>
                  {String(projectCanvasBackgroundDraft.dark || "").toUpperCase()}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => {
                    const next = normalizeProjectCanvasBackground(null);
                    setProjectCanvasBackgroundDraft(next);
                  }}
                  style={{
                    ...topMenuTextButtonStyle,
                    fontSize: 11,
                    padding: "6px 10px",
                    opacity: projectNameEditing ? 1 : 0.45,
                    cursor: projectNameEditing ? "pointer" : "not-allowed",
                  }}
                  title="Reset canvas background colors to defaults"
                  disabled={!projectNameEditing}
                >
                  Reset Defaults
                </button>
              </div>
              {activeProjectUpdatedAt ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {formatProjectTime(activeProjectUpdatedAt)}
                </div>
              ) : null}
            </div>
              </>
            ) : null}

            {projectDrawerTab === "screens" ? (
            <div style={{ display: "grid", gap: 8, minHeight: 0, flex: "1 1 auto" }}>
              <fieldset
                style={{ border: "none", margin: 0, padding: 0, minWidth: 0, display: "grid", gap: 8, minHeight: 0, height: "100%" }}
              >
              <div style={{ ...projectDrawerCardStyle, minHeight: 0, display: "flex", flexDirection: "column", flex: "1 1 auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>Canvas Screens</div>
                  <button
                    onClick={addScreen}
                    style={{
                      ...topMenuTextButtonStyle,
                      border: "1px solid #2b6cff",
                      background: "#2b6cff",
                      color: "#ffffff",
                      fontSize: 11,
                      padding: "6px 10px",
                      cursor: "pointer",
                      opacity: 1,
                    }}
                    title="Add Canvas Screen"
                  >
                    Add Screen
                  </button>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Screen changes save automatically.
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Choose the active design screen.
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Auto-zoom mode is configured per screen.
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    flex: "1 1 auto",
                    minHeight: 0,
                    overflow: "auto",
                    alignItems: "stretch",
                    justifyContent: "flex-start",
                  }}
                  className="vizi-scroll"
                >
                  {(screens || []).map((s) => {
                    const active = s.id === activeScreenId;
                    return (
                      <div
                        key={`screen-item-${s.id}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => switchToScreen(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            switchToScreen(s.id);
                          }
                        }}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          background: active
                            ? "color-mix(in srgb, var(--bg-elev) 88%, #2b6cff 12%)"
                            : "var(--bg)",
                          padding: "6px 8px",
                          display: "grid",
                          gap: 6,
                          cursor: "pointer",
                          outline: "none",
                          boxShadow: "none",
                        }}
                      >
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 8, alignItems: "center" }}>
                          <input
                            value={String(s.name || "")}
                            onClick={(e) => {
                              e.stopPropagation();
                              switchToScreen(s.id);
                            }}
                            onFocus={() => switchToScreen(s.id)}
                            onKeyDown={(e) => e.stopPropagation()}
                            onChange={(e) => renameScreenById(s.id, e.target.value)}
                            onBlur={() => {
                              if (String(s.name || "").trim()) return;
                              renameScreenById(s.id, "Screen");
                            }}
                            readOnly={false}
                            style={{
                              color: "var(--text)",
                              fontSize: 12,
                              fontWeight: active ? 800 : 600,
                              textAlign: "left",
                              padding: "4px 6px",
                              minWidth: 0,
                              border: "1px solid var(--border)",
                              borderRadius: 6,
                              background: "var(--bg-elev)",
                              outline: "none",
                              cursor: "text",
                            }}
                            title={s.name}
                          />
                          {active ? (
                            <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 800, flex: "0 0 auto" }}>Active</span>
                          ) : null}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteScreenById(s.id);
                            }}
                            disabled={screens.length <= 1}
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 6,
                              border: "1px solid #f04438",
                              background: screens.length > 1 ? "#f04438" : "rgba(244,68,56,0.45)",
                              color: "#fff",
                              cursor: screens.length > 1 ? "pointer" : "not-allowed",
                              opacity: screens.length > 1 ? 1 : 0.65,
                              padding: 0,
                              flex: "0 0 auto",
                            }}
                            title={`Delete ${s.name || "screen"}`}
                  >
                    {"\u2715"}
                  </button>
                </div>
                        <div style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr) 18px minmax(0,1fr)", gap: 6, alignItems: "center" }}>
                          <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}>W</span>
                          <input
                            type="number"
                            min={100}
                            max={10000}
                            step={10}
                            value={
                              Object.prototype.hasOwnProperty.call(screenSizeDrafts?.[String(s.id)] || {}, "w")
                                ? String(screenSizeDrafts[String(s.id)]?.w ?? "")
                                : String(Math.max(100, Math.round(Number(s?.vbW) || 1600)))
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              switchToScreen(s.id);
                            }}
                            onFocus={() => {
                              switchToScreen(s.id);
                              beginScreenSizeDraft(s.id, "w", s?.vbW);
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitScreenSizeDraft(s.id, "w");
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelScreenSizeDraft(s.id, "w");
                              }
                            }}
                            onChange={(e) => changeScreenSizeDraft(s.id, "w", e.target.value)}
                            onBlur={() => commitScreenSizeDraft(s.id, "w")}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 6,
                              padding: "3px 6px",
                              fontSize: 11,
                              fontWeight: 700,
                              minWidth: 0,
                            }}
                            title="Screen width"
                          />
                          <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}>H</span>
                          <input
                            type="number"
                            min={100}
                            max={10000}
                            step={10}
                            value={
                              Object.prototype.hasOwnProperty.call(screenSizeDrafts?.[String(s.id)] || {}, "h")
                                ? String(screenSizeDrafts[String(s.id)]?.h ?? "")
                                : String(Math.max(100, Math.round(Number(s?.vbH) || 900)))
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              switchToScreen(s.id);
                            }}
                            onFocus={() => {
                              switchToScreen(s.id);
                              beginScreenSizeDraft(s.id, "h", s?.vbH);
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitScreenSizeDraft(s.id, "h");
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelScreenSizeDraft(s.id, "h");
                              }
                            }}
                            onChange={(e) => changeScreenSizeDraft(s.id, "h", e.target.value)}
                            onBlur={() => commitScreenSizeDraft(s.id, "h")}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 6,
                              padding: "3px 6px",
                              fontSize: 11,
                              fontWeight: 700,
                              minWidth: 0,
                            }}
                            title="Screen height"
                          />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "62px minmax(0,1fr)", gap: 6, alignItems: "center" }}>
                          <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}>Auto Zoom</span>
                          <select
                            value={normalizeScreenAutoFitMode(s?.autoFitMode, "content")}
                            onClick={(e) => {
                              e.stopPropagation();
                              switchToScreen(s.id);
                            }}
                            onChange={(e) => {
                              e.stopPropagation();
                              switchToScreen(s.id);
                              updateScreenAutoFitModeById(s.id, e.target.value);
                            }}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 6,
                              padding: "4px 6px",
                              fontSize: 11,
                              fontWeight: 700,
                              minWidth: 0,
                            }}
                            title="Auto zoom behavior when this screen size or viewbox changes"
                          >
                            <option value="off">Off</option>
                            <option value="content">Fit Content</option>
                            <option value="contain">Fit Canvas</option>
                            <option value="height">Fit Height</option>
                          </select>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "62px minmax(0,1fr)", gap: 6, alignItems: "center" }}>
                          <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}>Route</span>
                          <select
                            value={String(s?.routeId || "")}
                            onClick={(e) => {
                              e.stopPropagation();
                              switchToScreen(s.id);
                            }}
                            onChange={(e) => {
                              e.stopPropagation();
                              switchToScreen(s.id);
                              updateScreenRouteIdById(s.id, e.target.value);
                            }}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 6,
                              padding: "4px 6px",
                              fontSize: 11,
                              fontWeight: 700,
                              minWidth: 0,
                            }}
                            title="Assign this screen to a route id"
                          >
                            <option value="">No Route</option>
                            {screenRouteOptions.map((route) => (
                              <option key={`screen-route-option-${route.value}`} value={route.value}>
                                {route.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 6, alignItems: "center" }}>
                          <select
                            defaultValue=""
                            onClick={(e) => {
                              e.stopPropagation();
                              switchToScreen(s.id);
                            }}
                            onChange={(e) => {
                              const next = String(e.target.value || "");
                              if (!next) return;
                              applyScreenSizePresetById(s.id, next);
                              e.target.value = "";
                            }}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 6,
                              padding: "4px 6px",
                              fontSize: 11,
                              fontWeight: 600,
                              minWidth: 0,
                            }}
                            title="Apply a common screen resolution"
                          >
                            <option value="">Apply preset...</option>
                            {SCREEN_SIZE_PRESETS.map((preset) => (
                              <option key={`preset-${preset.value}`} value={preset.value}>
                                {preset.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              switchToScreen(s.id);
                              matchScreenToViewportById(s.id);
                            }}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 6,
                              padding: "4px 8px",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                            title="Match this screen to current viewport size"
                          >
                            Match Viewport
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              </fieldset>
            </div>
            ) : null}

            {projectDrawerTab === "menu" ? (
            <div style={{ display: "grid", gap: 8, minHeight: 0, flex: "1 1 auto" }}>
              <fieldset
                style={{ border: "none", margin: 0, padding: 0, minWidth: 0, display: "grid", gap: 8, minHeight: 0, height: "100%" }}
              >
              <div style={{ ...projectDrawerCardStyle, minHeight: 0, display: "flex", flexDirection: "column", flex: "1 1 auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>Menu Config</div>
                  <button
                    onClick={addLiveMenuGroup}
                    style={{ ...topMenuTextButtonStyle, fontSize: 11, padding: "6px 10px" }}
                    title="Add Menu Group"
                  >
                    Add Group
                  </button>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Build grouped live menu entries from canvas screens, data tables, or reports.
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Menu changes save automatically.
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    flex: "1 1 auto",
                    minHeight: 0,
                    overflow: "auto",
                    alignContent: "start",
                    gridAutoRows: "max-content",
                  }}
                  className="vizi-scroll"
                >
                  {liveMenuGroupsForRender.map((group) => (
                    <div
                      key={`menu-group-${group.id}`}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 8,
                        display: "grid",
                        gap: 6,
                        background: "var(--bg)",
                        alignSelf: "start",
                      }}
                    >
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 6, alignItems: "center" }}>
                        <input
                          value={group.name}
                          onChange={(e) => renameLiveMenuGroup(group.id, e.target.value)}
                          placeholder="Group name"
                          style={{
                            border: "1px solid var(--border)",
                            background: "var(--bg-elev)",
                            color: "var(--text)",
                            borderRadius: 7,
                            padding: "6px 8px",
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        />
                        <button
                          onClick={() => addLiveMenuItem(group.id, "screen")}
                          style={{ ...topMenuTextButtonStyle, fontSize: 11, padding: "6px 8px" }}
                          title="Add Canvas Screen Item"
                        >
                          + Screen
                        </button>
                        <button
                          onClick={() => addLiveMenuItem(group.id, "data")}
                          style={{ ...topMenuTextButtonStyle, fontSize: 11, padding: "6px 8px" }}
                          title="Add Data Screen Item"
                        >
                          + Data
                        </button>
                        <button
                          onClick={() => addLiveMenuItem(group.id, "reports")}
                          style={{ ...topMenuTextButtonStyle, fontSize: 11, padding: "6px 8px" }}
                          title="Add Reports Item"
                        >
                          + Reports
                        </button>
                      </div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {group.items.map((item, index) => (
                          <div
                            key={`menu-item-${item.id}`}
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 7,
                              padding: 6,
                              display: "grid",
                              gridTemplateColumns: "82px 1fr 1fr auto auto auto auto",
                              gap: 6,
                              alignItems: "center",
                              background: "var(--bg-elev)",
                            }}
                          >
                            <select
                              value={item.type}
                              onChange={(e) => updateLiveMenuItem(group.id, item.id, { type: e.target.value })}
                              style={{
                                border: "1px solid var(--border)",
                                background: "var(--bg)",
                                color: "var(--text)",
                                borderRadius: 6,
                                padding: "5px 6px",
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            >
                              <option value="screen">Canvas</option>
                              <option value="data">Data</option>
                              <option value="reports">Reports</option>
                            </select>
                            {item.type === "data" ? (
                              <select
                                value={String(item.dataTable || "").trim()}
                                onChange={(e) => updateLiveMenuItem(group.id, item.id, { dataTable: e.target.value })}
                                style={{
                                  border: "1px solid var(--border)",
                                  background: "var(--bg)",
                                  color: "var(--text)",
                                  borderRadius: 6,
                                  padding: "5px 6px",
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              >
                                {databaseTablesForMenu.length ? (
                                  databaseTablesForMenu.map((table) => (
                                    <option key={`data-table-option-${table}`} value={table}>
                                      {table}
                                    </option>
                                  ))
                                ) : (
                                  <option value="">No tables</option>
                                )}
                              </select>
                            ) : item.type === "reports" ? (
                              <div
                                style={{
                                  border: "1px solid var(--border)",
                                  background: "var(--bg)",
                                  color: "var(--text-muted)",
                                  borderRadius: 6,
                                  padding: "5px 6px",
                                  fontSize: 11,
                                  fontWeight: 700,
                                }}
                                title="Opens Reports drawer"
                              >
                                Reports Page
                              </div>
                            ) : (
                              <select
                                value={item.screenId || ""}
                                onChange={(e) => updateLiveMenuItem(group.id, item.id, { screenId: e.target.value })}
                                style={{
                                  border: "1px solid var(--border)",
                                  background: "var(--bg)",
                                  color: "var(--text)",
                                  borderRadius: 6,
                                  padding: "5px 6px",
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              >
                                {screens.map((screen) => (
                                  <option key={`menu-screen-option-${screen.id}`} value={screen.id}>
                                    {screen.name || "Screen"}
                                  </option>
                                ))}
                              </select>
                            )}
                            <input
                              value={item.label || ""}
                              onChange={(e) => updateLiveMenuItem(group.id, item.id, { label: e.target.value })}
                              placeholder="Label (optional)"
                              style={{
                                border: "1px solid var(--border)",
                                background: "var(--bg)",
                                color: "var(--text)",
                                borderRadius: 6,
                                padding: "5px 6px",
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            />
                            <button
                              onClick={() =>
                                updateLiveMenuItem(group.id, item.id, {
                                  restricted: !Boolean(item?.restricted),
                                })
                              }
                              style={{
                                width: 24,
                                height: 22,
                                borderRadius: 6,
                                border: `1px solid ${
                                  item?.restricted
                                    ? "color-mix(in srgb, #f59e0b 64%, var(--border) 36%)"
                                    : "var(--border)"
                                }`,
                                background: item?.restricted
                                  ? "color-mix(in srgb, #f59e0b 12%, var(--bg))"
                                  : "var(--bg)",
                                color: item?.restricted ? "#f59e0b" : "var(--text-muted)",
                                cursor: "pointer",
                                padding: 0,
                                display: "grid",
                                placeItems: "center",
                              }}
                              title={item?.restricted ? "Unlock item" : "Lock item by role"}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M7 10V7a5 5 0 1110 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                              </svg>
                            </button>
                            <button
                              onClick={() => moveLiveMenuItem(group.id, item.id, -1)}
                              disabled={index === 0}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 6,
                                border: "1px solid var(--border)",
                                background: "var(--bg)",
                                cursor: index === 0 ? "not-allowed" : "pointer",
                                opacity: index === 0 ? 0.45 : 1,
                                padding: 0,
                              }}
                              title="Move up"
                            >
                              {"\u2191"}
                            </button>
                            <button
                              onClick={() => moveLiveMenuItem(group.id, item.id, 1)}
                              disabled={index >= group.items.length - 1}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 6,
                                border: "1px solid var(--border)",
                                background: "var(--bg)",
                                cursor: index >= group.items.length - 1 ? "not-allowed" : "pointer",
                                opacity: index >= group.items.length - 1 ? 0.45 : 1,
                                padding: 0,
                              }}
                              title="Move down"
                            >
                              {"\u2193"}
                            </button>
                            <button
                              onClick={() => deleteLiveMenuItem(group.id, item.id)}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 6,
                                border: "1px solid #f04438",
                                background: "#f04438",
                                color: "#fff",
                                padding: 0,
                              }}
                              title="Delete item"
                            >
                              {"\u2715"}
                            </button>
                            {item?.restricted ? (
                              <div
                                style={{
                                  gridColumn: "1 / -1",
                                  border: "1px solid color-mix(in srgb, #f59e0b 34%, var(--border) 66%)",
                                  borderRadius: 6,
                                  padding: "6px 8px",
                                  display: "grid",
                                  gap: 6,
                                  background: "color-mix(in srgb, #f59e0b 6%, var(--bg))",
                                }}
                              >
                                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>
                                  Allowed Roles
                                </div>
                                {securityRolesForMenu.length ? (
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                    {securityRolesForMenu.map((role) => {
                                      const checked = normalizeRoleIdList(item?.allowedRoleIds).includes(role.id);
                                      return (
                                        <label
                                          key={`menu-item-role-${item.id}-${role.id}`}
                                          style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 5,
                                            fontSize: 11,
                                            color: "var(--text)",
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(e) => {
                                              const next = normalizeRoleIdList(item?.allowedRoleIds);
                                              const updated = e.target.checked
                                                ? Array.from(new Set([...next, role.id]))
                                                : next.filter((id) => id !== role.id);
                                              updateLiveMenuItem(group.id, item.id, { allowedRoleIds: updated });
                                            }}
                                          />
                                          {role.name}
                                        </label>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                                    No roles loaded. Open Security to create roles first.
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                        <button
                          onClick={() => deleteLiveMenuGroup(group.id)}
                          style={{
                            ...topMenuTextButtonStyle,
                            fontSize: 11,
                            padding: "6px 10px",
                            minHeight: 30,
                            border: "1px solid #f04438",
                            background: "#f04438",
                            color: "#fff",
                          }}
                          title="Delete Group"
                        >
                          Delete Group
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              </fieldset>
            </div>
            ) : null}
          </div>
          {(!!projectStatus || !!lastProjectSaveLabel) && (
            <div
              style={{
                borderTop: "1px solid var(--border)",
                padding: "10px 12px",
                display: "grid",
                gap: 4,
              }}
            >
              {!!projectStatus ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{projectStatus}</div>
              ) : null}
              {!!lastProjectSaveLabel ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {lastProjectSaveKind === "auto" ? "Last autosave" : "Last save"}: {lastProjectSaveLabel}
                </div>
              ) : null}
            </div>
          )}
          {showProjectDrawer && projectDrawerTab === "project" && canEditProject ? (
            <div
              style={{
                borderTop: "1px solid var(--border)",
                padding: "10px 10px 12px",
                background: "var(--bg-soft)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={cancelProjectNameEditFromSettings}
                  disabled={!projectNameEditing}
                  style={{
                    ...topMenuTextButtonStyle,
                    fontSize: 12,
                    padding: "8px 10px",
                    opacity: projectNameEditing ? 1 : 0.45,
                    cursor: projectNameEditing ? "pointer" : "not-allowed",
                  }}
                  title="Cancel Project Changes"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {showDesktopTaskbar ? (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            height: TASKBAR_H,
            zIndex: 240,
            borderTop: "1px solid color-mix(in srgb, var(--border) 86%, #111827 14%)",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 94%, #0f172a 6%) 0%, color-mix(in srgb, var(--bg) 90%, #020617 10%) 100%)",
            boxShadow: "0 -8px 24px rgba(0,0,0,0.22)",
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            alignItems: "center",
            gap: 12,
            padding: "0 10px",
            boxSizing: "border-box",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            ref={taskbarMenuBtnRef}
            type="button"
            onClick={() => {
              if (isLiveMode) {
                setShowLiveMenuDrawer((v) => !v);
                return;
              }
              if (showProjectDrawer) {
                closeProjectDrawerSafely();
                return;
              }
              if (!canLeaveSaveDrawerState()) return;
              setShowProjectDrawer(true);
            }}
            style={{
              height: 36,
              width: 44,
              borderRadius: 9,
              border: "1px solid var(--border)",
              background:
                ((isLiveMode && showLiveMenuDrawer) || (!isLiveMode && showProjectDrawer))
                  ? "var(--selected-bg)"
                  : "var(--bg-elev)",
              color:
                ((isLiveMode && showLiveMenuDrawer) || (!isLiveMode && showProjectDrawer))
                  ? "var(--selected-text)"
                  : "var(--text)",
              fontSize: 13,
              fontWeight: 800,
              padding: 0,
              cursor: "pointer",
              boxShadow:
                ((isLiveMode && showLiveMenuDrawer) || (!isLiveMode && showProjectDrawer))
                  ? "var(--selected-shadow)"
                  : "none",
              display: "grid",
              placeItems: "center",
            }}
            title="Open left menu"
            aria-label="Open left menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
          <div
            className="vizi-scroll"
            style={{
              minWidth: 0,
              overflowX: "auto",
              overflowY: "hidden",
              paddingBottom: 1,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "max-content",
                maxWidth: "100%",
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                padding: "6px 8px",
                border: "1px solid color-mix(in srgb, var(--border) 90%, #1f2937 10%)",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--bg-elev) 97%, #0b1220 3%)",
              }}
            >
              {taskbarScreenGroups.map((group, groupIndex) => {
                const groupTint = [
                  "#3b82f6",
                  "#14b8a6",
                  "#f59e0b",
                  "#22c55e",
                  "#f43f5e",
                  "#06b6d4",
                ][groupIndex % 6];
                return (
                <div
                  key={`taskbar-group-${group.groupName}-${groupIndex}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 8px",
                    borderRadius: 9,
                    background: `color-mix(in srgb, var(--bg) 93%, ${groupTint} 7%)`,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                      lineHeight: 1,
                      maxWidth: 120,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      paddingLeft: 2,
                    }}
                  >
                    {group.groupName}
                  </span>
                  {(Array.isArray(group.items) ? group.items : []).map((screen, index) => {
                    const id = String(screen?.id || "");
                    const label = String(screen?.name || "").trim() || `Screen ${index + 1}`;
                    const active = id === String(activeScreenId || "");
                    return (
                      <button
                        key={`taskbar-screen-${group.groupName}-${id || index}`}
                        type="button"
                        onClick={() => {
                          if (!id || active) return;
                          switchToScreen(id);
                        }}
                        style={{
                          height: 28,
                          width: `${taskbarButtonWidthCh}ch`,
                          borderRadius: 7,
                          border: `1px solid ${active ? "color-mix(in srgb, var(--accent) 60%, var(--border) 40%)" : "color-mix(in srgb, var(--border) 90%, #1f2937 10%)"}`,
                          background: active
                            ? "color-mix(in srgb, var(--bg) 85%, var(--accent) 15%)"
                            : "color-mix(in srgb, var(--bg) 98%, #0b1220 2%)",
                          color: active ? "var(--text)" : "var(--text)",
                          fontSize: 11,
                          fontWeight: active ? 700 : 600,
                          padding: "0 10px",
                          cursor: active ? "default" : "pointer",
                          boxShadow: active ? "0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent) inset" : "none",
                          textAlign: "center",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={`${group.groupName} - ${label}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              );
              })}
            </div>
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifySelf: "end",
              gap: 8,
              minWidth: 0,
            }}
          >
            {showTaskbarZoomTools ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 6px",
                  borderRadius: 10,
                  border: "1px solid color-mix(in srgb, var(--border) 88%, #1f2937 12%)",
                  background: "color-mix(in srgb, var(--bg-elev) 96%, #0b1220 4%)",
                }}
              >
                {[
                  {
                    key: "zoom-out",
                    title: "Zoom Out",
                    onClick: zoomOut,
                    holdAction: zoomOut,
                    icon: (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ),
                  },
                  {
                    key: "zoom-in",
                    title: "Zoom In",
                    onClick: zoomIn,
                    holdAction: zoomIn,
                    icon: (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                        <path d="M11 8v6M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ),
                  },
                  {
                    key: "zoom-reset",
                    title: "Reset View (dbl-click = 100%)",
                    onClick: zoomReset,
                    onDoubleClick: zoomResetTo100,
                    icon: (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M6 8a7 7 0 1 1-1 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M6 4v4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ),
                  },
                  {
                    key: "zoom-fullscreen",
                    title: isAppFullscreen ? "Exit Full Screen" : "Full Screen",
                    onClick: toggleAppFullscreen,
                    icon: isAppFullscreen ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M8 8h8v8H8z" stroke="currentColor" strokeWidth="2" />
                      </svg>
                    ),
                  },
                ].map((btn) => (
                  <button
                    key={btn.key}
                    type="button"
                    title={btn.title}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => {
                      if (btn.holdAction) {
                        startZoomHold(btn.holdAction, e);
                        return;
                      }
                      e.stopPropagation();
                    }}
                    onPointerUp={() => {
                      if (btn.holdAction) stopZoomHold();
                    }}
                    onPointerCancel={() => {
                      if (btn.holdAction) stopZoomHold();
                    }}
                    onPointerLeave={() => {
                      if (btn.holdAction) stopZoomHold();
                    }}
                    onDoubleClick={(e) => {
                      if (typeof btn.onDoubleClick === "function") {
                        e.stopPropagation();
                        e.preventDefault();
                        btn.onDoubleClick();
                      }
                    }}
                    onClick={btn.holdAction ? undefined : btn.onClick}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      border: "1px solid color-mix(in srgb, var(--border) 88%, #1f2937 12%)",
                      background: "color-mix(in srgb, var(--bg) 96%, #0b1220 4%)",
                      color: "var(--text)",
                      boxShadow: "0 4px 10px rgba(0,0,0,0.14)",
                      display: "grid",
                      placeItems: "center",
                      lineHeight: 0,
                      padding: 0,
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "grid", placeItems: "center", width: 14, height: 14 }}>{btn.icon}</span>
                  </button>
                ))}
                <div
                  style={{
                    marginLeft: 2,
                    minWidth: 44,
                    textAlign: "center",
                    fontSize: 11,
                    fontWeight: 800,
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--text-muted)",
                  }}
                >
                  {Math.round((zoom || 1) * 100)}%
                </div>
              </div>
            ) : null}
            <button
              type="button"
              title={showTaskbarZoomTools ? "Collapse zoom tools" : "Expand zoom tools"}
              aria-label={showTaskbarZoomTools ? "Collapse zoom tools" : "Expand zoom tools"}
              onClick={() => setShowTaskbarZoomTools((v) => !v)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "1px solid color-mix(in srgb, var(--border) 88%, #1f2937 12%)",
                background: showTaskbarZoomTools
                  ? "color-mix(in srgb, var(--selected-bg) 85%, var(--bg-elev) 15%)"
                  : "color-mix(in srgb, var(--bg-elev) 96%, #0b1220 4%)",
                color: showTaskbarZoomTools ? "var(--selected-text)" : "var(--text)",
                boxShadow: showTaskbarZoomTools ? "var(--selected-shadow)" : "0 4px 10px rgba(0,0,0,0.14)",
                display: "grid",
                placeItems: "center",
                lineHeight: 0,
                padding: 0,
                cursor: "pointer",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d={showTaskbarZoomTools ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      ) : null}

      <TeamChatPanel
        showTeamChat={showTeamChat}
        setShowTeamChat={setShowTeamChat}
        isLiveMode={isLiveMode}
        canAskAi={true}
        isLiveMobile={isLiveMobile}
        topOffset={TOP_BAR_H + liveAlarmBarOffset}
        leftOffset={projectDrawerInsetPx}
        rightOffset={!isLiveMode && showRulers ? 32 : undefined}
        bottomOffset={showDesktopTaskbar ? TASKBAR_H + 20 : (isLiveMode ? 72 : 16)}
        desktopTopPx={teamChatDesktopTopPx}
        desktopRightPx={teamChatDesktopRightPx}
        liveBottomCarouselHeightPx={liveBottomCarouselHeightPx}
        teamChatBodyRef={teamChatBodyRef}
        teamChatLoading={teamChatLoading}
        teamChatMessages={teamChatMessages}
        teamChatDraft={teamChatDraft}
        setTeamChatDraft={setTeamChatDraft}
        teamChatSending={teamChatSending}
        teamChatUnreadCount={teamChatUnreadCount}
        onSend={sendTeamChatMessage}
        onUploadL5x={uploadL5xContextFile}
        onClearL5x={clearL5xContextDocs}
        chatContextDocs={chatContextDocs}
        chatContextUploading={chatContextUploading}
        currentUserId={user?.id}
        liveUsers={teamChatLiveUsers}
      />

      {!showZoom && !isLiveMode && (
        <button
          title="Show Zoom"
          onClick={() => setShowZoom(true)}
          style={{
            position: "fixed",
            left: isLiveMode ? undefined : Math.max(zoomPos.x, 8),
            right: isLiveMode ? (isLiveMobile ? 68 : 72) : undefined,
            bottom: showDesktopTaskbar
              ? TASKBAR_H + 12
              : (isLiveMode && isLiveMobile ? liveBottomCarouselHeightPx + 10 : 16),
            zIndex: 92,
            padding: isLiveMode ? "4px 8px" : "6px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            cursor: "pointer",
            boxShadow: "0 6px 14px rgba(0,0,0,0.10)",
            color: "var(--text)",
            fontSize: isLiveMode ? 11 : 12,
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          Zoom
        </button>
      )}
    </div>
  );
}





