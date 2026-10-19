import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// Keep the WASM files on the exact same package version as the JS library.
// Using a different version here can leave the worker without ModuleFactory.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const BLINK_CLOSED_THRESHOLD = 0.30;
const BLINK_OPEN_THRESHOLD = 0.30;
const BLINK_ONE_EYE_SUPPORT_THRESHOLD = 0.22;
const FAST_BLINK_DELTA = 0.12;
const FAST_BLINK_MIN_PREV = 0.18;
const FAST_BLINK_MIN_PEAK = 0.30;
const JUMP_DEBOUNCE_MS = 220;

let detector = null;
let previousLeft = 0;
let previousRight = 0;
let lastJumpTime = 0;
let closedSince = 0;
let wasClosed = false;
let initializing = false;

async function initialize() {
  if (initializing || detector) return;
  initializing = true;
  try {
    // Fetch the model as bytes in the worker and pass the buffer to MediaPipe.
    // This avoids a second model-path fetch inside the WASM runtime.
    const modelResponse = await fetch(MODEL_URL);
    if (!modelResponse.ok) {
      throw new Error(`Could not download face model (HTTP ${modelResponse.status}).`);
    }
    const modelBuffer = new Uint8Array(await modelResponse.arrayBuffer());

    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    detector = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: modelBuffer, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
    });

    self.postMessage({ type: "READY" });
  } catch (error) {
    self.postMessage({
      type: "ERROR",
      message: error?.message || "Could not initialize MediaPipe in the worker.",
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
      const bothOpen = left <= BLINK_OPEN_THRESHOLD && right <= BLINK_OPEN_THRESHOLD;
      const fastBlink =
        left >= FAST_BLINK_MIN_PEAK &&
        right >= FAST_BLINK_MIN_PEAK &&
        oldLeft <= FAST_BLINK_MIN_PREV &&
        oldRight <= FAST_BLINK_MIN_PREV &&
        left - oldLeft >= FAST_BLINK_DELTA &&
        right - oldRight >= FAST_BLINK_DELTA;

      previousLeft = left;
      previousRight = right;
      let blink = false;

      if (fastBlink && now - lastJumpTime >= JUMP_DEBOUNCE_MS) {
        lastJumpTime = now;
        wasClosed = true;
        closedSince = now;
        blink = true;
      } else if (!wasClosed && bothClosed) {
        wasClosed = true;
        closedSince = now;
      } else if (wasClosed && bothOpen) {
        const closedFor = now - closedSince;
        wasClosed = false;
        closedSince = 0;
        if (closedFor > 0 && closedFor <= 700 && now - lastJumpTime >= JUMP_DEBOUNCE_MS) {
          lastJumpTime = now;
          blink = true;
        }
      }

      if (blink) self.postMessage({ type: "BLINK_DETECTED" });
    } catch (error) {
      self.postMessage({ type: "FRAME_ERROR", message: error?.message || "Frame processing failed." });
    } finally {
      bitmap?.close?.();
      self.postMessage({ type: "FRAME_DONE" });
    }
  }

  if (data?.type === "STOP") {
    detector?.close();
    detector = null;
    self.close();
  }
};
