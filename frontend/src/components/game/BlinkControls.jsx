import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const CLOSED_THRESHOLD = 0.24;
const OPEN_THRESHOLD = 0.15;
const FAST_BLINK_DELTA = 0.10;
const FAST_BLINK_MIN_PEAK = 0.22;
const FAST_BLINK_PREVIOUS_MAX = 0.18;
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
  const readyToBlinkRef = useRef(true);
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
        readyToBlinkRef.current = true;
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
            const previousLeft = previousLeftRef.current;
            const previousRight = previousRightRef.current;

            const bothOpen = left < OPEN_THRESHOLD && right < OPEN_THRESHOLD;
            if (bothOpen) {
              readyToBlinkRef.current = true;
            }

            // Accept subtle blinks too: the two eyes do not always receive
            // identical scores, especially with glasses, lighting, or camera angle.
            const bothClosed =
              left > CLOSED_THRESHOLD && right > CLOSED_THRESHOLD;
            const softBlink =
              (left > 0.32 && right > 0.14) ||
              (right > 0.32 && left > 0.14);
            const fastBlink =
              left - previousLeft >= FAST_BLINK_DELTA &&
              right - previousRight >= FAST_BLINK_DELTA &&
              previousLeft < FAST_BLINK_PREVIOUS_MAX &&
              previousRight < FAST_BLINK_PREVIOUS_MAX &&
              left > FAST_BLINK_MIN_PEAK &&
              right > FAST_BLINK_MIN_PEAK;

            if (readyToBlinkRef.current && (bothClosed || softBlink || fastBlink)) {
              readyToBlinkRef.current = false;
              const now = performance.now();
              if (now - lastJumpTimeRef.current >= JUMP_DEBOUNCE_MS) {
                lastJumpTimeRef.current = now;
                setBlinkCount((count) => count + 1);
                setBlinkPulse(true);
                window.setTimeout(() => setBlinkPulse(false), 650);
                onBlinkRef.current?.();
              }
            }

            previousLeftRef.current = left;
            previousRightRef.current = right;
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
