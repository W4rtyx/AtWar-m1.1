import { BUILDING_SPECS, createDefaultOccupancyByType } from './buildings';
import {
  Building,
  GameState,
  PlayerState,
  TICK_DT,
  TerrainType,
  getRelationKey,
} from './types';

export const OPTIMUM_FILL_RATIO = 0.5;
export const CAPITAL_BASE_MATERIAL_PER_SEC = 0.4;

export interface OccupancyCurveResult {
  readonly occupancyPct: number;
  readonly outputMultiplier: number;
  readonly conversionEfficiency: number;
  readonly energyMultiplier: number;
  readonly manpowerMultiplier: number;
}

/**
 * Evaluates building staffing curve from 0% to 200%:
 * - 0..100%: linear output with 1.0 conversion efficiency
 * - 100..200%: overload yields up to +20% output (1.2x) at 80% conversion efficiency
 */
export function computeOccupancyCurve(occupancyPct: number): OccupancyCurveResult {
  const clamped = Math.max(0, Math.min(200, occupancyPct));
  const occ = clamped / 100;

  if (occ <= 0) {
    return {
      occupancyPct: 0,
      outputMultiplier: 0,
      conversionEfficiency: 0,
      energyMultiplier: 0,
      manpowerMultiplier: 0,
    };
  }

  if (occ <= 1) {
    return {
      occupancyPct: clamped,
      outputMultiplier: occ,
      conversionEfficiency: 1,
      energyMultiplier: occ,
      manpowerMultiplier: occ,
    };
  }

  const over = occ - 1;
  const outputMultiplier = 1 + 0.2 * over;
  const conversionEfficiency = 1 - 0.2 * over;
  const energyMultiplier = outputMultiplier / conversionEfficiency;
  return {
    occupancyPct: clamped,
    outputMultiplier,
    conversionEfficiency,
    energyMultiplier,
    manpowerMultiplier: occ,
  };
}

/** Rebuilds the set of unordered state pairs currently sharing a direct land border. */
export function recomputeNeighborPairs(state: GameState): void {
  state.neighborPairs.clear();
  const { width, height, owners, terrain } = state;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (terrain[idx] === TerrainType.WATER) continue;
      const o1 = owners[idx];
      if (o1 < 0) continue;

      if (x + 1 < width) {
        const rightIdx = idx + 1;
        if (terrain[rightIdx] !== TerrainType.WATER) {
          const o2 = owners[rightIdx];
          if (o2 >= 0 && o2 !== o1) {
            state.neighborPairs.add(getRelationKey(o1, o2));
          }
        }
      }

      if (y + 1 < height) {
        const downIdx = idx + width;
        if (terrain[downIdx] !== TerrainType.WATER) {
          const o2 = owners[downIdx];
          if (o2 >= 0 && o2 !== o1) {
            state.neighborPairs.add(getRelationKey(o1, o2));
          }
        }
      }
    }
  }
}

/** Single-pass territory, capital relocation, and neighbor-pair sync over the map grid. */
export function syncTerritoriesCapitalsAndNeighbors(state: GameState): void {
  const { width, height, owners, terrain, players } = state;
  state.neighborPairs.clear();

  for (const player of players.values()) {
    player.territoryCells = 0;
  }

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (terrain[idx] === TerrainType.WATER) continue;
      const o1 = owners[idx];
      if (o1 < 0) continue;

      const p1 = players.get(o1);
      if (p1) {
        p1.territoryCells++;
      }

      if (x + 1 < width) {
        const rightIdx = idx + 1;
        if (terrain[rightIdx] !== TerrainType.WATER) {
          const o2 = owners[rightIdx];
          if (o2 >= 0 && o2 !== o1) {
            state.neighborPairs.add(getRelationKey(o1, o2));
          }
        }
      }

      if (y + 1 < height) {
        const downIdx = idx + width;
        if (terrain[downIdx] !== TerrainType.WATER) {
          const o2 = owners[downIdx];
          if (o2 >= 0 && o2 !== o1) {
            state.neighborPairs.add(getRelationKey(o1, o2));
          }
        }
      }
    }
  }

  for (const player of players.values()) {
    if (player.territoryCells === 0) {
      player.alive = false;
      continue;
    }

    const capIdx = player.capitalY * width + player.capitalX;
    if (owners[capIdx] !== player.id) {
      for (let i = 0; i < owners.length; i++) {
        if (owners[i] === player.id) {
          player.capitalX = i % width;
          player.capitalY = (i - player.capitalX) / width;
          break;
        }
      }
    }
  }
}

