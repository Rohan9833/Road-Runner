import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Eye, EyeOff, LoaderCircle } from "lucide-react";

const DETECTION_INTERVAL_MS = 100;

export default function BlinkControls({ onBlink, gameStatus }) {
  const videoRef = useRef(null);
  const workerRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const frameBusyRef = useRef(false);
  const workerReadyRef = useRef(false);
  const onBlinkRef = useRef(onBlink);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [loadingStage, setLoadingStage] = useState("Waiting for camera…");
  const [blinkCount, setBlinkCount] = useState(0);
  const [blinkPulse, setBlinkPulse] = useState(false);
  const [blinkNotice, setBlinkNotice] = useState("");
  const [metrics, setMetrics] = useState(null);

  useEffect(() => { onBlinkRef.current = onBlink; }, [onBlink]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let lastVideoTime = -1;
    let lastDetectionTime = 0;
    let pulseTimer;
    let noticeTimer;
    let workerStartupTimer;

    const stopCamera = () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const worker = workerRef.current;
      workerRef.current = null;
      workerReadyRef.current = false;
      frameBusyRef.current = false;
      if (workerStartupTimer) window.clearTimeout(workerStartupTimer);
      workerStartupTimer = null;
      if (worker) {
        worker.postMessage({ type: "STOP" });
        worker.terminate();
      }
    };

    const reportBlink = (message) => {
      setBlinkCount((count) => count + 1);
      setBlinkNotice(`Blink detected${message.durationMs ? ` (${message.durationMs} ms)` : ""}`);
      setBlinkPulse(true);
      onBlinkRef.current?.();
      clearTimeout(pulseTimer);
      clearTimeout(noticeTimer);
      pulseTimer = window.setTimeout(() => setBlinkPulse(false), 350);
      noticeTimer = window.setTimeout(() => setBlinkNotice(""), 1400);
    };

    async function startCamera() {
      try {
        setStatus("loading");
        setLoadingStage("Requesting camera…");
        setError("");
        setMetrics(null);
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access requires HTTPS or localhost.");
        }

        const isMobile = window.matchMedia("(max-width: 650px)").matches;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: isMobile ? 320 : 640 },
            height: { ideal: isMobile ? 240 : 480 },
            frameRate: { ideal: 20, max: 24 },
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

        setLoadingStage("Loading OpenCV.js and eye classifiers…");
        // This is a classic worker because it loads standalone OpenCV.js via importScripts.
        // Serve the classic worker from /public so Vite does not inject /@vite/env
        // (which is an ES module and causes importScripts to throw in classic workers).
        const workerUrl = "/blinkDetection.worker.js?v=debug3";
        const worker = new Worker(workerUrl, {
          name: "road-runner-opencv-blink",
        });
        workerRef.current = worker;

        worker.onmessage = (event) => {
          if (cancelled || workerRef.current !== worker) return;
          const message = event.data;
          if (message?.type === "STATUS") {
            console.info("[OpenCV blink worker] Status", message);
            setLoadingStage(message.stage || "Preparing detector…");
          } else if (message?.type === "READY") {
            if (workerStartupTimer) window.clearTimeout(workerStartupTimer);
            workerStartupTimer = null;
            console.info("[OpenCV blink worker] READY", message);
            workerReadyRef.current = true;
            setStatus("ready");
            setLoadingStage("OpenCV.js ready");
          } else if (message?.type === "METRICS") {
            if (message.face === false || message.eyes !== 2 || message.blinkState) {
              console.debug("[OpenCV blink worker] Metrics", message);
            }
            setMetrics(message);
          } else if (message?.type === "BLINK_DETECTED") {
            console.info("[OpenCV blink worker] BLINK_DETECTED reached main thread", message);
            reportBlink(message);
          } else if (message?.type === "FRAME_DONE") {
            frameBusyRef.current = false;
          } else if (message?.type === "FRAME_ERROR") {
            console.warn("[OpenCV blink worker] Frame failed:", message.message);
            frameBusyRef.current = false;
          } else if (message?.type === "ERROR") {
            console.error("[OpenCV blink worker] Initialization ERROR received by UI", message);
            if (workerStartupTimer) window.clearTimeout(workerStartupTimer);
            workerStartupTimer = null;
            setError(`OpenCV setup failed: ${message.message || "Unknown error"}`);
            setStatus("error");
            stopCamera();
          }
        };
        worker.onerror = (event) => {
          console.error("[OpenCV blink worker] Runtime error details:", {
            message: event?.message || "(browser did not provide a message)",
            filename: event?.filename || "(unknown worker file)",
            lineno: event?.lineno ?? "(unknown line)",
            colno: event?.colno ?? "(unknown column)",
            errorName: event?.error?.name,
            errorMessage: event?.error?.message,
            errorStack: event?.error?.stack,
            error: event?.error || null,
          });
          if (!cancelled) {
            setError("OpenCV worker failed to start. Refresh and try again.");
            setStatus("error");
            stopCamera();
          }
        };
        console.info("[OpenCV blink worker] Worker created; sending INIT", {
          workerType: "classic",
          secureContext: window.isSecureContext,
          url: new URL(workerUrl, window.location.origin).href,
        });
        worker.postMessage({ type: "INIT" });
        workerStartupTimer = window.setTimeout(() => {
          if (cancelled || workerReadyRef.current || workerRef.current !== worker) return;
          console.error("[OpenCV blink worker] Main-thread watchdog fired", { workerUrl, loadingStage, elapsedMs: 35000 });
          setError("OpenCV did not initialize within 35 seconds. Check the Console for WASM/CDN errors and try again.");
          setStatus("error");
          stopCamera();
        }, 35000);

        const detect = async () => {
          if (cancelled) return;
          const currentVideo = videoRef.current;
          const now = performance.now();
          if (
            workerReadyRef.current &&
            !frameBusyRef.current &&
            currentVideo?.readyState >= 2 &&
            currentVideo.currentTime !== lastVideoTime &&
            now - lastDetectionTime >= DETECTION_INTERVAL_MS
          ) {
            lastVideoTime = currentVideo.currentTime;
            lastDetectionTime = now;
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
              console.warn("Could not copy camera frame:", frameError);
            }
          }
          frameRef.current = requestAnimationFrame(detect);
        };
        frameRef.current = requestAnimationFrame(detect);
      } catch (err) {
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
      clearTimeout(pulseTimer);
      clearTimeout(noticeTimer);
      stopCamera();
    };
  }, [enabled]);

  const toggleEnabled = () => {
    if (enabled) {
      setEnabled(false);
      setStatus("idle");
      setError("");
      setMetrics(null);
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
          {metrics?.face === false ? "Looking for face…" : metrics?.eyes === 2 ? "Eyes open" : metrics?.eyes === 1 ? "One eye visible" : "Tracking eyes…"}
          {metrics && !metrics.calibrated && <span> · calibrating {metrics.calibration || 0}/{metrics.calibrationTotal || 24}</span>}
          {blinkNotice && <strong className="blink-detected-notice"><Eye size={12} /> {blinkNotice}</strong>}
        </div>
      )}
      <div className="blink-widget-footer">
        <div className="blink-widget-copy">
          <strong>{statusLabel}</strong>
          <span>{status === "error" ? "Check camera permissions / connection" : enabled ? "Look toward the camera and blink" : "Jump by blinking"}</span>
        </div>
        <button type="button" className={`blink-toggle ${enabled ? "blink-toggle-on" : ""}`} onClick={toggleEnabled}>
          {enabled ? <><EyeOff size={14} /> Turn off</> : <><Camera size={14} /> Enable blink</>}
        </button>
      </div>
    </aside>
  );
}
