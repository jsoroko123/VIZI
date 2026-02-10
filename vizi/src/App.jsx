// src/App.jsx
import { useMemo, useRef, useState, useEffect } from "react";
import Toolbar from "./components/Toolbar";
import PropertiesPanel from "./components/PropertiesPanel";
import HelpPanel from "./components/HelpPanel";
import ImportModal from "./components/ImportModal";
import CanvasSvg from "./components/CanvasSvg";
import ViewBoxModal from "./components/ViewBoxModal";
import OpcConfig from "./components/OpcConfig";

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
import { exportToIgnitionJson, downloadIgnitionJson } from "./utils/ignitionExport";

// Vite: put SVGs in src/assets/SVG Files/*.svg
const SVG_LIBRARY = import.meta.glob("./assets/SVG_Files/**/*.svg", { as: "raw" });
// (no eager:true)

function getFolderFromKey(key) {
  const parts = String(key).split("/");
  const i = parts.findIndex((p) => p === "SVG_Files" || p === "SVG Files");
  if (i >= 0) {
    const rest = parts.slice(i + 1);
    if (rest.length <= 1) return "Root";
    return rest.slice(0, -1).join(" / ");
  }
  if (parts.length <= 2) return "Root";
  return parts.slice(0, -1).slice(-1)[0] || "Root";
}




