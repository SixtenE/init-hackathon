import { lazy, Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  BallCollider,
  CapsuleCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  useBeforePhysicsStep,
  type CollisionEnterPayload,
  type RapierRigidBody,
} from "@react-three/rapier";
import * as THREE from "three";
import { useFlightStore } from "./flightStore";
import { Explosion, type ExplosionHandle } from "./vfx/Explosion";

const AirbusA320 = lazy(() =>
  import("./models/AirbusA320").then(({ AirbusA320: Component }) => ({
    default: Component,
  })),
);

// Camera offset in the aircraft's local space: behind, above, and slightly to the side.
const CAMERA_OFFSET = new THREE.Vector3(0, 6, -26);
// Point the camera looks at, in the aircraft's local space (roughly the fuselage centre).
const LOOK_AT_OFFSET = new THREE.Vector3(0, 1.5, -4);
// How quickly the camera catches up (higher = stiffer).
const FOLLOW_SPEED = 6;
// Field of view widens with speed: BASE_FOV at/below FOV_MIN_SPEED, MAX_FOV at FOV_MAX_SPEED.
const BASE_FOV = 60;
const MAX_FOV = 115;
const FOV_MIN_SPEED = 8;
const FOV_MAX_SPEED = 28;
// How quickly the FOV follows the target (higher = snappier).
const FOV_RESPONSE = 6;

// The world is a narrow, endless strip running along +Z.
const WORLD_WIDTH = 140;
const WORLD_HEIGHT = 120;
const GROUND_Y = -WORLD_HEIGHT / 2;
const SPAWN_Z = 0;
// Landing gear (BallColliders below) reach 0.37 units under the body origin;
// spawn so the wheels rest just on the ground.
const GEAR_BOTTOM_OFFSET = 0.59 - 0.22;
const SPAWN_Y = GROUND_Y + GEAR_BOTTOM_OFFSET + 0.02;
// Length of the visible ground/wall shell that follows the aircraft.
const WORLD_VISIBLE_LENGTH = 1600;
// Effectively infinite extent for the static ground/ceiling/side colliders.
const WORLD_COLLIDER_LENGTH = 1_000_000;

// Flight control tuning (units per second / radians per second).
const MAX_BANK = 0.62;

// Lightweight flight dynamics. Units are intentionally game-scaled, while
// the relationships between thrust, drag, lift, and gravity remain physical.
const GRAVITY = 9.81;
// The aircraft starts parked on the runway: no speed, engines idle.
const INITIAL_AIRSPEED = 0;
const CRUISE_SPEED = 16;
const INITIAL_THROTTLE = 0;
const THROTTLE_RATE = 0.45;
const MAX_ENGINE_ACCELERATION = 12;
const DRAG_COEFFICIENT = 0.026;
// Level wings only make a fraction of weight, so accelerating with the stick
// neutral stays on the runway. The rest of the lift comes from angle of attack.
const LIFT_BASE_ACCELERATION = GRAVITY * 0.18;
const LIFT_AOA_ACCELERATION = GRAVITY * 3.6;
const MAX_LIFT_ACCELERATION = GRAVITY * 2.4;
const PITCH_SPEED = 0.7;
const MAX_PITCH = 0.55;
// Critical angle of attack. The stall meter fills as AoA approaches this.
const STALL_AOA = 0.42;
const SIDESLIP_DAMPING = 2.4;
const MAX_SAFE_LANDING_SPEED = 5;
const MAX_SAFE_WALL_IMPACT = 5;
const PHYSICS_STEP = 1 / 60;

// A projected blob shadow communicates altitude without the cost of enabling
// shadow maps for the detailed aircraft model. Painted into the ground shader
// so it cannot z-fight with the floor.
const SHADOW_MIN_OPACITY = 0;
const SHADOW_MAX_OPACITY = 0.55;
const SHADOW_MAX_ALTITUDE = 50;
const SHADOW_HALF_SIZE = new THREE.Vector2(8, 13);
// Rigid-body origin sits near the nose; slide the blob under the fuselage.
const SHADOW_LOCAL_OFFSET = new THREE.Vector3(0, 0, -5.5);

const MIN_DPR = 0.75;
const MAX_DPR = 1.5;

