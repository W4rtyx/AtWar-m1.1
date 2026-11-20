import { spawnBots, stepBots } from './bots';
import {
  createCapitalCityBuilding,
  demolishBuilding,
  placeBuilding,
  stackBuilding,
  stepBuildingConstruction,
  syncBuildingOwnership,
} from './buildings';
import {
  OPTIMUM_FILL_RATIO,
  areNeighbors,
  computeTradePairIncomePerSec,
  createInitialPlayerState,
  recomputeNeighborPairs,
  syncTerritoriesCapitalsAndNeighbors,
  updateAllPlayersEconomy,
} from './economy';
import {
  MAX_ARROW_PATH_LENGTH,
  MAX_ORDER_TICKS,
  MIN_ACTIVE_ORDER_MANPOWER,
  addEnemyAdjacentFrontierCells,
  buildSmoothAttackWaypoints,
  canOrderCaptureCell,
  claimInitialTerritory,
  clampPolylineLength,
  collectCenterlineWarEnemies,
  computePolylineLength,
  estimateFinishOffManpower,
  getRelation,
  isBorderCell,
  isFinishOffTargetSmall,
  setWarRelation,
  stepFrontExpansion,
} from './frontExpansion';
import { generateEuropeMap } from './mapGenerator';
import {
  Action,
  BETRAYAL_DEBUFF_TICKS,
  BETRAYAL_MONEY_PENALTY_RATIO,
  Building,
  ClientRenderState,
  DiplomaticRelation,
  GameState,
  MANPOWER_BUILDING_TYPES,
  PlayerState,
  Point,
  PublicBuildingInfo,
  PublicPlayerInfo,
  TICK_DT,
  TerrainType,
  WILDERNESS_OWNER,
  getRelationKey,
} from './types';

const HUMAN_PLAYER_ID = 1;
const HUMAN_START_RADIUS = 14;
const BOT_COUNT = 11;

export interface SpeedStepPlan {
  readonly ticksToRun: number;
  readonly nextAccumulatorSec: number;
  readonly maxTicksPerFrame: number;
}

/**
 * Computes exact fixed-timestep simulation steps for the elapsed real frame time scaled by simSpeed,
 * allowing 1x (10 ticks/s) through 50x (500 ticks/s) without premature per-frame throttling.
 */
export function planSimulationTicks(
  currentAccumulatorSec: number,
  dtSec: number,
  simSpeed: number,
): SpeedStepPlan {
  const clampedDt = Math.min(0.1, Math.max(0, dtSec));
  const maxAccumulator = Math.max(1.0, simSpeed * 0.35);
  const added = Math.min(maxAccumulator, Math.max(0, currentAccumulatorSec) + clampedDt * simSpeed);
  const maxTicksPerFrame = Math.min(100, Math.max(2, Math.ceil(simSpeed * 1.8)));
  const availableTicks = Math.floor(added / TICK_DT + 1e-9);
  const ticksToRun = Math.min(availableTicks, maxTicksPerFrame);
  const nextAccumulatorSec = Math.max(0, added - ticksToRun * TICK_DT);
  return {
    ticksToRun,
    nextAccumulatorSec,
    maxTicksPerFrame,
  };
}

function createBaseState(seed: number): GameState {
  const generated = generateEuropeMap(seed);
  return {
    tick: 0,
    phase: 'SELECT_START',
    paused: false,
    width: generated.width,
    height: generated.height,
    totalLandCells: generated.totalLandCells,
    terrain: generated.terrain,
    owners: generated.owners,
    players: new Map<number, PlayerState>(),
    humanPlayerId: HUMAN_PLAYER_ID,
    relations: new Map<string, DiplomaticRelation>(),
    tradeAgreements: new Set<string>(),
    neighborPairs: new Set<string>(),
    buildings: [],
    nextBuildingId: 1,
    lastTerritorySyncVersion: -1,
    attackOrders: [],
    frontPushOrders: [],
    publicResourceZones: generated.publicResourceZones,
    secretResourceZones: generated.secretResourceZones,
    nextOrderId: 1,
    rngState: seed,
    stateVersion: 1,
  };
}

export function createInitialGameState(seed = 20261120): GameState {
  return createBaseState(seed);
}

function findNearestOwnedPoint(
  state: GameState,
  x: number,
  y: number,
  playerId: number,
  maxRadius: number,
): Point | null {
  const { width, height, owners } = state;
  const ix = Math.round(x);
  const iy = Math.round(y);
  let bestDist = Infinity;
  let bestPt: Point | null = null;

  for (let dy = -maxRadius; dy <= maxRadius; dy++) {
    const ny = iy + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      const nx = ix + dx;
      if (nx < 0 || nx >= width) continue;
      if (owners[ny * width + nx] === playerId) {
        const d = Math.hypot(nx + 0.5 - x, ny + 0.5 - y);
        if (d < bestDist) {
          bestDist = d;
          bestPt = { x: nx + 0.5, y: ny + 0.5 };
        }
      }
    }
  }
  return bestPt;
}

function isNearPlayerTerritory(
  state: GameState,
  x: number,
  y: number,
  playerId: number,
  maxRadius: number,
): boolean {
  return findNearestOwnedPoint(state, x, y, playerId, maxRadius) !== null;
}

