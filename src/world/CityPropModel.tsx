import { Clone } from "@react-three/drei";
import { useLoader } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { PROP_MODEL_URLS, type PropModelId } from "./cityAssetCatalog";

const VEHICLE_MODELS = ["city-car", "pickup", "food-truck"] as const satisfies readonly PropModelId[];

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

const VEHICLE_LENGTH: Record<(typeof VEHICLE_MODELS)[number], number> = {
  "city-car": 4.4,
  pickup: 5.1,
  "food-truck": 6.2,
};

function meshBounds(object: THREE.Object3D): THREE.Box3 {
  const bounds = new THREE.Box3();
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    bounds.expandByObject(child);
  });
  if (bounds.isEmpty()) bounds.setFromObject(object);
  return bounds;
}

function prepareVehicleMaterials(object: THREE.Object3D) {
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

export function CityPropModel({
  model,
  scale = 1,
}: {
  model: PropModelId;
  scale?: number;
}) {
  const object = useLoader(FBXLoader, PROP_MODEL_URLS[model], configurePropLoader);
  const transform = useMemo(() => {
    prepareVehicleMaterials(object);
    const bounds = meshBounds(object);
    const sourceSize = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const length = VEHICLE_LENGTH[model as (typeof VEHICLE_MODELS)[number]] ?? 4.4;
    const sourceLength = Math.max(sourceSize.x, sourceSize.z);
    return {
      offset: [-center.x, -bounds.min.y, -center.z] as [number, number, number],
      scale: (length / Math.max(sourceLength, 1e-4)) * scale,
    };
  }, [object, model, scale]);

  return (
    <group scale={transform.scale}>
      <Clone object={object} position={transform.offset} />
    </group>
  );
}

VEHICLE_MODELS.forEach((model) => useLoader.preload(FBXLoader, PROP_MODEL_URLS[model], configurePropLoader));
