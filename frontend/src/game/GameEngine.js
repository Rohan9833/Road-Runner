import { GAME } from "./constants.js";
import { intersects } from "./Physics.js";
import { createPlayer, drawPlayer, jumpPlayer, updatePlayer } from "./Player.js";
import { createObstacle, drawObstacle, updateObstacles } from "./Obstacles.js";
import { drawBackground } from "./Background.js";

const POWER_PUFF_URL = "/febutaz.png";
const POWER_PUFF_WIDTH = 100;
const POWER_PUFF_HEIGHT = 50;
const IMMUNITY_SECONDS = 10;
// Queue a blink that arrives shortly before landing, then jump on the first grounded frame.
const JUMP_BUFFER_SECONDS = 0.12;

export function createGame(canvas, callbacks = {}) {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D context is unavailable.");
  const powerPuffImage = new Image();
  powerPuffImage.src = POWER_PUFF_URL;

  let frame = 0, previousTime = 0, elapsed = 0, score = 0, speed = GAME.initialSpeed, spawnIn = 1.05;
  let state = "ready", destroyed = false, player = createPlayer(), obstacles = [], lastScoreNotice = -1;
  let bufferedJump = false;
  let isMobile = window.matchMedia("(max-width: 650px)").matches;
  let powerPuffs = [], powerPuffSpawnIn = 7 + Math.random() * 4, immunityRemaining = 0;
  const setState = (next) => { state = next; render(); callbacks.onStatusChange?.(next); };
  const scheduleFrame = () => {
    if (!destroyed && state === "playing" && !frame) frame = window.requestAnimationFrame(tick);
  };

  function resizeCanvas() {
    // Lower backing resolution on mobile to reduce canvas fill/render cost.
    isMobile = window.matchMedia("(max-width: 650px)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 2);
    canvas.width = GAME.width * dpr; canvas.height = GAME.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false; render();
  }

  function reset() {
    elapsed = 0; score = 0; speed = GAME.initialSpeed; spawnIn = .9;
    player = createPlayer(); obstacles = []; powerPuffs = []; bufferedJump = false;
    powerPuffSpawnIn = 7 + Math.random() * 4; immunityRemaining = 0;
    previousTime = 0; lastScoreNotice = -1; callbacks.onScoreChange?.(0);
  }

  function start() {
    if (destroyed || state === "playing") return;
    if (state === "paused") { setState("playing"); previousTime = 0; scheduleFrame(); return; }
    reset(); setState("playing"); previousTime = 0; canvas.focus({ preventScroll: true }); scheduleFrame();
  }

  function restart() {
    if (destroyed) return;
    reset(); setState("playing"); previousTime = 0; canvas.focus({ preventScroll: true }); scheduleFrame();
  }

  function jump() {
    if (state === "ready") { start(); jumpPlayer(player); return; }
    if (state === "over") { restart(); return; }
    if (state !== "playing") return;

    // Jump immediately when grounded. If the blink arrives just before landing,
    // buffer it so the next jump starts on the first frame the player touches down.
    if (jumpPlayer(player)) {
      bufferedJump = false;
      return;
    }

    const floor = GAME.groundY - player.height;
    const distanceToFloor = Math.max(0, floor - player.y);
    const landingDiscriminant = player.vy * player.vy + 2 * GAME.gravity * distanceToFloor;
    const timeToLanding = (-player.vy + Math.sqrt(landingDiscriminant)) / GAME.gravity;

    if (player.vy > 0 && timeToLanding <= JUMP_BUFFER_SECONDS) {
      bufferedJump = true;
    }
  }

  function togglePause() {
    if (state === "playing") setState("paused");
    else if (state === "paused") { setState("playing"); previousTime = 0; scheduleFrame(); }
  }

  function onKeyDown(event) {
    if (event.repeat && ["Space", "ArrowUp", "KeyW"].includes(event.code)) return;
    if (["Space", "ArrowUp", "KeyW"].includes(event.code)) { event.preventDefault(); jump(); }
    else if (event.code === "Escape" || event.code === "KeyP") { event.preventDefault(); togglePause(); }
    else if (event.code === "KeyR") { event.preventDefault(); restart(); }
  }

  function onVisibilityChange() { if (document.hidden && state === "playing") setState("paused"); }

  function drawPowerPuff(powerPuff) {
    const x = Math.round(powerPuff.x);
    const y = Math.round(powerPuff.y);
    ctx.save();
    if (powerPuffImage.complete && powerPuffImage.naturalWidth > 0) {
      ctx.drawImage(
        powerPuffImage,
        x,
        y,
        POWER_PUFF_WIDTH,
        POWER_PUFF_HEIGHT
      );
    } else {
      // Keep pickups visible while the logo image is loading or unavailable.
      ctx.fillStyle = "#fffaf0";
      ctx.beginPath(); ctx.arc(x + POWER_PUFF_SIZE / 2, y + POWER_PUFF_SIZE / 2, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4a943e";
      ctx.beginPath(); ctx.arc(x + POWER_PUFF_SIZE / 2, y + POWER_PUFF_SIZE / 2, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fffaf0"; ctx.font = "bold 18px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("+", x + POWER_PUFF_SIZE / 2, y + 23);
    }
    ctx.restore();
  }

  function render() {
    if (destroyed) return;
    drawBackground(ctx, elapsed, speed, score);
    for (const obstacle of obstacles) drawObstacle(ctx, obstacle);
    for (const powerPuff of powerPuffs) drawPowerPuff(powerPuff);

    if (immunityRemaining > 0) {
      ctx.save();
      ctx.strokeStyle = "#4a943e"; ctx.lineWidth = 3;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.ellipse(player.x + player.width / 2, player.y + player.height / 2 - 8, player.width * .72, player.height * .72, 0, 0, Math.PI * 2);
      ctx.stroke(); ctx.restore();
      ctx.fillStyle = "#186049"; ctx.font = "bold 12px monospace"; ctx.textAlign = "right";
      ctx.fillText(`POWER PUFF ${Math.ceil(immunityRemaining)}s`, GAME.width - 18, 24);
    }

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
      const baseSpeed = Math.min(GAME.maxSpeed, GAME.initialSpeed + elapsed * GAME.speedRamp * 8);
      // Give mobile players a little more pace without changing desktop gameplay.
      const mobileSpeedMultiplier = isMobile ? 1.22 : 1;
      speed = baseSpeed * mobileSpeedMultiplier;
      updatePlayer(player, dt, true);
      if (bufferedJump && player.grounded) {
        bufferedJump = false;
        jumpPlayer(player);
      }
      obstacles = updateObstacles(obstacles, dt, speed);

      powerPuffSpawnIn -= dt;
      if (powerPuffSpawnIn <= 0) {
        // Pickups appear at running height so the player can collect them naturally.
        powerPuffs.push({
          x: GAME.width + 12,
          y: GAME.groundY - POWER_PUFF_HEIGHT - 7,
          width: POWER_PUFF_WIDTH,
          height: POWER_PUFF_HEIGHT
        });
        powerPuffSpawnIn = 10 + Math.random() * 13;
      }
      for (const powerPuff of powerPuffs) powerPuff.x -= speed * dt;
      powerPuffs = powerPuffs.filter((powerPuff) => powerPuff.x + powerPuff.width > -10);

      spawnIn -= dt;
      if (spawnIn <= 0) {
        obstacles.push(createObstacle(GAME.width + 12));
        const difficulty = Math.min(1, elapsed / 90);
        spawnIn = (GAME.minSpawnGap + Math.random() * (GAME.maxSpawnGap - GAME.minSpawnGap)) / speed + .32 + (1 - difficulty) * .26;
      }

      const playerHitbox = { x: player.x + 7, y: player.y + 5, width: player.width - 13, height: player.height - 7 };
      const collected = powerPuffs.some((powerPuff) => intersects(playerHitbox, {
        x: powerPuff.x + 3, y: powerPuff.y + 3, width: powerPuff.width - 6, height: powerPuff.height - 6,
      }));
      if (collected) {
        powerPuffs = powerPuffs.filter((powerPuff) => !intersects(playerHitbox, {
          x: powerPuff.x + 3, y: powerPuff.y + 3, width: powerPuff.width - 6, height: powerPuff.height - 6,
        }));
        immunityRemaining = IMMUNITY_SECONDS;
      }

      if (immunityRemaining > 0) immunityRemaining = Math.max(0, immunityRemaining - dt);
      const hit = immunityRemaining <= 0 && obstacles.some((o) => intersects(playerHitbox, {
        x: o.x + 3, y: o.y + 3, width: o.width - 6, height: o.height - 3,
      }));

      score = Math.floor((elapsed * speed / GAME.pixelsPerMeter) / 10);
      if (score !== lastScoreNotice) { callbacks.onScoreChange?.(score); lastScoreNotice = score; }
      if (hit) setState("over");
    }
    render();
    if (state === "playing") frame = window.requestAnimationFrame(tick);
    else frame = 0;
  }

  canvas.addEventListener("keydown", onKeyDown);
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  return {
    start, jump, restart, togglePause,
    destroy() {
      destroyed = true; window.cancelAnimationFrame(frame);
      canvas.removeEventListener("keydown", onKeyDown); window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibilityChange); window.removeEventListener("resize", resizeCanvas);
    },
  };
}
