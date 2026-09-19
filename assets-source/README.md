# Source assets

Editable / intermediate 3D files live here. **Nothing in this folder is served
to the browser** — only the optimized `.glb` files in `public/models/` are.

```text
FBX or other source → Blender (.blend) → export .glb → gltf-transform optimize → public/models/*.glb → React
```

| File | Role |
| --- | --- |
| `Airbus A320.fbx` + `Airbus A320.fbm/` | Original interchange source + its textures. Import into Blender only. |
| `airbus-a320.uncompressed.glb` | Raw GLB export (input to the optimizer). Re-export this from Blender when the model changes. |
| `*.blend` | Editable Blender scene (add when you start editing in Blender). |

## Rebuilding the runtime asset

```sh
pnpm models:optimize   # → public/models/airbus-a320.glb (Draco + WebP)
pnpm models:inspect    # verify meshes, textures and animation clips
```

`optimize` runs dedup → flatten → join → weld → simplify → prune → texture
compress (WebP) → Draco. For the A320 this took the asset from 10 MB to ~600 KB
and pruned 26 empty animation clips, leaving the 9 real landing-gear clips.

Animated nodes (landing gear, gear doors, wheels) are left as separate meshes
by `join`, so the clips still target the right objects.

## Blender export checklist (for animated models)

- Apply transforms (Ctrl+A → All Transforms) on static meshes.
- Delete unused objects, cameras, lights and orphan actions.
- Verify the animation clips you need exist and are named sensibly.
- Export glTF Binary (`.glb`), include animations, then run `pnpm models:optimize`.
