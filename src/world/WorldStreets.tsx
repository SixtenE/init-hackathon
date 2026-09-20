import { useTexture } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { gameMap, type MapStreet } from "./map";

const SIDEWALK_Y = 0.025;
const ASPHALT_Y = 0.05;
const MARKING_Y = 0.07;
const LOT_Y = 0.014;
const PARKING_LINE_Y = 0.018;
const PARK_Y = 0.02;
const TILE_SIZE = 10;
const DASH_LENGTH = 2.6;
const DASH_GAP = 2.1;
const STALL_SPACING = 2.8;

function planeXZ(x: number, z: number, width: number, depth: number, y: number, tile = false): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(x, y, z);
  if (tile) {
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < position.count; i++) {
      uv.setXY(i, position.getX(i) / TILE_SIZE, position.getZ(i) / TILE_SIZE);
    }
    uv.needsUpdate = true;
  }
  return geometry;
}

function mergePlanes(planes: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (planes.length === 0) return null;
  const merged = mergeGeometries(planes);
  planes.forEach((plane) => plane.dispose());
  return merged;
}

function alongRange(street: MapStreet): { start: number; end: number } {
  if (street.axis === "x") {
    return { start: street.x - street.length / 2, end: street.x + street.length / 2 };
  }
  return { start: street.z - street.length / 2, end: street.z + street.length / 2 };
}

function clearSegments(street: MapStreet): { start: number; end: number }[] {
  const { start, end } = alongRange(street);
  const crosses = street.axis === "x" ? gameMap.grid.avenueXs : gameMap.grid.streetZs;
  const holes = crosses
    .map((cross) => {
      const width =
        street.axis === "x"
          ? cross === 0
            ? gameMap.grid.centerAvenueWidth
            : gameMap.grid.avenueWidth
          : gameMap.grid.streetWidth;
      const hole = width / 2 + 0.9;
      return { a: cross - hole, b: cross + hole };
    })
    .filter((item) => item.b > start && item.a < end)
    .sort((left, right) => left.a - right.a);

  const segments: { start: number; end: number }[] = [];
  let cursor = start;
  for (const holeRange of holes) {
    if (holeRange.a > cursor + 1.2) segments.push({ start: cursor, end: holeRange.a });
    cursor = Math.max(cursor, holeRange.b);
  }
  if (end > cursor + 1.2) segments.push({ start: cursor, end });
  return segments;
}

function markingRect(
  street: MapStreet,
  alongStart: number,
  alongEnd: number,
  offset: number,
  thickness: number,
): THREE.BufferGeometry {
  const length = alongEnd - alongStart;
  const mid = (alongStart + alongEnd) / 2;
  if (street.axis === "x") {
    return planeXZ(mid, street.z + offset, length, thickness, MARKING_Y);
  }
  return planeXZ(street.x + offset, mid, thickness, length, MARKING_Y);
}

function buildStreetGeometries() {
  const sidewalkWidth = gameMap.grid.sidewalkWidth;
  const sidewalks: THREE.BufferGeometry[] = [];
  const asphalt: THREE.BufferGeometry[] = [];
  const dashes: THREE.BufferGeometry[] = [];
  const yellow: THREE.BufferGeometry[] = [];

  for (const street of gameMap.streets) {
    const asphaltWidth = Math.max(4, street.width - sidewalkWidth * 2);
    if (street.axis === "x") {
      sidewalks.push(planeXZ(street.x, street.z, street.length, street.width, SIDEWALK_Y));
      asphalt.push(planeXZ(street.x, street.z, street.length, asphaltWidth, ASPHALT_Y, true));
    } else {
      sidewalks.push(planeXZ(street.x, street.z, street.width, street.length, SIDEWALK_Y));
      asphalt.push(planeXZ(street.x, street.z, asphaltWidth, street.length, ASPHALT_Y, true));
    }

    const segments = clearSegments(street);
    if (street.axis === "z") {
      for (const segment of segments) {
        yellow.push(markingRect(street, segment.start, segment.end, -0.2, 0.12));
        yellow.push(markingRect(street, segment.start, segment.end, 0.2, 0.12));
      }
      continue;
    }

    const period = DASH_LENGTH + DASH_GAP;
    for (const segment of segments) {
      for (let t = segment.start; t + DASH_LENGTH <= segment.end; t += period) {
        dashes.push(markingRect(street, t, t + DASH_LENGTH, 0, 0.16));
      }
    }
  }

  const plazas: THREE.BufferGeometry[] = [];
  const parking: THREE.BufferGeometry[] = [];
  const stalls: THREE.BufferGeometry[] = [];
  for (const lot of gameMap.lots) {
    const plane = planeXZ(lot.x, lot.z, lot.width, lot.depth, LOT_Y, true);
    if (lot.kind === "parking") {
      parking.push(plane);
      const alongX = lot.width >= lot.depth;
      const span = alongX ? lot.width : lot.depth;
      const count = Math.max(2, Math.floor((span - 2.2) / STALL_SPACING));
      const start = -((count - 1) * STALL_SPACING) / 2;
      for (let i = 0; i < count; i++) {
        const offset = start + i * STALL_SPACING;
        if (alongX) {
          stalls.push(planeXZ(lot.x + offset, lot.z, 0.11, Math.max(2, lot.depth - 2.4), PARKING_LINE_Y));
        } else {
          stalls.push(planeXZ(lot.x, lot.z + offset, Math.max(2, lot.width - 2.4), 0.11, PARKING_LINE_Y));
        }
      }
    } else {
      plazas.push(plane);
    }
  }

  const parks = gameMap.parks.map((park) => planeXZ(park.x, park.z, park.width, park.depth, PARK_Y));

  return {
    sidewalks: mergePlanes(sidewalks),
    asphalt: mergePlanes(asphalt),
    dashes: mergePlanes(dashes),
    yellow: mergePlanes(yellow),
    plazas: mergePlanes(plazas),
    parking: mergePlanes(parking),
    stalls: mergePlanes(stalls),
    parks: mergePlanes(parks),
  };
}

