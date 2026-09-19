import { useFlightStore } from "../flightStore";
import {
  defaultWsUrl,
  finiteOrZero,
  isJoin,
  isLeave,
  isState,
  isWelcome,
  loadPilotName,
  loadPilotSession,
  type FlightPose,
  type ServerMessage,
} from "./protocol";
import { pushSnapshot, removePlayerSnapshots, resetSnapshots, upsertPlayerSnapshot } from "./snapshots";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

type FlightWindow = Window & {
  __flightClient?: GameClient;
  __flightSocket?: WebSocket;
};

function flightWindow(): FlightWindow {
  return window as FlightWindow;
}

class GameClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;
  private stopped = true;
  private generation = 0;
  private readonly name = loadPilotName();
  private readonly session = loadPilotSession();
  private lastPose: FlightPose | null = null;

  get playerName(): string {
    return this.name;
  }

  connect(): void {
    const w = flightWindow();
    if (w.__flightClient && w.__flightClient !== this) {
      w.__flightClient.disconnect();
    }
    w.__flightClient = this;
    this.stopped = false;
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.open();
  }

  disconnect(): void {
    this.stopped = true;
    this.clearReconnect();
    this.closeSocket();
    resetSnapshots();
    useFlightStore.getState().setConnection("disconnected", null);
  }

  sendPose(pose: FlightPose): void {
    this.lastPose = pose;
    this.send({
      type: "pose",
      ...pose,
      x: finiteOrZero(pose.x),
      y: finiteOrZero(pose.y),
      z: finiteOrZero(pose.z),
      qx: finiteOrZero(pose.qx),
      qy: finiteOrZero(pose.qy),
      qz: finiteOrZero(pose.qz),
      qw: Number.isFinite(pose.qw) ? pose.qw : 1,
      vx: finiteOrZero(pose.vx),
      vy: finiteOrZero(pose.vy),
      vz: finiteOrZero(pose.vz),
      throttle: finiteOrZero(pose.throttle),
      airspeed: finiteOrZero(pose.airspeed),
      verticalSpeed: finiteOrZero(pose.verticalSpeed),
      angleOfAttack: finiteOrZero(pose.angleOfAttack),
      crashReason: pose.crashReason ?? undefined,
    });
  }

  sendReset(): void {
    this.lastPose = null;
    this.send({ type: "reset" });
  }

  private open(): void {
    if (this.stopped) return;
    this.closeSocket();
    const generation = this.generation;
    this.setStatus("connecting");
    const url = defaultWsUrl();
    const socket = new WebSocket(url);
    this.socket = socket;
    const w = flightWindow();
    if (w.__flightSocket && w.__flightSocket !== socket) {
      try {
        w.__flightSocket.close();
      } catch {
        /* already closed */
      }
    }
    w.__flightSocket = socket;

    socket.addEventListener("open", () => {
      if (this.stopped || this.generation !== generation) {
        socket.close();
        return;
      }
      this.attempts = 0;
      this.send({ type: "hello", name: this.name, session: this.session });
      if (this.lastPose) this.sendPose(this.lastPose);
    });

    socket.addEventListener("message", (event) => {
      if (this.generation !== generation || this.socket !== socket) return;
      this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (this.generation !== generation) return;
      if (this.socket === socket) this.socket = null;
      this.setStatus("disconnected");
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.generation !== generation) return;
      socket.close();
    });
  }

  private closeSocket(): void {
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    if (flightWindow().__flightSocket === socket) {
      flightWindow().__flightSocket = undefined;
    }
    if (!socket) return;
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer === null) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private handleMessage(raw: unknown): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }

    if (isWelcome(message)) {
      const others = (message.players ?? []).filter(
        (player) => player.id !== message.id,
      );
      this.setStatus("connected", message.id);
      if (others.length > 0) {
        pushSnapshot({ type: "state", tick: message.tick, players: others });
        useFlightStore.getState().applyServerState(others);
      }
      return;
    }

    if (isJoin(message)) {
      if (message.player.id === useFlightStore.getState().localPlayerId) return;
      upsertPlayerSnapshot(message.player, 0);
      useFlightStore.getState().upsertPlayer(message.player);
      return;
    }

    if (isLeave(message)) {
      removePlayerSnapshots(message.id);
      useFlightStore.getState().removePlayer(message.id);
      return;
    }

    if (isState(message)) {
      const localId = useFlightStore.getState().localPlayerId;
      const players = localId == null
        ? message.players
        : message.players.filter((player) => player.id !== localId);
      pushSnapshot({ ...message, players });
      useFlightStore.getState().applyServerState(players);
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  private setStatus(status: ConnectionStatus, playerId?: number | null): void {
    useFlightStore.getState().setConnection(status, playerId === undefined ? undefined : playerId);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.clearReconnect();
    this.attempts += 1;
    const delay = Math.min(250 * 2 ** Math.min(this.attempts, 4), 3000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }
}

export const gameClient = new GameClient();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    gameClient.disconnect();
  });
}
