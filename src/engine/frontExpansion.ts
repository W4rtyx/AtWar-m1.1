import { evaluateFrontUnitSupport } from './combat';
import { evaluateCellDefense } from './defenses';
import { syncPlayerActiveManpower } from './economy';
import { getCombatBlackoutMultiplier } from './energyGrid';
import {
  AttackOrder,
  DiplomaticRelation,
  FINISH_OFF_MAX_CELLS,
  FINISH_OFF_MAX_LAND_RATIO,
  GameState,
  MAP_HEIGHT,
  MAP_WIDTH,
  PlayerState,
  Point,
  TerrainType,
  WILDERNESS_OWNER,
  getRelationKey,
} from './types';

export const PLAINS_SPEED = 1.0;
export const MOUNTAINS_SPEED = 0.35;

export const MAX_ARROW_PATH_LENGTH = 250;
export const MIN_ACTIVE_ORDER_MANPOWER = 5;
export const MAX_ORDER_TICKS = 110;
export const MAX_STAGNANT_TICKS = 12;

const WILDERNESS_BASE_COST = 0.62;
const ENEMY_BORDER_BASE_COST = 3.9;

const annexVisited = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
const annexQueue = new Int32Array(MAP_WIDTH * MAP_HEIGHT);
const sweepSeen = new Int32Array(MAP_WIDTH * MAP_HEIGHT);
let sweepStamp = 1;

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function organicCellNoise(x: number, y: number, orderId: number): number {
  return (
    Math.sin(x * 0.53 + y * 0.41 + orderId * 1.9) * 0.38 +
    Math.cos(x * 0.37 - y * 0.59 - orderId * 1.1) * 0.32
  );
}

const CARDINAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function getRelation(
  state: GameState,
  a: number,
  b: number,
): DiplomaticRelation {
  if (a === b || a < 0 || b < 0) {
    return 'NEUTRAL';
  }
  return state.relations.get(getRelationKey(a, b)) ?? 'NEUTRAL';
}

export function setWarRelation(state: GameState, a: number, b: number): void {
  if (a === b || a < 0 || b < 0) return;
  const key = getRelationKey(a, b);
  state.tradeAgreements.delete(key);
  if (state.relations.get(key) !== 'WAR') {
    state.relations.set(key, 'WAR');
    state.stateVersion++;
  }
}

export function canOrderCaptureCell(
  state: GameState,
  playerId: number,
  allowedEnemyIds: ReadonlyArray<number>,
  cellOwner: number,
): boolean {
  if (cellOwner === playerId || cellOwner < WILDERNESS_OWNER) {
    return false;
  }
  if (cellOwner === WILDERNESS_OWNER) {
    return true;
  }
  if (!allowedEnemyIds.includes(cellOwner)) {
    return false;
  }
  return getRelation(state, playerId, cellOwner) === 'WAR';
}

export function collectCenterlineWarEnemies(
  state: GameState,
  playerId: number,
  waypoints: ReadonlyArray<Point>,
): number[] {
  if (waypoints.length < 2) return [];
  const { width, height, owners } = state;
  const found = new Set<number>();

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(segLen / 1.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = Math.max(0, Math.min(width - 1, Math.floor(a.x + (b.x - a.x) * t)));
      const py = Math.max(0, Math.min(height - 1, Math.floor(a.y + (b.y - a.y) * t)));
      const owner = owners[py * width + px];
      if (
        owner >= 0 &&
        owner !== playerId &&
        getRelation(state, playerId, owner) === 'WAR'
      ) {
        found.add(owner);
      }
    }
  }

  // Also inspect immediate 2-cell neighborhood of the tip for border clicks/targets
  const tip = waypoints[waypoints.length - 1];
  const tx = Math.floor(tip.x);
  const ty = Math.floor(tip.y);
  for (let dy = -2; dy <= 2; dy++) {
    const ny = ty + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -2; dx <= 2; dx++) {
      const nx = tx + dx;
      if (nx < 0 || nx >= width) continue;
      const owner = owners[ny * width + nx];
      if (
        owner >= 0 &&
        owner !== playerId &&
        getRelation(state, playerId, owner) === 'WAR'
      ) {
        found.add(owner);
      }
    }
  }

  return Array.from(found);
}

export function computePolylineLength(points: ReadonlyArray<Point>): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

export function clampPolylineLength(
  points: ReadonlyArray<Point>,
  maxLength: number,
): Point[] {
  if (points.length === 0) return [];
  const out: Point[] = [{ x: points[0].x, y: points[0].y }];
  let accum = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const segLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (segLen < 1e-6) continue;

    if (accum + segLen >= maxLength) {
      const remain = maxLength - accum;
      const t = remain / segLen;
      out.push({
        x: prev.x + (curr.x - prev.x) * t,
        y: prev.y + (curr.y - prev.y) * t,
      });
      break;
    }

    out.push({ x: curr.x, y: curr.y });
    accum += segLen;
  }

  return out;
}

function perpDistToLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function simplifyWaypointsRDP(
  points: ReadonlyArray<Point>,
  epsilon: number,
): Point[] {
  if (points.length <= 2) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }

  let maxDist = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistToLine(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyWaypointsRDP(points.slice(0, index + 1), epsilon);
    const right = simplifyWaypointsRDP(points.slice(index), epsilon);
    return left.slice(0, left.length - 1).concat(right);
  }

  return [
    { x: first.x, y: first.y },
    { x: last.x, y: last.y },
  ];
}

function resamplePolyline(points: ReadonlyArray<Point>, targetCount: number): Point[] {
  if (points.length <= 1 || targetCount <= 1) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }
  const totalLen = computePolylineLength(points);
  if (totalLen < 1e-4) {
    return [{ x: points[0].x, y: points[0].y }];
  }

  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(
      cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
    );
  }

  const result: Point[] = [];
  let seg = 0;
  for (let k = 0; k < targetCount; k++) {
    const targetDist = (k / (targetCount - 1)) * totalLen;
    while (seg < cum.length - 2 && cum[seg + 1] < targetDist) {
      seg++;
    }
    const segStart = cum[seg];
    const segEnd = cum[seg + 1];
    const span = segEnd - segStart;
    const t = span > 1e-6 ? (targetDist - segStart) / span : 0;
    result.push({
      x: points[seg].x + (points[seg + 1].x - points[seg].x) * t,
      y: points[seg].y + (points[seg + 1].y - points[seg].y) * t,
    });
  }
  return result;
}

