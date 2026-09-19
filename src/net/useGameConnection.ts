import { useEffect } from "react";
import { gameClient } from "./gameClient";

export function useGameConnection(): void {
  useEffect(() => {
    // React StrictMode mounts, unmounts, then mounts again synchronously.
    // Delay the socket so the discarded first mount never opens a connection.
    const timer = window.setTimeout(() => gameClient.connect(), 0);
    const onPageHide = () => gameClient.disconnect();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) gameClient.connect();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      gameClient.disconnect();
    };
  }, []);
}