export default function App() {
  const debug = useFlightStore((state) => state.debug);
  const resetVersion = useFlightStore((state) => state.resetVersion);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyK") {
        event.preventDefault();
        if (!event.repeat) useFlightStore.getState().toggleDebug();
      } else if (event.code === "KeyR" && useFlightStore.getState().crashed) {
        event.preventDefault();
        if (!event.repeat) useFlightStore.getState().resetFlight();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <DebugPanel />
      <CrashOverlay />
      <Canvas
        camera={{ fov: BASE_FOV, near: 0.1, far: 600 }}
        dpr={[MIN_DPR, MAX_DPR]}
        gl={{ alpha: false, powerPreference: "high-performance", stencil: false }}
      >
        <FpsCounter />
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 10]} intensity={1.2} />
        <Suspense fallback={null}>
          <Physics
            gravity={[0, -GRAVITY, 0]}
            timeStep={PHYSICS_STEP}
            maxCcdSubsteps={2}
            debug={debug}
            colliders={false}
          >
            <WorldCube debug={debug} />
            <WorldColliders />
            <Aircraft key={resetVersion} debug={debug} />
          </Physics>
        </Suspense>
      </Canvas>
    </div>
  );
}

function CrashOverlay() {
  const crashed = useFlightStore((state) => state.crashed);
  const reason = useFlightStore((state) => state.crashReason);
  if (!crashed) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 2,
        display: "grid",
        placeContent: "center",
        textAlign: "center",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        textShadow: "0 2px 8px #000",
        pointerEvents: "none",
      }}
    >
      <div style={{ fontSize: 52, fontWeight: 800, color: "#ff4d4d" }}>CRASHED</div>
      <div style={{ fontSize: 18 }}>{reason}</div>
      <div style={{ marginTop: 12 }}>Press R to restart</div>
    </div>
  );
}

function DebugPanel() {
  const { debug, fps, airspeed, throttle, verticalSpeed, angleOfAttack, grounded, crashed, position } = useFlightStore();
  const stallRatio = THREE.MathUtils.clamp(angleOfAttack / STALL_AOA, 0, 1);
  const stallPercent = Math.round(stallRatio * 100);
  const stallColor = stallRatio >= 0.85 ? "#ff5a5a" : stallRatio >= 0.6 ? "#ffcc33" : "#7dff9a";

  return (
    <div
      hidden={!debug}
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        zIndex: 1,
        padding: "4px 8px",
        fontFamily: "monospace",
        fontSize: 14,
        color: "#fff",
        background: "rgba(0, 0, 0, 0.5)",
        borderRadius: 4,
        pointerEvents: "none",
      }}
    >
      <div>DEBUG · ⌘K to toggle</div>
      <div>{fps || "--"} FPS</div>
      <div>{airspeed.toFixed(1)} u/s · {Math.round(throttle * 100)}% throttle</div>
      <div>Vertical {verticalSpeed >= 0 ? "+" : ""}{verticalSpeed.toFixed(1)} u/s</div>
      <div>AoA {angleOfAttack >= 0 ? "+" : ""}{(angleOfAttack * THREE.MathUtils.RAD2DEG).toFixed(1)}°</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0" }}>
        <span style={{ color: stallRatio >= 0.85 ? stallColor : undefined }}>
          Stall {stallPercent}%
        </span>
        <div
          style={{
            width: 120,
            height: 8,
            background: "rgba(255, 255, 255, 0.18)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${stallPercent}%`,
              height: "100%",
              background: stallColor,
            }}
          />
        </div>
      </div>
      <div>X {position.x.toFixed(1)} · Y {position.y.toFixed(1)} · Z {position.z.toFixed(1)}</div>
      <div>{crashed ? "CRASHED" : grounded ? "GROUND" : "AIRBORNE"} · Rapier colliders visible</div>
      <div>W/S throttle · A/D turn · Space/Shift pitch</div>
    </div>
  );
}

