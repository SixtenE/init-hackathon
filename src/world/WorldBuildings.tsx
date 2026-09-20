import { useLoader } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo } from "react";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { CITY_MODEL_URLS, type CityModelId } from "./cityAssetCatalog";
import { fbxSourceBounds, InstancedFbx, useFbx } from "./InstancedFbx";
import { WorldDecorations } from "./WorldDecorations";
import { WorldStreets } from "./WorldStreets";
import { BUILDING_CELL, gameMap, type MapBuilding } from "./map";

function BuildingColliders({ groundY }: { groundY: number }) {
  return (
    <RigidBody type="fixed" colliders={false} name="buildings" position={[0, groundY, 0]}>
      {gameMap.buildings.map((building) => {
        const width = building.width * BUILDING_CELL;
        const height = building.floors * BUILDING_CELL;
        const depth = building.depth * BUILDING_CELL;
        return (
          <CuboidCollider
            key={building.id}
            name="building"
            args={[width / 2, height / 2, depth / 2]}
            position={[building.x, height / 2, building.z]}
            rotation={[0, building.rotation, 0]}
            friction={0.7}
            restitution={0.02}
          />
        );
      })}
    </RigidBody>
  );
}

function InstancedBuildingGroup({
  model,
  buildings,
  groundY,
}: {
  model: CityModelId;
  buildings: MapBuilding[];
  groundY: number;
}) {
  const object = useFbx(CITY_MODEL_URLS[model]);
  const bounds = useMemo(() => fbxSourceBounds(object), [object]);
  const instances = useMemo(
    () =>
      buildings.map((building) => {
        const width = building.width * BUILDING_CELL;
        const height = building.floors * BUILDING_CELL;
        const depth = building.depth * BUILDING_CELL;
        return {
          position: [building.x, groundY, building.z] as [number, number, number],
          rotationY: building.rotation,
          scale: [
            width / Math.max(bounds.size.x, 1e-4),
            height / Math.max(bounds.size.y, 1e-4),
            depth / Math.max(bounds.size.z, 1e-4),
          ] as [number, number, number],
        };
      }),
    [buildings, groundY, bounds],
  );

  return <InstancedFbx object={object} instances={instances} />;
}

function InstancedBuildings({ groundY }: { groundY: number }) {
  const byModel = useMemo(() => {
    const groups = new Map<CityModelId, MapBuilding[]>();
    for (const building of gameMap.buildings) {
      const list = groups.get(building.model);
      if (list) list.push(building);
      else groups.set(building.model, [building]);
    }
    return groups;
  }, []);

  return (
    <>
      {[...byModel.entries()].map(([model, buildings]) => (
        <InstancedBuildingGroup
          key={model}
          model={model}
          buildings={buildings}
          groundY={groundY}
        />
      ))}
    </>
  );
}

export function WorldBuildings({ groundY }: { groundY: number }) {
  return (
    <group>
      <WorldStreets groundY={groundY} />
      <WorldDecorations groundY={groundY} />
      <InstancedBuildings groundY={groundY} />
      <BuildingColliders groundY={groundY} />
    </group>
  );
}

Object.values(CITY_MODEL_URLS).forEach((url) => useLoader.preload(FBXLoader, url));
