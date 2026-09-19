import * as THREE from "three";
import type { PlayerState, StateMessage } from "./protocol";

const INTERP_DELAY_MS = 100;
const MAX_EXTRAPOLATE_S = 0.08;
const SNAP_DISTANCE = 40;
const MAX_SNAPSHOTS = 24;

export type SampledPlayer = PlayerState & {
  interpolated: boolean;
};

type Snapshot = {
  time: number;
  tick: number;
  players: Map<number, PlayerState>;
};

const snapshots: Snapshot[] = [];
const positionA = new THREE.Vector3();
const positionB = new THREE.Vector3();
const quatA = new THREE.Quaternion();
const quatB = new THREE.Quaternion();
const velocityA = new THREE.Vector3();
const velocityB = new THREE.Vector3();

export function resetSnapshots(): void {
  snapshots.length = 0;
}

export function pushSnapshot(message: StateMessage, time = performance.now()): void {
  const players = new Map<number, PlayerState>();
  for (const player of message.players) players.set(player.id, player);
  snapshots.push({ time, tick: message.tick, players });
  if (snapshots.length > MAX_SNAPSHOTS) snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
}

export function samplePlayers(now = performance.now()): SampledPlayer[] {
  if (snapshots.length === 0) return [];
  const renderTime = now - INTERP_DELAY_MS;

  let laterIndex = snapshots.findIndex((snapshot) => snapshot.time >= renderTime);
  if (laterIndex < 0) laterIndex = snapshots.length - 1;
  const earlierIndex = Math.max(0, laterIndex - 1);
  const earlier = snapshots[earlierIndex];
  const later = snapshots[laterIndex];

  const ids = new Set<number>([...earlier.players.keys(), ...later.players.keys()]);
  const result: SampledPlayer[] = [];
  for (const id of ids) {
    const sampled = sampleId(id, earlier, later, renderTime);
    if (sampled) result.push(sampled);
  }
  return result;
}

export function samplePlayer(id: number, now = performance.now()): SampledPlayer | null {
  if (snapshots.length === 0) return null;
  const renderTime = now - INTERP_DELAY_MS;
  let laterIndex = snapshots.findIndex((snapshot) => snapshot.time >= renderTime);
  if (laterIndex < 0) laterIndex = snapshots.length - 1;
  const earlierIndex = Math.max(0, laterIndex - 1);
  return sampleId(id, snapshots[earlierIndex], snapshots[laterIndex], renderTime);
}

function sampleId(
  id: number,
  earlier: Snapshot,
  later: Snapshot,
  renderTime: number,
): SampledPlayer | null {
  const from = earlier.players.get(id);
  const to = later.players.get(id) ?? from;
  const start = from ?? to;
  if (!start || !to) return null;

  if (start.spawn !== to.spawn) {
    return { ...to, interpolated: false };
  }

  positionA.set(start.x, start.y, start.z);
  positionB.set(to.x, to.y, to.z);
  if (positionA.distanceTo(positionB) > SNAP_DISTANCE) {
    return { ...to, interpolated: false };
  }

  let t = 1;
  if (later.time > earlier.time) {
    t = THREE.MathUtils.clamp((renderTime - earlier.time) / (later.time - earlier.time), 0, 1);
  }

  quatA.set(start.qx, start.qy, start.qz, start.qw);
  quatB.set(to.qx, to.qy, to.qz, to.qw);
  quatA.slerp(quatB, t);

  velocityA.set(start.vx, start.vy, start.vz);
  velocityB.set(to.vx, to.vy, to.vz);
  velocityA.lerp(velocityB, t);
  positionA.lerp(positionB, t);

  if (t >= 1 && renderTime > later.time) {
    const extra = Math.min((renderTime - later.time) / 1000, MAX_EXTRAPOLATE_S);
    positionA.addScaledVector(velocityA, extra);
  }

  return {
    ...to,
    x: positionA.x,
    y: positionA.y,
    z: positionA.z,
    qx: quatA.x,
    qy: quatA.y,
    qz: quatA.z,
    qw: quatA.w,
    vx: velocityA.x,
    vy: velocityA.y,
    vz: velocityA.z,
    throttle: THREE.MathUtils.lerp(start.throttle, to.throttle, t),
    airspeed: THREE.MathUtils.lerp(start.airspeed, to.airspeed, t),
    verticalSpeed: THREE.MathUtils.lerp(start.verticalSpeed, to.verticalSpeed, t),
    angleOfAttack: THREE.MathUtils.lerp(start.angleOfAttack, to.angleOfAttack, t),
    grounded: t < 0.5 ? start.grounded : to.grounded,
    crashed: start.crashed || to.crashed,
    interpolated: true,
  };
}
