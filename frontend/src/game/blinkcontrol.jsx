import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import "./App.css";

// ---- Blink detection thresholds ----
const BLINK_CLOSED_THRESHOLD = 0.45;   // L/R above this = eyes closed
const BLINK_OPEN_THRESHOLD = 0.20;     // L/R below this = eyes open

// ---- Fast blink detection ----
const FAST_BLINK_DELTA = 0.22;         // jump from low to high in one frame
const FAST_BLINK_MIN_PREV = 0.05;      // previous frame must have been near-open
const FAST_BLINK_MIN_PEAK = 0.42;      // peak must reach at least this

// ---- Debounce between jumps ----
const JUMP_DEBOUNCE_MS = 220;          // prevents double-triggering a single blink

const DEBUG_BLINK = true;

function App() {
  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const blinkDetectedRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const lastDebugLogRef = useRef(0);

  // Fast-blink state
  const prevLeftBlinkRef = useRef(0);
  const prevRightBlinkRef = useRef(0);
  const lastJumpTimeRef = useRef(0);

  const [jumpCount, setJumpCount] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let stream = null;

    async function initialize() {
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
        });

        if (cancelled) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();

        if (cancelled) return;

        setCameraReady(true);

        // ---------- Trigger helper (with debounce) ----------
        const triggerJump = (reason) => {
          const now = performance.now();
          if (now - lastJumpTimeRef.current < JUMP_DEBOUNCE_MS) {
            return; // debounced
          }
          lastJumpTimeRef.current = now;
          if (DEBUG_BLINK) {
            console.log(`>>> JUMP (${reason}) <<<`);
          }
          setJumpCount((count) => count + 1);
        };

        // ---------- Detection loop ----------
        const detect = () => {
          if (cancelled) return;

          const currentVideo = videoRef.current;
          const detector = landmarkerRef.current;

          if (
            currentVideo &&
            detector &&
            currentVideo.readyState >= 2 &&
            currentVideo.currentTime !== lastVideoTimeRef.current
          ) {
            lastVideoTimeRef.current = currentVideo.currentTime;

            const result = detector.detectForVideo(
              currentVideo,
              performance.now()
            );

            const categories =
              result.faceBlendshapes?.[0]?.categories ?? [];

            const leftBlink =
              categories.find((item) => item.categoryName === "eyeBlinkLeft")
                ?.score ?? 0;

            const rightBlink =
              categories.find((item) => item.categoryName === "eyeBlinkRight")
                ?.score ?? 0;

            if (DEBUG_BLINK) {
              const now = performance.now();
              if (now - lastDebugLogRef.current > 250) {
                lastDebugLogRef.current = now;
                console.log(
                  `blink L=${leftBlink.toFixed(3)} ` +
                    `R=${rightBlink.toFixed(3)} ` +
                    `armed=${blinkDetectedRef.current}`
                );
              }
            }

            const prevL = prevLeftBlinkRef.current;
            const prevR = prevRightBlinkRef.current;

            // ---------- Path A: fast blink (single-frame spike) ----------
            // Both eyes jump from near-open to closed within one frame,
            // and the peak is high enough to be a real blink.
            const leftJumped = leftBlink - prevL >= FAST_BLINK_DELTA;
            const rightJumped = rightBlink - prevR >= FAST_BLINK_DELTA;
            const prevNearOpen =
              prevL < FAST_BLINK_MIN_PREV && prevR < FAST_BLINK_MIN_PREV;
            const peakHighEnough =
              leftBlink > FAST_BLINK_MIN_PEAK &&
              rightBlink > FAST_BLINK_MIN_PEAK;

            if (
              leftJumped &&
              rightJumped &&
              prevNearOpen &&
              peakHighEnough
            ) {
              triggerJump("fast");
              // Mark as detected so the slow path doesn't also fire
              blinkDetectedRef.current = true;
            }

            // ---------- Path B: normal blink (closed, then reopened) ----------
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

            // Save current for next frame
            prevLeftBlinkRef.current = leftBlink;
            prevRightBlinkRef.current = rightBlink;
          }

          animationFrameRef.current = requestAnimationFrame(detect);
        };

        animationFrameRef.current = requestAnimationFrame(detect);
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

    initialize();

    return () => {
      cancelled = true;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      stream?.getTracks().forEach((track) => track.stop());
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  return (
    <main className="blink-screen">
      <video
        ref={videoRef}
        className="camera-preview"
        autoPlay
        muted
        playsInline
      />

      <div
        key={jumpCount}
        className={`man-container ${jumpCount > 0 ? "jump" : ""}`}
      >
        <img src="/man.png" alt="Jumping man" className="man-image" />
      </div>

      {error && <p className="camera-error">{error}</p>}

      {!cameraReady && !error && (
        <p className="camera-status">Starting camera...</p>
      )}
    </main>
  );
}

export default App;