import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CuboidCollider,
  InstancedRigidBodies,
  RigidBody,
  useAfterPhysicsStep,
  useRapier,
  type CollisionEnterPayload,
  type InstancedRigidBodyProps,
  type RapierRigidBody,
} from "@react-three/rapier";
import * as THREE from "three";
import { useFlightStore } from "../flightStore";

const BLOCK = 3.1;
const GRID_X = 4;
const GRID_Y = 28;
const GRID_Z = 3;
export const BUILDING_WIDTH = GRID_X * BLOCK;
const BUILDING_HEIGHT = GRID_Y * BLOCK;
const BUILDING_DEPTH = GRID_Z * BLOCK;
const DEBRIS_SIZE = BLOCK * 0.92;
const DEBRIS_HALF = DEBRIS_SIZE / 2;

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
const DEBRIS_MATERIAL = new THREE.MeshStandardMaterial({
  roughness: 0.9,
  metalness: 0.05,
});
const DEBRIS_GEOMETRY = new THREE.BoxGeometry(DEBRIS_SIZE, DEBRIS_SIZE, DEBRIS_SIZE);

const CONCRETE_COLOR = new THREE.Color("#c4b9ac");
const GLASS_COLOR = new THREE.Color("#3d5368");
const DARK_CONCRETE = new THREE.Color("#8f877d");

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

type Impact = {
  point: THREE.Vector3;
  velocity: THREE.Vector3;
};

function createDebrisInstances(origin: [number, number, number]): InstancedRigidBodyProps[] {
  const [ox, groundY, oz] = origin;
  const instances: InstancedRigidBodyProps[] = [];
  const x0 = ox - BUILDING_WIDTH / 2 + BLOCK / 2;
  const y0 = groundY + BLOCK / 2;
  const z0 = oz - BUILDING_DEPTH / 2 + BLOCK / 2;
  let index = 0;
  for (let iy = 0; iy < GRID_Y; iy += 1) {
    for (let iz = 0; iz < GRID_Z; iz += 1) {
      for (let ix = 0; ix < GRID_X; ix += 1) {
        instances.push({
          key: index,
          position: [x0 + ix * BLOCK, y0 + iy * BLOCK, z0 + iz * BLOCK],
        });
        index += 1;
      }
    }
  }
  return instances;
}

function debrisColor(index: number) {
  const ix = index % GRID_X;
  const iz = Math.floor(index / GRID_X) % GRID_Z;
  const iy = Math.floor(index / (GRID_X * GRID_Z));
  const onFacade = ix === 0 || ix === GRID_X - 1 || iz === 0 || iz === GRID_Z - 1;
  const isCorner = (ix === 0 || ix === GRID_X - 1) && (iz === 0 || iz === GRID_Z - 1);
  if (iy === 0 || isCorner) return DARK_CONCRETE;
  if (iy === GRID_Y - 1) return DARK_CONCRETE;
  if (onFacade) return GLASS_COLOR;
  return CONCRETE_COLOR;
}

function IntactTower() {
  const glassY = BUILDING_HEIGHT * 0.54;
  const glassH = BUILDING_HEIGHT * 0.78;
  return (
    <group>
      <mesh position={[0, BUILDING_HEIGHT / 2, 0]} material={CONCRETE}>
        <boxGeometry args={[BUILDING_WIDTH, BUILDING_HEIGHT, BUILDING_DEPTH]} />
      </mesh>
      <mesh position={[0, 1.55, 0]} material={LOBBY}>
        <boxGeometry args={[BUILDING_WIDTH + 0.18, 3.1, BUILDING_DEPTH + 0.18]} />
      </mesh>
      <mesh position={[0, glassY, BUILDING_DEPTH / 2 + 0.05]} material={GLASS}>
        <boxGeometry args={[BUILDING_WIDTH * 0.78, glassH, 0.12]} />
      </mesh>
      <mesh position={[0, glassY, -BUILDING_DEPTH / 2 - 0.05]} material={GLASS}>
        <boxGeometry args={[BUILDING_WIDTH * 0.78, glassH, 0.12]} />
      </mesh>
      <mesh position={[BUILDING_WIDTH / 2 + 0.05, glassY, 0]} rotation={[0, Math.PI / 2, 0]} material={GLASS}>
        <boxGeometry args={[BUILDING_DEPTH * 0.78, glassH, 0.12]} />
      </mesh>
      <mesh position={[-BUILDING_WIDTH / 2 - 0.05, glassY, 0]} rotation={[0, Math.PI / 2, 0]} material={GLASS}>
        <boxGeometry args={[BUILDING_DEPTH * 0.78, glassH, 0.12]} />
      </mesh>
      <mesh position={[0, BUILDING_HEIGHT + 0.28, 0]} material={ROOF}>
        <boxGeometry args={[BUILDING_WIDTH + 0.7, 0.55, BUILDING_DEPTH + 0.7]} />
      </mesh>
      <mesh position={[0, BUILDING_HEIGHT + 1.35, -0.4]} material={PENTHOUSE}>
        <boxGeometry args={[BUILDING_WIDTH * 0.36, 1.6, BUILDING_DEPTH * 0.4]} />
      </mesh>
    </group>
  );
}

