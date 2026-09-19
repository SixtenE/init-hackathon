import { useFlightStore } from "../flightStore";
import { CrumblingBuilding } from "./CrumblingBuilding";
import { gameMap } from "./map";

export function WorldBuildings({ groundY }: { groundY: number }) {
  const resetVersion = useFlightStore((state) => state.resetVersion);

  return (
    <group key={`buildings-${resetVersion}`}>
      {gameMap.buildings.map((building) => (
        <CrumblingBuilding key={building.id} building={building} groundY={groundY} />
      ))}
    </group>
  );
}
