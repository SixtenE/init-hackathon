import { useLoader } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { PROP_MODEL_URLS, type PropModelId } from "./cityAssetCatalog";
import { fbxSourceBounds, InstancedFbx } from "./InstancedFbx";
import { LowPolyTrees } from "./LowPolyTrees";
import { gameMap, type MapProp } from "./map";

const VEHICLE_MODELS = ["city-car", "pickup", "food-truck"] as const satisfies readonly PropModelId[];

const VEHICLE_LENGTH: Record<(typeof VEHICLE_MODELS)[number], number> = {
  "city-car": 4.4,
  pickup: 5.1,
  "food-truck": 6.2,
};

const propLoadingManager = new THREE.LoadingManager();
propLoadingManager.setURLModifier((url) => {
  const clean = url.split(/[?#]/)[0] ?? url;
  if (!/\.(png|jpe?g)$/i.test(clean)) return url;
  const name = decodeURIComponent((clean.split(/[/\\]/).pop() ?? clean).replace(/\+/g, " "));
  return `/models/city/${name}`;
});

function configurePropLoader(loader: { manager: THREE.LoadingManager }) {
  loader.manager = propLoadingManager;
}

const preparedVehicles = new WeakSet<THREE.Object3D>();

function prepareVehicleMaterials(object: THREE.Object3D) {
  if (preparedVehicles.has(object)) return;
  preparedVehicles.add(object);
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || !("map" in material)) continue;
      const textured = material as THREE.MeshStandardMaterial;
      if (textured.map) textured.map.colorSpace = THREE.SRGBColorSpace;
    }
  });
}

function InstancedVehicleGroup({
  model,
  cars,
  groundY,
}: {
  model: (typeof VEHICLE_MODELS)[number];
  cars: MapProp[];
  groundY: number;
}) {
  const object = useLoader(FBXLoader, PROP_MODEL_URLS[model], configurePropLoader);
  const bounds = useMemo(() => {
    prepareVehicleMaterials(object);
    return fbxSourceBounds(object);
  }, [object]);

  const instances = useMemo(() => {
    const sourceLength = Math.max(bounds.size.x, bounds.size.z, 1e-4);
    const baseLength = VEHICLE_LENGTH[model];
    return cars.map((car) => {
      const scale = (baseLength / sourceLength) * car.scale;
      return {
        position: [car.x, groundY, car.z] as [number, number, number],
        rotationY: car.rotation,
        scale: [scale, scale, scale] as [number, number, number],
      };
    });
  }, [cars, groundY, bounds, model]);

  return <InstancedFbx object={object} instances={instances} prepare={prepareVehicleMaterials} />;
}

function InstancedVehicles({ groundY }: { groundY: number }) {
  const byModel = useMemo(() => {
    const groups = new Map<(typeof VEHICLE_MODELS)[number], MapProp[]>();
    for (const car of gameMap.cars) {
      if (!VEHICLE_MODELS.includes(car.model as (typeof VEHICLE_MODELS)[number])) continue;
      const model = car.model as (typeof VEHICLE_MODELS)[number];
      const list = groups.get(model);
      if (list) list.push(car);
      else groups.set(model, [car]);
    }
    return groups;
  }, []);

  return (
    <>
      {[...byModel.entries()].map(([model, cars]) => (
        <InstancedVehicleGroup key={model} model={model} cars={cars} groundY={groundY} />
      ))}
    </>
  );
}

export function WorldDecorations({ groundY }: { groundY: number }) {
  return (
    <group position={[0, groundY, 0]}>
      <LowPolyTrees trees={gameMap.trees} />
      <InstancedVehicles groundY={0} />
    </group>
  );
}

VEHICLE_MODELS.forEach((model) =>
  useLoader.preload(FBXLoader, PROP_MODEL_URLS[model], configurePropLoader),
);
