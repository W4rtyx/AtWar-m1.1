import {
  AirUnitType,
  Building,
  GameState,
  GroundUnitType,
  NavalUnitType,
  Point,
  TerrainType,
  Unit,
  UnitType,
  WILDERNESS_OWNER,
  getRelationKey,
} from './types';

export const WATER_NAV_STEP = 3;
export const NAVAL_COAST_CLEARANCE = 2;
export const RADAR_STATION_VISION_RADIUS = 80;
export const AIRFIELD_OPERATION_RANGE = 130;
export const CLOSE_SONAR_RADIUS = 16;

export function getFireMissionSalvoIndustryCost(unitType: UnitType, count: number): number {
  const baseCost =
    unitType === 'ARTILLERY'
      ? 18
      : unitType === 'CRUISER'
        ? 28
        : unitType === 'BOMBER'
          ? 45
          : 0;
  if (baseCost <= 0) return 0;
  return Math.round(baseCost * Math.pow(Math.max(1, count), 0.7));
}

export function isNavalUnitType(type: UnitType): type is NavalUnitType {
  return (
    type === 'TRANSPORT_SHIP' ||
    type === 'CRUISER' ||
    type === 'SUBMARINE' ||
    type === 'RADAR_SHIP'
  );
}

export function isAirUnitType(type: UnitType): type is AirUnitType {
  return type === 'FIGHTER' || type === 'BOMBER' || type === 'RECON_PLANE';
}

export function isGroundUnitType(type: UnitType): type is GroundUnitType {
  return (
    type === 'INFANTRY' ||
    type === 'TANK' ||
    type === 'ARTILLERY' ||
    type === 'PARATROOPERS'
  );
}

export function supportsFireMission(type: UnitType): boolean {
  return type === 'ARTILLERY' || type === 'CRUISER' || type === 'BOMBER';
}

export function isPassableWaterCell(
  state: GameState,
  ix: number,
  iy: number,
): boolean {
  if (ix < 0 || ix >= state.width || iy < 0 || iy >= state.height) {
    return false;
  }
  return state.terrain[iy * state.width + ix] === TerrainType.WATER;
}

export function findNearestWaterCell(
  state: GameState,
  x: number,
  y: number,
  maxRadius = 4,
): Point | null {
  const cx = Math.max(0, Math.min(state.width - 1, Math.floor(x)));
  const cy = Math.max(0, Math.min(state.height - 1, Math.floor(y)));
  if (isPassableWaterCell(state, cx, cy)) {
    return { x: cx + 0.5, y: cy + 0.5 };
  }

  let best: Point | null = null;
  let bestDistSq = Infinity;
  const rSq = maxRadius * maxRadius;
  for (let dy = -maxRadius; dy <= maxRadius; dy++) {
    const ny = cy + dy;
    if (ny < 0 || ny >= state.height) continue;
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      const dSq = dx * dx + dy * dy;
      if (dSq > rSq || dSq >= bestDistSq) continue;
      const nx = cx + dx;
      if (nx < 0 || nx >= state.width) continue;
      if (state.terrain[ny * state.width + nx] === TerrainType.WATER) {
        bestDistSq = dSq;
        best = { x: nx + 0.5, y: ny + 0.5 };
      }
    }
  }
  return best;
}

export function findNearestCoastalLandCell(
  state: GameState,
  playerId: number,
  x: number,
  y: number,
  maxRadius = 3,
): Point | null {
  const cx = Math.max(0, Math.min(state.width - 1, Math.floor(x)));
  const cy = Math.max(0, Math.min(state.height - 1, Math.floor(y)));
  let best: Point | null = null;
  let bestDistSq = Infinity;
  const rSq = maxRadius * maxRadius;

  for (let dy = -maxRadius; dy <= maxRadius; dy++) {
    const ny = cy + dy;
    if (ny < 0 || ny >= state.height) continue;
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      const dSq = dx * dx + dy * dy;
      if (dSq > rSq || dSq >= bestDistSq) continue;
      const nx = cx + dx;
      if (nx < 0 || nx >= state.width) continue;
      const idx = ny * state.width + nx;
      if (state.terrain[idx] === TerrainType.WATER) continue;
      const owner = state.owners[idx];
      const rel =
        owner >= 0 && owner !== playerId
          ? (state.relations.get(getRelationKey(playerId, owner)) ?? 'NEUTRAL')
          : 'NEUTRAL';
      if (
        owner === playerId ||
        owner === WILDERNESS_OWNER ||
        (owner >= 0 && (rel === 'WAR' || rel === 'ALLIED'))
      ) {
        bestDistSq = dSq;
        best = { x: nx + 0.5, y: ny + 0.5 };
      }
    }
  }
  return best;
}

