import { getTechLevel } from './techTree';
import {
  BARRACKS_DEFENSE_RADIUS,
  Building,
  BuildingType,
  DefenseBuildingType,
  TechStateByBranch,
} from './types';

export type DefenseDomain = 'GROUND_INFANTRY' | 'GROUND_ARMOR' | 'AIR_DEFENSE';

export interface DefenseSpec {
  readonly type: DefenseBuildingType;
  readonly domain: DefenseDomain;
  readonly roleLabelCs: string;
  readonly techTreeBranchCs: string;
  readonly radius: number;
  readonly maxLevel: number;
  readonly frontCostBonusPerStack: number;
  readonly frontSlowdownPerStack: number;
  readonly antiInfantryRating: number;
  readonly antiArmorRating: number;
  readonly antiAirRating: number;
  readonly buildingProtectionRatio: number;
}

/** Static defense specifications structured with clear roles & Tech-Tree branches. */
export const DEFENSE_SPECS: Readonly<Record<DefenseBuildingType, DefenseSpec>> = {
  TRENCH: {
    type: 'TRENCH',
    domain: 'GROUND_INFANTRY',
    roleLabelCs: 'Základní frontová obrana (od startu)',
    techTreeBranchCs: 'Dostupné od startu · vylepšení: Obrana (Tech Tree)',
    radius: 16,
    maxLevel: 5,
    frontCostBonusPerStack: 0.55,
    frontSlowdownPerStack: 0.36,
    antiInfantryRating: 0.9,
    antiArmorRating: 0.2,
    antiAirRating: 0.0,
    buildingProtectionRatio: 0.1,
  },
  BUNKER: {
    type: 'BUNKER',
    domain: 'GROUND_ARMOR',
    roleLabelCs: 'Těžká protitanková pevnost',
    techTreeBranchCs: 'Obranné technologie · protitanková větev (Tech Tree)',
    radius: 20,
    maxLevel: 5,
    frontCostBonusPerStack: 1.15,
    frontSlowdownPerStack: 0.56,
    antiInfantryRating: 0.65,
    antiArmorRating: 1.35,
    antiAirRating: 0.1,
    buildingProtectionRatio: 0.25,
  },
  AA_BATTERY: {
    type: 'AA_BATTERY',
    domain: 'AIR_DEFENSE',
    roleLabelCs: 'PVO baterie proti výsadkům a náletům',
    techTreeBranchCs: 'Obranné technologie / PVO větev (Tech Tree)',
    radius: 26,
    maxLevel: 5,
    frontCostBonusPerStack: 0,
    frontSlowdownPerStack: 0,
    antiInfantryRating: 0.0,
    antiArmorRating: 0.0,
    antiAirRating: 1.2,
    buildingProtectionRatio: 0.45,
  },
};

export interface CellDefenseModifiers {
  readonly attackerCostMultiplier: number;
  readonly advanceSpeedMultiplier: number;
  readonly defenderLossMultiplier: number;
  readonly antiInfantryFactor: number;
  readonly antiArmorFactor: number;
  readonly antiAirFactor: number;
  readonly nodeProtectionFactor: number;
}

export function isDefenseBuildingType(type: BuildingType): type is DefenseBuildingType {
  return type === 'TRENCH' || type === 'BUNKER' || type === 'AA_BATTERY';
}

export function getDefenseRadius(type: BuildingType): number {
  if (isDefenseBuildingType(type)) {
    return DEFENSE_SPECS[type].radius;
  }
  return type === 'BARRACKS' ? BARRACKS_DEFENSE_RADIUS : 0;
}

/**
 * Evaluates aggregate defensive impact of completed barracks and fortifications covering
 * cell (x, y) for defenderId, including speed slowdown, attrition, armor & AA hooks.
 */
export function evaluateCellDefense(
  buildings: ReadonlyArray<Building>,
  defenderId: number,
  x: number,
  y: number,
  defenderPlayer?: { readonly techLevels?: Readonly<TechStateByBranch> },
): CellDefenseModifiers {
  let bestBarracksBonus = 0;
  let costBonus = 0;
  let slowdown = 0;
  let antiInfantry = 0;
  let antiArmor = 0;
  let antiAir = 0;
  let nodeProt = 0;

  const hasBunkerL2 = getTechLevel(defenderPlayer, 'ECONOMY_DEFENSE') >= 3;
  const hasEnhancedAa = getTechLevel(defenderPlayer, 'ARTILLERY_SUPPORT') >= 3;

  for (const b of buildings) {
    if (b.ownerId !== defenderId || b.stackCount <= 0 || b.effectiveOutputPct <= 0) {
      continue;
    }

    if (b.type === 'BARRACKS') {
      if (Math.hypot(b.x - x, b.y - y) <= BARRACKS_DEFENSE_RADIUS) {
        const eff = b.effectiveOutputPct / 100;
        const weighted = eff * (0.3 + 0.08 * Math.min(3, b.stackCount - 1));
        if (weighted > bestBarracksBonus) {
          bestBarracksBonus = weighted;
        }
      }
      continue;
    }

    if (!isDefenseBuildingType(b.type)) {
      continue;
    }

    const spec = DEFENSE_SPECS[b.type];
    const effectiveRadius =
      b.type === 'AA_BATTERY' && hasEnhancedAa ? spec.radius * 1.3 : spec.radius;
    if (Math.hypot(b.x - x, b.y - y) > effectiveRadius) {
      continue;
    }

    const eff = b.effectiveOutputPct / 100;
    const stackScale = 1 + 0.35 * Math.log2(b.stackCount);
    const levelScale = 1 + Math.max(0, b.level - 1) * 0.2;
    const weight = eff * stackScale * levelScale;

    const costMulTech = b.type === 'BUNKER' && hasBunkerL2 ? 1.35 : 1.0;
    const antiArmorMulTech = b.type === 'BUNKER' && hasBunkerL2 ? 1.85 : 1.0;
    const antiAirMulTech = b.type === 'AA_BATTERY' && hasEnhancedAa ? 1.3 : 1.0;

    costBonus += spec.frontCostBonusPerStack * weight * costMulTech;
    slowdown += spec.frontSlowdownPerStack * weight;
    antiInfantry += spec.antiInfantryRating * weight;
    antiArmor += spec.antiArmorRating * weight * antiArmorMulTech;
    antiAir += spec.antiAirRating * weight * antiAirMulTech;
    nodeProt += spec.buildingProtectionRatio * weight;
  }

  const cappedBarracks = Math.min(0.55, bestBarracksBonus);
  return {
    attackerCostMultiplier: 1 + Math.min(3.2, cappedBarracks + costBonus),
    advanceSpeedMultiplier: Math.max(0.16, 1 - Math.min(0.84, slowdown)),
    defenderLossMultiplier: Math.max(0.5, 1 - Math.min(0.5, (cappedBarracks + costBonus) * 0.24)),
    antiInfantryFactor: antiInfantry,
    antiArmorFactor: antiArmor,
    antiAirFactor: antiAir,
    nodeProtectionFactor: Math.min(0.75, nodeProt),
  };
}

/** Returns local anti-air defense coverage factor at (x, y) for Step 6/7 aircraft and drops. */
export function getAirDefenseCoverageAt(
  buildings: ReadonlyArray<Building>,
  ownerId: number,
  x: number,
  y: number,
  ownerPlayer?: { readonly techLevels?: Readonly<TechStateByBranch> },
): number {
  return evaluateCellDefense(buildings, ownerId, x, y, ownerPlayer).antiAirFactor;
}
