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
    // A clean, round pixel-art sun with short, evenly spaced rays.
    const sunX = 775;
    const sunY = 76;
    ctx.fillStyle = "#e8b967";
    ctx.fillRect(sunX - 24, sunY - 4, 7, 8);
    ctx.fillRect(sunX + 17, sunY - 4, 7, 8);
    ctx.fillRect(sunX - 4, sunY - 24, 8, 7);
    ctx.fillRect(sunX - 4, sunY + 17, 8, 7);
    ctx.fillRect(sunX - 17, sunY - 17, 6, 6);
    ctx.fillRect(sunX + 11, sunY - 17, 6, 6);
    ctx.fillRect(sunX - 17, sunY + 11, 6, 6);
    ctx.fillRect(sunX + 11, sunY + 11, 6, 6);

    ctx.fillStyle = "#f5cf83";
    ctx.fillRect(sunX - 15, sunY - 15, 30, 30);
    ctx.fillRect(sunX - 19, sunY - 9, 38, 18);
    ctx.fillRect(sunX - 9, sunY - 19, 18, 38);
    ctx.fillStyle = "#ffe3a2";
    ctx.fillRect(sunX - 8, sunY - 10, 14, 4);
  }

  // Removed the repeating dark cloud-like hill silhouettes near the horizon.
  // Keep the horizon clean so the sky transitions directly into the ground.

  // Sparse, varied cloud silhouettes stay in the upper sky instead of forming a repeating row.
  const cloudTravel = elapsed * 10;
  const clouds = [
    { startX: 20, y: 83, width: 72, scale: 1 },
    { startX: 125, y: 45, width: 36, scale: 0.52 },
    { startX: 220, y: 119, width: 32, scale: 0.46 },
    { startX: 320, y: 145, width: 52, scale: 0.78 },
    { startX: 410, y: 72, width: 39, scale: 0.56 },
    { startX: 510, y: 58, width: 88, scale: 1.12 },
    { startX: 625, y: 130, width: 34, scale: 0.48 },
    { startX: 720, y: 92, width: 42, scale: 0.6 },
    { startX: 820, y: 43, width: 44, scale: 0.62 },
    { startX: 930, y: 151, width: 38, scale: 0.54 },
    { startX: 1050, y: 105, width: 50, scale: 0.7 },
  ];

  for (let i = 0; i < clouds.length; i++) {
    const cloud = clouds[i];
    const loopWidth = width + 180;
    const x = ((cloud.startX - cloudTravel * (i % 2 === 0 ? 1 : 0.72)) % loopWidth + loopWidth) % loopWidth - 90;
    const y = cloud.y;
    const s = cloud.scale;

    ctx.fillStyle = isNight ? "#46566d" : "#fffaf0";
    // Each cloud has its own silhouette and proportions.
    if (i === 0) {
      ctx.fillRect(x + 10 * s, y, 48 * s, 12 * s);
      ctx.fillRect(x + 20 * s, y - 10 * s, 25 * s, 12 * s);
      ctx.fillRect(x, y + 4 * s, 68 * s, 8 * s);
    } else if (i === 1) {
      ctx.fillRect(x + 8 * s, y, 38 * s, 9 * s);
      ctx.fillRect(x + 18 * s, y - 8 * s, 18 * s, 10 * s);
      ctx.fillRect(x, y + 3 * s, 52 * s, 6 * s);
    } else {
      ctx.fillRect(x + 14 * s, y, 58 * s, 13 * s);
      ctx.fillRect(x + 26 * s, y - 12 * s, 28 * s, 14 * s);
      ctx.fillRect(x + 4 * s, y + 4 * s, 80 * s, 9 * s);
      ctx.fillRect(x + 22 * s, y + 11 * s, 42 * s, 4 * s);
    }
  }


  // A soft pixel-art rainbow drifts at the same pace as the clouds.
  // Draw only during daytime so the night sky stays calm.
  if (!isNight) {
    const rainbowLoop = width + 360;
    const rainbowX = ((width + 120 - cloudTravel * 0.72) % rainbowLoop + rainbowLoop) % rainbowLoop - 180;
    const rainbowY = 172;
    const rainbowWidth = 112;
    const rainbowHeight = 76;
    const rainbowColors = ["#e96b5b", "#f2a65a", "#f5d66f", "#6fbf83", "#6ba9df", "#9b83c9"];

    ctx.save();
    ctx.lineWidth = 5;
    for (let i = 0; i < rainbowColors.length; i++) {
      ctx.strokeStyle = rainbowColors[i];
      ctx.beginPath();
      ctx.arc(rainbowX, rainbowY, rainbowHeight - i * 5, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    // Mask the lower half so the rainbow reads as an arch.
    ctx.fillStyle = skyColor;
    ctx.fillRect(rainbowX - rainbowWidth - 8, rainbowY, rainbowWidth * 2 + 16, rainbowHeight + 8);
    // Redraw the colored arch with clean concentric arcs.
    for (let i = rainbowColors.length - 1; i >= 0; i--) {
      ctx.strokeStyle = rainbowColors[i];
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(rainbowX, rainbowY, rainbowHeight - i * 5, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
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
