export type FlightPose = {
  seq: number;
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

export type PlayerState = FlightPose & {
  id: number;
  name: string;
};

export type WelcomeMessage = {
  type: "welcome";
  id: number;
  tick: number;
  players?: PlayerState[];
};

export type StateMessage = {
  type: "state";
  tick: number;
  players: PlayerState[];
};

export type JoinMessage = {
  type: "join";
  player: PlayerState;
};

export type LeaveMessage = {
  type: "leave";
  id: number;
};

export type ServerMessage =
  | WelcomeMessage
  | StateMessage
  | JoinMessage
  | LeaveMessage
  | { type: string };

const DEFAULT_PORT = "8080";
const NAME_KEY = "flight_pilot_name";

export function isWelcome(message: ServerMessage): message is WelcomeMessage {
  return message.type === "welcome" && Number.isFinite((message as WelcomeMessage).id);
}

export function isState(message: ServerMessage): message is StateMessage {
  return message.type === "state" && Array.isArray((message as StateMessage).players);
}

export function isJoin(message: ServerMessage): message is JoinMessage {
  const player = (message as JoinMessage).player;
  return message.type === "join" && !!player && Number.isFinite(player.id);
}

export function isLeave(message: ServerMessage): message is LeaveMessage {
  return message.type === "leave" && Number.isFinite((message as LeaveMessage).id);
}

export function defaultWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return String(import.meta.env.VITE_WS_URL);

  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("server");
  if (explicit) return explicit;

  // Production: same-origin /ws behind TLS, matching jump-prince.
  if (window.location.protocol === "https:") {
    return `wss://${window.location.host}/ws`;
  }

  // Local HTTP: talk to the C++ relay directly. Override with ?port=8081.
  const port = params.get("port") ?? DEFAULT_PORT;
  return `ws://${window.location.hostname}:${port}`;
}

export function randomPilotName(): string {
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return `Pilot-${suffix}`;
}

export function loadPilotName(): string {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("name")?.trim();
  if (fromQuery) {
    const name = fromQuery.slice(0, 20);
    persistPilotName(name);
    return name;
  }
  try {
    const stored = localStorage.getItem(NAME_KEY);
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  const name = randomPilotName();
  persistPilotName(name);
  return name;
}

function persistPilotName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

const SESSION_KEY = "flight_pilot_session";

export function loadPilotSession(): string {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  const session = crypto.randomUUID();
  try {
    sessionStorage.setItem(SESSION_KEY, session);
  } catch {
    /* ignore */
  }
  return session;
}

export function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
