import { GAME } from "./constants.js";

const SPRITE_URL = "/player.png";

// These are the measured bounds of each character in the top row of player.png.
// The source image has a checkerboard background baked into the pixels.
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

// Every pose is stored and drawn in the same-size canvas. This is the key fix:
// the last pose can no longer change the destination dimensions or suddenly grow.
const FRAME_CANVAS_WIDTH = 105;
const FRAME_CANVAS_HEIGHT = 130;
const DRAW_WIDTH = 54;
const DRAW_HEIGHT = 66;

let spriteSheet;
let spriteLoadStarted = false;
let processedFrames = [];

function removeCheckerboard(frameCanvas) {
  // The checkerboard is part of the image, not transparency. Remove only the
  // connected light-grey/white background, keeping enclosed eye/skin highlights.
  const ctx = frameCanvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, frameCanvas.width, frameCanvas.height);
  const { data, width, height } = imageData;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const isBackground = (index) => {
    const offset = index * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    return spread < 14 && r > 185 && g > 185 && b > 185;
  };

  // Seed the flood fill from the four edges of the cropped pose.
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

  ctx.putImageData(imageData, 0, 0);
}

function prepareFrame(image, bounds) {
  const [left, top, right, bottom] = bounds;
  const cropWidth = right - left;
  const cropHeight = bottom - top;

  // First crop only this character, never a neighboring pose.
  const crop = document.createElement("canvas");
  crop.width = cropWidth;
  crop.height = cropHeight;
  const cropCtx = crop.getContext("2d", { willReadFrequently: true });
  cropCtx.imageSmoothingEnabled = false;
  cropCtx.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  removeCheckerboard(crop);

  // Place each cropped character into an identical frame canvas, centered and
  // bottom-aligned. That gives all animation frames the same origin and size.
  const frame = document.createElement("canvas");
  frame.width = FRAME_CANVAS_WIDTH;
  frame.height = FRAME_CANVAS_HEIGHT;
  const frameCtx = frame.getContext("2d");
  frameCtx.imageSmoothingEnabled = false;

  const scale = Math.min(
    (FRAME_CANVAS_WIDTH - 8) / cropWidth,
    (FRAME_CANVAS_HEIGHT - 6) / cropHeight,
  );
  const width = cropWidth * scale;
  const height = cropHeight * scale;
  const x = (FRAME_CANVAS_WIDTH - width) / 2;
  const y = FRAME_CANVAS_HEIGHT - height;

  frameCtx.drawImage(crop, x, y, width, height);
  return frame;
}

function getSpriteSheet() {
  if (spriteLoadStarted) return spriteSheet;
  spriteLoadStarted = true;

  spriteSheet = new Image();
  spriteSheet.onload = () => {
    // Preprocess once after loading; the game loop only selects a cached frame.
    processedFrames = RUN_FRAME_BOUNDS.map((bounds) =>
      prepareFrame(spriteSheet, bounds),
    );
  };
  spriteSheet.onerror = () => {
    console.error("Could not load /player.png. Put it in frontend/public/player.png.");
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
  // Keep animation timing separate from the physics update.
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
  getSpriteSheet();

  // The frame index wraps from 7 to 0, so running continues indefinitely.
  const frameIndex = jumping
    ? 3
    : Math.floor(elapsed / FRAME_DURATION) % RUN_FRAME_BOUNDS.length;
  const frame = processedFrames[frameIndex];

  ctx.save();

  // Shadow stays on the road while the character rises during a jump.
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
    // Every frame uses exactly this destination size, preventing size popping.
    // Position uses player.y, so the image follows the physics during a jump.
    const drawX = Math.round(player.x + player.width / 2 - DRAW_WIDTH / 2);
    const drawY = Math.round(player.y + player.height - DRAW_HEIGHT);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, drawX, drawY, DRAW_WIDTH, DRAW_HEIGHT);
  } else if (!spriteSheet?.complete || spriteSheet.naturalWidth === 0) {
    // Fallback shown only while the PNG is loading or if its path is incorrect.
    ctx.fillStyle = "#df6846";
    ctx.fillRect(player.x + 4, player.y + 7, player.width - 8, player.height - 7);
    ctx.fillStyle = "#2d4939";
    ctx.fillRect(player.x + 3, player.y + 18, player.width - 6, player.height - 20);
    ctx.fillStyle = "#f2c48e";
    ctx.fillRect(player.x + 10, player.y, player.width - 14, 16);
  }

  ctx.restore();
}