import { spawn } from "node:child_process";
import process from "node:process";

const STARTUP_PORTS = [4840, 5055, 5173];
const processes = [];
let stopping = false;

function run(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  processes.push(child);

  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[${name}] exited (code=${code ?? "null"}, signal=${signal ?? "null"}). Stopping all services.`);
    shutdown(code ?? 1);
  });
}

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  for (const child of processes) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const child of processes) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 1500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unique(values) {
  return [...new Set(values)];
}

function getListeningPidsWindows(ports) {
  const psCommand = [
    `$ports = @(${ports.join(",")})`,
    "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |",
    "Where-Object { $ports -contains $_.LocalPort } |",
    "Select-Object -ExpandProperty OwningProcess -Unique",
  ].join(" ");

  const result = spawn("powershell", ["-NoProfile", "-Command", psCommand], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  return new Promise((resolve) => {
    let stdout = "";
    result.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    result.on("close", () => {
      const pids = stdout
        .split(/\r?\n/)
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
      resolve(unique(pids));
    });
  });
}

async function cleanStartupPorts(ports) {
  if (process.platform !== "win32") return;

  const pids = await getListeningPidsWindows(ports);
  if (pids.length === 0) return;

  console.log(`[clean] Stopping stale listeners on ports ${ports.join(", ")} (pids: ${pids.join(", ")})`);

  for (const pid of pids) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/F", "/PID", String(pid)], {
        stdio: "ignore",
        shell: false,
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    });
  }

  await sleep(500);
}

async function getStaleAppPidsWindows() {
  const psCommand = [
    "Get-CimInstance Win32_Process |",
    "Where-Object {",
    "($_.Name -in @('node.exe','cmd.exe')) -and",
    "($_.CommandLine -match 'Projects\\\\Vizi\\\\app') -and",
    "($_.CommandLine -match 'start-all\\.js|watchdog\\.js|opc-server\\\\server\\.js|ai-server\\\\server\\.js|--prefix opc-server run start:watchdog|--prefix ai-server run start:watchdog|npm run dev:vite|vite\\\\bin\\\\vite\\.js')",
    "} | Select-Object -ExpandProperty ProcessId",
  ].join(" ");

  const result = spawn("powershell", ["-NoProfile", "-Command", psCommand], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  return new Promise((resolve) => {
    let stdout = "";
    result.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    result.on("close", () => {
      const pids = stdout
        .split(/\r?\n/)
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter(
          (pid) =>
            Number.isInteger(pid) &&
            pid > 0 &&
            pid !== process.pid &&
            pid !== process.ppid,
        );
      resolve(unique(pids));
    });
  });
}

async function killPids(pids, reason) {
  if (pids.length === 0) return;
  console.log(`[clean] ${reason} (pids: ${pids.join(", ")})`);

  for (const pid of pids) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/F", "/PID", String(pid)], {
        stdio: "ignore",
        shell: false,
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    });
  }
}

async function cleanStartup() {
  if (process.platform !== "win32") return;

  const stalePids = await getStaleAppPidsWindows();
  await killPids(stalePids, "Stopping stale app processes");

  await cleanStartupPorts(STARTUP_PORTS);
}

await cleanStartup();

run("opc-server", "npm", ["--prefix", "opc-server", "run", "start:watchdog"]);
run("ai-server", "npm", ["--prefix", "ai-server", "run", "start:watchdog"]);
run("vite", "npm", ["run", "dev:vite"]);
