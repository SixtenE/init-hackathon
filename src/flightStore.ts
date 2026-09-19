import { create } from "zustand";
import type { PlayerState } from "./net/protocol";

type FlightTelemetry = {
  airspeed: number;
  throttle: number;
  verticalSpeed: number;
  angleOfAttack: number;
  grounded: boolean;
  position: { x: number; y: number; z: number };
};

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

type FlightState = FlightTelemetry & {
  debug: boolean;
  fps: number;
  crashed: boolean;
  crashReason: string | null;
  resetVersion: number;
  connection: ConnectionStatus;
  localPlayerId: number | null;
  players: PlayerState[];
  playerIds: number[];
  toggleDebug: () => void;
  crash: (reason: string) => void;
  resetFlight: () => void;
  setFps: (fps: number) => void;
  setTelemetry: (telemetry: FlightTelemetry) => void;
  setConnection: (connection: ConnectionStatus, playerId?: number | null) => void;
  applyServerState: (players: PlayerState[]) => void;
};

export const useFlightStore = create<FlightState>((set) => ({
  debug: false,
  fps: 0,
  airspeed: 0,
  throttle: 0,
  verticalSpeed: 0,
  angleOfAttack: 0,
  grounded: true,
  position: { x: 0, y: 0, z: 0 },
  crashed: false,
  crashReason: null,
  resetVersion: 0,
  connection: "disconnected",
  localPlayerId: null,
  players: [],
  playerIds: [],
  toggleDebug: () => set((state) => ({ debug: !state.debug })),
  crash: (reason) => set((state) => state.crashed ? state : {
    crashed: true,
    crashReason: reason,
  }),
  resetFlight: () => set((state) => ({
    airspeed: 0,
    throttle: 0,
    verticalSpeed: 0,
    angleOfAttack: 0,
    grounded: true,
    position: { x: 0, y: 0, z: 0 },
    crashed: false,
    crashReason: null,
    resetVersion: state.resetVersion + 1,
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
}));
