import { GAME } from "./constants.js";

const SPRITE_URL = "/player.png";

// These bounds isolate the eight poses in the first row of player.png.
// Format: [left, top, right, bottom], measured in source-image pixels.
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

const FRAME_DURATION = 0.095;

// Each pose is placed on the same transparent canvas and drawn at one fixed size.
// This prevents the character's size/anchor from changing as the frame changes.
const FRAME_WIDTH = 105;
const FRAME_HEIGHT = 130;
const DRAW_WIDTH = 56;
const DRAW_HEIGHT = 68;

let spriteSheet;
let spriteLoadStarted = false;
let processedFrames = [];

function removeConnectedCheckerboard(canvas) {
  // The checkerboard is baked into this PNG. Flood-fill only the light background
  // connected to the crop's edges, preserving white details inside the character.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const isBackground = (index) => {
    const i = index * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    return spread < 15 && r > 175 && g > 175 && b > 175;
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

  // Step 1: crop exactly one pose so neighboring characters cannot leak in.
  const crop = document.createElement("canvas");
  crop.width = cropWidth;
  crop.height = cropHeight;
  const cropCtx = crop.getContext("2d", { willReadFrequently: true });
  cropCtx.imageSmoothingEnabled = false;
  cropCtx.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  removeConnectedCheckerboard(crop);

  // Step 2: use a common frame canvas for every pose. Scale by HEIGHT only,
  // not by each pose's width, so the runner never grows/shrinks on wide poses.
  const frame = document.createElement("canvas");
  frame.width = FRAME_WIDTH;
  frame.height = FRAME_HEIGHT;
  const frameCtx = frame.getContext("2d");
  frameCtx.imageSmoothingEnabled = false;

  const scale = (FRAME_HEIGHT - 8) / cropHeight;
  const drawWidth = cropWidth * scale;
  const drawHeight = cropHeight * scale;
  const x = (FRAME_WIDTH - drawWidth) / 2;
  const y = FRAME_HEIGHT - drawHeight;

  frameCtx.drawImage(crop, x, y, drawWidth, drawHeight);
  return frame;
}

function getSpriteSheet() {
  if (spriteLoadStarted) return spriteSheet;
  spriteLoadStarted = true;

  if (typeof Image === "undefined") return undefined;
  spriteSheet = new Image();
  spriteSheet.onload = () => {
    // Process once after the image loads. The animation loop uses cached frames.
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
  // Use a player-owned clock: it advances during play and pauses with the game.
  if (running) player.runTime += dt;

  // Jump physics controls player.y; sprite rendering must follow that same value.
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

  // A ping-pong loop avoids the abrupt final-pose -> first-pose jump. The frames
  // still move forward during the run; the return trip only closes the loop cleanly.
  const animationOrder = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1];
  const animationStep = Math.floor(player.runTime / FRAME_DURATION) % animationOrder.length;
  const frameIndex = jumping ? 3 : animationOrder[animationStep];
  const frame = processedFrames[frameIndex];

  ctx.save();

  // The shadow stays on the ground while the runner moves up during a jump.
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
    // Anchor the artwork to the player's feet. Never use GAME.groundY here:
    // using player.y is what makes the artwork follow the jump arc correctly.
    const drawX = Math.round(player.x + player.width / 2 - DRAW_WIDTH / 2);
    const drawY = Math.round(player.y + player.height - DRAW_HEIGHT + 2);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, drawX, drawY, DRAW_WIDTH, DRAW_HEIGHT);
  } else if (!spriteSheet?.complete || spriteSheet.naturalWidth === 0) {
    // Simple placeholder while the sprite is loading or if the path is missing.
    ctx.fillStyle = "#df6846";
    ctx.fillRect(player.x + 4, player.y + 7, player.width - 8, player.height - 7);
    ctx.fillStyle = "#2d4939";
    ctx.fillRect(player.x + 3, player.y + 18, player.width - 6, player.height - 20);
    ctx.fillStyle = "#f2c48e";
    ctx.fillRect(player.x + 10, player.y, player.width - 14, 16);
  }

  ctx.restore();
}