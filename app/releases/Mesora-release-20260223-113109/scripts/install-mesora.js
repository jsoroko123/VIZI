import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const platform = os.platform();
const passthroughArgs = process.argv.slice(2);

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: root,
      shell: false,
      ...opts,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Installer exited with code ${code}`));
    });
  });
}

async function main() {
  if (platform === "win32") {
    const ps1 = path.join(root, "installer", "windows", "install-mesora.ps1");
    await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      ps1,
      ...passthroughArgs,
    ]);
    return;
  }

  if (platform === "darwin") {
    const sh = path.join(root, "installer", "macos", "install-mesora-macos.sh");
    await run("bash", [sh, ...passthroughArgs]);
    return;
  }

  throw new Error(
    `Unsupported OS: ${platform}. Use Windows or macOS installer scripts directly.`
  );
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
