import { useMemo } from "react";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import type { MapBuilding } from "./map";

const BLOCK = 3.1;

type BuildingGrid = {
  x: number;
  y: number;
  z: number;
};

const CONCRETE = new THREE.MeshStandardMaterial({
  color: "#c9c2b6",
  roughness: 0.92,
  metalness: 0.04,
});
const LOBBY = new THREE.MeshStandardMaterial({
  color: "#8d857b",
  roughness: 0.86,
  metalness: 0.06,
});
const ROOF = new THREE.MeshStandardMaterial({
  color: "#6e6861",
  roughness: 0.9,
  metalness: 0.08,
});
const PENTHOUSE = new THREE.MeshStandardMaterial({
  color: "#b7aea3",
  roughness: 0.88,
  metalness: 0.05,
});

function createFacadeTextures() {
  const width = 256;
  const height = 1024;
  const cols = 6;
  const rows = 50;
  const mapCanvas = document.createElement("canvas");
  const emitCanvas = document.createElement("canvas");
  mapCanvas.width = emitCanvas.width = width;
  mapCanvas.height = emitCanvas.height = height;
  const map = mapCanvas.getContext("2d")!;
  const emit = emitCanvas.getContext("2d")!;

  map.fillStyle = "#1a2734";
  map.fillRect(0, 0, width, height);
  emit.fillStyle = "#000000";
  emit.fillRect(0, 0, width, height);

  const cellW = width / cols;
  const cellH = height / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const lit = (col * 13 + row * 7 + 3) % 5 !== 0;
      const x = col * cellW + 5;
      const y = row * cellH + 7;
      const w = cellW - 10;
      const h = cellH - 12;
      map.fillStyle = lit ? "#cfe6ff" : "#141c24";
      map.fillRect(x, y, w, h);
      if (lit) {
        emit.fillStyle = "#9ec9ff";
        emit.fillRect(x, y, w, h);
      }
    }
  }

  const mapTexture = new THREE.CanvasTexture(mapCanvas);
  const emissiveTexture = new THREE.CanvasTexture(emitCanvas);
  mapTexture.colorSpace = THREE.SRGBColorSpace;
  mapTexture.anisotropy = 8;
  emissiveTexture.anisotropy = 8;
  mapTexture.wrapS = mapTexture.wrapT = THREE.RepeatWrapping;
  emissiveTexture.wrapS = emissiveTexture.wrapT = THREE.RepeatWrapping;
  return { mapTexture, emissiveTexture };
}

const { mapTexture, emissiveTexture } = createFacadeTextures();
const GLASS = new THREE.MeshStandardMaterial({
  map: mapTexture,
  emissive: "#b9d7ff",
  emissiveMap: emissiveTexture,
  emissiveIntensity: 0.42,
  roughness: 0.28,
  metalness: 0.45,
});

function buildingExtents(grid: BuildingGrid) {
  return {
    width: grid.x * BLOCK,
    height: grid.y * BLOCK,
    depth: grid.z * BLOCK,
  };
}

function Tower({ grid }: { grid: BuildingGrid }) {
  const { width, height, depth } = buildingExtents(grid);
  const glass = useMemo(() => {
    const material = GLASS.clone();
    const map = mapTexture.clone();
    const emit = emissiveTexture.clone();
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    emit.wrapS = emit.wrapT = THREE.RepeatWrapping;
    const repeatX = Math.max(grid.x / 4, 0.5);
    const repeatY = Math.max(grid.y / 28, 0.35);
    map.repeat.set(repeatX, repeatY);
    emit.repeat.set(repeatX, repeatY);
    material.map = map;
    material.emissiveMap = emit;
    return material;
  }, [grid.x, grid.y]);

  const glassY = height * 0.54;
  const glassH = height * 0.78;
  return (
    <group>
      <mesh position={[0, height / 2, 0]} material={CONCRETE}>
        <boxGeometry args={[width, height, depth]} />
      </mesh>
      <mesh position={[0, 1.55, 0]} material={LOBBY}>
        <boxGeometry args={[width + 0.18, 3.1, depth + 0.18]} />
      </mesh>
      <mesh position={[0, glassY, depth / 2 + 0.05]} material={glass}>
        <boxGeometry args={[width * 0.78, glassH, 0.12]} />
      </mesh>
      <mesh position={[0, glassY, -depth / 2 - 0.05]} material={glass}>
        <boxGeometry args={[width * 0.78, glassH, 0.12]} />
      </mesh>
      <mesh position={[width / 2 + 0.05, glassY, 0]} rotation={[0, Math.PI / 2, 0]} material={glass}>
        <boxGeometry args={[depth * 0.78, glassH, 0.12]} />
      </mesh>
      <mesh position={[-width / 2 - 0.05, glassY, 0]} rotation={[0, Math.PI / 2, 0]} material={glass}>
        <boxGeometry args={[depth * 0.78, glassH, 0.12]} />
      </mesh>
      <mesh position={[0, height + 0.28, 0]} material={ROOF}>
        <boxGeometry args={[width + 0.7, 0.55, depth + 0.7]} />
      </mesh>
      <mesh position={[0, height + 1.35, -0.4]} material={PENTHOUSE}>
        <boxGeometry args={[width * 0.36, 1.6, depth * 0.4]} />
      </mesh>
    </group>
  );
}

export function SolidBuilding({
  building,
  groundY,
}: {
  building: MapBuilding;
  groundY: number;
}) {
  const grid = useMemo<BuildingGrid>(
    () => ({ x: building.width, y: building.floors, z: building.depth }),
    [building.depth, building.floors, building.width],
  );
  const { width, height, depth } = buildingExtents(grid);

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      name="building"
      position={[building.x, groundY, building.z]}
    >
      <CuboidCollider
        name="building"
        args={[width / 2, (height + 0.55) / 2, depth / 2]}
        position={[0, (height + 0.55) / 2, 0]}
        friction={0.7}
        restitution={0.02}
      />
      <Tower grid={grid} />
    </RigidBody>
  );
}
