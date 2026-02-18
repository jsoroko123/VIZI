import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// https://vite.dev/config/
function setSvgMetaPlugin() {
  return {
    name: "vizi-set-svg-meta",
    configureServer(server) {
      server.middlewares.use("/__vizi__/set-svg-meta", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method Not Allowed");
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });

        req.on("end", () => {
          try {
            const data = JSON.parse(body || "{}");
            const fileKey = String(data.fileKey || "");
            const kewidth = Number(data.kewidth);
            const keheight = Number(data.keheight);

            if (!fileKey || !Number.isFinite(kewidth) || !Number.isFinite(keheight)) {
              res.statusCode = 400;
              res.end("Invalid payload");
              return;
            }

            if (!fileKey.startsWith("./assets/SVG_Files/")) {
              res.statusCode = 400;
              res.end("Invalid file path");
              return;
            }

            const rel = fileKey.replace("./", "");
            const fullPath = path.resolve(process.cwd(), "src", rel);
            if (!fs.existsSync(fullPath)) {
              res.statusCode = 404;
              res.end("File not found");
              return;
            }

            const raw = fs.readFileSync(fullPath, "utf8");
            const updated = raw.replace(/<svg\b([^>]*)>/i, (match, attrs) => {
              let next = attrs;
              if (/kewidth\s*=/.test(next)) {
                next = next.replace(/kewidth\s*=\s*["'][^"']*["']/i, `kewidth="${kewidth}"`);
              } else {
                next += ` kewidth="${kewidth}"`;
              }
              if (/keheight\s*=/.test(next)) {
                next = next.replace(/keheight\s*=\s*["'][^"']*["']/i, `keheight="${keheight}"`);
              } else {
                next += ` keheight="${keheight}"`;
              }
              return `<svg${next}>`;
            });

            fs.writeFileSync(fullPath, updated, "utf8");
            res.statusCode = 200;
            res.end("OK");
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), setSvgMetaPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-router")) return "vendor-router";
          if (id.includes("react-dom") || id.includes("/react/")) return "vendor-react";
          if (id.includes("chart.js") || id.includes("react-chartjs-2")) return "vendor-chart";
          return "vendor";
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5055",
        changeOrigin: true,
      },
    },
  },
});
