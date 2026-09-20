export const CITY_MODEL_IDS = [
  "tower-02",
  "tower-06",
  "tower-07",
  "tower-08",
  "tower-09",
  "tower-10",
  "tower-11",
] as const;

export type CityModelId = (typeof CITY_MODEL_IDS)[number];

export const CITY_MODEL_URLS: Record<CityModelId, string> = {
  "tower-02": "/models/city/TOWER_02.fbx",
  "tower-06": "/models/city/TOWER_06.fbx",
  "tower-07": "/models/city/TOWER_07.fbx",
  "tower-08": "/models/city/TOWER_08.fbx",
  "tower-09": "/models/city/TOWER_09.fbx",
  "tower-10": "/models/city/TOWER_10.fbx",
  "tower-11": "/models/city/TOWER_11.fbx",
};

export function isCityModelId(value: unknown): value is CityModelId {
  return typeof value === "string" && CITY_MODEL_IDS.includes(value as CityModelId);
}

export const PROP_MODEL_IDS = [
  "tree-02",
  "tree-04",
  "tree-05",
  "city-car",
  "pickup",
  "food-truck",
] as const;

export type PropModelId = (typeof PROP_MODEL_IDS)[number];

export const PROP_MODEL_URLS: Record<"city-car" | "pickup" | "food-truck", string> = {
  "city-car": "/models/city/VECHICLE_CITY_CAR_02.fbx",
  pickup: "/models/city/VECHICLE_PICKUP_TRUCK.fbx",
  "food-truck": "/models/city/VECHICLE_FOOD_TRUCK.fbx",
};
