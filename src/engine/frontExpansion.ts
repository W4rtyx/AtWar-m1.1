import {
  DiplomaticRelation,
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
const ENEMY_BORDER_BASE_COST = 3.2;

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

export function canOrderCaptureCell(
  state: GameState,
  playerId: number,
  targetOwnerId: number,
  cellOwner: number,
): boolean {
  if (cellOwner === playerId || cellOwner < WILDERNESS_OWNER) {
    return false;
  }
  if (cellOwner === WILDERNESS_OWNER) {
    return true;
  }
  if (targetOwnerId === WILDERNESS_OWNER) {
    return false;
  }
  return cellOwner === targetOwnerId && getRelation(state, playerId, cellOwner) === 'WAR';
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

/**
 * Simplifies raw mouse drag points via Ramer-Douglas-Peucker into 4..10 smooth control points,
 * optionally applying a perpendicular arc bend offset and clamping total length.
 */
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

function countFriendlyNeighbors(
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

/**
 * Claims an initial circular connected land patch around (centerX, centerY) via BFS,
 * ensuring islands or across-strait land are not accidentally claimed.
 */
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
  targetOwnerId: number;
  manpowerCommitted: number;
  manpowerRemaining: number;
  ticksRemaining: number;
  stagnantTicks: number;
  mountainAccum: number;
}

function computeCellCaptureCost(
  state: GameState,
  nx: number,
  ny: number,
  cellTerrain: TerrainType,
  prevOwner: number,
): { readonly effectiveCost: number; readonly defenderLoss: number; readonly isForeign: boolean } {
  const terrainFactor = cellTerrain === TerrainType.MOUNTAINS ? 1 / MOUNTAINS_SPEED : 1 / PLAINS_SPEED;

  if (prevOwner === WILDERNESS_OWNER) {
    return {
      effectiveCost: WILDERNESS_BASE_COST * terrainFactor,
      defenderLoss: 0,
      isForeign: false,
    };
  }

  const defender = state.players.get(prevOwner);
  const defenderRatio = defender
    ? defender.manpower / Math.max(100, defender.maxManpower)
    : 0;
  const defenderStrength = 0.75 + 0.85 * Math.min(1, defenderRatio / 0.55);
  const defenderNeighbors = countFriendlyNeighbors(state, nx, ny, prevOwner);
  const cohesionFactor = 0.75 + defenderNeighbors * 0.14;

  let effectiveCost =
    ENEMY_BORDER_BASE_COST * defenderStrength * cohesionFactor * terrainFactor;
  let defenderLoss = ENEMY_BORDER_BASE_COST * 0.72 * cohesionFactor;

  if (defender && defender.betrayalDebuffTicks > 0) {
    effectiveCost *= 0.65;
    defenderLoss *= 1.4;
  }

  return {
    effectiveCost,
    defenderLoss,
    isForeign: true,
  };
}

function applyExpansionCandidates(
  state: GameState,
  order: ExpandableOrder,
  candidates: ExpansionCandidate[],
  onClaim?: (claimedIdx: number) => void,
): boolean {
  if (candidates.length === 0) {
    return false;
  }

  candidates.sort((a, b) => b.score - a.score);

  const tickBudget = Math.min(
    order.manpowerRemaining,
    Math.max(4.5, order.manpowerCommitted * 0.16),
  );
  let budgetSpent = 0;
  let anyClaimed = false;

  for (const cand of candidates) {
    if (order.manpowerRemaining < MIN_ACTIVE_ORDER_MANPOWER) {
      break;
    }

    const prevOwner = state.owners[cand.idx];
    if (!canOrderCaptureCell(state, order.playerId, order.targetOwnerId, prevOwner)) {
      continue;
    }

    const cellTerrain = state.terrain[cand.idx];
    if (cellTerrain === TerrainType.WATER) {
      continue;
    }

    const { effectiveCost, defenderLoss, isForeign } = computeCellCaptureCost(
      state,
      cand.nx,
      cand.ny,
      cellTerrain,
      prevOwner,
    );

    if (budgetSpent + effectiveCost > tickBudget) {
      if (budgetSpent === 0 && (cellTerrain === TerrainType.MOUNTAINS || isForeign)) {
        const stepCharge = Math.min(tickBudget, order.manpowerRemaining);
        order.mountainAccum += stepCharge;

        if (isForeign) {
          const skirmishAttackerLoss = Math.min(order.manpowerRemaining, stepCharge * 0.35);
          order.manpowerRemaining -= skirmishAttackerLoss;
          const defender = state.players.get(prevOwner);
          if (defender && defender.alive) {
            const betrayalMul = defender.betrayalDebuffTicks > 0 ? 1.4 : 1.0;
            defender.manpower = Math.max(
              0,
              defender.manpower - stepCharge * 0.25 * betrayalMul,
            );
          }
        }

        if (
          order.mountainAccum >= effectiveCost &&
          order.manpowerRemaining >= effectiveCost
        ) {
          order.mountainAccum -= effectiveCost;
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

    state.owners[cand.idx] = order.playerId;
    order.manpowerRemaining -= effectiveCost;
    budgetSpent += effectiveCost;
    anyClaimed = true;

    if (isForeign) {
      const defender: PlayerState | undefined = state.players.get(prevOwner);
      if (defender && defender.alive) {
        defender.manpower = Math.max(0, defender.manpower - defenderLoss);
      }
    }

    if (onClaim) {
      onClaim(cand.idx);
    }
  }

  return anyClaimed;
}

interface CurveProjection {
  readonly arcDist: number;
  readonly perpDist: number;
  readonly tanX: number;
  readonly tanY: number;
}

/**
 * Projects a cell strictly onto segments overlapping the active forward arc window [minArc, maxArc].
 * This prevents an arrow drawn across an encircled enemy from locking onto distant own territory.
 */
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

function refundRemainingManpower(player: PlayerState, remaining: number): void {
  if (remaining > 0) {
    player.manpower = Math.min(player.maxManpower, player.manpower + remaining);
  }
}

function stepAttackOrders(state: GameState): boolean {
  const { width, height, owners, terrain } = state;
  let mapChanged = false;
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

    // Pass 1: advance frontierArc strictly within a contiguous forward window from origin
    const winMin = Math.max(0, order.frontierArc - 8);
    const winMax = Math.min(totalLen, order.frontierArc + 16);
    let maxWindowOwnedArc = order.frontierArc;

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
          proj.perpDist <= halfCorridor * 0.7 &&
          proj.arcDist >= winMin &&
          proj.arcDist <= winMax &&
          proj.arcDist > maxWindowOwnedArc
        ) {
          maxWindowOwnedArc = proj.arcDist;
        }
      }
    }

    order.frontierArc = Math.max(order.frontierArc, maxWindowOwnedArc);
    const rawProgress = totalLen > 0 ? Math.min(1, order.frontierArc / totalLen) : 1;
    order.segmentProgress = Math.max(order.segmentProgress, rawProgress);

    let segIdx = 0;
    while (segIdx < cumDist.length - 2 && cumDist[segIdx + 1] < order.frontierArc) {
      segIdx++;
    }
    order.currentSegmentIndex = segIdx;

    const activeMinArc = Math.max(0, order.frontierArc - 12);
    const activeMaxArc = Math.min(totalLen + 4, order.frontierArc + 12);
    const candidateBestScore = new Map<number, { nx: number; ny: number; score: number }>();

    // Pass 2: gather strictly bounded expansion targets along the active forward corridor
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
            !canOrderCaptureCell(state, order.playerId, order.targetOwnerId, nOwner)
          ) {
            continue;
          }

          const nProj = projectPointOntoWaypointsWindow(
            nx + 0.5,
            ny + 0.5,
            order.waypoints,
            cumDist,
            activeMinArc - 2,
            totalLen + 6,
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
          if (dot < 0.38) {
            continue;
          }

          const friendly = countFriendlyNeighbors(state, nx, ny, order.playerId);
          const terrainBonus = terrain[nIdx] === TerrainType.MOUNTAINS ? -0.55 : 0;
          const wildernessBonus = nOwner === WILDERNESS_OWNER ? 0.35 : -0.25;
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
            wildernessBonus;

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

    const claimed = applyExpansionCandidates(state, order, candidates);
    if (claimed) {
      mapChanged = true;
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
      refundRemainingManpower(player, order.manpowerRemaining);
    } else {
      remainingOrders.push(order);
    }
  }

  state.attackOrders = remainingOrders;
  return mapChanged;
}

function stepFrontPushOrders(state: GameState): boolean {
  const { width, height, owners, terrain } = state;
  let mapChanged = false;
  const remainingOrders = [];

  for (const order of state.frontPushOrders) {
    const player = state.players.get(order.playerId);
    if (!player || !player.alive) {
      continue;
    }

    order.ticksRemaining--;
    const activeFrontierSet = new Set<number>();
    const candidateBestScore = new Map<number, { nx: number; ny: number; score: number }>();

    for (const cellIdx of order.frontierCells) {
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
          !canOrderCaptureCell(state, order.playerId, order.targetOwnerId, nOwner)
        ) {
          continue;
        }

        hasTarget = true;
        const stepLen = Math.hypot(dx, dy);
        const dot = (dx * order.dirX + dy * order.dirY) / stepLen;
        if (dot < 0.25) {
          continue;
        }

        const friendly = countFriendlyNeighbors(state, nx, ny, order.playerId);
        const terrainBonus = terrain[nIdx] === TerrainType.MOUNTAINS ? -0.55 : 0;
        const wildernessBonus = nOwner === WILDERNESS_OWNER ? 0.35 : -0.2;
        const score = dot * 2.6 + friendly * 0.5 + terrainBonus + wildernessBonus;

        const existing = candidateBestScore.get(nIdx);
        if (!existing || score > existing.score) {
          candidateBestScore.set(nIdx, { nx, ny, score });
        }
      }

      if (hasTarget) {
        activeFrontierSet.add(cellIdx);
      }
    }

    const candidates: ExpansionCandidate[] = [];
    for (const [idx, val] of candidateBestScore) {
      candidates.push({ idx, nx: val.nx, ny: val.ny, score: val.score });
    }

    const claimed = applyExpansionCandidates(state, order, candidates, (claimedIdx) => {
      activeFrontierSet.add(claimedIdx);
    });
    if (claimed) {
      mapChanged = true;
      order.stagnantTicks = 0;
    } else {
      order.stagnantTicks++;
    }

    order.frontierCells = Array.from(activeFrontierSet);

    const shouldTerminate =
      order.manpowerRemaining < MIN_ACTIVE_ORDER_MANPOWER ||
      order.ticksRemaining <= 0 ||
      order.stagnantTicks >= MAX_STAGNANT_TICKS ||
      order.frontierCells.length === 0 ||
      candidates.length === 0;

    if (shouldTerminate) {
      refundRemainingManpower(player, order.manpowerRemaining);
    } else {
      remainingOrders.push(order);
    }
  }

  state.frontPushOrders = remainingOrders;
  return mapChanged;
}

