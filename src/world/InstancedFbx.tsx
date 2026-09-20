import { useLoader } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

export type FbxInstance = {
  /** World translation of the model origin (usually ground-level centre). */
  position: [number, number, number];
  /** Yaw about world +Y. */
  rotationY: number;
  /** Non-uniform scale applied after centering the source bounds. */
  scale: [number, number, number];
};

type MeshPart = {
  key: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  /** Mesh transform relative to the FBX root. */
  localMatrix: THREE.Matrix4;
};

const scratchMatrix = new THREE.Matrix4();
const scratchScale = new THREE.Matrix4();
const scratchOffset = new THREE.Matrix4();
const scratchRotation = new THREE.Matrix4();
const scratchPosition = new THREE.Matrix4();

function collectMeshParts(root: THREE.Object3D): MeshPart[] {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts: MeshPart[] = [];
  let index = 0;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    parts.push({
      key: `${mesh.name || "mesh"}-${index}`,
      geometry: mesh.geometry,
      material: mesh.material,
      localMatrix: new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld),
    });
    index += 1;
  });
  return parts;
}

export function fbxSourceBounds(root: THREE.Object3D): {
  size: THREE.Vector3;
  center: THREE.Vector3;
  minY: number;
} {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  return {
    size: bounds.getSize(new THREE.Vector3()),
    center: bounds.getCenter(new THREE.Vector3()),
    minY: bounds.min.y,
  };
}

function writeInstanceMatrix(
  target: THREE.Matrix4,
  instance: FbxInstance,
  offset: THREE.Vector3,
  localMatrix: THREE.Matrix4,
) {
  scratchPosition.makeTranslation(instance.position[0], instance.position[1], instance.position[2]);
  scratchRotation.makeRotationY(instance.rotationY);
  scratchScale.makeScale(instance.scale[0], instance.scale[1], instance.scale[2]);
  scratchOffset.makeTranslation(offset.x, offset.y, offset.z);
  target
    .copy(scratchPosition)
    .multiply(scratchRotation)
    .multiply(scratchScale)
    .multiply(scratchOffset)
    .multiply(localMatrix);
}

function InstancedMeshPart({
  part,
  instances,
  offset,
}: {
  part: MeshPart;
  instances: FbxInstance[];
  offset: THREE.Vector3;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < instances.length; i++) {
      writeInstanceMatrix(scratchMatrix, instances[i], offset, part.localMatrix);
      mesh.setMatrixAt(i, scratchMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [instances, offset, part.localMatrix]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[part.geometry, part.material, instances.length]}
      frustumCulled
    />
  );
}

/**
 * Renders many copies of an FBX as InstancedMeshes (one draw call per unique
 * child mesh). Callers supply per-instance position / yaw / scale; this helper
 * centers the source AABB on the ground like CityBuildingModel / CityPropModel.
 */
export function InstancedFbx({
  object,
  instances,
  prepare,
}: {
  object: THREE.Object3D;
  instances: FbxInstance[];
  prepare?: (object: THREE.Object3D) => void;
}) {
  const prepared = useMemo(() => {
    prepare?.(object);
    const bounds = fbxSourceBounds(object);
    const parts = collectMeshParts(object);
    const offset = new THREE.Vector3(-bounds.center.x, -bounds.minY, -bounds.center.z);
    return { parts, offset, bounds };
  }, [object, prepare]);

  if (instances.length === 0) return null;

  return (
    <group>
      {prepared.parts.map((part) => (
        <InstancedMeshPart
          key={part.key}
          part={part}
          instances={instances}
          offset={prepared.offset}
        />
      ))}
    </group>
  );
}

export function useFbx(url: string, configure?: (loader: FBXLoader) => void) {
  return useLoader(FBXLoader, url, configure);
}

export { FBXLoader };
