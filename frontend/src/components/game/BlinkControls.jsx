import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Eye, EyeOff, LoaderCircle } from "lucide-react";

const FRAME_INTERVAL_MS = 100;

export default function BlinkControls({ onBlink }) {
  const videoRef = useRef(null);
  const workerRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const onBlinkRef = useRef(onBlink);
  const frameBusyRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const lastFrameAtRef = useRef(0);

  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [loadingStage, setLoadingStage] = useState("Waiting for camera…");
  const [blinkCount, setBlinkCount] = useState(0);
  const [blinkPulse, setBlinkPulse] = useState(false);
  const [blinkNotice, setBlinkNotice] = useState("");
  const [metrics, setMetrics] = useState({ faceFound: false, ear: null, baseline: null, calibration: 0, calibrationRequired: 24, backend: "" });

  useEffect(() => {
    onBlinkRef.current = onBlink;
  }, [onBlink]);

  const reportBlink = () => {
    setBlinkCount((count) => count + 1);
    setBlinkNotice("Blink detected");
    setBlinkPulse(true);
    onBlinkRef.current?.();
    window.setTimeout(() => setBlinkPulse(false), 350);
    window.setTimeout(() => setBlinkNotice(""), 1200);
  };

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const stopResources = () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const worker = workerRef.current;
      workerRef.current = null;
      if (worker) {
        worker.postMessage({ type: "STOP" });
        worker.terminate();
      }
      frameBusyRef.current = false;
    };

    async function start() {
      try {
        setStatus("loading");
        setLoadingStage("Requesting camera…");
        setError("");
        setMetrics({ faceFound: false, ear: null, baseline: null, calibration: 0, calibrationRequired: 24, backend: "" });

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access requires HTTPS or localhost.");
        }

        const isMobile = window.matchMedia("(max-width: 650px)").matches;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: isMobile ? 320 : 480 },
            height: { ideal: isMobile ? 240 : 360 },
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
        if (!video) throw new Error("Camera preview element is unavailable.");
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;

        setLoadingStage("Starting face-api.js worker…");
        const worker = new Worker(
          new URL("../../workers/blinkDetection.worker.js", import.meta.url),
          { type: "module", name: "road-runner-face-blink" }
        );
        workerRef.current = worker;

        worker.onmessage = (event) => {
          if (cancelled || workerRef.current !== worker) return;
          const message = event.data;
          switch (message?.type) {
            case "STATUS":
              console.info("[BlinkControls] Worker status:", message.status);
              setLoadingStage(message.status || "Loading face models…");
              break;
            case "READY":
              console.info("[BlinkControls] Worker ready:", { backend: message.backend });
              setStatus("ready");
              setLoadingStage("Detection active");
              setMetrics((current) => ({ ...current, backend: message.backend || "" }));
              break;
            case "METRICS":
              setMetrics((current) => ({ ...current, ...message }));
              break;
            case "BLINK_DETECTED":
              reportBlink();
              break;
            case "FRAME_DONE":
              frameBusyRef.current = false;
              break;
            case "FRAME_ERROR":
              console.warn("[BlinkControls] Worker frame error:", message.message);
              break;
            case "ERROR":
              console.error("[BlinkControls] Worker initialization failed:", {
                stage: message.stage,
                name: message.name,
                message: message.message,
                stack: message.stack,
              });
              setError(`Worker failed at ${message.stage || "unknown stage"}: ${message.message || "face-api.js could not initialize."}`);
              setStatus("error");
              stopResources();
              break;
            default:
              break;
          }
        };

        worker.onerror = (event) => {
          const detail =
            event?.message ||
            event?.error?.message ||
            "The browser could not load the worker module or one of its dependencies.";
          console.error("[BlinkControls] Worker crashed:", {
            message: detail,
            filename: event?.filename || "(unknown worker file)",
            line: event?.lineno ?? "(unknown line)",
            error: event?.error || null,
          });
          event?.preventDefault?.();
          if (!cancelled) {
            setError(`Blink worker failed: ${detail}`);
            setStatus("error");
            stopResources();
          }
        };

        worker.postMessage({ type: "INIT" });

        const sampleFrames = async () => {
          if (cancelled) return;
          const currentVideo = videoRef.current;
          const now = performance.now();

          if (
            workerRef.current === worker &&
            !frameBusyRef.current &&
            currentVideo &&
            currentVideo.readyState >= 2 &&
            currentVideo.currentTime !== lastVideoTimeRef.current &&
            now - lastFrameAtRef.current >= FRAME_INTERVAL_MS
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
            } catch (frameError) {
              frameBusyRef.current = false;
              console.warn("[BlinkControls] Could not copy camera frame:", frameError);
            }
          }

          if (!cancelled) frameRef.current = requestAnimationFrame(sampleFrames);
        };

        frameRef.current = requestAnimationFrame(sampleFrames);
      } catch (err) {
        console.error("[BlinkControls] Could not start blink control:", err);
        if (!cancelled) {
          setError(
            err?.name === "NotAllowedError"
              ? "Camera permission was denied. Allow camera access and try again."
              : err?.message || "Could not start blink control."
          );
          setStatus("error");
          stopResources();
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      stopResources();
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

  const statusLabel =
    status === "loading" ? "STARTING BLINK DETECTION" :
    status === "ready" ? "BLINK DETECTION ACTIVE" :
    status === "error" ? "CAMERA NEEDS ATTENTION" : "HANDS-FREE MODE";

  const calibrationComplete = metrics.calibration >= (metrics.calibrationRequired || 24);

  return (
    <aside className={`blink-widget ${enabled ? "blink-widget-enabled" : ""} ${blinkPulse ? "blink-widget-pulse" : ""}`} aria-label="Blink controls">
      <div className="blink-widget-heading">
        <span className="blink-live-dot" />
        <span>BLINK CONTROL</span>
        <span className="blink-widget-count">{blinkCount} BLINKS</span>
      </div>
      <video ref={videoRef} className="blink-camera-video-hidden" autoPlay muted playsInline />
      {enabled && status === "loading" && (
        <div className="blink-event-status"><LoaderCircle size={12} className="blink-spinner" /> {loadingStage}</div>
      )}
      {enabled && status === "error" && (
        <div className="blink-event-status blink-camera-error"><CameraOff size={12} /> {error}</div>
      )}
      {enabled && status === "ready" && (
        <div className="blink-event-status">
          <span className="blink-status-dot" />
          {metrics.faceFound ? (calibrationComplete ? "Face tracked · blink to jump" : `Calibrating eyes ${metrics.calibration || 0}/${metrics.calibrationRequired || 24}`) : "Looking for your face…"}
          {metrics.ear != null && (
            <span style={{ fontSize: 10, opacity: 0.72 }}>
              EAR {metrics.ear} / {metrics.baseline ?? "—"} {metrics.backend ? `· ${metrics.backend}` : ""}
            </span>
          )}
          {blinkNotice && <strong className="blink-detected-notice"><Eye size={12} /> {blinkNotice}</strong>}
        </div>
      )}
      <div className="blink-widget-footer">
        <div className="blink-widget-copy">
          <strong>{statusLabel}</strong>
          <span>{status === "error" ? "Check camera permissions and console" : enabled ? "Look at the camera, then blink" : "Runs face tracking in a background worker"}</span>
        </div>
        <button type="button" className={`blink-toggle ${enabled ? "blink-toggle-on" : ""}`} onClick={toggleEnabled}>
          {enabled ? <><EyeOff size={14} /> Turn off</> : <><Camera size={14} /> Enable</>}
        </button>
      </div>
    </aside>
  );
}
