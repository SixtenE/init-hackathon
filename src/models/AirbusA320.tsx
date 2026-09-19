import { useGLTF } from "@react-three/drei";

// Runtime asset: Draco-compressed GLB exported via the asset pipeline
// (see assets-source/README.md). Never load .fbx/.blend files in the browser.
export const AIRBUS_A320_MODEL = "/models/airbus-a320.glb";

export function AirbusA320() {
  const { scene } = useGLTF(AIRBUS_A320_MODEL);
  return <primitive object={scene} />;
}

useGLTF.preload(AIRBUS_A320_MODEL);
