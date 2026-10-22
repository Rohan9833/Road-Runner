import { GAME } from "./constants.js";

export function drawBackground(ctx, elapsed, speed, score = 0) {
  const { width, height, groundY } = GAME;
  const isNight = Math.floor(score / 100) % 2 === 1;

  const skyColor = isNight ? "#18243d" : "#f8f0db";
  const sunMoonColor = isNight ? "#f4efc6" : "#f2cd85";
  const hillColor = isNight ? "#293b50" : "#e9d9b8";
  const cloudColor = isNight ? "#526078" : "#fffaf0";
  const groundColor = isNight ? "#66566a" : "#e8a66a";
  const groundDetailColor = isNight ? "#493f5b" : "#bf794d";
  const groundEdgeColor = isNight ? "#a8b5c4" : "#345440";
  const groundStripeColor = isNight ? "#8c7180" : "#d58b54";

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = skyColor;
  ctx.fillRect(0, 0, width, height);

  // Sun during the day, moon at night.
  ctx.fillStyle = sunMoonColor;
  if (isNight) {
    ctx.beginPath();
    ctx.arc(776, 70, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skyColor;
    ctx.beginPath();
    ctx.arc(786, 62, 18, 0, Math.PI * 2);
    ctx.fill();

    // Pixel stars stay in the sky during the night phase.
    ctx.fillStyle = "#fff7d6";
    for (let i = 0; i < 18; i++) {
      const x = (i * 97 + 31) % width;
      const y = 20 + ((i * 43 + 17) % Math.max(30, groundY - 75));
      const twinkle = Math.sin(elapsed * 2 + i) > -0.2;
      if (twinkle) ctx.fillRect(x, y, i % 3 === 0 ? 3 : 2, i % 3 === 0 ? 3 : 2);
    }
  } else {
    ctx.fillRect(755, 49, 42, 42);
    ctx.fillRect(768, 36, 16, 68);
  }

  const hillOffset = (elapsed * speed * 0.11) % 230;
  const hillBaseY = groundY - 92;
  ctx.fillStyle = hillColor;
  for (let i = -1; i < 6; i++) {
    const x = i * 230 - hillOffset;
    ctx.fillRect(x, hillBaseY + 23, 92, 28);
    ctx.fillRect(x + 22, hillBaseY, 106, 46);
    ctx.fillRect(x + 61, hillBaseY + 18, 88, 29);
  }

  ctx.fillStyle = cloudColor;
  for (let i = 0; i < 3; i++) {
    const x = ((i * 355 - elapsed * 13) % (width + 130) + width + 130) % (width + 130) - 65;
    const y = 78 + i * 48;
    if (!isNight) {
      ctx.fillRect(x, y, 58, 10);
      ctx.fillRect(x + 13, y - 9, 32, 10);
      ctx.fillRect(x + 6, y + 10, 42, 5);
    } else if (i !== 1) {
      ctx.fillRect(x, y, 48, 7);
      ctx.fillRect(x + 11, y - 6, 25, 7);
    }
  }

  ctx.fillStyle = groundColor;
  ctx.fillRect(0, groundY, width, height - groundY);
  ctx.fillStyle = groundEdgeColor;
  ctx.fillRect(0, groundY, width, 5);

  ctx.fillStyle = groundDetailColor;
  const groundOffset = (elapsed * speed) % 54;
  for (let x = -54; x < width + 54; x += 54) {
    ctx.fillRect(x - groundOffset, groundY + 19, 23, 4);
    ctx.fillRect(x + 20 - groundOffset, groundY + 42, 12, 4);
  }

  ctx.fillStyle = groundStripeColor;
  ctx.fillRect(0, groundY + 8, width, 3);

  ctx.fillStyle = groundEdgeColor;
  for (let x = -40; x < width + 40; x += 119) {
    const offset = (elapsed * speed * 0.8) % 119;
    ctx.fillRect(x - offset, groundY - 10, 4, 6);
    ctx.fillRect(x - offset + 4, groundY - 5, 5, 2);
  }
}
