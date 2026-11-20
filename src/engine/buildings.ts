import {
  ALL_BUILDING_TYPES,
  Building,
  BuildingCost,
  BuildingSpec,
  BuildingType,
  GameState,
  MIN_BUILDING_SPACING,
  OccupancyByType,
  ResourceType,
  ResourceZonePublic,
  TerrainType,
} from './types';

/** Authoritative specification catalog for all constructible buildings (max 3 cost types each). */
export const BUILDING_SPECS: Readonly<Record<BuildingType, BuildingSpec>> = {
  CITY: {
    type: 'CITY',
    nameCs: 'Město',
    shortCode: 'MĚS',
    descriptionCs: 'Generuje Peníze z daní a zvyšuje strop i obnovu Manpoweru.',
    cost: { money: 160, buildingMaterial: 80, industry: 0 },
    baseEnergyConsumption: 2.5,
    baseEnergyProduction: 0,
    baseManpowerRequired: 0,
    baseMoneyPerSec: 6.5,
    baseMaterialPerSec: 0,
    baseIndustryPerSec: 0,
    baseKnowledgePerSec: 0,
    baseMaxManpowerBonus: 260,
    baseManpowerIncomeBonus: 4.2,
    energyReserveBonus: 0,
    requiresCoast: false,
    resourceZoneType: null,
  },
  MINE: {
    type: 'MINE',
    nameCs: 'Důl / Kamenolom',
    shortCode: 'DŮL',
    descriptionCs: 'Těží Stavební materiál. Silný bonus v zóně stav. materiálu.',
    cost: { money: 110, buildingMaterial: 0, industry: 0 },
    baseEnergyConsumption: 3.0,
    baseEnergyProduction: 0,
    baseManpowerRequired: 35,
    baseMoneyPerSec: 0,
    baseMaterialPerSec: 8.0,
    baseIndustryPerSec: 0,
    baseKnowledgePerSec: 0,
    baseMaxManpowerBonus: 0,
    baseManpowerIncomeBonus: 0,
    energyReserveBonus: 0,
    requiresCoast: false,
    resourceZoneType: 'CONSTRUCTION_MATERIAL',
  },
  POWER_PLANT: {
    type: 'POWER_PLANT',
    nameCs: 'Elektrárna',
    shortCode: 'ELK',
    descriptionCs: 'Vyrábí Energii a rozšiřuje rezervu. 1. elektrárna na startu ZDARMA.',
    cost: { money: 130, buildingMaterial: 60, industry: 0 },
    baseEnergyConsumption: 0,
    baseEnergyProduction: 16.0,
    baseManpowerRequired: 30,
    baseMoneyPerSec: 0,
    baseMaterialPerSec: 0,
    baseIndustryPerSec: 0,
    baseKnowledgePerSec: 0,
    baseMaxManpowerBonus: 0,
    baseManpowerIncomeBonus: 0,
    energyReserveBonus: 160,
    requiresCoast: false,
    resourceZoneType: 'BASIC_ENERGY',
  },
  FACTORY: {
    type: 'FACTORY',
    nameCs: 'Zbrojovka / Továrna',
    shortCode: 'ZBR',
    descriptionCs: 'Vyrábí Průmysl a násobí příjmy z obchodních dohod.',
    cost: { money: 180, buildingMaterial: 100, industry: 0 },
    baseEnergyConsumption: 5.0,
    baseEnergyProduction: 0,
    baseManpowerRequired: 55,
    baseMoneyPerSec: 0,
    baseMaterialPerSec: 0,
    baseIndustryPerSec: 6.0,
    baseKnowledgePerSec: 0,
    baseMaxManpowerBonus: 0,
    baseManpowerIncomeBonus: 0,
    energyReserveBonus: 0,
    requiresCoast: false,
    resourceZoneType: null,
  },
  LAB: {
    type: 'LAB',
    nameCs: 'Laboratoř',
    shortCode: 'LAB',
    descriptionCs: 'Generuje Knowledge (již získané znalosti se při ztrátě budovy neztrácejí).',
    cost: { money: 200, buildingMaterial: 0, industry: 70 },
    baseEnergyConsumption: 4.5,
    baseEnergyProduction: 0,
    baseManpowerRequired: 40,
    baseMoneyPerSec: 0,
    baseMaterialPerSec: 0,
    baseIndustryPerSec: 0,
    baseKnowledgePerSec: 4.5,
    baseMaxManpowerBonus: 0,
    baseManpowerIncomeBonus: 0,
    energyReserveBonus: 0,
    requiresCoast: false,
    resourceZoneType: null,
  },
  BARRACKS: {
    type: 'BARRACKS',
    nameCs: 'Kasárna',
    shortCode: 'KAS',
    descriptionCs: 'Zrychluje obnovu aktivního Manpoweru a posiluje obranu okolního sektoru.',
    cost: { money: 140, buildingMaterial: 75, industry: 0 },
    baseEnergyConsumption: 1.5,
    baseEnergyProduction: 0,
    baseManpowerRequired: 45,
    baseMoneyPerSec: 0,
    baseMaterialPerSec: 0,
    baseIndustryPerSec: 0,
    baseKnowledgePerSec: 0,
    baseMaxManpowerBonus: 90,
    baseManpowerIncomeBonus: 6.5,
    energyReserveBonus: 0,
    requiresCoast: false,
    resourceZoneType: null,
  },
  PORT: {
    type: 'PORT',
    nameCs: 'Přístav',
    shortCode: 'PŘÍ',
    descriptionCs: 'Stavba pouze na pobřeží u vody. Zvyšuje námořní obchodní příjmy.',
    cost: { money: 180, buildingMaterial: 90, industry: 50 },
    baseEnergyConsumption: 3.0,
    baseEnergyProduction: 0,
    baseManpowerRequired: 35,
    baseMoneyPerSec: 2.5,
    baseMaterialPerSec: 0,
    baseIndustryPerSec: 0,
    baseKnowledgePerSec: 0,
    baseMaxManpowerBonus: 0,
    baseManpowerIncomeBonus: 0,
    energyReserveBonus: 0,
    requiresCoast: true,
    resourceZoneType: null,
  },
  AIRFIELD: {
    type: 'AIRFIELD',
    nameCs: 'Letiště',
    shortCode: 'LET',
    descriptionCs: 'Základna letecké infrastruktury pro navazující taktické fáze.',
    cost: { money: 210, buildingMaterial: 100, industry: 80 },
    baseEnergyConsumption: 4.0,
    baseEnergyProduction: 0,
    baseManpowerRequired: 45,
    baseMoneyPerSec: 0,
    baseMaterialPerSec: 0,
    baseIndustryPerSec: 0,
    baseKnowledgePerSec: 0,
    baseMaxManpowerBonus: 0,
    baseManpowerIncomeBonus: 0,
    energyReserveBonus: 0,
    requiresCoast: false,
    resourceZoneType: null,
  },
};

