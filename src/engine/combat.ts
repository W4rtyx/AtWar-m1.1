import { evaluateCellDefense } from './defenses';
import { syncPlayerActiveManpower } from './economy';
import { getCombatBlackoutMultiplier } from './energyGrid';
import {
  Building,
  BuildingType,
  GameState,
  PlayerState,
  TICK_DT,
  TerrainType,
  Unit,
  UnitType,
} from './types';
import {
  UNIT_LOOT_RATIO,
  UNIT_SPECS,
  getAttackOrderFrontPoint,
  getUnitRelation,
} from './units';

export interface FrontUnitSupportModifiers {
  readonly attackerCostMultiplier: number;
  readonly attackerSpeedMultiplier: number;
  readonly fortificationSuppression: number;
  readonly defenderResistanceCostMultiplier: number;
  readonly defenderResistanceSpeedMultiplier: number;
}

/**
 * Evaluates tactical unit support & enemy unit resistance around frontier cell (cellX, cellY).
 * Friendly infantry, tanks, and artillery reduce arrow attrition and accelerate breakthroughs;
 * enemy units (especially in LOCK stance) strongly stiffen sector resistance.
 */
export function evaluateFrontUnitSupport(
  state: GameState,
  attackerId: number,
  defenderId: number,
  cellX: number,
  cellY: number,
  cellTerrain: TerrainType,
): FrontUnitSupportModifiers {
  if (state.units.length === 0) {
    return {
      attackerCostMultiplier: 1,
      attackerSpeedMultiplier: 1,
      fortificationSuppression: 0,
      defenderResistanceCostMultiplier: 1,
      defenderResistanceSpeedMultiplier: 1,
    };
  }

  const enemyDef =
    defenderId >= 0 ? evaluateCellDefense(state.buildings, defenderId, cellX, cellY) : null;

  let costReduction = 0;
  let speedBoost = 0;
  let fortSuppression = 0;
  let defenderResist = 0;

  for (const u of state.units) {
    if (u.count <= 0 || u.hp <= 0) continue;
    const spec = UNIT_SPECS[u.type];
    const radius = Math.max(u.ownerId === attackerId ? 20 : 18, spec.attackRange);
    const dist = Math.hypot(u.x - (cellX + 0.5), u.y - (cellY + 0.5));
    if (dist > radius) continue;

    const hpFrac = Math.max(0.2, Math.min(1, u.hp / Math.max(1, u.maxHp)));
    const moraleMul = 0.5 + 0.5 * (u.morale / 100);
    const baseWeight = Math.pow(u.count, 0.85) * hpFrac * moraleMul;

    if (u.ownerId === attackerId) {
      const encircledMul = u.isEncircled ? 0.65 : 1.0;
      const w = baseWeight * encircledMul;
      if (u.type === 'INFANTRY') {
        costReduction += 0.14 * w;
        speedBoost += 0.16 * w;
      } else if (u.type === 'TANK') {
        const terrainScale = cellTerrain === TerrainType.MOUNTAINS ? 0.35 : 1.0;
        const bunkerDamp = enemyDef ? 1 / (1 + enemyDef.antiArmorFactor * 0.65) : 1.0;
        costReduction += 0.24 * w * terrainScale * bunkerDamp;
        speedBoost += 0.34 * w * terrainScale * bunkerDamp;
        fortSuppression += 0.1 * w * terrainScale;
      } else if (u.type === 'ARTILLERY') {
        costReduction += 0.16 * w;
        speedBoost += 0.14 * w;
        fortSuppression += 0.32 * w;
      } else if (u.type === 'PARATROOPERS') {
        const dropMul = u.dropVulnerabilityTicks > 0 ? 0.5 : 1.0;
        costReduction += 0.15 * w * dropMul;
        speedBoost += 0.16 * w * dropMul;
      }
    } else if (u.ownerId === defenderId) {
      const stanceMul = u.stance === 'LOCK' ? 1.28 : 1.0;
      defenderResist += 0.22 * baseWeight * stanceMul;
    }
  }

  return {
    attackerCostMultiplier: Math.max(0.42, 1 - Math.min(0.58, costReduction)),
    attackerSpeedMultiplier: Math.min(1.9, 1 + Math.min(0.9, speedBoost)),
    fortificationSuppression: Math.min(0.65, fortSuppression),
    defenderResistanceCostMultiplier: Math.min(2.3, 1 + defenderResist),
    defenderResistanceSpeedMultiplier: Math.max(0.32, 1 / (1 + defenderResist * 0.75)),
  };
}

