import { GAME } from "./constants.js";

// Vite serves files in frontend/public at the site root.
const SPRITE_URL = "/player.png";

// Each rectangle isolates one pose from the top row of the supplied sprite sheet.
// Format: [x, y, width, height]. The source image has a checkerboard baked in.
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

// A ping-pong sequence avoids a harsh jump from the last pose straight to the first.
// The same frames play forward and then backward, so the loop remains continuous.
const ANIMATION_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1];
const FRAME_DURATION = 0.095;

// All frames are drawn into the same destination box. That keeps the runner's
// feet and center aligned even though the source poses have different widths.
const DRAW_WIDTH = 56;
const DRAW_HEIGHT = 72;
const FOOT_PADDING = 2;

let spriteSheet;
let spriteLoadStarted = false;
let processedFrames = [];

function removeCheckerboard(frameCanvas) {
  // The supplied PNG has a grey/white checkerboard instead of transparency.
  // Convert those near-neutral background pixels to transparent once per frame.
  // This avoids drawing the checkerboard squares around the character in-game.
  const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
  const imageData = frameCtx.getImageData(0, 0, frameCanvas.width, frameCanvas.height);
  const pixels = imageData.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    const neutral = Math.max(red, green, blue) - Math.min(red, green, blue) < 10;

    // Checker squares are near #eeeeee and #ffffff. Keep skin, hair, clothes,
    // outlines and other colored pixels intact.
    if (neutral && red > 225 && green > 225 && blue > 225) {
      pixels[i + 3] = 0;
    }
  }

  frameCtx.putImageData(imageData, 0, 0);
}

function prepareFrames(image) {
  // Crop each pose into its own canvas so adjacent poses can never leak in.
  processedFrames = RUN_FRAMES.map(([x, y, width, height]) => {
    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = width;
    frameCanvas.height = height;

    const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
    frameCtx.imageSmoothingEnabled = false;
    frameCtx.drawImage(image, x, y, width, height, 0, 0, width, height);

    removeCheckerboard(frameCanvas);
    return frameCanvas;
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
  // Start loading and preparing the animation frames as the game initializes.
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
  // Animation time advances only while the game is actively running.
  if (running) player.runTime += dt;

  // Gravity and vertical velocity create the jump arc.
  if (!player.grounded) {
    player.vy += GAME.gravity * dt;
    player.y += player.vy * dt;

    // Clamp the player to the ground so it cannot fall through the road.
    const floor = GAME.groundY - player.height;
    if (player.y >= floor) {
      player.y = floor;
      player.vy = 0;
      player.grounded = true;
    }
  }
}

export function jumpPlayer(player) {
  // Only allow a jump when the player's feet are on the ground.
  if (!player.grounded) return false;

  player.vy = GAME.jumpVelocity;
  player.grounded = false;
  return true;
}

export function drawPlayer(ctx, player, elapsed, jumping) {
  getSpriteSheet();

  // Cycle through a ping-pong list so the last pose transitions back smoothly.
  const animationStep = Math.floor(elapsed / FRAME_DURATION) % ANIMATION_ORDER.length;
  const frameIndex = jumping ? 3 : ANIMATION_ORDER[animationStep];
  const frame = processedFrames[frameIndex];

  ctx.save();

  // A subtle ground shadow helps show the jump height without replacing the art.
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
    // Keep every pose in a fixed-size box and align its feet to the same baseline.
    // This prevents the character from visibly jumping left/right between frames.
    ctx.imageSmoothingEnabled = false;
    const drawX = Math.round(player.x + player.width / 2 - DRAW_WIDTH / 2);
    const drawY = Math.round(
      player.y + player.height - DRAW_HEIGHT + FOOT_PADDING,
    );
    ctx.drawImage(frame, drawX, drawY, DRAW_WIDTH, DRAW_HEIGHT);
  } else if (!spriteSheet?.complete || spriteSheet.naturalWidth === 0) {
    // Temporary fallback while the PNG is loading or if the path is incorrect.
    ctx.fillStyle = "#df6846";
    ctx.fillRect(player.x + 4, player.y + 7, player.width - 8, player.height - 7);
    ctx.fillStyle = "#2d4939";
    ctx.fillRect(player.x + 3, player.y + 18, player.width - 6, player.height - 20);
    ctx.fillStyle = "#f2c48e";
    ctx.fillRect(player.x + 10, player.y, player.width - 14, 16);
  }

  ctx.restore();
}