import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// Responsive blink detection: keep the original fast-spike path plus a normal blink path.
const BLINK_CLOSED_THRESHOLD = 0.45;
const BLINK_OPEN_THRESHOLD = 0.20;
const FAST_BLINK_DELTA = 0.22;
const FAST_BLINK_MIN_PREV = 0.05;
const FAST_BLINK_MIN_PEAK = 0.42;
const JUMP_DEBOUNCE_MS = 220;
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export default function BlinkControls({ onBlink, gameStatus }) {
  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const frameRef = useRef(null);
  const streamRef = useRef(null);
  const onBlinkRef = useRef(onBlink);
  const lastVideoTimeRef = useRef(-1);
  const previousLeftRef = useRef(0);
  const previousRightRef = useRef(0);
  const lastJumpTimeRef = useRef(0);
  const closedSinceRef = useRef(0);
  const wasClosedRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [blinkCount, setBlinkCount] = useState(0);
  const [blinkPulse, setBlinkPulse] = useState(false);

  useEffect(() => {
    onBlinkRef.current = onBlink;
  }, [onBlink]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const stopCamera = () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      detectorRef.current?.close();
      detectorRef.current = null;
    };

    async function startCamera() {
      try {
        setStatus("loading");
        setError("");
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access requires HTTPS or localhost.");
        }

        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) return;

        const detector = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
        });
        if (cancelled) {
          detector.close();
          return;
        }
        detectorRef.current = detector;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) throw new Error("Camera preview is unavailable.");
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;

        previousLeftRef.current = 0;
        previousRightRef.current = 0;
        lastVideoTimeRef.current = -1;
        lastJumpTimeRef.current = 0;
        closedSinceRef.current = 0;
        wasClosedRef.current = false;
        setStatus("ready");

        const detect = () => {
          if (cancelled) return;
          const currentVideo = videoRef.current;
          const landmarker = detectorRef.current;

          if (
            currentVideo &&
            landmarker &&
            currentVideo.readyState >= 2 &&
            currentVideo.currentTime !== lastVideoTimeRef.current
          ) {
            lastVideoTimeRef.current = currentVideo.currentTime;
            const result = landmarker.detectForVideo(currentVideo, performance.now());
            const categories = result.faceBlendshapes?.[0]?.categories ?? [];
            const left = categories.find((item) => item.categoryName === "eyeBlinkLeft")?.score ?? 0;
            const right = categories.find((item) => item.categoryName === "eyeBlinkRight")?.score ?? 0;
            const now = performance.now();
            const previousLeft = previousLeftRef.current;
            const previousRight = previousRightRef.current;
            const bothClosed = left >= BLINK_CLOSED_THRESHOLD && right >= BLINK_CLOSED_THRESHOLD;
            const bothOpen = left <= BLINK_OPEN_THRESHOLD && right <= BLINK_OPEN_THRESHOLD;

            // Save raw scores so a quick closure can trigger without smoothing delay.
            previousLeftRef.current = left;
            previousRightRef.current = right;

            const fastBlink =
              left >= FAST_BLINK_MIN_PEAK &&
              right >= FAST_BLINK_MIN_PEAK &&
              previousLeft <= FAST_BLINK_MIN_PREV &&
              previousRight <= FAST_BLINK_MIN_PREV &&
              left - previousLeft >= FAST_BLINK_DELTA &&
              right - previousRight >= FAST_BLINK_DELTA;

            if (
              fastBlink &&
              now - lastJumpTimeRef.current >= JUMP_DEBOUNCE_MS
            ) {
              // Fast path: jump on the closure spike for minimal input delay.
              lastJumpTimeRef.current = now;
              wasClosedRef.current = true;
              closedSinceRef.current = now;
              setBlinkCount((count) => count + 1);
              setBlinkPulse(true);
              window.setTimeout(() => setBlinkPulse(false), 650);
              onBlinkRef.current?.();
            } else if (!wasClosedRef.current && bothClosed) {
              wasClosedRef.current = true;
              closedSinceRef.current = now;
            } else if (wasClosedRef.current && bothOpen) {
              // Normal path: trigger on reopening if the fast path didn't fire.
              const closedFor = now - closedSinceRef.current;
              wasClosedRef.current = false;
              closedSinceRef.current = 0;

              if (
                closedFor > 0 &&
                closedFor <= 700 &&
                now - lastJumpTimeRef.current >= JUMP_DEBOUNCE_MS
              ) {
                lastJumpTimeRef.current = now;
                setBlinkCount((count) => count + 1);
                setBlinkPulse(true);
                window.setTimeout(() => setBlinkPulse(false), 650);
                onBlinkRef.current?.();
              } else if (closedFor > 700) {
                wasClosedRef.current = false;
                closedSinceRef.current = 0;
              }
            }
          }

          frameRef.current = requestAnimationFrame(detect);
        };

        frameRef.current = requestAnimationFrame(detect);
      } catch (err) {
        console.error("Blink control error:", err);
        if (!cancelled) {
          setError(
            err.name === "NotAllowedError"
              ? "Camera permission was denied. Allow access and try again."
              : err.message || "Could not start blink control."
          );
          setStatus("error");
          stopCamera();
        }
      }
    }

    startCamera();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [enabled]);

  const toggleEnabled = () => {
    if (enabled) {
      setEnabled(false);
      setStatus("idle");
      setError("");
    } else {
      setEnabled(true);
    }
  };

  const statusLabel = status === "loading"
    ? "CONNECTING CAMERA"
    : status === "ready"
      ? gameStatus === "playing" ? "BLINK TO JUMP" : "BLINK CONTROL READY"
      : status === "error" ? "CAMERA NEEDS ATTENTION" : "HANDS-FREE MODE";

  return (
    <aside className={`blink-widget ${enabled ? "blink-widget-enabled" : ""} ${blinkPulse ? "blink-widget-pulse" : ""}`} aria-label="Blink controls">
      <div className="blink-widget-heading">
        <span className="blink-live-dot" />
        <span>BLINK CONTROL</span>
        <span className="blink-widget-count">{blinkCount} JUMPS</span>
      </div>
      <div className="blink-camera-frame">
        <video ref={videoRef} className="blink-camera-video" autoPlay muted playsInline />
        {!enabled && (
          <div className="blink-camera-placeholder">
            <Camera size={21} />
            <span>YOUR CAM</span>
          </div>
        )}
        {enabled && status === "loading" && (
          <div className="blink-camera-overlay"><LoaderCircle size={20} className="blink-spinner" /><span>Starting camera…</span></div>
        )}
        {enabled && status === "error" && (
          <div className="blink-camera-overlay blink-camera-error"><CameraOff size={19} /><span>{error}</span></div>
        )}
        {enabled && status === "ready" && (
          <span className="blink-camera-live"><span /> LIVE</span>
        )}
        {blinkPulse && <div className="blink-jump-flash"><Eye size={16} /> JUMP!</div>}
      </div>
      <div className="blink-widget-footer">
        <div className="blink-widget-copy">
          <strong>{statusLabel}</strong>
          <span>{status === "error" ? "Check camera permissions" : enabled ? "Blink both eyes to leap" : "Jump without your hands"}</span>
        </div>
        <button type="button" className={`blink-toggle ${enabled ? "blink-toggle-on" : ""}`} onClick={toggleEnabled}>
          {enabled ? <><EyeOff size={14} /> Turn off</> : <><Camera size={14} /> Enable</>}
        </button>
      </div>
    </aside>
  );
}
