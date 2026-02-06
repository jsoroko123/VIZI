// src/utils/ignitionExport.js

// ✅ MERGED CHANGE: one uniform export stroke width for EVERYTHING (overlays + polylines)
const EXPORT_STROKE_WIDTH = "1.5px"; // 👈 change this ONE value to control all stroke widths

function strokeWidthToPxString(w, fallback = "2px") {
    if (w == null) return fallback;

    // If already a string like "3px"
    if (typeof w === "string") {
        const s = w.trim();
        if (!s) return fallback;
        if (s.endsWith("px")) return s;

        const n = Number(s);
        if (Number.isFinite(n)) return `${n}px`;
        return fallback;
    }

    // Number
    if (typeof w === "number" && Number.isFinite(w)) {
        return `${w}px`;
    }

    return fallback;
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

function getStyleProp(el, prop) {
    const style = el.getAttribute("style");
    if (!style) return undefined;

    // very small style parser: "a:b; c:d;"
    const parts = style
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);

    for (const p of parts) {
        const i = p.indexOf(":");
        if (i === -1) continue;
        const k = p.slice(0, i).trim().toLowerCase();
        const v = p.slice(i + 1).trim();
        if (k === prop.toLowerCase()) return v || undefined;
    }
    return undefined;
}

function tagToIgnitionType(tag) {
    switch (tag) {
        case "polygon":
            return "polygon";
        case "polyline":
            return "polyline";
        case "path":
            return "path";
        case "rect":
            return "rect";
        case "circle":
            return "circle";
        case "ellipse":
            return "ellipse";
        case "line":
            return "line";
        case "g":
            return "group";
        default:
            return tag;
    }
}

function normalizeStrokeWidth(w) {
    if (w == null) return "2px";
    const s = String(w).trim();
    if (!s) return "2px";
    if (s.endsWith("px")) return s;
    const n = Number(s);
    if (Number.isFinite(n)) return `${n}px`;
    return s;
}

function pickAttr(el, name) {
    const v = el.getAttribute(name);
    if (v == null) return undefined;
    const s = String(v).trim();
    return s ? s : undefined;
}

function parseStyleString(styleStr) {
    // Ignition element "style" is an object; keep minimal & safe
    if (!styleStr) return undefined;
    return { raw: styleStr };
}

function defaultFillForType(type) {
    if (type === "polyline" || type === "line" || type === "path") return { paint: "transparent" };
    if (type === "group") return undefined;
    return {}; // ignition template often uses {} for polygons etc
}

function domToIgnitionElement(el, opts) {
    const { defaultTagPath = "", defaultStrokePaint, defaultFillPaint, inheritTagPath = true } = opts || {};

    const tag = el.tagName.toLowerCase();
    const type = tagToIgnitionType(tag);

    const id = pickAttr(el, "id");
    const name = pickAttr(el, "name") || id;

    const out = { type };

    if (id) out.id = id;
    if (name) out.name = name;

    // per-element Tag Path
    out.custom = { tagPath: inheritTagPath ? defaultTagPath : "" };

    // preserve transform (CRITICAL for many SVGs)
    const transform = pickAttr(el, "transform");
    if (transform) out.transform = transform;

    // preserve style info
    const ve = pickAttr(el, "vector-effect");
    const styleAttr = pickAttr(el, "style");
    if (ve || styleAttr) {
        out.style = {
            ...(ve ? { vectorEffect: ve } : {}),
            ...(styleAttr ? parseStyleString(styleAttr) : {}),
        };
    }

    // Force stroke widths NOT to scale when group is scaled
    if (type !== "group") {
        out.style = {
            ...(out.style || {}),
            vectorEffect: "non-scaling-stroke",
        };
    }

    // geometry / attributes
    const points = pickAttr(el, "points");
    const d = pickAttr(el, "d");
    if (points) out.points = points;
    if (d) out.d = d;

    const attrs = ["x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2"];
    for (const a of attrs) {
        const v = pickAttr(el, a);
        if (v != null) out[a] = v;
    }

    // stroke/fill — apply defaults if missing
    if (type !== "group") {
        const strokeAttr = pickAttr(el, "stroke") ?? getStyleProp(el, "stroke");
        const swAttr = pickAttr(el, "stroke-width") ?? getStyleProp(el, "stroke-width");
        const fillAttr = pickAttr(el, "fill") ?? getStyleProp(el, "fill");

        const linecap = pickAttr(el, "stroke-linecap") ?? getStyleProp(el, "stroke-linecap");
        const linejoin = pickAttr(el, "stroke-linejoin") ?? getStyleProp(el, "stroke-linejoin");

        out.stroke = {};

        // ✅ MERGED CHANGE:
        // Force all overlay SVG strokes to ONE uniform width on export.
        // If you want to preserve original SVG widths, replace next line with:
        // out.stroke.width = normalizeStrokeWidth(swAttr ?? "2px");
        out.stroke.width = strokeWidthToPxString(
            EXPORT_STROKE_WIDTH ?? swAttr,
            strokeWidthToPxString(swAttr, "2px")
        );

        if (strokeAttr) out.stroke.paint = strokeAttr;
        else if (defaultStrokePaint) out.stroke.paint = defaultStrokePaint;

        if (linecap) out.stroke.linecap = linecap;
        if (linejoin) out.stroke.linejoin = linejoin;

        if (fillAttr) out.fill = { paint: fillAttr };
        else {
            if (type === "polyline" || type === "line" || type === "path") out.fill = { paint: "transparent" };
            else {
                if (defaultFillPaint) out.fill = { paint: defaultFillPaint };
                else out.fill = defaultFillForType(type);
            }
        }
    }

    // children
    if (type === "group") {
        out.elements = Array.from(el.children || []).map((child) =>
            domToIgnitionElement(child, {
                defaultTagPath,
                defaultStrokePaint,
                defaultFillPaint,
                inheritTagPath,
            })
        );
    }

    return out;
}

