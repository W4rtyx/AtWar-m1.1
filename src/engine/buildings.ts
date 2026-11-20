import { ENERGY_RESERVE_PER_POWER_PLANT } from './energyGrid';
import {
  ALL_BUILDING_TYPES,
  BUILDING_COST_SCALING_PER_UNIT,
  BuildBatchSize,
  Building,
  BuildingCost,
  BuildingSpec,
  BuildingType,
  DEMOLISH_REFUND_RATIO,
  GameState,
  MAX_STACK_PER_NODE,
  MIN_BUILDING_SPACING,
  OccupancyByType,
  ResourceType,
  ResourceZonePublic,
  TerrainType,
} from './types';

export const STACK_SNAP_RADIUS = 6;

/** Authoritative specification catalog for all constructible buildings (max 3 cost types each). */
export const BUILDING_SPECS: Readonly<Record<BuildingType, BuildingSpec>> = {
  CITY: {
    type: 'CITY',
    nameCs: 'Město',
    shortCode: 'MĚS',
    descriptionCs: 'Generuje Peníze z daní a zvyšuje strop i obnovu Manpoweru.',
    cost: { money: 240, buildingMaterial: 130, industry: 0 },
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
    constructionTicks: 35,
    requiresCoast: false,
    resourceZoneType: null,
  },
  MINE: {
    type: 'MINE',
    nameCs: 'Důl / Kamenolom',
    shortCode: 'DŮL',
    descriptionCs: 'Těží Stavební materiál. Silný bonus v zóně stav. materiálu.',
    cost: { money: 160, buildingMaterial: 0, industry: 0 },
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
    constructionTicks: 25,
    requiresCoast: false,
    resourceZoneType: 'CONSTRUCTION_MATERIAL',
  },
  POWER_PLANT: {
    type: 'POWER_PLANT',
    nameCs: 'Elektrárna',
    shortCode: 'ELK',
    descriptionCs:
      'Vyrábí Energii a zvyšuje kapacitu rezervy (+2 500/ks). 1. elektrárna na startu ZDARMA.',
    cost: { money: 200, buildingMaterial: 95, industry: 0 },
    baseEnergyConsumption: 0,
    baseEnergyProduction: 16.0,
    baseManpowerRequired: 30,
    baseMoneyPerSec: 0,
    baseMaterialPerSec: 0,
    baseIndustryPerSec: 0,
    baseKnowledgePerSec: 0,
    baseMaxManpowerBonus: 0,
    baseManpowerIncomeBonus: 0,
    energyReserveBonus: ENERGY_RESERVE_PER_POWER_PLANT,
    constructionTicks: 20,
    requiresCoast: false,
    resourceZoneType: 'BASIC_ENERGY',
  },
  FACTORY: {
    type: 'FACTORY',
    nameCs: 'Zbrojovka / Továrna',
    shortCode: 'ZBR',
    descriptionCs: 'Vyrábí Průmysl a násobí příjmy z obchodních dohod.',
    cost: { money: 260, buildingMaterial: 150, industry: 0 },
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
    constructionTicks: 35,
    requiresCoast: false,
    resourceZoneType: null,
  },
  LAB: {
    type: 'LAB',
    nameCs: 'Laboratoř',
    shortCode: 'LAB',
    descriptionCs: 'Generuje Knowledge (již získané znalosti se při ztrátě budovy neztrácejí).',
    cost: { money: 290, buildingMaterial: 0, industry: 110 },
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
    constructionTicks: 40,
    requiresCoast: false,
    resourceZoneType: null,
  },
  BARRACKS: {
    type: 'BARRACKS',
    nameCs: 'Kasárna',
    shortCode: 'KAS',
    descriptionCs: 'Zrychluje obnovu aktivního Manpoweru a posiluje obranu okolního sektoru.',
    cost: { money: 210, buildingMaterial: 120, industry: 0 },
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
    constructionTicks: 30,
    requiresCoast: false,
    resourceZoneType: null,
  },
  PORT: {
    type: 'PORT',
    nameCs: 'Přístav',
    shortCode: 'PŘÍ',
    descriptionCs: 'Stavba pouze na pobřeží u vody. Zvyšuje námořní obchodní příjmy.',
    cost: { money: 260, buildingMaterial: 140, industry: 80 },
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
    constructionTicks: 45,
    requiresCoast: true,
    resourceZoneType: null,
  },
  AIRFIELD: {
    type: 'AIRFIELD',
    nameCs: 'Letiště',
    shortCode: 'LET',
    descriptionCs: 'Základna letecké infrastruktury pro navazující taktické fáze.',
    cost: { money: 300, buildingMaterial: 150, industry: 110 },
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
    constructionTicks: 50,
    requiresCoast: false,
    resourceZoneType: null,
  },
  TRENCH: {
    type: 'TRENCH',
    nameCs: 'Zákopy',
    shortCode: 'ZÁK',
    descriptionCs:
      'Polní opevnění. Zpomaluje postup nepřátelské fronty v dosahu a zvyšuje její ztráty.',
    cost: { money: 95, buildingMaterial: 75, industry: 0 },
    baseEnergyConsumption: 0,
    baseEnergyProduction: 0,
    baseManpowerRequired: 20,
    baseMoneyPerSec: 0,
    baseMaterialPerSec: 0,
    baseIndustryPerSec: 0,
    baseKnowledgePerSec: 0,
    baseMaxManpowerBonus: 0,
    baseManpowerIncomeBonus: 0,
    energyReserveBonus: 0,
    constructionTicks: 18,
    requiresCoast: false,
    resourceZoneType: null,
  },
  BUNKER: {
    type: 'BUNKER',
    nameCs: 'Pevnost',
    shortCode: 'PEV',
    descriptionCs:
      'Opevněný bunkr s protitankovými zátarasy. Silně brzdí frontový průnik v okruhu.',
    cost: { money: 220, buildingMaterial: 160, industry: 90 },
    baseEnergyConsumption: 3.5,
    baseEnergyProduction: 0,
    baseManpowerRequired: 40,
    baseMoneyPerSec: 0,
    baseMaterialPerSec: 0,
    baseIndustryPerSec: 0,
    baseKnowledgePerSec: 0,
    baseMaxManpowerBonus: 0,
    baseManpowerIncomeBonus: 0,
    energyReserveBonus: 0,
    constructionTicks: 32,
    requiresCoast: false,
    resourceZoneType: null,
  },
  AA_BATTERY: {
    type: 'AA_BATTERY',
    nameCs: 'PVO baterie',
    shortCode: 'PVO',
    descriptionCs:
      'Protivzdušná obrana chránící okolní budovy a uzly v dosahu (Krok 6: sestřelování letadel).',
    cost: { money: 240, buildingMaterial: 0, industry: 140 },
    baseEnergyConsumption: 4.5,
    baseEnergyProduction: 0,
    baseManpowerRequired: 30,
    baseMoneyPerSec: 0,
    baseMaterialPerSec: 0,
    baseIndustryPerSec: 0,
    baseKnowledgePerSec: 0,
    baseMaxManpowerBonus: 0,
    baseManpowerIncomeBonus: 0,
    energyReserveBonus: 0,
    constructionTicks: 30,
    requiresCoast: false,
    resourceZoneType: null,
  },
};

