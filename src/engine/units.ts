import { getAirDefenseCoverageAt, evaluateCellDefense } from './defenses';
import { syncPlayerActiveManpower, updateAllPlayersEconomy } from './economy';
import {
  AttackOrder,
  Building,
  BuildingType,
  DiplomaticRelation,
  FrontPushOrder,
  GameState,
  MAX_UNIT_STACK,
  Point,
  PublicUnitInfo,
  TICK_DT,
  TerrainType,
  Unit,
  UnitSpec,
  UnitStance,
  UnitType,
  WILDERNESS_OWNER,
  getRelationKey,
} from './types';

export const UNIT_MERGE_RADIUS = 14;
export const AUTO_MERGE_RADIUS = 4.2;
export const BORDER_VISION_RADIUS = 16;
export const AIRFIELD_PARADROP_RANGE = 120;
export const PARADROP_COOLDOWN_TICKS = 100;
export const PARADROP_VULNERABILITY_TICKS = 50;
export const REPAIR_BASE_RADIUS = 16;
export const FIELD_REPAIR_RATE_PER_SEC = 0.018;
export const BASE_REPAIR_RATE_PER_SEC = 0.068;
export const UNIT_LOOT_RATIO = 0.25;
export const MAX_UNIT_QUEUE_PER_BUILDING = 20;

/** Authoritative specification catalog for the 4 specialized ground unit types (max 2-3 cost items + MP). */
export const UNIT_SPECS: Readonly<Record<UnitType, UnitSpec>> = {
  INFANTRY: {
    type: 'INFANTRY',
    nameCs: 'Pěší divize',
    shortCode: 'PĚCH',
    descriptionCs:
      'Rychlá a dostupná pěchota z Kasáren. Skvělá pro průzkum (široký dohled), krytí křídel a podporu fronty.',
    producerBuilding: 'BARRACKS',
    cost: { money: 110, buildingMaterial: 35, industry: 0, manpower: 45 },
    productionTicks: 30,
    speedPlains: 4.2,
    speedMountains: 2.8,
    hpPerUnit: 100,
    attack: 16,
    defense: 15,
    attackRange: 8,
    operationRadius: 40,
    visionRadius: 30,
  },
  TANK: {
    type: 'TANK',
    nameCs: 'Obrněný svaz',
    shortCode: 'TANK',
    descriptionCs:
      'Těžký obrněný svaz ze Zbrojovky (ARMORY). Vysoká průbojnost a rychlost na rovinách, zpomalený v horách a u bunkrů.',
    producerBuilding: 'ARMORY',
    cost: { money: 210, buildingMaterial: 45, industry: 95, manpower: 35 },
    productionTicks: 50,
    speedPlains: 5.0,
    speedMountains: 1.5,
    hpPerUnit: 180,
    attack: 34,
    defense: 26,
    attackRange: 9,
    operationRadius: 46,
    visionRadius: 22,
  },
  ARTILLERY: {
    type: 'ARTILLERY',
    nameCs: 'Dělostřelectvo',
    shortCode: 'DĚLO',
    descriptionCs:
      'Palebná podpora ze Zbrojovky (ARMORY). Automaticky i manuálně (F) ostřeluje opevnění, frontu i jednotky na velký dosah.',
    producerBuilding: 'ARMORY',
    cost: { money: 190, buildingMaterial: 55, industry: 85, manpower: 30 },
    productionTicks: 45,
    speedPlains: 2.6,
    speedMountains: 1.1,
    hpPerUnit: 95,
    attack: 32,
    defense: 9,
    attackRange: 34,
    operationRadius: 54,
    visionRadius: 20,
  },
  PARATROOPERS: {
    type: 'PARATROOPERS',
    nameCs: 'Výsadkáři',
    shortCode: 'VÝS',
    descriptionCs:
      'Vzdušný výsadek z Letiště do týlu nepřítele (s cooldownem letiště, zranitelný při dopadu a proti PVO).',
    producerBuilding: 'AIRFIELD',
    cost: { money: 230, buildingMaterial: 0, industry: 70, manpower: 55 },
    productionTicks: 35,
    speedPlains: 3.6,
    speedMountains: 2.6,
    hpPerUnit: 90,
    attack: 20,
    defense: 12,
    attackRange: 8,
    operationRadius: 36,
    visionRadius: 26,
  },
};

export function getUnitRelation(
  state: GameState,
  a: number,
  b: number,
): DiplomaticRelation {
  if (a === b || a < 0 || b < 0) {
    return 'NEUTRAL';
  }
  return state.relations.get(getRelationKey(a, b)) ?? 'NEUTRAL';
}

export function canBuildingProduceUnit(
  buildingType: BuildingType,
  unitType: UnitType,
): boolean {
  return UNIT_SPECS[unitType].producerBuilding === buildingType;
}

export function getProducibleUnitsForBuilding(buildingType: BuildingType): UnitType[] {
  const result: UnitType[] = [];
  for (const unitType of ['INFANTRY', 'TANK', 'ARTILLERY', 'PARATROOPERS'] as const) {
    if (UNIT_SPECS[unitType].producerBuilding === buildingType) {
      result.push(unitType);
    }
  }
  return result;
}

/** Samples the active frontier point along an AttackOrder polyline using frontierArc. */
export function getAttackOrderFrontPoint(order: AttackOrder): Point {
  if (order.waypoints.length === 0) {
    return { x: order.origin.x, y: order.origin.y };
  }
  if (order.waypoints.length === 1) {
    return { x: order.waypoints[0].x, y: order.waypoints[0].y };
  }

  let remaining = Math.max(0, order.frontierArc);
  for (let i = 0; i < order.waypoints.length - 1; i++) {
    const a = order.waypoints[i];
    const b = order.waypoints[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= segLen || i === order.waypoints.length - 2) {
      const t = segLen > 1e-5 ? Math.max(0, Math.min(1, remaining / segLen)) : 0;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
    }
    remaining -= segLen;
  }

  const last = order.waypoints[order.waypoints.length - 1];
  return { x: last.x, y: last.y };
}

/** Computes the active frontier anchor for a FrontPushOrder. */
export function getFrontPushCenterPoint(state: GameState, order: FrontPushOrder): Point {
  if (order.focalPoint) {
    return { x: order.focalPoint.x, y: order.focalPoint.y };
  }
  if (order.frontierCells.length === 0) {
    return { x: order.originCenter.x, y: order.originCenter.y };
  }
  let sumX = 0;
  let sumY = 0;
  const sampleStep = Math.max(1, Math.floor(order.frontierCells.length / 24));
  let sampled = 0;
  for (let i = 0; i < order.frontierCells.length; i += sampleStep) {
    const idx = order.frontierCells[i];
    const cx = idx % state.width;
    const cy = (idx - cx) / state.width;
    sumX += cx + 0.5;
    sumY += cy + 0.5;
    sampled++;
  }
  return sampled > 0
    ? { x: sumX / sampled, y: sumY / sampled }
    : { x: order.originCenter.x, y: order.originCenter.y };
}

export interface SpawnUnitOptions {
  readonly stance?: UnitStance;
  readonly canParadrop?: boolean;
  readonly dropVulnerabilityTicks?: number;
}