function recalculateTerritoryAndCapitals(state: GameState): void {
  const { width, height, owners, players } = state;
  for (const player of players.values()) {
    player.territoryCells = 0;
  }

  for (let i = 0; i < owners.length; i++) {
    const owner = owners[i];
    if (owner >= 0) {
      const p = players.get(owner);
      if (p) {
        p.territoryCells++;
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
      for (let y = 0; y < height; y++) {
        let found = false;
        for (let x = 0; x < width; x++) {
          if (owners[y * width + x] === player.id) {
            player.capitalX = x;
            player.capitalY = y;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
  }
}

function declareWar(state: GameState, actorId: number, targetId: number): void {
  if (actorId === targetId) return;
  const actor = state.players.get(actorId);
  const target = state.players.get(targetId);
  if (!actor || !actor.alive || !target || !target.alive) {
    return;
  }

  const prev = getRelation(state, actorId, targetId);
  if (prev === 'WAR') {
    return;
  }

  if (prev === 'ALLIED') {
    actor.betrayalDebuffTicks = BETRAYAL_DEBUFF_TICKS;
    actor.money = Math.max(0, actor.money * (1 - BETRAYAL_MONEY_PENALTY_RATIO));
  }

  state.tradeAgreements.delete(getRelationKey(actorId, targetId));
  setWarRelation(state, actorId, targetId);
  updateAllPlayersEconomy(state, false);
}

function isOrderDirectedAtState(
  state: GameState,
  waypoints: ReadonlyArray<Point>,
  targetStateId: number,
): boolean {
  for (const wp of waypoints) {
    if (isNearPlayerTerritory(state, wp.x, wp.y, targetStateId, 24)) {
      return true;
    }
  }
  return false;
}

function doesFrontBorderState(
  state: GameState,
  cells: ReadonlyArray<number>,
  targetStateId: number,
): boolean {
  const { width, height, owners } = state;
  for (const idx of cells) {
    const x = idx % width;
    const y = (idx - x) / width;
    for (let dy = -2; dy <= 2; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        if (owners[ny * width + nx] === targetStateId) {
          return true;
        }
      }
    }
  }
  return false;
}

function cancelOrdersBetween(state: GameState, aId: number, bId: number): void {
  const playerA = state.players.get(aId);
  const playerB = state.players.get(bId);
  let refundA = 0;
  let refundB = 0;

  state.attackOrders = state.attackOrders.filter((order) => {
    if (order.playerId === aId && isOrderDirectedAtState(state, order.waypoints, bId)) {
      refundA += order.manpowerRemaining;
      return false;
    }
    if (order.playerId === bId && isOrderDirectedAtState(state, order.waypoints, aId)) {
      refundB += order.manpowerRemaining;
      return false;
    }
    return true;
  });

  state.frontPushOrders = state.frontPushOrders.filter((order) => {
    if (order.playerId === aId && doesFrontBorderState(state, order.frontierCells, bId)) {
      refundA += order.manpowerRemaining;
      return false;
    }
    if (order.playerId === bId && doesFrontBorderState(state, order.frontierCells, aId)) {
      refundB += order.manpowerRemaining;
      return false;
    }
    return true;
  });

  if (playerA && refundA > 0) {
    playerA.manpower = Math.min(playerA.maxManpower, playerA.manpower + refundA);
  }
  if (playerB && refundB > 0) {
    playerB.manpower = Math.min(playerB.maxManpower, playerB.manpower + refundB);
  }
  if (refundA > 0 || refundB > 0) {
    updateAllPlayersEconomy(state, false);
  }
}

function makePeace(state: GameState, actorId: number, targetId: number): void {
  if (actorId === targetId) return;
  const actor = state.players.get(actorId);
  const target = state.players.get(targetId);
  if (!actor || !actor.alive || !target || !target.alive) {
    return;
  }
  if (getRelation(state, actorId, targetId) !== 'WAR') {
    return;
  }

  state.relations.set(getRelationKey(actorId, targetId), 'NEUTRAL');
  cancelOrdersBetween(state, actorId, targetId);
  state.stateVersion++;
}

function toggleAlliance(state: GameState, actorId: number, targetId: number): void {
  if (actorId === targetId) return;
  const actor = state.players.get(actorId);
  const target = state.players.get(targetId);
  if (!actor || !actor.alive || !target || !target.alive) {
    return;
  }

  const current = getRelation(state, actorId, targetId);
  if (current === 'WAR') {
    return;
  }

  const next: DiplomaticRelation = current === 'ALLIED' ? 'NEUTRAL' : 'ALLIED';
  state.relations.set(getRelationKey(actorId, targetId), next);
  state.stateVersion++;
}

function toggleTrade(state: GameState, actorId: number, targetId: number): void {
  if (actorId === targetId) return;
  const actor = state.players.get(actorId);
  const target = state.players.get(targetId);
  if (!actor || !actor.alive || !target || !target.alive) {
    return;
  }

  const key = getRelationKey(actorId, targetId);
  if (state.tradeAgreements.has(key)) {
    state.tradeAgreements.delete(key);
    updateAllPlayersEconomy(state, false);
    state.stateVersion++;
    return;
  }

  if (!areNeighbors(state, actorId, targetId) || getRelation(state, actorId, targetId) === 'WAR') {
    return;
  }

  state.tradeAgreements.add(key);
  updateAllPlayersEconomy(state, false);
  state.stateVersion++;
}

function handleSelectStart(state: GameState, x: number, y: number): void {
  if (state.phase !== 'SELECT_START') {
    return;
  }
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= state.width || iy < 0 || iy >= state.height) {
    return;
  }
  const idx = iy * state.width + ix;
  if (state.terrain[idx] === TerrainType.WATER || state.owners[idx] !== WILDERNESS_OWNER) {
    return;
  }

  const claimed = claimInitialTerritory(state, HUMAN_PLAYER_ID, ix, iy, HUMAN_START_RADIUS);
  if (claimed === 0) {
    return;
  }

  const humanPlayer = createInitialPlayerState({
    id: HUMAN_PLAYER_ID,
    name: 'Republika (Vy)',
    isBot: false,
    colorHex: '#3b6e8c',
    colorRgb: [59, 110, 140],
    capitalX: ix,
    capitalY: iy,
    territoryCells: claimed,
    nextBotDecisionTick: 0,
  });

  state.players.set(HUMAN_PLAYER_ID, humanPlayer);
  spawnBots(state, BOT_COUNT);
  recalculateTerritoryAndCapitals(state);
  recomputeNeighborPairs(state);

  for (const player of state.players.values()) {
    createCapitalCityBuilding(state, player.id, player.capitalX, player.capitalY);
  }

  updateAllPlayersEconomy(state, false);
  for (const player of state.players.values()) {
    player.manpower = Math.round(player.maxManpower * OPTIMUM_FILL_RATIO);
  }
  updateAllPlayersEconomy(state, false);

  state.phase = 'PLAYING';
  state.paused = false;
  state.stateVersion++;
  state.lastTerritorySyncVersion = state.stateVersion;
}

function handleCreateAttackOrder(
  state: GameState,
  playerId: number,
  rawWaypoints: ReadonlyArray<Point>,
  manpowerPercent: number,
  explicitTargetOwnerId?: number,
): void {
  if (state.phase !== 'PLAYING' || rawWaypoints.length < 2) {
    return;
  }
  const player = state.players.get(playerId);
  if (!player || !player.alive) {
    return;
  }

  const anchoredOrigin = findNearestOwnedPoint(
    state,
    rawWaypoints[0].x,
    rawWaypoints[0].y,
    playerId,
    6,
  );
  if (!anchoredOrigin) {
    return;
  }

  const anchoredInput: Point[] = [anchoredOrigin, ...rawWaypoints.slice(1)];
  const waypoints = buildSmoothAttackWaypoints(anchoredInput);
  const totalPathLength = computePolylineLength(waypoints);
  if (waypoints.length < 2 || totalPathLength < 6) {
    return;
  }

  const wildernessOnly = explicitTargetOwnerId === WILDERNESS_OWNER;
  let targetOwnerIds: number[];
  if (wildernessOnly) {
    targetOwnerIds = [];
  } else if (
    explicitTargetOwnerId !== undefined &&
    explicitTargetOwnerId >= 0 &&
    explicitTargetOwnerId !== playerId &&
    getRelation(state, playerId, explicitTargetOwnerId) === 'WAR'
  ) {
    targetOwnerIds = [explicitTargetOwnerId];
  } else {
    targetOwnerIds = collectCenterlineWarEnemies(state, playerId, waypoints);
  }

  const clampedPct = Math.max(10, Math.min(100, manpowerPercent));
  const activeMp = Math.max(0, player.manpower - player.allocatedManpower);
  const committed = activeMp * (clampedPct / 100);
  if (committed < MIN_ACTIVE_ORDER_MANPOWER) {
    return;
  }

  player.manpower -= committed;
  updateAllPlayersEconomy(state, false);

  state.attackOrders.push({
    id: state.nextOrderId++,
    playerId,
    origin: anchoredOrigin,
    waypoints,
    frontierArc: 0,
    targetOwnerIds,
    wildernessOnly,
    currentSegmentIndex: 0,
    segmentProgress: 0,
    totalPathLength,
    manpowerCommitted: committed,
    manpowerRemaining: committed,
    ticksRemaining: MAX_ORDER_TICKS,
    maxTicks: MAX_ORDER_TICKS,
    stagnantTicks: 0,
    mountainAccum: 0,
  });
}

function handleBendAttackOrder(
  state: GameState,
  playerId: number,
  orderId: number,
  waypointIndex: number,
  x: number,
  y: number,
): void {
  if (state.phase !== 'PLAYING') {
    return;
  }
  const order = state.attackOrders.find(
    (o) => o.id === orderId && o.playerId === playerId,
  );
  if (!order || order.waypoints.length < 3) {
    return;
  }
  if (waypointIndex <= 0 || waypointIndex >= order.waypoints.length - 1) {
    return;
  }

  const clampedX = Math.max(0, Math.min(state.width - 1, x));
  const clampedY = Math.max(0, Math.min(state.height - 1, y));

  const nextWaypoints = order.waypoints.map((pt, idx) =>
    idx === waypointIndex ? { x: clampedX, y: clampedY } : pt,
  );
  const bounded = clampPolylineLength(nextWaypoints, MAX_ARROW_PATH_LENGTH);
  order.waypoints = bounded;
  order.totalPathLength = computePolylineLength(bounded);
  order.stagnantTicks = 0;
}

function inferFrontTargetOwner(
  state: GameState,
  playerId: number,
  cells: ReadonlyArray<number>,
  dirX: number,
  dirY: number,
  explicitTargetOwnerId?: number,
): number {
  if (explicitTargetOwnerId !== undefined) {
    return explicitTargetOwnerId;
  }
  const { width, height, owners, terrain } = state;
  const warCounts = new Map<number, number>();
  let wildCount = 0;

  for (const idx of cells) {
    const cx = idx % width;
    const cy = (idx - cx) / width;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= width) continue;
        const stepLen = Math.hypot(dx, dy);
        if ((dx * dirX + dy * dirY) / stepLen < 0.25) continue;
        const nIdx = ny * width + nx;
        if (terrain[nIdx] === TerrainType.WATER) continue;
        const nOwner = owners[nIdx];
        if (nOwner === WILDERNESS_OWNER) {
          wildCount++;
        } else if (
          nOwner >= 0 &&
          nOwner !== playerId &&
          getRelation(state, playerId, nOwner) === 'WAR'
        ) {
          warCounts.set(nOwner, (warCounts.get(nOwner) ?? 0) + 1);
        }
      }
    }
  }

  let bestWarOwner = -1;
  let bestCount = 0;
  for (const [owner, count] of warCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestWarOwner = owner;
    }
  }

  if (bestWarOwner >= 0 && (wildCount === 0 || bestCount >= wildCount * 0.5)) {
    return bestWarOwner;
  }
  return WILDERNESS_OWNER;
}

