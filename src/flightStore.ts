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
  connection: ConnectionStatus;
  localPlayerId: number | null;
  players: PlayerState[];
  playerIds: number[];
  toggleDebug: () => void;
  setConnection: (connection: ConnectionStatus, playerId?: number | null) => void;
  applyServerState: (players: PlayerState[]) => void;
  setFps: (fps: number) => void;
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
  connection: "disconnected",
  localPlayerId: null,
  players: [],
  playerIds: [],
  toggleDebug: () => set((state) => ({ debug: !state.debug })),
  setConnection: (connection, playerId) =>
    set((state) => ({
      connection,
      localPlayerId: playerId === undefined ? state.localPlayerId : playerId,
      ...(connection === "disconnected"
        ? { players: [], playerIds: [], crashed: false, crashReason: null }
        : {}),
    })),
  applyServerState: (players) =>
    set((state) => {
      const ids = players.map((player) => player.id);
      const idsChanged =
        ids.length !== state.playerIds.length || ids.some((id, index) => id !== state.playerIds[index]);
      const me = players.find((player) => player.id === state.localPlayerId);
      return {
        players,
        playerIds: idsChanged ? ids : state.playerIds,
        ...(me
          ? {
              airspeed: me.airspeed,
              throttle: me.throttle,
              verticalSpeed: me.verticalSpeed,
              angleOfAttack: me.angleOfAttack,
              grounded: me.grounded,
              position: { x: me.x, y: me.y, z: me.z },
              crashed: me.crashed,
              crashReason: me.crashed ? me.crashReason ?? "Crashed" : null,
            }
          : {}),
      };
    }),
  setFps: (fps) => set({ fps }),
}));
