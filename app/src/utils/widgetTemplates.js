export const DEFAULT_WIDGET_WRITE_MODE = "ignition";
export const DEFAULT_WIDGET_OPC_SERVER = "Ignition OPC UA Server";

const FIXED_ASPECT_WIDGET_SIZES = {
  routedisplay: { width: 320, height: 128 },
  scaleadapter: { width: 320, height: 126 },
  scaleadaptor: { width: 320, height: 126 },
};

function normalizeWidgetKind(widgetKind) {
  return String(widgetKind || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function getWidgetVisualBBox(overlay, fallbackBBox = null) {
  const rawBBox = fallbackBBox || overlay?.bbox;
  if (!rawBBox || typeof rawBBox !== "object") {
    return rawBBox;
  }

  const bbox = {
    x: Number(rawBBox.x || rawBBox.left || 0),
    y: Number(rawBBox.y || rawBBox.top || 0),
    width: Number(rawBBox.width || rawBBox.w || 0),
    height: Number(rawBBox.height || rawBBox.h || 0),
  };

  if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height) || bbox.width <= 0 || bbox.height <= 0) {
    return rawBBox;
  }

  const widgetSize = FIXED_ASPECT_WIDGET_SIZES[normalizeWidgetKind(overlay?.widget?.kind)];
  if (!widgetSize) {
    return bbox;
  }

  const targetHeight = Math.max(60, bbox.width * widgetSize.height / widgetSize.width);
  if (bbox.height <= targetHeight + 1) {
    return bbox;
  }

  return {
    ...bbox,
    height: targetHeight,
  };
}

export function resolveWidgetWriteMode(widget, tagPath = "") {
  const explicit = String(
    widget?.writeMode
    ?? widget?.writeTarget
    ?? widget?.tagSource
    ?? ""
  ).trim().toLowerCase();
  if (explicit === "view" || explicit === "popup" || explicit === "openview" || explicit === "open-view") {
    return "view";
  }
  if (
    explicit === "script" ||
    explicit === "gateway-script" ||
    explicit === "gatewayscript" ||
    explicit === "project-script" ||
    explicit === "projectscript"
  ) {
    return "script";
  }
  if (explicit === "opc" || explicit === "ignition") {
    return explicit;
  }
  const normalizedTagPath = String(tagPath || "").trim();
  if (normalizedTagPath.startsWith("[")) {
    return "ignition";
  }
  return normalizedTagPath ? "opc" : DEFAULT_WIDGET_WRITE_MODE;
}

export function resolveWidgetOpcServer(widget) {
  const explicit = String(
    widget?.opcServer
    ?? widget?.opcServerName
    ?? widget?.serverName
    ?? ""
  ).trim();
  return explicit || DEFAULT_WIDGET_OPC_SERVER;
}