function clampPointToMap(p: Point): Point {
  return {
    x: Math.max(0, Math.min(MAP_WIDTH - 1, p.x)),
    y: Math.max(0, Math.min(MAP_HEIGHT - 1, p.y)),
  };
}

export function buildSmoothAttackWaypoints(
  rawPoints: ReadonlyArray<Point>,
  bendOffset = 0,
): Point[] {
  if (rawPoints.length < 2) {
    return rawPoints.map(clampPointToMap);
  }

  const clampedInput = clampPolylineLength(rawPoints, MAX_ARROW_PATH_LENGTH);
  let simplified = simplifyWaypointsRDP(clampedInput, 3.5);

  if (simplified.length > 10) {
    let eps = 6.0;
    while (simplified.length > 10 && eps < 40) {
      simplified = simplifyWaypointsRDP(clampedInput, eps);
      eps += 2.5;
    }
  }

  if (simplified.length > 10) {
    simplified = resamplePolyline(simplified, 8);
  } else if (simplified.length < 4) {
    simplified = resamplePolyline(simplified, 5);
  }

  if (Math.abs(bendOffset) > 0.25 && simplified.length >= 3) {
    const start = simplified[0];
    const end = simplified[simplified.length - 1];
    const chordX = end.x - start.x;
    const chordY = end.y - start.y;
    const chordLen = Math.hypot(chordX, chordY);
    if (chordLen > 2) {
      const nx = -chordY / chordLen;
      const ny = chordX / chordLen;
      simplified = simplified.map((pt, idx) => {
        const t = idx / (simplified.length - 1);
        const weight = Math.sin(Math.PI * t);
        return {
          x: pt.x + nx * bendOffset * weight,
          y: pt.y + ny * bendOffset * weight,
        };
      });
    }
  }

  const bounded = simplified.map(clampPointToMap);
  return clampPolylineLength(bounded, MAX_ARROW_PATH_LENGTH);
}

export function isBorderCell(
  state: GameState,
  x: number,
  y: number,
  playerId: number,
): boolean {
  const { width, height, owners, terrain } = state;
  const idx = y * width + x;
  if (owners[idx] !== playerId) {
    return false;
  }
  for (const [dx, dy] of CARDINAL_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
      continue;
    }
    const nIdx = ny * width + nx;
    if (terrain[nIdx] !== TerrainType.WATER && owners[nIdx] !== playerId) {
      return true;
    }
  }
  return false;
}

export function countFriendlyNeighbors(
  state: GameState,
  x: number,
  y: number,
  playerId: number,
): number {
  const { width, height, owners } = state;
  let count = 0;
  for (const [dx, dy] of CARDINAL_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      if (owners[ny * width + nx] === playerId) {
        count++;
      }
    }
  }
  return count;
}