function handleCreateFrontPushOrder(
  state: GameState,
  playerId: number,
  frontierCells: ReadonlyArray<number>,
  dirX: number,
  dirY: number,
  manpowerPercent: number,
  explicitTargetOwnerId?: number,
  focalPoint?: Point,
  sweepAllBorders?: boolean,
  finishOff?: boolean,
  explicitCommittedManpower?: number,
): void {
  if (state.phase !== 'PLAYING') {
    return;
  }
  const player = state.players.get(playerId);
  if (!player || !player.alive) {
    return;
  }

  const len = Math.hypot(dirX, dirY);
  if (len < 0.001) {
    return;
  }
  const ux = dirX / len;
  const uy = dirY / len;

  const validCells = new Set<number>();
  const totalCells = state.width * state.height;
  for (const idx of frontierCells) {
    if (idx >= 0 && idx < totalCells && state.owners[idx] === playerId) {
      const cx = idx % state.width;
      const cy = (idx - cx) / state.width;
      if (isBorderCell(state, cx, cy, playerId)) {
        validCells.add(idx);
      }
    }
  }
  if (validCells.size === 0) {
    return;
  }

  const cellList = Array.from(validCells);
  let sumX = 0;
  let sumY = 0;
  for (const idx of cellList) {
    const cx = idx % state.width;
    const cy = (idx - cx) / state.width;
    sumX += cx + 0.5;
    sumY += cy + 0.5;
  }
  const originCenter: Point = {
    x: sumX / cellList.length,
    y: sumY / cellList.length,
  };

  const targetOwnerId = inferFrontTargetOwner(
    state,
    playerId,
    cellList,
    ux,
    uy,
    explicitTargetOwnerId,
  );

  const clampedPct = Math.max(10, Math.min(100, manpowerPercent));
  const activeMp = Math.max(0, player.manpower - player.allocatedManpower);
  const committed =
    explicitCommittedManpower !== undefined
      ? Math.min(activeMp, Math.max(0, explicitCommittedManpower))
      : activeMp * (clampedPct / 100);
  if (committed < MIN_ACTIVE_ORDER_MANPOWER) {
    return;
  }

  player.manpower -= committed;
  updateAllPlayersEconomy(state, false);

  state.frontPushOrders.push({
    id: state.nextOrderId++,
    playerId,
    frontierCells: cellList,
    targetOwnerId,
    originCenter,
    focalPoint,
    sweepAllBorders,
    finishOff,
    dirX: ux,
    dirY: uy,
    manpowerCommitted: committed,
    manpowerRemaining: committed,
    ticksRemaining: MAX_ORDER_TICKS,
    maxTicks: MAX_ORDER_TICKS,
    stagnantTicks: 0,
    mountainAccum: 0,
  });
}

