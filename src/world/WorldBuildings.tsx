import { SolidBuilding } from "./SolidBuilding";
import { gameMap } from "./map";

export function WorldBuildings({ groundY }: { groundY: number }) {
  return (
    <group>
      {gameMap.buildings.map((building) => (
        <SolidBuilding key={building.id} building={building} groundY={groundY} />
      ))}
    </group>
  );
}
