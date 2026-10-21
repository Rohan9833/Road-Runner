/* Classic Web Worker: MediaPipe blendshapes + facial-landmark EAR fusion. */
const WASM_URL = "/mediapipe/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const CALIBRATION_FRAMES = 36;
const BLEND_CLOSED = 0.42;
const BLEND_OPEN = 0.24;
const MIN_CLOSED_MS = 35;
const MAX_CLOSED_MS = 750;
const COOLDOWN_MS = 300;
const EAR_CLOSED_RATIO = 0.72;
const EAR_ABSOLUTE_FLOOR = 0.105;
const REQUIRED_CLOSED_FRAMES = 1;

let detector = null;
let initializing = false;
let stopped = false;
let previousLeft = 0;
let previousRight = 0;
let lastBlinkAt = 0;
let closedSince = 0;
let closedFrames = 0;
let wasOpen = false;
let calibrationSamples = [];
let baselineEar = null;
let frameCount = 0;

self.postMessage({ type: "WORKER_LOADED", detector: "MediaPipe blendshapes + EAR" });

function distance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(points, indexes) {
  const [left, upperA, upperB, right, lowerA, lowerB] = indexes.map((i) => points[i]);
  const horizontal = distance(left, right);
  if (horizontal < 1e-6) return null;
  return (distance(upperA, lowerB) + distance(upperB, lowerA)) / (2 * horizontal);
}

function getEAR(points) {
  if (!points || points.length < 468) return null;
  // Standard MediaPipe Face Mesh eye contour landmarks.
  const left = eyeAspectRatio(points, [33, 160, 158, 133, 153, 144]);
  const right = eyeAspectRatio(points, [362, 385, 387, 263, 373, 380]);
  if (left == null || right == null) return null;
  return { left, right, mean: (left + right) / 2 };
}

