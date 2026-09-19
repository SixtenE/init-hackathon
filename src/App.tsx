import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Portfolio } from "./Portfolio";
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
import { gameClient } from "./net/gameClient";
import { samplePlayer } from "./net/snapshots";
import { useGameConnection } from "./net/useGameConnection";
import { Explosion, type ExplosionHandle } from "./vfx/Explosion";
import { CrumblingBuilding, BUILDING_WIDTH } from "./world/CrumblingBuilding";

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
// How quickly the FOV follows the target (higher = snappier).
const FOV_RESPONSE = 6;

// Playable volume is a square arena on XZ, with a fixed ceiling height.
const WORLD_SIZE = 800;
const WORLD_HEIGHT = 120;
const GROUND_Y = -WORLD_HEIGHT / 2;
const SPAWN_Z = 0;
// Start in the middle of the arena, well above the ground and the
// building, with room to climb before the ceiling.
const SPAWN_ALTITUDE = 42;
const SPAWN_Y = GROUND_Y + SPAWN_ALTITUDE;
const BUILDING_GAP = 3.5;
const BUILDING_ORIGIN_A: [number, number, number] = [20, GROUND_Y, 145];
const BUILDING_ORIGIN_B: [number, number, number] = [
  BUILDING_ORIGIN_A[0] + BUILDING_WIDTH + BUILDING_GAP,
  GROUND_Y,
  145,
];

// Flight control tuning (units per second / radians per second).
const MAX_BANK = 0.62;

// World units follow the A320 model scale (~12.5 units long vs 37.6 m real).
const KNOTS_TO_MPS = 0.514444;
const METERS_PER_UNIT = 3;
const knotsToSpeed = (knots: number) => (knots * KNOTS_TO_MPS) / METERS_PER_UNIT;
const speedToKnots = (speed: number) => (speed * METERS_PER_UNIT) / KNOTS_TO_MPS;
const unitsToFpm = (speed: number) => speed * METERS_PER_UNIT * 196.85;

// Typical A320-200 at ~65 t. Stall and landing are landing-config VS1g / VREF;
// takeoff speeds are a mid-weight Conf 1+F case. Cruise is 250 KIAS — the
// real below-10,000 ft limit, which matches this low-altitude world better
// than Mach 0.78 TAS (~450 kt).
const STALL_SPEED_KT = 105;
const V1_SPEED_KT = 142;
const VR_SPEED_KT = 149;
const V2_SPEED_KT = 155;
const VREF_SPEED_KT = 135;
const CRUISE_SPEED_KT = 250;
const VMO_SPEED_KT = 350;
const MAX_THRUST_SPEED_KT = 330;

const STALL_SPEED = knotsToSpeed(STALL_SPEED_KT);
const VR_SPEED = knotsToSpeed(VR_SPEED_KT);
const CRUISE_SPEED = knotsToSpeed(CRUISE_SPEED_KT);
const MAX_THRUST_SPEED = knotsToSpeed(MAX_THRUST_SPEED_KT);
const VLS_SPEED = STALL_SPEED * 1.23;
const FOV_MIN_SPEED = knotsToSpeed(130);
const FOV_MAX_SPEED = knotsToSpeed(300);

const GRAVITY = 9.81;
// Airborne spawn: cruise speed with the throttle that holds that speed in
// level flight, so a restart does not immediately stall.
const INITIAL_AIRSPEED = CRUISE_SPEED;
const INITIAL_THROTTLE = (CRUISE_SPEED / MAX_THRUST_SPEED) ** 2;
const THROTTLE_RATE = 0.32;
// Full throttle tops out near 330 kt. Acceleration is quicker than a real
// A320 takeoff roll so V1 still arrives in a playable ~8 s.
const MAX_ENGINE_ACCELERATION = 4.5;
const DRAG_COEFFICIENT = MAX_ENGINE_ACCELERATION / MAX_THRUST_SPEED ** 2;
// Level wings only make a fraction of weight, so accelerating with the stick
// neutral stays on the runway. Cl is tuned so 1 g stall is at 105 kt / 24° AoA
// and rotation at VR (~149 kt, ~12° AoA) just produces enough lift to fly.
const LIFT_BASE_ACCELERATION = GRAVITY * 0.18;
const LIFT_AOA_ACCELERATION = GRAVITY * 13.1;
const MAX_LIFT_ACCELERATION = GRAVITY * 2.4;
// Nose-up attitude that makes 1 g at cruise with the stick neutral.
const TRIM_AOA = (GRAVITY - LIFT_BASE_ACCELERATION) / LIFT_AOA_ACCELERATION;
const PITCH_SPEED = 0.7;
const MAX_PITCH = 0.55;
// A320 rotation is about 15° pitch, not a full stall pull.
const MAX_GROUND_PITCH = 0.28;
// Critical angle of attack. The stall meter fills as AoA approaches this.
const STALL_AOA = 0.42;
const SIDESLIP_DAMPING = 2.4;
const MAX_SAFE_LANDING_SPEED = 5;
const MAX_SAFE_WALL_IMPACT = 5;
const PHYSICS_STEP = 1 / 60;
const POSE_SEND_INTERVAL = 1 / 20;

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
let captureFlightKeys = false;
let canvasInView = false;
let gameStarted = false;

