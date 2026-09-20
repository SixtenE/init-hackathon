import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Billboard, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

type BlendMode = "normal" | "additive";

const ASSET_ROOT = "/BinbunVFX_Vol2";
const PARTICLE_ROOT = `${ASSET_ROOT}/kenney_particle-pack/PNG (Transparent)`;
const FLARE_URL = `${PARTICLE_ROOT}/flare_01.png`;
const CORE_URL = `${ASSET_ROOT}/explosion3.png`;
// explosion3.png is an opaque sheet: olive background + red grid lines. Key both out.
const CORE_CHROMA_KEYS: Array<[number, number, number]> = [
  [111, 109, 81],
  [249, 48, 61],
];
const SCORCH_URL = `${PARTICLE_ROOT}/scorch_01.png`;
const SPARK_URLS = Array.from({ length: 7 }, (_, index) => `${PARTICLE_ROOT}/spark_0${index + 1}.png`);
const SMOKE_URLS = Array.from({ length: 10 }, (_, index) => `${PARTICLE_ROOT}/smoke_${String(index + 1).padStart(2, "0")}.png`);
const DIRT_URLS = Array.from({ length: 3 }, (_, index) => `${PARTICLE_ROOT}/dirt_0${index + 1}.png`);
const EXPLOSION_TEXTURE_URLS = [
  FLARE_URL,
  CORE_URL,
  SCORCH_URL,
  ...SPARK_URLS,
  ...SMOKE_URLS,
  ...DIRT_URLS,
];

// Warm VFX textures once at module load so each aircraft mount does not re-fetch.
useTexture.preload(EXPLOSION_TEXTURE_URLS);

type FlipbookBillboardProps = {
  url: string;
  cols: number;
  rows: number;
  duration: number;
  blending?: BlendMode;
  loop?: boolean;
  delay?: number;
  size?: number;
  startScale?: number;
  endScale?: number;
  atlasScale?: [number, number];
  atlasOffset?: [number, number];
  frameInset?: number;
  /** Opaque sheet colors (0-255 RGB) to treat as transparent. */
  chromaKeys?: Array<[number, number, number]>;
  renderOrder?: number;
  onFinished?: () => void;
};

const MAX_CHROMA_KEYS = 4;

