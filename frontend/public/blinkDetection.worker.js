/* Pupil-visibility blink detector for Road Runner.
 * MediaPipe supplies eye/iris landmarks; blink events are based on image pixels,
 * not EAR or eye-blendshape scores. Both pupils must disappear briefly.
 */
const WASM_URL = "/mediapipe/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const REQUIRED_MISSING_FRAMES = 2;
const MIN_BLINK_GAP_MS = 260;
const MAX_MISSING_MS = 700;
const DARK_PIXEL_THRESHOLD = 85;
const MIN_CENTER_DARK_RATIO = 0.08;
const MIN_LOCAL_CONTRAST = 12;

let detector = null;
let initializing = false;
let stopped = false;
let frameCount = 0;
let pupilsWereVisible = false;
let missingFrames = 0;
let missingSince = 0;
let lastBlinkAt = -Infinity;

self.postMessage({ type: "WORKER_LOADED", detector: "pupil visibility" });

function distance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
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
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    stopped = false;
    self.postMessage({ type: "READY", backend: "pupil visibility" });
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

function grayAt(data, width, x, y) {
  const px = Math.max(0, Math.min(width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(data.length / 4 / width - 1, Math.round(y)));
  const index = (py * width + px) * 4;
  return (data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114);
}

// Check for a dark pupil-like center relative to the surrounding iris area.
// Eye and iris landmarks locate the search patch; pixel contrast decides visibility.
function pupilVisible(imageData, width, height, landmarks, centerIndex, eyeLeftIndex, eyeRightIndex) {
  const center = landmarks[centerIndex];
  const eyeLeft = landmarks[eyeLeftIndex];
  const eyeRight = landmarks[eyeRightIndex];
  if (!center || !eyeLeft || !eyeRight) return false;

  const eyeWidthPx = distance(eyeLeft, eyeRight) * width;
  if (eyeWidthPx < 8) return false;

  const cx = center.x * width;
  const cy = center.y * height;
  const radius = Math.max(1.5, Math.min(eyeWidthPx * 0.075, 5));
  const outerRadius = radius * 2.1;
  let centerDark = 0, centerCount = 0, ringSum = 0, ringCount = 0;

  const minX = Math.max(0, Math.floor(cx - outerRadius));
  const maxX = Math.min(width - 1, Math.ceil(cx + outerRadius));
  const minY = Math.max(0, Math.floor(cy - outerRadius));
  const maxY = Math.min(height - 1, Math.ceil(cy + outerRadius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      const gray = grayAt(imageData.data, width, x, y);
      if (d <= radius) {
        centerCount += 1;
        if (gray <= DARK_PIXEL_THRESHOLD) centerDark += 1;
      } else if (d >= radius * 1.35 && d <= outerRadius) {
        ringSum += gray;
        ringCount += 1;
      }
    }
  }

  if (!centerCount || !ringCount) return false;
  const centerDarkRatio = centerDark / centerCount;
  const centerMean = Array.from({ length: 1 }, () => {
    let sum = 0;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (Math.hypot(x - cx, y - cy) <= radius) sum += grayAt(imageData.data, width, x, y);
      }
    }
    return sum / centerCount;
  })[0];
  const ringMean = ringSum / ringCount;
  return centerDarkRatio >= MIN_CENTER_DARK_RATIO &&
    ringMean - centerMean >= MIN_LOCAL_CONTRAST;
}

function processFrame(bitmap, timestamp) {
  try {
    if (!detector || stopped) return;
    frameCount += 1;
    const result = detector.detectForVideo(bitmap, timestamp);
    const landmarks = result.faceLandmarks?.[0];

    if (!landmarks || landmarks.length < 478) {
      pupilsWereVisible = false;
      missingFrames = 0;
      missingSince = 0;
      self.postMessage({ type: "METRICS", face: false, leftPupil: false, rightPupil: false, frame: frameCount });
      return;
    }

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);

    // MediaPipe iris centers: 468 (subject's right eye) and 473 (subject's left eye).
    // Eye corners: 33–133 and 362–263.
    const leftPupil = pupilVisible(imageData, bitmap.width, bitmap.height, landmarks, 468, 33, 133);
    const rightPupil = pupilVisible(imageData, bitmap.width, bitmap.height, landmarks, 473, 362, 263);
    const bothVisible = leftPupil && rightPupil;
    const bothMissing = !leftPupil && !rightPupil;

    if (bothVisible) {
      pupilsWereVisible = true;
      missingFrames = 0;
      missingSince = 0;
    } else if (pupilsWereVisible && bothMissing) {
      missingFrames += 1;
      if (!missingSince) missingSince = timestamp;

      const missingDuration = timestamp - missingSince;
      if (
        missingFrames >= REQUIRED_MISSING_FRAMES &&
        missingDuration <= MAX_MISSING_MS &&
        timestamp - lastBlinkAt >= MIN_BLINK_GAP_MS
      ) {
        lastBlinkAt = timestamp;
        pupilsWereVisible = false;
        self.postMessage({
          type: "BLINK_DETECTED",
          method: "pupil-disappearance",
          missingFrames,
          missingDuration,
          confidence: 0.8,
        });
      } else if (missingDuration > MAX_MISSING_MS) {
        // Do not repeatedly report a long eye occlusion as multiple blinks.
        pupilsWereVisible = false;
        missingFrames = 0;
        missingSince = 0;
      }
    } else if (!bothMissing) {
      // If one pupil remains visible, treat it as partial occlusion/reflection,
      // not a confirmed blink.
      missingFrames = 0;
      missingSince = 0;
    }

    self.postMessage({
      type: "METRICS",
      face: true,
      leftPupil,
      rightPupil,
      bothPupilsVisible: bothVisible,
      missingFrames,
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
    pupilsWereVisible = false;
    missingFrames = 0;
    missingSince = 0;
    lastBlinkAt = -Infinity;
    return;
  }
  if (data?.type === "STOP") {
    stopped = true;
    detector?.close();
    detector = null;
    self.close();
  }
};
