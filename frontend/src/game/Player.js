import { GAME } from "./constants.js";

// Vite serves files in frontend/public at the site root.
const SPRITE_URL = "/player.png";

// These crop rectangles were measured on the original 840 x 859 sprite sheet.
// The replacement player.png is 494 x 505, so every crop coordinate must be
// scaled to the loaded image's actual dimensions before cropping.
const REFERENCE_IMAGE_WIDTH = 840;
const REFERENCE_IMAGE_HEIGHT = 859;

// Format: [x, y, width, height] in the original 840 x 859 image.
const RUN_FRAMES = [
  [27, 301, 76, 119],
  [143, 302, 68, 118],
  [237, 302, 79, 119],
  [343, 302, 77, 119],
  [449, 302, 72, 118],
  [555, 302, 69, 119],
  [647, 302, 85, 119],
  [750, 302, 89, 119],
];

// Ping-pong animation plays forward and backward for a softer loop transition.
const ANIMATION_ORDER = [0, 1, 2, 3, 4, 5, 6, 7,];
const FRAME_DURATION = 0.095;

// The final drawing box is the same for every frame. Each pose is fitted inside
// it without stretching, and its feet share the same bottom baseline.
const DRAW_WIDTH = 64;
const DRAW_HEIGHT = 72;
const FOOT_PADDING = 2;

let spriteSheet;
let spriteLoadStarted = false;
let processedFrames = [];

function removeCheckerboard(frameCanvas) {
  // The checkerboard is baked into the PNG, not stored as transparency.
  // Flood-fill only bright neutral pixels connected to the crop's edges. This
  // removes the background while preserving enclosed light details on the runner.
  const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
  const imageData = frameCtx.getImageData(0, 0, frameCanvas.width, frameCanvas.height);
  const { data, width, height } = imageData;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const isBackground = (index) => {
    const offset = index * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);

    // The sheet's light-grey and white checker squares are both near-neutral.
    return spread < 18 && red > 195 && green > 195 && blue > 195;
  };

  const enqueue = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const index = y * width + x;
    if (visited[index] || !isBackground(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  // Start at the crop border so only background connected to the outside is removed.
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

  frameCtx.putImageData(imageData, 0, 0);
}

function prepareFrames(image) {
  // The image was replaced and its dimensions changed. Calculate independent
  // X/Y scale factors instead of using the old 840 x 859 pixel coordinates raw.
  const scaleX = image.naturalWidth / REFERENCE_IMAGE_WIDTH;
  const scaleY = image.naturalHeight / REFERENCE_IMAGE_HEIGHT;

  processedFrames = RUN_FRAMES.map(([sourceX, sourceY, sourceWidth, sourceHeight]) => {
    // Scale rectangle edges (rather than just widths) to avoid rounding gaps.
    const left = Math.round(sourceX * scaleX);
    const top = Math.round(sourceY * scaleY);
    const right = Math.round((sourceX + sourceWidth) * scaleX);
    const bottom = Math.round((sourceY + sourceHeight) * scaleY);
    const cropWidth = right - left;
    const cropHeight = bottom - top;

    // Crop one pose only; these scaled coordinates now fit the replacement PNG.
    const crop = document.createElement("canvas");
    crop.width = cropWidth;
    crop.height = cropHeight;
    const cropCtx = crop.getContext("2d", { willReadFrequently: true });
    cropCtx.imageSmoothingEnabled = false;
    cropCtx.drawImage(
      image,
      left,
      top,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );
    removeCheckerboard(crop);

    // Give each pose the same transparent canvas. Fit by preserving aspect ratio,
    // then center horizontally and align the feet at the same bottom baseline.
    const frame = document.createElement("canvas");
    frame.width = DRAW_WIDTH;
    frame.height = DRAW_HEIGHT;
    const frameCtx = frame.getContext("2d");
    frameCtx.imageSmoothingEnabled = false;

    const scale = Math.min(
      (DRAW_WIDTH - 2) / cropWidth,
      (DRAW_HEIGHT - 2) / cropHeight,
    );
    const drawWidth = cropWidth * scale;
    const drawHeight = cropHeight * scale;
    const drawX = (DRAW_WIDTH - drawWidth) / 2;
    const drawY = DRAW_HEIGHT - drawHeight - FOOT_PADDING;

    frameCtx.drawImage(
      crop,
      0,
      0,
      cropWidth,
      cropHeight,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    );

    return frame;
  });
}

function getSpriteSheet() {
  if (spriteLoadStarted) return spriteSheet;
  spriteLoadStarted = true;

  if (typeof Image === "undefined") return undefined;

  spriteSheet = new Image();
  spriteSheet.onload = () => prepareFrames(spriteSheet);
  spriteSheet.onerror = () => {
    console.error(
      "Could not load /player.png. Save the sprite sheet at frontend/public/player.png.",
    );
  };
  spriteSheet.src = SPRITE_URL;
  return spriteSheet;
}

export function createPlayer() {
  // Begin loading and preparing the character art when the player is created.
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
  // Keep animation time tied to gameplay, so it stops while paused.
  if (running) player.runTime += dt;

  // Jump physics updates the logical player position; rendering follows that position.
  if (!player.grounded) {
    player.vy += GAME.gravity * dt;
    player.y += player.vy * dt;

    // Clamp to the road surface so rounding never lets the player fall through it.
    const floor = GAME.groundY - player.height;
    if (player.y >= floor) {
      player.y = floor;
      player.vy = 0;
      player.grounded = true;
    }
  }
}

export function jumpPlayer(player) {
  // Only start a jump if the player is currently standing on the road.
  if (!player.grounded) return false;

  player.vy = GAME.jumpVelocity;
  player.grounded = false;
  return true;
}

export function drawPlayer(ctx, player, _elapsed, jumping) {
  getSpriteSheet();

  // Use the player's own timer so the animation pauses/resumes with gameplay.
  const animationStep =
    Math.floor(player.runTime / FRAME_DURATION) % ANIMATION_ORDER.length;
  const frameIndex = jumping ? 3 : ANIMATION_ORDER[animationStep];
  const frame = processedFrames[frameIndex];

  ctx.save();

  // The shadow stays on the road while the runner moves upward during a jump.
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
    // Every processed frame is exactly 56 x 72 and has the same foot baseline.
    // The sprite is anchored to the physics player's feet, including while jumping.
    const drawX = Math.round(player.x + player.width / 2 - DRAW_WIDTH / 2);
    const drawY = Math.round(
      player.y + player.height - DRAW_HEIGHT + FOOT_PADDING,
    );

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