export default function App() {
  const [tool, setTool] = useState("select"); // "select" | "polyline"
  const DEFAULT_STROKE = "#808080";
  const DEFAULT_FILL = "#cccccc";
  const [shapes, setShapes] = useState([]); // polylines only

  // Multi-selection
  const [selectedIds, setSelectedIds] = useState([]); // polyline ids
  const [selectedOverlayIds, setSelectedOverlayIds] = useState([]); // overlay ids

  // drawing = { mode:"draw-poly", id }
  const [drawing, setDrawing] = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null); // { id, value }

  // unified drag for moving ALL selected items
  // { startWorld, polylines:[{id, origPoints}], overlays:[{id, origTx, origTy}] }
  const [dragAll, setDragAll] = useState(null);

  // editing a polyline
  const [editingId, setEditingId] = useState(null); // double-click line to edit
  const [dragHandle, setDragHandle] = useState(null); // { id, index }
  const [selectedSegment, setSelectedSegment] = useState(null); // { id, index, kind: "point" }

  // Import picker UI
  const [importOpen, setImportOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [lastContextPoint, setLastContextPoint] = useState(null);
  const [panelCursor, setPanelCursor] = useState(null);
  const [contextImportQuery, setContextImportQuery] = useState("");
  const [contextSvgMenuOpen, setContextSvgMenuOpen] = useState(false);
  const [contextSvgMenuPos, setContextSvgMenuPos] = useState({ x: 0, y: 0 });
  const contextSvgMenuTimerRef = useRef(null);
  const svgMenuInputRef = useRef(null);
  const [duplicateOffset, setDuplicateOffset] = useState(20);
  const duplicateOffsetRef = useRef(20);
  const [polyHandleMenu, setPolyHandleMenu] = useState(null);

  // SVG overlays (imported files): { id, name, inner, tx, ty, scale, fill, stroke, tagPath }
  const [svgOverlays, setSvgOverlays] = useState([]);

  // overlay resize
  const [overlayResize, setOverlayResize] = useState(null); // { id, anchorLocal, anchorWorld, startDist, origScale }

  // ✅ Export settings (dynamic)
  const [exportVB, setExportVB] = useState({ x: 0, y: 0, w: 1600, h: 900 });
  const [exportBasis, setExportBasis] = useState({ w: 1600, h: 900 }); // affects Perspective "basis"
  const [showZoom, setShowZoom] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showTagPaths, setShowTagPaths] = useState(false);
  const [marquee, setMarquee] = useState(null);

  const [vbW, setVbW] = useState(1600);
  const [vbH, setVbH] = useState(900);
  const [viewBoxOpen, setViewBoxOpen] = useState(false);

  const [importAnchor, setImportAnchor] = useState(null);


  const overlayRefs = useRef(new Map()); // id -> <g> element containing imported inner
  const svgRef = useRef(null);
  const clipboardRef = useRef({ shapes: [], overlays: [], pasteCount: 0 });

  const shapesRef = useRef(shapes);
  const overlaysRef = useRef(svgOverlays);
  const selPolyRef = useRef(selectedIds);
  const selOverRef = useRef(selectedOverlayIds);
  const projectFileRef = useRef(null);
  const [projectHandle, setProjectHandle] = useState(null);
  const [projectName, setProjectName] = useState("Untitled");


  const PAN_SPEED = 0.05; // 🔥 adjust this to taste

  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { overlaysRef.current = svgOverlays; }, [svgOverlays]);
  useEffect(() => { selPolyRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { selOverRef.current = selectedOverlayIds; }, [selectedOverlayIds]);
  useEffect(() => { duplicateOffsetRef.current = Number(duplicateOffset) || 0; }, [duplicateOffset]);
  useEffect(() => {
    if (!selectedSegment) return;
    if (!selectedIds.includes(selectedSegment.id) || editingId !== selectedSegment.id) {
      setSelectedSegment(null);
    }
  }, [selectedIds, editingId, selectedSegment]);

  // ---- Project file handle (for Save / Save As) ----
  const projectHandleRef = useRef(null);


  function getProjectPayload() {
    return {
      version: 1,
      name: projectName || "Untitled",
      savedAt: new Date().toISOString(),

      shapes: shapesRef.current ?? [],
      svgOverlays: overlaysRef.current ?? [],

      vbW,
      vbH,
      pan,
      zoom,
    };
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

    // ✅ Best: overwrite same file via File System Access API
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

    // ✅ Fallback: browser can't overwrite → downloads a new file
    downloadTextFile(`${projectName || "project"}.json`, text);
  }

  async function saveProject() {
    const payload = getProjectPayload();
    const text = JSON.stringify(payload, null, 2);

    // ✅ If we already have a handle, overwrite the same file
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
    // ✅ Best: File System Access API open picker
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

      // ✅ basic validation + fallbacks
      const nextShapes = Array.isArray(data.shapes) ? data.shapes : [];
      const nextOverlays = Array.isArray(data.svgOverlays) ? data.svgOverlays : [];

      pushHistory();

      setShapes(nextShapes);
      setSvgOverlays(nextOverlays);

      if (Number.isFinite(data.vbW)) setVbW(data.vbW);
      if (Number.isFinite(data.vbH)) setVbH(data.vbH);

      if (data.pan && Number.isFinite(data.pan.x) && Number.isFinite(data.pan.y)) {
        setPan({ x: data.pan.x, y: data.pan.y });
      }
      if (Number.isFinite(data.zoom)) setZoom(data.zoom);

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

      // ✅ remember this file so Save overwrites it next time
      projectHandleRef.current = handle;
      if (handle?.name) setProjectName(handle.name.replace(/\.json$/i, ""));
      return;
    }

    // ✅ Fallback: trigger hidden <input type=file> (your existing projectFileRef approach)
    projectFileRef.current?.click();
  }


  // optional: remember last project name across reloads
  useEffect(() => {
    const savedName = localStorage.getItem("vizi_project_name");
    if (savedName) setProjectName(savedName);
  }, []);

  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || t.isContentEditable;
    }

    function onKeyDown(e) {
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
  }, []);

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
  }, []);


  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || t.isContentEditable;
    }

    function onKeyDown(e) {
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
  }, []);



  // Floating panel visibility
  const [showToolbar, setShowToolbar] = useState(true);
  const [toolbarPos, setToolbarPos] = useState({ x: 16, y: 50 });
  const [showHUD, setShowHUD] = useState(true);
  const [showMainDrawer, setShowMainDrawer] = useState(false);
  const [drawerView, setDrawerView] = useState("ai");
  const [altDown, setAltDown] = useState(false);
  useEffect(() => {
    if (!showHUD) setPanelCursor(null);
  }, [showHUD]);
  useEffect(() => {
    if (importOpen) setShowHUD(false);
  }, [importOpen]);

  useEffect(() => {
    if (tool === "polyline") setShowHUD(false);
  }, [tool]);

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

  function openDrawer(view) {
    setDrawerView(view || "ai");
    setShowMainDrawer(true);
  }


  // ✅ ZOOM (main svg)
  const [zoom, setZoom] = useState(1);
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 8;
  const ZOOM_STEP = 1.15;


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

    if ((!polyParts.length && !textParts.length) || !Number.isFinite(minX)) return;

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
        const fill = s.fill || DEFAULT_FILL;
        const strokeWidth = Number(s.strokeWidth) || 3;
        const style = lineStyleToStrokeProps(s.lineStyle ?? "solid", strokeWidth);

        const dashAttr = style.dasharray ? ` stroke-dasharray="${style.dasharray}"` : "";
        const linecap = style.linecap ?? "round";
        const linejoin = style.linejoin ?? "round";

        return `<polyline points="${pointsAttr}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"${dashAttr} />`;
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

    // Ensure text is always on top
    const inner = `${polyInner}${textInner}`;

    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${inner}</svg>`;
    const genKey = addGeneratedSvg(`Selection-Group-${polyParts.length + textParts.length}`, raw);
    const stroke = polyParts[0]?.stroke || DEFAULT_STROKE;
    const fill = polyParts[0]?.fill || textParts[0]?.fill || DEFAULT_FILL;
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
    // resetView?.(); // if you want
  };

  const [pan, setPan] = useState({ x: 0, y: 0 });

  const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

  function zoomIn() {
    setZoom((z) => clampZoom(+(z * ZOOM_STEP).toFixed(4)));
  }
  function zoomOut() {
    setZoom((z) => clampZoom(+(z / ZOOM_STEP).toFixed(4)));
  }
  function zoomReset() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
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

    const nextShapes = Array.isArray(data.shapes) ? data.shapes : [];
    const nextOverlays = Array.isArray(data.svgOverlays) ? data.svgOverlays : [];

    pushHistory();

    setShapes(nextShapes);
    setSvgOverlays(nextOverlays);

    if (Number.isFinite(data.vbW)) setVbW(data.vbW);
    if (Number.isFinite(data.vbH)) setVbH(data.vbH);

    if (data.pan && Number.isFinite(data.pan.x) && Number.isFinite(data.pan.y)) {
      setPan({ x: data.pan.x, y: data.pan.y });
    }
    if (Number.isFinite(data.zoom)) setZoom(data.zoom);

    // clear selection/edit state
    setSelectedIds([]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setDrawing(null);
    setDragAll(null);
    setDragHandle(null);
    setOverlayResize(null);
    setMarquee(null);
    setImportAnchor(null);
  }

  function buildProjectPayload() {
    return {
      version: 1,
      name: projectName,
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
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      vbW,
      vbH,
      pan,
      zoom,
      shapes,
      svgOverlays,
    };

    async function saveProjectAs() {
      const data = buildProjectPayload();
      const json = JSON.stringify(data, null, 2);

      // ✅ Preferred: File System Access API (real overwrite)
      if ("showSaveFilePicker" in window) {
        const handle = await window.showSaveFilePicker({
          suggestedName: `${projectName || "project"}.json`,
          types: [
            {
              description: "Vizi Project",
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

      // 🟡 Fallback: download (cannot overwrite same file in most browsers)
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

      // “forget” current file
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




  function approxTextBBox(t) {
    if (!t) return null;

    const x = Number(t.x ?? 0);
    const y = Number(t.y ?? 0);

    const fontSize = Number(t.fontSize ?? 16);
    const text = String(t.text ?? "");

    // ✅ If you store width/height, prefer that
    const wStored = Number(t.w);
    const hStored = Number(t.h);
    if (Number.isFinite(wStored) && Number.isFinite(hStored)) {
      return { x, y, w: wStored, h: hStored };
    }

    // ✅ Cheap approximation so properties panel works immediately
    const w = Math.max(8, text.length * fontSize * 0.6);
    const h = Math.max(8, fontSize * 1.2);

    return { x, y, w, h };
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
    setMarquee(null);
  }

  function pushHistory() {
    historyRef.current.past.push(getSnapshot());
    historyRef.current.future = []; // clear redo on new action
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

  function extractKeySize(rawSvg) {
    try {
      const doc = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg) return null;

      // ✅ 1) Root <svg> itself (your Inkscape files store it here)
      const rootW = parseLen(svg.getAttribute("kewidth"));
      const rootH = parseLen(svg.getAttribute("keheight"));
      if (rootW > 0 && rootH > 0) return { w: rootW, h: rootH };

      // ✅ 2) Any descendant element with kewidth/keheight
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
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function rectsIntersect(a, b) {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  }

  // ✅ Mouse wheel zoom handler
  function onWheelZoom(e) {
    e.preventDefault();

    // Zoom wins first
    if (e.ctrlKey || e.metaKey) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        setZoom((z) => clampZoom(dir > 0 ? z * ZOOM_STEP : z / ZOOM_STEP));
        return;
      }
      return;
    }

    const factor = e.deltaMode === 1 ? 20 : 1; // line → px

    let dx = 0;
    let dy = 0;

    if (e.shiftKey) {
      // 🔥 SHIFT = horizontal pan
      dx = e.deltaY * factor;
    } else {
      // normal vertical pan
      dy = e.deltaY * factor;
      dx = e.deltaX * factor; // trackpad horizontal still works
    }

    setPan((p) => ({
      x: p.x - dx * PAN_SPEED,
      y: p.y - dy * PAN_SPEED,
    }));
  };



  const [generatedSvgs, setGeneratedSvgs] = useState([]);
  const persistSvgMeta = async (w, h) => {
    if (!isSingle || singleKind !== "SVG" || !singleId) return;
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    const o = svgOverlays.find((x) => x.id === singleId);
    if (!o?.sourceKey) return;
    if (String(o.sourceKey).startsWith("__generated__/")) return;
    try {
      await fetch("/__vizi__/set-svg-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileKey: o.sourceKey,
          kewidth: w,
          keheight: h,
        }),
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

  const svgFiles = useMemo(() => {
    const base = Object.keys(SVG_LIBRARY).map((k) => ({ key: k, name: k.split("/").pop() || k }));
    const generated = generatedSvgs.map((g) => ({
      key: g.key,
      name: g.name || g.key.split("/").pop() || g.key,
    }));
    return [...base, ...generated].sort((a, b) => a.name.localeCompare(b.name));
  }, [generatedSvgs]);

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
      if (s.type === "polyline" || Array.isArray(s.points)) return "Polyline";

      return "Shape";
    }

    if (selectedOverlayIds.length === 1) return "SVG";
    return null;
  }, [isSingle, selectedIds, selectedOverlayIds, shapes]);

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

  function setOverlayRef(id, node) {
    if (!id) return;
    if (node) overlayRefs.current.set(id, node);
    else overlayRefs.current.delete(id);
  }

  function svgPoint(evt) {
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

    // ✅ SNAP LOGIC (final)
    // - no modifier → free
    // - Shift → snap
    // - Alt → never snap
    if (evt.shiftKey && !evt.altKey) {
      x = snap(x, GRID);
      y = snap(y, GRID);
    }

    return { x, y };
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
      fill: "#808080",
      fontFamily: "system-ui",
      fontWeight: "400",
      anchor: "start", // start | middle | end
    };

    setShapes((prev) => [...prev, t]);
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setShowHUD(false);
    setTool("select"); // place once, go back to select
  }


  function exitEditMode() {
    setEditingId(null);
    setDragHandle(null);
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
    // ✅ FIRST: use stored bbox if present (this is your kewidth/keheight box)
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



  function worldFromLocal(o, lx, ly) {
    return { x: o.tx + o.scale * lx, y: o.ty + o.scale * ly };
  }

  // ---------- Multi-drag ----------
  function beginDragAll(startWorld, nextSelectedIds, nextSelectedOverlayIds) {
    const shapePayload = shapes
      .filter((s) => nextSelectedIds.includes(s.id))
      .map((s) => {
        if (s?.type === "text") {
          return { id: s.id, kind: "text", origX: Number(s.x ?? 0), origY: Number(s.y ?? 0) };
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
    return SVG_LIBRARY[fileKey];
  }

  function ensureGeneratedKey(name) {
    const clean = String(name || "Generated.svg").replace(/[\\/:*?"<>|]/g, "_");
    const base = clean.toLowerCase().endsWith(".svg") ? clean : `${clean}.svg`;
    let key = `__generated__/${base}`;
    let i = 2;
    while (generatedSvgMap.has(key) || SVG_LIBRARY[key]) {
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
    if (!entry) {
      const w = Math.max(40, Number(targetW) || 120);
      const h = Math.max(30, w * 0.6);
      return {
        id: uid(),
        sourceKey: fileKey || "__unknown__",
        name: fileKey ? fileKey.split("/").pop() || fileKey : "Unknown",
        inner: `<rect x="0" y="0" width="${w}" height="${h}" fill="${DEFAULT_FILL}" stroke="${DEFAULT_STROKE}" stroke-width="2" />`,
        tx: center.x - w / 2,
        ty: center.y - h / 2,
        scale: 1,
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        tagPath: "",
        bbox: { x: 0, y: 0, width: w, height: h },
      };
    }

    const raw = typeof entry === "function" ? await entry() : entry;
    if (typeof raw !== "string") {
      const w = Math.max(40, Number(targetW) || 120);
      const h = Math.max(30, w * 0.6);
      return {
        id: uid(),
        sourceKey: fileKey || "__unknown__",
        name: fileKey ? fileKey.split("/").pop() || fileKey : "Unknown",
        inner: `<rect x="0" y="0" width="${w}" height="${h}" fill="${DEFAULT_FILL}" stroke="${DEFAULT_STROKE}" stroke-width="2" />`,
        tx: center.x - w / 2,
        ty: center.y - h / 2,
        scale: 1,
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        tagPath: "",
        bbox: { x: 0, y: 0, width: w, height: h },
      };
    }

    const parsed = stripOuterSvg(raw);
    if (!parsed) {
      const w = Math.max(40, Number(targetW) || 120);
      const h = Math.max(30, w * 0.6);
      return {
        id: uid(),
        sourceKey: fileKey || "__unknown__",
        name: fileKey ? fileKey.split("/").pop() || fileKey : "Unknown",
        inner: `<rect x="0" y="0" width="${w}" height="${h}" fill="${DEFAULT_FILL}" stroke="${DEFAULT_STROKE}" stroke-width="2" />`,
        tx: center.x - w / 2,
        ty: center.y - h / 2,
        scale: 1,
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        tagPath: "",
        bbox: { x: 0, y: 0, width: w, height: h },
      };
    }

    const key = extractKeySize(raw);
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

    return {
      id: uid(),
      sourceKey: fileKey,
      name: fileKey.split("/").pop() || fileKey,
      inner,
      tx,
      ty,
      scale,
      fill: DEFAULT_FILL,
      stroke: DEFAULT_STROKE,
      tagPath: "",
      bbox: { x: localVb.x, y: localVb.y, width: localVb.w, height: localVb.h },
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
        const fontSize = Number(s.fontSize ?? 24);
        const txt = String(s.text ?? "");
        const estW = Math.max(10, txt.length * fontSize * 0.6);
        const estH = Math.max(10, fontSize * 1.2);
        const anchor = s.anchor ?? "start";
        const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;
        items.push({
          x: Number(s.x ?? 0) + ax,
          y: Number(s.y ?? 0) - estH,
          w: estW,
          h: estH,
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
      items.push({
        x: o.tx + o.scale * bb.x,
        y: o.ty + o.scale * bb.y,
        w: o.scale * bb.width,
        h: o.scale * bb.height,
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
  }


  function duplicateSelectedStable() {
    const pad = getDupOffset();

    const curShapes = shapesRef.current;
    const curOverlays = overlaysRef.current;
    const curSelShapes = selPolyRef.current;     // (your selectedIds)
    const curSelOvers = selOverRef.current;      // (your selectedOverlayIds)

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

    const dx = refW + pad; // ✅ width of leftmost element + offset

    // build duplicates
    pushHistory();

    const shapeDups = curShapes
      .filter((s) => curSelShapes.includes(s.id))
      .map((s) => {
        const id = uid();

        // ✅ Text duplicate (shift right only)
        if (s.type === "text") {
          return { ...s, id, x: Number(s.x ?? 0) + dx, y: Number(s.y ?? 0) };
        }

        // ✅ Polyline duplicate
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
        return { ...o, id, tx: o.tx + dx, ty: o.ty }; // ✅ keep Y
      });

    if (shapeDups.length) setShapes((prev) => [...prev, ...shapeDups]);
    if (overlayDups.length) setSvgOverlays((prev) => [...prev, ...overlayDups]);

    // ✅ IMPORTANT: set selection AFTER state applies (so next Ctrl+D sees selection)
    queueMicrotask(() => {
      setSelectedIds(shapeDups.map((s) => s.id));
      setSelectedOverlayIds(overlayDups.map((o) => o.id));
    });

    exitEditMode();
    setDrawing(null);
    setTool("select");
  }

  function handleDuplicate() {
    duplicateSelectedStable();
  }

  function copySelection() {
    const curShapes = shapesRef.current;
    const curOverlays = overlaysRef.current;
    const curSelShapes = selPolyRef.current;
    const curSelOvers = selOverRef.current;

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
          const fontSize = Number(s.fontSize ?? 24);
          const txt = String(s.text ?? "");
          const estW = Math.max(10, txt.length * fontSize * 0.6);
          const estH = Math.max(10, fontSize * 1.2);
          const anchor = s.anchor ?? "start";
          const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;
          boxes.push({
            x: Number(s.x ?? 0) + ax,
            y: Number(s.y ?? 0) - estH,
            w: estW,
            h: estH,
          });
        } else if (Array.isArray(s.points)) {
          const bb = bboxOfPoints(s.points);
          if (bb) boxes.push({ x: bb.minX, y: bb.minY, w: bb.w, h: bb.h });
        }
      }
      for (const o of clip.overlays) {
        const bb = o.bbox || overlayLocalBBox(o.id);
        if (!bb) continue;
        boxes.push({
          x: o.tx + o.scale * bb.x,
          y: o.ty + o.scale * bb.y,
          w: o.scale * bb.width,
          h: o.scale * bb.height,
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
  function startPolylineAt(p) {
    pushHistory();
    const id = uid();
    const poly = {
      id,
      type: "polyline",
      tagPath: "", // ✅ NEW
      points: [p, { x: p.x, y: p.y }], // last is preview
      stroke: "#808080",
      strokeWidth: 3,
      lineStyle: "solid",
    };

    setShapes((prev) => [...prev, poly]);
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setDrawing({ mode: "draw-poly", id });
    setShowHUD(false);
  }

  function addPolylinePoint(p) {
    pushHistory();
    if (!drawing || drawing.mode !== "draw-poly") return;
    const id = drawing.id;

    setShapes((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;

        const fixed = s.points.slice(0, -1);
        const lastFixed = fixed[fixed.length - 1];
        const firstFixed = fixed[0];
        const SNAP_DIST = 12;
        let nextP = p;
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

  function finishPolyline() {
    pushHistory();
    if (!drawing || drawing.mode !== "draw-poly") return;
    const id = drawing.id;

    setShapes((prev) =>
      prev.flatMap((s) => {
        // keep everything else (including text)
        if (s.id !== id) return [s];

        // only polylines can be finished here
        if (s.type !== "polyline" || !Array.isArray(s.points)) return [s];

        const fixed = s.points.slice(0, -1); // remove preview point

        // if too short, drop ONLY this polyline
        if (fixed.length < 2) return [];

        return [{ ...s, points: fixed }];
      })
    );

    setDrawing(null);
    clearSelection();
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
    if (selectedIds.length) {
      setShapes((prev) => prev.filter((s) => !selectedIds.includes(s.id)));
      if (editingId && selectedIds.includes(editingId)) setEditingId(null);
    }
    if (selectedOverlayIds.length) {
      setSvgOverlays((prev) => prev.filter((o) => !selectedOverlayIds.includes(o.id)));
    }
    clearSelection();
    exitEditMode();
  }

  function onShapeMouseDown(e, id) {
    if (tool !== "select") return;
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

    let nextPoly = selectedIds;
    let nextOver = selectedOverlayIds;

    if (!selectedIds.includes(id)) {
      nextPoly = [id];
      nextOver = [];
      setSelectedIds(nextPoly);
      setSelectedOverlayIds(nextOver);
    }

    const p = svgPoint(e);
    beginDragAll(p, nextPoly, nextOver);
  }

  function onShapeDoubleClick(e, id) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();

    const s = shapes.find((x) => x.id === id);
    if (s?.type === "text") {
      setSelectedIds([id]);
      setSelectedOverlayIds([]);
      setEditingId(null);
      setInlineEdit(null);
      setPanelCursor({ x: e.clientX, y: e.clientY });
      setShowHUD(true);
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

  //   const p = svgPoint(e);      // uses clientX/clientY → world coords
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
    e.stopPropagation();
    e.preventDefault();

    if (e.shiftKey) {
      setSelectedOverlayIds((prev) => toggleIn(prev, id));
      exitEditMode();
      setDrawing(null);
      return;
    }

    let nextPoly = selectedIds;
    let nextOver = selectedOverlayIds;

    if (!selectedOverlayIds.includes(id)) {
      nextOver = [id];
      nextPoly = [];
      setSelectedOverlayIds(nextOver);
      setSelectedIds(nextPoly);
    }

    exitEditMode();
    setDrawing(null);

    const p = svgPoint(e);
    beginDragAll(p, nextPoly, nextOver);
  }

  function onOverlayDoubleClick(e, id) {
    if (tool !== "select") return;
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
    pushHistory(); // ✅ UNDO: start of overlay resize
    setOverlayResize({
      id,
      anchorLocal,
      anchorWorld,
      startDist,
      origScale: o.scale,
    });
  }

  function extractSvgSize(rawSvg) {
    try {
      const doc = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg) return null;

      // 1️⃣ Ignition-style properties
      const kw = svg.getAttribute("kewidth");
      const kh = svg.getAttribute("keheight");

      if (kw && kh) {
        const w = parseFloat(kw);
        const h = parseFloat(kh);
        if (Number.isFinite(w) && Number.isFinite(h)) {
          return { w, h, source: "key" };
        }
      }

      // 2️⃣ Standard width/height
      const wAttr = svg.getAttribute("width");
      const hAttr = svg.getAttribute("height");

      if (wAttr && hAttr) {
        const w = parseFloat(wAttr);
        const h = parseFloat(hAttr);
        if (Number.isFinite(w) && Number.isFinite(h)) {
          return { w, h, source: "attr" };
        }
      }

      // 3️⃣ ViewBox fallback
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



  // ✅ Lazy/eager compatible SVG import
  async function onPickSvg(fileKey, anchorOverride) {
    const entry = getSvgEntry(fileKey);
    if (!entry) return;

    // entry is a function in lazy mode, string in eager mode
    const raw = typeof entry === "function" ? await entry() : entry;
    if (typeof raw !== "string") return;

    const parsed = stripOuterSvg(raw);
    if (!parsed) return;

    pushHistory(); // ✅ undo import

    const pad = 40;
    const availW = vbW - pad * 2;
    const availH = vbH - pad * 2;

    const key = extractKeySize(raw);
    console.log("🔑 extractKeySize:", key);
    const baseVb = parsed.vb; // {x,y,w,h}

    // ✅ If key exists, overlay local coords become 0..key.w / 0..key.h
    let localVb = key ? { x: 0, y: 0, w: key.w, h: key.h } : baseVb;
    if (!localVb || !Number.isFinite(localVb.w) || !Number.isFinite(localVb.h) || localVb.w <= 0 || localVb.h <= 0) {
      localVb = { x: 0, y: 0, w: 100, h: 100 };
    }

    // ✅ Normalize inner so geometry matches localVb
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

    // ✅ If kewidth/keheight exists, import at EXACT size (1 world unit = 1 key unit)
    // Otherwise default to 350 width.
    const scale = key ? 1 : Math.min(350 / srcW, vbH / srcH);

    const srcCx = localVb.x + localVb.w / 2;
    const srcCy = localVb.y + localVb.h / 2;

    const anchor = anchorOverride ?? importAnchor ?? { x: vbW / 2, y: vbH / 2 };

    const tx = anchor.x - scale * srcCx;
    const ty = anchor.y - scale * srcCy;

    // ✅ bbox must be in the SAME local coordinate system the overlay uses
    const bbox = { x: localVb.x, y: localVb.y, width: localVb.w, height: localVb.h };

    const id = uid();
    setSvgOverlays((prev) => [
      ...prev,
      {
        id,
        sourceKey: fileKey,
        name: fileKey.split("/").pop() || fileKey,
        inner,
        tx,
        ty,
        scale,
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        tagPath: "",
        bbox,
      },
    ]);

    setSelectedOverlayIds([id]);
    setSelectedIds([]);
    setImportOpen(false);
    exitEditMode();
    setShowHUD(false);
    setImportAnchor(null);
  }

  async function swapOverlayTemplate(overlayId, fileKey) {
    const o = overlaysRef.current.find((x) => x.id === overlayId);
    if (!o) return;
    const bb = overlayLocalBBox(overlayId);
    if (!bb) return;

    const worldX = o.tx + o.scale * bb.x;
    const worldY = o.ty + o.scale * bb.y;
    const worldW = o.scale * bb.width;
    const worldH = o.scale * bb.height;
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

      // ✅ Polyline
      if (s.type === "polyline" || Array.isArray(s.points)) {
        if (!Array.isArray(s.points)) continue;
        const bb = bboxOfPoints(s.points);
        if (!bb) continue;
        boxes.push({ x: bb.minX, y: bb.minY, w: bb.w, h: bb.h });
        continue;
      }

      // ✅ Text
      if (s.type === "text") {
        const fontSize = Number(s.fontSize ?? 24);
        const txt = String(s.text ?? "");
        const estW = Math.max(10, txt.length * fontSize * 0.6); // rough width
        const estH = Math.max(10, fontSize * 1.2);

        // anchor: start | middle | end
        const anchor = s.anchor ?? "start";
        const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;

        boxes.push({
          x: Number(s.x ?? 0) + ax,
          y: Number(s.y ?? 0) - estH, // ✅ better bbox: y is top; text y is baseline
          w: estW,
          h: estH,
        });
        continue;
      }
    }

    for (const id of selectedOverlayIds) {
      const o = svgOverlays.find((x) => x.id === id);
      if (!o) continue;
      const bb = overlayLocalBBox(id);
      if (!bb) continue;

      boxes.push({
        x: o.tx + o.scale * bb.x,
        y: o.ty + o.scale * bb.y,
        w: o.scale * bb.width,
        h: o.scale * bb.height,
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
    fill: DEFAULT_FILL,
    stroke: DEFAULT_STROKE,
    arrowStart: "none",
    arrowEnd: "none",
    lineStyle: "solid",   // ✅ NEW
    x: "",
    y: "",
    w: "",
    h: "",
    text: "",
    fontSize: "24",
    fontFamily: "system-ui",
    fontWeight: "400",
    textAlign: "start",
  });


  useEffect(() => {
    if (!selectedBBox) {
      setHudFields({
        id: "",
        tagPath: "",
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
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
      });
      return;
    }

    let idText = "";
    let tagPath = "";
    let fill = DEFAULT_FILL;
    let stroke = DEFAULT_STROKE;
    let arrowStart = "none";
    let arrowEnd = "none";
    let lineStyle = "solid"; // ✅ NEW

    if (isSingle && singleKind === "Polyline") {
      const s = shapes.find((x) => x.id === singleId);
      if (s) {
        idText = s.id;
        tagPath = s.tagPath || "";
        stroke = s.stroke || DEFAULT_STROKE;
        arrowStart = s.arrowStart ?? "none";
        arrowEnd = s.arrowEnd ?? "none";
        lineStyle = s.lineStyle ?? "solid"; // ✅ NEW
      }
    } else if (isSingle && singleKind === "SVG") {
      const o = svgOverlays.find((x) => x.id === singleId);
      if (o) {
        idText = o.id;
        tagPath = o.tagPath || "";
        fill = !o.fill || o.fill === "none" ? DEFAULT_FILL : o.fill;
        stroke = !o.stroke || o.stroke === "none" ? DEFAULT_STROKE : o.stroke;
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
          fill,
          stroke,
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
        });
        return;
      }
    }


    setHudFields({
      id: idText,
      tagPath,
      fill,
      stroke,
      arrowStart,
      arrowEnd,
      lineStyle, // ✅ NEW
      x: String(fmt(selectedBBox.x)),
      y: String(fmt(selectedBBox.y)),
      w: String(fmt(selectedBBox.w)),
      h: String(fmt(selectedBBox.h)),
      text: "",
      fontSize: "24",
      fontFamily: "system-ui",
      fontWeight: "400",
      textAlign: "start",
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
    } else if (singleKind === "SVG") {
      setSvgOverlays((prev) => prev.map((o) => (o.id === singleId ? { ...o, id: nextId } : o)));
      setSelectedOverlayIds([nextId]);
    }
  }

  function applySingleTagPath(nextRaw) {
    if (!isSingle || !singleId) return;
    const v = String(nextRaw ?? "").trim();

    if (singleKind === "Polyline" || singleKind === "Text") {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, tagPath: v } : s)));
    } else if (singleKind === "SVG") {
      setSvgOverlays((prev) => prev.map((o) => (o.id === singleId ? { ...o, tagPath: v } : o)));
    }
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

  function applySingleStroke(nextStroke) {
    if (!isSingle || !singleId) return;
    const c = String(nextStroke || "").trim();
    if (!c) return;

    if (singleKind === "Polyline") {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, stroke: c } : s)));
    } else if (singleKind === "SVG") {
      setSvgOverlays((prev) =>
        prev.map((o) =>
          o.id === singleId ? { ...o, stroke: c, inner: updateSvgInnerStroke(o.inner, c) } : o
        )
      );
    }
  }

  function applySingleFill(nextFill) {
    if (!isSingle || !singleId) return;
    const c = String(nextFill || "").trim();
    if (!c) return;

    if (singleKind === "SVG") {
      setSvgOverlays((prev) =>
        prev.map((o) =>
          o.id === singleId ? { ...o, fill: c, inner: updateSvgInnerFill(o.inner, c) } : o
        )
      );
    } else if (singleKind === "Text") {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, fill: c } : s)));
    }
  }

  function applyBBoxFromHud(next) {
    const X = numOrNull(next.x);
    const Y = numOrNull(next.y);
    const W = numOrNull(next.w);
    const H = numOrNull(next.h);

    if (!selectedBBox) return;

    if (selectedOverlayIds.length === 1 && selectedIds.length === 0) {
      const id = selectedOverlayIds[0];
      const o = svgOverlays.find((x) => x.id === id);
      if (!o) return;

      // use your key-based bbox first (this is {width: 25, height: 25} for your files)
      const bb = o.bbox || overlayLocalBBox(id);
      if (!bb) return;

      const targetX = X == null ? selectedBBox.x : X;
      const targetY = Y == null ? selectedBBox.y : Y;

      // compute scale from desired W/H
      let nextScale = o.scale;

      // If user typed W, scale must be W / bb.width
      if (W != null && bb.width > 0) nextScale = W / bb.width;

      // If user typed H (and not W), scale must be H / bb.height
      if (W == null && H != null && bb.height > 0) nextScale = H / bb.height;

      // If they typed BOTH, we cannot satisfy both unless aspect matches (uniform scale).
      // We'll prefer W (so "exact W" works). If you prefer "fit inside", use Math.min().
      if (W != null && H != null && bb.width > 0 && bb.height > 0) {
        nextScale = W / bb.width; // ✅ prefer exact W
        // alternative: nextScale = Math.min(W / bb.width, H / bb.height);
      }

      nextScale = Math.max(0.05, nextScale);

      // Make top-left match targetX/targetY
      const newTx = targetX - nextScale * bb.x;
      const newTy = targetY - nextScale * bb.y;

      setSvgOverlays((prev) =>
        prev.map((x) => (x.id === id ? { ...x, tx: newTx, ty: newTy, scale: nextScale } : x))
      );

      return; // ✅ stop here so old min(sx,sy) logic doesn't interfere
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

          // ✅ Polyline
          if ((s.type === "polyline" || Array.isArray(s.points)) && Array.isArray(s.points)) {
            const pts = s.points.map((p) => ({
              x: base.x + (p.x - base.x) * sx + dx,
              y: base.y + (p.y - base.y) * sy + dy,
            }));
            return { ...s, points: pts };
          }

          // ✅ Text
          if (s.type === "text") {
            const newX = base.x + (Number(s.x ?? 0) - base.x) * sx + dx;
            const newY = base.y + (Number(s.y ?? 0) - base.y) * sy + dy;

            // If user is resizing via W/H, scale fontSize uniformly (optional but feels right)
            const fs0 = Number(s.fontSize ?? 24);
            const newFontSize =
              Number.isFinite(fs0) ? Math.max(1, fs0 * sUni) : s.fontSize;

            return { ...s, x: newX, y: newY, fontSize: newFontSize };
          }

          // unknown shape type: just move by dx/dy
          return s;
        })
      );
    }


    // Overlays: uniform scale only
    if (selectedOverlayIds.length) {
      const sUni = Math.max(0.05, Math.min(sx, sy));
      setSvgOverlays((prev) =>
        prev.map((o) => {
          if (!selectedOverlayIds.includes(o.id)) return o;

          const newTx = base.x + (o.tx - base.x) * sx + dx;
          const newTy = base.y + (o.ty - base.y) * sy + dy;
          const newScale = Math.max(0.05, o.scale * sUni);

          return { ...o, tx: newTx, ty: newTy, scale: newScale };
        })
      );
    }
  }

  // ---------- Mouse / Keyboard ----------
  useKeyboardShortcuts({
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
    clearImportAnchor: () => setImportAnchor(null),
    deleteSelected,
  });

  function onSvgMouseDown(e) {
    if (e.button === 2) return;
    if (importOpen) return;

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

      if (!drawing) startPolylineAt(p2);
      else addPolylinePoint(p2);
      return;
    }

    if (tool === "text") {
      startTextAt(p);
      return;
    }

    if (tool === "select" && !e.shiftKey) {
      setMarquee({ start: p, cur: p });
      clearSelection();
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
      if (tool !== "polyline" || !drawing) return;
      e.preventDefault();
      e.stopPropagation();
      finishPolyline();
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [tool, drawing]);


  function onContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();

    // ✅ While drawing: right-click removes the last SAVED segment (2 entries back)
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

    // ✅ Not drawing: keep your import-marker right-double-click
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

    for (const s of shapesRef.current || []) {
      if (s.type === "text") {
        const fontSize = Number(s.fontSize ?? 24);
        const txt = String(s.text ?? "");
        const estW = Math.max(10, txt.length * fontSize * 0.6);
        const estH = Math.max(10, fontSize * 1.2);
        const anchor = s.anchor ?? "start";
        const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;
        const pad = 8;
        const r = {
          x: Number(s.x ?? 0) + ax - pad,
          y: Number(s.y ?? 0) - pad,
          w: Math.max(estW + pad * 2, 60),
          h: Math.max(estH + pad * 2, 28),
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
      for (const o of overlaysRef.current || []) {
        const bb = o.bbox || overlayLocalBBox(o.id);
        if (!bb) continue;
        const r = {
          x: o.tx + o.scale * bb.x,
          y: o.ty + o.scale * bb.y,
          w: o.scale * bb.width,
          h: o.scale * bb.height,
        };
        if (pointInRect(p, r)) { hit = true; hitOverlayId = o.id; break; }
      }
    }

    // ✅ If nothing directly hit, allow right-click on current group bbox
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




  function onMouseMove(e) {
    const p =
      drawing?.mode === "draw-poly"
        ? svgPoint(e, { snapToGrid: true })
        : svgPoint(e, { snapToGrid: false });
    if (marquee) {
      setMarquee((m) => (m ? { ...m, cur: p } : m));
      return;
    }

    if (drawing?.mode === "draw-poly") {
      const id = drawing.id;

      setShapes((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;

          const pts = s.points.slice();
          const fixed = pts.slice(0, -1);             // points excluding preview
          const last = fixed[fixed.length - 1] || pts[0];

          let nextP = svgPoint(e);

          // ✅ ALT = straight line (horizontal/vertical) from last fixed point
          if (e.altKey && last) {
            nextP = constrainHV(last, nextP);
          }

          const first = fixed[0];
          const SNAP_DIST = 12;
          if (first && distance(nextP, first) <= SNAP_DIST) {
            nextP = { x: first.x, y: first.y };
          }

          pts[pts.length - 1] = { x: nextP.x, y: nextP.y };
          return { ...s, points: pts };
        })
      );
      return;
    }

    if (overlayResize) {
      const { id, anchorLocal, anchorWorld, startDist, origScale } = overlayResize;
      const o = svgOverlays.find((x) => x.id === id);
      if (!o) return;

      const d = Math.max(1, distance(p, anchorWorld));
      const ratio = d / startDist;
      const newScale = Math.max(0.05, origScale * ratio);

      const newTx = anchorWorld.x - newScale * anchorLocal.x;
      const newTy = anchorWorld.y - newScale * anchorLocal.y;

      setSvgOverlays((prev) =>
        prev.map((x) => (x.id === id ? { ...x, scale: newScale, tx: newTx, ty: newTy } : x))
      );
      return;
    }

    if (dragHandle) {
      setShapes((prev) =>
        prev.map((s) => {
          if (s.id !== dragHandle.id) return s;
          const pts = s.points.slice();
          pts[dragHandle.index] = { x: p.x, y: p.y };
          return { ...s, points: pts };
        })
      );
      return;
    }

    if (dragAll) {
      const dx = p.x - dragAll.startWorld.x;
      const dy = p.y - dragAll.startWorld.y;

      if (dragAll.shapes?.length) {
        setShapes((prev) =>
          prev.map((s) => {
            const rec = dragAll.shapes.find((x) => x.id === s.id);
            if (!rec) return s;

            if (rec.kind === "text" && s.type === "text") {
              return { ...s, x: rec.origX + dx, y: rec.origY + dy };
            }

            if (rec.kind === "poly" && Array.isArray(s.points)) {
              return { ...s, points: rec.origPoints.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })) };
            }

            return s;
          })
        );
      }

      if (dragAll.overlays?.length) {
        setSvgOverlays((prev) =>
          prev.map((o) => {
            const rec = dragAll.overlays.find((x) => x.id === o.id);
            if (!rec) return o;
            return { ...o, tx: rec.origTx + dx, ty: rec.origTy + dy };
          })
        );
      }
      return;
    }

  }

  function onMouseUp() {
    if (marquee) {
      const r = rectFrom2Points(marquee.start, marquee.cur);

      // ✅ Shapes (polylines + text) in rect
      const hitShapeIds = shapes
        .filter((s) => {
          // Polyline bbox
          if (s.type === "polyline" && Array.isArray(s.points)) {
            const bb = bboxOfPoints(s.points);
            if (!bb) return false;
            const br = { x: bb.minX, y: bb.minY, w: bb.w, h: bb.h };
            return rectsIntersect(r, br);
          }

          // Text bbox (approx)
          if (s.type === "text") {
            const fontSize = Number(s.fontSize ?? 24);
            const txt = String(s.text ?? "");
            const estW = Math.max(10, txt.length * fontSize * 0.6);
            const estH = Math.max(10, fontSize * 1.2);

            const anchor = s.anchor ?? "start";
            const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;

            const br = {
              x: Number(s.x ?? 0) + ax,
              y: Number(s.y ?? 0) - estH, // baseline -> top
              w: estW,
              h: estH,
            };
            return rectsIntersect(r, br);
          }

          return false;
        })
        .map((s) => s.id);

      // ✅ Overlays in rect
      const hitOvers = svgOverlays
        .filter((o) => {
          const bb = overlayLocalBBox(o.id);
          if (!bb) return false;
          const wr = {
            x: o.tx + o.scale * bb.x,
            y: o.ty + o.scale * bb.y,
            w: o.scale * bb.width,
            h: o.scale * bb.height,
          };
          return rectsIntersect(r, wr);
        })
        .map((o) => o.id);

      setSelectedIds(hitShapeIds);
      setSelectedOverlayIds(hitOvers);

      setMarquee(null);
      setDragAll(null);
      setDragHandle(null);
      setOverlayResize(null);
      return;
    }

    setDragAll(null);
    setDragHandle(null);
    setOverlayResize(null);
  }



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

    const x = o.tx + o.scale * bb.x;
    const y = o.ty + o.scale * bb.y;
    const w = o.scale * bb.width;
    const h = o.scale * bb.height;

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

  const inlineEditPos = useMemo(() => {
    if (!inlineEdit?.id || !svgRef.current) return null;
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
  }, [inlineEdit?.id, shapes, pan, zoom]);

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
    return `${selectedBBox.x}-${selectedBBox.y}-${selectedBBox.w}-${selectedBBox.h}-${selCount}-${singleKind}`;
  }, [selectedBBox, selCount, singleKind]);

  const freezePanel = !!(dragAll || dragHandle || overlayResize);
  const isEmptyMenu = contextMenu?.mode === "empty";
  const menuSize = isEmptyMenu ? { w: 210, h: 260 } : { w: 190, h: 240 };
  const winW = typeof window !== "undefined" ? window.innerWidth : 0;
  const winH = typeof window !== "undefined" ? window.innerHeight : 0;
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

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#fafafa",
        overflow: "hidden",
        fontFamily: "system-ui",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <Toolbar
        tool={tool}
        setTool={setTool}
        importOpen={importOpen}
        setImportOpen={setImportOpen}
        exportSVG={exportSVG}
        exportIgnitionJson={exportIgnitionJson}
        editingId={editingId}
        toggleEditMode={toggleEditMode}
        toolbarPos={toolbarPos}
        setToolbarPos={setToolbarPos}
        selectedIds={selectedIds}
        selectedOverlayIds={selectedOverlayIds}
        setEditingId={setEditingId}
        setDrawing={setDrawing}
        exitEditMode={exitEditMode}
        setSelectedOverlayIds={setSelectedOverlayIds}
        deleteSelected={deleteSelected}
        showToolbar={showToolbar}
        setShowToolbar={setShowToolbar}
        resetView={resetView}
        openViewBox={() => setViewBoxOpen(true)}
        exportProjectJson={saveProject}     // Save
        exportProjectJsonAs={saveProjectAs} // Save As (NEW PROP)
        importProjectJson={loadProjectViaPicker} // Load


      />

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
        applySingleFill={applySingleFill}
        applySingleStroke={applySingleStroke}
        applyBBoxFromHud={applyBBoxFromHud}
        applySingleArrowStart={applySingleArrowStart}
        applySingleArrowEnd={applySingleArrowEnd}
        applySingleLineStyle={applySingleLineStyle}
        applySingleTextValue={applySingleTextValue}
        applySingleFontSize={applySingleFontSize}
        applySingleFontFamily={applySingleFontFamily}
        applySingleFontWeight={applySingleFontWeight}
        applySingleTextAlign={applySingleTextAlign}
        duplicateOffset={duplicateOffset}
        setDuplicateOffset={setDuplicateOffset}
        convertPolylinesToSvg={convertSelectedPolylinesToSvg}
      />

      <ImportModal importOpen={importOpen}
        setImportOpen={setImportOpen}
        svgFiles={svgFiles}
        svgLibrary={SVG_LIBRARY}   // ✅ add this
        onPickSvg={onPickSvg}
      />

        <CanvasSvg
          svgRef={svgRef}
          zoom={zoom}          // ✅ NEW
          onWheel={onWheelZoom} // ✅ NEW
          vbW={vbW}
          vbH={vbH}
          tool={tool}
          shapes={shapes}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          setSelectedOverlayIds={setSelectedOverlayIds}
          inlineEditId={inlineEdit?.id || null}
          selectedSegment={selectedSegment}
          editingId={editingId}
        showTagPaths={showTagPaths}
        showGrid={showGrid}
        onSvgMouseDown={onSvgMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onContextMenu={onContextMenu}
        onShapeMouseDown={onShapeMouseDown}
        onShapeDoubleClick={onShapeDoubleClick}
        onEditPolylineClick={onEditPolylineClick}
        onHandleMouseDown={onHandleMouseDown}
        onHandleDoubleClick={onHandleDoubleClick}
        onHandleContextMenu={onHandleContextMenu}
        onSegmentMouseDown={onSegmentMouseDown}
        setShapes={setShapes}
        svgOverlays={svgOverlays}
        setSvgOverlays={setSvgOverlays}
        selectedOverlayIds={selectedOverlayIds}
        singleSelectedOverlayId={singleSelectedOverlayId}
        setOverlayRef={setOverlayRef}
        onOverlayMouseDown={onOverlayMouseDown}
        onOverlayDoubleClick={onOverlayDoubleClick}
        overlaySelectionUI={overlaySelectionUI}
        overlayLocalBBox={overlayLocalBBox}
        marquee={marquee}
        pan={pan}
        importAnchor={importAnchor}
        onSvgDoubleClick={onSvgDoubleClick}
      />

      {inlineEdit && inlineEditPos && (
        <input
          autoFocus
          value={inlineEdit.value}
          onChange={(e) => setInlineEdit((p) => ({ ...p, value: e.target.value }))}
          onBlur={() => {
            const next = inlineEdit.value;
            if (next != null) {
              pushHistory();
              setShapes((prev) =>
                prev.map((x) => (x.id === inlineEdit.id ? { ...x, text: String(next) } : x))
              );
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
            color: "#111",
            border: "1px solid #2b6cff",
            borderRadius: 6,
            padding: "2px 6px",
            background: "white",
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

          // ✅ allow selecting same file again later
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

          // ✅ update project metadata
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




      {showZoom && (
        <div
          style={{
            position: "absolute",
            left: toolbarPos.x,
            bottom: 16,
            zIndex: 80,
            boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 10,
            background: "rgba(255,255,255,0.95)",
            border: "1px solid #e6e6e6",
            borderRadius: 14,
            alignItems: "center",
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {/* Zoom buttons */}
          {[
            { label: "+", onClick: zoomIn, title: "Zoom In" },
            { label: "−", onClick: zoomOut, title: "Zoom Out" },
            { label: "⟲", onClick: resetView, title: "Reset View" },
          ].map((btn) => (
            <button
              key={btn.title}
              title={btn.title}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={btn.onClick}
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                border: "1px solid #d6d6d6",
                background: "white",
                cursor: "pointer",
                boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
                color: "#111",
                display: "grid",
                placeItems: "center",
                padding: 0,
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              {btn.label}
            </button>
          ))}

          {/* zoom % */}
          <div
            style={{
              fontSize: 12,
              opacity: 0.6,
              marginTop: 2,
              userSelect: "none",
            }}
          >
            {Math.round((zoom || 1) * 100)}%
          </div>

          <button
            title="Toggle Tag Paths"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setShowTagPaths((v) => !v)}
            style={{
              width: 38,
              height: 32,
              marginTop: 4,
              borderRadius: 10,
              border: showTagPaths ? "2px solid #2b6cff" : "1px solid #d6d6d6",
              background: showTagPaths ? "linear-gradient(180deg, #eef3ff 0%, #e2ecff 100%)" : "white",
              cursor: "pointer",
              boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
              color: showTagPaths ? "#1f56cc" : "#111",
              display: "grid",
              placeItems: "center",
              padding: 0,
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            Tag
          </button>

          <button
            title="Toggle Grid"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setShowGrid((v) => !v)}
            style={{
              width: 38,
              height: 32,
              marginTop: 4,
              borderRadius: 10,
              border: showGrid ? "2px solid #2b6cff" : "1px solid #d6d6d6",
              background: showGrid ? "linear-gradient(180deg, #eef3ff 0%, #e2ecff 100%)" : "white",
              cursor: "pointer",
              boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
              color: showGrid ? "#1f56cc" : "#111",
              display: "grid",
              placeItems: "center",
              padding: 0,
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            Grid
          </button>

          {/* ❌ Hide button (toolbar style, bottom) */}
          <button
            title="Hide Zoom"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setShowZoom(false)}
            style={{
              width: 38,
              height: 38,
              marginTop: 6,
              borderRadius: 12,
              border: "1px solid #d6d6d6",
              background: "white",
              cursor: "pointer",
              boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
              color: "#111",
              display: "grid",
              placeItems: "center",
              padding: 0,
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: menuLeft,
            top: menuTop,
            zIndex: 200,
            background: "white",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 10,
            boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
            padding: isEmptyMenu ? 0 : "6px 0",
            minWidth: isEmptyMenu ? menuSize.w : 160,
            maxHeight: isEmptyMenu ? menuSize.h : undefined,
            overflow: isEmptyMenu ? "hidden" : "visible",
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
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
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
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
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
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
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
              onClick={() => {
                handleDuplicate();
                setContextMenu(null);
              }}
            >
              Duplicate
            </div>
          )}

          {contextMenu.mode === "element" && selectedIds.length === 1 && (() => {
            const s = shapes.find((x) => x.id === selectedIds[0]);
            return s && (s.type === "polyline" || Array.isArray(s.points));
          })() && (
            <div
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
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
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#b00020" }}
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
              {(clipboardRef.current.shapes.length > 0 || clipboardRef.current.overlays.length > 0) && (
                <div
                  style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
                  onClick={() => {
                    pasteClipboard();
                    setContextMenu(null);
                  }}
                >
                  Paste
                </div>
              )}
              <div
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
                onClick={() => {
                  undo();
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>↶</span>
                Undo
              </div>
              <div
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
                onClick={() => {
                  redo();
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>↷</span>
                Redo
              </div>
              <div
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
                onClick={() => {
                  setTool("polyline");
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>／</span>
                Polyline
              </div>
              <div
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
                onClick={() => {
                  setTool("text");
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>T</span>
                Text
              </div>
              <div
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
                onClick={() => {
                  setTool("select");
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>↔</span>
                Move
              </div>
              <div
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "#111",
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
                <span style={{ color: "#999" }}>▸</span>
              </div>
            </>
          )}

          {contextMenu.mode === "element" && selectedBBox && !showHUD && (
            <div
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
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
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
              onClick={() => {
                setShowHUD(false);
                setContextMenu(null);
              }}
            >
              Hide Properties
            </div>
          )}
          {contextMenu.mode === "element" && !selectedBBox && (
            <div style={{ padding: "8px 12px", fontSize: 13, color: "#888" }}>
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
            background: "white",
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
            style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#b00020" }}
            onClick={() => {
              removeVertex(polyHandleMenu.id, polyHandleMenu.index);
              setSelectedSegment(null);
              setPolyHandleMenu(null);
            }}
          >
            Delete Segment
          </div>
          <div
            style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#111" }}
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
            background: "white",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 10,
            boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
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
          <div style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", background: "white" }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: "#111" }}>SVG Files</div>
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
                  border: "1px solid #e6e6e6",
                  background: "white",
                  borderRadius: 8,
                  padding: "7px 26px 7px 8px",
                  color: "#111",
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
                    border: "1px solid #e6e6e6",
                    background: "white",
                    cursor: "pointer",
                    lineHeight: 1,
                    color: "#111",
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
              <div style={{ color: "#888", fontSize: 12 }}>No matches.</div>
            ) : (
              contextGrouped.map((group) => (
                <div key={group.folder} style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "#808080", fontSize: 11, fontWeight: 800, padding: "2px 2px" }}>
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
                        border: "1px solid #e6e6e6",
                        background: "white",
                        cursor: "pointer",
                        color: "#111",
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
            inset: 0,
            zIndex: 220,
          }}
        >
          <div
            onClick={() => setShowMainDrawer(false)}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              height: "100%",
              width: "min(900px, 96vw)",
              background: "#f7f8fb",
              boxShadow: "-16px 0 40px rgba(0,0,0,0.18)",
              display: "flex",
              flexDirection: "column",
              borderLeft: "1px solid rgba(0,0,0,0.08)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderBottom: "1px solid #e4e7ec",
                background: "white",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "0.02em" }}>
                {drawerView === "ai"
                  ? "AI"
                  : drawerView === "data"
                  ? "Data"
                  : drawerView === "tags"
                  ? "Tags"
                  : drawerView === "opc"
                  ? "OPC Configuration"
                  : "Help"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {[
                  { key: "ai", label: "AI" },
                  { key: "data", label: "Data" },
                  { key: "tags", label: "Tags" },
                  { key: "opc", label: "OPC" },
                  { key: "help", label: "Help" },
                ].map((item) => (
                  <button
                    key={`drawer-nav-${item.key}`}
                    onClick={() => setDrawerView(item.key)}
                    style={{
                      border: "1px solid #d0d7e2",
                      background: drawerView === item.key ? "#2b6cff" : "white",
                      color: drawerView === item.key ? "white" : "#111",
                      borderRadius: 999,
                      padding: "4px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  onClick={() => setShowMainDrawer(false)}
                  style={{
                    border: "1px solid #d0d7e2",
                    background: "white",
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <div style={{ flex: "1 1 auto", overflow: "hidden" }}>
              {drawerView === "tags" ? (
                <div style={{ height: "100%", overflow: "auto" }}>
                  <OpcConfig embedded mode="tags" />
                </div>
              ) : drawerView === "opc" ? (
                <div style={{ height: "100%", overflow: "auto" }}>
                  <OpcConfig embedded />
                </div>
              ) : drawerView === "help" ? (
                <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
                  <HelpPanel inline onClose={() => setShowMainDrawer(false)} />
                </div>
              ) : (
                <iframe
                  title={drawerView === "data" ? "Data" : "AI"}
                  src={drawerView === "data" ? "/data" : "/ai"}
                  style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <button
        title="Menu"
        onClick={() => openDrawer("ai")}
        style={{
          position: "fixed",
          right: 60,
          top: 60,
          zIndex: 90,
          padding: "8px 12px",
          borderRadius: 10,
          border: "1px solid rgba(0,0,0,0.12)",
          background: "white",
          cursor: "pointer",
          boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
          color: "#111",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        Menu
      </button>


      {!showToolbar && (
        <button
          title="Show Toolbar"
          onClick={() => setShowToolbar(true)}
          style={{
            position: "fixed",
            left: toolbarPos.x,
            top: toolbarPos.y,
            zIndex: 92,
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid rgba(0,0,0,0.12)",
            background: "white",
            cursor: "pointer",
            boxShadow: "0 6px 14px rgba(0,0,0,0.10)",
            color: "#111",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          Toolbar
        </button>
      )}

      {!showZoom && (
        <button
          title="Show Zoom"
          onClick={() => setShowZoom(true)}
          style={{
            position: "fixed",
            left: toolbarPos.x,
            bottom: 16,
            zIndex: 92,
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid rgba(0,0,0,0.12)",
            background: "white",
            cursor: "pointer",
            boxShadow: "0 6px 14px rgba(0,0,0,0.10)",
            color: "#111",
            fontSize: 12,
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