export function claimInitialTerritory(
  state: GameState,
  playerId: number,
  centerX: number,
  centerY: number,
  radius: number,
): number {
  const { width, height, terrain, owners } = state;
  const startIdx = centerY * width + centerX;
  if (
    centerX < 0 ||
    centerX >= width ||
    centerY < 0 ||
    centerY >= height ||
    terrain[startIdx] === TerrainType.WATER ||
    owners[startIdx] !== WILDERNESS_OWNER
  ) {
    return 0;
  }

  const visited = new Uint8Array(width * height);
  const queue: number[] = [startIdx];
  visited[startIdx] = 1;
  const rSq = radius * radius;
  let claimed = 0;

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    owners[idx] = playerId;
    claimed++;

    const cx = idx % width;
    const cy = (idx - cx) / width;

    for (const [dx, dy] of CARDINAL_OFFSETS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (visited[nIdx]) continue;
      if (terrain[nIdx] === TerrainType.WATER || owners[nIdx] !== WILDERNESS_OWNER) {
        continue;
      }
      const distSq = (nx - centerX) * (nx - centerX) + (ny - centerY) * (ny - centerY);
      if (distSq <= rSq) {
        visited[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }

  if (claimed > 0) {
    state.stateVersion++;
  }
  return claimed;
}

interface ExpansionCandidate {
  readonly idx: number;
  readonly nx: number;
  readonly ny: number;
  readonly score: number;
}

interface ExpandableOrder {
  playerId: number;
  manpowerCommitted: number;
  manpowerRemaining: number;
  ticksRemaining: number;
  stagnantTicks: number;
  mountainAccum: number;
  readonly finishOff?: boolean;
}

function getProtectedReserveFloor(defender: PlayerState): number {
  return Math.min(defender.maxManpower * 0.4, Math.max(28, defender.maxManpower * 0.08));
}

function applyDefenderAttrition(defender: PlayerState, rawLoss: number): void {
  if (!defender.alive || rawLoss <= 0) return;
  const minTotalFloor = defender.blackoutActive
    ? Math.min(defender.maxManpower, defender.allocatedManpower)
    : Math.min(
        defender.maxManpower,
        defender.allocatedManpower + getProtectedReserveFloor(defender),
      );
  if (defender.manpower > minTotalFloor) {
    defender.manpower = Math.max(minTotalFloor, defender.manpower - rawLoss);
    syncPlayerActiveManpower(defender);
  }
}

function computeCellCaptureCost(
  state: GameState,
  attackerId: number,
  nx: number,
  ny: number,
  cellTerrain: TerrainType,
  prevOwner: number,
): {
  readonly effectiveCost: number;
  readonly defenderLoss: number;
  readonly advanceSpeedMultiplier: number;
  readonly isForeign: boolean;
} {
  const terrainFactor = cellTerrain === TerrainType.MOUNTAINS ? 1 / MOUNTAINS_SPEED : 1 / PLAINS_SPEED;

  if (prevOwner === WILDERNESS_OWNER) {
    return {
      effectiveCost: WILDERNESS_BASE_COST * terrainFactor,
      defenderLoss: 0,
      advanceSpeedMultiplier: 1,
      isForeign: false,
    };
  }

  const defender = state.players.get(prevOwner);
  const attacker = state.players.get(attackerId);
  const defenderActive = defender
    ? Math.max(0, defender.manpower - defender.allocatedManpower)
    : 0;
  const defenderRatio = defender
    ? defenderActive / Math.max(100, defender.maxManpower)
    : 0;
  const defenderStrength = 0.72 + 0.85 * Math.min(1, defenderRatio / 0.55);
  const defenderNeighbors = countFriendlyNeighbors(state, nx, ny, prevOwner);
  const cohesionFactor = 0.75 + defenderNeighbors * 0.14;

  const defense = evaluateCellDefense(state.buildings, prevOwner, nx, ny);
  const support = evaluateFrontUnitSupport(state, attackerId, prevOwner, nx, ny, cellTerrain);
  const defenderBlackoutMul = getCombatBlackoutMultiplier(defender);
  const attackerBlackoutMul = getCombatBlackoutMultiplier(attacker);

  const effectiveFortCostMul =
    1 + (defense.attackerCostMultiplier - 1) * (1 - support.fortificationSuppression);
  const effectiveFortSpeedMul =
    1 - (1 - defense.advanceSpeedMultiplier) * (1 - support.fortificationSuppression);

  let effectiveCost =
    ENEMY_BORDER_BASE_COST *
    defenderStrength *
    cohesionFactor *
    terrainFactor *
    effectiveFortCostMul *
    support.attackerCostMultiplier *
    support.defenderResistanceCostMultiplier *
    (defenderBlackoutMul / attackerBlackoutMul);
  // Scale defender losses proportionally so low reserves don't spiral permanently to zero
  let defenderLoss =
    (ENEMY_BORDER_BASE_COST *
      (0.18 + 0.38 * defenderRatio) *
      cohesionFactor *
      defense.defenderLossMultiplier) /
    defenderBlackoutMul;

  if (defender && defender.betrayalDebuffTicks > 0) {
    effectiveCost *= 0.65;
    defenderLoss *= 1.4;
  }

  const advanceSpeedMultiplier = Math.max(
    0.18,
    Math.min(
      2.0,
      effectiveFortSpeedMul *
        support.attackerSpeedMultiplier *
        support.defenderResistanceSpeedMultiplier,
    ),
  );

  return {
    effectiveCost,
    defenderLoss,
    advanceSpeedMultiplier,
    isForeign: true,
  };
}

interface ApplyExpansionResult {
  readonly claimed: boolean;
  readonly capturedForeign: boolean;
}

function applyExpansionCandidates(
  state: GameState,
  order: ExpandableOrder,
  allowedEnemyIds: ReadonlyArray<number>,
  candidates: ExpansionCandidate[],
  onClaim?: (claimedIdx: number) => void,
): ApplyExpansionResult {
  if (candidates.length === 0) {
    return { claimed: false, capturedForeign: false };
  }

  candidates.sort((a, b) => b.score - a.score);

  const attacker = state.players.get(order.playerId);
  const attackerCombatMul = getCombatBlackoutMultiplier(attacker);
  const budgetRate = order.finishOff ? 0.24 : 0.16;
  const tickBudget =
    Math.min(
      order.manpowerRemaining,
      Math.max(4.5, order.manpowerCommitted * budgetRate),
    ) * attackerCombatMul;
  let budgetSpent = 0;
  let anyClaimed = false;
  let anyForeignCaptured = false;

  for (const cand of candidates) {
    if (order.manpowerRemaining < MIN_ACTIVE_ORDER_MANPOWER) {
      break;
    }

    const prevOwner = state.owners[cand.idx];
    if (!canOrderCaptureCell(state, order.playerId, allowedEnemyIds, prevOwner)) {
      continue;
    }

    const cellTerrain = state.terrain[cand.idx];
    if (cellTerrain === TerrainType.WATER) {
      continue;
    }

    const { effectiveCost, defenderLoss, advanceSpeedMultiplier, isForeign } =
      computeCellCaptureCost(
        state,
        order.playerId,
        cand.nx,
        cand.ny,
        cellTerrain,
        prevOwner,
      );
    const budgetCost = isForeign
      ? effectiveCost / Math.max(0.22, advanceSpeedMultiplier)
      : effectiveCost;

    if (budgetSpent + budgetCost > tickBudget) {
      if (budgetSpent === 0 && (cellTerrain === TerrainType.MOUNTAINS || isForeign)) {
        const stepCharge = Math.min(tickBudget, order.manpowerRemaining);
        order.mountainAccum += stepCharge;

        if (isForeign) {
          setWarRelation(state, order.playerId, prevOwner);
          const skirmishAttackerLoss = Math.min(order.manpowerRemaining, stepCharge * 0.32);
          order.manpowerRemaining -= skirmishAttackerLoss;
          const defender = state.players.get(prevOwner);
          if (defender && defender.alive) {
            const betrayalMul = defender.betrayalDebuffTicks > 0 ? 1.4 : 1.0;
            applyDefenderAttrition(defender, stepCharge * 0.2 * betrayalMul);
          }
        }

        if (
          order.mountainAccum >= budgetCost &&
          order.manpowerRemaining >= effectiveCost
        ) {
          order.mountainAccum -= budgetCost;
        } else {
          break;
        }
      } else {
        continue;
      }
    }

    if (order.manpowerRemaining < effectiveCost) {
      continue;
    }

    if (isForeign) {
      setWarRelation(state, order.playerId, prevOwner);
    }

    state.owners[cand.idx] = order.playerId;
    order.manpowerRemaining -= effectiveCost;
    budgetSpent += budgetCost;
    anyClaimed = true;

    if (isForeign) {
      anyForeignCaptured = true;
      const defender: PlayerState | undefined = state.players.get(prevOwner);
      if (defender) {
        applyDefenderAttrition(defender, defenderLoss);
      }
    }

    if (onClaim) {
      onClaim(cand.idx);
    }
  }

  return { claimed: anyClaimed, capturedForeign: anyForeignCaptured };
}

interface CurveProjection {
  readonly arcDist: number;
  readonly perpDist: number;
  readonly tanX: number;
  readonly tanY: number;
}

function projectPointOntoWaypointsWindow(
  px: number,
  py: number,
  waypoints: ReadonlyArray<Point>,
  cumDist: ReadonlyArray<number>,
  minArc: number,
  maxArc: number,
): CurveProjection {
  let bestPerp = Infinity;
  let bestArc = 0;
  let bestTanX = 1;
  let bestTanY = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const segStart = cumDist[i];
    const segEnd = cumDist[i + 1];
    if (segEnd < minArc || segStart > maxArc) {
      continue;
    }

    const a = waypoints[i];
    const b = waypoints[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-8) continue;
    const len = Math.sqrt(lenSq);
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    const dist = Math.hypot(px - projX, py - projY);

    if (dist < bestPerp) {
      bestPerp = dist;
      bestArc = segStart + t * len;
      bestTanX = dx / len;
      bestTanY = dy / len;
    }
  }

  return {
    arcDist: bestArc,
    perpDist: bestPerp,
    tanX: bestTanX,
    tanY: bestTanY,
  };
}

/**
 * Walks contiguously along the polyline spine from origin to find how far owned territory
 * reaches WITHOUT jumping over an intervening foreign state or uncaptured wilderness strip.
 */
function computeContiguousOwnedSpineArc(
  state: GameState,
  order: AttackOrder,
  cumDist: ReadonlyArray<number>,
): number {
  const totalLen = cumDist[cumDist.length - 1];
  if (totalLen < 1e-4) return 0;

  const { width, height, owners, terrain } = state;
  let seg = 0;
  let lastOwnedArc = 0;

  for (let s = 0; s <= totalLen; s += 1.0) {
    while (seg < cumDist.length - 2 && cumDist[seg + 1] < s) {
      seg++;
    }
    const segStart = cumDist[seg];
    const segEnd = cumDist[seg + 1];
    const span = segEnd - segStart;
    const t = span > 1e-6 ? (s - segStart) / span : 0;
    const a = order.waypoints[seg];
    const b = order.waypoints[seg + 1];
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;

    const ix = Math.max(0, Math.min(width - 1, Math.floor(px)));
    const iy = Math.max(0, Math.min(height - 1, Math.floor(py)));
    const idx = iy * width + ix;

    if (terrain[idx] === TerrainType.WATER) {
      continue;
    }
    if (owners[idx] === order.playerId) {
      lastOwnedArc = s;
    } else if (s > 2.5) {
      // Hit an uncaptured barrier along the spine — stop contiguous advance right here
      break;
    }
  }

  return lastOwnedArc;
}

function refundRemainingManpower(player: PlayerState, remaining: number): void {
  if (remaining > 0) {
    player.manpower = Math.min(player.maxManpower, player.manpower + remaining);
    syncPlayerActiveManpower(player);
  }
}

interface ExpansionStepResult {
  readonly mapChanged: boolean;
  readonly capturedForeign: boolean;
  readonly anyTerminated: boolean;
}

function stepAttackOrders(state: GameState): ExpansionStepResult {
  const { width, height, owners, terrain } = state;
  let mapChanged = false;
  let capturedForeign = false;
  let anyTerminated = false;
  const remainingOrders = [];

  for (const order of state.attackOrders) {
    const player = state.players.get(order.playerId);
    if (!player || !player.alive) {
      continue;
    }

    if (order.waypoints.length < 2) {
      refundRemainingManpower(player, order.manpowerRemaining);
      continue;
    }

    order.ticksRemaining--;

    // Sync allowed WAR enemies dynamically along the centerline (unless wilderness-only)
    if (!order.wildernessOnly) {
      const centerlineWar = collectCenterlineWarEnemies(
        state,
        order.playerId,
        order.waypoints,
      );
      if (centerlineWar.length > 0) {
        const merged = new Set(order.targetOwnerIds);
        for (const id of centerlineWar) {
          merged.add(id);
        }
        order.targetOwnerIds = Array.from(merged);
      }
    }

    const cumDist: number[] = [0];
    for (let i = 1; i < order.waypoints.length; i++) {
      cumDist.push(
        cumDist[i - 1] +
          Math.hypot(
            order.waypoints[i].x - order.waypoints[i - 1].x,
            order.waypoints[i].y - order.waypoints[i - 1].y,
          ),
      );
    }
    const totalLen = cumDist[cumDist.length - 1];
    order.totalPathLength = totalLen;

    const halfCorridor = 8.5;
    const scanPad = halfCorridor + 6;

    let minX = width - 1;
    let maxX = 0;
    let minY = height - 1;
    let maxY = 0;
    for (const wp of order.waypoints) {
      minX = Math.min(minX, Math.floor(wp.x - scanPad));
      maxX = Math.max(maxX, Math.ceil(wp.x + scanPad));
      minY = Math.min(minY, Math.floor(wp.y - scanPad));
      maxY = Math.max(maxY, Math.ceil(wp.y + scanPad));
    }
    minX = Math.max(0, minX);
    maxX = Math.min(width - 1, maxX);
    minY = Math.max(0, minY);
    maxY = Math.min(height - 1, maxY);

    // Spine march guarantees arrows crossing an enemy state never skip to distant own territory
    const spineArc = computeContiguousOwnedSpineArc(state, order, cumDist);
    order.frontierArc = Math.max(order.frontierArc, spineArc);

    const winMin = Math.max(0, order.frontierArc - 4);
    const winMax = Math.min(totalLen, spineArc + 4);
    let maxContiguousArc = order.frontierArc;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (owners[y * width + x] !== order.playerId) continue;
        const proj = projectPointOntoWaypointsWindow(
          x + 0.5,
          y + 0.5,
          order.waypoints,
          cumDist,
          winMin,
          winMax,
        );
        if (
          proj.perpDist <= halfCorridor * 0.65 &&
          proj.arcDist >= winMin &&
          proj.arcDist <= winMax &&
          proj.arcDist > maxContiguousArc
        ) {
          maxContiguousArc = proj.arcDist;
        }
      }
    }

    order.frontierArc = Math.max(order.frontierArc, maxContiguousArc);
    const rawProgress = totalLen > 0 ? Math.min(1, order.frontierArc / totalLen) : 1;
    order.segmentProgress = Math.max(order.segmentProgress, rawProgress);

    let segIdx = 0;
    while (segIdx < cumDist.length - 2 && cumDist[segIdx + 1] < order.frontierArc) {
      segIdx++;
    }
    order.currentSegmentIndex = segIdx;

    const activeMinArc = Math.max(0, order.frontierArc - 10);
    const activeMaxArc = Math.min(totalLen + 4, order.frontierArc + 10);
    const candidateBestScore = new Map<number, { nx: number; ny: number; score: number }>();

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * width + x;
        if (owners[idx] !== order.playerId) continue;

        const proj = projectPointOntoWaypointsWindow(
          x + 0.5,
          y + 0.5,
          order.waypoints,
          cumDist,
          activeMinArc,
          activeMaxArc,
        );
        if (
          proj.perpDist > halfCorridor ||
          proj.arcDist < activeMinArc ||
          proj.arcDist > activeMaxArc
        ) {
          continue;
        }

        for (const [dx, dy] of NEIGHBOR_OFFSETS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          const nOwner = owners[nIdx];
          if (
            terrain[nIdx] === TerrainType.WATER ||
            !canOrderCaptureCell(state, order.playerId, order.targetOwnerIds, nOwner)
          ) {
            continue;
          }

          const nProj = projectPointOntoWaypointsWindow(
            nx + 0.5,
            ny + 0.5,
            order.waypoints,
            cumDist,
            activeMinArc - 2,
            Math.min(totalLen + 6, activeMaxArc + 6),
          );
          if (
            nProj.perpDist > halfCorridor ||
            nProj.arcDist < activeMinArc - 2 ||
            nProj.arcDist > totalLen + 6
          ) {
            continue;
          }

          const stepLen = Math.hypot(dx, dy);
          const dot = (dx * nProj.tanX + dy * nProj.tanY) / stepLen;
          const friendly = countFriendlyNeighbors(state, nx, ny, order.playerId);
          if (dot < 0.35 && friendly < 3) {
            continue;
          }

          const terrainBonus = terrain[nIdx] === TerrainType.MOUNTAINS ? -0.55 : 0;
          const wildernessBonus = nOwner === WILDERNESS_OWNER ? 0.35 : -0.2;
          const cleanupBonus = friendly >= 3 ? 1.8 : 0;
          const arcLeadBonus = Math.min(
            1.5,
            Math.max(-0.5, (nProj.arcDist - order.frontierArc) * 0.06),
          );
          const score =
            dot * 3.0 -
            nProj.perpDist * 0.26 +
            friendly * 0.45 +
            arcLeadBonus +
            terrainBonus +
            wildernessBonus +
            cleanupBonus +
            organicCellNoise(nx, ny, order.id) * 0.45;

          const existing = candidateBestScore.get(nIdx);
          if (!existing || score > existing.score) {
            candidateBestScore.set(nIdx, { nx, ny, score });
          }
        }
      }
    }

    const candidates: ExpansionCandidate[] = [];
    for (const [idx, val] of candidateBestScore) {
      candidates.push({ idx, nx: val.nx, ny: val.ny, score: val.score });
    }

    const res = applyExpansionCandidates(
      state,
      order,
      order.targetOwnerIds,
      candidates,
    );
    if (res.claimed) {
      mapChanged = true;
      if (res.capturedForeign) capturedForeign = true;
      order.stagnantTicks = 0;
    } else {
      order.stagnantTicks++;
    }

    const shouldTerminate =
      order.manpowerRemaining < MIN_ACTIVE_ORDER_MANPOWER ||
      order.ticksRemaining <= 0 ||
      order.stagnantTicks >= MAX_STAGNANT_TICKS ||
      candidates.length === 0;

    if (shouldTerminate) {
      anyTerminated = true;
      refundRemainingManpower(player, order.manpowerRemaining);
    } else {
      remainingOrders.push(order);
    }
  }

  state.attackOrders = remainingOrders;
  return { mapChanged, capturedForeign, anyTerminated };
}

