import { GAME } from "./constants.js";

const SPRITE_URL = "/player.png";

// Exact bounds of the eight poses in the top row of the 840 x 859 sprite sheet.
// Cropping a full 105px cell included fragments of nearby poses.
const RUN_FRAME_BOUNDS = [
  [25, 300, 104, 422],
  [123, 300, 171, 422],
  [222, 300, 319, 422],
  [331, 300, 421, 422],
  [432, 300, 497, 422],
  [535, 300, 624, 422],
  [635, 300, 739, 422],
  [744, 300, 839, 422],
];

const FRAME_DURATION = 0.095;
// All frames use one fixed canvas and one fixed sprite scale.
const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 70;
const SPRITE_SCALE = 0.50;

let spriteSheet;
let spriteLoadStarted = false;
let processedFrames = [];

function removeConnectedCheckerboard(canvas) {
  // The checkerboard is baked into the PNG. Remove only light background pixels
  // connected to the crop edge, preserving enclosed highlights in the character.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
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
    return Math.max(r, g, b) - Math.min(r, g, b) < 16 && r > 175 && g > 175 && b > 175;
  };

  const enqueue = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const index = y * width + x;
    if (visited[index] || !isBackground(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    data[index * 4 + 3] = 0;
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }
  ctx.putImageData(imageData, 0, 0);
}

function prepareFrame(image, bounds) {
  const [left, top, right, bottom] = bounds;
  const cropWidth = right - left;
  const cropHeight = bottom - top;

  // Crop only one measured pose, preventing neighboring characters from leaking in.
  const crop = document.createElement("canvas");
  crop.width = cropWidth;
  crop.height = cropHeight;
  const cropCtx = crop.getContext("2d", { willReadFrequently: true });
  cropCtx.imageSmoothingEnabled = false;
  cropCtx.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  removeConnectedCheckerboard(crop);

  // Normalize the pose onto a common canvas. SPRITE_SCALE never changes between
  // frames, so a wide running pose cannot suddenly grow larger than a narrow one.
  const frame = document.createElement("canvas");
  frame.width = FRAME_WIDTH;
  frame.height = FRAME_HEIGHT;
  const frameCtx = frame.getContext("2d");
  frameCtx.imageSmoothingEnabled = false;

  const drawWidth = cropWidth * SPRITE_SCALE;
  const drawHeight = cropHeight * SPRITE_SCALE;
  const drawX = (FRAME_WIDTH - drawWidth) / 2;
  const drawY = FRAME_HEIGHT - drawHeight;
  frameCtx.drawImage(crop, 0, 0, cropWidth, cropHeight, drawX, drawY, drawWidth, drawHeight);
  return frame;
}

function getSpriteSheet() {
  if (spriteLoadStarted) return spriteSheet;
  spriteLoadStarted = true;
  if (typeof Image === "undefined") return undefined;

  spriteSheet = new Image();
  spriteSheet.onload = () => {
    // Prepare frames once on load; rendering only selects a cached frame.
    processedFrames = RUN_FRAME_BOUNDS.map((bounds) => prepareFrame(spriteSheet, bounds));
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
  // Keep the animation clock paused whenever the game is paused.
  if (running) player.runTime += dt;

  // Physics controls vertical movement independently of the sprite artwork.
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

export function drawPlayer(ctx, player, _elapsed, jumping) {
  getSpriteSheet();

  // Loop directly from the final frame back to the first with no blank frame.
  const frameIndex = Math.floor(player.runTime / FRAME_DURATION) % RUN_FRAME_BOUNDS.length;
  const frame = processedFrames[frameIndex];

  ctx.save();

  // Shadow remains on the road while the player jumps.
  ctx.fillStyle = "#2c4638";
  ctx.globalAlpha = jumping ? 0.10 : 0.18;
  ctx.beginPath();
  ctx.ellipse(player.x + player.width / 2, GAME.groundY + 2, jumping ? 10 : 14, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (frame) {
    // Every frame uses the exact same destination size and bottom anchor.
    const drawX = Math.round(player.x + player.width / 2 - FRAME_WIDTH / 2);
    const drawY = Math.round(player.y + player.height - FRAME_HEIGHT + 5);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, drawX, drawY, FRAME_WIDTH, FRAME_HEIGHT);
  } else if (!spriteSheet?.complete || spriteSheet.naturalWidth === 0) {
    // Fallback shown only while the PNG loads or when its path is missing.
    ctx.fillStyle = "#df6846";
    ctx.fillRect(player.x + 4, player.y + 7, player.width - 8, player.height - 7);
    ctx.fillStyle = "#2d4939";
    ctx.fillRect(player.x + 3, player.y + 18, player.width - 6, player.height - 20);
    ctx.fillStyle = "#f2c48e";
    ctx.fillRect(player.x + 10, player.y, player.width - 14, 16);
  }

  ctx.restore();
}