const STREET_GEOMETRIES = buildStreetGeometries();

const sidewalkMaterial = new THREE.MeshLambertMaterial({
  color: "#c4c0b6",
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});
const plazaMaterial = new THREE.MeshLambertMaterial({
  color: "#9b978e",
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});
const parkingMaterial = new THREE.MeshLambertMaterial({
  color: "#5e5e60",
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});
const stallMaterial = new THREE.MeshBasicMaterial({
  color: "#d7d2c4",
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
const dashMaterial = new THREE.MeshBasicMaterial({
  color: "#ece8d6",
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
const yellowMaterial = new THREE.MeshBasicMaterial({
  color: "#e2c34a",
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
const parkMaterial = new THREE.MeshLambertMaterial({
  color: "#4d7340",
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

export function WorldStreets({ groundY }: { groundY: number }) {
  const [asphaltMap, grungeMap] = useTexture([
    "/models/city/LR_Asphalt02.jpg",
    "/models/city/LR_abstract-black-gray-grunge-texture-pattern-background.jpg",
  ]);
  const asphaltMaterial = useMemo(() => {
    asphaltMap.wrapS = THREE.RepeatWrapping;
    asphaltMap.wrapT = THREE.RepeatWrapping;
    asphaltMap.anisotropy = 8;
    asphaltMap.colorSpace = THREE.SRGBColorSpace;
    grungeMap.wrapS = THREE.RepeatWrapping;
    grungeMap.wrapT = THREE.RepeatWrapping;
    grungeMap.anisotropy = 4;
    grungeMap.colorSpace = THREE.SRGBColorSpace;
    plazaMaterial.map = grungeMap;
    plazaMaterial.needsUpdate = true;
    parkingMaterial.map = asphaltMap;
    parkingMaterial.needsUpdate = true;
    return new THREE.MeshLambertMaterial({
      map: asphaltMap,
      color: "#9a9a9a",
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }, [asphaltMap, grungeMap]);

  return (
    <group position={[0, groundY, 0]}>
      {STREET_GEOMETRIES.plazas && <mesh geometry={STREET_GEOMETRIES.plazas} material={plazaMaterial} />}
      {STREET_GEOMETRIES.parking && (
        <mesh geometry={STREET_GEOMETRIES.parking} material={parkingMaterial} />
      )}
      {STREET_GEOMETRIES.parks && <mesh geometry={STREET_GEOMETRIES.parks} material={parkMaterial} />}
      {STREET_GEOMETRIES.sidewalks && (
        <mesh geometry={STREET_GEOMETRIES.sidewalks} material={sidewalkMaterial} />
      )}
      {STREET_GEOMETRIES.asphalt && (
        <mesh geometry={STREET_GEOMETRIES.asphalt} material={asphaltMaterial} />
      )}
      {STREET_GEOMETRIES.stalls && <mesh geometry={STREET_GEOMETRIES.stalls} material={stallMaterial} />}
      {STREET_GEOMETRIES.dashes && <mesh geometry={STREET_GEOMETRIES.dashes} material={dashMaterial} />}
      {STREET_GEOMETRIES.yellow && <mesh geometry={STREET_GEOMETRIES.yellow} material={yellowMaterial} />}
    </group>
  );
}
