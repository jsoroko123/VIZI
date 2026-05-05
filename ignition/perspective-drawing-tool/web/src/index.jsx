import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CanvasSvg from "../../../../app/src/components/CanvasSvg.jsx";
import ImportModal from "../../../../app/src/components/ImportModal.jsx";
import { stripOuterSvg } from "../../../../app/src/utils/svgSanitize.js";
import PerspectiveViziCanvasBridge from "./PerspectiveViziCanvasBridge.jsx";

const { ComponentRegistry } = window.PerspectiveClient;
const COMPONENT_TYPE = "com.mesora.perspective.drawingtool";
const MODULE_ID = "com.mesora.perspective.drawing";
const MODULE_URL_ALIAS = "mesora-drawing";
const MODULE_RESOURCE_BASE = "/res/mesora-drawing";
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
const SVG_RAW_CACHE_MAX = 80;
const DEFAULT_FILL = "#D7DADE";
const DEFAULT_STROKE = "#808080";
const DEFAULT_CANVAS_WIDTH = 1668;
const DEFAULT_CANVAS_HEIGHT = 1401;
const LOCAL_CANVAS_ZOOM_MIN = 0.1;
const LOCAL_CANVAS_ZOOM_MAX = 4;
const LOCAL_CANVAS_ZOOM_STEP = 0.1;
const LOCAL_CANVAS_ZOOM_CACHE_PREFIX = "mesora-drawing:canvas-zoom:v1:";

function readTreeValue(tree, path, fallback) {
    try {
        if (typeof fallback === "string" && typeof tree.readString === "function") {
            return tree.readString(path, fallback);
        }
        if (typeof fallback === "number" && typeof tree.readNumber === "function") {
            return tree.readNumber(path, fallback);
        }
        if (typeof fallback === "boolean" && typeof tree.readBoolean === "function") {
            return tree.readBoolean(path, fallback);
        }
        if (Array.isArray(fallback) && typeof tree.readArray === "function") {
            return tree.readArray(path, fallback);
        }
        if (fallback && typeof fallback === "object" && typeof tree.readObject === "function") {
            return tree.readObject(path, fallback);
        }
        if (typeof tree.read === "function") {
            return tree.read(path, fallback);
        }
    } catch (_error) {
    }
    return fallback;
}

function isPlainObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
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

function getComponentPropSource(componentProps) {
    const nested = componentProps?.props;
    if (isPlainObject(nested)) {
        return nested;
    }
    return isPlainObject(componentProps) ? componentProps : {};
}

function cloneValue(value) {
    if (Array.isArray(value)) {
        return value.map(cloneValue);
    }
    if (isPlainObject(value)) {
        const out = {};
        Object.keys(value).forEach((key) => {
            out[key] = cloneValue(value[key]);
        });
        return out;
    }
    return value;
}

