import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CanvasSvg from "../../../../app/src/components/CanvasSvg.jsx";
import ImportModal from "../../../../app/src/components/ImportModal.jsx";
import WidgetSelectorModal from "../../../../app/src/components/WidgetSelectorModal.jsx";
import { stripOuterSvg } from "../../../../app/src/utils/svgSanitize.js";
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
const SVG_RAW_CACHE_MAX = 80;
const DEFAULT_FILL = "#CCCCCC";
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
const CANVAS_RULER_SIZE = 24;
const PROPERTY_PANEL_WIDTH = 300;
const PROPERTY_PANEL_HEIGHT = 520;
const PROPERTY_PANEL_MIN_HEIGHT = 240;
const QUICK_TAG_PANEL_WIDTH = 360;
const QUICK_TAG_PANEL_HEIGHT = 124;
const TOOLBAR_WIDTH = 220;
const COLLAPSED_TOOLBAR_WIDTH = 116;
const TOOLBAR_INSET = 16;
const TOOLBAR_DRAWER_GAP = -6;
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
            "Use Polyline to draw process flow. Left click adds segments, right click removes the current segment, and double click or Enter finishes the line.",
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

function coerceArray(value) {
    return Array.isArray(value) ? value : [];
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

        const key = path.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);

        const provider = String(entry?.provider || "").trim()
            || ((path.match(/^\[([^\]]+)\]/)?.[1] || "").trim());

        out.push({
            path,
            provider: provider || "Tags",
            name: String(entry?.name || "").trim() || path,
            objectType: String(entry?.objectType || "").trim(),
            typeId: String(entry?.typeId || "").trim(),
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
            const color = String(entry?.color ?? "").trim();
            const mappingValue = String(
                entry?.value
                ?? entry?.state
                ?? entry?.field
                ?? entry?.input
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

function updateSvgInnerStrokeWidth(inner, strokeWidth) {
    if (!inner) return inner;
    const sw = Number.parseFloat(strokeWidth);
    if (!Number.isFinite(sw) || sw <= 0) return inner;
    const value = String(sw);

    let next = String(inner);
    next = next.replace(/stroke-width\s*=\s*['"][^'"]*['"]/gi, `stroke-width="${value}"`);
    next = next.replace(/stroke-width\s*:\s*[^;\"']+/gi, `stroke-width:${value}`);
    next = next.replace(/vector-effect\s*=\s*['"][^'"]*['"]/gi, 'vector-effect="non-scaling-stroke"');
    next = next.replace(/vector-effect\s*:\s*[^;\"']+/gi, "vector-effect:non-scaling-stroke");

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
                nextAttrs += ' vector-effect="non-scaling-stroke"';
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
    return String(overlay?.eType || "").trim().toLowerCase().includes("diverter");
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

function normalizeIgnitionTagValues(payload) {
    const out = new Map();

    coerceArray(payload?.values ?? payload).forEach((entry) => {
        const path = String(entry?.path ?? "").trim();
        if (!path) {
            return;
        }
        out.set(path, entry?.value ?? null);
        out.set(path.toLowerCase(), entry?.value ?? null);
    });

    return out;
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

function isBinOverlay(overlay) {
    const eType = String(overlay?.eType || overlay?.name || "").trim().toLowerCase();
    return eType === "bin" || eType.startsWith("bin");
}

function getIgnitionTagValue(tagValMap, basePath, member) {
    const full = `${basePath}/${member}`;
    return tagValMap.get(full) ?? tagValMap.get(full.toLowerCase()) ?? null;
}

function toPositiveNumber(value) {
    const next = Number(value);
    return Number.isFinite(next) && next > 0 ? next : null;
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
    const targetWidth = toPositiveNumber(availableBrowserWidth || hostWidth) || targetViewWidth;
    const targetHeight = toPositiveNumber(availableBrowserHeight || hostHeight) || targetViewHeight;
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
    return popupViewName ? `Popups/${popupViewName}` : "";
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
        <div style={{ display: "grid", gap: 8 }}>
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
            <div style={{ display: "grid", gap: 8 }}>
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
                borderRadius: 12,
                padding: "10px 12px",
                minHeight: 40,
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: disabled ? "default" : "pointer",
                fontSize: 13,
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
        && Boolean(target.closest("[data-vizi-properties-panel='1'], [data-vizi-import-drawer='1'], [data-vizi-widget-drawer='1'], [data-vizi-dropdown='1'], [data-vizi-dropdown-menu='1']"));
}

function stopInteractivePropagation(event) {
    event?.stopPropagation?.();
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

function EditorDropdownField({
    disabled = false,
    helperText = "",
    helperTone = "muted",
    label,
    onChange,
    placeholder = "Select...",
    sections = EMPTY_ARRAY,
    value = ""
}) {
    const rootRef = useRef(null);
    const [open, setOpen] = useState(false);
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
                            setOpen((current) => !current);
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
                        {normalizedSections.map((section, sectionIndex) => (
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
    value = ""
}) {
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const searchRef = useRef(null);
    const lastAutoOpenTokenRef = useRef(0);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [menuRect, setMenuRect] = useState(null);
    const currentValue = value == null ? "" : String(value);
    const normalizedOptions = useMemo(
        () => coerceArray(options).map((option) => {
            const path = String(option?.path || "").trim();
            if (!path) {
                return null;
            }
            const provider = String(option?.provider || "Tags").trim() || "Tags";
            const name = String(option?.name || "").trim() || path;
            return {
                value: path,
                path,
                provider,
                name,
                searchText: `${provider} ${name} ${path}`.toLowerCase()
            };
        }).filter(Boolean),
        [options]
    );
    const groupedOptions = useMemo(
        () => normalizedOptions.reduce((acc, option) => {
            if (!acc[option.provider]) {
                acc[option.provider] = [];
            }
            acc[option.provider].push(option);
            return acc;
        }, {}),
        [normalizedOptions]
    );
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
                items: filteredOptions
            }
        ]
        : Object.keys(groupedOptions).map((provider) => ({
            label: provider,
            items: groupedOptions[provider]
        }));
    const triggerLabel = selectedOption?.path
        || (currentValue ? `${currentValue} (current)` : "Select tag...");
    const resultSummary = loading
        ? "Loading Ignition tags..."
        : !loaded
            ? "Open to load Ignition tags"
            : queryText
                ? `${filteredOptions.length} match${filteredOptions.length === 1 ? "" : "es"}`
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
                    >
                        <div style={{ display: "grid", gap: 6 }}>
                            <input
                                ref={searchRef}
                                type="text"
                                value={query}
                                placeholder="Search tags by name, path, or provider..."
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
                            className="vizi-scroll"
                            style={{
                                display: "grid",
                                gap: 6,
                                maxHeight: Math.max(120, Number(menuRect.maxHeight || 320) - 68),
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
                                        return (
                                            <button
                                                key={`${section.label || "option"}-${item.value}`}
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
                                                    {item.path}
                                                </span>
                                            </button>
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
    const scale = Math.max(0.0001, Math.abs(Number(overlay?.scale || 1)));
    return {
        x: Number(overlay?.tx || 0) + scale * Number(bbox.x || 0),
        y: Number(overlay?.ty || 0) + scale * Number(bbox.y || 0),
        width: Math.max(1, scale * Number(bbox.width || 0)),
        height: Math.max(1, scale * Number(bbox.height || 0))
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

function worldFromLocal(overlay, x, y) {
    const scale = overlayScale(overlay);
    return {
        x: Number(overlay?.tx || 0) + scale * Number(x || 0),
        y: Number(overlay?.ty || 0) + scale * Number(y || 0)
    };
}

function distance(left, right) {
    const dx = Number(left?.x || 0) - Number(right?.x || 0);
    const dy = Number(left?.y || 0) - Number(right?.y || 0);
    return Math.hypot(dx, dy);
}

export default function PerspectiveViziCanvasBridge(props) {
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
    const externalShowRulers = Boolean(getModelValue(props, "showRulers", false));
    const externalShowTagPaths = Boolean(getModelValue(props, "showTagPaths", false));
    const externalSelectionMode = String(getModelValue(props, "selectionMode", "all") || "all");
    const externalStrokeNormalizeWidthRaw = Number(getModelValue(props, "strokeNormalizeWidth", NORMALIZED_SVG_STROKE_WIDTH));
    const externalStrokeNormalizeWidth = Number.isFinite(externalStrokeNormalizeWidthRaw) && externalStrokeNormalizeWidthRaw > 0
        ? externalStrokeNormalizeWidthRaw
        : NORMALIZED_SVG_STROKE_WIDTH;
    const svgLibraryEnabled = Boolean(getModelValue(props, "svgLibraryEnabled", true));
    const externalShapesKey = JSON.stringify(coerceArray(externalShapes));
    const externalOverlaysKey = JSON.stringify(coerceArray(externalOverlays));
    const externalSelectedIdsKey = JSON.stringify(coerceArray(externalSelectedIds));
    const externalSelectedOverlayIdsKey = JSON.stringify(coerceArray(externalSelectedOverlayIds));
    const [shapes, setShapesState] = useState(coerceArray(externalShapes));
    const [svgOverlays, setSvgOverlaysState] = useState(coerceArray(externalOverlays));
    const [selectedIds, setSelectedIds] = useState(coerceArray(externalSelectedIds));
    const [selectedOverlayIds, setSelectedOverlayIds] = useState(coerceArray(externalSelectedOverlayIds));
    const [tool, setToolState] = useState(externalTool);
    const [showGrid, setShowGridState] = useState(externalShowGrid);
    const [toolbarCollapsed, setToolbarCollapsedState] = useState(externalToolbarCollapsed);
    const [showRulers, setShowRulersState] = useState(externalShowRulers);
    const [showTagPaths, setShowTagPathsState] = useState(externalShowTagPaths);
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
    const [ignitionTagOptions, setIgnitionTagOptions] = useState(EMPTY_ARRAY);
    const [ignitionTagValuesByPath, setIgnitionTagValuesByPath] = useState(() => new Map());
    const [ignitionTagsError, setIgnitionTagsError] = useState("");
    const [ignitionTagsLoading, setIgnitionTagsLoading] = useState(false);
    const [ignitionTagsLoaded, setIgnitionTagsLoaded] = useState(false);
    const [quickTagPickerState, setQuickTagPickerState] = useState({
        overlayId: "",
        nonce: 0,
        clientX: 0,
        clientY: 0
    });
    const [importOpen, setImportOpen] = useState(false);
    const [widgetOpen, setWidgetOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [propertiesSelectionKey, setPropertiesSelectionKey] = useState("");
    const shapesRef = useRef(coerceArray(externalShapes));
    const overlaysRef = useRef(coerceArray(externalOverlays));
    const clipboardRef = useRef({ shapes: [], overlays: [], pasteCount: 0 });
    const historyRef = useRef({ past: [], future: [], current: null });
    const historyRestoreRef = useRef(false);
    const svgCatalogRequestIdRef = useRef(0);
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

    useEffect(() => {
        shapesRef.current = shapes;
    }, [shapes]);

    useEffect(() => {
        overlaysRef.current = svgOverlays;
    }, [svgOverlays]);

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
        setToolbarCollapsedState(externalToolbarCollapsed);
    }, [externalToolbarCollapsed]);

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

        coerceArray(svgOverlays).forEach((overlay) => {
            addPath(getOverlayFillBindingTagPath(overlay));
            const basePath = String(overlay?.tagPath || getOverlayFillBindingTagPath(overlay) || "").trim();
            addPath(basePath);
            if (basePath && isBinOverlay(overlay)) {
                BIN_UDT_MEMBERS.forEach((member) => addPath(`${basePath}/${member}`));
            }
        });

        coerceArray(shapes).forEach((shape) => {
            addPath(String(shape?.tagPath || "").trim());
        });

        return out;
    }, [svgOverlays, shapes]);
    const overlayFillBindingPathsKey = JSON.stringify(overlayFillBindingPaths);
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
        if (!overlayFillBindingPaths.length) {
            setIgnitionTagValuesByPath((previous) => (previous.size ? new Map() : previous));
            return undefined;
        }

        let cancelled = false;
        let timerId = 0;
        const queryValue = encodeURIComponent(JSON.stringify(overlayFillBindingPaths));

        const loadIgnitionTagValues = async () => {
            for (const routePath of MODULE_TAG_VALUE_ROUTE_CANDIDATES) {
                try {
                    const response = await fetch(`${routePath}?paths=${queryValue}`, {
                        cache: "no-store",
                        credentials: "same-origin"
                    });
                    if (!response.ok) {
                        continue;
                    }

                    const payload = await response.json();
                    if (cancelled) {
                        return;
                    }

                    setIgnitionTagValuesByPath(normalizeIgnitionTagValues(payload));
                    return;
                } catch (_error) {
                }
            }

            if (!cancelled) {
                setIgnitionTagValuesByPath(new Map());
            }
        };

        loadIgnitionTagValues();

        if (typeof window !== "undefined" && typeof window.setInterval === "function") {
            timerId = window.setInterval(loadIgnitionTagValues, 1000);
        }

        return () => {
            cancelled = true;
            if (timerId && typeof window !== "undefined" && typeof window.clearInterval === "function") {
                window.clearInterval(timerId);
            }
        };
    }, [overlayFillBindingPathsKey]);

    const persistValue = useCallback(
        (path, value) => {
            writeComponentProp(props, path, value);
        },
        [props]
    );

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
    const handleRefreshSvgLibrary = useCallback(() => {
        loadSvgCatalog();
    }, [loadSvgCatalog]);
    const svgLibraryHelpText = svgLibraryExternalDirectory
        ? `Drop .svg files into this folder and click Refresh:\n${svgLibraryExternalDirectory}`
        : "External SVG folder path will appear here when the catalog loads.";
    const svgLibrarySummaryText = svgLibraryExternalCount > 0
        ? `${svgCatalogFiles.length} templates loaded, ${svgLibraryExternalCount} external`
        : `${svgCatalogFiles.length} templates loaded`;

    const zoom = Number(getModelValue(props, "zoom", 1)) || 1;
    const pan = getModelValue(props, "pan", { x: 0, y: 0 });
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
    const liveUpdatesEnabled = Boolean(getModelValue(props, "liveUpdatesEnabled", true));
    const liveClickable = Boolean(getModelValue(props, "liveClickable", false));

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

    const theme = String(getModelValue(props, "theme", "light") || "light");
    const canvasBackgroundColor = String(
        getModelValue(
            props,
            "canvasBackgroundColor",
            getModelValue(props, "backgroundColor", "#0f172a")
        ) || "#0f172a"
    );

    const pointFromEvent = useCallback((event) => {
        const svg = svgRef.current;
        if (!svg) {
            return { x: viewBox.width / 2, y: viewBox.height / 2 };
        }

        let svgX;
        let svgY;
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

        if (!Number.isFinite(svgX) || !Number.isFinite(svgY)) {
            const rect = svg.getBoundingClientRect?.();
            if (!rect || rect.width <= 0 || rect.height <= 0) {
                return { x: viewBox.width / 2, y: viewBox.height / 2 };
            }
            svgX = (((Number(event?.clientX || 0) - Number(rect.left || 0)) / rect.width) * viewBox.width);
            svgY = (((Number(event?.clientY || 0) - Number(rect.top || 0)) / rect.height) * viewBox.height);
        }

        const nextX = (svgX - Number(pan?.x || 0)) / zoom;
        const nextY = (svgY - Number(pan?.y || 0)) / zoom;

        return {
            x: Math.max(0, Math.min(viewBox.width, nextX)),
            y: Math.max(0, Math.min(viewBox.height, nextY))
        };
    }, [pan, viewBox.height, viewBox.width, zoom]);

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
    const quickTagPickerOverlay = useMemo(
        () => svgOverlays.find((overlay) => String(overlay?.id || "") === String(quickTagPickerState?.overlayId || "")) || null,
        [quickTagPickerState, svgOverlays]
    );
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

    const closeQuickTagPicker = useCallback(() => {
        setQuickTagPickerState({
            overlayId: "",
            nonce: 0,
            clientX: 0,
            clientY: 0
        });
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

    const pasteClipboard = useCallback(() => {
        const clipboard = clipboardRef.current;
        const shapeCopies = coerceArray(clipboard?.shapes);
        const overlayCopies = coerceArray(clipboard?.overlays);
        if (!shapeCopies.length && !overlayCopies.length) {
            return;
        }

        const pasteCount = Number(clipboard?.pasteCount || 0) + 1;
        const dx = 20 * pasteCount;
        const dy = 20 * pasteCount;
        const nextShapeIds = [];
        const nextOverlayIds = [];

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
        return {
            id,
            sourceKey: fileKey,
            name: overlayName,
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
            },
            ...extraOverlay
        };
    }, [viewBox.height, viewBox.width, viewBox.x, viewBox.y]);

    const onPickSvg = useCallback(async (fileKey) => {
        const raw = await readSvgRawByKey(fileKey, { forceFresh: false });
        const nextOverlay = createOverlayFromRawMarkup(raw, { fileKey });
        if (!nextOverlay) {
            return;
        }

        updateSvgOverlays((previous) => [...previous, nextOverlay], { persist: true });
        setSelectedOverlayIds([nextOverlay.id]);
        setSelectedIds([]);
        setImportOpen(false);
        setWidgetOpen(false);
    }, [createOverlayFromRawMarkup, readSvgRawByKey, updateSvgOverlays]);

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

    const onPickWidget = useCallback((widgetKey) => {
        const template = widgetTemplate(widgetKey);
        const nextOverlay = createOverlayFromRawMarkup(template?.raw, {
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

        updateSvgOverlays((previous) => [...previous, nextOverlay], { persist: true });
        setSelectedOverlayIds([nextOverlay.id]);
        setSelectedIds([]);
        setImportOpen(false);
        setWidgetOpen(false);
    }, [createOverlayFromRawMarkup, updateSvgOverlays]);

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
        closePropertiesPanel();
        const shapeId = String(id || "");
        const shape = shapesRef.current.find((item) => String(item?.id || "") === shapeId);

        if (!shape || !isShapeSelectableByMode(shape)) {
            return;
        }

        if (tool !== "select") {
            return;
        }

        if (event?.shiftKey) {
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
            return;
        }

        const alreadySelected = selectedIds.includes(shapeId);
        const dragShapeIds = alreadySelected ? coerceArray(selectedIds) : [shapeId];
        const dragOverlayIds = alreadySelected ? coerceArray(selectedOverlayIds) : EMPTY_ARRAY;

        setSelectedIds(dragShapeIds);
        setSelectedOverlayIds(dragOverlayIds);
        setSelectedSegment(null);
        if (!alreadySelected) {
            setEditingId(null);
            return;
        }

        beginSelectionDrag(pointFromEvent(event), dragShapeIds, dragOverlayIds);
    }, [beginSelectionDrag, closePropertiesPanel, editingId, isShapeSelectableByMode, pointFromEvent, selectedIds, selectedOverlayIds, startOrAppendPolylineAt, tool]);

    const handleOverlayMouseDown = useCallback((event, id) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (tool === "polyline" || tool === "trunkconn") {
            startOrAppendPolylineAt(pointFromEvent(event), event);
            return;
        }
        closePropertiesPanel();
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
        if (!alreadySelected) {
            return;
        }

        beginSelectionDrag(pointFromEvent(event), dragShapeIds, dragOverlayIds);
    }, [beginSelectionDrag, closePropertiesPanel, overlaysSelectable, pointFromEvent, selectedIds, selectedOverlayIds, startOrAppendPolylineAt, tool]);

    const handleShapeDoubleClick = useCallback((event, id) => {
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
        const selectionKey = `overlay:${overlayId}`;
        openPropertiesForSelection(selectionKey);
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

        setSelectedOverlayIds([overlayId]);
        setSelectedIds([]);
        setEditingId(null);
        setSelectedSegment(null);
        closePropertiesPanel();
        setQuickTagPickerState({
            overlayId,
            nonce: Date.now(),
            clientX: Number(event?.clientX || 0),
            clientY: Number(event?.clientY || 0)
        });
    }, [closePropertiesPanel, overlaysSelectable, tool]);

    const openOverlayPopup = useCallback((overlay) => {
        if (!overlay || overlay.widget || overlay.embeddedView) {
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

        const popupConfig = {
            id: popupId,
            viewPath,
            viewParams: {
                overlayId,
                eType: popupViewName,
                name: popupTitle,
                tagPath: String(overlay?.tagPath || "").trim()
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
        if (!overlay || overlay.widget || overlay.embeddedView) {
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
        if (event?.altKey) {
            insertPointOnPolyline(shapeId, pointFromEvent(event));
            setSelectedIds([shapeId]);
            setSelectedOverlayIds([]);
            setEditingId(shapeId);
            setSelectedSegment(null);
            setDragSegment(null);
            return;
        }
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
            keepHorizontal
        });
        setDragHandle(null);
        setDragState(null);
        setMarquee(null);
    }, [appendPolylinePoint, drawing, insertPointOnPolyline, maybeConstrainPolylinePoint, pointFromEvent, tool]);

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
        const corners = { TL: topLeft, TR: topRight, BR: bottomRight, BL: bottomLeft };
        const oppositeCorners = { TL: bottomRight, TR: bottomLeft, BR: topLeft, BL: topRight };
        const key = String(corner || "").toUpperCase();
        const anchorLocal = oppositeCorners[key];
        const startLocal = corners[key];
        if (!anchorLocal || !startLocal) {
            return;
        }

        const anchorWorld = worldFromLocal(overlay, anchorLocal.x, anchorLocal.y);
        const startWorld = worldFromLocal(overlay, startLocal.x, startLocal.y);
        setSelectedOverlayIds([overlayId]);
        setSelectedIds([]);
        setEditingId(null);
        setSelectedSegment(null);
        setOverlayResize({
            kind: "single",
            id: overlayId,
            anchorLocal,
            anchorWorld,
            startDist: Math.max(1, distance(startWorld, anchorWorld)),
            originalScale: overlayScale(overlay),
            bbox
        });
        setDragState(null);
        setMarquee(null);
    }, [overlayLocalBBox, overlaysSelectable, tool]);

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
                scale: overlayScale(overlay),
                bbox
            };
        });

        if (!Object.keys(originalsById).length) {
            return;
        }

        setOverlayResize({
            kind: "group",
            anchorWorld,
            startDist: Math.max(1, distance(startWorld, anchorWorld)),
            originalsById
        });
        setDragState(null);
        setMarquee(null);
    }, [overlayLocalBBox, selectedBBox, selectedIds.length, selectedOverlayIds, tool]);

    const handleMouseMove = useCallback((event) => {
        const point = pointFromEvent(event);

        if (dragSegment?.id) {
            updateShapes((previous) => previous.map((shape) => {
                if (String(shape?.id || "") !== String(dragSegment.id || "") || !Array.isArray(shape?.points)) {
                    return shape;
                }
                const segmentIndex = Number(dragSegment.index || 0);
                const nextPoints = clonePoints(shape.points);
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
                if (dragSegment.keepHorizontal) {
                    const baseY = (Number(startPoint?.y || 0) + Number(endPoint?.y || 0)) / 2;
                    const nextY = Math.max(0, Math.min(viewBox.height, baseY + deltaY));
                    nextPoints[segmentIndex] = { x: Number(startPoint?.x || 0), y: nextY };
                    nextPoints[segmentIndex + 1] = { x: Number(endPoint?.x || 0), y: nextY };
                } else {
                    const baseX = (Number(startPoint?.x || 0) + Number(endPoint?.x || 0)) / 2;
                    const nextX = Math.max(0, Math.min(viewBox.width, baseX + deltaX));
                    nextPoints[segmentIndex] = { x: nextX, y: Number(startPoint?.y || 0) };
                    nextPoints[segmentIndex + 1] = { x: nextX, y: Number(endPoint?.y || 0) };
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
                nextPoints[dragHandle.index] = point;
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
            const ratio = clamp(distance(point, overlayResize.anchorWorld) / Math.max(1, overlayResize.startDist), 0.05, 100);
            updateSvgOverlays((previous) => previous.map((overlay) => {
                if (String(overlay?.id || "") !== String(overlayResize.id || "")) {
                    return overlay;
                }
                const scale = Math.max(0.0001, Number(overlayResize.originalScale || 1) * ratio);
                return {
                    ...overlay,
                    scale,
                    tx: Number(overlayResize.anchorWorld?.x || 0) - scale * Number(overlayResize.anchorLocal?.x || 0),
                    ty: Number(overlayResize.anchorWorld?.y || 0) - scale * Number(overlayResize.anchorLocal?.y || 0)
                };
            }), { persist: false });
            return;
        }

        if (overlayResize?.kind === "group") {
            const ratio = clamp(distance(point, overlayResize.anchorWorld) / Math.max(1, overlayResize.startDist), 0.05, 100);
            updateSvgOverlays((previous) => previous.map((overlay) => {
                const snapshot = overlayResize.originalsById[String(overlay?.id || "")];
                if (!snapshot?.bbox) {
                    return overlay;
                }

                const nextScale = Math.max(0.0001, Number(snapshot.scale || 1) * ratio);
                const startTopLeft = {
                    x: Number(snapshot.tx || 0) + Number(snapshot.scale || 1) * Number(snapshot.bbox.x || 0),
                    y: Number(snapshot.ty || 0) + Number(snapshot.scale || 1) * Number(snapshot.bbox.y || 0)
                };
                const nextTopLeft = {
                    x: Number(overlayResize.anchorWorld?.x || 0) + (startTopLeft.x - Number(overlayResize.anchorWorld?.x || 0)) * ratio,
                    y: Number(overlayResize.anchorWorld?.y || 0) + (startTopLeft.y - Number(overlayResize.anchorWorld?.y || 0)) * ratio
                };

                return {
                    ...overlay,
                    scale: nextScale,
                    tx: nextTopLeft.x - nextScale * Number(snapshot.bbox.x || 0),
                    ty: nextTopLeft.y - nextScale * Number(snapshot.bbox.y || 0)
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
    }, [dragHandle, dragSegment, dragState, drawing, marquee, maybeConstrainPolylinePoint, overlayResize, pointFromEvent, shapeResize, updateShapes, updateSvgOverlays, viewBox.height, viewBox.width]);

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

        if (tool === "polyline" || tool === "trunkconn" && drawing?.kind === "polyline" && drawing.id) {
            removeCurrentPolylineSegment();
        }
    }, [drawing, removeCurrentPolylineSegment, tool]);

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
    const quickTagPickerOverlayIsBin = useMemo(
        () => String(quickTagPickerOverlay?.eType || "").trim().toLowerCase().startsWith("bin"),
        [quickTagPickerOverlay]
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

        const rootWidth = Number(rootSize?.width || DEFAULT_CANVAS_WIDTH);
        const rootHeight = Number(rootSize?.height || DEFAULT_CANVAS_HEIGHT);
        const rulerInset = showRulers ? CANVAS_RULER_SIZE : 0;

        const fallbackLeft = rootWidth - PROPERTY_PANEL_WIDTH - 16;
        const fallbackTop = 16 + rulerInset;
        const anchorLeft = Number(topLeft?.x || fallbackLeft);
        const anchorRight = Number(topRight?.x || (anchorLeft + 120));
        const anchorTop = Number(topLeft?.y || fallbackTop);

        const preferredLeft = anchorRight + 12;
        const maxLeft = Math.max(16, rootWidth - PROPERTY_PANEL_WIDTH - 16);
        const left = preferredLeft <= maxLeft
            ? preferredLeft
            : clamp(anchorLeft - PROPERTY_PANEL_WIDTH - 12, 16, maxLeft);
        const top = clamp(anchorTop, 16 + rulerInset, Math.max(16 + rulerInset, rootHeight - 220));
        const availableHeight = Math.max(PROPERTY_PANEL_MIN_HEIGHT, rootHeight - top - 16);
        const panelHeight = Math.max(
            PROPERTY_PANEL_MIN_HEIGHT,
            Math.min(PROPERTY_PANEL_HEIGHT, availableHeight)
        );

        return {
            position: "absolute",
            left,
            top,
            zIndex: 70,
            width: PROPERTY_PANEL_WIDTH,
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
    }, [propertiesVisible, propertyTargetBounds, worldToPanelPoint, rootSize, showRulers]);

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
        const top = Number(rootRect.top || 0) + Number(floatingPropertyPanelStyle.top || 0);
        const availableHeight = Math.max(PROPERTY_PANEL_MIN_HEIGHT, viewportHeight - top - 16);
        const panelHeight = Math.max(
            PROPERTY_PANEL_MIN_HEIGHT,
            Math.min(PROPERTY_PANEL_HEIGHT, availableHeight)
        );
        return {
            ...floatingPropertyPanelStyle,
            position: "fixed",
            left,
            top,
            maxWidth: Math.max(180, viewportWidth - left - 16),
            height: panelHeight,
            maxHeight: panelHeight
        };
    }, [floatingPropertyPanelStyle, rootSize]);

    const quickTagPickerStyle = useMemo(() => {
        if (!editorVisible || !quickTagPickerOverlay) {
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
    }, [editorVisible, quickTagPickerOverlay, quickTagPickerState, rootSize]);

    useEffect(() => {
        if (!quickTagPickerOverlay) {
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
    }, [closeQuickTagPicker, quickTagPickerOverlay]);

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
            { key: "TR", cx: x + width, cy: y },
            { key: "BR", cx: x + width, cy: y + height },
            { key: "BL", cx: x, cy: y + height }
        ];

        return (
            <g data-overlay-selection-ui={String(overlay?.id || "")}>
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
                        />
                        <circle
                            cx={corner.cx}
                            cy={corner.cy}
                            r={14}
                            fill="transparent"
                            style={{ cursor: resizeCursorForCorner(corner.key) }}
                            onMouseDown={(event) => handleOverlayHandleDown(event, overlay?.id, corner.key)}
                        />
                    </g>
                ))}
            </g>
        );
    }, [handleOverlayHandleDown]);

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
            return applyOverlayIgnitionFillBinding(overlay, rawValue);
        });
    }, [updateSelectedOverlay]);

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
            return applyOverlayIgnitionFillBinding(overlay, rawValue);
        });
    }, [updateOverlayById]);

    const commitSelectedOverlayFill = useCallback((rawValue) => {
        updateSelectedOverlay((overlay) => applyOverlayFillFallbackColor(overlay, rawValue));
    }, [updateSelectedOverlay]);

    const commitSelectedOverlayNumber = useCallback((field, rawValue, options = {}) => {
        const next = parsePanelNumber(rawValue);
        if (next == null) {
            return;
        }
        const value = options.min != null ? Math.max(options.min, next) : next;
        updateSelectedOverlay((overlay) => ({
            ...overlay,
            [field]: value
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
            const scale = Math.max(0.0001, Math.abs(Number(overlay?.scale || 1)));
            return axis === "x"
                ? { ...overlay, tx: next - scale * Number(bbox.x || 0) }
                : { ...overlay, ty: next - scale * Number(bbox.y || 0) };
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
            return {
                ...overlay,
                scale: nextScale,
                tx: Number(currentBounds.x || 0) - nextScale * Number(bbox.x || 0),
                ty: Number(currentBounds.y || 0) - nextScale * Number(bbox.y || 0)
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
            : svgLibraryReady
                ? `${svgCatalogFiles.length} SVG templates ready`
                : "Loading SVG templates...";
    const widgetLibraryStatusText = "Mesora widgets ready";

    const svgDrawerLayout = useMemo(() => {
        const maxPanelWidth = Math.max(0, Number(rootSize?.width || DEFAULT_CANVAS_WIDTH) - (TOOLBAR_INSET * 2));
        const activeToolbarWidth = toolbarCollapsed ? COLLAPSED_TOOLBAR_WIDTH : TOOLBAR_WIDTH;
        const preferredLeft = TOOLBAR_INSET + activeToolbarWidth + TOOLBAR_DRAWER_GAP;
        const availableBesideToolbar = Math.max(0, maxPanelWidth - activeToolbarWidth - TOOLBAR_DRAWER_GAP);

        if (availableBesideToolbar >= SVG_DRAWER_MIN_WIDTH) {
            return {
                left: preferredLeft,
                top: TOOLBAR_INSET,
                bottom: TOOLBAR_INSET,
                width: Math.min(SVG_DRAWER_PREFERRED_WIDTH, availableBesideToolbar)
            };
        }

        return {
            left: TOOLBAR_INSET,
            top: TOOLBAR_INSET,
            bottom: TOOLBAR_INSET,
            width: Math.max(260, Math.min(SVG_DRAWER_PREFERRED_WIDTH, maxPanelWidth))
        };
    }, [rootSize, toolbarCollapsed]);
    const widgetDrawerLayout = svgDrawerLayout;
    const helpDrawerLayout = useMemo(() => {
        const maxPanelWidth = Math.max(0, Number(rootSize?.width || DEFAULT_CANVAS_WIDTH) - (TOOLBAR_INSET * 2));
        const activeToolbarWidth = toolbarCollapsed ? COLLAPSED_TOOLBAR_WIDTH : TOOLBAR_WIDTH;
        const preferredLeft = TOOLBAR_INSET + activeToolbarWidth + TOOLBAR_DRAWER_GAP;
        const availableBesideToolbar = Math.max(0, maxPanelWidth - activeToolbarWidth - TOOLBAR_DRAWER_GAP);

        if (availableBesideToolbar >= HELP_DRAWER_MIN_WIDTH) {
            return {
                left: preferredLeft,
                top: TOOLBAR_INSET,
                bottom: TOOLBAR_INSET,
                width: Math.min(HELP_DRAWER_PREFERRED_WIDTH, availableBesideToolbar)
            };
        }

        return {
            left: TOOLBAR_INSET,
            top: TOOLBAR_INSET,
            bottom: TOOLBAR_INSET,
            width: Math.max(280, Math.min(HELP_DRAWER_PREFERRED_WIDTH, maxPanelWidth))
        };
    }, [rootSize, toolbarCollapsed]);
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
    }, [activateTool, cancelPolyline, copySelection, deleteSelected, drawing, duplicateSelected, editorVisible, finishPolyline, pasteClipboard, redo, undo]);

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
        clearSelection();
    }, [clearSelection, editorVisible]);

    return (
        <div
            ref={rootRef}
            data-vizi-canvas-root="1"
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
                width: viewBox.width,
                height: viewBox.height,
                zoom: liveCanvasZoom,
                flexShrink: 0,
                position: "relative",
                transformOrigin: "top left"
            } : {
                position: "absolute",
                inset: 0
            }}>
            <CanvasSvg
                svgRef={svgRef}
                zoom={isLiveMode ? 1 : zoom}
                pan={isLiveMode ? { x: 0, y: 0 } : (isPlainObject(pan) ? pan : { x: 0, y: 0 })}
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
                useWindowPointerTracking={false}
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
                svgOverlays={svgOverlays}
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
                importAnchor={null}
                onCanvasDoubleClick={NOOP}
                tagStateColorsByPath={binTagStateColorsByPath}
                routeColorsBySvgKey={binTagStateColorsByPath}
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
                onWidgetDurationPresetChange={NOOP}
                onTrendTagDrop={NOOP}
                hiddenTagBubbleIds={EMPTY_ARRAY}
                onHideTagBubble={NOOP}
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
                        style={{
                            position: "absolute",
                            top: TOOLBAR_INSET,
                            left: TOOLBAR_INSET,
                            zIndex: 60,
                            width: COLLAPSED_TOOLBAR_WIDTH,
                            maxWidth: `min(${COLLAPSED_TOOLBAR_WIDTH}px, calc(100% - ${TOOLBAR_INSET * 2}px))`,
                            display: "grid",
                            gap: 8,
                            padding: 10,
                            borderRadius: 18,
                            border: "1px solid rgba(51, 65, 85, 0.95)",
                            background: "linear-gradient(180deg, rgba(2, 6, 23, 0.95) 0%, rgba(15, 23, 42, 0.92) 100%)",
                            boxShadow: "0 24px 60px rgba(2, 6, 23, 0.34)"
                        }}
                    >
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
                        style={{
                            position: "absolute",
                            top: TOOLBAR_INSET,
                            left: TOOLBAR_INSET,
                            zIndex: 60,
                            width: TOOLBAR_WIDTH,
                            maxWidth: `min(${TOOLBAR_WIDTH}px, calc(100% - ${TOOLBAR_INSET * 2}px))`,
                            display: "grid",
                            gap: 12,
                            padding: 14,
                            borderRadius: 18,
                            border: "1px solid rgba(51, 65, 85, 0.95)",
                            background: "linear-gradient(180deg, rgba(2, 6, 23, 0.95) 0%, rgba(15, 23, 42, 0.92) 100%)",
                            boxShadow: "0 24px 60px rgba(2, 6, 23, 0.34)"
                        }}
                    >
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
                                Tools
                            </div>
                            <button
                                type="button"
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
                                    color: svgLibraryError ? "#fecaca" : "rgba(226, 232, 240, 0.72)"
                                }}
                            >
                                {svgLibraryStatusText}
                                <div>{widgetLibraryStatusText}</div>
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

            {editorVisible && quickTagPickerOverlay && quickTagPickerStyle ? (
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
                                {quickTagPickerOverlay.name || quickTagPickerOverlay.id || "SVG Overlay"}
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
                    <PropertyTagPathField
                        autoOpenToken={quickTagPickerAutoOpenToken}
                        label="Tag Path"
                        value={quickTagPickerOverlay.tagPath || ""}
                        options={ignitionTagOptionsForQuickPicker}
                        loaded={ignitionTagsLoaded}
                        loading={ignitionTagsLoading}
                        error={ignitionTagsError}
                        onOpen={loadIgnitionTags}
                        onCommit={(value) => {
                            commitOverlayTagPathById(quickTagPickerOverlay.id, value);
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
                                                    { value: "opc", label: "Direct OPC" }
                                                ]
                                            }
                                        ]}
                                        onChange={(nextValue) => {
                                            commitSelectedOverlayWidgetField("writeMode", nextValue);
                                        }}
                                    />
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
                                ) : !selectedOverlayIsEmbeddedView ? (
                                    <PropertyTagPathField
                                        label="Tag Path"
                                        value={selectedOverlay.tagPath || ""}
                                        options={ignitionTagOptionsForOverlay}
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
                                    <PropertyField
                                        label="EType"
                                        value={selectedOverlay.eType || ""}
                                        onCommit={(value) => {
                                            commitSelectedOverlayText("eType", value);
                                        }}
                                    />
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
                                                label="Scale"
                                                value={formatPanelNumber(selectedOverlay.scale || 1)}
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
                            gridTemplateColumns: "1fr 1fr",
                            gap: 8,
                            paddingTop: 4,
                            borderTop: "1px solid rgba(71, 85, 105, 0.5)"
                        }}
                    >
                        <button
                            type="button"
                            onClick={closePropertiesPanel}
                            style={{
                                background: "rgba(30, 58, 138, 0.72)",
                                border: "1px solid rgba(59, 130, 246, 0.55)",
                                color: "#bfdbfe",
                                height: 34,
                                borderRadius: 10,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                letterSpacing: "0.04em"
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
                                height: 34,
                                borderRadius: 10,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                letterSpacing: "0.04em"
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
                        onRefresh={handleRefreshSvgLibrary}
                        refreshDisabled={svgLibraryRefreshing}
                        docked
                        absoluteDocked
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
                        absoluteDocked
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
                        position: "absolute",
                        left: helpDrawerLayout.left,
                        top: helpDrawerLayout.top,
                        bottom: helpDrawerLayout.bottom,
                        width: helpDrawerLayout.width,
                        zIndex: 58,
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