export interface PlacementBuildingView {
  readonly id: number;
  readonly ownerId: number;
  readonly type: BuildingType;
  readonly x: number;
  readonly y: number;
  readonly stackCount: number;
  readonly underConstructionCount: number;
  readonly isCapital: boolean;
}

export interface PlacementValidationState {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  readonly owners: Int16Array;
  readonly buildings: ReadonlyArray<PlacementBuildingView>;
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

export interface BatchCostQuote {
  readonly unitsToBuild: number;
  readonly totalCost: BuildingCost;
  readonly usesFreePowerPlant: boolean;
}

export interface PlacementCheckResult {
  readonly valid: boolean;
  readonly reasonCs: string | null;
  readonly inMatchingZone: boolean;
  readonly isFreePowerPlant: boolean;
  readonly effectiveCost: BuildingCost;
  readonly stackTargetId: number | null;
  readonly plannedUnits: number;
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
    TRENCH: 100,
    BUNKER: 100,
    AA_BATTERY: 100,
  };
  for (const bType of ALL_BUILDING_TYPES) {
    map[bType] = 100;
  }
  return map;
}

/** Counts owned units of a type (completed + queued) for progressive cost scaling, excluding the initial starter capital. */
export function countPlayerUnitsOfType(
  buildings: ReadonlyArray<{
    readonly ownerId: number;
    readonly type: BuildingType;
    readonly stackCount: number;
    readonly underConstructionCount: number;
    readonly isCapital: boolean;
  }>,
  playerId: number,
  buildingType: BuildingType,
): number {
  let count = 0;
  for (const b of buildings) {
    if (b.ownerId !== playerId || b.type !== buildingType) continue;
    const nodeTotal = b.stackCount + b.underConstructionCount;
    count += b.isCapital ? Math.max(0, nodeTotal - 1) : nodeTotal;
  }
  return count;
}