function FpsCounter() {
  const frames = useRef(0);
  const elapsed = useRef(0);
  const lowFpsSamples = useRef(0);
  const highFpsSamples = useRef(0);
  const { gl, setDpr } = useThree();

  useFrame((_, delta) => {
    frames.current += 1;
    elapsed.current += delta;
    if (elapsed.current >= 1) {
      const fps = frames.current / elapsed.current;
      useFlightStore.getState().setFps(Math.round(fps));

      // Resolution is the dominant cost in this scene. Adjust it slowly and
      // with hysteresis so slower devices stay responsive without oscillating.
      lowFpsSamples.current = fps < 48 ? lowFpsSamples.current + 1 : 0;
      highFpsSamples.current = fps > 57 ? highFpsSamples.current + 1 : 0;

      if (lowFpsSamples.current >= 2) {
        setDpr(Math.max(MIN_DPR, gl.getPixelRatio() - 0.25));
        lowFpsSamples.current = 0;
        highFpsSamples.current = 0;
      } else if (highFpsSamples.current >= 4) {
        setDpr(Math.min(MAX_DPR, window.devicePixelRatio, gl.getPixelRatio() + 0.25));
        lowFpsSamples.current = 0;
        highFpsSamples.current = 0;
      }

      frames.current = 0;
      elapsed.current = 0;
    }
  });
  return null;
}

// Procedural skybox: a camera-following sphere shaded with a zenith→horizon
// gradient plus a sun disc and glow. It is drawn first with depth writes off so
// it always sits behind the scene, and it needs no texture assets.
const SUN_DIRECTION = new THREE.Vector3(10, 20, 10).normalize();
const SKY_RADIUS = 550;
const SKY_GEOMETRY = new THREE.SphereGeometry(1, 48, 32);
const SKY_MATERIAL = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  depthTest: false,
  toneMapped: false,
  uniforms: {
    zenithColor: { value: new THREE.Color("#1f5fa8") },
    skyColor: { value: new THREE.Color("#6fb1e6") },
    horizonColor: { value: new THREE.Color("#dbe9f3") },
    groundColor: { value: new THREE.Color("#4a5a66") },
    sunColor: { value: new THREE.Color("#fff4d6") },
    sunDirection: { value: SUN_DIRECTION },
  },
  vertexShader: `
    varying vec3 vDirection;
    void main() {
      vDirection = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 zenithColor;
    uniform vec3 skyColor;
    uniform vec3 horizonColor;
    uniform vec3 groundColor;
    uniform vec3 sunColor;
    uniform vec3 sunDirection;
    varying vec3 vDirection;
    void main() {
      vec3 dir = normalize(vDirection);
      float elevation = dir.y;

      // Sky gradient: bright haze at the horizon, saturating towards the zenith.
      vec3 sky = mix(skyColor, zenithColor, smoothstep(0.05, 0.7, elevation));
      sky = mix(horizonColor, sky, smoothstep(0.0, 0.18, elevation));
      // Below the horizon fade into a muted ground tone.
      vec3 color = mix(groundColor, sky, smoothstep(-0.08, 0.0, elevation));

      // Sun disc with a soft glow, only above the horizon.
      float cosAngle = dot(dir, sunDirection);
      float disc = smoothstep(0.9985, 0.9995, cosAngle);
      float glow = pow(max(cosAngle, 0.0), 24.0) * 0.45;
      float horizonMask = smoothstep(-0.02, 0.02, elevation);
      color += sunColor * (disc + glow) * horizonMask;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
});

function Skybox() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position);
  });
  return (
    <mesh
      ref={ref}
      geometry={SKY_GEOMETRY}
      material={SKY_MATERIAL}
      scale={SKY_RADIUS}
      renderOrder={-1000}
      frustumCulled={false}
    />
  );
}

// Ground: a solid colour with an analytically anti-aliased grid. Drawing the
// lines in the shader (rather than from a tiled texture) avoids the moiré and
// shimmering that thin texture lines produce at grazing angles.
const GROUND_GEOMETRY = new THREE.PlaneGeometry(WORLD_WIDTH, WORLD_VISIBLE_LENGTH);
const GROUND_MATERIAL = new THREE.ShaderMaterial({
  uniforms: {
    groundColor: { value: new THREE.Color("#5c7a4f") },
    lineColor: { value: new THREE.Color("#8fae7f") },
    cellSize: { value: 20 },
    lineWidth: { value: 0.35 },
    shadowCenter: { value: new THREE.Vector2(0, SPAWN_Z) },
    shadowHalfSize: { value: SHADOW_HALF_SIZE.clone() },
    shadowYaw: { value: 0 },
    shadowOpacity: { value: SHADOW_MAX_OPACITY },
  },
  vertexShader: `
    varying vec2 vWorldXZ;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldXZ = worldPosition.xz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 groundColor;
    uniform vec3 lineColor;
    uniform float cellSize;
    uniform float lineWidth;
    uniform vec2 shadowCenter;
    uniform vec2 shadowHalfSize;
    uniform float shadowYaw;
    uniform float shadowOpacity;
    varying vec2 vWorldXZ;
    void main() {
      vec2 coord = vWorldXZ / cellSize;
      // Distance to the nearest grid line, in screen-space derivative units.
      vec2 derivative = fwidth(coord);
      vec2 grid = abs(fract(coord - 0.5) - 0.5) / max(derivative, vec2(1e-5));
      float lineDistance = min(grid.x, grid.y);
      float halfWidth = (lineWidth / cellSize) / max(min(derivative.x, derivative.y), 1e-5) * 0.5;
      float line = 1.0 - smoothstep(halfWidth, halfWidth + 1.0, lineDistance);
      // Fade the lines out in the distance so they never resolve to noise.
      float fade = 1.0 - smoothstep(0.02, 0.2, max(derivative.x, derivative.y));
      vec3 color = mix(groundColor, lineColor, line * fade);

      vec2 delta = vWorldXZ - shadowCenter;
      float s = sin(shadowYaw);
      float c = cos(shadowYaw);
      vec2 local = vec2(c * delta.x - s * delta.y, s * delta.x + c * delta.y);
      float ellipse = length(local / max(shadowHalfSize, vec2(1e-4)));
      float blob = 1.0 - smoothstep(0.18, 1.0, ellipse);
      color *= 1.0 - shadowOpacity * blob;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
});

