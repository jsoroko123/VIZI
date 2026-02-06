// src/App.jsx
import { useMemo, useRef, useState, useEffect } from "react";
import Toolbar from "./components/Toolbar";
import PropertiesPanel from "./components/PropertiesPanel";
import HelpPanel from "./components/HelpPanel";
import ImportModal from "./components/ImportModal";
import CanvasSvg from "./components/CanvasSvg";
import ViewBoxModal from "./components/ViewBoxModal";

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




export default function App() {
  const [tool, setTool] = useState("select"); // "select" | "polyline"
  const [shapes, setShapes] = useState([]); // polylines only

  // Multi-selection
  const [selectedIds, setSelectedIds] = useState([]); // polyline ids
  const [selectedOverlayIds, setSelectedOverlayIds] = useState([]); // overlay ids

  // drawing = { mode:"draw-poly", id }
  const [drawing, setDrawing] = useState(null);

  // unified drag for moving ALL selected items
  // { startWorld, polylines:[{id, origPoints}], overlays:[{id, origTx, origTy}] }
  const [dragAll, setDragAll] = useState(null);

  // editing a polyline
  const [editingId, setEditingId] = useState(null); // double-click line to edit
  const [dragHandle, setDragHandle] = useState(null); // { id, index }

  // Import picker UI
  const [importOpen, setImportOpen] = useState(false);

  // SVG overlays (imported files): { id, name, inner, tx, ty, scale, fill, stroke, tagPath }
  const [svgOverlays, setSvgOverlays] = useState([]);

  // overlay resize
  const [overlayResize, setOverlayResize] = useState(null); // { id, anchorLocal, anchorWorld, startDist, origScale }

  // ✅ Export settings (dynamic)
  const [exportVB, setExportVB] = useState({ x: 0, y: 0, w: 1600, h: 900 });
  const [exportBasis, setExportBasis] = useState({ w: 1600, h: 900 }); // affects Perspective "basis"
  const [showZoom, setShowZoom] = useState(true);
  const [marquee, setMarquee] = useState(null);

  const [vbW, setVbW] = useState(1600);
  const [vbH, setVbH] = useState(900);
  const [viewBoxOpen, setViewBoxOpen] = useState(false);

  const [importAnchor, setImportAnchor] = useState(null);


  const overlayRefs = useRef(new Map()); // id -> <g> element containing imported inner
  const svgRef = useRef(null);

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
  const [showHUD, setShowHUD] = useState(true);
  const [showHelp, setShowHelp] = useState(true);


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

  const applySingleTextAlign = (v) => {
    if (!isSingle || singleKind !== "Text" || !singleId) return;
    const a = v === "middle" || v === "end" ? v : "start";
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, anchor: a } : s)));
  };



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



  const svgFiles = useMemo(() => {
    return Object.keys(SVG_LIBRARY)
      .map((k) => ({ key: k, name: k.split("/").pop() || k }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const selCount = selectedIds.length + selectedOverlayIds.length;
  const isSingle = selCount === 1;

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
      fill: "#111111",
      fontFamily: "system-ui",
      anchor: "start", // start | middle | end
    };

    setShapes((prev) => [...prev, t]);
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(id); // reuse editingId for text too
    setTool("select"); // place once, go back to select
  }


  function exitEditMode() {
    setEditingId(null);
    setDragHandle(null);
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
  function duplicateSelected() {
    const pad = 20;
    if (!selectedIds.length && !selectedOverlayIds.length) return;
    if (!selectedBBox) return;

    const dx = Math.max(0, selectedBBox.w) + pad;

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
    const pad = 20;

    const curShapes = shapesRef.current;
    const curOverlays = overlaysRef.current;
    const curSelShapes = selPolyRef.current;     // (your selectedIds)
    const curSelOvers = selOverRef.current;      // (your selectedOverlayIds)

    if (!curSelShapes.length && !curSelOvers.length) return;

    // compute GROUP bbox from current selection (so multi-select works)
    const boxes = [];

    for (const id of curSelShapes) {
      const s = curShapes.find((x) => x.id === id);
      if (!s) continue;

      // ✅ Text
      if (s.type === "text") {
        const fontSize = Number(s.fontSize ?? 24);
        const txt = String(s.text ?? "");
        const estW = Math.max(10, txt.length * fontSize * 0.6);
        const estH = Math.max(10, fontSize * 1.2);

        const anchor = s.anchor ?? "start";
        const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;

        boxes.push({
          x: Number(s.x ?? 0) + ax,
          y: Number(s.y ?? 0) - estH, // baseline -> top
          w: estW,
          h: estH,
        });
        continue;
      }

      // ✅ Polyline / any points-based shape
      if (Array.isArray(s.points)) {
        const bb = bboxOfPoints(s.points);
        if (!bb) continue;
        boxes.push({ x: bb.minX, y: bb.minY, w: bb.w, h: bb.h });
      }
    }

    for (const id of curSelOvers) {
      const o = curOverlays.find((x) => x.id === id);
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
    const dx = groupW + pad; // ✅ width of group + pad

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



  // ---------- Polyline drawing/editing ----------
  function startPolylineAt(p) {
    pushHistory();
    const id = uid();
    const poly = {
      id,
      type: "polyline",
      tagPath: "", // ✅ NEW
      points: [p, { x: p.x, y: p.y }], // last is preview
      stroke: "#111",
      strokeWidth: 3,
      lineStyle: "solid",
    };

    setShapes((prev) => [...prev, poly]);
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setDrawing({ mode: "draw-poly", id });
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

        const newFixed =
          lastFixed && lastFixed.x === p.x && lastFixed.y === p.y ? fixed : [...fixed, p];

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
    setTool("select");
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
      setEditingId(id);

      const next = window.prompt("Edit text:", s.text ?? "");
      if (next != null) {
        pushHistory();
        setShapes((prev) => prev.map((x) => (x.id === id ? { ...x, text: String(next) } : x)));
      }
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
  }


  function onHandleDoubleClick(e, id, index) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    removeVertex(id, index);
  }

  function onEditPolylineClick(e, id) {
    if (tool !== "select") return;
    if (editingId !== id) return;
    e.stopPropagation();
    const p = svgPoint(e);
    insertPointOnPolyline(id, p);
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

  function onOverlayHandleDown(e, id, corner) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();

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
  async function onPickSvg(fileKey) {
    const entry = SVG_LIBRARY[fileKey];
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
    const localVb = key ? { x: 0, y: 0, w: key.w, h: key.h } : baseVb;

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
    const scale = key ? 1 : Math.min(availW / srcW, availH / srcH);

    const srcCx = localVb.x + localVb.w / 2;
    const srcCy = localVb.y + localVb.h / 2;

    const anchor = importAnchor ?? { x: vbW / 2, y: vbH / 2 };

    const tx = anchor.x - scale * srcCx;
    const ty = anchor.y - scale * srcCy;

    // ✅ bbox must be in the SAME local coordinate system the overlay uses
    const bbox = { x: localVb.x, y: localVb.y, width: localVb.w, height: localVb.h };

    const id = uid();
    setSvgOverlays((prev) => [
      ...prev,
      {
        id,
        name: fileKey.split("/").pop() || fileKey,
        inner,
        tx,
        ty,
        scale,
        fill: "#ffffff",
        stroke: "#111111",
        tagPath: "",
        bbox,
      },
    ]);

    setSelectedOverlayIds([id]);
    setSelectedIds([]);
    setImportOpen(false);
    exitEditMode();
    setShowHUD(true);
    setImportAnchor(null);
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
    fill: "#ffffff",
    stroke: "#111111",
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
    textAlign: "start",
  });


  useEffect(() => {
    if (!selectedBBox) {
      setHudFields({
        id: "",
        tagPath: "",
        fill: "#ffffff",
        stroke: "#111111",
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
        textAlign: "start",
      });
      return;
    }

    let idText = "";
    let tagPath = "";
    let fill = "#ffffff";
    let stroke = "#111111";
    let arrowStart = "none";
    let arrowEnd = "none";
    let lineStyle = "solid"; // ✅ NEW

    if (isSingle && singleKind === "Polyline") {
      const s = shapes.find((x) => x.id === singleId);
      if (s) {
        idText = s.id;
        tagPath = s.tagPath || "";
        stroke = s.stroke || "#111111";
        arrowStart = s.arrowStart ?? "none";
        arrowEnd = s.arrowEnd ?? "none";
        lineStyle = s.lineStyle ?? "solid"; // ✅ NEW
      }
    } else if (isSingle && singleKind === "SVG") {
      const o = svgOverlays.find((x) => x.id === singleId);
      if (o) {
        idText = o.id;
        tagPath = o.tagPath || "";
        fill = o.fill ?? "#ffffff";
        stroke = o.stroke ?? "#111111";
      }
    } else if (isSingle && singleKind === "Text") {
      const t = shapes.find((x) => x.id === singleId);
      if (t) {
        idText = t.id;
        tagPath = t.tagPath || "";
        fill = t.fill ?? "#111111";
        stroke = t.stroke ?? "#111111"; // optional if you support stroke on text

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

  function applySingleStroke(nextStroke) {
    if (!isSingle || !singleId) return;
    const c = String(nextStroke || "").trim();
    if (!c) return;

    if (singleKind === "Polyline") {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, stroke: c } : s)));
    } else if (singleKind === "SVG") {
      setSvgOverlays((prev) => prev.map((o) => (o.id === singleId ? { ...o, stroke: c } : o)));
    }
  }

  function applySingleFill(nextFill) {
    if (!isSingle || !singleId) return;
    const c = String(nextFill || "").trim();
    if (!c) return;

    if (singleKind === "SVG") {
      setSvgOverlays((prev) => prev.map((o) => (o.id === singleId ? { ...o, fill: c } : o)));
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
    duplicateSelected,
    cancelPolyline,
    exitEditMode,
    closeImport: () => setImportOpen(false),
    clearSelection,
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
    }
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
            <circle cx={c.cx} cy={c.cy} r={7} fill="white" stroke="#2b6cff" strokeWidth={2} />
            <circle
              cx={c.cx}
              cy={c.cy}
              r={16}
              fill="transparent"
              style={{ cursor: "nwse-resize" }}
              onMouseDown={(e) => onOverlayHandleDown(e, o.id, c.key)}
            />
          </g>
        ))}
      </g>
    );
  }

  const singleSelectedOverlayId =
    selectedOverlayIds.length === 1 && selectedIds.length === 0 ? selectedOverlayIds[0] : null;

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
        applySingleTextAlign={applySingleTextAlign}
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
        editingId={editingId}
        onSvgMouseDown={onSvgMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onContextMenu={onContextMenu}
        onShapeMouseDown={onShapeMouseDown}
        onShapeDoubleClick={onShapeDoubleClick}
        onEditPolylineClick={onEditPolylineClick}
        onHandleMouseDown={onHandleMouseDown}
        onHandleDoubleClick={onHandleDoubleClick}
        setShapes={setShapes}
        svgOverlays={svgOverlays}
        setSvgOverlays={setSvgOverlays}
        selectedOverlayIds={selectedOverlayIds}
        singleSelectedOverlayId={singleSelectedOverlayId}
        setOverlayRef={setOverlayRef}
        onOverlayMouseDown={onOverlayMouseDown}
        overlaySelectionUI={overlaySelectionUI}
        overlayLocalBBox={overlayLocalBBox}
        marquee={marquee}
        pan={pan}
        importAnchor={importAnchor}
        onSvgDoubleClick={onSvgDoubleClick}
      />

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
            left: 16,
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

      <HelpPanel showHelp={showHelp} setShowHelp={setShowHelp} />

      <div
        style={{
          position: "fixed",
          left: 125,
          bottom: 16,
          zIndex: 60,
          display: "flex",
          gap: 8,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!showToolbar && (
          <button
            style={{
              border: "1px solid #e6e6e6",
              background: "white",
              borderRadius: 10,
              padding: "6px 10px",
              cursor: "pointer",
              color: "#111",
            }}
            onClick={() => setShowToolbar(true)}
          >
            Show Toolbar
          </button>
        )}
        {!showHUD && (
          <button
            style={{
              border: "1px solid #e6e6e6",
              background: "white",
              borderRadius: 10,
              padding: "6px 10px",
              boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
              cursor: "pointer",
              color: "#111",
            }}
            onClick={() => setShowHUD(true)}
          >
            Show Properties
          </button>
        )}

        {!showZoom && (
          <button
            style={{
              border: "1px solid #e6e6e6",
              background: "white",
              borderRadius: 10,
              padding: "6px 10px",
              boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
              cursor: "pointer",
              color: "#111",
            }}
            onClick={() => setShowZoom(true)}
          >
            Show Zoom
          </button>
        )}
      </div>

      <div
        style={{
          position: "fixed",
          right: 125,
          bottom: 16,
          zIndex: 60,
          display: "flex",
          gap: 8,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >

        {!showHelp && (
          <button
            style={{
              border: "1px solid #e6e6e6",
              background: "white",
              borderRadius: 10,
              padding: "6px 10px",
              boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
              cursor: "pointer",
              color: "#111",
            }}
            onClick={() => setShowHelp(true)}
          >
            Show Help
          </button>
        )}

      </div>
    </div>
  );
}