export function addEnemyAdjacentFrontierCells(
  state: GameState,
  playerId: number,
  targetOwnerId: number,
  intoSet: Set<number>,
): void {
  const { width, height, owners, terrain } = state;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      if (owners[idx] !== playerId) continue;
      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (owners[nIdx] === targetOwnerId && terrain[nIdx] !== TerrainType.WATER) {
          intoSet.add(idx);
          break;
        }
      }
    }
  }
}

export function isFinishOffTargetSmall(state: GameState, target: PlayerState): boolean {
  if (!target.alive || target.territoryCells <= 0) {
    return false;
  }
  return (
    target.territoryCells <= FINISH_OFF_MAX_CELLS ||
    target.territoryCells / Math.max(1, state.totalLandCells) < FINISH_OFF_MAX_LAND_RATIO
  );
}

/**
 * Estimates manpower required to finish off all remaining pockets of a small residual opponent.
 * Returns null if the opponent exceeds small-target thresholds or shares no active border.
 */
export function estimateFinishOffManpower(
  state: GameState,
  attackerId: number,
  targetId: number,
): number | null {
  const attacker = state.players.get(attackerId);
  const target = state.players.get(targetId);
  if (!attacker || !attacker.alive || !target || !target.alive || attackerId === targetId) {
    return null;
  }
  if (!isFinishOffTargetSmall(state, target)) {
    return null;
  }

  const { width, height, owners, terrain } = state;
  let cellCount = 0;
  let totalCost = 0;
  let hasSharedBorder = false;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      if (owners[idx] !== targetId || terrain[idx] === TerrainType.WATER) {
        continue;
      }
      cellCount++;
      totalCost += computeCellCaptureCost(
        state,
        attackerId,
        x,
        y,
        terrain[idx],
        targetId,
      ).effectiveCost;

      if (!hasSharedBorder) {
        for (const [dx, dy] of NEIGHBOR_OFFSETS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (owners[ny * width + nx] === attackerId) {
            hasSharedBorder = true;
            break;
          }
        }
      }
    }
  }

  if (!hasSharedBorder || cellCount === 0) {
    return null;
  }
  return Math.max(25, Math.ceil(totalCost * 1.25));
}

