import { useEffect } from "react";
import { gameClient } from "./gameClient";

export function useGameConnection(): void {
  useEffect(() => {
    // React StrictMode mounts, unmounts, then mounts again synchronously.
    // Delay the socket so the discarded first mount never opens a connection.
    const timer = window.setTimeout(() => gameClient.connect(), 0);
    return () => {
      window.clearTimeout(timer);
      gameClient.disconnect();
    };
  }, []);
}
