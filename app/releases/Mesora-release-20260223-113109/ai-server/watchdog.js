import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const entry = path.resolve(process.cwd(), "server.js");
const lockPath = path.resolve(process.cwd(), ".watchdog.lock");
let child = null;
let stopping = false;
let restartTimer = null;
let restartDelayMs = 1000;
let childStartedAt = 0;
let lockFd = null;

function pidIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  try {
    lockFd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(lockFd, String(process.pid));
    return true;
  } catch {
    try {
      const existingRaw = fs.readFileSync(lockPath, "utf8");
      const existingPid = Number.parseInt(String(existingRaw || "").trim(), 10);
      if (pidIsRunning(existingPid)) {
        // eslint-disable-next-line no-console
        console.log(`[watchdog] ai-server already running under pid ${existingPid}. Exiting duplicate.`);
        return false;
      }
      fs.unlinkSync(lockPath);
      lockFd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(lockFd, String(process.pid));
      return true;
    } catch {
      return false;
    }
  }
}

function releaseLock() {
  try {
    if (lockFd != null) {
      fs.closeSync(lockFd);
      lockFd = null;
    }
  } catch {
    // ignore
  }
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {
    // ignore
  }
}

function startChild() {
  if (stopping) return;
  childStartedAt = Date.now();
  const cmd = process.execPath;
  child = spawn(cmd, [entry], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (stopping) return;
    const ranForMs = Date.now() - childStartedAt;
    if (ranForMs >= 30000) {
      restartDelayMs = 1000;
    } else {
      restartDelayMs = Math.min(30000, restartDelayMs * 2);
    }
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    // eslint-disable-next-line no-console
    console.log(`[watchdog] ai-server exited (${reason}). Restarting in ${Math.round(restartDelayMs / 1000)}s...`);
    restartTimer = setTimeout(startChild, restartDelayMs);
  });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) {
    child.kill("SIGINT");
  }
  setTimeout(() => {
    releaseLock();
    process.exit(0);
  }, 1000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (!acquireLock()) {
  process.exit(0);
}

startChild();
