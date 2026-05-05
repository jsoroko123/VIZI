import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CanvasSvg from "../../../../app/src/components/CanvasSvg.jsx";
import ImportModal from "../../../../app/src/components/ImportModal.jsx";
import WidgetSelectorModal from "../../../../app/src/components/WidgetSelectorModal.jsx";
import { stripOuterSvg } from "../../../../app/src/utils/svgSanitize.js";
import { getFolderFromKey } from "../../../../app/src/utils/appDataTransforms.js";
import {
    defaultWidgetSettings,
    resolveWidgetOpcServer,
    resolveWidgetWriteMode,
    widgetTemplate
} from "../../../../app/src/utils/widgetTemplates.js";

const MODULE_ID = "com.mesora.perspective.drawing";
const MODULE_URL_ALIAS = "mesora-drawing";
const MODULE_RESOURCE_BASE = "/res/mesora-drawing";
const MODULE_DATA_ROUTE_CANDIDATES = [
    `/data/${MODULE_URL_ALIAS}/ignition-tags`,
    `/main/data/${MODULE_URL_ALIAS}/ignition-tags`,
    `/data/${MODULE_ID}/ignition-tags`,
    `/main/data/${MODULE_ID}/ignition-tags`
];
const MODULE_TAG_VALUE_ROUTE_CANDIDATES = [
    `/data/${MODULE_URL_ALIAS}/ignition-tag-values`,
    `/main/data/${MODULE_URL_ALIAS}/ignition-tag-values`,
    `/data/${MODULE_ID}/ignition-tag-values`,
    `/main/data/${MODULE_ID}/ignition-tag-values`
];
const MODULE_TAG_WRITE_ROUTE_CANDIDATES = [
    `/data/${MODULE_URL_ALIAS}/ignition-tag-write`,
    `/main/data/${MODULE_URL_ALIAS}/ignition-tag-write`,
    `/data/${MODULE_ID}/ignition-tag-write`,
    `/main/data/${MODULE_ID}/ignition-tag-write`
];
const MODULE_OPC_WRITE_ROUTE_CANDIDATES = [
    `/data/${MODULE_URL_ALIAS}/opc-write`,
    `/main/data/${MODULE_URL_ALIAS}/opc-write`,
    `/data/${MODULE_ID}/opc-write`,
    `/main/data/${MODULE_ID}/opc-write`
];
const SVG_LIBRARY_CATALOG_ROUTE_CANDIDATES = [
    `/data/${MODULE_URL_ALIAS}/svg-library-catalog`,
    `/main/data/${MODULE_URL_ALIAS}/svg-library-catalog`,
    `/data/${MODULE_ID}/svg-library-catalog`,
    `/main/data/${MODULE_ID}/svg-library-catalog`,
    `${MODULE_RESOURCE_BASE}/svg-library/manifest.json`
];
const SVG_LIBRARY_UPLOAD_ROUTE_CANDIDATES = [
    `/data/${MODULE_URL_ALIAS}/svg-library-upload`,
    `/main/data/${MODULE_URL_ALIAS}/svg-library-upload`,
    `/data/${MODULE_ID}/svg-library-upload`,
    `/main/data/${MODULE_ID}/svg-library-upload`
];
const HMI_STATE_STYLE_MAP_ROUTE_CANDIDATES = [
    `/data/${MODULE_URL_ALIAS}/hmi-state-style-maps`,
    `/main/data/${MODULE_URL_ALIAS}/hmi-state-style-maps`,
    `/data/${MODULE_ID}/hmi-state-style-maps`,
    `/main/data/${MODULE_ID}/hmi-state-style-maps`
];
const IGNITION_TAG_VALUE_POLL_MS = 250;
const SVG_RAW_CACHE_MAX = 80;
const DEFAULT_FILL = "#D7DADE";
const DEFAULT_STROKE = "#808080";
const NORMALIZED_SVG_STROKE_WIDTH = 1.5;
const DEFAULT_IGNITION_FILL_MAP = Object.freeze([
    Object.freeze({ value: "1", color: "#ef4444" }),
    Object.freeze({ value: "2", color: "#f59e0b" }),
    Object.freeze({ value: "3", color: "#22c55e" }),
    Object.freeze({ value: "4", color: "#f59e0b" }),
    Object.freeze({ value: "5", color: "#ef4444" }),
    Object.freeze({ value: "6", color: "#f97316" }),
    Object.freeze({ value: "16", color: "#7f1d1d" })
]);
const DEFAULT_CANVAS_WIDTH = 1668;
const DEFAULT_CANVAS_HEIGHT = 1401;
const LOCAL_CANVAS_ZOOM_MIN = 0.1;
const LOCAL_CANVAS_ZOOM_MAX = 4;
const LOCAL_CANVAS_ZOOM_STEP = 0.1;
const LOCAL_CANVAS_ZOOM_CACHE_PREFIX = "mesora-drawing:canvas-zoom:v1:";
const CANVAS_RULER_SIZE = 24;
const PROPERTY_PANEL_WIDTH = 300;
const PROPERTY_PANEL_MIN_WIDTH = 280;
const PROPERTY_PANEL_MAX_WIDTH = 560;
const PROPERTY_PANEL_WIDTH_STORAGE_KEY = "mesora-drawing:property-panel-width:v1";
const PROPERTY_PANEL_HEIGHT = 520;
const PROPERTY_PANEL_MIN_HEIGHT = 240;
const PROPERTY_PANEL_HEIGHT_STORAGE_KEY = "mesora-drawing:property-panel-height:v1";
const QUICK_TAG_PANEL_WIDTH = 360;
const QUICK_TAG_PANEL_HEIGHT = 124;
const QUICK_SVG_PANEL_WIDTH = 300;
const QUICK_SVG_PANEL_HEIGHT = 420;
const TOOLBAR_WIDTH = 300;
const COLLAPSED_TOOLBAR_WIDTH = 116;
const TOOLBAR_INSET = 16;
const TOOLBAR_DRAWER_GAP = -6;
const TOOLBAR_DEFAULT_POSITION = Object.freeze({ x: TOOLBAR_INSET, y: TOOLBAR_INSET });
const SVG_DRAWER_MIN_WIDTH = 300;
const SVG_DRAWER_PREFERRED_WIDTH = 348;
const HELP_DRAWER_MIN_WIDTH = 320;
const HELP_DRAWER_PREFERRED_WIDTH = 420;
const EMPTY_MAP = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);
const NOOP = () => {};
const IGNITION_TOOL_HELP_SECTIONS = Object.freeze([
    Object.freeze({
        title: "Getting Started",
        items: Object.freeze([
            "Use Move to select, drag, resize, and open properties for items on the canvas.",
            "Use Polyline to draw process flow. Left click adds segments, right click removes the current segment, and double click, Enter, or Shift plus right click finishes the line.",
            "Use Text to place a label or a live tag readout. Text can bind directly to an Ignition tag path."
        ])
    }),
    Object.freeze({
        title: "Selection And Editing",
        items: Object.freeze([
            "Single click selects one item. Shift plus click adds or removes items from the current selection.",
            "Drag on empty space to marquee select multiple items.",
            "Double click an SVG, widget, or text item to open its properties panel.",
            "Shift plus Delete removes the current selection."
        ])
    }),
    Object.freeze({
        title: "SVGs And Lines",
        items: Object.freeze([
            "SVG Library opens the Mesora equipment drawer so you can place process equipment on the canvas.",
            "Tag Path on an SVG binds the equipment to an Ignition tag. EType controls diverters and popup routing.",
            "Polylines light from the SVG or line connected to their start point, just like the Mesora tool."
        ])
    }),
    Object.freeze({
        title: "Widgets",
        items: Object.freeze([
            "Widgets opens the Mesora widget drawer. Place a widget, then double click it to edit its properties.",
            "Widgets can write to either Ignition tags or direct OPC, depending on the Write Target setting.",
            "Push Button and On Off Button support titles, title font size, press value, and release value."
        ])
    }),
    Object.freeze({
        title: "Bindings",
        items: Object.freeze([
            "Use the Tag Path picker to browse and search Ignition tags without expanding a huge inline list.",
            "Text items support Scale, Decimals, and Units so live values can be formatted on the canvas.",
            "Diverters should use their state tag path so the active straight or divert path can render correctly."
        ])
    }),
    Object.freeze({
        title: "Shortcuts",
        items: Object.freeze([
            "Shift plus M switches to Move.",
            "Shift plus P switches to Polyline.",
            "Shift plus T switches to Text.",
            "Shift plus C, V, D, Z, and Y map to copy, paste, duplicate, undo, and redo."
        ])
    })
]);

function isPlainObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function getComponentPropSource(componentProps) {
    const nested = componentProps?.props;
    if (isPlainObject(nested)) {
        return nested;
    }
    return isPlainObject(componentProps) ? componentProps : {};
}

function readObjectPathValue(source, path) {
    if (!source || !path) {
        return undefined;
    }

    try {
        if (typeof source.readString === "function") {
            const value = source.readString(path, "");
            if (value) {
                return value;
            }
        }
    } catch (_error) {
    }

    try {
        if (typeof source.read === "function") {
            const value = source.read(path, undefined);
            if (value != null) {
                return value;
            }
        }
    } catch (_error) {
    }

    return String(path)
        .split(".")
        .filter(Boolean)
        .reduce((acc, segment) => {
            if (acc == null) {
                return undefined;
            }
            return acc[segment];
        }, source);
}

function normalizePerspectiveThemeName(value) {
    if (value == null) {
        return "";
    }
    if (isPlainObject(value)) {
        return normalizePerspectiveThemeName(
            value.name
            ?? value.value
            ?? value.theme
            ?? value.themeName
            ?? value.props?.theme
        );
    }
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) {
        return "";
    }
    if (raw.includes("dark")) {
        return "dark";
    }
    if (raw.includes("light")) {
        return "light";
    }
    return "";
}

function getElementThemeCandidates(element) {
    if (!element) {
        return [];
    }
    return [
        element.getAttribute?.("data-theme"),
        element.getAttribute?.("theme"),
        element.getAttribute?.("data-theme-name"),
        element.getAttribute?.("class"),
        element.className
    ];
}

function detectDomThemeName() {
    if (typeof document === "undefined") {
        return "";
    }
    const themeSelectors = [
        "[data-theme*='terra-dark']",
        "[data-theme*='terra-light']",
        "[data-theme*='dark']",
        "[data-theme*='light']",
        "[theme*='terra-dark']",
        "[theme*='terra-light']",
        "[theme*='dark']",
        "[theme*='light']",
        "[class*='terra-dark']",
        "[class*='terra-light']",
        "[class*='theme--dark']",
        "[class*='theme--light']",
        "[class*='theme-dark']",
        "[class*='theme-light']",
        "[class*='ia_theme--dark']",
        "[class*='ia_theme--light']",
        "[class*='ia_theme--terra-dark']",
        "[class*='ia_theme--terra-light']"
    ];
    const candidates = [
        ...getElementThemeCandidates(document.documentElement),
        ...getElementThemeCandidates(document.body)
    ];
    for (const selector of themeSelectors) {
        try {
            const element = document.querySelector?.(selector);
            if (element) {
                candidates.push(...getElementThemeCandidates(element), selector);
            }
        } catch (_error) {
        }
    }
    return candidates.map(normalizePerspectiveThemeName).find(Boolean) || "";
}

function findThemeInObject(value, depth = 4, seen = new Set()) {
    const direct = normalizePerspectiveThemeName(value);
    if (direct || depth <= 0 || !value || typeof value !== "object" || seen.has(value)) {
        return direct;
    }
    seen.add(value);
    const priorityKeys = ["theme", "themeName", "selectedTheme", "currentTheme", "session", "props", "page", "view", "project"];
    for (const key of priorityKeys) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            continue;
        }
        const theme = findThemeInObject(value[key], depth - 1, seen);
        if (theme) {
            return theme;
        }
    }
    let entries = [];
    try {
        entries = Object.entries(value).slice(0, 80);
    } catch (_error) {
        entries = [];
    }
    for (const [key, entryValue] of entries) {
        if (/theme/i.test(key)) {
            const theme = findThemeInObject(entryValue, depth - 1, seen);
            if (theme) {
                return theme;
            }
        }
    }
    return "";
}

function getPerspectiveSessionThemeName(componentProps) {
    const nestedProps = getComponentPropSource(componentProps);
    const globalClient = typeof window !== "undefined" ? window.__client : null;
    const globalDesigner = typeof window !== "undefined" ? window._perspective_designer : null;
    const sources = [
        componentProps,
        nestedProps,
        componentProps?.store,
        nestedProps?.store,
        componentProps?.store?.view,
        nestedProps?.store?.view,
        componentProps?.store?.view?.page,
        nestedProps?.store?.view?.page,
        globalClient,
        globalClient?.session,
        globalClient?.store,
        globalClient?.store?.session,
        globalClient?.store?.page,
        globalClient?.store?.page?.session,
        globalClient?.store?.view,
        globalClient?.store?.view?.session,
        globalClient?.store?.view?.page,
        globalClient?.store?.view?.page?.session,
        globalDesigner,
        globalDesigner?.session,
        globalDesigner?.store,
        globalDesigner?.store?.session,
        globalDesigner?.store?.view,
        globalDesigner?.store?.view?.session,
        globalDesigner?.store?.view?.page
    ].filter(Boolean);
    const paths = [
        "session.props.theme",
        "session.props.theme.name",
        "session.props.theme.value",
        "session.theme",
        "session.theme.name",
        "session.theme.value",
        "props.session.props.theme",
        "props.session.props.theme.name",
        "props.session.theme",
        "page.session.props.theme",
        "page.session.props.theme.name",
        "page.props.session.props.theme",
        "view.session.props.theme",
        "view.session.props.theme.name",
        "view.props.session.props.theme",
        "project.props.theme",
        "project.theme"
    ];
    for (const source of sources) {
        for (const path of paths) {
            const theme = normalizePerspectiveThemeName(readObjectPathValue(source, path));
            if (theme) {
                return theme;
            }
        }
    }
    const domTheme = detectDomThemeName();
    if (domTheme) {
        return domTheme;
    }
    const sessionRoots = [
        componentProps?.session,
        nestedProps?.session,
        componentProps?.props?.session,
        nestedProps?.props?.session,
        componentProps?.store?.session,
        nestedProps?.store?.session,
        globalClient?.session,
        globalClient?.store?.session,
        globalClient?.store?.page?.session,
        globalClient?.store?.view?.session,
        globalClient?.store?.view?.page?.session,
        globalDesigner?.session,
        globalDesigner?.store?.session,
        globalDesigner?.store?.view?.session
    ].filter(Boolean);
    for (const source of sessionRoots) {
        const theme = findThemeInObject(source);
        if (theme) {
            return theme;
        }
    }
    return "";
}

function getPerspectiveThemeName(componentProps) {
    return getPerspectiveSessionThemeName(componentProps)
        || normalizePerspectiveThemeName(getModelValue(componentProps, "theme", ""))
        || "light";
}

function isLegacyCanvasBackgroundDefault(value) {
    const normalized = String(value || "").replace(/\s+/g, "").trim().toLowerCase();
    return normalized === "#0f172a"
        || normalized === "rgb(15,23,42)"
        || normalized === "rgba(15,23,42,1)"
        || normalized === "#0f141c"
        || normalized === "rgb(15,20,28)"
        || normalized === "rgba(15,20,28,1)"
        || normalized === "#f8fafc"
        || normalized === "rgb(248,250,252)"
        || normalized === "rgba(248,250,252,1)"
        || normalized === "#ffffff"
        || normalized === "#fff"
        || normalized === "rgb(255,255,255)"
        || normalized === "rgba(255,255,255,1)"
        || normalized === "var(--canvas-bg)";
}

function getThemeCanvasBackground(theme) {
    return normalizePerspectiveThemeName(theme) === "dark"
        ? "var(--vizi-canvas-bg-dark, #0f141c)"
        : "var(--vizi-canvas-bg-light, #ffffff)";
}

function useDomThemeVersion() {
    const [version, setVersion] = useState(0);

    useEffect(() => {
        if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
            return undefined;
        }
        const bump = () => setVersion((previous) => (previous + 1) % 100000);
        const observer = new MutationObserver(bump);
        const options = {
            attributes: true,
            attributeFilter: ["class", "data-theme", "theme", "data-theme-name"]
        };
        if (document.documentElement) {
            observer.observe(document.documentElement, options);
        }
        if (document.body) {
            observer.observe(document.body, options);
        }
        return () => observer.disconnect();
    }, []);

    return version;
}

function getPerspectiveCanvasBackground(componentProps, theme) {
    const explicitCanvasBackground = String(getModelValue(componentProps, "canvasBackgroundColor", "") || "").trim();
    if (explicitCanvasBackground) {
        return explicitCanvasBackground;
    }
    const backgroundColor = String(getModelValue(componentProps, "backgroundColor", "") || "").trim();
    if (backgroundColor && !isLegacyCanvasBackgroundDefault(backgroundColor)) {
        return backgroundColor;
    }
    return getThemeCanvasBackground(theme);
}

function normalizeCacheKeyPart(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ");
}

function resolveCanvasZoomCacheKey(componentProps) {
    const nestedProps = getComponentPropSource(componentProps);
    const globalClient = typeof window !== "undefined" ? window.__client : null;
    const globalDesigner = typeof window !== "undefined" ? window._perspective_designer : null;
    const stores = [
        componentProps?.store,
        nestedProps?.store,
        globalClient?.store,
        globalDesigner?.store
    ].filter(Boolean);
    const viewPaths = [
        "view.resourcePath",
        "view.viewPath",
        "view.path",
        "view.mountPath",
        "view.name",
        "view.id",
        "view.page.resourcePath",
        "view.page.viewPath",
        "view.page.path",
        "view.page.url",
        "view.page.mountPath",
        "view.page.rootView.resourcePath",
        "view.page.rootView.path",
        "page.resourcePath",
        "page.viewPath",
        "page.path",
        "page.url"
    ];

    const candidates = [];
    stores.forEach((store) => {
        viewPaths.forEach((path) => {
            candidates.push(readObjectPathValue(store, path));
        });
    });
    if (typeof window !== "undefined" && window.location) {
        candidates.push(`${window.location.origin}${window.location.pathname}`);
    }
    candidates.push(componentProps?.store?.path, nestedProps?.store?.path);

    const identity = candidates
        .map(normalizeCacheKeyPart)
        .find(Boolean) || "default";
    return `${LOCAL_CANVAS_ZOOM_CACHE_PREFIX}${encodeURIComponent(identity)}`;
}

function readCachedCanvasZoom(cacheKey) {
    if (!cacheKey || typeof window === "undefined" || !window.localStorage) {
        return null;
    }

    try {
        const raw = window.localStorage.getItem(cacheKey);
        if (raw == null || raw === "") {
            return null;
        }
        return normalizeLocalCanvasZoom(Number(raw));
    } catch (_error) {
        return null;
    }
}

function writeCachedCanvasZoom(cacheKey, zoomValue) {
    if (!cacheKey || typeof window === "undefined" || !window.localStorage) {
        return;
    }

    try {
        if (zoomValue == null) {
            window.localStorage.removeItem(cacheKey);
            return;
        }
        window.localStorage.setItem(cacheKey, String(normalizeLocalCanvasZoom(zoomValue)));
    } catch (_error) {
    }
}

function coerceArray(value) {
    return Array.isArray(value) ? value : [];
}

function cleanTagTypeDisplayName(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }
    const withoutProvider = raw.replace(/^\[[^\]]+\]/, "").trim();
    const parts = withoutProvider.split(/[\\/]/).map((part) => part.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : withoutProvider;
}

const NON_UDT_TYPE_IDS = new Set([
    "atomic",
    "client",
    "derived",
    "document",
    "expression",
    "folder",
    "memory",
    "opc",
    "query",
    "reference",
    "system"
]);

function isUdtTypeCandidate(typeId, objectType) {
    const cleaned = cleanTagTypeDisplayName(typeId);
    if (!cleaned) {
        return false;
    }
    const objectText = String(objectType || "").trim().toLowerCase();
    if (objectText.includes("udt")) {
        return true;
    }
    return !NON_UDT_TYPE_IDS.has(cleaned.toLowerCase());
}

function getTagTypeDisplayName(entry) {
    const explicit = cleanTagTypeDisplayName(entry?.udtName || entry?.udtType || entry?.templateName || "");
    if (explicit) {
        return explicit;
    }
    const typeId = cleanTagTypeDisplayName(entry?.typeId || "");
    if (isUdtTypeCandidate(typeId, entry?.objectType)) {
        return typeId;
    }
    return cleanTagTypeDisplayName(
        entry?.dataType
        || entry?.plcType
        || entry?.uaType
        || typeId
        || ""
    );
}

function isIgnitionDocumentTagEntry(entry) {
    const objectType = String(entry?.objectType || "").trim().toLowerCase();
    const dataType = cleanTagTypeDisplayName(entry?.dataType || entry?.plcType || entry?.uaType || "").toLowerCase();
    const typeId = cleanTagTypeDisplayName(entry?.typeId || "").toLowerCase();
    return objectType === "document"
        || objectType === "documenttag"
        || objectType.includes("documenttag")
        || dataType === "document"
        || typeId === "document";
}

function buildUdtTypeOptions({ tags = EMPTY_ARRAY, styleMapIndex = EMPTY_MAP, currentValues = EMPTY_ARRAY } = {}) {
    const seen = new Set();
    const out = [];
    const add = (value, group = "Ignition UDTs") => {
        const clean = cleanTagTypeDisplayName(value);
        if (!clean) {
            return;
        }
        const key = clean.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        out.push({ value: clean, label: clean, group });
    };

    coerceArray(tags).forEach((tag) => {
        add(getTagTypeDisplayName(tag), "Ignition UDTs");
    });

    coerceArray(styleMapIndex?.entries).forEach((entry) => {
        add(entry?.name, "State Maps");
    });

    coerceArray(currentValues).forEach((value) => {
        add(value, "Current");
    });

    out.sort((left, right) => {
        const groupCompare = String(left.group || "").localeCompare(String(right.group || ""), undefined, { sensitivity: "base" });
        if (groupCompare !== 0) {
            return groupCompare;
        }
        return String(left.label || "").localeCompare(String(right.label || ""), undefined, { sensitivity: "base" });
    });

    return out;
}

function normalizeTagTypeMatchToken(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/^\[[^\]]+\]/, "")
        .replace(/\.(svg|json)$/i, "")
        .replace(/[^a-z0-9]+/g, "");
}

function collectTagTypeMatchTokens(...values) {
    const tokens = new Set();
    values.forEach((value) => {
        const raw = String(value || "").trim();
        if (!raw) {
            return;
        }

        const whole = normalizeTagTypeMatchToken(raw);
        if (whole) {
            tokens.add(whole);
        }

        raw
            .replace(/^\[[^\]]+\]/, "")
            .split(/[\s._:/\\|()[\]{}<>-]+/)
            .map(normalizeTagTypeMatchToken)
            .filter(Boolean)
            .forEach((token) => {
                tokens.add(token);
                if (token.startsWith("udt") && token.length > 3) {
                    tokens.add(token.slice(3));
                }
            });
    });
    return tokens;
}

function isDiverterTypeToken(value) {
    const token = normalizeTagTypeMatchToken(value);
    return token.includes("diverter") || token.includes("twoway");
}

function usesTwoWayUdtTypeToken(value) {
    const token = normalizeTagTypeMatchToken(value);
    return isDiverterTypeToken(token) || token === "gate";
}

function tagMatchesTypeFilter(entry, typeFilter) {
    const filterToken = normalizeTagTypeMatchToken(typeFilter);
    if (!filterToken) {
        return true;
    }

    const typeTokens = collectTagTypeMatchTokens(
        entry?.udtName,
        entry?.udtType,
        entry?.templateName,
        entry?.typeId,
        entry?.dataType,
        entry?.plcType,
        entry?.uaType
    );
    if (!typeTokens.size) {
        return false;
    }
    if (typeTokens.has(filterToken)) {
        return true;
    }
    if (usesTwoWayUdtTypeToken(filterToken)) {
        for (const token of typeTokens) {
            if (usesTwoWayUdtTypeToken(token)) {
                return true;
            }
        }
    }

    for (const token of typeTokens) {
        if (filterToken.length >= 3 && token.endsWith(filterToken)) {
            return true;
        }
        if (token.length >= 3 && filterToken.endsWith(token)) {
            return true;
        }
    }

    return false;
}

function normalizeIgnitionTagEntries(payload) {
    const rawEntries = coerceArray(payload?.tags ?? payload);
    const seen = new Set();
    const out = [];

    rawEntries.forEach((entry) => {
        const path = String(entry?.path || "").trim();
        if (!path) {
            return;
        }
        if (isIgnitionDocumentTagEntry(entry)) {
            return;
        }

        const key = path.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);

        const provider = String(entry?.provider || "").trim()
            || ((path.match(/^\[([^\]]+)\]/)?.[1] || "").trim());
        const dataType = String(entry?.dataType || entry?.plcType || entry?.uaType || "").trim();
        const typeId = String(entry?.typeId || "").trim();
        const typeName = getTagTypeDisplayName({ ...entry, typeId, dataType });

        out.push({
            path,
            provider: provider || "Tags",
            name: String(entry?.name || "").trim() || path,
            objectType: String(entry?.objectType || "").trim(),
            typeId,
            dataType,
            udtName: typeName,
            hasChildren: Boolean(entry?.hasChildren)
        });
    });

    out.sort((left, right) => {
        const providerCompare = String(left.provider || "").localeCompare(String(right.provider || ""), undefined, { sensitivity: "base" });
        if (providerCompare !== 0) {
            return providerCompare;
        }
        return String(left.path || "").localeCompare(String(right.path || ""), undefined, { sensitivity: "base" });
    });

    return out;
}

function cloneDefaultIgnitionFillMappings(source = DEFAULT_IGNITION_FILL_MAP) {
    return coerceArray(source)
        .map((entry) => {
            const value = String(entry?.value ?? "").trim();
            const color = String(entry?.color ?? "").trim();
            if (!value || !color) {
                return null;
            }
            return { value, color };
        })
        .filter(Boolean);
}

function normalizeIgnitionFillBindingMappings(value) {
    const normalized = coerceArray(value)
        .map((entry) => {
            const color = String(
                entry?.color
                ?? entry?.class
                ?? entry?.styleClass
                ?? entry?.className
                ?? entry?.style
                ?? entry?.cssClass
                ?? ""
            ).trim();
            const mappingValue = String(
                entry?.value
                ?? entry?.state
                ?? entry?.field
                ?? entry?.input
                ?? entry?.key
                ?? ""
            ).trim();
            if (!mappingValue || !color) {
                return null;
            }
            return {
                value: mappingValue,
                color
            };
        })
        .filter(Boolean);

    return normalized.length ? normalized : cloneDefaultIgnitionFillMappings();
}

function readStateStyleMapSource(value) {
    if (typeof value === "string") {
        const raw = value.trim();
        if (!raw) {
            return {};
        }
        try {
            return JSON.parse(raw);
        } catch (_error) {
            return {};
        }
    }
    if (
        isPlainObject(value)
        && Object.prototype.hasOwnProperty.call(value, "value")
        && (
            Object.prototype.hasOwnProperty.call(value, "quality")
            || Object.prototype.hasOwnProperty.call(value, "timestamp")
        )
    ) {
        return value.value;
    }
    return isPlainObject(value) || Array.isArray(value) ? value : {};
}

function normalizeCssPropertyName(value) {
    return String(value || "")
        .trim()
        .replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
        .replace(/^ms-/, "-ms-")
        .toLowerCase();
}

function normalizeCssValue(value) {
    if (value == null || typeof value === "object") {
        return "";
    }
    return String(value).trim().replace(/[{}]/g, "");
}

function readInlineStyleObject(value) {
    const source = isPlainObject(value) ? value : {};
    const nested = isPlainObject(source.style)
        ? source.style
        : isPlainObject(source.css)
            ? source.css
            : isPlainObject(source.styles)
                ? source.styles
                : {};
    const out = { ...nested };
    [
        "fill",
        "stroke",
        "color",
        "backgroundColor",
        "background-color",
        "opacity",
        "fillOpacity",
        "fill-opacity",
        "strokeOpacity",
        "stroke-opacity",
        "strokeWidth",
        "stroke-width"
    ].forEach((property) => {
        if (source[property] !== undefined && source[property] !== null) {
            out[property] = source[property];
        }
    });
    return out;
}

function normalizeHmiStatePaint(value) {
    if (isPlainObject(value)) {
        return String(
            value.fill
            ?? value.color
            ?? value.backgroundColor
            ?? value["background-color"]
            ?? ""
        ).trim();
    }
    return String(value ?? "").trim();
}

function normalizeHmiStateStyleMapRows(value) {
    const source = readStateStyleMapSource(value);
    const rows = [];
    const pushRow = (stateKey, entry) => {
        const record = isPlainObject(entry) ? entry : {};
        const mappingValue = String(
            record.value
            ?? record.state
            ?? record.field
            ?? record.input
            ?? record.key
            ?? stateKey
            ?? ""
        ).trim();
        const paint = normalizeHmiStatePaint(
            record.color
            ?? record.class
            ?? record.styleClass
            ?? record.className
            ?? record.style
            ?? record.cssClass
            ?? readInlineStyleObject(record)
            ?? (isPlainObject(entry) ? "" : entry)
        );
        if (!mappingValue || !paint) {
            return;
        }
        rows.push({
            value: mappingValue,
            state: mappingValue,
            color: paint,
            style: readInlineStyleObject(record),
            text: String(record.text ?? record.label ?? "").trim()
        });
    };

    if (Array.isArray(source)) {
        source.forEach((entry, index) => pushRow(String(index), entry));
        return rows;
    }

    if (isPlainObject(source)) {
        Object.entries(source).forEach(([stateKey, entry]) => pushRow(stateKey, entry));
    }

    return rows;
}

function getHmiStateStyleMappingValue(mapping) {
    return String(
        mapping?.value
        ?? mapping?.state
        ?? mapping?.field
        ?? mapping?.input
        ?? mapping?.key
        ?? ""
    ).trim();
}

function getHmiStateStyleMappingPaint(mapping) {
    return String(
        mapping?.color
        ?? mapping?.class
        ?? mapping?.styleClass
        ?? mapping?.className
        ?? mapping?.style
        ?? mapping?.cssClass
        ?? ""
    ).trim();
}

function isHmiStateFallbackMapping(mapping) {
    const value = getHmiStateStyleMappingValue(mapping).toLowerCase();
    return value === "fallback" || value === "default" || value === "else" || value === "otherwise";
}

function getHmiStateStyleFallbackPaint(mappings) {
    for (const mapping of coerceArray(mappings)) {
        if (!isHmiStateFallbackMapping(mapping)) {
            continue;
        }
        const paint = getHmiStateStyleMappingPaint(mapping);
        if (paint) {
            return paint;
        }
    }
    return "";
}

function looksLikeHmiStateStyleTable(value) {
    const source = readStateStyleMapSource(value);
    if (Array.isArray(source)) {
        return true;
    }
    if (!isPlainObject(source)) {
        return false;
    }
    return Object.entries(source).some(([stateKey, entry]) => {
        if (!isPlainObject(entry)) {
            return typeof entry === "string" || typeof entry === "number";
        }
        const hasPaint =
            Object.prototype.hasOwnProperty.call(entry, "color")
            || Object.prototype.hasOwnProperty.call(entry, "class")
            || Object.prototype.hasOwnProperty.call(entry, "style")
            || Object.prototype.hasOwnProperty.call(entry, "styleClass")
            || Object.prototype.hasOwnProperty.call(entry, "className")
            || Object.prototype.hasOwnProperty.call(entry, "cssClass");
        const hasExplicitState =
            Object.prototype.hasOwnProperty.call(entry, "value")
            || Object.prototype.hasOwnProperty.call(entry, "state")
            || Object.prototype.hasOwnProperty.call(entry, "field")
            || Object.prototype.hasOwnProperty.call(entry, "input")
            || Object.prototype.hasOwnProperty.call(entry, "key");
        return hasPaint && (hasExplicitState || String(stateKey || "").trim() !== "");
    });
}

function normalizeHmiStateStyleMapIndex(value) {
    const source = readStateStyleMapSource(value);
    const entries = [];
    const addEntry = (name, table) => {
        const rows = normalizeHmiStateStyleMapRows(table);
        const token = normalizeTagTypeMatchToken(name);
        if (!rows.length) {
            return;
        }
        entries.push({
            name: String(name || "").trim(),
            token,
            rows
        });
    };

    if (looksLikeHmiStateStyleTable(source)) {
        addEntry("default", source);
        return { entries, defaultRows: entries[0]?.rows || [] };
    }

    if (isPlainObject(source)) {
        Object.entries(source).forEach(([name, table]) => addEntry(name, table));
    }

    return {
        entries,
        defaultRows: entries.length === 1 ? entries[0].rows : []
    };
}

function resolveHmiStateStyleEntryReference(entry, styles) {
    const styleIndex = isPlainObject(styles) ? styles : {};
    if (typeof entry === "string" || typeof entry === "number") {
        const styleKey = String(entry).trim();
        if (styleKey && isPlainObject(styleIndex[styleKey])) {
            return { ...styleIndex[styleKey] };
        }
        return entry;
    }

    if (!isPlainObject(entry)) {
        return entry;
    }

    const styleKey = String(
        entry.styleRef
        ?? entry.ref
        ?? entry.styleKey
        ?? entry.styleName
        ?? ""
    ).trim();
    if (!styleKey || !isPlainObject(styleIndex[styleKey])) {
        return entry;
    }

    const {
        styleRef: _ignoredStyleRef,
        ref: _ignoredRef,
        styleKey: _ignoredStyleKey,
        styleName: _ignoredStyleName,
        ...entryWithoutRef
    } = entry;
    return {
        ...styleIndex[styleKey],
        ...entryWithoutRef
    };
}

function resolveHmiStateStyleMapReferences(maps, styles) {
    const source = readStateStyleMapSource(maps);
    const styleIndex = readStateStyleMapSource(styles);
    if (!isPlainObject(styleIndex) || !Object.keys(styleIndex).length) {
        return source;
    }

    const resolveTable = (table) => {
        const tableSource = readStateStyleMapSource(table);
        if (Array.isArray(tableSource)) {
            return tableSource.map((entry) => resolveHmiStateStyleEntryReference(entry, styleIndex));
        }
        if (isPlainObject(tableSource)) {
            return Object.entries(tableSource).reduce((acc, [stateKey, entry]) => {
                acc[stateKey] = resolveHmiStateStyleEntryReference(entry, styleIndex);
                return acc;
            }, {});
        }
        return table;
    };

    if (looksLikeHmiStateStyleTable(source)) {
        return resolveTable(source);
    }

    if (isPlainObject(source)) {
        return Object.entries(source).reduce((acc, [name, table]) => {
            acc[name] = resolveTable(table);
            return acc;
        }, {});
    }

    return source;
}

function normalizeHmiStateStyleMapPayload(value) {
    const payload = isPlainObject(value) ? value : { maps: value };
    const rawMaps = (
        payload.maps
        ?? payload.hmiStateStyleMaps
        ?? payload.udtStateStyleMaps
        ?? payload.stateMaps
        ?? payload.data
        ?? value
    );
    const styles = payload.styles ?? payload.classes ?? payload.styleClasses ?? payload.styleDefinitions ?? EMPTY_MAP;
    const maps = resolveHmiStateStyleMapReferences(rawMaps, styles);

    return {
        maps: isPlainObject(maps) || Array.isArray(maps) ? maps : EMPTY_MAP,
        styles: isPlainObject(styles) ? styles : EMPTY_MAP,
        filePath: String(payload.filePath ?? payload.path ?? "").trim(),
        lastModified: Math.max(0, Number(payload.lastModified) || 0),
        mapCount: Math.max(0, Number(payload.mapCount) || 0),
        error: String(payload.error || "").trim()
    };
}

function normalizeIgnitionStyleClassNameForCss(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }
    const lower = raw.toLowerCase();
    let classText = "";
    let singleStyleName = false;
    if (lower.startsWith("style:")) {
        classText = raw.slice(raw.indexOf(":") + 1).trim();
        singleStyleName = true;
    } else if (lower.startsWith("class:")) {
        classText = raw.slice(raw.indexOf(":") + 1).trim();
    } else if (lower.startsWith(".")) {
        classText = raw.slice(1).trim();
    } else if (lower.startsWith("psc-")) {
        classText = raw;
    } else if (raw.includes("/")) {
        classText = raw;
        singleStyleName = true;
    }
    if (!classText) {
        return "";
    }

    const entries = singleStyleName ? [classText] : classText.split(/\s+/);
    return entries
        .map((entry) => {
            const cleaned = String(entry || "")
                .trim()
                .replace(/^\./, "")
                .replace(/^style:/i, "")
                .replace(/^class:/i, "");
            if (!cleaned) {
                return "";
            }
            return cleaned.toLowerCase().startsWith("psc-") ? cleaned : `psc-${cleaned}`;
        })
        .filter(Boolean)
        .join(" ");
}

function escapeCssClassSelector(value) {
    const className = String(value || "").trim();
    if (!className) {
        return "";
    }
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return `.${CSS.escape(className)}`;
    }
    return `.${className.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
}

function collectStyleDefinitionClassNames(name, definition) {
    const rawClassNames = [];
    const add = (value) => {
        if (Array.isArray(value)) {
            value.forEach(add);
            return;
        }
        const raw = String(value || "").trim();
        if (raw) {
            rawClassNames.push(raw);
        }
    };
    add(definition?.class);
    add(definition?.classes);
    add(definition?.styleClass);
    add(definition?.className);
    add(definition?.cssClass);
    add(definition?.styleClassName);
    const nameText = String(name || "").trim();
    if (nameText.includes("/") || nameText.toLowerCase().startsWith("psc-")) {
        add(nameText);
    }

    const classNames = new Set();
    rawClassNames.forEach((raw) => {
        normalizeIgnitionStyleClassNameForCss(raw)
            .split(/\s+/)
            .map((entry) => entry.trim())
            .filter(Boolean)
            .forEach((entry) => classNames.add(entry));
    });
    return Array.from(classNames);
}

function serializeHmiStateStyleDeclaration(styleObject) {
    const source = isPlainObject(styleObject) ? styleObject : {};
    const declarations = [];
    Object.entries(source).forEach(([property, rawValue]) => {
        const cssProperty = normalizeCssPropertyName(property);
        const cssValue = normalizeCssValue(rawValue);
        if (!cssProperty || !cssValue) {
            return;
        }
        declarations.push(`${cssProperty}: ${cssValue} !important;`);
    });
    return declarations.join(" ");
}

function buildHmiStateStyleDefinitionCss(styles) {
    const source = readStateStyleMapSource(styles);
    if (!isPlainObject(source)) {
        return "";
    }

    const rules = [];
    Object.entries(source).forEach(([name, definition]) => {
        if (!isPlainObject(definition)) {
            return;
        }
        const classNames = collectStyleDefinitionClassNames(name, definition);
        const declaration = serializeHmiStateStyleDeclaration(readInlineStyleObject(definition));
        if (!classNames.length || !declaration) {
            return;
        }
        classNames.forEach((className) => {
            const selector = escapeCssClassSelector(className);
            if (selector) {
                rules.push(`${selector} { ${declaration} }`);
            }
        });
    });
    return rules.join("\n");
}

function hasHmiStateStyleMapEntries(value) {
    return normalizeHmiStateStyleMapIndex(value).entries.length > 0;
}

function mergeHmiStateStyleMapSources(baseMaps, overrideMaps) {
    const baseSource = readStateStyleMapSource(baseMaps);
    const overrideSource = readStateStyleMapSource(overrideMaps);
    const hasBase = hasHmiStateStyleMapEntries(baseSource);
    const hasOverride = hasHmiStateStyleMapEntries(overrideSource);

    if (!hasOverride) {
        return hasBase ? baseSource : EMPTY_MAP;
    }
    if (!hasBase) {
        return overrideSource;
    }
    if (looksLikeHmiStateStyleTable(baseSource) || looksLikeHmiStateStyleTable(overrideSource)) {
        return overrideSource;
    }
    return {
        ...baseSource,
        ...overrideSource
    };
}

function getHmiStateStyleMappingsForOverlay(overlay, stateStyleMapIndex) {
    const entries = Array.isArray(stateStyleMapIndex?.entries) ? stateStyleMapIndex.entries : [];
    if (!entries.length) {
        return [];
    }

    const overlayTypeTokens = Array.from(collectTagTypeMatchTokens(
        overlay?.eType,
        overlay?.name,
        overlay?.sourceKey
    )).filter(Boolean);
    for (const token of overlayTypeTokens) {
        const exact = entries.find((entry) => entry.token && entry.token === token);
        if (exact) {
            return exact.rows;
        }
    }

    const tokenList = Array.from(collectTagTypeMatchTokens(
        overlay?.udtName,
        overlay?.udtType,
        overlay?.templateName,
        overlay?.typeId,
        overlay?.eType,
        overlay?.name,
        overlay?.sourceKey
    )).filter(Boolean);

    for (const token of tokenList) {
        const exact = entries.find((entry) => entry.token && entry.token === token);
        if (exact) {
            return exact.rows;
        }
    }

    if (tokenList.some(isDiverterTypeToken)) {
        const diverterMatch = entries.find((entry) => isDiverterTypeToken(entry.name) || isDiverterTypeToken(entry.token));
        if (diverterMatch) {
            return diverterMatch.rows;
        }
    }

    for (const token of tokenList) {
        const partial = entries.find((entry) => (
            entry.token
            && token.length >= 3
            && (
                token.includes(entry.token)
                || entry.token.includes(token)
            )
        ));
        if (partial) {
            return partial.rows;
        }
    }

    return Array.isArray(stateStyleMapIndex?.defaultRows) ? stateStyleMapIndex.defaultRows : [];
}

function getOverlayHmiStateStyleBinding(overlay, stateStyleMapIndex) {
    const mappings = getHmiStateStyleMappingsForOverlay(overlay, stateStyleMapIndex);
    if (!mappings.length) {
        return null;
    }

    const currentBinding = getOverlayFillBinding(overlay);
    const tagPath = String(
        currentBinding?.tagPath
        ?? currentBinding?.path
        ?? currentBinding?.sourcePath
        ?? overlay?.tagPath
        ?? ""
    ).trim();
    if (!tagPath) {
        return null;
    }

    const mappedFallbackColor = getHmiStateStyleFallbackPaint(mappings);
    const fallbackColor = String(
        mappedFallbackColor
        || currentBinding?.transform?.fallbackColor
        || currentBinding?.fallbackColor
        || overlay?.fill
        || DEFAULT_FILL
    ).trim() || DEFAULT_FILL;

    return {
        ...(isPlainObject(currentBinding) ? currentBinding : {}),
        type: "tag",
        source: "ignition",
        property: "fill",
        tagPath,
        transform: {
            ...(isPlainObject(currentBinding?.transform) ? currentBinding.transform : {}),
            type: "map",
            inputType: "value",
            mappings,
            fallbackColor
        }
    };
}

function applyHmiStateStyleMapsToOverlays(overlays, stateStyleMapIndex) {
    if (!Array.isArray(overlays)) {
        return overlays;
    }

    const hasStateStyleEntries = Array.isArray(stateStyleMapIndex?.entries) && stateStyleMapIndex.entries.length > 0;
    return overlays.map((overlay) => {
        if (!isPlainObject(overlay) || overlay?.widget || overlay?.embeddedView) {
            return overlay;
        }
        const fillBinding = hasStateStyleEntries
            ? getOverlayHmiStateStyleBinding(overlay, stateStyleMapIndex)
            : null;
        const currentBindings = isPlainObject(overlay.bindings) ? overlay.bindings : {};
        if (fillBinding) {
            return withOverlayBindings(overlay, {
                ...currentBindings,
                fill: fillBinding
            });
        }

        if (
            getOverlayFillBinding(overlay) ||
            isStaticSvgOverlay(overlay) ||
            isDiverterOverlay(overlay) ||
            isBinOverlay(overlay)
        ) {
            return overlay;
        }

        const tagPath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
        return tagPath ? applyOverlayIgnitionFillBinding(overlay, tagPath) : overlay;
    });
}

function formatSvgAttributeNumber(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return "0";
    return Number(numberValue.toFixed(4)).toString();
}

const SVG_STROKE_TARGET_SELECTOR = "path,rect,circle,ellipse,polygon,polyline,line";

function isProtectedSvgStroke(value) {
    const v = String(value || "").trim().toLowerCase();
    return (
        !v ||
        v === "none" ||
        v === "transparent" ||
        v === "currentcolor" ||
        v === "inherit" ||
        v.startsWith("url(")
    );
}

function readSvgStylePaint(el, name) {
    const style = String(el?.getAttribute?.("style") || "");
    if (!style) return "";
    const match = style.match(new RegExp(`${name}\\s*:\\s*([^;]+)`, "i"));
    return String(match?.[1] || "").trim();
}

function readSvgPaint(el, name) {
    const attrValue = String(el?.getAttribute?.(name) || "").trim();
    if (attrValue) return attrValue;
    return readSvgStylePaint(el, name);
}

function readInheritedSvgPaint(el, root, name) {
    let node = el;
    while (node && node.nodeType === 1) {
        const value = readSvgPaint(node, name);
        if (value) return value;
        if (node === root) break;
        node = node.parentNode || null;
    }
    return "";
}

const SVG_STROKE_DETAIL_ID_RE = /(?:symbol|glyph|icon|needle|bulb|speed-center|temperature|label|legend)/i;

function isSvgStrokeDetailMarkerElement(el) {
    const marker = String(
        el?.getAttribute?.("data-vizi-stroke-detail") ||
        el?.getAttribute?.("data-vizi-detail") ||
        ""
    ).trim().toLowerCase();
    if (marker === "true" || marker === "1") {
        return true;
    }

    const tokenText = [
        el?.getAttribute?.("id"),
        el?.getAttribute?.("class"),
        el?.getAttribute?.("data-name")
    ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" ");
    return SVG_STROKE_DETAIL_ID_RE.test(tokenText);
}

function getSvgStrokeDetailRoot(el, root) {
    let node = el;
    while (node && node.nodeType === 1 && node !== root) {
        if (isSvgStrokeDetailMarkerElement(node)) {
            return node;
        }
        node = node.parentNode || null;
    }
    return null;
}

function isSvgStrokeDetailElement(el, root) {
    return Boolean(getSvgStrokeDetailRoot(el, root));
}

function setSvgPaint(el, name, value) {
    if (!el) return;
    el.setAttribute(name, value);
    const style = String(el.getAttribute("style") || "");
    if (!style || !new RegExp(`${name}\\s*:`, "i").test(style)) return;
    el.setAttribute(
        "style",
        style.replace(new RegExp(`${name}\\s*:\\s*([^;]+)(;?)`, "gi"), `${name}:${value}$2`)
    );
}

function removeSvgPaint(el, name) {
    if (!el) return;
    el.removeAttribute(name);
    const style = String(el.getAttribute("style") || "");
    if (!style || !new RegExp(`${name}\\s*:`, "i").test(style)) return;
    const cleaned = style
        .replace(new RegExp(`${name}\\s*:\\s*([^;]+);?`, "gi"), "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .join(";");
    if (cleaned) {
        el.setAttribute("style", cleaned);
    } else {
        el.removeAttribute("style");
    }
}

function getKnownSvgStrokeDetailWidth(el) {
    const tokenText = [
        el?.getAttribute?.("id"),
        el?.getAttribute?.("class"),
        el?.getAttribute?.("data-name")
    ].join(" ");
    return /(?:temperature|speed)-symbol/i.test(tokenText) ? "0.026" : "";
}

function normalizeSvgStrokeDetails(root) {
    Array.from(root?.querySelectorAll?.("*") || []).forEach((el) => {
        const detailRoot = getSvgStrokeDetailRoot(el, root);
        if (!detailRoot) return;
        if (el === detailRoot) {
            const knownWidth = getKnownSvgStrokeDetailWidth(el);
            if (knownWidth) {
                setSvgPaint(el, "stroke-width", knownWidth);
            }
            el.removeAttribute("vector-effect");
            return;
        }
        removeSvgPaint(el, "stroke-width");
        el.removeAttribute("vector-effect");
    });
}

function serializeSvgInner(root) {
    const serializer = new XMLSerializer();
    return Array.from(root.childNodes)
        .map((node) => serializer.serializeToString(node))
        .join("");
}

function stripSvgVectorEffect(inner) {
    let next = String(inner || "");
    next = next.replace(/\svector-effect\s*=\s*['"][^'"]*['"]/gi, "");
    next = next.replace(/\bstyle\s*=\s*(["'])([^"']*)\1/gi, (_match, quote, styleBody) => {
        const cleaned = String(styleBody || "")
            .split(";")
            .map((part) => part.trim())
            .filter((part) => part && !/^vector-effect\s*:/i.test(part))
            .join(";");
        return cleaned ? `style=${quote}${cleaned}${quote}` : "";
    });
    return next;
}

function updateSvgInnerStrokeWidth(inner, strokeWidth) {
    if (!inner) return inner;
    const sw = Number.parseFloat(strokeWidth);
    if (!Number.isFinite(sw) || sw <= 0) return inner;
    const value = formatSvgAttributeNumber(sw);

    const stripped = stripSvgVectorEffect(inner);

    try {
        const doc = new DOMParser().parseFromString(
            `<svg xmlns="http://www.w3.org/2000/svg">${String(stripped || "")}</svg>`,
            "image/svg+xml"
        );
        if (!doc.querySelector("parsererror")) {
            const root = doc.documentElement;
            normalizeSvgStrokeDetails(root);
            Array.from(root.querySelectorAll("*")).forEach((el) => {
                if (isSvgStrokeDetailElement(el, root)) return;
                if (readSvgPaint(el, "stroke-width")) {
                    setSvgPaint(el, "stroke-width", value);
                }
            });

            Array.from(root.querySelectorAll(SVG_STROKE_TARGET_SELECTOR)).forEach((el) => {
                if (isSvgStrokeDetailElement(el, root)) return;
                const directStroke = readSvgPaint(el, "stroke");
                if (directStroke && isProtectedSvgStroke(directStroke)) return;
                if (!directStroke) {
                    const inheritedStroke = readInheritedSvgPaint(el.parentNode || el, root, "stroke");
                    if (!isProtectedSvgStroke(inheritedStroke)) {
                        setSvgPaint(el, "stroke", inheritedStroke);
                    }
                }
                setSvgPaint(el, "stroke-width", value);
                el.setAttribute("vector-effect", "non-scaling-stroke");
            });

            return serializeSvgInner(root);
        }
    } catch {
        // Use the legacy string fallback below.
    }

    let next = stripped;
    next = next.replace(/stroke-width\s*=\s*['"][^'"]*['"]/gi, `stroke-width="${value}"`);
    next = next.replace(/stroke-width\s*:\s*[^;\"']+/gi, `stroke-width:${value}`);

    next = next.replace(
        /<(polyline|polygon|path|rect|circle|ellipse|line)\b([^>]*?)(\/?)>/gi,
        (match, tag, attrs, selfClose) => {
            const strokeIsNone = /stroke\s*=\s*['"]\s*none\s*['"]|stroke\s*:\s*none/i.test(attrs);
            if (strokeIsNone) return match;

            let nextAttrs = String(attrs || "");

            if (!/stroke-width\s*=|stroke-width\s*:/i.test(nextAttrs)) {
                nextAttrs += ` stroke-width="${value}"`;
            }
            if (!/vector-effect\s*=|vector-effect\s*:/i.test(nextAttrs)) {
                nextAttrs += ` vector-effect="non-scaling-stroke"`;
            }

            return `<${tag}${nextAttrs}${selfClose}>`;
        }
    );

    return next;
}

function getOverlayFillBinding(overlay) {
    const direct = overlay?.bindings?.fill;
    if (isPlainObject(direct)) {
        return direct;
    }
    const legacy = overlay?.fillBinding;
    if (isPlainObject(legacy)) {
        return legacy;
    }
    return null;
}

function getOverlayFillBindingTagPath(overlay) {
    const binding = getOverlayFillBinding(overlay);
    const tagPath = String(
        binding?.tagPath
        ?? binding?.path
        ?? binding?.sourcePath
        ?? overlay?.tagPath
        ?? ""
    ).trim();
    return tagPath;
}

function isDiverterOverlay(overlay) {
    return isDiverterTypeToken(overlay?.eType);
}

function usesTwoWayUdtOverlay(overlay) {
    return usesTwoWayUdtTypeToken(overlay?.eType);
}

function createIgnitionFillBinding(tagPath, fallbackColor, existingBinding = null) {
    const normalizedTagPath = String(tagPath || "").trim();
    const nextFallbackColor = String(fallbackColor || DEFAULT_FILL).trim() || DEFAULT_FILL;
    const nextMappings = normalizeIgnitionFillBindingMappings(
        existingBinding?.transform?.mappings
        ?? existingBinding?.mappings
    );

    return {
        type: "tag",
        source: "ignition",
        property: "fill",
        tagPath: normalizedTagPath,
        transform: {
            type: "map",
            inputType: "value",
            mappings: nextMappings,
            fallbackColor: nextFallbackColor
        }
    };
}

function withOverlayBindings(overlay, nextBindings) {
    const baseOverlay = isPlainObject(overlay) ? { ...overlay } : {};
    if (isPlainObject(nextBindings) && Object.keys(nextBindings).length > 0) {
        return {
            ...baseOverlay,
            bindings: nextBindings
        };
    }
    const { bindings: _ignoredBindings, ...overlayWithoutBindings } = baseOverlay;
    return overlayWithoutBindings;
}

function applyOverlayIgnitionFillBinding(overlay, rawTagPath) {
    const nextTagPath = String(rawTagPath ?? "").trim();
    const currentBindings = isPlainObject(overlay?.bindings) ? overlay.bindings : {};
    const isDiverter = isDiverterOverlay(overlay);
    const isWidget = Boolean(overlay?.widget);

    if (!nextTagPath) {
        const { fill: _removedFillBinding, ...restBindings } = currentBindings;
        return withOverlayBindings(
            {
                ...overlay,
                tagPath: ""
            },
            restBindings
        );
    }

    if (isDiverter || isWidget) {
        const { fill: _removedFillBinding, ...restBindings } = currentBindings;
        return withOverlayBindings(
            {
                ...overlay,
                tagPath: nextTagPath
            },
            restBindings
        );
    }

    const existingBinding = getOverlayFillBinding(overlay);
    const fallbackColor = String(
        existingBinding?.transform?.fallbackColor
        ?? overlay?.fill
        ?? DEFAULT_FILL
    ).trim() || DEFAULT_FILL;

    return {
        ...overlay,
        tagPath: nextTagPath,
        bindings: {
            ...currentBindings,
            fill: createIgnitionFillBinding(nextTagPath, fallbackColor, existingBinding)
        }
    };
}

function applyOverlayFillFallbackColor(overlay, rawFill) {
    const nextFill = String(rawFill ?? "").trim();
    const existingBinding = getOverlayFillBinding(overlay);

    if (!existingBinding) {
        return {
            ...overlay,
            fill: nextFill
        };
    }

    const currentBindings = isPlainObject(overlay?.bindings) ? overlay.bindings : {};
    return {
        ...overlay,
        fill: nextFill,
        bindings: {
            ...currentBindings,
            fill: createIgnitionFillBinding(
                getOverlayFillBindingTagPath(overlay),
                nextFill || DEFAULT_FILL,
                existingBinding
            )
        }
    };
}

function incrementTagPathValue(rawTagPath, amount = 1) {
    const tagPath = String(rawTagPath ?? "").trim();
    const step = Number(amount);
    if (!tagPath || !Number.isFinite(step) || step === 0) {
        return tagPath;
    }

    let lastMatch = null;
    const regex = /\d+/g;
    let match = regex.exec(tagPath);
    while (match) {
        lastMatch = match;
        match = regex.exec(tagPath);
    }

    if (!lastMatch) {
        return tagPath;
    }

    const start = Number(lastMatch.index || 0);
    const rawDigits = String(lastMatch[0] || "");
    const currentValue = Number(rawDigits);
    if (!Number.isFinite(currentValue)) {
        return tagPath;
    }

    const nextValue = Math.max(0, currentValue + step);
    const nextDigits = String(nextValue).padStart(rawDigits.length, "0");
    return `${tagPath.slice(0, start)}${nextDigits}${tagPath.slice(start + rawDigits.length)}`;
}

function withIncrementedShapeTagPath(shape, amount = 1) {
    const nextTagPath = incrementTagPathValue(shape?.tagPath, amount);
    if (!nextTagPath || nextTagPath === String(shape?.tagPath || "").trim()) {
        return shape;
    }
    return {
        ...shape,
        tagPath: nextTagPath
    };
}

function withIncrementedOverlayTagPath(overlay, amount = 1) {
    const nextTagPath = incrementTagPathValue(overlay?.tagPath, amount);
    if (!nextTagPath || nextTagPath === String(overlay?.tagPath || "").trim()) {
        return overlay;
    }
    return applyOverlayIgnitionFillBinding(overlay, nextTagPath);
}

function normalizeIgnitionTagValuePayload(payload) {
    const values = new Map();
    const meta = new Map();

    coerceArray(payload?.values ?? payload).forEach((entry) => {
        const path = String(entry?.path ?? "").trim();
        if (!path) {
            return;
        }
        const value = entry?.value ?? null;
        const quality = String(entry?.quality ?? "").trim();
        const timestamp = String(entry?.timestamp ?? "").trim();
        const error = String(entry?.error ?? "").trim();
        const record = {
            path,
            value,
            quality,
            timestamp,
            error
        };
        values.set(path, value);
        values.set(path.toLowerCase(), value);
        meta.set(path, record);
        meta.set(path.toLowerCase(), record);
    });

    return { values, meta };
}

function areIgnitionTagValuesEqual(left, right) {
    if (Object.is(left, right)) {
        return true;
    }
    if (left == null || right == null) {
        return false;
    }
    if (typeof left !== "object" || typeof right !== "object") {
        return false;
    }
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch (_error) {
        return String(left) === String(right);
    }
}

function areIgnitionTagMetaRecordsEqual(left, right) {
    if (left === right) {
        return true;
    }
    if (!left || !right) {
        return false;
    }
    return (
        String(left.path ?? "") === String(right.path ?? "") &&
        String(left.quality ?? "") === String(right.quality ?? "") &&
        String(left.error ?? "") === String(right.error ?? "") &&
        areIgnitionTagValuesEqual(left.value, right.value)
    );
}

function areMapsEqualByValue(leftMap, rightMap, valueEquals = Object.is) {
    if (leftMap === rightMap) {
        return true;
    }
    if (!(leftMap instanceof Map) || !(rightMap instanceof Map)) {
        return false;
    }
    if (leftMap.size !== rightMap.size) {
        return false;
    }
    for (const [key, rightValue] of rightMap.entries()) {
        if (!leftMap.has(key)) {
            return false;
        }
        if (!valueEquals(leftMap.get(key), rightValue)) {
            return false;
        }
    }
    return true;
}

function normalizeIgnitionTagValues(payload) {
    return normalizeIgnitionTagValuePayload(payload).values;
}

function chunkIgnitionTagValuePaths(paths, maxEncodedChars = 6000) {
    const source = coerceArray(paths)
        .map((path) => String(path || "").trim())
        .filter(Boolean);

    if (!source.length) {
        return [];
    }

    const chunks = [];
    let current = [];

    const getEncodedLength = (entries) => encodeURIComponent(JSON.stringify(entries)).length;

    source.forEach((path) => {
        const next = [...current, path];
        if (current.length > 0 && getEncodedLength(next) > maxEncodedChars) {
            chunks.push(current);
            current = [path];
            return;
        }
        current = next;
    });

    if (current.length) {
        chunks.push(current);
    }

    return chunks;
}

const BIN_UDT_MEMBERS = [
    "FriendlyName",
    "CurrentLevel",
    "CurrentLevelPercent",
    "MaxLevel",
    "i_LockFilling",
    "i_LockDischarging",
    "AssignedProductName",
    "BinNo"
];
const IGNITION_FILL_STATE_MEMBERS = [
    "HMI State",
    "HMI_State",
    "hmi_state",
    "HMIState",
    "hmistate",
    "i_HMIState",
    "o_HMIState",
    "State"
];
const IGNITION_MODE_STATUS_MEMBERS = [
    "Mode_Status",
    "ModeStatus",
    "Control_Status",
    "ControlStatus",
    "i_ModeStatus",
    "o_ModeStatus",
    "StsMode",
    "HMI_ModeStatus"
];
const IGNITION_MANUAL_MODE_MEMBERS = [
    "i_ManualMode",
    "o_ManualMode",
    "ManualMode",
    "StsManual",
    "ManualActive",
    "i_HandMode",
    "o_HandMode",
    "HandMode",
    "StsHand",
    "HandActive"
];
const IGNITION_AUTO_MODE_MEMBERS = [
    "i_AutoMode",
    "o_AutoMode",
    "AutoMode",
    "StsAuto",
    "AutoActive"
];
const IGNITION_MAINTENANCE_MODE_MEMBERS = [
    "i_MaintenanceMode",
    "o_MaintenanceMode",
    "MaintenanceMode",
    "MaintMode",
    "StsMaint",
    "MaintActive"
];
const IGNITION_FORCE_MODE_MEMBERS = [
    "Force",
    "ForceTrue",
    "i_Force",
    "o_Force",
    "i_ForceTrue",
    "o_ForceTrue",
    "ForceMode",
    "i_ForceMode",
    "o_ForceMode",
    "StsForce",
    "ForceActive"
];
const IGNITION_DESCRIPTION_MEMBERS = [
    "Description",
    "description",
    "Desc",
    "desc",
    "EquipmentDescription",
    "equipmentDescription",
    "equipment_description",
    "HMI_Description",
    "HMIDescription",
    "Tooltip",
    "ToolTip",
    "tooltip"
];
const IGNITION_MODE_MEMBERS = Array.from(
    new Set([
        ...IGNITION_MODE_STATUS_MEMBERS,
        ...IGNITION_MANUAL_MODE_MEMBERS,
        ...IGNITION_AUTO_MODE_MEMBERS,
        ...IGNITION_MAINTENANCE_MODE_MEMBERS,
        ...IGNITION_FORCE_MODE_MEMBERS
    ])
);
const MOTOR_UDT_STATE_MEMBERS = IGNITION_FILL_STATE_MEMBERS;
const MOTOR_UDT_ROUTE_COLOR_MEMBERS = [
    "RouteColor",
    "Route Color",
    "routeColor",
    "route_color"
];
const MOTOR_UDT_MEMBERS = Array.from(
    new Set([...MOTOR_UDT_STATE_MEMBERS, ...MOTOR_UDT_ROUTE_COLOR_MEMBERS])
);
const MOTOR_UDT_CONNECTION_MEMBERS = MOTOR_UDT_STATE_MEMBERS;
const DIVERTER_UDT_STATE_MEMBERS = IGNITION_FILL_STATE_MEMBERS;
const DIVERTER_UDT_ROUTE_COLOR_MEMBERS = MOTOR_UDT_ROUTE_COLOR_MEMBERS;
const DIVERTER_UDT_MEMBERS = Array.from(
    new Set([...DIVERTER_UDT_STATE_MEMBERS, ...DIVERTER_UDT_ROUTE_COLOR_MEMBERS])
);
const DIVERTER_UDT_CONNECTION_MEMBERS = DIVERTER_UDT_STATE_MEMBERS;
const DOC_DIC_UDT_STATE_MEMBERS = IGNITION_FILL_STATE_MEMBERS;
const DOC_DIC_UDT_ROUTE_COLOR_MEMBERS = MOTOR_UDT_ROUTE_COLOR_MEMBERS;
const DOC_DIC_UDT_MEMBERS = Array.from(
    new Set([...DOC_DIC_UDT_STATE_MEMBERS, ...DOC_DIC_UDT_ROUTE_COLOR_MEMBERS])
);
const DOC_DIC_UDT_CONNECTION_MEMBERS = DOC_DIC_UDT_STATE_MEMBERS;

function isBinOverlay(overlay) {
    const eType = String(overlay?.eType || overlay?.name || "").trim().toLowerCase();
    return eType === "bin" || eType.startsWith("bin");
}

function isMotorOverlay(overlay) {
    const eType = String(overlay?.eType || overlay?.name || "").trim().toLowerCase();
    return eType === "motor" || eType.startsWith("motor");
}

function isDocOrDicTypeToken(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) {
        return false;
    }
    const parts = raw.split(/[^a-z0-9]+/).filter(Boolean);
    if (parts.includes("doc") || parts.includes("dic")) {
        return true;
    }
    const compact = raw.replace(/[^a-z0-9]/g, "");
    return compact === "doc" || compact === "dic" || compact.endsWith("doc") || compact.endsWith("dic");
}

function isDocOrDicOverlay(overlay) {
    return [
        overlay?.eType,
        overlay?.udtName,
        overlay?.udtType,
        overlay?.templateName,
        overlay?.typeId,
        overlay?.name,
        overlay?.sourceKey
    ].some(isDocOrDicTypeToken);
}

function shouldQueryOverlayFillStateMembers(overlay) {
    if (overlay?.widget) {
        return false;
    }
    return !isBinOverlay(overlay);
}

function shouldQueryOverlayModeMembers(overlay) {
    if (overlay?.widget || overlay?.embeddedView) {
        return false;
    }
    return !isBinOverlay(overlay);
}

function getIgnitionTagValue(tagValMap, basePath, member) {
    const root = String(basePath || "").trim();
    const child = String(member || "").trim();
    if (!root || !child) {
        return null;
    }
    const slashPath = `${root}/${child}`;
    const dotPath = `${root}.${child}`;
    return tagValMap.get(slashPath)
        ?? tagValMap.get(slashPath.toLowerCase())
        ?? tagValMap.get(dotPath)
        ?? tagValMap.get(dotPath.toLowerCase())
        ?? null;
}

function normalizeIgnitionMemberName(value) {
    return String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

const IGNITION_FILL_STATE_MEMBER_KEYS = new Set(
    IGNITION_FILL_STATE_MEMBERS.map(normalizeIgnitionMemberName)
);

function isIgnitionFillStateMemberName(value) {
    const key = normalizeIgnitionMemberName(value);
    return Boolean(key && IGNITION_FILL_STATE_MEMBER_KEYS.has(key));
}

function getIgnitionTagDirectValue(tagValMap, rawPath) {
    const path = String(rawPath || "").trim();
    if (!path || !tagValMap) {
        return null;
    }
    return tagValMap.get(path)
        ?? tagValMap.get(path.toLowerCase())
        ?? null;
}

function getIgnitionTagValueForMembers(tagValMap, basePath, members) {
    for (const member of coerceArray(members)) {
        const value = getIgnitionTagValue(tagValMap, basePath, member);
        if (value != null && String(value).trim() !== "") {
            return value;
        }
    }
    return null;
}

function getIgnitionTagValueForMembersDeep(tagValMap, basePath, members) {
    const direct = getIgnitionTagValueForMembers(tagValMap, basePath, members);
    if (direct != null && String(direct).trim() !== "") {
        return direct;
    }

    const path = String(basePath || "").trim();
    if (!path || !tagValMap || typeof tagValMap.entries !== "function") {
        return null;
    }

    const memberKeys = new Set(coerceArray(members).map(normalizeIgnitionMemberName).filter(Boolean));
    if (!memberKeys.size) {
        return null;
    }

    const lowerPath = path.toLowerCase();
    const prefixes = [`${lowerPath}/`, `${lowerPath}.`];
    for (const [rawKey, value] of tagValMap.entries()) {
        if (value == null || String(value).trim() === "") {
            continue;
        }
        const key = String(rawKey || "").trim().toLowerCase();
        if (!prefixes.some((prefix) => key.startsWith(prefix))) {
            continue;
        }
        const leaf = key.split(/[/.]/).filter(Boolean).pop() || "";
        if (memberKeys.has(normalizeIgnitionMemberName(leaf))) {
            return value;
        }
    }

    return null;
}

function getIgnitionHmiStateValueForBase(tagValMap, basePath, members = IGNITION_FILL_STATE_MEMBERS) {
    const path = String(basePath || "").trim();
    if (!path) {
        return null;
    }
    const leaf = path.split(/[/.]/).map((entry) => entry.trim()).filter(Boolean).pop() || "";
    if (isIgnitionFillStateMemberName(leaf)) {
        const directValue = getIgnitionTagDirectValue(tagValMap, path);
        if (directValue != null && String(directValue).trim() !== "") {
            return directValue;
        }
    }
    return getIgnitionTagValueForMembersDeep(tagValMap, path, members);
}

function getIgnitionTagMeta(tagMetaMap, rawPath) {
    const path = String(rawPath || "").trim();
    if (!path || !tagMetaMap) {
        return null;
    }
    return tagMetaMap.get(path)
        ?? tagMetaMap.get(path.toLowerCase())
        ?? null;
}

function describeIgnitionTagQualityIssue(meta) {
    const error = String(meta?.error ?? "").trim();
    if (error) {
        return "No OPC/PLC connection";
    }

    const quality = String(meta?.quality ?? "").trim();
    if (!quality) {
        return "";
    }

    const qualityKey = quality.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!qualityKey || qualityKey.startsWith("good")) {
        return "";
    }

    if (
        qualityKey.includes("bad")
        || qualityKey.includes("error")
        || qualityKey.includes("fault")
        || qualityKey.includes("timeout")
        || qualityKey.includes("stale")
        || qualityKey.includes("notconnected")
        || qualityKey.includes("comm")
        || qualityKey.includes("uncertain")
    ) {
        return "No OPC/PLC connection";
    }

    return "";
}

function getIgnitionTagQualityIssue(tagMetaMap, rawPath) {
    const path = String(rawPath || "").trim();
    const meta = getIgnitionTagMeta(tagMetaMap, path);
    const message = describeIgnitionTagQualityIssue(meta);
    if (!message) {
        return null;
    }
    return {
        path: String(meta?.path || path).trim(),
        quality: String(meta?.quality || "").trim(),
        error: String(meta?.error || "").trim(),
        message
    };
}

function getOverlayConnectionCheckPaths(overlay) {
    const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
    if (!basePath || overlay?.embeddedView) {
        return [];
    }

    const out = [];
    const seen = new Set();
    const push = (rawPath) => {
        const path = String(rawPath || "").trim();
        if (!path) {
            return;
        }
        const key = path.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        out.push(path);
    };
    const pushMembers = (members) => {
        coerceArray(members).forEach((member) => {
            push(`${basePath}/${member}`);
            push(`${basePath}.${member}`);
        });
    };

    push(basePath);

    const leaf = basePath.split(/[/.]/).map((entry) => entry.trim()).filter(Boolean).pop() || "";
    if (isIgnitionFillStateMemberName(leaf)) {
        return out;
    } else if (isBinOverlay(overlay)) {
        pushMembers(BIN_UDT_MEMBERS);
    } else if (isMotorOverlay(overlay)) {
        pushMembers(MOTOR_UDT_CONNECTION_MEMBERS);
    } else if (usesTwoWayUdtOverlay(overlay)) {
        pushMembers(DIVERTER_UDT_CONNECTION_MEMBERS);
    } else if (isDocOrDicOverlay(overlay)) {
        pushMembers(DOC_DIC_UDT_CONNECTION_MEMBERS);
    } else if (shouldQueryOverlayFillStateMembers(overlay)) {
        pushMembers(IGNITION_FILL_STATE_MEMBERS);
    }

    if (!out.length) {
        push(basePath);
    }
    return out;
}

function getOverlayConnectionIssue(overlay, tagMetaMap) {
    if (isStaticSvgOverlay(overlay)) {
        return null;
    }
    const paths = getOverlayConnectionCheckPaths(overlay);
    let firstIssue = null;
    for (const path of paths) {
        const meta = getIgnitionTagMeta(tagMetaMap, path);
        if (!meta) {
            continue;
        }
        const issue = getIgnitionTagQualityIssue(tagMetaMap, path);
        if (!issue) {
            return null;
        }
        if (!firstIssue) {
            firstIssue = issue;
        }
    }
    return firstIssue;
}

function isStaticSvgOverlay(overlay) {
    return Boolean(overlay?.static || overlay?.isStatic || overlay?.staticSvg);
}

function resolveIgnitionStateMappingColor(mappings, rawValue) {
    const valueText = String(rawValue ?? "").trim();
    if (!valueText) {
        return "";
    }

    const valueLower = valueText.toLowerCase();
    const valueNum = Number(rawValue);
    const valueBool =
        valueLower === "true" || valueLower === "1"
            ? true
            : valueLower === "false" || valueLower === "0"
                ? false
                : null;

    for (const mapping of coerceArray(mappings)) {
        const color = String(
            mapping?.color
            ?? mapping?.class
            ?? mapping?.styleClass
            ?? mapping?.className
            ?? mapping?.style
            ?? mapping?.cssClass
            ?? ""
        ).trim();
        const mappingValue = String(
            mapping?.value
            ?? mapping?.state
            ?? mapping?.field
            ?? mapping?.input
            ?? mapping?.key
            ?? ""
        ).trim();
        if (!color || !mappingValue) {
            continue;
        }

        if (mappingValue === valueText || mappingValue.toLowerCase() === valueLower) {
            return color;
        }

        const mappingNum = Number(mappingValue);
        if (Number.isFinite(valueNum) && Number.isFinite(mappingNum) && mappingNum === valueNum) {
            return color;
        }

        const mappingLower = mappingValue.toLowerCase();
        const mappingBool =
            mappingLower === "true" || mappingLower === "1"
                ? true
                : mappingLower === "false" || mappingLower === "0"
                    ? false
                    : null;
        if (valueBool != null && mappingBool != null && mappingBool === valueBool) {
            return color;
        }
    }

    return "";
}

function getOverlayHmiStateColor(overlay, rawState, stateStyleMapIndex = null) {
    const hmiStateStyleMappings = getHmiStateStyleMappingsForOverlay(overlay, stateStyleMapIndex);
    if (hmiStateStyleMappings.length) {
        const mappedPaint = resolveIgnitionStateMappingColor(hmiStateStyleMappings, rawState);
        if (mappedPaint) {
            return mappedPaint;
        }
        const fallbackPaint = getHmiStateStyleFallbackPaint(hmiStateStyleMappings);
        if (fallbackPaint) {
            return fallbackPaint;
        }
    }

    const binding = getOverlayFillBinding(overlay);
    const mappings = normalizeIgnitionFillBindingMappings(
        binding?.transform?.mappings
        ?? binding?.mappings
    );
    return resolveIgnitionStateMappingColor(mappings, rawState);
}

function toPositiveNumber(value) {
    const next = Number(value);
    return Number.isFinite(next) && next > 0 ? next : null;
}

function normalizeLocalCanvasZoom(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return 1;
    }
    return Math.min(
        LOCAL_CANVAS_ZOOM_MAX,
        Math.max(LOCAL_CANVAS_ZOOM_MIN, Math.round(num * 100) / 100)
    );
}

function readDefaultSizeCandidate(candidate) {
    if (!candidate) {
        return null;
    }

    try {
        if (typeof candidate.readObject === "function") {
            const readObjectValue = candidate.readObject("defaultSize", null);
            const width = toPositiveNumber(readObjectValue?.width);
            const height = toPositiveNumber(readObjectValue?.height);
            if (width && height) {
                return { width, height };
            }
        }
    } catch (_error) {
    }

    try {
        if (typeof candidate.read === "function") {
            const readValue = candidate.read("defaultSize", null);
            const width = toPositiveNumber(readValue?.width);
            const height = toPositiveNumber(readValue?.height);
            if (width && height) {
                return { width, height };
            }
        }
    } catch (_error) {
    }

    const width = toPositiveNumber(candidate?.defaultSize?.width ?? candidate?.width);
    const height = toPositiveNumber(candidate?.defaultSize?.height ?? candidate?.height);
    if (width && height) {
        return { width, height };
    }

    return null;
}

function escapeAttributeValue(value) {
    const raw = String(value || "");
    if (!raw) {
        return "";
    }
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(raw);
    }
    return raw
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

function readMeasuredComponentSize(componentProps) {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") {
        return null;
    }

    const nestedProps = getComponentPropSource(componentProps);
    const componentPaths = [
        componentProps?.store?.path,
        nestedProps?.store?.path
    ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

    let bestRect = null;
    let bestArea = -1;

    componentPaths.forEach((path) => {
        const selector = `[data-component-path="${escapeAttributeValue(path)}"]`;
        document.querySelectorAll(selector).forEach((node) => {
            if (!node || typeof node.getBoundingClientRect !== "function") {
                return;
            }
            const rect = node.getBoundingClientRect();
            const width = toPositiveNumber(rect.width);
            const height = toPositiveNumber(rect.height);
            if (!width || !height) {
                return;
            }
            const area = width * height;
            if (area > bestArea) {
                bestArea = area;
                bestRect = { width, height };
            }
        });
    });

    return bestRect;
}

function resolveCanvasHostSize(componentProps) {
    const nestedProps = getComponentPropSource(componentProps);
    const globalClient = typeof window !== "undefined" ? window.__client : null;
    const measuredSize = readMeasuredComponentSize(componentProps);
    if (measuredSize) {
        return measuredSize;
    }
    const candidates = [
        componentProps?.store?.view?.page?.rootView?.props,
        nestedProps?.store?.view?.page?.rootView?.props,
        componentProps?.store?.view?.page?.props,
        nestedProps?.store?.view?.page?.props,
        componentProps?.store?.view?.page?.rootView,
        nestedProps?.store?.view?.page?.rootView,
        globalClient?.store?.view?.page?.rootView?.props,
        globalClient?.store?.view?.page?.props,
        globalClient?.store?.view?.page?.rootView
    ];

    for (const candidate of candidates) {
        const resolved = readDefaultSizeCandidate(candidate);
        if (resolved) {
            return resolved;
        }
    }

    return {
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT
    };
}

function resolveCanvasDefaultSize(componentProps) {
    const nestedProps = getComponentPropSource(componentProps);
    const globalClient = typeof window !== "undefined" ? window.__client : null;
    const candidates = [
        componentProps?.store?.view?.page?.rootView?.props,
        nestedProps?.store?.view?.page?.rootView?.props,
        componentProps?.store?.view?.page?.props,
        nestedProps?.store?.view?.page?.props,
        componentProps?.store?.view?.page?.rootView,
        nestedProps?.store?.view?.page?.rootView,
        globalClient?.store?.view?.page?.rootView?.props,
        globalClient?.store?.view?.page?.props,
        globalClient?.store?.view?.page?.rootView
    ];

    for (const candidate of candidates) {
        const resolved = readDefaultSizeCandidate(candidate);
        if (resolved) {
            return resolved;
        }
    }

    return null;
}

function isAutoResizableViewBoxParts(x, y, width, height) {
    return x === 0
        && y === 0
        && (
            (width === 1200 && height === 800)
            || (width === DEFAULT_CANVAS_WIDTH && height === DEFAULT_CANVAS_HEIGHT)
        );
}

function normalizeViewBox(documentValue, fallbackSize = null) {
    const fallbackWidth = toPositiveNumber(fallbackSize?.width) || DEFAULT_CANVAS_WIDTH;
    const fallbackHeight = toPositiveNumber(fallbackSize?.height) || DEFAULT_CANVAS_HEIGHT;
    const viewBox = documentValue && documentValue.viewBox;
    if (typeof viewBox === "string" && viewBox.trim()) {
        const trimmed = viewBox.trim();
        if (fallbackSize) {
            const parts = trimmed.split(/[\s,]+/).map((value) => Number(value));
            if (
                parts.length === 4
                && parts.every(Number.isFinite)
                && isAutoResizableViewBoxParts(parts[0], parts[1], parts[2], parts[3])
            ) {
                return `0 0 ${fallbackWidth} ${fallbackHeight}`;
            }
        }
        return trimmed;
    }
    if (isPlainObject(viewBox)) {
        const x = Number(viewBox.x) || 0;
        const y = Number(viewBox.y) || 0;
        const width = Number(viewBox.width) || 100;
        const height = Number(viewBox.height) || 100;
        if (fallbackSize && isAutoResizableViewBoxParts(x, y, width, height)) {
            return `0 0 ${fallbackWidth} ${fallbackHeight}`;
        }
        return `${x} ${y} ${width} ${height}`;
    }
    return `0 0 ${fallbackWidth} ${fallbackHeight}`;
}

function parseViewBoxParts(raw) {
    const parts = String(raw || "")
        .trim()
        .split(/\s+/)
        .map((value) => Number(value));

    if (parts.length === 4 && parts.every(Number.isFinite)) {
        return {
            x: parts[0],
            y: parts[1],
            width: Math.max(1, parts[2]),
            height: Math.max(1, parts[3])
        };
    }

    return {
        x: 0,
        y: 0,
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT
    };
}

function readBrowserViewportHeight() {
    if (typeof window === "undefined") {
        return 0;
    }
    return (
        toPositiveNumber(window.visualViewport?.height)
        || toPositiveNumber(window.innerHeight)
        || 0
    );
}

function readBrowserViewportWidth() {
    if (typeof window === "undefined") {
        return 0;
    }
    return (
        toPositiveNumber(window.visualViewport?.width)
        || toPositiveNumber(window.innerWidth)
        || 0
    );
}

function resolveBrowserHeightCanvasZoom(
    rootNode,
    fallbackWidth,
    fallbackHeight,
    viewBoundsWidth,
    viewBoundsHeight,
    browserViewportWidth,
    browserViewportHeight
) {
    const targetViewWidth = toPositiveNumber(viewBoundsWidth) || DEFAULT_CANVAS_WIDTH;
    const targetViewHeight = toPositiveNumber(viewBoundsHeight) || DEFAULT_CANVAS_HEIGHT;
    const rect = rootNode && typeof rootNode.getBoundingClientRect === "function"
        ? rootNode.getBoundingClientRect()
        : null;
    const rootLeft = Math.max(0, Number(rect?.left || 0));
    const rootTop = Math.max(0, Number(rect?.top || 0));
    const hostWidth = toPositiveNumber(fallbackWidth) || toPositiveNumber(rect?.width) || 0;
    const hostHeight = toPositiveNumber(fallbackHeight) || toPositiveNumber(rect?.height) || 0;
    const viewportWidth = toPositiveNumber(browserViewportWidth) || 0;
    const viewportHeight = toPositiveNumber(browserViewportHeight) || 0;
    const availableBrowserWidth = viewportWidth > 0
        ? Math.max(1, viewportWidth - rootLeft)
        : 0;
    const availableBrowserHeight = viewportHeight > 0
        ? Math.max(1, viewportHeight - rootTop)
        : 0;
    const targetWidth = toPositiveNumber(hostWidth || availableBrowserWidth) || targetViewWidth;
    const targetHeight = toPositiveNumber(hostHeight || availableBrowserHeight) || targetViewHeight;
    const scaleByWidth = targetWidth / targetViewWidth;
    const scaleByHeight = targetHeight / targetViewHeight;
    return Math.max(0.05, Math.min(8, scaleByHeight));
}

function getModelValue(props, key, fallback) {
    const source = getComponentPropSource(props);
    const direct = source[key];
    if (direct !== undefined) {
        return direct;
    }
    if (isPlainObject(source.model) && source.model[key] !== undefined) {
        return source.model[key];
    }
    return fallback;
}

function detectPerspectivePreviewMode(props) {
    const nestedProps = getComponentPropSource(props);
    const parentStore = props?.store?.view?.page?.parent;
    const nestedParentStore = nestedProps?.store?.view?.page?.parent;
    const globalClient = typeof window !== "undefined" ? window.__client : null;
    const globalDesigner = typeof window !== "undefined" ? window._perspective_designer : null;

    if (typeof parentStore?.isPreviewing === "boolean") {
        return parentStore.isPreviewing;
    }

    if (typeof props?.store?.isPreviewing === "boolean") {
        return props.store.isPreviewing;
    }

    if (typeof nestedParentStore?.isPreviewing === "boolean") {
        return nestedParentStore.isPreviewing;
    }

    if (typeof nestedProps?.store?.isPreviewing === "boolean") {
        return nestedProps.store.isPreviewing;
    }

    if (typeof globalClient?.isPreviewing === "boolean") {
        return globalClient.isPreviewing;
    }

    if (typeof globalClient?.store?.isPreviewing === "boolean") {
        return globalClient.store.isPreviewing;
    }

    if (typeof globalDesigner?.isPreviewing === "boolean") {
        return globalDesigner.isPreviewing;
    }

    if (typeof globalDesigner?.store?.isPreviewing === "boolean") {
        return globalDesigner.store.isPreviewing;
    }

    if (typeof props?.eventsEnabled === "boolean") {
        return props.eventsEnabled;
    }

    if (typeof nestedProps?.eventsEnabled === "boolean") {
        return nestedProps.eventsEnabled;
    }

    if (globalDesigner || parentStore?.isDesigner === true || props?.store?.isDesigner === true) {
        return false;
    }

    return true;
}

function detectPerspectiveDesignerMode(props) {
    const parentStore = props?.store?.view?.page?.parent;
    const nestedProps = getComponentPropSource(props);
    const nestedParentStore = nestedProps?.store?.view?.page?.parent;
    const localStore = props?.store;
    const globalClient = typeof window !== "undefined" ? window.__client : null;
    const globalDesigner = typeof window !== "undefined" ? window._perspective_designer : null;
    const designerScope = typeof window !== "undefined"
        ? window.PerspectiveClient?.ClientScope?.Designer || "D"
        : "D";

    if (
        parentStore?.isDesigner === true
        || nestedParentStore?.isDesigner === true
        || localStore?.isDesigner === true
        || nestedProps?.store?.isDesigner === true
        || globalClient?.isDesigner === true
        || globalDesigner?.isDesigner === true
    ) {
        return true;
    }

    if (
        parentStore?.scope === designerScope
        || nestedParentStore?.scope === designerScope
        || localStore?.scope === designerScope
        || nestedProps?.store?.scope === designerScope
        || globalClient?.scope === designerScope
        || globalDesigner?.scope === designerScope
    ) {
        return true;
    }

    return Boolean(globalDesigner);
}

function getPersistedArrayValue(props, key, fallback = EMPTY_ARRAY) {
    const source = getComponentPropSource(props);
    const hasDirectValue = Object.prototype.hasOwnProperty.call(source, key);
    const hasModelValue = isPlainObject(source?.model)
        && Object.prototype.hasOwnProperty.call(source.model, key);
    const direct = hasDirectValue ? source[key] : undefined;
    const modelValue = hasModelValue ? source.model[key] : undefined;

    if (hasModelValue && Array.isArray(modelValue)) {
        return modelValue;
    }
    if (hasDirectValue && Array.isArray(direct)) {
        return direct;
    }
    if (Array.isArray(modelValue)) {
        return modelValue;
    }
    if (Array.isArray(direct)) {
        return direct;
    }
    return fallback;
}

function isSvgMarkup(value) {
    return typeof value === "string" && value.includes("<svg");
}

function parseLen(value) {
    if (value == null) {
        return null;
    }
    const next = Number.parseFloat(String(value).trim());
    return Number.isFinite(next) ? next : null;
}

function inferETypeFromFileKey(fileKey) {
    const raw = String(fileKey || "").trim();
    if (!raw) {
        return "";
    }
    const leaf = raw.split("/").pop() || raw;
    return leaf.replace(/\.svg$/i, "").trim();
}

function extractSvgEType(rawSvg, fileKey = "") {
    try {
        const doc = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
        const svg = doc.querySelector("svg");
        if (svg) {
            const direct =
                String(svg.getAttribute("eType") || "").trim()
                || String(svg.getAttribute("etype") || "").trim()
                || String(svg.getAttribute("data-etype") || "").trim();
            if (direct) {
                return direct;
            }
        }
    } catch (_error) {
    }
    return inferETypeFromFileKey(fileKey);
}

function hasExplicitSvgEType(rawSvg) {
    try {
        const doc = new DOMParser().parseFromString(String(rawSvg || ""), "image/svg+xml");
        const svg = doc.querySelector("svg");
        if (!svg) {
            return false;
        }
        const direct =
            String(svg.getAttribute("eType") || "").trim()
            || String(svg.getAttribute("etype") || "").trim()
            || String(svg.getAttribute("data-etype") || "").trim();
        if (direct) {
            return true;
        }
        return Boolean(svg.querySelector("[eType],[etype],[data-etype]"));
    } catch (_error) {
        return false;
    }
}

function extractKeySize(rawSvg) {
    try {
        const doc = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
        const svg = doc.querySelector("svg");
        if (!svg) {
            return null;
        }

        const rootWidth = parseLen(svg.getAttribute("kewidth"));
        const rootHeight = parseLen(svg.getAttribute("keheight"));
        if (rootWidth > 0 && rootHeight > 0) {
            return { w: rootWidth, h: rootHeight };
        }

        const keyedNode = svg.querySelector("[kewidth][keheight]");
        if (keyedNode) {
            const keyedWidth = parseLen(keyedNode.getAttribute("kewidth"));
            const keyedHeight = parseLen(keyedNode.getAttribute("keheight"));
            if (keyedWidth > 0 && keyedHeight > 0) {
                return { w: keyedWidth, h: keyedHeight };
            }
        }

        const widthAttr = parseLen(svg.getAttribute("width"));
        const heightAttr = parseLen(svg.getAttribute("height"));
        if (widthAttr > 0 && heightAttr > 0) {
            return { w: widthAttr, h: heightAttr };
        }

        const viewBox = svg.getAttribute("viewBox");
        if (viewBox) {
            const parts = viewBox.trim().split(/[\s,]+/).map(Number);
            if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3]) && parts[2] > 0 && parts[3] > 0) {
                return { w: parts[2], h: parts[3] };
            }
        }
    } catch (_error) {
    }

    return null;
}

function isOverlayETypeAutoManaged(overlay) {
    const value = overlay?.eTypeAuto;
    if (value === false) {
        return false;
    }
    if (typeof value === "string" && value.trim().toLowerCase() === "false") {
        return false;
    }
    return true;
}

function buildOverlaySourcePayload(raw, fileKey = "") {
    if (typeof raw !== "string") {
        return null;
    }
    const parsed = stripOuterSvg(raw);
    if (!parsed?.inner) {
        return null;
    }

    const keySize = extractKeySize(raw);
    const parsedEType = extractSvgEType(raw, fileKey);
    const sourceHadEType = hasExplicitSvgEType(raw);
    const baseViewBox = parsed.vb;
    let localViewBox = keySize
        ? { x: 0, y: 0, w: keySize.w, h: keySize.h }
        : baseViewBox;

    if (!localViewBox || !Number.isFinite(localViewBox.w) || !Number.isFinite(localViewBox.h) || localViewBox.w <= 0 || localViewBox.h <= 0) {
        localViewBox = { x: 0, y: 0, w: 100, h: 100 };
    }

    let inner = parsed.inner;
    let sourceScaleX = 1;
    let sourceScaleY = 1;
    if (keySize && baseViewBox?.w > 0 && baseViewBox?.h > 0) {
        const scaleX = keySize.w / baseViewBox.w;
        const scaleY = keySize.h / baseViewBox.h;
        sourceScaleX = scaleX;
        sourceScaleY = scaleY;
        inner = `
      <g transform="translate(${-baseViewBox.x},${-baseViewBox.y}) scale(${scaleX},${scaleY})">
        ${parsed.inner}
      </g>
    `;
    }

    return {
        inner,
        eType: parsedEType,
        sourceHadEType,
        bbox: {
            x: localViewBox.x,
            y: localViewBox.y,
            width: localViewBox.w,
            height: localViewBox.h
        },
        sourceScaleX,
        sourceScaleY
    };
}

function nearlyEqual(left, right, epsilon = 0.0001) {
    return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

function sameOverlayBbox(left, right) {
    return Boolean(left && right)
        && nearlyEqual(left.x, right.x)
        && nearlyEqual(left.y, right.y)
        && nearlyEqual(left.width, right.width)
        && nearlyEqual(left.height, right.height);
}

function refreshOverlayFromSourcePayload(overlay, payload) {
    if (!overlay || !payload?.inner || !payload?.bbox) {
        return overlay;
    }

    const previousBounds = getOverlayBounds(overlay);
    const nextBbox = payload.bbox;
    const nextScaleX = previousBounds
        ? Math.max(0.0001, Number(previousBounds.width || 0) / Math.max(1e-6, Number(nextBbox.width || 0)))
        : overlayScaleX(overlay);
    const nextScaleY = previousBounds
        ? Math.max(0.0001, Number(previousBounds.height || 0) / Math.max(1e-6, Number(nextBbox.height || 0)))
        : overlayScaleY(overlay);
    const nextTx = previousBounds
        ? Number(previousBounds.x || 0) - nextScaleX * Number(nextBbox.x || 0)
        : Number(overlay?.tx || 0);
    const nextTy = previousBounds
        ? Number(previousBounds.y || 0) - nextScaleY * Number(nextBbox.y || 0)
        : Number(overlay?.ty || 0);
    const nextEType = isOverlayETypeAutoManaged(overlay)
        ? String(payload.eType || overlay?.eType || "").trim()
        : String(overlay?.eType || payload.eType || "").trim();
    const sourceHadEType = Boolean(payload.sourceHadEType ?? overlay?.sourceHadEType);
    const defaultFill = sourceHadEType ? "" : DEFAULT_FILL;
    const defaultStroke = sourceHadEType ? "" : DEFAULT_STROKE;

    let nextOverlay = {
        ...overlay,
        inner: payload.inner,
        bbox: nextBbox,
        tx: nextTx,
        ty: nextTy,
        scale: nextScaleX,
        scaleX: nextScaleX,
        scaleY: nextScaleY,
        fill: overlay?.fill || defaultFill,
        stroke: overlay?.stroke || defaultStroke,
        strokeMode: overlay?.strokeMode || "preserve",
        eType: nextEType,
        eTypeAuto: isOverlayETypeAutoManaged(overlay),
        sourceHadEType,
        popupParamsJson: overlay?.popupParamsJson || "{}",
        sourceScaleX: payload.sourceScaleX,
        sourceScaleY: payload.sourceScaleY
    };

    const tagPath = String(nextOverlay.tagPath || getOverlayFillBindingTagPath(nextOverlay) || "").trim();
    const bindingPath = String(getOverlayFillBindingTagPath(overlay) || "").trim();
    const needsFillBinding = Boolean(
        tagPath
        && !nextOverlay.widget
        && !nextOverlay.embeddedView
        && !isStaticSvgOverlay(nextOverlay)
        && (!getOverlayFillBinding(overlay) || bindingPath !== tagPath)
    );
    if (needsFillBinding) {
        nextOverlay = applyOverlayIgnitionFillBinding(nextOverlay, tagPath);
    }

    const changed =
        String(overlay?.inner || "") !== String(nextOverlay.inner || "")
        || !sameOverlayBbox(overlay?.bbox, nextOverlay.bbox)
        || !nearlyEqual(overlay?.tx, nextOverlay.tx, 0.001)
        || !nearlyEqual(overlay?.ty, nextOverlay.ty, 0.001)
        || !nearlyEqual(overlayScaleX(overlay), overlayScaleX(nextOverlay))
        || !nearlyEqual(overlayScaleY(overlay), overlayScaleY(nextOverlay))
        || String(overlay?.eType || "") !== String(nextOverlay.eType || "")
        || Boolean(overlay?.sourceHadEType) !== Boolean(nextOverlay.sourceHadEType)
        || String(overlay?.strokeMode || "") !== String(nextOverlay.strokeMode || "")
        || String(overlay?.popupParamsJson || "") !== String(nextOverlay.popupParamsJson || "")
        || !nearlyEqual(overlay?.sourceScaleX || 1, nextOverlay.sourceScaleX || 1)
        || !nearlyEqual(overlay?.sourceScaleY || 1, nextOverlay.sourceScaleY || 1)
        || JSON.stringify(overlay?.bindings || null) !== JSON.stringify(nextOverlay.bindings || null);

    return changed ? nextOverlay : overlay;
}

function createId(prefix = "id") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeSvgCatalogEntries(value) {
    return (Array.isArray(value) ? value : [])
        .map((entry) => {
            const key = String(entry?.key || "").trim();
            const name = String(entry?.name || key.split("/").pop() || "").trim();
            const urls = [];
            coerceArray(entry?.urlCandidates).forEach((candidate) => {
                const next = String(candidate || "").trim();
                if (next && !urls.includes(next)) {
                    urls.push(next);
                }
            });
            const directUrl = String(entry?.url || "").trim();
            if (directUrl && !urls.includes(directUrl)) {
                urls.push(directUrl);
            }
            if (!key || !name || !urls.length) {
                return null;
            }
            return {
                key,
                name,
                source: String(entry?.source || "").trim(),
                url: urls.length === 1 ? urls[0] : urls
            };
        })
        .filter(Boolean);
}

function normalizeSvgCatalogPayload(value) {
    const payload = value && typeof value === "object" && !Array.isArray(value)
        ? value
        : { entries: value };

    return {
        entries: normalizeSvgCatalogEntries(payload?.entries),
        externalDirectory: String(payload?.externalDirectory || "").trim(),
        externalCount: Math.max(0, Number(payload?.externalCount) || 0),
        builtInCount: Math.max(0, Number(payload?.builtInCount) || 0),
        error: String(payload?.error || "").trim()
    };
}

function writeComponentProp(props, path, value) {
    const sanitizePerspectiveValue = (nextValue) => {
        if (nextValue === undefined || nextValue === null) {
            return undefined;
        }

        if (Array.isArray(nextValue)) {
            return nextValue
                .map((item) => sanitizePerspectiveValue(item))
                .filter((item) => item !== undefined);
        }

        if (isPlainObject(nextValue)) {
            return Object.entries(nextValue).reduce((acc, [key, entryValue]) => {
                const sanitizedEntry = sanitizePerspectiveValue(entryValue);
                if (sanitizedEntry !== undefined) {
                    acc[key] = sanitizedEntry;
                }
                return acc;
            }, {});
        }

        return nextValue;
    };

    const candidatePaths = path.startsWith("model.") ? [path] : [path, `model.${path}`];
    const writers = [];
    const sanitizedValue = sanitizePerspectiveValue(value);

    if (sanitizedValue === undefined) {
        return false;
    }

    if (props?.store?.props && typeof props.store.props.write === "function") {
        writers.push(props.store.props.write.bind(props.store.props));
    }
    if (props?.store && typeof props.store.write === "function") {
        writers.push(props.store.write.bind(props.store));
    }

    let wrote = false;
    writers.forEach((writePath) => {
        candidatePaths.forEach((candidatePath) => {
            try {
                writePath(candidatePath, sanitizedValue);
                wrote = true;
            } catch (_error) {
            }
        });
    });

    return wrote;
}

function getPerspectiveClientStore(props) {
    const nestedProps = getComponentPropSource(props);
    return (
        props?.store?.view?.page?.parent
        || nestedProps?.store?.view?.page?.parent
        || props?.store?.page?.parent
        || nestedProps?.store?.page?.parent
        || (typeof window !== "undefined" ? window.__client : null)
        || (typeof window !== "undefined" ? window._perspective_designer?.store?.page?.parent : null)
        || null
    );
}

function normalizeOverlayPopupViewName(value) {
    return String(value || "")
        .trim()
        .replace(/\.svg$/i, "")
        .replace(/^\/+|\/+$/g, "");
}

function resolveOverlayPopupViewName(overlay) {
    const popupViewName = normalizeOverlayPopupViewName(
        overlay?.eType
        || overlay?.name
        || overlay?.sourceKey
    );
    if (!popupViewName) {
        return "";
    }

    const eTypeToken = String(overlay?.eType || "").trim();
    const popupLeaf = popupViewName.split(/[\\/]/).pop() || popupViewName;
    if (usesTwoWayUdtTypeToken(eTypeToken) || usesTwoWayUdtTypeToken(popupLeaf)) {
        return "TwoWay_DiscreteV2";
    }
    return popupViewName;
}

function resolveOverlayPopupViewPath(overlay) {
    const popupViewName = resolveOverlayPopupViewName(overlay);
    if (!popupViewName) {
        return "";
    }
    if (/^Terra\/Popups\//i.test(popupViewName)) {
        return popupViewName;
    }
    if (/^Popups\//i.test(popupViewName)) {
        return `Terra/${popupViewName}`;
    }
    return `Terra/Popups/${popupViewName}`;
}

function parsePopupParamsObject(value) {
    if (isPlainObject(value)) {
        return cloneDeepValue(value);
    }
    const raw = String(value ?? "").trim();
    if (!raw) {
        return {};
    }
    try {
        const parsed = JSON.parse(raw);
        return isPlainObject(parsed) ? parsed : {};
    } catch (_error) {
        return {};
    }
}

function applyPopupParamPlaceholders(value, context) {
    if (typeof value === "string") {
        return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => (
            Object.prototype.hasOwnProperty.call(context, key)
                ? String(context[key] ?? "")
                : match
        ));
    }
    if (Array.isArray(value)) {
        return value.map((entry) => applyPopupParamPlaceholders(entry, context));
    }
    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, applyPopupParamPlaceholders(entry, context)])
        );
    }
    return value;
}

function resolveOverlayPopupParams(overlay, baseParams) {
    const rawParams =
        overlay?.popupParamsJson
        ?? overlay?.popupParams
        ?? overlay?.popupParametersJson
        ?? overlay?.popupParameters
        ?? {};
    return applyPopupParamPlaceholders(parsePopupParamsObject(rawParams), baseParams);
}

function pointsEqual(left, right) {
    return Math.abs(Number(left?.x || 0) - Number(right?.x || 0)) < 0.001
        && Math.abs(Number(left?.y || 0) - Number(right?.y || 0)) < 0.001;
}

function clonePoints(points) {
    return (Array.isArray(points) ? points : []).map((point) => ({
        x: Number(point?.x || 0),
        y: Number(point?.y || 0)
    }));
}

function buildShapeSnapshot(shape) {
    if (!shape || typeof shape !== "object") {
        return null;
    }
    if (shape.type === "text") {
        return {
            id: String(shape.id || ""),
            kind: "text",
            x: Number(shape.x || 0),
            y: Number(shape.y || 0)
        };
    }
    if (Array.isArray(shape.points)) {
        return {
            id: String(shape.id || ""),
            kind: "polyline",
            points: clonePoints(shape.points)
        };
    }
    return {
        id: String(shape.id || ""),
        kind: String(shape.type || "shape"),
        x: Number(shape.x || 0),
        y: Number(shape.y || 0),
        width: Number(shape.width || 0),
        height: Number(shape.height || 0)
    };
}

function applyShapeSnapshotDelta(shape, snapshot, dx, dy) {
    if (!shape || !snapshot) {
        return shape;
    }
    if (snapshot.kind === "text") {
        return {
            ...shape,
            x: snapshot.x + dx,
            y: snapshot.y + dy
        };
    }
    if (snapshot.kind === "polyline") {
        return {
            ...shape,
            points: snapshot.points.map((point) => ({
                x: point.x + dx,
                y: point.y + dy
            }))
        };
    }
    return {
        ...shape,
        x: snapshot.x + dx,
        y: snapshot.y + dy,
        width: snapshot.width,
        height: snapshot.height
    };
}

function buildOverlayDragSnapshot(overlay) {
    if (!overlay || typeof overlay !== "object") {
        return null;
    }
    return {
        id: String(overlay.id || ""),
        tx: Number(overlay.tx || 0),
        ty: Number(overlay.ty || 0)
    };
}

function buildShapeResizeSnapshot(shape) {
    if (!shape || typeof shape !== "object") {
        return null;
    }
    return {
        id: String(shape.id || ""),
        type: String(shape.type || ""),
        x: Number(shape.x || 0),
        y: Number(shape.y || 0),
        width: Number(shape.width || 0),
        height: Number(shape.height || 0),
        fontSize: Number(shape.fontSize || 24),
        points: Array.isArray(shape.points) ? clonePoints(shape.points) : null
    };
}

function applyShapeResizeSnapshot(shape, snapshot, startBounds, nextBounds) {
    if (!shape || !snapshot || !startBounds || !nextBounds) {
        return shape;
    }

    const baseWidth = Math.max(1, Number(startBounds.width || 0));
    const baseHeight = Math.max(1, Number(startBounds.height || 0));
    const scaleX = Math.max(0.0001, Number(nextBounds.width || 0) / baseWidth);
    const scaleY = Math.max(0.0001, Number(nextBounds.height || 0) / baseHeight);
    const nextX = Number(nextBounds.x || 0) + (Number(snapshot.x || 0) - Number(startBounds.x || 0)) * scaleX;
    const nextY = Number(nextBounds.y || 0) + (Number(snapshot.y || 0) - Number(startBounds.y || 0)) * scaleY;

    if (Array.isArray(snapshot.points)) {
        return {
            ...shape,
            points: snapshot.points.map((point) => ({
                x: Number(nextBounds.x || 0) + (Number(point.x || 0) - Number(startBounds.x || 0)) * scaleX,
                y: Number(nextBounds.y || 0) + (Number(point.y || 0) - Number(startBounds.y || 0)) * scaleY
            }))
        };
    }

    if (snapshot.type === "text") {
        return {
            ...shape,
            x: nextX,
            y: nextY,
            fontSize: Math.max(8, Number(snapshot.fontSize || 24) * ((scaleX + scaleY) / 2))
        };
    }

    return {
        ...shape,
        x: nextX,
        y: nextY,
        width: Math.max(1, Number(snapshot.width || 0) * scaleX),
        height: Math.max(1, Number(snapshot.height || 0) * scaleY)
    };
}

function dist2(left, right) {
    const dx = Number(left?.x || 0) - Number(right?.x || 0);
    const dy = Number(left?.y || 0) - Number(right?.y || 0);
    return dx * dx + dy * dy;
}

function closestPointOnSegment(point, start, end) {
    const ax = Number(start?.x || 0);
    const ay = Number(start?.y || 0);
    const bx = Number(end?.x || 0);
    const by = Number(end?.y || 0);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 1e-9) {
        return { x: ax, y: ay };
    }
    const px = Number(point?.x || 0);
    const py = Number(point?.y || 0);
    const t = clamp((((px - ax) * dx) + ((py - ay) * dy)) / lengthSquared, 0, 1);
    return {
        x: ax + t * dx,
        y: ay + t * dy
    };
}

function resizeCursorForCorner(corner) {
    const key = String(corner || "").toUpperCase();
    if (key === "L" || key === "R") return "ew-resize";
    if (key === "T" || key === "B") return "ns-resize";
    return key === "TR" || key === "BL" ? "nesw-resize" : "nwse-resize";
}

function cloneDeepValue(value) {
    if (typeof globalThis.structuredClone === "function") {
        return globalThis.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function DockSection({ children, title }) {
    return (
        <div style={{ display: "grid", gap: 6 }}>
            {title ? (
                <div
                    style={{
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "rgba(226, 232, 240, 0.72)"
                    }}
                >
                    {title}
                </div>
            ) : null}
            <div style={{ display: "grid", gap: 6 }}>
                {children}
            </div>
        </div>
    );
}

function DockButton({ active = false, children, disabled = false, onClick }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            style={{
                width: "100%",
                border: active ? "1px solid rgba(96, 165, 250, 0.8)" : "1px solid rgba(71, 85, 105, 0.9)",
                background: active ? "linear-gradient(180deg, #4f8cff 0%, #3567f3 100%)" : "rgba(15, 23, 42, 0.9)",
                color: "#f8fafc",
                borderRadius: 10,
                padding: "7px 10px",
                minHeight: 34,
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: disabled ? "default" : "pointer",
                fontSize: 12,
                fontWeight: 700,
                boxShadow: active ? "0 10px 24px rgba(37, 99, 235, 0.28)" : "none",
                opacity: disabled ? 0.58 : 1
            }}
        >
            {children}
        </button>
    );
}

function isInteractiveEditorTarget(target) {
    if (!target || typeof target !== "object") {
        return false;
    }
    const tag = String(target.tagName || "").toLowerCase();
    if (
        tag === "input"
        || tag === "textarea"
        || tag === "select"
        || tag === "button"
        || target.isContentEditable === true
    ) {
        return true;
    }
    return typeof target.closest === "function"
        && Boolean(target.closest("[data-vizi-properties-panel='1'], [data-vizi-import-drawer='1'], [data-vizi-widget-drawer='1'], [data-vizi-dropdown='1'], [data-vizi-dropdown-menu='1'], [data-vizi-quick-svg-picker='1'], [data-vizi-quick-tag-picker='1']"));
}

function stopInteractivePropagation(event) {
    event?.stopPropagation?.();
}

function copyTextToClipboard(value) {
    const text = String(value ?? "").trim();
    if (!text || typeof window === "undefined" || typeof document === "undefined") {
        return;
    }

    if (window.navigator?.clipboard?.writeText) {
        window.navigator.clipboard.writeText(text).catch(() => {
            copyTextToClipboardFallback(text);
        });
        return;
    }

    copyTextToClipboardFallback(text);
}

function copyTextToClipboardFallback(text) {
    try {
        const textarea = document.createElement("textarea");
        textarea.value = String(text ?? "");
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
    } catch (_error) {
    }
}

function PropertySection({ children, title }) {
    return (
        <div style={{ display: "grid", gap: 10 }}>
            {title ? (
                <div
                    style={{
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "rgba(226, 232, 240, 0.72)"
                    }}
                >
                    {title}
                </div>
            ) : null}
            <div style={{ display: "grid", gap: 10 }}>
                {children}
            </div>
        </div>
    );
}

function PropertyField({ disabled = false, label, onCommit, placeholder = "", value = "" }) {
    const [draft, setDraft] = useState(value == null ? "" : String(value));

    useEffect(() => {
        setDraft(value == null ? "" : String(value));
    }, [value]);

    const commit = useCallback(() => {
        if (disabled || typeof onCommit !== "function") {
            return;
        }
        onCommit(draft);
    }, [disabled, draft, onCommit]);

    return (
        <label
            style={{ display: "grid", gap: 5 }}
            onMouseDown={stopInteractivePropagation}
            onClick={stopInteractivePropagation}
            onDoubleClick={stopInteractivePropagation}
        >
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(226, 232, 240, 0.88)" }}>
                {label}
            </span>
            <input
                type="text"
                value={draft}
                disabled={disabled}
                placeholder={placeholder}
                onChange={(event) => {
                    setDraft(event.target.value);
                }}
                onBlur={commit}
                onFocus={stopInteractivePropagation}
                onPointerDown={stopInteractivePropagation}
                onMouseDown={stopInteractivePropagation}
                onMouseUp={stopInteractivePropagation}
                onClick={stopInteractivePropagation}
                onDoubleClick={stopInteractivePropagation}
                onKeyDown={(event) => {
                    stopInteractivePropagation(event);
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commit();
                        event.currentTarget.blur();
                    }
                }}
                onKeyUp={stopInteractivePropagation}
                style={{
                    width: "100%",
                    height: 36,
                    boxSizing: "border-box",
                    borderRadius: 10,
                    border: "1px solid rgba(71, 85, 105, 0.9)",
                    background: disabled ? "rgba(15, 23, 42, 0.55)" : "rgba(15, 23, 42, 0.92)",
                    color: "#f8fafc",
                    padding: "0 10px",
                    fontSize: 12,
                    fontWeight: 600,
                    opacity: disabled ? 0.78 : 1
                }}
            />
        </label>
    );
}

function PropertyColorField({ disabled = false, label, onCommit, placeholder = "#e2e8f0", value = "" }) {
    const [draft, setDraft] = useState(value == null ? "" : String(value));

    useEffect(() => {
        setDraft(value == null ? "" : String(value));
    }, [value]);

    const swatchValue = useMemo(() => {
        const text = String(draft || "").trim();
        if (/^#[0-9a-f]{6}$/i.test(text)) {
            return text;
        }
        if (/^#[0-9a-f]{3}$/i.test(text)) {
            return `#${text.slice(1).split("").map((ch) => `${ch}${ch}`).join("")}`;
        }
        return placeholder;
    }, [draft, placeholder]);

    const commit = useCallback((nextValue = draft) => {
        if (disabled || typeof onCommit !== "function") {
            return;
        }
        onCommit(String(nextValue ?? "").trim());
    }, [disabled, draft, onCommit]);

    return (
        <label
            style={{ display: "grid", gap: 5 }}
            onMouseDown={stopInteractivePropagation}
            onClick={stopInteractivePropagation}
            onDoubleClick={stopInteractivePropagation}
        >
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(226, 232, 240, 0.88)" }}>
                {label}
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "40px minmax(0, 1fr)", gap: 8 }}>
                <input
                    type="color"
                    value={swatchValue}
                    disabled={disabled}
                    onChange={(event) => {
                        const next = event.target.value;
                        setDraft(next);
                        commit(next);
                    }}
                    onFocus={stopInteractivePropagation}
                    onPointerDown={stopInteractivePropagation}
                    onMouseDown={stopInteractivePropagation}
                    onMouseUp={stopInteractivePropagation}
                    onClick={stopInteractivePropagation}
                    onDoubleClick={stopInteractivePropagation}
                    style={{
                        width: "100%",
                        height: 36,
                        boxSizing: "border-box",
                        borderRadius: 10,
                        border: "1px solid rgba(71, 85, 105, 0.9)",
                        background: disabled ? "rgba(15, 23, 42, 0.55)" : "rgba(15, 23, 42, 0.92)",
                        padding: 4,
                        cursor: disabled ? "default" : "pointer",
                        opacity: disabled ? 0.78 : 1
                    }}
                />
                <input
                    type="text"
                    value={draft}
                    disabled={disabled}
                    placeholder={placeholder}
                    onChange={(event) => {
                        setDraft(event.target.value);
                    }}
                    onBlur={() => commit()}
                    onFocus={stopInteractivePropagation}
                    onPointerDown={stopInteractivePropagation}
                    onMouseDown={stopInteractivePropagation}
                    onMouseUp={stopInteractivePropagation}
                    onClick={stopInteractivePropagation}
                    onDoubleClick={stopInteractivePropagation}
                    onKeyDown={(event) => {
                        stopInteractivePropagation(event);
                        if (event.key === "Enter") {
                            event.preventDefault();
                            commit();
                            event.currentTarget.blur();
                        }
                    }}
                    onKeyUp={stopInteractivePropagation}
                    style={{
                        width: "100%",
                        height: 36,
                        boxSizing: "border-box",
                        borderRadius: 10,
                        border: "1px solid rgba(71, 85, 105, 0.9)",
                        background: disabled ? "rgba(15, 23, 42, 0.55)" : "rgba(15, 23, 42, 0.92)",
                        color: "#f8fafc",
                        padding: "0 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        opacity: disabled ? 0.78 : 1
                    }}
                />
            </div>
        </label>
    );
}

function PropertyCheckbox({ checked = false, disabled = false, label, onChange }) {
    return (
        <label
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minHeight: 36,
                color: "#f8fafc",
                fontSize: 12,
                fontWeight: 800,
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.72 : 1
            }}
            onMouseDown={stopInteractivePropagation}
            onClick={stopInteractivePropagation}
            onDoubleClick={stopInteractivePropagation}
        >
            <input
                type="checkbox"
                checked={Boolean(checked)}
                disabled={disabled}
                onChange={(event) => {
                    if (!disabled && typeof onChange === "function") {
                        onChange(Boolean(event.target.checked));
                    }
                }}
                onFocus={stopInteractivePropagation}
                onPointerDown={stopInteractivePropagation}
                onMouseDown={stopInteractivePropagation}
                onMouseUp={stopInteractivePropagation}
                onClick={stopInteractivePropagation}
                onDoubleClick={stopInteractivePropagation}
                onKeyDown={stopInteractivePropagation}
                onKeyUp={stopInteractivePropagation}
                style={{
                    width: 16,
                    height: 16,
                    accentColor: "#2563eb",
                    cursor: disabled ? "default" : "pointer"
                }}
            />
            <span>{label}</span>
        </label>
    );
}

function PropertyTextArea({ disabled = false, label, onCommit, placeholder = "", rows = 5, value = "" }) {
    const [draft, setDraft] = useState(value == null ? "" : String(value));

    useEffect(() => {
        setDraft(value == null ? "" : String(value));
    }, [value]);

    const commit = useCallback(() => {
        if (disabled || typeof onCommit !== "function") {
            return;
        }
        onCommit(draft);
    }, [disabled, draft, onCommit]);

    return (
        <label
            style={{ display: "grid", gap: 5 }}
            onMouseDown={stopInteractivePropagation}
            onClick={stopInteractivePropagation}
            onDoubleClick={stopInteractivePropagation}
        >
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(226, 232, 240, 0.88)" }}>
                {label}
            </span>
            <textarea
                value={draft}
                disabled={disabled}
                placeholder={placeholder}
                rows={rows}
                onChange={(event) => {
                    setDraft(event.target.value);
                }}
                onBlur={commit}
                onFocus={stopInteractivePropagation}
                onPointerDown={stopInteractivePropagation}
                onMouseDown={stopInteractivePropagation}
                onMouseUp={stopInteractivePropagation}
                onClick={stopInteractivePropagation}
                onDoubleClick={stopInteractivePropagation}
                onKeyDown={stopInteractivePropagation}
                onKeyUp={stopInteractivePropagation}
                style={{
                    width: "100%",
                    minHeight: Math.max(84, rows * 18),
                    boxSizing: "border-box",
                    borderRadius: 10,
                    border: "1px solid rgba(71, 85, 105, 0.9)",
                    background: disabled ? "rgba(15, 23, 42, 0.55)" : "rgba(15, 23, 42, 0.92)",
                    color: "#f8fafc",
                    padding: "10px",
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 1.45,
                    resize: "vertical",
                    opacity: disabled ? 0.78 : 1
                }}
            />
        </label>
    );
}

function splitIgnitionProviderPath(rawPath) {
    const path = String(rawPath || "").replace(/\r?\n/g, "").trim();
    const providerMatch = path.match(/^(\[[^\]]+\])(.*)$/);
    if (!providerMatch) {
        return { prefix: "", body: path };
    }
    return {
        prefix: providerMatch[1],
        body: String(providerMatch[2] || "").replace(/^[\\/]+/, "")
    };
}

function getIgnitionTagParentPath(rawPath) {
    const { prefix, body } = splitIgnitionProviderPath(rawPath);
    const text = String(body || "").trim();
    if (!text) {
        return "";
    }
    const slashIndex = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
    const dotIndex = text.lastIndexOf(".");
    const splitIndex = Math.max(slashIndex, dotIndex);
    if (splitIndex <= 0) {
        return "";
    }
    return `${prefix}${text.slice(0, splitIndex)}`;
}

function getIgnitionTagAncestorPaths(rawPath) {
    const out = [];
    let parent = getIgnitionTagParentPath(rawPath);
    const seen = new Set();
    while (parent && !seen.has(parent.toLowerCase())) {
        out.push(parent);
        seen.add(parent.toLowerCase());
        parent = getIgnitionTagParentPath(parent);
    }
    return out;
}

function getIgnitionTagLeafName(rawPath) {
    const { body } = splitIgnitionProviderPath(rawPath);
    const text = String(body || rawPath || "").trim();
    const slashIndex = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
    const dotIndex = text.lastIndexOf(".");
    const splitIndex = Math.max(slashIndex, dotIndex);
    return splitIndex >= 0 ? text.slice(splitIndex + 1) : text;
}

function EditorDropdownField({
    disabled = false,
    helperText = "",
    helperTone = "muted",
    label,
    onChange,
    onOpen,
    placeholder = "Select...",
    searchable = false,
    searchPlaceholder = "Search...",
    sections = EMPTY_ARRAY,
    value = ""
}) {
    const rootRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const normalizedValue = value == null ? "" : String(value);
    const normalizedSections = coerceArray(sections)
        .map((section) => ({
            label: String(section?.label || "").trim(),
            items: coerceArray(section?.items)
                .map((item) => {
                    const itemValue = String(item?.value ?? "");
                    const itemLabel = String(item?.label || itemValue).trim();
                    if (!itemLabel) {
                        return null;
                    }
                    return {
                        value: itemValue,
                        label: itemLabel
                    };
                })
                .filter(Boolean)
        }))
        .filter((section) => section.items.length > 0);

    const selectedItem = normalizedSections
        .flatMap((section) => section.items)
        .find((item) => item.value === normalizedValue);
    const displayLabel = selectedItem?.label || placeholder;
    const queryText = String(query || "").trim().toLowerCase();
    const visibleSections = queryText
        ? normalizedSections
            .map((section) => ({
                ...section,
                items: section.items.filter((item) =>
                    `${section.label || ""} ${item.label || ""} ${item.value || ""}`.toLowerCase().includes(queryText)
                )
            }))
            .filter((section) => section.items.length > 0)
        : normalizedSections;

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const handleWindowPointerDown = (event) => {
            const root = rootRef.current;
            if (root && root.contains(event.target)) {
                return;
            }
            setOpen(false);
            setQuery("");
        };
        window.addEventListener("pointerdown", handleWindowPointerDown, true);
        return () => {
            window.removeEventListener("pointerdown", handleWindowPointerDown, true);
        };
    }, [open]);

    return (
        <div
            ref={rootRef}
            data-vizi-dropdown="1"
            style={{ display: "grid", gap: 5 }}
            onMouseDown={stopInteractivePropagation}
            onClick={stopInteractivePropagation}
            onDoubleClick={stopInteractivePropagation}
        >
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(226, 232, 240, 0.88)" }}>
                {label}
            </span>
            <div style={{ position: "relative" }}>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={(event) => {
                        stopInteractivePropagation(event);
                        if (!disabled) {
                            setOpen((current) => {
                                const next = !current;
                                if (next && typeof onOpen === "function") {
                                    onOpen();
                                }
                                if (!next) {
                                    setQuery("");
                                }
                                return next;
                            });
                        }
                    }}
                    onPointerDown={stopInteractivePropagation}
                    onMouseDown={stopInteractivePropagation}
                    onMouseUp={stopInteractivePropagation}
                    onDoubleClick={stopInteractivePropagation}
                    style={{
                        width: "100%",
                        minHeight: 36,
                        boxSizing: "border-box",
                        borderRadius: 10,
                        border: "1px solid rgba(71, 85, 105, 0.9)",
                        background: disabled ? "rgba(15, 23, 42, 0.55)" : "rgba(15, 23, 42, 0.92)",
                        color: "#f8fafc",
                        padding: "8px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        cursor: disabled ? "default" : "pointer",
                        opacity: disabled ? 0.78 : 1,
                        textAlign: "left"
                    }}
                >
                    <span
                        style={{
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                        }}
                    >
                        {displayLabel}
                    </span>
                    <span style={{ color: "rgba(226, 232, 240, 0.72)", fontSize: 11 }}>
                        {open ? "▲" : "▼"}
                    </span>
                </button>

                {open && !disabled ? (
                    <div
                        data-vizi-dropdown-menu="1"
                        className="vizi-scroll"
                        style={{
                            marginTop: 6,
                            overflowY: "auto",
                            maxHeight: 220,
                            padding: 8,
                            borderRadius: 12,
                            border: "1px solid rgba(71, 85, 105, 0.92)",
                            background: "rgba(2, 6, 23, 0.98)",
                            boxShadow: "0 20px 40px rgba(2, 6, 23, 0.38)",
                            display: "grid",
                            gap: 6
                        }}
                        onPointerDown={stopInteractivePropagation}
                        onMouseDown={stopInteractivePropagation}
                        onMouseUp={stopInteractivePropagation}
                        onClick={stopInteractivePropagation}
                        onDoubleClick={stopInteractivePropagation}
                    >
                        {searchable ? (
                            <input
                                type="text"
                                value={query}
                                placeholder={searchPlaceholder}
                                onChange={(event) => setQuery(event.target.value)}
                                onPointerDown={stopInteractivePropagation}
                                onMouseDown={stopInteractivePropagation}
                                onMouseUp={stopInteractivePropagation}
                                onClick={stopInteractivePropagation}
                                style={{
                                    width: "100%",
                                    minHeight: 32,
                                    boxSizing: "border-box",
                                    borderRadius: 9,
                                    border: "1px solid rgba(71, 85, 105, 0.9)",
                                    background: "rgba(15, 23, 42, 0.95)",
                                    color: "#f8fafc",
                                    padding: "7px 9px",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    outline: "none"
                                }}
                            />
                        ) : null}
                        {visibleSections.map((section, sectionIndex) => (
                            <div key={`${section.label || "section"}-${sectionIndex}`} style={{ display: "grid", gap: 4 }}>
                                {section.label ? (
                                    <div
                                        style={{
                                            padding: "2px 6px 4px",
                                            fontSize: 10,
                                            fontWeight: 800,
                                            letterSpacing: "0.08em",
                                            textTransform: "uppercase",
                                            color: "rgba(148, 163, 184, 0.88)"
                                        }}
                                    >
                                        {section.label}
                                    </div>
                                ) : null}
                                {section.items.map((item) => {
                                    const active = item.value === normalizedValue;
                                    return (
                                        <button
                                            key={`${section.label || "option"}-${item.value}-${item.label}`}
                                            type="button"
                                            onClick={(event) => {
                                                stopInteractivePropagation(event);
                                                setOpen(false);
                                                setQuery("");
                                                if (typeof onChange === "function") {
                                                    onChange(item.value);
                                                }
                                            }}
                                            onPointerDown={stopInteractivePropagation}
                                            onMouseDown={stopInteractivePropagation}
                                            onMouseUp={stopInteractivePropagation}
                                            style={{
                                                width: "100%",
                                                border: active ? "1px solid rgba(96, 165, 250, 0.85)" : "1px solid rgba(51, 65, 85, 0.92)",
                                                background: active ? "linear-gradient(180deg, rgba(79, 140, 255, 0.95) 0%, rgba(53, 103, 243, 0.95) 100%)" : "rgba(15, 23, 42, 0.94)",
                                                color: "#f8fafc",
                                                borderRadius: 10,
                                                padding: "8px 10px",
                                                fontSize: 12,
                                                fontWeight: active ? 700 : 600,
                                                textAlign: "left",
                                                cursor: "pointer"
                                            }}
                                        >
                                            {item.label}
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                        {!visibleSections.length ? (
                            <div
                                style={{
                                    borderRadius: 8,
                                    border: "1px dashed rgba(71, 85, 105, 0.78)",
                                    padding: "10px 8px",
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: "rgba(148, 163, 184, 0.9)",
                                    textAlign: "center"
                                }}
                            >
                                No matches.
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
            {helperText ? (
                <div
                    style={{
                        fontSize: 10,
                        lineHeight: 1.4,
                        color: helperTone === "error" ? "#fecaca" : "rgba(226, 232, 240, 0.68)"
                    }}
                >
                    {helperText}
                </div>
            ) : null}
        </div>
    );
}

function PropertyTagPathField({
    autoOpenToken = 0,
    disabled = false,
    error = "",
    label,
    loaded = true,
    loading = false,
    onOpen,
    onCommit,
    options = EMPTY_ARRAY,
    typeFilter = "",
    value = ""
}) {
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const searchRef = useRef(null);
    const listRef = useRef(null);
    const selectedOptionRef = useRef(null);
    const lastAutoOpenTokenRef = useRef(0);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [menuRect, setMenuRect] = useState(null);
    const [expandedTagPaths, setExpandedTagPaths] = useState(() => new Set());
    const currentValue = value == null ? "" : String(value);
    const normalizedTypeFilter = String(typeFilter || "").trim();
    const normalizedOptions = useMemo(
        () => {
            const mapped = coerceArray(options).map((option) => {
            const path = String(option?.path || "").trim();
            if (!path) {
                return null;
            }
            const provider = String(option?.provider || "Tags").trim() || "Tags";
            const name = String(option?.name || "").trim() || path;
            const typeId = String(option?.typeId || "").trim();
            const dataType = String(option?.dataType || option?.plcType || option?.uaType || "").trim();
            const udtName = getTagTypeDisplayName({ ...option, typeId, dataType });
            const groupLabel = udtName || provider;
            return {
                value: path,
                path,
                parentPath: getIgnitionTagParentPath(path),
                leafName: getIgnitionTagLeafName(path),
                provider,
                name,
                objectType: String(option?.objectType || "").trim(),
                typeId,
                dataType,
                udtName,
                groupLabel,
                searchText: `${provider} ${groupLabel} ${udtName} ${dataType} ${typeId} ${name} ${path}`.toLowerCase()
            };
            }).filter(Boolean);
            const allByPath = new Map();
            mapped.forEach((option) => {
                allByPath.set(String(option.path || "").toLowerCase(), option);
            });
            return mapped.filter((option) => {
                if (tagMatchesTypeFilter(option, normalizedTypeFilter)) {
                    return true;
                }
                let parent = option.parentPath;
                const seenParents = new Set();
                while (parent && !seenParents.has(parent.toLowerCase())) {
                    seenParents.add(parent.toLowerCase());
                    const parentOption = allByPath.get(parent.toLowerCase());
                    if (!parentOption) {
                        break;
                    }
                    if (tagMatchesTypeFilter(parentOption, normalizedTypeFilter)) {
                        return true;
                    }
                    parent = parentOption.parentPath;
                }
                return false;
            });
        },
        [normalizedTypeFilter, options]
    );
    const optionByPath = useMemo(() => {
        const map = new Map();
        normalizedOptions.forEach((option) => {
            map.set(String(option.path || "").toLowerCase(), option);
        });
        return map;
    }, [normalizedOptions]);
    const groupedOptions = useMemo(
        () => normalizedOptions.reduce((acc, option) => {
            let groupLabel = option.groupLabel;
            let parent = option.parentPath;
            const seenParents = new Set();
            while (parent && !seenParents.has(parent.toLowerCase())) {
                seenParents.add(parent.toLowerCase());
                const parentOption = optionByPath.get(parent.toLowerCase());
                if (!parentOption) {
                    break;
                }
                if (parentOption.udtName || parentOption.groupLabel) {
                    groupLabel = parentOption.groupLabel || parentOption.udtName || groupLabel;
                    break;
                }
                parent = parentOption.parentPath;
            }
            if (!acc[groupLabel]) {
                acc[groupLabel] = [];
            }
            acc[groupLabel].push(option);
            return acc;
        }, {}),
        [normalizedOptions, optionByPath]
    );
    const buildVisibleTagTreeRows = useCallback((items) => {
        const list = coerceArray(items);
        const localByPath = new Map();
        list.forEach((item) => {
            localByPath.set(String(item.path || "").toLowerCase(), item);
        });
        const childrenByParent = new Map();
        list.forEach((item) => {
            const parentKey = String(item.parentPath || "").toLowerCase();
            if (!parentKey || !localByPath.has(parentKey)) {
                return;
            }
            if (!childrenByParent.has(parentKey)) {
                childrenByParent.set(parentKey, []);
            }
            childrenByParent.get(parentKey).push(item);
        });
        const compareRows = (left, right) =>
            String(left.leafName || left.name || left.path || "").localeCompare(
                String(right.leafName || right.name || right.path || ""),
                undefined,
                { sensitivity: "base", numeric: true }
            );
        const roots = list
            .filter((item) => {
                const parentKey = String(item.parentPath || "").toLowerCase();
                return !parentKey || !localByPath.has(parentKey);
            })
            .sort(compareRows);
        const rows = [];
        const walk = (item, depth) => {
            const key = String(item.path || "").toLowerCase();
            const children = (childrenByParent.get(key) || []).slice().sort(compareRows);
            const expanded = expandedTagPaths.has(key);
            rows.push({
                ...item,
                depth,
                childCount: children.length,
                hasTreeChildren: children.length > 0,
                expanded
            });
            if (children.length && expanded) {
                children.forEach((child) => walk(child, depth + 1));
            }
        };
        roots.forEach((item) => walk(item, 0));
        return rows;
    }, [expandedTagPaths]);
    const hasCurrentOption = normalizedOptions.some((option) => option.path === currentValue);
    const selectedOption = normalizedOptions.find((option) => option.path === currentValue) || null;
    const queryText = String(query || "").trim().toLowerCase();
    const filteredOptions = queryText
        ? normalizedOptions.filter((option) => option.searchText.includes(queryText))
        : normalizedOptions;
    const groupedFilteredSections = queryText
        ? [
            {
                label: filteredOptions.length ? "Results" : "",
                items: filteredOptions.map((item) => ({
                    ...item,
                    depth: 0,
                    childCount: 0,
                    hasTreeChildren: false,
                    expanded: false
                }))
            }
        ]
        : Object.keys(groupedOptions).map((provider) => ({
            label: provider,
            items: buildVisibleTagTreeRows(groupedOptions[provider])
        }));
    const triggerLabel = selectedOption?.path
        ? (
            selectedOption.udtName
                ? `${selectedOption.path} (${selectedOption.udtName})`
                : selectedOption.path
        )
        : (currentValue ? `${currentValue} (current)` : "Select tag...");
    const resultSummary = loading
        ? "Loading Ignition tags..."
        : !loaded
            ? "Open to load Ignition tags"
            : queryText
                ? `${filteredOptions.length} match${filteredOptions.length === 1 ? "" : "es"}`
                : normalizedTypeFilter
                    ? `${normalizedOptions.length} ${normalizedTypeFilter} tag${normalizedOptions.length === 1 ? "" : "s"} available`
                    : `${normalizedOptions.length} Ignition tags available`;
    const helperText = error
        ? error
        : loading
            ? "Loading Ignition tags..."
            : !loaded
                ? "Open to load Ignition tags."
            : resultSummary;

    const closeMenu = useCallback(() => {
        setOpen(false);
        setQuery("");
    }, []);

    const updateMenuRect = useCallback(() => {
        const trigger = triggerRef.current;
        if (!trigger || typeof window === "undefined") {
            return;
        }
        const rect = trigger.getBoundingClientRect();
        const boundaryRect = trigger.closest("[data-vizi-canvas-root='1']")?.getBoundingClientRect?.()
            || {
                left: 0,
                top: 0,
                right: window.innerWidth || 0,
                bottom: window.innerHeight || 0,
                width: window.innerWidth || 0,
                height: window.innerHeight || 0
            };
        const boundaryLeft = Number(boundaryRect.left || 0);
        const boundaryTop = Number(boundaryRect.top || 0);
        const boundaryRight = Number(boundaryRect.right || ((boundaryLeft || 0) + Number(boundaryRect.width || 0)));
        const boundaryBottom = Number(boundaryRect.bottom || ((boundaryTop || 0) + Number(boundaryRect.height || 0)));
        const horizontalPadding = 12;
        const verticalPadding = 12;
        const menuGap = 6;
        const desiredWidth = Math.max(rect.width, 360);
        const maxWidth = Math.max(280, boundaryRight - boundaryLeft - (horizontalPadding * 2));
        const width = Math.min(desiredWidth, maxWidth);
        const left = Math.min(
            Math.max(boundaryLeft + horizontalPadding, rect.left),
            Math.max(boundaryLeft + horizontalPadding, boundaryRight - width - horizontalPadding)
        );
        const availableBelow = Math.max(0, boundaryBottom - rect.bottom - verticalPadding - menuGap);
        const availableAbove = Math.max(0, rect.top - boundaryTop - verticalPadding - menuGap);
        const openAbove = availableBelow < 240 && availableAbove > availableBelow;
        const maxHeight = Math.min(440, openAbove ? availableAbove : availableBelow);
        const top = openAbove
            ? Math.max(boundaryTop + verticalPadding, rect.top - maxHeight - menuGap)
            : Math.min(
                rect.bottom + menuGap,
                Math.max(boundaryTop + verticalPadding, boundaryBottom - maxHeight - verticalPadding)
            );
        setMenuRect({
            left,
            top,
            width,
            maxHeight
        });
    }, []);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        updateMenuRect();
        const handleWindowPointerDown = (event) => {
            const root = rootRef.current;
            const menu = menuRef.current;
            const target = event?.target;
            if ((root && root.contains(target)) || (menu && menu.contains(target))) {
                return;
            }
            closeMenu();
        };
        const handleEscape = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeMenu();
            }
        };
        const handleLayout = () => {
            updateMenuRect();
        };
        window.addEventListener("pointerdown", handleWindowPointerDown, true);
        window.addEventListener("resize", handleLayout, true);
        document.addEventListener("scroll", handleLayout, true);
        window.addEventListener("keydown", handleEscape, true);
        return () => {
            window.removeEventListener("pointerdown", handleWindowPointerDown, true);
            window.removeEventListener("resize", handleLayout, true);
            document.removeEventListener("scroll", handleLayout, true);
            window.removeEventListener("keydown", handleEscape, true);
        };
    }, [closeMenu, open, updateMenuRect]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            searchRef.current?.focus?.();
            searchRef.current?.select?.();
        }, 0);
        return () => {
            window.clearTimeout(timer);
        };
    }, [open]);

    useEffect(() => {
        if (!open || queryText || !currentValue) {
            return undefined;
        }
        const ancestors = getIgnitionTagAncestorPaths(currentValue);
        if (ancestors.length) {
            setExpandedTagPaths((previous) => {
                const next = new Set(previous);
                let changed = false;
                ancestors.forEach((path) => {
                    const key = String(path || "").toLowerCase();
                    if (key && !next.has(key)) {
                        next.add(key);
                        changed = true;
                    }
                });
                return changed ? next : previous;
            });
        }
        const scrollSelected = () => {
            const selectedNode = selectedOptionRef.current;
            const listNode = listRef.current;
            if (!selectedNode || !listNode) {
                return;
            }
            if (String(selectedNode.getAttribute("data-tag-path") || "") !== currentValue) {
                return;
            }
            selectedNode.scrollIntoView({
                block: "center",
                inline: "nearest"
            });
        };
        const timer = window.setTimeout(scrollSelected, 0);
        const frame = window.requestAnimationFrame(scrollSelected);
        return () => {
            window.clearTimeout(timer);
            window.cancelAnimationFrame(frame);
        };
    }, [currentValue, normalizedOptions.length, open, queryText]);

    useEffect(() => {
        const nextToken = Number(autoOpenToken) || 0;
        if (!nextToken || disabled || lastAutoOpenTokenRef.current === nextToken) {
            return;
        }
        lastAutoOpenTokenRef.current = nextToken;
        setQuery("");
        setOpen(true);
        if (typeof onOpen === "function") {
            onOpen();
        }
        const timer = window.setTimeout(() => {
            updateMenuRect();
            searchRef.current?.focus?.();
            searchRef.current?.select?.();
        }, 0);
        return () => {
            window.clearTimeout(timer);
        };
    }, [autoOpenToken, disabled, onOpen, updateMenuRect]);

    return (
        <div
            ref={rootRef}
            data-vizi-dropdown="1"
            style={{ display: "grid", gap: 5 }}
            onMouseDown={stopInteractivePropagation}
            onClick={stopInteractivePropagation}
            onDoubleClick={stopInteractivePropagation}
        >
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(226, 232, 240, 0.88)" }}>
                {label}
            </span>
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled || (loading && !normalizedOptions.length)}
                onClick={(event) => {
                    stopInteractivePropagation(event);
                    if (disabled || (loading && !normalizedOptions.length)) {
                        return;
                    }
                    setOpen((current) => {
                        const next = !current;
                        if (next && typeof onOpen === "function") {
                            onOpen();
                        }
                        if (!next) {
                            setQuery("");
                        }
                        return next;
                    });
                }}
                onPointerDown={stopInteractivePropagation}
                onMouseDown={stopInteractivePropagation}
                onMouseUp={stopInteractivePropagation}
                onDoubleClick={stopInteractivePropagation}
                onContextMenu={(event) => {
                    event.preventDefault();
                    if (!currentValue) {
                        stopInteractivePropagation(event);
                        return;
                    }
                    stopInteractivePropagation(event);
                    copyTextToClipboard(currentValue);
                }}
                style={{
                    width: "100%",
                    minHeight: 36,
                    boxSizing: "border-box",
                    borderRadius: 10,
                    border: "1px solid rgba(71, 85, 105, 0.9)",
                    background: disabled ? "rgba(15, 23, 42, 0.55)" : "rgba(15, 23, 42, 0.92)",
                    color: "#f8fafc",
                    padding: "8px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    cursor: disabled ? "default" : "pointer",
                    opacity: disabled ? 0.78 : 1,
                    textAlign: "left"
                }}
            >
                <span
                    style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                    }}
                >
                    {triggerLabel}
                </span>
                <span style={{ color: "rgba(226, 232, 240, 0.72)", fontSize: 11 }}>
                    {open ? "^" : "v"}
                </span>
            </button>
            {helperText ? (
                <div
                    style={{
                        fontSize: 10,
                        lineHeight: 1.4,
                        color: error ? "#fecaca" : "rgba(226, 232, 240, 0.68)"
                    }}
                >
                    {helperText}
                </div>
            ) : null}
            {open && menuRect && typeof document !== "undefined" && document.body
                ? createPortal(
                    <div
                        ref={menuRef}
                        data-vizi-dropdown-menu="1"
                        style={{
                            position: "fixed",
                            left: menuRect.left,
                            top: menuRect.top,
                            width: menuRect.width,
                            maxHeight: menuRect.maxHeight,
                            boxSizing: "border-box",
                            zIndex: 2147483200,
                            borderRadius: 10,
                            border: "1px solid rgba(71, 85, 105, 0.96)",
                            background: "rgba(2, 6, 23, 0.985)",
                            boxShadow: "0 24px 48px rgba(2, 6, 23, 0.44)",
                            display: "grid",
                            gap: 6,
                            padding: 8,
                            overflow: "hidden"
                        }}
                        onPointerDown={stopInteractivePropagation}
                        onMouseDown={stopInteractivePropagation}
                        onMouseUp={stopInteractivePropagation}
                        onClick={stopInteractivePropagation}
                        onDoubleClick={stopInteractivePropagation}
                        onKeyDown={stopInteractivePropagation}
                        onKeyUp={stopInteractivePropagation}
                        onContextMenu={stopInteractivePropagation}
                    >
                        <div style={{ display: "grid", gap: 6 }}>
                            <input
                                ref={searchRef}
                                type="text"
                                value={query}
                                placeholder="Search tags by name, path, UDT, or provider..."
                                onChange={(event) => {
                                    setQuery(event.target.value);
                                }}
                                onFocus={stopInteractivePropagation}
                                onPointerDown={stopInteractivePropagation}
                                onMouseDown={stopInteractivePropagation}
                                onMouseUp={stopInteractivePropagation}
                                onClick={stopInteractivePropagation}
                                onDoubleClick={stopInteractivePropagation}
                                onKeyDown={(event) => {
                                    stopInteractivePropagation(event);
                                    if (event.key === "Escape") {
                                        event.preventDefault();
                                        closeMenu();
                                    }
                                }}
                                onKeyUp={stopInteractivePropagation}
                                style={{
                                    width: "100%",
                                    height: 30,
                                    boxSizing: "border-box",
                                    borderRadius: 8,
                                    border: "1px solid rgba(71, 85, 105, 0.9)",
                                    background: "rgba(15, 23, 42, 0.92)",
                                    color: "#f8fafc",
                                    padding: "0 9px",
                                    fontSize: 11,
                                    fontWeight: 600
                                }}
                            />
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "flex-start",
                                    gap: 8,
                                    fontSize: 9,
                                    lineHeight: 1.2,
                                    color: "rgba(226, 232, 240, 0.68)"
                                }}
                            >
                                <span>{resultSummary}</span>
                            </div>
                        </div>
                        <div
                            ref={listRef}
                            className="vizi-scroll"
                            style={{
                                display: "grid",
                                gap: 6,
                                maxHeight: Math.max(96, Number(menuRect.maxHeight || 320) - 92),
                                overflowY: "auto",
                                paddingRight: 2
                            }}
                        >
                            <div style={{ display: "grid", gap: 3 }}>
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        stopInteractivePropagation(event);
                                        closeMenu();
                                        if (typeof onCommit === "function") {
                                            onCommit("");
                                        }
                                    }}
                                    onPointerDown={stopInteractivePropagation}
                                    onMouseDown={stopInteractivePropagation}
                                    onMouseUp={stopInteractivePropagation}
                                    style={{
                                        width: "100%",
                                        border: currentValue ? "1px solid rgba(51, 65, 85, 0.92)" : "1px solid rgba(96, 165, 250, 0.85)",
                                        background: currentValue ? "rgba(15, 23, 42, 0.94)" : "linear-gradient(180deg, rgba(79, 140, 255, 0.95) 0%, rgba(53, 103, 243, 0.95) 100%)",
                                        color: "#f8fafc",
                                        borderRadius: 8,
                                        padding: "6px 8px",
                                        fontSize: 11,
                                        fontWeight: currentValue ? 600 : 700,
                                        textAlign: "left",
                                        lineHeight: 1.15,
                                        cursor: "pointer"
                                    }}
                                >
                                    No tag
                                </button>
                                {!hasCurrentOption && currentValue ? (
                                    <div
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            stopInteractivePropagation(event);
                                            copyTextToClipboard(currentValue);
                                        }}
                                        style={{
                                            border: "1px solid rgba(71, 85, 105, 0.76)",
                                            background: "rgba(15, 23, 42, 0.9)",
                                            color: "#e2e8f0",
                                            borderRadius: 8,
                                            padding: "6px 8px",
                                            display: "grid",
                                            gap: 1
                                        }}
                                    >
                                        <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.15 }}>{currentValue}</div>
                                        <div style={{ fontSize: 9, color: "rgba(148, 163, 184, 0.9)", lineHeight: 1.1 }}>Current saved value</div>
                                    </div>
                                ) : null}
                            </div>
                            {groupedFilteredSections.map((section, sectionIndex) => (
                                <div key={`${section.label || "section"}-${sectionIndex}`} style={{ display: "grid", gap: 3 }}>
                                    {section.label ? (
                                        <div
                                            style={{
                                                padding: "1px 4px 2px",
                                                fontSize: 9,
                                                fontWeight: 800,
                                                letterSpacing: "0.08em",
                                                textTransform: "uppercase",
                                                color: "rgba(148, 163, 184, 0.88)"
                                            }}
                                        >
                                            {section.label}
                                        </div>
                                    ) : null}
                                    {section.items.map((item) => {
                                        const active = item.value === currentValue;
                                        const depth = Math.max(0, Number(item.depth || 0));
                                        const hasTreeChildren = Boolean(item.hasTreeChildren);
                                        return (
                                            <div
                                                key={`${section.label || "option"}-${item.value}`}
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns: `${depth * 14 + 22}px minmax(0, 1fr)`,
                                                    gap: 4,
                                                    alignItems: "stretch"
                                                }}
                                            >
                                                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                                                    {hasTreeChildren ? (
                                                        <button
                                                            type="button"
                                                            aria-label={item.expanded ? "Collapse tag" : "Expand tag"}
                                                            title={item.expanded ? "Collapse" : "Expand"}
                                                            onClick={(event) => {
                                                                stopInteractivePropagation(event);
                                                                setExpandedTagPaths((previous) => {
                                                                    const next = new Set(previous);
                                                                    const key = String(item.value || "").toLowerCase();
                                                                    if (next.has(key)) {
                                                                        next.delete(key);
                                                                    } else {
                                                                        next.add(key);
                                                                    }
                                                                    return next;
                                                                });
                                                            }}
                                                            onPointerDown={stopInteractivePropagation}
                                                            onMouseDown={stopInteractivePropagation}
                                                            onMouseUp={stopInteractivePropagation}
                                                            style={{
                                                                width: 20,
                                                                height: 28,
                                                                borderRadius: 7,
                                                                border: "1px solid rgba(51, 65, 85, 0.92)",
                                                                background: "rgba(15, 23, 42, 0.92)",
                                                                color: "#f8fafc",
                                                                cursor: "pointer",
                                                                fontSize: 12,
                                                                fontWeight: 800,
                                                                lineHeight: 1
                                                            }}
                                                        >
                                                            {item.expanded ? "-" : "+"}
                                                        </button>
                                                    ) : null}
                                                </div>
                                                <button
                                                    ref={active ? selectedOptionRef : undefined}
                                                    data-tag-path={item.value}
                                                    type="button"
                                                    onClick={(event) => {
                                                        stopInteractivePropagation(event);
                                                        closeMenu();
                                                        if (typeof onCommit === "function") {
                                                            onCommit(item.value);
                                                        }
                                                    }}
                                                    onPointerDown={stopInteractivePropagation}
                                                    onMouseDown={stopInteractivePropagation}
                                                    onMouseUp={stopInteractivePropagation}
                                                    onContextMenu={(event) => {
                                                        event.preventDefault();
                                                        stopInteractivePropagation(event);
                                                        copyTextToClipboard(item.value);
                                                    }}
                                                    style={{
                                                        width: "100%",
                                                        border: active ? "1px solid rgba(96, 165, 250, 0.85)" : "1px solid rgba(51, 65, 85, 0.92)",
                                                        background: active ? "linear-gradient(180deg, rgba(79, 140, 255, 0.95) 0%, rgba(53, 103, 243, 0.95) 100%)" : "rgba(15, 23, 42, 0.94)",
                                                        color: "#f8fafc",
                                                        borderRadius: 8,
                                                        padding: "6px 8px",
                                                        fontSize: 11,
                                                        fontWeight: active ? 700 : 600,
                                                        textAlign: "left",
                                                        cursor: "pointer",
                                                        display: "grid",
                                                        gap: 1,
                                                        lineHeight: 1.1
                                                    }}
                                                >
                                                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        {item.name}
                                                        {hasTreeChildren ? (
                                                            <span style={{ marginLeft: 6, fontSize: 9, color: active ? "rgba(239, 246, 255, 0.82)" : "rgba(148, 163, 184, 0.85)" }}>
                                                                {item.childCount}
                                                            </span>
                                                        ) : null}
                                                    </span>
                                                    <span
                                                        style={{
                                                            minWidth: 0,
                                                            overflow: "hidden",
                                                            textOverflow: "ellipsis",
                                                            whiteSpace: "nowrap",
                                                            fontSize: 9,
                                                            fontWeight: 600,
                                                            lineHeight: 1.05,
                                                            color: active ? "rgba(239, 246, 255, 0.9)" : "rgba(148, 163, 184, 0.92)"
                                                        }}
                                                    >
                                                        {item.udtName ? `${item.udtName} | ${item.path}` : item.path}
                                                    </span>
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                            {!loading && !filteredOptions.length ? (
                                <div
                                    style={{
                                        borderRadius: 8,
                                        border: "1px dashed rgba(71, 85, 105, 0.78)",
                                        padding: "10px 8px",
                                        fontSize: 10,
                                        fontWeight: 600,
                                        color: "rgba(148, 163, 184, 0.9)",
                                        textAlign: "center"
                                    }}
                                >
                                    No tags match that search.
                                </div>
                            ) : null}
                        </div>
                    </div>,
                    document.body
                )
                : null}
        </div>
    );
}

function PropertyReadout({ label, value = "" }) {
    return (
        <div style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(226, 232, 240, 0.88)" }}>
                {label}
            </span>
            <div
                style={{
                    minHeight: 36,
                    boxSizing: "border-box",
                    borderRadius: 10,
                    border: "1px solid rgba(71, 85, 105, 0.9)",
                    background: "rgba(15, 23, 42, 0.55)",
                    color: "#cbd5e1",
                    padding: "8px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center"
                }}
            >
                {value == null || value === "" ? "None" : String(value)}
            </div>
        </div>
    );
}

function formatPanelNumber(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) {
        return "";
    }
    if (Math.abs(next - Math.round(next)) < 0.001) {
        return String(Math.round(next));
    }
    return String(Math.round(next * 100) / 100);
}

function parsePanelNumber(value) {
    const next = Number.parseFloat(String(value ?? "").trim());
    return Number.isFinite(next) ? next : null;
}

function getShapeBounds(shape) {
    if (!shape || typeof shape !== "object") {
        return null;
    }
    if (shape.type === "text") {
        const fontSize = Math.max(8, Number(shape.fontSize || 24));
        const text = String(shape.text || "");
        const width = Math.max(40, text.length * fontSize * 0.6);
        const height = Math.max(24, fontSize * 1.2);
        const anchor = shape.anchor === "middle" || shape.anchor === "end" ? shape.anchor : "start";
        const anchorOffsetX = anchor === "middle" ? -width / 2 : anchor === "end" ? -width : 0;
        return {
            x: Number(shape.x || 0) + anchorOffsetX,
            y: Number(shape.y || 0),
            width,
            height
        };
    }
    if (Array.isArray(shape.points)) {
        const points = clonePoints(shape.points);
        if (!points.length) {
            return null;
        }
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        points.forEach((point) => {
            minX = Math.min(minX, Number(point.x || 0));
            minY = Math.min(minY, Number(point.y || 0));
            maxX = Math.max(maxX, Number(point.x || 0));
            maxY = Math.max(maxY, Number(point.y || 0));
        });
        return {
            x: minX,
            y: minY,
            width: Math.max(1, maxX - minX),
            height: Math.max(1, maxY - minY)
        };
    }
    return {
        x: Number(shape.x || 0),
        y: Number(shape.y || 0),
        width: Math.max(0, Number(shape.width || 0)),
        height: Math.max(0, Number(shape.height || 0))
    };
}

function getOverlayBounds(overlay) {
    const bbox = overlay?.bbox;
    if (!bbox || typeof bbox !== "object") {
        return null;
    }
    const scaleX = overlayScaleX(overlay);
    const scaleY = overlayScaleY(overlay);
    if (overlayRotationDegrees(overlay)) {
        const corners = [
            worldFromLocal(overlay, Number(bbox.x || 0), Number(bbox.y || 0)),
            worldFromLocal(overlay, Number(bbox.x || 0) + Number(bbox.width || 0), Number(bbox.y || 0)),
            worldFromLocal(overlay, Number(bbox.x || 0) + Number(bbox.width || 0), Number(bbox.y || 0) + Number(bbox.height || 0)),
            worldFromLocal(overlay, Number(bbox.x || 0), Number(bbox.y || 0) + Number(bbox.height || 0))
        ];
        const xs = corners.map((point) => Number(point.x || 0));
        const ys = corners.map((point) => Number(point.y || 0));
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        return {
            x: minX,
            y: minY,
            width: Math.max(1, maxX - minX),
            height: Math.max(1, maxY - minY)
        };
    }
    return {
        x: Number(overlay?.tx || 0) + scaleX * Number(bbox.x || 0),
        y: Number(overlay?.ty || 0) + scaleY * Number(bbox.y || 0),
        width: Math.max(1, scaleX * Number(bbox.width || 0)),
        height: Math.max(1, scaleY * Number(bbox.height || 0))
    };
}

function expandViewBoundsToFitContent(baseViewBounds, shapes, overlays, padding = 24) {
    const fallback = {
        x: Number(baseViewBounds?.x || 0),
        y: Number(baseViewBounds?.y || 0),
        width: Math.max(1, Number(baseViewBounds?.width || DEFAULT_CANVAS_WIDTH)),
        height: Math.max(1, Number(baseViewBounds?.height || DEFAULT_CANVAS_HEIGHT))
    };
    const boundsList = [
        ...coerceArray(shapes).map((shape) => getShapeBounds(shape)),
        ...coerceArray(overlays).map((overlay) => getOverlayBounds(overlay))
    ].filter(Boolean);

    if (!boundsList.length) {
        return fallback;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    boundsList.forEach((bounds) => {
        const x = Number(bounds.x || 0);
        const y = Number(bounds.y || 0);
        const width = Number(bounds.width || 0);
        const height = Number(bounds.height || 0);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
    });

    const extraPadding = Math.max(0, Number(padding || 0));
    const nextX = Math.min(fallback.x, minX - extraPadding);
    const nextY = Math.min(fallback.y, minY - extraPadding);
    const nextRight = Math.max(fallback.x + fallback.width, maxX + extraPadding);
    const nextBottom = Math.max(fallback.y + fallback.height, maxY + extraPadding);

    return {
        x: nextX,
        y: nextY,
        width: Math.max(1, nextRight - nextX),
        height: Math.max(1, nextBottom - nextY)
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeToolbarPosition(value) {
    if (!isPlainObject(value)) {
        return null;
    }
    const x = Number(value.x);
    const y = Number(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
    }
    return { x, y };
}

function clampToolbarPosition(position, panelWidth, panelHeight, viewportWidth, viewportHeight) {
    const normalized = normalizeToolbarPosition(position) || TOOLBAR_DEFAULT_POSITION;
    const width = toPositiveNumber(panelWidth) || TOOLBAR_WIDTH;
    const height = toPositiveNumber(panelHeight) || 160;
    const viewWidth = toPositiveNumber(viewportWidth) || DEFAULT_CANVAS_WIDTH;
    const viewHeight = toPositiveNumber(viewportHeight) || DEFAULT_CANVAS_HEIGHT;
    const maxX = Math.max(TOOLBAR_INSET, viewWidth - width - TOOLBAR_INSET);
    const maxY = Math.max(TOOLBAR_INSET, viewHeight - height - TOOLBAR_INSET);
    return {
        x: Math.round(clamp(normalized.x, TOOLBAR_INSET, maxX)),
        y: Math.round(clamp(normalized.y, TOOLBAR_INSET, maxY))
    };
}

function clampPropertyPanelWidth(value, viewportWidth = 0) {
    const width = Number(value);
    const vpW = Number(viewportWidth) || DEFAULT_CANVAS_WIDTH;
    const maxWidth = Math.max(
        PROPERTY_PANEL_MIN_WIDTH,
        Math.min(PROPERTY_PANEL_MAX_WIDTH, Math.floor(vpW * 0.72))
    );
    return clamp(
        Number.isFinite(width) ? width : PROPERTY_PANEL_WIDTH,
        PROPERTY_PANEL_MIN_WIDTH,
        maxWidth
    );
}

function clampPropertyPanelHeight(value, maxHeight = PROPERTY_PANEL_HEIGHT) {
    const height = Number(value);
    const maxPanelHeight = Math.max(
        PROPERTY_PANEL_MIN_HEIGHT,
        Number.isFinite(Number(maxHeight)) ? Number(maxHeight) : PROPERTY_PANEL_HEIGHT
    );
    return clamp(
        Number.isFinite(height) ? height : PROPERTY_PANEL_HEIGHT,
        PROPERTY_PANEL_MIN_HEIGHT,
        maxPanelHeight
    );
}

function readStoredPropertyPanelWidth() {
    if (typeof window === "undefined" || !window.localStorage) {
        return PROPERTY_PANEL_WIDTH;
    }
    try {
        return clampPropertyPanelWidth(
            window.localStorage.getItem(PROPERTY_PANEL_WIDTH_STORAGE_KEY),
            window.innerWidth
        );
    } catch (_error) {
        return PROPERTY_PANEL_WIDTH;
    }
}

function readStoredPropertyPanelHeight() {
    if (typeof window === "undefined" || !window.localStorage) {
        return PROPERTY_PANEL_HEIGHT;
    }
    try {
        return clampPropertyPanelHeight(
            window.localStorage.getItem(PROPERTY_PANEL_HEIGHT_STORAGE_KEY),
            (toPositiveNumber(window.innerHeight) || DEFAULT_CANVAS_HEIGHT) - 32
        );
    } catch (_error) {
        return PROPERTY_PANEL_HEIGHT;
    }
}

function toggleIn(list, id) {
    const key = String(id || "").trim();
    const source = coerceArray(list).map((value) => String(value || "").trim()).filter(Boolean);
    if (!key) {
        return source;
    }
    return source.includes(key)
        ? source.filter((value) => value !== key)
        : [...source, key];
}

function rectFromPoints(start, end) {
    const startX = Number(start?.x || 0);
    const startY = Number(start?.y || 0);
    const endX = Number(end?.x || 0);
    const endY = Number(end?.y || 0);
    return {
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY)
    };
}

function rectFromAspectLockedCorner(anchor, pointer, startBounds, corner, options = {}) {
    const key = String(corner || "").toUpperCase();
    const ax = Number(anchor?.x || 0);
    const ay = Number(anchor?.y || 0);
    const px = Number(pointer?.x || ax);
    const py = Number(pointer?.y || ay);
    const baseWidth = Math.max(1e-6, Number(startBounds?.width ?? startBounds?.w ?? 1));
    const baseHeight = Math.max(1e-6, Number(startBounds?.height ?? startBounds?.h ?? 1));
    const minWidth = Math.max(1e-6, Number(options?.minWidth ?? options?.minW ?? 1));
    const minHeight = Math.max(1e-6, Number(options?.minHeight ?? options?.minH ?? 1));
    const rawWidth = Math.max(1e-6, Math.abs(px - ax));
    const rawHeight = Math.max(1e-6, Math.abs(py - ay));
    const scale = Math.max(rawWidth / baseWidth, rawHeight / baseHeight, minWidth / baseWidth, minHeight / baseHeight);
    const width = Math.max(minWidth, baseWidth * scale);
    const height = Math.max(minHeight, baseHeight * scale);

    if (key === "TL") {
        return { x: ax - width, y: ay - height, width, height };
    }
    if (key === "TR") {
        return { x: ax, y: ay - height, width, height };
    }
    if (key === "BR") {
        return { x: ax, y: ay, width, height };
    }
    if (key === "BL") {
        return { x: ax - width, y: ay, width, height };
    }

    return rectFromPoints(anchor, pointer);
}

function rectsIntersect(left, right) {
    if (!left || !right) {
        return false;
    }
    return (
        Number(left.x || 0) <= Number(right.x || 0) + Number(right.width || 0)
        && Number(left.x || 0) + Number(left.width || 0) >= Number(right.x || 0)
        && Number(left.y || 0) <= Number(right.y || 0) + Number(right.height || 0)
        && Number(left.y || 0) + Number(left.height || 0) >= Number(right.y || 0)
    );
}

function rectContains(outer, inner) {
    if (!outer || !inner) {
        return false;
    }
    return (
        Number(outer.x || 0) <= Number(inner.x || 0)
        && Number(outer.y || 0) <= Number(inner.y || 0)
        && Number(outer.x || 0) + Number(outer.width || 0) >= Number(inner.x || 0) + Number(inner.width || 0)
        && Number(outer.y || 0) + Number(outer.height || 0) >= Number(inner.y || 0) + Number(inner.height || 0)
    );
}

function unionBounds(bounds) {
    const items = (Array.isArray(bounds) ? bounds : []).filter(Boolean);
    if (!items.length) {
        return null;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    items.forEach((item) => {
        minX = Math.min(minX, Number(item.x || 0));
        minY = Math.min(minY, Number(item.y || 0));
        maxX = Math.max(maxX, Number(item.x || 0) + Number(item.width || 0));
        maxY = Math.max(maxY, Number(item.y || 0) + Number(item.height || 0));
    });

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return null;
    }

    return {
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY)
    };
}

function overlayScale(overlay) {
    return Math.max(0.0001, Math.abs(Number(overlay?.scale || 1)));
}

function overlayScaleX(overlay) {
    const scaleX = Number(overlay?.scaleX);
    return Number.isFinite(scaleX) && scaleX !== 0
        ? Math.max(0.0001, Math.abs(scaleX))
        : overlayScale(overlay);
}

function overlayScaleY(overlay) {
    const scaleY = Number(overlay?.scaleY);
    return Number.isFinite(scaleY) && scaleY !== 0
        ? Math.max(0.0001, Math.abs(scaleY))
        : overlayScale(overlay);
}

function overlayRotationDegrees(overlay) {
    const value = Number(overlay?.rotation ?? overlay?.rotate ?? overlay?.angle);
    if (!Number.isFinite(value)) {
        return 0;
    }
    const normalized = value % 360;
    return Math.abs(normalized) < 0.0001 ? 0 : normalized;
}

function worldFromLocal(overlay, x, y) {
    const scaleX = overlayScaleX(overlay);
    const scaleY = overlayScaleY(overlay);
    const rotation = overlayRotationDegrees(overlay);
    const bbox = overlay?.bbox;
    if (rotation && bbox && typeof bbox === "object") {
        const cx = Number(bbox.x || 0) + Math.max(0.0001, Number(bbox.width || 0)) / 2;
        const cy = Number(bbox.y || 0) + Math.max(0.0001, Number(bbox.height || 0)) / 2;
        const worldCx = Number(overlay?.tx || 0) + scaleX * cx;
        const worldCy = Number(overlay?.ty || 0) + scaleY * cy;
        const radians = rotation * Math.PI / 180;
        const dx = (Number(x || 0) - cx) * scaleX;
        const dy = (Number(y || 0) - cy) * scaleY;
        return {
            x: worldCx + dx * Math.cos(radians) - dy * Math.sin(radians),
            y: worldCy + dx * Math.sin(radians) + dy * Math.cos(radians)
        };
    }
    return {
        x: Number(overlay?.tx || 0) + scaleX * Number(x || 0),
        y: Number(overlay?.ty || 0) + scaleY * Number(y || 0)
    };
}

function overlayTranslationForLocalPoint(overlay, localPoint, worldPoint, scaleX, scaleY, bboxOverride = null) {
    const bbox = bboxOverride || overlay?.bbox;
    const sx = Math.max(0.0001, Number(scaleX || 1));
    const sy = Math.max(0.0001, Number(scaleY || 1));
    const lx = Number(localPoint?.x || 0);
    const ly = Number(localPoint?.y || 0);
    const wx = Number(worldPoint?.x || 0);
    const wy = Number(worldPoint?.y || 0);
    const rotation = overlayRotationDegrees(overlay);
    if (rotation && bbox && typeof bbox === "object") {
        const cx = Number(bbox.x || 0) + Math.max(0.0001, Number(bbox.width || 0)) / 2;
        const cy = Number(bbox.y || 0) + Math.max(0.0001, Number(bbox.height || 0)) / 2;
        const radians = rotation * Math.PI / 180;
        const dx = (lx - cx) * sx;
        const dy = (ly - cy) * sy;
        const rotatedX = dx * Math.cos(radians) - dy * Math.sin(radians);
        const rotatedY = dx * Math.sin(radians) + dy * Math.cos(radians);
        return {
            tx: wx - sx * cx - rotatedX,
            ty: wy - sy * cy - rotatedY
        };
    }
    return {
        tx: wx - sx * lx,
        ty: wy - sy * ly
    };
}

function distance(left, right) {
    const dx = Number(left?.x || 0) - Number(right?.x || 0);
    const dy = Number(left?.y || 0) - Number(right?.y || 0);
    return Math.hypot(dx, dy);
}

export default function PerspectiveViziCanvasBridge(props) {
    useDomThemeVersion();
    const rootRef = useRef(null);
    const svgRef = useRef(null);
    const svgRawCacheRef = useRef(new Map());
    const sourceDocument = isPlainObject(props.document) ? props.document : {};
    const perspectiveClientStore = getPerspectiveClientStore(props);
    const hostSize = resolveCanvasHostSize(props);
    const defaultHostSize = resolveCanvasDefaultSize(props);
    const previewActive = detectPerspectivePreviewMode(props);
    const designerActive = detectPerspectiveDesignerMode(props);
    const editorVisible = designerActive && !previewActive;
    const isLiveMode = !designerActive || previewActive;
    const browserRuntimeMode = isLiveMode && !designerActive;
    const [rootSize, setRootSize] = useState({
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT
    });
    const [browserViewportWidth, setBrowserViewportWidth] = useState(() => readBrowserViewportWidth());
    const [browserViewportHeight, setBrowserViewportHeight] = useState(() => readBrowserViewportHeight());
    const effectiveHostSize = (
        toPositiveNumber(rootSize?.width) && toPositiveNumber(rootSize?.height)
            ? rootSize
            : hostSize
    );
    const responsiveViewBox = parseViewBoxParts(normalizeViewBox(sourceDocument, effectiveHostSize));
    const documentViewBounds = parseViewBoxParts(normalizeViewBox(sourceDocument));
    const externalShapes = getPersistedArrayValue(props, "shapes", EMPTY_ARRAY);
    const externalOverlays = getPersistedArrayValue(props, "svgOverlays", EMPTY_ARRAY);
    const externalSelectedIds = getModelValue(props, "selectedIds", EMPTY_ARRAY);
    const externalSelectedOverlayIds = getModelValue(props, "selectedOverlayIds", EMPTY_ARRAY);
    const externalTool = String(getModelValue(props, "tool", "select") || "select");
    const externalShowGrid = Boolean(getModelValue(props, "showGrid", false));
    const externalGridSizeRaw = Number(getModelValue(props, "gridSize", 20));
    const externalGridSize = Number.isFinite(externalGridSizeRaw) && externalGridSizeRaw > 0
        ? externalGridSizeRaw
        : 20;
    const externalToolbarCollapsed = Boolean(getModelValue(props, "toolbarCollapsed", false));
    const externalToolbarPosition = normalizeToolbarPosition(getModelValue(props, "toolbarPosition", TOOLBAR_DEFAULT_POSITION));
    const externalShowRulers = Boolean(getModelValue(props, "showRulers", false));
    const externalShowTagPaths = Boolean(getModelValue(props, "showTagPaths", false));
    const externalSelectionMode = String(getModelValue(props, "selectionMode", "all") || "all");
    const externalStrokeNormalizeWidthRaw = Number(getModelValue(props, "strokeNormalizeWidth", NORMALIZED_SVG_STROKE_WIDTH));
    const externalStrokeNormalizeWidth = Number.isFinite(externalStrokeNormalizeWidthRaw) && externalStrokeNormalizeWidthRaw > 0
        ? externalStrokeNormalizeWidthRaw
        : NORMALIZED_SVG_STROKE_WIDTH;
    const propHmiStateStyleMaps = getModelValue(
        props,
        "hmiStateStyleMaps",
        getModelValue(props, "udtStateStyleMaps", EMPTY_MAP)
    );
    const [fileHmiStateStyleMaps, setFileHmiStateStyleMaps] = useState(EMPTY_MAP);
    const [fileHmiStateStyleDefinitions, setFileHmiStateStyleDefinitions] = useState(EMPTY_MAP);
    const [hmiStateStyleMapFilePath, setHmiStateStyleMapFilePath] = useState("");
    const [hmiStateStyleMapError, setHmiStateStyleMapError] = useState("");
    const [hmiStateStyleMapRefreshing, setHmiStateStyleMapRefreshing] = useState(false);
    const [hmiStateStyleMapLastModified, setHmiStateStyleMapLastModified] = useState(0);
    const propHmiStateStyleMapsKey = JSON.stringify(propHmiStateStyleMaps || {});
    const fileHmiStateStyleMapsKey = JSON.stringify(fileHmiStateStyleMaps || {});
    const effectiveHmiStateStyleMaps = useMemo(
        () => mergeHmiStateStyleMapSources(fileHmiStateStyleMaps, propHmiStateStyleMaps),
        [fileHmiStateStyleMapsKey, propHmiStateStyleMapsKey]
    );
    const hmiStateStyleMapIndex = useMemo(
        () => normalizeHmiStateStyleMapIndex(effectiveHmiStateStyleMaps),
        [effectiveHmiStateStyleMaps]
    );
    const svgLibraryEnabled = Boolean(getModelValue(props, "svgLibraryEnabled", true));
    const externalShapesKey = JSON.stringify(coerceArray(externalShapes));
    const externalOverlaysKey = JSON.stringify(coerceArray(externalOverlays));
    const externalSelectedIdsKey = JSON.stringify(coerceArray(externalSelectedIds));
    const externalSelectedOverlayIdsKey = JSON.stringify(coerceArray(externalSelectedOverlayIds));
    const externalToolbarPositionKey = JSON.stringify(externalToolbarPosition || TOOLBAR_DEFAULT_POSITION);
    const [shapes, setShapesState] = useState(coerceArray(externalShapes));
    const [svgOverlays, setSvgOverlaysState] = useState(coerceArray(externalOverlays));
    const [selectedIds, setSelectedIds] = useState(coerceArray(externalSelectedIds));
    const [selectedOverlayIds, setSelectedOverlayIds] = useState(coerceArray(externalSelectedOverlayIds));
    const [tool, setToolState] = useState(externalTool);
    const [showGrid, setShowGridState] = useState(externalShowGrid);
    const [toolbarCollapsed, setToolbarCollapsedState] = useState(externalToolbarCollapsed);
    const [toolbarPosition, setToolbarPositionState] = useState(() => clampToolbarPosition(
        externalToolbarPosition || TOOLBAR_DEFAULT_POSITION,
        externalToolbarCollapsed ? COLLAPSED_TOOLBAR_WIDTH : TOOLBAR_WIDTH,
        160,
        readBrowserViewportWidth(),
        readBrowserViewportHeight()
    ));
    const [showRulers, setShowRulersState] = useState(externalShowRulers);
    const [showTagPaths, setShowTagPathsState] = useState(externalShowTagPaths);
    const [hiddenTagBubbleIds, setHiddenTagBubbleIds] = useState([]);
    const hiddenTagBubbleTimersRef = useRef(new Map());
    const [selectionMode, setSelectionModeState] = useState(externalSelectionMode);
    const [strokeNormalizeWidthDraft, setStrokeNormalizeWidthDraft] = useState(formatPanelNumber(externalStrokeNormalizeWidth));
    const [drawing, setDrawing] = useState(null);
    const [dragState, setDragState] = useState(null);
    const [marquee, setMarquee] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [selectedSegment, setSelectedSegment] = useState(null);
    const [dragSegment, setDragSegment] = useState(null);
    const [dragHandle, setDragHandle] = useState(null);
    const [shapeResize, setShapeResize] = useState(null);
    const [overlayResize, setOverlayResize] = useState(null);
    const [svgCatalogFiles, setSvgCatalogFiles] = useState(EMPTY_ARRAY);
    const [svgLibraryError, setSvgLibraryError] = useState("");
    const [svgLibraryExternalDirectory, setSvgLibraryExternalDirectory] = useState("");
    const [svgLibraryExternalCount, setSvgLibraryExternalCount] = useState(0);
    const [svgLibraryRefreshing, setSvgLibraryRefreshing] = useState(false);
    const [svgLibraryUploading, setSvgLibraryUploading] = useState(false);
    const [ignitionTagOptions, setIgnitionTagOptions] = useState(EMPTY_ARRAY);
    const [ignitionTagValuesByPath, setIgnitionTagValuesByPath] = useState(() => new Map());
    const [ignitionTagMetaByPath, setIgnitionTagMetaByPath] = useState(() => new Map());
    const [ignitionTagsError, setIgnitionTagsError] = useState("");
    const [ignitionTagsLoading, setIgnitionTagsLoading] = useState(false);
    const [ignitionTagsLoaded, setIgnitionTagsLoaded] = useState(false);
    const [quickTagPickerState, setQuickTagPickerState] = useState({
        overlayId: "",
        overlayIds: EMPTY_ARRAY,
        nonce: 0,
        clientX: 0,
        clientY: 0
    });
    const [quickSvgPickerState, setQuickSvgPickerState] = useState({
        open: false,
        clientX: 0,
        clientY: 0,
        worldPoint: null
    });
    const [quickSvgPickerQuery, setQuickSvgPickerQuery] = useState("");
    const [importOpen, setImportOpen] = useState(false);
    const [widgetOpen, setWidgetOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [importAnchor, setImportAnchor] = useState(null);
    const [propertiesSelectionKey, setPropertiesSelectionKey] = useState("");
    const [propertyPanelWidth, setPropertyPanelWidth] = useState(readStoredPropertyPanelWidth);
    const [propertyPanelHeight, setPropertyPanelHeight] = useState(readStoredPropertyPanelHeight);
    const [propertyPanelResizing, setPropertyPanelResizing] = useState(false);
    const shapesRef = useRef(coerceArray(externalShapes));
    const overlaysRef = useRef(coerceArray(externalOverlays));
    const clipboardRef = useRef({ shapes: [], overlays: [], pasteCount: 0 });
    const historyRef = useRef({ past: [], future: [], current: null });
    const historyRestoreRef = useRef(false);
    const propertyPanelResizeRef = useRef({
        resizing: false,
        mode: "",
        startX: 0,
        startY: 0,
        startWidth: PROPERTY_PANEL_WIDTH,
        startHeight: PROPERTY_PANEL_HEIGHT,
        panelTop: 0
    });
    const toolbarPanelRef = useRef(null);
    const toolbarPositionRef = useRef(toolbarPosition);
    const toolbarDragRef = useRef({ dragging: false, offsetX: 0, offsetY: 0, panelWidth: TOOLBAR_WIDTH, panelHeight: 160 });
    const svgCatalogRequestIdRef = useRef(0);
    const hmiStateStyleMapRequestIdRef = useRef(0);
    const quickSvgPickerInputRef = useRef(null);
    const runtimeDocumentViewBounds = useMemo(
        () => expandViewBoundsToFitContent(documentViewBounds, shapes, svgOverlays),
        [
            documentViewBounds.x,
            documentViewBounds.y,
            documentViewBounds.width,
            documentViewBounds.height,
            shapes,
            svgOverlays
        ]
    );
    const viewBox = browserRuntimeMode ? runtimeDocumentViewBounds : responsiveViewBox;
    const ignitionTagOptionByPath = useMemo(() => {
        const out = new Map();
        coerceArray(ignitionTagOptions).forEach((option) => {
            const path = String(option?.path || "").trim();
            if (!path) {
                return;
            }
            out.set(path, option);
            out.set(path.toLowerCase(), option);
        });
        return out;
    }, [ignitionTagOptions]);
    const applyIgnitionTagMetadataToOverlay = useCallback((overlay, rawTagPath = null) => {
        if (!isPlainObject(overlay)) {
            return overlay;
        }
        const tagPath = String(rawTagPath ?? overlay?.tagPath ?? getOverlayFillBindingTagPath(overlay) ?? "").trim();
        if (!tagPath) {
            return overlay;
        }
        const option = ignitionTagOptionByPath.get(tagPath) || ignitionTagOptionByPath.get(tagPath.toLowerCase());
        if (!option) {
            return overlay;
        }

        const typeId = String(option?.typeId || "").trim();
        const udtName = String(option?.udtName || "").trim();
        const dataType = String(option?.dataType || "").trim();
        const objectType = String(option?.objectType || "").trim();
        const next = { ...overlay };
        let changed = false;

        if (typeId && String(next.typeId || "") !== typeId) {
            next.typeId = typeId;
            changed = true;
        }
        if (udtName && String(next.udtName || "") !== udtName) {
            next.udtName = udtName;
            next.udtType = String(next.udtType || "").trim() || udtName;
            next.templateName = String(next.templateName || "").trim() || udtName;
            changed = true;
        }
        if (dataType && String(next.dataType || "") !== dataType) {
            next.dataType = dataType;
            changed = true;
        }
        if (objectType && String(next.objectType || "") !== objectType) {
            next.objectType = objectType;
            changed = true;
        }

        return changed ? next : overlay;
    }, [ignitionTagOptionByPath]);
    const svgOverlaysWithTagMetadata = useMemo(
        () => coerceArray(svgOverlays).map((overlay) => applyIgnitionTagMetadataToOverlay(overlay)),
        [svgOverlays, applyIgnitionTagMetadataToOverlay]
    );
    const canvasSvgOverlays = useMemo(
        () => applyHmiStateStyleMapsToOverlays(svgOverlaysWithTagMetadata, hmiStateStyleMapIndex),
        [svgOverlaysWithTagMetadata, hmiStateStyleMapIndex]
    );

    useEffect(() => {
        shapesRef.current = shapes;
    }, [shapes]);

    useEffect(() => {
        overlaysRef.current = svgOverlays;
    }, [svgOverlays]);

    useEffect(() => {
        toolbarPositionRef.current = toolbarPosition;
    }, [toolbarPosition]);

    useEffect(() => {
        const node = rootRef.current;
        if (!node || typeof node.getBoundingClientRect !== "function") {
            return undefined;
        }

        const updateRootSize = () => {
            const rect = node.getBoundingClientRect();
            const width = toPositiveNumber(rect?.width) || DEFAULT_CANVAS_WIDTH;
            const height = toPositiveNumber(rect?.height) || DEFAULT_CANVAS_HEIGHT;
            setRootSize((previous) => (
                previous.width === width && previous.height === height
                    ? previous
                    : { width, height }
            ));
        };

        updateRootSize();

        if (typeof ResizeObserver === "function") {
            const observer = new ResizeObserver(() => {
                updateRootSize();
            });
            observer.observe(node);
            return () => observer.disconnect();
        }

        if (typeof window !== "undefined") {
            window.addEventListener("resize", updateRootSize);
            return () => window.removeEventListener("resize", updateRootSize);
        }

        return undefined;
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") {
            return undefined;
        }

        const updateViewportHeight = () => {
            const nextWidth = readBrowserViewportWidth();
            const nextHeight = readBrowserViewportHeight();
            setBrowserViewportWidth((previous) => (previous === nextWidth ? previous : nextWidth));
            setBrowserViewportHeight((previous) => (previous === nextHeight ? previous : nextHeight));
        };

        updateViewportHeight();
        window.addEventListener("resize", updateViewportHeight);
        window.visualViewport?.addEventListener?.("resize", updateViewportHeight);
        return () => {
            window.removeEventListener("resize", updateViewportHeight);
            window.visualViewport?.removeEventListener?.("resize", updateViewportHeight);
        };
    }, []);

    useEffect(() => {
        if (typeof window === "undefined" || !window.localStorage) {
            return;
        }
        try {
            window.localStorage.setItem(PROPERTY_PANEL_WIDTH_STORAGE_KEY, String(Math.round(propertyPanelWidth)));
        } catch (_error) {
        }
    }, [propertyPanelWidth]);

    useEffect(() => {
        if (typeof window === "undefined" || !window.localStorage) {
            return;
        }
        try {
            window.localStorage.setItem(PROPERTY_PANEL_HEIGHT_STORAGE_KEY, String(Math.round(propertyPanelHeight)));
        } catch (_error) {
        }
    }, [propertyPanelHeight]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return undefined;
        }
        const clampWidthToRoot = (value) =>
            clampPropertyPanelWidth(
                value,
                Number(rootSize?.width || browserViewportWidth || DEFAULT_CANVAS_WIDTH)
            );
        const clampHeightToRoot = (value, panelTop = 0) =>
            clampPropertyPanelHeight(
                value,
                Math.max(
                    PROPERTY_PANEL_MIN_HEIGHT,
                    Number(rootSize?.height || browserViewportHeight || DEFAULT_CANVAS_HEIGHT) -
                        Number(panelTop || 0) -
                        16
                )
            );
        function onMove(event) {
            if (!propertyPanelResizeRef.current.resizing) {
                return;
            }
            if (propertyPanelResizeRef.current.mode === "height") {
                const nextHeight = clampHeightToRoot(
                    propertyPanelResizeRef.current.startHeight +
                        (Number(event.clientY) - propertyPanelResizeRef.current.startY),
                    propertyPanelResizeRef.current.panelTop
                );
                setPropertyPanelHeight(nextHeight);
                return;
            }
            const nextWidth = clampWidthToRoot(
                propertyPanelResizeRef.current.startWidth +
                    (Number(event.clientX) - propertyPanelResizeRef.current.startX)
            );
            setPropertyPanelWidth(nextWidth);
        }
        function endResize() {
            if (!propertyPanelResizeRef.current.resizing) {
                return;
            }
            propertyPanelResizeRef.current.resizing = false;
            propertyPanelResizeRef.current.mode = "";
            setPropertyPanelResizing(false);
        }
        function onKeyDown(event) {
            if (event.key === "Escape") {
                endResize();
            }
        }

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", endResize);
        window.addEventListener("pointerup", endResize);
        window.addEventListener("pointercancel", endResize);
        window.addEventListener("blur", endResize);
        window.addEventListener("keydown", onKeyDown);
        document.addEventListener("mouseleave", endResize);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", endResize);
            window.removeEventListener("pointerup", endResize);
            window.removeEventListener("pointercancel", endResize);
            window.removeEventListener("blur", endResize);
            window.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("mouseleave", endResize);
            endResize();
        };
    }, [browserViewportHeight, browserViewportWidth, rootSize]);

    useEffect(() => {
        setPropertyPanelWidth((previous) =>
            clampPropertyPanelWidth(
                previous,
                Number(rootSize?.width || browserViewportWidth || DEFAULT_CANVAS_WIDTH)
            )
        );
        setPropertyPanelHeight((previous) =>
            clampPropertyPanelHeight(
                previous,
                Math.max(
                    PROPERTY_PANEL_MIN_HEIGHT,
                    Number(rootSize?.height || browserViewportHeight || DEFAULT_CANVAS_HEIGHT) - 32
                )
            )
        );
    }, [browserViewportHeight, browserViewportWidth, rootSize]);

    useEffect(() => {
        if (!propertyPanelResizing || typeof document === "undefined") {
            return undefined;
        }
        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;
        const resizeCursor = propertyPanelResizeRef.current.mode === "height" ? "row-resize" : "col-resize";
        document.body.style.cursor = resizeCursor;
        document.body.style.userSelect = "none";
        return () => {
            document.body.style.cursor =
                previousCursor === "col-resize" || previousCursor === "row-resize"
                    ? ""
                    : previousCursor;
            document.body.style.userSelect = previousUserSelect;
        };
    }, [propertyPanelResizing]);

    useEffect(() => {
        const next = coerceArray(externalShapes);
        shapesRef.current = next;
        setShapesState(next);
    }, [externalShapesKey]);

    useEffect(() => {
        const next = coerceArray(externalOverlays);
        overlaysRef.current = next;
        setSvgOverlaysState(next);
    }, [externalOverlaysKey]);

    useEffect(() => {
        setSelectedIds(coerceArray(externalSelectedIds));
    }, [externalSelectedIdsKey]);

    useEffect(() => {
        setSelectedOverlayIds(coerceArray(externalSelectedOverlayIds));
    }, [externalSelectedOverlayIdsKey]);

    useEffect(() => {
        setToolState(externalTool);
    }, [externalTool]);

    useEffect(() => {
        setShowGridState(externalShowGrid);
    }, [externalShowGrid]);

    useEffect(() => {
        setShowRulersState(externalShowRulers);
    }, [externalShowRulers]);

    useEffect(() => {
        setShowTagPathsState(externalShowTagPaths);
    }, [externalShowTagPaths]);

    useEffect(() => {
        if (!showTagPaths && hiddenTagBubbleIds.length) {
            setHiddenTagBubbleIds((previous) => {
                const next = previous.filter((entry) => {
                    const value = String(entry || "").trim();
                    return value && value.includes(":") && !value.startsWith("tag:");
                });
                if (next.length === previous.length) {
                    return previous;
                }
                const keep = new Set(next);
                previous.forEach((entry) => {
                    if (keep.has(entry)) {
                        return;
                    }
                    const timerId = hiddenTagBubbleTimersRef.current.get(entry);
                    if (timerId) {
                        window.clearTimeout(timerId);
                    }
                    hiddenTagBubbleTimersRef.current.delete(entry);
                });
                return next;
            });
        }
    }, [hiddenTagBubbleIds.length, showTagPaths]);

    useEffect(() => () => {
        hiddenTagBubbleTimersRef.current.forEach((timerId) => {
            window.clearTimeout(timerId);
        });
        hiddenTagBubbleTimersRef.current.clear();
    }, []);

    useEffect(() => {
        setToolbarCollapsedState(externalToolbarCollapsed);
    }, [externalToolbarCollapsed]);

    useEffect(() => {
        const panelWidth = toolbarCollapsed ? COLLAPSED_TOOLBAR_WIDTH : TOOLBAR_WIDTH;
        const panelHeight = toolbarPanelRef.current?.getBoundingClientRect?.().height || 160;
        const nextPosition = clampToolbarPosition(
            externalToolbarPosition || TOOLBAR_DEFAULT_POSITION,
            panelWidth,
            panelHeight,
            browserViewportWidth,
            browserViewportHeight
        );
        toolbarPositionRef.current = nextPosition;
        setToolbarPositionState(nextPosition);
    }, [browserViewportHeight, browserViewportWidth, externalToolbarPositionKey, toolbarCollapsed]);

    useEffect(() => {
        setStrokeNormalizeWidthDraft(formatPanelNumber(externalStrokeNormalizeWidth));
    }, [externalStrokeNormalizeWidth]);

    useEffect(() => {
        setSelectionModeState(externalSelectionMode);
    }, [externalSelectionMode]);

    const overlayFillBindingPaths = useMemo(() => {
        const seen = new Set();
        const out = [];

        const addPath = (path) => {
            const key = String(path || "").toLowerCase();
            if (!path || seen.has(key)) return;
            seen.add(key);
            out.push(path);
        };
        const addBrowsedChildPaths = (basePath) => {
            const root = String(basePath || "").trim();
            if (!root) return;
            const lowerRoot = root.toLowerCase();
            const prefixes = [`${lowerRoot}/`, `${lowerRoot}.`];
            let added = 0;
            coerceArray(ignitionTagOptions).forEach((option) => {
                if (added >= 250) return;
                const path = String(option?.path || "").trim();
                const lower = path.toLowerCase();
                if (!path || lower === lowerRoot) return;
                if (!prefixes.some((prefix) => lower.startsWith(prefix))) return;
                addPath(path);
                added += 1;
            });
        };

        coerceArray(canvasSvgOverlays).forEach((overlay) => {
            addPath(getOverlayFillBindingTagPath(overlay));
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            addPath(basePath);
            addBrowsedChildPaths(basePath);
            if (basePath && !overlay?.widget && !overlay?.embeddedView) {
                IGNITION_DESCRIPTION_MEMBERS.forEach((member) => addPath(`${basePath}/${member}`));
            }
            if (basePath && shouldQueryOverlayFillStateMembers(overlay)) {
                IGNITION_FILL_STATE_MEMBERS.forEach((member) => addPath(`${basePath}/${member}`));
            }
            if (basePath && shouldQueryOverlayModeMembers(overlay)) {
                IGNITION_MODE_MEMBERS.forEach((member) => addPath(`${basePath}/${member}`));
            }
            if (basePath && isBinOverlay(overlay)) {
                BIN_UDT_MEMBERS.forEach((member) => addPath(`${basePath}/${member}`));
            }
            if (basePath && isMotorOverlay(overlay)) {
                MOTOR_UDT_MEMBERS.forEach((member) => addPath(`${basePath}/${member}`));
            }
            if (basePath && usesTwoWayUdtOverlay(overlay)) {
                DIVERTER_UDT_MEMBERS.forEach((member) => addPath(`${basePath}/${member}`));
            }
            if (basePath && isDocOrDicOverlay(overlay)) {
                DOC_DIC_UDT_MEMBERS.forEach((member) => addPath(`${basePath}/${member}`));
            }
        });

        coerceArray(shapes).forEach((shape) => {
            addPath(String(shape?.tagPath || "").trim());
        });

        return out;
    }, [canvasSvgOverlays, ignitionTagOptions, shapes]);
    const overlayFillBindingPathsKey = JSON.stringify(overlayFillBindingPaths);
    const overlayFillBindingPathChunks = useMemo(
        () => chunkIgnitionTagValuePaths(overlayFillBindingPaths),
        [overlayFillBindingPathsKey]
    );
    const overlayFillBindingPathChunksKey = JSON.stringify(overlayFillBindingPathChunks);
    const ignitionTagRequestIdRef = useRef(0);

    const loadIgnitionTags = useCallback(async () => {
        const requestId = ignitionTagRequestIdRef.current + 1;
        ignitionTagRequestIdRef.current = requestId;
        setIgnitionTagsLoading(true);
        setIgnitionTagsError("");
        let lastError = "Failed to load Ignition tags.";

        for (const routePath of MODULE_DATA_ROUTE_CANDIDATES) {
            try {
                const response = await fetch(routePath, {
                    cache: "no-store",
                    credentials: "same-origin"
                });
                if (!response.ok) {
                    lastError = `Failed to load Ignition tags (${response.status}).`;
                    continue;
                }

                const payload = await response.json();
                if (ignitionTagRequestIdRef.current !== requestId) {
                    return;
                }

                setIgnitionTagOptions(normalizeIgnitionTagEntries(payload));
                setIgnitionTagsError(String(payload?.error || "").trim());
                setIgnitionTagsLoaded(true);
                setIgnitionTagsLoading(false);
                return;
            } catch (error) {
                lastError = String(error?.message || "Failed to load Ignition tags.");
            }
        }

        if (ignitionTagRequestIdRef.current === requestId) {
            setIgnitionTagOptions(EMPTY_ARRAY);
            setIgnitionTagsError(lastError);
            setIgnitionTagsLoaded(true);
            setIgnitionTagsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!overlayFillBindingPathChunks.length) {
            setIgnitionTagValuesByPath((previous) => (previous.size ? new Map() : previous));
            setIgnitionTagMetaByPath((previous) => (previous.size ? new Map() : previous));
            return undefined;
        }

        let cancelled = false;
        let timerId = 0;
        let inFlight = false;

        const loadIgnitionTagValues = async () => {
            const mergedValues = new Map();
            const mergedMeta = new Map();

            for (const routePath of MODULE_TAG_VALUE_ROUTE_CANDIDATES) {
                mergedValues.clear();
                mergedMeta.clear();

                try {
                    const payloads = await Promise.all(overlayFillBindingPathChunks.map(async (pathChunk) => {
                        const queryValue = encodeURIComponent(JSON.stringify(pathChunk));
                        const response = await fetch(`${routePath}?paths=${queryValue}`, {
                            cache: "no-store",
                            credentials: "same-origin"
                        });
                        if (!response.ok) {
                            throw new Error(`Failed to load tag values (${response.status}).`);
                        }
                        return response.json();
                    }));

                    if (cancelled) {
                        return false;
                    }

                    payloads.forEach((payload) => {
                        const normalized = normalizeIgnitionTagValuePayload(payload);
                        normalized.values.forEach((value, key) => {
                            mergedValues.set(key, value);
                        });
                        normalized.meta.forEach((value, key) => {
                            mergedMeta.set(key, value);
                        });
                    });

                    if (cancelled) {
                        return false;
                    }

                    setIgnitionTagValuesByPath((previous) => (
                        areMapsEqualByValue(previous, mergedValues, areIgnitionTagValuesEqual)
                            ? previous
                            : new Map(mergedValues)
                    ));
                    setIgnitionTagMetaByPath((previous) => (
                        areMapsEqualByValue(previous, mergedMeta, areIgnitionTagMetaRecordsEqual)
                            ? previous
                            : new Map(mergedMeta)
                    ));
                    return true;
                } catch (_error) {
                }
            }

            return false;
        };

        const scheduleNext = (delay = IGNITION_TAG_VALUE_POLL_MS) => {
            if (cancelled || typeof window === "undefined" || typeof window.setTimeout !== "function") {
                return;
            }
            timerId = window.setTimeout(runPoll, Math.max(50, Number(delay) || IGNITION_TAG_VALUE_POLL_MS));
        };

        const runPoll = async () => {
            if (cancelled || inFlight) {
                return;
            }
            inFlight = true;
            const startedAt = Date.now();
            try {
                await loadIgnitionTagValues();
            } finally {
                inFlight = false;
                if (!cancelled) {
                    const elapsed = Date.now() - startedAt;
                    scheduleNext(Math.max(50, IGNITION_TAG_VALUE_POLL_MS - elapsed));
                }
            }
        };

        runPoll();

        return () => {
            cancelled = true;
            if (timerId && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
                window.clearTimeout(timerId);
            }
        };
    }, [overlayFillBindingPathChunksKey]);

    const persistValue = useCallback(
        (path, value) => {
            writeComponentProp(props, path, value);
        },
        [props]
    );

    useEffect(() => {
        if (!designerActive || previewActive) {
            return;
        }

        const source = getComponentPropSource(props);
        const hasModelStyleMaps = isPlainObject(source.model)
            && Object.prototype.hasOwnProperty.call(source.model, "hmiStateStyleMaps");

        if (hasModelStyleMaps) {
            return;
        }

        const rootStyleMaps = isPlainObject(source.hmiStateStyleMaps)
            ? source.hmiStateStyleMaps
            : {};

        writeComponentProp(props, "model.hmiStateStyleMaps", rootStyleMaps);
    }, [designerActive, previewActive, props]);

    const persistShapes = useCallback(
        (nextShapes) => {
            persistValue("shapes", nextShapes);
        },
        [persistValue]
    );

    const persistSvgOverlays = useCallback(
        (nextOverlays) => {
            persistValue("svgOverlays", nextOverlays);
        },
        [persistValue]
    );

    const updateShapes = useCallback(
        (updater, options = {}) => {
            const nextShapes = coerceArray(
                typeof updater === "function" ? updater(shapesRef.current) : updater
            );
            shapesRef.current = nextShapes;
            setShapesState(nextShapes);
            if (options.persist) {
                persistShapes(nextShapes);
            }
            return nextShapes;
        },
        [persistShapes]
    );

    const updateSvgOverlays = useCallback(
        (updater, options = {}) => {
            const nextOverlays = coerceArray(
                typeof updater === "function" ? updater(overlaysRef.current) : updater
            );
            overlaysRef.current = nextOverlays;
            setSvgOverlaysState(nextOverlays);
            if (options.persist) {
                persistSvgOverlays(nextOverlays);
            }
            return nextOverlays;
        },
        [persistSvgOverlays]
    );

    const setTool = useCallback((nextTool) => {
        const value = String(nextTool || "select");
        setToolState(value);
        persistValue("tool", value);
    }, [persistValue]);

    const setShowGrid = useCallback((nextValue) => {
        const value = Boolean(nextValue);
        setShowGridState(value);
        persistValue("showGrid", value);
    }, [persistValue]);

    const setToolbarCollapsed = useCallback((nextValue) => {
        const value = Boolean(nextValue);
        setToolbarCollapsedState(value);
        persistValue("toolbarCollapsed", value);
        if (value) {
            setImportOpen(false);
            setWidgetOpen(false);
            setHelpOpen(false);
        }
    }, [persistValue]);

    const persistToolbarPosition = useCallback((position) => {
        const panelWidth = toolbarCollapsed ? COLLAPSED_TOOLBAR_WIDTH : TOOLBAR_WIDTH;
        const panelHeight = toolbarPanelRef.current?.getBoundingClientRect?.().height || 160;
        const nextPosition = clampToolbarPosition(
            position,
            panelWidth,
            panelHeight,
            browserViewportWidth,
            browserViewportHeight
        );
        toolbarPositionRef.current = nextPosition;
        setToolbarPositionState(nextPosition);
        persistValue("toolbarPosition", nextPosition);
        return nextPosition;
    }, [browserViewportHeight, browserViewportWidth, persistValue, toolbarCollapsed]);

    const redockToolbar = useCallback((event) => {
        stopInteractivePropagation(event);
        persistToolbarPosition(TOOLBAR_DEFAULT_POSITION);
    }, [persistToolbarPosition]);

    const startToolbarDrag = useCallback((event) => {
        if (!event || Number(event.button || 0) !== 0) {
            return;
        }
        const target = event.target;
        if (
            target instanceof Element
            && target.closest("button,input,select,textarea,a,[data-no-toolbar-drag='true']")
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        const rect = toolbarPanelRef.current?.getBoundingClientRect?.();
        const startPosition = clampToolbarPosition(
            toolbarPositionRef.current || toolbarPosition,
            rect?.width || (toolbarCollapsed ? COLLAPSED_TOOLBAR_WIDTH : TOOLBAR_WIDTH),
            rect?.height || 160,
            browserViewportWidth,
            browserViewportHeight
        );
        toolbarDragRef.current = {
            dragging: true,
            offsetX: Number(event.clientX) - startPosition.x,
            offsetY: Number(event.clientY) - startPosition.y,
            panelWidth: rect?.width || (toolbarCollapsed ? COLLAPSED_TOOLBAR_WIDTH : TOOLBAR_WIDTH),
            panelHeight: rect?.height || 160
        };
        toolbarPositionRef.current = startPosition;
        setToolbarPositionState(startPosition);
    }, [browserViewportHeight, browserViewportWidth, toolbarCollapsed, toolbarPosition]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return undefined;
        }

        const onPointerMove = (event) => {
            const drag = toolbarDragRef.current;
            if (!drag?.dragging) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const nextPosition = clampToolbarPosition(
                {
                    x: Number(event.clientX) - Number(drag.offsetX || 0),
                    y: Number(event.clientY) - Number(drag.offsetY || 0)
                },
                drag.panelWidth,
                drag.panelHeight,
                browserViewportWidth,
                browserViewportHeight
            );
            toolbarPositionRef.current = nextPosition;
            setToolbarPositionState((previous) => (
                previous.x === nextPosition.x && previous.y === nextPosition.y
                    ? previous
                    : nextPosition
            ));
        };

        const endToolbarDrag = (event) => {
            const drag = toolbarDragRef.current;
            if (!drag?.dragging) {
                return;
            }
            event?.preventDefault?.();
            event?.stopPropagation?.();
            toolbarDragRef.current = { ...drag, dragging: false };
            persistToolbarPosition(toolbarPositionRef.current || TOOLBAR_DEFAULT_POSITION);
        };

        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", endToolbarDrag, true);
        window.addEventListener("pointercancel", endToolbarDrag, true);
        window.addEventListener("blur", endToolbarDrag);
        return () => {
            window.removeEventListener("pointermove", onPointerMove, true);
            window.removeEventListener("pointerup", endToolbarDrag, true);
            window.removeEventListener("pointercancel", endToolbarDrag, true);
            window.removeEventListener("blur", endToolbarDrag);
        };
    }, [browserViewportHeight, browserViewportWidth, persistToolbarPosition]);

    useEffect(() => {
        const panelWidth = toolbarCollapsed ? COLLAPSED_TOOLBAR_WIDTH : TOOLBAR_WIDTH;
        const panelHeight = toolbarPanelRef.current?.getBoundingClientRect?.().height || 160;
        const nextPosition = clampToolbarPosition(
            toolbarPositionRef.current || toolbarPosition,
            panelWidth,
            panelHeight,
            browserViewportWidth,
            browserViewportHeight
        );
        if (nextPosition.x === toolbarPositionRef.current?.x && nextPosition.y === toolbarPositionRef.current?.y) {
            return;
        }
        toolbarPositionRef.current = nextPosition;
        setToolbarPositionState(nextPosition);
    }, [browserViewportHeight, browserViewportWidth, toolbarCollapsed, toolbarPosition]);

    const setShowRulers = useCallback((nextValue) => {
        const value = Boolean(nextValue);
        setShowRulersState(value);
        persistValue("showRulers", value);
    }, [persistValue]);

    const setShowTagPaths = useCallback((nextValue) => {
        const value = Boolean(nextValue);
        setShowTagPathsState(value);
        persistValue("showTagPaths", value);
    }, [persistValue]);

    const handleHideTagBubble = useCallback((id) => {
        const bubbleId = String(id || "").trim();
        if (!bubbleId) {
            return;
        }
        const existingTimer = hiddenTagBubbleTimersRef.current.get(bubbleId);
        if (existingTimer) {
            window.clearTimeout(existingTimer);
        }
        setHiddenTagBubbleIds((previous) => (
            previous.includes(bubbleId) ? previous : [...previous, bubbleId]
        ));
        const timerId = window.setTimeout(() => {
            hiddenTagBubbleTimersRef.current.delete(bubbleId);
            setHiddenTagBubbleIds((previous) => previous.filter((entry) => entry !== bubbleId));
        }, 30000);
        hiddenTagBubbleTimersRef.current.set(bubbleId, timerId);
    }, []);

    const setSelectionMode = useCallback((nextMode) => {
        const value = String(nextMode || "all");
        setSelectionModeState(value);
        persistValue("selectionMode", value);
    }, [persistValue]);

    const resolvedStrokeNormalizeWidth = useMemo(() => {
        const parsed = parsePanelNumber(strokeNormalizeWidthDraft);
        return parsed != null && parsed > 0 ? parsed : NORMALIZED_SVG_STROKE_WIDTH;
    }, [strokeNormalizeWidthDraft]);

    const commitStrokeNormalizeWidth = useCallback(() => {
        const value = resolvedStrokeNormalizeWidth;
        setStrokeNormalizeWidthDraft(formatPanelNumber(value));
        persistValue("strokeNormalizeWidth", value);
        return value;
    }, [persistValue, resolvedStrokeNormalizeWidth]);

    const normalizeAllSvgStrokeWidths = useCallback(() => {
        const strokeWidth = commitStrokeNormalizeWidth();
        updateSvgOverlays(
            (previous) => coerceArray(previous).map((overlay) => {
                if (!overlay || overlay.widget) {
                    return overlay;
                }
                return {
                    ...overlay,
                    strokeWidth,
                    inner: updateSvgInnerStrokeWidth(overlay.inner, strokeWidth)
                };
            }),
            { persist: true }
        );
    }, [commitStrokeNormalizeWidth, updateSvgOverlays]);

    const makeHistorySnapshot = useCallback(() => ({
        shapes: cloneDeepValue(shapesRef.current),
        svgOverlays: cloneDeepValue(overlaysRef.current),
        selectedIds: cloneDeepValue(selectedIds),
        selectedOverlayIds: cloneDeepValue(selectedOverlayIds),
        tool: String(tool || "select"),
        editingId: editingId ? String(editingId) : null,
        selectedSegment: selectedSegment ? cloneDeepValue(selectedSegment) : null
    }), [editingId, selectedIds, selectedOverlayIds, selectedSegment, tool]);

    const applyHistorySnapshot = useCallback((snapshot) => {
        if (!snapshot || typeof snapshot !== "object") {
            return;
        }

        historyRestoreRef.current = true;
        const nextShapes = coerceArray(snapshot.shapes).map((shape) => cloneDeepValue(shape));
        const nextOverlays = coerceArray(snapshot.svgOverlays).map((overlay) => cloneDeepValue(overlay));
        shapesRef.current = nextShapes;
        overlaysRef.current = nextOverlays;
        setShapesState(nextShapes);
        setSvgOverlaysState(nextOverlays);
        persistShapes(nextShapes);
        persistSvgOverlays(nextOverlays);
        setSelectedIds(coerceArray(snapshot.selectedIds));
        setSelectedOverlayIds(coerceArray(snapshot.selectedOverlayIds));
        setToolState(String(snapshot.tool || "select"));
        persistValue("tool", String(snapshot.tool || "select"));
        setEditingId(snapshot.editingId ? String(snapshot.editingId) : null);
        setSelectedSegment(snapshot.selectedSegment ? cloneDeepValue(snapshot.selectedSegment) : null);
        setDrawing(null);
        setDragState(null);
        setDragHandle(null);
        setShapeResize(null);
        setOverlayResize(null);
        setMarquee(null);
        queueMicrotask(() => {
            historyRestoreRef.current = false;
        });
    }, [persistShapes, persistSvgOverlays, persistValue]);

    const undo = useCallback(() => {
        const history = historyRef.current;
        if (!history.past.length) {
            return;
        }
        const previous = history.past.pop();
        if (history.current) {
            history.future.push(cloneDeepValue(history.current));
        }
        history.current = cloneDeepValue(previous);
        applyHistorySnapshot(previous);
    }, [applyHistorySnapshot]);

    const redo = useCallback(() => {
        const history = historyRef.current;
        if (!history.future.length) {
            return;
        }
        const next = history.future.pop();
        if (history.current) {
            history.past.push(cloneDeepValue(history.current));
        }
        history.current = cloneDeepValue(next);
        applyHistorySnapshot(next);
    }, [applyHistorySnapshot]);

    const loadHmiStateStyleMaps = useCallback(async () => {
        const requestId = hmiStateStyleMapRequestIdRef.current + 1;
        hmiStateStyleMapRequestIdRef.current = requestId;
        setHmiStateStyleMapRefreshing(true);
        setHmiStateStyleMapError("");
        let lastError = "Failed to load HMI state style maps.";

        for (const routePath of HMI_STATE_STYLE_MAP_ROUTE_CANDIDATES) {
            try {
                const requestUrl = `${routePath}${routePath.includes("?") ? "&" : "?"}t=${Date.now()}`;
                const response = await fetch(requestUrl, {
                    cache: "no-store",
                    credentials: "same-origin"
                });
                if (!response.ok) {
                    lastError = `Failed to load HMI state style maps (${response.status}).`;
                    continue;
                }

                const payload = normalizeHmiStateStyleMapPayload(await response.json());
                if (hmiStateStyleMapRequestIdRef.current !== requestId) {
                    return;
                }

                setFileHmiStateStyleMaps(payload.maps);
                setFileHmiStateStyleDefinitions(payload.styles);
                setHmiStateStyleMapFilePath(payload.filePath);
                setHmiStateStyleMapLastModified(payload.lastModified);
                setHmiStateStyleMapError(payload.error);
                setHmiStateStyleMapRefreshing(false);
                return;
            } catch (error) {
                lastError = String(error?.message || "Failed to load HMI state style maps.");
            }
        }

        if (hmiStateStyleMapRequestIdRef.current === requestId) {
            setFileHmiStateStyleMaps(EMPTY_MAP);
            setFileHmiStateStyleDefinitions(EMPTY_MAP);
            setHmiStateStyleMapFilePath("");
            setHmiStateStyleMapLastModified(0);
            setHmiStateStyleMapError(lastError);
            setHmiStateStyleMapRefreshing(false);
        }
    }, []);

    useEffect(() => {
        loadHmiStateStyleMaps();
        return undefined;
    }, [loadHmiStateStyleMaps]);

    useEffect(() => {
        if (typeof document === "undefined") {
            return undefined;
        }

        const styleElementId = "mesora-hmi-state-style-map-css";
        const cssText = buildHmiStateStyleDefinitionCss(fileHmiStateStyleDefinitions);
        let styleElement = document.getElementById(styleElementId);
        if (!cssText) {
            if (styleElement && styleElement.parentNode) {
                styleElement.parentNode.removeChild(styleElement);
            }
            return undefined;
        }

        if (!styleElement) {
            styleElement = document.createElement("style");
            styleElement.id = styleElementId;
            styleElement.setAttribute("data-mesora-source", "hmi-state-style-maps");
            document.head.appendChild(styleElement);
        }
        if (styleElement.textContent !== cssText) {
            styleElement.textContent = cssText;
        }
        return undefined;
    }, [fileHmiStateStyleDefinitions]);

    const loadSvgCatalog = useCallback(async () => {
        const requestId = svgCatalogRequestIdRef.current + 1;
        svgCatalogRequestIdRef.current = requestId;
        setSvgLibraryRefreshing(true);
        setSvgLibraryError("");
        let lastError = "Failed to load SVG catalog.";

        for (const routePath of SVG_LIBRARY_CATALOG_ROUTE_CANDIDATES) {
            try {
                const requestUrl = `${routePath}${routePath.includes("?") ? "&" : "?"}t=${Date.now()}`;
                const response = await fetch(requestUrl, {
                    cache: "no-store",
                    credentials: "same-origin"
                });
                if (!response.ok) {
                    lastError = `Failed to load SVG catalog (${response.status}).`;
                    continue;
                }

                const payload = normalizeSvgCatalogPayload(await response.json());
                if (svgCatalogRequestIdRef.current !== requestId) {
                    return;
                }

                svgRawCacheRef.current.clear();
                setSvgCatalogFiles(payload.entries);
                setSvgLibraryExternalDirectory(payload.externalDirectory);
                setSvgLibraryExternalCount(payload.externalCount);
                setSvgLibraryError(payload.error);
                setSvgLibraryRefreshing(false);
                return;
            } catch (error) {
                lastError = String(error?.message || "Failed to load SVG catalog.");
            }
        }

        if (svgCatalogRequestIdRef.current === requestId) {
            setSvgCatalogFiles(EMPTY_ARRAY);
            setSvgLibraryExternalDirectory("");
            setSvgLibraryExternalCount(0);
            setSvgLibraryError(lastError);
            setSvgLibraryRefreshing(false);
        }
    }, []);

    useEffect(() => {
        if (!svgLibraryEnabled) {
            setSvgCatalogFiles(EMPTY_ARRAY);
            setSvgLibraryError("");
            setSvgLibraryExternalDirectory("");
            setSvgLibraryExternalCount(0);
            setSvgLibraryRefreshing(false);
            setSvgLibraryUploading(false);
            setImportOpen(false);
            return undefined;
        }

        loadSvgCatalog();
        return undefined;
    }, [loadSvgCatalog, svgLibraryEnabled]);

    useEffect(() => {
        if (!svgLibraryEnabled || !importOpen) {
            return;
        }
        loadSvgCatalog();
    }, [importOpen, loadSvgCatalog, svgLibraryEnabled]);

    const svgLibraryMap = useMemo(() => {
        const out = {};
        svgCatalogFiles.forEach((entry) => {
            out[entry.key] = entry.url;
        });
        return out;
    }, [svgCatalogFiles]);

    const readSvgRaw = useCallback(async (entry, options = {}) => {
        if (entry == null) {
            return null;
        }

        const forceFresh = options?.forceFresh === true;
        let value = typeof entry === "function" ? await entry() : entry;
        if (value && typeof value === "object" && typeof value.default === "string") {
            value = value.default;
        }
        if (isSvgMarkup(value)) {
            return value;
        }

        const urlCandidates = (Array.isArray(value) ? value : [value])
            .map((candidate) => String(candidate || "").trim())
            .filter(Boolean);
        if (!urlCandidates.length) {
            return null;
        }

        const cache = svgRawCacheRef.current;
        const cacheKey = urlCandidates.join("\n");
        if (!forceFresh && cache.has(cacheKey)) {
            const cached = cache.get(cacheKey);
            cache.delete(cacheKey);
            cache.set(cacheKey, cached);
            return cached;
        }

        let lastError = "Failed to load SVG.";
        for (const url of urlCandidates) {
            try {
                const requestUrl = forceFresh
                    ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`
                    : url;
                const response = await fetch(
                    requestUrl,
                    forceFresh
                        ? { cache: "no-store", credentials: "same-origin" }
                        : { credentials: "same-origin" }
                );
                if (!response.ok) {
                    lastError = `Failed to load SVG (${response.status}).`;
                    continue;
                }
                const raw = await response.text();

                if (cache.has(cacheKey)) {
                    cache.delete(cacheKey);
                }
                cache.set(cacheKey, raw);
                while (cache.size > SVG_RAW_CACHE_MAX) {
                    const oldest = cache.keys().next().value;
                    cache.delete(oldest);
                }

                return raw;
            } catch (error) {
                lastError = String(error?.message || "Failed to load SVG.");
            }
        }

        throw new Error(lastError);
    }, []);

    const readSvgRawByKey = useCallback(
        async (fileKey, options = {}) => readSvgRaw(svgLibraryMap[fileKey], options),
        [readSvgRaw, svgLibraryMap]
    );

    const svgFiles = useMemo(
        () => svgCatalogFiles
            .map((entry) => ({ key: entry.key, name: entry.name }))
            .sort((left, right) => left.name.localeCompare(right.name)),
        [svgCatalogFiles]
    );
    const svgTemplateSections = useMemo(() => {
        const byFolder = new Map();
        coerceArray(svgFiles).forEach((entry) => {
            const key = String(entry?.key || "").trim();
            const name = String(entry?.name || key).trim();
            if (!key || !name) {
                return;
            }
            const folder = getFolderFromKey(key);
            if (!byFolder.has(folder)) {
                byFolder.set(folder, []);
            }
            byFolder.get(folder).push({ value: key, label: name });
        });
        return Array.from(byFolder.keys())
            .sort((left, right) => {
                if (left === "Root") return -1;
                if (right === "Root") return 1;
                return String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base" });
            })
            .map((folder) => ({
                label: folder,
                items: byFolder.get(folder).slice().sort((left, right) =>
                    String(left?.label || "").localeCompare(String(right?.label || ""), undefined, { sensitivity: "base" })
                )
            }));
    }, [svgFiles]);
    const quickSvgGrouped = useMemo(() => {
        const query = String(quickSvgPickerQuery || "").trim().toLowerCase();
        const filtered = coerceArray(svgFiles).filter((entry) => {
            if (!query) {
                return true;
            }
            const name = String(entry?.name || "").toLowerCase();
            const key = String(entry?.key || "").toLowerCase();
            return name.includes(query) || key.includes(query);
        });
        const byFolder = new Map();
        filtered.forEach((entry) => {
            const folder = getFolderFromKey(entry?.key || "");
            if (!byFolder.has(folder)) {
                byFolder.set(folder, []);
            }
            byFolder.get(folder).push(entry);
        });
        return Array.from(byFolder.keys())
            .sort((left, right) => {
                if (left === "Root") return -1;
                if (right === "Root") return 1;
                return String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base" });
            })
            .map((folder) => ({
                folder,
                files: byFolder.get(folder).slice().sort((left, right) =>
                    String(left?.name || "").localeCompare(String(right?.name || ""), undefined, { sensitivity: "base" })
                )
            }));
    }, [quickSvgPickerQuery, svgFiles]);
    const handleRefreshSvgLibrary = useCallback(() => {
        loadSvgCatalog();
    }, [loadSvgCatalog]);
    const handleImportSvgLibraryFile = useCallback(async (file) => {
        if (!file) {
            return false;
        }

        const fileName = String(file.name || "").trim();
        if (!/\.svg$/i.test(fileName)) {
            setSvgLibraryError("Only .svg files can be imported.");
            return false;
        }

        let content = "";
        try {
            content = await file.text();
        } catch (error) {
            setSvgLibraryError(String(error?.message || "Failed to read selected SVG file."));
            return false;
        }

        if (!/<svg\b/i.test(content)) {
            setSvgLibraryError("The selected file does not contain an SVG root element.");
            return false;
        }

        setSvgLibraryUploading(true);
        setSvgLibraryError("");
        let lastError = "Failed to import SVG.";

        try {
            for (const routePath of SVG_LIBRARY_UPLOAD_ROUTE_CANDIDATES) {
                try {
                    const response = await fetch(routePath, {
                        method: "POST",
                        cache: "no-store",
                        credentials: "same-origin",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            fileName,
                            folder: "",
                            content
                        })
                    });

                    let payload = null;
                    try {
                        payload = await response.json();
                    } catch (_error) {
                        payload = null;
                    }

                    if (!response.ok || payload?.ok === false) {
                        lastError = String(payload?.error || `Failed to import SVG (${response.status}).`);
                        continue;
                    }

                    svgRawCacheRef.current.clear();
                    await loadSvgCatalog();
                    setSvgLibraryUploading(false);
                    return true;
                } catch (error) {
                    lastError = String(error?.message || "Failed to import SVG.");
                }
            }
        } finally {
            setSvgLibraryUploading(false);
        }

        setSvgLibraryError(lastError);
        return false;
    }, [loadSvgCatalog]);
    const handleRefreshHmiStateStyleMaps = useCallback(() => {
        loadHmiStateStyleMaps();
    }, [loadHmiStateStyleMaps]);
    const svgLibraryHelpText = svgLibraryExternalDirectory
        ? `Import an SVG here, or drop .svg files into this folder and click Refresh:\n${svgLibraryExternalDirectory}`
        : "Import an SVG here; the external folder path will appear when the catalog loads.";
    const svgLibrarySummaryText = svgLibraryExternalCount > 0
        ? `${svgCatalogFiles.length} templates loaded, ${svgLibraryExternalCount} external`
        : `${svgCatalogFiles.length} templates loaded`;

    const zoom = Number(getModelValue(props, "zoom", 1)) || 1;
    const pan = getModelValue(props, "pan", { x: 0, y: 0 });

    const localZoomCacheKey = resolveCanvasZoomCacheKey(props);
    const [localZoom, setLocalZoom] = useState(() => readCachedCanvasZoom(resolveCanvasZoomCacheKey(props)));
    const effectiveZoom = localZoom !== null ? localZoom : zoom;
    const effectiveZoomRef = useRef(effectiveZoom);
    effectiveZoomRef.current = effectiveZoom;
    const stepCanvasZoom = useCallback((direction) => {
        const amount = Number(direction);
        if (!Number.isFinite(amount) || amount === 0) return;
        const base = normalizeLocalCanvasZoom(effectiveZoomRef.current);
        setLocalZoom(normalizeLocalCanvasZoom(base + (amount * LOCAL_CANVAS_ZOOM_STEP)));
    }, []);
    useEffect(() => {
        setLocalZoom(readCachedCanvasZoom(localZoomCacheKey));
    }, [localZoomCacheKey]);
    useEffect(() => {
        writeCachedCanvasZoom(localZoomCacheKey, localZoom);
    }, [localZoomCacheKey, localZoom]);
    const liveCanvasZoom = browserRuntimeMode
        ? resolveBrowserHeightCanvasZoom(
            rootRef.current,
            viewBox.width,
            defaultHostSize?.height || hostSize?.height || rootSize?.height,
            viewBox.width,
            viewBox.height,
            browserViewportWidth,
            browserViewportHeight
        )
        : 1;
    const runtimeCanvasZoom = browserRuntimeMode
        ? Math.max(
            0.05,
            Math.min(
                8,
                liveCanvasZoom * (localZoom !== null ? normalizeLocalCanvasZoom(localZoom) : 1)
            )
        )
        : 1;
    const liveUpdatesEnabled = Boolean(getModelValue(props, "liveUpdatesEnabled", true));
    const liveClickable = Boolean(getModelValue(props, "liveClickable", false));
    const editorZoom = isLiveMode ? 1 : Math.max(1e-9, Number(effectiveZoom) || 1);
    const editorPanX = isLiveMode || !isPlainObject(pan) ? 0 : (Number(pan.x) || 0);
    const editorPanY = isLiveMode || !isPlainObject(pan) ? 0 : (Number(pan.y) || 0);
    const editorPan = useMemo(() => ({ x: editorPanX, y: editorPanY }), [editorPanX, editorPanY]);

    const binNameLabelByOverlayId = useMemo(() => {
        const out = {};
        coerceArray(svgOverlays).forEach((overlay) => {
            const id = String(overlay?.id || "").trim();
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            if (!id || !basePath || !isBinOverlay(overlay)) return;
            const friendly = getIgnitionTagValue(ignitionTagValuesByPath, basePath, "FriendlyName");
            const name = String(friendly ?? "").trim();
            if (name) out[id] = name;
        });
        return out;
    }, [svgOverlays, ignitionTagValuesByPath]);

    const binProductLabelByOverlayId = useMemo(() => {
        const out = {};
        coerceArray(svgOverlays).forEach((overlay) => {
            const id = String(overlay?.id || "").trim();
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            if (!id || !basePath || !isBinOverlay(overlay)) return;
            const product = getIgnitionTagValue(ignitionTagValuesByPath, basePath, "AssignedProductName");
            const label = String(product ?? "").trim();
            if (label) out[id] = label;
        });
        return out;
    }, [svgOverlays, ignitionTagValuesByPath]);

    const binLevelRatioByOverlayId = useMemo(() => {
        const out = {};
        coerceArray(svgOverlays).forEach((overlay) => {
            const id = String(overlay?.id || "").trim();
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            if (!id || !basePath || !isBinOverlay(overlay)) return;
            const pct = Number(getIgnitionTagValue(ignitionTagValuesByPath, basePath, "CurrentLevelPercent"));
            if (Number.isFinite(pct)) {
                out[id] = Math.max(0, Math.min(1, pct / 100));
                return;
            }
            const current = Number(getIgnitionTagValue(ignitionTagValuesByPath, basePath, "CurrentLevel"));
            const max = Number(getIgnitionTagValue(ignitionTagValuesByPath, basePath, "MaxLevel"));
            if (Number.isFinite(current) && Number.isFinite(max) && max > 0) {
                out[id] = Math.max(0, Math.min(1, current / max));
            }
        });
        return out;
    }, [svgOverlays, ignitionTagValuesByPath]);

    const binLockedInByOverlayId = useMemo(() => {
        const out = {};
        coerceArray(svgOverlays).forEach((overlay) => {
            const id = String(overlay?.id || "").trim();
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            if (!id || !basePath || !isBinOverlay(overlay)) return;
            if (getIgnitionTagValue(ignitionTagValuesByPath, basePath, "i_LockFilling")) out[id] = true;
        });
        return out;
    }, [svgOverlays, ignitionTagValuesByPath]);

    const binLockedOutByOverlayId = useMemo(() => {
        const out = {};
        coerceArray(svgOverlays).forEach((overlay) => {
            const id = String(overlay?.id || "").trim();
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            if (!id || !basePath || !isBinOverlay(overlay)) return;
            if (getIgnitionTagValue(ignitionTagValuesByPath, basePath, "i_LockDischarging")) out[id] = true;
        });
        return out;
    }, [svgOverlays, ignitionTagValuesByPath]);

    // Map trunk tag keys ("trunk:<id>") to the bin tagPaths connected via drop lines.
    // Drop lines have tagPath = binTagPath and an endpoint near the trunk.
    const trunkBinMappings = useMemo(() => {
        const map = new Map();
        const allShapes = shapes;
        const trunkShapes = allShapes.filter((s) =>
            s?.type === "polyline" && String(s?.tagPath || "").startsWith("trunk:")
        );
        const dropLines = allShapes.filter((s) =>
            s?.type === "polyline" &&
            String(s?.tagPath || "") &&
            !String(s?.tagPath || "").startsWith("trunk:")
        );
        trunkShapes.forEach((trunk) => {
            const trunkPts = Array.isArray(trunk.points) ? trunk.points : [];
            if (trunkPts.length < 2) return;
            const trunkY = trunkPts.reduce((sum, p) => sum + (Number(p?.y) || 0), 0) / trunkPts.length;
            const trunkMinX = Math.min(...trunkPts.map((p) => Number(p?.x) || 0));
            const trunkMaxX = Math.max(...trunkPts.map((p) => Number(p?.x) || 0));
            const connectedBinPaths = dropLines
                .map((dl) => {
                    const pts = Array.isArray(dl.points) ? dl.points : [];
                    const endPt = pts[pts.length - 1];
                    if (!endPt) return null;
                    const near = Math.abs(Number(endPt.y) - trunkY) < 30 &&
                        Number(endPt.x) >= trunkMinX - 30 &&
                        Number(endPt.x) <= trunkMaxX + 30;
                    return near ? String(dl.tagPath || "").trim() : null;
                })
                .filter(Boolean);
            if (connectedBinPaths.length > 0) {
                map.set(String(trunk.tagPath), connectedBinPaths);
            }
        });
        return map;
    }, [shapes]);

    const isBinFlowing = useCallback((basePath) => {
        const lockDischarging = getIgnitionTagValue(ignitionTagValuesByPath, basePath, "i_LockDischarging");
        const currentLevel = Number(getIgnitionTagValue(ignitionTagValuesByPath, basePath, "CurrentLevel"));
        const lockedOut = lockDischarging === true || lockDischarging === 1
            || String(lockDischarging ?? "").toLowerCase() === "true"
            || String(lockDischarging ?? "") === "1";
        return !lockedOut && Number.isFinite(currentLevel) && currentLevel > 0;
    }, [ignitionTagValuesByPath]);

    const binTagStateColorsByPath = useMemo(() => {
        const out = new Map();
        coerceArray(svgOverlays).forEach((overlay) => {
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            if (!basePath || !isBinOverlay(overlay)) return;
            if (isBinFlowing(basePath)) {
                out.set(basePath, "#22c55e");
                out.set(basePath.toLowerCase(), "#22c55e");
            }
        });
        // Color trunk tag keys when any connected bin is flowing
        trunkBinMappings.forEach((binPaths, trunkKey) => {
            if (binPaths.some((p) => isBinFlowing(p))) {
                out.set(trunkKey, "#22c55e");
                out.set(trunkKey.toLowerCase(), "#22c55e");
            }
        });
        return out;
    }, [svgOverlays, ignitionTagValuesByPath, trunkBinMappings, isBinFlowing]);

    const genericHmiTagStateColorsByPath = useMemo(() => {
        const out = new Map();
        coerceArray(canvasSvgOverlays).forEach((overlay) => {
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            if (!basePath || !shouldQueryOverlayFillStateMembers(overlay)) return;

            const rawState = getIgnitionHmiStateValueForBase(
                ignitionTagValuesByPath,
                basePath,
                IGNITION_FILL_STATE_MEMBERS
            );
            const color = String(getOverlayHmiStateColor(overlay, rawState, hmiStateStyleMapIndex) || "").trim();
            if (!color) return;

            out.set(basePath, color);
            out.set(basePath.toLowerCase(), color);
            IGNITION_FILL_STATE_MEMBERS.forEach((member) => {
                const slashPath = `${basePath}/${member}`;
                const dotPath = `${basePath}.${member}`;
                out.set(slashPath, color);
                out.set(slashPath.toLowerCase(), color);
                out.set(dotPath, color);
                out.set(dotPath.toLowerCase(), color);
            });
        });
        return out;
    }, [canvasSvgOverlays, ignitionTagValuesByPath, hmiStateStyleMapIndex]);

    const motorTagStateColorsByPath = useMemo(() => {
        const out = new Map();
        coerceArray(svgOverlays).forEach((overlay) => {
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            if (!basePath || !isMotorOverlay(overlay)) return;
            const rawState = getIgnitionHmiStateValueForBase(
                ignitionTagValuesByPath,
                basePath,
                MOTOR_UDT_STATE_MEMBERS
            );
            const color = String(getOverlayHmiStateColor(overlay, rawState, hmiStateStyleMapIndex) || "").trim();
            if (!color) return;
            out.set(basePath, color);
            out.set(basePath.toLowerCase(), color);
            MOTOR_UDT_STATE_MEMBERS.forEach((member) => {
                const fullPath = `${basePath}/${member}`;
                out.set(fullPath, color);
                out.set(fullPath.toLowerCase(), color);
            });
        });
        return out;
    }, [svgOverlays, ignitionTagValuesByPath, hmiStateStyleMapIndex]);

    const overlayHmiStateColorByOverlayId = useMemo(() => {
        const out = {};
        coerceArray(canvasSvgOverlays).forEach((overlay) => {
            const id = String(overlay?.id || "").trim();
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            if (!id || !basePath || !shouldQueryOverlayFillStateMembers(overlay)) return;
            const rawState = getIgnitionHmiStateValueForBase(
                ignitionTagValuesByPath,
                basePath,
                IGNITION_FILL_STATE_MEMBERS
            );
            const color = String(getOverlayHmiStateColor(overlay, rawState, hmiStateStyleMapIndex) || "").trim();
            if (color) out[id] = color;
        });
        return out;
    }, [canvasSvgOverlays, ignitionTagValuesByPath, hmiStateStyleMapIndex]);

    const motorRouteColorsBySvgKey = useMemo(() => {
        const out = new Map();
        coerceArray(svgOverlays).forEach((overlay) => {
            const id = String(overlay?.id || "").trim();
            const name = String(overlay?.name || "").trim();
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            if (!basePath || !isMotorOverlay(overlay)) return;
            const color = String(
                getIgnitionTagValueForMembersDeep(
                    ignitionTagValuesByPath,
                    basePath,
                    MOTOR_UDT_ROUTE_COLOR_MEMBERS
                ) || ""
            ).trim();
            if (!color) return;
            out.set(basePath, color);
            out.set(basePath.toLowerCase(), color);
            if (id) {
                out.set(id, color);
                out.set(id.toLowerCase(), color);
            }
            if (name) {
                out.set(name, color);
                out.set(name.toLowerCase(), color);
            }
        });
        return out;
    }, [svgOverlays, ignitionTagValuesByPath]);

    const diverterRouteColorsBySvgKey = useMemo(() => {
        const out = new Map();
        coerceArray(svgOverlays).forEach((overlay) => {
            const id = String(overlay?.id || "").trim();
            const name = String(overlay?.name || "").trim();
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            if (!basePath || !usesTwoWayUdtOverlay(overlay)) return;
            const color = String(
                getIgnitionTagValueForMembersDeep(
                    ignitionTagValuesByPath,
                    basePath,
                    DIVERTER_UDT_ROUTE_COLOR_MEMBERS
                ) || ""
            ).trim();
            if (!color) return;
            out.set(basePath, color);
            out.set(basePath.toLowerCase(), color);
            if (id) {
                out.set(id, color);
                out.set(id.toLowerCase(), color);
            }
            if (name) {
                out.set(name, color);
                out.set(name.toLowerCase(), color);
            }
        });
        return out;
    }, [svgOverlays, ignitionTagValuesByPath]);

    const docDicRouteColorsBySvgKey = useMemo(() => {
        const out = new Map();
        coerceArray(svgOverlays).forEach((overlay) => {
            const id = String(overlay?.id || "").trim();
            const name = String(overlay?.name || "").trim();
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            if (!basePath || !isDocOrDicOverlay(overlay)) return;
            const color = String(
                getIgnitionTagValueForMembersDeep(
                    ignitionTagValuesByPath,
                    basePath,
                    DOC_DIC_UDT_ROUTE_COLOR_MEMBERS
                ) || ""
            ).trim();
            if (!color) return;
            out.set(basePath, color);
            out.set(basePath.toLowerCase(), color);
            if (id) {
                out.set(id, color);
                out.set(id.toLowerCase(), color);
            }
            if (name) {
                out.set(name, color);
                out.set(name.toLowerCase(), color);
            }
        });
        return out;
    }, [svgOverlays, ignitionTagValuesByPath]);

    const overlayTagStateColorsByPath = useMemo(() => {
        const out = new Map();
        genericHmiTagStateColorsByPath.forEach((value, key) => {
            out.set(key, value);
        });
        motorTagStateColorsByPath.forEach((value, key) => {
            out.set(key, value);
        });
        return out;
    }, [genericHmiTagStateColorsByPath, motorTagStateColorsByPath]);

    const overlayRouteColorsBySvgKey = useMemo(() => {
        const out = new Map(binTagStateColorsByPath);
        motorRouteColorsBySvgKey.forEach((value, key) => {
            out.set(key, value);
        });
        diverterRouteColorsBySvgKey.forEach((value, key) => {
            out.set(key, value);
        });
        docDicRouteColorsBySvgKey.forEach((value, key) => {
            out.set(key, value);
        });
        return out;
    }, [binTagStateColorsByPath, motorRouteColorsBySvgKey, diverterRouteColorsBySvgKey, docDicRouteColorsBySvgKey]);

    const overlayConnectionIssueByOverlayId = useMemo(() => {
        const out = {};
        if (!(ignitionTagMetaByPath instanceof Map) || ignitionTagMetaByPath.size === 0) {
            return out;
        }
        coerceArray(svgOverlays).forEach((overlay) => {
            const id = String(overlay?.id || "").trim();
            if (!id) {
                return;
            }
            const issue = getOverlayConnectionIssue(overlay, ignitionTagMetaByPath);
            if (issue) {
                out[id] = issue;
            }
        });
        return out;
    }, [svgOverlays, ignitionTagMetaByPath]);

    const theme = getPerspectiveThemeName(props);
    const canvasBackgroundColor = getPerspectiveCanvasBackground(props, theme);

    const pointFromEvent = useCallback((event) => {
        const svg = svgRef.current;
        if (!svg) {
            return { x: viewBox.width / 2, y: viewBox.height / 2 };
        }

        let svgX;
        let svgY;
        const rect = svg.getBoundingClientRect?.();
        const rectWidth = Number(rect?.width) || 0;
        const rectHeight = Number(rect?.height) || 0;
        const boxWidth = Math.max(1e-9, Number(viewBox.width) || 1);
        const boxHeight = Math.max(1e-9, Number(viewBox.height) || 1);
        if (rect && rectWidth > 0 && rectHeight > 0) {
            const relX = Number(event?.clientX || 0) - Number(rect.left || 0);
            const relY = Number(event?.clientY || 0) - Number(rect.top || 0);
            const scale = Math.max(1e-9, Math.min(rectWidth / boxWidth, rectHeight / boxHeight));
            svgX = relX / scale;
            svgY = relY / scale;
        } else {
            try {
                if (typeof svg.createSVGPoint === "function") {
                    const point = svg.createSVGPoint();
                    point.x = Number(event?.clientX || 0);
                    point.y = Number(event?.clientY || 0);
                    const ctm = svg.getScreenCTM?.();
                    if (ctm && typeof ctm.inverse === "function") {
                        const localPoint = point.matrixTransform(ctm.inverse());
                        svgX = Number(localPoint?.x);
                        svgY = Number(localPoint?.y);
                    }
                }
            } catch (_error) {
            }
        }

        if (!Number.isFinite(svgX) || !Number.isFinite(svgY)) {
            return { x: viewBox.width / 2, y: viewBox.height / 2 };
        }

        const nextX = (svgX - editorPanX) / editorZoom;
        const nextY = (svgY - editorPanY) / editorZoom;

        return {
            x: Math.max(0, Math.min(viewBox.width, nextX)),
            y: Math.max(0, Math.min(viewBox.height, nextY))
        };
    }, [editorPanX, editorPanY, editorZoom, viewBox.height, viewBox.width]);

    const constrainHV = useCallback((from, to) => {
        const dx = Number(to?.x || 0) - Number(from?.x || 0);
        const dy = Number(to?.y || 0) - Number(from?.y || 0);
        if (Math.abs(dx) >= Math.abs(dy)) {
            return {
                x: Number(to?.x || 0),
                y: Number(from?.y || 0)
            };
        }
        return {
            x: Number(from?.x || 0),
            y: Number(to?.y || 0)
        };
    }, []);

    const constrainPolylineHandleMove = useCallback((points, index, target) => {
        const pts = Array.isArray(points) ? points : [];
        const idx = Number(index);
        const nextPoint = {
            x: Number(target?.x) || 0,
            y: Number(target?.y) || 0
        };
        if (!Number.isInteger(idx) || idx < 0 || idx >= pts.length) {
            return nextPoint;
        }

        const anchors = [];
        if (idx > 0) {
            anchors.push(pts[idx - 1]);
        }
        if (idx < pts.length - 1) {
            anchors.push(pts[idx + 1]);
        }

        const candidates = anchors
            .filter(Boolean)
            .map((anchor) => {
                const constrained = constrainHV(anchor, nextPoint);
                return {
                    point: constrained,
                    score: Math.hypot(
                        Number(constrained?.x || 0) - nextPoint.x,
                        Number(constrained?.y || 0) - nextPoint.y
                    )
                };
            });

        if (!candidates.length) {
            return nextPoint;
        }
        candidates.sort((a, b) => Number(a?.score || 0) - Number(b?.score || 0));
        return candidates[0]?.point || nextPoint;
    }, [constrainHV]);

    const constrainTo45DegreeAngle = useCallback((from, to) => {
        const startX = Number(from?.x || 0);
        const startY = Number(from?.y || 0);
        const dx = Number(to?.x || 0) - startX;
        const dy = Number(to?.y || 0) - startY;
        const distanceToTarget = Math.hypot(dx, dy);
        if (!Number.isFinite(distanceToTarget) || distanceToTarget <= 0.0001) {
            return {
                x: startX,
                y: startY
            };
        }

        const rawAngle = Math.atan2(dy, dx);
        const snappedAngle = Math.round(rawAngle / (Math.PI / 4)) * (Math.PI / 4);
        return {
            x: startX + distanceToTarget * Math.cos(snappedAngle),
            y: startY + distanceToTarget * Math.sin(snappedAngle)
        };
    }, []);

    const snapPointToGrid = useCallback((point) => {
        const grid = Math.max(0.1, Number(externalGridSize) || 20);
        const nextX = Math.round(Number(point?.x || 0) / grid) * grid;
        const nextY = Math.round(Number(point?.y || 0) / grid) * grid;
        return {
            x: Math.max(0, Math.min(viewBox.width, nextX)),
            y: Math.max(0, Math.min(viewBox.height, nextY))
        };
    }, [externalGridSize, viewBox.height, viewBox.width]);

    const maybeConstrainPolylinePoint = useCallback((id, point, event) => {
        let nextPoint = {
            x: Number(point?.x || 0),
            y: Number(point?.y || 0)
        };
        const useStraightConstraint = Boolean(event?.altKey);
        const useGridConstraint = Boolean(event?.shiftKey) && !useStraightConstraint;
        const useAngleConstraint = Boolean((event?.ctrlKey || event?.metaKey) && !useStraightConstraint && !useGridConstraint);

        if (useGridConstraint) {
            nextPoint = snapPointToGrid(nextPoint);
        }

        if (!useStraightConstraint && !useAngleConstraint) {
            return nextPoint;
        }

        const activeShape = shapesRef.current.find((shape) => String(shape?.id || "") === String(id || ""));
        if (!activeShape || !Array.isArray(activeShape.points) || activeShape.points.length < 2) {
            return nextPoint;
        }

        const fixed = clonePoints(activeShape.points).slice(0, -1);
        const lastFixed = fixed[fixed.length - 1];
        if (!lastFixed) {
            return nextPoint;
        }
        if (useStraightConstraint) {
            return constrainHV(lastFixed, nextPoint);
        }
        return constrainTo45DegreeAngle(lastFixed, nextPoint);
    }, [constrainHV, constrainTo45DegreeAngle, snapPointToGrid]);

    const isShapeSelectableByMode = useCallback((shape) => {
        if (!shape || typeof shape !== "object") {
            return false;
        }
        if (selectionMode === "all") {
            return true;
        }
        if (selectionMode === "svg") {
            return false;
        }
        return String(shape?.type || "").trim().toLowerCase() === "polyline" || Array.isArray(shape?.points);
    }, [selectionMode]);

    const overlaysSelectable = selectionMode !== "polyline";
    const clearSelection = useCallback(() => {
        setSelectedIds([]);
        setSelectedOverlayIds([]);
        setSelectedSegment(null);
        setEditingId(null);
    }, []);

    useEffect(() => {
        if (!editingId) {
            return;
        }
        const stillExists = shapes.some((shape) => String(shape?.id || "") === String(editingId || ""));
        if (!stillExists) {
            setEditingId(null);
            setSelectedSegment(null);
        }
    }, [editingId, shapes]);

    useEffect(() => {
        if (!editingId) {
            return;
        }
        const stillSelected = selectedIds.some((id) => String(id || "") === String(editingId || ""));
        if (!stillSelected) {
            setEditingId(null);
            setSelectedSegment(null);
        }
    }, [editingId, selectedIds]);

    const historyDocumentKey = useMemo(
        () => JSON.stringify({
            shapes,
            svgOverlays,
            tool
        }),
        [shapes, svgOverlays, tool]
    );

    useEffect(() => {
        if (drawing || dragState || dragSegment || dragHandle || shapeResize || overlayResize || marquee) {
            return;
        }
        const snapshot = makeHistorySnapshot();
        const history = historyRef.current;
        if (historyRestoreRef.current) {
            history.current = cloneDeepValue(snapshot);
            return;
        }
        if (!history.current) {
            history.current = cloneDeepValue(snapshot);
            return;
        }
        const currentKey = JSON.stringify({
            shapes: history.current.shapes,
            svgOverlays: history.current.svgOverlays,
            tool: history.current.tool
        });
        if (currentKey === historyDocumentKey) {
            history.current = {
                ...cloneDeepValue(snapshot),
                shapes: history.current.shapes,
                svgOverlays: history.current.svgOverlays,
                tool: history.current.tool
            };
            return;
        }
        history.past.push(cloneDeepValue(history.current));
        if (history.past.length > 100) {
            history.past.shift();
        }
        history.future = [];
        history.current = cloneDeepValue(snapshot);
    }, [dragHandle, dragSegment, dragState, drawing, historyDocumentKey, makeHistorySnapshot, marquee, overlayResize, shapeResize]);

    const overlayLocalBBox = useCallback((overlayId) => {
        const overlay = overlaysRef.current.find((item) => String(item?.id || "") === String(overlayId || ""));
        const bbox = overlay?.bbox;
        if (!bbox || typeof bbox !== "object") {
            return null;
        }

        const x = Number(bbox.x || bbox.left || 0);
        const y = Number(bbox.y || bbox.top || 0);
        const width = Number(bbox.width || bbox.w || 0);
        const height = Number(bbox.height || bbox.h || 0);

        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            return null;
        }

        return {
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
            width,
            height
        };
    }, []);

    const selectedShapeItems = useMemo(
        () => shapes.filter((shape) => selectedIds.includes(String(shape?.id || ""))),
        [selectedIds, shapes]
    );

    const selectedOverlayItems = useMemo(
        () => svgOverlays.filter((overlay) => selectedOverlayIds.includes(String(overlay?.id || ""))),
        [selectedOverlayIds, svgOverlays]
    );

    const selectedOverlayGroup = useMemo(
        () => (
            selectedIds.length === 0 && selectedOverlayItems.length > 1
                ? selectedOverlayItems
                : EMPTY_ARRAY
        ),
        [selectedIds.length, selectedOverlayItems]
    );

    const selectedBBox = useMemo(
        () => unionBounds([
            ...selectedShapeItems.map((shape) => getShapeBounds(shape)),
            ...selectedOverlayItems.map((overlay) => getOverlayBounds(overlay))
        ]),
        [selectedOverlayItems, selectedShapeItems]
    );

    const selectedShape = useMemo(() => {
        if (selectedIds.length !== 1 || selectedOverlayIds.length !== 0) {
            return null;
        }
        return shapes.find((shape) => String(shape?.id || "") === String(selectedIds[0] || "")) || null;
    }, [selectedIds, selectedOverlayIds.length, shapes]);

    const selectedOverlay = useMemo(() => {
        if (selectedOverlayIds.length !== 1 || selectedIds.length !== 0) {
            return null;
        }
        return svgOverlays.find((overlay) => String(overlay?.id || "") === String(selectedOverlayIds[0] || "")) || null;
    }, [selectedIds.length, selectedOverlayIds, svgOverlays]);

    const singleSelectionKey = useMemo(() => {
        if (selectedOverlay) {
            return `overlay:${String(selectedOverlay.id || "")}`;
        }
        if (selectedShape) {
            return `shape:${String(selectedShape.id || "")}`;
        }
        return "";
    }, [selectedOverlay, selectedShape]);

    const propertiesVisible = editorVisible
        && Boolean(singleSelectionKey)
        && propertiesSelectionKey === singleSelectionKey;
    const quickTagPickerOverlayIds = useMemo(() => {
        const ids = coerceArray(quickTagPickerState?.overlayIds)
            .map((id) => String(id || "").trim())
            .filter(Boolean);
        if (ids.length) {
            return ids;
        }
        const fallbackId = String(quickTagPickerState?.overlayId || "").trim();
        return fallbackId ? [fallbackId] : EMPTY_ARRAY;
    }, [quickTagPickerState]);
    const quickTagPickerTargetOverlays = useMemo(() => {
        if (!quickTagPickerOverlayIds.length) {
            return EMPTY_ARRAY;
        }
        const ids = new Set(quickTagPickerOverlayIds);
        return svgOverlays.filter((overlay) => ids.has(String(overlay?.id || "").trim()));
    }, [quickTagPickerOverlayIds, svgOverlays]);
    const quickTagPickerOverlay = useMemo(
        () => (quickTagPickerTargetOverlays.length === 1 ? quickTagPickerTargetOverlays[0] : null),
        [quickTagPickerTargetOverlays]
    );
    const quickTagPickerHasTarget = quickTagPickerTargetOverlays.length > 0;
    const quickTagPickerIsGroup = quickTagPickerTargetOverlays.length > 1;
    const quickTagPickerRef = useRef(null);
    const quickTagPickerAutoOpenToken = Number(quickTagPickerState?.nonce || 0);

    const finishPolyline = useCallback(() => {
        if (drawing?.kind !== "polyline") {
            return;
        }
        const activeShape = shapesRef.current.find((shape) => String(shape?.id || "") === String(drawing.id || ""));
        if (!activeShape) {
            setDrawing(null);
            return;
        }
        let nextPoints = clonePoints(activeShape.points);
        if (nextPoints.length >= 2 && pointsEqual(nextPoints[nextPoints.length - 1], nextPoints[nextPoints.length - 2])) {
            nextPoints = nextPoints.slice(0, -1);
        }
        if (nextPoints.length < 2) {
            updateShapes(
                (previous) => previous.filter((shape) => String(shape?.id || "") !== String(drawing.id || "")),
                { persist: true }
            );
            setSelectedIds([]);
        } else {
            updateShapes(
                (previous) => previous.map((shape) => (
                    String(shape?.id || "") === String(drawing.id || "")
                        ? { ...shape, points: nextPoints }
                        : shape
                )),
                { persist: true }
            );
        }
        setDrawing(null);
        setSelectedSegment(null);
        setEditingId(null);
    }, [drawing, updateShapes]);

    const openPropertiesForSelection = useCallback((key) => {
        const nextKey = String(key || "").trim();
        if (!nextKey) {
            return;
        }
        setPropertiesSelectionKey(nextKey);
    }, []);

    const closePropertiesPanel = useCallback(() => {
        setPropertiesSelectionKey("");
    }, []);

    const retargetPropertiesPanelIfOpen = useCallback((key) => {
        const nextKey = String(key || "").trim();
        if (!propertiesVisible || !nextKey) {
            return;
        }
        setPropertiesSelectionKey(nextKey);
    }, [propertiesVisible]);

    const closeQuickTagPicker = useCallback(() => {
        setQuickTagPickerState({
            overlayId: "",
            overlayIds: EMPTY_ARRAY,
            nonce: 0,
            clientX: 0,
            clientY: 0
        });
    }, []);

    const closeQuickSvgPicker = useCallback(() => {
        setQuickSvgPickerState({
            open: false,
            clientX: 0,
            clientY: 0,
            worldPoint: null
        });
        setQuickSvgPickerQuery("");
    }, []);

    const appendPolylinePoint = useCallback((id, point) => {
        const shapeId = String(id || "");
        if (!shapeId) {
            return;
        }

        updateShapes((previous) => previous.map((shape) => {
            if (String(shape?.id || "") !== shapeId || !Array.isArray(shape?.points)) {
                return shape;
            }

            const points = clonePoints(shape.points);
            const fixed = points.slice(0, Math.max(0, points.length - 1));
            const lastFixed = fixed[fixed.length - 1];
            const nextPoint = {
                x: Number(point?.x) || 0,
                y: Number(point?.y) || 0
            };

            const nextFixed =
                lastFixed && pointsEqual(lastFixed, nextPoint)
                    ? fixed
                    : [...fixed, nextPoint];
            const tail = nextFixed[nextFixed.length - 1];

            if (!tail) {
                return shape;
            }

            return {
                ...shape,
                points: [...nextFixed, { x: tail.x, y: tail.y }]
            };
        }), { persist: true });
    }, [updateShapes]);

    const commitPolylinePreviewPoint = useCallback((id, point, options = {}) => {
        const shapeId = String(id || "");
        if (!shapeId) {
            return;
        }

        updateShapes((previous) => previous.map((shape) => {
            if (String(shape?.id || "") !== shapeId || !Array.isArray(shape?.points) || !shape.points.length) {
                return shape;
            }

            const points = clonePoints(shape.points);
            points[points.length - 1] = {
                x: Number(point?.x) || 0,
                y: Number(point?.y) || 0
            };

            return {
                ...shape,
                points
            };
        }), { persist: Boolean(options.persist) });
    }, [updateShapes]);

    const finishActivePolylineAt = useCallback((id, point, event) => {
        const shapeId = String(id || "");
        if (!shapeId) {
            return;
        }
        const finalPoint = maybeConstrainPolylinePoint(shapeId, point, event);
        commitPolylinePreviewPoint(shapeId, finalPoint, { persist: false });
        finishPolyline();
    }, [commitPolylinePreviewPoint, finishPolyline, maybeConstrainPolylinePoint]);

    const computeOrthogonalRoute = useCallback((from, to) => {
        const corner = { x: from.x, y: to.y };
        return [from, corner, to];
    }, []);

    const computeStraightRoute = useCallback((from, to) => {
        return [from, to];
    }, []);

    const startTrunkConnAt = useCallback((point) => {
        const id = createId("polyline");
        updateShapes((previous) => [
            ...previous,
            {
                id,
                type: "polyline",
                points: [point, point],
                stroke: DEFAULT_STROKE,
                strokeWidth: 3,
                fill: "none",
                lineStyle: "solid",
                arrowStart: "none",
                arrowEnd: "none",
                tagPath: ""
            }
        ], { persist: false });
        setSelectedIds([id]);
        setSelectedOverlayIds([]);
        setEditingId(null);
        setSelectedSegment(null);
        setDrawing({ kind: "trunkconn", id, start: point });
    }, [updateShapes]);

    const finishTrunkConnAt = useCallback((point) => {
        if (drawing?.kind !== "trunkconn" || !drawing?.id) return;
        const route = computeStraightRoute(drawing.start, point);
        updateShapes((previous) => previous.map((shape) =>
            String(shape?.id || "") === String(drawing.id || "")
                ? { ...shape, points: route }
                : shape
        ), { persist: true });
        setDrawing(null);
    }, [computeStraightRoute, drawing, updateShapes]);

    const connectBinsToTrunk = useCallback(() => {
        // Find the selected trunk polyline (horizontal line among selected shapes)
        const selShapeIds = coerceArray(selectedIds).map((id) => String(id || "")).filter(Boolean);
        const selOverlayIds = coerceArray(selectedOverlayIds).map((id) => String(id || "")).filter(Boolean);

        const allShapes = shapesRef.current;
        const allOverlays = overlaysRef.current;

        // Pick the most horizontal polyline from selection as the trunk
        const trunkShape = selShapeIds
            .map((id) => allShapes.find((s) => String(s?.id || "") === id))
            .filter((s) => s?.type === "polyline" && Array.isArray(s.points) && s.points.length >= 2)
            .sort((a, b) => {
                const spanX = (pts) => Math.abs((pts[pts.length - 1]?.x || 0) - (pts[0]?.x || 0));
                return spanX(b.points) - spanX(a.points);
            })[0];

        if (!trunkShape) return;

        // Trunk Y level = average Y of trunk points
        const trunkY = trunkShape.points.reduce((sum, p) => sum + (Number(p?.y) || 0), 0) / trunkShape.points.length;
        const trunkMinX = Math.min(...trunkShape.points.map((p) => Number(p?.x) || 0));
        const trunkMaxX = Math.max(...trunkShape.points.map((p) => Number(p?.x) || 0));

        // Selected bin overlays
        const binOverlays = selOverlayIds.length
            ? selOverlayIds.map((id) => allOverlays.find((o) => String(o?.id || "") === id)).filter(Boolean)
            : allOverlays.filter((o) => isBinOverlay(o));

        if (!binOverlays.length) return;

        const newLines = binOverlays.map((overlay) => {
            const bounds = getOverlayBounds(overlay);
            if (!bounds) return null;
            // Drop from bottom-center of bin
            const binCenterX = Math.max(trunkMinX, Math.min(trunkMaxX, bounds.x + bounds.width / 2));
            const binBottomY = bounds.y + bounds.height;
            const start = { x: binCenterX, y: binBottomY };
            const end = { x: binCenterX, y: trunkY };
            return {
                id: createId("polyline"),
                type: "polyline",
                points: [start, end],
                stroke: DEFAULT_STROKE,
                strokeWidth: 3,
                fill: "none",
                lineStyle: "solid",
                arrowStart: "none",
                arrowEnd: "none",
                tagPath: String(overlay?.tagPath || "").trim()
            };
        }).filter(Boolean);

        if (!newLines.length) return;
        const trunkTagKey = `trunk:${trunkShape.id}`;
        updateShapes((previous) => [
            ...previous.map((s) => {
                if (String(s?.id || "") === String(trunkShape.id || "")) {
                    const { arrowEnd: _a, ...rest } = s;
                    return { ...rest, tagPath: trunkTagKey };
                }
                return s;
            }),
            ...newLines,
        ], { persist: true });
    }, [overlaysRef, selectedIds, selectedOverlayIds, shapesRef, updateShapes]);

    const startOrAppendPolylineAt = useCallback((point, event) => {
        if (drawing?.kind === "polyline" && drawing.id) {
            if (Number(event?.detail || 0) >= 2) {
                finishActivePolylineAt(drawing.id, point, event);
                return;
            }
            appendPolylinePoint(drawing.id, maybeConstrainPolylinePoint(drawing.id, point, event));
            return;
        }

        const startPoint = maybeConstrainPolylinePoint("", point, event);
        const id = createId("polyline");
        updateShapes((previous) => [
            ...previous,
            {
                id,
                type: "polyline",
                points: [startPoint, startPoint],
                stroke: DEFAULT_STROKE,
                strokeWidth: 3,
                fill: "none",
                lineStyle: "solid",
                arrowStart: "none",
                arrowEnd: "none",
                tagPath: "",
            }
        ], { persist: false });
        setSelectedIds([id]);
        setSelectedOverlayIds([]);
        setEditingId(null);
        setSelectedSegment(null);
        setDrawing({ kind: "polyline", id, start: startPoint });
    }, [appendPolylinePoint, drawing, finishActivePolylineAt, maybeConstrainPolylinePoint, tool, updateShapes]);

    const deleteSelected = useCallback(() => {
        const shapeIds = coerceArray(selectedIds).map((id) => String(id || "")).filter(Boolean);
        const overlayIds = coerceArray(selectedOverlayIds).map((id) => String(id || "")).filter(Boolean);
        if (!shapeIds.length && !overlayIds.length) {
            return;
        }

        if (shapeIds.length) {
            updateShapes(
                (previous) => previous.filter((shape) => !shapeIds.includes(String(shape?.id || ""))),
                { persist: true }
            );
        }

        if (overlayIds.length) {
            updateSvgOverlays(
                (previous) => previous.filter((overlay) => !overlayIds.includes(String(overlay?.id || ""))),
                { persist: true }
            );
        }

        setSelectedIds([]);
        setSelectedOverlayIds([]);
        setSelectedSegment(null);
        if (editingId && shapeIds.includes(String(editingId || ""))) {
            setEditingId(null);
        }
    }, [editingId, selectedIds, selectedOverlayIds, updateShapes, updateSvgOverlays]);

    const cancelPolyline = useCallback(() => {
        if (drawing?.kind !== "polyline" || !drawing?.id) {
            return;
        }
        updateShapes(
            (previous) => previous.filter((shape) => String(shape?.id || "") !== String(drawing.id || "")),
            { persist: true }
        );
        setDrawing(null);
        clearSelection();
        setTool("select");
    }, [clearSelection, drawing, setTool, updateShapes]);

    const removeCurrentPolylineSegment = useCallback(() => {
        if (drawing?.kind !== "polyline" || !drawing?.id) {
            return false;
        }

        const shapeId = String(drawing.id || "");
        let handled = false;
        let cancelled = false;

        updateShapes((previous) => previous.flatMap((shape) => {
            if (String(shape?.id || "") !== shapeId || !Array.isArray(shape?.points) || !shape.points.length) {
                return [shape];
            }

            const points = clonePoints(shape.points);
            const fixedPoints = points.slice(0, Math.max(0, points.length - 1));

            if (fixedPoints.length <= 1) {
                handled = true;
                cancelled = true;
                return [];
            }

            const nextFixedPoints = fixedPoints.slice(0, -1);
            const tail = nextFixedPoints[nextFixedPoints.length - 1];
            if (!tail) {
                handled = true;
                cancelled = true;
                return [];
            }

            handled = true;
            return [{
                ...shape,
                points: [...nextFixedPoints, { x: tail.x, y: tail.y }]
            }];
        }), { persist: true });

        if (!handled) {
            return false;
        }

        setSelectedSegment(null);
        setEditingId(null);

        if (cancelled) {
            setDrawing(null);
            setSelectedIds([]);
            setSelectedOverlayIds([]);
            return true;
        }

        setSelectedIds([shapeId]);
        setSelectedOverlayIds([]);
        return true;
    }, [drawing, updateShapes]);

    const copySelection = useCallback(() => {
        const shapeIds = new Set(coerceArray(selectedIds).map((id) => String(id || "")).filter(Boolean));
        const overlayIds = new Set(coerceArray(selectedOverlayIds).map((id) => String(id || "")).filter(Boolean));
        const shapesCopy = shapesRef.current
            .filter((shape) => shapeIds.has(String(shape?.id || "")))
            .map((shape) => cloneDeepValue(shape));
        const overlaysCopy = overlaysRef.current
            .filter((overlay) => overlayIds.has(String(overlay?.id || "")))
            .map((overlay) => cloneDeepValue(overlay));
        if (!shapesCopy.length && !overlaysCopy.length) {
            return;
        }
        clipboardRef.current = {
            shapes: shapesCopy,
            overlays: overlaysCopy,
            pasteCount: 0
        };
    }, [selectedIds, selectedOverlayIds]);

    const cutSelection = useCallback(() => {
        const hasSelection =
            coerceArray(selectedIds).length > 0 ||
            coerceArray(selectedOverlayIds).length > 0;
        if (!hasSelection) {
            return;
        }
        copySelection();
        deleteSelected();
    }, [copySelection, deleteSelected, selectedIds, selectedOverlayIds]);

    const pasteClipboard = useCallback((anchorPoint = null) => {
        const clipboard = clipboardRef.current;
        const shapeCopies = coerceArray(clipboard?.shapes);
        const overlayCopies = coerceArray(clipboard?.overlays);
        if (!shapeCopies.length && !overlayCopies.length) {
            return;
        }

        const pasteCount = Number(clipboard?.pasteCount || 0) + 1;
        const anchor =
            anchorPoint &&
            Number.isFinite(Number(anchorPoint.x)) &&
            Number.isFinite(Number(anchorPoint.y))
                ? { x: Number(anchorPoint.x), y: Number(anchorPoint.y) }
                : null;
        let dx = anchor ? 0 : 20 * pasteCount;
        let dy = anchor ? 0 : 20 * pasteCount;
        const nextShapeIds = [];
        const nextOverlayIds = [];

        if (anchor) {
            const bounds = [
                ...shapeCopies.map((shape) => getShapeBounds(shape)),
                ...overlayCopies.map((overlay) => getOverlayBounds(overlay))
            ].filter(Boolean);
            if (bounds.length) {
                const minX = Math.min(...bounds.map((box) => Number(box.x || 0)));
                const minY = Math.min(...bounds.map((box) => Number(box.y || 0)));
                dx = anchor.x - minX;
                dy = anchor.y - minY;
            }
        }

        const nextShapes = shapeCopies.map((shape) => {
            const id = createId("shape");
            nextShapeIds.push(id);
            if (Array.isArray(shape?.points)) {
                return withIncrementedShapeTagPath({
                    ...cloneDeepValue(shape),
                    id,
                    points: clonePoints(shape.points).map((point) => ({
                        x: Number(point.x || 0) + dx,
                        y: Number(point.y || 0) + dy
                    }))
                }, pasteCount);
            }
            return withIncrementedShapeTagPath({
                ...cloneDeepValue(shape),
                id,
                x: Number(shape?.x || 0) + dx,
                y: Number(shape?.y || 0) + dy
            }, pasteCount);
        });

        const nextOverlays = overlayCopies.map((overlay) => {
            const id = createId("overlay");
            nextOverlayIds.push(id);
            return withIncrementedOverlayTagPath({
                ...cloneDeepValue(overlay),
                id,
                tx: Number(overlay?.tx || 0) + dx,
                ty: Number(overlay?.ty || 0) + dy
            }, pasteCount);
        });

        if (nextShapes.length) {
            updateShapes((previous) => [...previous, ...nextShapes], { persist: true });
        }
        if (nextOverlays.length) {
            updateSvgOverlays((previous) => [...previous, ...nextOverlays], { persist: true });
        }
        clipboardRef.current = {
            shapes: shapeCopies,
            overlays: overlayCopies,
            pasteCount
        };
        setSelectedIds(nextShapeIds);
        setSelectedOverlayIds(nextOverlayIds);
        setEditingId(null);
        setSelectedSegment(null);
        setTool("select");
    }, [setTool, updateShapes, updateSvgOverlays]);

    const duplicateSelected = useCallback(() => {
        const shapeIds = new Set(coerceArray(selectedIds).map((id) => String(id || "")).filter(Boolean));
        const overlayIds = new Set(coerceArray(selectedOverlayIds).map((id) => String(id || "")).filter(Boolean));
        const selectedShapes = shapesRef.current.filter((shape) => shapeIds.has(String(shape?.id || "")));
        const selectedOverlays = overlaysRef.current.filter((overlay) => overlayIds.has(String(overlay?.id || "")));
        if (!selectedShapes.length && !selectedOverlays.length) {
            return;
        }
        const selectionBoxes = [
            ...selectedShapes.map((shape) => getShapeBounds(shape)),
            ...selectedOverlays.map((overlay) => getOverlayBounds(overlay))
        ].filter(Boolean);
        const leftmostBox = selectionBoxes.length
            ? selectionBoxes.reduce((left, right) => (
                Number(right?.x || 0) < Number(left?.x || 0) ? right : left
            ), selectionBoxes[0])
            : null;
        const dx = Math.max(0, Number(leftmostBox?.width || 0)) + 10;
        const nextShapeIds = [];
        const nextOverlayIds = [];
        const nextShapes = selectedShapes.map((shape) => {
            const id = createId("shape");
            nextShapeIds.push(id);
            if (Array.isArray(shape?.points) && shape.points.length > 0) {
                return withIncrementedShapeTagPath({
                    ...cloneDeepValue(shape),
                    id,
                    points: clonePoints(shape.points).map((point) => ({
                        x: Number(point.x || 0) + dx,
                        y: Number(point.y || 0)
                    }))
                }, 1);
            }
            return withIncrementedShapeTagPath({
                ...cloneDeepValue(shape),
                id,
                x: Number(shape?.x || 0) + dx,
                y: Number(shape?.y || 0)
            }, 1);
        });
        const nextOverlays = selectedOverlays.map((overlay) => {
            const id = createId("overlay");
            nextOverlayIds.push(id);
            return withIncrementedOverlayTagPath({
                ...cloneDeepValue(overlay),
                id,
                tx: Number(overlay?.tx || 0) + dx,
                ty: Number(overlay?.ty || 0)
            }, 1);
        });
        if (nextShapes.length) {
            updateShapes((previous) => [...previous, ...nextShapes], { persist: true });
        }
        if (nextOverlays.length) {
            updateSvgOverlays((previous) => [...previous, ...nextOverlays], { persist: true });
        }
        setSelectedIds(nextShapeIds);
        setSelectedOverlayIds(nextOverlayIds);
        setEditingId(null);
    }, [selectedIds, selectedOverlayIds, updateShapes, updateSvgOverlays]);

    const reorderSelectedOverlays = useCallback((mode) => {
        const selectedIdsList = coerceArray(selectedOverlayIds).map((id) => String(id || "")).filter(Boolean);
        const selectedSet = new Set(selectedIdsList);
        if (!selectedSet.size) {
            return;
        }

        let nextSelectionOrder = selectedIdsList;
        updateSvgOverlays((previous) => {
            const list = coerceArray(previous);
            const orderedSelected = list
                .filter((overlay) => selectedSet.has(String(overlay?.id || "")))
                .map((overlay) => String(overlay?.id || ""));
            if (!orderedSelected.length) {
                return list;
            }
            nextSelectionOrder = orderedSelected;

            if (mode === "front") {
                return [
                    ...list.filter((overlay) => !selectedSet.has(String(overlay?.id || ""))),
                    ...list.filter((overlay) => selectedSet.has(String(overlay?.id || "")))
                ];
            }
            if (mode === "back") {
                return [
                    ...list.filter((overlay) => selectedSet.has(String(overlay?.id || ""))),
                    ...list.filter((overlay) => !selectedSet.has(String(overlay?.id || "")))
                ];
            }

            const reordered = [...list];
            let changed = false;
            if (mode === "forward") {
                for (let i = reordered.length - 2; i >= 0; i -= 1) {
                    const currentSelected = selectedSet.has(String(reordered[i]?.id || ""));
                    const nextSelected = selectedSet.has(String(reordered[i + 1]?.id || ""));
                    if (currentSelected && !nextSelected) {
                        [reordered[i], reordered[i + 1]] = [reordered[i + 1], reordered[i]];
                        changed = true;
                    }
                }
            } else if (mode === "backward") {
                for (let i = 1; i < reordered.length; i += 1) {
                    const currentSelected = selectedSet.has(String(reordered[i]?.id || ""));
                    const previousSelected = selectedSet.has(String(reordered[i - 1]?.id || ""));
                    if (currentSelected && !previousSelected) {
                        [reordered[i - 1], reordered[i]] = [reordered[i], reordered[i - 1]];
                        changed = true;
                    }
                }
            }

            return changed ? reordered : list;
        }, { persist: true });

        if (nextSelectionOrder.length) {
            setSelectedOverlayIds(nextSelectionOrder);
        }
    }, [selectedOverlayIds, updateSvgOverlays]);

    const alignSelectedOverlays = useCallback((axis = "horizontal") => {
        const selectedIdsList = coerceArray(selectedOverlayIds)
            .map((id) => String(id || "").trim())
            .filter(Boolean);
        if (selectedIds.length > 0 || selectedIdsList.length < 2) {
            return;
        }

        const selectedSet = new Set(selectedIdsList);
        const items = overlaysRef.current
            .filter((overlay) => selectedSet.has(String(overlay?.id || "")))
            .map((overlay) => {
                const bounds = getOverlayBounds(overlay);
                if (!bounds) return null;
                return {
                    id: String(overlay?.id || ""),
                    centerX: Number(bounds.x || 0) + Number(bounds.width || 0) / 2,
                    centerY: Number(bounds.y || 0) + Number(bounds.height || 0) / 2
                };
            })
            .filter(Boolean);
        if (items.length < 2) {
            return;
        }

        const horizontal = String(axis || "").toLowerCase().startsWith("h");
        const centers = items.map((item) => horizontal ? item.centerY : item.centerX);
        const target = (Math.min(...centers) + Math.max(...centers)) / 2;
        if (!Number.isFinite(target)) {
            return;
        }

        const deltaById = new Map();
        items.forEach((item) => {
            deltaById.set(item.id, horizontal
                ? { dx: 0, dy: target - item.centerY }
                : { dx: target - item.centerX, dy: 0 });
        });

        updateSvgOverlays((previous) => previous.map((overlay) => {
            const delta = deltaById.get(String(overlay?.id || ""));
            if (!delta) {
                return overlay;
            }
            return {
                ...overlay,
                tx: Number(overlay?.tx || 0) + delta.dx,
                ty: Number(overlay?.ty || 0) + delta.dy
            };
        }), { persist: true });
    }, [selectedIds.length, selectedOverlayIds, updateSvgOverlays]);

    const beginSelectionDrag = useCallback((start, shapeIds = EMPTY_ARRAY, overlayIds = EMPTY_ARRAY) => {
        const shapeSnapshotsById = {};
        coerceArray(shapeIds).forEach((shapeId) => {
            const shape = shapesRef.current.find((item) => String(item?.id || "") === String(shapeId || ""));
            const snapshot = buildShapeSnapshot(shape);
            if (snapshot?.id) {
                shapeSnapshotsById[snapshot.id] = snapshot;
            }
        });

        const overlaySnapshotsById = {};
        coerceArray(overlayIds).forEach((overlayId) => {
            const overlay = overlaysRef.current.find((item) => String(item?.id || "") === String(overlayId || ""));
            const snapshot = buildOverlayDragSnapshot(overlay);
            if (snapshot?.id) {
                overlaySnapshotsById[snapshot.id] = snapshot;
            }
        });

        if (!Object.keys(shapeSnapshotsById).length && !Object.keys(overlaySnapshotsById).length) {
            return;
        }

        setDragState({
            start,
            shapeSnapshotsById,
            overlaySnapshotsById
        });
    }, []);

    const insertPointOnPolyline = useCallback((id, point) => {
        updateShapes((previous) => previous.map((shape) => {
            if (String(shape?.id || "") !== String(id || "") || !Array.isArray(shape?.points) || shape.points.length < 2) {
                return shape;
            }

            const points = clonePoints(shape.points);
            let best = { index: 0, distanceSquared: Number.POSITIVE_INFINITY, point: null };

            for (let index = 0; index < points.length - 1; index += 1) {
                const candidate = closestPointOnSegment(point, points[index], points[index + 1]);
                const candidateDistanceSquared = dist2(point, candidate);
                if (candidateDistanceSquared < best.distanceSquared) {
                    best = {
                        index,
                        distanceSquared: candidateDistanceSquared,
                        point: candidate
                    };
                }
            }

            if (!best.point) {
                return shape;
            }

            const nextPoints = points.slice(0, best.index + 1)
                .concat([{ x: best.point.x, y: best.point.y }], points.slice(best.index + 1));
            return {
                ...shape,
                points: nextPoints
            };
        }), { persist: true });
    }, [updateShapes]);

    const deletePolylineVertex = useCallback((id, index) => {
        const shape = shapesRef.current.find((item) => String(item?.id || "") === String(id || ""));
        if (!shape || !Array.isArray(shape?.points) || shape.points.length <= 2) {
            return false;
        }

        const numericIndex = Number(index);
        if (!Number.isInteger(numericIndex) || numericIndex < 0 || numericIndex >= shape.points.length) {
            return false;
        }

        updateShapes((previous) => previous.map((item) => {
            if (String(item?.id || "") !== String(id || "") || !Array.isArray(item?.points) || item.points.length <= 2) {
                return item;
            }
            const nextPoints = clonePoints(item.points);
            nextPoints.splice(numericIndex, 1);
            return {
                ...item,
                points: nextPoints
            };
        }), { persist: true });

        const nextIndex = Math.max(0, Math.min(numericIndex, shape.points.length - 2));
        setSelectedIds([String(id || "")]);
        setSelectedOverlayIds([]);
        setEditingId(String(id || ""));
        setSelectedSegment({ id: String(id || ""), index: nextIndex, kind: "point" });
        return true;
    }, [updateShapes]);

    const handleImportToggle = useCallback(() => {
        if (!svgLibraryEnabled || !svgCatalogFiles.length) {
            return;
        }
        setWidgetOpen(false);
        setHelpOpen(false);
        setImportOpen((current) => !current);
    }, [svgCatalogFiles.length, svgLibraryEnabled]);

    const createOverlayFromRawMarkup = useCallback((raw, options = {}) => {
        if (typeof raw !== "string") {
            return null;
        }
        const parsed = stripOuterSvg(raw);
        if (!parsed?.inner) {
            return null;
        }

        const fileKey = String(options.fileKey || "").trim();
        const overlayName = String(options.name || "").trim() || fileKey.split("/").pop() || fileKey || "Overlay";
        const extraOverlay = isPlainObject(options.extraOverlay) ? options.extraOverlay : {};
        const keySize = extractKeySize(raw);
        const parsedEType = extractSvgEType(raw, fileKey);
        const sourceHadEType = hasExplicitSvgEType(raw);
        const defaultFill = sourceHadEType ? "" : DEFAULT_FILL;
        const defaultStroke = sourceHadEType ? "" : DEFAULT_STROKE;
        const baseViewBox = parsed.vb;
        let localViewBox = keySize
            ? { x: 0, y: 0, w: keySize.w, h: keySize.h }
            : baseViewBox;

        if (!localViewBox || !Number.isFinite(localViewBox.w) || !Number.isFinite(localViewBox.h) || localViewBox.w <= 0 || localViewBox.h <= 0) {
            localViewBox = { x: 0, y: 0, w: 100, h: 100 };
        }

        let inner = parsed.inner;
        let sourceScaleX = 1;
        let sourceScaleY = 1;
        if (keySize && baseViewBox?.w > 0 && baseViewBox?.h > 0) {
            const scaleX = keySize.w / baseViewBox.w;
            const scaleY = keySize.h / baseViewBox.h;
            sourceScaleX = scaleX;
            sourceScaleY = scaleY;
            inner = `
      <g transform="translate(${-baseViewBox.x},${-baseViewBox.y}) scale(${scaleX},${scaleY})">
        ${parsed.inner}
      </g>
    `;
        }

        const srcWidth = Math.max(localViewBox.w, 1);
        const srcHeight = Math.max(localViewBox.h, 1);
        const fitScale = Math.min(
            Math.max(1, viewBox.width - 80) / srcWidth,
            Math.max(1, viewBox.height - 80) / srcHeight
        );
        const scale = keySize ? 1 : Math.max(0.2, Math.min(350 / srcWidth, fitScale));
        const srcCenterX = localViewBox.x + (localViewBox.w / 2);
        const srcCenterY = localViewBox.y + (localViewBox.h / 2);
        const anchor = {
            x: viewBox.x + (viewBox.width / 2),
            y: viewBox.y + (viewBox.height / 2)
        };
        const id = createId("overlay");
        return {
            id,
            sourceKey: fileKey,
            name: overlayName,
            inner,
            tx: anchor.x - (scale * srcCenterX),
            ty: anchor.y - (scale * srcCenterY),
            scale,
            scaleX: scale,
            scaleY: scale,
            fill: defaultFill,
            stroke: defaultStroke,
            strokeMode: "preserve",
            tagPath: "",
            eType: parsedEType,
            eTypeAuto: true,
            sourceHadEType,
            popupParamsJson: "{}",
            bbox: {
                x: localViewBox.x,
                y: localViewBox.y,
                width: localViewBox.w,
                height: localViewBox.h
            },
            sourceScaleX,
            sourceScaleY,
            ...extraOverlay
        };
    }, [viewBox.height, viewBox.width, viewBox.x, viewBox.y]);

    const onPickSvg = useCallback(async (fileKey, anchorPoint = null) => {
        const raw = await readSvgRawByKey(fileKey, { forceFresh: false });
        let nextOverlay = createOverlayFromRawMarkup(raw, { fileKey });
        if (!nextOverlay) {
            return;
        }
        const targetAnchor =
            anchorPoint &&
            Number.isFinite(Number(anchorPoint.x)) &&
            Number.isFinite(Number(anchorPoint.y))
                ? { x: Number(anchorPoint.x), y: Number(anchorPoint.y) }
                : importAnchor &&
                    Number.isFinite(Number(importAnchor.x)) &&
                    Number.isFinite(Number(importAnchor.y))
                    ? { x: Number(importAnchor.x), y: Number(importAnchor.y) }
                    : null;
        if (
            targetAnchor &&
            nextOverlay?.bbox
        ) {
            const scaleX = overlayScaleX(nextOverlay);
            const scaleY = overlayScaleY(nextOverlay);
            const bbox = nextOverlay.bbox;
            const centerX = Number(bbox.x || 0) + Number(bbox.width || 0) / 2;
            const centerY = Number(bbox.y || 0) + Number(bbox.height || 0) / 2;
            nextOverlay = {
                ...nextOverlay,
                tx: targetAnchor.x - scaleX * centerX,
                ty: targetAnchor.y - scaleY * centerY
            };
        }

        updateSvgOverlays((previous) => [...previous, nextOverlay], { persist: true });
        setSelectedOverlayIds([nextOverlay.id]);
        setSelectedIds([]);
        setImportOpen(false);
        setWidgetOpen(false);
        setImportAnchor(null);
    }, [createOverlayFromRawMarkup, importAnchor, readSvgRawByKey, updateSvgOverlays]);

    const swapSelectedOverlaySvgTemplate = useCallback(async (fileKey) => {
        const targetKey = String(fileKey || "").trim();
        if (!targetKey || !selectedOverlay || selectedOverlay?.widget || selectedOverlay?.embeddedView) {
            return;
        }

        try {
            const raw = await readSvgRawByKey(targetKey, { forceFresh: false });
            const payload = buildOverlaySourcePayload(raw, targetKey);
            if (!payload) {
                throw new Error("Failed to parse selected SVG.");
            }

            const targetEntry = coerceArray(svgFiles).find((entry) => String(entry?.key || "") === targetKey);
            const nextName = String(targetEntry?.name || targetKey.split("/").pop() || targetKey).trim() || "SVG Overlay";
            const selectedId = String(selectedOverlay.id || "");

            updateSvgOverlays((previous) => previous.map((overlay) => {
                if (String(overlay?.id || "") !== selectedId) {
                    return overlay;
                }
                return {
                    ...refreshOverlayFromSourcePayload(overlay, payload),
                    id: overlay.id,
                    sourceKey: targetKey,
                    name: nextName
                };
            }), { persist: true });
        } catch (error) {
            setSvgLibraryError(String(error?.message || "Failed to swap SVG template."));
        }
    }, [readSvgRawByKey, selectedOverlay, svgFiles, updateSvgOverlays]);

    const handleWidgetToggle = useCallback(() => {
        setImportOpen(false);
        setHelpOpen(false);
        setWidgetOpen((current) => !current);
    }, []);

    const handleAddEmbeddedView = useCallback(() => {
        const width = Math.min(520, Math.max(300, Number(viewBox.width || DEFAULT_CANVAS_WIDTH) * 0.3));
        const height = Math.min(320, Math.max(180, Number(viewBox.height || DEFAULT_CANVAS_HEIGHT) * 0.18));
        const id = createId("embedded-view");
        const nextOverlay = {
            id,
            name: "Embedded View",
            tx: Number(viewBox.x || 0) + ((Number(viewBox.width || DEFAULT_CANVAS_WIDTH) - width) / 2),
            ty: Number(viewBox.y || 0) + ((Number(viewBox.height || DEFAULT_CANVAS_HEIGHT) - height) / 2),
            scale: 1,
            fill: "",
            stroke: "",
            strokeMode: "preserve",
            tagPath: "",
            eType: "EmbeddedView",
            eTypeAuto: false,
            bbox: {
                x: 0,
                y: 0,
                width,
                height
            },
            embeddedView: {
                viewPath: "",
                paramsJson: "{}",
                runtimeInteractive: true
            }
        };

        updateSvgOverlays((previous) => [...previous, nextOverlay], { persist: true });
        setSelectedOverlayIds([id]);
        setSelectedIds([]);
        setImportOpen(false);
        setWidgetOpen(false);
        setHelpOpen(false);
        setPropertiesSelectionKey(`overlay:${id}`);
    }, [setPropertiesSelectionKey, updateSvgOverlays, viewBox.height, viewBox.width, viewBox.x, viewBox.y]);

    const handleHelpToggle = useCallback(() => {
        setImportOpen(false);
        setWidgetOpen(false);
        setHelpOpen((current) => !current);
    }, []);

    const onPickWidget = useCallback((widgetKey, anchorPoint = null) => {
        const template = widgetTemplate(widgetKey);
        let nextOverlay = createOverlayFromRawMarkup(template?.raw, {
            fileKey: template?.name || String(widgetKey || ""),
            name: template?.name || String(widgetKey || "Widget"),
            extraOverlay: {
                tagPath: "",
                widget: defaultWidgetSettings(widgetKey),
                eType: "Widget",
                eTypeAuto: false
            }
        });
        if (!nextOverlay) {
            return;
        }
        const targetAnchor =
            anchorPoint &&
            Number.isFinite(Number(anchorPoint.x)) &&
            Number.isFinite(Number(anchorPoint.y))
                ? { x: Number(anchorPoint.x), y: Number(anchorPoint.y) }
                : importAnchor &&
                    Number.isFinite(Number(importAnchor.x)) &&
                    Number.isFinite(Number(importAnchor.y))
                    ? { x: Number(importAnchor.x), y: Number(importAnchor.y) }
                    : null;
        if (targetAnchor && nextOverlay?.bbox) {
            const scaleX = overlayScaleX(nextOverlay);
            const scaleY = overlayScaleY(nextOverlay);
            const bbox = nextOverlay.bbox;
            const centerX = Number(bbox.x || 0) + Number(bbox.width || 0) / 2;
            const centerY = Number(bbox.y || 0) + Number(bbox.height || 0) / 2;
            nextOverlay = {
                ...nextOverlay,
                tx: targetAnchor.x - scaleX * centerX,
                ty: targetAnchor.y - scaleY * centerY
            };
        }

        updateSvgOverlays((previous) => [...previous, nextOverlay], { persist: true });
        setSelectedOverlayIds([nextOverlay.id]);
        setSelectedIds([]);
        setImportOpen(false);
        setWidgetOpen(false);
        setImportAnchor(null);
    }, [createOverlayFromRawMarkup, importAnchor, updateSvgOverlays]);

    const handleCanvasDoubleClick = useCallback((event) => {
        if (!editorVisible || event?.defaultPrevented) {
            return;
        }
        if (tool === "polyline" || drawing?.kind === "polyline") {
            return;
        }
        if (isInteractiveEditorTarget(event?.target)) {
            return;
        }
        const target = event?.target;
        if (
            target instanceof Element
            && target.closest(
                [
                    "[data-overlay-id]",
                    "[data-shape-id]",
                    "[data-overlay-selection-ui]",
                    "[data-overlay-selection-move-hit]",
                    "[data-overlay-selection-hit]",
                    "[data-shape-selection-ui]",
                    "[data-shape-selection-hit]",
                    "[data-mixed-selection-ui]",
                    "[data-vizi-properties-panel]",
                    "[data-vizi-import-drawer]",
                    "[data-vizi-widget-drawer]",
                    "[data-vizi-dropdown]",
                    "[data-vizi-dropdown-menu]",
                    "[data-vizi-quick-svg-picker]",
                    "[data-vizi-quick-tag-picker]"
                ].join(", ")
            )
        ) {
            return;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();
        setImportAnchor(pointFromEvent(event));
        clearSelection();
        setEditingId(null);
        setSelectedSegment(null);
        setPropertiesSelectionKey("");
    }, [clearSelection, drawing, editorVisible, pointFromEvent, tool]);

    const handleSvgMouseDown = useCallback((event) => {
        if (event?.button && event.button !== 0) {
            return;
        }
        if (event?.defaultPrevented) {
            return;
        }

        const point = pointFromEvent(event);

        if (tool === "select") {
            setSelectedSegment(null);
            setEditingId(null);
            setDragState(null);
            setDragHandle(null);
            setShapeResize(null);
            setOverlayResize(null);
            if (!event?.shiftKey) {
                clearSelection();
            }
            setMarquee({
                start: point,
                cur: point,
                additive: Boolean(event?.shiftKey),
                baseShapeIds: coerceArray(selectedIds),
                baseOverlayIds: coerceArray(selectedOverlayIds)
            });
            return;
        }

        if (tool === "text") {
            const id = createId("text");
            updateShapes((previous) => [
                ...previous,
                {
                    id,
                    type: "text",
                    x: point.x,
                    y: point.y,
                    text: "Text",
                    fontSize: 24,
                    fill: DEFAULT_STROKE,
                    fontFamily: "system-ui",
                    fontWeight: "400",
                    anchor: "start",
                    tagPath: "",
                    scaleFactor: "",
                    decimals: "",
                    unit: ""
                }
            ], { persist: true });
            setSelectedIds([id]);
            setSelectedOverlayIds([]);
            setEditingId(null);
            setSelectedSegment(null);
            return;
        }

        if (tool === "rect" || tool === "circle") {
            const id = createId(tool);
            updateShapes((previous) => [
                ...previous,
                {
                    id,
                    type: tool,
                    x: point.x,
                    y: point.y,
                    width: 0,
                    height: 0,
                    stroke: DEFAULT_STROKE,
                    strokeWidth: 3,
                    fill: "transparent",
                    lineStyle: "solid",
                    tagPath: ""
                }
            ], { persist: false });
            setSelectedIds([id]);
            setSelectedOverlayIds([]);
            setEditingId(null);
            setSelectedSegment(null);
            setDrawing({ kind: tool, id, start: point });
            return;
        }

        if (tool === "trunkconn" || tool === "polyline" || tool === "trunkconn") {
            startOrAppendPolylineAt(point, event);
        }
    }, [clearSelection, drawing, pointFromEvent, selectedIds, selectedOverlayIds, startOrAppendPolylineAt, tool, updateShapes]);

    const handleShapeMouseDown = useCallback((event, id) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (tool === "polyline" || tool === "trunkconn") {
            startOrAppendPolylineAt(pointFromEvent(event), event);
            return;
        }
        const shapeId = String(id || "");
        const shape = shapesRef.current.find((item) => String(item?.id || "") === shapeId);

        if (!shape || !isShapeSelectableByMode(shape)) {
            return;
        }

        if (tool !== "select") {
            return;
        }

        if (event?.shiftKey) {
            closePropertiesPanel();
            setSelectedIds((previous) => toggleIn(previous, shapeId));
            setSelectedSegment(null);
            if (editingId === shapeId) {
                setEditingId(null);
            }
            return;
        }

        if (editingId === shapeId) {
            setSelectedIds([shapeId]);
            setSelectedOverlayIds([]);
            retargetPropertiesPanelIfOpen(`shape:${shapeId}`);
            return;
        }

        const alreadySelected = selectedIds.includes(shapeId);
        const dragShapeIds = alreadySelected ? coerceArray(selectedIds) : [shapeId];
        const dragOverlayIds = alreadySelected ? coerceArray(selectedOverlayIds) : EMPTY_ARRAY;

        setSelectedIds(dragShapeIds);
        setSelectedOverlayIds(dragOverlayIds);
        setSelectedSegment(null);
        retargetPropertiesPanelIfOpen(`shape:${shapeId}`);
        if (!alreadySelected) {
            setEditingId(null);
            return;
        }

        beginSelectionDrag(pointFromEvent(event), dragShapeIds, dragOverlayIds);
    }, [beginSelectionDrag, closePropertiesPanel, editingId, isShapeSelectableByMode, pointFromEvent, retargetPropertiesPanelIfOpen, selectedIds, selectedOverlayIds, startOrAppendPolylineAt, tool]);

    const handleOverlayMouseDown = useCallback((event, id) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (tool === "polyline" || tool === "trunkconn") {
            startOrAppendPolylineAt(pointFromEvent(event), event);
            return;
        }
        if (!overlaysSelectable) {
            return;
        }
        const overlayId = String(id || "");
        const overlay = overlaysRef.current.find((item) => String(item?.id || "") === overlayId);
        if (!overlay) {
            return;
        }

        if (tool !== "select") {
            return;
        }

        if (event?.shiftKey) {
            closePropertiesPanel();
            setSelectedOverlayIds((previous) => toggleIn(previous, overlayId));
            setSelectedSegment(null);
            setEditingId(null);
            return;
        }

        const alreadySelected = selectedOverlayIds.includes(overlayId);
        const dragOverlayIds = alreadySelected ? coerceArray(selectedOverlayIds) : [overlayId];
        const dragShapeIds = alreadySelected ? coerceArray(selectedIds) : EMPTY_ARRAY;

        setSelectedOverlayIds(dragOverlayIds);
        setSelectedIds(dragShapeIds);
        setSelectedSegment(null);
        setEditingId(null);
        retargetPropertiesPanelIfOpen(`overlay:${overlayId}`);
        if (!alreadySelected) {
            return;
        }

        beginSelectionDrag(pointFromEvent(event), dragShapeIds, dragOverlayIds);
    }, [beginSelectionDrag, closePropertiesPanel, overlaysSelectable, pointFromEvent, retargetPropertiesPanelIfOpen, selectedIds, selectedOverlayIds, startOrAppendPolylineAt, tool]);

    const handleShapeDoubleClick = useCallback((event, id) => {
        if (String(event?.type || "").toLowerCase() !== "dblclick" || Number(event?.button || 0) !== 0) {
            return;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const shapeId = String(id || "");
        const shape = shapesRef.current.find((item) => String(item?.id || "") === shapeId);
        if (tool === "polyline" || tool === "trunkconn" && drawing?.kind === "polyline" && String(drawing.id || "") === shapeId) {
            finishActivePolylineAt(shapeId, pointFromEvent(event), event);
            return;
        }
        if (!shape || !isShapeSelectableByMode(shape) || tool !== "select") {
            return;
        }
        setSelectedIds([shapeId]);
        setSelectedOverlayIds([]);
        if (Array.isArray(shape?.points) || String(shape?.type || "").toLowerCase() === "polyline") {
            setEditingId(shapeId);
            setSelectedSegment(null);
        } else {
            setEditingId(null);
            setSelectedSegment(null);
        }
        openPropertiesForSelection(`shape:${shapeId}`);
    }, [drawing, finishActivePolylineAt, isShapeSelectableByMode, openPropertiesForSelection, pointFromEvent, tool]);

    const handleOverlayDoubleClick = useCallback((event, overlayOrId) => {
        if (String(event?.type || "").toLowerCase() !== "dblclick" || Number(event?.button || 0) !== 0) {
            return;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!overlaysSelectable || tool !== "select") {
            return;
        }
        const overlayId = String(
            typeof overlayOrId === "object" && overlayOrId
                ? overlayOrId.id || ""
                : overlayOrId || ""
        ).trim();
        const overlay = overlaysRef.current.find((item) => String(item?.id || "").trim() === overlayId);
        if (!overlay) {
            return;
        }
        setSelectedOverlayIds([overlayId]);
        setSelectedIds([]);
        setEditingId(null);
        setSelectedSegment(null);
        closeQuickTagPicker();
        openPropertiesForSelection(`overlay:${overlayId}`);
    }, [closeQuickTagPicker, openPropertiesForSelection, overlaysSelectable, tool]);

    const handleOverlayContextMenu = useCallback((event, overlayOrId) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!overlaysSelectable || tool !== "select") {
            return;
        }

        const overlayId = String(
            typeof overlayOrId === "object" && overlayOrId
                ? overlayOrId.id || ""
                : overlayOrId || ""
        ).trim();
        const overlay = overlaysRef.current.find((item) => String(item?.id || "").trim() === overlayId);
        if (!overlay || overlay.widget || overlay.embeddedView) {
            return;
        }

        const selectedOverlayIdList = coerceArray(selectedOverlayIds)
            .map((id) => String(id || "").trim())
            .filter(Boolean);
        const isCurrentMultiOverlaySelection = Boolean(
            selectedIds.length === 0
            && selectedOverlayIdList.length > 1
            && selectedOverlayIdList.includes(overlayId)
        );
        const targetOverlayIds = isCurrentMultiOverlaySelection ? selectedOverlayIdList : [overlayId];
        if (!isCurrentMultiOverlaySelection) {
            setSelectedOverlayIds([overlayId]);
        }
        setSelectedIds([]);
        setEditingId(null);
        setSelectedSegment(null);
        closePropertiesPanel();
        setQuickTagPickerState({
            overlayId: targetOverlayIds[0] || overlayId,
            overlayIds: targetOverlayIds,
            nonce: Date.now(),
            clientX: Number(event?.clientX || 0),
            clientY: Number(event?.clientY || 0)
        });
    }, [closePropertiesPanel, overlaysSelectable, selectedIds.length, selectedOverlayIds, tool]);

    const openOverlayPopup = useCallback((overlay) => {
        if (!overlay || overlay.widget || overlay.embeddedView || isStaticSvgOverlay(overlay)) {
            return false;
        }

        const viewPath = resolveOverlayPopupViewPath(overlay);
        if (!viewPath) {
            return false;
        }

        const clientStore = getPerspectiveClientStore(props);
        const mounts = clientStore?.mounts;
        if (!mounts || typeof mounts.activatePopup !== "function") {
            return false;
        }

        const overlayId = String(overlay?.id || "").trim();
        const popupViewName = resolveOverlayPopupViewName(overlay);
        const popupTitle = String(overlay?.name || popupViewName || "Popup")
            .trim()
            .replace(/\.svg$/i, "");
        const popupId = overlayId
            ? `svg-popup-${overlayId}`
            : `svg-popup-${String(viewPath).replace(/[^a-z0-9/_-]+/gi, "-").toLowerCase()}`;
        const tagPath = String(overlay?.tagPath || "").trim();
        const baseViewParams = {
            overlayId,
            eType: popupViewName,
            name: popupTitle,
            tagName: tagPath,
            tagPath
        };
        const extraViewParams = resolveOverlayPopupParams(overlay, baseViewParams);

        const popupConfig = {
            id: popupId,
            viewPath,
            viewParams: {
                ...extraViewParams,
                ...baseViewParams
            },
            title: popupTitle,
            showCloseIcon: true,
            draggable: true,
            resizable: true,
            modal: false,
            overlayDismiss: false
        };

        if (Array.isArray(mounts.activePopups) && mounts.activePopups.some((popup) => popup?.id === popupId)) {
            if (typeof mounts.closePopup === "function") {
                mounts.closePopup(popupId);
            }
        }

        mounts.activatePopup(popupConfig);
        if (typeof mounts.focusPopup === "function") {
            mounts.focusPopup(popupId);
        }
        return true;
    }, [props]);

    const handleLiveOverlayMouseDown = useCallback((event, id) => {
        const overlayId = String(id || "").trim();
        if (!overlayId) {
            return;
        }

        const overlay = overlaysRef.current.find((item) => String(item?.id || "") === overlayId);
        if (!overlay || overlay.widget || overlay.embeddedView || isStaticSvgOverlay(overlay)) {
            return;
        }

        event?.preventDefault?.();
        event?.stopPropagation?.();
        openOverlayPopup(overlay);
    }, [openOverlayPopup]);

    const handleEditPolylineClick = useCallback((event, id) => {
        const shapeId = String(id || "");
        if (tool === "polyline" || tool === "trunkconn" && drawing?.kind === "polyline" && String(drawing.id || "") === shapeId) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            finishActivePolylineAt(shapeId, pointFromEvent(event), event);
            return;
        }
        if (tool !== "select" || String(editingId || "") !== shapeId) {
            return;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();
        insertPointOnPolyline(shapeId, pointFromEvent(event));
        setSelectedIds([shapeId]);
        setSelectedOverlayIds([]);
        setSelectedSegment(null);
    }, [drawing, editingId, finishActivePolylineAt, insertPointOnPolyline, pointFromEvent, tool]);

    const handleSegmentMouseDown = useCallback((event, id, index) => {
        if (tool === "polyline" || tool === "trunkconn" && drawing?.kind === "polyline" && String(drawing.id || "") === String(id || "")) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            appendPolylinePoint(id, maybeConstrainPolylinePoint(id, pointFromEvent(event), event));
            return;
        }

        if (tool !== "select") {
            return;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const shapeId = String(id || "");
        const segmentIndex = Number(index || 0);
        const shape = shapesRef.current.find((item) => String(item?.id || "") === shapeId);
        const points = clonePoints(shape?.points);
        const startPoint = points[segmentIndex];
        const endPoint = points[segmentIndex + 1];
        if (!startPoint || !endPoint) {
            return;
        }
        const keepHorizontal = Math.abs(Number(endPoint?.x || 0) - Number(startPoint?.x || 0))
            >= Math.abs(Number(endPoint?.y || 0) - Number(startPoint?.y || 0));
        setSelectedIds([shapeId]);
        setSelectedOverlayIds([]);
        setEditingId(shapeId);
        setSelectedSegment({ id: shapeId, index: segmentIndex, kind: "segment" });
        setDragSegment({
            id: shapeId,
            index: segmentIndex,
            startPointer: pointFromEvent(event),
            startPoints: [startPoint, endPoint],
            startPolylinePoints: points,
            keepHorizontal
        });
        setDragHandle(null);
        setDragState(null);
        setMarquee(null);
    }, [appendPolylinePoint, drawing, maybeConstrainPolylinePoint, pointFromEvent, tool]);

    const handlePolylineHandleMouseDown = useCallback((event, id, index) => {
        if (tool !== "select") {
            return;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const shapeId = String(id || "");
        setSelectedIds([shapeId]);
        setSelectedOverlayIds([]);
        setEditingId(shapeId);
        setSelectedSegment({ id: shapeId, index: Number(index || 0), kind: "point" });
        setDragHandle({ id: shapeId, index: Number(index || 0) });
        setDragState(null);
        setMarquee(null);
    }, [tool]);

    const handlePolylineHandleDoubleClick = useCallback((event, id, index) => {
        if (tool !== "select") {
            return;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();
        deletePolylineVertex(id, index);
    }, [deletePolylineVertex, tool]);

    const handleOverlayHandleDown = useCallback((event, id, corner) => {
        if (tool !== "select" || !overlaysSelectable) {
            return;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();

        const overlayId = String(id || "");
        const overlay = overlaysRef.current.find((item) => String(item?.id || "") === overlayId);
        const bbox = overlayLocalBBox(overlayId);
        if (!overlay || !bbox) {
            return;
        }

        const topLeft = { x: bbox.x, y: bbox.y };
        const topRight = { x: bbox.x + bbox.width, y: bbox.y };
        const bottomRight = { x: bbox.x + bbox.width, y: bbox.y + bbox.height };
        const bottomLeft = { x: bbox.x, y: bbox.y + bbox.height };
        const centerX = bbox.x + bbox.width / 2;
        const centerY = bbox.y + bbox.height / 2;
        const top = { x: centerX, y: bbox.y };
        const right = { x: bbox.x + bbox.width, y: centerY };
        const bottom = { x: centerX, y: bbox.y + bbox.height };
        const left = { x: bbox.x, y: centerY };
        const handles = { TL: topLeft, T: top, TR: topRight, R: right, BR: bottomRight, B: bottom, BL: bottomLeft, L: left };
        const oppositeHandles = { TL: bottomRight, T: bottom, TR: bottomLeft, R: left, BR: topLeft, B: top, BL: topRight, L: right };
        const axesByHandle = {
            TL: { x: true, y: true },
            T: { x: false, y: true },
            TR: { x: true, y: true },
            R: { x: true, y: false },
            BR: { x: true, y: true },
            B: { x: false, y: true },
            BL: { x: true, y: true },
            L: { x: true, y: false }
        };
        const key = String(corner || "").toUpperCase();
        const anchorLocal = oppositeHandles[key];
        const startLocal = handles[key];
        if (!anchorLocal || !startLocal) {
            return;
        }

        const anchorWorld = worldFromLocal(overlay, anchorLocal.x, anchorLocal.y);
        const startWorld = worldFromLocal(overlay, startLocal.x, startLocal.y);
        const startPointerWorld = pointFromEvent(event);
        setSelectedOverlayIds([overlayId]);
        setSelectedIds([]);
        setEditingId(null);
        setSelectedSegment(null);
        setOverlayResize({
            kind: "single",
            id: overlayId,
            handle: key,
            axes: axesByHandle[key] || { x: true, y: true },
            anchorLocal,
            anchorWorld,
            handleLocal: startLocal,
            startWorld,
            startPointerWorld,
            startDist: Math.max(1, distance(startWorld, anchorWorld)),
            originalScaleX: overlayScaleX(overlay),
            originalScaleY: overlayScaleY(overlay),
            bbox,
            startBounds: getOverlayBounds(overlay)
        });
        setDragState(null);
        setMarquee(null);
    }, [overlayLocalBBox, overlaysSelectable, pointFromEvent, tool]);

    const handleShapeResizeHandleDown = useCallback((event, corner) => {
        if (tool !== "select" || !selectedBBox || !selectedIds.length || selectedOverlayIds.length) {
            return;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();

        const bounds = {
            x: Number(selectedBBox.x || 0),
            y: Number(selectedBBox.y || 0),
            width: Math.max(1, Number(selectedBBox.width || 0)),
            height: Math.max(1, Number(selectedBBox.height || 0))
        };
        const topLeft = { x: bounds.x, y: bounds.y };
        const topRight = { x: bounds.x + bounds.width, y: bounds.y };
        const bottomRight = { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
        const bottomLeft = { x: bounds.x, y: bounds.y + bounds.height };
        const oppositeCorners = { TL: bottomRight, TR: bottomLeft, BR: topLeft, BL: topRight };
        const anchor = oppositeCorners[String(corner || "").toUpperCase()];
        if (!anchor) {
            return;
        }

        const originalsById = {};
        coerceArray(selectedIds).forEach((shapeId) => {
            const shape = shapesRef.current.find((item) => String(item?.id || "") === String(shapeId || ""));
            const snapshot = buildShapeResizeSnapshot(shape);
            if (snapshot?.id) {
                originalsById[snapshot.id] = snapshot;
            }
        });

        if (!Object.keys(originalsById).length) {
            return;
        }

        setShapeResize({
            corner: String(corner || "").toUpperCase(),
            anchor,
            startBounds: bounds,
            originalsById
        });
        setDragState(null);
        setMarquee(null);
    }, [selectedBBox, selectedIds, selectedOverlayIds.length, tool]);

    const handleOverlayGroupHandleDown = useCallback((event, corner) => {
        if (tool !== "select" || selectedIds.length > 0 || selectedOverlayIds.length < 2 || !selectedBBox) {
            return;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();

        const bounds = {
            x: Number(selectedBBox.x || 0),
            y: Number(selectedBBox.y || 0),
            width: Math.max(1, Number(selectedBBox.width || 0)),
            height: Math.max(1, Number(selectedBBox.height || 0))
        };
        const topLeft = { x: bounds.x, y: bounds.y };
        const topRight = { x: bounds.x + bounds.width, y: bounds.y };
        const bottomRight = { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
        const bottomLeft = { x: bounds.x, y: bounds.y + bounds.height };
        const corners = { TL: topLeft, TR: topRight, BR: bottomRight, BL: bottomLeft };
        const oppositeCorners = { TL: bottomRight, TR: bottomLeft, BR: topLeft, BL: topRight };
        const key = String(corner || "").toUpperCase();
        const anchorWorld = oppositeCorners[key];
        const startWorld = corners[key];
        if (!anchorWorld || !startWorld) {
            return;
        }

        const originalsById = {};
        selectedOverlayIds.forEach((overlayId) => {
            const overlay = overlaysRef.current.find((item) => String(item?.id || "") === String(overlayId || ""));
            if (!overlay) {
                return;
            }
            const bbox = overlayLocalBBox(overlayId);
            if (!bbox) {
                return;
            }
            originalsById[String(overlayId || "")] = {
                id: String(overlayId || ""),
                tx: Number(overlay.tx || 0),
                ty: Number(overlay.ty || 0),
                scaleX: overlayScaleX(overlay),
                scaleY: overlayScaleY(overlay),
                bbox
            };
        });

        if (!Object.keys(originalsById).length) {
            return;
        }

        setOverlayResize({
            kind: "group",
            anchorWorld,
            startWorld,
            startPointerWorld: pointFromEvent(event),
            startDist: Math.max(1, distance(startWorld, anchorWorld)),
            originalsById
        });
        setDragState(null);
        setMarquee(null);
    }, [overlayLocalBBox, pointFromEvent, selectedBBox, selectedIds.length, selectedOverlayIds, tool]);

    const handleMouseMove = useCallback((event) => {
        const point = pointFromEvent(event);
        const isAltDown = Boolean(event?.altKey);

        if (dragSegment?.id) {
            updateShapes((previous) => previous.map((shape) => {
                if (String(shape?.id || "") !== String(dragSegment.id || "") || !Array.isArray(shape?.points)) {
                    return shape;
                }
                const segmentIndex = Number(dragSegment.index || 0);
                const sourcePoints = clonePoints(dragSegment.startPolylinePoints || shape.points);
                const nextPoints = clonePoints(sourcePoints);
                if (segmentIndex < 0 || segmentIndex >= nextPoints.length - 1) {
                    return shape;
                }
                const startPoint = dragSegment.startPoints?.[0];
                const endPoint = dragSegment.startPoints?.[1];
                const startPointer = dragSegment.startPointer;
                if (!startPoint || !endPoint || !startPointer) {
                    return shape;
                }

                const deltaX = Number(point?.x || 0) - Number(startPointer?.x || 0);
                const deltaY = Number(point?.y || 0) - Number(startPointer?.y || 0);
                if (isAltDown && dragSegment.keepHorizontal) {
                    const baseY = (Number(startPoint?.y || 0) + Number(endPoint?.y || 0)) / 2;
                    const nextY = Math.max(0, Math.min(viewBox.height, baseY + deltaY));
                    nextPoints[segmentIndex] = { x: Number(startPoint?.x || 0), y: nextY };
                    nextPoints[segmentIndex + 1] = { x: Number(endPoint?.x || 0), y: nextY };
                    const tolerance = 1;
                    for (let idx = segmentIndex - 1; idx >= 0; idx -= 1) {
                        const left = sourcePoints[idx];
                        const right = sourcePoints[idx + 1];
                        if (!left || !right || Math.abs(Number(left.y || 0) - Number(right.y || 0)) > tolerance) {
                            break;
                        }
                        nextPoints[idx] = { ...nextPoints[idx], y: nextY };
                    }
                    for (let idx = segmentIndex + 1; idx < sourcePoints.length - 1; idx += 1) {
                        const left = sourcePoints[idx];
                        const right = sourcePoints[idx + 1];
                        if (!left || !right || Math.abs(Number(left.y || 0) - Number(right.y || 0)) > tolerance) {
                            break;
                        }
                        nextPoints[idx + 1] = { ...nextPoints[idx + 1], y: nextY };
                    }
                } else if (isAltDown) {
                    const baseX = (Number(startPoint?.x || 0) + Number(endPoint?.x || 0)) / 2;
                    const nextX = Math.max(0, Math.min(viewBox.width, baseX + deltaX));
                    nextPoints[segmentIndex] = { x: nextX, y: Number(startPoint?.y || 0) };
                    nextPoints[segmentIndex + 1] = { x: nextX, y: Number(endPoint?.y || 0) };
                    const tolerance = 1;
                    for (let idx = segmentIndex - 1; idx >= 0; idx -= 1) {
                        const left = sourcePoints[idx];
                        const right = sourcePoints[idx + 1];
                        if (!left || !right || Math.abs(Number(left.x || 0) - Number(right.x || 0)) > tolerance) {
                            break;
                        }
                        nextPoints[idx] = { ...nextPoints[idx], x: nextX };
                    }
                    for (let idx = segmentIndex + 1; idx < sourcePoints.length - 1; idx += 1) {
                        const left = sourcePoints[idx];
                        const right = sourcePoints[idx + 1];
                        if (!left || !right || Math.abs(Number(left.x || 0) - Number(right.x || 0)) > tolerance) {
                            break;
                        }
                        nextPoints[idx + 1] = { ...nextPoints[idx + 1], x: nextX };
                    }
                } else {
                    const minStartX = Math.min(Number(startPoint?.x || 0), Number(endPoint?.x || 0));
                    const maxStartX = Math.max(Number(startPoint?.x || 0), Number(endPoint?.x || 0));
                    const minStartY = Math.min(Number(startPoint?.y || 0), Number(endPoint?.y || 0));
                    const maxStartY = Math.max(Number(startPoint?.y || 0), Number(endPoint?.y || 0));
                    const nextDeltaX = clamp(deltaX, -minStartX, Math.max(0, viewBox.width - maxStartX));
                    const nextDeltaY = clamp(deltaY, -minStartY, Math.max(0, viewBox.height - maxStartY));
                    nextPoints[segmentIndex] = {
                        x: Number(startPoint?.x || 0) + nextDeltaX,
                        y: Number(startPoint?.y || 0) + nextDeltaY
                    };
                    nextPoints[segmentIndex + 1] = {
                        x: Number(endPoint?.x || 0) + nextDeltaX,
                        y: Number(endPoint?.y || 0) + nextDeltaY
                    };
                }
                return {
                    ...shape,
                    points: nextPoints
                };
            }), { persist: false });
            return;
        }

        if (dragHandle?.id) {
            updateShapes((previous) => previous.map((shape) => {
                if (String(shape?.id || "") !== String(dragHandle.id || "") || !Array.isArray(shape?.points)) {
                    return shape;
                }
                const nextPoints = clonePoints(shape.points);
                if (dragHandle.index < 0 || dragHandle.index >= nextPoints.length) {
                    return shape;
                }
                const nextPoint = isAltDown
                    ? constrainPolylineHandleMove(shape.points, dragHandle.index, point)
                    : point;
                nextPoints[dragHandle.index] = nextPoint;
                return {
                    ...shape,
                    points: nextPoints
                };
            }), { persist: false });
            return;
        }

        if (shapeResize?.startBounds && shapeResize?.anchor) {
            const nextBounds = rectFromPoints(shapeResize.anchor, point);
            updateShapes((previous) => previous.map((shape) => {
                const snapshot = shapeResize.originalsById[String(shape?.id || "")];
                return snapshot
                    ? applyShapeResizeSnapshot(shape, snapshot, shapeResize.startBounds, nextBounds)
                    : shape;
            }), { persist: false });
            return;
        }

        if (overlayResize?.kind === "single") {
            updateSvgOverlays((previous) => previous.map((overlay) => {
                if (String(overlay?.id || "") !== String(overlayResize.id || "")) {
                    return overlay;
                }
                const axes = isPlainObject(overlayResize.axes) ? overlayResize.axes : { x: true, y: true };
                const anchorWorld = overlayResize.anchorWorld || { x: 0, y: 0 };
                const anchorLocal = overlayResize.anchorLocal || { x: 0, y: 0 };
                const handleLocal = overlayResize.handleLocal || anchorLocal;
                const handle = String(overlayResize.handle || "").toUpperCase();
                const startWorld = overlayResize.startWorld || null;
                const startPointerWorld = overlayResize.startPointerWorld || null;
                const resizePoint = startWorld && startPointerWorld
                    ? {
                        x: Number(startWorld.x || 0) + (Number(point.x || 0) - Number(startPointerWorld.x || 0)),
                        y: Number(startWorld.y || 0) + (Number(point.y || 0) - Number(startPointerWorld.y || 0))
                    }
                    : point;
                const originalScaleX = Math.max(0.0001, Number(overlayResize.originalScaleX || overlayScaleX(overlay)));
                const originalScaleY = Math.max(0.0001, Number(overlayResize.originalScaleY || overlayScaleY(overlay)));
                const localSpanX = Number(handleLocal.x || 0) - Number(anchorLocal.x || 0);
                const localSpanY = Number(handleLocal.y || 0) - Number(anchorLocal.y || 0);
                if (axes.x && axes.y && !overlay?.widget && !overlay?.embeddedView) {
                    const ratio = clamp(
                        distance(resizePoint, anchorWorld) / Math.max(1, Number(overlayResize.startDist || 1)),
                        0.05,
                        100
                    );
                    const scaleX = clamp(originalScaleX * ratio, 0.05, 100);
                    const scaleY = clamp(originalScaleY * ratio, 0.05, 100);
                    const nextTranslation = overlayTranslationForLocalPoint(
                        overlay,
                        anchorLocal,
                        anchorWorld,
                        scaleX,
                        scaleY,
                        overlayResize.bbox || overlay?.bbox
                    );
                    return {
                        ...overlay,
                        scale: scaleX,
                        scaleX,
                        scaleY,
                        tx: nextTranslation.tx,
                        ty: nextTranslation.ty
                    };
                }
                const scaleX = axes.x && Math.abs(localSpanX) > 1e-9
                    ? clamp(Math.abs((Number(resizePoint.x || 0) - Number(anchorWorld.x || 0)) / localSpanX), 0.05, 100)
                    : originalScaleX;
                const scaleY = axes.y && Math.abs(localSpanY) > 1e-9
                    ? clamp(Math.abs((Number(resizePoint.y || 0) - Number(anchorWorld.y || 0)) / localSpanY), 0.05, 100)
                    : originalScaleY;
                return {
                    ...overlay,
                    scale: scaleX,
                    scaleX,
                    scaleY,
                    ...overlayTranslationForLocalPoint(overlay, anchorLocal, anchorWorld, scaleX, scaleY, overlayResize.bbox || overlay?.bbox)
                };
            }), { persist: false });
            return;
        }

        if (overlayResize?.kind === "group") {
            const startWorld = overlayResize.startWorld || null;
            const startPointerWorld = overlayResize.startPointerWorld || null;
            const resizePoint = startWorld && startPointerWorld
                ? {
                    x: Number(startWorld.x || 0) + (Number(point.x || 0) - Number(startPointerWorld.x || 0)),
                    y: Number(startWorld.y || 0) + (Number(point.y || 0) - Number(startPointerWorld.y || 0))
                }
                : point;
            const ratio = clamp(distance(resizePoint, overlayResize.anchorWorld) / Math.max(1, overlayResize.startDist), 0.05, 100);
            updateSvgOverlays((previous) => previous.map((overlay) => {
                const snapshot = overlayResize.originalsById[String(overlay?.id || "")];
                if (!snapshot?.bbox) {
                    return overlay;
                }

                const snapshotScaleX = Math.max(0.0001, Number(snapshot.scaleX || snapshot.scale || 1));
                const snapshotScaleY = Math.max(0.0001, Number(snapshot.scaleY || snapshot.scale || 1));
                const nextScaleX = Math.max(0.0001, snapshotScaleX * ratio);
                const nextScaleY = Math.max(0.0001, snapshotScaleY * ratio);
                const startTopLeft = {
                    x: Number(snapshot.tx || 0) + snapshotScaleX * Number(snapshot.bbox.x || 0),
                    y: Number(snapshot.ty || 0) + snapshotScaleY * Number(snapshot.bbox.y || 0)
                };
                const nextTopLeft = {
                    x: Number(overlayResize.anchorWorld?.x || 0) + (startTopLeft.x - Number(overlayResize.anchorWorld?.x || 0)) * ratio,
                    y: Number(overlayResize.anchorWorld?.y || 0) + (startTopLeft.y - Number(overlayResize.anchorWorld?.y || 0)) * ratio
                };

                return {
                    ...overlay,
                    scale: nextScaleX,
                    scaleX: nextScaleX,
                    scaleY: nextScaleY,
                    tx: nextTopLeft.x - nextScaleX * Number(snapshot.bbox.x || 0),
                    ty: nextTopLeft.y - nextScaleY * Number(snapshot.bbox.y || 0)
                };
            }), { persist: false });
            return;
        }

        if (dragState?.start) {
            const dx = point.x - Number(dragState.start?.x || 0);
            const dy = point.y - Number(dragState.start?.y || 0);
            if (Object.keys(dragState.shapeSnapshotsById || {}).length) {
                updateShapes((previous) => previous.map((shape) => {
                    const snapshot = dragState.shapeSnapshotsById[String(shape?.id || "")];
                    return snapshot ? applyShapeSnapshotDelta(shape, snapshot, dx, dy) : shape;
                }), { persist: false });
            }
            updateSvgOverlays((previous) => previous.map((overlay) => {
                const snapshot = dragState.overlaySnapshotsById[String(overlay?.id || "")];
                if (!snapshot) {
                    return overlay;
                }
                return {
                    ...overlay,
                    tx: snapshot.tx + dx,
                    ty: snapshot.ty + dy
                };
            }), { persist: false });
            return;
        }

        if (marquee?.start) {
            setMarquee((current) => current ? { ...current, cur: point } : current);
            return;
        }

        if (drawing?.kind === "rect" || drawing?.kind === "circle") {
            updateShapes((previous) => previous.map((shape) => {
                if (String(shape?.id || "") !== String(drawing.id || "")) {
                    return shape;
                }
                return {
                    ...shape,
                    x: Math.min(Number(drawing.start?.x || 0), point.x),
                    y: Math.min(Number(drawing.start?.y || 0), point.y),
                    width: Math.abs(point.x - Number(drawing.start?.x || 0)),
                    height: Math.abs(point.y - Number(drawing.start?.y || 0))
                };
            }), { persist: false });
            return;
        }

        if (drawing?.kind === "trunkconn" && drawing.id) {
            const route = computeStraightRoute(drawing.start, point);
            updateShapes((previous) => previous.map((shape) =>
                String(shape?.id || "") === String(drawing.id || "")
                    ? { ...shape, points: route }
                    : shape
            ), { persist: false });
        }

        if (drawing?.kind === "polyline") {
            updateShapes((previous) => previous.map((shape) => {
                if (String(shape?.id || "") !== String(drawing.id || "")) {
                    return shape;
                }
                const points = clonePoints(shape.points);
                if (!points.length) {
                    return shape;
                }
                points[points.length - 1] = maybeConstrainPolylinePoint(drawing.id, point, event);
                return { ...shape, points };
            }), { persist: false });
        }
    }, [constrainPolylineHandleMove, dragHandle, dragSegment, dragState, drawing, marquee, maybeConstrainPolylinePoint, overlayResize, pointFromEvent, shapeResize, updateShapes, updateSvgOverlays, viewBox.height, viewBox.width]);

    const handleMouseUp = useCallback(() => {
        if (dragSegment?.id) {
            const segmentIndex = Number(dragSegment.index || 0);
            const shape = shapesRef.current.find((item) => String(item?.id || "") === String(dragSegment.id || ""));
            const currentPoints = Array.isArray(shape?.points) ? shape.points : EMPTY_ARRAY;
            const startPoint = dragSegment.startPoints?.[0];
            const endPoint = dragSegment.startPoints?.[1];
            const moved = !pointsEqual(startPoint, currentPoints[segmentIndex])
                || !pointsEqual(endPoint, currentPoints[segmentIndex + 1]);
            if (moved) {
                persistShapes(shapesRef.current);
            }
            setDragSegment(null);
            return;
        }

        if (dragHandle?.id) {
            persistShapes(shapesRef.current);
            setDragHandle(null);
            return;
        }

        if (shapeResize?.startBounds) {
            persistShapes(shapesRef.current);
            setShapeResize(null);
            return;
        }

        if (overlayResize?.kind) {
            persistSvgOverlays(overlaysRef.current);
            setOverlayResize(null);
            return;
        }

        if (dragState?.start) {
            if (Object.keys(dragState.shapeSnapshotsById || {}).length) {
                persistShapes(shapesRef.current);
            }
            if (Object.keys(dragState.overlaySnapshotsById || {}).length) {
                persistSvgOverlays(overlaysRef.current);
            }
            setDragState(null);
            return;
        }

        if (marquee?.start) {
            const bounds = rectFromPoints(marquee.start, marquee.cur);
            const isWindowSelect = marquee.start.x < marquee.cur.x;
            const matchesBounds = isWindowSelect ? rectContains : rectsIntersect;
            const hitShapeIds = shapesRef.current
                .filter((shape) => isShapeSelectableByMode(shape) && matchesBounds(bounds, getShapeBounds(shape)))
                .map((shape) => String(shape?.id || ""));
            const hitOverlayIds = overlaysSelectable
                ? overlaysRef.current
                    .filter((overlay) => matchesBounds(bounds, getOverlayBounds(overlay)))
                    .map((overlay) => String(overlay?.id || ""))
                : EMPTY_ARRAY;

            setSelectedIds(
                marquee.additive
                    ? Array.from(new Set([...coerceArray(marquee.baseShapeIds), ...hitShapeIds]))
                    : hitShapeIds
            );
            setSelectedOverlayIds(
                marquee.additive
                    ? Array.from(new Set([...coerceArray(marquee.baseOverlayIds), ...hitOverlayIds]))
                    : hitOverlayIds
            );
            setMarquee(null);
            return;
        }

        if (drawing?.kind === "rect" || drawing?.kind === "circle") {
            persistShapes(shapesRef.current);
            setDrawing(null);
        }
    }, [dragHandle, dragSegment, dragState, drawing, isShapeSelectableByMode, marquee, overlayResize, overlaysSelectable, persistShapes, persistSvgOverlays, shapeResize]);

    const useWindowPointerTracking =
        editorVisible && (
            Boolean(dragState) ||
            Boolean(dragSegment) ||
            Boolean(dragHandle) ||
            Boolean(shapeResize) ||
            Boolean(overlayResize) ||
            Boolean(marquee) ||
            String(drawing?.kind || "") === "rect" ||
            String(drawing?.kind || "") === "circle"
        );

    useEffect(() => {
        if (!useWindowPointerTracking || typeof window === "undefined") {
            return undefined;
        }
        const handleMove = (event) => handleMouseMove(event);
        const handleRelease = () => handleMouseUp();
        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", handleRelease);
        window.addEventListener("pointerup", handleRelease);
        window.addEventListener("pointercancel", handleRelease);
        window.addEventListener("blur", handleRelease);
        return () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", handleRelease);
            window.removeEventListener("pointerup", handleRelease);
            window.removeEventListener("pointercancel", handleRelease);
            window.removeEventListener("blur", handleRelease);
        };
    }, [handleMouseMove, handleMouseUp, useWindowPointerTracking]);

    const handleSvgDoubleClick = useCallback((event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (drawing?.kind === "polyline" && drawing.id) {
            finishActivePolylineAt(drawing.id, pointFromEvent(event), event);
            return;
        }
        finishPolyline();
    }, [drawing, finishActivePolylineAt, finishPolyline, pointFromEvent]);

    const handleCanvasContextMenu = useCallback((event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        const isDrawingPolyline = drawing?.kind === "polyline" && drawing.id;
        if ((tool === "polyline" || tool === "trunkconn") && isDrawingPolyline) {
            if (event?.shiftKey) {
                finishActivePolylineAt(drawing.id, pointFromEvent(event), {
                    altKey: event?.altKey,
                    ctrlKey: event?.ctrlKey,
                    metaKey: event?.metaKey,
                    shiftKey: false
                });
                return;
            }
            removeCurrentPolylineSegment();
            return;
        }

        const target = event?.target;
        const hitElement =
            target instanceof Element &&
            Boolean(target.closest("[data-shape-id], [data-overlay-id], [data-overlay-selection-ui], [data-mixed-selection-ui]"));
        if (hitElement || tool !== "select") {
            closeQuickSvgPicker();
            return;
        }

        const worldPoint = pointFromEvent(event);
        setQuickSvgPickerState({
            open: true,
            clientX: Number(event?.clientX || 0),
            clientY: Number(event?.clientY || 0),
            worldPoint
        });
        setQuickSvgPickerQuery("");
        closeQuickTagPicker();
        closePropertiesPanel();
        window.requestAnimationFrame(() => quickSvgPickerInputRef.current?.focus?.());
    }, [closePropertiesPanel, closeQuickSvgPicker, closeQuickTagPicker, drawing, finishActivePolylineAt, pointFromEvent, removeCurrentPolylineSegment, tool]);

    const worldToPanelPoint = useCallback((worldX, worldY) => {
        const svg = svgRef.current;
        const root = rootRef.current;
        if (!svg || !root || typeof svg.createSVGPoint !== "function" || typeof root.getBoundingClientRect !== "function") {
            return null;
        }
        try {
            const point = svg.createSVGPoint();
            point.x = Number(pan?.x || 0) + Number(worldX || 0) * zoom;
            point.y = Number(pan?.y || 0) + Number(worldY || 0) * zoom;
            const ctm = svg.getScreenCTM?.();
            if (!ctm) {
                return null;
            }
            const screenPoint = point.matrixTransform(ctm);
            const rootRect = root.getBoundingClientRect();
            return {
                x: Number(screenPoint?.x || 0) - Number(rootRect.left || 0),
                y: Number(screenPoint?.y || 0) - Number(rootRect.top || 0)
            };
        } catch (_error) {
            return null;
        }
    }, [pan, zoom]);

    const activateTool = useCallback((nextTool) => {
        if (drawing?.kind === "polyline" && nextTool !== "polyline" && nextTool !== "trunkconn") {
            finishPolyline();
        } else if (drawing && drawing.kind !== nextTool && drawing.kind !== "polyline") {
            setDrawing(null);
        }
        setDragState(null);
        setDragHandle(null);
        setShapeResize(null);
        setOverlayResize(null);
        setMarquee(null);
        setSelectedSegment(null);
        if (nextTool !== "select") {
            setEditingId(null);
        }
        setTool(nextTool);
    }, [drawing, finishPolyline, setTool]);

    const selectedShapeBounds = useMemo(() => getShapeBounds(selectedShape), [selectedShape]);
    const selectedOverlayBounds = useMemo(() => getOverlayBounds(selectedOverlay), [selectedOverlay]);
    const selectedOverlayWidgetKind = useMemo(
        () => String(selectedOverlay?.widget?.kind || "").trim().toLowerCase(),
        [selectedOverlay]
    );
    const selectedOverlayIsEmbeddedView = useMemo(
        () => Boolean(selectedOverlay?.embeddedView),
        [selectedOverlay]
    );
    const selectedOverlayIsStatic = useMemo(
        () => isStaticSvgOverlay(selectedOverlay),
        [selectedOverlay]
    );
    const selectedOverlayTemplateKey = useMemo(() => {
        if (!selectedOverlay || selectedOverlay?.widget || selectedOverlay?.embeddedView) {
            return "";
        }
        const explicitKey = String(selectedOverlay?.sourceKey || selectedOverlay?.fileKey || selectedOverlay?.key || "").trim();
        if (explicitKey) {
            return explicitKey;
        }
        const overlayName = String(selectedOverlay?.name || "").trim();
        if (!overlayName) {
            return "";
        }
        return coerceArray(svgFiles).find((entry) =>
            String(entry?.name || "").trim().toLowerCase() === overlayName.toLowerCase()
        )?.key || "";
    }, [selectedOverlay, svgFiles]);
    const selectedOverlayTemplateSections = useMemo(() => {
        if (!selectedOverlayTemplateKey) {
            return svgTemplateSections;
        }
        const hasCurrent = coerceArray(svgTemplateSections).some((section) =>
            coerceArray(section?.items).some((item) => String(item?.value || "") === selectedOverlayTemplateKey)
        );
        if (hasCurrent) {
            return svgTemplateSections;
        }
        const label = String(selectedOverlay?.name || selectedOverlayTemplateKey.split("/").pop() || selectedOverlayTemplateKey).trim();
        return [
            { label: "Current", items: [{ value: selectedOverlayTemplateKey, label }] },
            ...svgTemplateSections
        ];
    }, [selectedOverlay, selectedOverlayTemplateKey, svgTemplateSections]);
    const editableSelectedOverlayGroup = useMemo(
        () => selectedOverlayGroup.filter((overlay) => (
            overlay
            && !overlay.embeddedView
            && (overlay.widget || !isStaticSvgOverlay(overlay))
        )),
        [selectedOverlayGroup]
    );
    const selectedOverlayGroupCommonTagPath = useMemo(() => {
        if (!editableSelectedOverlayGroup.length) {
            return "";
        }
        const values = editableSelectedOverlayGroup.map((overlay) => String(overlay?.tagPath || "").trim());
        const first = values[0] || "";
        return values.every((value) => value === first) ? first : "";
    }, [editableSelectedOverlayGroup]);
    const selectedOverlayGroupHasMixedTagPaths = useMemo(() => {
        if (editableSelectedOverlayGroup.length < 2) {
            return false;
        }
        const values = editableSelectedOverlayGroup.map((overlay) => String(overlay?.tagPath || "").trim());
        const first = values[0] || "";
        return values.some((value) => value !== first);
    }, [editableSelectedOverlayGroup]);
    const selectedOverlayGroupCommonEType = useMemo(() => {
        const values = editableSelectedOverlayGroup
            .filter((overlay) => !overlay?.widget)
            .map((overlay) => String(overlay?.eType || "").trim())
            .filter(Boolean);
        if (!values.length) {
            return "";
        }
        const first = values[0] || "";
        return values.every((value) => value.toLowerCase() === first.toLowerCase()) ? first : "";
    }, [editableSelectedOverlayGroup]);
    const selectedOverlayEmbeddedView = useMemo(
        () => (isPlainObject(selectedOverlay?.embeddedView) ? selectedOverlay.embeddedView : EMPTY_MAP),
        [selectedOverlay]
    );
    const selectedOverlayEmbeddedViewInteractive = useMemo(
        () => selectedOverlayEmbeddedView?.runtimeInteractive !== false,
        [selectedOverlayEmbeddedView]
    );
    const selectedOverlayWidgetSupportsWrite = useMemo(
        () => ["displaybox", "pushbutton", "onoffbutton"].includes(selectedOverlayWidgetKind),
        [selectedOverlayWidgetKind]
    );
    const selectedOverlayWidgetSupportsView = useMemo(
        () => ["pushbutton", "onoffbutton"].includes(selectedOverlayWidgetKind),
        [selectedOverlayWidgetKind]
    );
    const selectedOverlayWidgetSupportsButtonTextColor = useMemo(
        () => ["displaybox", "pushbutton", "onoffbutton"].includes(selectedOverlayWidgetKind),
        [selectedOverlayWidgetKind]
    );
    const selectedOverlayWidgetWriteMode = useMemo(
        () => resolveWidgetWriteMode(selectedOverlay?.widget, selectedOverlay?.tagPath),
        [selectedOverlay]
    );
    const selectedOverlayWidgetOpcServer = useMemo(
        () => resolveWidgetOpcServer(selectedOverlay?.widget),
        [selectedOverlay]
    );
    const selectedOverlayEmbeddedViewParamsError = useMemo(() => {
        if (!selectedOverlayIsEmbeddedView) {
            return "";
        }
        const raw = String(selectedOverlayEmbeddedView?.paramsJson ?? "{}").trim();
        if (!raw) {
            return "";
        }
        try {
            const parsed = JSON.parse(raw);
            if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
                return "Params must be a JSON object.";
            }
            return "";
        } catch (error) {
            return String(error?.message || "Invalid JSON.");
        }
    }, [selectedOverlayEmbeddedView, selectedOverlayIsEmbeddedView]);
    const selectedOverlayPopupParamsError = useMemo(() => {
        if (!selectedOverlay || selectedOverlayIsEmbeddedView || selectedOverlay?.widget) {
            return "";
        }
        const raw = String(selectedOverlay?.popupParamsJson ?? selectedOverlay?.popupParams ?? "{}").trim();
        if (!raw) {
            return "";
        }
        try {
            const parsed = JSON.parse(raw);
            if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
                return "Params must be a JSON object.";
            }
            return "";
        } catch (error) {
            return String(error?.message || "Invalid JSON.");
        }
    }, [selectedOverlay, selectedOverlayIsEmbeddedView]);
    const selectedOverlayIsBin = useMemo(
        () => String(selectedOverlay?.eType || "").trim().toLowerCase().startsWith("bin"),
        [selectedOverlay]
    );
    const ignitionTagOptionsForOverlay = useMemo(
        () => selectedOverlayIsBin
            ? ignitionTagOptions.filter((opt) => {
                const objectType = String(opt?.objectType || "").toLowerCase();
                const typeId = String(opt?.typeId || "").toLowerCase();
                return objectType.includes("bin") || typeId.includes("bin");
            })
            : ignitionTagOptions,
        [ignitionTagOptions, selectedOverlayIsBin]
    );
    const selectedOverlayGroupIsBin = useMemo(
        () => String(selectedOverlayGroupCommonEType || "").trim().toLowerCase().startsWith("bin"),
        [selectedOverlayGroupCommonEType]
    );
    const ignitionTagOptionsForOverlayGroup = useMemo(
        () => selectedOverlayGroupIsBin
            ? ignitionTagOptions.filter((opt) => {
                const objectType = String(opt?.objectType || "").toLowerCase();
                const typeId = String(opt?.typeId || "").toLowerCase();
                return objectType.includes("bin") || typeId.includes("bin");
            })
            : ignitionTagOptions,
        [ignitionTagOptions, selectedOverlayGroupIsBin]
    );
    const svgETypeOptions = useMemo(
        () => buildUdtTypeOptions({
            tags: ignitionTagOptions,
            styleMapIndex: hmiStateStyleMapIndex,
            currentValues: [
                selectedOverlay?.eType,
                ...coerceArray(svgOverlays).map((overlay) => overlay?.eType)
            ]
        }),
        [hmiStateStyleMapIndex, ignitionTagOptions, selectedOverlay?.eType, svgOverlays]
    );
    const svgETypeSections = useMemo(() => {
        const grouped = new Map();
        coerceArray(svgETypeOptions).forEach((option) => {
            const group = String(option?.group || "UDTs").trim() || "UDTs";
            if (!grouped.has(group)) {
                grouped.set(group, []);
            }
            grouped.get(group).push({
                value: String(option?.value || "").trim(),
                label: String(option?.label || option?.value || "").trim()
            });
        });
        return [
            { label: "", items: [{ value: "", label: "None" }] },
            ...Array.from(grouped.entries()).map(([label, items]) => ({ label, items }))
        ];
    }, [svgETypeOptions]);
    const svgETypeHelperText = ignitionTagsLoading
        ? "Loading UDTs..."
        : ignitionTagsLoaded
            ? `${svgETypeOptions.length} UDT${svgETypeOptions.length === 1 ? "" : "s"} available`
            : "Open to load UDTs from Ignition tags.";
    const editableQuickTagPickerTargetOverlays = useMemo(
        () => quickTagPickerTargetOverlays.filter((overlay) => (
            overlay
            && !overlay.embeddedView
            && (overlay.widget || !isStaticSvgOverlay(overlay))
        )),
        [quickTagPickerTargetOverlays]
    );
    const quickTagPickerCommonTagPath = useMemo(() => {
        if (!editableQuickTagPickerTargetOverlays.length) {
            return "";
        }
        const values = editableQuickTagPickerTargetOverlays.map((overlay) => String(overlay?.tagPath || "").trim());
        const first = values[0] || "";
        return values.every((value) => value === first) ? first : "";
    }, [editableQuickTagPickerTargetOverlays]);
    const quickTagPickerHasMixedTagPaths = useMemo(() => {
        if (editableQuickTagPickerTargetOverlays.length < 2) {
            return false;
        }
        const values = editableQuickTagPickerTargetOverlays.map((overlay) => String(overlay?.tagPath || "").trim());
        const first = values[0] || "";
        return values.some((value) => value !== first);
    }, [editableQuickTagPickerTargetOverlays]);
    const quickTagPickerCommonEType = useMemo(() => {
        const values = editableQuickTagPickerTargetOverlays
            .filter((overlay) => !overlay?.widget)
            .map((overlay) => String(overlay?.eType || "").trim())
            .filter(Boolean);
        if (!values.length) {
            return "";
        }
        const first = values[0] || "";
        return values.every((value) => value.toLowerCase() === first.toLowerCase()) ? first : "";
    }, [editableQuickTagPickerTargetOverlays]);
    const quickTagPickerTypeFilter = quickTagPickerIsGroup
        ? quickTagPickerCommonEType
        : quickTagPickerOverlay?.widget
            ? ""
            : quickTagPickerOverlay?.eType;
    const quickTagPickerOverlayIsBin = useMemo(
        () => String(quickTagPickerTypeFilter || "").trim().toLowerCase().startsWith("bin"),
        [quickTagPickerTypeFilter]
    );
    const ignitionTagOptionsForQuickPicker = useMemo(
        () => quickTagPickerOverlayIsBin
            ? ignitionTagOptions.filter((opt) => {
                const objectType = String(opt?.objectType || "").toLowerCase();
                const typeId = String(opt?.typeId || "").toLowerCase();
                return objectType.includes("bin") || typeId.includes("bin");
            })
            : ignitionTagOptions,
        [ignitionTagOptions, quickTagPickerOverlayIsBin]
    );
    const propertyTargetBounds = selectedOverlayBounds || selectedShapeBounds || selectedBBox;

    const floatingPropertyPanelStyle = useMemo(() => {
        if (!propertiesVisible || !propertyTargetBounds) {
            return null;
        }

        const topLeft = worldToPanelPoint(
            Number(propertyTargetBounds.x || 0),
            Number(propertyTargetBounds.y || 0)
        );
        const topRight = worldToPanelPoint(
            Number(propertyTargetBounds.x || 0) + Number(propertyTargetBounds.width || 0),
            Number(propertyTargetBounds.y || 0)
        );
        const bottomLeft = worldToPanelPoint(
            Number(propertyTargetBounds.x || 0),
            Number(propertyTargetBounds.y || 0) + Number(propertyTargetBounds.height || 0)
        );
        const bottomRight = worldToPanelPoint(
            Number(propertyTargetBounds.x || 0) + Number(propertyTargetBounds.width || 0),
            Number(propertyTargetBounds.y || 0) + Number(propertyTargetBounds.height || 0)
        );

        const rootWidth = Number(rootSize?.width || DEFAULT_CANVAS_WIDTH);
        const rootHeight = Number(rootSize?.height || DEFAULT_CANVAS_HEIGHT);
        const rulerInset = showRulers ? CANVAS_RULER_SIZE : 0;
        const panelWidth = clampPropertyPanelWidth(propertyPanelWidth, rootWidth);

        const minTop = 16 + rulerInset;
        const maxUsableHeight = Math.max(PROPERTY_PANEL_MIN_HEIGHT, rootHeight - minTop - 16);
        const panelHeight = clampPropertyPanelHeight(propertyPanelHeight, maxUsableHeight);
        const minLeft = 16;
        const maxLeft = Math.max(minLeft, rootWidth - panelWidth - 16);
        const maxTop = Math.max(minTop, rootHeight - panelHeight - 16);
        const renderedAnchorRect = (() => {
            const root = rootRef.current;
            const rootRect = root?.getBoundingClientRect?.();
            if (!root || !rootRect) {
                return null;
            }
            const overlayIdSet = new Set(coerceArray(selectedOverlayIds).map((id) => String(id || "")).filter(Boolean));
            const shapeIdSet = new Set(coerceArray(selectedIds).map((id) => String(id || "")).filter(Boolean));
            if (!overlayIdSet.size && !shapeIdSet.size) {
                return null;
            }
            const rects = [];
            root.querySelectorAll?.("[data-overlay-id], [data-shape-id]")?.forEach((node) => {
                const overlayId = node.getAttribute?.("data-overlay-id");
                const shapeId = node.getAttribute?.("data-shape-id");
                if (
                    (overlayId && overlayIdSet.has(String(overlayId))) ||
                    (shapeId && shapeIdSet.has(String(shapeId)))
                ) {
                    const rect = node.getBoundingClientRect?.();
                    if (
                        rect &&
                        Number.isFinite(Number(rect.left)) &&
                        Number.isFinite(Number(rect.right)) &&
                        Number.isFinite(Number(rect.top)) &&
                        Number.isFinite(Number(rect.bottom)) &&
                        Number(rect.width) > 0 &&
                        Number(rect.height) > 0
                    ) {
                        rects.push(rect);
                    }
                }
            });
            if (!rects.length) {
                return null;
            }
            return {
                left: Math.min(...rects.map((rect) => Number(rect.left || 0))) - Number(rootRect.left || 0),
                right: Math.max(...rects.map((rect) => Number(rect.right || 0))) - Number(rootRect.left || 0),
                top: Math.min(...rects.map((rect) => Number(rect.top || 0))) - Number(rootRect.top || 0),
                bottom: Math.max(...rects.map((rect) => Number(rect.bottom || 0))) - Number(rootRect.top || 0)
            };
        })();
        const anchorXs = [topLeft, topRight, bottomLeft, bottomRight]
            .map((point) => Number(point?.x))
            .filter(Number.isFinite);
        const anchorYs = [topLeft, topRight, bottomLeft, bottomRight]
            .map((point) => Number(point?.y))
            .filter(Number.isFinite);
        const fallbackLeft = rootWidth - panelWidth - 16;
        const fallbackTop = minTop;
        const anchorRect = renderedAnchorRect || (anchorXs.length && anchorYs.length
            ? {
                left: Math.min(...anchorXs),
                right: Math.max(...anchorXs),
                top: Math.min(...anchorYs),
                bottom: Math.max(...anchorYs)
            }
            : {
                left: fallbackLeft,
                right: fallbackLeft + 120,
                top: fallbackTop,
                bottom: fallbackTop + 80
            });
        const anchorCenterX = (anchorRect.left + anchorRect.right) / 2;
        const anchorCenterY = (anchorRect.top + anchorRect.bottom) / 2;
        const gap = 4;
        const candidates = [
            { side: "right", x: anchorRect.right + gap, y: anchorCenterY - panelHeight / 2, order: 0 },
            { side: "left", x: anchorRect.left - panelWidth - gap, y: anchorCenterY - panelHeight / 2, order: 1 },
            { side: "below", x: anchorCenterX - panelWidth / 2, y: anchorRect.bottom + gap, order: 2 },
            { side: "above", x: anchorCenterX - panelWidth / 2, y: anchorRect.top - panelHeight - gap, order: 3 }
        ];
        const rectDistance = (a, b) => {
            const dx = Math.max(a.left - b.right, b.left - a.right, 0);
            const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
            return Math.hypot(dx, dy);
        };
        const edgeGap = (side, panelRect) => {
            if (side === "right") {
                return Math.abs(panelRect.left - anchorRect.right);
            }
            if (side === "left") {
                return Math.abs(anchorRect.left - panelRect.right);
            }
            if (side === "below") {
                return Math.abs(panelRect.top - anchorRect.bottom);
            }
            return Math.abs(anchorRect.top - panelRect.bottom);
        };
        const scoredCandidates = candidates.map((candidate) => {
            const left = clamp(candidate.x, minLeft, maxLeft);
            const top = clamp(candidate.y, minTop, maxTop);
            const panelRect = {
                left,
                right: left + panelWidth,
                top,
                bottom: top + panelHeight
            };
            const overlaps = !(
                panelRect.right <= anchorRect.left ||
                panelRect.left >= anchorRect.right ||
                panelRect.bottom <= anchorRect.top ||
                panelRect.top >= anchorRect.bottom
            );
            const clampDistance = Math.hypot(left - candidate.x, top - candidate.y);
            const sidePreference = candidate.side === "right" || candidate.side === "left" ? 0 : 80;
            return {
                left,
                top,
                score:
                    edgeGap(candidate.side, panelRect) * 24 +
                    sidePreference +
                    rectDistance(anchorRect, panelRect) * 0.15 +
                    (overlaps ? 10000 : 0) +
                    clampDistance * 0.4 +
                    candidate.order * 0.01
            };
        }).sort((left, right) => left.score - right.score);
        const best = scoredCandidates[0] || { left: fallbackLeft, top: fallbackTop };
        const left = best.left;
        const top = best.top;

        return {
            position: "absolute",
            left,
            top,
            zIndex: 70,
            width: panelWidth,
            maxWidth: `calc(100% - ${left + 16}px)`,
            height: panelHeight,
            maxHeight: panelHeight,
            overflow: "hidden",
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr) auto",
            gap: 12,
            padding: 14,
            borderRadius: 18,
            border: "1px solid rgba(51, 65, 85, 0.95)",
            background: "linear-gradient(180deg, rgba(2, 6, 23, 0.95) 0%, rgba(15, 23, 42, 0.92) 100%)",
            boxShadow: "0 24px 60px rgba(2, 6, 23, 0.34)"
        };
    }, [propertiesVisible, propertyTargetBounds, worldToPanelPoint, rootSize, showRulers, propertyPanelWidth, propertyPanelHeight, selectedIds, selectedOverlayIds]);

    const fixedPropertyPanelStyle = useMemo(() => {
        if (!floatingPropertyPanelStyle) {
            return null;
        }
        const rootRect = rootRef.current?.getBoundingClientRect?.();
        if (!rootRect) {
            return null;
        }
        const viewportWidth = typeof window !== "undefined" ? window.innerWidth : Number(rootRect.width || 0);
        const viewportHeight = typeof window !== "undefined" ? window.innerHeight : Number(rootRect.height || 0);
        const left = Number(rootRect.left || 0) + Number(floatingPropertyPanelStyle.left || 0);
        const desiredTop = Number(rootRect.top || 0) + Number(floatingPropertyPanelStyle.top || 0);
        const minTop = Math.max(16, Number(rootRect.top || 0) + 16 + (showRulers ? CANVAS_RULER_SIZE : 0));
        const desiredHeight = Number(floatingPropertyPanelStyle.height || PROPERTY_PANEL_HEIGHT);
        const maxUsableHeight = Math.max(PROPERTY_PANEL_MIN_HEIGHT, viewportHeight - minTop - 16);
        const panelHeight = Math.min(desiredHeight, maxUsableHeight);
        const maxTop = Math.max(minTop, viewportHeight - panelHeight - 16);
        const top = clamp(desiredTop, minTop, maxTop);
        return {
            ...floatingPropertyPanelStyle,
            position: "fixed",
            left,
            top,
            maxWidth: Math.max(180, viewportWidth - left - 16),
            height: panelHeight,
            maxHeight: panelHeight
        };
    }, [floatingPropertyPanelStyle, rootSize, showRulers]);

    const quickSvgPickerStyle = useMemo(() => {
        if (!editorVisible || !quickSvgPickerState?.open) {
            return null;
        }
        const rootRect = rootRef.current?.getBoundingClientRect?.();
        const viewportWidth = typeof window !== "undefined" ? window.innerWidth : Number(rootRect?.width || DEFAULT_CANVAS_WIDTH);
        const viewportHeight = typeof window !== "undefined" ? window.innerHeight : Number(rootRect?.height || DEFAULT_CANVAS_HEIGHT);
        const rootLeft = Number(rootRect?.left || 0);
        const rootTop = Number(rootRect?.top || 0);
        const rootRight = rootLeft + Number(rootRect?.width || viewportWidth);
        const rootBottom = rootTop + Number(rootRect?.height || viewportHeight);
        const width = Math.min(QUICK_SVG_PANEL_WIDTH, Math.max(240, rootRight - rootLeft - 24));
        const maxHeight = Math.min(
            QUICK_SVG_PANEL_HEIGHT,
            Math.max(220, rootBottom - rootTop - 24)
        );
        const preferredLeft = Number(quickSvgPickerState?.clientX || 0) + 8;
        const preferredTop = Number(quickSvgPickerState?.clientY || 0) + 8;
        const left = clamp(
            preferredLeft,
            rootLeft + 12,
            Math.max(rootLeft + 12, Math.min(rootRight - width - 12, viewportWidth - width - 12))
        );
        const top = clamp(
            preferredTop,
            rootTop + 12,
            Math.max(rootTop + 12, Math.min(rootBottom - maxHeight - 12, viewportHeight - maxHeight - 12))
        );
        return {
            position: "fixed",
            left,
            top,
            zIndex: 94,
            width,
            maxWidth: Math.max(220, viewportWidth - left - 12),
            maxHeight,
            overflow: "hidden",
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            borderRadius: 16,
            border: "1px solid rgba(51, 65, 85, 0.95)",
            background: "linear-gradient(180deg, rgba(2, 6, 23, 0.97) 0%, rgba(15, 23, 42, 0.95) 100%)",
            boxShadow: "0 18px 44px rgba(2, 6, 23, 0.34)"
        };
    }, [editorVisible, quickSvgPickerState, rootSize]);

    const quickTagPickerStyle = useMemo(() => {
        if (!editorVisible || !quickTagPickerHasTarget) {
            return null;
        }
        const rootRect = rootRef.current?.getBoundingClientRect?.();
        if (!rootRect) {
            return null;
        }

        const viewportWidth = typeof window !== "undefined" ? window.innerWidth : Number(rootRect.width || 0);
        const viewportHeight = typeof window !== "undefined" ? window.innerHeight : Number(rootRect.height || 0);
        const rootLeft = Number(rootRect.left || 0);
        const rootTop = Number(rootRect.top || 0);
        const rootRight = rootLeft + Number(rootRect.width || 0);
        const rootBottom = rootTop + Number(rootRect.height || 0);
        const width = Math.min(QUICK_TAG_PANEL_WIDTH, Math.max(280, rootRight - rootLeft - 24));
        const maxHeight = Math.min(
            QUICK_TAG_PANEL_HEIGHT,
            Math.max(112, rootBottom - rootTop - 24)
        );
        const preferredLeft = Number(quickTagPickerState?.clientX || 0) + 8;
        const preferredTop = Number(quickTagPickerState?.clientY || 0) + 8;
        const left = clamp(
            preferredLeft,
            rootLeft + 12,
            Math.max(rootLeft + 12, Math.min(rootRight - width - 12, viewportWidth - width - 12))
        );
        const top = clamp(
            preferredTop,
            rootTop + 12,
            Math.max(rootTop + 12, Math.min(rootBottom - maxHeight - 12, viewportHeight - maxHeight - 12))
        );

        return {
            position: "fixed",
            left,
            top,
            zIndex: 90,
            width,
            maxWidth: Math.max(220, viewportWidth - left - 12),
            minHeight: 100,
            maxHeight,
            overflow: "visible",
            display: "grid",
            gap: 10,
            padding: 12,
            borderRadius: 16,
            border: "1px solid rgba(51, 65, 85, 0.95)",
            background: "linear-gradient(180deg, rgba(2, 6, 23, 0.96) 0%, rgba(15, 23, 42, 0.94) 100%)",
            boxShadow: "0 18px 44px rgba(2, 6, 23, 0.34)"
        };
    }, [editorVisible, quickTagPickerHasTarget, quickTagPickerState, rootSize]);

    useEffect(() => {
        if (!quickSvgPickerState?.open) {
            return undefined;
        }
        const focusSearch = () => {
            quickSvgPickerInputRef.current?.focus?.();
            quickSvgPickerInputRef.current?.select?.();
        };
        const focusTimer = window.setTimeout(focusSearch, 0);
        const focusFrame = window.requestAnimationFrame(focusSearch);
        const handlePointerDown = (event) => {
            const target = event?.target;
            if (target?.closest?.("[data-vizi-quick-svg-picker='1']")) {
                return;
            }
            closeQuickSvgPicker();
        };
        const handleEscape = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeQuickSvgPicker();
            }
        };
        window.addEventListener("pointerdown", handlePointerDown, true);
        window.addEventListener("keydown", handleEscape, true);
        return () => {
            window.clearTimeout(focusTimer);
            window.cancelAnimationFrame(focusFrame);
            window.removeEventListener("pointerdown", handlePointerDown, true);
            window.removeEventListener("keydown", handleEscape, true);
        };
    }, [closeQuickSvgPicker, quickSvgPickerState?.open]);

    useEffect(() => {
        if (!quickTagPickerHasTarget) {
            return undefined;
        }
        const handlePointerDown = (event) => {
            const target = event?.target;
            const popupNode = quickTagPickerRef.current;
            if (popupNode?.contains?.(target) || target?.closest?.("[data-vizi-dropdown-menu='1']")) {
                return;
            }
            closeQuickTagPicker();
        };
        const handleEscape = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeQuickTagPicker();
            }
        };
        window.addEventListener("pointerdown", handlePointerDown, true);
        window.addEventListener("keydown", handleEscape, true);
        return () => {
            window.removeEventListener("pointerdown", handlePointerDown, true);
            window.removeEventListener("keydown", handleEscape, true);
        };
    }, [closeQuickTagPicker, quickTagPickerHasTarget]);

    const overlaySelectionUI = useCallback((overlay) => {
        const bounds = getOverlayBounds(overlay);
        if (!bounds) {
            return null;
        }

        const x = Number(bounds.x || 0);
        const y = Number(bounds.y || 0);
        const width = Math.max(1, Number(bounds.width || 0));
        const height = Math.max(1, Number(bounds.height || 0));
        const corners = [
            { key: "TL", cx: x, cy: y },
            { key: "T", cx: x + width / 2, cy: y },
            { key: "TR", cx: x + width, cy: y },
            { key: "R", cx: x + width, cy: y + height / 2 },
            { key: "BR", cx: x + width, cy: y + height },
            { key: "B", cx: x + width / 2, cy: y + height },
            { key: "BL", cx: x, cy: y + height },
            { key: "L", cx: x, cy: y + height / 2 }
        ];
        const minSide = Math.max(0, Math.min(Math.abs(width), Math.abs(height)));
        const handleHitRadius = minSide > 0
            ? Math.max(3, Math.min(12, minSide * 0.18))
            : 12;

        return (
            <g data-overlay-selection-ui={String(overlay?.id || "")}>
                <rect
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill="transparent"
                    pointerEvents="all"
                    style={{ cursor: "move" }}
                    onMouseDown={(event) => handleOverlayMouseDown(event, overlay?.id)}
                    onDoubleClick={(event) => handleOverlayDoubleClick(event, overlay?.id)}
                />
                <rect
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill="none"
                    stroke="#2b6cff"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    pointerEvents="none"
                />
                {corners.map((corner) => (
                    <g key={`${String(overlay?.id || "")}-${corner.key}`}>
                        <circle
                            cx={corner.cx}
                            cy={corner.cy}
                            r={6}
                            fill="white"
                            stroke="#2b6cff"
                            strokeWidth={2}
                            pointerEvents="none"
                        />
                        <circle
                            cx={corner.cx}
                            cy={corner.cy}
                            r={handleHitRadius}
                            fill="transparent"
                            style={{ cursor: resizeCursorForCorner(corner.key) }}
                            onMouseDown={(event) => handleOverlayHandleDown(event, overlay?.id, corner.key)}
                        />
                    </g>
                ))}
            </g>
        );
    }, [handleOverlayDoubleClick, handleOverlayHandleDown, handleOverlayMouseDown]);

    const overlayGroupSelectionUI = useCallback(() => {
        if (!selectedBBox || selectedIds.length > 0 || selectedOverlayIds.length < 2) {
            return null;
        }

        const x = Number(selectedBBox.x || 0);
        const y = Number(selectedBBox.y || 0);
        const width = Math.max(1, Number(selectedBBox.width || 0));
        const height = Math.max(1, Number(selectedBBox.height || 0));
        const corners = [
            { key: "TL", cx: x, cy: y },
            { key: "TR", cx: x + width, cy: y },
            { key: "BR", cx: x + width, cy: y + height },
            { key: "BL", cx: x, cy: y + height }
        ];

        return (
            <g data-overlay-group-selection-ui="1">
                <rect
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill="none"
                    stroke="#2b6cff"
                    strokeWidth={2}
                    strokeDasharray="8 5"
                    pointerEvents="none"
                />
                {corners.map((corner) => (
                    <g key={`overlay-group-${corner.key}`}>
                        <circle
                            cx={corner.cx}
                            cy={corner.cy}
                            r={6}
                            fill="white"
                            stroke="#2b6cff"
                            strokeWidth={2}
                        />
                        <circle
                            cx={corner.cx}
                            cy={corner.cy}
                            r={14}
                            fill="transparent"
                            style={{ cursor: resizeCursorForCorner(corner.key) }}
                            onMouseDown={(event) => handleOverlayGroupHandleDown(event, corner.key)}
                        />
                    </g>
                ))}
            </g>
        );
    }, [handleOverlayGroupHandleDown, selectedBBox, selectedIds.length, selectedOverlayIds.length]);

    const shapeSelectionUI = useCallback(() => {
        if (!selectedBBox || !selectedIds.length || selectedOverlayIds.length) {
            return null;
        }

        if (
            selectedIds.length === 1
            && selectedShape
            && Array.isArray(selectedShape?.points)
            && String(editingId || "") === String(selectedShape?.id || "")
        ) {
            return null;
        }

        const x = Number(selectedBBox.x || 0);
        const y = Number(selectedBBox.y || 0);
        const width = Math.max(1, Number(selectedBBox.width || 0));
        const height = Math.max(1, Number(selectedBBox.height || 0));
        const corners = [
            { key: "TL", cx: x, cy: y },
            { key: "TR", cx: x + width, cy: y },
            { key: "BR", cx: x + width, cy: y + height },
            { key: "BL", cx: x, cy: y + height }
        ];

        return (
            <g data-shape-selection-ui="1">
                <rect
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill="none"
                    stroke="#2b6cff"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    pointerEvents="none"
                />
                {corners.map((corner) => (
                    <g key={`shape-selection-${corner.key}`}>
                        <circle
                            cx={corner.cx}
                            cy={corner.cy}
                            r={6}
                            fill="white"
                            stroke="#2b6cff"
                            strokeWidth={2}
                        />
                        <circle
                            cx={corner.cx}
                            cy={corner.cy}
                            r={14}
                            fill="transparent"
                            style={{ cursor: resizeCursorForCorner(corner.key) }}
                            onMouseDown={(event) => handleShapeResizeHandleDown(event, corner.key)}
                        />
                    </g>
                ))}
            </g>
        );
    }, [editingId, handleShapeResizeHandleDown, selectedBBox, selectedIds.length, selectedOverlayIds.length, selectedShape]);

    const mixedSelectionUI = useCallback(() => {
        if (!selectedBBox || !selectedIds.length || !selectedOverlayIds.length) {
            return null;
        }

        return (
            <g data-mixed-selection-ui="1">
                <rect
                    x={Number(selectedBBox.x || 0)}
                    y={Number(selectedBBox.y || 0)}
                    width={Math.max(1, Number(selectedBBox.width || 0))}
                    height={Math.max(1, Number(selectedBBox.height || 0))}
                    fill="none"
                    stroke="#2b6cff"
                    strokeWidth={2}
                    strokeDasharray="10 6"
                    pointerEvents="none"
                />
            </g>
        );
    }, [selectedBBox, selectedIds.length, selectedOverlayIds.length]);

    const updateSelectedShape = useCallback((updater) => {
        if (!selectedShape) {
            return;
        }
        updateShapes((previous) => previous.map((shape) => (
            String(shape?.id || "") === String(selectedShape.id || "")
                ? updater(shape)
                : shape
        )), { persist: true });
    }, [selectedShape, updateShapes]);

    const updateSelectedOverlay = useCallback((updater) => {
        if (!selectedOverlay) {
            return;
        }
        updateSvgOverlays((previous) => previous.map((overlay) => (
            String(overlay?.id || "") === String(selectedOverlay.id || "")
                ? updater(overlay)
                : overlay
        )), { persist: true });
    }, [selectedOverlay, updateSvgOverlays]);

    const updateOverlayById = useCallback((overlayId, updater) => {
        const targetId = String(overlayId || "").trim();
        if (!targetId || typeof updater !== "function") {
            return;
        }
        updateSvgOverlays((previous) => previous.map((overlay) => (
            String(overlay?.id || "").trim() === targetId
                ? updater(overlay)
                : overlay
        )), { persist: true });
    }, [updateSvgOverlays]);

    const commitSelectedShapeText = useCallback((field, rawValue) => {
        updateSelectedShape((shape) => ({
            ...shape,
            [field]: String(rawValue ?? "")
        }));
    }, [updateSelectedShape]);

    const commitSelectedShapeNumber = useCallback((field, rawValue, options = {}) => {
        const next = parsePanelNumber(rawValue);
        if (next == null) {
            return;
        }
        const value = options.min != null ? Math.max(options.min, next) : next;
        updateSelectedShape((shape) => ({
            ...shape,
            [field]: value
        }));
    }, [updateSelectedShape]);

    const commitSelectedShapeOptionalNumber = useCallback((field, rawValue, options = {}) => {
        const trimmed = String(rawValue ?? "").trim();
        if (!trimmed) {
            updateSelectedShape((shape) => ({
                ...shape,
                [field]: ""
            }));
            return;
        }
        const next = parsePanelNumber(trimmed);
        if (next == null) {
            return;
        }
        const value = options.min != null ? Math.max(options.min, next) : next;
        updateSelectedShape((shape) => ({
            ...shape,
            [field]: value
        }));
    }, [updateSelectedShape]);

    const commitSelectedShapePosition = useCallback((axis, rawValue) => {
        const next = parsePanelNumber(rawValue);
        if (next == null) {
            return;
        }
        updateSelectedShape((shape) => {
            if (Array.isArray(shape?.points)) {
                const bounds = getShapeBounds(shape);
                if (!bounds) {
                    return shape;
                }
                const dx = axis === "x" ? next - Number(bounds.x || 0) : 0;
                const dy = axis === "y" ? next - Number(bounds.y || 0) : 0;
                return {
                    ...shape,
                    points: clonePoints(shape.points).map((point) => ({
                        x: Number(point.x || 0) + dx,
                        y: Number(point.y || 0) + dy
                    }))
                };
            }
            return {
                ...shape,
                [axis]: next
            };
        });
    }, [updateSelectedShape]);

    const commitSelectedShapeBoundsDimension = useCallback((axis, rawValue) => {
        const next = parsePanelNumber(rawValue);
        if (next == null) {
            return;
        }
        updateSelectedShape((shape) => {
            if (!Array.isArray(shape?.points)) {
                return shape;
            }
            const startBounds = getShapeBounds(shape);
            if (!startBounds) {
                return shape;
            }
            const snapshot = buildShapeResizeSnapshot(shape);
            if (!snapshot) {
                return shape;
            }
            const nextBounds = {
                ...startBounds,
                [axis]: Math.max(1, next)
            };
            return applyShapeResizeSnapshot(shape, snapshot, startBounds, nextBounds);
        });
    }, [updateSelectedShape]);

    const commitSelectedOverlayText = useCallback((field, rawValue) => {
        updateSelectedOverlay((overlay) => ({
            ...overlay,
            [field]: String(rawValue ?? "")
        }));
    }, [updateSelectedOverlay]);

    const commitSelectedOverlayWidgetField = useCallback((field, rawValue) => {
        updateSelectedOverlay((overlay) => ({
            ...overlay,
            widget: {
                ...(isPlainObject(overlay?.widget) ? overlay.widget : {}),
                [field]: rawValue
            }
        }));
    }, [updateSelectedOverlay]);

    const commitSelectedOverlayEmbeddedViewField = useCallback((field, rawValue) => {
        updateSelectedOverlay((overlay) => ({
            ...overlay,
            embeddedView: {
                ...(isPlainObject(overlay?.embeddedView) ? overlay.embeddedView : {}),
                [field]: rawValue
            }
        }));
    }, [updateSelectedOverlay]);

    const commitSelectedOverlayTagPath = useCallback((rawValue) => {
        updateSelectedOverlay((overlay) => {
            if (overlay?.widget) {
                const nextTagPath = String(rawValue ?? "").trim();
                const currentBindings = isPlainObject(overlay?.bindings) ? overlay.bindings : {};
                const { fill: _removedFillBinding, ...restBindings } = currentBindings;
                return withOverlayBindings(
                    {
                        ...overlay,
                        tagPath: nextTagPath
                    },
                    restBindings
                );
            }
            return applyOverlayIgnitionFillBinding(
                applyIgnitionTagMetadataToOverlay(overlay, rawValue),
                rawValue
            );
        });
    }, [applyIgnitionTagMetadataToOverlay, updateSelectedOverlay]);

    const commitOverlayTagPathById = useCallback((overlayId, rawValue) => {
        updateOverlayById(overlayId, (overlay) => {
            if (overlay?.widget) {
                const nextTagPath = String(rawValue ?? "").trim();
                const currentBindings = isPlainObject(overlay?.bindings) ? overlay.bindings : {};
                const { fill: _removedFillBinding, ...restBindings } = currentBindings;
                return withOverlayBindings(
                    {
                        ...overlay,
                        tagPath: nextTagPath
                    },
                    restBindings
                );
            }
            return applyOverlayIgnitionFillBinding(
                applyIgnitionTagMetadataToOverlay(overlay, rawValue),
                rawValue
            );
        });
    }, [applyIgnitionTagMetadataToOverlay, updateOverlayById]);

    const commitSelectedOverlayGroupTagPath = useCallback((rawValue) => {
        const editableIds = new Set(
            editableSelectedOverlayGroup
                .map((overlay) => String(overlay?.id || "").trim())
                .filter(Boolean)
        );
        if (!editableIds.size) {
            return;
        }

        updateSvgOverlays((previous) => previous.map((overlay) => {
            const overlayId = String(overlay?.id || "").trim();
            if (!editableIds.has(overlayId)) {
                return overlay;
            }

            if (overlay?.widget) {
                const nextTagPath = String(rawValue ?? "").trim();
                const currentBindings = isPlainObject(overlay?.bindings) ? overlay.bindings : {};
                const { fill: _removedFillBinding, ...restBindings } = currentBindings;
                return withOverlayBindings(
                    {
                        ...overlay,
                        tagPath: nextTagPath
                    },
                    restBindings
                );
            }

            return applyOverlayIgnitionFillBinding(
                applyIgnitionTagMetadataToOverlay(overlay, rawValue),
                rawValue
            );
        }), { persist: true });
    }, [applyIgnitionTagMetadataToOverlay, editableSelectedOverlayGroup, updateSvgOverlays]);

    const commitQuickTagPickerGroupTagPath = useCallback((rawValue) => {
        const editableIds = new Set(
            editableQuickTagPickerTargetOverlays
                .map((overlay) => String(overlay?.id || "").trim())
                .filter(Boolean)
        );
        if (!editableIds.size) {
            return;
        }

        updateSvgOverlays((previous) => previous.map((overlay) => {
            const overlayId = String(overlay?.id || "").trim();
            if (!editableIds.has(overlayId)) {
                return overlay;
            }

            if (overlay?.widget) {
                const nextTagPath = String(rawValue ?? "").trim();
                const currentBindings = isPlainObject(overlay?.bindings) ? overlay.bindings : {};
                const { fill: _removedFillBinding, ...restBindings } = currentBindings;
                return withOverlayBindings(
                    {
                        ...overlay,
                        tagPath: nextTagPath
                    },
                    restBindings
                );
            }

            return applyOverlayIgnitionFillBinding(
                applyIgnitionTagMetadataToOverlay(overlay, rawValue),
                rawValue
            );
        }), { persist: true });
    }, [applyIgnitionTagMetadataToOverlay, editableQuickTagPickerTargetOverlays, updateSvgOverlays]);

    const commitSelectedOverlayFill = useCallback((rawValue) => {
        updateSelectedOverlay((overlay) => applyOverlayFillFallbackColor(overlay, rawValue));
    }, [updateSelectedOverlay]);

    const commitSelectedOverlayNumber = useCallback((field, rawValue, options = {}) => {
        const next = parsePanelNumber(rawValue);
        if (next == null) {
            return;
        }
        const value = options.min != null ? Math.max(options.min, next) : next;
        updateSelectedOverlay((overlay) => {
            if (field === "scale") {
                const bbox = overlay?.bbox;
                const currentBounds = getOverlayBounds(overlay);
                if (bbox && currentBounds) {
                    return {
                        ...overlay,
                        scale: value,
                        scaleX: value,
                        scaleY: value,
                        tx: Number(currentBounds.x || 0) - value * Number(bbox.x || 0),
                        ty: Number(currentBounds.y || 0) - value * Number(bbox.y || 0)
                    };
                }
            }
            if (field === "scaleX" || field === "scaleY") {
                const bbox = overlay?.bbox;
                const currentBounds = getOverlayBounds(overlay);
                if (bbox && currentBounds) {
                    const nextScaleX = field === "scaleX" ? value : overlayScaleX(overlay);
                    const nextScaleY = field === "scaleY" ? value : overlayScaleY(overlay);
                    return {
                        ...overlay,
                        scale: nextScaleX,
                        scaleX: nextScaleX,
                        scaleY: nextScaleY,
                        tx: Number(currentBounds.x || 0) - nextScaleX * Number(bbox.x || 0),
                        ty: Number(currentBounds.y || 0) - nextScaleY * Number(bbox.y || 0)
                    };
                }
            }
            const nextOverlay = {
                ...overlay,
                [field]: value
            };
            if (field === "strokeWidth" && !overlay?.widget && !overlay?.embeddedView) {
                nextOverlay.inner = updateSvgInnerStrokeWidth(overlay?.inner, value);
            }
            return nextOverlay;
        });
    }, [updateSelectedOverlay]);

    const toggleSelectedOverlayFlip = useCallback((axis) => {
        const isY = String(axis || "").trim().toLowerCase() === "y";
        const field = isY ? "flipY" : "flipX";
        updateSelectedOverlay((overlay) => ({
            ...overlay,
            [field]: !Boolean(
                overlay?.[field]
                || (isY ? overlay?.flippedY || overlay?.mirrorY : overlay?.flippedX || overlay?.mirrorX)
            )
        }));
    }, [updateSelectedOverlay]);

    const toggleSelectedOverlayStatic = useCallback(() => {
        updateSelectedOverlay((overlay) => ({
            ...overlay,
            static: !isStaticSvgOverlay(overlay)
        }));
    }, [updateSelectedOverlay]);

    const commitSelectedOverlayPosition = useCallback((axis, rawValue) => {
        const next = parsePanelNumber(rawValue);
        if (next == null) {
            return;
        }
        updateSelectedOverlay((overlay) => {
            const bbox = overlay?.bbox;
            if (!bbox || typeof bbox !== "object") {
                return overlay;
            }
            const scaleX = overlayScaleX(overlay);
            const scaleY = overlayScaleY(overlay);
            return axis === "x"
                ? { ...overlay, tx: next - scaleX * Number(bbox.x || 0) }
                : { ...overlay, ty: next - scaleY * Number(bbox.y || 0) };
        });
    }, [updateSelectedOverlay]);

    const commitSelectedOverlayDimension = useCallback((axis, rawValue) => {
        const next = parsePanelNumber(rawValue);
        if (next == null) {
            return;
        }
        updateSelectedOverlay((overlay) => {
            const bbox = overlay?.bbox;
            if (!bbox || typeof bbox !== "object") {
                return overlay;
            }
            const baseSize = Math.max(1, Number(axis === "width" ? bbox.width : bbox.height) || 0);
            const nextScale = Math.max(0.05, next / baseSize);
            const currentBounds = getOverlayBounds(overlay);
            if (!currentBounds) {
                return overlay;
            }
            const currentScaleX = overlayScaleX(overlay);
            const currentScaleY = overlayScaleY(overlay);
            const nextScaleX = axis === "width" ? nextScale : currentScaleX;
            const nextScaleY = axis === "height" ? nextScale : currentScaleY;
            return {
                ...overlay,
                scale: nextScaleX,
                scaleX: nextScaleX,
                scaleY: nextScaleY,
                tx: Number(currentBounds.x || 0) - nextScaleX * Number(bbox.x || 0),
                ty: Number(currentBounds.y || 0) - nextScaleY * Number(bbox.y || 0)
            };
        });
    }, [updateSelectedOverlay]);

    const writeIgnitionTagValue = useCallback(async (tagPath, value) => {
        const nextTagPath = String(tagPath || "").trim();
        if (!nextTagPath) {
            throw new Error("Ignition tag path is required.");
        }

        const encodedPath = encodeURIComponent(nextTagPath);
        const encodedValue = encodeURIComponent(String(value ?? ""));
        let lastError = "Ignition write failed.";

        for (const routePath of MODULE_TAG_WRITE_ROUTE_CANDIDATES) {
            try {
                const response = await fetch(`${routePath}?path=${encodedPath}&value=${encodedValue}`, {
                    cache: "no-store",
                    credentials: "same-origin"
                });
                if (!response.ok) {
                    lastError = `Ignition write failed (${response.status}).`;
                    continue;
                }
                const payload = await response.json();
                const error = String(payload?.error || "").trim();
                if (error) {
                    lastError = error;
                    continue;
                }

                setIgnitionTagValuesByPath((previous) => {
                    const next = previous instanceof Map ? new Map(previous) : new Map();
                    next.set(nextTagPath, payload?.value ?? value);
                    next.set(nextTagPath.toLowerCase(), payload?.value ?? value);
                    return next;
                });
                return payload || { value };
            } catch (error) {
                lastError = String(error?.message || "Ignition write failed.");
            }
        }

        throw new Error(lastError);
    }, []);

    const writeIgnitionOpcValue = useCallback(async (opcItemPath, value, opcServerName) => {
        const nextOpcItemPath = String(opcItemPath || "").trim();
        if (!nextOpcItemPath) {
            throw new Error("OPC item path is required.");
        }

        const nextOpcServerName = String(opcServerName || "").trim();
        const encodedPath = encodeURIComponent(nextOpcItemPath);
        const encodedValue = encodeURIComponent(String(value ?? ""));
        const encodedServer = encodeURIComponent(nextOpcServerName);
        let lastError = "OPC write failed.";

        for (const routePath of MODULE_OPC_WRITE_ROUTE_CANDIDATES) {
            try {
                const response = await fetch(
                    `${routePath}?server=${encodedServer}&path=${encodedPath}&value=${encodedValue}`,
                    {
                        cache: "no-store",
                        credentials: "same-origin"
                    }
                );
                if (!response.ok) {
                    lastError = `OPC write failed (${response.status}).`;
                    continue;
                }
                const payload = await response.json();
                const error = String(payload?.error || "").trim();
                if (error) {
                    lastError = error;
                    continue;
                }
                return payload || { value };
            } catch (error) {
                lastError = String(error?.message || "OPC write failed.");
            }
        }

        throw new Error(lastError);
    }, []);

    const selectedShapeLabel = selectedShape
        ? (() => {
            const rawType = String(selectedShape?.type || "").toLowerCase();
            if (rawType === "polyline") {
                return "Line";
            }
            if (rawType === "rect") {
                return "Rectangle";
            }
            if (rawType === "circle") {
                return "Circle";
            }
            if (rawType === "text") {
                return "Text";
            }
            return "Shape";
        })()
        : "";

    const svgLibraryReady = svgCatalogFiles.length > 0;
    const normalizableSvgCount = useMemo(
        () => coerceArray(svgOverlays).filter((overlay) => overlay && !overlay.widget && !overlay.embeddedView).length,
        [svgOverlays]
    );
    const svgLibraryStatusText = !svgLibraryEnabled
        ? "SVG library disabled"
        : svgLibraryError
            ? svgLibraryError
            : svgLibraryUploading
                ? "Importing SVG..."
                : svgLibraryRefreshing
                    ? "Refreshing SVG templates..."
            : svgLibraryReady
                ? `${svgCatalogFiles.length} SVG templates ready`
                : "Loading SVG templates...";
    const widgetLibraryStatusText = "Mesora widgets ready";
    const hmiStateStyleMapCount = Array.isArray(hmiStateStyleMapIndex?.entries)
        ? hmiStateStyleMapIndex.entries.length
        : 0;
    const hmiStateStyleMapStatusText = hmiStateStyleMapError
        ? hmiStateStyleMapError
        : hmiStateStyleMapRefreshing
            ? "Loading HMI state styles..."
            : hmiStateStyleMapCount > 0
                ? `${hmiStateStyleMapCount} HMI state style maps loaded`
                : "No HMI state style maps loaded";

    const toolbarPanelLayout = useMemo(() => {
        const width = toolbarCollapsed ? COLLAPSED_TOOLBAR_WIDTH : TOOLBAR_WIDTH;
        const panelHeight = toolbarPanelRef.current?.getBoundingClientRect?.().height || 160;
        return clampToolbarPosition(
            toolbarPosition,
            width,
            panelHeight,
            browserViewportWidth,
            browserViewportHeight
        );
    }, [browserViewportHeight, browserViewportWidth, toolbarCollapsed, toolbarPosition]);

    const svgDrawerLayout = useMemo(() => {
        const viewportWidth = Number(browserViewportWidth || rootSize?.width || DEFAULT_CANVAS_WIDTH);
        const viewportHeight = Number(browserViewportHeight || rootSize?.height || DEFAULT_CANVAS_HEIGHT);
        const maxPanelWidth = Math.max(0, viewportWidth - (TOOLBAR_INSET * 2));
        const activeToolbarWidth = toolbarCollapsed ? COLLAPSED_TOOLBAR_WIDTH : TOOLBAR_WIDTH;
        const toolbarLeft = Number(toolbarPanelLayout?.x) || TOOLBAR_INSET;
        const toolbarTop = Number(toolbarPanelLayout?.y) || TOOLBAR_INSET;
        const panelTop = clamp(toolbarTop, TOOLBAR_INSET, Math.max(TOOLBAR_INSET, viewportHeight - 280));
        const preferredLeft = toolbarLeft + activeToolbarWidth + TOOLBAR_DRAWER_GAP;
        const availableRight = Math.max(0, viewportWidth - preferredLeft - TOOLBAR_INSET);
        const availableLeft = Math.max(0, toolbarLeft - TOOLBAR_DRAWER_GAP - TOOLBAR_INSET);

        if (availableRight >= SVG_DRAWER_MIN_WIDTH) {
            return {
                left: preferredLeft,
                top: panelTop,
                bottom: TOOLBAR_INSET,
                width: Math.min(SVG_DRAWER_PREFERRED_WIDTH, availableRight)
            };
        }

        if (availableLeft >= SVG_DRAWER_MIN_WIDTH) {
            const width = Math.min(SVG_DRAWER_PREFERRED_WIDTH, availableLeft);
            return {
                left: Math.max(TOOLBAR_INSET, toolbarLeft - width - TOOLBAR_DRAWER_GAP),
                top: panelTop,
                bottom: TOOLBAR_INSET,
                width
            };
        }

        return {
            left: TOOLBAR_INSET,
            top: TOOLBAR_INSET,
            bottom: TOOLBAR_INSET,
            width: Math.max(260, Math.min(SVG_DRAWER_PREFERRED_WIDTH, maxPanelWidth))
        };
    }, [browserViewportHeight, browserViewportWidth, rootSize, toolbarCollapsed, toolbarPanelLayout]);
    const widgetDrawerLayout = svgDrawerLayout;
    const helpDrawerLayout = useMemo(() => {
        const viewportWidth = Number(browserViewportWidth || rootSize?.width || DEFAULT_CANVAS_WIDTH);
        const viewportHeight = Number(browserViewportHeight || rootSize?.height || DEFAULT_CANVAS_HEIGHT);
        const maxPanelWidth = Math.max(0, viewportWidth - (TOOLBAR_INSET * 2));
        const activeToolbarWidth = toolbarCollapsed ? COLLAPSED_TOOLBAR_WIDTH : TOOLBAR_WIDTH;
        const toolbarLeft = Number(toolbarPanelLayout?.x) || TOOLBAR_INSET;
        const toolbarTop = Number(toolbarPanelLayout?.y) || TOOLBAR_INSET;
        const panelTop = clamp(toolbarTop, TOOLBAR_INSET, Math.max(TOOLBAR_INSET, viewportHeight - 280));
        const preferredLeft = toolbarLeft + activeToolbarWidth + TOOLBAR_DRAWER_GAP;
        const availableRight = Math.max(0, viewportWidth - preferredLeft - TOOLBAR_INSET);
        const availableLeft = Math.max(0, toolbarLeft - TOOLBAR_DRAWER_GAP - TOOLBAR_INSET);

        if (availableRight >= HELP_DRAWER_MIN_WIDTH) {
            return {
                left: preferredLeft,
                top: panelTop,
                bottom: TOOLBAR_INSET,
                width: Math.min(HELP_DRAWER_PREFERRED_WIDTH, availableRight)
            };
        }

        if (availableLeft >= HELP_DRAWER_MIN_WIDTH) {
            const width = Math.min(HELP_DRAWER_PREFERRED_WIDTH, availableLeft);
            return {
                left: Math.max(TOOLBAR_INSET, toolbarLeft - width - TOOLBAR_DRAWER_GAP),
                top: panelTop,
                bottom: TOOLBAR_INSET,
                width
            };
        }

        return {
            left: TOOLBAR_INSET,
            top: TOOLBAR_INSET,
            bottom: TOOLBAR_INSET,
            width: Math.max(280, Math.min(HELP_DRAWER_PREFERRED_WIDTH, maxPanelWidth))
        };
    }, [browserViewportHeight, browserViewportWidth, rootSize, toolbarCollapsed, toolbarPanelLayout]);
    useEffect(() => {
        const onKeyDown = (event) => {
            if (!editorVisible) {
                return;
            }
            if (isInteractiveEditorTarget(event.target)) {
                return;
            }
            if (event.altKey || event.ctrlKey || event.metaKey) {
                return;
            }
            if (!event.shiftKey || event.key !== "Delete") {
                return;
            }

            const activeSegment =
                selectedSegment
                && selectedSegment.kind === "point"
                && String(selectedSegment.id || "")
                && String(editingId || "") === String(selectedSegment.id || "")
                && selectedIds.includes(String(selectedSegment.id || ""));
            const hasActiveSelection =
                (Array.isArray(selectedIds) && selectedIds.length > 0)
                || (Array.isArray(selectedOverlayIds) && selectedOverlayIds.length > 0);
            if (!activeSegment && !hasActiveSelection) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            if (activeSegment && deletePolylineVertex(selectedSegment.id, selectedSegment.index)) {
                return;
            }
            deleteSelected();
        };

        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [deletePolylineVertex, deleteSelected, editingId, editorVisible, selectedIds, selectedOverlayIds, selectedSegment]);

    useEffect(() => {
        const onWheelNonPassive = (event) => {
            if (!editorVisible && !browserRuntimeMode) return;
            if (!rootRef.current) return;
            if (!rootRef.current.contains(event.target)) return;
            if (!event.altKey) return;
            event.preventDefault();
            event.stopPropagation();
            stepCanvasZoom(event.deltaY < 0 ? 1 : -1);
        };
        window.addEventListener("wheel", onWheelNonPassive, { passive: false, capture: true });
        return () => window.removeEventListener("wheel", onWheelNonPassive, { passive: false, capture: true });
    }, [browserRuntimeMode, editorVisible, stepCanvasZoom]);

    useEffect(() => {
        const onKeyDown = (event) => {
            if (!editorVisible) {
                return;
            }
            if (isInteractiveEditorTarget(event.target)) {
                return;
            }

            const key = String(event.key || "").toLowerCase();
            const alternate = event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
            const consumeShortcutEvent = () => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
            };

            if (!event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "PageUp" || event.key === "PageDown")) {
                const hasOverlaySelection = coerceArray(selectedOverlayIds).length > 0;
                if (!hasOverlaySelection) {
                    return;
                }
                consumeShortcutEvent();
                if (event.key === "PageUp") {
                    reorderSelectedOverlays(event.shiftKey ? "front" : "forward");
                } else {
                    reorderSelectedOverlays(event.shiftKey ? "back" : "backward");
                }
                return;
            }

            if (alternate) {
                if (key === "m") {
                    consumeShortcutEvent();
                    activateTool("select");
                    return;
                }
                if (key === "p") {
                    consumeShortcutEvent();
                    activateTool("polyline");
                    return;
                }
                if (key === "t") {
                    consumeShortcutEvent();
                    activateTool("text");
                    return;
                }
                if (key === "c") {
                    consumeShortcutEvent();
                    copySelection();
                    return;
                }
                if (key === "x") {
                    consumeShortcutEvent();
                    cutSelection();
                    return;
                }
                if (key === "v") {
                    consumeShortcutEvent();
                    pasteClipboard();
                    return;
                }
                if (key === "z") {
                    consumeShortcutEvent();
                    undo();
                    return;
                }
                if (key === "y") {
                    consumeShortcutEvent();
                    redo();
                    return;
                }
                if (key === "d" || String(event.code || "") === "KeyD") {
                    consumeShortcutEvent();
                    duplicateSelected();
                    return;
                }
                return;
            }

            if (event.altKey) {
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                if (drawing?.kind === "polyline") {
                    cancelPolyline();
                    return;
                }
                if (importAnchor) {
                    setImportAnchor(null);
                    return;
                }
                setEditingId(null);
                setSelectedSegment(null);
                return;
            }

            if (event.key === "Enter" && drawing?.kind === "polyline") {
                event.preventDefault();
                finishPolyline();
            }
        };

        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [activateTool, cancelPolyline, copySelection, cutSelection, deleteSelected, drawing, duplicateSelected, editorVisible, finishPolyline, importAnchor, pasteClipboard, redo, reorderSelectedOverlays, selectedOverlayIds, undo]);

    useEffect(() => {
        const onKeyUp = (event) => {
            if (!editorVisible || isInteractiveEditorTarget(event.target)) {
                return;
            }
            const key = String(event.key || "").toLowerCase();
            const alternate = event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
            if (!alternate) {
                return;
            }
            if (
                key === "c"
                || key === "x"
                || key === "v"
                || key === "z"
                || key === "y"
                || key === "d"
                || key === "m"
                || key === "p"
                || key === "t"
                || String(event.code || "") === "KeyD"
            ) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
            }
        };

        window.addEventListener("keyup", onKeyUp, true);
        return () => window.removeEventListener("keyup", onKeyUp, true);
    }, [editorVisible]);

    useEffect(() => {
        if (editorVisible) {
            return;
        }
        setImportOpen(false);
        closeQuickSvgPicker();
        setDragState(null);
        setDragSegment(null);
        setDragHandle(null);
        setShapeResize(null);
        setOverlayResize(null);
        setMarquee(null);
        setSelectedSegment(null);
        setEditingId(null);
        setDrawing(null);
        setHelpOpen(false);
        setImportAnchor(null);
        clearSelection();
    }, [clearSelection, closeQuickSvgPicker, editorVisible]);

    return (
        <div
            ref={rootRef}
            data-vizi-canvas-root="1"
            onMouseDownCapture={(event) => {
                if (!editorVisible || !propertiesSelectionKey || Number(event?.button || 0) !== 0) {
                    return;
                }
                if (isInteractiveEditorTarget(event?.target)) {
                    return;
                }
                const target = event?.target;
                if (
                    target instanceof Element
                    && target.closest(
                        [
                            "[data-overlay-id]",
                            "[data-shape-id]",
                            "[data-overlay-selection-ui]",
                            "[data-overlay-selection-move-hit]",
                            "[data-overlay-selection-hit]",
                            "[data-shape-selection-ui]",
                            "[data-shape-selection-hit]",
                            "[data-mixed-selection-ui]"
                        ].join(", ")
                    )
                ) {
                    return;
                }
                closePropertiesPanel();
            }}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                minWidth: 0,
                minHeight: 0,
                ...(browserRuntimeMode ? {
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "flex-start",
                    overflowX: "auto",
                    overflowY: "hidden"
                } : {})
            }}
        >
            <div style={browserRuntimeMode ? {
                width: Math.max(1, Number(viewBox.width) || 1) * runtimeCanvasZoom,
                height: Math.max(1, Number(viewBox.height) || 1) * runtimeCanvasZoom,
                flexShrink: 0,
                position: "relative",
                transformOrigin: "top left"
            } : {
                position: "absolute",
                inset: 0
            }}>
            <CanvasSvg
                svgRef={svgRef}
                zoom={editorZoom}
                pan={editorPan}
                onWheel={NOOP}
                marquee={editorVisible ? marquee : null}
                tool={editorVisible ? tool : "select"}
                shapes={shapes}
                setShapes={(updater) => updateShapes(updater, { persist: true })}
                selectedIds={editorVisible ? selectedIds : EMPTY_ARRAY}
                setSelectedIds={editorVisible ? setSelectedIds : NOOP}
                setSelectedOverlayIds={editorVisible ? setSelectedOverlayIds : NOOP}
                inlineEditId={null}
                selectedSegment={editorVisible ? selectedSegment : null}
                editingId={editorVisible ? editingId : null}
                showTagPaths={editorVisible && showTagPaths}
                showGrid={editorVisible && showGrid}
                showRulers={editorVisible && showRulers}
                useWindowPointerTracking={useWindowPointerTracking}
                onSvgMouseDown={editorVisible ? handleSvgMouseDown : NOOP}
                onMouseMove={editorVisible ? handleMouseMove : NOOP}
                onMouseUp={editorVisible ? handleMouseUp : NOOP}
                onContextMenu={editorVisible ? handleCanvasContextMenu : NOOP}
                onShapeMouseDown={editorVisible ? handleShapeMouseDown : NOOP}
                onShapeDoubleClick={editorVisible ? handleShapeDoubleClick : NOOP}
                onEditPolylineClick={editorVisible ? handleEditPolylineClick : NOOP}
                onHandleMouseDown={editorVisible ? handlePolylineHandleMouseDown : NOOP}
                onHandleDoubleClick={editorVisible ? handlePolylineHandleDoubleClick : NOOP}
                onHandleContextMenu={NOOP}
                onSegmentMouseDown={editorVisible ? handleSegmentMouseDown : NOOP}
                onOverlayContextMenu={editorVisible ? handleOverlayContextMenu : NOOP}
                vbW={viewBox.width}
                vbH={viewBox.height}
                svgOverlays={canvasSvgOverlays}
                setSvgOverlays={(updater) => updateSvgOverlays(updater, { persist: true })}
                selectedOverlayIds={editorVisible ? selectedOverlayIds : EMPTY_ARRAY}
                singleSelectedOverlayId={editorVisible && selectedOverlayIds.length === 1 ? selectedOverlayIds[0] : null}
                setOverlayRef={NOOP}
                onOverlayMouseDown={editorVisible ? handleOverlayMouseDown : handleLiveOverlayMouseDown}
                onOverlayDoubleClick={editorVisible ? handleOverlayDoubleClick : NOOP}
                overlaySelectionUI={editorVisible ? overlaySelectionUI : null}
                overlayGroupSelectionUI={editorVisible ? overlayGroupSelectionUI : null}
                shapeSelectionUI={editorVisible ? shapeSelectionUI : null}
                mixedSelectionUI={editorVisible ? mixedSelectionUI : null}
                overlayLocalBBox={overlayLocalBBox}
                importAnchor={editorVisible ? importAnchor : null}
                onCanvasDoubleClick={editorVisible ? handleCanvasDoubleClick : NOOP}
                tagStateColorsByPath={overlayTagStateColorsByPath}
                routeColorsBySvgKey={overlayRouteColorsBySvgKey}
                routeStrokeColorByGroupPath={EMPTY_MAP}
                svgLiveValuesByGroupPath={EMPTY_MAP}
                ignitionTagValuesByPath={ignitionTagValuesByPath}
                writeIgnitionTagValue={writeIgnitionTagValue}
                writeIgnitionOpcValue={writeIgnitionOpcValue}
                liveTagKeys={coerceArray(getModelValue(props, "liveTagKeys", EMPTY_ARRAY))}
                opcTags={coerceArray(getModelValue(props, "opcTags", EMPTY_ARRAY))}
                opcTemplateMap={EMPTY_MAP}
                opcTagMappingMap={EMPTY_MAP}
                opcMappingSetMap={EMPTY_MAP}
                widgetDbValues={EMPTY_MAP}
                binProductLabelByOverlayId={binProductLabelByOverlayId}
                binNameLabelByOverlayId={binNameLabelByOverlayId}
                binLevelRatioByOverlayId={binLevelRatioByOverlayId}
                binLockedInByOverlayId={binLockedInByOverlayId}
                binLockedOutByOverlayId={binLockedOutByOverlayId}
                overlayHmiStateColorByOverlayId={overlayHmiStateColorByOverlayId}
                overlayConnectionIssueByOverlayId={overlayConnectionIssueByOverlayId}
                onWidgetDurationPresetChange={NOOP}
                onTrendTagDrop={NOOP}
                hiddenTagBubbleIds={hiddenTagBubbleIds}
                onHideTagBubble={handleHideTagBubble}
                onSvgDoubleClick={editorVisible ? handleSvgDoubleClick : NOOP}
                collaboratorCursors={EMPTY_ARRAY}
                liveUpdatesEnabled={liveUpdatesEnabled}
                interactionActive={editorVisible && (
                    Boolean(drawing)
                    || Boolean(dragState)
                    || Boolean(dragSegment)
                    || Boolean(dragHandle)
                    || Boolean(shapeResize)
                    || Boolean(overlayResize)
                    || Boolean(marquee)
                )}
                theme={theme}
                canvasBackgroundColor={canvasBackgroundColor}
                liveClickable={liveClickable}
                isLiveMode={isLiveMode}
                perspectiveClientStore={perspectiveClientStore}
                preserveAspectRatioMode="xMinYMin meet"
                forceStaticVisuals={false}
                viewportTopOffset={0}
                viewportLeftOffset={0}
                viewportScrollTarget={null}
                onViewportScroll={NOOP}
            />
            </div>

            {editorVisible ? (
                toolbarCollapsed ? (
                    <div
                        ref={toolbarPanelRef}
                        style={{
                            position: "fixed",
                            top: toolbarPanelLayout.y,
                            left: toolbarPanelLayout.x,
                            zIndex: 120,
                            width: COLLAPSED_TOOLBAR_WIDTH,
                            maxWidth: `min(${COLLAPSED_TOOLBAR_WIDTH}px, calc(100vw - ${TOOLBAR_INSET * 2}px))`,
                            display: "grid",
                            gap: 8,
                            padding: 10,
                            borderRadius: 18,
                            border: "1px solid rgba(51, 65, 85, 0.95)",
                            background: "linear-gradient(180deg, rgba(2, 6, 23, 0.95) 0%, rgba(15, 23, 42, 0.92) 100%)",
                            boxShadow: "0 24px 60px rgba(2, 6, 23, 0.34)",
                            userSelect: "none"
                        }}
                    >
                        <div
                            onPointerDown={startToolbarDrag}
                            title="Drag toolbar"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 6,
                                cursor: "move",
                                touchAction: "none"
                            }}
                        >
                            <span
                                style={{
                                    minWidth: 0,
                                    fontSize: 10,
                                    fontWeight: 800,
                                    letterSpacing: "0.08em",
                                    textTransform: "uppercase",
                                    color: "rgba(226, 232, 240, 0.72)",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap"
                                }}
                            >
                                Tools
                            </span>
                            <button
                                type="button"
                                title="Dock toolbar"
                                onPointerDown={stopInteractivePropagation}
                                onMouseDown={stopInteractivePropagation}
                                onClick={redockToolbar}
                                style={{
                                    border: "1px solid rgba(71, 85, 105, 0.9)",
                                    background: "rgba(15, 23, 42, 0.88)",
                                    color: "#f8fafc",
                                    minWidth: 42,
                                    height: 24,
                                    padding: "0 8px",
                                    borderRadius: 999,
                                    fontSize: 10,
                                    fontWeight: 800,
                                    cursor: "pointer"
                                }}
                            >
                                Dock
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => setToolbarCollapsed(false)}
                            style={{
                                width: "100%",
                                minHeight: 38,
                                borderRadius: 12,
                                border: "1px solid rgba(71, 85, 105, 0.9)",
                                background: "rgba(15, 23, 42, 0.9)",
                                color: "#f8fafc",
                                cursor: "pointer",
                                fontSize: 12,
                                fontWeight: 800,
                                letterSpacing: "0.04em"
                            }}
                        >
                            Show Tools
                        </button>
                    </div>
                ) : (
                    <div
                        ref={toolbarPanelRef}
                        style={{
                            position: "fixed",
                            top: toolbarPanelLayout.y,
                            left: toolbarPanelLayout.x,
                            zIndex: 120,
                            width: TOOLBAR_WIDTH,
                            maxWidth: `min(${TOOLBAR_WIDTH}px, calc(100vw - ${TOOLBAR_INSET * 2}px))`,
                            overflowY: "visible",
                            display: "grid",
                            gap: 10,
                            padding: 12,
                            borderRadius: 18,
                            border: "1px solid rgba(51, 65, 85, 0.95)",
                            background: "linear-gradient(180deg, rgba(2, 6, 23, 0.95) 0%, rgba(15, 23, 42, 0.92) 100%)",
                            boxShadow: "0 24px 60px rgba(2, 6, 23, 0.34)",
                            userSelect: "none"
                        }}
                    >
                        <div
                            onPointerDown={startToolbarDrag}
                            title="Drag toolbar"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 12,
                                cursor: "move",
                                touchAction: "none"
                            }}
                        >
                            <div
                                style={{
                                    fontSize: 11,
                                    fontWeight: 800,
                                    letterSpacing: "0.12em",
                                    textTransform: "uppercase",
                                    color: "rgba(226, 232, 240, 0.76)"
                                }}
                            >
                                Tools
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6
                                }}
                            >
                                <button
                                    type="button"
                                    title="Dock toolbar"
                                    onPointerDown={stopInteractivePropagation}
                                    onMouseDown={stopInteractivePropagation}
                                    onClick={redockToolbar}
                                    style={{
                                        border: "1px solid rgba(71, 85, 105, 0.9)",
                                        background: "rgba(15, 23, 42, 0.88)",
                                        color: "#f8fafc",
                                        minWidth: 48,
                                        height: 28,
                                        padding: "0 8px",
                                        borderRadius: 999,
                                        fontSize: 11,
                                        fontWeight: 800,
                                        cursor: "pointer"
                                    }}
                                >
                                    Dock
                                </button>
                                <button
                                    type="button"
                                    title="Hide tools"
                                    onPointerDown={stopInteractivePropagation}
                                    onMouseDown={stopInteractivePropagation}
                                    onClick={() => setToolbarCollapsed(true)}
                                    style={{
                                        border: "1px solid rgba(71, 85, 105, 0.9)",
                                        background: "rgba(15, 23, 42, 0.88)",
                                        color: "#f8fafc",
                                        minWidth: 28,
                                        height: 28,
                                        padding: "0 8px",
                                        borderRadius: 999,
                                        fontSize: 14,
                                        fontWeight: 700,
                                        cursor: "pointer"
                                    }}
                                >
                                    _
                                </button>
                            </div>
                        </div>

                        <DockSection title="Zoom">
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <button
                                    type="button"
                                    onPointerDown={stopInteractivePropagation}
                                    onMouseDown={stopInteractivePropagation}
                                    onClick={(e) => { stopInteractivePropagation(e); stepCanvasZoom(-1); }}
                                    style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(71,85,105,0.9)", background: "rgba(15,23,42,0.9)", color: "#f8fafc", fontSize: 16, cursor: "pointer", lineHeight: 1 }}
                                >−</button>
                                <input
                                    type="range"
                                    min={10}
                                    max={400}
                                    step={5}
                                    value={Math.round(effectiveZoom * 100)}
                                    onPointerDown={stopInteractivePropagation}
                                    onMouseDown={stopInteractivePropagation}
                                    onChange={(e) => setLocalZoom(normalizeLocalCanvasZoom(Number(e.target.value) / 100))}
                                    style={{ flex: 1, accentColor: "#22c55e", cursor: "pointer" }}
                                />
                                <button
                                    type="button"
                                    onPointerDown={stopInteractivePropagation}
                                    onMouseDown={stopInteractivePropagation}
                                    onClick={(e) => { stopInteractivePropagation(e); stepCanvasZoom(1); }}
                                    style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(71,85,105,0.9)", background: "rgba(15,23,42,0.9)", color: "#f8fafc", fontSize: 16, cursor: "pointer", lineHeight: 1 }}
                                >+</button>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                                <span style={{ fontSize: 11, color: "rgba(226,232,240,0.72)", fontWeight: 700 }}>
                                    {Math.round(effectiveZoom * 100)}%
                                </span>
                                <button
                                    type="button"
                                    onPointerDown={stopInteractivePropagation}
                                    onMouseDown={stopInteractivePropagation}
                                    onClick={(e) => { stopInteractivePropagation(e); setLocalZoom(null); }}
                                    style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, border: "1px solid rgba(71,85,105,0.9)", background: "rgba(15,23,42,0.9)", color: "rgba(226,232,240,0.72)", cursor: "pointer", fontWeight: 700 }}
                                >Reset</button>
                            </div>
                        </DockSection>

                        <div style={{ height: 1, background: "rgba(71, 85, 105, 0.7)" }} />

                        <DockSection>
                            <DockButton active={tool === "select"} onClick={() => activateTool("select")}>
                                <span>Move</span>
                            </DockButton>

                            <EditorDropdownField
                                label="Selection"
                                value={selectionMode}
                                sections={[
                                    {
                                        items: [
                                            { value: "all", label: "All objects" },
                                            { value: "svg", label: "SVG only" },
                                            { value: "polyline", label: "Polylines only" }
                                        ]
                                    }
                                ]}
                                onChange={(nextValue) => {
                                    setSelectionMode(nextValue);
                                    clearSelection();
                                }}
                            />

                            <div
                                style={{
                                    marginTop: 6,
                                    fontSize: 10,
                                    fontWeight: 800,
                                    letterSpacing: "0.08em",
                                    textTransform: "uppercase",
                                    color: "rgba(226, 232, 240, 0.72)"
                                }}
                            >
                                Draw
                            </div>

                            <DockButton active={tool === "polyline"} onClick={() => activateTool("polyline")}>
                                <span>Polyline</span>
                            </DockButton>
                            <DockButton active={tool === "trunkconn"} onClick={() => activateTool("trunkconn")} title="Trunk Connector — click start then end, auto-routes with right angles and flow arrow">
                                <span>Trunk Line</span>
                            </DockButton>
                            <DockButton
                                onClick={connectBinsToTrunk}
                                title="Select a trunk polyline + bin overlays (or no overlays to use all bins), then click to auto-generate drop connections"
                            >
                                <span>Connect Bins</span>
                            </DockButton>
                            <DockButton active={tool === "text"} onClick={() => activateTool("text")}>
                                <span>Text</span>
                            </DockButton>
                        </DockSection>

                        <div style={{ height: 1, background: "rgba(71, 85, 105, 0.7)" }} />

                        <DockSection title="Assets">
                            <DockButton
                                active={importOpen}
                                disabled={!svgLibraryReady}
                                onClick={handleImportToggle}
                            >
                                <span>SVG Library</span>
                            </DockButton>
                            <DockButton
                                active={widgetOpen}
                                onClick={handleWidgetToggle}
                            >
                                <span>Widgets</span>
                            </DockButton>
                            <DockButton
                                disabled={hmiStateStyleMapRefreshing}
                                onClick={handleRefreshHmiStateStyleMaps}
                            >
                                <span>{hmiStateStyleMapRefreshing ? "Loading Styles" : "Refresh Styles"}</span>
                            </DockButton>
                            <DockButton onClick={handleAddEmbeddedView}>
                                <span>Embedded View</span>
                            </DockButton>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "minmax(0, 1fr) 78px",
                                    gap: 8,
                                    alignItems: "stretch"
                                }}
                            >
                                <DockButton
                                    disabled={!normalizableSvgCount}
                                    onClick={normalizeAllSvgStrokeWidths}
                                >
                                    <span>Match Stroke</span>
                                </DockButton>
                                <input
                                    type="number"
                                    min="0.1"
                                    step="0.1"
                                    value={strokeNormalizeWidthDraft}
                                    placeholder={formatPanelNumber(NORMALIZED_SVG_STROKE_WIDTH)}
                                    onChange={(event) => {
                                        setStrokeNormalizeWidthDraft(event.target.value);
                                    }}
                                    onBlur={commitStrokeNormalizeWidth}
                                    onFocus={stopInteractivePropagation}
                                    onPointerDown={stopInteractivePropagation}
                                    onMouseDown={stopInteractivePropagation}
                                    onMouseUp={stopInteractivePropagation}
                                    onClick={stopInteractivePropagation}
                                    onDoubleClick={stopInteractivePropagation}
                                    onKeyDown={(event) => {
                                        stopInteractivePropagation(event);
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            commitStrokeNormalizeWidth();
                                            event.currentTarget.blur();
                                        }
                                    }}
                                    onKeyUp={stopInteractivePropagation}
                                    style={{
                                        width: "100%",
                                        minHeight: 40,
                                        boxSizing: "border-box",
                                        borderRadius: 12,
                                        border: "1px solid rgba(71, 85, 105, 0.9)",
                                        background: "rgba(15, 23, 42, 0.92)",
                                        color: "#f8fafc",
                                        padding: "0 10px",
                                        fontSize: 12,
                                        fontWeight: 700,
                                        textAlign: "center"
                                    }}
                                />
                            </div>
                            <div
                                style={{
                                    fontSize: 11,
                                    lineHeight: 1.45,
                                    color: (svgLibraryError || hmiStateStyleMapError) ? "#fecaca" : "rgba(226, 232, 240, 0.72)"
                                }}
                            >
                                {svgLibraryStatusText}
                                <div>{widgetLibraryStatusText}</div>
                                <div>{hmiStateStyleMapStatusText}</div>
                                {!svgLibraryError && normalizableSvgCount ? (
                                    <div>{`${normalizableSvgCount} SVGs -> ${formatPanelNumber(resolvedStrokeNormalizeWidth)}px stroke`}</div>
                                ) : null}
                            </div>
                        </DockSection>

                        <div style={{ height: 1, background: "rgba(71, 85, 105, 0.7)" }} />

                        <DockSection title="Display">
                            <DockButton active={showTagPaths} onClick={() => setShowTagPaths(!showTagPaths)}>
                                <span>Show TagPaths</span>
                            </DockButton>
                            <DockButton active={showGrid} onClick={() => setShowGrid(!showGrid)}>
                                <span>Show Grid</span>
                            </DockButton>
                        </DockSection>

                        <div style={{ height: 1, background: "rgba(71, 85, 105, 0.7)" }} />

                        <DockSection title="Help">
                            <DockButton active={helpOpen} onClick={handleHelpToggle}>
                                <span>Open Help</span>
                            </DockButton>
                        </DockSection>
                    </div>
                )
            ) : null}

            {editorVisible && quickSvgPickerStyle ? (
                <div
                    data-vizi-quick-svg-picker="1"
                    style={quickSvgPickerStyle}
                    onPointerDown={stopInteractivePropagation}
                    onMouseDown={stopInteractivePropagation}
                    onMouseUp={stopInteractivePropagation}
                    onClick={stopInteractivePropagation}
                    onDoubleClick={stopInteractivePropagation}
                    onKeyDown={stopInteractivePropagation}
                    onKeyUp={stopInteractivePropagation}
                    onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                >
                    <div
                        style={{
                            padding: 10,
                            borderBottom: "1px solid rgba(71, 85, 105, 0.72)",
                            display: "grid",
                            gap: 8
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: "#f8fafc" }}>
                                SVG Files
                            </div>
                            <button
                                type="button"
                                onClick={closeQuickSvgPicker}
                                style={{
                                    border: "1px solid rgba(71, 85, 105, 0.9)",
                                    background: "rgba(15, 23, 42, 0.88)",
                                    color: "#f8fafc",
                                    width: 24,
                                    height: 24,
                                    borderRadius: 999,
                                    fontSize: 13,
                                    fontWeight: 700,
                                    cursor: "pointer"
                                }}
                            >
                                x
                            </button>
                        </div>
                        <input
                            ref={quickSvgPickerInputRef}
                            value={quickSvgPickerQuery}
                            onChange={(event) => setQuickSvgPickerQuery(event.target.value)}
                            onPointerDown={stopInteractivePropagation}
                            onMouseDown={stopInteractivePropagation}
                            onClick={stopInteractivePropagation}
                            onKeyDown={stopInteractivePropagation}
                            onKeyUp={stopInteractivePropagation}
                            placeholder="Search..."
                            style={{
                                width: "100%",
                                boxSizing: "border-box",
                                border: "1px solid rgba(71, 85, 105, 0.9)",
                                background: "rgba(15, 23, 42, 0.88)",
                                color: "#f8fafc",
                                borderRadius: 10,
                                padding: "8px 10px",
                                outline: "none",
                                fontSize: 12
                            }}
                        />
                    </div>
                    <div
                        className="vizi-scroll"
                        style={{
                            minHeight: 0,
                            overflow: "auto",
                            padding: 10,
                            display: "grid",
                            gap: 8,
                            alignContent: "start"
                        }}
                    >
                        {(clipboardRef.current.shapes.length > 0 || clipboardRef.current.overlays.length > 0) ? (
                            <button
                                type="button"
                                onClick={() => {
                                    pasteClipboard(quickSvgPickerState.worldPoint);
                                    closeQuickSvgPicker();
                                }}
                                style={{
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "8px 10px",
                                    borderRadius: 10,
                                    border: "1px solid rgba(59, 130, 246, 0.72)",
                                    background: "rgba(37, 99, 235, 0.28)",
                                    color: "#bfdbfe",
                                    cursor: "pointer",
                                    fontSize: 12,
                                    fontWeight: 800
                                }}
                            >
                                Paste
                            </button>
                        ) : null}
                        {quickSvgGrouped.length === 0 ? (
                            <div style={{ color: "rgba(226, 232, 240, 0.72)", fontSize: 12 }}>
                                No matches.
                            </div>
                        ) : (
                            quickSvgGrouped.map((group) => (
                                <div key={`quick-svg-group-${group.folder}`} style={{ display: "grid", gap: 6 }}>
                                    <div style={{ color: "rgba(226, 232, 240, 0.62)", fontSize: 11, fontWeight: 800 }}>
                                        {group.folder}
                                    </div>
                                    {group.files.map((file) => (
                                        <button
                                            key={file.key}
                                            type="button"
                                            title={file.key}
                                            onClick={() => {
                                                onPickSvg(file.key, quickSvgPickerState.worldPoint);
                                                closeQuickSvgPicker();
                                            }}
                                            style={{
                                                width: "100%",
                                                textAlign: "left",
                                                padding: "8px 10px",
                                                borderRadius: 10,
                                                border: "1px solid rgba(71, 85, 105, 0.85)",
                                                background: "rgba(15, 23, 42, 0.72)",
                                                color: "#f8fafc",
                                                cursor: "pointer",
                                                fontSize: 12
                                            }}
                                        >
                                            {file.name}
                                        </button>
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            ) : null}

            {editorVisible && quickTagPickerHasTarget && quickTagPickerStyle ? (
                <div
                    ref={quickTagPickerRef}
                    data-vizi-quick-tag-picker="1"
                    style={quickTagPickerStyle}
                    onPointerDown={stopInteractivePropagation}
                    onMouseDown={stopInteractivePropagation}
                    onMouseUp={stopInteractivePropagation}
                    onClick={stopInteractivePropagation}
                    onDoubleClick={stopInteractivePropagation}
                    onKeyDown={stopInteractivePropagation}
                    onKeyUp={stopInteractivePropagation}
                    onContextMenu={stopInteractivePropagation}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12
                        }}
                    >
                        <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
                            <div
                                style={{
                                    fontSize: 11,
                                    fontWeight: 800,
                                    letterSpacing: "0.12em",
                                    textTransform: "uppercase",
                                    color: "rgba(226, 232, 240, 0.76)"
                                }}
                            >
                                Set Tag
                            </div>
                            <div
                                style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: "#f8fafc",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap"
                                }}
                            >
                                {quickTagPickerIsGroup
                                    ? `${quickTagPickerTargetOverlays.length} SVGs selected`
                                    : quickTagPickerOverlay?.name || quickTagPickerOverlay?.id || "SVG Overlay"}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={closeQuickTagPicker}
                            style={{
                                border: "1px solid rgba(71, 85, 105, 0.9)",
                                background: "rgba(15, 23, 42, 0.88)",
                                color: "#f8fafc",
                                width: 28,
                                height: 28,
                                borderRadius: 999,
                                fontSize: 14,
                                fontWeight: 700,
                                cursor: "pointer",
                                flex: "0 0 auto"
                            }}
                        >
                            x
                        </button>
                    </div>
                    {quickTagPickerIsGroup ? (
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                gap: 8
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    alignSelectedOverlays("horizontal");
                                    closeQuickTagPicker();
                                }}
                                style={{
                                    border: "1px solid rgba(71, 85, 105, 0.9)",
                                    background: "rgba(15, 23, 42, 0.88)",
                                    color: "#e2e8f0",
                                    minHeight: 30,
                                    borderRadius: 10,
                                    fontSize: 11,
                                    fontWeight: 800,
                                    cursor: "pointer"
                                }}
                            >
                                Align H
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    alignSelectedOverlays("vertical");
                                    closeQuickTagPicker();
                                }}
                                style={{
                                    border: "1px solid rgba(71, 85, 105, 0.9)",
                                    background: "rgba(15, 23, 42, 0.88)",
                                    color: "#e2e8f0",
                                    minHeight: 30,
                                    borderRadius: 10,
                                    fontSize: 11,
                                    fontWeight: 800,
                                    cursor: "pointer"
                                }}
                            >
                                Align V
                            </button>
                        </div>
                    ) : null}
                    <PropertyTagPathField
                        autoOpenToken={quickTagPickerAutoOpenToken}
                        label={quickTagPickerIsGroup && quickTagPickerHasMixedTagPaths ? "Tag Path (mixed)" : "Tag Path"}
                        value={quickTagPickerIsGroup ? quickTagPickerCommonTagPath : quickTagPickerOverlay?.tagPath || ""}
                        options={ignitionTagOptionsForQuickPicker}
                        typeFilter={quickTagPickerTypeFilter}
                        loaded={ignitionTagsLoaded}
                        loading={ignitionTagsLoading}
                        error={ignitionTagsError}
                        onOpen={loadIgnitionTags}
                        onCommit={(value) => {
                            if (quickTagPickerIsGroup) {
                                commitQuickTagPickerGroupTagPath(value);
                            } else if (quickTagPickerOverlay?.id) {
                                commitOverlayTagPathById(quickTagPickerOverlay.id, value);
                            }
                            closeQuickTagPicker();
                        }}
                    />
                </div>
            ) : null}

            {editorVisible && propertiesVisible && floatingPropertyPanelStyle ? (
                <div
                    data-vizi-properties-panel="1"
                    style={floatingPropertyPanelStyle}
                    onPointerDown={stopInteractivePropagation}
                    onMouseDown={stopInteractivePropagation}
                    onMouseUp={stopInteractivePropagation}
                    onClick={stopInteractivePropagation}
                    onDoubleClick={stopInteractivePropagation}
                    onKeyDown={stopInteractivePropagation}
                    onKeyUp={stopInteractivePropagation}
                    onContextMenu={stopInteractivePropagation}
                >
                <style>{`
                    .vizi-scroll::-webkit-scrollbar { width: 4px; }
                    .vizi-scroll::-webkit-scrollbar-track { background: transparent; }
                    .vizi-scroll::-webkit-scrollbar-thumb { background: rgba(71, 85, 105, 0.4); border-radius: 999px; }
                    .vizi-scroll::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.72); }
                    .vizi-scroll { scrollbar-width: thin; scrollbar-color: rgba(71, 85, 105, 0.4) transparent; }
                `}</style>
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize properties panel"
                        title="Resize properties panel"
                        onMouseDown={(event) => {
                            if (event.button !== 0) {
                                return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            propertyPanelResizeRef.current = {
                                resizing: true,
                                mode: "width",
                                startX: event.clientX,
                                startY: event.clientY,
                                startWidth: clampPropertyPanelWidth(
                                    propertyPanelWidth,
                                    Number(rootSize?.width || browserViewportWidth || DEFAULT_CANVAS_WIDTH)
                                ),
                                startHeight: propertyPanelHeight,
                                panelTop: Number(floatingPropertyPanelStyle?.top || 0)
                            };
                            setPropertyPanelResizing(true);
                        }}
                        style={{
                            position: "absolute",
                            top: 0,
                            right: 0,
                            bottom: 0,
                            width: 10,
                            cursor: "col-resize",
                            zIndex: 1,
                            background: propertyPanelResizing && propertyPanelResizeRef.current.mode === "width"
                                ? "rgba(56, 189, 248, 0.28)"
                                : "transparent"
                        }}
                    />
                    <div
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label="Resize properties panel height"
                        title="Resize properties panel height"
                        onMouseDown={(event) => {
                            if (event.button !== 0) {
                                return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            propertyPanelResizeRef.current = {
                                resizing: true,
                                mode: "height",
                                startX: event.clientX,
                                startY: event.clientY,
                                startWidth: propertyPanelWidth,
                                startHeight: clampPropertyPanelHeight(
                                    propertyPanelHeight,
                                    Math.max(
                                        PROPERTY_PANEL_MIN_HEIGHT,
                                        Number(rootSize?.height || browserViewportHeight || DEFAULT_CANVAS_HEIGHT) -
                                            Number(floatingPropertyPanelStyle?.top || 0) -
                                            16
                                    )
                                ),
                                panelTop: Number(floatingPropertyPanelStyle?.top || 0)
                            };
                            setPropertyPanelResizing(true);
                        }}
                        style={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            bottom: 0,
                            height: 10,
                            cursor: "row-resize",
                            zIndex: 2,
                            background: propertyPanelResizing && propertyPanelResizeRef.current.mode === "height"
                                ? "rgba(56, 189, 248, 0.28)"
                                : "transparent"
                        }}
                    />
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12
                        }}
                    >
                        <div
                            style={{
                                fontSize: 11,
                                fontWeight: 800,
                                letterSpacing: "0.12em",
                                textTransform: "uppercase",
                                color: "rgba(226, 232, 240, 0.76)"
                            }}
                        >
                            Properties
                        </div>
                        <button
                            type="button"
                            onClick={closePropertiesPanel}
                            style={{
                                border: "1px solid rgba(71, 85, 105, 0.9)",
                                background: "rgba(15, 23, 42, 0.88)",
                                color: "#f8fafc",
                                width: 28,
                                height: 28,
                                borderRadius: 999,
                                fontSize: 14,
                                fontWeight: 700,
                                cursor: "pointer"
                            }}
                        >
                            x
                        </button>
                    </div>
                    <div
                        className="vizi-scroll"
                        style={{
                            minHeight: 0,
                            overflowY: "auto",
                            paddingRight: 2
                        }}
                    >
                    <PropertySection>
                        {selectedOverlay ? (
                            <>
                                <PropertyReadout
                                    label="Type"
                                    value={
                                        selectedOverlayIsEmbeddedView
                                            ? "Embedded View"
                                            : selectedOverlay.widget
                                                ? "Widget"
                                                : "SVG Overlay"
                                    }
                                />
                                <PropertyReadout label="ID" value={selectedOverlay.id} />
                                {selectedOverlay.widget ? (
                                    <PropertyReadout
                                        label="Widget Kind"
                                        value={String(selectedOverlay.widget?.kind || "").trim() || "Widget"}
                                    />
                                ) : null}
                                <PropertyField
                                    label="Name"
                                    value={selectedOverlay.name || ""}
                                    onCommit={(value) => {
                                        commitSelectedOverlayText("name", value);
                                    }}
                                />
                                {!selectedOverlayIsEmbeddedView && !selectedOverlay.widget ? (
                                    <EditorDropdownField
                                        label="SVG"
                                        value={selectedOverlayTemplateKey}
                                        placeholder="Select SVG..."
                                        searchable
                                        searchPlaceholder="Search SVG library..."
                                        sections={selectedOverlayTemplateSections}
                                        disabled={!svgLibraryEnabled || svgLibraryRefreshing || !svgFiles.length}
                                        helperText={
                                            svgLibraryRefreshing
                                                ? "Loading SVG library..."
                                                : svgLibraryError || `${svgFiles.length} SVG template${svgFiles.length === 1 ? "" : "s"} available`
                                        }
                                        helperTone={svgLibraryError ? "error" : "muted"}
                                        onOpen={() => {
                                            if (svgLibraryEnabled && !svgLibraryRefreshing) {
                                                loadSvgCatalog();
                                            }
                                        }}
                                        onChange={(value) => {
                                            swapSelectedOverlaySvgTemplate(value);
                                        }}
                                    />
                                ) : null}
                                {!selectedOverlayIsEmbeddedView && !selectedOverlay.widget ? (
                                    <PropertyCheckbox
                                        label="Static"
                                        checked={selectedOverlayIsStatic}
                                        onChange={toggleSelectedOverlayStatic}
                                    />
                                ) : null}
                                {selectedOverlayIsEmbeddedView ? (
                                    <>
                                        <PropertyField
                                            label="View Path"
                                            value={selectedOverlayEmbeddedView?.viewPath || ""}
                                            placeholder="Views/MyEmbeddedView"
                                            onCommit={(value) => {
                                                commitSelectedOverlayEmbeddedViewField("viewPath", String(value ?? "").trim());
                                            }}
                                        />
                                        <PropertyTextArea
                                            label="View Params JSON"
                                            value={selectedOverlayEmbeddedView?.paramsJson || "{}"}
                                            placeholder='{"tagPath":"[default]MyTag"}'
                                            rows={5}
                                            onCommit={(value) => {
                                                commitSelectedOverlayEmbeddedViewField("paramsJson", String(value ?? ""));
                                            }}
                                        />
                                        <EditorDropdownField
                                            label="Runtime Interaction"
                                            value={selectedOverlayEmbeddedViewInteractive ? "enabled" : "disabled"}
                                            options={[
                                                { label: "Enabled", value: "enabled" },
                                                { label: "Disabled", value: "disabled" }
                                            ]}
                                            onChange={(value) => {
                                                commitSelectedOverlayEmbeddedViewField("runtimeInteractive", value !== "disabled");
                                            }}
                                        />
                                        {selectedOverlayEmbeddedViewParamsError ? (
                                            <PropertyReadout
                                                label="Params Status"
                                                value={selectedOverlayEmbeddedViewParamsError}
                                            />
                                        ) : null}
                                    </>
                                ) : null}
                                {selectedOverlay.widget && selectedOverlayWidgetSupportsWrite ? (
                                    <EditorDropdownField
                                        label="Write Target"
                                        value={selectedOverlayWidgetWriteMode}
                                        sections={[
                                            {
                                                items: [
                                                    { value: "ignition", label: "Ignition Tag" },
                                                    { value: "opc", label: "Direct OPC" },
                                                    ...(selectedOverlayWidgetSupportsView
                                                        ? [{ value: "view", label: "Open View" }]
                                                        : [])
                                                ]
                                            }
                                        ]}
                                        onChange={(nextValue) => {
                                            commitSelectedOverlayWidgetField("writeMode", nextValue);
                                        }}
                                    />
                                ) : null}
                                {!selectedOverlayIsEmbeddedView && selectedOverlay.widget && selectedOverlayWidgetSupportsView && selectedOverlayWidgetWriteMode === "view" ? (
                                    <>
                                        <PropertyField
                                            label="View Path"
                                            value={selectedOverlay.widget?.viewPath || ""}
                                            placeholder="Views/MyPopup"
                                            onCommit={(value) => {
                                                commitSelectedOverlayWidgetField("viewPath", String(value ?? "").trim());
                                            }}
                                        />
                                        <PropertyTextArea
                                            label="View Params JSON"
                                            value={selectedOverlay.widget?.viewParamsJson || "{}"}
                                            placeholder='{"tagPath":"[default]MyTag"}'
                                            rows={4}
                                            onCommit={(value) => {
                                                commitSelectedOverlayWidgetField("viewParamsJson", String(value ?? "").trim() || "{}");
                                            }}
                                        />
                                    </>
                                ) : null}
                                {!selectedOverlayIsEmbeddedView && selectedOverlay.widget && selectedOverlayWidgetSupportsWrite && selectedOverlayWidgetWriteMode === "opc" ? (
                                    <>
                                        <PropertyField
                                            label="OPC Item Path"
                                            value={selectedOverlay.tagPath || ""}
                                            placeholder="ns=1;s=[PLC]Program:Tags.MyCommand"
                                            onCommit={(value) => {
                                                commitSelectedOverlayTagPath(value);
                                            }}
                                        />
                                        <PropertyField
                                            label="OPC Server"
                                            value={selectedOverlayWidgetOpcServer}
                                            onCommit={(value) => {
                                                commitSelectedOverlayWidgetField("opcServer", String(value ?? ""));
                                            }}
                                        />
                                    </>
                                ) : !selectedOverlayIsEmbeddedView && selectedOverlayWidgetWriteMode !== "view" && !(selectedOverlayIsStatic && !selectedOverlay.widget) ? (
                                    <PropertyTagPathField
                                        label="Tag Path"
                                        value={selectedOverlay.tagPath || ""}
                                        options={ignitionTagOptionsForOverlay}
                                        typeFilter={selectedOverlay.widget ? "" : selectedOverlay.eType}
                                        loaded={ignitionTagsLoaded}
                                        loading={ignitionTagsLoading}
                                        error={ignitionTagsError}
                                        onOpen={loadIgnitionTags}
                                        onCommit={(value) => {
                                            commitSelectedOverlayTagPath(value);
                                        }}
                                    />
                                ) : null}
                                {!selectedOverlayIsEmbeddedView ? (
                                    <EditorDropdownField
                                        label="EType"
                                        value={selectedOverlay.eType || ""}
                                        placeholder="Select UDT..."
                                        searchable
                                        searchPlaceholder="Search UDTs..."
                                        sections={svgETypeSections}
                                        helperText={ignitionTagsError || svgETypeHelperText}
                                        helperTone={ignitionTagsError ? "error" : "muted"}
                                        onOpen={() => {
                                            if (!ignitionTagsLoaded && !ignitionTagsLoading) {
                                                loadIgnitionTags();
                                            }
                                        }}
                                        onChange={(value) => {
                                            commitSelectedOverlayText("eType", value);
                                        }}
                                    />
                                ) : null}
                                {!selectedOverlayIsEmbeddedView && !selectedOverlay.widget && !selectedOverlayIsStatic ? (
                                    <>
                                        <PropertyTextArea
                                            label="Popup Params JSON"
                                            value={selectedOverlay.popupParamsJson || "{}"}
                                            placeholder='{"line":"{{tagName}}","area":"Mill"}'
                                            rows={4}
                                            onCommit={(value) => {
                                                commitSelectedOverlayText("popupParamsJson", value);
                                            }}
                                        />
                                        {selectedOverlayPopupParamsError ? (
                                            <PropertyReadout
                                                label="Popup Params Status"
                                                value={selectedOverlayPopupParamsError}
                                            />
                                        ) : null}
                                    </>
                                ) : null}
                                {selectedOverlay.widget ? (
                                    <>
                                        <PropertyField
                                            label="Title"
                                            value={selectedOverlay.widget?.title || ""}
                                            onCommit={(value) => {
                                                commitSelectedOverlayWidgetField("title", String(value ?? ""));
                                            }}
                                        />
                                        <PropertyField
                                            label="Title Font Size"
                                            value={formatPanelNumber(selectedOverlay.widget?.titleFontSize)}
                                            placeholder="Auto"
                                            onCommit={(value) => {
                                                const trimmed = String(value ?? "").trim();
                                                if (!trimmed) {
                                                    commitSelectedOverlayWidgetField("titleFontSize", "");
                                                    return;
                                                }
                                                const next = parsePanelNumber(trimmed);
                                                if (next == null) {
                                                    return;
                                                }
                                                commitSelectedOverlayWidgetField("titleFontSize", next);
                                            }}
                                        />
                                        <PropertyColorField
                                            label="Text Color"
                                            value={selectedOverlay.widget?.textColor || ""}
                                            placeholder="#e2e8f0"
                                            onCommit={(value) => {
                                                commitSelectedOverlayWidgetField("textColor", String(value ?? "").trim());
                                            }}
                                        />
                                        {selectedOverlayWidgetSupportsButtonTextColor ? (
                                            <PropertyColorField
                                                label="Button Text"
                                                value={selectedOverlay.widget?.buttonTextColor || ""}
                                                placeholder="#ffffff"
                                                onCommit={(value) => {
                                                    commitSelectedOverlayWidgetField("buttonTextColor", String(value ?? "").trim());
                                                }}
                                            />
                                        ) : null}
                                        {String(selectedOverlay.widget?.kind || "").trim().toLowerCase() === "pushbutton" ? (
                                            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                                <PropertyField
                                                    label="Press Value"
                                                    value={String(
                                                        Object.prototype.hasOwnProperty.call(selectedOverlay.widget || {}, "writeValue")
                                                            ? selectedOverlay.widget.writeValue
                                                            : 1
                                                    )}
                                                    onCommit={(value) => {
                                                        commitSelectedOverlayWidgetField("writeValue", String(value ?? ""));
                                                    }}
                                                />
                                                <PropertyField
                                                    label="Release Value"
                                                    value={String(
                                                        Object.prototype.hasOwnProperty.call(selectedOverlay.widget || {}, "releaseValue")
                                                            ? selectedOverlay.widget.releaseValue
                                                            : 0
                                                    )}
                                                    onCommit={(value) => {
                                                        commitSelectedOverlayWidgetField("releaseValue", String(value ?? ""));
                                                    }}
                                                />
                                            </div>
                                        ) : null}
                                    </>
                                ) : null}
                                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                    <PropertyField
                                        label="X"
                                        value={formatPanelNumber(selectedOverlayBounds?.x)}
                                        onCommit={(value) => {
                                            commitSelectedOverlayPosition("x", value);
                                        }}
                                    />
                                    <PropertyField
                                        label="Y"
                                        value={formatPanelNumber(selectedOverlayBounds?.y)}
                                        onCommit={(value) => {
                                            commitSelectedOverlayPosition("y", value);
                                        }}
                                    />
                                </div>
                                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                    <PropertyField
                                        label="Width"
                                        value={formatPanelNumber(selectedOverlayBounds?.width)}
                                        onCommit={(value) => {
                                            commitSelectedOverlayDimension("width", value);
                                        }}
                                    />
                                    <PropertyField
                                        label="Height"
                                        value={formatPanelNumber(selectedOverlayBounds?.height)}
                                        onCommit={(value) => {
                                            commitSelectedOverlayDimension("height", value);
                                        }}
                                    />
                                </div>
                                {!selectedOverlayIsEmbeddedView ? (
                                    <>
                                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                            <PropertyField
                                                label="Scale X"
                                                value={formatPanelNumber(overlayScaleX(selectedOverlay))}
                                                onCommit={(value) => {
                                                    commitSelectedOverlayNumber("scaleX", value, { min: 0.05 });
                                                }}
                                            />
                                            <PropertyField
                                                label="Scale Y"
                                                value={formatPanelNumber(overlayScaleY(selectedOverlay))}
                                                onCommit={(value) => {
                                                    commitSelectedOverlayNumber("scaleY", value, { min: 0.05 });
                                                }}
                                            />
                                        </div>
                                        <PropertyField
                                            label="Rotation"
                                            value={formatPanelNumber(selectedOverlay.rotation || 0)}
                                            onCommit={(value) => {
                                                commitSelectedOverlayNumber("rotation", value);
                                            }}
                                        />
                                        {!selectedOverlay.widget ? (
                                            <div
                                                style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}
                                                onMouseDown={stopInteractivePropagation}
                                                onClick={stopInteractivePropagation}
                                                onDoubleClick={stopInteractivePropagation}
                                            >
                                                {[
                                                    ["x", "Flip H", Boolean(selectedOverlay.flipX || selectedOverlay.flippedX || selectedOverlay.mirrorX)],
                                                    ["y", "Flip V", Boolean(selectedOverlay.flipY || selectedOverlay.flippedY || selectedOverlay.mirrorY)]
                                                ].map(([axis, label, active]) => (
                                                    <button
                                                        key={axis}
                                                        type="button"
                                                        onClick={(event) => {
                                                            stopInteractivePropagation(event);
                                                            toggleSelectedOverlayFlip(axis);
                                                        }}
                                                        style={{
                                                            height: 36,
                                                            borderRadius: 10,
                                                            border: `1px solid ${active ? "rgba(96, 165, 250, 0.9)" : "rgba(71, 85, 105, 0.9)"}`,
                                                            background: active ? "rgba(37, 99, 235, 0.52)" : "rgba(15, 23, 42, 0.92)",
                                                            color: "#f8fafc",
                                                            fontSize: 12,
                                                            fontWeight: 800,
                                                            cursor: "pointer"
                                                        }}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : null}
                                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                            <PropertyField
                                                label="Scale"
                                                value={formatPanelNumber(selectedOverlay.scale || overlayScaleX(selectedOverlay))}
                                                onCommit={(value) => {
                                                    commitSelectedOverlayNumber("scale", value, { min: 0.05 });
                                                }}
                                            />
                                            <PropertyField
                                                label="Stroke Width"
                                                value={formatPanelNumber(selectedOverlay.strokeWidth || 0)}
                                                onCommit={(value) => {
                                                    commitSelectedOverlayNumber("strokeWidth", value, { min: 0 });
                                                }}
                                            />
                                        </div>
                                        <PropertyField
                                            label="Fill"
                                            value={selectedOverlay.fill || ""}
                                            onCommit={(value) => {
                                                commitSelectedOverlayFill(value);
                                            }}
                                        />
                                        <PropertyField
                                            label="Stroke"
                                            value={selectedOverlay.stroke || ""}
                                            onCommit={(value) => {
                                                commitSelectedOverlayText("stroke", value);
                                            }}
                                        />
                                    </>
                                ) : null}
                            </>
                        ) : selectedOverlayGroup.length > 1 ? (
                            <>
                                <PropertyReadout
                                    label="Selection"
                                    value={`${selectedOverlayGroup.length} SVGs selected`}
                                />
                                <PropertyReadout
                                    label="Tag Writable"
                                    value={`${editableSelectedOverlayGroup.length} SVGs`}
                                />
                                {editableSelectedOverlayGroup.length ? (
                                    <>
                                        <PropertyTagPathField
                                            label={selectedOverlayGroupHasMixedTagPaths ? "Tag Path (mixed)" : "Tag Path"}
                                            value={selectedOverlayGroupCommonTagPath}
                                            options={ignitionTagOptionsForOverlayGroup}
                                            typeFilter={selectedOverlayGroupCommonEType}
                                            loaded={ignitionTagsLoaded}
                                            loading={ignitionTagsLoading}
                                            error={ignitionTagsError}
                                            onOpen={loadIgnitionTags}
                                            onCommit={(value) => {
                                                commitSelectedOverlayGroupTagPath(value);
                                            }}
                                        />
                                        <div
                                            style={{
                                                fontSize: 12,
                                                lineHeight: 1.5,
                                                color: "rgba(226, 232, 240, 0.72)"
                                            }}
                                        >
                                            The selected tag path will be applied to all selected non-static SVG overlays.
                                        </div>
                                    </>
                                ) : (
                                    <div
                                        style={{
                                            fontSize: 12,
                                            lineHeight: 1.5,
                                            color: "rgba(226, 232, 240, 0.72)"
                                        }}
                                    >
                                        Static SVGs and embedded views do not use tag paths.
                                    </div>
                                )}
                            </>
                        ) : selectedShape ? (
                            <>
                                <PropertyReadout label="Type" value={selectedShapeLabel} />
                                <PropertyReadout label="ID" value={selectedShape.id} />
                                <PropertyTagPathField
                                    label="Tag Path"
                                    value={selectedShape.tagPath || ""}
                                    options={ignitionTagOptions}
                                    loaded={ignitionTagsLoaded}
                                    loading={ignitionTagsLoading}
                                    error={ignitionTagsError}
                                    onOpen={loadIgnitionTags}
                                    onCommit={(value) => {
                                        commitSelectedShapeText("tagPath", value);
                                    }}
                                />
                                {String(selectedShape?.type || "").toLowerCase() === "text" ? (
                                    <>
                                        <PropertyField
                                            label="Text"
                                            value={selectedShape.text || ""}
                                            onCommit={(value) => {
                                                commitSelectedShapeText("text", value);
                                            }}
                                        />
                                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                            <PropertyField
                                                label="X"
                                                value={formatPanelNumber(selectedShape.x)}
                                                onCommit={(value) => {
                                                    commitSelectedShapePosition("x", value);
                                                }}
                                            />
                                            <PropertyField
                                                label="Y"
                                                value={formatPanelNumber(selectedShape.y)}
                                                onCommit={(value) => {
                                                    commitSelectedShapePosition("y", value);
                                                }}
                                            />
                                        </div>
                                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                            <PropertyField
                                                label="Font Size"
                                                value={formatPanelNumber(selectedShape.fontSize || 24)}
                                                onCommit={(value) => {
                                                    commitSelectedShapeNumber("fontSize", value, { min: 1 });
                                                }}
                                            />
                                            <PropertyField
                                                label="Fill"
                                                value={selectedShape.fill || ""}
                                                onCommit={(value) => {
                                                    commitSelectedShapeText("fill", value);
                                                }}
                                            />
                                        </div>
                                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                            <PropertyField
                                                label="Scale"
                                                value={formatPanelNumber(selectedShape.scaleFactor)}
                                                placeholder="1"
                                                onCommit={(value) => {
                                                    commitSelectedShapeOptionalNumber("scaleFactor", value);
                                                }}
                                            />
                                            <PropertyField
                                                label="Decimals"
                                                value={formatPanelNumber(selectedShape.decimals)}
                                                placeholder="Auto"
                                                onCommit={(value) => {
                                                    commitSelectedShapeOptionalNumber("decimals", value, { min: 0 });
                                                }}
                                            />
                                        </div>
                                        <PropertyField
                                            label="Units"
                                            value={selectedShape.unit || ""}
                                            placeholder="psi"
                                            onCommit={(value) => {
                                                commitSelectedShapeText("unit", value);
                                            }}
                                        />
                                    </>
                                ) : Array.isArray(selectedShape?.points) ? (
                                    <>
                                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                            <PropertyField
                                                label="X"
                                                value={formatPanelNumber(selectedShapeBounds?.x)}
                                                onCommit={(value) => {
                                                    commitSelectedShapePosition("x", value);
                                                }}
                                            />
                                            <PropertyField
                                                label="Y"
                                                value={formatPanelNumber(selectedShapeBounds?.y)}
                                                onCommit={(value) => {
                                                    commitSelectedShapePosition("y", value);
                                                }}
                                            />
                                        </div>
                                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                            <PropertyField
                                                label="Width"
                                                value={formatPanelNumber(selectedShapeBounds?.width)}
                                                onCommit={(value) => {
                                                    commitSelectedShapeBoundsDimension("width", value);
                                                }}
                                            />
                                            <PropertyField
                                                label="Height"
                                                value={formatPanelNumber(selectedShapeBounds?.height)}
                                                onCommit={(value) => {
                                                    commitSelectedShapeBoundsDimension("height", value);
                                                }}
                                            />
                                        </div>
                                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                            <PropertyField
                                                label="Stroke"
                                                value={selectedShape.stroke || ""}
                                                onCommit={(value) => {
                                                    commitSelectedShapeText("stroke", value);
                                                }}
                                            />
                                            <PropertyField
                                                label="Stroke Width"
                                                value={formatPanelNumber(selectedShape.strokeWidth || 0)}
                                                onCommit={(value) => {
                                                    commitSelectedShapeNumber("strokeWidth", value, { min: 0 });
                                                }}
                                            />
                                        </div>
                                        <EditorDropdownField
                                            label="Line Style"
                                            value={selectedShape.lineStyle || "solid"}
                                            sections={[
                                                {
                                                    label: "Style",
                                                    items: [
                                                        { value: "solid", label: "Solid" },
                                                        { value: "dashed", label: "Dashed" },
                                                        { value: "dotted", label: "Dotted" },
                                                        { value: "wavy", label: "Wavy" }
                                                    ]
                                                }
                                            ]}
                                            onChange={(value) => {
                                                const next = ["solid", "dashed", "dotted", "wavy"].includes(String(value || ""))
                                                    ? value
                                                    : "solid";
                                                commitSelectedShapeText("lineStyle", next);
                                            }}
                                        />
                                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                            <EditorDropdownField
                                                label="Start Arrow"
                                                value={selectedShape.arrowStart || "none"}
                                                sections={[
                                                    {
                                                        label: "Direction",
                                                        items: [
                                                            { value: "none", label: "None" },
                                                            { value: "in", label: "Inward" },
                                                            { value: "out", label: "Outward" }
                                                        ]
                                                    }
                                                ]}
                                                onChange={(value) => {
                                                    const next = ["none", "in", "out"].includes(String(value || ""))
                                                        ? value
                                                        : "none";
                                                    commitSelectedShapeText("arrowStart", next);
                                                }}
                                            />
                                            <EditorDropdownField
                                                label="End Arrow"
                                                value={selectedShape.arrowEnd || "none"}
                                                sections={[
                                                    {
                                                        label: "Direction",
                                                        items: [
                                                            { value: "none", label: "None" },
                                                            { value: "in", label: "Inward" },
                                                            { value: "out", label: "Outward" }
                                                        ]
                                                    }
                                                ]}
                                                onChange={(value) => {
                                                    const next = ["none", "in", "out"].includes(String(value || ""))
                                                        ? value
                                                        : "none";
                                                    commitSelectedShapeText("arrowEnd", next);
                                                }}
                                            />
                                        </div>
                                        <PropertyReadout
                                            label="Points"
                                            value={String(coerceArray(selectedShape.points).length)}
                                        />
                                    </>
                                ) : (
                                    <>
                                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                            <PropertyField
                                                label="X"
                                                value={formatPanelNumber(selectedShape.x)}
                                                onCommit={(value) => {
                                                    commitSelectedShapePosition("x", value);
                                                }}
                                            />
                                            <PropertyField
                                                label="Y"
                                                value={formatPanelNumber(selectedShape.y)}
                                                onCommit={(value) => {
                                                    commitSelectedShapePosition("y", value);
                                                }}
                                            />
                                        </div>
                                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                            <PropertyField
                                                label="Width"
                                                value={formatPanelNumber(selectedShape.width || 0)}
                                                onCommit={(value) => {
                                                    commitSelectedShapeNumber("width", value, { min: 0 });
                                                }}
                                            />
                                            <PropertyField
                                                label="Height"
                                                value={formatPanelNumber(selectedShape.height || 0)}
                                                onCommit={(value) => {
                                                    commitSelectedShapeNumber("height", value, { min: 0 });
                                                }}
                                            />
                                        </div>
                                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                                            <PropertyField
                                                label="Fill"
                                                value={selectedShape.fill || ""}
                                                onCommit={(value) => {
                                                    commitSelectedShapeText("fill", value);
                                                }}
                                            />
                                            <PropertyField
                                                label="Stroke"
                                                value={selectedShape.stroke || ""}
                                                onCommit={(value) => {
                                                    commitSelectedShapeText("stroke", value);
                                                }}
                                            />
                                        </div>
                                        <PropertyField
                                            label="Stroke Width"
                                            value={formatPanelNumber(selectedShape.strokeWidth || 0)}
                                            onCommit={(value) => {
                                                commitSelectedShapeNumber("strokeWidth", value, { min: 0 });
                                            }}
                                        />
                                    </>
                                )}
                            </>
                        ) : (
                            <>
                                <PropertyReadout
                                    label="Selection"
                                    value={`${selectedOverlayIds.length} SVGs, ${selectedIds.length} shapes`}
                                />
                                <div
                                    style={{
                                        fontSize: 12,
                                        lineHeight: 1.5,
                                        color: "rgba(226, 232, 240, 0.72)"
                                    }}
                                >
                                    Select a single SVG or shape to edit its properties.
                                </div>
                            </>
                        )}
                    </PropertySection>
                    </div>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                            gap: 8,
                            paddingTop: 4,
                            borderTop: "1px solid rgba(71, 85, 105, 0.5)"
                        }}
                    >
                        <button
                            type="button"
                            onClick={copySelection}
                            style={{
                                background: "rgba(15, 23, 42, 0.82)",
                                border: "1px solid rgba(71, 85, 105, 0.78)",
                                color: "#e2e8f0",
                                height: 32,
                                borderRadius: 10,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                                letterSpacing: "0.03em"
                            }}
                        >
                            Copy
                        </button>
                        <button
                            type="button"
                            onClick={() => { cutSelection(); closePropertiesPanel(); }}
                            style={{
                                background: "rgba(15, 23, 42, 0.82)",
                                border: "1px solid rgba(71, 85, 105, 0.78)",
                                color: "#e2e8f0",
                                height: 32,
                                borderRadius: 10,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                                letterSpacing: "0.03em"
                            }}
                        >
                            Cut
                        </button>
                        <button
                            type="button"
                            onClick={() => { duplicateSelected(); closePropertiesPanel(); }}
                            style={{
                                background: "rgba(15, 23, 42, 0.82)",
                                border: "1px solid rgba(71, 85, 105, 0.78)",
                                color: "#e2e8f0",
                                height: 32,
                                borderRadius: 10,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                                letterSpacing: "0.03em"
                            }}
                        >
                            Duplicate
                        </button>
                        <button
                            type="button"
                            onClick={closePropertiesPanel}
                            style={{
                                background: "rgba(30, 58, 138, 0.72)",
                                border: "1px solid rgba(59, 130, 246, 0.55)",
                                color: "#bfdbfe",
                                height: 32,
                                borderRadius: 10,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                                letterSpacing: "0.03em"
                            }}
                        >
                            Save
                        </button>
                        <button
                            type="button"
                            onClick={() => { deleteSelected(); closePropertiesPanel(); }}
                            style={{
                                background: "rgba(127, 29, 29, 0.6)",
                                border: "1px solid rgba(239, 68, 68, 0.5)",
                                color: "#fca5a5",
                                height: 32,
                                borderRadius: 10,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                                letterSpacing: "0.03em"
                            }}
                        >
                            Delete
                        </button>
                    </div>
                </div>
            ) : null}

            {editorVisible && svgLibraryEnabled && importOpen ? (
                <div
                    style={{
                        "--bg-elev": "rgba(15, 23, 42, 0.98)",
                        "--bg-soft": "rgba(15, 23, 42, 0.92)",
                        "--border": "rgba(71, 85, 105, 0.9)",
                        "--text": "#f8fafc",
                        "--text-muted": "rgba(226, 232, 240, 0.72)"
                    }}
                >
                    <ImportModal
                        importOpen={importOpen}
                        setImportOpen={setImportOpen}
                        svgFiles={svgFiles}
                        svgLibrary={svgLibraryMap}
                        loadSvgRaw={readSvgRawByKey}
                        onPickSvg={onPickSvg}
                        helpText={svgLibraryHelpText}
                        librarySummary={svgLibrarySummaryText}
                        onImportFile={handleImportSvgLibraryFile}
                        importDisabled={svgLibraryRefreshing}
                        importing={svgLibraryUploading}
                        onRefresh={handleRefreshSvgLibrary}
                        refreshDisabled={svgLibraryRefreshing || svgLibraryUploading}
                        docked
                        appearance="ignition-drawer"
                        attached
                        dockLeft={svgDrawerLayout.left}
                        dockTop={svgDrawerLayout.top}
                        dockBottom={svgDrawerLayout.bottom}
                        dockWidth={svgDrawerLayout.width}
                    />
                </div>
            ) : null}

            {editorVisible && widgetOpen ? (
                <div
                    style={{
                        "--bg-elev": "rgba(15, 23, 42, 0.98)",
                        "--bg-soft": "rgba(15, 23, 42, 0.92)",
                        "--border": "rgba(71, 85, 105, 0.9)",
                        "--text": "#f8fafc",
                        "--text-muted": "rgba(226, 232, 240, 0.72)"
                    }}
                >
                    <WidgetSelectorModal
                        open={widgetOpen}
                        onClose={() => setWidgetOpen(false)}
                        onPickWidget={onPickWidget}
                        docked
                        appearance="ignition-drawer"
                        attached
                        dockLeft={widgetDrawerLayout.left}
                        dockTop={widgetDrawerLayout.top}
                        dockBottom={widgetDrawerLayout.bottom}
                        dockWidth={widgetDrawerLayout.width}
                    />
                </div>
            ) : null}

            {editorVisible && helpOpen ? (
                <div
                    style={{
                        position: "fixed",
                        left: helpDrawerLayout.left,
                        top: helpDrawerLayout.top,
                        bottom: helpDrawerLayout.bottom,
                        width: helpDrawerLayout.width,
                        zIndex: 118,
                        display: "grid",
                        gridTemplateRows: "auto 1fr",
                        borderRadius: 22,
                        border: "1px solid rgba(71, 85, 105, 0.9)",
                        background: "linear-gradient(180deg, rgba(2, 6, 23, 0.98) 0%, rgba(15, 23, 42, 0.96) 100%)",
                        boxShadow: "0 24px 60px rgba(2, 6, 23, 0.34)",
                        overflow: "hidden"
                    }}
                    onPointerDown={stopInteractivePropagation}
                    onMouseDown={stopInteractivePropagation}
                    onMouseUp={stopInteractivePropagation}
                    onClick={stopInteractivePropagation}
                    onDoubleClick={stopInteractivePropagation}
                    onKeyDown={stopInteractivePropagation}
                    onKeyUp={stopInteractivePropagation}
                    onContextMenu={stopInteractivePropagation}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "18px 18px 14px",
                            borderBottom: "1px solid rgba(71, 85, 105, 0.6)"
                        }}
                    >
                        <div style={{ display: "grid", gap: 4 }}>
                            <div style={{ fontSize: 22, fontWeight: 800, color: "#f8fafc" }}>
                                Ignition Tool Help
                            </div>
                            <div style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(226, 232, 240, 0.72)" }}>
                                Quick reference for drawing, bindings, widgets, and shortcuts in the Vizi Ignition tool.
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setHelpOpen(false)}
                            style={{
                                border: "1px solid rgba(71, 85, 105, 0.9)",
                                background: "rgba(15, 23, 42, 0.88)",
                                color: "#f8fafc",
                                minWidth: 32,
                                height: 32,
                                padding: "0 10px",
                                borderRadius: 999,
                                fontSize: 14,
                                fontWeight: 700,
                                cursor: "pointer"
                            }}
                        >
                            x
                        </button>
                    </div>
                    <div
                        className="vizi-scroll"
                        style={{
                            overflowY: "auto",
                            padding: 18,
                            display: "grid",
                            gap: 16
                        }}
                    >
                        {IGNITION_TOOL_HELP_SECTIONS.map((section) => (
                            <div
                                key={section.title}
                                style={{
                                    display: "grid",
                                    gap: 8,
                                    padding: 14,
                                    borderRadius: 16,
                                    border: "1px solid rgba(51, 65, 85, 0.72)",
                                    background: "rgba(15, 23, 42, 0.62)"
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: 12,
                                        fontWeight: 800,
                                        letterSpacing: "0.08em",
                                        textTransform: "uppercase",
                                        color: "#f8fafc"
                                    }}
                                >
                                    {section.title}
                                </div>
                                <div style={{ display: "grid", gap: 8 }}>
                                    {section.items.map((item) => (
                                        <div
                                            key={item}
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns: "10px 1fr",
                                                gap: 8,
                                                alignItems: "start",
                                                color: "rgba(226, 232, 240, 0.84)",
                                                fontSize: 13,
                                                lineHeight: 1.55
                                            }}
                                        >
                                            <span style={{ color: "#60a5fa" }}>•</span>
                                            <span>{item}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