export function spawnUnitStack(
  state: GameState,
  ownerId: number,
  type: UnitType,
  x: number,
  y: number,
  count = 1,
  opts?: SpawnUnitOptions,
): Unit {
  const spec = UNIT_SPECS[type];
  const clampedCount = Math.max(1, Math.min(MAX_UNIT_STACK, Math.round(count)));
  const maxHp = clampedCount * spec.hpPerUnit;
  const unit: Unit = {
    id: state.nextUnitId++,
    ownerId,
    type,
    x: Math.max(0.5, Math.min(state.width - 0.5, x)),
    y: Math.max(0.5, Math.min(state.height - 0.5, y)),
    count: clampedCount,
    hp: maxHp,
    maxHp,
    morale: 100,
    stance: opts?.stance ?? 'RANGE',
    operationRadius: spec.operationRadius,
    targetX: null,
    targetY: null,
    waypoints: [],
    fireMissionX: null,
    fireMissionY: null,
    fireMissionTicksRemaining: 0,
    attachedOrderId: null,
    attachedOrderKind: null,
    manualOrder: false,
    mergeTargetUnitId: null,
    isEncircled: false,
    supplyLevel: 1,
    canParadrop: opts?.canParadrop ?? type === 'PARATROOPERS',
    dropVulnerabilityTicks: opts?.dropVulnerabilityTicks ?? 0,
    combatCooldownTicks: 0,
    lastCombatTargetX: null,
    lastCombatTargetY: null,
    breakoutAccum: 0,
  };
  state.units.push(unit);
  state.stateVersion++;
  return unit;
}

export function queueUnitProduction(
  state: GameState,
  playerId: number,
  buildingId: number,
  unitType: UnitType,
  requestedCount = 1,
): number {
  if (state.phase !== 'PLAYING') {
    return 0;
  }
  const player = state.players.get(playerId);
  const building = state.buildings.find(
    (b) => b.id === buildingId && b.ownerId === playerId,
  );
  if (!player || !player.alive || player.isEliminated || !building || building.stackCount <= 0) {
    return 0;
  }
  if (!canBuildingProduceUnit(building.type, unitType)) {
    return 0;
  }

  const spec = UNIT_SPECS[unitType];
  const desired = Math.max(1, Math.min(10, Math.floor(requestedCount)));
  const ticksPerUnit = Math.max(
    10,
    Math.round(spec.productionTicks / (1 + 0.35 * Math.log2(building.stackCount))),
  );

  let queued = 0;
  for (let i = 0; i < desired; i++) {
    if (building.unitQueue.length >= MAX_UNIT_QUEUE_PER_BUILDING) {
      break;
    }
    const activeMp = Math.max(0, player.manpower - player.allocatedManpower);
    if (
      player.money < spec.cost.money ||
      player.buildingMaterial < spec.cost.buildingMaterial ||
      player.industry < spec.cost.industry ||
      activeMp < spec.cost.manpower
    ) {
      break;
    }

    player.money -= spec.cost.money;
    player.buildingMaterial -= spec.cost.buildingMaterial;
    player.industry -= spec.cost.industry;
    player.manpower -= spec.cost.manpower;
    syncPlayerActiveManpower(player);

    building.unitQueue.push({
      unitType,
      ticksRemaining: ticksPerUnit,
      ticksTotal: ticksPerUnit,
    });
    queued++;
  }

  if (queued > 0) {
    updateAllPlayersEconomy(state, false);
    state.stateVersion++;
  }
  return queued;
}

export function quickQueueUnitProduction(
  state: GameState,
  playerId: number,
  unitType: UnitType,
  requestedCount = 1,
): number {
  const spec = UNIT_SPECS[unitType];
  let bestBuilding: Building | null = null;
  for (const b of state.buildings) {
    if (
      b.ownerId !== playerId ||
      b.type !== spec.producerBuilding ||
      b.stackCount <= 0 ||
      b.unitQueue.length >= MAX_UNIT_QUEUE_PER_BUILDING
    ) {
      continue;
    }
    if (!bestBuilding || b.unitQueue.length < bestBuilding.unitQueue.length) {
      bestBuilding = b;
    }
  }
  if (!bestBuilding) {
    return 0;
  }
  return queueUnitProduction(state, playerId, bestBuilding.id, unitType, requestedCount);
}

function combineUnitsIntoAnchor(anchor: Unit, donor: Unit): boolean {
  if (
    anchor.id === donor.id ||
    anchor.ownerId !== donor.ownerId ||
    anchor.type !== donor.type ||
    anchor.count <= 0 ||
    donor.count <= 0
  ) {
    return false;
  }
  const spec = UNIT_SPECS[anchor.type];
  const combinedCount = anchor.count + donor.count;
  if (combinedCount > MAX_UNIT_STACK) {
    return false;
  }

  const totalCount = combinedCount;
  anchor.morale = Math.max(
    0,
    Math.min(100, (anchor.morale * anchor.count + donor.morale * donor.count) / totalCount),
  );
  anchor.supplyLevel = Math.max(
    0,
    Math.min(1, (anchor.supplyLevel * anchor.count + donor.supplyLevel * donor.count) / totalCount),
  );
  anchor.count = totalCount;
  anchor.maxHp = totalCount * spec.hpPerUnit;
  anchor.hp = Math.min(anchor.maxHp, anchor.hp + donor.hp);
  anchor.canParadrop = anchor.canParadrop && donor.canParadrop;
  anchor.dropVulnerabilityTicks = Math.max(
    anchor.dropVulnerabilityTicks,
    donor.dropVulnerabilityTicks,
  );
  anchor.isEncircled = anchor.isEncircled || donor.isEncircled;
  donor.count = 0;
  donor.hp = 0;
  return true;
}

export function mergeUnitStacks(
  state: GameState,
  playerId: number,
  unitIds: ReadonlyArray<number>,
): number {
  if (state.phase !== 'PLAYING' || unitIds.length < 2) {
    return 0;
  }
  const idSet = new Set(unitIds);
  const byType = new Map<UnitType, Unit[]>();

  for (const unit of state.units) {
    if (unit.ownerId === playerId && unit.count > 0 && idSet.has(unit.id)) {
      let group = byType.get(unit.type);
      if (!group) {
        group = [];
        byType.set(unit.type, group);
      }
      group.push(unit);
    }
  }

  let mergedCount = 0;
  for (const group of byType.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => b.count - a.count || a.id - b.id);
    const anchor = group[0];

    for (let i = 1; i < group.length; i++) {
      const donor = group[i];
      if (anchor.count + donor.count > MAX_UNIT_STACK) {
        continue;
      }
      const dist = Math.hypot(donor.x - anchor.x, donor.y - anchor.y);
      if (dist <= UNIT_MERGE_RADIUS) {
        if (combineUnitsIntoAnchor(anchor, donor)) {
          mergedCount++;
        }
      } else {
        donor.mergeTargetUnitId = anchor.id;
        donor.targetX = anchor.x;
        donor.targetY = anchor.y;
        donor.manualOrder = true;
        donor.attachedOrderId = null;
        donor.attachedOrderKind = null;
      }
    }
  }

  if (mergedCount > 0) {
    state.units = state.units.filter((u) => u.count > 0 && u.hp > 0);
    state.stateVersion++;
  }
  return mergedCount;
}

