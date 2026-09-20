import { Clone, useGLTF } from "@react-three/drei";
import * as THREE from "three";

// Runtime asset: Draco-compressed GLB exported via the asset pipeline
// (see assets-source/README.md). Never load .fbx/.blend files in the browser.
export const AIRBUS_A320_MODEL = "/models/airbus-a320.glb";

const WHITE = new THREE.Color("#ffffff");
const EXTERIOR_MATERIAL = "PaletteMaterial001";
const paintedMaterials = new WeakSet<THREE.Material>();
const strippedScenes = new WeakSet<THREE.Object3D>();

function paintAircraftWhite(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || paintedMaterials.has(material)) continue;
      // Exterior livery lives on this palette; cockpit screens keep their textures.
      if (material.name !== EXTERIOR_MATERIAL) continue;
      paintedMaterials.add(material);
      const std = material as THREE.MeshStandardMaterial;
      std.color.copy(WHITE);
      std.map = null;
      std.needsUpdate = true;
    }
  });
}

/**
 * Chase camera never sees the cockpit. Hide non-exterior materials (including
 * multi-material Body groups) so those draw calls and texture samples stop.
 * Mutate the shared scene before Clone so every instance inherits the strip.
 */
function hideCockpitMeshes(root: THREE.Object3D) {
  if (strippedScenes.has(root)) return;
  strippedScenes.add(root);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let exteriorCount = 0;
    for (const material of materials) {
      if (!material) continue;
      if (material.name === EXTERIOR_MATERIAL) {
        exteriorCount += 1;
        continue;
      }
      material.visible = false;
    }
    if (exteriorCount === 0) mesh.visible = false;
  });
}

export function AirbusA320() {
  const { scene } = useGLTF(AIRBUS_A320_MODEL);
  paintAircraftWhite(scene);
  hideCockpitMeshes(scene);
  return <Clone object={scene} />;
}

useGLTF.preload(AIRBUS_A320_MODEL);
