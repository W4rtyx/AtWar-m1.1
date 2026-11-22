import { evaluateCellDefense, getAirDefenseCoverageAt } from './defenses';
import { syncPlayerActiveManpower } from './economy';
import { getCombatBlackoutMultiplier } from './energyGrid';
import {
  getFireMissionSalvoIndustryCost,
  isAirUnitType,
  isNavalUnitType,
  supportsFireMission,
} from './navalAir';
import {
  Building,
  BuildingType,
  GameState,
  PlayerState,
  TICK_DT,
  TerrainType,
  Unit,
  UnitType,
  WILDERNESS_OWNER,
} from './types';
import {
  UNIT_LOOT_RATIO,
  UNIT_SPECS,
  getAttackOrderFrontPoint,
  getFrontPushCenterPoint,
  getUnitRelation,
  isUnitVisibleToPlayer,
} from './units';

export const ARTILLERY_BLAST_RADIUS = 7.5;
export const BARE_ARROW_FOREIGN_COST_MUL = 1.85;
export const BARE_ARROW_FOREIGN_SPEED_MUL = 0.52;

/** Applies manpower growth suppression from artillery bombardment or air strikes. */
export function applyManpowerSuppression(
  target: PlayerState,
  addedTicks: number,
  addedIntensity: number,
): void {
  if (!target.alive || target.isEliminated || addedTicks <= 0 || addedIntensity <= 0) {
    return;
  }
  target.manpowerSuppressionTicks = Math.min(
    300,
    target.manpowerSuppressionTicks + Math.round(addedTicks),
  );
  target.manpowerSuppressionIntensity = Math.min(
    0.65,
    Math.max(target.manpowerSuppressionIntensity, 0.12) + addedIntensity,
  );
}

export interface FrontUnitSupportModifiers {
  readonly attackerCostMultiplier: number;
  readonly attackerSpeedMultiplier: number;
  readonly fortificationSuppression: number;
  readonly defenderResistanceCostMultiplier: number;
  readonly defenderResistanceSpeedMultiplier: number;
}

