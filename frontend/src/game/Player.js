import { GAME } from "./constants.js";

// Vite serves files in frontend/public at the site root.
const SPRITE_URL = "/player.png";

// IMPORTANT: this sprite sheet is not a perfectly spaced 8-cell strip.
// Each pose has a slightly different horizontal position, so fixed-width crops
// included pieces of neighboring characters. These rectangles crop each pose
// separately from the first (running) row of the supplied 840 x 840 image.
// Rectangle format: [sourceX, sourceY, sourceWidth, sourceHeight].
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

// Display size is separate from the collision box used by the game physics.
// This lets the artwork look clear without making obstacle collisions unfair.
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
  spriteSheet.onerror = () => {
    console.error(
      "Could not load /player.png. Save the sprite sheet at frontend/public/player.png.",
    );
  };
  spriteSheet.src = SPRITE_URL;
  return spriteSheet;
}

export function createPlayer() {
  // Start loading the sprite once when the player is created.
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
  // Animation time advances only while gameplay is active.
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
  const sheet = getSpriteSheet();

  // Pick one tightly-cropped pose. A fixed pose is used in mid-air.
  const frameIndex = jumping
    ? 3
    : Math.floor(elapsed * 10) % RUN_FRAMES.length;
  const [sourceX, sourceY, sourceWidth, sourceHeight] = RUN_FRAMES[frameIndex];

  ctx.save();

  // A small shadow makes it easier to judge the player's height during jumps.
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
    // Preserve the pose's natural proportions instead of stretching it.
    const aspectRatio = sourceWidth / sourceHeight;
    const drawHeight = DRAW_HEIGHT;
    const drawWidth = drawHeight * aspectRatio;

    // drawImage's first four numbers select the source crop; the last four
    // set the destination position and size on the game canvas.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sheet,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      Math.round(player.x + player.width / 2 - drawWidth / 2),
      Math.round(player.y + player.height - drawHeight - DRAW_Y_OFFSET + 14),
      drawWidth,
      drawHeight,
    );
  } else {
    // Temporary fallback shown only while the PNG is loading or missing.
    ctx.fillStyle = "#df6846";
    ctx.fillRect(player.x + 4, player.y + 7, player.width - 8, player.height - 7);
    ctx.fillStyle = "#2d4939";
    ctx.fillRect(player.x + 3, player.y + 18, player.width - 6, player.height - 20);
    ctx.fillStyle = "#f2c48e";
    ctx.fillRect(player.x + 10, player.y, player.width - 14, 16);
  }

  ctx.restore();
}