export function widgetTemplate(widgetKey) {
  const templates = {
    lineChart: {
      name: "Widget-LineChart.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect x="1" y="1" width="318" height="178" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Line Chart</text><line x1="36" y1="142" x2="292" y2="142" stroke="#475569" stroke-width="2"/><line x1="36" y1="42" x2="36" y2="142" stroke="#475569" stroke-width="2"/><polyline points="42,130 92,108 136,118 180,84 232,98 286,60" fill="none" stroke="#22c55e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    },
    barChart: {
      name: "Widget-BarChart.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect x="1" y="1" width="318" height="178" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Bar Chart</text><line x1="36" y1="142" x2="292" y2="142" stroke="#475569" stroke-width="2"/><rect x="58" y="96" width="30" height="46" rx="4" fill="#22c55e"/><rect x="104" y="76" width="30" height="66" rx="4" fill="#38bdf8"/><rect x="150" y="52" width="30" height="90" rx="4" fill="#f59e0b"/><rect x="196" y="88" width="30" height="54" rx="4" fill="#a78bfa"/><rect x="242" y="66" width="30" height="76" rx="4" fill="#fb7185"/></svg>`,
    },
    areaChart: {
      name: "Widget-AreaChart.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect x="1" y="1" width="318" height="178" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Area Chart</text><line x1="36" y1="142" x2="292" y2="142" stroke="#475569" stroke-width="2"/><path d="M42,128 L90,102 L138,114 L186,80 L234,96 L286,70 L286,142 L42,142 Z" fill="#22c55e55" stroke="#22c55e" stroke-width="3"/></svg>`,
    },
    gauge: {
      name: "Widget-Gauge.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 180"><rect x="1" y="1" width="258" height="178" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Gauge</text><path d="M46 132a84 84 0 0 1 168 0" fill="none" stroke="#334155" stroke-width="16" stroke-linecap="round"/><path d="M46 132a84 84 0 0 1 126 -72" fill="none" stroke="#22c55e" stroke-width="16" stroke-linecap="round"/><line x1="130" y1="132" x2="192" y2="88" stroke="#e2e8f0" stroke-width="4" stroke-linecap="round"/><circle cx="130" cy="132" r="6" fill="#e2e8f0"/></svg>`,
    },
    weather: {
      name: "Widget-Weather.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect x="1" y="1" width="318" height="178" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Weather</text><circle cx="66" cy="84" r="22" fill="#fbbf24"/><path d="M112 108h118a22 22 0 0 0 0-44 29 29 0 0 0-55-10 24 24 0 0 0-36 20 18 18 0 0 0-27 34z" fill="#cbd5e1"/><text x="20" y="150" fill="#e2e8f0" font-size="32" font-family="system-ui" font-weight="800">72</text><text x="86" y="150" fill="#93c5fd" font-size="14" font-family="system-ui" font-weight="700">F</text><text x="132" y="150" fill="#94a3b8" font-size="12" font-family="system-ui">Partly Cloudy</text></svg>`,
    },
    kpi: {
      name: "Widget-KPI.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140"><rect x="1" y="1" width="238" height="138" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">KPI</text><text x="20" y="84" fill="#22c55e" font-size="42" font-family="system-ui" font-weight="700">98.7%</text><text x="20" y="112" fill="#94a3b8" font-size="12" font-family="system-ui">Target: 95%</text></svg>`,
    },
    displayBox: {
      name: "Widget-DisplayBox.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect x="1" y="1" width="318" height="178" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Display Box</text><text x="20" y="92" fill="#22c55e" font-size="40" font-family="system-ui" font-weight="700">123.4</text><text x="214" y="92" fill="#93c5fd" font-size="16" font-family="system-ui" font-weight="700">psi</text><rect x="20" y="122" width="194" height="30" rx="8" fill="#111827" stroke="#334155"/><rect x="222" y="122" width="78" height="30" rx="8" fill="#2b6cff"/><text x="242" y="141" fill="#ffffff" font-size="12" font-family="system-ui" font-weight="700">Write</text></svg>`,
    },
    routeDisplay: {
      name: "Widget-RouteDisplay.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 128"><rect x="1" y="1" width="318" height="126" rx="14" fill="#0f172a" stroke="#334155" stroke-width="2"/><rect x="7" y="7" width="306" height="24" rx="8" fill="#1d4ed833" stroke="#60a5fa55"/><rect x="7" y="7" width="7" height="24" rx="4" fill="#22c55e"/><text x="22" y="23" fill="#ffffff" font-size="12" font-family="system-ui" font-weight="800">Route Display</text><rect x="7" y="35" width="306" height="60" rx="9" fill="#0f172acc" stroke="#334155"/><text x="17" y="52" fill="#94a3b8" font-size="10" font-family="system-ui" font-weight="700">Job Number</text><text x="301" y="52" text-anchor="end" fill="#e2e8f0" font-size="11" font-family="system-ui" font-weight="800">120</text><line x1="15" y1="60" x2="305" y2="60" stroke="#334155"/><text x="17" y="70" fill="#94a3b8" font-size="10" font-family="system-ui" font-weight="700">Job Step</text><text x="301" y="70" text-anchor="end" fill="#e2e8f0" font-size="11" font-family="system-ui" font-weight="800">3</text><line x1="15" y1="78" x2="305" y2="78" stroke="#334155"/><text x="17" y="88" fill="#94a3b8" font-size="10" font-family="system-ui" font-weight="700">Route State</text><text x="301" y="88" text-anchor="end" fill="#22c55e" font-size="11" font-family="system-ui" font-weight="800">Active</text><rect x="7" y="100" width="148" height="21" rx="7" fill="#b45309"/><text x="81" y="114" text-anchor="middle" fill="#ffffff" font-size="10" font-family="system-ui" font-weight="800">Pause</text><rect x="165" y="100" width="148" height="21" rx="7" fill="#15803d"/><text x="239" y="114" text-anchor="middle" fill="#ffffff" font-size="10" font-family="system-ui" font-weight="800">Continue</text></svg>`,
    },
    scaleAdapter: {
      name: "Widget-ScaleAdapter.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 126"><rect x="1" y="1" width="318" height="124" rx="14" fill="#0f172a" stroke="#334155" stroke-width="2"/><rect x="10" y="10" width="300" height="26" rx="9" fill="#0f2b5f"/><rect x="10" y="10" width="7" height="26" rx="4" fill="#22c55e"/><text x="25" y="28" fill="#ffffff" font-size="12" font-family="system-ui" font-weight="800">Scale Adapter</text><rect x="16" y="44" width="288" height="22" rx="7" fill="#064e3b" stroke="#22c55e"/><text x="160" y="59" text-anchor="middle" fill="#22c55e" font-size="12" font-family="system-ui" font-weight="900">Dosing</text><text x="26" y="86" fill="#94a3b8" font-size="11" font-family="system-ui" font-weight="800">Flowrate</text><text x="294" y="86" text-anchor="end" fill="#ffffff" font-size="12" font-family="system-ui" font-weight="900">0 lb/h</text><text x="26" y="108" fill="#94a3b8" font-size="11" font-family="system-ui" font-weight="800">Job Weight</text><text x="294" y="108" text-anchor="end" fill="#ffffff" font-size="12" font-family="system-ui" font-weight="900">812283 lb</text></svg>`,
    },
    countdownBar: {
      name: "Widget-CountdownBar.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 72"><rect x="12" y="8" width="296" height="14" rx="7" fill="#111827" stroke="#334155"/><rect x="12" y="8" width="168" height="14" rx="7" fill="#2b6cff"/><text x="12" y="40" fill="#94a3b8" font-size="12" font-family="system-ui" font-weight="700">Countdown</text><text x="160" y="20" text-anchor="middle" fill="#ffffff" font-size="10" font-family="system-ui" font-weight="800">4.0s</text></svg>`,
    },
    pushButton: {
      name: "Widget-PushButton.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 150"><rect x="1" y="1" width="258" height="148" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Push Button</text><rect x="34" y="52" width="192" height="70" rx="12" fill="#1e293b" stroke="#334155"/><rect x="40" y="58" width="180" height="58" rx="10" fill="#2563eb"/><text x="130" y="94" text-anchor="middle" fill="#ffffff" font-size="16" font-family="system-ui" font-weight="800">PRESS</text></svg>`,
    },
    openViewButton: {
      name: "Widget-OpenViewButton.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 150"><rect x="1" y="1" width="258" height="148" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Open View</text><rect x="34" y="52" width="192" height="70" rx="12" fill="#1e293b" stroke="#334155"/><rect x="40" y="58" width="180" height="58" rx="10" fill="#2563eb"/><path d="M111 78h34m0 0-13-13m13 13-13 13" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><text x="130" y="108" text-anchor="middle" fill="#ffffff" font-size="13" font-family="system-ui" font-weight="800">VIEW</text></svg>`,
    },
    onOffButton: {
      name: "Widget-OnOffButton.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 160"><rect x="1" y="1" width="278" height="158" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">On/Off Button</text><rect x="34" y="52" width="212" height="74" rx="14" fill="#111827" stroke="#334155"/><rect x="40" y="58" width="98" height="62" rx="10" fill="#16a34a"/><rect x="142" y="58" width="98" height="62" rx="10" fill="#334155"/><text x="89" y="96" text-anchor="middle" fill="#ffffff" font-size="16" font-family="system-ui" font-weight="800">ON</text><text x="191" y="96" text-anchor="middle" fill="#cbd5e1" font-size="16" font-family="system-ui" font-weight="800">OFF</text></svg>`,
    },
    statusTable: {
      name: "Widget-StatusTable.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 190"><rect x="1" y="1" width="338" height="188" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Status Table</text><rect x="16" y="40" width="308" height="28" rx="6" fill="#1e293b"/><text x="28" y="58" fill="#94a3b8" font-size="11" font-family="system-ui">Tag</text><text x="170" y="58" fill="#94a3b8" font-size="11" font-family="system-ui">State</text><text x="252" y="58" fill="#94a3b8" font-size="11" font-family="system-ui">Quality</text><rect x="16" y="74" width="308" height="30" rx="6" fill="#111827"/><rect x="16" y="108" width="308" height="30" rx="6" fill="#111827"/><rect x="16" y="142" width="308" height="30" rx="6" fill="#111827"/></svg>`,
    },
  };
  return templates[widgetKey] || templates.lineChart;
}

export function defaultWidgetSettings(widgetKey) {
  const kind = String(widgetKey || "").trim();
  const base = {
    kind: kind || "lineChart",
    title: "",
    titleFontSize: "",
    textColor: "",
    buttonTextColor: "",
    writeMode: DEFAULT_WIDGET_WRITE_MODE,
    opcServer: DEFAULT_WIDGET_OPC_SERVER,
    viewPath: "",
    viewParamsJson: "{}",
    scriptPath: "",
    scriptProject: "",
    scriptArgsJson: "[]",
    scriptKwargsJson: "{}",
    writeValue: 1,
    releaseValue: 0,
    onValue: 1,
    offValue: 0,
    min: 0,
    max: 100,
    decimals: 0,
    unit: "",
    historyPoints: 40,
    rowCount: 4,
    rangeFrom: null,
    rangeTo: null,
    windowMinutes: 60,
    durationPreset: "1h",
    maxPoints: 500,
    lineTension: 0.34,
    showPoints: true,
    showLegend: true,
    showGrid: true,
    markSpots: true,
    markerSize: 4.2,
    lineWidth: 2.4,
    lineStyle: "smooth",
    yAxisSide: "left",
    seriesTags: [],
    axisMode: "auto",
    barSourceMode: "table",
    barTable: "",
    barField: "",
    barLabelField: "",
    barQuery: "",
    barQueryValueField: "",
    barQueryLabelField: "",
  };
  if (kind === "statusTable") return { ...base, historyPoints: 12, rowCount: 6 };
  if (kind === "kpi") return { ...base, historyPoints: 10 };
  if (kind === "displayBox") return { ...base, historyPoints: 10 };
  if (kind === "routeDisplay") return { ...base, title: "Route Display", writeMode: "opc", historyPoints: 10 };
  if (kind === "scaleAdapter" || kind === "scaleAdaptor") return { ...base, kind: "scaleAdapter", title: "Scale Adapter", historyPoints: 10, decimals: 4 };
  if (kind === "weather") return { ...base, historyPoints: 10, decimals: 1, unit: "F" };
  if (kind === "countdownBar") return { ...base, historyPoints: 10, decimals: 1 };
  if (kind === "openViewButton") {
    return {
      ...base,
      kind: "pushButton",
      title: "Open View",
      writeMode: "view",
      historyPoints: 10,
      decimals: 0,
    };
  }
  if (kind === "pushButton") return { ...base, historyPoints: 10, decimals: 0 };
  if (kind === "onOffButton") return { ...base, historyPoints: 10, decimals: 0 };
  if (kind === "gauge") return { ...base, min: 0, max: 100, historyPoints: 16 };
  if (kind === "barChart") return { ...base, historyPoints: 20 };
  if (kind === "areaChart") return { ...base, historyPoints: 40 };
  return base;
}
