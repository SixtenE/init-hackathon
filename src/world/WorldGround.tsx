import { useTexture } from "@react-three/drei";
import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { cityExtent, gameMap } from "./map";

const extent = cityExtent();
const parkData = gameMap.parks.map(
  (park) => new THREE.Vector4(park.x, park.z, park.width, park.depth),
);
while (parkData.length < 4) parkData.push(new THREE.Vector4(0, 0, 0, 0));

export const cityGroundMaterial = new THREE.ShaderMaterial({
  toneMapped: false,
  uniforms: {
    asphaltMap: { value: null },
    grungeMap: { value: null },
    cityMin: { value: new THREE.Vector2(extent.minX, extent.minZ) },
    cityMax: { value: new THREE.Vector2(extent.maxX, extent.maxZ) },
    cityOrigin: { value: new THREE.Vector2(extent.originX, extent.originZ) },
    blockSize: { value: new THREE.Vector2(extent.blockX, extent.blockZ) },
    avenueWidth: { value: gameMap.grid.avenueWidth },
    streetWidth: { value: gameMap.grid.streetWidth },
    parks: { value: parkData },
    shadowCenter: { value: new THREE.Vector2(0, 0) },
    shadowHalfSize: { value: new THREE.Vector2(8, 13) },
    shadowYaw: { value: 0 },
    shadowOpacity: { value: 0 },
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
    uniform sampler2D asphaltMap;
    uniform sampler2D grungeMap;
    uniform vec2 cityMin;
    uniform vec2 cityMax;
    uniform vec2 cityOrigin;
    uniform vec2 blockSize;
    uniform float avenueWidth;
    uniform float streetWidth;
    uniform vec4 parks[4];
    uniform vec2 shadowCenter;
    uniform vec2 shadowHalfSize;
    uniform float shadowYaw;
    uniform float shadowOpacity;
    varying vec2 vWorldXZ;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float boxMask(vec2 p, vec2 center, vec2 size) {
      float valid = step(0.5, min(size.x, size.y));
      vec2 d = abs(p - center) - size * 0.5;
      return valid * (1.0 - smoothstep(-1.5, 1.5, max(d.x, d.y)));
    }

    void main() {
      vec2 p = vWorldXZ;
      vec3 asphalt = texture2D(asphaltMap, p / 16.0).rgb;
      vec3 grunge = texture2D(grungeMap, p / 22.0).rgb;
      float n = noise(p * 0.035);
      float nFine = noise(p * 0.22);

      vec2 cityCenter = 0.5 * (cityMin + cityMax);
      vec2 cityHalf = 0.5 * (cityMax - cityMin);
      vec2 cityDelta = abs(p - cityCenter) - cityHalf;
      float citySdf = length(max(cityDelta, 0.0)) + min(max(cityDelta.x, cityDelta.y), 0.0);
      float urban = 1.0 - smoothstep(0.0, 90.0, citySdf);
      float core = 1.0 - smoothstep(-18.0, 8.0, citySdf);

      vec2 local = (p - cityOrigin) / max(blockSize, vec2(1.0));
      vec2 blockId = floor(local);
      float blockHash = hash(blockId);
      vec2 distFromRoad = min(fract(local), 1.0 - fract(local)) * blockSize;
      float roadX = 1.0 - smoothstep(avenueWidth * 0.5 - 0.6, avenueWidth * 0.5 + 0.8, distFromRoad.x);
      float roadZ = 1.0 - smoothstep(streetWidth * 0.5 - 0.6, streetWidth * 0.5 + 0.8, distFromRoad.y);
      float road = max(roadX, roadZ);
      float walkX = 1.0 - smoothstep(avenueWidth * 0.5 + 1.4, avenueWidth * 0.5 + 2.6, distFromRoad.x);
      float walkZ = 1.0 - smoothstep(streetWidth * 0.5 + 1.4, streetWidth * 0.5 + 2.6, distFromRoad.y);
      float sidewalk = max(walkX, walkZ) * (1.0 - road);

      vec3 dirt = mix(vec3(0.27, 0.24, 0.19), vec3(0.22, 0.21, 0.17), n);
      vec3 scrub = mix(vec3(0.24, 0.27, 0.18), vec3(0.20, 0.23, 0.16), nFine);
      vec3 outskirts = mix(dirt, scrub, smoothstep(0.28, 0.72, noise(p * 0.012)));
      outskirts *= 0.88 + 0.18 * grunge.r;

      vec3 plaza = mix(vec3(0.52, 0.50, 0.46), vec3(0.44, 0.43, 0.40), blockHash);
      plaza = mix(plaza, asphalt, 0.22) * (0.82 + 0.22 * grunge.g);
      vec3 parking = mix(vec3(0.28, 0.28, 0.29), asphalt, 0.55) * (0.78 + 0.18 * nFine);
      vec3 lot = mix(plaza, parking, step(0.46, blockHash));
      vec3 walk = mix(vec3(0.58, 0.56, 0.52), grunge, 0.18);
      vec3 roadColor = mix(vec3(0.16, 0.16, 0.17), asphalt, 0.7) * 0.85;

      vec3 cityColor = mix(lot, walk, sidewalk);
      cityColor = mix(cityColor, roadColor, road);

      float park = 0.0;
      park = max(park, boxMask(p, parks[0].xy, parks[0].zw));
      park = max(park, boxMask(p, parks[1].xy, parks[1].zw));
      park = max(park, boxMask(p, parks[2].xy, parks[2].zw));
      park = max(park, boxMask(p, parks[3].xy, parks[3].zw));
      vec3 grass = mix(vec3(0.22, 0.36, 0.18), vec3(0.30, 0.44, 0.20), nFine);
      grass = mix(grass, vec3(0.18, 0.28, 0.14), noise(p * 0.08));
      cityColor = mix(cityColor, grass, park);

      vec3 fringeLot = mix(vec3(0.36, 0.34, 0.31), dirt, 0.35 + 0.3 * blockHash);
      vec3 developed = mix(fringeLot, cityColor, core);
      vec3 color = mix(outskirts, developed, urban);

      vec2 delta = p - shadowCenter;
      float s = sin(shadowYaw);
      float c = cos(shadowYaw);
      vec2 localShadow = vec2(c * delta.x - s * delta.y, s * delta.x + c * delta.y);
      float ellipse = length(localShadow / max(shadowHalfSize, vec2(1e-4)));
      float blob = 1.0 - smoothstep(0.18, 1.0, ellipse);
      color *= 1.0 - shadowOpacity * blob;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
});

export function WorldGround({ size, y }: { size: number; y: number }) {
  const [asphaltMap, grungeMap] = useTexture([
    "/models/city/LR_Asphalt02.jpg",
    "/models/city/LR_abstract-black-gray-grunge-texture-pattern-background.jpg",
  ]);
  const geometry = useMemo(() => new THREE.PlaneGeometry(size, size), [size]);

  useLayoutEffect(() => {
    asphaltMap.wrapS = asphaltMap.wrapT = THREE.RepeatWrapping;
    grungeMap.wrapS = grungeMap.wrapT = THREE.RepeatWrapping;
    asphaltMap.anisotropy = 8;
    grungeMap.anisotropy = 4;
    asphaltMap.colorSpace = THREE.SRGBColorSpace;
    grungeMap.colorSpace = THREE.SRGBColorSpace;
    cityGroundMaterial.uniforms.asphaltMap.value = asphaltMap;
    cityGroundMaterial.uniforms.grungeMap.value = grungeMap;
  }, [asphaltMap, grungeMap]);

  return (
    <mesh
      geometry={geometry}
      material={cityGroundMaterial}
      rotation-x={-Math.PI / 2}
      position-y={y}
    />
  );
}