// The playable volume is still a box; its walls are drawn as a faint tint so
// the player can see the boundary without it hiding the sky. The bottom face
// is dropped so it cannot z-fight with the ground plane.
function createWorldWallGeometry() {
  const box = new THREE.BoxGeometry(WORLD_WIDTH, WORLD_HEIGHT, WORLD_VISIBLE_LENGTH);
  const index = box.getIndex()!;
  // Drop the -Y face (ground is drawn separately) and both Z end caps, since
  // the strip is endless.
  const dropped = [box.groups[3], box.groups[4], box.groups[5]];
  const kept = Array.from(index.array).filter((_, i) =>
    !dropped.some((group) => i >= group.start && i < group.start + group.count),
  );
  box.setIndex(kept);
  box.clearGroups();
  return box;
}

const WORLD_GEOMETRY = createWorldWallGeometry();
const WORLD_MATERIAL = new THREE.MeshBasicMaterial({
  side: THREE.BackSide,
  color: "#9fd3ff",
  transparent: true,
  opacity: 0.08,
  depthWrite: false,
  toneMapped: false,
});

// Shared aircraft position, written every frame by the Aircraft so the world
// shell can follow without going through the store.
const aircraftPosition = new THREE.Vector3(0, SPAWN_Y, SPAWN_Z);