/** Awards 25% of destroyed enemy unit resource value as battle loot to victorId. */
export function awardUnitDefeatLoot(
  state: GameState,
  victorId: number,
  unitType: UnitType,
  unitsLost: number,
): void {
  if (unitsLost <= 0 || victorId < 0) return;
  const victor = state.players.get(victorId);
  if (!victor || !victor.alive || victor.isEliminated) return;
  const spec = UNIT_SPECS[unitType];
  victor.money += Math.round(spec.cost.money * UNIT_LOOT_RATIO * unitsLost);
  victor.buildingMaterial += Math.round(spec.cost.buildingMaterial * UNIT_LOOT_RATIO * unitsLost);
  victor.industry += Math.round(spec.cost.industry * UNIT_LOOT_RATIO * unitsLost);
}

function getArtilleryBuildingPriority(type: BuildingType): number {
  switch (type) {
    case 'BUNKER':
      return 6;
    case 'TRENCH':
      return 5;
    case 'AA_BATTERY':
      return 4;
    case 'AIRFIELD':
      return 3;
    case 'FACTORY':
      return 2;
    case 'BARRACKS':
      return 1;
    default:
      return 0;
  }
}

function shellEnemyDefenseOrFrontline(
  state: GameState,
  attacker: Unit,
  attOwner: PlayerState | undefined,
  deadBuildingIds: Set<number>,
): void {
  const attSpec = UNIT_SPECS.ARTILLERY;
  let bestBuilding: Building | null = null;
  let bestPriority = 0;
  let bestDist = attSpec.attackRange;

  for (const candidate of state.buildings) {
    if (deadBuildingIds.has(candidate.id)) continue;
    if (candidate.stackCount <= 0 && candidate.underConstructionCount <= 0) continue;
    if (candidate.ownerId === attacker.ownerId) continue;
    if (getUnitRelation(state, attacker.ownerId, candidate.ownerId) !== 'WAR') continue;

    const prio = getArtilleryBuildingPriority(candidate.type);
    if (prio <= 0) continue;

    const dist = Math.hypot(candidate.x + 0.5 - attacker.x, candidate.y + 0.5 - attacker.y);
    if (dist > attSpec.attackRange) continue;

    if (prio > bestPriority || (prio === bestPriority && dist < bestDist)) {
      bestPriority = prio;
      bestDist = dist;
      bestBuilding = candidate;
    }
  }

  if (bestBuilding) {
    attacker.combatCooldownTicks = 6;
    attacker.lastCombatTargetX = bestBuilding.x + 0.5;
    attacker.lastCombatTargetY = bestBuilding.y + 0.5;

    const supplyMul = 0.45 + 0.55 * attacker.supplyLevel;
    const moraleMul = 0.5 + 0.5 * (attacker.morale / 100);
    const blackoutMul = getCombatBlackoutMultiplier(attOwner);
    const hpEfficiency = 0.45 + 0.55 * Math.min(1, attacker.hp / Math.max(1, attacker.maxHp));
    const countScale = Math.pow(attacker.count, 0.88);
    const shellPower =
      attSpec.attack * countScale * hpEfficiency * supplyMul * moraleMul * blackoutMul;

    const occupier = state.players.get(bestBuilding.ownerId);
    if (occupier && occupier.alive && !occupier.isEliminated) {
      const mpAttrition = Math.min(20 * TICK_DT, shellPower * TICK_DT * 0.25);
      const protectedFloor = occupier.allocatedManpower;
      if (occupier.manpower > protectedFloor) {
        occupier.manpower = Math.max(protectedFloor, occupier.manpower - mpAttrition);
        syncPlayerActiveManpower(occupier);
      }
    }

    if (!bestBuilding.isCapital) {
      const chipInterval = Math.max(8, Math.round(32 / Math.max(1, Math.min(8, attacker.count))));
      if ((state.tick + bestBuilding.id) % chipInterval === 0) {
        if (bestBuilding.stackCount > 0) {
          bestBuilding.stackCount--;
        } else if (bestBuilding.underConstructionCount > 0) {
          bestBuilding.underConstructionCount--;
        }
        if (bestBuilding.stackCount <= 0 && bestBuilding.underConstructionCount <= 0) {
          deadBuildingIds.add(bestBuilding.id);
        }
        state.stateVersion++;
      }
    }
    return;
  }

  // Fallback supporting barrage onto active friendly WAR frontline push inside attackRange
  let bestFront: { x: number; y: number } | null = null;
  let bestFrontDist = attSpec.attackRange;
  for (const order of state.attackOrders) {
    if (order.playerId !== attacker.ownerId) continue;
    if (order.wildernessOnly) continue;
    if (
      order.targetOwnerIds.length > 0 &&
      !order.targetOwnerIds.some((id) => getUnitRelation(state, attacker.ownerId, id) === 'WAR')
    ) {
      continue;
    }
    const head = getAttackOrderFrontPoint(order);
    const dist = Math.hypot(head.x - attacker.x, head.y - attacker.y);
    if (dist > bestFrontDist) continue;

    const ix = Math.max(0, Math.min(state.width - 1, Math.floor(head.x)));
    const iy = Math.max(0, Math.min(state.height - 1, Math.floor(head.y)));
    let touchesWar = false;
    for (let dy = -2; dy <= 2 && !touchesWar; dy++) {
      const ny = iy + dy;
      if (ny < 0 || ny >= state.height) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const nx = ix + dx;
        if (nx < 0 || nx >= state.width) continue;
        const cOwner = state.owners[ny * state.width + nx];
        if (cOwner >= 0 && cOwner !== attacker.ownerId && getUnitRelation(state, attacker.ownerId, cOwner) === 'WAR') {
          touchesWar = true;
          break;
        }
      }
    }
    if (touchesWar) {
      bestFrontDist = dist;
      bestFront = head;
    }
  }

  if (bestFront) {
    attacker.combatCooldownTicks = 6;
    attacker.lastCombatTargetX = bestFront.x;
    attacker.lastCombatTargetY = bestFront.y;
  }
}