async function initialize() {
  if (initializing || detector) return;
  initializing = true;
  let stage = "load local MediaPipe bundle";
  try {
    self.exports = {};
    self.module = { exports: self.exports };
    importScripts("/mediapipe/vision_bundle.js");
    const api = self.module?.exports;
    if (!api?.FaceLandmarker || !api?.FilesetResolver) {
      throw new Error("Local MediaPipe bundle loaded without FaceLandmarker exports.");
    }

    stage = "download face model";
    const modelResponse = await fetch(MODEL_URL);
    if (!modelResponse.ok) throw new Error(`Could not download face model (HTTP ${modelResponse.status}).`);
    const modelBuffer = new Uint8Array(await modelResponse.arrayBuffer());

    stage = "resolve local WASM runtime";
    const visionFiles = await api.FilesetResolver.forVisionTasks(WASM_URL);

    stage = "create FaceLandmarker";
    detector = await api.FaceLandmarker.createFromOptions(visionFiles, {
      baseOptions: { modelAssetBuffer: modelBuffer, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
    stopped = false;
    console.info("[BlinkWorker] Multi-signal detector ready: blendshapes + EAR");
    self.postMessage({ type: "READY", backend: "MediaPipe blendshapes + EAR", calibrationFrames: CALIBRATION_FRAMES });
  } catch (error) {
    console.error("[BlinkWorker] Initialization failed", {
      stage, name: error?.name, message: error?.message, stack: error?.stack,
    });
    self.postMessage({
      type: "ERROR", stage, name: error?.name || "Error",
      message: error?.message || "Could not initialize MediaPipe in the worker.",
      stack: error?.stack || "",
    });
  } finally {
    initializing = false;
  }
}

function processFrame(bitmap, timestamp) {
  try {
    if (!detector || stopped) return;
    frameCount += 1;
    const result = detector.detectForVideo(bitmap, timestamp);
    const categories = result.faceBlendshapes?.[0]?.categories ?? [];
    const left = categories.find((item) => item.categoryName === "eyeBlinkLeft")?.score ?? 0;
    const right = categories.find((item) => item.categoryName === "eyeBlinkRight")?.score ?? 0;
    const points = result.faceLandmarks?.[0];
    const ear = getEAR(points);

    if (ear && frameCount <= CALIBRATION_FRAMES && left < BLEND_CLOSED && right < BLEND_CLOSED) {
      calibrationSamples.push(ear.mean);
      if (calibrationSamples.length > CALIBRATION_FRAMES) calibrationSamples.shift();
      const sorted = [...calibrationSamples].sort((a, b) => a - b);
      // Use a robust upper quartile of open-eye samples as the personal baseline.
      baselineEar = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.75)] : null;
    }

    const earClosed = ear && baselineEar != null
      ? ear.mean < Math.max(EAR_ABSOLUTE_FLOOR, baselineEar * EAR_CLOSED_RATIO)
      : false;
    const blendClosed = left >= BLEND_CLOSED || right >= BLEND_CLOSED;
    const blendOpen = left <= BLEND_OPEN && right <= BLEND_OPEN;
    const earOpen = ear && baselineEar != null
      ? ear.mean >= baselineEar * 0.84
      : false;

    // Fuse independent cues. Blendshapes can catch closure under glasses;
    // EAR can catch blinks when blendshape scores are weak. A single-eye
    // signal is accepted only when the other signal supports closure.
    const closureEvidence = blendClosed || earClosed;
    const reopeningEvidence = blendOpen || earOpen;
    const openEvidence = blendOpen || earOpen;

    if (openEvidence) wasOpen = true;

    if (wasOpen && closureEvidence) {
      closedFrames += 1;
      if (!closedSince && closedFrames >= REQUIRED_CLOSED_FRAMES) {
        closedSince = timestamp;
      }
    } else if (closedSince && reopeningEvidence) {
      const duration = timestamp - closedSince;
      const blink = duration >= MIN_CLOSED_MS &&
        duration <= MAX_CLOSED_MS &&
        timestamp - lastBlinkAt >= COOLDOWN_MS;
      if (blink) {
        lastBlinkAt = timestamp;
        console.info("[BlinkWorker] BLINK_DETECTED", {
          durationMs: Math.round(duration),
          blendLeft: Number(left.toFixed(3)),
          blendRight: Number(right.toFixed(3)),
          ear: ear ? Number(ear.mean.toFixed(3)) : null,
          baselineEar: baselineEar == null ? null : Number(baselineEar.toFixed(3)),
          frame: frameCount,
        });
        self.postMessage({
          type: "BLINK_DETECTED",
          durationMs: Math.round(duration),
          confidence: blendClosed && earClosed ? 0.95 : 0.78,
          signals: { blendshape: blendClosed, ear: Boolean(earClosed) },
        });
      }
      closedSince = 0;
      closedFrames = 0;
    } else if (closedSince && timestamp - closedSince > MAX_CLOSED_MS) {
      closedSince = 0;
      closedFrames = 0;
    }

    previousLeft = left;
    previousRight = right;

    self.postMessage({
      type: "METRICS",
      face: Boolean(points),
      blendLeft: left,
      blendRight: right,
      ear: ear?.mean ?? null,
      baselineEar,
      earClosed: Boolean(earClosed),
      blendClosed,
      calibration: calibrationSamples.length,
      calibrationTotal: CALIBRATION_FRAMES,
      frame: frameCount,
    });
  } catch (error) {
    console.error("[BlinkWorker] Frame inference failed", {
      name: error?.name, message: error?.message, stack: error?.stack,
    });
    self.postMessage({ type: "FRAME_ERROR", message: error?.message || "Frame processing failed." });
  } finally {
    bitmap?.close?.();
    self.postMessage({ type: "FRAME_DONE" });
  }
}

self.onmessage = async (event) => {
  const data = event.data;
  if (data?.type === "INIT") {
    await initialize();
    return;
  }
  if (data?.type === "FRAME") {
    processFrame(data.bitmap, data.timestamp ?? performance.now());
    return;
  }
  if (data?.type === "RESET") {
    previousLeft = 0;
    previousRight = 0;
    lastBlinkAt = 0;
    closedSince = 0;
    closedFrames = 0;
    wasOpen = false;
    calibrationSamples = [];
    baselineEar = null;
    frameCount = 0;
    return;
  }
  if (data?.type === "STOP") {
    stopped = true;
    detector?.close();
    detector = null;
    self.close();
  }
};