function WorldCube({ debug }: { debug: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const shell = useRef<THREE.Group>(null);

  // The ground and wall shell slide along with the aircraft so the strip never
  // ends. The grid shader uses world-space XZ, so sliding the plane leaves the
  // grid visually fixed.
  useFrame(() => {
    shell.current?.position.setZ(aircraftPosition.z);
  });

  return (
    <>
      <Skybox />
      <group ref={shell} position-z={SPAWN_Z}>
        <mesh
          geometry={GROUND_GEOMETRY}
          material={GROUND_MATERIAL}
          rotation-x={-Math.PI / 2}
          position-y={GROUND_Y}
        />
        <mesh ref={ref} geometry={WORLD_GEOMETRY} material={WORLD_MATERIAL} />
      </group>
      {debug && <EntityBounds target={ref} />}
    </>
  );
}

function WorldColliders() {
  const halfWidth = WORLD_WIDTH / 2;
  const halfHeight = WORLD_HEIGHT / 2;
  const halfDepth = WORLD_COLLIDER_LENGTH / 2;

  return (
    <RigidBody type="fixed" colliders={false} name="world">
      <CuboidCollider
        name="ground"
        args={[halfWidth, 0.5, halfDepth]}
        position={[0, GROUND_Y - 0.5, 0]}
        friction={0.9}
        restitution={0.04}
      />
      <CuboidCollider name="ceiling" args={[halfWidth, 0.5, halfDepth]} position={[0, halfHeight + 0.5, 0]} />
      <CuboidCollider name="wall-x" args={[0.5, halfHeight, halfDepth]} position={[halfWidth + 0.5, 0, 0]} />
      <CuboidCollider name="wall-x" args={[0.5, halfHeight, halfDepth]} position={[-halfWidth - 0.5, 0, 0]} />
    </RigidBody>
  );
}

// Keep helpers outside their targets so they never enlarge their own bounds.
// Resources and frame updates exist only while debug mode is enabled.
function EntityBounds({ target }: { target: React.RefObject<THREE.Object3D | null> }) {
  const scene = useThree((state) => state.scene);
  const helper = useRef<THREE.BoxHelper | null>(null);

  useEffect(() => {
    if (!target.current) return;
    const bounds = new THREE.BoxHelper(target.current, "#00ffff");
    bounds.material.depthTest = false;
    bounds.material.depthWrite = false;
    bounds.material.toneMapped = false;
    bounds.renderOrder = 1000;
    scene.add(bounds);
    helper.current = bounds;
    return () => {
      scene.remove(bounds);
      bounds.dispose();
      helper.current = null;
    };
  }, [scene, target]);

  useFrame(() => helper.current?.update());
  return null;
}

// Build the aircraft bounds in its own coordinate space. Unlike BoxHelper's
// world-aligned bounds, this stays tight when the plane yaws or banks.
function LocalEntityBounds({ target }: { target: React.RefObject<THREE.Object3D | null> }) {
  useEffect(() => {
    const object = target.current;
    if (!object) return;

    object.updateWorldMatrix(true, true);
    const inverseWorld = object.matrixWorld.clone().invert();
    const relativeMatrix = new THREE.Matrix4();
    const meshBounds = new THREE.Box3();
    const localBounds = new THREE.Box3();

    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry) return;
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
      if (!child.geometry.boundingBox) return;

      relativeMatrix.multiplyMatrices(inverseWorld, child.matrixWorld);
      meshBounds.copy(child.geometry.boundingBox).applyMatrix4(relativeMatrix);
      localBounds.union(meshBounds);
    });

    if (localBounds.isEmpty()) return;
    const helper = new THREE.Box3Helper(localBounds, "#00ffff");
    const helperMaterial = helper.material as THREE.LineBasicMaterial;
    helperMaterial.depthTest = false;
    helperMaterial.depthWrite = false;
    helperMaterial.toneMapped = false;
    helper.renderOrder = 1000;
    object.add(helper);

    return () => {
      object.remove(helper);
      helper.dispose();
    };
  }, [target]);

  return null;
}

type KeyState = Record<string, boolean>;

// Keys whose browser default (page scroll, button activation) must be suppressed.
const FLIGHT_KEYS = new Set(["Space", "ShiftLeft", "ShiftRight", "KeyW", "KeyA", "KeyS", "KeyD"]);

function useKeyboard(): React.RefObject<KeyState> {
  const keys = useRef<KeyState>({});
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Shortcuts (⌘K etc.) must not register as flight input. macOS also
      // swallows the keyup for keys released while ⌘ is held, which would
      // otherwise leave them stuck "down".
      if (e.metaKey || e.ctrlKey) return;
      if (FLIGHT_KEYS.has(e.code)) e.preventDefault();
      keys.current[e.code] = true;
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
      if (e.code === "MetaLeft" || e.code === "MetaRight" || e.code === "ControlLeft" || e.code === "ControlRight") {
        keys.current = {};
      }
    };
    const release = () => {
      keys.current = {};
    };
    const visibility = () => {
      if (document.hidden) release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return keys;
}

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const linearVelocity = new THREE.Vector3();
const angularVelocity = new THREE.Vector3();
const bodyRotation = new THREE.Quaternion();
const totalForce = new THREE.Vector3();
const totalTorque = new THREE.Vector3();
const shadowWorldPosition = new THREE.Vector3();
const shadowWorldQuaternion = new THREE.Quaternion();
const shadowEuler = new THREE.Euler(0, 0, 0, "YXZ");
const shadowOffset = new THREE.Vector3();