export function autoMergeNearbyUnits(state: GameState): boolean {
  let anyMerged = false;
  for (let i = 0; i < state.units.length; i++) {
    const a = state.units[i];
    if (a.count <= 0 || a.hp <= 0) continue;

    for (let j = i + 1; j < state.units.length; j++) {
      const b = state.units[j];
      if (b.count <= 0 || b.hp <= 0) continue;
      if (a.ownerId !== b.ownerId || a.type !== b.type) continue;
      if (a.count + b.count > MAX_UNIT_STACK) continue;

      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > AUTO_MERGE_RADIUS) continue;

      const explicitConverge = b.mergeTargetUnitId === a.id || a.mergeTargetUnitId === b.id;
      const bothIdle =
        a.targetX === null &&
        b.targetX === null &&
        a.attachedOrderId === null &&
        b.attachedOrderId === null;
      const sameAttached =
        a.attachedOrderId !== null && a.attachedOrderId === b.attachedOrderId;
      const sameTarget =
        a.targetX !== null &&
        a.targetY !== null &&
        b.targetX !== null &&
        b.targetY !== null &&
        Math.hypot(a.targetX - b.targetX, a.targetY - b.targetY) <= 5;

      if (explicitConverge || bothIdle || sameAttached || sameTarget) {
        const anchor = b.mergeTargetUnitId === a.id || a.count >= b.count ? a : b;
        const donor = anchor === a ? b : a;
        if (combineUnitsIntoAnchor(anchor, donor)) {
          anyMerged = true;
          if (anchor === b) break;
        }
      }
    }
  }

  if (anyMerged) {
    state.units = state.units.filter((u) => u.count > 0 && u.hp > 0);
    state.stateVersion++;
  }
  return anyMerged;
}

export function stepUnitProduction(state: GameState): void {
  if (state.phase !== 'PLAYING') {
    return;
  }

  let anySpawned = false;
  for (const building of state.buildings) {
    if (building.paradropCooldownTicks > 0) {
      building.paradropCooldownTicks--;
    }

    if (building.stackCount <= 0 || building.unitQueue.length === 0) {
      continue;
    }

    const owner = state.players.get(building.ownerId);
    if (!owner || !owner.alive || owner.isEliminated) {
      building.unitQueue = [];
      continue;
    }

    const job = building.unitQueue[0];
    const progressRate = Math.max(0.25, building.effectiveOutputPct / 100);
    job.ticksRemaining -= progressRate;

    if (job.ticksRemaining <= 0) {
      building.unitQueue.shift();
      spawnUnitStack(
        state,
        building.ownerId,
        job.unitType,
        building.x + 0.5,
        building.y + 0.5,
        1,
      );
      anySpawned = true;
    }
  }

  if (anySpawned) {
    autoMergeNearbyUnits(state);
    state.stateVersion++;
  }
}

export const NAV_CELL_STEP = 4;
export const ARTILLERY_FIRE_MISSION_TICKS = 60;

function pushHumanNotice(state: GameState, playerId: number, messageCs: string): void {
  if (playerId !== state.humanPlayerId) {
    return;
  }
  state.lastNotice = {
    id: state.nextNoticeId++,
    messageCs,
    tick: state.tick,
  };
  state.stateVersion++;
}

function isPassableUnitCell(
  state: GameState,
  playerId: number,
  ix: number,
  iy: number,
  waterOnly = false,
): boolean {
  if (ix < 0 || ix >= state.width || iy < 0 || iy >= state.height) {
    return false;
  }
  const idx = iy * state.width + ix;
  if (state.terrain[idx] === TerrainType.WATER) {
    return false;
  }
  if (!waterOnly) {
    const cellOwner = state.owners[idx];
    if (
      cellOwner >= 0 &&
      cellOwner !== playerId &&
      getUnitRelation(state, playerId, cellOwner) === 'NEUTRAL'
    ) {
      return false;
    }
  }
  return true;
}

function hasDirectPassableLine(
  state: GameState,
  playerId: number,
  a: Point,
  b: Point,
  waterOnly = false,
): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / 0.55));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = Math.floor(a.x + (b.x - a.x) * t);
    const py = Math.floor(a.y + (b.y - a.y) * t);
    if (!isPassableUnitCell(state, playerId, px, py, waterOnly)) {
      return false;
    }
  }
  return true;
}

function findCoarseBlockAnchor(
  state: GameState,
  playerId: number,
  gx: number,
  gy: number,
  waterOnly: boolean,
): Point | null {
  const x0 = gx * NAV_CELL_STEP;
  const y0 = gy * NAV_CELL_STEP;
  const cx = x0 + NAV_CELL_STEP * 0.5;
  const cy = y0 + NAV_CELL_STEP * 0.5;
  let best: Point | null = null;
  let bestDistSq = Infinity;

  for (let dy = 0; dy < NAV_CELL_STEP; dy++) {
    const y = y0 + dy;
    if (y >= state.height) continue;
    for (let dx = 0; dx < NAV_CELL_STEP; dx++) {
      const x = x0 + dx;
      if (x >= state.width) continue;
      if (!isPassableUnitCell(state, playerId, x, y, waterOnly)) continue;
      const dSq = (x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  return best;
}

interface HeapNode {
  readonly idx: number;
  readonly f: number;
}

/**
 * Coarse-grid (4x4 cell) A* land pathfinder with line-of-sight edge checks and greedy
 * string-pulling waypoint smoothing. Never crosses water or unapproved neutral states.
 */
export function findLandPath(
  state: GameState,
  playerId: number,
  unitType: UnitType,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  waterOnly = false,
): Point[] | null {
  const startPt: Point = {
    x: Math.max(0.5, Math.min(state.width - 0.5, startX)),
    y: Math.max(0.5, Math.min(state.height - 0.5, startY)),
  };
  const goalPt: Point = {
    x: Math.max(0.5, Math.min(state.width - 0.5, goalX)),
    y: Math.max(0.5, Math.min(state.height - 0.5, goalY)),
  };

  if (
    !isPassableUnitCell(state, playerId, Math.floor(goalPt.x), Math.floor(goalPt.y), waterOnly)
  ) {
    return null;
  }

  if (hasDirectPassableLine(state, playerId, startPt, goalPt, waterOnly)) {
    return [goalPt];
  }

  const gw = Math.ceil(state.width / NAV_CELL_STEP);
  const gh = Math.ceil(state.height / NAV_CELL_STEP);
  const total = gw * gh;

  const startGx = Math.max(0, Math.min(gw - 1, Math.floor(startPt.x / NAV_CELL_STEP)));
  const startGy = Math.max(0, Math.min(gh - 1, Math.floor(startPt.y / NAV_CELL_STEP)));
  const goalGx = Math.max(0, Math.min(gw - 1, Math.floor(goalPt.x / NAV_CELL_STEP)));
  const goalGy = Math.max(0, Math.min(gh - 1, Math.floor(goalPt.y / NAV_CELL_STEP)));

  const startNode = startGy * gw + startGx;
  const goalNode = goalGy * gw + goalGx;

  const anchorCache = new Map<number, Point | null>();
  anchorCache.set(startNode, startPt);
  anchorCache.set(goalNode, goalPt);

  const getAnchor = (nIdx: number): Point | null => {
    const cached = anchorCache.get(nIdx);
    if (cached !== undefined) return cached;
    const gx = nIdx % gw;
    const gy = (nIdx - gx) / gw;
    const found = findCoarseBlockAnchor(state, playerId, gx, gy, waterOnly);
    anchorCache.set(nIdx, found);
    return found;
  };

  const gScore = new Float32Array(total);
  gScore.fill(Infinity);
  const cameFrom = new Int32Array(total);
  cameFrom.fill(-1);
  const closed = new Uint8Array(total);

  const heap: HeapNode[] = [];
  const heapPush = (node: HeapNode): void => {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].f <= heap[i].f) break;
      const tmp = heap[parent];
      heap[parent] = heap[i];
      heap[i] = tmp;
      i = parent;
    }
  };
  const heapPop = (): HeapNode => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      const len = heap.length;
      while (true) {
        let best = i;
        const left = i * 2 + 1;
        const right = left + 1;
        if (left < len && heap[left].f < heap[best].f) best = left;
        if (right < len && heap[right].f < heap[best].f) best = right;
        if (best === i) break;
        const tmp = heap[i];
        heap[i] = heap[best];
        heap[best] = tmp;
        i = best;
      }
    }
    return top;
  };

  gScore[startNode] = 0;
  heapPush({
    idx: startNode,
    f: Math.hypot(goalPt.x - startPt.x, goalPt.y - startPt.y),
  });

  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  let foundGoal = false;
  while (heap.length > 0) {
    const curr = heapPop();
    const u = curr.idx;
    if (closed[u]) continue;
    closed[u] = 1;

    if (u === goalNode) {
      foundGoal = true;
      break;
    }

    const ux = u % gw;
    const uy = (u - ux) / gw;
    const uAnchor = getAnchor(u);
    if (!uAnchor) continue;

    for (const [dx, dy] of dirs) {
      const vx = ux + dx;
      const vy = uy + dy;
      if (vx < 0 || vx >= gw || vy < 0 || vy >= gh) continue;
      const v = vy * gw + vx;
      if (closed[v]) continue;

      if (dx !== 0 && dy !== 0) {
        const adj1 = uy * gw + vx;
        const adj2 = vy * gw + ux;
        if (!getAnchor(adj1) || !getAnchor(adj2)) {
          continue;
        }
      }

      const vAnchor = getAnchor(v);
      if (!vAnchor) continue;
      if (!hasDirectPassableLine(state, playerId, uAnchor, vAnchor, waterOnly)) {
        continue;
      }

      const vIx = Math.floor(vAnchor.x);
      const vIy = Math.floor(vAnchor.y);
      const vCellIdx = vIy * state.width + vIx;
      let weight = state.terrain[vCellIdx] === TerrainType.MOUNTAINS
        ? unitType === 'TANK'
          ? 2.2
          : 1.5
        : 1.0;
      const vOwner = state.owners[vCellIdx];
      if (!waterOnly && vOwner >= 0 && vOwner !== playerId) {
        weight *= 1.35;
      }

      const stepCost = Math.hypot(vAnchor.x - uAnchor.x, vAnchor.y - uAnchor.y) * weight;
      const tentativeG = gScore[u] + stepCost;
      if (tentativeG < gScore[v]) {
        cameFrom[v] = u;
        gScore[v] = tentativeG;
        const h = Math.hypot(goalPt.x - vAnchor.x, goalPt.y - vAnchor.y);
        heapPush({ idx: v, f: tentativeG + h });
      }
    }
  }

  if (!foundGoal) {
    return null;
  }

  const rawPts: Point[] = [];
  let trace = goalNode;
  while (trace !== -1) {
    const pt = getAnchor(trace);
    if (pt) rawPts.push(pt);
    if (trace === startNode) break;
    trace = cameFrom[trace];
  }
  rawPts.reverse();
  if (rawPts.length === 0) {
    return null;
  }
  rawPts[0] = startPt;
  rawPts[rawPts.length - 1] = goalPt;

  // Greedy string-pulling smoothing along strict land-passable chords
  const smoothed: Point[] = [];
  let i = 0;
  while (i < rawPts.length - 1) {
    let nextIdx = i + 1;
    for (let j = rawPts.length - 1; j > i + 1; j--) {
      if (hasDirectPassableLine(state, playerId, rawPts[i], rawPts[j], waterOnly)) {
        nextIdx = j;
        break;
      }
    }
    smoothed.push(rawPts[nextIdx]);
    i = nextIdx;
  }

  return smoothed.length > 0 ? smoothed : [goalPt];
}