function handleTargetedAttack(
  state: GameState,
  playerId: number,
  targetOwnerId: number,
  anchorX: number,
  anchorY: number,
  manpowerPercent: number,
): void {
  if (state.phase !== 'PLAYING') return;
  const player = state.players.get(playerId);
  if (!player || !player.alive) return;

  if (targetOwnerId >= 0) {
    if (targetOwnerId === playerId || getRelation(state, playerId, targetOwnerId) !== 'WAR') {
      return;
    }
  }

  const { width, height, owners, terrain } = state;
  const nearbyCells: number[] = [];
  const allEnemyFrontierCells: number[] = [];
  let sumDirX = 0;
  let sumDirY = 0;

  if (targetOwnerId >= 0) {
    const rSq = 45 * 45;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (owners[idx] !== playerId) continue;

        let touchesEnemy = false;
        let localDx = 0;
        let localDy = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const nIdx = ny * width + nx;
            if (terrain[nIdx] !== TerrainType.WATER && owners[nIdx] === targetOwnerId) {
              touchesEnemy = true;
              localDx += dx;
              localDy += dy;
            }
          }
        }
        if (!touchesEnemy) continue;

        allEnemyFrontierCells.push(idx);
        const dSq = (x + 0.5 - anchorX) * (x + 0.5 - anchorX) + (y + 0.5 - anchorY) * (y + 0.5 - anchorY);
        if (dSq <= rSq) {
          nearbyCells.push(idx);
          sumDirX += localDx;
          sumDirY += localDy;
        }
      }
    }
  } else {
    const rad = 36;
    const rSq = rad * rad;
    const minX = Math.max(0, Math.floor(anchorX - rad));
    const maxX = Math.min(width - 1, Math.ceil(anchorX + rad));
    const minY = Math.max(0, Math.floor(anchorY - rad));
    const maxY = Math.min(height - 1, Math.ceil(anchorY + rad));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dSq = (x + 0.5 - anchorX) * (x + 0.5 - anchorX) + (y + 0.5 - anchorY) * (y + 0.5 - anchorY);
        if (dSq > rSq) continue;
        const idx = y * width + x;
        if (owners[idx] !== playerId) continue;

        let touchesWild = false;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const nIdx = ny * width + nx;
            if (terrain[nIdx] !== TerrainType.WATER && owners[nIdx] === WILDERNESS_OWNER) {
              touchesWild = true;
              sumDirX += dx;
              sumDirY += dy;
            }
          }
        }
        if (touchesWild) {
          nearbyCells.push(idx);
        }
      }
    }

    if (nearbyCells.length === 0) {
      const wildCandidates: Array<{ readonly idx: number; readonly x: number; readonly y: number; readonly dSq: number }> = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          if (owners[idx] !== playerId) continue;

          let touchesWild = false;
          for (let dy = -1; dy <= 1 && !touchesWild; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              if (nx < 0 || nx >= width) continue;
              const nIdx = ny * width + nx;
              if (terrain[nIdx] !== TerrainType.WATER && owners[nIdx] === WILDERNESS_OWNER) {
                touchesWild = true;
                break;
              }
            }
          }
          if (touchesWild) {
            const dSq =
              (x + 0.5 - anchorX) * (x + 0.5 - anchorX) +
              (y + 0.5 - anchorY) * (y + 0.5 - anchorY);
            wildCandidates.push({ idx, x, y, dSq });
          }
        }
      }

      wildCandidates.sort((a, b) => a.dSq - b.dSq);
      const picked = wildCandidates.slice(0, 32);
      for (const c of picked) {
        nearbyCells.push(c.idx);
        sumDirX += anchorX - (c.x + 0.5);
        sumDirY += anchorY - (c.y + 0.5);
      }
    }
  }

  const chosenCells = nearbyCells.length > 0 ? nearbyCells : allEnemyFrontierCells;
  if (chosenCells.length === 0) {
    return;
  }

  const dirLen = Math.hypot(sumDirX, sumDirY);
  const rawDx = anchorX - player.capitalX;
  const rawDy = anchorY - player.capitalY;
  const fallbackLen = Math.hypot(rawDx, rawDy);
  const dirX = dirLen > 0.01 ? sumDirX / dirLen : fallbackLen > 0.01 ? rawDx / fallbackLen : 1;
  const dirY = dirLen > 0.01 ? sumDirY / dirLen : fallbackLen > 0.01 ? rawDy / fallbackLen : 0;

  const effectivePct = Math.max(10, Math.min(100, manpowerPercent));
  handleCreateFrontPushOrder(
    state,
    playerId,
    chosenCells,
    dirX,
    dirY,
    effectivePct,
    targetOwnerId,
    { x: anchorX, y: anchorY },
    false,
    false,
  );
}