export interface PlacementValidationState {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  readonly owners: Int16Array;
  readonly buildings: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly publicResourceZones: ReadonlyArray<ResourceZonePublic>;
}

export interface PlacementPlayerView {
  readonly id: number;
  readonly alive: boolean;
  readonly money?: number;
  readonly buildingMaterial?: number;
  readonly industry?: number;
  readonly freePowerPlantUsed?: boolean;
}

export interface PlacementCheckResult {
  readonly valid: boolean;
  readonly reasonCs: string | null;
  readonly inMatchingZone: boolean;
  readonly isFreePowerPlant: boolean;
  readonly effectiveCost: BuildingCost;
}

/** Creates default 100% occupancy settings for every building type. */
export function createDefaultOccupancyByType(): OccupancyByType {
  const map: Record<BuildingType, number> = {
    CITY: 100,
    MINE: 100,
    POWER_PLANT: 100,
    FACTORY: 100,
    LAB: 100,
    BARRACKS: 100,
    PORT: 100,
    AIRFIELD: 100,
  };
  for (const bType of ALL_BUILDING_TYPES) {
    map[bType] = 100;
  }
  return map;
}

/** Returns actual build cost, granting each player's first Power Plant for free. */
export function getEffectiveBuildingCost(
  buildingType: BuildingType,
  freePowerPlantUsed: boolean,
): BuildingCost {
  if (buildingType === 'POWER_PLANT' && !freePowerPlantUsed) {
    return { money: 0, buildingMaterial: 0, industry: 0 };
  }
  return BUILDING_SPECS[buildingType].cost;
}

