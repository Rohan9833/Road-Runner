import { GAME } from "./constants.js";
export function drawBackground(ctx, elapsed, speed) {
  const { width, height, groundY } = GAME;
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = "#f8f0db"; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#f2cd85"; ctx.fillRect(755, 49, 42, 42); ctx.fillRect(768, 36, 16, 68);
  const hillOffset = (elapsed * speed * .11) % 230; ctx.fillStyle = "#e9d9b8";
  for (let i = -1; i < 6; i++) { const x = i * 230 - hillOffset; ctx.fillRect(x, 207, 92, 28); ctx.fillRect(x + 22, 184, 106, 46); ctx.fillRect(x + 61, 202, 88, 29); }
  ctx.fillStyle = "#fffaf0";
  for (let i = 0; i < 3; i++) {
    const x = ((i * 355 - elapsed * 13) % (width + 130) + width + 130) % (width + 130) - 65, y = 62 + i * 38;
    ctx.fillRect(x, y, 58, 10); ctx.fillRect(x + 13, y - 9, 32, 10); ctx.fillRect(x + 6, y + 10, 42, 5);
  }
  ctx.fillStyle = "#e8a66a"; ctx.fillRect(0, groundY, width, height - groundY);
  ctx.fillStyle = "#345440"; ctx.fillRect(0, groundY, width, 5);
  ctx.fillStyle = "#bf794d"; const groundOffset = (elapsed * speed) % 54;
  for (let x = -54; x < width + 54; x += 54) { ctx.fillRect(x - groundOffset, groundY + 19, 23, 4); ctx.fillRect(x + 20 - groundOffset, groundY + 42, 12, 4); }
  ctx.fillStyle = "#d58b54"; ctx.fillRect(0, groundY + 8, width, 3);
  ctx.fillStyle = "#345440";
  for (let x = -40; x < width + 40; x += 119) { const offset = (elapsed * speed * .8) % 119; ctx.fillRect(x - offset, groundY - 10, 4, 6); ctx.fillRect(x - offset + 4, groundY - 5, 5, 2); }
}