export function issueUnitMoveOrder(
  state: GameState,
  playerId: number,
  unitIds: ReadonlyArray<number>,
  targetX: number,
  targetY: number,
): number {
  if (state.phase !== 'PLAYING') {
    return 0;
  }
  const clampedX = Math.max(0.5, Math.min(state.width - 0.5, targetX));
  const clampedY = Math.max(0.5, Math.min(state.height - 0.5, targetY));
  const ix = Math.floor(clampedX);
  const iy = Math.floor(clampedY);
  if (state.terrain[iy * state.width + ix] === TerrainType.WATER) {
    pushHumanNotice(
      state,
      playerId,
      'Na vodní plochu nelze poslat pozemní jednotku — přes vodu je potřeba přístav/loď.',
    );
    return 0;
  }

  const targetOwner = state.owners[iy * state.width + ix];
  if (
    targetOwner >= 0 &&
    targetOwner !== playerId &&
    getUnitRelation(state, playerId, targetOwner) === 'NEUTRAL'
  ) {
    pushHumanNotice(
      state,
      playerId,
      'Cíl leží v neutrálním státě (nejdřív vyhlaste válku).',
    );
    return 0;
  }

  const idSet = new Set(unitIds);
  let updated = 0;
  let firstFailedUnit: Unit | null = null;
  for (const unit of state.units) {
    if (unit.ownerId !== playerId || unit.count <= 0 || !idSet.has(unit.id)) continue;
    const path = findLandPath(
      state,
      playerId,
      unit.type,
      unit.x,
      unit.y,
      clampedX,
      clampedY,
      false,
    );
    if (!path || path.length === 0) {
      if (!firstFailedUnit) firstFailedUnit = unit;
      continue;
    }

    unit.waypoints = path;
    unit.targetX = clampedX;
    unit.targetY = clampedY;
    unit.manualOrder = true;
    unit.attachedOrderId = null;
    unit.attachedOrderKind = null;
    unit.mergeTargetUnitId = null;
    unit.fireMissionX = null;
    unit.fireMissionY = null;
    unit.fireMissionTicksRemaining = 0;
    updated++;
  }

  if (updated === 0 && firstFailedUnit) {
    const waterConnected =
      findLandPath(
        state,
        playerId,
        firstFailedUnit.type,
        firstFailedUnit.x,
        firstFailedUnit.y,
        clampedX,
        clampedY,
        true,
      ) !== null;
    pushHumanNotice(
      state,
      playerId,
      waterConnected
        ? 'Soušová cesta je zablokována neutrálním státem.'
        : 'Přes vodu nelze projít pěšky — k přesunu na ostrov je potřeba přístav/loď.',
    );
    return 0;
  }

  if (updated > 0) {
    state.stateVersion++;
  }
  return updated;
}

export function issueArtilleryFireMission(
  state: GameState,
  playerId: number,
  unitIds: ReadonlyArray<number>,
  targetX: number,
  targetY: number,
): number {
  if (state.phase !== 'PLAYING') {
    return 0;
  }
  const clampedX = Math.max(0.5, Math.min(state.width - 0.5, targetX));
  const clampedY = Math.max(0.5, Math.min(state.height - 0.5, targetY));
  const ix = Math.floor(clampedX);
  const iy = Math.floor(clampedY);
  const cellOwner = state.owners[iy * state.width + ix];
  if (
    cellOwner >= 0 &&
    cellOwner !== playerId &&
    getUnitRelation(state, playerId, cellOwner) !== 'WAR'
  ) {
    pushHumanNotice(
      state,
      playerId,
      'Nelze ostřelovat neutrální nebo spojenecké území (nejdřív vyhlaste válku).',
    );
    return 0;
  }

  const idSet = new Set(unitIds);
  const maxRange = UNIT_SPECS.ARTILLERY.attackRange;
  let updated = 0;

  for (const unit of state.units) {
    if (
      unit.ownerId !== playerId ||
      unit.type !== 'ARTILLERY' ||
      unit.count <= 0 ||
      !idSet.has(unit.id)
    ) {
      continue;
    }
    if (Math.hypot(clampedX - unit.x, clampedY - unit.y) > maxRange) {
      continue;
    }

    unit.fireMissionX = clampedX;
    unit.fireMissionY = clampedY;
    unit.fireMissionTicksRemaining = ARTILLERY_FIRE_MISSION_TICKS;
    unit.targetX = null;
    unit.targetY = null;
    unit.waypoints = [];
    unit.manualOrder = false;
    unit.attachedOrderId = null;
    unit.attachedOrderKind = null;
    unit.mergeTargetUnitId = null;
    updated++;
  }

  if (updated === 0) {
    pushHumanNotice(state, playerId, 'Cíl je mimo dostřel vybraného dělostřelectva.');
    return 0;
  }

  state.stateVersion++;
  return updated;
}

