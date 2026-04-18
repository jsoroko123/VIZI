import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CanvasSvg from "../../../../app/src/components/CanvasSvg.jsx";
import ImportModal from "../../../../app/src/components/ImportModal.jsx";
import { stripOuterSvg } from "../../../../app/src/utils/svgSanitize.js";
import PerspectiveViziCanvasBridge from "./PerspectiveViziCanvasBridge.jsx";

const { ComponentRegistry } = window.PerspectiveClient;
const COMPONENT_TYPE = "com.mesora.perspective.drawingtool";
const MODULE_RESOURCE_BASE = "/res/mesora-drawing";
const SVG_LIBRARY_MANIFEST_URL = `${MODULE_RESOURCE_BASE}/svg-library/manifest.json`;
const SVG_RAW_CACHE_MAX = 80;
const DEFAULT_FILL = "#CCCCCC";
const DEFAULT_STROKE = "#808080";
const DEFAULT_CANVAS_WIDTH = 1668;
const DEFAULT_CANVAS_HEIGHT = 1401;

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

function normalizeViewBox(documentValue, fallbackSize = null) {
    const fallbackWidth = toPositiveNumber(fallbackSize?.width) || DEFAULT_CANVAS_WIDTH;
    const fallbackHeight = toPositiveNumber(fallbackSize?.height) || DEFAULT_CANVAS_HEIGHT;
    const viewBox = documentValue && documentValue.viewBox;
    if (typeof viewBox === "string" && viewBox.trim()) {
        const trimmed = viewBox.trim();
        if (fallbackSize && trimmed === "0 0 1200 800") {
            return `0 0 ${fallbackWidth} ${fallbackHeight}`;
        }
        return trimmed;
    }
    if (isPlainObject(viewBox)) {
        const x = Number(viewBox.x) || 0;
        const y = Number(viewBox.y) || 0;
        const width = Number(viewBox.width) || 100;
        const height = Number(viewBox.height) || 100;
        if (fallbackSize && x === 0 && y === 0 && width === 1200 && height === 800) {
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

function coerceArray(value) {
    return Array.isArray(value) ? value : [];
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
    const direct = source?.[key];
    const modelValue = isPlainObject(source?.model) ? source.model[key] : undefined;

    if (Array.isArray(direct) && direct.length > 0) {
        return direct;
    }
    if (Array.isArray(modelValue) && modelValue.length > 0) {
        return modelValue;
    }
    if (Array.isArray(direct)) {
        return direct;
    }
    if (Array.isArray(modelValue)) {
        return modelValue;
    }
    return fallback;
}

function getRootContainerProps(props) {
    const baseStyle = {
        width: "100%",
        height: "100%"
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
            const url = String(entry?.url || "").trim();
            if (!key || !name || !url) {
                return null;
            }
            return { key, name, url };
        })
        .filter(Boolean);
}

function writeComponentProp(props, path, value) {
    const candidatePaths = path.startsWith("model.") ? [path] : [path, `model.${path}`];
    const writers = [];

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
                writePath(candidatePath, value);
                wrote = true;
            } catch (_error) {
            }
        });
    });

    return wrote;
}

