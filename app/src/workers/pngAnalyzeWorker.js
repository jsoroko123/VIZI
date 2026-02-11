import "@techstark/opencv-js";

async function loadCv() {
  if (globalThis.cv && globalThis.cv.Mat) return globalThis.cv;
  const cv = globalThis.cv;
  if (cv?.Mat) return cv;
  return await new Promise((resolve) => {
    if (cv && cv.onRuntimeInitialized) {
      cv.onRuntimeInitialized = () => resolve(cv);
    } else {
      const check = setInterval(() => {
        if (globalThis.cv?.Mat) {
          clearInterval(check);
          resolve(globalThis.cv);
        }
      }, 50);
    }
  });
}

self.onmessage = async (e) => {
  const { type, imageData, dataUrl, skipOpenCv } = e.data || {};
  if (type !== "analyze") return;

  try {
    self.postMessage({ type: "status", message: "Worker started" });
    let lineSegs = [];
    if (!skipOpenCv) {
      self.postMessage({ type: "status", message: "OpenCV..." });
      const cv = await loadCv();
      self.postMessage({ type: "status", message: "OpenCV ready" });

      const src = cv.matFromImageData(imageData);
      const gray = new cv.Mat();
      const blur = new cv.Mat();
      const edges = new cv.Mat();
      const lines = new cv.Mat();

      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
      cv.Canny(blur, edges, 30, 100);
      cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 80, 40, 8);

      for (let i = 0; i < lines.rows; i++) {
        const x1 = lines.data32S[i * 4];
        const y1 = lines.data32S[i * 4 + 1];
        const x2 = lines.data32S[i * 4 + 2];
        const y2 = lines.data32S[i * 4 + 3];
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        const len = Math.hypot(dx, dy);
        if (len < 40) continue;
        if (dx > 6 && dy > 6) continue;
        lineSegs.push([x1, y1, x2, y2]);
      }

      src.delete();
      gray.delete();
      blur.delete();
      edges.delete();
      lines.delete();
    }

    self.postMessage({ type: "result", lines: lineSegs, labels: [] });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err?.message || err) });
  }
};
