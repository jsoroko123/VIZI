import { build } from "../../../app/node_modules/esbuild/lib/main.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "../../../app");
const appNodeModules = path.resolve(appDir, "node_modules");
const requestedBundleFileName = process.argv[2] || "drawingtool.js";
const outputDir = path.resolve(__dirname, "../gateway/src/main/resources/mounted/js");
const outputFile = path.resolve(outputDir, requestedBundleFileName);
const legacyOutputFile = path.resolve(outputDir, "drawingtool.js");
const svgLibrarySourceDir = path.resolve(appDir, "src/assets/SVG_Files");
const svgLibraryOutputDir = path.resolve(__dirname, "../gateway/src/main/resources/mounted/svg-library");
const svgLibraryManifestFile = path.resolve(svgLibraryOutputDir, "manifest.json");
const moduleResourceBase = "/res/mesora-drawing";

const aliasEntries = new Map([
    ["react", path.resolve(__dirname, "./src/shims/react.js")],
    ["react-dom", path.resolve(__dirname, "./src/shims/react-dom.js")],
    ["react/jsx-runtime", path.resolve(__dirname, "./src/shims/react-jsx-runtime.js")],
    ["react/jsx-dev-runtime", path.resolve(__dirname, "./src/shims/react-jsx-runtime.js")],
    ["chart.js", path.resolve(appNodeModules, "chart.js/dist/chart.js")],
    ["react-chartjs-2", path.resolve(appNodeModules, "react-chartjs-2/dist/index.js")]
]);

const aliasPlugin = {
    name: "mesora-aliases",
    setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /.*/ }, (args) => {
            const replacement = aliasEntries.get(args.path);
            if (!replacement) {
                return null;
            }

            return {
                path: replacement
            };
        });
    }
};

async function listSvgFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
        entries.map(async (entry) => {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                return listSvgFiles(fullPath);
            }
            return entry.isFile() && entry.name.toLowerCase().endsWith(".svg")
                ? [fullPath]
                : [];
        })
    );
    return files.flat().sort((left, right) => left.localeCompare(right));
}

function encodeUrlPath(relativePath) {
    return relativePath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

async function copySvgLibrary() {
    await fs.rm(svgLibraryOutputDir, { recursive: true, force: true });
    await fs.mkdir(svgLibraryOutputDir, { recursive: true });

    const svgFiles = await listSvgFiles(svgLibrarySourceDir);
    const manifest = [];

    for (const sourceFile of svgFiles) {
        const relativePath = path.relative(svgLibrarySourceDir, sourceFile).split(path.sep).join("/");
        const destinationFile = path.join(svgLibraryOutputDir, ...relativePath.split("/"));
        await fs.mkdir(path.dirname(destinationFile), { recursive: true });
        await fs.copyFile(sourceFile, destinationFile);

        manifest.push({
            key: `./assets/SVG_Files/${relativePath}`,
            name: path.basename(relativePath),
            url: `${moduleResourceBase}/svg-library/${encodeUrlPath(relativePath)}`
        });
    }

    await fs.writeFile(svgLibraryManifestFile, JSON.stringify(manifest, null, 2));
}

await copySvgLibrary();
await fs.mkdir(outputDir, { recursive: true });

const outputDirEntries = await fs.readdir(outputDir, { withFileTypes: true });
await Promise.all(
    outputDirEntries.map(async (entry) => {
        if (!entry.isFile()) {
            return;
        }
        if (!entry.name.startsWith("drawingtool-") || !entry.name.endsWith(".js")) {
            return;
        }
        if (entry.name === requestedBundleFileName) {
            return;
        }
        await fs.rm(path.join(outputDir, entry.name), { force: true });
    })
);

await build({
    entryPoints: [path.resolve(__dirname, "./src/index.jsx")],
    outfile: outputFile,
    bundle: true,
    format: "iife",
    globalName: "MesoraDrawingToolBundle",
    platform: "browser",
    target: ["es2019"],
    minify: false,
    sourcemap: false,
    jsx: "automatic",
    loader: {
        ".js": "jsx",
        ".jsx": "jsx"
    },
    define: {
        "process.env.NODE_ENV": "\"production\""
    },
    plugins: [aliasPlugin]
});

if (path.resolve(outputFile) !== path.resolve(legacyOutputFile)) {
    await fs.copyFile(outputFile, legacyOutputFile);
}
