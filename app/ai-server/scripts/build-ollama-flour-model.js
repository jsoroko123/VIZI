import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_SERVER_DIR = path.resolve(__dirname, "..");
const KNOWLEDGE_PATH = path.resolve(AI_SERVER_DIR, "knowledge", "flour-mill.md");
const OUT_DIR = path.resolve(AI_SERVER_DIR, "ollama");
const MODELFILE_PATH = path.resolve(OUT_DIR, "Modelfile.flour-mill");

const baseModel = String(process.env.OLLAMA_BASE_MODEL || "llama3.1").trim() || "llama3.1";
const targetModel = String(process.env.OLLAMA_TARGET_MODEL || "mesora-flour-mill").trim() || "mesora-flour-mill";

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(KNOWLEDGE_PATH)) {
  fail(`Knowledge file not found: ${KNOWLEDGE_PATH}`);
}

const knowledge = String(fs.readFileSync(KNOWLEDGE_PATH, "utf8") || "").trim();
if (!knowledge) {
  fail("Knowledge file is empty.");
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const systemPrompt = [
  "You are Mesora AI for flour milling operations and controls.",
  "Use flour-mill domain best practices, process sequencing, equipment behavior, and troubleshooting.",
  "Keep answers practical and concise for operators, maintenance technicians, and controls engineers.",
  "When uncertain, state assumptions and ask for exact tags, alarms, states, or route details.",
  "Never suggest bypassing safety interlocks or LOTO procedures.",
  "",
  "Domain Knowledge:",
  knowledge,
].join("\n");

const modelfile = [
  `FROM ${baseModel}`,
  "PARAMETER temperature 0.2",
  "PARAMETER top_p 0.9",
  `SYSTEM """${systemPrompt.replace(/"""/g, '\\"\\"\\"')}"""`,
  "",
].join("\n");

fs.writeFileSync(MODELFILE_PATH, modelfile, "utf8");
console.log(`Wrote ${MODELFILE_PATH}`);

const result = spawnSync("ollama", ["create", targetModel, "-f", MODELFILE_PATH], {
  cwd: AI_SERVER_DIR,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  fail(`ollama create failed with exit code ${result.status ?? 1}`);
}

console.log(`Created/updated Ollama model: ${targetModel}`);
