import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const releaseName = String(process.env.RELEASE_NAME || "Mesora").trim() || "Mesora";
const appRoot = process.cwd();
const releaseRoot = path.resolve(appRoot, "releases");
const NPM_EXEC_PATH = String(process.env.npm_execpath || "").trim();

const payloadEntries = [
  "installer",
  "ai-server",
  "opc-server",
  "scripts",
  "dist",
  "src/assets/SVG_Files",
  "src/assets/SVG_Files_Streamlined",
  "package.json",
  "package-lock.json",
  "README.md",
  "Install-Mesora.bat",
  "Install-Mesora.command",
];

const excludedRelPathPatterns = [
  /(^|[\\/])Install-Vizi[^\\/]*$/i,
  /(^|[\\/])install-vizi[^\\/]*$/i,
  /(^|[\\/])scripts[\\/]install-vizi\.js$/i,
];

function fail(message) {
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
}

function runChecked(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${commandArgs.join(" ")}`);
  }
}

function nowStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}${m}${day}-${hh}${mm}${ss}`;
}

function shouldCopy(srcPath) {
  const rel = path.relative(appRoot, srcPath).replace(/\\/g, "/");
  for (const pattern of excludedRelPathPatterns) {
    if (pattern.test(rel)) return false;
  }
  const base = path.basename(srcPath);
  if (base === "node_modules") return false;
  if (base === ".git") return false;
  if (base === ".vite") return false;
  if (base === ".DS_Store") return false;
  if (base.toLowerCase() === "thumbs.db") return false;
  if (base.toLowerCase().endsWith(".log")) return false;
  return true;
}

function copyEntry(relativePath, stagingDir) {
  const src = path.resolve(appRoot, relativePath);
  if (!fs.existsSync(src)) return false;
  const dest = path.resolve(stagingDir, relativePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.cpSync(src, dest, {
      recursive: true,
      force: true,
      filter: shouldCopy,
    });
  } else {
    fs.copyFileSync(src, dest);
  }
  return true;
}

function createZip(stagingDir, zipPath) {
  if (process.platform === "win32") {
    const escapedStage = stagingDir.replace(/'/g, "''");
    const escapedZip = zipPath.replace(/'/g, "''");
    runChecked("powershell", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${escapedStage}\\*' -DestinationPath '${escapedZip}' -Force`,
    ]);
    return;
  }
  runChecked("zip", ["-r", "-q", zipPath, "."], { cwd: stagingDir });
}

function runNpm(argsList, options = {}) {
  if (NPM_EXEC_PATH) {
    runChecked(process.execPath, [NPM_EXEC_PATH, ...argsList], options);
    return;
  }
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  runChecked(npmCommand, argsList, { ...options, shell: process.platform === "win32" });
}

try {
  if (!skipBuild) {
    // eslint-disable-next-line no-console
    console.log("Building frontend (npm run build)...");
    runNpm(["run", "build"], { cwd: appRoot });
  }

  const stamp = nowStamp();
  const folderName = `${releaseName}-release-${stamp}`;
  const stagingDir = path.resolve(releaseRoot, folderName);
  const zipPath = path.resolve(releaseRoot, `${folderName}.zip`);

  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });

  const copied = [];
  payloadEntries.forEach((entry) => {
    if (copyEntry(entry, stagingDir)) copied.push(entry);
  });

  if (!copied.length) {
    throw new Error("No release payload files were copied.");
  }

  const manifestPath = path.resolve(stagingDir, "release-manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        name: releaseName,
        createdAt: new Date().toISOString(),
        appRoot,
        payload: copied,
      },
      null,
      2
    ),
    "utf8"
  );

  // eslint-disable-next-line no-console
  console.log(`Creating zip: ${zipPath}`);
  createZip(stagingDir, zipPath);

  // eslint-disable-next-line no-console
  console.log("Release package created.");
  // eslint-disable-next-line no-console
  console.log(`Staging folder: ${stagingDir}`);
  // eslint-disable-next-line no-console
  console.log(`Zip file: ${zipPath}`);
} catch (err) {
  fail(err?.message || String(err));
}
