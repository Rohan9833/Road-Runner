import { GAME } from "./constants.js";

const SPRITE_URL = "/player.png";

// Use the same-sized grid cell for every pose. Trimming each pose independently
// made the visible character grow/shrink because every crop had a different ratio.
const FRAME_COUNT = 8;
const SOURCE_FRAME_WIDTH = 105;
const SOURCE_FRAME_HEIGHT = 150;
const SOURCE_RUN_ROW_Y = 100;

// This is the one and only display size for the runner, for every animation frame.
const DRAW_WIDTH = 56;
const DRAW_HEIGHT = 80;
const FRAME_DURATION = 0.095;

let spriteSheet;
let spriteLoadStarted = false;
let processedFrames = [];

function removeConnectedCheckerboard(canvas) {
  // The checkerboard is part of the PNG pixels, not transparent alpha.
  // Remove only near-neutral light pixels connected to the cell's outer edge.
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
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    return spread < 16 && r > 175 && g > 175 && b > 175;
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

function prepareFrame(image, frameIndex) {
  // Crop the same 105 x 150 source cell for every pose. Do not trim or rescale
  // individual characters: the original cell layout provides a consistent scale.
  const frame = document.createElement("canvas");
  frame.width = SOURCE_FRAME_WIDTH;
  frame.height = SOURCE_FRAME_HEIGHT;

  const frameCtx = frame.getContext("2d", { willReadFrequently: true });
  frameCtx.imageSmoothingEnabled = false;
  frameCtx.drawImage(
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

  removeConnectedCheckerboard(frame);
  return frame;
}

function getSpriteSheet() {
  if (spriteLoadStarted) return spriteSheet;
  spriteLoadStarted = true;

  if (typeof Image === "undefined") return undefined;

  spriteSheet = new Image();
  spriteSheet.onload = () => {
    // Prepare every frame once after loading, not on every game-loop tick.
    processedFrames = Array.from({ length: FRAME_COUNT }, (_, index) =>
      prepareFrame(spriteSheet, index),
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
  // Keep animation timing attached to the player so it pauses with the game.
  if (running) player.runTime += dt;

  // Jump physics is independent of the sprite image.
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

  // Modulo wraps the index from the last frame back to the first without a gap.
  const frameIndex = Math.floor(player.runTime / FRAME_DURATION) % FRAME_COUNT;
  const frame = processedFrames[frameIndex];

  ctx.save();

  // The shadow remains on the road while the runner moves upward during a jump.
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
    // IMPORTANT: every frame is drawn at exactly the same width and height.
    // The bottom edge follows the physics player's feet, so jumps remain aligned.
    const drawX = Math.round(player.x + player.width / 2 - DRAW_WIDTH / 2);
    const drawY = Math.round(player.y + player.height - DRAW_HEIGHT + 5);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, drawX, drawY, DRAW_WIDTH, DRAW_HEIGHT);
  } else if (!spriteSheet?.complete || spriteSheet.naturalWidth === 0) {
    // Temporary fallback while the PNG loads or if the public asset is missing.
    ctx.fillStyle = "#df6846";
    ctx.fillRect(player.x + 4, player.y + 7, player.width - 8, player.height - 7);
    ctx.fillStyle = "#2d4939";
    ctx.fillRect(player.x + 3, player.y + 18, player.width - 6, player.height - 20);
    ctx.fillStyle = "#f2c48e";
    ctx.fillRect(player.x + 10, player.y, player.width - 14, 16);
  }

  ctx.restore();
}