function resolvePath(source, path) {
    if (!path || !isPlainObject(source)) {
        return undefined;
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

function resolveBindings(element, data) {
    const resolved = cloneValue(element || {});
    const bindings = isPlainObject(resolved.bindings) ? resolved.bindings : {};

    Object.keys(bindings).forEach((propName) => {
        const binding = bindings[propName];
        if (typeof binding === "string") {
            const value = resolvePath(data, binding);
            if (value !== undefined) {
                resolved[propName] = value;
            }
            return;
        }
        if (isPlainObject(binding)) {
            const path = binding.path || binding.key || "";
            const value = resolvePath(data, path);
            if (value !== undefined) {
                resolved[propName] = value;
            } else if (Object.prototype.hasOwnProperty.call(binding, "fallback")) {
                resolved[propName] = binding.fallback;
            }
        }
    });

    return resolved;
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

function resolveOverlayPopupViewPath(overlay) {
    const popupViewName = normalizeOverlayPopupViewName(
        overlay?.eType
        || overlay?.name
        || overlay?.sourceKey
    );
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
        return cloneValue(value);
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

function coerceArray(value) {
    return Array.isArray(value) ? value : [];
}

function getIndexShapeBounds(shape) {
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
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        shape.points.forEach((point) => {
            const x = Number(point?.x || 0);
            const y = Number(point?.y || 0);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
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
    return {
        x: Number(shape.x || 0),
        y: Number(shape.y || 0),
        width: Math.max(0, Number(shape.width || 0)),
        height: Math.max(0, Number(shape.height || 0))
    };
}

function getIndexOverlayBounds(overlay) {
    const bbox = overlay?.bbox;
    if (!bbox || typeof bbox !== "object") {
        return null;
    }
    const scale = Math.max(0.0001, Math.abs(Number(overlay?.scale || 1)));
    return {
        x: Number(overlay?.tx || 0) + scale * Number(bbox.x || 0),
        y: Number(overlay?.ty || 0) + scale * Number(bbox.y || 0),
        width: Math.max(1, scale * Number(bbox.width || 0)),
        height: Math.max(1, scale * Number(bbox.height || 0))
    };
}

function expandIndexViewBoundsToFitContent(baseViewBounds, shapes, overlays, padding = 24) {
    const fallback = {
        x: Number(baseViewBounds?.x || 0),
        y: Number(baseViewBounds?.y || 0),
        width: Math.max(1, Number(baseViewBounds?.width || DEFAULT_CANVAS_WIDTH)),
        height: Math.max(1, Number(baseViewBounds?.height || DEFAULT_CANVAS_HEIGHT))
    };
    const boundsList = [
        ...coerceArray(shapes).map((shape) => getIndexShapeBounds(shape)),
        ...coerceArray(overlays).map((overlay) => getIndexOverlayBounds(overlay))
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

function buildElementProps(element) {
    const props = {
        key: element.id || element.name || `${element.type || "element"}-${Math.random().toString(36).slice(2, 9)}`
    };

    [
        "id",
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "cx",
        "cy",
        "r",
        "rx",
        "ry",
        "width",
        "height",
        "d",
        "fill",
        "stroke",
        "strokeWidth",
        "strokeDasharray",
        "strokeLinecap",
        "strokeLinejoin",
        "opacity",
        "transform",
        "points",
        "textAnchor",
        "dominantBaseline",
        "fontSize",
        "fontWeight",
        "fontFamily",
        "letterSpacing",
        "preserveAspectRatio",
        "href"
    ].forEach((name) => {
        if (element[name] !== undefined && element[name] !== null) {
            props[name] = element[name];
        }
    });

    if (isPlainObject(element.attrs)) {
        Object.assign(props, element.attrs);
    }

    return props;
}

function renderLegacyElement(element, data) {
    if (!isPlainObject(element)) {
        return null;
    }

    const next = resolveBindings(element, data);
    if (next.visible === false) {
        return null;
    }

    const type = String(next.type || "").toLowerCase();
    const props = buildElementProps(next);

    if (type === "group" || type === "g") {
        return (
            <g {...props}>
                {coerceArray(next.elements).map((child) => renderLegacyElement(child, data))}
            </g>
        );
    }

    if (type === "text") {
        const textValue = next.text == null ? "" : String(next.text);
        return <text {...props}>{textValue}</text>;
    }

    if (type === "rect" || type === "circle" || type === "ellipse" || type === "line" || type === "path" || type === "polyline" || type === "polygon" || type === "image") {
        return React.createElement(type, props);
    }

    return null;
}

function LegacyDocumentRenderer({
    backgroundColor,
    data,
    document,
    gridSize,
    preserveAspectRatio,
    showGrid
}) {
    const viewBox = normalizeViewBox(document);
    const parsedViewBox = parseViewBoxParts(viewBox);
    const gridStep = Math.max(4, Number(gridSize) || 20);

    const gridPath = useMemo(() => {
        if (!showGrid) {
            return "";
        }
        const commands = [];
        const maxX = parsedViewBox.x + parsedViewBox.width;
        const maxY = parsedViewBox.y + parsedViewBox.height;

        for (let x = parsedViewBox.x; x <= maxX; x += gridStep) {
            commands.push(`M ${x} ${parsedViewBox.y} L ${x} ${maxY}`);
        }
        for (let y = parsedViewBox.y; y <= maxY; y += gridStep) {
            commands.push(`M ${parsedViewBox.x} ${y} L ${maxX} ${y}`);
        }

        return commands.join(" ");
    }, [gridStep, parsedViewBox.height, parsedViewBox.width, parsedViewBox.x, parsedViewBox.y, showGrid]);

    return (
        <svg
            viewBox={viewBox}
            preserveAspectRatio={preserveAspectRatio || "xMidYMid meet"}
            style={{
                width: "100%",
                height: "100%",
                display: "block",
                background: backgroundColor || "#0f172a"
            }}
        >
            {showGrid && gridPath ? (
                <path
                    d={gridPath}
                    fill="none"
                    stroke="rgba(148, 163, 184, 0.22)"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                />
            ) : null}
            {coerceArray(document?.elements).map((element) => renderLegacyElement(element, data))}
        </svg>
    );
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

function detectPerspectiveRootComponent(props) {
    const nestedProps = getComponentPropSource(props);
    const componentPaths = [
        props?.store?.path,
        nestedProps?.store?.path
    ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    const scopes = [
        props?.store?.view?.page?.parent?.scope,
        nestedProps?.store?.view?.page?.parent?.scope,
        props?.store?.view?.page?.scope,
        nestedProps?.store?.view?.page?.scope
    ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

    return componentPaths.some((path) => scopes.some((scope) => path === `${scope}.0`));
}

function getPersistedArrayValue(props, key, fallback = EMPTY_ARRAY) {
    const source = getComponentPropSource(props);
    const hasDirectValue = Object.prototype.hasOwnProperty.call(source, key);
    const hasModelValue = isPlainObject(source?.model)
        && Object.prototype.hasOwnProperty.call(source.model, key);
    const direct = hasDirectValue ? source[key] : undefined;
    const modelValue = hasModelValue ? source.model[key] : undefined;

    // The bridge writes both top-level props and model props, but in practice
    // the model path is the more reliable one to rehydrate from after local edits.
    // Prefer an explicitly-present model array so widget/svg edits do not snap
    // back to stale top-level reducer values on the next render.
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

function getRootContainerProps(props) {
    const baseStyle = {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        flex: "1 1 auto",
        alignSelf: "stretch"
    };

    if (typeof props?.emit !== "function") {
        return { style: baseStyle };
    }

    try {
        const emitted = props.emit() || {};
        const emittedStyle = isPlainObject(emitted.style) ? emitted.style : {};
        return {
            ...emitted,
            style: {
                ...emittedStyle,
                ...baseStyle
            }
        };
    } catch (_error) {
        return { style: baseStyle };
    }
}

function createEmptyMap() {
    return Object.freeze({});
}

const EMPTY_MAP = createEmptyMap();
const EMPTY_ARRAY = Object.freeze([]);
const NOOP = () => {};
function getNodeArea(node) {
    if (!node || typeof node.getBoundingClientRect !== "function") {
        return -1;
    }
    const rect = node.getBoundingClientRect();
    return Math.max(0, Number(rect.width || 0)) * Math.max(0, Number(rect.height || 0));
}

function resolveComponentHostNode(ref, componentPath) {
    const node = ref?.current;
    const candidates = [];
    const seen = new Set();

    const addCandidate = (candidate) => {
        if (
            !candidate
            || seen.has(candidate)
            || typeof candidate.getBoundingClientRect !== "function"
        ) {
            return;
        }

        const rect = candidate.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) {
            return;
        }

        seen.add(candidate);
        candidates.push(candidate);
    };

    addCandidate(node);
    addCandidate(node?.closest?.("[data-component-path]"));
    addCandidate(node?.parentElement);

    const path = String(componentPath || "").trim();
    if (path && typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
        const selector = `[data-component-path="${escapeAttributeValue(path)}"]`;
        document.querySelectorAll(selector).forEach(addCandidate);
    }

    if (candidates.length === 0) {
        return null;
    }

    return candidates.sort((left, right) => getNodeArea(right) - getNodeArea(left))[0] || null;
}

function useElementRect(ref, active, componentPath) {
    const [rect, setRect] = useState(null);

    useLayoutEffect(() => {
        if (!active) {
            setRect(null);
            return undefined;
        }

        let frame = 0;
        let mounted = true;

        const resolveMeasuredNode = () => {
            return resolveComponentHostNode(ref, componentPath);
        };

        const update = () => {
            frame = 0;
            const node = resolveMeasuredNode();
            if (!mounted || !node || typeof node.getBoundingClientRect !== "function") {
                return;
            }

            const next = node.getBoundingClientRect();
            setRect((previous) => {
                if (
                    previous
                    && Math.abs(previous.left - next.left) < 0.5
                    && Math.abs(previous.top - next.top) < 0.5
                    && Math.abs(previous.width - next.width) < 0.5
                    && Math.abs(previous.height - next.height) < 0.5
                ) {
                    return previous;
                }
                return {
                    left: next.left,
                    top: next.top,
                    width: next.width,
                    height: next.height
                };
            });
        };

        const schedule = () => {
            if (!mounted || frame) {
                return;
            }
            frame = window.requestAnimationFrame(update);
        };

        schedule();

        const node = resolveMeasuredNode();
        const resizeObserver = typeof ResizeObserver !== "undefined" && node
            ? new ResizeObserver(() => {
                schedule();
            })
            : null;

        resizeObserver?.observe(node);
        window.addEventListener("resize", schedule, true);
        document.addEventListener("scroll", schedule, true);

        return () => {
            mounted = false;
            if (frame) {
                window.cancelAnimationFrame(frame);
            }
            resizeObserver?.disconnect();
            window.removeEventListener("resize", schedule, true);
            document.removeEventListener("scroll", schedule, true);
        };
    }, [active, componentPath, ref]);

    return rect;
}

function DesignerCanvasPortal({ active, anchorRef, componentPath, children }) {
    const rect = useElementRect(anchorRef, active, componentPath);

    if (!active || !rect || typeof document === "undefined" || !document.body) {
        return null;
    }

    return createPortal(
        <div
            style={{
                position: "fixed",
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                zIndex: 2147483000,
                pointerEvents: "auto"
            }}
        >
            {children}
        </div>,
        document.body
    );
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

            const nested = svg.querySelector("[eType],[etype],[data-etype]");
            const nestedValue =
                String(nested?.getAttribute?.("eType") || "").trim()
                || String(nested?.getAttribute?.("etype") || "").trim()
                || String(nested?.getAttribute?.("data-etype") || "").trim();
            if (nestedValue) {
                return nestedValue;
            }
        }
    } catch (_error) {
    }
    return inferETypeFromFileKey(fileKey);
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

function ViziCanvasBridge(props) {
    useDomThemeVersion();
    const rootRef = useRef(null);
    const svgRef = useRef(null);
    const svgRawCacheRef = useRef(new Map());
    const sourceDocument = isPlainObject(props.document) ? props.document : {};
    const hostSize = resolveCanvasHostSize(props);
    const defaultHostSize = resolveCanvasDefaultSize(props);
    const previewActive = detectPerspectivePreviewMode(props);
    const designerActive = detectPerspectiveDesignerMode(props);
    const editorVisible = designerActive && !previewActive;
    const isLiveMode = !designerActive || previewActive;
    const browserRuntimeMode = isLiveMode && !designerActive;
    const [rootSize, setRootSize] = useState(hostSize);
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
    const externalOverlaysKey = JSON.stringify(coerceArray(externalOverlays));
    const externalSelectedIdsKey = JSON.stringify(coerceArray(externalSelectedIds));
    const externalSelectedOverlayIdsKey = JSON.stringify(coerceArray(externalSelectedOverlayIds));
    const svgLibraryEnabled = Boolean(getModelValue(props, "svgLibraryEnabled", true));
    const [selectedIds, setSelectedIds] = useState(coerceArray(externalSelectedIds));
    const [selectedOverlayIds, setSelectedOverlayIds] = useState(coerceArray(externalSelectedOverlayIds));
    const [svgOverlays, setSvgOverlaysState] = useState(coerceArray(externalOverlays));
    const [svgCatalogFiles, setSvgCatalogFiles] = useState(EMPTY_ARRAY);
    const [svgLibraryError, setSvgLibraryError] = useState("");
    const [svgLibraryExternalDirectory, setSvgLibraryExternalDirectory] = useState("");
    const [svgLibraryExternalCount, setSvgLibraryExternalCount] = useState(0);
    const [svgLibraryRefreshing, setSvgLibraryRefreshing] = useState(false);
    const [svgLibraryUploading, setSvgLibraryUploading] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const svgCatalogRequestIdRef = useRef(0);
    const localZoomCacheKey = resolveCanvasZoomCacheKey(props);
    const [localZoom, setLocalZoom] = useState(() => readCachedCanvasZoom(resolveCanvasZoomCacheKey(props)));
    const runtimeDocumentViewBounds = useMemo(
        () => expandIndexViewBoundsToFitContent(documentViewBounds, externalShapes, svgOverlays),
        [
            documentViewBounds.x,
            documentViewBounds.y,
            documentViewBounds.width,
            documentViewBounds.height,
            externalShapes,
            svgOverlays
        ]
    );
    const viewBox = browserRuntimeMode ? runtimeDocumentViewBounds : responsiveViewBox;
    const stepCanvasZoom = useCallback((direction) => {
        const amount = Number(direction);
        if (!Number.isFinite(amount) || amount === 0) {
            return;
        }
        setLocalZoom((previous) => {
            const base = previous != null ? previous : 1;
            return normalizeLocalCanvasZoom(base + (amount * LOCAL_CANVAS_ZOOM_STEP));
        });
    }, []);

    useEffect(() => {
        setLocalZoom(readCachedCanvasZoom(localZoomCacheKey));
    }, [localZoomCacheKey]);

    useEffect(() => {
        writeCachedCanvasZoom(localZoomCacheKey, localZoom);
    }, [localZoomCacheKey, localZoom]);

    useEffect(() => {
        const node = rootRef.current;
        if (!node || typeof node.getBoundingClientRect !== "function") {
            return undefined;
        }

        const updateRootSize = () => {
            const rect = node.getBoundingClientRect();
            const width = toPositiveNumber(rect?.width) || hostSize.width;
            const height = toPositiveNumber(rect?.height) || hostSize.height;
            setRootSize((previous) => (
                previous.width === width && previous.height === height
                    ? previous
                    : { width, height }
            ));
        };

        updateRootSize();

        if (typeof ResizeObserver === "function") {
            const observer = new ResizeObserver(updateRootSize);
            observer.observe(node);
            return () => observer.disconnect();
        }

        if (typeof window !== "undefined") {
            window.addEventListener("resize", updateRootSize);
            return () => window.removeEventListener("resize", updateRootSize);
        }

        return undefined;
    }, [hostSize.height, hostSize.width]);

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
        const onWheelNonPassive = (event) => {
            if (!browserRuntimeMode) return;
            if (!event.altKey) return;
            if (!rootRef.current) return;
            if (!rootRef.current.contains(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            stepCanvasZoom(event.deltaY < 0 ? 1 : -1);
        };
        window.addEventListener("wheel", onWheelNonPassive, { passive: false, capture: true });
        return () => window.removeEventListener("wheel", onWheelNonPassive, { passive: false, capture: true });
    }, [browserRuntimeMode, stepCanvasZoom]);

    useEffect(() => {
        setSelectedIds(coerceArray(externalSelectedIds));
    }, [externalSelectedIdsKey]);

    useEffect(() => {
        setSelectedOverlayIds(coerceArray(externalSelectedOverlayIds));
    }, [externalSelectedOverlayIdsKey]);

    useEffect(() => {
        setSvgOverlaysState(coerceArray(externalOverlays));
    }, [externalOverlaysKey]);

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

    const persistSvgOverlays = useCallback(
        (nextOverlays) => {
            writeComponentProp(props, "svgOverlays", nextOverlays);
        },
        [props]
    );

    const setSvgOverlays = useCallback(
        (updater) => {
            setSvgOverlaysState((previous) => {
                const nextValue = typeof updater === "function" ? updater(previous) : updater;
                const normalized = coerceArray(nextValue);
                persistSvgOverlays(normalized);
                return normalized;
            });
        },
        [persistSvgOverlays]
    );

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

    const handleSvgMouseDown = useCallback(() => {
        setSelectedIds([]);
        setSelectedOverlayIds([]);
    }, []);

    const handleShapeMouseDown = useCallback((_event, id) => {
        setSelectedIds(id ? [String(id)] : []);
        setSelectedOverlayIds([]);
    }, []);

    const openOverlayPopup = useCallback((overlay) => {
        if (!overlay || overlay.widget) {
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
        const popupViewName = normalizeOverlayPopupViewName(
            overlay?.eType
            || overlay?.name
            || overlay?.sourceKey
        );
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

        if (Array.isArray(mounts.activePopups) && mounts.activePopups.some((popup) => popup?.id === popupId)) {
            if (typeof mounts.closePopup === "function") {
                mounts.closePopup(popupId);
            }
        }

        mounts.activatePopup({
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
        });
        if (typeof mounts.focusPopup === "function") {
            mounts.focusPopup(popupId);
        }
        return true;
    }, [props]);

    const handleOverlayMouseDown = useCallback((event, id) => {
        const overlayId = id ? String(id) : "";
        const overlay = svgOverlays.find((item) => String(item?.id || "") === overlayId);
        if (!overlay) {
            return;
        }

        if (editorVisible) {
            setSelectedOverlayIds([overlayId]);
            setSelectedIds([]);
            return;
        }

        event?.preventDefault?.();
        event?.stopPropagation?.();
        openOverlayPopup(overlay);
    }, [editorVisible, openOverlayPopup, setSelectedIds, setSelectedOverlayIds, svgOverlays]);

    const zoom = Number(getModelValue(props, "zoom", 1)) || 1;
    const pan = getModelValue(props, "pan", { x: 0, y: 0 });
    const showGrid = Boolean(getModelValue(props, "showGrid", false));
    const showRulers = Boolean(getModelValue(props, "showRulers", false));
    const tool = String(getModelValue(props, "tool", "select") || "select");
    const liveUpdatesEnabled = Boolean(getModelValue(props, "liveUpdatesEnabled", true));
    const liveClickable = Boolean(getModelValue(props, "liveClickable", false));
    const theme = getPerspectiveThemeName(props);
    const canvasBackgroundColor = getPerspectiveCanvasBackground(props, theme);

    const svgFiles = useMemo(
        () => svgCatalogFiles.map((entry) => ({ key: entry.key, name: entry.name })).sort((left, right) => left.name.localeCompare(right.name)),
        [svgCatalogFiles]
    );
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
    const svgLibraryHelpText = svgLibraryExternalDirectory
        ? `Import an SVG here, or drop .svg files into this folder and click Refresh:\n${svgLibraryExternalDirectory}`
        : "Import an SVG here; the external folder path will appear when the catalog loads.";
    const svgLibrarySummaryText = svgLibraryExternalCount > 0
        ? `${svgCatalogFiles.length} templates loaded, ${svgLibraryExternalCount} external`
        : `${svgCatalogFiles.length} templates loaded`;

    const handleImportToggle = useCallback(() => {
        if (!svgLibraryEnabled || !svgCatalogFiles.length) {
            return;
        }
        setImportOpen((current) => !current);
    }, [svgCatalogFiles.length, svgLibraryEnabled]);

    useEffect(() => {
        if (editorVisible) {
            return;
        }
        setImportOpen(false);
        setSelectedIds([]);
        setSelectedOverlayIds([]);
    }, [editorVisible]);

    const onPickSvg = useCallback(
        async (fileKey) => {
            const raw = await readSvgRawByKey(fileKey, { forceFresh: false });
            if (typeof raw !== "string") {
                return;
            }

            const parsed = stripOuterSvg(raw);
            if (!parsed?.inner) {
                return;
            }

            const keySize = extractKeySize(raw);
            const parsedEType = extractSvgEType(raw, fileKey);
            const baseViewBox = parsed.vb;
            let localViewBox = keySize
                ? { x: 0, y: 0, w: keySize.w, h: keySize.h }
                : baseViewBox;

            if (!localViewBox || !Number.isFinite(localViewBox.w) || !Number.isFinite(localViewBox.h) || localViewBox.w <= 0 || localViewBox.h <= 0) {
                localViewBox = { x: 0, y: 0, w: 100, h: 100 };
            }

            let inner = parsed.inner;
            if (keySize && baseViewBox?.w > 0 && baseViewBox?.h > 0) {
                const scaleX = keySize.w / baseViewBox.w;
                const scaleY = keySize.h / baseViewBox.h;
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
            const nextOverlay = {
                id,
                sourceKey: fileKey,
                name: fileKey.split("/").pop() || fileKey,
                inner,
                tx: anchor.x - (scale * srcCenterX),
                ty: anchor.y - (scale * srcCenterY),
                scale,
                fill: DEFAULT_FILL,
                stroke: DEFAULT_STROKE,
                strokeMode: "preserve",
                tagPath: "",
                eType: parsedEType,
                eTypeAuto: true,
                bbox: {
                    x: localViewBox.x,
                    y: localViewBox.y,
                    width: localViewBox.w,
                    height: localViewBox.h
                }
            };

            setSvgOverlays((previous) => [...coerceArray(previous), nextOverlay]);
            setSelectedOverlayIds([id]);
            setSelectedIds([]);
            setImportOpen(false);
        },
        [readSvgRawByKey, setSvgOverlays, viewBox.height, viewBox.width, viewBox.x, viewBox.y]
    );

    const overlayLocalBBox = useCallback((overlayId) => {
        const overlay = svgOverlays.find((item) => String(item?.id || "") === String(overlayId || ""));
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
    }, [svgOverlays]);

    const libraryButtonLabel = svgLibraryError
        ? "SVG Library Unavailable"
        : svgLibraryUploading
        ? "Importing SVG..."
        : svgLibraryRefreshing
        ? "Refreshing SVG Library..."
        : svgCatalogFiles.length > 0
        ? `SVG Library (${svgCatalogFiles.length})`
        : "Loading SVG Library...";
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
    const canvasContent = (
        <CanvasSvg
            svgRef={svgRef}
            zoom={isLiveMode ? 1 : zoom}
            pan={isLiveMode ? { x: 0, y: 0 } : (isPlainObject(pan) ? pan : { x: 0, y: 0 })}
            onWheel={NOOP}
            marquee={null}
            tool={tool}
            shapes={coerceArray(externalShapes)}
            setShapes={NOOP}
            selectedIds={editorVisible ? selectedIds : EMPTY_ARRAY}
            setSelectedIds={editorVisible ? setSelectedIds : NOOP}
            setSelectedOverlayIds={editorVisible ? setSelectedOverlayIds : NOOP}
            inlineEditId={null}
            selectedSegment={null}
            editingId={null}
            showTagPaths={false}
            showGrid={editorVisible && showGrid}
            showRulers={editorVisible && showRulers}
            useWindowPointerTracking={false}
            onSvgMouseDown={editorVisible ? handleSvgMouseDown : NOOP}
            onMouseMove={NOOP}
            onMouseUp={NOOP}
            onContextMenu={NOOP}
            onShapeMouseDown={editorVisible ? handleShapeMouseDown : NOOP}
            onShapeDoubleClick={NOOP}
            onEditPolylineClick={NOOP}
            onHandleMouseDown={NOOP}
            onHandleDoubleClick={NOOP}
            onHandleContextMenu={NOOP}
            onSegmentMouseDown={NOOP}
            vbW={viewBox.width}
            vbH={viewBox.height}
            svgOverlays={svgOverlays}
            setSvgOverlays={setSvgOverlays}
            selectedOverlayIds={editorVisible ? selectedOverlayIds : EMPTY_ARRAY}
            singleSelectedOverlayId={editorVisible && selectedOverlayIds.length === 1 ? selectedOverlayIds[0] : null}
            setOverlayRef={NOOP}
            onOverlayMouseDown={handleOverlayMouseDown}
            onOverlayDoubleClick={NOOP}
            overlaySelectionUI={null}
            overlayGroupSelectionUI={null}
            shapeSelectionUI={null}
            mixedSelectionUI={null}
            overlayLocalBBox={overlayLocalBBox}
            importAnchor={null}
            onCanvasDoubleClick={NOOP}
            tagStateColorsByPath={EMPTY_MAP}
            routeColorsBySvgKey={EMPTY_MAP}
            routeStrokeColorByGroupPath={EMPTY_MAP}
            svgLiveValuesByGroupPath={EMPTY_MAP}
            liveTagKeys={coerceArray(getModelValue(props, "liveTagKeys", EMPTY_ARRAY))}
            opcTags={coerceArray(getModelValue(props, "opcTags", EMPTY_ARRAY))}
            opcTemplateMap={EMPTY_MAP}
            opcTagMappingMap={EMPTY_MAP}
            opcMappingSetMap={EMPTY_MAP}
            widgetDbValues={EMPTY_MAP}
            binProductLabelByOverlayId={EMPTY_MAP}
            binNameLabelByOverlayId={EMPTY_MAP}
            binLevelRatioByOverlayId={EMPTY_MAP}
            binLockedInByOverlayId={EMPTY_MAP}
            binLockedOutByOverlayId={EMPTY_MAP}
            onWidgetDurationPresetChange={NOOP}
            onTrendTagDrop={NOOP}
            hiddenTagBubbleIds={EMPTY_ARRAY}
            onHideTagBubble={NOOP}
            onSvgDoubleClick={NOOP}
            collaboratorCursors={EMPTY_ARRAY}
            liveUpdatesEnabled={liveUpdatesEnabled}
            interactionActive={false}
            theme={theme}
            canvasBackgroundColor={canvasBackgroundColor}
            liveClickable={liveClickable}
            isLiveMode={isLiveMode}
            preserveAspectRatioMode="xMinYMin meet"
            forceStaticVisuals={!editorVisible}
            viewportTopOffset={0}
            viewportLeftOffset={0}
            viewportScrollTarget={null}
            onViewportScroll={NOOP}
            absoluteViewportLayout={false}
        />
    );

    return (
        <div
            ref={rootRef}
            style={{
                position: "relative",
                display: "flex",
                width: "100%",
                height: "100%",
                minWidth: 0,
                minHeight: 0,
                flex: "1 1 auto",
                alignSelf: "stretch",
                overflow: "hidden",
                ...(browserRuntimeMode ? {
                    alignItems: "flex-start",
                    justifyContent: "flex-start",
                    overflowX: "auto",
                    overflowY: "hidden"
                } : {})
            }}
        >
            {browserRuntimeMode ? (
                <div
                    style={{
                        width: Math.max(1, Number(viewBox.width) || 1) * runtimeCanvasZoom,
                        height: Math.max(1, Number(viewBox.height) || 1) * runtimeCanvasZoom,
                        flexShrink: 0,
                        position: "relative",
                        transformOrigin: "top left"
                    }}
                >
                    {canvasContent}
                </div>
            ) : canvasContent}

            {editorVisible && svgLibraryEnabled ? (
                <div
                    style={{
                        position: "absolute",
                        top: 12,
                        right: 12,
                        zIndex: 50,
                        display: "grid",
                        gap: 8,
                        maxWidth: 320
                    }}
                >
                    <button
                        type="button"
                        onClick={handleImportToggle}
                        disabled={svgCatalogFiles.length === 0}
                        style={{
                            border: "1px solid rgba(148, 163, 184, 0.35)",
                            background: "rgba(15, 23, 42, 0.88)",
                            color: "#f8fafc",
                            borderRadius: 999,
                            padding: "10px 14px",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: svgCatalogFiles.length > 0 ? "pointer" : "default",
                            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.2)",
                            opacity: svgCatalogFiles.length > 0 ? 1 : 0.76
                        }}
                    >
                        {libraryButtonLabel}
                    </button>

                    {svgLibraryError ? (
                        <div
                            style={{
                                border: "1px solid rgba(239, 68, 68, 0.32)",
                                background: "rgba(127, 29, 29, 0.92)",
                                color: "#fee2e2",
                                borderRadius: 14,
                                padding: "10px 12px",
                                fontSize: 11,
                                lineHeight: 1.4
                            }}
                        >
                            {svgLibraryError}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {editorVisible && svgLibraryEnabled && importOpen ? (
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
                />
            ) : null}
        </div>
    );
}

function hasViziCanvasModel(props) {
    const shapes = getPersistedArrayValue(props, "shapes", EMPTY_ARRAY);
    const overlays = getPersistedArrayValue(props, "svgOverlays", EMPTY_ARRAY);
    const forceViziCanvas = Boolean(getModelValue(props, "forceViziCanvas", false));
    const svgLibraryEnabled = Boolean(getModelValue(props, "svgLibraryEnabled", true));
    return forceViziCanvas
        || svgLibraryEnabled
        || (Array.isArray(shapes) && shapes.length > 0)
        || (Array.isArray(overlays) && overlays.length > 0);
}

function MesoraDrawingTool(props) {
    useDomThemeVersion();
    const rootProps = getRootContainerProps(props);
    const viewProps = getComponentPropSource(props);
    const rootRef = useRef(null);
    const previewActive = detectPerspectivePreviewMode(props);
    const designerActive = detectPerspectiveDesignerMode(props);
    const rootRuntimeComponent = !designerActive && detectPerspectiveRootComponent(props);
    const useDesignerPortal = designerActive && !previewActive && hasViziCanvasModel(props);
    const rootTheme = getPerspectiveThemeName(props);
    const rootBackgroundColor = getPerspectiveCanvasBackground(props, rootTheme);
    const defaultViewSize = resolveCanvasDefaultSize(props);
    const rootRuntimeHeight = toPositiveNumber(defaultViewSize?.height)
        ? `${defaultViewSize.height}px`
        : "100dvh";
    const fillViewport = rootRuntimeComponent;
    const componentPath = String(
        rootProps["data-component-path"]
        || props?.store?.path
        || viewProps?.store?.path
        || ""
    ).trim();

    if (hasViziCanvasModel(props)) {
        const editorContent = (
            <BridgeErrorBoundary fallback={<ViziCanvasBridge {...props} />}>
                <PerspectiveViziCanvasBridge {...props} />
            </BridgeErrorBoundary>
        );

        return (
            <div
                {...rootProps}
                ref={rootRef}
                style={{
                    ...(isPlainObject(rootProps.style) ? rootProps.style : {}),
                    position: fillViewport ? "fixed" : "relative",
                    left: fillViewport ? 0 : undefined,
                    top: fillViewport ? 0 : undefined,
                    right: fillViewport ? 0 : undefined,
                    bottom: fillViewport ? 0 : undefined,
                    width: fillViewport ? "100dvw" : undefined,
                    height: fillViewport ? rootRuntimeHeight : undefined,
                    minWidth: fillViewport ? "100vw" : undefined,
                    minHeight: fillViewport ? rootRuntimeHeight : undefined,
                    overflow: "hidden",
                    background: rootBackgroundColor
                }}
            >
                {useDesignerPortal ? (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            minWidth: "100%",
                            minHeight: "100%",
                            background: rootBackgroundColor,
                            pointerEvents: "none"
                        }}
                    />
                ) : editorContent}
                <DesignerCanvasPortal
                    active={useDesignerPortal}
                    anchorRef={rootRef}
                    componentPath={componentPath}
                >
                    {editorContent}
                </DesignerCanvasPortal>
            </div>
        );
    }

    return (
        <div {...rootProps}>
            <LegacyDocumentRenderer
                document={viewProps.document}
                data={viewProps.data}
                backgroundColor={rootBackgroundColor}
                showGrid={viewProps.showGrid}
                gridSize={viewProps.gridSize}
                preserveAspectRatio={viewProps.preserveAspectRatio}
            />
        </div>
    );
}

class DrawingToolMeta {
    getComponentType() {
        return COMPONENT_TYPE;
    }

    getViewComponent() {
        return MesoraDrawingTool;
    }

    getDefaultSize() {
        return {
            width: "100%",
            height: "100dvh"
        };
    }

    getPropsReducer(tree) {
        return {
            document: readTreeValue(tree, "document", { viewBox: `0 0 ${DEFAULT_CANVAS_WIDTH} ${DEFAULT_CANVAS_HEIGHT}`, elements: [] }),
            data: readTreeValue(tree, "data", {}),
            model: readTreeValue(tree, "model", {}),
            shapes: readTreeValue(tree, "shapes", []),
            svgOverlays: readTreeValue(tree, "svgOverlays", []),
            zoom: readTreeValue(tree, "zoom", 1),
            pan: readTreeValue(tree, "pan", { x: 0, y: 0 }),
            tool: readTreeValue(tree, "tool", "select"),
            forceViziCanvas: readTreeValue(tree, "forceViziCanvas", false),
            svgLibraryEnabled: readTreeValue(tree, "svgLibraryEnabled", true),
            backgroundColor: readTreeValue(tree, "backgroundColor", ""),
            showGrid: readTreeValue(tree, "showGrid", false),
            gridSize: readTreeValue(tree, "gridSize", 20),
            preserveAspectRatio: readTreeValue(tree, "preserveAspectRatio", "xMinYMin slice"),
            panZoomEnabled: readTreeValue(tree, "panZoomEnabled", false),
            showRulers: readTreeValue(tree, "showRulers", false),
            showTagPaths: readTreeValue(tree, "showTagPaths", false),
            selectionMode: readTreeValue(tree, "selectionMode", "all"),
            liveUpdatesEnabled: readTreeValue(tree, "liveUpdatesEnabled", true),
            liveClickable: readTreeValue(tree, "liveClickable", false),
            theme: readTreeValue(tree, "theme", ""),
            liveTagKeys: readTreeValue(tree, "liveTagKeys", []),
            opcTags: readTreeValue(tree, "opcTags", [])
        };
    }
}

class BridgeErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        try {
            console.error("Mesora Perspective Drawing component error", error, info);
        } catch (_error) {
        }
    }

    render() {
        if (this.state.error) {
            const message = String(this.state.error?.message || this.state.error || "Unknown component error.");
            if (this.props.fallback) {
                return (
                    <div style={{ position: "relative", width: "100%", height: "100%" }}>
                        {this.props.fallback}
                        <div
                            style={{
                                position: "absolute",
                                right: 12,
                                bottom: 12,
                                maxWidth: 420,
                                boxSizing: "border-box",
                                padding: "10px 12px",
                                borderRadius: 14,
                                border: "1px solid rgba(239, 68, 68, 0.35)",
                                background: "rgba(127, 29, 29, 0.94)",
                                color: "#fee2e2",
                                fontFamily: "system-ui, sans-serif",
                                fontSize: 12,
                                lineHeight: 1.45,
                                boxShadow: "0 16px 32px rgba(15, 23, 42, 0.3)",
                                zIndex: 80
                            }}
                        >
                            <div style={{ fontWeight: 800, marginBottom: 4 }}>
                                Advanced tools hit an error
                            </div>
                            <div>Showing the stable canvas fallback for now.</div>
                            <div style={{ marginTop: 4, opacity: 0.9 }}>{message}</div>
                        </div>
                    </div>
                );
            }

            return (
                <div
                    style={{
                        width: "100%",
                        height: "100%",
                        boxSizing: "border-box",
                        padding: 16,
                        border: "1px solid rgba(239, 68, 68, 0.35)",
                        background: "rgba(127, 29, 29, 0.92)",
                        color: "#fee2e2",
                        fontFamily: "system-ui, sans-serif",
                        fontSize: 13,
                        lineHeight: 1.45,
                        overflow: "auto"
                    }}
                >
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>Vizi Drawing Tool Error</div>
                    <div>{message}</div>
                </div>
            );
        }

        return this.props.children;
    }
}

ComponentRegistry.register(new DrawingToolMeta());
