import { useMemo } from "react";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { CityBuildingModel } from "./CityBuildingModel";
import { BUILDING_CELL, type MapBuilding } from "./map";

export function SolidBuilding({
  building,
  groundY,
}: {
  building: MapBuilding;
  groundY: number;
}) {
  const width = building.width * BUILDING_CELL;
  const height = building.floors * BUILDING_CELL;
  const depth = building.depth * BUILDING_CELL;
  const size = useMemo(
    () => [width, height, depth] as [number, number, number],
    [width, height, depth],
  );

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      name="building"
      position={[building.x, groundY, building.z]}
      rotation={[0, building.rotation, 0]}
    >
      <CuboidCollider
        name="building"
        args={[width / 2, height / 2, depth / 2]}
        position={[0, height / 2, 0]}
        friction={0.7}
        restitution={0.02}
      />
      <CityBuildingModel model={building.model} size={size} />
    </RigidBody>
  );
}
