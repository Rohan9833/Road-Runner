import { GAME } from "./constants.js";
export function createObstacle(x, variant = Math.floor(Math.random() * 3)) {
  const sizes = [{ width: 29, height: 33 }, { width: 42, height: 43 }, { width: 54, height: 27 }];
  const size = sizes[variant] || sizes[0];
  return { x, y: GAME.groundY - size.height, ...size, variant };
}
export function updateObstacles(obstacles, dt, speed) {
  for (const obstacle of obstacles) obstacle.x -= speed * dt;
  return obstacles.filter((obstacle) => obstacle.x + obstacle.width > -10);
}
export function drawObstacle(ctx, obstacle) {
  const { x, y, width, height, variant } = obstacle;
  ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.imageSmoothingEnabled = false;
  if (variant === 2) {
    ctx.fillStyle = "#b85f3e"; ctx.fillRect(0, 5, width, height - 5);
    ctx.fillStyle = "#e69a58"; ctx.fillRect(4, 8, width - 8, 4);
    ctx.fillStyle = "#754532"; ctx.fillRect(5, 15, 5, height - 15); ctx.fillRect(width - 10, 15, 5, height - 15);
    ctx.fillStyle = "#f6d59b"; ctx.fillRect(0, 5, width, 3);
  } else {
    ctx.fillStyle = "#345d42"; ctx.fillRect(width * .33, 0, width * .38, height);
    ctx.fillRect(0, height * .35, width * .33, height * .22); ctx.fillRect(width * .68, height * .52, width * .32, height * .2);
    ctx.fillRect(width * .07, height * .18, width * .22, height * .46);
    ctx.fillStyle = "#568254"; ctx.fillRect(width * .39, 3, 4, height - 6);
  }
  ctx.restore();
}