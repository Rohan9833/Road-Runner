import { GAME } from "./constants.js";

// Vite serves files in frontend/public at the site root.
const SPRITE_URL = "/player.png";

// Use the original, evenly-spaced sprite-sheet cells instead of hand-guessed
// crop rectangles. The sheet is 840 x 840 and has 8 frames across each row.
const FRAME_COUNT = 8;
const CELL_WIDTH = 105;
const CELL_HEIGHT = 150;
const RUN_ROW_Y = 280;

// Draw every cropped pose inside the same visual box. The physics hitbox remains
// controlled by GAME.playerWidth / GAME.playerHeight in constants.js.
const DRAW_WIDTH = 58;
const DRAW_HEIGHT = 76;
const FRAME_DURATION = 0.085;

let spriteSheet;
let spriteLoadStarted = false;
let processedFrames = [];

/**
 * Remove only checkerboard pixels connected to a frame's outside edge.
 *
 * Do NOT remove every white/grey pixel: that also deletes the runner's eyes,
 * skin highlights and clothing. Flood-fill from the edges removes the background
 * while preserving similar-colored pixels enclosed inside the character.
 */
function removeConnectedCheckerboard(frameCanvas) {
  const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
  const imageData = frameCtx.getImageData(0, 0, frameCanvas.width, frameCanvas.height);
  const { data, width, height } = imageData;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  // Checkerboard squares are near-neutral light grey or white.
  const isBackground = (pixelIndex) => {
    const offset = pixelIndex * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    return spread < 14 && red > 185 && green > 185 && blue > 185;
  };

  // Seed the flood-fill with pixels around all four edges of this frame.
  const addPixel = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const index = y * width + x;
    if (visited[index] || !isBackground(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    addPixel(x, 0);
    addPixel(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    addPixel(0, y);
    addPixel(width - 1, y);
  }

  // Walk only through connected background pixels; interior white details stay.
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    data[index * 4 + 3] = 0;
    addPixel(x - 1, y);
    addPixel(x + 1, y);
    addPixel(x, y - 1);
    addPixel(x, y + 1);
  }

  frameCtx.putImageData(imageData, 0, 0);
}

/** Crop one original sprite-sheet cell and trim its transparent margins. */
function prepareFrame(image, frameIndex) {
  const cell = document.createElement("canvas");
  cell.width = CELL_WIDTH;
  cell.height = CELL_HEIGHT;

  const cellCtx = cell.getContext("2d", { willReadFrequently: true });
  cellCtx.imageSmoothingEnabled = false;
  cellCtx.drawImage(
    image,
    frameIndex * CELL_WIDTH,
    RUN_ROW_Y,
    CELL_WIDTH,
    CELL_HEIGHT,
    0,
    0,
    CELL_WIDTH,
    CELL_HEIGHT,
  );

  removeConnectedCheckerboard(cell);

  // Find the actual visible pixels so each pose can be aligned consistently.
  const pixels = cellCtx.getImageData(0, 0, CELL_WIDTH, CELL_HEIGHT).data;
  let minX = CELL_WIDTH;
  let minY = CELL_HEIGHT;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    for (let x = 0; x < CELL_WIDTH; x += 1) {
      const alpha = pixels[(y * CELL_WIDTH + x) * 4 + 3];
      if (alpha === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  // If a crop unexpectedly contains no visible pixels, keep the whole cell.
  if (maxX < minX || maxY < minY) {
    return { image: cell, width: CELL_WIDTH, height: CELL_HEIGHT };
  }

  const trimmedWidth = maxX - minX + 1;
  const trimmedHeight = maxY - minY + 1;
  const trimmed = document.createElement("canvas");
  trimmed.width = trimmedWidth;
  trimmed.height = trimmedHeight;

  const trimmedCtx = trimmed.getContext("2d");
  trimmedCtx.imageSmoothingEnabled = false;
  trimmedCtx.drawImage(
    cell,
    minX,
    minY,
    trimmedWidth,
    trimmedHeight,
    0,
    0,
    trimmedWidth,
    trimmedHeight,
  );

  return { image: trimmed, width: trimmedWidth, height: trimmedHeight };
}

function getSpriteSheet() {
  if (spriteLoadStarted) return spriteSheet;
  spriteLoadStarted = true;

  if (typeof Image === "undefined") return undefined;

  spriteSheet = new Image();
  spriteSheet.onload = () => {
    // Prepare frames once on load, not on every animation tick.
    processedFrames = Array.from({ length: FRAME_COUNT }, (_, index) =>
      prepareFrame(spriteSheet, index),
    );
  };
  spriteSheet.onerror = () => {
    console.error(
      "Could not load /player.png. Make sure it is in frontend/public/player.png.",
    );
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
  // The animation clock advances only while the game is running.
  if (running) player.runTime += dt;

  // Vertical movement uses velocity and gravity, independently of the artwork.
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
  // A jump can start only when the player is touching the ground.
  if (!player.grounded) return false;

  player.vy = GAME.jumpVelocity;
  player.grounded = false;
  return true;
}

export function drawPlayer(ctx, player, elapsed, jumping) {
  getSpriteSheet();

  // Loop through frames in their original order. Modulo wraps frame 7 to frame 0
  // and keeps the animation running continuously for as long as the game runs.
  const frameIndex = jumping
    ? 3
    : Math.floor(elapsed / FRAME_DURATION) % FRAME_COUNT;
  const frame = processedFrames[frameIndex];

  ctx.save();

  // Keep a small shadow at ground level to communicate jump height.
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

  if (frame) {
    // Fit each trimmed pose into a common box without stretching its proportions.
    const scale = Math.min(
      DRAW_WIDTH / frame.width,
      DRAW_HEIGHT / frame.height,
    );
    const drawWidth = frame.width * scale;
    const drawHeight = frame.height * scale;
    const drawX = player.x + player.width / 2 - drawWidth / 2;
    const drawY = player.y + player.height - drawHeight + 2;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      frame.image,
      Math.round(drawX),
      Math.round(drawY),
      Math.round(drawWidth),
      Math.round(drawHeight),
    );
  } else if (!spriteSheet?.complete || spriteSheet.naturalWidth === 0) {
    // Simple fallback while the sprite image is loading or missing.
    ctx.fillStyle = "#df6846";
    ctx.fillRect(player.x + 4, player.y + 7, player.width - 8, player.height - 7);
    ctx.fillStyle = "#2d4939";
    ctx.fillRect(player.x + 3, player.y + 18, player.width - 6, player.height - 20);
    ctx.fillStyle = "#f2c48e";
    ctx.fillRect(player.x + 10, player.y, player.width - 14, 16);
  }

  ctx.restore();
}