import * as faceapi from "face-api.js";
import * as tf from "@tensorflow/tfjs";

const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights";
const INPUT_SIZE = 320;
const FACE_SCORE_THRESHOLD = 0.25;
const CALIBRATION_FRAMES = 24;
const MIN_BLINK_MS = 0;
const MAX_BLINK_MS = 750;
const COOLDOWN_MS = 320;

let detectorReady = false;
let initializing = false;
let detectorCanvas = null;
let detectorContext = null;
let stopped = false;
let baseline = null;
let calibrationCount = 0;
let calibrationMax = 0;
let calibrationEars = [];
let closed = false;
let closedAt = 0;
let lastBlinkAt = 0;
let earHistory = [];
let initStage = "worker script loaded";

console.info("[FaceBlinkWorker] Script started", {
  userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "(no navigator)",
  hasOffscreenCanvas: typeof OffscreenCanvas !== "undefined",
  hasImageBitmap: typeof ImageBitmap !== "undefined",
  hasImageData: typeof ImageData !== "undefined",
  hasFetch: typeof fetch === "function",
  hasCreateImageBitmap: typeof createImageBitmap === "function",
});

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(points) {
  if (!points || points.length < 6) return null;
  const horizontal = pointDistance(points[0], points[3]);
  if (horizontal < 1) return null;
  return (pointDistance(points[1], points[5]) + pointDistance(points[2], points[4])) / (2 * horizontal);
}

function calculateEar(landmarks) {
  const left = eyeAspectRatio(landmarks.getLeftEye());
  const right = eyeAspectRatio(landmarks.getRightEye());
  if (left == null && right == null) return null;
  if (left == null) return right;
  if (right == null) return left;
  return (left + right) / 2;
}

function smoothEar(value) {
  // Keep the raw EAR: median smoothing can erase short blink closures.
  earHistory.push(value);
  if (earHistory.length > 3) earHistory.shift();
  return value;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function initialize() {
  if (initializing || detectorReady || stopped) return;
  initializing = true;
  try {
    initStage = "checking worker APIs";
    console.info("[FaceBlinkWorker] INIT received; checking APIs", {
      faceapiEnvType: typeof faceapi.env,
      faceapiEnvKeys: (() => { try { return Object.keys(faceapi.env || {}); } catch (e) { return String(e); } })(),
      tfVersion: tf?.version?.tfjs || "(unknown)",
    });
    self.postMessage({ type: "STATUS", status: "Preparing face-api.js worker environment…" });

    // face-api.js 0.22.2 does not automatically recognize a Web Worker as a
    // browser environment. Register the worker's supported canvas/image types
    // explicitly before loading models or running inference.
    if (
      typeof OffscreenCanvas === "undefined" ||
      typeof ImageBitmap === "undefined" ||
      typeof ImageData === "undefined"
    ) {
      throw new Error(
        "This browser does not support the OffscreenCanvas/ImageBitmap APIs required for worker-based face detection."
      );
    }

    initStage = "registering explicit face-api.js worker environment";
    // face-api.js 0.22.2 auto-detects only a DOM browser or Node.js. A Web
    // Worker is neither, so monkeyPatch() throws before it can apply overrides.
    // Register the environment directly to bypass that unsupported auto-detection.
    const WorkerImagePlaceholder = class WorkerImagePlaceholder {};
    const WorkerVideoPlaceholder = class WorkerVideoPlaceholder {};
    const workerEnvironment = {
      Canvas: OffscreenCanvas,
      CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D,
      Image: WorkerImagePlaceholder,
      ImageData,
      Video: WorkerVideoPlaceholder,
      createCanvasElement: () => new OffscreenCanvas(1, 1),
      createImageElement: () => new WorkerImagePlaceholder(),
      createVideoElement: () => new WorkerVideoPlaceholder(),
      fetch: globalThis.fetch.bind(globalThis),
      readFile: async (path) => {
        const response = await fetch(path);
        if (!response.ok) {
          throw new Error(`Failed to fetch face-api asset: ${response.status} ${response.statusText} (${path})`);
        }
        return response.arrayBuffer();
      },
    };
    console.info("[FaceBlinkWorker] Registering custom worker environment", {
      availableEnvApi: typeof faceapi.env.setEnv,
      canvas: workerEnvironment.Canvas.name,
      context: workerEnvironment.CanvasRenderingContext2D.name,
      hasFetch: typeof workerEnvironment.fetch === "function",
    });
    if (typeof faceapi.env.setEnv !== "function") {
      throw new Error("This face-api.js build does not expose env.setEnv; worker environment cannot be registered.");
    }
    faceapi.env.setEnv(workerEnvironment);
    console.info("[FaceBlinkWorker] Custom worker environment registered", {
      registeredCanvas: faceapi.env.getEnv().Canvas?.name,
      registeredImageData: faceapi.env.getEnv().ImageData?.name,
      hasFetch: typeof faceapi.env.getEnv().fetch === "function",
    });

    initStage = "TensorFlow CPU backend initialization";
    console.info("[FaceBlinkWorker] face-api environment configured; initializing TensorFlow CPU backend");
    self.postMessage({ type: "STATUS", status: "Loading face-api.js models…" });

    // WebGL generally requires a DOM canvas and is not available in a Web Worker.
    // Use the CPU backend explicitly so inference can run without a DOM.
    await tf.setBackend("cpu");
    await tf.ready();

    initStage = "loading TinyFaceDetector and FaceLandmark68Net models";
    console.info("[FaceBlinkWorker] Loading models from", MODEL_URL);
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    ]);
    console.info("[FaceBlinkWorker] Both face models loaded successfully");

    detectorCanvas = new OffscreenCanvas(2, 2);
    detectorContext = detectorCanvas.getContext("2d", { willReadFrequently: true });
    if (!detectorContext) throw new Error("Could not create an OffscreenCanvas 2D context.");

    initStage = "ready";
    detectorReady = true;
    console.info("[FaceBlinkWorker] Initialization complete", { backend: tf.getBackend() });
    self.postMessage({ type: "READY", backend: tf.getBackend() });
  } catch (error) {
    console.error("[FaceBlinkWorker] Initialization failed", {
      stage: initStage,
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      error,
    });
    self.postMessage({
      type: "ERROR",
      stage: initStage,
      name: error?.name || "Error",
      message: error?.message || "face-api.js could not initialize.",
      stack: error?.stack || "",
    });
  } finally {
    initializing = false;
  }
}

