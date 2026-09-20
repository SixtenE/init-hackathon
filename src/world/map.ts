import rawMap from "./map.json";

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
};

export type GameMap = {
  name: string;
  buildings: MapBuilding[];
};

function assertPositiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Map field ${label} must be a positive integer`);
  }
  return value;
}

function parseBuilding(value: unknown, index: number): MapBuilding {
  if (!value || typeof value !== "object") {
    throw new Error(`Map building ${index} is invalid`);
  }
  const building = value as Record<string, unknown>;
  if (typeof building.id !== "string" || building.id.length === 0) {
    throw new Error(`Map building ${index} needs a string id`);
  }
  if (typeof building.x !== "number" || typeof building.z !== "number") {
    throw new Error(`Map building ${building.id} needs numeric x and z`);
  }
  return {
    id: building.id,
    x: building.x,
    z: building.z,
    width: assertPositiveInt(building.width, `${building.id}.width`),
    floors: assertPositiveInt(building.floors, `${building.id}.floors`),
    depth: assertPositiveInt(building.depth, `${building.id}.depth`),
  };
}

function parseMap(value: unknown): GameMap {
  if (!value || typeof value !== "object") {
    throw new Error("Map JSON is invalid");
  }
  const data = value as Record<string, unknown>;
  if (typeof data.name !== "string" || data.name.length === 0) {
    throw new Error("Map JSON needs a name");
  }
  if (!Array.isArray(data.buildings)) {
    throw new Error("Map JSON needs a buildings array");
  }

  const buildings = data.buildings.map(parseBuilding);
  const ids = new Set<string>();
  for (const building of buildings) {
    if (ids.has(building.id)) {
      throw new Error(`Duplicate building id "${building.id}"`);
    }
    ids.add(building.id);
  }

  return { name: data.name, buildings };
}

export const gameMap = parseMap(rawMap);