function handleFinishOffTarget(
  state: GameState,
  playerId: number,
  targetOwnerId: number,
): void {
  if (state.phase !== 'PLAYING') return;
  const player = state.players.get(playerId);
  const target = state.players.get(targetOwnerId);
  if (!player || !player.alive || !target || !isFinishOffTargetSmall(state, target)) {
    return;
  }

  const requiredMp = estimateFinishOffManpower(state, playerId, targetOwnerId);
  if (requiredMp === null) {
    return;
  }

  const activeMpBefore = Math.max(0, player.manpower - player.allocatedManpower);
  if (activeMpBefore + 0.5 < requiredMp) {
    return;
  }

  const frontierSet = new Set<number>();
  addEnemyAdjacentFrontierCells(state, playerId, targetOwnerId, frontierSet);
  if (frontierSet.size === 0) {
    return;
  }

  if (getRelation(state, playerId, targetOwnerId) !== 'WAR') {
    declareWar(state, playerId, targetOwnerId);
  }

  const activeMpAfter = Math.max(0, player.manpower - player.allocatedManpower);
  handleCreateFrontPushOrder(
    state,
    playerId,
    Array.from(frontierSet),
    1,
    0,
    100,
    targetOwnerId,
    undefined,
    true,
    true,
    Math.min(activeMpAfter, requiredMp),
  );
}

function handleBorderSurgePush(
  state: GameState,
  playerId: number,
  x: number,
  y: number,
  manpowerPercent: number,
): void {
  if (state.phase !== 'PLAYING') return;
  const player = state.players.get(playerId);
  if (!player || !player.alive) return;

  const { width, height, owners, terrain } = state;
  const ix = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const iy = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const clickedOwner = owners[iy * width + ix];

  let targetOwnerId = WILDERNESS_OWNER;
  if (
    clickedOwner >= 0 &&
    clickedOwner !== playerId &&
    getRelation(state, playerId, clickedOwner) === 'WAR'
  ) {
    targetOwnerId = clickedOwner;
  } else {
    let bestDistSq = Infinity;
    for (let dy = -6; dy <= 6; dy++) {
      const ny = iy + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -6; dx <= 6; dx++) {
        const dSq = dx * dx + dy * dy;
        if (dSq > 36 || dSq >= bestDistSq) continue;
        const nx = ix + dx;
        if (nx < 0 || nx >= width) continue;
        const o = owners[ny * width + nx];
        if (o >= 0 && o !== playerId && getRelation(state, playerId, o) === 'WAR') {
          bestDistSq = dSq;
          targetOwnerId = o;
        }
      }
    }
  }

  const allowedEnemyIds = targetOwnerId >= 0 ? [targetOwnerId] : [];
  const radius = 18;
  const rSq = radius * radius;
  const frontierCells: number[] = [];
  let sumDirX = 0;
  let sumDirY = 0;

  const minX = Math.max(0, ix - radius);
  const maxX = Math.min(width - 1, ix + radius);
  const minY = Math.max(0, iy - radius);
  const maxY = Math.min(height - 1, iy + radius);

  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      if ((cx - ix) * (cx - ix) + (cy - iy) * (cy - iy) > rSq) continue;
      if (!isBorderCell(state, cx, cy, playerId)) continue;

      let cellHasTarget = false;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= width) continue;
          const nIdx = ny * width + nx;
          if (terrain[nIdx] === TerrainType.WATER) continue;
          if (canOrderCaptureCell(state, playerId, allowedEnemyIds, owners[nIdx])) {
            cellHasTarget = true;
            sumDirX += dx;
            sumDirY += dy;
          }
        }
      }

      if (cellHasTarget) {
        frontierCells.push(cy * width + cx);
      }
    }
  }

  if (frontierCells.length === 0) return;

  const dirLen = Math.hypot(sumDirX, sumDirY);
  const dirX = dirLen > 0.01 ? sumDirX / dirLen : ix + 0.5 - player.capitalX;
  const dirY = dirLen > 0.01 ? sumDirY / dirLen : iy + 0.5 - player.capitalY;

  handleCreateFrontPushOrder(
    state,
    playerId,
    frontierCells,
    dirX,
    dirY,
    manpowerPercent,
    targetOwnerId,
    { x, y },
  );
}

