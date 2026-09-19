import { create } from "zustand";

type FlightTelemetry = {
  airspeed: number;
  throttle: number;
  verticalSpeed: number;
  angleOfAttack: number;
  grounded: boolean;
  position: { x: number; y: number; z: number };
};

type FlightState = FlightTelemetry & {
  debug: boolean;
  fps: number;
  crashed: boolean;
  crashReason: string | null;
  resetVersion: number;
  toggleDebug: () => void;
  crash: (reason: string) => void;
  resetFlight: () => void;
  setFps: (fps: number) => void;
  setTelemetry: (telemetry: FlightTelemetry) => void;
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
}));
