/* Adaptive multi-signal blink detector for Road Runner.
 * No calibration screen: the open-eye EAR baseline learns in the background.
 * Blink detection combines eyelid landmarks and MediaPipe blink blendshapes;
 * pupil visibility is intentionally not required (more robust with glasses).
 */
const WASM_URL = "/mediapipe/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const MIN_BLINK_GAP_MS = 350;
const REQUIRED_CLOSED_FRAMES = 3;
const BLENDSHAPE_STRONG = 0.72;
const BLENDSHAPE_BOTH = 0.50;
const EAR_CLOSED_RATIO = 0.68;
const MIN_VALID_EAR = 0.08;
const MAX_VALID_EAR = 0.48;
const BASELINE_ALPHA_UP = 0.12;
const BASELINE_ALPHA_DOWN = 0.008;

let detector = null;
let initializing = false;
let stopped = false;
let frameCount = 0;
let lastBlinkAt = -Infinity;
let closedFrames = 0;
let blinkArmed = true;
let openEarBaseline = null;
let lastFaceAt = 0;

self.postMessage({ type: "WORKER_LOADED", detector: "adaptive multi-signal blink" });

function distance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(landmarks, cornerA, cornerB, upperA, lowerA, upperB, lowerB) {
  const horizontal = distance(landmarks[cornerA], landmarks[cornerB]);
  if (horizontal < 0.0001) return 0;
  const verticalA = distance(landmarks[upperA], landmarks[lowerA]);
  const verticalB = distance(landmarks[upperB], landmarks[lowerB]);
  return (verticalA + verticalB) / (2 * horizontal);
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
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`Could not download face model (HTTP ${response.status}).`);
    const modelBuffer = new Uint8Array(await response.arrayBuffer());

    stage = "resolve local WASM runtime";
    const files = await api.FilesetResolver.forVisionTasks(WASM_URL);

    stage = "create FaceLandmarker";
    detector = await api.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: modelBuffer, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
    stopped = false;
    self.postMessage({ type: "READY", backend: "adaptive multi-signal blink" });
  } catch (error) {
    self.postMessage({
      type: "ERROR",
      stage,
      name: error?.name || "Error",
      message: error?.message || "Could not initialize MediaPipe.",
      stack: error?.stack || "",
    });
  } finally {
    initializing = false;
  }
}

function getBlinkScores(result) {
  const categories = result.faceBlendshapes?.[0]?.categories || [];
  const scoreFor = (name) => categories.find((item) => item.categoryName === name)?.score || 0;
  return {
    left: scoreFor("eyeBlinkLeft"),
    right: scoreFor("eyeBlinkRight"),
  };
}

function updateOpenEyeBaseline(ear, blinkScore, timestamp) {
  if (!Number.isFinite(ear) || ear < MIN_VALID_EAR || ear > MAX_VALID_EAR) return;
  // Only use likely-open frames. Never adapt the baseline during a detected closure.
  if (blinkScore > 0.25) return;

  if (openEarBaseline === null) {
    openEarBaseline = ear;
    lastFaceAt = timestamp;
    return;
  }

  // Learn quickly when the observed eye is more open, and very slowly downward
  // to accommodate camera/pose drift without learning a closed eye as "normal".
  const alpha = ear >= openEarBaseline ? BASELINE_ALPHA_UP : BASELINE_ALPHA_DOWN;
  openEarBaseline += alpha * (ear - openEarBaseline);
  lastFaceAt = timestamp;
}

function processFrame(bitmap, timestamp) {
  try {
    if (!detector || stopped) return;
    frameCount += 1;
    const result = detector.detectForVideo(bitmap, timestamp);
    const landmarks = result.faceLandmarks?.[0];

    if (!landmarks || landmarks.length < 468) {
      closedFrames = 0;
      blinkArmed = true;
      self.postMessage({ type: "METRICS", face: false, frame: frameCount });
      return;
    }

    const leftEar = eyeAspectRatio(landmarks, 33, 133, 160, 144, 158, 153);
    const rightEar = eyeAspectRatio(landmarks, 362, 263, 385, 380, 387, 373);
    const validLeft = leftEar >= MIN_VALID_EAR && leftEar <= MAX_VALID_EAR;
    const validRight = rightEar >= MIN_VALID_EAR && rightEar <= MAX_VALID_EAR;
    const meanEar = validLeft && validRight
      ? (leftEar + rightEar) / 2
      : (validLeft ? leftEar : (validRight ? rightEar : 0));

    const scores = getBlinkScores(result);
    const maxBlinkScore = Math.max(scores.left, scores.right);
    const meanBlinkScore = (scores.left + scores.right) / 2;

    // Blendshapes are useful with many glasses; EAR provides a second route when
    // reflections make the blendshape score unreliable.
    updateOpenEyeBaseline(meanEar, maxBlinkScore, timestamp);
    const earClosed = openEarBaseline !== null &&
      meanEar > 0 &&
      meanEar < openEarBaseline * EAR_CLOSED_RATIO;
    const blendshapeClosed = maxBlinkScore >= BLENDSHAPE_STRONG ||
      meanBlinkScore >= BLENDSHAPE_BOTH;
    const isClosed = blendshapeClosed || earClosed;

    if (isClosed) {
      closedFrames += 1;
      if (
        closedFrames >= REQUIRED_CLOSED_FRAMES &&
        blinkArmed &&
        timestamp - lastBlinkAt >= MIN_BLINK_GAP_MS
      ) {
        lastBlinkAt = timestamp;
        blinkArmed = false;
        const confidence = blendshapeClosed && earClosed ? 0.96 :
          (blendshapeClosed ? 0.84 : 0.74);
        self.postMessage({
          type: "BLINK_DETECTED",
          method: blendshapeClosed && earClosed ? "blendshape+ear" :
            (blendshapeClosed ? "blendshape" : "ear-adaptive"),
          confidence,
          leftEar,
          rightEar,
          openEarBaseline,
          leftBlinkScore: scores.left,
          rightBlinkScore: scores.right,
        });
      }
    } else {
      closedFrames = 0;
      blinkArmed = true;
    }

    self.postMessage({
      type: "METRICS",
      face: true,
      leftEar,
      rightEar,
      meanEar,
      openEarBaseline,
      earClosed,
      leftBlinkScore: scores.left,
      rightBlinkScore: scores.right,
      closedFrames,
      frame: frameCount,
    });
  } catch (error) {
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
    frameCount = 0;
    lastBlinkAt = -Infinity;
    closedFrames = 0;
    blinkArmed = true;
    openEarBaseline = null;
    lastFaceAt = 0;
    return;
  }
  if (data?.type === "STOP") {
    stopped = true;
    detector?.close();
    detector = null;
    self.close();
  }
};
