import { useFlightStore } from "../flightStore";
import {
  defaultWsUrl,
  isState,
  isWelcome,
  randomPilotName,
  type FlightInput,
  type ServerMessage,
} from "./protocol";
import { pushSnapshot, resetSnapshots } from "./snapshots";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

class GameClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;
  private stopped = true;
  private readonly name = randomPilotName();
  private lastInput: FlightInput | null = null;

  get playerName(): string {
    return this.name;
  }

  connect(): void {
    this.stopped = false;
    this.open();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    resetSnapshots();
    useFlightStore.getState().setConnection("disconnected", null);
  }

  sendInput(input: FlightInput): void {
    this.lastInput = input;
    this.send({ type: "input", ...input });
  }

  sendReset(): void {
    this.send({ type: "reset" });
  }

  private open(): void {
    if (this.stopped) return;
    this.setStatus("connecting");
    const url = defaultWsUrl();
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.attempts = 0;
      this.send({ type: "hello", name: this.name });
      if (this.lastInput) this.send({ type: "input", ...this.lastInput });
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setStatus("disconnected");
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  private handleMessage(raw: unknown): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }

    if (isWelcome(message)) {
      this.setStatus("connected", message.id);
      return;
    }

    if (isState(message)) {
      pushSnapshot(message);
      useFlightStore.getState().applyServerState(message.players);
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
    this.attempts += 1;
    const delay = Math.min(250 * 2 ** Math.min(this.attempts, 4), 3000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }
}

export const gameClient = new GameClient();
