import { spawn } from "node:child_process";
import process from "node:process";

const STARTUP_PORTS = [4840, 5055, 5173];
const processes = [];
let stopping = false;

function run(name, command, args, options = {}) {
  const { critical = true } = options;
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  processes.push({ name, child, critical });

  child.on("exit", (code, signal) => {
    if (stopping) return;
    if (!critical) {
      console.error(
        `[${name}] exited (code=${code ?? "null"}, signal=${signal ?? "null"}). Continuing without ${name}.`
      );
      return;
    }
    console.error(`[${name}] exited (code=${code ?? "null"}, signal=${signal ?? "null"}). Stopping all services.`);
    shutdown(code ?? 1);
  });
}

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  for (const proc of processes) {
    const child = proc.child;
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const proc of processes) {
      const child = proc.child;
      if (child && !child.killed) {
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

  return new Promise((resolve) => {
    let result;
    try {
      result = spawn("powershell", ["-NoProfile", "-Command", psCommand], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } catch {
      resolve([]);
      return;
    }
    let stdout = "";
    result.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    result.on("error", () => resolve([]));
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
    "($_.CommandLine -match 'start-all\\.js|watchdog\\.js|opc-server\\\\server\\.js|ai-server\\\\server\\.js|--prefix opc-server run start:watchdog|--prefix ai-server run start:watchdog|--prefix ai-server run app-server:watchdog|npm run dev:vite|vite\\\\bin\\\\vite\\.js')",
    "} | Select-Object -ExpandProperty ProcessId",
  ].join(" ");

  return new Promise((resolve) => {
    let result;
    try {
      result = spawn("powershell", ["-NoProfile", "-Command", psCommand], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } catch {
      resolve([]);
      return;
    }
    let stdout = "";
    result.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    result.on("error", () => resolve([]));
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

run("opc-server", "npm", ["--prefix", "opc-server", "run", "start:watchdog"], { critical: false });
run("app-server", "npm", ["--prefix", "ai-server", "run", "start:watchdog"]);
run("vite", "npm", ["run", "dev:vite"], { critical: false });
