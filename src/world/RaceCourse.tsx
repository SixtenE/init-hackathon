import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, type IntersectionEnterPayload } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFlightStore } from "../flightStore";
import { gameMap, type MapGate } from "./map";

// Thick enough that a fast aircraft cannot step over the sensor between physics ticks.
const SENSOR_DEPTH = 5;
const RING_SCALE = 2.2;

const NEXT_COLOR = new THREE.Color("#ffe566");
const UPCOMING_COLOR = new THREE.Color("#e0b83a");

const ringGeometry = new THREE.RingGeometry(0.86, 1, 64);

function Gate({ gate, groundY }: { gate: MapGate; groundY: number }) {
  const nextGate = useFlightStore((s) => s.race.nextGate);
  const passGate = useFlightStore((s) => s.passGate);
  const passed = gate.index < nextGate;
  const isNext = gate.index === nextGate;

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: isNext ? NEXT_COLOR : UPCOMING_COLOR,
        transparent: true,
        opacity: isNext ? 0.95 : 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    [isNext],
  );
  useEffect(() => () => material.dispose(), [material]);

  const pulse = useRef(0);
  useFrame((_, delta) => {
    if (!isNext) return;
    pulse.current += delta * 3.2;
    material.opacity = 0.72 + 0.23 * Math.sin(pulse.current);
  });

  const onEnter = (payload: IntersectionEnterPayload) => {
    const name = payload.other.rigidBodyObject?.name ?? "";
    if (name !== "aircraft") return;
    passGate(gate.index, performance.now());
  };

  const radius = (Math.max(gate.width, gate.height) / 2) * RING_SCALE;
  const centerY = groundY + gate.y;

  if (passed) return null;

  return (
    <group position={[gate.x, centerY, gate.z]} rotation={[0, gate.yaw, 0]}>
      <mesh geometry={ringGeometry} material={material} scale={[radius, radius, 1]} />
      <RigidBody type="fixed" colliders={false} name={`gate-${gate.index}`}>
        <CuboidCollider
          sensor
          args={[radius, radius, SENSOR_DEPTH / 2]}
          onIntersectionEnter={onEnter}
        />
      </RigidBody>
    </group>
  );
}

export function RaceCourse({ groundY }: { groundY: number }) {
  const setGateCount = useFlightStore((s) => s.setGateCount);
  useEffect(() => {
    setGateCount(gameMap.course.gates.length);
  }, [setGateCount]);

  return (
    <group>
      {gameMap.course.gates.map((gate) => (
        <Gate key={gate.index} gate={gate} groundY={groundY} />
      ))}
    </group>
  );
}
