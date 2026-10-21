import cv from "@techstark/opencv-js";

const FACE_CASCADE_URL = "https://cdn.jsdelivr.net/gh/opencv/opencv/4.x/data/haarcascades/haarcascade_frontalface_default.xml";
const EYE_CASCADE_URL = "https://cdn.jsdelivr.net/gh/opencv/opencv/4.x/data/haarcascades/haarcascade_eye_tree_eyeglasses.xml";
const SAMPLE_WINDOW = 7;
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
let samples = [];
let calibrationFrames = 0;
let baselineLeft = 0;
let baselineRight = 0;
let eyesWereOpen = false;
let closedSince = 0;
let lastBlinkAt = 0;
let consecutiveClosed = 0;
let busy = false;

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

async function waitForOpenCV() {
  if (cv?.Mat && cv?.CascadeClassifier) return;
  await new Promise((resolve, reject) => {
    const previous = cv.onRuntimeInitialized;
    const timeout = setTimeout(() => reject(new Error("OpenCV.js initialization timed out.")), 30000);
    cv.onRuntimeInitialized = () => {
      clearTimeout(timeout);
      previous?.();
      resolve();
    };
    if (cv?.Mat && cv?.CascadeClassifier) {
      clearTimeout(timeout);
      resolve();
    }
  });
}

async function loadCascade(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download OpenCV cascade (${response.status}): ${filename}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  try { cv.FS_unlink(`/${filename}`); } catch {}
  cv.FS_createDataFile("/", filename, bytes, true, false, false);
  const classifier = new cv.CascadeClassifier();
  if (!classifier.load(filename)) throw new Error(`OpenCV could not load ${filename}`);
  return classifier;
}

async function initialize() {
  if (initialized || initializing) return;
  initializing = true;
  try {
    post("STATUS", { stage: "Loading OpenCV.js…" });
    await waitForOpenCV();
    faceCascade = await loadCascade(FACE_CASCADE_URL, "road_runner_face.xml");
    eyeCascade = await loadCascade(EYE_CASCADE_URL, "road_runner_eye_glasses.xml");
    canvas = new OffscreenCanvas(2, 2);
    context = canvas.getContext("2d", { willReadFrequently: true });
    initialized = true;
    post("READY", { backend: "OpenCV.js Haar cascades", calibrationFrames: CALIBRATION_FRAMES });
  } catch (error) {
    post("ERROR", { stage: "initialize", message: error?.message || String(error) });
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
  const faceX = Math.max(0, face.x);
  const faceY = Math.max(0, face.y);
  const faceW = face.width;
  const faceH = face.height;
  const eyeY = faceY + Math.round(faceH * 0.20);
  const eyeH = Math.max(1, Math.round(faceH * 0.42));
  const halfW = Math.max(1, Math.round(faceW * 0.48));
  const leftX = faceX + Math.round(faceW * 0.04);
  const rightX = faceX + Math.round(faceW * 0.50);
  const leftRect = new cv.Rect(leftX, eyeY, Math.min(halfW, gray.cols - leftX), Math.min(eyeH, gray.rows - eyeY));
  const rightRect = new cv.Rect(rightX, eyeY, Math.min(halfW, gray.cols - rightX), Math.min(eyeH, gray.rows - eyeY));
  const found = [];
  for (const rect of [leftRect, rightRect]) {
    if (rect.width < 8 || rect.height < 8) {
      found.push(false);
      continue;
    }
    const roi = gray.roi(rect);
    const eyes = new cv.RectVector();
    const weights = new cv.IntVector();
    try {
      eyeCascade.detectMultiScale(roi, eyes, 1.1, 2, 0, new cv.Size(8, 8), new cv.Size());
      found.push(eyes.size() > 0);
    } finally {
      roi.delete();
      eyes.delete();
      weights.delete();
    }
  }
  return found;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function processFrame(bitmap, timestamp) {
  if (!initialized || stopped || busy) {
    bitmap?.close?.();
    return;
  }
  busy = true;
  let source, gray, faces, faceVector;
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    source = cv.matFromImageData(imageData);
    gray = new cv.Mat();
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    // Mild blur stabilizes Haar results without hiding short closures.
    cv.equalizeHist(gray, gray);
    faces = new cv.RectVector();
    faceVector = new cv.IntVector();
    faceCascade.detectMultiScale(gray, faces, 1.1, 4, 0, new cv.Size(48, 48), new cv.Size());
    if (faces.size() === 0) {
      post("METRICS", { face: false, eyes: 0, calibration: calibrationFrames, calibrationTotal: CALIBRATION_FRAMES });
      return;
    }
    const face = largestRect(faces);
    const eyeOpen = detectEyes(gray, face);
    const openCount = Number(eyeOpen[0]) + Number(eyeOpen[1]);

    if (openCount === 2) {
      eyesWereOpen = true;
      consecutiveClosed = 0;
      if (calibrationFrames < CALIBRATION_FRAMES) {
        calibrationFrames += 1;
        // Require a stable run of open-eye detections before setting baseline.
        samples.push(openCount);
        if (samples.length > SAMPLE_WINDOW) samples.shift();
        if (samples.length >= 4) {
          baselineLeft = 1;
          baselineRight = 1;
        }
      }
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
    } else if (openCount === 1) {
      // Partial occlusion / a light blink: tolerate one eye being detected,
      // but keep the closing interval if it has already started.
      consecutiveClosed = 0;
    } else {
      consecutiveClosed = 0;
      if (closedSince && timestamp - closedSince > MAX_CLOSED_MS) closedSince = 0;
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
    faceVector?.delete();
    busy = false;
    post("FRAME_DONE");
  }
}

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "INIT") {
    stopped = false;
    await initialize();
  } else if (message.type === "FRAME") {
    processFrame(message.bitmap, message.timestamp || performance.now());
  } else if (message.type === "RESET") {
    samples = [];
    calibrationFrames = 0;
    baselineLeft = 0;
    baselineRight = 0;
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
