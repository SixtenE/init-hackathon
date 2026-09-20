import { useEffect } from "react";
import { useFlightStore } from "../flightStore";
import { gameMap } from "../world/map";
import "./hud.css";

function formatRaceTime(ms: number) {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const hundredths = Math.floor((total % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

export function RaceFinishScreen() {
  const status = useFlightStore((state) => state.race.status);
  const finishTime = useFlightStore((state) => state.race.finishTime);
  const bestTime = useFlightStore((state) => state.race.bestTime);
  const gateCount = useFlightStore((state) => state.race.gateCount);
  const resetFlight = useFlightStore((state) => state.resetFlight);

  useEffect(() => {
    if (status !== "finished") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.repeat) return;
      if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        resetFlight();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, resetFlight]);

  if (status !== "finished" || finishTime == null) return null;

  const newBest = bestTime != null && finishTime === bestTime;

  return (
    <div className="race-finish" role="dialog" aria-label="Race finished" aria-modal="true">
      <p className="race-finish-kicker">{gameMap.course.name}</p>
      <h2 className="race-finish-title">Finish</h2>
      <p className="race-finish-time">{formatRaceTime(finishTime)}</p>
      {newBest ? (
        <p className="race-finish-best is-new">New best</p>
      ) : bestTime != null ? (
        <p className="race-finish-best">Best {formatRaceTime(bestTime)}</p>
      ) : null}
      <p className="race-finish-meta">{gateCount} checkpoints</p>
      <button type="button" className="race-finish-again" onClick={resetFlight}>
        Fly again
      </button>
      <p className="race-finish-hint">R / Enter</p>
    </div>
  );
}
