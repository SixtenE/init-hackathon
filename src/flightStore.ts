import { create } from "zustand";
import type { PlayerState } from "./net/protocol";

const SPAWN_AIRSPEED = (250 * 0.514444) / 3;
const SPAWN_THROTTLE = (250 / 330) ** 2;

type FlightTelemetry = {
  pitch: number;
  bank: number;
  heading: number;
  airspeed: number;
  throttle: number;
  verticalSpeed: number;
  angleOfAttack: number;
  grounded: boolean;
  position: { x: number; y: number; z: number };
};

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type RaceStatus = "ready" | "racing" | "finished";

export type RaceState = {
  status: RaceStatus;
  /** Index of the gate the pilot must fly through next. */
  nextGate: number;
  gateCount: number;
  startTime: number | null;
  finishTime: number | null;
  bestTime: number | null;
  /** Elapsed ms at each passed gate, in order. */
  splits: number[];
};

const initialRace = (gateCount: number): RaceState => ({
  status: "ready",
  nextGate: 0,
  gateCount,
  startTime: null,
  finishTime: null,
  bestTime: null,
  splits: [],
});

export const PLAYER_SPAWN_GRACE_MS = 2500;

type FlightState = FlightTelemetry & {
  race: RaceState;
  passGate: (index: number, now: number) => void;
  resetRace: () => void;
  setGateCount: (count: number) => void;
  /** performance.now() until local player-vs-player hits are ignored; 0 = armed. */
  spawnProtectedUntil: number;
  beginSpawnProtection: (durationMs?: number) => void;
  debug: boolean;
  danielMode: boolean;
  fps: number;
  crashed: boolean;
  crashReason: string | null;
  resetVersion: number;
  connection: ConnectionStatus;
  localPlayerId: number | null;
  players: PlayerState[];
  playerIds: number[];
  toggleDebug: () => void;
  toggleDanielMode: () => void;
  crash: (reason: string) => void;
  resetFlight: () => void;
  setFps: (fps: number) => void;
  setTelemetry: (telemetry: FlightTelemetry) => void;
  setConnection: (connection: ConnectionStatus, playerId?: number | null) => void;
  applyServerState: (players: PlayerState[]) => void;
  upsertPlayer: (player: PlayerState) => void;
  removePlayer: (id: number) => void;
};

export const useFlightStore = create<FlightState>((set) => ({
  debug: false,
  danielMode: false,
  fps: 0,
  pitch: 0,
  bank: 0,
  heading: 0,
  airspeed: SPAWN_AIRSPEED,
  throttle: SPAWN_THROTTLE,
  verticalSpeed: 0,
  angleOfAttack: 0,
  grounded: false,
  position: { x: 0, y: 0, z: 0 },
  crashed: false,
  crashReason: null,
  resetVersion: 0,
  connection: "disconnected",
  localPlayerId: null,
  players: [],
  playerIds: [],
  race: initialRace(0),
  spawnProtectedUntil: 0,
  beginSpawnProtection: (durationMs = PLAYER_SPAWN_GRACE_MS) =>
    set({ spawnProtectedUntil: performance.now() + durationMs }),
  setGateCount: (count) =>
    set((state) => (state.race.gateCount === count ? state : { race: initialRace(count) })),
  passGate: (index, now) =>
    set((state) => {
      const race = state.race;
      if (state.crashed || race.status === "finished" || index !== race.nextGate) return state;
      const startTime = race.startTime ?? now;
      const elapsed = now - startTime;
      const splits = [...race.splits, elapsed];
      const finished = index === race.gateCount - 1;
      return {
        race: {
          ...race,
          status: finished ? "finished" : "racing",
          nextGate: finished ? race.gateCount : index + 1,
          startTime,
          finishTime: finished ? elapsed : null,
          bestTime: finished
            ? race.bestTime == null
              ? elapsed
              : Math.min(race.bestTime, elapsed)
            : race.bestTime,
          splits,
        },
      };
    }),
  resetRace: () =>
    set((state) => ({
      race: { ...initialRace(state.race.gateCount), bestTime: state.race.bestTime },
    })),
  toggleDebug: () => set((state) => ({ debug: !state.debug })),
  toggleDanielMode: () => set((state) => ({ danielMode: !state.danielMode })),
  crash: (reason) => set((state) => state.crashed ? state : {
    crashed: true,
    crashReason: reason,
  }),
  resetFlight: () => set((state) => ({
    pitch: 0,
    bank: 0,
    heading: 0,
    airspeed: SPAWN_AIRSPEED,
    throttle: SPAWN_THROTTLE,
    verticalSpeed: 0,
    angleOfAttack: 0,
    grounded: false,
    position: { x: 0, y: 0, z: 0 },
    crashed: false,
    crashReason: null,
    resetVersion: state.resetVersion + 1,
    spawnProtectedUntil: performance.now() + PLAYER_SPAWN_GRACE_MS,
    race: { ...initialRace(state.race.gateCount), bestTime: state.race.bestTime },
  })),
  setFps: (fps) => set({ fps }),
  setTelemetry: (telemetry) => set(telemetry),
  setConnection: (connection, playerId) =>
    set((state) => ({
      connection,
      localPlayerId: playerId === undefined ? state.localPlayerId : playerId,
      ...(connection === "disconnected" ? { players: [], playerIds: [] } : {}),
    })),
  applyServerState: (players) =>
    set((state) => {
      const ids = players.map((player) => player.id);
      const idsChanged =
        ids.length !== state.playerIds.length || ids.some((id, index) => id !== state.playerIds[index]);
      return {
        players,
        playerIds: idsChanged ? ids : state.playerIds,
      };
    }),
  upsertPlayer: (player) =>
    set((state) => {
      const index = state.players.findIndex((entry) => entry.id === player.id);
      if (index >= 0) {
        const players = state.players.slice();
        players[index] = player;
        return { players };
      }
      return {
        players: [...state.players, player],
        playerIds: [...state.playerIds, player.id],
      };
    }),
  removePlayer: (id) =>
    set((state) => {
      if (!state.playerIds.includes(id)) return state;
      return {
        players: state.players.filter((player) => player.id !== id),
        playerIds: state.playerIds.filter((playerId) => playerId !== id),
      };
    }),
}));