function buildIgnitionShapeJson({ viewBox, elements, name, propConfig }) {
    return [
        {
            type: "ia.shapes.svg",
            version: 0,
            props: {
                viewBox: viewBox || "0 0 100 100",
                elements,
            },
            meta: { name: name || "Exported Drawing" },
            position: { grow: 1, basis: "300px" },
            custom: {},
            propConfig: propConfig || {},
        },
    ];
}

function buildPerElementStrokeTagBindings(propsElements) {
    const propConfig = {};

    function walk(node, path) {
        if (!node) return;

        const tagPath = node?.custom?.tagPath ? String(node.custom.tagPath).trim() : "";

        // Only bind if drawable and has tagPath
        if (node.type !== "group" && node.stroke && tagPath) {
            propConfig[`${path}.stroke.paint`] = {
                binding: {
                    type: "tag",
                    config: {
                        fallbackDelay: 2.5,
                        mode: "direct",
                        tagPath: `${tagPath}/RouteColor`,
                    },
                },
            };
        }

        if (Array.isArray(node.elements)) {
            for (let i = 0; i < node.elements.length; i++) {
                walk(node.elements[i], `${path}.elements[${i}]`);
            }
        }
    }

    for (let i = 0; i < propsElements.length; i++) {
        walk(propsElements[i], `props.elements[${i}]`);
    }

    return propConfig;
}

