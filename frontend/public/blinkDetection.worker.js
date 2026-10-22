/* Classic worker: MediaPipe's Emscripten runtime requires importScripts. */
const WASM_URL = "/mediapipe/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let detector = null;
let initializing = false;

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function eyeAspectRatio(landmarks, points) {
  const [leftCorner, upperOuter, upperInner, rightCorner, lowerInner, lowerOuter] = points.map((index) => landmarks[index]);
  if (![leftCorner, upperOuter, upperInner, rightCorner, lowerInner, lowerOuter].every(Boolean)) return 0;
  const horizontal = distance(leftCorner, rightCorner);
  if (horizontal < 0.0001) return 0;
  return (distance(upperOuter, lowerOuter) + distance(upperInner, lowerInner)) / (2 * horizontal);
}

self.postMessage({ type: "WORKER_LOADED" });

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

    stage = "download face landmark model";
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`Could not download face model (HTTP ${response.status}).`);
    const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());

    stage = "resolve local WASM runtime";
    const visionFiles = await api.FilesetResolver.forVisionTasks(WASM_URL);

    stage = "create FaceLandmarker";
    detector = await api.FaceLandmarker.createFromOptions(visionFiles, {
      baseOptions: { modelAssetBuffer, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    self.postMessage({ type: "READY" });
  } catch (error) {
    self.postMessage({
      type: "ERROR",
      stage,
      message: error?.message || "Could not initialize MediaPipe.",
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
      const landmarks = result.faceLandmarks?.[0];
      if (!landmarks || landmarks.length < 264) {
        self.postMessage({ type: "FRAME_RESULT", facePresent: false, leftEar: 0, rightEar: 0, timestamp: data.timestamp });
      } else {
        // MediaPipe Face Mesh eye contour landmarks. Ratios are scale independent.
        // Image coordinates are mirrored only for display; landmark geometry is unaffected.
        const leftEar = eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380]);
        const rightEar = eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144]);
        self.postMessage({
          type: "FRAME_RESULT",
          facePresent: leftEar > 0 && rightEar > 0,
          leftEar,
          rightEar,
          timestamp: data.timestamp,
        });
      }
    } catch (error) {
      self.postMessage({ type: "FRAME_ERROR", message: error?.message || "Frame processing failed." });
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
