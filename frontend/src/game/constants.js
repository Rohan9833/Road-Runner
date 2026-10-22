export const GAME = Object.freeze({
  width: 960, height: 520, groundY: 390, playerX: 112,
  playerWidth: 42, playerHeight: 54, gravity: 1850, jumpVelocity: -650,
  // Increase speed slowly: the game takes about 58 seconds to reach max speed.
  initialSpeed: 330, maxSpeed: 680, speedRamp: 0.75,
  minSpawnGap: 280, maxSpawnGap: 470, pixelsPerMeter: 34,
});
