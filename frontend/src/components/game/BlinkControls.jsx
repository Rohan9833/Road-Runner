import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Eye, EyeOff, LoaderCircle } from "lucide-react";

// Camera sampling stays lightweight; MediaPipe inference runs in the worker.
const DETECTION_INTERVAL_MS = 45;

export default function BlinkControls({ onBlink }) {
  const videoRef = useRef(null);
  const workerRef = useRef(null);
  const workerReadyRef = useRef(false);
  const frameBusyRef = useRef(false);
  const frameRef = useRef(null);
  const streamRef = useRef(null);
  const onBlinkRef = useRef(onBlink);
  const lastVideoTimeRef = useRef(-1);
  const lastDetectionTimeRef = useRef(0);
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
      workerRef.current?.postMessage({ type: "STOP" });
      workerRef.current?.terminate();
      workerRef.current = null;
      workerReadyRef.current = false;
      frameBusyRef.current = false;
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
            // Keep the established camera resolution so blink scores remain reliable.
            width: { ideal: isMobile ? 160 : 480 },
            height: { ideal: isMobile ? 120 : 360 },
            frameRate: { ideal: isMobile ? 15 : 24, max: isMobile ? 20 : 30 },
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

        setLoadingStage("Starting background blink detection…");
        console.info("[BlinkControls] Camera stream ready", {
          width: video.videoWidth,
          height: video.videoHeight,
          currentTime: video.currentTime,
          readyState: video.readyState,
          tracks: stream.getVideoTracks().map((track) => ({
            label: track.label,
            readyState: track.readyState,
            settings: track.getSettings?.(),
          })),
        });
        const workerUrl = "/blinkDetection.worker.js?v=multisignal-fast-20261021-2";
        console.info("[BlinkControls] Creating multi-signal MediaPipe worker", {
          workerUrl,
          mediaPipePackageVersion: "1.1.1",
          wasmUrl: "/mediapipe/wasm",
          detectionIntervalMs: DETECTION_INTERVAL_MS,
        });
        const worker = new Worker(workerUrl);
        workerRef.current = worker;
        console.info("[BlinkControls] Classic worker created", { type: "classic" });
        worker.onmessage = (event) => {
          if (cancelled || workerRef.current !== worker) return;
          const message = event.data;
          if (message?.type !== "FRAME_DONE") {
            console.info("[BlinkControls] Worker message", message);
          }
          if (message?.type === "READY") {
            workerReadyRef.current = true;
            lastVideoTimeRef.current = -1;
            lastDetectionTimeRef.current = 0;
            frameBusyRef.current = false;
            setStatus("ready");
          } else if (message?.type === "BLINK_DETECTED") {
            reportBlink();
          } else if (message?.type === "FRAME_DONE") {
            frameBusyRef.current = false;
          } else if (message?.type === "FRAME_ERROR") {
            console.error("[BlinkControls] Worker frame processing failed", message);
          } else if (message?.type === "ERROR") {
            console.error("[BlinkControls] Worker initialization reported an error", message);
            setError(
              `Worker init failed at ${message.stage || "unknown stage"}: ${message.message || "Unknown MediaPipe error"}`
            );
            setStatus("error");
            stopCamera();
          }
        };
        worker.onerror = (event) => {
          console.error("[BlinkControls] Worker runtime error", {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            event,
          });
          if (!cancelled) {
            setError("Background blink detection failed to start. Please try again.");
            setStatus("error");
            stopCamera();
          }
        };
        worker.onmessageerror = (event) => {
          console.error("[BlinkControls] Worker message deserialization error", event);
        };
        console.info("[BlinkControls] Sending INIT to worker");
        worker.postMessage({ type: "INIT" });

        const detect = async () => {
          if (cancelled) return;
          const currentVideo = videoRef.current;
          const now = performance.now();
          if (
            workerReadyRef.current &&
            !frameBusyRef.current &&
            currentVideo &&
            currentVideo.readyState >= 2 &&
            currentVideo.currentTime !== lastVideoTimeRef.current &&
            now - lastDetectionTimeRef.current >= DETECTION_INTERVAL_MS
          ) {
            lastVideoTimeRef.current = currentVideo.currentTime;
            lastDetectionTimeRef.current = now;
            frameBusyRef.current = true;
            try {
              const bitmap = await createImageBitmap(currentVideo);
              if (cancelled || workerRef.current !== worker) {
                bitmap.close();
                frameBusyRef.current = false;
              } else {
                worker.postMessage({ type: "FRAME", bitmap, timestamp: now }, [bitmap]);
              }
            } catch (frameError) {
              frameBusyRef.current = false;
              console.warn("Could not copy camera frame for blink detection:", frameError);
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
