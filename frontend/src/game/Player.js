import { GAME } from "./constants.js";

const SPRITE_URL = "/player.png";

// The sprite sheet is 840px wide, with eight 105px columns.
// Crop the same complete cell for every pose instead of guessed character bounds.
const FRAME_COUNT = 8;
const SOURCE_FRAME_WIDTH = 105;
const SOURCE_FRAME_HEIGHT = 150;
const SOURCE_RUN_ROW_Y = 280;

const FRAME_DURATION = 0.095;

// Every processed frame has the same dimensions and baseline.
// This prevents the player from shrinking, jumping vertically, or disappearing
// when the animation changes from the final pose back to the first pose.
const NORMAL_FRAME_WIDTH = 64;
const NORMAL_FRAME_HEIGHT = 80;
const MAX_CHARACTER_WIDTH = 58;
const MAX_CHARACTER_HEIGHT = 74;

let spriteSheet;
let spriteLoadStarted = false;
let processedFrames = [];

function isCheckerPixel(data, index) {
  const offset = index * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const spread = Math.max(red, green, blue) - Math.min(red, green, blue);

  // The checkerboard is light and nearly neutral. Dark outlines and colored
  // pixels belonging to the character are deliberately not classified as background.
  return spread < 16 && red > 175 && green > 175 && blue > 175;
}

function removeConnectedCheckerboard(canvas) {
  // The checkerboard is baked into the PNG, so the browser cannot treat it as
  // transparency. Flood-fill only background pixels connected to the crop edges.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const enqueue = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const index = y * width + x;
    if (visited[index] || !isCheckerPixel(data, index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  // Start at the border; background-colored pixels inside closed outlines remain.
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

function prepareFrame(image, frameIndex) {
  // 1. Crop one full grid cell. Never read pixels from the next character.
  const source = document.createElement("canvas");
  source.width = SOURCE_FRAME_WIDTH;
  source.height = SOURCE_FRAME_HEIGHT;
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  sourceCtx.imageSmoothingEnabled = false;
  sourceCtx.drawImage(
    image,
    frameIndex * SOURCE_FRAME_WIDTH,
    SOURCE_RUN_ROW_Y,
    SOURCE_FRAME_WIDTH,
    SOURCE_FRAME_HEIGHT,
    0,
    0,
    SOURCE_FRAME_WIDTH,
    SOURCE_FRAME_HEIGHT,
  );

  // 2. Remove the checkerboard before finding the visible character bounds.
  removeConnectedCheckerboard(source);

  const sourcePixels = sourceCtx.getImageData(
    0,
    0,
    SOURCE_FRAME_WIDTH,
    SOURCE_FRAME_HEIGHT,
  ).data;

  let minX = SOURCE_FRAME_WIDTH;
  let minY = SOURCE_FRAME_HEIGHT;
  let maxX = -1;
  let maxY = -1;

  // 3. Find the remaining non-transparent pixels; cell padding is not scaled.
  for (let y = 0; y < SOURCE_FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < SOURCE_FRAME_WIDTH; x += 1) {
      if (sourcePixels[(y * SOURCE_FRAME_WIDTH + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  // A bad/empty cell should reuse the previous valid frame rather than flash blank.
  if (maxX < minX || maxY < minY) {
    return null;
  }

  const characterWidth = maxX - minX + 1;
  const characterHeight = maxY - minY + 1;

  // 4. Fit each pose to the same maximum size while preserving its proportions.
  const scale = Math.min(
    MAX_CHARACTER_WIDTH / characterWidth,
    MAX_CHARACTER_HEIGHT / characterHeight,
  );
  const drawWidth = characterWidth * scale;
  const drawHeight = characterHeight * scale;

  const normalized = document.createElement("canvas");
  normalized.width = NORMAL_FRAME_WIDTH;
  normalized.height = NORMAL_FRAME_HEIGHT;
  const normalizedCtx = normalized.getContext("2d");
  normalizedCtx.imageSmoothingEnabled = false;

  // Center horizontally and align the feet to the same baseline.
  const drawX = (NORMAL_FRAME_WIDTH - drawWidth) / 2;
  const drawY = NORMAL_FRAME_HEIGHT - drawHeight - 2;
  normalizedCtx.drawImage(
    source,
    minX,
    minY,
    characterWidth,
    characterHeight,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  );

  return normalized;
}

function getSpriteSheet() {
  if (spriteLoadStarted) return spriteSheet;
  spriteLoadStarted = true;

  if (typeof Image === "undefined") return undefined;

  spriteSheet = new Image();
  spriteSheet.onload = () => {
    // Prepare all frames once. If a cell is empty, reuse a neighboring valid pose
    // so there is never a one-frame disappearance during the animation loop.
    const frames = Array.from({ length: FRAME_COUNT }, (_, index) =>
      prepareFrame(spriteSheet, index),
    );
    let lastValidFrame = frames.find(Boolean);

    processedFrames = frames.map((frame) => {
      if (frame) lastValidFrame = frame;
      return frame || lastValidFrame;
    });

    // Handle empty cells at the beginning too by using the first valid frame.
    const firstValidFrame = processedFrames.find(Boolean);
    processedFrames = processedFrames.map((frame) => frame || firstValidFrame);
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
  // Keep the animation clock on the player so it pauses with gameplay.
  if (running) player.runTime += dt;

  // Jump physics changes player.y; the sprite renderer uses that same position.
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

  // Modulo loops continuously: 0, 1, 2 ... 7, then directly back to 0.
  const frameIndex = Math.floor(player.runTime / FRAME_DURATION) % FRAME_COUNT;
  const frame = processedFrames[frameIndex] || processedFrames[0];

  ctx.save();

  // The shadow stays on the road while the runner jumps above it.
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
    // Draw all normalized frames at exactly the same dimensions and baseline.
    // This removes the size pop and vertical flicker between poses.
    const drawX = Math.round(player.x + player.width / 2 - NORMAL_FRAME_WIDTH / 2);
    const drawY = Math.round(player.y + player.height - NORMAL_FRAME_HEIGHT);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, drawX, drawY, NORMAL_FRAME_WIDTH, NORMAL_FRAME_HEIGHT);
  } else if (!spriteSheet?.complete || spriteSheet.naturalWidth === 0) {
    // Simple placeholder shown only while the sprite is loading or missing.
    ctx.fillStyle = "#df6846";
    ctx.fillRect(player.x + 4, player.y + 7, player.width - 8, player.height - 7);
    ctx.fillStyle = "#2d4939";
    ctx.fillRect(player.x + 3, player.y + 18, player.width - 6, player.height - 20);
    ctx.fillStyle = "#f2c48e";
    ctx.fillRect(player.x + 10, player.y, player.width - 14, 16);
  }

  ctx.restore();
}