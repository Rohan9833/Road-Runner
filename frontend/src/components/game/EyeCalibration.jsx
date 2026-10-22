import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, CircleAlert, Eye, LoaderCircle, ScanFace } from "lucide-react";
import GameCanvas from "./GameCanvas.jsx";

const FRAME_INTERVAL_MS = 35;
const OPEN_CAPTURE_MS = 2200;
const CLOSED_CAPTURE_MS = 1100;
const FACE_STABLE_MS = 900;
const REQUIRED_BLINKS = 3;

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const initialCalibration = {
  phase: "camera",
  message: "Allow camera access to begin your eye calibration.",
  facePresent: false,
  leftEar: 0,
  rightEar: 0,
  blinkCount: 0,
  calibrated: false,
  error: "",
};

export default function EyeCalibration() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const workerRef = useRef(null);
  const frameRef = useRef(0);
  const frameBusyRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const lastFrameAtRef = useRef(0);
  const blinkHandlerRef = useRef(null);
  const phaseRef = useRef("camera");
  const phaseStartedRef = useRef(0);
  const faceSeenSinceRef = useRef(0);
  const openSamplesRef = useRef({ left: [], right: [] });
  const closedSamplesRef = useRef({ left: [], right: [] });
  const openBaselineRef = useRef({ left: 0, right: 0 });
  const closedBaselineRef = useRef({ left: 0, right: 0 });
  const previousClosedRef = useRef(false);
  const blinkCountRef = useRef(0);
  const lastBlinkAtRef = useRef(0);
  const lastJumpTriggerAtRef = useRef(-Infinity);
  const lastUiUpdateRef = useRef(0);
  const calibratedThresholdsRef = useRef({ left: 0, right: 0 });
  const [state, setState] = useState(initialCalibration);
  const [cameraReady, setCameraReady] = useState(false);
  const [showGame, setShowGame] = useState(false);

  const update = useCallback((patch) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);

  const setPhase = useCallback((phase, message) => {
    phaseRef.current = phase;
    phaseStartedRef.current = performance.now();
    update({ phase, message, error: "" });
  }, [update]);

  const registerBlinkHandler = useCallback((handler) => {
    blinkHandlerRef.current = handler;
  }, []);

  const handleFrame = useCallback((message) => {
    const now = message.timestamp || performance.now();
    const left = Number(message.leftEar) || 0;
    const right = Number(message.rightEar) || 0;
    const shouldUpdateUi = now - lastUiUpdateRef.current >= 250;
    if (shouldUpdateUi) {
      lastUiUpdateRef.current = now;
      update({ facePresent: Boolean(message.facePresent), leftEar: left, rightEar: right });
    }

    if (!message.facePresent || left <= 0 || right <= 0) {
      faceSeenSinceRef.current = 0;
      previousClosedRef.current = false;
      if (["face", "open", "close", "reopen", "blinks"].includes(phaseRef.current) && shouldUpdateUi) {
        update({ message: "I can't see both eyes clearly. Face the camera and improve the lighting." });
      }
      return;
    }

    const phase = phaseRef.current;
    if (phase === "face") {
      if (!faceSeenSinceRef.current) faceSeenSinceRef.current = now;
      if (now - faceSeenSinceRef.current >= FACE_STABLE_MS) {
        openSamplesRef.current = { left: [], right: [] };
        setPhase("open", "Keep both eyes comfortably OPEN and look toward the camera.");
      }
      return;
    }

    if (phase === "open") {
      openSamplesRef.current.left.push(left);
      openSamplesRef.current.right.push(right);
      if (now - phaseStartedRef.current >= OPEN_CAPTURE_MS) {
        const baseline = {
          left: median(openSamplesRef.current.left),
          right: median(openSamplesRef.current.right),
        };
        if (baseline.left < 0.08 || baseline.right < 0.08) {
          openSamplesRef.current = { left: [], right: [] };
          setPhase("open", "I couldn't get a stable open-eye reading. Open your eyes naturally and try again.");
          return;
        }
        openBaselineRef.current = baseline;
        closedSamplesRef.current = { left: [], right: [] };
        setPhase("close", "Now CLOSE both eyes gently and hold them closed until the next step.");
      }
      return;
    }

    if (phase === "close") {
      closedSamplesRef.current.left.push(left);
      closedSamplesRef.current.right.push(right);
      if (now - phaseStartedRef.current >= CLOSED_CAPTURE_MS) {
        const closed = {
          left: median(closedSamplesRef.current.left),
          right: median(closedSamplesRef.current.right),
        };
        const open = openBaselineRef.current;
        const leftGap = open.left - closed.left;
        const rightGap = open.right - closed.right;
        if (leftGap < Math.max(0.025, open.left * 0.14) || rightGap < Math.max(0.025, open.right * 0.14)) {
          closedSamplesRef.current = { left: [], right: [] };
          setPhase("close", "The change was too small to confirm both eyes closed. Try closing them fully, then hold still.");
          return;
        }
        closedBaselineRef.current = closed;
        calibratedThresholdsRef.current = {
          left: closed.left + leftGap * 0.55,
          right: closed.right + rightGap * 0.55,
        };
        previousClosedRef.current = false;
        blinkCountRef.current = 0;
        update({ blinkCount: 0 });
        setPhase("blinks", "Calibration looks good. Blink naturally 3 times to verify detection.");
      }
      return;
    }

    if (phase === "blinks") {
      const thresholds = calibratedThresholdsRef.current;
      const isClosed = left < thresholds.left && right < thresholds.right;
      if (isClosed && !previousClosedRef.current) {
        previousClosedRef.current = true;
        lastBlinkAtRef.current = now;
      } else if (!isClosed && previousClosedRef.current) {
        previousClosedRef.current = false;
        const duration = now - lastBlinkAtRef.current;
        if (duration >= 35 && duration <= 900 && now - lastBlinkAtRef.current > 0) {
          blinkCountRef.current += 1;
          update({ blinkCount: blinkCountRef.current, message: `Good! Blink confirmed (${blinkCountRef.current}/${REQUIRED_BLINKS}).` });
          if (blinkCountRef.current >= REQUIRED_BLINKS) {
            setPhase("complete", "Both eyes are calibrated. You're ready to run.");
            update({ calibrated: true });
          }
        }
      }
      return;
    }

    if (phase === "playing") {
      const thresholds = calibratedThresholdsRef.current;
      const isClosed = left < thresholds.left && right < thresholds.right;
      if (isClosed && !previousClosedRef.current) {
        // Trigger on the first confirmed closed-eye frame, rather than waiting
        // for the eyes to reopen. This removes most of the perceived blink lag.
        previousClosedRef.current = true;
        lastBlinkAtRef.current = now;
        // Add two frame intervals (2 × 35 ms) to the existing blink debounce.
        if (now - lastJumpTriggerAtRef.current >= 330) {
          lastJumpTriggerAtRef.current = now;
          blinkHandlerRef.current?.();
        }
      } else if (!isClosed && previousClosedRef.current) {
        previousClosedRef.current = false;
      }
    }
  }, [setPhase, update]);

  useEffect(() => {
    let cancelled = false;
    let worker = null;

    const stopCamera = () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      workerRef.current?.postMessage({ type: "STOP" });
      workerRef.current?.terminate();
      workerRef.current = null;
      frameBusyRef.current = false;
    };

    const start = async () => {
      try {
        update({ phase: "camera", message: "Requesting camera permission…", error: "" });
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access requires HTTPS or localhost.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 480 },
            height: { ideal: 360 },
            frameRate: { ideal: 24, max: 30 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) throw new Error("Camera preview could not be created.");
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setCameraReady(true);
        setPhase("loading", "Loading eye-tracking model…");

        worker = new Worker("/blinkDetection.worker.js");
        workerRef.current = worker;
        worker.onmessage = (event) => {
          if (cancelled || workerRef.current !== worker) return;
          const message = event.data;
          if (message?.type === "READY") {
            setPhase("face", "Center your face in the frame and look straight at the camera.");
          } else if (message?.type === "FRAME_RESULT") {
            handleFrame(message);
          } else if (message?.type === "FRAME_DONE") {
            frameBusyRef.current = false;
          } else if (message?.type === "ERROR") {
            update({ phase: "error", error: message.message || "Eye-tracking model failed to load." });
            stopCamera();
          }
        };
        worker.onerror = () => update({ phase: "error", error: "Eye tracking crashed. Refresh the page and try again." });
        worker.postMessage({ type: "INIT" });

        const detect = async () => {
          if (cancelled) return;
          const currentVideo = videoRef.current;
          const now = performance.now();
          if (
            currentVideo && currentVideo.readyState >= 2 &&
            currentVideo.currentTime !== lastVideoTimeRef.current &&
            now - lastFrameAtRef.current >= FRAME_INTERVAL_MS &&
            !frameBusyRef.current && workerRef.current === worker
          ) {
            lastVideoTimeRef.current = currentVideo.currentTime;
            lastFrameAtRef.current = now;
            frameBusyRef.current = true;
            try {
              const bitmap = await createImageBitmap(currentVideo);
              if (cancelled || workerRef.current !== worker) {
                bitmap.close();
                frameBusyRef.current = false;
              } else {
                worker.postMessage({ type: "FRAME", bitmap, timestamp: now }, [bitmap]);
              }
            } catch {
              frameBusyRef.current = false;
            }
          }
          frameRef.current = requestAnimationFrame(detect);
        };
        frameRef.current = requestAnimationFrame(detect);
      } catch (error) {
        stopCamera();
        if (!cancelled) update({
          phase: "error",
          error: error?.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access and retry."
            : error?.message || "Unable to start the camera.",
        });
      }
    };

    start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [handleFrame, setPhase, update]);

  const retryCalibration = () => {
    openSamplesRef.current = { left: [], right: [] };
    closedSamplesRef.current = { left: [], right: [] };
    openBaselineRef.current = { left: 0, right: 0 };
    closedBaselineRef.current = { left: 0, right: 0 };
    previousClosedRef.current = false;
    blinkCountRef.current = 0;
    faceSeenSinceRef.current = 0;
    update({ calibrated: false, blinkCount: 0 });
    setPhase("face", "Center your face in the frame and look straight at the camera.");
  };

  const phaseNumber = state.phase === "face" ? 1
    : state.phase === "open" ? 2
      : state.phase === "close" ? 3
        : state.phase === "blinks" ? 4
          : state.phase === "complete" || state.phase === "playing" ? 5 : 0;

  return (
    <section className="eye-calibration" aria-label="Eye calibration">
      <div className={showGame ? "calibration-setup-ui calibration-setup-ui-hidden" : "calibration-setup-ui"}>
      <div className="eye-calibration-header">
        <div>
          <span className="eye-calibration-eyebrow"><ScanFace size={15} /> PERSONAL EYE CALIBRATION</span>
          <h2>{showGame ? "Blink to jump" : state.phase === "complete" ? "You're calibrated." : "Let's set up blink control."}</h2>
          <p>{showGame ? "Your camera stays active while you play. Blink naturally to jump." : "We'll measure your own eye openness, so detection is personalized for you."}</p>
        </div>
        <span className={state.calibrated ? "calibration-badge calibration-badge-done" : "calibration-badge"}>
          {state.calibrated ? <CheckCircle2 size={14} /> : <Camera size={14} />}
          {state.calibrated ? "CALIBRATED" : "CAMERA SETUP"}
        </span>
      </div>

      <div className={`calibration-layout ${showGame ? "calibration-layout-playing" : ""}`}>
        <div className="calibration-camera-card">
          <div className="calibration-video-frame">
            <video ref={videoRef} className="calibration-video" autoPlay muted playsInline />
            {!cameraReady && <div className="calibration-video-placeholder"><Camera size={28} /><span>Starting camera…</span></div>}
            {cameraReady && <span className="calibration-live-label"><span /> LIVE PREVIEW</span>}
            {state.phase === "error" && <div className="calibration-error-overlay"><CircleAlert size={20} /><span>{state.error}</span></div>}
          </div>
          <div className="calibration-camera-meta">
            <span className={state.facePresent ? "calibration-indicator calibration-indicator-on" : "calibration-indicator"} />
            {state.facePresent ? "Face detected" : "Waiting for face"}
            <span className="calibration-meta-spacer" />
            {state.leftEar > 0 ? `L ${state.leftEar.toFixed(3)} · R ${state.rightEar.toFixed(3)}` : "Eye tracking initializing"}
          </div>
        </div>

        {!showGame && (
          <div className="calibration-instructions">
            <span className="calibration-step-label">STEP {Math.max(1, Math.min(5, phaseNumber))} OF 5</span>
            <h3>{state.phase === "loading" ? "Preparing eye tracking" : state.phase === "face" ? "Center your face" : state.phase === "open" ? "Open your eyes" : state.phase === "close" ? "Close your eyes" : state.phase === "blinks" ? "Blink to verify" : state.phase === "complete" ? "Calibration complete" : state.phase === "error" ? "Camera needs attention" : "Camera setup"}</h3>
            <p>{state.message}</p>
            <div className="calibration-progress" aria-label={`Step ${phaseNumber} of 5`}>
              {[1, 2, 3, 4, 5].map((step) => <span key={step} className={step <= phaseNumber ? "calibration-progress-step calibration-progress-step-active" : "calibration-progress-step"} />)}
            </div>
            {state.phase === "blinks" && <div className="calibration-blink-count"><Eye size={17} /> <strong>{state.blinkCount} / {REQUIRED_BLINKS}</strong><span>verified blinks</span></div>}
            {state.phase === "complete" && <div className="calibration-success"><CheckCircle2 size={18} /><span>Both eyes confirmed. Personalized EAR thresholds saved for this session.</span></div>}
            {state.phase === "error" && <button type="button" className="button button-primary calibration-retry" onClick={() => window.location.reload()}>Retry camera</button>}
            {state.phase === "close" && <span className="calibration-tip">Keep your head still. Close your eyes gently; don't squeeze them hard.</span>}
            {state.phase === "open" && <span className="calibration-tip">Remove strong glare if possible and keep both eyes in view.</span>}
            {state.phase === "complete" && <button type="button" className="button button-primary calibration-retry" onClick={() => { setShowGame(true); setPhase("playing", "Calibration complete. Blink naturally to jump."); }}>Start playing <Eye size={16} /></button>}
            {state.phase !== "complete" && state.phase !== "error" && state.phase !== "camera" && state.phase !== "loading" && (
              <button type="button" className="calibration-reset-button" onClick={retryCalibration}>Restart calibration</button>
            )}
          </div>
        )}
      </div>
      </div>
      {showGame && <div className="calibrated-game-area"><GameCanvas onRegisterBlinkHandler={registerBlinkHandler} /></div>}
    </section>
  );
}
