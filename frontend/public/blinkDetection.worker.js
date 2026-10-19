/* Classic worker: MediaPipe's Emscripten runtime requires importScripts. */
const WASM_URL = "/mediapipe/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Use separate close/open thresholds (hysteresis) to avoid score jitter.
// Blendshape scores are confidence-like values: a lower score means the eye is open.
 // Use a very permissive open threshold so partially reopened eyes reset the blink.
const BLINK_CLOSED_THRESHOLD = 0.36;
const BLINK_OPEN_THRESHOLD = 0.38;
const BLINK_ONE_EYE_SUPPORT_THRESHOLD = 0.16;
const FAST_BLINK_DELTA = 0.12;
const FAST_BLINK_MIN_PREV = 0.20;
const FAST_BLINK_MIN_PEAK = 0.36;
const JUMP_DEBOUNCE_MS = 300;

let detector = null;
let previousLeft = 0;
let previousRight = 0;
let lastJumpTime = 0;
let closedSince = 0;
let wasClosed = false;
let initializing = false;

self.postMessage({ type: "WORKER_LOADED" });

async function initialize() {
  if (initializing || detector) return;
  initializing = true;
  let stage = "load local MediaPipe bundle";
  try {
    // Vite config copies the package's CommonJS bundle here with a .js extension
    // so the browser serves it as JavaScript, not application/node.
    self.exports = {};
    self.module = { exports: self.exports };
    importScripts("/mediapipe/vision_bundle.js");
    const api = self.module?.exports;
    if (!api?.FaceLandmarker || !api?.FilesetResolver) {
      throw new Error("Local MediaPipe bundle loaded without FaceLandmarker exports.");
    }
    console.info("[BlinkWorker] Local classic bundle loaded");

    stage = "download model";
    const modelResponse = await fetch(MODEL_URL);
    if (!modelResponse.ok) throw new Error(`Could not download face model (HTTP ${modelResponse.status}).`);
    const modelBuffer = new Uint8Array(await modelResponse.arrayBuffer());
    console.info("[BlinkWorker] Model downloaded", { bytes: modelBuffer.byteLength });

    stage = "resolve local WASM runtime";
    const visionFiles = await api.FilesetResolver.forVisionTasks(WASM_URL);
    console.info("[BlinkWorker] Local WASM fileset resolved", visionFiles);

    stage = "create FaceLandmarker";
    detector = await api.FaceLandmarker.createFromOptions(visionFiles, {
      baseOptions: { modelAssetBuffer: modelBuffer, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
    });
    console.info("[BlinkWorker] FaceLandmarker ready");
    self.postMessage({ type: "READY" });
  } catch (error) {
    console.error("[BlinkWorker] Initialization failed", {
      stage, name: error?.name, message: error?.message, stack: error?.stack, error,
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

self.onmessage = async (event) => {
  const data = event.data;
  if (data?.type === "INIT") {
    await initialize();
    return;
  }
  if (data?.type === "FRAME") {
    const bitmap = data.bitmap;
    try {
      if (!detector) return;
      const result = detector.detectForVideo(bitmap, data.timestamp);
      const categories = result.faceBlendshapes?.[0]?.categories ?? [];
      const left = categories.find((item) => item.categoryName === "eyeBlinkLeft")?.score ?? 0;
      const right = categories.find((item) => item.categoryName === "eyeBlinkRight")?.score ?? 0;
      const now = data.timestamp;
      const oldLeft = previousLeft;
      const oldRight = previousRight;
      const bothClosed =
        (left >= BLINK_CLOSED_THRESHOLD && right >= BLINK_ONE_EYE_SUPPORT_THRESHOLD) ||
        (right >= BLINK_CLOSED_THRESHOLD && left >= BLINK_ONE_EYE_SUPPORT_THRESHOLD);
      // Treat eyes as open once both scores fall below the relaxed threshold;
      // this allows a partial reopening to finish the blink instead of sticking closed.
      const bothOpen = left <= BLINK_OPEN_THRESHOLD && right <= BLINK_OPEN_THRESHOLD;
      const fastBlink =
        left >= FAST_BLINK_MIN_PEAK && right >= FAST_BLINK_MIN_PEAK &&
        oldLeft <= FAST_BLINK_MIN_PREV && oldRight <= FAST_BLINK_MIN_PREV &&
        left - oldLeft >= FAST_BLINK_DELTA && right - oldRight >= FAST_BLINK_DELTA;
      previousLeft = left;
      previousRight = right;
      let blink = false;
      if (!wasClosed && bothClosed) {
        wasClosed = true;
        closedSince = now;
        // A strong closure can be detected immediately so short blinks are not missed.
        if (fastBlink && now - lastJumpTime >= JUMP_DEBOUNCE_MS) {
          lastJumpTime = now;
          blink = true;
        }
      } else if (wasClosed && bothOpen) {
        const closedFor = now - closedSince;
        wasClosed = false;
        closedSince = 0;
        if (closedFor > 0 && closedFor <= 900 && now - lastJumpTime >= JUMP_DEBOUNCE_MS) {
          lastJumpTime = now;
          blink = true;
        }
      }
      if (blink) self.postMessage({ type: "BLINK_DETECTED" });
    } catch (error) {
      console.error("[BlinkWorker] Frame inference failed", { name: error?.name, message: error?.message, stack: error?.stack });
      self.postMessage({ type: "FRAME_ERROR", message: error?.message || "Frame processing failed.", stack: error?.stack || "" });
    } finally {
      bitmap?.close?.();
      self.postMessage({ type: "FRAME_DONE" });
    }
    return;
  }
  if (data?.type === "STOP") {
    detector?.close();
    detector = null;
    self.close();
  }
};