/**
 * Absorbs tiny isolated residual enemy fragments (<= 16 land cells with 0 buildings,
 * touching only attacker land or water) encountered during strong or FULL assaults.
 */
function sweepMicroPocketsForAttacker(
  state: GameState,
  attackerId: number,
  targetOwnerId: number,
  order: ExpandableOrder,
  seedSources: ReadonlyArray<number>,
): number {
  if (targetOwnerId < 0 || seedSources.length === 0) return 0;
  const { width, height, owners, terrain } = state;
  const total = width * height;
  const seen = total <= sweepSeen.length ? sweepSeen : new Int32Array(total);

  const protectedCells = new Set<number>();
  for (const b of state.buildings) {
    protectedCells.add(b.y * width + b.x);
  }
  for (const u of state.units) {
    if (u.count > 0 && u.hp > 0) {
      const ux = Math.max(0, Math.min(width - 1, Math.floor(u.x)));
      const uy = Math.max(0, Math.min(height - 1, Math.floor(u.y)));
      protectedCells.add(uy * width + ux);
    }
  }

  const candidateSeeds: number[] = [];
  for (const srcIdx of seedSources) {
    const x = srcIdx % width;
    const y = (srcIdx - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const nIdx = ny * width + nx;
        if (owners[nIdx] === targetOwnerId && terrain[nIdx] !== TerrainType.WATER) {
          candidateSeeds.push(nIdx);
        }
      }
    }
  }

  let sweptTotal = 0;
  for (const seedIdx of candidateSeeds) {
    if (order.manpowerRemaining < MIN_ACTIVE_ORDER_MANPOWER) break;
    if (owners[seedIdx] !== targetOwnerId) continue;

    sweepStamp++;
    if (sweepStamp >= 0x70000000) {
      seen.fill(0, 0, total);
      sweepStamp = 1;
    }

    const comp: number[] = [seedIdx];
    seen[seedIdx] = sweepStamp;
    let valid = true;

    for (let head = 0; head < comp.length && valid; head++) {
      const idx = comp[head];
      if (protectedCells.has(idx)) {
        valid = false;
        break;
      }
      const cx = idx % width;
      const cy = (idx - cx) / width;
      if (cx === 0 || cx === width - 1 || cy === 0 || cy === height - 1) {
        valid = false;
        break;
      }

      for (let dy = -1; dy <= 1 && valid; dy++) {
        const ny = cy + dy;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nIdx = ny * width + (cx + dx);
          if (terrain[nIdx] === TerrainType.WATER) continue;
          const nOwner = owners[nIdx];
          if (nOwner === targetOwnerId) {
            if (seen[nIdx] !== sweepStamp) {
              seen[nIdx] = sweepStamp;
              if (comp.length >= 16) {
                valid = false;
                break;
              }
              comp.push(nIdx);
            }
          } else if (nOwner !== attackerId) {
            valid = false;
            break;
          }
        }
      }
    }

    if (valid && comp.length > 0 && comp.length <= 16) {
      for (const idx of comp) {
        owners[idx] = attackerId;
      }
      order.manpowerRemaining = Math.max(0, order.manpowerRemaining - comp.length * 0.7);
      sweptTotal += comp.length;
    }
  }

  return sweptTotal;
}