/** Computes progressive unit cost (+14% per existing built/queued unit of that type). */
export function getUnitBuildCost(
  buildingType: BuildingType,
  existingScaledCount: number,
  isFreePowerPlant: boolean,
): BuildingCost {
  if (isFreePowerPlant) {
    return { money: 0, buildingMaterial: 0, industry: 0 };
  }
  const base = BUILDING_SPECS[buildingType].cost;
  const scale = 1 + Math.max(0, existingScaledCount) * BUILDING_COST_SCALING_PER_UNIT;
  return {
    money: Math.round(base.money * scale),
    buildingMaterial: Math.round(base.buildingMaterial * scale),
    industry: Math.round(base.industry * scale),
  };
}

/** Quotes batch unit count and cumulative progressive cost for 1x, 5x, 10x, or MAX. */
export function computeBatchQuote(
  buildingType: BuildingType,
  existingScaledCount: number,
  freePowerPlantUsed: boolean,
  requestedBatch: BuildBatchSize,
  maxRoomInNode: number,
  funds: {
    readonly money: number;
    readonly buildingMaterial: number;
    readonly industry: number;
  },
): BatchCostQuote {
  const room = Math.max(0, maxRoomInNode);
  if (room === 0) {
    return {
      unitsToBuild: 0,
      totalCost: { money: 0, buildingMaterial: 0, industry: 0 },
      usesFreePowerPlant: false,
    };
  }

  let totalMoney = 0;
  let totalMaterial = 0;
  let totalIndustry = 0;
  let usesFree = false;
  let units = 0;

  if (requestedBatch === 'MAX') {
    for (let i = 0; i < room; i++) {
      const unitIsFree = buildingType === 'POWER_PLANT' && !freePowerPlantUsed && i === 0;
      const unitCost = getUnitBuildCost(buildingType, existingScaledCount + i, unitIsFree);
      if (
        totalMoney + unitCost.money > funds.money ||
        totalMaterial + unitCost.buildingMaterial > funds.buildingMaterial ||
        totalIndustry + unitCost.industry > funds.industry
      ) {
        break;
      }
      totalMoney += unitCost.money;
      totalMaterial += unitCost.buildingMaterial;
      totalIndustry += unitCost.industry;
      if (unitIsFree) usesFree = true;
      units++;
    }

    return {
      unitsToBuild: units,
      totalCost: {
        money: totalMoney,
        buildingMaterial: totalMaterial,
        industry: totalIndustry,
      },
      usesFreePowerPlant: usesFree,
    };
  }

  const targetCount = Math.min(requestedBatch, room);
  for (let i = 0; i < targetCount; i++) {
    const unitIsFree = buildingType === 'POWER_PLANT' && !freePowerPlantUsed && i === 0;
    const unitCost = getUnitBuildCost(buildingType, existingScaledCount + i, unitIsFree);
    totalMoney += unitCost.money;
    totalMaterial += unitCost.buildingMaterial;
    totalIndustry += unitCost.industry;
    if (unitIsFree) usesFree = true;
    units++;
  }

  return {
    unitsToBuild: units,
    totalCost: {
      money: totalMoney,
      buildingMaterial: totalMaterial,
      industry: totalIndustry,
    },
    usesFreePowerPlant: usesFree,
  };
}