function GroundShadow({ target }: { target: React.RefObject<THREE.Object3D | null> }) {
  useFrame(() => {
    const plane = target.current;
    if (!plane) return;

    plane.getWorldPosition(shadowWorldPosition);
    plane.getWorldQuaternion(shadowWorldQuaternion);
    shadowEuler.setFromQuaternion(shadowWorldQuaternion, "YXZ");
    shadowOffset.copy(SHADOW_LOCAL_OFFSET).applyQuaternion(shadowWorldQuaternion);

    const altitude = Math.max(0, shadowWorldPosition.y - GROUND_Y);
    const altitudeRatio = THREE.MathUtils.clamp(altitude / SHADOW_MAX_ALTITUDE, 0, 1);
    const spread = THREE.MathUtils.lerp(1, 1.7, altitudeRatio);

    const uniforms = GROUND_MATERIAL.uniforms;
    uniforms.shadowCenter.value.set(
      shadowWorldPosition.x + shadowOffset.x,
      shadowWorldPosition.z + shadowOffset.z,
    );
    uniforms.shadowHalfSize.value.set(SHADOW_HALF_SIZE.x * spread, SHADOW_HALF_SIZE.y * spread);
    uniforms.shadowYaw.value = shadowEuler.y;
    uniforms.shadowOpacity.value = THREE.MathUtils.lerp(
      SHADOW_MAX_OPACITY,
      SHADOW_MIN_OPACITY,
      altitudeRatio,
    );
  });

  return null;
}

