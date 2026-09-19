import { useEffect, useRef } from "react";
import { gameClient } from "./gameClient";

type KeyState = Record<string, boolean>;

const FLIGHT_KEYS = new Set(["Space", "ShiftLeft", "ShiftRight", "KeyW", "KeyA", "KeyS", "KeyD"]);

function readAxes(keys: KeyState) {
  return {
    throttle: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
    turn: (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0),
    pitch: (keys.Space ? 1 : 0) - (keys.ShiftLeft || keys.ShiftRight ? 1 : 0),
  };
}

export function useGameConnection(): void {
  const keys = useRef<KeyState>({});
  const seq = useRef(0);

  useEffect(() => {
    gameClient.connect();
    return () => gameClient.disconnect();
  }, []);

  useEffect(() => {
    const send = () => {
      seq.current += 1;
      gameClient.sendInput({ seq: seq.current, ...readAxes(keys.current) });
    };

    const down = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) return;
      if (FLIGHT_KEYS.has(event.code)) event.preventDefault();
      keys.current[event.code] = true;
      send();
    };
    const up = (event: KeyboardEvent) => {
      keys.current[event.code] = false;
      if (
        event.code === "MetaLeft" ||
        event.code === "MetaRight" ||
        event.code === "ControlLeft" ||
        event.code === "ControlRight"
      ) {
        keys.current = {};
      }
      send();
    };
    const release = () => {
      keys.current = {};
      send();
    };
    const visibility = () => {
      if (document.hidden) release();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", visibility);
    const interval = window.setInterval(send, 50);

    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
      window.clearInterval(interval);
    };
  }, []);
}