export function cancelArtilleryFireMission(
  state: GameState,
  playerId: number,
  unitIds: ReadonlyArray<number>,
): number {
  const idSet = new Set(unitIds);
  let cleared = 0;
  for (const unit of state.units) {
    if (unit.ownerId !== playerId || !idSet.has(unit.id)) continue;
    if (unit.fireMissionTicksRemaining > 0 || unit.fireMissionX !== null) {
      unit.fireMissionX = null;
      unit.fireMissionY = null;
      unit.fireMissionTicksRemaining = 0;
      cleared++;
    }
  }
  if (cleared > 0) {
    state.stateVersion++;
  }
  return cleared;
}

export function setUnitsStance(
  state: GameState,
  playerId: number,
  unitIds: ReadonlyArray<number>,
  stance: UnitStance,
): number {
  const idSet = new Set(unitIds);
  let updated = 0;
  for (const unit of state.units) {
    if (unit.ownerId === playerId && unit.count > 0 && idSet.has(unit.id)) {
      unit.stance = stance;
      if (stance === 'LOCK') {
        unit.attachedOrderId = null;
        unit.attachedOrderKind = null;
        unit.targetX = null;
        unit.targetY = null;
        unit.waypoints = [];
        unit.manualOrder = false;
        unit.mergeTargetUnitId = null;
      }
      updated++;
    }
  }
  if (updated > 0) {
    state.stateVersion++;
  }
  return updated;
}

export function findReadyAirfieldForParadrop(
  state: GameState,
  playerId: number,
  targetX: number,
  targetY: number,
): Building | null {
  let best: Building | null = null;
  let bestDist = Infinity;
  for (const b of state.buildings) {
    if (
      b.ownerId !== playerId ||
      b.type !== 'AIRFIELD' ||
      b.stackCount <= 0 ||
      b.paradropCooldownTicks > 0
    ) {
      continue;
    }
    const dist = Math.hypot(b.x + 0.5 - targetX, b.y + 0.5 - targetY);
    if (dist <= AIRFIELD_PARADROP_RANGE && dist < bestDist) {
      bestDist = dist;
      best = b;
    }
  }
  return best;
}

export function executeParadrop(
  state: GameState,
  playerId: number,
  unitId: number,
  targetX: number,
  targetY: number,
): boolean {
  if (state.phase !== 'PLAYING') {
    return false;
  }
  const unit = state.units.find((u) => u.id === unitId && u.ownerId === playerId);
  if (!unit || unit.type !== 'PARATROOPERS' || !unit.canParadrop || unit.count <= 0) {
    return false;
  }

  const ix = Math.max(0, Math.min(state.width - 1, Math.floor(targetX)));
  const iy = Math.max(0, Math.min(state.height - 1, Math.floor(targetY)));
  const targetIdx = iy * state.width + ix;
  if (state.terrain[targetIdx] === TerrainType.WATER) {
    return false;
  }

  const cellOwner = state.owners[targetIdx];
  if (
    cellOwner >= 0 &&
    cellOwner !== playerId &&
    getUnitRelation(state, playerId, cellOwner) === 'NEUTRAL'
  ) {
    return false;
  }

  const airfield = findReadyAirfieldForParadrop(state, playerId, ix + 0.5, iy + 0.5);
  if (!airfield) {
    return false;
  }

  airfield.paradropCooldownTicks = Math.max(
    50,
    Math.round(PARADROP_COOLDOWN_TICKS / (1 + 0.25 * Math.log2(airfield.stackCount))),
  );

  unit.x = ix + 0.5;
  unit.y = iy + 0.5;
  unit.canParadrop = false;
  unit.dropVulnerabilityTicks = PARADROP_VULNERABILITY_TICKS;
  unit.targetX = null;
  unit.targetY = null;
  unit.manualOrder = false;
  unit.attachedOrderId = null;
  unit.attachedOrderKind = null;
  unit.mergeTargetUnitId = null;

  // Check enemy AA_BATTERY interception at landing zone
  let bestAaCoverage = 0;
  let aaOwnerId = -1;
  for (const other of state.players.values()) {
    if (
      other.id === playerId ||
      !other.alive ||
      getUnitRelation(state, playerId, other.id) !== 'WAR'
    ) {
      continue;
    }
    const cov = getAirDefenseCoverageAt(state.buildings, other.id, ix, iy);
    if (cov > bestAaCoverage) {
      bestAaCoverage = cov;
      aaOwnerId = other.id;
    }
  }

  if (bestAaCoverage > 0) {
    const spec = UNIT_SPECS.PARATROOPERS;
    const damageRatio = Math.min(0.85, bestAaCoverage * 0.45);
    const dmg = unit.maxHp * damageRatio;
    const prevCount = unit.count;
    unit.hp = Math.max(0, unit.hp - dmg);
    unit.morale = Math.max(25, unit.morale - Math.round(damageRatio * 45));
    const newCount =
      unit.hp <= 0 ? 0 : Math.min(unit.count, Math.max(1, Math.ceil(unit.hp / spec.hpPerUnit)));

    if (newCount < prevCount && aaOwnerId >= 0) {
      const aaOwner = state.players.get(aaOwnerId);
      if (aaOwner && aaOwner.alive) {
        const lost = prevCount - newCount;
        aaOwner.money += Math.round(spec.cost.money * UNIT_LOOT_RATIO * lost);
        aaOwner.industry += Math.round(spec.cost.industry * UNIT_LOOT_RATIO * lost);
      }
    }

    if (newCount <= 0 || unit.hp <= 0) {
      unit.count = 0;
      unit.hp = 0;
      state.units = state.units.filter((u) => u.count > 0 && u.hp > 0);
      state.stateVersion++;
      return true;
    }

    unit.count = newCount;
    unit.maxHp = newCount * spec.hpPerUnit;
    unit.hp = Math.min(unit.hp, unit.maxHp);
  }

  // Claim a small landing perimeter if dropped on unclaimed wilderness
  if (state.owners[targetIdx] === WILDERNESS_OWNER) {
    for (let dy = -2; dy <= 2; dy++) {
      const ny = iy + dy;
      if (ny < 0 || ny >= state.height) continue;
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 5) continue;
        const nx = ix + dx;
        if (nx < 0 || nx >= state.width) continue;
        const nIdx = ny * state.width + nx;
        if (state.terrain[nIdx] !== TerrainType.WATER && state.owners[nIdx] === WILDERNESS_OWNER) {
          state.owners[nIdx] = playerId;
        }
      }
    }
    unit.isEncircled = false;
  } else {
    unit.isEncircled =
      cellOwner >= 0 &&
      cellOwner !== playerId &&
      getUnitRelation(state, playerId, cellOwner) !== 'ALLIED';
  }

  state.stateVersion++;
  return true;
}

