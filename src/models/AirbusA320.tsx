import { Clone, useGLTF } from "@react-three/drei";

// Runtime asset: Draco-compressed GLB exported via the asset pipeline
// (see assets-source/README.md). Never load .fbx/.blend files in the browser.
export const AIRBUS_A320_MODEL = "/models/airbus-a320.glb";

export function AirbusA320() {
  const { scene } = useGLTF(AIRBUS_A320_MODEL);
  // Clone so every networked aircraft can share the cached GLTF.
  return <Clone object={scene} />;
}

useGLTF.preload(AIRBUS_A320_MODEL);