function Aircraft({ debug }: { debug: boolean }) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const ref = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Group>(null);
  const explosionRef = useRef<ExplosionHandle>(null);
  const impactVelocity = useRef(new THREE.Vector3(0, 0, INITIAL_AIRSPEED));
  const pitchTarget = useRef(0);
  const throttle = useRef(INITIAL_THROTTLE);
  const angleOfAttack = useRef(0);
  const telemetryElapsed = useRef(0);
  const groundContacts = useRef(0);
  const crashed = useRef(false);
  const keys = useKeyboard();

  const crashPlane = (reason: string, impactSpeed: number) => {
    if (crashed.current) return;
    crashed.current = true;
    throttle.current = 0;
    const body = bodyRef.current;
    if (body) {
      const impulse = body.mass() * Math.min(impactSpeed, 20) * 0.08;
      body.applyTorqueImpulse({ x: impulse * 0.35, y: impulse * 0.2, z: impulse }, true);
    }
    const explosionPosition = new THREE.Vector3(0, 2, -5.5);
    if (ref.current) {
      ref.current.localToWorld(explosionPosition);
    } else if (body) {
      const position = body.translation();
      explosionPosition.set(position.x, position.y + 2, position.z);
    }
    explosionRef.current?.trigger(explosionPosition);
    useFlightStore.getState().crash(reason);
  };

  const handleCollisionEnter = (event: CollisionEnterPayload) => {
    const surface = event.other.colliderObject?.name ?? event.other.rigidBodyObject?.name ?? "";
    const velocity = impactVelocity.current;

    if (surface === "ground") {
      groundContacts.current += 1;
      const impactSpeed = Math.max(0, -velocity.y);
      if (impactSpeed > MAX_SAFE_LANDING_SPEED) {
        crashPlane(`Hard landing at ${impactSpeed.toFixed(1)} u/s`, impactSpeed);
      }
      return;
    }

    let impactSpeed = velocity.length();
    if (surface === "wall-x") impactSpeed = Math.abs(velocity.x);
    if (surface === "wall-z") impactSpeed = Math.abs(velocity.z);
    if (surface === "ceiling") impactSpeed = Math.max(0, velocity.y);

    if (surface.startsWith("wall") && impactSpeed > MAX_SAFE_WALL_IMPACT) {
      crashPlane("Collision with the wall", impactSpeed);
    } else if (surface === "ceiling" && impactSpeed > MAX_SAFE_WALL_IMPACT) {
      crashPlane("Collision with the ceiling", impactSpeed);
    }
  };

  const handleCollisionExit = (event: { other: CollisionEnterPayload["other"] }) => {
    const surface = event.other.colliderObject?.name ?? event.other.rigidBodyObject?.name ?? "";
    if (surface === "ground") {
      groundContacts.current = Math.max(0, groundContacts.current - 1);
    }
  };

  useBeforePhysicsStep(() => {
    const body = bodyRef.current;
    if (!body) return;
    const k = keys.current;
    const velocity = body.linvel();
    const rotation = body.rotation();
    const spin = body.angvel();

    linearVelocity.set(velocity.x, velocity.y, velocity.z);
    impactVelocity.current.copy(linearVelocity);
    angularVelocity.set(spin.x, spin.y, spin.z);
    bodyRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    forward.set(0, 0, 1).applyQuaternion(bodyRotation).normalize();
    up.set(0, 1, 0).applyQuaternion(bodyRotation).normalize();
    right.set(1, 0, 0).applyQuaternion(bodyRotation).normalize();

    body.resetForces(true);
    body.resetTorques(true);

    const throttleInput = crashed.current ? 0 : (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    const turn = crashed.current ? 0 : (k.KeyA ? 1 : 0) - (k.KeyD ? 1 : 0);
    const pitch = crashed.current
      ? 0
      : (k.Space ? 1 : 0) - (k.ShiftLeft || k.ShiftRight ? 1 : 0);

    if (crashed.current) {
      throttle.current = 0;
      return;
    } else {
      throttle.current = THREE.MathUtils.clamp(
        throttle.current + throttleInput * THROTTLE_RATE * PHYSICS_STEP,
        0,
        1,
      );
    }

    if (pitch) {
      pitchTarget.current = THREE.MathUtils.clamp(
        pitchTarget.current + pitch * PITCH_SPEED * PHYSICS_STEP,
        -MAX_PITCH,
        MAX_PITCH,
      );
    } else {
      pitchTarget.current = THREE.MathUtils.damp(
        pitchTarget.current,
        0,
        0.65,
        PHYSICS_STEP,
      );
    }

    const forwardAirspeed = Math.max(0, linearVelocity.dot(forward));
    const controlAuthority = THREE.MathUtils.clamp(forwardAirspeed / CRUISE_SPEED, 0.15, 1.25);
    const mass = body.mass();
    const speed = linearVelocity.length();
    const pitchAngle = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
    const flightPathPitch =
      speed > 1 ? Math.asin(THREE.MathUtils.clamp(linearVelocity.y / speed, -1, 1)) : 0;
    const aoa = THREE.MathUtils.clamp(
      pitchAngle - flightPathPitch,
      -MAX_PITCH,
      MAX_PITCH,
    );
    angleOfAttack.current = aoa;
    const liftAcceleration = THREE.MathUtils.clamp(
      (forwardAirspeed / CRUISE_SPEED) ** 2 *
        (LIFT_BASE_ACCELERATION + LIFT_AOA_ACCELERATION * aoa),
      -MAX_LIFT_ACCELERATION,
      MAX_LIFT_ACCELERATION,
    );
    const sideslipSpeed = linearVelocity.dot(right);

    totalForce
      .copy(forward)
      .multiplyScalar(throttle.current * MAX_ENGINE_ACCELERATION * mass)
      .addScaledVector(up, liftAcceleration * mass);
    if (speed > 0.001) {
      totalForce.addScaledVector(linearVelocity, -DRAG_COEFFICIENT * speed * mass);
    }
    totalForce.addScaledVector(right, -sideslipSpeed * SIDESLIP_DAMPING * mass);
    body.addForce(totalForce, true);
    const bankAngle = Math.atan2(right.y, up.y);
    const pitchRate = angularVelocity.dot(right);
    const rollRate = angularVelocity.dot(forward);
    const yawRate = angularVelocity.dot(up);
    const pitchError = pitchTarget.current - pitchAngle;
    const bankError = -turn * MAX_BANK - bankAngle;

    totalTorque
      .copy(right)
      .multiplyScalar((-pitchError * 34 - pitchRate * 9) * mass * controlAuthority)
      .addScaledVector(
        forward,
        (bankError * 22 - rollRate * 7) * mass * controlAuthority,
      )
      .addScaledVector(
        up,
        (turn * 6 * controlAuthority - yawRate * 1.5) * mass,
      );
    body.addTorque(totalTorque, true);
  });

  useFrame((_, delta) => {
    const body = bodyRef.current;
    if (!body) return;
    const velocity = body.linvel();
    const position = body.translation();
    aircraftPosition.set(position.x, position.y, position.z);

    telemetryElapsed.current += delta;
    if (telemetryElapsed.current >= 0.2) {
      useFlightStore.getState().setTelemetry({
        airspeed: Math.hypot(velocity.x, velocity.y, velocity.z),
        throttle: throttle.current,
        verticalSpeed: velocity.y,
        angleOfAttack: angleOfAttack.current,
        grounded: groundContacts.current > 0,
        position: { x: position.x, y: position.y, z: position.z },
      });
      telemetryElapsed.current = 0;
    }
  });

  return (
    <>
      <RigidBody
        ref={bodyRef}
        name="aircraft"
        colliders={false}
        position={[0, SPAWN_Y, SPAWN_Z]}
        linearVelocity={[0, 0, INITIAL_AIRSPEED]}
        linearDamping={0.015}
        angularDamping={0.18}
        ccd
        canSleep={false}
        onCollisionEnter={handleCollisionEnter}
        onCollisionExit={handleCollisionExit}
      >
        <group ref={ref}>
          <group ref={modelRef}>
            <AirbusA320 />
          </group>
        </group>
        <CapsuleCollider
          name="aircraft-fuselage"
          args={[5.4, 0.82]}
          position={[0, 2.05, -6.3]}
          rotation={[Math.PI / 2, 0, 0]}
          friction={0.35}
          restitution={0.04}
        />
        <CuboidCollider name="aircraft-wings" args={[6, 0.16, 1.25]} position={[0, 1.72, -5.2]} />
        <CuboidCollider name="aircraft-tailplane" args={[2.4, 0.12, 0.7]} position={[0, 2.25, -11.25]} />
        <CuboidCollider name="aircraft-tail" args={[0.14, 1.25, 1.1]} position={[0, 3, -11.2]} />
        <BallCollider name="aircraft-gear" args={[0.22]} position={[-2.05, 0.59, -5.7]} friction={1.2} />
        <BallCollider name="aircraft-gear" args={[0.22]} position={[2.05, 0.59, -5.7]} friction={1.2} />
        <BallCollider name="aircraft-gear" args={[0.22]} position={[0, 0.59, -1.8]} friction={1.2} />
      </RigidBody>
      {debug && <LocalEntityBounds target={modelRef} />}
      <GroundShadow target={ref} />
      <ChaseCamera target={ref} body={bodyRef} />
      <Explosion ref={explosionRef} groundY={GROUND_Y} />
    </>
  );
}