function handleCancelPlayerOrders(state: GameState, playerId: number): void {
  const player = state.players.get(playerId);
  if (!player) return;

  let refund = 0;
  state.attackOrders = state.attackOrders.filter((order) => {
    if (order.playerId === playerId) {
      refund += order.manpowerRemaining;
      return false;
    }
    return true;
  });
  state.frontPushOrders = state.frontPushOrders.filter((order) => {
    if (order.playerId === playerId) {
      refund += order.manpowerRemaining;
      return false;
    }
    return true;
  });

  if (refund > 0) {
    player.manpower = Math.min(player.maxManpower, player.manpower + refund);
    updateAllPlayersEconomy(state, false);
  }
}

function handleTick(state: GameState): void {
  if (state.phase !== 'PLAYING' || state.paused) {
    return;
  }

  state.tick++;
  const versionBefore = state.stateVersion;
  stepBuildingConstruction(state);
  stepFrontExpansion(state);
  if (syncBuildingOwnership(state)) {
    state.stateVersion++;
  }

  if (
    state.stateVersion !== versionBefore ||
    state.lastTerritorySyncVersion !== state.stateVersion ||
    state.tick % 4 === 1
  ) {
    syncTerritoriesCapitalsAndNeighbors(state);
    state.lastTerritorySyncVersion = state.stateVersion;
  }

  for (const player of state.players.values()) {
    if (!player.alive) continue;
    if (player.betrayalDebuffTicks > 0) {
      player.betrayalDebuffTicks--;
    }
  }

  updateAllPlayersEconomy(state, true);
  stepBots(state);
}

function handleSetBuildingTypeOccupancy(
  state: GameState,
  playerId: number,
  buildingType: keyof PlayerState['buildingOccupancyByType'],
  occupancyPct: number,
): void {
  const player = state.players.get(playerId);
  if (!player || !player.alive) return;
  player.buildingOccupancyByType[buildingType] = Math.max(0, Math.min(200, Math.round(occupancyPct)));
  updateAllPlayersEconomy(state, false);
  state.stateVersion++;
}

function handleSetBuildingOccupancy(
  state: GameState,
  playerId: number,
  buildingId: number,
  occupancyPct: number | null,
): void {
  const player = state.players.get(playerId);
  if (!player || !player.alive) return;
  const building = state.buildings.find(
    (b) => b.id === buildingId && b.ownerId === playerId,
  );
  if (!building) return;
  building.occupancyOverride =
    occupancyPct === null ? null : Math.max(0, Math.min(200, Math.round(occupancyPct)));
  updateAllPlayersEconomy(state, false);
  state.stateVersion++;
}

function handleSetAllOccupancy(
  state: GameState,
  playerId: number,
  occupancyPct: number,
): void {
  const player = state.players.get(playerId);
  if (!player || !player.alive) return;
  const clamped = Math.max(0, Math.min(200, Math.round(occupancyPct)));
  for (const bType of MANPOWER_BUILDING_TYPES) {
    player.buildingOccupancyByType[bType] = clamped;
  }
  for (const building of state.buildings) {
    if (building.ownerId === playerId) {
      building.occupancyOverride = null;
    }
  }
  updateAllPlayersEconomy(state, false);
  state.stateVersion++;
}