export function hasWaterClearance(
  state: GameState,
  ix: number,
  iy: number,
  clearance = NAVAL_COAST_CLEARANCE,
): boolean {
  if (
    ix - clearance < 0 ||
    ix + clearance >= state.width ||
    iy - clearance < 0 ||
    iy + clearance >= state.height
  ) {
    return false;
  }
  const { width, terrain } = state;
  for (let dy = -clearance; dy <= clearance; dy++) {
    const row = (iy + dy) * width;
    for (let dx = -clearance; dx <= clearance; dx++) {
      if (terrain[row + ix + dx] !== TerrainType.WATER) {
        return false;
      }
    }
  }
  return true;
}

export function hasDirectWaterLine(
  state: GameState,
  a: Point,
  b: Point,
  clearance = 0,
): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / 0.4));
  let prevX = Math.max(0, Math.min(state.width - 1, Math.floor(a.x)));
  let prevY = Math.max(0, Math.min(state.height - 1, Math.floor(a.y)));
  if (!isPassableWaterCell(state, prevX, prevY)) {
    return false;
  }

  const endpointExemption = clearance + 1.5;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const sx = a.x + (b.x - a.x) * t;
    const sy = a.y + (b.y - a.y) * t;
    const px = Math.max(0, Math.min(state.width - 1, Math.floor(sx)));
    const py = Math.max(0, Math.min(state.height - 1, Math.floor(sy)));
    if (!isPassableWaterCell(state, px, py)) {
      return false;
    }
    // Prevent diagonal corner-cutting across land cells
    if (px !== prevX && py !== prevY) {
      if (
        !isPassableWaterCell(state, prevX, py) ||
        !isPassableWaterCell(state, px, prevY)
      ) {
        return false;
      }
    }
    if (
      clearance > 0 &&
      Math.hypot(sx - a.x, sy - a.y) > endpointExemption &&
      Math.hypot(b.x - sx, b.y - sy) > endpointExemption &&
      !hasWaterClearance(state, px, py, clearance)
    ) {
      return false;
    }
    prevX = px;
    prevY = py;
  }
  return true;
}