async function processFrame(bitmap, timestamp) {
  if (!detectorReady || !bitmap || stopped) {
    bitmap?.close?.();
    self.postMessage({ type: "FRAME_DONE" });
    return;
  }
  let rgbaTensor = null;
  let rgbTensor = null;

  try {
    detectorCanvas.width = bitmap.width;
    detectorCanvas.height = bitmap.height;
    detectorContext.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
    const imageData = detectorContext.getImageData(0, 0, bitmap.width, bitmap.height);

    rgbaTensor = tf.tensor3d(new Int32Array(imageData.data), [bitmap.height, bitmap.width, 4], "int32");
    rgbTensor = rgbaTensor.slice([0, 0, 0], [bitmap.height, bitmap.width, 3]);

    const detections = await faceapi
      .detectAllFaces(rgbTensor, new faceapi.TinyFaceDetectorOptions({
        inputSize: INPUT_SIZE,
        scoreThreshold: FACE_SCORE_THRESHOLD,
      }))
      .withFaceLandmarks();

    if (stopped) return;
    if (!detections.length) {
      closed = false;
      closedAt = 0;
      earHistory = [];
      self.postMessage({ type: "METRICS", faceFound: false, ear: null, baseline });
      return;
    }

    const face = detections.reduce((best, current) =>
      current.detection.score > best.detection.score ? current : best
    );
    const rawEar = calculateEar(face.landmarks);
    if (rawEar == null || !Number.isFinite(rawEar)) return;
    const ear = smoothEar(rawEar);

    if (calibrationCount < CALIBRATION_FRAMES) {
      calibrationCount += 1;
      calibrationEars.push(ear);
      calibrationMax = Math.max(calibrationMax, ear);
      // The maximum is easily inflated by landmark jitter. Use the median of
      // the open-eye samples so the baseline reflects typical eyes-open EAR.
      baseline = median(calibrationEars);
      self.postMessage({
        type: "METRICS", faceFound: true, ear: Number(ear.toFixed(3)),
        baseline: Number(baseline.toFixed(3)), calibration: calibrationCount,
        calibrationRequired: CALIBRATION_FRAMES,
      });
      return;
    }

    if (!closed && ear > baseline * 0.72) {
      baseline = Math.max(baseline * 0.985 + ear * 0.015, calibrationMax * 0.82);
    }

    // Use a more sensitive relative threshold. Glasses and camera angle can
    // reduce the absolute EAR change, so detect a meaningful drop from this
    // player's calibrated open-eye baseline rather than relying on one fixed
    // EAR value.
    // The previous close threshold was too strict for the user's observed EAR
    // (~0.274 with a ~0.315 baseline). Use a larger relative drop, while keeping
    // reopening below the typical open-eye reading to avoid getting stuck closed.
    const closeThreshold = Math.max(0.07, baseline * 0.82);
    const reopenThreshold = Math.max(0.09, baseline * 0.86);

    if (!closed && ear < closeThreshold) {
      closed = true;
      closedAt = timestamp;
    } else if (closed && ear >= reopenThreshold) {
      const duration = timestamp - closedAt;
      closed = false;
      closedAt = 0;
      if (duration >= MIN_BLINK_MS && duration <= MAX_BLINK_MS && timestamp - lastBlinkAt >= COOLDOWN_MS) {
        lastBlinkAt = timestamp;
        self.postMessage({ type: "BLINK_DETECTED", duration, ear: Number(ear.toFixed(3)) });
      }
    }

    self.postMessage({
      type: "METRICS", faceFound: true, ear: Number(ear.toFixed(3)),
      baseline: Number(baseline.toFixed(3)), closeThreshold: Number(closeThreshold.toFixed(3)),
      reopenThreshold: Number(reopenThreshold.toFixed(3)), closed,
      calibration: calibrationCount, calibrationRequired: CALIBRATION_FRAMES, backend: tf.getBackend(),
    });
  } catch (error) {
    console.warn("[FaceBlinkWorker] Frame inference failed", error);
    self.postMessage({ type: "FRAME_ERROR", message: error?.message || "Frame inference failed." });
  } finally {
    rgbaTensor?.dispose();
    rgbTensor?.dispose();
    bitmap?.close?.();
    self.postMessage({ type: "FRAME_DONE" });
  }
}

self.onmessage = (event) => {
  const data = event.data;
  if (data?.type === "INIT") void initialize();
  if (data?.type === "FRAME") void processFrame(data.bitmap, data.timestamp);
  if (data?.type === "RESET") {
    baseline = null; calibrationCount = 0; calibrationMax = 0; calibrationEars = [];
    closed = false; closedAt = 0; lastBlinkAt = 0; earHistory = [];
  }
  if (data?.type === "STOP") {
    stopped = true;
    detectorReady = false;
    try {
      faceapi.nets.tinyFaceDetector.dispose();
      faceapi.nets.faceLandmark68Net.dispose();
    } catch { /* Models may not have finished loading. */ }
    self.close();
  }
};