function getFrontPushPointForUnit(
  state: GameState,
  order: FrontPushOrder,
  unit: Unit,
): Point | null {
  if (order.focalPoint) {
    return { x: order.focalPoint.x, y: order.focalPoint.y };
  }
  if (order.sweepAllBorders && order.frontierCells.length > 0) {
    let bestPt: Point | null = null;
    let bestDistSq = Infinity;
    const sampleStep = Math.max(1, Math.floor(order.frontierCells.length / 48));
    for (let i = 0; i < order.frontierCells.length; i += sampleStep) {
      const idx = order.frontierCells[i];
      const cx = (idx % state.width) + 0.5;
      const cy = (idx - (idx % state.width)) / state.width + 0.5;
      const dx = cx - unit.x;
      const dy = cy - unit.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestPt = { x: cx, y: cy };
      }
    }
    if (bestPt) {
      return bestPt;
    }
  }
  return getFrontPushCenterPoint(state, order);
}

function findOrderFrontForAttachment(
  state: GameState,
  unit: Unit,
): { readonly orderId: number; readonly kind: 'ATTACK' | 'FRONT_PUSH'; readonly frontPt: Point } | null {
  let bestDist = unit.operationRadius;
  let best: {
    readonly orderId: number;
    readonly kind: 'ATTACK' | 'FRONT_PUSH';
    readonly frontPt: Point;
  } | null = null;

  for (const order of state.attackOrders) {
    if (order.playerId !== unit.ownerId) continue;
    const frontPt = getAttackOrderFrontPoint(order);
    const dist = Math.hypot(frontPt.x - unit.x, frontPt.y - unit.y);
    if (dist <= bestDist) {
      bestDist = dist;
      best = { orderId: order.id, kind: 'ATTACK', frontPt };
    }
  }

  for (const order of state.frontPushOrders) {
    if (order.playerId !== unit.ownerId) continue;
    const frontPt = getFrontPushPointForUnit(state, order, unit);
    if (!frontPt) continue;
    const dist = Math.hypot(frontPt.x - unit.x, frontPt.y - unit.y);
    if (dist <= bestDist) {
      bestDist = dist;
      best = { orderId: order.id, kind: 'FRONT_PUSH', frontPt };
    }
  }

  return best;
}

function getAttachedOrderFrontPoint(state: GameState, unit: Unit): Point | null {
  if (unit.attachedOrderId === null) {
    return null;
  }
  if (unit.attachedOrderKind === 'ATTACK') {
    const order = state.attackOrders.find(
      (o) => o.id === unit.attachedOrderId && o.playerId === unit.ownerId,
    );
    return order ? getAttackOrderFrontPoint(order) : null;
  }
  if (unit.attachedOrderKind === 'FRONT_PUSH') {
    const order = state.frontPushOrders.find(
      (o) => o.id === unit.attachedOrderId && o.playerId === unit.ownerId,
    );
    return order ? getFrontPushPointForUnit(state, order, unit) : null;
  }
  return null;
}

function isUnitNearRepairBase(state: GameState, unit: Unit): boolean {
  for (const b of state.buildings) {
    if (b.ownerId !== unit.ownerId || b.stackCount <= 0) continue;
    if (b.type !== 'CITY' && b.type !== 'BARRACKS' && b.type !== 'ARMORY') continue;
    if (Math.hypot(b.x + 0.5 - unit.x, b.y + 0.5 - unit.y) <= REPAIR_BASE_RADIUS) {
      return true;
    }
  }
  return false;
}

function findEnemyUnitInOperationRadius(state: GameState, unit: Unit): Unit | null {
  let best: Unit | null = null;
  let bestDist = unit.operationRadius;
  for (const candidate of state.units) {
    if (candidate.count <= 0 || candidate.hp <= 0) continue;
    if (candidate.ownerId === unit.ownerId) continue;
    if (getUnitRelation(state, unit.ownerId, candidate.ownerId) !== 'WAR') continue;
    const dist = Math.hypot(candidate.x - unit.x, candidate.y - unit.y);
    if (dist > bestDist) continue;
    if (!isUnitVisibleToPlayer(state, unit.ownerId, candidate)) continue;
    bestDist = dist;
    best = candidate;
  }
  return best;
}

function assignUnitFollowTarget(
  state: GameState,
  unit: Unit,
  goalX: number,
  goalY: number,
): boolean {
  const sameGoal =
    unit.targetX !== null &&
    unit.targetY !== null &&
    Math.hypot(unit.targetX - goalX, unit.targetY - goalY) <= 1.5;

  if (
    hasDirectPassableLine(
      state,
      unit.ownerId,
      { x: unit.x, y: unit.y },
      { x: goalX, y: goalY },
      false,
    )
  ) {
    unit.targetX = goalX;
    unit.targetY = goalY;
    unit.waypoints = [{ x: goalX, y: goalY }];
    return true;
  }

  if (!sameGoal || unit.waypoints.length === 0 || (state.tick + unit.id) % 15 === 0) {
    const path = findLandPath(state, unit.ownerId, unit.type, unit.x, unit.y, goalX, goalY, false);
    if (!path || path.length === 0) {
      return false;
    }
    unit.waypoints = path;
  }
  unit.targetX = goalX;
  unit.targetY = goalY;
  return true;
}