function stepFrontPushOrders(state: GameState): ExpansionStepResult {
  const { width, height, owners, terrain } = state;
  let mapChanged = false;
  let capturedForeign = false;
  let anyTerminated = false;
  const remainingOrders = [];

  for (const order of state.frontPushOrders) {
    const player = state.players.get(order.playerId);
    if (!player || !player.alive) {
      continue;
    }

    order.ticksRemaining--;
    const allowedEnemyIds =
      order.targetOwnerId >= 0 ? [order.targetOwnerId] : [];
    const activeFrontierSet = new Set<number>(order.frontierCells);

    if (order.sweepAllBorders && order.targetOwnerId >= 0) {
      addEnemyAdjacentFrontierCells(state, order.playerId, order.targetOwnerId, activeFrontierSet);
    } else if (order.focalPoint) {
      const recruitRadius = order.finishOff ? 30 : 22;
      const recruitRSq = recruitRadius * recruitRadius;
      const fx = Math.round(order.focalPoint.x);
      const fy = Math.round(order.focalPoint.y);
      const minRx = Math.max(0, fx - recruitRadius);
      const maxRx = Math.min(width - 1, fx + recruitRadius);
      const minRy = Math.max(0, fy - recruitRadius);
      const maxRy = Math.min(height - 1, fy + recruitRadius);

      for (let cy = minRy; cy <= maxRy; cy++) {
        for (let cx = minRx; cx <= maxRx; cx++) {
          const dSq =
            (cx - order.focalPoint.x) * (cx - order.focalPoint.x) +
            (cy - order.focalPoint.y) * (cy - order.focalPoint.y);
          if (dSq <= recruitRSq && isBorderCell(state, cx, cy, order.playerId)) {
            activeFrontierSet.add(cy * width + cx);
          }
        }
      }
    }

    const prunedFrontierSet = new Set<number>();
    const candidateBestScore = new Map<number, { nx: number; ny: number; score: number }>();

    for (const cellIdx of activeFrontierSet) {
      if (cellIdx < 0 || cellIdx >= width * height) continue;
      if (owners[cellIdx] !== order.playerId) continue;

      const x = cellIdx % width;
      const y = (cellIdx - x) / width;
      let hasTarget = false;

      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        const nOwner = owners[nIdx];
        if (
          terrain[nIdx] === TerrainType.WATER ||
          !canOrderCaptureCell(state, order.playerId, allowedEnemyIds, nOwner)
        ) {
          continue;
        }

        hasTarget = true;
        const stepLen = Math.hypot(dx, dy);
        const friendly = countFriendlyNeighbors(state, nx, ny, order.playerId);
        const terrainBonus = terrain[nIdx] === TerrainType.MOUNTAINS ? -0.55 : 0;
        const wildernessBonus = nOwner === WILDERNESS_OWNER ? 0.35 : -0.15;
        const cleanupBonus = friendly >= 3 ? 2.0 : 0;
        const edgeNoise = organicCellNoise(nx, ny, order.id);

        let score: number;
        if (order.finishOff) {
          score =
            friendly * 0.75 +
            cleanupBonus +
            terrainBonus +
            wildernessBonus +
            edgeNoise;
        } else if (order.focalPoint) {
          const toFocalX = order.focalPoint.x - (x + 0.5);
          const toFocalY = order.focalPoint.y - (y + 0.5);
          const focalLen = Math.hypot(toFocalX, toFocalY);
          const localDirX = focalLen > 3 ? toFocalX / focalLen : order.dirX;
          const localDirY = focalLen > 3 ? toFocalY / focalLen : order.dirY;
          const localDot = (dx * localDirX + dy * localDirY) / stepLen;
          if (!order.sweepAllBorders && localDot < -0.15 && friendly < 3) {
            continue;
          }

          const distFocal = Math.hypot(
            nx + 0.5 - order.focalPoint.x,
            ny + 0.5 - order.focalPoint.y,
          );
          const distOrigin = Math.hypot(
            nx + 0.5 - order.originCenter.x,
            ny + 0.5 - order.originCenter.y,
          );
          const anchorPenalty = order.sweepAllBorders ? distFocal * 0.04 : distFocal * 0.22 + distOrigin * 0.08;
          score =
            localDot * (order.sweepAllBorders ? 0.8 : 1.9) -
            anchorPenalty +
            friendly * 0.32 +
            terrainBonus +
            wildernessBonus +
            cleanupBonus +
            edgeNoise;
        } else {
          const dot = (dx * order.dirX + dy * order.dirY) / stepLen;
          if (dot < 0.2 && friendly < 3) {
            continue;
          }
          const relX = nx + 0.5 - order.originCenter.x;
          const relY = ny + 0.5 - order.originCenter.y;
          const lateralDist = relX * -order.dirY + relY * order.dirX;
          score =
            dot * 2.5 -
            lateralDist * lateralDist * 0.015 +
            friendly * 0.42 +
            terrainBonus +
            wildernessBonus +
            cleanupBonus +
            edgeNoise;
        }

        const existing = candidateBestScore.get(nIdx);
        if (!existing || score > existing.score) {
          candidateBestScore.set(nIdx, { nx, ny, score });
        }
      }

      if (hasTarget) {
        prunedFrontierSet.add(cellIdx);
      }
    }

    const candidates: ExpansionCandidate[] = [];
    for (const [idx, val] of candidateBestScore) {
      candidates.push({ idx, nx: val.nx, ny: val.ny, score: val.score });
    }

    const claimedCells: number[] = [];
    const res = applyExpansionCandidates(
      state,
      order,
      allowedEnemyIds,
      candidates,
      (claimedIdx) => {
        prunedFrontierSet.add(claimedIdx);
        claimedCells.push(claimedIdx);
      },
    );
    if (res.claimed) {
      mapChanged = true;
      if (res.capturedForeign) capturedForeign = true;
      order.stagnantTicks = 0;

      if (
        order.targetOwnerId >= 0 &&
        (order.finishOff || order.manpowerCommitted >= 60)
      ) {
        const sweepSeeds = order.finishOff
          ? claimedCells.concat(order.frontierCells.slice(0, 120))
          : claimedCells;
        const swept = sweepMicroPocketsForAttacker(
          state,
          order.playerId,
          order.targetOwnerId,
          order,
          sweepSeeds,
        );
        if (swept > 0) {
          mapChanged = true;
          capturedForeign = true;
        }
      }
    } else {
      order.stagnantTicks++;
      if (
        order.finishOff &&
        order.targetOwnerId >= 0 &&
        order.manpowerRemaining >= MIN_ACTIVE_ORDER_MANPOWER
      ) {
        const swept = sweepMicroPocketsForAttacker(
          state,
          order.playerId,
          order.targetOwnerId,
          order,
          order.frontierCells.slice(0, 120),
        );
        if (swept > 0) {
          mapChanged = true;
          capturedForeign = true;
          order.stagnantTicks = 0;
        }
      }
    }

    order.frontierCells = Array.from(prunedFrontierSet);

    const shouldTerminate =
      order.manpowerRemaining < MIN_ACTIVE_ORDER_MANPOWER ||
      order.ticksRemaining <= 0 ||
      order.stagnantTicks >= MAX_STAGNANT_TICKS ||
      order.frontierCells.length === 0 ||
      candidates.length === 0;

    if (shouldTerminate) {
      anyTerminated = true;
      refundRemainingManpower(player, order.manpowerRemaining);
    } else {
      remainingOrders.push(order);
    }
  }

  state.frontPushOrders = remainingOrders;
  return { mapChanged, capturedForeign, anyTerminated };
}

