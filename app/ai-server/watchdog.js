import { spawn } from "child_process";
import path from "path";

const entry = path.resolve(process.cwd(), "server.js");
let child = null;
let stopping = false;

function startChild() {
  const cmd = process.execPath;
  child = spawn(cmd, [entry], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (stopping) return;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    // eslint-disable-next-line no-console
    console.log(`[watchdog] ai-server exited (${reason}). Restarting in 1s...`);
    setTimeout(startChild, 1000);
  });
}

function shutdown() {
  stopping = true;
  if (child) {
    child.kill("SIGINT");
  }
  setTimeout(() => process.exit(0), 1000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startChild();