/** Returns true if states a and b share a land border. */
export function areNeighbors(state: GameState, a: number, b: number): boolean {
  if (a === b || a < 0 || b < 0) return false;
  return state.neighborPairs.has(getRelationKey(a, b));
}

function getRelationFromMap(state: GameState, a: number, b: number): string {
  return state.relations.get(getRelationKey(a, b)) ?? 'NEUTRAL';
}

/** Computes passive money/sec income generated for each participant in a mutual trade agreement. */
export function computeTradePairIncomePerSec(
  state: GameState,
  aId: number,
  bId: number,
): number {
  const a = state.players.get(aId);
  const b = state.players.get(bId);
  if (!a || !b || !a.alive || !b.alive) {
    return 0;
  }

  let factoriesCount = 0;
  for (const building of state.buildings) {
    if (
      building.type === 'FACTORY' &&
      building.stackCount > 0 &&
      (building.ownerId === aId || building.ownerId === bId)
    ) {
      factoriesCount += building.stackCount;
    }
  }

  const sizeFactor = Math.pow(Math.max(1, a.territoryCells + b.territoryCells), 0.42) * 0.16;
  const factoryFactor = factoriesCount * 1.6;
  return 2.0 + sizeFactor + factoryFactor;
}

/** Keeps activeManpower aligned after combat deductions or refunds. */
export function syncPlayerActiveManpower(player: PlayerState): void {
  player.activeManpower = Math.max(0, player.manpower - player.allocatedManpower);
}

/** Creates an initialized 6-pillar PlayerState for human or AI bot players. */
export function createInitialPlayerState(params: {
  readonly id: number;
  readonly name: string;
  readonly isBot: boolean;
  readonly colorHex: string;
  readonly colorRgb: readonly [number, number, number];
  readonly capitalX: number;
  readonly capitalY: number;
  readonly territoryCells: number;
  readonly nextBotDecisionTick: number;
}): PlayerState {
  return {
    id: params.id,
    name: params.name,
    isBot: params.isBot,
    colorHex: params.colorHex,
    colorRgb: params.colorRgb,
    capitalX: params.capitalX,
    capitalY: params.capitalY,
    manpower: 240,
    maxManpower: 480,
    manpowerIncomePerSec: 12,
    manpowerGrowthEfficiency: 1,
    allocatedManpower: 0,
    activeManpower: 240,
    money: 280,
    moneyIncomePerSec: 6,
    tradeIncomePerSec: 0,
    knowledge: 0,
    knowledgeIncomePerSec: 0,
    buildingMaterial: 150,
    buildingMaterialIncomePerSec: CAPITAL_BASE_MATERIAL_PER_SEC,
    industry: 0,
    industryIncomePerSec: 0,
    energyReserve: 100,
    energyReserveMax: null,
    energyProductionPerSec: 0,
    energyConsumptionPerSec: 0,
    energyNetPerSec: 0,
    energySupplyRatio: 1,
    freePowerPlantUsed: false,
    buildingOccupancyByType: createDefaultOccupancyByType(),
    betrayalDebuffTicks: 0,
    nextBotDecisionTick: params.nextBotDecisionTick,
    territoryCells: params.territoryCells,
    alive: true,
  };
}