/** Resolves unit-vs-unit tactical fire, artillery bombardment, encircled pocket attrition, count scaling, and defeat loot. */
export function stepUnitsCombat(state: GameState): void {
  if (state.phase !== 'PLAYING' || state.units.length === 0) {
    return;
  }

  const incomingDamage = new Map<number, number>();
  const lastAttacker = new Map<number, number>();
  const deadBuildingIds = new Set<number>();

  for (const u of state.units) {
    if (u.combatCooldownTicks === 0) {
      u.lastCombatTargetX = null;
      u.lastCombatTargetY = null;
    }
  }

  // 1. Unit-vs-unit tactical engagements
  for (const attacker of state.units) {
    if (attacker.count <= 0 || attacker.hp <= 0) continue;
    const attSpec = UNIT_SPECS[attacker.type];
    const attOwner = state.players.get(attacker.ownerId);

    let bestTarget: Unit | null = null;
    let bestDist = attSpec.attackRange;
    for (const candidate of state.units) {
      if (candidate.count <= 0 || candidate.hp <= 0) continue;
      if (candidate.ownerId === attacker.ownerId) continue;
      if (getUnitRelation(state, attacker.ownerId, candidate.ownerId) !== 'WAR') continue;
      const dist = Math.hypot(candidate.x - attacker.x, candidate.y - attacker.y);
      if (dist <= bestDist) {
        bestDist = dist;
        bestTarget = candidate;
      }
    }

    if (!bestTarget) {
      if (attacker.type === 'ARTILLERY') {
        shellEnemyDefenseOrFrontline(state, attacker, attOwner, deadBuildingIds);
      }
      continue;
    }

    const defIx = Math.max(0, Math.min(state.width - 1, Math.floor(bestTarget.x)));
    const defIy = Math.max(0, Math.min(state.height - 1, Math.floor(bestTarget.y)));
    const defTerrain = state.terrain[defIy * state.width + defIx];
    const defOwner = state.players.get(bestTarget.ownerId);
    const enemyFort = evaluateCellDefense(state.buildings, bestTarget.ownerId, defIx, defIy);

    const supplyMul = 0.45 + 0.55 * attacker.supplyLevel;
    const moraleMul = 0.5 + 0.5 * (attacker.morale / 100);
    const blackoutMul = getCombatBlackoutMultiplier(attOwner);
    const countScale = Math.pow(attacker.count, 0.88);
    const hpEfficiency = 0.45 + 0.55 * Math.min(1, attacker.hp / Math.max(1, attacker.maxHp));

    let dmg =
      attSpec.attack *
      countScale *
      hpEfficiency *
      supplyMul *
      moraleMul *
      blackoutMul *
      TICK_DT *
      0.7;

    if (attacker.type === 'TANK') {
      if (bestTarget.type === 'INFANTRY' && defTerrain === TerrainType.PLAINS) {
        dmg *= 1.35;
      }
      if (enemyFort.antiArmorFactor > 0.2) {
        dmg *= Math.max(0.45, 1 / (1 + enemyFort.antiArmorFactor * 0.55));
      }
    } else if (attacker.type === 'ARTILLERY') {
      if (enemyFort.attackerCostMultiplier > 1.2) {
        dmg *= 1.4;
      }
      if (bestDist <= 9) {
        dmg *= 0.68;
      }
    } else if (attacker.type === 'PARATROOPERS' && attacker.dropVulnerabilityTicks > 0) {
      dmg *= 0.65;
    }

    if (bestTarget.type === 'ARTILLERY' && bestDist <= 9) {
      dmg *= 1.45;
    }
    if (bestTarget.dropVulnerabilityTicks > 0) {
      dmg *= 1.5;
    }
    if (bestTarget.stance === 'LOCK') {
      dmg *= 0.78;
    }
    if (defOwner && defOwner.betrayalDebuffTicks > 0) {
      dmg *= 1.35;
    }
    const defSpec = UNIT_SPECS[bestTarget.type];
    const defenseMitigation = 100 / (100 + defSpec.defense * 1.4);
    const finalDmg = Math.max(0.5 * TICK_DT, dmg * defenseMitigation);

    incomingDamage.set(bestTarget.id, (incomingDamage.get(bestTarget.id) ?? 0) + finalDmg);
    lastAttacker.set(bestTarget.id, attacker.ownerId);

    attacker.combatCooldownTicks = 6;
    attacker.lastCombatTargetX = bestTarget.x;
    attacker.lastCombatTargetY = bestTarget.y;
    bestTarget.combatCooldownTicks = 6;
  }

  // 2. Encircled pocket combat: isolated units fight enemy garrison/terrain without energy supply
  for (const unit of state.units) {
    if (unit.count <= 0 || unit.hp <= 0 || !unit.isEncircled) continue;
    const ix = Math.max(0, Math.min(state.width - 1, Math.floor(unit.x)));
    const iy = Math.max(0, Math.min(state.height - 1, Math.floor(unit.y)));
    const cellOwner = state.owners[iy * state.width + ix];
    if (cellOwner < 0 || cellOwner === unit.ownerId) continue;

    const spec = UNIT_SPECS[unit.type];
    const enemyFort = evaluateCellDefense(state.buildings, cellOwner, ix, iy);
    const dropMul = unit.dropVulnerabilityTicks > 0 ? 1.55 : 1.0;
    const fortMul = 1 + Math.min(0.8, (enemyFort.attackerCostMultiplier - 1) * 0.35);
    const pocketDmg = unit.maxHp * 0.048 * dropMul * fortMul * TICK_DT;

    incomingDamage.set(unit.id, (incomingDamage.get(unit.id) ?? 0) + pocketDmg);
    if (!lastAttacker.has(unit.id)) {
      lastAttacker.set(unit.id, cellOwner);
    }

    // Encircled unit fights back against occupying state's local manpower
    const occupier = state.players.get(cellOwner);
    if (occupier && occupier.alive && !occupier.isEliminated) {
      const mpAttrition = Math.min(
        18 * TICK_DT,
        spec.attack * Math.pow(unit.count, 0.8) * TICK_DT * 0.26,
      );
      const protectedFloor = occupier.blackoutActive
        ? occupier.allocatedManpower
        : Math.min(
            occupier.maxManpower,
            occupier.allocatedManpower +
              Math.min(occupier.maxManpower * 0.4, Math.max(28, occupier.maxManpower * 0.08)),
          );
      if (occupier.manpower > protectedFloor) {
        occupier.manpower = Math.max(protectedFloor, occupier.manpower - mpAttrition);
        syncPlayerActiveManpower(occupier);
      }
    }
  }

  // 3. Apply damage, rescale stack count, award defeat loot, and clean up destroyed units
  let anyRemoved = false;
  for (const unit of state.units) {
    const dmg = incomingDamage.get(unit.id) ?? 0;
    if (dmg <= 0) continue;

    const spec = UNIT_SPECS[unit.type];
    const prevCount = unit.count;
    unit.hp = Math.max(0, unit.hp - dmg);
    unit.morale = Math.max(0, unit.morale - 2.2 * TICK_DT);

    const newCount =
      unit.hp <= 0 ? 0 : Math.min(prevCount, Math.max(1, Math.ceil(unit.hp / spec.hpPerUnit)));

    if (newCount < prevCount) {
      const victorId = lastAttacker.get(unit.id) ?? -1;
      awardUnitDefeatLoot(state, victorId, unit.type, prevCount - newCount);
    }

    if (newCount <= 0 || unit.hp <= 0) {
      unit.count = 0;
      unit.hp = 0;
      anyRemoved = true;
    } else if (newCount !== prevCount) {
      unit.count = newCount;
      unit.maxHp = newCount * spec.hpPerUnit;
      unit.hp = Math.min(unit.hp, unit.maxHp);
      state.stateVersion++;
    }
  }

  if (deadBuildingIds.size > 0) {
    state.buildings = state.buildings.filter((b) => !deadBuildingIds.has(b.id));
    state.stateVersion++;
  }

  if (anyRemoved) {
    state.units = state.units.filter((u) => u.count > 0 && u.hp > 0);
    state.stateVersion++;
  }
}
