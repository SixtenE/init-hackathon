const RAD_TO_DEG = 180 / Math.PI;
export function attitudeFromQuaternion(q: { x: number; y: number; z: number; w: number }) {
  // Aircraft forward is +Z; positive bank matches the simulation's right turn.
  const forwardX = 2 * (q.x * q.z + q.w * q.y);
  const forwardY = 2 * (q.y * q.z - q.w * q.x);
  const forwardZ = 1 - 2 * (q.x * q.x + q.y * q.y);
  return {
    pitch: Math.asin(Math.max(-1, Math.min(1, forwardY))) * RAD_TO_DEG,
    bank: Math.atan2(2 * (q.x * q.y + q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z)) * RAD_TO_DEG,
    heading: (Math.atan2(forwardX, forwardZ) * RAD_TO_DEG + 360) % 360,
  };
}
export const toKnots = (speed: number) => Math.max(0, speed * 3 / 0.514444);
export const toFeetAgl = (worldY: number) => Math.max(0, (worldY + 60) * 3 / 0.3048);