function findWaterBlockAnchor(
  state: GameState,
  gx: number,
  gy: number,
  requireClearance: boolean,
): Point | null {
  const x0 = gx * WATER_NAV_STEP;
  const y0 = gy * WATER_NAV_STEP;
  const cx = x0 + WATER_NAV_STEP * 0.5;
  const cy = y0 + WATER_NAV_STEP * 0.5;
  let best: Point | null = null;
  let bestScore = -Infinity;

  for (let dy = 0; dy < WATER_NAV_STEP; dy++) {
    const y = y0 + dy;
    if (y >= state.height) continue;
    for (let dx = 0; dx < WATER_NAV_STEP; dx++) {
      const x = x0 + dx;
      if (x >= state.width) continue;
      if (!isPassableWaterCell(state, x, y)) continue;

      const clear2 = hasWaterClearance(state, x, y, NAVAL_COAST_CLEARANCE);
      if (requireClearance && !clear2) continue;
      const clear1 = clear2 || hasWaterClearance(state, x, y, 1);

      let waterNeighbors = 0;
      if (isPassableWaterCell(state, x + 1, y)) waterNeighbors++;
      if (isPassableWaterCell(state, x - 1, y)) waterNeighbors++;
      if (isPassableWaterCell(state, x, y + 1)) waterNeighbors++;
      if (isPassableWaterCell(state, x, y - 1)) waterNeighbors++;

      const dSq = (x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy);
      const clearanceBonus = clear2 ? 1000 : clear1 ? 300 : 0;
      const score = clearanceBonus + waterNeighbors * 10 - dSq;
      if (score > bestScore) {
        bestScore = score;
        best = { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  return best;
}

interface WaterHeapNode {
  readonly idx: number;
  readonly f: number;
}

function runWaterAStar(
  state: GameState,
  startWater: Point,
  goalWater: Point,
  requireClearance: boolean,
): Point[] | null {
  const gw = Math.ceil(state.width / WATER_NAV_STEP);
  const gh = Math.ceil(state.height / WATER_NAV_STEP);
  const total = gw * gh;

  const startGx = Math.max(0, Math.min(gw - 1, Math.floor(startWater.x / WATER_NAV_STEP)));
  const startGy = Math.max(0, Math.min(gh - 1, Math.floor(startWater.y / WATER_NAV_STEP)));
  const goalGx = Math.max(0, Math.min(gw - 1, Math.floor(goalWater.x / WATER_NAV_STEP)));
  const goalGy = Math.max(0, Math.min(gh - 1, Math.floor(goalWater.y / WATER_NAV_STEP)));

  const startNode = startGy * gw + startGx;
  const goalNode = goalGy * gw + goalGx;

  const anchorCache = new Map<number, Point | null>();
  anchorCache.set(startNode, startWater);
  anchorCache.set(goalNode, goalWater);

  const getAnchor = (nIdx: number): Point | null => {
    const cached = anchorCache.get(nIdx);
    if (cached !== undefined) return cached;
    const gx = nIdx % gw;
    const gy = (nIdx - gx) / gw;
    const found = findWaterBlockAnchor(state, gx, gy, requireClearance);
    anchorCache.set(nIdx, found);
    return found;
  };

  const gScore = new Float32Array(total);
  gScore.fill(Infinity);
  const cameFrom = new Int32Array(total);
  cameFrom.fill(-1);
  const closed = new Uint8Array(total);

  const heap: WaterHeapNode[] = [];
  const heapPush = (node: WaterHeapNode): void => {
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
  const heapPop = (): WaterHeapNode => {
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
    f: Math.hypot(goalWater.x - startWater.x, goalWater.y - startWater.y),
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
        if (!getAnchor(uy * gw + vx) || !getAnchor(vy * gw + ux)) {
          continue;
        }
      }

      const vAnchor = getAnchor(v);
      if (!vAnchor) continue;
      const edgeClearance = requireClearance && u !== startNode && v !== goalNode ? 1 : 0;
      if (!hasDirectWaterLine(state, uAnchor, vAnchor, edgeClearance)) {
        continue;
      }

      const vIx = Math.floor(vAnchor.x);
      const vIy = Math.floor(vAnchor.y);
      const coastalPenalty =
        !requireClearance && u !== startNode && v !== goalNode
          ? hasWaterClearance(state, vIx, vIy, NAVAL_COAST_CLEARANCE)
            ? 1.0
            : hasWaterClearance(state, vIx, vIy, 1)
              ? 1.5
              : 2.8
          : 1.0;

      const stepCost = Math.hypot(vAnchor.x - uAnchor.x, vAnchor.y - uAnchor.y) * coastalPenalty;
      const tentativeG = gScore[u] + stepCost;
      if (tentativeG < gScore[v]) {
        cameFrom[v] = u;
        gScore[v] = tentativeG;
        const h = Math.hypot(goalWater.x - vAnchor.x, goalWater.y - vAnchor.y);
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
  rawPts[0] = startWater;
  rawPts[rawPts.length - 1] = goalWater;

  const smoothClearance = 1;
  const smoothed: Point[] = [];
  let i = 0;
  while (i < rawPts.length - 1) {
    let nextIdx = i + 1;
    for (let j = rawPts.length - 1; j > i + 1; j--) {
      if (hasDirectWaterLine(state, rawPts[i], rawPts[j], smoothClearance)) {
        nextIdx = j;
        break;
      }
    }
    smoothed.push(rawPts[nextIdx]);
    i = nextIdx;
  }

  return smoothed.length > 0 ? smoothed : [goalWater];
}

/**
 * Coarse-grid (3x3 cell) A* water pathfinder with 2-cell coastal clearance preference,
 * strict 0.4-step line-of-sight edge checks, and greedy smoothing. Reliably navigates
 * naval ships around jagged peninsulas and coastlines without scraping shore.
 */
export function findWaterPath(
  state: GameState,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
): Point[] | null {
  const startWater = findNearestWaterCell(state, startX, startY, 4);
  if (!startWater) {
    return null;
  }
  const goalWater = findNearestWaterCell(state, goalX, goalY, 3);
  if (!goalWater) {
    return null;
  }

  if (hasDirectWaterLine(state, startWater, goalWater, NAVAL_COAST_CLEARANCE)) {
    return [goalWater];
  }

  return (
    runWaterAStar(state, startWater, goalWater, true) ??
    runWaterAStar(state, startWater, goalWater, false)
  );
}

export function findAirfieldCoveringPoint(
  state: GameState,
  playerId: number,
  targetX: number,
  targetY: number,
  airRange: number,
): Building | null {
  let best: Building | null = null;
  let bestDist = airRange;
  for (const b of state.buildings) {
    if (b.ownerId !== playerId || b.type !== 'AIRFIELD' || b.stackCount <= 0) {
      continue;
    }
    const dist = Math.hypot(b.x + 0.5 - targetX, b.y + 0.5 - targetY);
    if (dist <= bestDist) {
      bestDist = dist;
      best = b;
    }
  }
  return best;
}

export function findNearbyOwnedPort(
  state: GameState,
  playerId: number,
  x: number,
  y: number,
  maxRadius = 16,
): { readonly port: Building; readonly waterPoint: Point } | null {
  let best: { readonly port: Building; readonly waterPoint: Point } | null = null;
  let bestDist = maxRadius;

  for (const b of state.buildings) {
    if (b.ownerId !== playerId || b.type !== 'PORT' || b.stackCount <= 0) {
      continue;
    }
    const dist = Math.hypot(b.x + 0.5 - x, b.y + 0.5 - y);
    if (dist > bestDist) continue;
    const waterPt = findNearestWaterCell(state, b.x + 0.5, b.y + 0.5, 4);
    if (waterPt) {
      bestDist = dist;
      best = { port: b, waterPoint: waterPt };
    }
  }
  return best;
}

/**
 * Disembarks a TRANSPORT_SHIP onto coastal land (WILDERNESS, WAR enemy, or own/allied shore),
 * claiming a small coastal beachhead and restoring the carried ground unit stack.
 */
export function disembarkTransportShip(
  state: GameState,
  transport: Unit,
  landingX: number,
  landingY: number,
  cargoHpPerUnit: number,
): boolean {
  const ix = Math.max(0, Math.min(state.width - 1, Math.floor(landingX)));
  const iy = Math.max(0, Math.min(state.height - 1, Math.floor(landingY)));
  const landingIdx = iy * state.width + ix;
  if (state.terrain[landingIdx] === TerrainType.WATER) {
    return false;
  }

  const landingOwner = state.owners[landingIdx];
  const rel =
    landingOwner >= 0 && landingOwner !== transport.ownerId
      ? (state.relations.get(getRelationKey(transport.ownerId, landingOwner)) ?? 'NEUTRAL')
      : 'NEUTRAL';
  if (landingOwner >= 0 && landingOwner !== transport.ownerId && rel === 'NEUTRAL') {
    return false;
  }

  for (let dy = -2; dy <= 2; dy++) {
    const ny = iy + dy;
    if (ny < 0 || ny >= state.height) continue;
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 6) continue;
      const nx = ix + dx;
      if (nx < 0 || nx >= state.width) continue;
      const idx = ny * state.width + nx;
      if (state.terrain[idx] === TerrainType.WATER) continue;
      const o = state.owners[idx];
      if (o === WILDERNESS_OWNER) {
        state.owners[idx] = transport.ownerId;
      } else if (o >= 0 && o !== transport.ownerId) {
        const oRel = state.relations.get(getRelationKey(transport.ownerId, o)) ?? 'NEUTRAL';
        if (oRel === 'WAR') {
          state.owners[idx] = transport.ownerId;
        }
      }
    }
  }

  const cargoType: GroundUnitType = transport.cargoUnitType ?? 'INFANTRY';
  const hpFraction = Math.max(0.25, Math.min(1, transport.hp / Math.max(1, transport.maxHp)));
  const landedMaxHp = transport.count * cargoHpPerUnit;

  transport.type = cargoType;
  transport.cargoUnitType = null;
  transport.x = ix + 0.5;
  transport.y = iy + 0.5;
  transport.maxHp = landedMaxHp;
  transport.hp = Math.max(1, landedMaxHp * hpFraction);
  transport.targetX = null;
  transport.targetY = null;
  transport.waypoints = [];
  transport.manualOrder = false;
  transport.attachedOrderId = null;
  transport.attachedOrderKind = null;
  transport.isEncircled = false;

  state.stateVersion++;
  return true;
}
