let cvModule = null;
let cv = null;
let openCvRuntimeInitialized = false;
let resolveOpenCvRuntime;
const openCvRuntimePromise = new Promise((resolve) => { resolveOpenCvRuntime = resolve; });
const FACE_CASCADE_URL = "https://cdn.jsdelivr.net/gh/opencv/opencv/4.x/data/haarcascades/haarcascade_frontalface_default.xml";
const EYE_CASCADE_URL = "https://cdn.jsdelivr.net/gh/opencv/opencv/4.x/data/haarcascades/haarcascade_eye_tree_eyeglasses.xml";
const CALIBRATION_FRAMES = 24;
const MIN_CLOSED_MS = 45;
const MAX_CLOSED_MS = 800;
const COOLDOWN_MS = 320;

let initialized = false;
let initializing = false;
let stopped = false;
let faceCascade = null;
let eyeCascade = null;
let canvas = null;
let context = null;
let calibrationFrames = 0;
let eyesWereOpen = false;
let closedSince = 0;
let lastBlinkAt = 0;
let consecutiveClosed = 0;
let busy = false;

console.info("[OpenCV blink worker] BUILD models-from-main-20261021-1 loaded", {
  moduleType: typeof cvModule,
  isPromise: Boolean(cvModule && typeof cvModule.then === "function"),
  moduleKeys: (() => { try { return Object.keys(cvModule || {}).slice(0, 30); } catch (error) { return String(error); } })(),
  hasOffscreenCanvas: typeof OffscreenCanvas !== "undefined",
  hasFetch: typeof fetch === "function",
});

self.addEventListener("error", (event) => {
  console.error("[OpenCV blink worker] Uncaught worker error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    errorName: event.error?.name,
    errorMessage: event.error?.message,
    errorStack: event.error?.stack,
  });
});
self.addEventListener("unhandledrejection", (event) => {
  console.error("[OpenCV blink worker] Unhandled promise rejection", {
    reason: event.reason?.message || String(event.reason),
    stack: event.reason?.stack,
    reason: event.reason,
  });
});

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