export function stepUnitsMovementAndSupply(state: GameState): void {
  if (state.phase !== 'PLAYING' || state.units.length === 0) {
    return;
  }

  const { width, height, terrain, owners } = state;
  const unitById = new Map<number, Unit>();
  for (const u of state.units) {
    unitById.set(u.id, u);
  }

  let anyMapClaimed = false;

  for (const unit of state.units) {
    if (unit.count <= 0 || unit.hp <= 0) continue;
    const spec = UNIT_SPECS[unit.type];
    const owner = state.players.get(unit.ownerId);

    if (unit.dropVulnerabilityTicks > 0) {
      unit.dropVulnerabilityTicks--;
    }
    if (unit.combatCooldownTicks > 0) {
      unit.combatCooldownTicks--;
    }

    const curIx = Math.max(0, Math.min(width - 1, Math.floor(unit.x)));
    const curIy = Math.max(0, Math.min(height - 1, Math.floor(unit.y)));
    const cellOwner = owners[curIy * width + curIx];
    const onEnemy =
      cellOwner >= 0 &&
      cellOwner !== unit.ownerId &&
      getUnitRelation(state, unit.ownerId, cellOwner) !== 'ALLIED';
    unit.isEncircled = onEnemy;

    if (unit.isEncircled) {
      unit.supplyLevel = Math.max(0, unit.supplyLevel - 0.55 * TICK_DT);
      unit.morale = Math.max(0, unit.morale - 4.5 * TICK_DT);
    } else {
      const ownerSupply = owner ? owner.energySupplyRatio : 1;
      if (unit.supplyLevel < ownerSupply) {
        unit.supplyLevel = Math.min(ownerSupply, unit.supplyLevel + 0.45 * TICK_DT);
      } else {
        unit.supplyLevel = Math.max(ownerSupply, unit.supplyLevel - 0.35 * TICK_DT);
      }
      unit.morale = Math.min(100, unit.morale + 6.0 * TICK_DT * Math.max(0.25, ownerSupply));
    }

    if (unit.fireMissionTicksRemaining > 0) {
      // Active artillery fire mission holds battery in place until barrage completes or cancels
      unit.targetX = null;
      unit.targetY = null;
      unit.waypoints = [];
    } else if (unit.stance === 'RANGE' && !unit.manualOrder && !unit.isEncircled) {
      // RANGE auto-attach ONLY when friendly offensive order or WAR enemy is inside operationRadius
      let frontPt = getAttachedOrderFrontPoint(state, unit);
      if (
        unit.attachedOrderId !== null &&
        frontPt !== null &&
        Math.hypot(frontPt.x - unit.x, frontPt.y - unit.y) > unit.operationRadius * 1.35
      ) {
        frontPt = null;
      }

      if (unit.attachedOrderId !== null && frontPt === null) {
        unit.attachedOrderId = null;
        unit.attachedOrderKind = null;
        unit.targetX = null;
        unit.targetY = null;
        unit.waypoints = [];
      } else if (unit.attachedOrderId === null) {
        const found = findOrderFrontForAttachment(state, unit);
        if (found) {
          unit.attachedOrderId = found.orderId;
          unit.attachedOrderKind = found.kind;
          frontPt = found.frontPt;
        }
      }

      if (frontPt !== null) {
        if (unit.type === 'ARTILLERY') {
          const dx = frontPt.x - unit.x;
          const dy = frontPt.y - unit.y;
          const dist = Math.hypot(dx, dy);
          const standoff = spec.attackRange * 0.68;
          if (dist > standoff + 1.5 && dist > 1e-4) {
            const sxGoal = frontPt.x - (dx / dist) * standoff;
            const syGoal = frontPt.y - (dy / dist) * standoff;
            if (!assignUnitFollowTarget(state, unit, sxGoal, syGoal)) {
              unit.targetX = null;
              unit.targetY = null;
              unit.waypoints = [];
              unit.attachedOrderId = null;
              unit.attachedOrderKind = null;
            }
          } else {
            unit.targetX = null;
            unit.targetY = null;
            unit.waypoints = [];
          }
        } else if (!assignUnitFollowTarget(state, unit, frontPt.x, frontPt.y)) {
          unit.targetX = null;
          unit.targetY = null;
          unit.waypoints = [];
          unit.attachedOrderId = null;
          unit.attachedOrderKind = null;
        }
      } else if (unit.mergeTargetUnitId === null) {
        const enemyInRange =
          unit.type !== 'ARTILLERY' ? findEnemyUnitInOperationRadius(state, unit) : null;
        if (!enemyInRange || !assignUnitFollowTarget(state, unit, enemyInRange.x, enemyInRange.y)) {
          unit.targetX = null;
          unit.targetY = null;
          unit.waypoints = [];
        }
      }
    } else if (unit.stance === 'LOCK') {
      unit.attachedOrderId = null;
      unit.attachedOrderKind = null;
      if (!unit.manualOrder && unit.mergeTargetUnitId === null) {
        unit.targetX = null;
        unit.targetY = null;
        unit.waypoints = [];
      }
    }

    if (unit.mergeTargetUnitId !== null) {
      const anchor = unitById.get(unit.mergeTargetUnitId);
      if (anchor && anchor.count > 0 && anchor.ownerId === unit.ownerId) {
        unit.targetX = anchor.x;
        unit.targetY = anchor.y;
      } else {
        unit.mergeTargetUnitId = null;
      }
    }

    // Waypoint-guided movement integration along A* smoothed land corridor
    if (unit.targetX !== null && unit.targetY !== null) {
      while (
        unit.waypoints.length > 0 &&
        Math.hypot(unit.waypoints[0].x - unit.x, unit.waypoints[0].y - unit.y) <= 1.25
      ) {
        unit.waypoints.shift();
      }

      const activePt: Point =
        unit.waypoints.length > 0
          ? unit.waypoints[0]
          : { x: unit.targetX, y: unit.targetY };
      const finalDist = Math.hypot(unit.targetX - unit.x, unit.targetY - unit.y);
      const dx = activePt.x - unit.x;
      const dy = activePt.y - unit.y;
      const dist = Math.hypot(dx, dy);

      if (finalDist <= 1.15 && unit.waypoints.length === 0) {
        unit.targetX = null;
        unit.targetY = null;
        unit.waypoints = [];
        unit.manualOrder = false;
      } else if (dist > 1e-4) {
        const curTerrain = terrain[curIy * width + curIx];
        const baseSpeed =
          curTerrain === TerrainType.MOUNTAINS ? spec.speedMountains : spec.speedPlains;
        const supplyMul = 0.55 + 0.45 * unit.supplyLevel;
        const moraleMul = 0.6 + 0.4 * (unit.morale / 100);
        let stepDist = Math.min(dist, baseSpeed * supplyMul * moraleMul * TICK_DT);

        let ux = dx / dist;
        let uy = dy / dist;
        const probeDist = Math.max(stepDist, 0.85);
        let probeX = Math.max(0, Math.min(width - 1, Math.floor(unit.x + ux * probeDist)));
        let probeY = Math.max(0, Math.min(height - 1, Math.floor(unit.y + uy * probeDist)));
        let canStep = isPassableUnitCell(state, unit.ownerId, probeX, probeY, false);

        if (!canStep) {
          // Recompute coarse land path once if map border/relation changed dynamically mid-march
          const replanned = findLandPath(
            state,
            unit.ownerId,
            unit.type,
            unit.x,
            unit.y,
            unit.targetX,
            unit.targetY,
            false,
          );
          if (replanned && replanned.length > 0) {
            unit.waypoints = replanned;
            const nextPt = replanned[0];
            const ndx = nextPt.x - unit.x;
            const ndy = nextPt.y - unit.y;
            const ndist = Math.hypot(ndx, ndy);
            if (ndist > 1e-4) {
              ux = ndx / ndist;
              uy = ndy / ndist;
              stepDist = Math.min(ndist, stepDist);
              probeX = Math.max(0, Math.min(width - 1, Math.floor(unit.x + ux * probeDist)));
              probeY = Math.max(0, Math.min(height - 1, Math.floor(unit.y + uy * probeDist)));
              canStep = isPassableUnitCell(state, unit.ownerId, probeX, probeY, false);
            }
          } else {
            unit.targetX = null;
            unit.targetY = null;
            unit.waypoints = [];
            unit.manualOrder = false;
            stepDist = 0;
          }
        }

        if (!canStep) {
          stepDist = 0;
        } else {
          const probeIdx = probeY * width + probeX;
          const probeOwner = owners[probeIdx];

          if (
            probeOwner >= 0 &&
            probeOwner !== unit.ownerId &&
            getUnitRelation(state, unit.ownerId, probeOwner) === 'WAR'
          ) {
            const def = evaluateCellDefense(state.buildings, probeOwner, probeX, probeY);
            const armorPenalty =
              unit.type === 'TANK'
                ? 1 / (1 + def.antiArmorFactor * 1.15)
                : def.advanceSpeedMultiplier;
            const defenseMul = Math.max(0.18, Math.min(1, armorPenalty));

            if (unit.isEncircled) {
              stepDist *= 0.08 * defenseMul;
              unit.breakoutAccum += stepDist;
              if (unit.breakoutAccum >= 1.2) {
                unit.breakoutAccum -= 1.2;
                unit.hp = Math.max(1, unit.hp - 1.2 * def.attackerCostMultiplier);
              }
            } else {
              stepDist *= 0.42 * defenseMul;
            }
          } else if (
            unit.isEncircled &&
            (probeOwner === unit.ownerId || probeOwner === WILDERNESS_OWNER)
          ) {
            stepDist *= 0.48;
          }
        }

        if (stepDist > 0) {
          const nx = Math.max(0.5, Math.min(width - 0.5, unit.x + ux * stepDist));
          const ny = Math.max(0.5, Math.min(height - 0.5, unit.y + uy * stepDist));
          const nIx = Math.floor(nx);
          const nIy = Math.floor(ny);
          const nIdx = nIy * width + nIx;
          if (isPassableUnitCell(state, unit.ownerId, nIx, nIy, false)) {
            unit.x = nx;
            unit.y = ny;

            // Advancing non-encircled tactical units claim entered WAR/WILDERNESS cells along their spearhead
            const enteredOwner = owners[nIdx];
            if (
              !unit.isEncircled &&
              (enteredOwner === WILDERNESS_OWNER ||
                (enteredOwner >= 0 &&
                  enteredOwner !== unit.ownerId &&
                  getUnitRelation(state, unit.ownerId, enteredOwner) === 'WAR'))
            ) {
              owners[nIdx] = unit.ownerId;
              anyMapClaimed = true;
            }
          }
        }
      }
    }

    // Field vs Base repair when out of combat and supplied
    if (
      !unit.isEncircled &&
      unit.combatCooldownTicks === 0 &&
      unit.hp < unit.maxHp &&
      owner &&
      !owner.blackoutActive
    ) {
      const nearBase = isUnitNearRepairBase(state, unit);
      const ratePerSec = nearBase ? BASE_REPAIR_RATE_PER_SEC : FIELD_REPAIR_RATE_PER_SEC;
      const heal = ratePerSec * owner.energySupplyRatio * unit.maxHp * TICK_DT;
      unit.hp = Math.min(unit.maxHp, unit.hp + heal);
    }
  }

  if (anyMapClaimed) {
    state.stateVersion++;
  }
  autoMergeNearbyUnits(state);
}

