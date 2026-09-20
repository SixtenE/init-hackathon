import rawMap from "./map.json";
import { isCityModelId, type CityModelId } from "./cityAssetCatalog";

export const BUILDING_CELL = 3.1;

export type MapBuilding = {
  id: string;
  /** World X of the building centre. */
  x: number;
  /** World Z of the building centre. Y is the ground plane. */
  z: number;
  /** Footprint width in building-grid cells. */
  width: number;
  /** Height in building-grid cells (storeys). */
  floors: number;
  /** Footprint depth in building-grid cells. */
  depth: number;
  model: CityModelId;
  rotation: number;
};

export type MapStreet = {
  id: string;
  x: number;
  z: number;
  length: number;
  width: number;
  /** "x" streets run east-west. "z" avenues run north-south. */
  axis: "x" | "z";
};

export type MapPark = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
};

export type MapLot = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  kind: "plaza" | "parking";
};

export type CityGrid = {
  avenueXs: number[];
  streetZs: number[];
  avenueWidth: number;
  centerAvenueWidth: number;
  streetWidth: number;
  sidewalkWidth: number;
  approachZ: number;
};

export type MapGate = {
  index: number;
  x: number;
  /** Altitude of the gate centre above the ground plane. */
  y: number;
  z: number;
  /** Heading (radians about +Y) the gate faces; fly through along it. */
  yaw: number;
  width: number;
  height: number;
};

export type MapObstacle = {
  id: string;
  x: number;
  /** Altitude of the beam's underside above the ground plane. */
  y: number;
  z: number;
  yaw: number;
  /** Span of the beam along its local X. */
  length: number;
  height: number;
  depth: number;
};

export type RaceCourse = {
  name: string;
  gates: MapGate[];
  obstacles: MapObstacle[];
};

export type GameMap = {
  name: string;
  grid: CityGrid;
  buildings: MapBuilding[];
  streets: MapStreet[];
  parks: MapPark[];
  lots: MapLot[];
  course: RaceCourse;
};

type LotRect = { x: number; z: number; w: number; d: number };
type ParkSpec = { id: string; col: number; row: number };

const HALF_PI = Math.PI / 2;
const TALL_MODELS: CityModelId[] = ["tower-02", "tower-06", "tower-07"];
const MID_MODELS: CityModelId[] = ["tower-08", "tower-09", "tower-10"];
const LOW_MODELS: CityModelId[] = ["tower-10", "tower-11", "tower-08"];

function assertPositiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Map field ${label} must be a positive integer`);
  }
  return value;
}

function assertPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Map field ${label} must be a positive number`);
  }
  return value;
}

function parseNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${label} needs at least two numbers`);
  }
  const numbers = value.map((item, index) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(`${label}[${index}] must be a number`);
    }
    return item;
  });
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i]! <= numbers[i - 1]!) {
      throw new Error(`${label} must be strictly increasing`);
    }
  }
  return numbers;
}

function parseBuilding(value: unknown, index: number, label: string): MapBuilding {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} ${index} is invalid`);
  }
  const building = value as Record<string, unknown>;
  if (typeof building.id !== "string" || building.id.length === 0) {
    throw new Error(`${label} ${index} needs a string id`);
  }
  if (typeof building.x !== "number" || typeof building.z !== "number") {
    throw new Error(`${label} ${building.id} needs numeric x and z`);
  }
  if (!isCityModelId(building.model)) {
    throw new Error(`${label} ${building.id} has an unknown city model`);
  }
  if (building.rotation !== undefined && typeof building.rotation !== "number") {
    throw new Error(`${label} ${building.id} rotation must be numeric`);
  }
  return {
    id: building.id,
    x: building.x,
    z: building.z,
    width: assertPositiveInt(building.width, `${building.id}.width`),
    floors: assertPositiveInt(building.floors, `${building.id}.floors`),
    depth: assertPositiveInt(building.depth, `${building.id}.depth`),
    model: building.model,
    rotation: building.rotation ?? 0,
  };
}

function parseParkSpec(value: unknown, index: number): ParkSpec {
  if (!value || typeof value !== "object") {
    throw new Error(`Map park ${index} is invalid`);
  }
  const park = value as Record<string, unknown>;
  if (typeof park.id !== "string" || park.id.length === 0) {
    throw new Error(`Map park ${index} needs a string id`);
  }
  if (
    typeof park.col !== "number" ||
    !Number.isInteger(park.col) ||
    park.col < 0 ||
    typeof park.row !== "number" ||
    !Number.isInteger(park.row) ||
    park.row < 0
  ) {
    throw new Error(`Map park ${park.id} needs integer col and row`);
  }
  return { id: park.id, col: park.col, row: park.row };
}

function requireNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}.${key} must be a number`);
  }
  return value;
}

function parseGate(value: unknown, index: number): MapGate {
  if (!value || typeof value !== "object") {
    throw new Error(`Course gate ${index} is invalid`);
  }
  const gate = value as Record<string, unknown>;
  const label = `gate[${index}]`;
  return {
    index,
    x: requireNumber(gate, "x", label),
    y: requireNumber(gate, "y", label),
    z: requireNumber(gate, "z", label),
    yaw: typeof gate.yaw === "number" ? gate.yaw : 0,
    width: assertPositiveNumber(gate.width, `${label}.width`),
    height: assertPositiveNumber(gate.height, `${label}.height`),
  };
}

function parseObstacle(value: unknown, index: number): MapObstacle {
  if (!value || typeof value !== "object") {
    throw new Error(`Course obstacle ${index} is invalid`);
  }
  const obstacle = value as Record<string, unknown>;
  if (typeof obstacle.id !== "string" || obstacle.id.length === 0) {
    throw new Error(`Course obstacle ${index} needs a string id`);
  }
  const label = `obstacle ${obstacle.id}`;
  return {
    id: obstacle.id,
    x: requireNumber(obstacle, "x", label),
    y: requireNumber(obstacle, "y", label),
    z: requireNumber(obstacle, "z", label),
    yaw: typeof obstacle.yaw === "number" ? obstacle.yaw : 0,
    length: assertPositiveNumber(obstacle.length, `${label}.length`),
    height: assertPositiveNumber(obstacle.height, `${label}.height`),
    depth: assertPositiveNumber(obstacle.depth, `${label}.depth`),
  };
}

function parseCourse(value: unknown): RaceCourse {
  if (!value || typeof value !== "object") {
    throw new Error("Map JSON needs a course");
  }
  const course = value as Record<string, unknown>;
  if (!Array.isArray(course.gates) || course.gates.length < 2) {
    throw new Error("Course needs at least two gates");
  }
  const gates = course.gates.map(parseGate);
  const obstacles = Array.isArray(course.obstacles) ? course.obstacles.map(parseObstacle) : [];
  const ids = new Set<string>();
  for (const obstacle of obstacles) {
    if (ids.has(obstacle.id)) throw new Error(`Duplicate obstacle id "${obstacle.id}"`);
    ids.add(obstacle.id);
  }
  return {
    name: typeof course.name === "string" && course.name.length > 0 ? course.name : "Circuit",
    gates,
    obstacles,
  };
}

function parseGrid(value: unknown): CityGrid {
  if (!value || typeof value !== "object") {
    throw new Error("Map JSON needs a grid");
  }
  const grid = value as Record<string, unknown>;
  const avenueXs = parseNumberArray(grid.avenueXs, "grid.avenueXs");
  const streetZs = parseNumberArray(grid.streetZs, "grid.streetZs");
  return {
    avenueXs,
    streetZs,
    avenueWidth: assertPositiveNumber(grid.avenueWidth, "grid.avenueWidth"),
    centerAvenueWidth: assertPositiveNumber(
      grid.centerAvenueWidth ?? grid.avenueWidth,
      "grid.centerAvenueWidth",
    ),
    streetWidth: assertPositiveNumber(grid.streetWidth, "grid.streetWidth"),
    sidewalkWidth: assertPositiveNumber(grid.sidewalkWidth, "grid.sidewalkWidth"),
    approachZ: typeof grid.approachZ === "number" ? grid.approachZ : streetZs[0]!,
  };
}

function hash2(a: number, b: number): number {
  const n = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  const mixed = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildingFootprint(building: MapBuilding): LotRect {
  const width = building.width * BUILDING_CELL;
  const depth = building.depth * BUILDING_CELL;
  const quarterTurns = Math.round(building.rotation / HALF_PI);
  const swapped = Math.abs(quarterTurns) % 2 === 1;
  return {
    x: building.x,
    z: building.z,
    w: swapped ? depth : width,
    d: swapped ? width : depth,
  };
}

function overlaps(a: LotRect, b: LotRect, margin: number): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + margin && Math.abs(a.z - b.z) * 2 < a.d + b.d + margin;
}

function avenueWidthAt(grid: CityGrid, x: number): number {
  return x === 0 ? grid.centerAvenueWidth : grid.avenueWidth;
}

function blockLot(grid: CityGrid, col: number, row: number): LotRect {
  const x0 = grid.avenueXs[col]!;
  const x1 = grid.avenueXs[col + 1]!;
  const z0 = grid.streetZs[row]!;
  const z1 = grid.streetZs[row + 1]!;
  const minX = x0 + avenueWidthAt(grid, x0) / 2;
  const maxX = x1 - avenueWidthAt(grid, x1) / 2;
  const minZ = z0 + grid.streetWidth / 2;
  const maxZ = z1 - grid.streetWidth / 2;
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    w: maxX - minX,
    d: maxZ - minZ,
  };
}

function isApproachLot(grid: CityGrid, lot: LotRect): boolean {
  const firstStreet = grid.streetZs[0]!;
  return Math.abs(lot.x) < 52 && lot.z < firstStreet + 32;
}

function pickModel(floors: number, noise: number): CityModelId {
  const models = floors >= 22 ? TALL_MODELS : floors >= 12 ? MID_MODELS : LOW_MODELS;
  return models[Math.floor(noise * models.length) % models.length]!;
}

function floorsForLot(lot: LotRect, grid: CityGrid, noise: number): number {
  const coreX = 0;
  const coreZ = (grid.streetZs[0]! + grid.streetZs[grid.streetZs.length - 1]!) / 2;
  const spanX = (grid.avenueXs[grid.avenueXs.length - 1]! - grid.avenueXs[0]!) / 2;
  const spanZ = (grid.streetZs[grid.streetZs.length - 1]! - grid.streetZs[0]!) / 2;
  const dist = Math.hypot((lot.x - coreX) / spanX, (lot.z - coreZ) / spanZ);
  const core = clamp(1 - dist, 0, 1);
  const south = lot.z < grid.streetZs[0]! + 50;
  const min = south ? 5 : Math.round(7 + core * 8);
  const max = south ? 9 : Math.round(12 + core * 16);
  return clamp(Math.round(min + noise * (max - min)), min, max);
}

function buildingFromLot(
  id: string,
  lot: LotRect,
  noise: number,
  floors: number,
): MapBuilding | null {
  const maxWidth = Math.floor((lot.w - 1.2) / BUILDING_CELL);
  const maxDepth = Math.floor((lot.d - 1.2) / BUILDING_CELL);
  if (maxWidth < 3 || maxDepth < 3) return null;

  const width = clamp(Math.round(3 + noise * (maxWidth - 2)), 3, maxWidth);
  const depth = clamp(Math.round(3 + hash2(Math.round(lot.x), Math.round(lot.z) + 9) * (maxDepth - 2)), 3, maxDepth);
  const worldW = width * BUILDING_CELL;
  const worldD = depth * BUILDING_CELL;
  const slackX = Math.max(0, lot.w - worldW);
  const slackZ = Math.max(0, lot.d - worldD);
  const shiftX = (hash2(Math.round(lot.x) + 3, Math.round(lot.z)) - 0.5) * slackX * 0.7;
  const shiftZ = (hash2(Math.round(lot.x), Math.round(lot.z) + 4) - 0.5) * slackZ * 0.7;

  return {
    id,
    x: lot.x + shiftX,
    z: lot.z + shiftZ,
    width,
    floors,
    depth,
    model: pickModel(floors, noise),
    rotation: 0,
  };
}

function splitAcross(lot: LotRect, gap: number, axis: "x" | "z"): [LotRect, LotRect] {
  if (axis === "x") {
    const width = (lot.w - gap) / 2;
    return [
      { x: lot.x - (width + gap) / 2, z: lot.z, w: width, d: lot.d },
      { x: lot.x + (width + gap) / 2, z: lot.z, w: width, d: lot.d },
    ];
  }
  const depth = (lot.d - gap) / 2;
  return [
    { x: lot.x, z: lot.z - (depth + gap) / 2, w: lot.w, d: depth },
    { x: lot.x, z: lot.z + (depth + gap) / 2, w: lot.w, d: depth },
  ];
}

function generateStreets(grid: CityGrid): MapStreet[] {
  const minX = grid.avenueXs[0]!;
  const maxX = grid.avenueXs[grid.avenueXs.length - 1]!;
  const minZ = grid.streetZs[0]!;
  const maxZ = grid.streetZs[grid.streetZs.length - 1]!;
  const streets: MapStreet[] = [];

  for (const z of grid.streetZs) {
    streets.push({
      id: `street-z-${z}`,
      x: (minX + maxX) / 2,
      z,
      length: maxX - minX + grid.avenueWidth,
      width: grid.streetWidth,
      axis: "x",
    });
  }

  for (const x of grid.avenueXs) {
    const startZ = x === 0 ? grid.approachZ : minZ;
    streets.push({
      id: `avenue-x-${x}`,
      x,
      z: (startZ + maxZ) / 2,
      length: maxZ - startZ + grid.streetWidth,
      width: avenueWidthAt(grid, x),
      axis: "z",
    });
  }

  return streets;
}

function generateLots(grid: CityGrid, parks: ParkSpec[]): MapLot[] {
  const parkKeys = new Set(parks.map((park) => `${park.col}:${park.row}`));
  const cols = grid.avenueXs.length - 1;
  const rows = grid.streetZs.length - 1;
  const lots: MapLot[] = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      if (parkKeys.has(`${col}:${row}`)) continue;
      const lot = blockLot(grid, col, row);
      const noise = hash2(col + 3, row + 19);
      lots.push({
        id: `lot-${col}-${row}`,
        x: lot.x,
        z: lot.z,
        width: lot.w,
        depth: lot.d,
        kind: isApproachLot(grid, lot) || noise < 0.42 ? "plaza" : "parking",
      });
    }
  }
  return lots;
}

function generateParks(grid: CityGrid, specs: ParkSpec[]): MapPark[] {
  const cols = grid.avenueXs.length - 1;
  const rows = grid.streetZs.length - 1;
  return specs.map((spec) => {
    if (spec.col >= cols || spec.row >= rows) {
      throw new Error(`Park ${spec.id} sits outside the city grid`);
    }
    const lot = blockLot(grid, spec.col, spec.row);
    return {
      id: spec.id,
      x: lot.x,
      z: lot.z,
      width: lot.w,
      depth: lot.d,
    };
  });
}

function generateBuildings(
  grid: CityGrid,
  landmarks: MapBuilding[],
  parks: ParkSpec[],
): MapBuilding[] {
  const buildings = [...landmarks];
  const parkKeys = new Set(parks.map((park) => `${park.col}:${park.row}`));
  const cols = grid.avenueXs.length - 1;
  const rows = grid.streetZs.length - 1;

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      if (parkKeys.has(`${col}:${row}`)) continue;
      const lot = blockLot(grid, col, row);
      if (isApproachLot(grid, lot)) continue;
      if (landmarks.some((building) => overlaps(buildingFootprint(building), lot, 1))) continue;

      const noise = hash2(col + 11, row + 29);
      const core = Math.hypot(lot.x / 160, (lot.z - 188) / 120) < 0.72;
      let pattern: "one" | "two-x" | "two-z" | "skip" = "one";
      if (noise < 0.07) pattern = "skip";
      else if (core && noise > 0.52) pattern = noise > 0.78 ? "two-z" : "two-x";
      else if (noise > 0.9) pattern = "two-x";
      if (pattern === "skip") continue;

      const lots =
        pattern === "one" ? [lot] : splitAcross(lot, 2.4, pattern === "two-x" ? "x" : "z");
      lots.forEach((part, index) => {
        const local = hash2(col * 17 + index, row * 23 + 5);
        const building = buildingFromLot(
          `block-${col}-${row}${lots.length > 1 ? `-${index}` : ""}`,
          part,
          local,
          floorsForLot(part, grid, local),
        );
        if (!building) return;
        if (buildings.some((existing) => overlaps(buildingFootprint(existing), buildingFootprint(building), 1.6))) {
          return;
        }
        buildings.push(building);
      });
    }
  }

  return buildings;
}

function parseMap(value: unknown): GameMap {
  if (!value || typeof value !== "object") {
    throw new Error("Map JSON is invalid");
  }
  const data = value as Record<string, unknown>;
  if (typeof data.name !== "string" || data.name.length === 0) {
    throw new Error("Map JSON needs a name");
  }
  if (!Array.isArray(data.landmarks)) {
    throw new Error("Map JSON needs a landmarks array");
  }

  const grid = parseGrid(data.grid);
  const course = parseCourse(data.course);
  const landmarks = data.landmarks.map((item, index) => parseBuilding(item, index, "Landmark"));
  const parkSpecs = Array.isArray(data.parks) ? data.parks.map(parseParkSpec) : [];
  const ids = new Set<string>();
  for (const building of landmarks) {
    if (ids.has(building.id)) {
      throw new Error(`Duplicate building id "${building.id}"`);
    }
    ids.add(building.id);
  }

  const streets = generateStreets(grid);
  const parks = generateParks(grid, parkSpecs);
  const lots = generateLots(grid, parkSpecs);
  const buildings = generateBuildings(grid, landmarks, parkSpecs);
  for (const building of buildings) {
    if (ids.has(building.id) && !landmarks.some((landmark) => landmark.id === building.id)) {
      throw new Error(`Duplicate building id "${building.id}"`);
    }
    ids.add(building.id);
  }

  return { name: data.name, grid, buildings, streets, parks, lots, course };
}

export const gameMap = parseMap(rawMap);

export function cityExtent() {
  const grid = gameMap.grid;
  const minX = grid.avenueXs[0]!;
  const maxX = grid.avenueXs[grid.avenueXs.length - 1]!;
  const maxZ = grid.streetZs[grid.streetZs.length - 1]!;
  return {
    minX: minX - grid.avenueWidth / 2,
    maxX: maxX + grid.avenueWidth / 2,
    minZ: grid.approachZ,
    maxZ: maxZ + grid.streetWidth / 2,
    originX: minX,
    originZ: grid.streetZs[0]!,
    blockX: grid.avenueXs[1]! - minX,
    blockZ: grid.streetZs[1]! - grid.streetZs[0]!,
  };
}
