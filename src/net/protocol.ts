export type FlightInput = {
  seq: number;
  throttle: number;
  turn: number;
  pitch: number;
};

export type PlayerState = {
  id: number;
  name: string;
  spawn: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  throttle: number;
  airspeed: number;
  verticalSpeed: number;
  angleOfAttack: number;
  grounded: boolean;
  crashed: boolean;
  crashReason?: string | null;
};

export type WelcomeMessage = {
  type: "welcome";
  id: number;
  tick: number;
};

export type StateMessage = {
  type: "state";
  tick: number;
  players: PlayerState[];
};

export type ServerMessage = WelcomeMessage | StateMessage | { type: string };

export function isWelcome(message: ServerMessage): message is WelcomeMessage {
  return message.type === "welcome";
}

export function isState(message: ServerMessage): message is StateMessage {
  return message.type === "state" && Array.isArray((message as StateMessage).players);
}

export function defaultWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return String(import.meta.env.VITE_WS_URL);
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function randomPilotName(): string {
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return `Pilot-${suffix}`;
}