/**
 * Local Fog of War filter:
 * Enemy tactical units are ONLY revealed when inside vision radius of viewer's borders,
 * viewer's units, or allied borders/units.
 */
export function isUnitVisibleToPlayer(
  state: GameState,
  viewerPlayerId: number,
  unit: Unit,
): boolean {
  if (unit.count <= 0 || unit.hp <= 0) {
    return false;
  }
  if (unit.ownerId === viewerPlayerId) {
    return true;
  }
  if (getUnitRelation(state, viewerPlayerId, unit.ownerId) === 'ALLIED') {
    return true;
  }

  // 1. Check vision from viewer's units and allied units
  for (const spotter of state.units) {
    if (spotter.count <= 0 || spotter.hp <= 0) continue;
    if (
      spotter.ownerId !== viewerPlayerId &&
      getUnitRelation(state, viewerPlayerId, spotter.ownerId) !== 'ALLIED'
    ) {
      continue;
    }
    const visRadius = UNIT_SPECS[spotter.type].visionRadius;
    if (Math.hypot(unit.x - spotter.x, unit.y - spotter.y) <= visRadius) {
      return true;
    }
  }

  // 2. Check proximity to viewer's or allied territory borders
  const ux = Math.floor(unit.x);
  const uy = Math.floor(unit.y);
  const r = BORDER_VISION_RADIUS;
  const rSq = r * r;
  const minX = Math.max(0, ux - r);
  const maxX = Math.min(state.width - 1, ux + r);
  const minY = Math.max(0, uy - r);
  const maxY = Math.min(state.height - 1, uy + r);

  for (let y = minY; y <= maxY; y++) {
    const dy = y + 0.5 - unit.y;
    const row = y * state.width;
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - unit.x;
      if (dx * dx + dy * dy > rSq) continue;
      const cellOwner = state.owners[row + x];
      if (cellOwner < 0) continue;
      if (
        cellOwner === viewerPlayerId ||
        getUnitRelation(state, viewerPlayerId, cellOwner) === 'ALLIED'
      ) {
        return true;
      }
    }
  }

  return false;
}

/** Sanitizes unit state before sending to client (strips enemy orders/targets). */
export function toPublicUnitInfo(unit: Unit, viewerPlayerId: number): PublicUnitInfo {
  const isOwn = unit.ownerId === viewerPlayerId;
  return {
    id: unit.id,
    ownerId: unit.ownerId,
    type: unit.type,
    x: unit.x,
    y: unit.y,
    count: unit.count,
    hp: unit.hp,
    maxHp: unit.maxHp,
    morale: unit.morale,
    stance: unit.stance,
    operationRadius: isOwn ? unit.operationRadius : 0,
    targetX: isOwn ? unit.targetX : null,
    targetY: isOwn ? unit.targetY : null,
    waypoints: isOwn ? unit.waypoints.map((p) => ({ ...p })) : [],
    fireMissionX: isOwn ? unit.fireMissionX : null,
    fireMissionY: isOwn ? unit.fireMissionY : null,
    fireMissionTicksRemaining: isOwn ? unit.fireMissionTicksRemaining : 0,
    attachedOrderId: isOwn ? unit.attachedOrderId : null,
    isEncircled: unit.isEncircled,
    supplyLevel: isOwn ? unit.supplyLevel : 1,
    canParadrop: isOwn ? unit.canParadrop : false,
    dropVulnerabilityTicks: unit.dropVulnerabilityTicks,
    combatCooldownTicks: unit.combatCooldownTicks,
    lastCombatTargetX: unit.lastCombatTargetX,
    lastCombatTargetY: unit.lastCombatTargetY,
  };
}

function pointInPolygon(px: number, py: number, poly: ReadonlyArray<Point>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function distToPolyline(px: number, py: number, points: ReadonlyArray<Point>): number {
  if (points.length === 1) {
    return Math.hypot(px - points[0].x, py - points[0].y);
  }
  let minD = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const ax = points[i].x;
    const ay = points[i].y;
    const bx = points[i + 1].x;
    const by = points[i + 1].y;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < minD) {
      minD = d;
    }
  }
  return minD;
}

export function findHumanUnitsInPolygon(
  state: GameState,
  points: ReadonlyArray<Point>,
): number[] {
  if (state.phase !== 'PLAYING' || points.length === 0) {
    return [];
  }
  if (points.length < 3) {
    const hit: number[] = [];
    for (const u of state.units) {
      if (
        u.ownerId === state.humanPlayerId &&
        u.count > 0 &&
        distToPolyline(u.x, u.y, points) <= 8
      ) {
        hit.push(u.id);
      }
    }
    return hit;
  }

  const isClosedLoop =
    points.length >= 6 &&
    Math.hypot(
      points[0].x - points[points.length - 1].x,
      points[0].y - points[points.length - 1].y,
    ) < 42;

  const hit: number[] = [];
  for (const u of state.units) {
    if (u.ownerId !== state.humanPlayerId || u.count <= 0) continue;
    if (
      (isClosedLoop && pointInPolygon(u.x, u.y, points)) ||
      (!isClosedLoop && pointInPolygon(u.x, u.y, points)) ||
      distToPolyline(u.x, u.y, points) <= 6.5
    ) {
      hit.push(u.id);
    }
  }
  return hit;
}

export function findHumanUnitsInRect(
  state: GameState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number[] {
  if (state.phase !== 'PLAYING') {
    return [];
  }
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const hit: number[] = [];
  for (const u of state.units) {
    if (u.ownerId !== state.humanPlayerId || u.count <= 0) continue;
    if (u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) {
      hit.push(u.id);
    }
  }
  return hit;
}