function BuildingDebris({
  origin,
  impact,
}: {
  origin: [number, number, number];
  impact: Impact;
}) {
  const bodiesRef = useRef<(RapierRigidBody | null)[] | null>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const kicked = useRef(false);
  const instances = useMemo(() => createDebrisInstances(origin), [origin]);
  const { world } = useRapier();

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let index = 0; index < instances.length; index += 1) {
      mesh.setColorAt(index, debrisColor(index));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [instances.length]);

  useLayoutEffect(() => {
    return () => {
      const mesh = meshRef.current;
      if (mesh) {
        mesh.count = 0;
        mesh.visible = false;
        mesh.removeFromParent();
      }
      const bodies = bodiesRef.current;
      if (!bodies) return;
      for (const body of bodies) {
        if (!body) continue;
        try {
          if (world.getRigidBody(body.handle)) world.removeRigidBody(body);
        } catch {
          // Already removed with the Rapier body.
        }
      }
    };
  }, [world]);

  useAfterPhysicsStep(() => {
    if (kicked.current) return;
    const bodies = bodiesRef.current;
    if (!bodies?.[0]) return;
    kicked.current = true;

    const speed = impact.velocity.length();
    const blast = THREE.MathUtils.clamp(speed * 0.45, 10, 34);
    const direction = impact.velocity.clone();
    if (direction.lengthSq() < 0.01) direction.set(0, 0.2, 1);
    direction.normalize();

    for (const body of bodies) {
      if (!body) continue;
      const position = body.translation();
      const dx = position.x - impact.point.x;
      const dy = position.y - impact.point.y;
      const dz = position.z - impact.point.z;
      const distance = Math.hypot(dx, dy, dz) || 0.2;
      const falloff = 1 / (1 + distance * 0.11);
      const mass = body.mass();
      const outward = blast * falloff * mass;
      body.applyImpulse(
        {
          x: (direction.x * speed * 0.22 + (dx / distance) * blast * 0.55) * falloff * mass,
          y: (6.5 + Math.abs(dy) * 0.35) * falloff * mass,
          z: (direction.z * speed * 0.22 + (dz / distance) * blast * 0.55) * falloff * mass,
        },
        true,
      );
      body.applyTorqueImpulse(
        {
          x: (dy - dz) * outward * 0.04,
          y: (dx + dz) * outward * 0.03,
          z: (dx - dy) * outward * 0.04,
        },
        true,
      );
    }
  });

  return (
    <InstancedRigidBodies
      ref={bodiesRef}
      instances={instances}
      colliders={false}
      type="dynamic"
      name="building-debris"
      canSleep
      linearDamping={0.12}
      angularDamping={0.22}
      colliderNodes={[
        <CuboidCollider
          key="chunk"
          args={[DEBRIS_HALF, DEBRIS_HALF, DEBRIS_HALF]}
          restitution={0.05}
          friction={0.82}
          density={0.55}
        />,
      ]}
    >
      <instancedMesh
        ref={meshRef}
        args={[DEBRIS_GEOMETRY, DEBRIS_MATERIAL, instances.length]}
        frustumCulled={false}
      />
    </InstancedRigidBodies>
  );
}

export function CrumblingBuilding({ origin }: { origin: [number, number, number] }) {
  const resetVersion = useFlightStore((state) => state.resetVersion);
  const [collapsed, setCollapsed] = useState(false);
  const impactRef = useRef<Impact>({
    point: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
  });

  useLayoutEffect(() => {
    setCollapsed(false);
  }, [resetVersion]);

  const handleCollisionEnter = (event: CollisionEnterPayload) => {
    if (collapsed) return;
    const otherName = event.other.rigidBodyObject?.name ?? event.other.colliderObject?.name ?? "";
    if (otherName !== "aircraft" && !otherName.startsWith("aircraft")) return;

    const otherBody = event.other.rigidBody;
    const translation = otherBody?.translation();
    const velocity = otherBody?.linvel();
    impactRef.current.point.set(
      translation?.x ?? origin[0],
      translation?.y ?? origin[1] + BUILDING_HEIGHT * 0.45,
      translation?.z ?? origin[2],
    );
    impactRef.current.velocity.set(velocity?.x ?? 0, velocity?.y ?? 0, velocity?.z ?? 18);
    setCollapsed(true);
  };

  if (collapsed) {
    return <BuildingDebris origin={origin} impact={impactRef.current} />;
  }

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      name="building"
      position={origin}
      onCollisionEnter={handleCollisionEnter}
    >
      <CuboidCollider
        name="building"
        args={[BUILDING_WIDTH / 2, (BUILDING_HEIGHT + 0.55) / 2, BUILDING_DEPTH / 2]}
        position={[0, (BUILDING_HEIGHT + 0.55) / 2, 0]}
        friction={0.7}
        restitution={0.02}
      />
      <IntactTower />
    </RigidBody>
  );
}
