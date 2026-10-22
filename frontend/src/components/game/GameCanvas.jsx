import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { createGame } from "../../game/GameEngine.js";

const BEST_KEY = "road-runner-best-v1";
function readBest() {
  try { return Number(window.localStorage.getItem(BEST_KEY)) || 0; }
  catch { return 0; }
}

export default function GameCanvas({ onRegisterBlinkHandler }) {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [status, setStatus] = useState("ready");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(readBest);
  const [muted, setMuted] = useState(true);
  const gameOverBlinkCountRef = useRef(0);
  const lastGameOverBlinkAtRef = useRef(0);

  const handleStatus = useCallback((next) => setStatus(next), []);
  const handleScore = useCallback((next) => {
    setScore(next);
    setBest((current) => {
      if (next > current) {
        try { window.localStorage.setItem(BEST_KEY, String(next)); } catch { /* Storage may be disabled. */ }
        return next;
      }
      return current;
    });
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const game = createGame(canvasRef.current, { onStatusChange: handleStatus, onScoreChange: handleScore });
    gameRef.current = game;
    return () => { game.destroy(); gameRef.current = null; };
  }, [handleStatus, handleScore]);

  const start = () => gameRef.current?.start();
  const jump = () => gameRef.current?.jump();
  const togglePause = () => gameRef.current?.togglePause();
  const restart = () => gameRef.current?.restart();
  const handleBlink = useCallback(() => {
    if (status === "ready" || status === "playing") {
      gameOverBlinkCountRef.current = 0;
      gameRef.current?.jump();
      return;
    }

    if (status === "over") {
      const now = performance.now();
      // Five separate blinks within 1.2 seconds count as a restart gesture.
      if (now - lastGameOverBlinkAtRef.current > 1200) {
        gameOverBlinkCountRef.current = 0;
      }
      lastGameOverBlinkAtRef.current = now;
      gameOverBlinkCountRef.current += 1;

      if (gameOverBlinkCountRef.current >= 5) {
        gameOverBlinkCountRef.current = 0;
        lastGameOverBlinkAtRef.current = 0;
        gameRef.current?.restart();
      }
    }
  }, [status]);

  useEffect(() => {
    onRegisterBlinkHandler?.(handleBlink);
    return () => onRegisterBlinkHandler?.(null);
  }, [handleBlink, onRegisterBlinkHandler]);

  return <section className="game-shell" aria-label="Road Runner game">
    <div className="game-topbar">
      <div className="game-status"><span className={`status-dot ${status === "playing" ? "status-dot-live" : ""}`} />{status === "playing" ? "RUN IN PROGRESS" : status === "paused" ? "PAUSED" : status === "over" ? "RUN ENDED" : "READY WHEN YOU ARE"}</div>
      <div className="game-stats"><div className="stat"><span>THIS RUN</span><strong>{String(score).padStart(5, "0")}</strong></div><div className="stat"><span>BEST RUN</span><strong>{String(best).padStart(5, "0")}</strong></div></div>
    </div>
    <div className="canvas-wrap">
      <canvas ref={canvasRef} className="game-canvas" aria-label="Road Runner play area. Press space or arrow up to jump." tabIndex={0} onPointerDown={() => { if (status === "playing") jump(); }} />
      {status !== "playing" && <div className="game-overlay"><div className="overlay-card">
        <span className="overlay-kicker">{status === "over" ? "THAT'S A WRAP" : status === "paused" ? "TAKE YOUR TIME" : "READY, RUNNER?"}</span>
        <h2>{status === "over" ? "Oof. One more?" : status === "paused" ? "Catch your breath." : "Let's hit the road."}</h2>
        <p>{status === "over" ? `You ran ${score} meters. Your best is ${best}.` : status === "paused" ? "The road can wait a second." : "Jump clean, keep your rhythm, chase the horizon."}</p>
        <button className="button button-primary overlay-button" onClick={status === "paused" ? togglePause : status === "over" ? restart : start}>
          {status === "over" ? <><RotateCcw size={17} /> Run it back</> : status === "paused" ? <><Play size={17} /> Resume run</> : <><Play size={17} fill="currentColor" /> Start running</>}
        </button>
        {status === "ready" && <span className="overlay-hint">PRESS SPACE OR TAP TO JUMP</span>}
      </div></div>}
    </div>
    <div className="game-controls">
      <div className="controls-copy"><span className="controls-label">CONTROLS</span><span><kbd>SPACE</kbd> / <kbd>↑</kbd> jump <span className="control-divider">·</span> <kbd>ESC</kbd> pause</span></div>
      <div className="control-buttons">
        <button className="icon-button" type="button" onClick={togglePause} aria-label={status === "paused" ? "Resume game" : "Pause game"} title="Pause / resume"><Pause size={17} /></button>
        <button className="icon-button" type="button" onClick={restart} aria-label="Restart game" title="Restart"><RotateCcw size={17} /></button>
        <button className="icon-button" type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Sound effects off" : "Sound effects planned for a later update"} title="Sound effects will be added in a later milestone">{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
      </div>
    </div>
    <div className="mobile-hint"><span><ArrowLeft size={14} /> TAP THE GAME TO JUMP <ArrowRight size={14} /></span></div>
  </section>;
}