import { SolidBuilding } from "./SolidBuilding";
import { WorldDecorations } from "./WorldDecorations";
import { WorldStreets } from "./WorldStreets";
import { gameMap } from "./map";

export function WorldBuildings({ groundY }: { groundY: number }) {
  return (
    <group>
      <WorldStreets groundY={groundY} />
      <WorldDecorations groundY={groundY} />
      {gameMap.buildings.map((building) => (
        <SolidBuilding key={building.id} building={building} groundY={groundY} />
      ))}
    </group>
  );
}
