import { Clone } from "@react-three/drei";
import { useLoader } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { CITY_MODEL_URLS, type CityModelId } from "./cityAssetCatalog";

export function CityBuildingModel({
  model,
  size,
}: {
  model: CityModelId;
  size: [number, number, number];
}) {
  const object = useLoader(FBXLoader, CITY_MODEL_URLS[model]);
  const transform = useMemo(() => {
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    const sourceSize = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    return {
      offset: [-center.x, -bounds.min.y, -center.z] as [number, number, number],
      scale: [
        size[0] / sourceSize.x,
        size[1] / sourceSize.y,
        size[2] / sourceSize.z,
      ] as [number, number, number],
    };
  }, [object, size]);

  return (
    <group scale={transform.scale}>
      <Clone object={object} position={transform.offset} />
    </group>
  );
}

Object.values(CITY_MODEL_URLS).forEach((url) => useLoader.preload(FBXLoader, url));