function updateCaptureFlightKeys() {
  captureFlightKeys = gameStarted && canvasInView;
}

export default function App() {
  const debug = useFlightStore((state) => state.debug);
  const resetVersion = useFlightStore((state) => state.resetVersion);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [sceneLoaded, setSceneLoaded] = useState(false);
  const [inView, setInView] = useState(false);
  const [started, setStarted] = useState(false);
  useGameConnection();

  const handleSceneReady = useCallback(() => setSceneLoaded(true), []);
  const startGame = useCallback(() => {
    if (gameStarted) return;
    gameStarted = true;
    setStarted(true);
    updateCaptureFlightKeys();
  }, []);

  useEffect(() => {
    gameStarted = false;
    return () => {
      gameStarted = false;
      canvasInView = false;
      updateCaptureFlightKeys();
    };
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyK") {
        event.preventDefault();
        if (!event.repeat) useFlightStore.getState().toggleDebug();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting && entry.intersectionRatio >= 0.45;
        canvasInView = visible;
        setInView(visible);
        updateCaptureFlightKeys();
      },
      { threshold: [0, 0.45, 1] },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      canvasInView = false;
      updateCaptureFlightKeys();
    };
  }, []);

  return (
    <>
      <Portfolio />
      <div ref={canvasRef} className="relative h-screen w-full snap-start">
        <ConnectionBadge />
        <DebugPanel />
        <GameLoadingScreen
          loaded={sceneLoaded}
          inView={inView}
          started={started}
          onStart={startGame}
        />
        <Canvas
          camera={{ fov: BASE_FOV, near: 0.1, far: 1100 }}
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
              paused={!started}
            >
              <WorldCube debug={debug} />
              <WorldColliders />
              <group key={`buildings-${resetVersion}`}>
                <CrumblingBuilding origin={BUILDING_ORIGIN_A} />
                <CrumblingBuilding origin={BUILDING_ORIGIN_B} />
              </group>
              <Aircraft key={`aircraft-${resetVersion}`} debug={debug} />
              <RemoteFleet debug={debug} />
              <SceneReady onReady={handleSceneReady} />
            </Physics>
          </Suspense>
        </Canvas>
      </div>
    </>
  );
}

function SceneReady({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

function GameLoadingScreen({
  loaded,
  inView,
  started,
  onStart,
}: {
  loaded: boolean;
  inView: boolean;
  started: boolean;
  onStart: () => void;
}) {
  useEffect(() => {
    if (!loaded || !inView || started) return;
    const id = window.setTimeout(onStart, 900);
    return () => window.clearTimeout(id);
  }, [loaded, inView, started, onStart]);

  useEffect(() => {
    if (started) return;
    const onKey = (event: KeyboardEvent) => {
      if (!inView) return;
      if (event.code === "Space" || event.key === " ") event.preventDefault();
      if (loaded && (event.code === "Space" || event.code === "Enter")) onStart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inView, loaded, started, onStart]);

  if (started) return null;

  return (
    <div
      onClick={loaded ? onStart : undefined}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        display: "grid",
        placeContent: "center",
        background: "#000",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        cursor: loaded ? "pointer" : "default",
      }}
    >
      {loaded ? "Ready" : "Loading"}
    </div>
  );
}

function ConnectionBadge() {
  const connection = useFlightStore((state) => state.connection);
  const remotes = useFlightStore((state) => state.playerIds.length);
  const live = connection === "connected";
  const playerCount = live ? remotes + 1 : remotes;

  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 3,
        padding: "6px 10px",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        color: live ? "#d7ffe6" : "#ffe9c2",
        background: live ? "rgba(0, 20, 8, 0.55)" : "rgba(28, 16, 0, 0.55)",
        border: live ? "1px solid rgba(120, 255, 170, 0.35)" : "1px solid rgba(255, 196, 120, 0.4)",
        borderRadius: 6,
        pointerEvents: "none",
      }}
    >
      {live
        ? `LIVE · ${gameClient.playerName} · ${playerCount} ${playerCount === 1 ? "pilot" : "pilots"}`
        : connection === "connecting"
          ? "Connecting to game server"
          : "Offline · physics still local"}
    </div>
  );
}

