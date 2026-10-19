import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// Responsive blink detection: keep the original fast-spike path plus a normal blink path.
// MediaPipe blink scores vary with camera, lighting, and face position. Use
// a more tolerant two-eye threshold while still requiring both eyes to react.
const BLINK_CLOSED_THRESHOLD = 0.30;
// A partially opened eye may still have a moderate blink score; allow reopening
// at a higher score so users do not need to open their eyes completely.
const BLINK_OPEN_THRESHOLD = 0.30;
const BLINK_ONE_EYE_SUPPORT_THRESHOLD = 0.22;
const FAST_BLINK_DELTA = 0.12;
const FAST_BLINK_MIN_PREV = 0.18;
const FAST_BLINK_MIN_PEAK = 0.30;
const JUMP_DEBOUNCE_MS = 220;
// Face inference is expensive on phones. 12–15 checks/sec is enough to catch
// a blink while leaving more CPU time for the game animation.
const DETECTION_INTERVAL_MS = 160; // About 6 inference passes/sec to reduce main-thread stalls.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export default function BlinkControls({ onBlink }) {
  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const frameRef = useRef(null);
  const streamRef = useRef(null);
  const onBlinkRef = useRef(onBlink);
  const lastVideoTimeRef = useRef(-1);
  const lastDetectionTimeRef = useRef(0);
  const previousLeftRef = useRef(0);
  const previousRightRef = useRef(0);
  const lastJumpTimeRef = useRef(0);
  const closedSinceRef = useRef(0);
  const wasClosedRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [loadingStage, setLoadingStage] = useState("Waiting for camera…");
  const [blinkCount, setBlinkCount] = useState(0);
  const [blinkPulse, setBlinkPulse] = useState(false);
  const [blinkNotice, setBlinkNotice] = useState("");

  useEffect(() => {
    onBlinkRef.current = onBlink;
  }, [onBlink]);

  // Show a small confirmation and notify the game to jump.
  const reportBlink = () => {
    setBlinkCount((count) => count + 1);
    setBlinkNotice("Blink detected");
    setBlinkPulse(true);
    onBlinkRef.current?.();
    window.setTimeout(() => setBlinkPulse(false), 350);
    window.setTimeout(() => setBlinkNotice(""), 1400);
  };

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
        setLoadingStage("Requesting camera…");
        setError("");
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access requires HTTPS or localhost.");
        }

        // Request camera access first so Safari/iPadOS can show its permission
        // prompt immediately, before the MediaPipe model and WASM files load.
        const isMobile = window.matchMedia("(max-width: 650px)").matches;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            // Smaller camera frames dramatically reduce MediaPipe CPU cost on phones.
            width: { ideal: isMobile ? 160 : 480 },
            height: { ideal: isMobile ? 120 : 360 },
            frameRate: { ideal: isMobile ? 10 : 24, max: isMobile ? 12 : 30 },
          },
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

        setLoadingStage("Loading vision runtime…");
        const vision = await Promise.race([
          FilesetResolver.forVisionTasks(WASM_URL),
          new Promise((_, reject) =>
            window.setTimeout(
              () => reject(new Error("Timed out loading MediaPipe runtime. Check the iPad internet connection or CDN access.")),
              20000
            )
          ),
        ]);
        if (cancelled) return;

        setLoadingStage("Loading face model…");
        const detector = await Promise.race([
          FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
          }),
          new Promise((_, reject) =>
            window.setTimeout(
              () => reject(new Error("Timed out loading the face model. The model download may be blocked or too slow on this iPad.")),
              25000
            )
          ),
        ]);
        if (cancelled) {
          detector.close();
          return;
        }
        detectorRef.current = detector;

        previousLeftRef.current = 0;
        previousRightRef.current = 0;
        lastVideoTimeRef.current = -1;
        lastDetectionTimeRef.current = 0;
        lastJumpTimeRef.current = 0;
        closedSinceRef.current = 0;
        wasClosedRef.current = false;
        setStatus("ready");

        const detect = () => {
          if (cancelled) return;
          const currentVideo = videoRef.current;
          const landmarker = detectorRef.current;

          const frameNow = performance.now();
          if (
            currentVideo &&
            landmarker &&
            currentVideo.readyState >= 2 &&
            currentVideo.currentTime !== lastVideoTimeRef.current &&
            frameNow - lastDetectionTimeRef.current >= DETECTION_INTERVAL_MS
          ) {
            lastVideoTimeRef.current = currentVideo.currentTime;
            lastDetectionTimeRef.current = frameNow;
            const result = landmarker.detectForVideo(currentVideo, frameNow);
            const categories = result.faceBlendshapes?.[0]?.categories ?? [];
            const left = categories.find((item) => item.categoryName === "eyeBlinkLeft")?.score ?? 0;
            const right = categories.find((item) => item.categoryName === "eyeBlinkRight")?.score ?? 0;
            const now = performance.now();
            const previousLeft = previousLeftRef.current;
            const previousRight = previousRightRef.current;
            // The two eye scores are not always equal when the full face is
            // visible. Accept a strong score from either eye when the other
            // eye also shows a meaningful closure response.
            const bothClosed =
              (left >= BLINK_CLOSED_THRESHOLD && right >= BLINK_ONE_EYE_SUPPORT_THRESHOLD) ||
              (right >= BLINK_CLOSED_THRESHOLD && left >= BLINK_ONE_EYE_SUPPORT_THRESHOLD);
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
              reportBlink();
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
                reportBlink();
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
      ? "BLINK DETECTION ACTIVE"
      : status === "error" ? "CAMERA NEEDS ATTENTION" : "HANDS-FREE MODE";

  return (
    <aside className={`blink-widget ${enabled ? "blink-widget-enabled" : ""} ${blinkPulse ? "blink-widget-pulse" : ""}`} aria-label="Blink controls">
      <div className="blink-widget-heading">
        <span className="blink-live-dot" />
        <span>BLINK CONTROL</span>
        <span className="blink-widget-count">{blinkCount} BLINKS</span>
      </div>
      {/* Keep the video playing for detection, but do not render a camera preview. */}
      <video ref={videoRef} className="blink-camera-video-hidden" autoPlay muted playsInline />
      {enabled && status === "loading" && (
        <div className="blink-event-status"><LoaderCircle size={12} className="blink-spinner" /> {loadingStage}</div>
      )}
      {enabled && status === "error" && (
        <div className="blink-event-status blink-camera-error"><CameraOff size={12} /> {error}</div>
      )}
      {enabled && status === "ready" && (
        <div className="blink-event-status">
          <span className="blink-status-dot" /> Detection active
          {blinkNotice && <strong className="blink-detected-notice"><Eye size={12} /> {blinkNotice}</strong>}
        </div>
      )}
      <div className="blink-widget-footer">
        <div className="blink-widget-copy">
          <strong>{statusLabel}</strong>
          <span>{status === "error" ? "Check camera permissions" : enabled ? "Blink to jump" : "Detect blinks without preview"}</span>
        </div>
        <button type="button" className={`blink-toggle ${enabled ? "blink-toggle-on" : ""}`} onClick={toggleEnabled}>
          {enabled ? <><EyeOff size={14} /> Turn off</> : <><Camera size={14} /> Enable</>}
        </button>
      </div>
    </aside>
  );
}
