import { CityPropModel } from "./CityPropModel";
import { LowPolyTrees } from "./LowPolyTrees";
import { gameMap, type MapProp } from "./map";

function Vehicle({ prop }: { prop: MapProp }) {
  return (
    <group position={[prop.x, 0, prop.z]} rotation={[0, prop.rotation, 0]}>
      <CityPropModel model={prop.model} scale={prop.scale} />
    </group>
  );
}

export function WorldDecorations({ groundY }: { groundY: number }) {
  return (
    <group position={[0, groundY, 0]}>
      <LowPolyTrees trees={gameMap.trees} />
      {gameMap.cars.map((car) => (
        <Vehicle key={car.id} prop={car} />
      ))}
    </group>
  );
}