export function dispatchAction(state: GameState, action: Action): void {
  switch (action.type) {
    case 'SELECT_START_POSITION':
      handleSelectStart(state, action.x, action.y);
      break;
    case 'CREATE_ATTACK_ORDER':
      handleCreateAttackOrder(
        state,
        action.playerId,
        action.waypoints,
        action.manpowerPercent,
        action.targetOwnerId,
      );
      break;
    case 'AMBUSH_ATTACK':
      declareWar(state, action.playerId, action.targetId);
      handleCreateAttackOrder(
        state,
        action.playerId,
        action.waypoints,
        action.manpowerPercent,
        action.targetId,
      );
      break;
    case 'BEND_ATTACK_ORDER':
      handleBendAttackOrder(
        state,
        action.playerId,
        action.orderId,
        action.waypointIndex,
        action.x,
        action.y,
      );
      break;
    case 'CREATE_FRONT_PUSH_ORDER':
      handleCreateFrontPushOrder(
        state,
        action.playerId,
        action.frontierCells,
        action.dirX,
        action.dirY,
        action.manpowerPercent,
        action.targetOwnerId,
      );
      break;
    case 'BORDER_SURGE_PUSH':
      handleBorderSurgePush(
        state,
        action.playerId,
        action.x,
        action.y,
        action.manpowerPercent,
      );
      break;
    case 'PLACE_BUILDING': {
      const placed = placeBuilding(
        state,
        action.playerId,
        action.buildingType,
        action.x,
        action.y,
        action.batchSize ?? 1,
      );
      if (placed) {
        updateAllPlayersEconomy(state, false);
      }
      break;
    }
    case 'STACK_BUILDING': {
      const added = stackBuilding(
        state,
        action.playerId,
        action.buildingId,
        action.batchSize,
      );
      if (added > 0) {
        updateAllPlayersEconomy(state, false);
      }
      break;
    }
    case 'DEMOLISH_BUILDING': {
      const removed = demolishBuilding(
        state,
        action.playerId,
        action.buildingId,
        action.demolishAll,
      );
      if (removed) {
        updateAllPlayersEconomy(state, false);
      }
      break;
    }
    case 'TARGETED_ATTACK':
      handleTargetedAttack(
        state,
        action.playerId,
        action.targetOwnerId,
        action.anchorX,
        action.anchorY,
        action.manpowerPercent,
      );
      break;
    case 'FINISH_OFF_TARGET':
      handleFinishOffTarget(state, action.playerId, action.targetOwnerId);
      break;
    case 'SET_BUILDING_TYPE_OCCUPANCY':
      handleSetBuildingTypeOccupancy(
        state,
        action.playerId,
        action.buildingType,
        action.occupancyPct,
      );
      break;
    case 'SET_BUILDING_OCCUPANCY':
      handleSetBuildingOccupancy(
        state,
        action.playerId,
        action.buildingId,
        action.occupancyPct,
      );
      break;
    case 'SET_ALL_OCCUPANCY':
      handleSetAllOccupancy(state, action.playerId, action.occupancyPct);
      break;
    case 'DECLARE_WAR':
      declareWar(state, action.actorId, action.targetId);
      break;
    case 'MAKE_PEACE':
      makePeace(state, action.actorId, action.targetId);
      break;
    case 'TOGGLE_ALLIANCE':
      toggleAlliance(state, action.actorId, action.targetId);
      break;
    case 'TOGGLE_TRADE':
      toggleTrade(state, action.actorId, action.targetId);
      break;
    case 'CANCEL_PLAYER_ORDERS':
      handleCancelPlayerOrders(state, action.playerId);
      break;
    case 'TOGGLE_PAUSE':
      if (state.phase === 'PLAYING') {
        state.paused = !state.paused;
      }
      break;
    case 'RESTART_GAME': {
      const fresh = createBaseState(action.seed ?? ((state.rngState ^ 0x9e3779b9) >>> 0));
      state.tick = fresh.tick;
      state.phase = fresh.phase;
      state.paused = fresh.paused;
      state.terrain.set(fresh.terrain);
      state.owners.set(fresh.owners);
      state.players.clear();
      state.relations.clear();
      state.tradeAgreements.clear();
      state.neighborPairs.clear();
      state.buildings = [];
      state.nextBuildingId = 1;
      state.lastTerritorySyncVersion = -1;
      state.attackOrders = [];
      state.frontPushOrders = [];
      state.publicResourceZones.splice(
        0,
        state.publicResourceZones.length,
        ...fresh.publicResourceZones,
      );
      state.secretResourceZones.splice(
        0,
        state.secretResourceZones.length,
        ...fresh.secretResourceZones,
      );
      state.nextOrderId = 1;
      state.rngState = fresh.rngState;
      state.stateVersion++;
      break;
    }
    case 'TICK':
      handleTick(state);
      break;
  }
}

function toPublicBuilding(b: Building): PublicBuildingInfo {
  return {
    id: b.id,
    type: b.type,
    ownerId: b.ownerId,
    x: b.x,
    y: b.y,
    isCapital: b.isCapital,
    level: b.level,
    revealedEfficiencyPct: b.revealedEfficiencyPct,
    stackCount: b.stackCount,
    underConstructionCount: b.underConstructionCount,
    constructionTicksRemaining: b.constructionTicksRemaining,
    constructionTicksTotal: b.constructionTicksTotal,
    totalInvestedMoney: b.totalInvestedMoney,
    totalInvestedMaterial: b.totalInvestedMaterial,
    totalInvestedIndustry: b.totalInvestedIndustry,
    occupancyOverride: b.occupancyOverride,
    effectiveOccupancyPct: b.effectiveOccupancyPct,
    effectiveOutputPct: b.effectiveOutputPct,
    allocatedManpower: b.allocatedManpower,
    currentEnergyUse: b.currentEnergyUse,
    currentEnergyProd: b.currentEnergyProd,
  };
}

/**
 * Produces a strictly sanitized client state snapshot:
 * - Secret resource optimum coordinates are never exposed.
 * - Opponent manpower, buildings, and internal economy stats are omitted.
 */