function stallProximity(airspeed: number, angleOfAttack: number, grounded: boolean) {
  const aoaStall = THREE.MathUtils.clamp(angleOfAttack / STALL_AOA, 0, 1);
  if (grounded) return aoaStall;
  const speedStall = THREE.MathUtils.clamp(
    (VLS_SPEED - airspeed) / (VLS_SPEED - STALL_SPEED),
    0,
    1,
  );
  return Math.max(aoaStall, speedStall);
}

function DebugPanel() {
  const {
    debug,
    fps,
    airspeed,
    throttle,
    verticalSpeed,
    angleOfAttack,
    grounded,
    crashed,
    position,
    connection,
    localPlayerId,
    players,
  } = useFlightStore();
  const stallRatio = stallProximity(airspeed, angleOfAttack, grounded);
  const stallPercent = Math.round(stallRatio * 100);
  const stallColor = stallRatio >= 0.85 ? "#ff5a5a" : stallRatio >= 0.6 ? "#ffcc33" : "#7dff9a";
  const knots = Math.max(0, speedToKnots(airspeed));
  const verticalFpm = unitsToFpm(verticalSpeed);

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
      <div>
        {connection} · {gameClient.playerName} · id {localPlayerId ?? "--"} ·{" "}
        {connection === "connected" ? players.length + 1 : players.length} pilots
      </div>
      <div>
        {Math.round(knots)} kt · {Math.round(throttle * 100)}% throttle
      </div>
      <div>
        VS {STALL_SPEED_KT} · V1 {V1_SPEED_KT} · VR {VR_SPEED_KT} · V2 {V2_SPEED_KT} · VREF {VREF_SPEED_KT} · VMO {VMO_SPEED_KT}
      </div>
      <div>Vertical {verticalFpm >= 0 ? "+" : ""}{Math.round(verticalFpm)} ft/min</div>
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
      <div>{crashed ? "CRASHED" : grounded ? "GROUND" : "AIRBORNE"} · client physics</div>
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
const SKY_RADIUS = 1000;
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
const GROUND_GEOMETRY = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
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
  const box = new THREE.BoxGeometry(WORLD_SIZE, WORLD_HEIGHT, WORLD_SIZE);
  const index = box.getIndex()!;
  // Drop the -Y face so it cannot z-fight with the ground plane.
  const dropped = box.groups[3];
  const kept = Array.from(index.array).filter(
    (_, i) => i < dropped.start || i >= dropped.start + dropped.count,
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

function WorldCube({ debug }: { debug: boolean }) {
  const ref = useRef<THREE.Mesh>(null);

  return (
    <>
      <Skybox />
      <group>
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
  const halfSize = WORLD_SIZE / 2;
  const halfHeight = WORLD_HEIGHT / 2;

  return (
    <RigidBody type="fixed" colliders={false} name="world">
      <CuboidCollider
        name="ground"
        args={[halfSize, 0.5, halfSize]}
        position={[0, GROUND_Y - 0.5, 0]}
        friction={0.18}
        restitution={0.04}
      />
      <CuboidCollider name="ceiling" args={[halfSize, 0.5, halfSize]} position={[0, halfHeight + 0.5, 0]} />
      <CuboidCollider name="wall-x" args={[0.5, halfHeight, halfSize]} position={[halfSize + 0.5, 0, 0]} />
      <CuboidCollider name="wall-x" args={[0.5, halfHeight, halfSize]} position={[-halfSize - 0.5, 0, 0]} />
      <CuboidCollider name="wall-z" args={[halfSize, halfHeight, 0.5]} position={[0, 0, halfSize + 0.5]} />
      <CuboidCollider name="wall-z" args={[halfSize, halfHeight, 0.5]} position={[0, 0, -halfSize - 0.5]} />
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
      const code = e.code || (e.key === " " ? "Space" : "");
      if (!captureFlightKeys) return;
      if (FLIGHT_KEYS.has(code)) e.preventDefault();
      if (code) keys.current[code] = true;
      if (e.key === " ") keys.current.Space = true;
    };
    const up = (e: KeyboardEvent) => {
      const code = e.code || (e.key === " " ? "Space" : "");
      if (code) keys.current[code] = false;
      if (e.key === " ") keys.current.Space = false;
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
  const pitchTarget = useRef(TRIM_AOA);
  const throttle = useRef(INITIAL_THROTTLE);
  const angleOfAttack = useRef(0);
  const telemetryElapsed = useRef(0);
  const poseElapsed = useRef(POSE_SEND_INTERVAL);
  const poseSeq = useRef(0);
  const groundContacts = useRef(0);
  const crashed = useRef(false);
  const keys = useKeyboard();

  const publishPose = () => {
    if (useFlightStore.getState().connection !== "connected") return;
    const body = bodyRef.current;
    if (!body) return;
    const velocity = body.linvel();
    const position = body.translation();
    const rotation = body.rotation();
    const flight = useFlightStore.getState();
    poseSeq.current += 1;
    gameClient.sendPose({
      seq: poseSeq.current,
      spawn: flight.resetVersion,
      x: position.x,
      y: position.y,
      z: position.z,
      qx: rotation.x,
      qy: rotation.y,
      qz: rotation.z,
      qw: rotation.w,
      vx: velocity.x,
      vy: velocity.y,
      vz: velocity.z,
      throttle: throttle.current,
      airspeed: Math.hypot(velocity.x, velocity.y, velocity.z),
      verticalSpeed: velocity.y,
      angleOfAttack: angleOfAttack.current,
      grounded: groundContacts.current > 0,
      crashed: crashed.current,
      crashReason: flight.crashReason,
    });
  };

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
    publishPose();
  };

  const handleCollisionEnter = (event: CollisionEnterPayload) => {
    const surface = event.other.colliderObject?.name ?? event.other.rigidBodyObject?.name ?? "";
    const velocity = impactVelocity.current;

    if (surface === "ground") {
      groundContacts.current += 1;
      const impactSpeed = Math.max(0, -velocity.y);
      if (impactSpeed > MAX_SAFE_LANDING_SPEED) {
        crashPlane(`Hard landing at ${Math.round(unitsToFpm(impactSpeed))} ft/min`, impactSpeed);
      }
      return;
    }

    if (surface === "building" || surface === "building-debris") {
      crashPlane("Collision with a building", velocity.length());
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

    const forwardAirspeed = Math.max(0, linearVelocity.dot(forward));
    const groundedNow = groundContacts.current > 0;
    const rotateGate = groundedNow
      ? THREE.MathUtils.smoothstep(STALL_SPEED * 0.7, VR_SPEED, forwardAirspeed)
      : 1;
    const pitchLimit = (groundedNow ? MAX_GROUND_PITCH : MAX_PITCH) * rotateGate;
    if (pitch) {
      pitchTarget.current = THREE.MathUtils.clamp(
        pitchTarget.current + pitch * PITCH_SPEED * PHYSICS_STEP,
        -pitchLimit,
        pitchLimit,
      );
    } else {
      pitchTarget.current = THREE.MathUtils.damp(
        pitchTarget.current,
        groundedNow ? 0 : TRIM_AOA,
        0.65,
        PHYSICS_STEP,
      );
    }
    if (groundedNow) {
      pitchTarget.current = THREE.MathUtils.clamp(
        pitchTarget.current,
        -pitchLimit,
        pitchLimit,
      );
    }

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
    let liftCoeff = LIFT_BASE_ACCELERATION + LIFT_AOA_ACCELERATION * aoa;
    if (!groundedNow && aoa > STALL_AOA) {
      const stallDepth = THREE.MathUtils.clamp((aoa - STALL_AOA) / 0.12, 0, 1);
      const stalledCoeff = LIFT_BASE_ACCELERATION + LIFT_AOA_ACCELERATION * STALL_AOA;
      liftCoeff = THREE.MathUtils.lerp(stalledCoeff, stalledCoeff * 0.25, stallDepth);
    }
    const liftAcceleration = THREE.MathUtils.clamp(
      (forwardAirspeed / CRUISE_SPEED) ** 2 * liftCoeff,
      -MAX_LIFT_ACCELERATION,
      MAX_LIFT_ACCELERATION,
    );
    // At VR, pulling back has to break the gear tripod and fly. Add a rotation
    // lift assist so takeoff happens near the real 149 kt rotate speed.
    const rotationLift =
      groundedNow && pitch > 0
        ? GRAVITY *
          1.25 *
          THREE.MathUtils.smoothstep(VR_SPEED * 0.97, VR_SPEED * 1.03, forwardAirspeed)
        : 0;
    const sideslipSpeed = linearVelocity.dot(right);

    totalForce
      .copy(forward)
      .multiplyScalar(throttle.current * MAX_ENGINE_ACCELERATION * mass)
      .addScaledVector(up, (liftAcceleration + rotationLift) * mass);
    if (speed > 0.001) {
      totalForce.addScaledVector(linearVelocity, -DRAG_COEFFICIENT * speed * mass);
      if (groundedNow) {
        // The gear colliders cannot roll, so keep contact friction low and
        // apply a small constant rolling resistance instead.
        totalForce.addScaledVector(linearVelocity, -(0.35 * mass) / speed);
      }
    }
    totalForce.addScaledVector(right, -sideslipSpeed * SIDESLIP_DAMPING * mass);
    body.addForce(totalForce, true);
    const bankAngle = Math.atan2(right.y, up.y);
    const pitchRate = angularVelocity.dot(right);
    const rollRate = angularVelocity.dot(forward);
    const yawRate = angularVelocity.dot(up);
    const pitchError = pitchTarget.current - pitchAngle;
    const bankError = -turn * MAX_BANK - bankAngle;
    const pitchGain = groundedNow ? 88 : 34;
    const pitchDamp = groundedNow ? 14 : 9;

    totalTorque
      .copy(right)
      .multiplyScalar((-pitchError * pitchGain - pitchRate * pitchDamp) * mass * controlAuthority)
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

    poseElapsed.current += delta;
    if (poseElapsed.current >= POSE_SEND_INTERVAL) {
      poseElapsed.current -= POSE_SEND_INTERVAL;
      if (poseElapsed.current >= POSE_SEND_INTERVAL) poseElapsed.current = 0;
      publishPose();
    }
  });

  return (
    <>
      <RigidBody
        ref={bodyRef}
        name="aircraft"
        colliders={false}
        position={[0, SPAWN_Y, SPAWN_Z]}
        rotation={[-TRIM_AOA, 0, 0]}
        linearVelocity={[0, 0, INITIAL_AIRSPEED]}
        linearDamping={0.004}
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
        <BallCollider name="aircraft-gear" args={[0.22]} position={[-2.05, 0.59, -5.7]} friction={0.1} />
        <BallCollider name="aircraft-gear" args={[0.22]} position={[2.05, 0.59, -5.7]} friction={0.1} />
        <BallCollider name="aircraft-gear" args={[0.22]} position={[0, 0.59, -1.8]} friction={0.1} />
      </RigidBody>
      {debug && <LocalEntityBounds target={modelRef} />}
      <GroundShadow target={ref} />
      <ChaseCamera target={ref} body={bodyRef} />
      <Explosion ref={explosionRef} groundY={GROUND_Y} />
    </>
  );
}

function RemoteFleet({ debug }: { debug: boolean }) {
  const localPlayerId = useFlightStore((state) => state.localPlayerId);
  const playerIds = useFlightStore((state) => state.playerIds);
  if (localPlayerId == null) return null;
  return (
    <>
      {playerIds.map((id) =>
        id === localPlayerId ? null : (
          <RemoteAircraft key={id} playerId={id} debug={debug} />
        ),
      )}
    </>
  );
}

function PilotLabel({ playerId }: { playerId: number }) {
  const name = useFlightStore(
    (state) => state.players.find((player) => player.id === playerId)?.name ?? `Pilot-${playerId}`,
  );
  return (
    <Html position={[0, 7.5, -6]} center distanceFactor={40} style={{ pointerEvents: "none" }}>
      <div
        style={{
          padding: "2px 8px",
          borderRadius: 4,
          background: "rgba(0, 0, 0, 0.55)",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </div>
    </Html>
  );
}

function RemoteAircraft({ playerId, debug }: { playerId: number; debug: boolean }) {
  const bodyRef = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Group>(null);
  const explosionRef = useRef<ExplosionHandle>(null);
  const crashed = useRef(false);
  const spawn = useFlightStore(
    (state) => state.players.find((player) => player.id === playerId)?.spawn ?? 0,
  );

  useFrame(() => {
    const pose = samplePlayer(playerId);
    const body = bodyRef.current;
    if (!pose || !body) return;

    body.position.set(pose.x, pose.y, pose.z);
    body.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);

    if (pose.crashed && !crashed.current) {
      crashed.current = true;
      const explosionPosition = new THREE.Vector3(0, 2, -5.5);
      body.localToWorld(explosionPosition);
      explosionRef.current?.trigger(explosionPosition);
    }
    if (!pose.crashed) crashed.current = false;
  });

  return (
    <>
      <group ref={bodyRef} position={[0, SPAWN_Y, SPAWN_Z]}>
        <group ref={modelRef}>
          <AirbusA320 />
        </group>
        <PilotLabel playerId={playerId} />
      </group>
      {debug && <LocalEntityBounds target={modelRef} />}
      <Explosion key={spawn} ref={explosionRef} groundY={GROUND_Y} />
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