/** Returns true if land cell (x, y) is non-water and within Chebyshev distance maxDist of water. */
export function isCoastalLandCell(
  terrain: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  maxDist = 2,
): boolean {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return false;
  }
  if (terrain[y * width + x] === TerrainType.WATER) {
    return false;
  }
  for (let dy = -maxDist; dy <= maxDist; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -maxDist; dx <= maxDist; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      if (nx < 0 || nx >= width) continue;
      if (terrain[ny * width + nx] === TerrainType.WATER) {
        return true;
      }
    }
  }
  return false;
}

/** Finds the public resource circle matching the requested resource type at (x, y). */
export function findMatchingPublicZone(
  zones: ReadonlyArray<ResourceZonePublic>,
  resourceType: ResourceType,
  x: number,
  y: number,
): ResourceZonePublic | null {
  for (const zone of zones) {
    if (zone.type !== resourceType) continue;
    if (Math.hypot(x - zone.centerX, y - zone.centerY) <= zone.radius) {
      return zone;
    }
  }
  return null;
}

/**
 * Validates building placement using strictly public map/player data so the client preview
 * never requires or leaks secret resource optimum coordinates.
 */
export function validateBuildingPlacement(
  view: PlacementValidationState,
  player: PlacementPlayerView | undefined,
  buildingType: BuildingType,
  rawX: number,
  rawY: number,
): PlacementCheckResult {
  const ix = Math.floor(rawX);
  const iy = Math.floor(rawY);
  const spec = BUILDING_SPECS[buildingType];
  const freeUsed = player?.freePowerPlantUsed ?? false;
  const isFreePowerPlant = buildingType === 'POWER_PLANT' && !freeUsed;
  const effectiveCost = getEffectiveBuildingCost(buildingType, freeUsed);
  const inMatchingZone =
    spec.resourceZoneType !== null &&
    findMatchingPublicZone(view.publicResourceZones, spec.resourceZoneType, ix, iy) !== null;

  if (!player || !player.alive) {
    return {
      valid: false,
      reasonCs: 'Stát není aktivní',
      inMatchingZone,
      isFreePowerPlant,
      effectiveCost,
    };
  }

  if (ix < 0 || ix >= view.width || iy < 0 || iy >= view.height) {
    return {
      valid: false,
      reasonCs: 'Mimo mapu',
      inMatchingZone,
      isFreePowerPlant,
      effectiveCost,
    };
  }

  const idx = iy * view.width + ix;
  if (view.terrain[idx] === TerrainType.WATER) {
    return {
      valid: false,
      reasonCs: 'Nelze stavět na vodě',
      inMatchingZone,
      isFreePowerPlant,
      effectiveCost,
    };
  }

  if (view.owners[idx] !== player.id) {
    return {
      valid: false,
      reasonCs: 'Mimo vlastní území',
      inMatchingZone,
      isFreePowerPlant,
      effectiveCost,
    };
  }

  for (const existing of view.buildings) {
    if (Math.hypot(existing.x - ix, existing.y - iy) < MIN_BUILDING_SPACING) {
      return {
        valid: false,
        reasonCs: 'Příliš blízko jiné budovy',
        inMatchingZone,
        isFreePowerPlant,
        effectiveCost,
      };
    }
  }

  if (spec.requiresCoast && !isCoastalLandCell(view.terrain, view.width, view.height, ix, iy, 2)) {
    return {
      valid: false,
      reasonCs: 'Přístav musí být na pobřeží u vody',
      inMatchingZone,
      isFreePowerPlant,
      effectiveCost,
    };
  }

  const money = player.money ?? 0;
  const mat = player.buildingMaterial ?? 0;
  const ind = player.industry ?? 0;
  if (
    money < effectiveCost.money ||
    mat < effectiveCost.buildingMaterial ||
    ind < effectiveCost.industry
  ) {
    return {
      valid: false,
      reasonCs: 'Nedostatek surovin',
      inMatchingZone,
      isFreePowerPlant,
      effectiveCost,
    };
  }

  return {
    valid: true,
    reasonCs: null,
    inMatchingZone,
    isFreePowerPlant,
    effectiveCost,
  };
}

