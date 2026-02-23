import fs from "node:fs/promises";
import path from "node:path";

const SRC_DIR = path.resolve("src/assets/SVG_Files");
const DEST_DIR = path.resolve("src/assets/SVG_Files_Streamlined");

const namedColorMap = new Map([
  ["black", { r: 0, g: 0, b: 0 }],
  ["gray", { r: 128, g: 128, b: 128 }],
  ["grey", { r: 128, g: 128, b: 128 }],
  ["silver", { r: 192, g: 192, b: 192 }],
  ["white", { r: 255, g: 255, b: 255 }],
]);

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function isSkippablePaint(value) {
  const v = String(value || "").trim().toLowerCase();
  return (
    !v ||
    v === "none" ||
    v === "transparent" ||
    v === "currentcolor" ||
    v.startsWith("url(") ||
    v.startsWith("var(")
  );
}

function parseColor(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || isSkippablePaint(raw)) return null;

  if (namedColorMap.has(raw)) {
    return namedColorMap.get(raw);
  }

  const hex3 = raw.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    const [r, g, b] = hex3[1].split("").map((n) => Number.parseInt(n + n, 16));
    return { r, g, b };
  }

  const hex6 = raw.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    return {
      r: Number.parseInt(hex6[1].slice(0, 2), 16),
      g: Number.parseInt(hex6[1].slice(2, 4), 16),
      b: Number.parseInt(hex6[1].slice(4, 6), 16),
    };
  }

  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((x) => x.trim());
    if (parts.length >= 3) {
      const nums = parts.slice(0, 3).map((x) => Number(x));
      if (nums.every((n) => Number.isFinite(n))) {
        return {
          r: clampByte(nums[0]),
          g: clampByte(nums[1]),
          b: clampByte(nums[2]),
        };
      }
    }
  }
  return null;
}

function isNearGray({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min <= 10;
}

function normalizePaintValue(value, mode) {
  if (isSkippablePaint(value)) return String(value || "").trim();
  const color = parseColor(value);
  if (!color) return String(value || "").trim();

  if (!isNearGray(color)) return String(value || "").trim();

  if (mode === "stroke") return "#808080";
  if (mode === "fill") {
    const avg = (color.r + color.g + color.b) / 3;
    if (avg >= 240) return "#f2f2f2";
    return "#c8c8c8";
  }
  return String(value || "").trim();
}

function normalizeStyleDeclaration(styleText) {
  const parts = String(styleText || "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
  const kv = [];
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    let value = part.slice(idx + 1).trim();
    if (!key) continue;

    if (key === "stroke") value = normalizePaintValue(value, "stroke");
    if (key === "fill") value = normalizePaintValue(value, "fill");
    if ((key === "stroke-opacity" || key === "fill-opacity") && (value === "1" || value === "1.0")) continue;
    if (key === "display" && value === "inline") continue;
    kv.push(`${key}:${value}`);
  }
  return kv.join(";");
}

function streamlineSvgText(svgText) {
  let out = String(svgText || "").replace(/\r/g, "");

  out = out.replace(/<\?xml[\s\S]*?\?>\s*/gi, "");
  out = out.replace(/<!--[\s\S]*?-->\s*/g, "");
  out = out.replace(/<sodipodi:namedview[\s\S]*?\/>\s*/gi, "");
  out = out.replace(/<inkscape:path-effect[\s\S]*?\/>\s*/gi, "");
  out = out.replace(/\s(?:inkscape|sodipodi):[a-zA-Z0-9_-]+="[^"]*"/g, "");
  out = out.replace(/\sxmlns:(?:inkscape|sodipodi|svg)="[^"]*"/g, "");
  out = out.replace(/<defs\b[^>]*>\s*<\/defs>\s*/gi, "");

  out = out.replace(/\sstyle="([^"]*)"/gi, (_m, style) => {
    const normalized = normalizeStyleDeclaration(style);
    return normalized ? ` style="${normalized}"` : "";
  });

  out = out.replace(/\sstroke="([^"]*)"/gi, (_m, value) => ` stroke="${normalizePaintValue(value, "stroke")}"`);
  out = out.replace(/\sfill="([^"]*)"/gi, (_m, value) => ` fill="${normalizePaintValue(value, "fill")}"`);

  out = out
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `${out}\n`;
}

async function ensureEmptyDir(dirPath) {
  await fs.rm(dirPath, { recursive: true, force: true });
  await fs.mkdir(dirPath, { recursive: true });
}

async function walkFiles(root, visitor) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(abs, visitor);
    } else if (entry.isFile()) {
      await visitor(abs);
    }
  }
}

async function main() {
  await ensureEmptyDir(DEST_DIR);
  let copied = 0;
  let streamlined = 0;

  await walkFiles(SRC_DIR, async (absFile) => {
    const rel = path.relative(SRC_DIR, absFile);
    const outFile = path.join(DEST_DIR, rel);
    await fs.mkdir(path.dirname(outFile), { recursive: true });

    if (absFile.toLowerCase().endsWith(".svg")) {
      const raw = await fs.readFile(absFile, "utf8");
      const next = streamlineSvgText(raw);
      await fs.writeFile(outFile, next, "utf8");
      streamlined += 1;
    } else {
      await fs.copyFile(absFile, outFile);
      copied += 1;
    }
  });

  const msg = [
    `SVG library copied.`,
    `Source: ${SRC_DIR}`,
    `Dest:   ${DEST_DIR}`,
    `Streamlined SVG files: ${streamlined}`,
    `Copied non-SVG files: ${copied}`,
  ].join("\n");
  process.stdout.write(`${msg}\n`);
}

main().catch((err) => {
  process.stderr.write(`Failed to streamline SVG library: ${String(err?.message || err)}\n`);
  process.exitCode = 1;
});
