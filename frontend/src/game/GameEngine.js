import { GAME } from "./constants.js";
import { intersects } from "./Physics.js";
import { createPlayer, drawPlayer, jumpPlayer, updatePlayer } from "./Player.js";
import { createObstacle, drawObstacle, updateObstacles } from "./Obstacles.js";
import { drawBackground } from "./Background.js";

export function createGame(canvas, callbacks = {}) {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D context is unavailable.");
  let frame = 0, previousTime = 0, elapsed = 0, score = 0, speed = GAME.initialSpeed, spawnIn = 1.05;
  let state = "ready", destroyed = false, player = createPlayer(), obstacles = [], lastScoreNotice = -1;
  const setState = (next) => { state = next; callbacks.onStatusChange?.(next); };
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = GAME.width * dpr; canvas.height = GAME.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false; render();
  }
  function reset() {
    elapsed = 0; score = 0; speed = GAME.initialSpeed; spawnIn = .9;
    player = createPlayer(); obstacles = []; previousTime = 0; lastScoreNotice = -1; callbacks.onScoreChange?.(0);
  }
  function start() {
    if (destroyed || state === "playing") return;
    if (state === "paused") { setState("playing"); previousTime = 0; return; }
    reset(); setState("playing"); previousTime = 0; canvas.focus({ preventScroll: true });
  }
  function restart() {
    if (destroyed) return;
    reset(); setState("playing"); previousTime = 0; canvas.focus({ preventScroll: true });
  }
  function jump() {
    if (state === "ready") { start(); jumpPlayer(player); return; }
    if (state === "over") { restart(); return; }
    if (state === "playing") jumpPlayer(player);
  }
  function togglePause() {
    if (state === "playing") setState("paused");
    else if (state === "paused") { setState("playing"); previousTime = 0; }
  }
  function onKeyDown(event) {
    if (event.repeat && ["Space", "ArrowUp"].includes(event.code)) return;
    if (["Space", "ArrowUp", "KeyW"].includes(event.code)) { event.preventDefault(); jump(); }
    else if (event.code === "Escape" || event.code === "KeyP") { event.preventDefault(); togglePause(); }
    else if (event.code === "KeyR") { event.preventDefault(); restart(); }
  }
  function onVisibilityChange() { if (document.hidden && state === "playing") setState("paused"); }
  function render() {
    if (destroyed) return;
    drawBackground(ctx, elapsed, speed);
    for (const obstacle of obstacles) drawObstacle(ctx, obstacle);
    drawPlayer(ctx, player, elapsed, !player.grounded);
    if (state === "paused") { ctx.fillStyle = "rgba(44, 70, 56, .10)"; ctx.fillRect(0, 0, GAME.width, GAME.height); }
  }
  function tick(timestamp) {
    if (destroyed) return;
    if (!previousTime) previousTime = timestamp;
    const dt = Math.min((timestamp - previousTime) / 1000, .032);
    previousTime = timestamp;
    if (state === "playing") {
      elapsed += dt;
      speed = Math.min(GAME.maxSpeed, GAME.initialSpeed + elapsed * GAME.speedRamp * 8);
      updatePlayer(player, dt, true);
      obstacles = updateObstacles(obstacles, dt, speed);
      spawnIn -= dt;
      if (spawnIn <= 0) {
        obstacles.push(createObstacle(GAME.width + 12));
        const difficulty = Math.min(1, elapsed / 90);
        spawnIn = (GAME.minSpawnGap + Math.random() * (GAME.maxSpawnGap - GAME.minSpawnGap)) / speed + .32 + (1 - difficulty) * .26;
      }
      const playerHitbox = { x: player.x + 7, y: player.y + 5, width: player.width - 13, height: player.height - 7 };
      const hit = obstacles.some((o) => intersects(playerHitbox, { x: o.x + 3, y: o.y + 3, width: o.width - 6, height: o.height - 3 }));
      score = Math.floor((elapsed * speed / GAME.pixelsPerMeter) / 10);
      if (score !== lastScoreNotice) { callbacks.onScoreChange?.(score); lastScoreNotice = score; }
      if (hit) setState("over");
    }
    render(); frame = window.requestAnimationFrame(tick);
  }
  canvas.addEventListener("keydown", onKeyDown);
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas(); frame = window.requestAnimationFrame(tick);
  return {
    start, jump, restart, togglePause,
    destroy() {
      destroyed = true; window.cancelAnimationFrame(frame);
      canvas.removeEventListener("keydown", onKeyDown); window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibilityChange); window.removeEventListener("resize", resizeCanvas);
    },
  };
}