const cameraGoal = new THREE.Vector3();
const lookGoal = new THREE.Vector3();
const currentLook = new THREE.Vector3();

function ChaseCamera({
  target,
  body,
}: {
  target: React.RefObject<THREE.Object3D | null>;
  body: React.RefObject<RapierRigidBody | null>;
}) {
  useFrame(({ camera }, delta) => {
    const plane = target.current;
    if (!plane) return;

    cameraGoal.copy(CAMERA_OFFSET);
    plane.localToWorld(cameraGoal);
    lookGoal.copy(LOOK_AT_OFFSET);
    plane.localToWorld(lookGoal);

    const t = 1 - Math.exp(-FOLLOW_SPEED * delta);
    camera.position.lerp(cameraGoal, t);
    currentLook.lerp(lookGoal, t);
    camera.lookAt(currentLook);

    // Widen the field of view as speed builds for a sense of acceleration.
    if (camera instanceof THREE.PerspectiveCamera) {
      const rigidBody = body.current;
      const speed = rigidBody
        ? Math.hypot(rigidBody.linvel().x, rigidBody.linvel().y, rigidBody.linvel().z)
        : 0;
      const speedRatio = THREE.MathUtils.clamp(
        (speed - FOV_MIN_SPEED) / (FOV_MAX_SPEED - FOV_MIN_SPEED),
        0,
        1,
      );
      const targetFov = THREE.MathUtils.lerp(BASE_FOV, MAX_FOV, speedRatio);
      const nextFov = THREE.MathUtils.damp(camera.fov, targetFov, FOV_RESPONSE, delta);
      if (Math.abs(nextFov - camera.fov) > 0.001) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
    }
  });
  return null;
}
