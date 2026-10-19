
import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import "./App.css";

// ---- Blink detection thresholds ----
const BLINK_CLOSED_THRESHOLD = 0.45;
const BLINK_OPEN_THRESHOLD = 0.20;
const FAST_BLINK_DELTA = 0.22;
const FAST_BLINK_MIN_PREV = 0.05;
const FAST_BLINK_MIN_PEAK = 0.42;
const JUMP_DEBOUNCE_MS = 220;

// Detection is capped to ~24 fps. Blinks last 100ms+ so this catches
// everything while roughly halving main-thread load vs. 60fps.
const DETECT_INTERVAL_MS = 1000 / 24;

const DEBUG_BLINK = false;

export default function App() {
  const videoRef = useRef(null);
  const manRef = useRef(null);
  const landmarkerRef = useRef(null);

  // Frame scheduling
  const frameCbRef = useRef(0);
  const usingRVFCRef = useRef(false);

  // Detection state
  const blinkDetectedRef = useRef(false);
  const lastDetectMsRef = useRef(0);
  const prevLeftBlinkRef = useRef(0);
  const prevRightBlinkRef = useRef(0);
  const lastJumpTimeRef = useRef(0);

  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let stream = null;
    const cleanupFns = [];

    const cancelScheduled = () => {
      if (!frameCbRef.current) return;
      const v = videoRef.current;
      if (usingRVFCRef.current && v && typeof v.cancelVideoFrameCallback === "function") {
        v.cancelVideoFrameCallback(frameCbRef.current);
      } else {
        cancelAnimationFrame(frameCbRef.current);
      }
      frameCbRef.current = 0;
    };

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks("/mediapipe-wasm");
        if (cancelled) return;

        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFaceLandmarks: false, // explicitly off — we don't need them
        });

        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 480 },
            height: { ideal: 360 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setCameraReady(true);

        // ---- trigger with debounce; restart CSS animation without
        //      React re-render / DOM remount ----
        const triggerJump = (reason) => {
          const now = performance.now();
          if (now - lastJumpTimeRef.current < JUMP_DEBOUNCE_MS) return;
          lastJumpTimeRef.current = now;

          if (DEBUG_BLINK) console.log(`JUMP (${reason})`);

          const el = manRef.current;
          if (el) {
            el.classList.remove("jump");
            void el.offsetWidth; // force reflow → animation restarts
            el.classList.add("jump");
          }
        };

        // Cache blendshape indices on first result (order is stable per model).
        let leftIdx = -1;
        let rightIdx = -1;

        const schedule = () => {
          if (cancelled) return;
          cancelScheduled();
          const v = videoRef.current;
          if (!v) return;

          if (typeof v.requestVideoFrameCallback === "function") {
            usingRVFCRef.current = true;
            frameCbRef.current = v.requestVideoFrameCallback(processFrame);
          } else {
            usingRVFCRef.current = false;
            frameCbRef.current = requestAnimationFrame(processFrame);
          }
        };

        const processFrame = () => {
          if (cancelled) return;
          if (document.hidden) {
            schedule();
            return;
          }

          const now = performance.now();
          // Throttle: don't run inference more often than DETECT_INTERVAL_MS
          if (now - lastDetectMsRef.current < DETECT_INTERVAL_MS) {
            schedule();
            return;
          }

          const detector = landmarkerRef.current;
          const v = videoRef.current;
          if (!detector || !v || v.readyState < 2) {
            schedule();
            return;
          }

          lastDetectMsRef.current = now;

          let result;
          try {
            result = detector.detectForVideo(v, now);
          } catch (err) {
            console.error("detectForVideo failed:", err);
            schedule();
            return;
          }

          const cats = result.faceBlendshapes?.[0]?.categories;
          if (cats && cats.length) {
            if (leftIdx < 0) {
              leftIdx = cats.findIndex((c) => c.categoryName === "eyeBlinkLeft");
              rightIdx = cats.findIndex((c) => c.categoryName === "eyeBlinkRight");
            }
            const leftBlink = cats[leftIdx]?.score ?? 0;
            const rightBlink = cats[rightIdx]?.score ?? 0;

            const prevL = prevLeftBlinkRef.current;
            const prevR = prevRightBlinkRef.current;

            // Path A: fast single-frame blink
            if (
              leftBlink - prevL >= FAST_BLINK_DELTA &&
              rightBlink - prevR >= FAST_BLINK_DELTA &&
              prevL < FAST_BLINK_MIN_PREV &&
              prevR < FAST_BLINK_MIN_PREV &&
              leftBlink > FAST_BLINK_MIN_PEAK &&
              rightBlink > FAST_BLINK_MIN_PEAK
            ) {
              triggerJump("fast");
              blinkDetectedRef.current = true;
            }

            // Path B: closed → reopened blink
            if (
              leftBlink > BLINK_CLOSED_THRESHOLD &&
              rightBlink > BLINK_CLOSED_THRESHOLD
            ) {
              blinkDetectedRef.current = true;
            } else if (
              blinkDetectedRef.current &&
              leftBlink < BLINK_OPEN_THRESHOLD &&
              rightBlink < BLINK_OPEN_THRESHOLD
            ) {
              blinkDetectedRef.current = false;
              triggerJump("slow");
            }

            prevLeftBlinkRef.current = leftBlink;
            prevRightBlinkRef.current = rightBlink;
          }

          schedule();
        };

        schedule();

        const onVisibility = () => {
          if (!document.hidden && !cancelled) schedule();
        };
        document.addEventListener("visibilitychange", onVisibility);
        cleanupFns.push(() =>
          document.removeEventListener("visibilitychange", onVisibility)
        );
      } catch (err) {
        console.error("Blink scanner error:", err);
        if (!cancelled) {
          setError(
            err.name === "NotAllowedError"
              ? "Camera permission denied. Allow camera access in your browser."
              : `Unable to start: ${err.message}`
          );
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      cleanupFns.forEach((fn) => fn());
      cancelScheduled();
      stream?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  return (
    <main className="blink-screen">
      <video ref={videoRef} className="camera-preview" autoPlay muted playsInline />

      <div ref={manRef} className="man-container">
        <img src="/man.png" alt="Jumping man" className="man-image" />
      </div>

      {error && <p className="camera-error">{error}</p>}
      {!cameraReady && !error && (
        <p className="camera-status">Starting camera...</p>
      )}
    </main>
  );
}