/**
 * Strictly deterministic pocket annexation (unrolled flat-index BFS):
 * Annexes a connected land component ONLY when 100% enclosed by one single state
 * and NEVER touching water, map edges, wilderness, or any third state.
 */
export function annexEncircledPockets(state: GameState): boolean {
  const { width, height, terrain, owners } = state;
  const total = width * height;
  const maxX = width - 1;
  const maxY = height - 1;
  const visited = total <= annexVisited.length ? annexVisited : new Uint8Array(total);
  const queue = total <= annexQueue.length ? annexQueue : new Int32Array(total);
  visited.fill(0, 0, total);
  let anyAnnexed = false;

  const occupiedUnitCells = new Set<number>();
  for (const u of state.units) {
    if (u.count > 0 && u.hp > 0) {
      const ux = Math.max(0, Math.min(width - 1, Math.floor(u.x)));
      const uy = Math.max(0, Math.min(height - 1, Math.floor(u.y)));
      occupiedUnitCells.add(uy * width + ux);
    }
  }

  for (let startIdx = 0; startIdx < total; startIdx++) {
    if (visited[startIdx] || terrain[startIdx] === TerrainType.WATER) {
      continue;
    }

    const regionOwner = owners[startIdx];
    let head = 0;
    let tail = 0;
    queue[tail++] = startIdx;
    visited[startIdx] = 1;

    let disqualified = occupiedUnitCells.has(startIdx);
    let singleEncloser: number | null = null;

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % width;
      const y = (idx - x) / width;

      if (x === 0 || x === maxX || y === 0 || y === maxY || occupiedUnitCells.has(idx)) {
        disqualified = true;
      }

      if (!disqualified) {
        const left = idx - 1;
        const right = idx + 1;
        const up = idx - width;
        const down = idx + width;

        // 4 cardinal neighbors: validate water/encloser AND push same-owner cells
        if (terrain[left] === TerrainType.WATER) {
          disqualified = true;
        } else {
          const o = owners[left];
          if (o === regionOwner) {
            if (!visited[left]) {
              visited[left] = 1;
              queue[tail++] = left;
            }
          } else if (o === WILDERNESS_OWNER) {
            disqualified = true;
          } else if (singleEncloser === null) {
            singleEncloser = o;
          } else if (singleEncloser !== o) {
            disqualified = true;
          }
        }

        if (terrain[right] === TerrainType.WATER) {
          disqualified = true;
        } else {
          const o = owners[right];
          if (o === regionOwner) {
            if (!visited[right]) {
              visited[right] = 1;
              queue[tail++] = right;
            }
          } else if (o === WILDERNESS_OWNER) {
            disqualified = true;
          } else if (singleEncloser === null) {
            singleEncloser = o;
          } else if (singleEncloser !== o) {
            disqualified = true;
          }
        }

        if (terrain[up] === TerrainType.WATER) {
          disqualified = true;
        } else {
          const o = owners[up];
          if (o === regionOwner) {
            if (!visited[up]) {
              visited[up] = 1;
              queue[tail++] = up;
            }
          } else if (o === WILDERNESS_OWNER) {
            disqualified = true;
          } else if (singleEncloser === null) {
            singleEncloser = o;
          } else if (singleEncloser !== o) {
            disqualified = true;
          }
        }

        if (terrain[down] === TerrainType.WATER) {
          disqualified = true;
        } else {
          const o = owners[down];
          if (o === regionOwner) {
            if (!visited[down]) {
              visited[down] = 1;
              queue[tail++] = down;
            }
          } else if (o === WILDERNESS_OWNER) {
            disqualified = true;
          } else if (singleEncloser === null) {
            singleEncloser = o;
          } else if (singleEncloser !== o) {
            disqualified = true;
          }
        }

        // 4 diagonal neighbors (disqualification only)
        if (!disqualified) {
          const ul = up - 1;
          if (terrain[ul] === TerrainType.WATER) {
            disqualified = true;
          } else {
            const o = owners[ul];
            if (o !== regionOwner) {
              if (o === WILDERNESS_OWNER) disqualified = true;
              else if (singleEncloser === null) singleEncloser = o;
              else if (singleEncloser !== o) disqualified = true;
            }
          }
        }
        if (!disqualified) {
          const ur = up + 1;
          if (terrain[ur] === TerrainType.WATER) {
            disqualified = true;
          } else {
            const o = owners[ur];
            if (o !== regionOwner) {
              if (o === WILDERNESS_OWNER) disqualified = true;
              else if (singleEncloser === null) singleEncloser = o;
              else if (singleEncloser !== o) disqualified = true;
            }
          }
        }
        if (!disqualified) {
          const dl = down - 1;
          if (terrain[dl] === TerrainType.WATER) {
            disqualified = true;
          } else {
            const o = owners[dl];
            if (o !== regionOwner) {
              if (o === WILDERNESS_OWNER) disqualified = true;
              else if (singleEncloser === null) singleEncloser = o;
              else if (singleEncloser !== o) disqualified = true;
            }
          }
        }
        if (!disqualified) {
          const dr = down + 1;
          if (terrain[dr] === TerrainType.WATER) {
            disqualified = true;
          } else {
            const o = owners[dr];
            if (o !== regionOwner) {
              if (o === WILDERNESS_OWNER) disqualified = true;
              else if (singleEncloser === null) singleEncloser = o;
              else if (singleEncloser !== o) disqualified = true;
            }
          }
        }
      } else {
        // Fast flood-fill of visited cells once the component is already disqualified
        if (x > 0) {
          const left = idx - 1;
          if (!visited[left] && terrain[left] !== TerrainType.WATER && owners[left] === regionOwner) {
            visited[left] = 1;
            queue[tail++] = left;
          }
        }
        if (x < maxX) {
          const right = idx + 1;
          if (
            !visited[right] &&
            terrain[right] !== TerrainType.WATER &&
            owners[right] === regionOwner
          ) {
            visited[right] = 1;
            queue[tail++] = right;
          }
        }
        if (y > 0) {
          const up = idx - width;
          if (!visited[up] && terrain[up] !== TerrainType.WATER && owners[up] === regionOwner) {
            visited[up] = 1;
            queue[tail++] = up;
          }
        }
        if (y < maxY) {
          const down = idx + width;
          if (!visited[down] && terrain[down] !== TerrainType.WATER && owners[down] === regionOwner) {
            visited[down] = 1;
            queue[tail++] = down;
          }
        }
      }
    }

    if (
      !disqualified &&
      singleEncloser !== null &&
      singleEncloser >= 0 &&
      singleEncloser !== regionOwner &&
      (regionOwner === WILDERNESS_OWNER ||
        getRelation(state, singleEncloser, regionOwner) !== 'ALLIED')
    ) {
      for (let i = 0; i < tail; i++) {
        owners[queue[i]] = singleEncloser;
      }
      anyAnnexed = true;
    }
  }

  return anyAnnexed;
}

export function stepFrontExpansion(state: GameState): void {
  const attackRes = stepAttackOrders(state);
  const pushRes = stepFrontPushOrders(state);
  if (attackRes.mapChanged || pushRes.mapChanged) {
    if (
      attackRes.capturedForeign ||
      pushRes.capturedForeign ||
      attackRes.anyTerminated ||
      pushRes.anyTerminated ||
      state.tick % 4 === 0
    ) {
      annexEncircledPockets(state);
    }
    state.stateVersion++;
  }
}