export function FlipbookBillboard({
  url,
  cols,
  rows,
  duration,
  blending = "normal",
  loop = false,
  delay = 0,
  size = 1,
  startScale = 1,
  endScale = 1,
  atlasScale = [1, 1],
  atlasOffset = [0, 0],
  frameInset = 0,
  chromaKeys,
  renderOrder = 0,
  onFinished,
}: FlipbookBillboardProps) {
  const texture = useTexture(url);
  const group = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const finished = useRef(false);

  const chromaKeyVectors = useMemo(() => {
    const keys = (chromaKeys ?? []).slice(0, MAX_CHROMA_KEYS);
    const vectors = keys.map(([r, g, b]) => new THREE.Vector3(r / 255, g / 255, b / 255));
    while (vectors.length < MAX_CHROMA_KEYS) vectors.push(new THREE.Vector3(-10, -10, -10));
    return { vectors, count: keys.length };
  }, [chromaKeys]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending:
          blending === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: false,
        uniforms: {
          map: { value: texture },
          progress: { value: 0 },
          grid: { value: new THREE.Vector2(cols, rows) },
          atlasScale: { value: new THREE.Vector2(...atlasScale) },
          atlasOffset: { value: new THREE.Vector2(...atlasOffset) },
          frameInset: { value: frameInset },
          chromaKeys: { value: chromaKeyVectors.vectors },
          chromaKeyCount: { value: chromaKeyVectors.count },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D map;
          uniform float progress;
          uniform vec2 grid;
          uniform vec2 atlasScale;
          uniform vec2 atlasOffset;
          uniform float frameInset;
          uniform vec3 chromaKeys[${MAX_CHROMA_KEYS}];
          uniform int chromaKeyCount;
          varying vec2 vUv;

          void main() {
            float frameCount = grid.x * grid.y;
            float frame = min(floor(progress * frameCount), frameCount - 1.0);
            float column = mod(frame, grid.x);
            float topDownRow = floor(frame / grid.x);
            float row = grid.y - 1.0 - topDownRow;
            vec2 insetUv = mix(vec2(frameInset), vec2(1.0 - frameInset), vUv);
            vec2 frameUv = (vec2(column, row) + insetUv) / grid;
            vec2 atlasUv = atlasOffset + frameUv * atlasScale;
            vec4 color = texture2D(map, atlasUv);
            if (color.a < 0.1) discard;
            for (int i = 0; i < ${MAX_CHROMA_KEYS}; i++) {
              if (i >= chromaKeyCount) break;
              if (distance(color.rgb, chromaKeys[i]) < 0.12) discard;
            }
            gl_FragColor = color;
          }
        `,
      }),
    [atlasOffset, atlasScale, blending, chromaKeyVectors, cols, frameInset, rows, texture],
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, delta) => {
    elapsed.current += Math.min(delta, 0.05);
    const localTime = elapsed.current - delay;
    const visible = localTime >= 0;
    if (group.current) group.current.visible = visible;
    if (!visible) return;

    const rawProgress = localTime / duration;
    const progress = loop
      ? THREE.MathUtils.euclideanModulo(rawProgress, 1)
      : THREE.MathUtils.clamp(rawProgress, 0, 1);
    // Three.js materials are intentionally mutable inside the render loop.
    // eslint-disable-next-line react/immutability
    material.uniforms.progress.value = progress;
    const eased = 1 - (1 - progress) ** 3;
    const animatedScale = size * THREE.MathUtils.lerp(startScale, endScale, eased);
    group.current?.scale.setScalar(animatedScale);

    if (!loop && rawProgress >= 1 && !finished.current) {
      finished.current = true;
      onFinished?.();
    }
  });

  return (
    <Billboard ref={group} renderOrder={renderOrder}>
      <mesh material={material}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </Billboard>
  );
}

type ParticleBurstProps = {
  count: number;
  urls: string[];
  speed: [number, number];
  size: [number, number];
  gravity: number;
  drag: number;
  lifetime: number;
  blending: BlendMode;
  growth?: number;
  spin?: number;
  upwardBias?: number;
  delay?: number;
  renderOrder?: number;
  onFinished?: () => void;
};

type Particle = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  size: number;
  age: number;
  lifetime: number;
  angle: number;
  angularVelocity: number;
};

const particleDummy = new THREE.Object3D();
const particleSpin = new THREE.Quaternion();
const particleZ = new THREE.Vector3(0, 0, 1);

function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRange([min, max]: [number, number], random: () => number) {
  return THREE.MathUtils.lerp(min, max, random());
}

export function ParticleBurst({
  count,
  urls,
  speed,
  size,
  gravity,
  drag,
  lifetime,
  blending,
  growth = 0,
  spin = 0,
  upwardBias = 0,
  delay = 0,
  renderOrder = 0,
  onFinished,
}: ParticleBurstProps) {
  const textures = useTexture(urls) as THREE.Texture[];
  const meshes = useRef<Array<THREE.InstancedMesh | null>>([]);
  const finished = useRef(false);

  const batches = useMemo(() => {
    const random = createSeededRandom(count * 977 + urls.length * 131 + Math.round(lifetime * 100));
    const result = textures.map(() => [] as Particle[]);
    for (let index = 0; index < count; index += 1) {
      const direction = new THREE.Vector3(
        random() * 2 - 1,
        random() * 2 - 1,
        random() * 2 - 1,
      );
      if (upwardBias > 0) direction.y = Math.abs(direction.y) + upwardBias;
      direction.normalize().multiplyScalar(randomRange(speed, random));
      result[index % result.length].push({
        position: new THREE.Vector3(
          (random() - 0.5) * 0.5,
          (random() - 0.5) * 0.35,
          (random() - 0.5) * 0.5,
        ),
        velocity: direction,
        size: randomRange(size, random),
        age: -delay - random() * 0.08,
        lifetime: lifetime * THREE.MathUtils.lerp(0.8, 1.2, random()),
        angle: random() * Math.PI * 2,
        angularVelocity: (random() * 2 - 1) * spin,
      });
    }
    return result;
  }, [count, delay, lifetime, size, speed, textures, upwardBias, spin, urls.length]);

  const resources = useMemo(
    () =>
      textures.map((texture, index) => {
        const geometry = new THREE.PlaneGeometry(1, 1);
        geometry.setAttribute(
          "particleOpacity",
          new THREE.InstancedBufferAttribute(new Float32Array(batches[index].length), 1),
        );
        return {
          geometry,
          material: new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          depthTest: true,
          blending:
            blending === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
          toneMapped: false,
          uniforms: { map: { value: texture } },
          vertexShader: `
            attribute float particleOpacity;
            varying vec2 vUv;
            varying float vOpacity;
            void main() {
              vUv = uv;
              vOpacity = particleOpacity;
              gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D map;
            varying vec2 vUv;
            varying float vOpacity;
            void main() {
              vec4 color = texture2D(map, vUv);
              if (color.a < 0.05 || vOpacity <= 0.001) discard;
              gl_FragColor = vec4(color.rgb * vOpacity, color.a * vOpacity);
            }
          `,
          }),
        };
      }),
    [batches, blending, textures],
  );

  useEffect(() => {
    meshes.current.forEach((mesh, batchIndex) => {
      if (!mesh) return;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const opacity = resources[batchIndex].geometry.getAttribute(
        "particleOpacity",
      ) as THREE.InstancedBufferAttribute;
      opacity.setUsage(THREE.DynamicDrawUsage);
    });
    return () => {
      resources.forEach(({ geometry, material }) => {
        geometry.dispose();
        material.dispose();
      });
    };
  }, [batches, resources]);

  useFrame(({ camera }, delta) => {
    const step = Math.min(delta, 0.05);
    let alive = 0;

    batches.forEach((batch, batchIndex) => {
      const mesh = meshes.current[batchIndex];
      if (!mesh) return;
      const opacityAttribute = resources[batchIndex].geometry.getAttribute(
        "particleOpacity",
      ) as THREE.InstancedBufferAttribute;

      batch.forEach((particle, index) => {
        particle.age += step;
        if (particle.age < 0 || particle.age >= particle.lifetime) {
          particleDummy.scale.setScalar(0);
          particleDummy.updateMatrix();
          mesh.setMatrixAt(index, particleDummy.matrix);
          opacityAttribute.setX(index, 0);
          return;
        }

        alive += 1;
        const life = particle.age / particle.lifetime;
        const damping = Math.exp(-drag * step);
        particle.velocity.multiplyScalar(damping);
        particle.velocity.y += gravity * step;
        particle.position.addScaledVector(particle.velocity, step);
        particle.angle += particle.angularVelocity * step;

        const fadeIn = THREE.MathUtils.smoothstep(life, 0, 0.08);
        const fadeOut = 1 - THREE.MathUtils.smoothstep(life, 0.55, 1);
        const opacity = fadeIn * fadeOut;
        const wobble = 1 + Math.sin(particle.age * 5 + index * 1.7) * 0.04;
        const particleScale = particle.size * (1 + growth * particle.age) * wobble;

        particleDummy.position.copy(particle.position);
        particleDummy.quaternion.copy(camera.quaternion);
        particleSpin.setFromAxisAngle(particleZ, particle.angle);
        particleDummy.quaternion.multiply(particleSpin);
        particleDummy.scale.setScalar(particleScale);
        particleDummy.updateMatrix();
        mesh.setMatrixAt(index, particleDummy.matrix);
        opacityAttribute.setX(index, opacity);
      });

      mesh.instanceMatrix.needsUpdate = true;
      opacityAttribute.needsUpdate = true;
    });

    if (alive === 0 && batches.every((batch) => batch.every((particle) => particle.age >= particle.lifetime))) {
      if (!finished.current) {
        finished.current = true;
        onFinished?.();
      }
    }
  });

  return (
    <group renderOrder={renderOrder}>
      {batches.map((batch, index) => (
        <instancedMesh
          key={urls[index]}
          ref={(mesh) => {
            meshes.current[index] = mesh;
          }}
          args={[resources[index].geometry, resources[index].material, batch.length]}
          frustumCulled={false}
          renderOrder={renderOrder}
        />
      ))}
    </group>
  );
}

function ScorchMark({ groundOffset, scale }: { groundOffset: number; scale: number }) {
  const texture = useTexture(SCORCH_URL);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    elapsed.current += Math.min(delta, 0.05);
    if (material.current) {
      material.current.opacity = 0.55 * (1 - THREE.MathUtils.smoothstep(elapsed.current, 2.8, 5));
    }
  });

  return (
    <mesh position={[0, groundOffset + 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={scale} renderOrder={1}>
      <planeGeometry args={[5, 5]} />
      <meshBasicMaterial
        ref={material}
        map={texture}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        color="#2b211c"
      />
    </mesh>
  );
}

type ExplosionInstanceProps = {
  position: THREE.Vector3;
  groundY: number;
  scale: number;
  onFinished: () => void;
};

function ExplosionInstance({ position, groundY, scale, onFinished }: ExplosionInstanceProps) {
  const light = useRef<THREE.PointLight>(null);
  const elapsed = useRef(0);
  const completed = useRef(false);

  useFrame((_, delta) => {
    elapsed.current += Math.min(delta, 0.05);
    if (light.current) light.current.intensity = 32 * Math.exp(-elapsed.current * 10);
    if (elapsed.current >= 5 && !completed.current) {
      completed.current = true;
      onFinished();
    }
  });

  return (
    <group position={position} scale={scale}>
      <pointLight ref={light} color="#ff7a33" intensity={32} distance={65} decay={2} />
      <FlipbookBillboard
        url={FLARE_URL}
        cols={1}
        rows={1}
        duration={0.12}
        blending="additive"
        size={16}
        startScale={0.25}
        endScale={1.15}
        renderOrder={20}
      />
      <FlipbookBillboard
        url={CORE_URL}
        cols={5}
        rows={2}
        duration={0.9}
        blending="additive"
        size={9}
        startScale={0.2}
        endScale={1.2}
        atlasScale={[460 / 480, 184 / 362]}
        atlasOffset={[0, (362 - 184) / 362]}
        frameInset={0.025}
        chromaKeys={CORE_CHROMA_KEYS}
        renderOrder={21}
      />
      <ParticleBurst
        count={42}
        urls={SPARK_URLS}
        speed={[8, 22]}
        size={[0.3, 1]}
        gravity={-9}
        drag={1.2}
        lifetime={1}
        blending="additive"
        spin={8}
        upwardBias={0.1}
        renderOrder={22}
      />
      <ParticleBurst
        count={12}
        urls={DIRT_URLS}
        speed={[5, 13]}
        size={[0.45, 1.2]}
        gravity={-14}
        drag={0.45}
        lifetime={1.5}
        blending="normal"
        spin={10}
        upwardBias={0.35}
        renderOrder={23}
      />
      <ParticleBurst
        count={25}
        urls={SMOKE_URLS}
        speed={[1.5, 5]}
        size={[1.4, 3.2]}
        gravity={1.8}
        drag={0.8}
        lifetime={2.5}
        blending="normal"
        growth={0.8}
        spin={1.2}
        upwardBias={1.3}
        delay={0.2}
        renderOrder={24}
      />
      <ScorchMark groundOffset={groundY - position.y} scale={1 / scale} />
    </group>
  );
}

export type ExplosionHandle = {
  trigger: (position: THREE.Vector3) => void;
};

type ExplosionProps = {
  scale?: number;
  groundY?: number;
};

export const Explosion = forwardRef<ExplosionHandle, ExplosionProps>(function Explosion(
  { scale = 1, groundY = 0 },
  ref,
) {
  // Load the effect with the scene so triggering it cannot suspend and blank the canvas.
  useTexture(EXPLOSION_TEXTURE_URLS);
  const nextId = useRef(0);
  const [active, setActive] = useState<{ id: number; position: THREE.Vector3 } | null>(null);

  useImperativeHandle(ref, () => ({
    trigger(position) {
      nextId.current += 1;
      setActive({ id: nextId.current, position: position.clone() });
    },
  }));

  if (!active) return null;
  return (
    <ExplosionInstance
      key={active.id}
      position={active.position}
      groundY={groundY}
      scale={scale}
      onFinished={() => setActive((current) => current?.id === active.id ? null : current)}
    />
  );
});