// ----------------------------
// ✅ OPTIONAL: infer polyline tagPath by endpoint touching an overlay bbox
// Requires overlayRefs + svgOverlays
// ----------------------------
function pointInRect(p, r, pad = 0) {
    return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

function inferPolylineTagPathFromOverlays(polyline, overlaysInfo, pad = 12) {
    const pts = polyline?.points || [];
    if (pts.length < 2) return "";

    const start = pts[0];
    const end = pts[pts.length - 1];

    // Prefer end-point first (common “connection” behavior), then start
    const tryPoints = [end, start];

    for (const p of tryPoints) {
        const hits = overlaysInfo.filter((o) => o.tagPath && pointInRect(p, o.worldBBox, pad));
        if (!hits.length) continue;

        // pick smallest bbox to avoid large overlays stealing matches
        hits.sort((a, b) => a.area - b.area);
        return hits[0].tagPath;
    }

    return "";
}

/**
 * Export overlays + drawn polylines into ia.shapes.svg JSON.
 * - Overlays exported as wrapper <g> with transform translate/scale
 * - Polylines exported as their own elements
 *
 * IMPORTANT draw order:
 * - elements earlier are behind
 * - elements later are in front
 *
 * So we export: polylines FIRST, overlays AFTER => polylines behind SVG ✅
 */
export function exportToIgnitionJson(
    { svgRef, shapes, svgOverlays, overlayRefs },
    options = {}
) {
    const svgNode = svgRef?.current;
    if (!svgNode) throw new Error("svgRef.current is null");

    const vb = svgNode.getAttribute("viewBox") || "0 0 100 100";

    // Build overlayElements
    const overlayElements = svgOverlays.map((o) => {
        const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
        wrapper.setAttribute("id", o.id);
        wrapper.setAttribute("name", o.name || o.id);
        wrapper.setAttribute("transform", `translate(${o.tx} ${o.ty}) scale(${o.scale})`);

        const parser = new DOMParser();
        const doc = parser.parseFromString(
            `<svg xmlns="http://www.w3.org/2000/svg">${o.inner}</svg>`,
            "image/svg+xml"
        );
        const innerSvg = doc.documentElement;

        Array.from(innerSvg.childNodes).forEach((n) => {
            if (n.nodeType === 1) wrapper.appendChild(n.cloneNode(true));
        });

        return domToIgnitionElement(wrapper, {
            defaultTagPath: o.tagPath || "",
            defaultStrokePaint: o.stroke || "#111111",
            defaultFillPaint: o.fill || "#ffffff",
            inheritTagPath: true,
        });
    });

    // Build overlay bbox info (only if overlayRefs supplied)
    const overlayInfo = [];
    const AUTO_BIND_PAD = options.autoBindPad ?? 12;

    const overlayMap = new Map(svgOverlays.map((o) => [o.id, o]));
    const overlayNodeMap = overlayRefs?.current;

    if (overlayNodeMap && overlayNodeMap instanceof Map) {
        for (const [id, node] of overlayNodeMap.entries()) {
            const o = overlayMap.get(id);
            if (!o || !node) continue;

            let bb;
            try {
                bb = node.getBBox(); // local bbox
            } catch {
                continue;
            }

            const worldBBox = {
                x: o.tx + o.scale * bb.x,
                y: o.ty + o.scale * bb.y,
                w: o.scale * bb.width,
                h: o.scale * bb.height,
            };

            overlayInfo.push({
                id,
                tagPath: String(o.tagPath || "").trim(),
                worldBBox,
                area: Math.max(1, worldBBox.w * worldBBox.h),
            });
        }
    }

    // Build polyElements (tagPath can auto-bind to touched overlay)
    const polyElements = shapes
        .filter((s) => s?.type === "polyline" || Array.isArray(s?.points))
        .map((s) => {
        const pts = (s.points || []).map((p) => `${p.x} ${p.y}`).join(" ");

        let tagPath = String(s.tagPath || "").trim();

        // If empty tagPath and overlayRefs available, infer from touched overlay
        if (!tagPath && overlayInfo.length) {
            tagPath = inferPolylineTagPathFromOverlays(s, overlayInfo, AUTO_BIND_PAD);
        }

        return {
            type: "polyline",
            id: s.id,
            name: s.id,
            points: pts,
            custom: { tagPath },
            fill: { paint: "transparent" },
            stroke: {
                paint: s.stroke || "#111111",
                // ✅ MERGED CHANGE: polylines use the same forced export width too
                width: strokeWidthToPxString(EXPORT_STROKE_WIDTH, "3px"),
                linecap: "round",
                linejoin: "round",
            },
            style: { vectorEffect: "non-scaling-stroke" },
        };
    });

    const root = {
        type: "group",
        id: "Layer_1",
        name: "Layer_1",
        style: {},
        elements: [
            {
                type: "group",
                id: "Drawing",
                name: "Drawing",

                // ✅ DRAW ORDER FIX:
                // polylines FIRST (behind), overlays AFTER (in front)
                elements: [...polyElements, ...overlayElements],
            },
        ],
    };

    const propsElements = [root];
    const propConfig = buildPerElementStrokeTagBindings(propsElements);

    return buildIgnitionShapeJson({
        viewBox: vb,
        elements: propsElements,
        name: options.name || "Exported Drawing",
        propConfig,
    });
}

export function downloadIgnitionJson(payload, filename = "ignition-shapes.json") {
    downloadTextFile(filename, JSON.stringify(payload, null, 2));
}