async function waitForOpenCV() {
  // Bypass Vite's optimized dependency URL. The previous package import failed
  // to fetch /node_modules/.vite/deps/... inside the module worker.
  if (!cvModule) {
    console.info("[OpenCV blink worker] Loading standalone OpenCV.js with importScripts");
    try {
      // Configure Emscripten before loading the script so its WASM file is
      // fetched from the OpenCV CDN rather than the app's /play route.
      self.Module = {
        ...(self.Module || {}),
        locateFile: (file) => new URL(file, "https://docs.opencv.org/4.x/").href,
        printErr: (...args) => console.error("[OpenCV blink worker] Emscripten:", ...args),
        onAbort: (reason) => console.error("[OpenCV blink worker] Emscripten aborted:", reason),
        onRuntimeInitialized: () => {
          openCvRuntimeInitialized = true;
          console.info("[OpenCV blink worker] Emscripten runtime callback fired", {
            moduleType: typeof self.Module,
            moduleHasMat: Boolean(self.Module?.Mat),
            moduleHasCascadeClassifier: Boolean(self.Module?.CascadeClassifier),
            cvType: typeof self.cv,
            cvIsPromise: Boolean(self.cv && typeof self.cv.then === "function"),
            cvHasMat: Boolean(self.cv?.Mat),
            cvKeys: (() => { try { return Object.keys(self.cv || {}).slice(0, 20); } catch { return []; } })(),
          });
          resolveOpenCvRuntime(true);
        },
      };
      console.info("[OpenCV blink worker] Configured WASM asset URL", self.Module.locateFile("opencv_js.wasm"));
      importScripts("https://docs.opencv.org/4.x/opencv.js");
      cvModule = self.cv;
      console.info("[OpenCV blink worker] Standalone script loaded", {
        moduleType: typeof cvModule,
        isPromise: Boolean(cvModule && typeof cvModule.then === "function"),
        hasMat: Boolean(cvModule?.Mat),
        hasCascadeClassifier: Boolean(cvModule?.CascadeClassifier),
      });
    } catch (error) {
      console.error("[OpenCV blink worker] importScripts failed", {
        name: error?.name, message: error?.message, stack: error?.stack, error,
      });
      throw new Error(`Could not load standalone OpenCV.js: ${error?.message || String(error)}`);
    }
  }

  if (cvModule && typeof cvModule.then === "function") {
    console.info("[OpenCV blink worker] Waiting for OpenCV WASM runtime (maximum 30 seconds)");
    let timeoutId;
    let outcome;
    try {
      outcome = await Promise.race([
        Promise.resolve(cvModule).then((resolved) => ({ kind: "promise", resolved })),
        openCvRuntimePromise.then(() => ({ kind: "runtime-callback" })),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("OpenCV.js runtime did not become usable within 30 seconds.")), 30000);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
    const candidates = [
      outcome.kind === "promise" ? outcome.resolved?.default || outcome.resolved : null,
      self.cv,
      self.Module,
    ].filter(Boolean);
    cv = candidates.find((candidate) => candidate?.Mat && candidate?.CascadeClassifier) || null;
    console.info("[OpenCV blink worker] Runtime resolution result", {
      outcome: outcome.kind,
      runtimeCallbackFired: openCvRuntimeInitialized,
      hasMat: Boolean(cv?.Mat),
      hasCascadeClassifier: Boolean(cv?.CascadeClassifier),
      candidateDiagnostics: candidates.map((candidate, index) => ({
        index, type: typeof candidate, isPromise: typeof candidate?.then === "function",
        hasMat: Boolean(candidate?.Mat), hasCascadeClassifier: Boolean(candidate?.CascadeClassifier),
      })),
    });
    if (cv?.Mat && cv?.CascadeClassifier) return;
    throw new Error(outcome.kind === "runtime-callback"
      ? "OpenCV signaled runtime initialization, but neither cv nor Module exposed Mat/CascadeClassifier."
      : "OpenCV.js promise resolved without Mat/CascadeClassifier.");
  } else if (cvModule?.Mat && cvModule?.CascadeClassifier) {
    cv = cvModule;
    return;
  }
  if (!cvModule || (typeof cvModule !== "object" && typeof cvModule !== "function")) {
    throw new Error("OpenCV.js script loaded but did not expose a cv runtime.");
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OpenCV.js runtime initialization timed out after 30000 ms.")), 30000);
    const previousCallback = cvModule.onRuntimeInitialized;
    cvModule.onRuntimeInitialized = () => {
      clearTimeout(timeout);
      cv = cvModule;
      console.info("[OpenCV blink worker] Standalone OpenCV runtime initialized", {
        hasMat: Boolean(cv?.Mat),
        hasCascadeClassifier: Boolean(cv?.CascadeClassifier),
      });
      if (typeof previousCallback === "function") {
        try { previousCallback(); } catch (error) {
          console.warn("[OpenCV blink worker] Previous runtime callback failed", error);
        }
      }
      resolve();
    };
    cvModule.onAbort = (reason) => {
      clearTimeout(timeout);
      reject(new Error(`OpenCV.js runtime aborted: ${reason || "unknown reason"}`));
    };
  });

  if (!cv?.Mat || !cv?.CascadeClassifier) {
    throw new Error("OpenCV.js initialized without Mat/CascadeClassifier.");
  }
}

function loadCascadeFromBytes(buffer, filename) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
    throw new Error(`Missing or empty model buffer for ${filename}`);
  }
  const bytes = new Uint8Array(buffer);
  console.info("[OpenCV blink worker] Parsing preloaded cascade bytes", { filename, bytes: bytes.length });
  const virtualPath = `/${filename}`;
  try { cv.FS_unlink(virtualPath); } catch {}
  cv.FS_createDataFile("/", filename, bytes, true, false, false);
  const classifier = new cv.CascadeClassifier();
  const loaded = classifier.load(virtualPath);
  console.info("[OpenCV blink worker] Cascade XML parse completed", { filename, loaded });
  if (!loaded) {
    classifier.delete();
    throw new Error(`OpenCV could not parse cascade file: ${filename}`);
  }
  return classifier;
}

