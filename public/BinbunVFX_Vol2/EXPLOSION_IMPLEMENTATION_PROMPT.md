# Prompt: Implement an Explosion VFX system in React Three Fiber

Use this prompt with a coding agent (or as a spec for yourself) to build the
explosion effect described below. All referenced assets are in this folder and
are CC0 licensed (no attribution required).

---

## The prompt

I'm building a 3D web app with React Three Fiber and want a reusable, realistic
explosion effect component. I have CC0 sprite assets downloaded already — use
them; do not fetch anything else.

### Project stack

- React + Vite (or Next.js), TypeScript
- `three`, `@react-three/fiber`, `@react-three/drei`
- Postprocessing for glow: `@react-three/postprocessing` (Bloom) — optional but recommended

### Assets to use (paths relative to this folder)

| File(s) | Role in the explosion |
|---|---|
| `explosion3.png` (480×362 RGBA) | **Core boom**: a multi-frame explosion sequence; slice it as a flipbook grid and play it once on spawn, on a camera-facing billboard |
| `M484ExplosionSet1.png` (790×440, RGB, black background) | **Alternative retro/pixel look**: also a flipbook; because it has a solid black background, do NOT use alpha transparency — use `AdditiveBlending` so black renders as invisible and the effect glows |
| `kenney_particle-pack/PNG (Transparent)/flare_01.png` | **Initial flash**: one big additive billboard in the first ~0.1s, scales up fast then fades |
| `kenney_particle-pack/PNG (Transparent)/spark_01..07.png` | **Flying embers/shrapnel**: small billboards emitted radially with random velocities, gravity, shrink + fade over ~1s, additive blending |
| `kenney_particle-pack/PNG (Transparent)/smoke_01..10.png` | **Smoke plume**: alpha-blended billboards, slower, rising, growing in size, fading late (~2s), slight rotation over lifetime |
| `kenney_particle-pack/PNG (Transparent)/dirt_01..03.png` | **Debris chunks**: heavier ballistic particles with stronger gravity and tumbling rotation |
| `kenney_particle-pack/PNG (Transparent)/scorch_01.png` | **Scorch mark decal**: optional flat plane placed on the ground at the explosion point, fades slowly |

Do **not** use the `ExplosionFX/` and `shared/` folders — those are Godot
`.tscn`/`.gdshader` files from the original BinbunVFX pack and are not usable
in three.js.

### Deliverable 1: `<FlipbookBillboard />` component

A reusable component that:

1. Takes props: `url`, `cols`, `rows` (grid dimensions of the sheet),
   `duration` (seconds), `blending` ('normal' | 'additive'), `loop`.
2. Uses a `THREE.ShaderMaterial` on a `planeGeometry`, always faces the camera
   (either `<Billboard>` from drei, or a vertex shader that extracts the
   camera-facing basis from `modelViewMatrix`).
3. Fragment shader computes the frame: `frame = floor(progress * cols * rows)`,
   then `uv = (vec2(mod(frame, cols), floor(frame / cols)) + vUv) / vec2(cols, rows)`.
   Note OpenGL UV origin is bottom-left, so row 0 is the **bottom** row of the
   sheet — flip `floor(frame/cols)` accordingly if the sheet is laid out
   top-to-bottom.
4. `progress` is driven by a clock started on mount (or on an `active` prop),
   clamped to 0–1. On finish (progress >= 1), call `onFinished` so the parent
   can unmount the effect. Discard fragments with alpha < 0.1.
5. For the additive variant set `depthWrite: false`, `blending: AdditiveBlending`,
   `transparent: true`. For the alpha variant use `NormalBlending`, also
   `depthWrite: false`.

Load textures with drei's `useTexture` so they're in the suspense cache.

### Deliverable 2: `<ParticleBurst />` component

A billboard particle emitter:

1. Props: `count`, `urls: string[]` (sprite variants to pick randomly),
   `speed: [min, max]`, `size: [min, max]`, `gravity`, `drag`, `lifetime`,
   `blending`, `growth` (per-second scale multiplier, for smoke), `spin`.
2. Pre-generate particle data on mount with `useMemo`: random unit direction
   (bias directions upward for smoke, spherical for sparks), random speed,
   size, lifetime jitter, angular velocity, texture index.
3. Render with an `InstancedMesh` of planes — or one `<Billboard>` group of
   sprites if count is small (< 60). Use `useFrame` to integrate positions
   (`v += g*dt; p += v*dt`), update scale/opacity per particle. Per-instance
   opacity: pack lifetime fade into the instance color and multiply in the
   shader (with `MeshBasicMaterial` use `onBeforeCompile`, or write a small
   custom ShaderMaterial with an instanced attribute).
4. Unmount/report completion when all particles exceed their lifetimes
   (`onFinished` callback).

### Deliverable 3: `<Explosion />` — the composed effect

Combines the above into one `forwardRef` component with an imperative
`.trigger(position)` API (or `useEffect`-based auto-play), in this timeline:

| Time | Layer |
|---|---|
| 0.0–0.12s | `<FlipbookBillboard flare_01>` giant flash (or dedicated flash plane), bright `pointLight` intensity 30 → 0 |
| 0.0–0.9s | flipbook of `explosion3.png` as the core boom, scale easing from 0.2 → 1.2 |
| 0.0–1.0s | `<ParticleBurst>` sparks (additive, count ~40, gravity -9, drag) |
| 0.0–1.5s | `<ParticleBurst>` dirt debris (count ~12, gravity -14, tumble) |
| 0.2–2.5s | `<ParticleBurst>` smoke (alpha blend, count ~25, rises, grows 1→3×, fades) |
| 0.0s | `<scorch_01>` decal on ground (optional, fades over 5s) |

Also add a `<pointLight color="#ff7a33">` whose intensity decays
exponentially over ~0.4s — it sells the effect more than anything else.
Mount everything under one group positioned at the trigger point, and clean up
(remove from scene) after the last layer finishes. Support firing the same
explosion repeatedly (reset all clocks/particles on `.trigger`).

Wrap the whole thing so it can be used like:

```tsx
<Explosion ref={explosionRef} />
// elsewhere:
explosionRef.current.trigger(new THREE.Vector3(x, y, z))
```

### Quality requirements

- Billboards must never z-fight: `depthWrite: false` on all transparent
  materials; render order flash → core → sparks/debris → smoke.
- Additive layers use `AdditiveBlending` and dark pixels must contribute
  nothing (the flash/spark sprites are already black-background-friendly).
- No per-frame allocations in `useFrame` (reuse `THREE.Vector3`/`Matrix4` temps,
  `dummy Object3D` for instanced matrix updates).
- Dispose geometries/materials on unmount.
- Dampen smoke rotation slightly with a noise-ish wobble so it doesn't look mechanical.
- Add a `scale` prop so the whole effect can be sized per explosion.
- Optional demo: a ground plane and a button/pointer event that triggers the
  explosion at the click point (`onPointerDown` on the ground mesh + drei's
  raycast), plus Bloom (`intensity ~1.2, luminanceThreshold ~0.2`) on the
  canvas.

### Asset verification notes

- Confirm the grid layout of `explosion3.png` and `M484ExplosionSet1.png`
  before hardcoding `cols`/`rows`: open them, count frames, and adjust. The
  shaders should take cols/rows as props anyway.
- `M484ExplosionSet1.png` has no alpha channel — additive blending is
  mandatory for it.
- Kenney sprites are individual transparent PNGs, not sequences: treat them
  as static textures (fine — motion comes from the particles moving, not
  texture animation).
