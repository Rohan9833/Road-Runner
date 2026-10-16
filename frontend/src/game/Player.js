import { GAME } from "./constants.js";

// Vite serves files inside frontend/public from the site root, so this loads
// frontend/public/player.png as /player.png.
const SPRITE_URL = "/player.png";

// The supplied sprite sheet is 840px wide: eight 105px animation cells.
const FRAME_COUNT = 8;
const FRAME_WIDTH = 105;

// The runner poses occupy the middle of each cell; the rest is transparent padding.
// Keep the crop inside each cell so a neighboring pose cannot appear beside the runner.
const SOURCE_X_INSET = 5;
const SOURCE_WIDTH = 95;
const SOURCE_Y = 285;
const SOURCE_HEIGHT = 145;

// Draw the character larger than its collision box. This is only visual sizing;
// the actual collision dimensions remain controlled by constants.js.
const DRAW_WIDTH = 62;
const DRAW_HEIGHT = 78;
const DRAW_X_OFFSET = 10;
const DRAW_Y_OFFSET = 22;

let spriteSheet;
let spriteLoadStarted = false;

function getSpriteSheet() {
  if (spriteLoadStarted) return spriteSheet;
  spriteLoadStarted = true;

  if (typeof Image === "undefined") return undefined;

  spriteSheet = new Image();
  spriteSheet.onload = () => {};
  spriteSheet.onerror = () => {
    console.error(
      "Road Runner could not load /player.png. Make sure it is saved in frontend/public/player.png.",
    );
  };
  spriteSheet.src = SPRITE_URL;
  return spriteSheet;
}

export function createPlayer() {
  // Start loading the sprite as soon as the game creates its player.
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
  // Track animation time only while the game is actively running.
  if (running) player.runTime += dt;

  // Simple vertical physics: gravity pulls the player back to the ground after a jump.
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
  // Prevent a second jump while the character is already in the air.
  if (!player.grounded) return false;

  player.vy = GAME.jumpVelocity;
  player.grounded = false;
  return true;
}

export function drawPlayer(ctx, player, elapsed, jumping) {
  const sheet = getSpriteSheet();

  // Each frame shows a different running pose. Use one fixed pose while jumping.
  const frame = jumping ? 5 : Math.floor(elapsed * 11) % FRAME_COUNT;
  const sourceX = frame * FRAME_WIDTH + SOURCE_X_INSET;

  ctx.save();

  // Draw a small shadow at ground level; it gets lighter while the runner jumps.
  ctx.fillStyle = "#2c4638";
  ctx.globalAlpha = jumping ? 0.10 : 0.18;
  ctx.beginPath();
  ctx.ellipse(
    player.x + player.width / 2,
    GAME.groundY + 2,
    jumping ? 10 : 15,
    3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.globalAlpha = 1;

  if (sheet?.complete && sheet.naturalWidth > 0) {
    // Crop a single pose from the sheet, then draw it at a readable game size.
    // The destination rectangle is intentionally wider/taller than the hitbox.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sheet,
      sourceX,
      SOURCE_Y,
      SOURCE_WIDTH,
      SOURCE_HEIGHT,
      Math.round(player.x - DRAW_X_OFFSET),
      Math.round(player.y - DRAW_Y_OFFSET),
      DRAW_WIDTH,
      DRAW_HEIGHT,
    );
  } else {
    // Temporary fallback while the PNG loads, or if the public asset is missing.
    ctx.fillStyle = "#df6846";
    ctx.fillRect(player.x + 4, player.y + 7, player.width - 8, player.height - 7);
    ctx.fillStyle = "#2d4939";
    ctx.fillRect(player.x + 3, player.y + 18, player.width - 6, player.height - 20);
    ctx.fillStyle = "#f2c48e";
    ctx.fillRect(player.x + 10, player.y, player.width - 14, 16);
  }

  ctx.restore();
}