/**
 * Runs one authoritative economy evaluation across all alive states:
 * 1) Validates neighbor trade agreements & tallies passive trade income
 * 2) Allocates staffing manpower (0..200%) across owned buildings
 * 3) Balances energy production, consumption & reserve buffer
 * 4) Computes home-front manpower capacity/growth and updates 6 resource stocks
 */
export function updateAllPlayersEconomy(state: GameState, applyTickGrowth: boolean): void {
  const tradeIncomeByPlayer = new Map<number, number>();
  for (const key of Array.from(state.tradeAgreements)) {
    const [aStr, bStr] = key.split(':');
    const aId = Number(aStr);
    const bId = Number(bStr);
    if (
      !Number.isFinite(aId) ||
      !Number.isFinite(bId) ||
      !areNeighbors(state, aId, bId) ||
      getRelationFromMap(state, aId, bId) === 'WAR'
    ) {
      state.tradeAgreements.delete(key);
      continue;
    }

    const pairIncome = computeTradePairIncomePerSec(state, aId, bId);
    if (pairIncome <= 0) {
      state.tradeAgreements.delete(key);
      continue;
    }

    tradeIncomeByPlayer.set(aId, (tradeIncomeByPlayer.get(aId) ?? 0) + pairIncome);
    tradeIncomeByPlayer.set(bId, (tradeIncomeByPlayer.get(bId) ?? 0) + pairIncome);
  }

  const buildingsByOwner = new Map<number, Building[]>();
  for (const building of state.buildings) {
    let list = buildingsByOwner.get(building.ownerId);
    if (!list) {
      list = [];
      buildingsByOwner.set(building.ownerId, list);
    }
    list.push(building);
  }

  for (const player of state.players.values()) {
    if (!player.alive) continue;

    const ownedBuildings = buildingsByOwner.get(player.id) ?? [];

    // Step A: Manpower staffing allocation
    let totalDesiredMp = 0;
    const buildingTargetPcts: number[] = [];
    const buildingDesiredMps: number[] = [];

    for (let i = 0; i < ownedBuildings.length; i++) {
      const b = ownedBuildings[i];
      const units = b.stackCount;
      const spec = BUILDING_SPECS[b.type];
      if (units <= 0 || spec.baseManpowerRequired <= 0) {
        buildingTargetPcts.push(units > 0 ? 100 : 0);
        buildingDesiredMps.push(0);
        continue;
      }
      const rawPct = b.occupancyOverride ?? player.buildingOccupancyByType[b.type] ?? 100;
      const clampedPct = Math.max(0, Math.min(200, rawPct));
      const desiredMp = spec.baseManpowerRequired * (clampedPct / 100) * units;
      buildingTargetPcts.push(clampedPct);
      buildingDesiredMps.push(desiredMp);
      totalDesiredMp += desiredMp;
    }

    const staffingFulfillment =
      totalDesiredMp > 0 ? Math.min(1, Math.max(0, player.manpower / totalDesiredMp)) : 1;
    let allocatedManpower = 0;

    for (let i = 0; i < ownedBuildings.length; i++) {
      const b = ownedBuildings[i];
      const units = b.stackCount;
      const assignedMp = buildingDesiredMps[i] * staffingFulfillment;
      b.allocatedManpower = assignedMp;
      b.effectiveOccupancyPct =
        units <= 0
          ? 0
          : BUILDING_SPECS[b.type].baseManpowerRequired > 0
            ? buildingTargetPcts[i] * staffingFulfillment
            : 100;
      allocatedManpower += assignedMp;
    }

    player.allocatedManpower = allocatedManpower;
    player.activeManpower = Math.max(0, player.manpower - allocatedManpower);

    // Step B: Energy balance & unlimited reserve
    let energyProd = 0;
    let energyCons = 0;

    for (const b of ownedBuildings) {
      const units = b.stackCount;
      if (units <= 0) {
        b.currentEnergyProd = 0;
        b.currentEnergyUse = 0;
        continue;
      }
      const spec = BUILDING_SPECS[b.type];
      const curve = computeOccupancyCurve(b.effectiveOccupancyPct);
      const effPct = b.revealedEfficiencyPct ?? 100;
      let prod = 0;
      let cons = 0;

      if (b.type === 'POWER_PLANT') {
        prod = spec.baseEnergyProduction * (effPct / 100) * curve.outputMultiplier * units;
        energyProd += prod;
      } else if (spec.baseEnergyConsumption > 0) {
        cons =
          (spec.baseManpowerRequired > 0
            ? spec.baseEnergyConsumption * curve.energyMultiplier
            : spec.baseEnergyConsumption) * units;
        energyCons += cons;
      }

      b.currentEnergyProd = prod;
      b.currentEnergyUse = cons;
    }

    const energyNet = energyProd - energyCons;

    if (applyTickGrowth) {
      player.energyReserve = Math.max(0, player.energyReserve + energyNet * TICK_DT);
    } else {
      player.energyReserve = Math.max(0, player.energyReserve);
    }

    const energySupplyRatio =
      player.energyReserve > 0 || energyNet >= 0
        ? 1
        : Math.max(0.25, Math.min(1, energyProd / Math.max(0.01, energyCons)));

    player.energyReserveMax = null;
    player.energyProductionPerSec = energyProd;
    player.energyConsumptionPerSec = energyCons;
    player.energyNetPerSec = energyNet;
    player.energySupplyRatio = energySupplyRatio;

    // Step C: Resource production & home-front manpower capacity/growth
    const tradeIncome = tradeIncomeByPlayer.get(player.id) ?? 0;
    let moneyIncome = Math.pow(Math.max(1, player.territoryCells), 0.55) * 0.11 + tradeIncome;
    let materialIncome = CAPITAL_BASE_MATERIAL_PER_SEC;
    let industryIncome = 0;
    let knowledgeIncome = 0;
    let cityCount = 0;
    let barracksMaxBonus = 0;
    let barracksIncomeBonus = 0;

    for (const b of ownedBuildings) {
      const units = b.stackCount;
      if (units <= 0) {
        b.effectiveOutputPct = 0;
        continue;
      }
      const spec = BUILDING_SPECS[b.type];
      const curve = computeOccupancyCurve(b.effectiveOccupancyPct);
      const effPct = b.revealedEfficiencyPct ?? 100;
      const siteScale = effPct / 100;
      const energyFactor = spec.baseEnergyConsumption > 0 ? energySupplyRatio : 1;

      if (b.type === 'CITY') {
        cityCount += units;
        moneyIncome += spec.baseMoneyPerSec * (0.5 + 0.5 * energySupplyRatio) * units;
        b.effectiveOutputPct = Math.round((0.5 + 0.5 * energySupplyRatio) * 100);
      } else if (b.type === 'MINE') {
        materialIncome +=
          spec.baseMaterialPerSec * siteScale * curve.outputMultiplier * energyFactor * units;
        b.effectiveOutputPct = Math.round(effPct * curve.outputMultiplier * energyFactor);
      } else if (b.type === 'POWER_PLANT') {
        b.effectiveOutputPct = Math.round(effPct * curve.outputMultiplier);
      } else if (b.type === 'FACTORY') {
        industryIncome += spec.baseIndustryPerSec * curve.outputMultiplier * energyFactor * units;
        b.effectiveOutputPct = Math.round(100 * curve.outputMultiplier * energyFactor);
      } else if (b.type === 'LAB') {
        knowledgeIncome += spec.baseKnowledgePerSec * curve.outputMultiplier * energyFactor * units;
        b.effectiveOutputPct = Math.round(100 * curve.outputMultiplier * energyFactor);
      } else if (b.type === 'BARRACKS') {
        const barracksEnergyScale = 0.7 + 0.3 * energySupplyRatio;
        barracksMaxBonus += spec.baseMaxManpowerBonus * curve.outputMultiplier * units;
        barracksIncomeBonus +=
          spec.baseManpowerIncomeBonus * curve.outputMultiplier * barracksEnergyScale * units;
        b.effectiveOutputPct = Math.round(100 * curve.outputMultiplier * barracksEnergyScale);
      } else if (b.type === 'PORT') {
        moneyIncome += spec.baseMoneyPerSec * curve.outputMultiplier * energyFactor * units;
        b.effectiveOutputPct = Math.round(100 * curve.outputMultiplier * energyFactor);
      } else {
        b.effectiveOutputPct = Math.round(100 * curve.outputMultiplier * energyFactor);
      }
    }

    player.tradeIncomePerSec = tradeIncome;
    player.moneyIncomePerSec = moneyIncome;
    player.buildingMaterialIncomePerSec = materialIncome;
    player.industryIncomePerSec = industryIncome;
    player.knowledgeIncomePerSec = knowledgeIncome;

    const maxManpower = Math.round(
      160 +
        Math.pow(Math.max(1, player.territoryCells), 0.52) * 5.2 +
        cityCount * BUILDING_SPECS.CITY.baseMaxManpowerBonus +
        barracksMaxBonus,
    );
    const clampedManpower = Math.min(maxManpower, Math.max(0, player.manpower));
    const fillRatio = Math.max(0, Math.min(1, clampedManpower / Math.max(1, maxManpower)));

    let growthEfficiency: number;
    if (fillRatio <= OPTIMUM_FILL_RATIO) {
      growthEfficiency = 0.48 + 0.52 * Math.sin((fillRatio / OPTIMUM_FILL_RATIO) * (Math.PI / 2));
    } else {
      const overRatio = (fillRatio - OPTIMUM_FILL_RATIO) / (1 - OPTIMUM_FILL_RATIO);
      growthEfficiency = Math.pow(Math.max(0, 1 - overRatio), 1.65);
    }

    const peakManpowerIncome =
      4.5 +
      Math.pow(Math.max(1, player.territoryCells), 0.48) * 0.18 +
      cityCount * BUILDING_SPECS.CITY.baseManpowerIncomeBonus +
      barracksIncomeBonus;

    let manpowerIncome = peakManpowerIncome * growthEfficiency;
    const activeBeforeGrowth = Math.max(0, clampedManpower - allocatedManpower);
    if (activeBeforeGrowth / Math.max(1, maxManpower) < 0.18) {
      manpowerIncome = Math.max(manpowerIncome, 12 + maxManpower * 0.022);
    }

    player.maxManpower = maxManpower;
    player.manpowerGrowthEfficiency = growthEfficiency;
    player.manpowerIncomePerSec = manpowerIncome;

    if (applyTickGrowth) {
      player.money += moneyIncome * TICK_DT;
      player.buildingMaterial += materialIncome * TICK_DT;
      player.industry += industryIncome * TICK_DT;
      player.knowledge += knowledgeIncome * TICK_DT;
      player.manpower = Math.min(maxManpower, clampedManpower + manpowerIncome * TICK_DT);
    } else {
      player.manpower = clampedManpower;
    }

    // Re-sync staffing & active manpower after clamped/grown total manpower
    const finalFulfillment =
      totalDesiredMp > 0 ? Math.min(1, Math.max(0, player.manpower / totalDesiredMp)) : 1;
    let finalAllocated = 0;
    for (let i = 0; i < ownedBuildings.length; i++) {
      const b = ownedBuildings[i];
      const units = b.stackCount;
      const assigned = buildingDesiredMps[i] * finalFulfillment;
      b.allocatedManpower = assigned;
      b.effectiveOccupancyPct =
        units <= 0
          ? 0
          : BUILDING_SPECS[b.type].baseManpowerRequired > 0
            ? buildingTargetPcts[i] * finalFulfillment
            : 100;
      finalAllocated += assigned;
    }
    player.allocatedManpower = finalAllocated;
    player.activeManpower = Math.max(0, player.manpower - finalAllocated);
  }
}