function ViziCanvasBridge(props) {
    const svgRef = useRef(null);
    const svgRawCacheRef = useRef(new Map());
    const sourceDocument = isPlainObject(props.document) ? props.document : {};
    const hostSize = resolveCanvasHostSize(props);
    const viewBox = parseViewBoxParts(normalizeViewBox(sourceDocument, hostSize));
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
    const [importOpen, setImportOpen] = useState(false);

    useEffect(() => {
        setSelectedIds(coerceArray(externalSelectedIds));
    }, [externalSelectedIdsKey]);

    useEffect(() => {
        setSelectedOverlayIds(coerceArray(externalSelectedOverlayIds));
    }, [externalSelectedOverlayIdsKey]);

    useEffect(() => {
        setSvgOverlaysState(coerceArray(externalOverlays));
    }, [externalOverlaysKey]);

    useEffect(() => {
        if (!svgLibraryEnabled) {
            setSvgCatalogFiles(EMPTY_ARRAY);
            setSvgLibraryError("");
            setImportOpen(false);
            return undefined;
        }

        let cancelled = false;
        setSvgLibraryError("");

        fetch(SVG_LIBRARY_MANIFEST_URL, { cache: "no-store" })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Failed to load SVG catalog (${response.status}).`);
                }
                return response.json();
            })
            .then((payload) => {
                if (cancelled) {
                    return;
                }
                setSvgCatalogFiles(normalizeSvgCatalogEntries(payload));
            })
            .catch((error) => {
                if (cancelled) {
                    return;
                }
                setSvgCatalogFiles(EMPTY_ARRAY);
                setSvgLibraryError(String(error?.message || "Failed to load SVG catalog."));
            });

        return () => {
            cancelled = true;
        };
    }, [svgLibraryEnabled]);

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
        if (typeof value !== "string") {
            return null;
        }
        if (isSvgMarkup(value)) {
            return value;
        }

        const url = value.trim();
        if (!url) {
            return null;
        }

        const cache = svgRawCacheRef.current;
        if (!forceFresh && cache.has(url)) {
            const cached = cache.get(url);
            cache.delete(url);
            cache.set(url, cached);
            return cached;
        }

        const requestUrl = forceFresh
            ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`
            : url;
        const response = await fetch(requestUrl, forceFresh ? { cache: "no-store" } : undefined);
        if (!response.ok) {
            throw new Error(`Failed to load SVG (${response.status}).`);
        }
        const raw = await response.text();

        if (cache.has(url)) {
            cache.delete(url);
        }
        cache.set(url, raw);
        while (cache.size > SVG_RAW_CACHE_MAX) {
            const oldest = cache.keys().next().value;
            cache.delete(oldest);
        }

        return raw;
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

    const handleOverlayMouseDown = useCallback((_event, id) => {
        setSelectedOverlayIds(id ? [String(id)] : []);
        setSelectedIds([]);
    }, []);

    const zoom = Number(getModelValue(props, "zoom", 1)) || 1;
    const pan = getModelValue(props, "pan", { x: 0, y: 0 });
    const showGrid = Boolean(getModelValue(props, "showGrid", false));
    const showRulers = Boolean(getModelValue(props, "showRulers", false));
    const tool = String(getModelValue(props, "tool", "select") || "select");
    const liveUpdatesEnabled = Boolean(getModelValue(props, "liveUpdatesEnabled", true));
    const previewActive = detectPerspectivePreviewMode(props);
    const editorVisible = !previewActive;
    const isLiveMode = previewActive;
    const liveClickable = Boolean(getModelValue(props, "liveClickable", false));
    const theme = String(getModelValue(props, "theme", "light") || "light");
    const canvasBackgroundColor = String(
        getModelValue(
            props,
            "canvasBackgroundColor",
            getModelValue(props, "backgroundColor", "#0f172a")
        ) || "#0f172a"
    );

    const svgFiles = useMemo(
        () => svgCatalogFiles.map((entry) => ({ key: entry.key, name: entry.name })).sort((left, right) => left.name.localeCompare(right.name)),
        [svgCatalogFiles]
    );

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
        : svgCatalogFiles.length > 0
        ? `SVG Library (${svgCatalogFiles.length})`
        : "Loading SVG Library...";

    return (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <CanvasSvg
                svgRef={svgRef}
                zoom={zoom}
                pan={isPlainObject(pan) ? pan : { x: 0, y: 0 }}
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
                onOverlayMouseDown={editorVisible ? handleOverlayMouseDown : NOOP}
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
                preserveAspectRatioMode="xMinYMin slice"
                forceStaticVisuals={!editorVisible}
                viewportTopOffset={0}
                viewportLeftOffset={0}
                viewportScrollTarget={null}
                onViewportScroll={NOOP}
            />

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
    const rootProps = getRootContainerProps(props);
    const viewProps = getComponentPropSource(props);
    const rootRef = useRef(null);
    const previewActive = detectPerspectivePreviewMode(props);
    const designerActive = detectPerspectiveDesignerMode(props);
    const rootRuntimeComponent = !designerActive && detectPerspectiveRootComponent(props);
    const useDesignerPortal = designerActive && !previewActive && hasViziCanvasModel(props);
    const rootBackgroundColor = String(viewProps.backgroundColor || "#0f172a");
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
                    position: "relative",
                    overflow: "hidden",
                    background: rootBackgroundColor,
                    height: rootRuntimeComponent ? "100dvh" : undefined,
                    minHeight: rootRuntimeComponent ? "100dvh" : undefined,
                    maxHeight: rootRuntimeComponent ? "none" : undefined
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
                backgroundColor={viewProps.backgroundColor}
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
            width: DEFAULT_CANVAS_WIDTH,
            height: DEFAULT_CANVAS_HEIGHT
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
            backgroundColor: readTreeValue(tree, "backgroundColor", "#0f172a"),
            showGrid: readTreeValue(tree, "showGrid", false),
            gridSize: readTreeValue(tree, "gridSize", 20),
            preserveAspectRatio: readTreeValue(tree, "preserveAspectRatio", "xMinYMin slice"),
            panZoomEnabled: readTreeValue(tree, "panZoomEnabled", false),
            showRulers: readTreeValue(tree, "showRulers", false),
            showTagPaths: readTreeValue(tree, "showTagPaths", false),
            selectionMode: readTreeValue(tree, "selectionMode", "all"),
            liveUpdatesEnabled: readTreeValue(tree, "liveUpdatesEnabled", true),
            liveClickable: readTreeValue(tree, "liveClickable", false),
            theme: readTreeValue(tree, "theme", "light"),
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
