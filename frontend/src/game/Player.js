import { GAME } from "./constants.js";

const SPRITE_URL = "/player.png";

// The supplied sheet is 840 x 859. The poses are NOT evenly centered in
// 105px cells, so equal-width crops cut off some poses and include neighbors.
// These are measured bounds for the eight characters in the top running row.
// Format: [left, top, right, bottom] in source-image pixels.
const RUN_FRAME_BOUNDS = [
  [25, 300, 104, 422],
  [123, 300, 211, 422],
  [222, 300, 319, 422],
  [331, 300, 421, 422],
  [432, 300, 521, 422],
  [535, 300, 624, 422],
  [635, 300, 739, 422],
  [744, 300, 839, 422],
];

const FRAME_DURATION = 0.09;

// All poses share one fixed drawing box. The player hitbox remains independent.
const DRAW_WIDTH = 54;
const DRAW_HEIGHT = 62;

let spriteSheet;
let spriteLoadStarted = false;
let processedFrames = [];

/**
 * Remove the checkerboard background from a frame.
 * The uploaded sprite has a checker pattern baked into the pixels, not alpha.
 * Only near-neutral light pixels are removed; colored outlines and clothes stay.
 */
function removeCheckerboard(frameCanvas) {
  const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
  const imageData = frameCtx.getImageData(0, 0, frameCanvas.width, frameCanvas.height);
  const pixels = imageData.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);

    // Both checker colors are bright grey/white. Avoid removing darker outlines.
    if (spread < 12 && red > 218 && green > 218 && blue > 218) {
      pixels[i + 3] = 0;
    }
  }

  frameCtx.putImageData(imageData, 0, 0);
}

/** Crop a single measured pose, remove its checkerboard, and cache it. */
function prepareFrame(image, bounds) {
  const [left, top, right, bottom] = bounds;
  const width = right - left;
  const height = bottom - top;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const frameCtx = canvas.getContext("2d", { willReadFrequently: true });
  frameCtx.imageSmoothingEnabled = false;
  frameCtx.drawImage(image, left, top, width, height, 0, 0, width, height);
  removeCheckerboard(canvas);

  return { image: canvas, width, height };
}

function getSpriteSheet() {
  if (spriteLoadStarted) return spriteSheet;
  spriteLoadStarted = true;

  spriteSheet = new Image();
  spriteSheet.onload = () => {
    // Process once after loading; never create canvases during animation frames.
    processedFrames = RUN_FRAME_BOUNDS.map((bounds) =>
      prepareFrame(spriteSheet, bounds),
    );
  };
  spriteSheet.onerror = () => {
    console.error("Could not load /player.png. Place it in frontend/public/player.png.");
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
  // Advance the animation clock only while the run is active.
  if (running) player.runTime += dt;

  // Physics is independent of sprite rendering.
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
  getSpriteSheet();

  // Modulo makes the animation loop forever: 0, 1, 2 ... 7, 0, 1 ...
  const frameIndex = jumping
    ? 3
    : Math.floor(elapsed / FRAME_DURATION) % RUN_FRAME_BOUNDS.length;
  const frame = processedFrames[frameIndex];

  ctx.save();

  // A small ground shadow helps communicate jumping height.
  ctx.fillStyle = "#2c4638";
  ctx.globalAlpha = jumping ? 0.10 : 0.18;
  ctx.beginPath();
  ctx.ellipse(
    player.x + player.width / 2,
    GAME.groundY + 2,
    jumping ? 10 : 14,
    3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.globalAlpha = 1;

  if (frame) {
    // Keep the original proportions and use the same maximum dimensions for
    // every pose. This prevents the last frame from suddenly appearing larger.
    const scale = Math.min(DRAW_WIDTH / frame.width, DRAW_HEIGHT / frame.height);
    const drawWidth = frame.width * scale;
    const drawHeight = frame.height * scale;
    const drawX = player.x + player.width / 2 - drawWidth / 2;
    const drawY = GAME.groundY - drawHeight;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      frame.image,
      Math.round(drawX),
      Math.round(drawY),
      Math.round(drawWidth),
      Math.round(drawHeight),
    );
  } else if (!spriteSheet?.complete || spriteSheet.naturalWidth === 0) {
    // Fallback used only before the image loads or if the asset is missing.
    ctx.fillStyle = "#df6846";
    ctx.fillRect(player.x + 4, player.y + 7, player.width - 8, player.height - 7);
    ctx.fillStyle = "#2d4939";
    ctx.fillRect(player.x + 3, player.y + 18, player.width - 6, player.height - 20);
    ctx.fillStyle = "#f2c48e";
    ctx.fillRect(player.x + 10, player.y, player.width - 14, 16);
  }

  ctx.restore();
}