/**
 * Computes authoritative post-construction location efficiency (%) using secret off-center optima.
 * Outside resource circles runs at 35% emergency minimum; inside scales 62..100% by optimum proximity.
 */
export function computeSiteEfficiencyPct(
  state: GameState,
  buildingType: BuildingType,
  x: number,
  y: number,
): number {
  const zoneType = BUILDING_SPECS[buildingType].resourceZoneType;
  if (zoneType === null) {
    return 100;
  }

  const zone = findMatchingPublicZone(state.publicResourceZones, zoneType, x, y);
  if (!zone) {
    return 35;
  }

  const secret = state.secretResourceZones.find((s) => s.zoneId === zone.id);
  if (!secret) {
    return 75;
  }

  const distToOpt = Math.hypot(x - secret.optimumX, y - secret.optimumY);
  const maxSpan = Math.max(1, zone.radius * 1.55);
  const proximity = Math.max(0, Math.min(1, 1 - distToOpt / maxSpan));
  return Math.round(62 + 38 * Math.pow(proximity, 1.35));
}

/** Constructs a building on owned territory if valid, deducting its cost and revealing site efficiency. */
export function placeBuilding(
  state: GameState,
  playerId: number,
  buildingType: BuildingType,
  rawX: number,
  rawY: number,
): Building | null {
  if (state.phase !== 'PLAYING') {
    return null;
  }
  const player = state.players.get(playerId);
  if (!player) {
    return null;
  }

  const check = validateBuildingPlacement(state, player, buildingType, rawX, rawY);
  if (!check.valid) {
    return null;
  }

  const ix = Math.floor(rawX);
  const iy = Math.floor(rawY);

  player.money -= check.effectiveCost.money;
  player.buildingMaterial -= check.effectiveCost.buildingMaterial;
  player.industry -= check.effectiveCost.industry;
  if (check.isFreePowerPlant) {
    player.freePowerPlantUsed = true;
  }

  const revealedEfficiencyPct = computeSiteEfficiencyPct(state, buildingType, ix, iy);
  const spec = BUILDING_SPECS[buildingType];
  const building: Building = {
    id: state.nextBuildingId++,
    type: buildingType,
    ownerId: playerId,
    x: ix,
    y: iy,
    isCapital: false,
    revealedEfficiencyPct,
    occupancyOverride: null,
    effectiveOccupancyPct: player.buildingOccupancyByType[buildingType],
    effectiveOutputPct: revealedEfficiencyPct,
    allocatedManpower: 0,
    currentEnergyUse: spec.baseEnergyConsumption,
    currentEnergyProd: spec.baseEnergyProduction * (revealedEfficiencyPct / 100),
  };

  state.buildings.push(building);
  state.stateVersion++;
  return building;
}

/** Creates a player's starting Capital City building free of charge. */
export function createCapitalCityBuilding(
  state: GameState,
  playerId: number,
  x: number,
  y: number,
): Building {
  const spec = BUILDING_SPECS.CITY;
  const city: Building = {
    id: state.nextBuildingId++,
    type: 'CITY',
    ownerId: playerId,
    x,
    y,
    isCapital: true,
    revealedEfficiencyPct: 100,
    occupancyOverride: null,
    effectiveOccupancyPct: 100,
    effectiveOutputPct: 100,
    allocatedManpower: 0,
    currentEnergyUse: spec.baseEnergyConsumption,
    currentEnergyProd: 0,
  };
  state.buildings.push(city);
  return city;
}

/** Transfers building ownership whenever the underlying cell is captured by another state. */
export function syncBuildingOwnership(state: GameState): boolean {
  const { width, owners } = state;
  let anyTransferred = false;

  for (const building of state.buildings) {
    const cellOwner = owners[building.y * width + building.x];
    if (cellOwner >= 0 && cellOwner !== building.ownerId) {
      building.ownerId = cellOwner;
      building.occupancyOverride = null;
      anyTransferred = true;
    }
  }

  return anyTransferred;
}