/** Returns actual single-unit build cost, granting each player's first Power Plant for free. */
export function getEffectiveBuildingCost(
  buildingType: BuildingType,
  freePowerPlantUsed: boolean,
  existingScaledCount = 0,
): BuildingCost {
  return getUnitBuildCost(
    buildingType,
    existingScaledCount,
    buildingType === 'POWER_PLANT' && !freePowerPlantUsed,
  );
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

function findStackTargetNear(
  buildings: ReadonlyArray<PlacementBuildingView>,
  playerId: number,
  buildingType: BuildingType,
  x: number,
  y: number,
): PlacementBuildingView | null {
  let best: PlacementBuildingView | null = null;
  let bestDist = STACK_SNAP_RADIUS;
  for (const b of buildings) {
    if (b.ownerId !== playerId || b.type !== buildingType) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d <= bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

/**
 * Validates new node placement or stacking onto an existing node using strictly public
 * map/player data so client previews never require or leak secret resource optima.
 */
export function validateBuildingPlacement(
  view: PlacementValidationState,
  player: PlacementPlayerView | undefined,
  buildingType: BuildingType,
  rawX: number,
  rawY: number,
  batchSize: BuildBatchSize = 1,
): PlacementCheckResult {
  const ix = Math.floor(rawX);
  const iy = Math.floor(rawY);
  const spec = BUILDING_SPECS[buildingType];
  const freeUsed = player?.freePowerPlantUsed ?? false;
  const funds = {
    money: player?.money ?? 0,
    buildingMaterial: player?.buildingMaterial ?? 0,
    industry: player?.industry ?? 0,
  };
  const existingScaledCount = player
    ? countPlayerUnitsOfType(view.buildings, player.id, buildingType)
    : 0;

  if (!player || !player.alive) {
    const fallbackQuote = computeBatchQuote(
      buildingType,
      existingScaledCount,
      freeUsed,
      batchSize === 'MAX' ? 1 : batchSize,
      MAX_STACK_PER_NODE,
      funds,
    );
    return {
      valid: false,
      reasonCs: 'Stát není aktivní',
      inMatchingZone: false,
      isFreePowerPlant: fallbackQuote.usesFreePowerPlant,
      effectiveCost: fallbackQuote.totalCost,
      stackTargetId: null,
      plannedUnits: 0,
    };
  }

  const stackTarget = findStackTargetNear(view.buildings, player.id, buildingType, ix, iy);
  const targetX = stackTarget ? stackTarget.x : ix;
  const targetY = stackTarget ? stackTarget.y : iy;
  const inMatchingZone =
    spec.resourceZoneType !== null &&
    findMatchingPublicZone(view.publicResourceZones, spec.resourceZoneType, targetX, targetY) !==
      null;

  const maxRoomInNode = stackTarget
    ? MAX_STACK_PER_NODE - (stackTarget.stackCount + stackTarget.underConstructionCount)
    : MAX_STACK_PER_NODE;

  const quote = computeBatchQuote(
    buildingType,
    existingScaledCount,
    freeUsed,
    batchSize,
    maxRoomInNode,
    funds,
  );
  const fallbackDisplayQuote =
    quote.unitsToBuild > 0
      ? quote
      : computeBatchQuote(
          buildingType,
          existingScaledCount,
          freeUsed,
          1,
          Math.max(1, maxRoomInNode),
          funds,
        );

  if (ix < 0 || ix >= view.width || iy < 0 || iy >= view.height) {
    return {
      valid: false,
      reasonCs: 'Mimo mapu',
      inMatchingZone,
      isFreePowerPlant: fallbackDisplayQuote.usesFreePowerPlant,
      effectiveCost: fallbackDisplayQuote.totalCost,
      stackTargetId: stackTarget?.id ?? null,
      plannedUnits: 0,
    };
  }

  if (stackTarget) {
    if (maxRoomInNode <= 0) {
      return {
        valid: false,
        reasonCs: `Uzel je plný (max ${MAX_STACK_PER_NODE}×)`,
        inMatchingZone,
        isFreePowerPlant: false,
        effectiveCost: fallbackDisplayQuote.totalCost,
        stackTargetId: stackTarget.id,
        plannedUnits: 0,
      };
    }
  } else {
    const idx = iy * view.width + ix;
    if (view.terrain[idx] === TerrainType.WATER) {
      return {
        valid: false,
        reasonCs: 'Nelze stavět na vodě',
        inMatchingZone,
        isFreePowerPlant: fallbackDisplayQuote.usesFreePowerPlant,
        effectiveCost: fallbackDisplayQuote.totalCost,
        stackTargetId: null,
        plannedUnits: 0,
      };
    }

    if (view.owners[idx] !== player.id) {
      return {
        valid: false,
        reasonCs: 'Mimo vlastní území',
        inMatchingZone,
        isFreePowerPlant: fallbackDisplayQuote.usesFreePowerPlant,
        effectiveCost: fallbackDisplayQuote.totalCost,
        stackTargetId: null,
        plannedUnits: 0,
      };
    }

    for (const existing of view.buildings) {
      if (Math.hypot(existing.x - ix, existing.y - iy) < MIN_BUILDING_SPACING) {
        return {
          valid: false,
          reasonCs: 'Příliš blízko jiné budovy',
          inMatchingZone,
          isFreePowerPlant: fallbackDisplayQuote.usesFreePowerPlant,
          effectiveCost: fallbackDisplayQuote.totalCost,
          stackTargetId: null,
          plannedUnits: 0,
        };
      }
    }

    if (spec.requiresCoast && !isCoastalLandCell(view.terrain, view.width, view.height, ix, iy, 2)) {
      return {
        valid: false,
        reasonCs: 'Přístav musí být na pobřeží u vody',
        inMatchingZone,
        isFreePowerPlant: fallbackDisplayQuote.usesFreePowerPlant,
        effectiveCost: fallbackDisplayQuote.totalCost,
        stackTargetId: null,
        plannedUnits: 0,
      };
    }
  }

  if (
    quote.unitsToBuild <= 0 ||
    funds.money < quote.totalCost.money ||
    funds.buildingMaterial < quote.totalCost.buildingMaterial ||
    funds.industry < quote.totalCost.industry
  ) {
    return {
      valid: false,
      reasonCs: 'Nedostatek surovin',
      inMatchingZone,
      isFreePowerPlant: fallbackDisplayQuote.usesFreePowerPlant,
      effectiveCost: fallbackDisplayQuote.totalCost,
      stackTargetId: stackTarget?.id ?? null,
      plannedUnits: 0,
    };
  }

  return {
    valid: true,
    reasonCs: null,
    inMatchingZone,
    isFreePowerPlant: quote.usesFreePowerPlant,
    effectiveCost: quote.totalCost,
    stackTargetId: stackTarget?.id ?? null,
    plannedUnits: quote.unitsToBuild,
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

/**
 * Starts construction of a new building node (1..N batch units) or queues extra units
 * onto an existing owned node of the same type within snap radius.
 * Site efficiency stays hidden (null) until the first structure completes construction.
 */
export function placeBuilding(
  state: GameState,
  playerId: number,
  buildingType: BuildingType,
  rawX: number,
  rawY: number,
  batchSize: BuildBatchSize = 1,
): Building | null {
  if (state.phase !== 'PLAYING') {
    return null;
  }
  const player = state.players.get(playerId);
  if (!player) {
    return null;
  }

  const check = validateBuildingPlacement(state, player, buildingType, rawX, rawY, batchSize);
  if (!check.valid || check.plannedUnits <= 0) {
    return null;
  }

  if (check.stackTargetId !== null) {
    const added = stackBuilding(state, playerId, check.stackTargetId, batchSize);
    if (added <= 0) return null;
    return state.buildings.find((b) => b.id === check.stackTargetId) ?? null;
  }

  const ix = Math.floor(rawX);
  const iy = Math.floor(rawY);

  player.money -= check.effectiveCost.money;
  player.buildingMaterial -= check.effectiveCost.buildingMaterial;
  player.industry -= check.effectiveCost.industry;
  if (check.isFreePowerPlant) {
    player.freePowerPlantUsed = true;
  }

  const spec = BUILDING_SPECS[buildingType];
  const building: Building = {
    id: state.nextBuildingId++,
    type: buildingType,
    ownerId: playerId,
    x: ix,
    y: iy,
    isCapital: false,
    level: 1,
    revealedEfficiencyPct: spec.resourceZoneType === null ? 100 : null,
    stackCount: 0,
    underConstructionCount: check.plannedUnits,
    constructionTicksRemaining: spec.constructionTicks,
    constructionTicksTotal: spec.constructionTicks,
    totalInvestedMoney: check.effectiveCost.money,
    totalInvestedMaterial: check.effectiveCost.buildingMaterial,
    totalInvestedIndustry: check.effectiveCost.industry,
    occupancyOverride: null,
    effectiveOccupancyPct: player.buildingOccupancyByType[buildingType],
    effectiveOutputPct: 0,
    allocatedManpower: 0,
    currentEnergyUse: 0,
    currentEnergyProd: 0,
  };

  state.buildings.push(building);
  state.stateVersion++;
  return building;
}

/** Queues additional stacked units (1x/5x/10x/MAX) onto an existing owned building node. */
export function stackBuilding(
  state: GameState,
  playerId: number,
  buildingId: number,
  batchSize: BuildBatchSize,
): number {
  if (state.phase !== 'PLAYING') {
    return 0;
  }
  const player = state.players.get(playerId);
  const building = state.buildings.find(
    (b) => b.id === buildingId && b.ownerId === playerId,
  );
  if (!player || !player.alive || !building) {
    return 0;
  }

  const maxRoom = MAX_STACK_PER_NODE - (building.stackCount + building.underConstructionCount);
  if (maxRoom <= 0) {
    return 0;
  }

  const existingScaledCount = countPlayerUnitsOfType(state.buildings, playerId, building.type);
  const quote = computeBatchQuote(
    building.type,
    existingScaledCount,
    player.freePowerPlantUsed,
    batchSize,
    maxRoom,
    {
      money: player.money,
      buildingMaterial: player.buildingMaterial,
      industry: player.industry,
    },
  );

  if (
    quote.unitsToBuild <= 0 ||
    player.money < quote.totalCost.money ||
    player.buildingMaterial < quote.totalCost.buildingMaterial ||
    player.industry < quote.totalCost.industry
  ) {
    return 0;
  }

  player.money -= quote.totalCost.money;
  player.buildingMaterial -= quote.totalCost.buildingMaterial;
  player.industry -= quote.totalCost.industry;
  if (quote.usesFreePowerPlant) {
    player.freePowerPlantUsed = true;
  }

  building.totalInvestedMoney += quote.totalCost.money;
  building.totalInvestedMaterial += quote.totalCost.buildingMaterial;
  building.totalInvestedIndustry += quote.totalCost.industry;
  building.underConstructionCount += quote.unitsToBuild;
  if (building.constructionTicksRemaining <= 0) {
    building.constructionTicksRemaining = building.constructionTicksTotal;
  }

  state.stateVersion++;
  return quote.unitsToBuild;
}

/**
 * Demolishes 1 unit or the entire removable stack at an owned node, refunding 50% of
 * proportionally invested resources and freeing allocated manpower immediately.
 */
export function demolishBuilding(
  state: GameState,
  playerId: number,
  buildingId: number,
  demolishAll: boolean,
): boolean {
  if (state.phase !== 'PLAYING') {
    return false;
  }
  const player = state.players.get(playerId);
  const idx = state.buildings.findIndex(
    (b) => b.id === buildingId && b.ownerId === playerId,
  );
  if (!player || idx === -1) {
    return false;
  }

  const building = state.buildings[idx];
  const totalUnits = building.stackCount + building.underConstructionCount;
  const removable = building.isCapital ? Math.max(0, totalUnits - 1) : totalUnits;
  if (removable <= 0) {
    return false;
  }

  const toRemove = demolishAll ? removable : 1;
  const paidUnits = building.isCapital ? Math.max(0, totalUnits - 1) : totalUnits;
  const ratio = paidUnits > 0 ? toRemove / paidUnits : 0;

  const refundMoney = Math.floor(building.totalInvestedMoney * ratio * DEMOLISH_REFUND_RATIO);
  const refundMat = Math.floor(building.totalInvestedMaterial * ratio * DEMOLISH_REFUND_RATIO);
  const refundInd = Math.floor(building.totalInvestedIndustry * ratio * DEMOLISH_REFUND_RATIO);

  player.money += refundMoney;
  player.buildingMaterial += refundMat;
  player.industry += refundInd;

  building.totalInvestedMoney *= Math.max(0, 1 - ratio);
  building.totalInvestedMaterial *= Math.max(0, 1 - ratio);
  building.totalInvestedIndustry *= Math.max(0, 1 - ratio);

  let remainingToRemove = toRemove;
  const removeQueued = Math.min(building.underConstructionCount, remainingToRemove);
  building.underConstructionCount -= removeQueued;
  remainingToRemove -= removeQueued;

  if (remainingToRemove > 0) {
    building.stackCount = Math.max(0, building.stackCount - remainingToRemove);
  }

  if (building.underConstructionCount === 0) {
    building.constructionTicksRemaining = 0;
  }

  if (building.stackCount === 0 && building.underConstructionCount === 0) {
    state.buildings.splice(idx, 1);
  }

  state.stateVersion++;
  return true;
}

/** Advances building construction timers and reveals resource zone efficiency upon first completion. */
export function stepBuildingConstruction(state: GameState): boolean {
  let anyCompleted = false;

  for (const building of state.buildings) {
    if (building.underConstructionCount <= 0) {
      continue;
    }

    building.constructionTicksRemaining--;
    if (building.constructionTicksRemaining <= 0) {
      building.stackCount++;
      building.underConstructionCount--;
      if (building.revealedEfficiencyPct === null) {
        building.revealedEfficiencyPct = computeSiteEfficiencyPct(
          state,
          building.type,
          building.x,
          building.y,
        );
      }
      building.constructionTicksRemaining =
        building.underConstructionCount > 0 ? building.constructionTicksTotal : 0;
      anyCompleted = true;
    }
  }

  if (anyCompleted) {
    state.stateVersion++;
  }
  return anyCompleted;
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
    level: 1,
    revealedEfficiencyPct: 100,
    stackCount: 1,
    underConstructionCount: 0,
    constructionTicksRemaining: 0,
    constructionTicksTotal: spec.constructionTicks,
    totalInvestedMoney: 0,
    totalInvestedMaterial: 0,
    totalInvestedIndustry: 0,
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

/** Transfers building ownership (including any units under construction) whenever the underlying cell is captured. */
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