/**
 * Immediately annexes enclosed empty pockets (wilderness or foreign state pockets without
 * access to water, map edge, or other neighbors) to the single encircling state.
 */
function annexEncircledPockets(state: GameState): boolean {
  const { width, height, terrain, owners, players } = state;
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let anyAnnexed = false;

  for (let startIdx = 0; startIdx < total; startIdx++) {
    if (visited[startIdx] || terrain[startIdx] === TerrainType.WATER) {
      continue;
    }

    const regionOwner = owners[startIdx];
    let head = 0;
    let tail = 0;
    queue[tail++] = startIdx;
    visited[startIdx] = 1;

    let touchesMapEdge = false;
    let touchesWater = false;
    let singleEncloser: number | null = null;
    let multipleEnclosers = false;
    let containsCapital = false;

    let capIdx = -1;
    if (regionOwner >= 0) {
      const p = players.get(regionOwner);
      if (p) {
        capIdx = p.capitalY * width + p.capitalX;
      }
    }

    while (head < tail) {
      const idx = queue[head++];
      if (idx === capIdx) {
        containsCapital = true;
      }

      const x = idx % width;
      const y = (idx - x) / width;

      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        touchesMapEdge = true;
      }

      for (const [dx, dy] of CARDINAL_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          touchesMapEdge = true;
          continue;
        }
        const nIdx = ny * width + nx;
        if (terrain[nIdx] === TerrainType.WATER) {
          touchesWater = true;
          continue;
        }
        const nOwner = owners[nIdx];
        if (nOwner === regionOwner) {
          if (!visited[nIdx]) {
            visited[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        } else {
          if (singleEncloser === null) {
            singleEncloser = nOwner;
          } else if (singleEncloser !== nOwner) {
            multipleEnclosers = true;
          }
        }
      }
    }

    if (
      !touchesMapEdge &&
      !touchesWater &&
      !multipleEnclosers &&
      singleEncloser !== null &&
      singleEncloser >= 0 &&
      singleEncloser !== regionOwner
    ) {
      const pocketSize = tail;
      const canAnnexWilderness =
        regionOwner === WILDERNESS_OWNER && pocketSize <= 2200;
      const canAnnexForeign =
        regionOwner >= 0 &&
        pocketSize < 3200 &&
        (!containsCapital || pocketSize <= 450);

      if (canAnnexWilderness || canAnnexForeign) {
        for (let i = 0; i < tail; i++) {
          owners[queue[i]] = singleEncloser;
        }
        anyAnnexed = true;
      }
    }
  }

  return anyAnnexed;
}

export function stepFrontExpansion(state: GameState): void {
  const changedByAttacks = stepAttackOrders(state);
  const changedByPushes = stepFrontPushOrders(state);
  if (changedByAttacks || changedByPushes) {
    annexEncircledPockets(state);
    state.stateVersion++;
  }
}
