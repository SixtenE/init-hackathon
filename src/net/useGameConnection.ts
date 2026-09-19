import { useEffect } from "react";
import { gameClient } from "./gameClient";

export function useGameConnection(): void {
  useEffect(() => {
    gameClient.connect();
    return () => gameClient.disconnect();
  }, []);
}
