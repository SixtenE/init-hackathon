import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { CityBuildingModel } from "./CityBuildingModel";
import type { MapBuilding } from "./map";

const BLOCK = 3.1;

export function SolidBuilding({
  building,
  groundY,
}: {
  building: MapBuilding;
  groundY: number;
}) {
  const width = building.width * BLOCK;
  const height = building.floors * BLOCK;
  const depth = building.depth * BLOCK;

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
      <CityBuildingModel model={building.model} size={[width, height, depth]} />
    </RigidBody>
  );
}