async function initialize(message = {}) {
  if (initialized || initializing) {
    console.debug("[OpenCV blink worker] INIT ignored", { initialized, initializing });
    return;
  }
  initializing = true;
  try {
    console.info("[OpenCV blink worker] INIT received");
    post("STATUS", { stage: "Loading OpenCV.js…" });
    await waitForOpenCV();
    console.info("[OpenCV blink worker] Runtime ready; parsing preloaded face and eye cascades");
    faceCascade = loadCascadeFromBytes(message.faceCascadeBuffer, "road_runner_face.xml");
    eyeCascade = loadCascadeFromBytes(message.eyeCascadeBuffer, "road_runner_eye_tree_eyeglasses.xml");
    console.info("[OpenCV blink worker] Both cascades loaded successfully");
    canvas = new OffscreenCanvas(2, 2);
    context = canvas.getContext("2d", { willReadFrequently: true });
    initialized = true;
    post("READY", { backend: "OpenCV.js Haar cascades", calibrationFrames: CALIBRATION_FRAMES });
  } catch (error) {
    console.error("[OpenCV blink worker] Initialization failed", {
      name: error?.name, message: error?.message, stack: error?.stack, error,
    });
    post("ERROR", {
      stage: "initialize",
      name: error?.name || "Error",
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
  } finally {
    initializing = false;
  }
}

function largestRect(rects) {
  let best = null;
  for (let i = 0; i < rects.size(); i += 1) {
    const rect = rects.get(i);
    if (!best || rect.width * rect.height > best.width * best.height) best = rect;
  }
  return best;
}

function detectEyes(gray, face) {
  const x = Math.max(0, face.x);
  const y = Math.max(0, face.y);
  const w = face.width;
  const h = face.height;
  const eyeY = y + Math.round(h * 0.20);
  const eyeH = Math.min(Math.round(h * 0.42), gray.rows - eyeY);
  const halfW = Math.round(w * 0.48);
  const regions = [
    new cv.Rect(x + Math.round(w * 0.04), eyeY, Math.min(halfW, gray.cols - x - Math.round(w * 0.04)), eyeH),
    new cv.Rect(x + Math.round(w * 0.50), eyeY, Math.min(halfW, gray.cols - x - Math.round(w * 0.50)), eyeH),
  ];
  return regions.map((rect) => {
    if (rect.width < 8 || rect.height < 8) return false;
    const roi = gray.roi(rect);
    const eyes = new cv.RectVector();
    try {
      eyeCascade.detectMultiScale(roi, eyes, 1.1, 2, 0, new cv.Size(8, 8), new cv.Size());
      return eyes.size() > 0;
    } finally {
      roi.delete();
      eyes.delete();
    }
  });
}

function processFrame(bitmap, timestamp) {
  if (!initialized || stopped || busy) {
    bitmap?.close?.();
    return;
  }
  busy = true;
  let source, gray, faces;
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    source = cv.matFromImageData(context.getImageData(0, 0, canvas.width, canvas.height));
    gray = new cv.Mat();
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.equalizeHist(gray, gray);
    faces = new cv.RectVector();
    faceCascade.detectMultiScale(gray, faces, 1.1, 4, 0, new cv.Size(48, 48), new cv.Size());
    if (faces.size() === 0) {
      post("METRICS", { face: false, eyes: 0, calibration: calibrationFrames, calibrationTotal: CALIBRATION_FRAMES });
      return;
    }

    const eyes = detectEyes(gray, largestRect(faces));
    const openCount = Number(eyes[0]) + Number(eyes[1]);

    if (openCount === 2) {
      eyesWereOpen = true;
      consecutiveClosed = 0;
      calibrationFrames = Math.min(CALIBRATION_FRAMES, calibrationFrames + 1);
      if (closedSince) {
        const duration = timestamp - closedSince;
        if (duration >= MIN_CLOSED_MS && duration <= MAX_CLOSED_MS && timestamp - lastBlinkAt >= COOLDOWN_MS) {
          lastBlinkAt = timestamp;
          post("BLINK_DETECTED", { durationMs: Math.round(duration), confidence: 0.72 });
        }
        closedSince = 0;
      }
    } else if (eyesWereOpen && openCount === 0) {
      consecutiveClosed += 1;
      if (!closedSince && consecutiveClosed >= 2) closedSince = timestamp;
      if (closedSince && timestamp - closedSince > MAX_CLOSED_MS) closedSince = 0;
    } else if (openCount === 1) {
      consecutiveClosed = 0;
    }

    post("METRICS", {
      face: true,
      eyes: openCount,
      calibration: calibrationFrames,
      calibrationTotal: CALIBRATION_FRAMES,
      calibrated: calibrationFrames >= CALIBRATION_FRAMES,
      glassesCascade: true,
      frameWidth: canvas.width,
      frameHeight: canvas.height,
    });
  } catch (error) {
    post("FRAME_ERROR", { message: error?.message || String(error) });
  } finally {
    source?.delete();
    gray?.delete();
    faces?.delete();
    busy = false;
    post("FRAME_DONE");
  }
}

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type !== "FRAME") console.debug("[OpenCV blink worker] Message received", { type: message.type });
  if (message.type === "INIT") {
    stopped = false;
    await initialize(message);
  } else if (message.type === "FRAME") {
    processFrame(message.bitmap, message.timestamp || performance.now());
  } else if (message.type === "RESET") {
    calibrationFrames = 0;
    eyesWereOpen = false;
    closedSince = 0;
    consecutiveClosed = 0;
    lastBlinkAt = 0;
  } else if (message.type === "STOP") {
    stopped = true;
    faceCascade?.delete();
    eyeCascade?.delete();
    faceCascade = null;
    eyeCascade = null;
    initialized = false;
  }
};