/**
 * Evaluates tactical unit support & enemy unit resistance around frontier cell (cellX, cellY).
 * Bare attack arrows against foreign states are slow and costly; friendly infantry, tanks,
 * artillery, and paratroopers provide decisive breakthrough power and suppress enemy defenses.
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
      attackerCostMultiplier: BARE_ARROW_FOREIGN_COST_MUL,
      attackerSpeedMultiplier: BARE_ARROW_FOREIGN_SPEED_MUL,
      fortificationSuppression: 0,
      defenderResistanceCostMultiplier: 1,
      defenderResistanceSpeedMultiplier: 1,
    };
  }

  const enemyDef =
    defenderId >= 0 ? evaluateCellDefense(state.buildings, defenderId, cellX, cellY) : null;

  let attackerSupportWeight = 0;
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
      attackerSupportWeight += w;
      if (u.type === 'INFANTRY') {
        costReduction += 0.14 * w;
        speedBoost += 0.16 * w;
      } else if (u.type === 'TANK') {
        const terrainScale = cellTerrain === TerrainType.MOUNTAINS ? 0.35 : 1.0;
        const bunkerDamp = enemyDef ? 1 / (1 + enemyDef.antiArmorFactor * 0.65) : 1.0;
        costReduction += 0.24 * w * terrainScale * bunkerDamp;
        speedBoost += 0.34 * w * terrainScale * bunkerDamp;
        fortSuppression += 0.12 * w * terrainScale;
      } else if (u.type === 'ARTILLERY') {
        costReduction += 0.16 * w;
        speedBoost += 0.14 * w;
        fortSuppression += 0.34 * w;
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

  const supportBlend = Math.min(1, attackerSupportWeight / 1.35);
  const baseCostMul = 1 + (BARE_ARROW_FOREIGN_COST_MUL - 1) * (1 - supportBlend);
  const baseSpeedMul = 1 - (1 - BARE_ARROW_FOREIGN_SPEED_MUL) * (1 - supportBlend);

  return {
    attackerCostMultiplier: Math.max(0.42, baseCostMul * (1 - Math.min(0.58, costReduction))),
    attackerSpeedMultiplier: Math.min(1.65, baseSpeedMul * (1 + Math.min(0.65, speedBoost * 0.65))),
    fortificationSuppression: Math.min(0.62, fortSuppression),
    defenderResistanceCostMultiplier: Math.min(2.4, 1 + defenderResist),
    defenderResistanceSpeedMultiplier: Math.max(0.3, 1 / (1 + defenderResist * 0.75)),
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
    case 'ARMORY':
      return 3;
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

function executeArtilleryFireMissionSalvo(
  state: GameState,
  attacker: Unit,
  attOwner: PlayerState | undefined,
  fx: number,
  fy: number,
  remainingAfterDec: number,
  incomingDamage: Map<number, number>,
  lastAttacker: Map<number, number>,
  deadBuildingIds: Set<number>,
): void {
  const attSpec = UNIT_SPECS[attacker.type];
  attacker.combatCooldownTicks = 6;
  attacker.lastCombatTargetX = fx;
  attacker.lastCombatTargetY = fy;

  if (remainingAfterDec % 10 !== 9) {
    return;
  }

  const ammoCost = getFireMissionSalvoIndustryCost(attacker.type, attacker.count);
  if (!attOwner || attOwner.industry < ammoCost) {
    attacker.fireMissionX = null;
    attacker.fireMissionY = null;
    attacker.fireMissionTicksRemaining = 0;
    if (attacker.ownerId === state.humanPlayerId) {
      state.lastNotice = {
        id: state.nextNoticeId++,
        messageCs: 'Nedostatek Průmyslu pro munici',
        tick: state.tick,
      };
    }
    state.stateVersion++;
    return;
  }
  attOwner.industry = Math.max(0, attOwner.industry - ammoCost);

  const supplyMul = 0.45 + 0.55 * attacker.supplyLevel;
  const moraleMul = 0.5 + 0.5 * (attacker.morale / 100);
  const blackoutMul = getCombatBlackoutMultiplier(attOwner);
  const hpEfficiency = 0.45 + 0.55 * Math.min(1, attacker.hp / Math.max(1, attacker.maxHp));
  const countScale = Math.pow(attacker.count, 0.88);
  const salvoPower =
    attSpec.attack * countScale * hpEfficiency * supplyMul * moraleMul * blackoutMul;

  // 1. Area splash damage & morale shock to WAR enemy units (including naval ships/transports) inside blast circle
  for (const candidate of state.units) {
    if (candidate.count <= 0 || candidate.hp <= 0) continue;
    if (candidate.ownerId === attacker.ownerId) continue;
    if (getUnitRelation(state, attacker.ownerId, candidate.ownerId) !== 'WAR') continue;
    if (isAirUnitType(candidate.type)) continue;
    const dist = Math.hypot(candidate.x - fx, candidate.y - fy);
    if (dist > ARTILLERY_BLAST_RADIUS) continue;

    const falloff = Math.max(0.35, 1 - 0.6 * (dist / ARTILLERY_BLAST_RADIUS));
    const navalBonus =
      attacker.type === 'BOMBER' && candidate.type === 'TRANSPORT_SHIP' ? 1.45 : 1.0;
    const splashDmg = Math.max(2.5, salvoPower * 0.65 * falloff * navalBonus);
    incomingDamage.set(candidate.id, (incomingDamage.get(candidate.id) ?? 0) + splashDmg);
    lastAttacker.set(candidate.id, attacker.ownerId);
    candidate.morale = Math.max(0, candidate.morale - 7 * falloff);
  }

  // 2. Direct structural damage to enemy fortifications & structures inside impact zone
  const canChipSingle = attacker.count >= 2 || Math.floor(remainingAfterDec / 10) % 2 === 0;
  for (const b of state.buildings) {
    if (b.isCapital || deadBuildingIds.has(b.id)) continue;
    if (b.stackCount <= 0 && b.underConstructionCount <= 0) continue;
    if (b.ownerId === attacker.ownerId) continue;
    if (getUnitRelation(state, attacker.ownerId, b.ownerId) !== 'WAR') continue;
    if (Math.hypot(b.x + 0.5 - fx, b.y + 0.5 - fy) > ARTILLERY_BLAST_RADIUS) continue;

    if (canChipSingle) {
      if (b.stackCount > 0) {
        b.stackCount--;
      } else if (b.underConstructionCount > 0) {
        b.underConstructionCount--;
      }
      if (b.stackCount <= 0 && b.underConstructionCount <= 0) {
        deadBuildingIds.add(b.id);
      }
      state.stateVersion++;
    }
  }

  // 3. Disrupt enemy offensive frontline orders near impact zone
  for (const order of state.attackOrders) {
    if (order.playerId === attacker.ownerId) continue;
    if (getUnitRelation(state, attacker.ownerId, order.playerId) !== 'WAR') continue;
    const head = getAttackOrderFrontPoint(order);
    if (Math.hypot(head.x - fx, head.y - fy) <= ARTILLERY_BLAST_RADIUS + 5) {
      order.manpowerRemaining = Math.max(0, order.manpowerRemaining - salvoPower * 0.45);
    }
  }
  for (const order of state.frontPushOrders) {
    if (order.playerId === attacker.ownerId) continue;
    if (getUnitRelation(state, attacker.ownerId, order.playerId) !== 'WAR') continue;
    const center = getFrontPushCenterPoint(state, order);
    if (Math.hypot(center.x - fx, center.y - fy) <= ARTILLERY_BLAST_RADIUS + 6) {
      order.manpowerRemaining = Math.max(0, order.manpowerRemaining - salvoPower * 0.4);
    }
  }

  // 4. Garrison & activeManpower percentage casualties + Manpower Suppression inside WAR enemy tiles
  const impactedCellsByOwner = new Map<number, number>();
  const rCeil = Math.ceil(ARTILLERY_BLAST_RADIUS);
  const rSq = ARTILLERY_BLAST_RADIUS * ARTILLERY_BLAST_RADIUS;
  const minX = Math.max(0, Math.floor(fx) - rCeil);
  const maxX = Math.min(state.width - 1, Math.floor(fx) + rCeil);
  const minY = Math.max(0, Math.floor(fy) - rCeil);
  const maxY = Math.min(state.height - 1, Math.floor(fy) + rCeil);
  for (let y = minY; y <= maxY; y++) {
    const dy = y + 0.5 - fy;
    const row = y * state.width;
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - fx;
      if (dx * dx + dy * dy > rSq) continue;
      if (state.terrain[row + x] === TerrainType.WATER) continue;
      const cellOwner = state.owners[row + x];
      if (
        cellOwner >= 0 &&
        cellOwner !== attacker.ownerId &&
        cellOwner !== WILDERNESS_OWNER &&
        getUnitRelation(state, attacker.ownerId, cellOwner) === 'WAR'
      ) {
        impactedCellsByOwner.set(cellOwner, (impactedCellsByOwner.get(cellOwner) ?? 0) + 1);
      }
    }
  }

  let totalManpowerKilled = 0;
  const refArea = Math.max(1, Math.PI * ARTILLERY_BLAST_RADIUS * ARTILLERY_BLAST_RADIUS * 0.55);
  for (const [enemyId, hitCells] of impactedCellsByOwner) {
    const occupier = state.players.get(enemyId);
    if (!occupier || !occupier.alive || occupier.isEliminated) continue;
    const coverageRatio = Math.min(1, hitCells / refArea);
    const suppressionAdd = Math.min(0.22, (0.1 + 0.04 * Math.min(3, countScale)) * coverageRatio);
    applyManpowerSuppression(occupier, 80, suppressionAdd);

    const activeMp = Math.max(0, occupier.manpower - occupier.allocatedManpower);
    if (activeMp <= 0) continue;

    const pctRate = Math.min(
      0.08,
      (0.02 + 0.014 * Math.min(4, countScale)) *
        coverageRatio *
        hpEfficiency *
        supplyMul *
        moraleMul *
        blackoutMul,
    );
    const flatFloor = Math.min(60, salvoPower * 0.45 * coverageRatio);
    const mpLoss = Math.min(activeMp, Math.max(flatFloor, activeMp * pctRate));

    occupier.manpower = Math.max(occupier.allocatedManpower, occupier.manpower - mpLoss);
    syncPlayerActiveManpower(occupier);
    totalManpowerKilled += Math.round(mpLoss);
  }

  state.artilleryExplosions.push({
    id: state.nextFxId++,
    x: fx,
    y: fy,
    radius: ARTILLERY_BLAST_RADIUS,
    ttlTicks: 10,
    maxTtlTicks: 10,
    manpowerKilled: totalManpowerKilled,
  });
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
      applyManpowerSuppression(occupier, 10, 0.03 * TICK_DT);
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
  if (state.phase !== 'PLAYING') {
    return;
  }

  if (state.artilleryExplosions.length > 0) {
    for (const fx of state.artilleryExplosions) {
      fx.ttlTicks--;
    }
    state.artilleryExplosions = state.artilleryExplosions.filter((fx) => fx.ttlTicks > 0);
  }

  if (state.units.length === 0) {
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

  // 1. Unit-vs-unit tactical engagements, manual artillery/cruiser/bomber fire missions, and AA interception
  for (const attacker of state.units) {
    if (attacker.count <= 0 || attacker.hp <= 0) continue;
    const attSpec = UNIT_SPECS[attacker.type];
    const attOwner = state.players.get(attacker.ownerId);

    // Enemy AA_BATTERY flak fire against aircraft and airborne paratroopers flying over defended sectors
    if (isAirUnitType(attacker.type) || attacker.inAirTransit) {
      const ax = Math.max(0, Math.min(state.width - 1, Math.floor(attacker.x)));
      const ay = Math.max(0, Math.min(state.height - 1, Math.floor(attacker.y)));
      let bestAaCoverage = 0;
      let aaOwnerId = -1;
      for (const other of state.players.values()) {
        if (
          other.id === attacker.ownerId ||
          !other.alive ||
          getUnitRelation(state, attacker.ownerId, other.id) !== 'WAR'
        ) {
          continue;
        }
        const cov = getAirDefenseCoverageAt(state.buildings, other.id, ax, ay);
        if (cov > bestAaCoverage) {
          bestAaCoverage = cov;
          aaOwnerId = other.id;
        }
      }
      if (bestAaCoverage > 0) {
        const strikeExposure =
          attacker.fireMissionTicksRemaining > 0 || attacker.inAirTransit ? 1.85 : 1.0;
        const aaDmg = bestAaCoverage * 24 * strikeExposure * TICK_DT;
        incomingDamage.set(attacker.id, (incomingDamage.get(attacker.id) ?? 0) + aaDmg);
        if (aaOwnerId >= 0) {
          lastAttacker.set(attacker.id, aaOwnerId);
        }
        attacker.combatCooldownTicks = 6;
      }
    }

    if (attacker.inAirTransit) {
      continue;
    }

    if (
      supportsFireMission(attacker.type) &&
      attacker.fireMissionTicksRemaining > 0 &&
      attacker.fireMissionX !== null &&
      attacker.fireMissionY !== null
    ) {
      const fx = attacker.fireMissionX;
      const fy = attacker.fireMissionY;
      const distToTarget = Math.hypot(fx - attacker.x, fy - attacker.y);
      const inStrikeProximity =
        attacker.type === 'BOMBER' ? distToTarget <= 18 : distToTarget <= attSpec.attackRange;
      if (attacker.type === 'BOMBER' && !inStrikeProximity) {
        // Bomber is still flying toward strike zone; wait until it enters release radius
      } else if (inStrikeProximity) {
        attacker.fireMissionTicksRemaining--;
        executeArtilleryFireMissionSalvo(
          state,
          attacker,
          attOwner,
          fx,
          fy,
          attacker.fireMissionTicksRemaining,
          incomingDamage,
          lastAttacker,
          deadBuildingIds,
        );
        if (attacker.fireMissionTicksRemaining <= 0) {
          attacker.fireMissionX = null;
          attacker.fireMissionY = null;
          attacker.fireMissionTicksRemaining = 0;
        }
        continue;
      } else {
        attacker.fireMissionX = null;
        attacker.fireMissionY = null;
        attacker.fireMissionTicksRemaining = 0;
      }
    }

    if (attSpec.attack <= 0 || attSpec.attackRange <= 0) {
      continue;
    }

    let bestTarget: Unit | null = null;
    let bestScore = -Infinity;
    for (const candidate of state.units) {
      if (candidate.count <= 0 || candidate.hp <= 0) continue;
      if (candidate.ownerId === attacker.ownerId) continue;
      if (getUnitRelation(state, attacker.ownerId, candidate.ownerId) !== 'WAR') continue;

      if (attacker.type === 'FIGHTER') {
        if (!isAirUnitType(candidate.type) && candidate.type !== 'PARATROOPERS') continue;
      } else if (attacker.type === 'SUBMARINE') {
        if (!isNavalUnitType(candidate.type)) continue;
      } else if (isAirUnitType(candidate.type) || candidate.inAirTransit) {
        // Non-fighters do not dogfight airborne aircraft or paratroopers in flight
        continue;
      }

      const dist = Math.hypot(candidate.x - attacker.x, candidate.y - attacker.y);
      if (dist > attSpec.attackRange) continue;
      if (!isUnitVisibleToPlayer(state, attacker.ownerId, candidate)) continue;

      const targetPriority =
        attacker.type === 'FIGHTER' && candidate.type === 'BOMBER'
          ? 20
          : attacker.type === 'SUBMARINE' && candidate.type === 'TRANSPORT_SHIP'
            ? 15
            : 0;
      const score = targetPriority - dist;
      if (score > bestScore) {
        bestScore = score;
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
    const bestDist = Math.hypot(bestTarget.x - attacker.x, bestTarget.y - attacker.y);

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
    } else if (attacker.type === 'SUBMARINE') {
      dmg *= bestTarget.type === 'TRANSPORT_SHIP' ? 2.0 : 1.65;
    } else if (attacker.type === 'CRUISER') {
      if (bestTarget.type === 'TRANSPORT_SHIP') dmg *= 1.6;
      else if (bestTarget.type === 'SUBMARINE') dmg *= 0.85;
    } else if (attacker.type === 'FIGHTER') {
      dmg *= 1.6;
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
