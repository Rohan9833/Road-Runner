import { GAME } from "./constants.js";

const SPRITE_URL = "/player.png";
const FRAME_COUNT = 8;
const FRAME_WIDTH = 105;
const FRAME_HEIGHT = 150;
// The supplied sheet has two horizontal rows of eight running poses.
// Crop around the visible character art instead of including the large empty margins.
const ROW_TOPS = [280, 420];

let spriteSheet;
let spriteLoadStarted = false;

function getSpriteSheet() {
  if (spriteLoadStarted) return spriteSheet;
  spriteLoadStarted = true;
  if (typeof Image === "undefined") return undefined;

  spriteSheet = new Image();
  spriteSheet.onload = () => {};
  spriteSheet.onerror = () => {
    console.error("Could not load /player.png. Put the sprite sheet in frontend/public/player.png.");
  };
  spriteSheet.src = SPRITE_URL;
  return spriteSheet;
}

export function createPlayer() {
  getSpriteSheet();
  return {
    x: GAME.playerX,
    y: GAME.groundY - GAME.playerHeight,
    width: GAME.playerWidth,
    height: GAME.playerHeight,
    vy: 0,
    grounded: true,
    runTime: 0,
  };
}

export function updatePlayer(player, dt, running) {
  if (running) player.runTime += dt;

  if (!player.grounded) {
    player.vy += GAME.gravity * dt;
    player.y += player.vy * dt;
    const floor = GAME.groundY - player.height;
    if (player.y >= floor) {
      player.y = floor;
      player.vy = 0;
      player.grounded = true;
    }
  }
}

export function jumpPlayer(player) {
  if (!player.grounded) return false;
  player.vy = GAME.jumpVelocity;
  player.grounded = false;
  return true;
}

export function drawPlayer(ctx, player, elapsed, jumping) {
  const sheet = getSpriteSheet();
  const frame = jumping ? 5 : Math.floor(elapsed * 11) % FRAME_COUNT;
  const row = 0;
  const sourceX = frame * FRAME_WIDTH;
  const sourceY = ROW_TOPS[row];

  ctx.save();

  // A soft ground shadow keeps the runner grounded without drawing a replacement character.
  ctx.fillStyle = "#2c4638";
  ctx.globalAlpha = jumping ? 0.10 : 0.18;
  ctx.beginPath();
  ctx.ellipse(
    player.x + player.width * 0.52,
    GAME.groundY + 2,
    player.width * (jumping ? 0.30 : 0.43),
    3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.globalAlpha = 1;

  if (sheet?.complete && sheet.naturalWidth > 0) {
    // Each pose occupies one 105px-wide cell. Crop to the artwork band in the source row.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sheet,
      sourceX,
      sourceY,
      FRAME_WIDTH,
      FRAME_HEIGHT,
      Math.round(player.x - 7),
      Math.round(player.y - 14),
      player.width + 15,
      player.height + 18,
    );
  } else {
    // Keep the game playable while the image loads or if the asset path is incorrect.
    ctx.fillStyle = "#df6846";
    ctx.fillRect(player.x + 4, player.y + 7, player.width - 8, player.height - 7);
    ctx.fillStyle = "#2d4939";
    ctx.fillRect(player.x + 3, player.y + 18, player.width - 6, player.height - 20);
    ctx.fillStyle = "#f2c48e";
    ctx.fillRect(player.x + 10, player.y, player.width - 14, 16);
  }

  ctx.restore();
}