export function createClientRenderState(state: GameState): ClientRenderState {
  const players: PublicPlayerInfo[] = [];
  for (const p of state.players.values()) {
    const isHuman = p.id === state.humanPlayerId;
    const relationToHuman: DiplomaticRelation = isHuman
      ? 'NEUTRAL'
      : getRelation(state, state.humanPlayerId, p.id);
    const isNeighborOfHuman = !isHuman && areNeighbors(state, state.humanPlayerId, p.id);
    const tradeKey = getRelationKey(state.humanPlayerId, p.id);
    const hasTradeWithHuman = !isHuman && state.tradeAgreements.has(tradeKey);
    const tradeIncomeWithHumanPerSec = hasTradeWithHuman
      ? computeTradePairIncomePerSec(state, state.humanPlayerId, p.id)
      : 0;

    if (isHuman) {
      players.push({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        colorHex: p.colorHex,
        colorRgb: p.colorRgb,
        capitalX: p.capitalX,
        capitalY: p.capitalY,
        territoryCells: p.territoryCells,
        alive: p.alive,
        betrayalDebuffTicks: p.betrayalDebuffTicks,
        relationToHuman,
        isNeighborOfHuman: false,
        hasTradeWithHuman: false,
        tradeIncomeWithHumanPerSec: 0,
        finishOffEligible: false,
        finishOffRequiredManpower: null,
        manpower: p.manpower,
        maxManpower: p.maxManpower,
        manpowerIncomePerSec: p.manpowerIncomePerSec,
        manpowerGrowthEfficiency: p.manpowerGrowthEfficiency,
        allocatedManpower: p.allocatedManpower,
        activeManpower: p.activeManpower,
        money: p.money,
        moneyIncomePerSec: p.moneyIncomePerSec,
        tradeIncomePerSec: p.tradeIncomePerSec,
        knowledge: p.knowledge,
        knowledgeIncomePerSec: p.knowledgeIncomePerSec,
        buildingMaterial: p.buildingMaterial,
        buildingMaterialIncomePerSec: p.buildingMaterialIncomePerSec,
        industry: p.industry,
        industryIncomePerSec: p.industryIncomePerSec,
        energyReserve: p.energyReserve,
        energyReserveMax: p.energyReserveMax,
        energyProductionPerSec: p.energyProductionPerSec,
        energyConsumptionPerSec: p.energyConsumptionPerSec,
        energyNetPerSec: p.energyNetPerSec,
        energySupplyRatio: p.energySupplyRatio,
        blackoutActive: p.blackoutActive,
        blackoutSeverity: p.blackoutSeverity,
        freePowerPlantUsed: p.freePowerPlantUsed,
        buildingOccupancyByType: { ...p.buildingOccupancyByType },
      });
    } else {
      const finishOffRequiredManpower = isNeighborOfHuman
        ? estimateFinishOffManpower(state, state.humanPlayerId, p.id)
        : null;
      players.push({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        colorHex: p.colorHex,
        colorRgb: p.colorRgb,
        capitalX: p.capitalX,
        capitalY: p.capitalY,
        territoryCells: p.territoryCells,
        alive: p.alive,
        betrayalDebuffTicks: p.betrayalDebuffTicks,
        relationToHuman,
        isNeighborOfHuman,
        hasTradeWithHuman,
        tradeIncomeWithHumanPerSec,
        finishOffEligible: finishOffRequiredManpower !== null,
        finishOffRequiredManpower,
      });
    }
  }

  const relationsObj: Record<string, DiplomaticRelation> = {};
  for (const [key, rel] of state.relations) {
    relationsObj[key] = rel;
  }

  const buildings: PublicBuildingInfo[] = [];
  for (const b of state.buildings) {
    if (b.ownerId === state.humanPlayerId) {
      buildings.push(toPublicBuilding(b));
    }
  }

  return {
    tick: state.tick,
    phase: state.phase,
    paused: state.paused,
    width: state.width,
    height: state.height,
    totalLandCells: state.totalLandCells,
    terrain: state.terrain,
    owners: state.owners,
    players,
    humanPlayerId: state.humanPlayerId,
    relations: relationsObj,
    tradeAgreements: Array.from(state.tradeAgreements),
    buildings,
    attackOrders: state.attackOrders.map((o) => ({
      ...o,
      origin: { ...o.origin },
      waypoints: o.waypoints.map((pt) => ({ ...pt })),
      targetOwnerIds: [...o.targetOwnerIds],
    })),
    frontPushOrders: state.frontPushOrders.map((o) => ({
      ...o,
      frontierCells: [...o.frontierCells],
    })),
    publicResourceZones: state.publicResourceZones,
    stateVersion: state.stateVersion,
  };
}

function pointInLasso(px: number, py: number, poly: ReadonlyArray<Point>): boolean {
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

function distToPolylinePoints(
  px: number,
  py: number,
  points: ReadonlyArray<Point>,
): number {
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

export interface EngineController {
  dispatch(action: Action): void;
  getRenderState(): ClientRenderState;
  isPlayingAndUnpaused(): boolean;
  findHumanBorderCellsFromLasso(points: ReadonlyArray<Point>): number[];
  pruneHumanBorderCells(cells: ReadonlyArray<number>, originalCount: number): number[];
}

export function createEngineController(seed?: number): EngineController {
  const state = createInitialGameState(seed);

  return {
    dispatch(action: Action): void {
      dispatchAction(state, action);
    },
    getRenderState(): ClientRenderState {
      return createClientRenderState(state);
    },
    isPlayingAndUnpaused(): boolean {
      return state.phase === 'PLAYING' && !state.paused;
    },
    findHumanBorderCellsFromLasso(points: ReadonlyArray<Point>): number[] {
      if (state.phase !== 'PLAYING' || points.length === 0) {
        return [];
      }
      const { width, height } = state;
      const result: number[] = [];
      const isClosedLoop =
        points.length >= 6 &&
        Math.hypot(
          points[0].x - points[points.length - 1].x,
          points[0].y - points[points.length - 1].y,
        ) < 42;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!isBorderCell(state, x, y, state.humanPlayerId)) {
            continue;
          }
          const cx = x + 0.5;
          const cy = y + 0.5;
          const insideLoop = isClosedLoop && pointInLasso(cx, cy, points);
          const nearStroke =
            points.length === 1
              ? Math.hypot(cx - points[0].x, cy - points[0].y) <= 8.5
              : distToPolylinePoints(cx, cy, points) <= 6.5;
          if (insideLoop || nearStroke) {
            result.push(y * width + x);
          }
        }
      }
      return result;
    },
    pruneHumanBorderCells(
      cells: ReadonlyArray<number>,
      originalCount: number,
    ): number[] {
      if (state.phase !== 'PLAYING' || cells.length === 0) {
        return [];
      }
      const { width } = state;
      const surviving: number[] = [];
      for (const idx of cells) {
        const cx = idx % width;
        const cy = (idx - cx) / width;
        if (isBorderCell(state, cx, cy, state.humanPlayerId)) {
          surviving.push(idx);
        }
      }
      if (surviving.length < 3 || surviving.length < originalCount * 0.65) {
        return [];
      }
      return surviving;
    },
  };
}
