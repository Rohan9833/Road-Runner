import { GAME } from "./constants.js";

export function createPlayer() {
  return { x: GAME.playerX, y: GAME.groundY - GAME.playerHeight, width: GAME.playerWidth, height: GAME.playerHeight, vy: 0, grounded: true, runTime: 0 };
}
export function updatePlayer(player, dt, running) {
  if (running) player.runTime += dt;
  if (!player.grounded) {
    player.vy += GAME.gravity * dt;
    player.y += player.vy * dt;
    const floor = GAME.groundY - player.height;
    if (player.y >= floor) { player.y = floor; player.vy = 0; player.grounded = true; }
  }
}
export function jumpPlayer(player) {
  if (!player.grounded) return false;
  player.vy = GAME.jumpVelocity;
  player.grounded = false;
  return true;
}
export function drawPlayer(ctx, player, elapsed, jumping) {
  const x = Math.round(player.x), y = Math.round(player.y), frame = Math.floor(elapsed * 12) % 2;
  ctx.save(); ctx.translate(x, y); ctx.scale(3, 3); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#2c4638"; ctx.globalAlpha = jumping ? .15 : .22; ctx.fillRect(1, 15, 12, 2); ctx.globalAlpha = 1;
  ctx.fillStyle = "#df6846"; ctx.fillRect(0, 5, 4, 3); ctx.fillRect(frame ? 0 : -2, 6, 3, 2);
  ctx.fillStyle = "#2d4939"; ctx.fillRect(4, 6, 7, 7); ctx.fillRect(5, 5, 6, 2);
  ctx.fillStyle = "#f2c48e"; ctx.fillRect(5, 0, 7, 6); ctx.fillRect(8, -1, 5, 3);
  ctx.fillStyle = "#2d4939"; ctx.fillRect(4, 0, 7, 2); ctx.fillRect(10, 2, 1, 1);
  ctx.fillStyle = "#243329"; ctx.fillRect(10, 3, 1, 1);
  ctx.fillStyle = "#f2c48e"; ctx.fillRect(frame ? 2 : 9, 7, 2, 4);
  ctx.fillStyle = "#355441";
  if (jumping) { ctx.fillRect(5, 12, 3, 3); ctx.fillRect(9, 11, 3, 3); ctx.fillStyle = "#26392e"; ctx.fillRect(3, 14, 4, 2); ctx.fillRect(9, 13, 4, 2); }
  else if (frame) { ctx.fillRect(5, 12, 3, 3); ctx.fillRect(9, 12, 3, 2); ctx.fillStyle = "#26392e"; ctx.fillRect(6, 14, 5, 2); ctx.fillRect(10, 13, 4, 2); }
  else { ctx.fillRect(5, 12, 3, 2); ctx.fillRect(9, 12, 3, 3); ctx.fillStyle = "#26392e"; ctx.fillRect(3, 13, 5, 2); ctx.fillRect(9, 14, 5, 2); }
  ctx.restore();
}