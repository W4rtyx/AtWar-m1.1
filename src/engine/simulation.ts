import { spawnBots, stepBots } from './bots';
import {
  MAX_ARROW_PATH_LENGTH,
  MAX_ORDER_TICKS,
  MIN_ACTIVE_ORDER_MANPOWER,
  buildSmoothAttackWaypoints,
  claimInitialTerritory,
  clampPolylineLength,
  computePolylineLength,
  getRelation,
  isBorderCell,
  stepFrontExpansion,
} from './frontExpansion';
import { generateEuropeMap } from './mapGenerator';
import {
  Action,
  BETRAYAL_DEBUFF_TICKS,
  ClientRenderState,
  DiplomaticRelation,
  GameState,
  PlayerState,
  Point,
  PublicPlayerInfo,
  TICK_DT,
  TerrainType,
  WILDERNESS_OWNER,
  getRelationKey,
} from './types';

const HUMAN_PLAYER_ID = 1;
const HUMAN_START_RADIUS = 14;
const BOT_COUNT = 11;
const OPTIMUM_FILL_RATIO = 0.5;

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

/**
 * Computes non-linear manpower capacity and growth rate around a 50% optimum:
 * - Low fill (< 45%): slower recovery that accelerates toward optimum
 * - Optimum window (45-55%): peak growth rate
 * - High fill (> 55%): diminishing growth tapering to zero at 100% capacity
 */
function updatePlayerManpowerEconomy(player: PlayerState, applyTickGrowth: boolean): void {
  const maxManpower = Math.round(320 + Math.pow(Math.max(1, player.territoryCells), 0.88) * 0.62);
  const clampedManpower = Math.min(maxManpower, Math.max(0, player.manpower));
  const fillRatio = Math.max(0, Math.min(1, clampedManpower / Math.max(1, maxManpower)));

  let efficiency: number;
  if (fillRatio <= OPTIMUM_FILL_RATIO) {
    efficiency = 0.22 + 0.78 * Math.sin((fillRatio / OPTIMUM_FILL_RATIO) * (Math.PI / 2));
  } else {
    const overRatio = (fillRatio - OPTIMUM_FILL_RATIO) / (1 - OPTIMUM_FILL_RATIO);
    efficiency = Math.pow(Math.max(0, 1 - overRatio), 1.65);
  }

  const peakIncomePerSec = 7.2 + Math.pow(Math.max(1, player.territoryCells), 0.76) * 0.066;
  const incomePerSec = peakIncomePerSec * efficiency;

  player.maxManpower = maxManpower;
  player.manpowerGrowthEfficiency = efficiency;
  player.manpowerIncomePerSec = incomePerSec;

  if (applyTickGrowth) {
    player.manpower = Math.min(maxManpower, clampedManpower + incomePerSec * TICK_DT);
  } else {
    player.manpower = clampedManpower;
  }
}

function isNearPlayerTerritory(
  state: GameState,
  x: number,
  y: number,
  playerId: number,
  maxRadius: number,
): boolean {
  const { width, height, owners } = state;
  const ix = Math.round(x);
  const iy = Math.round(y);
  for (let dy = -maxRadius; dy <= maxRadius; dy++) {
    const ny = iy + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      const nx = ix + dx;
      if (nx < 0 || nx >= width) continue;
      if (owners[ny * width + nx] === playerId) {
        return true;
      }
    }
  }
  return false;
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
  }

  state.relations.set(getRelationKey(actorId, targetId), 'WAR');
  state.stateVersion++;
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
    updatePlayerManpowerEconomy(playerA, false);
  }
  if (playerB && refundB > 0) {
    playerB.manpower = Math.min(playerB.maxManpower, playerB.manpower + refundB);
    updatePlayerManpowerEconomy(playerB, false);
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

  const humanPlayer: PlayerState = {
    id: HUMAN_PLAYER_ID,
    name: 'Republika (Vy)',
    isBot: false,
    colorHex: '#3b6e8c',
    colorRgb: [59, 110, 140],
    capitalX: ix,
    capitalY: iy,
    manpower: 240,
    maxManpower: 480,
    manpowerIncomePerSec: 14,
    manpowerGrowthEfficiency: 1,
    betrayalDebuffTicks: 0,
    territoryCells: claimed,
    alive: true,
  };

  state.players.set(HUMAN_PLAYER_ID, humanPlayer);
  spawnBots(state, BOT_COUNT);
  recalculateTerritoryAndCapitals(state);

  for (const player of state.players.values()) {
    updatePlayerManpowerEconomy(player, false);
    player.manpower = Math.round(player.maxManpower * OPTIMUM_FILL_RATIO);
    updatePlayerManpowerEconomy(player, false);
  }

  state.phase = 'PLAYING';
  state.paused = false;
  state.stateVersion++;
}

function handleCreateAttackOrder(
  state: GameState,
  playerId: number,
  rawWaypoints: ReadonlyArray<Point>,
  manpowerPercent: number,
): void {
  if (state.phase !== 'PLAYING' || rawWaypoints.length < 2) {
    return;
  }
  const player = state.players.get(playerId);
  if (!player || !player.alive) {
    return;
  }

  const startPt = rawWaypoints[0];
  if (!isNearPlayerTerritory(state, startPt.x, startPt.y, playerId, 5)) {
    return;
  }

  const waypoints = buildSmoothAttackWaypoints(rawWaypoints);
  const totalPathLength = computePolylineLength(waypoints);
  if (waypoints.length < 2 || totalPathLength < 6) {
    return;
  }

  const clampedPct = Math.max(10, Math.min(100, manpowerPercent));
  const committed = player.manpower * (clampedPct / 100);
  if (committed < MIN_ACTIVE_ORDER_MANPOWER) {
    return;
  }

  player.manpower -= committed;
  updatePlayerManpowerEconomy(player, false);

  state.attackOrders.push({
    id: state.nextOrderId++,
    playerId,
    waypoints,
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

function handleCreateFrontPushOrder(
  state: GameState,
  playerId: number,
  frontierCells: ReadonlyArray<number>,
  dirX: number,
  dirY: number,
  manpowerPercent: number,
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

  const clampedPct = Math.max(10, Math.min(100, manpowerPercent));
  const committed = player.manpower * (clampedPct / 100);
  if (committed < MIN_ACTIVE_ORDER_MANPOWER) {
    return;
  }

  player.manpower -= committed;
  updatePlayerManpowerEconomy(player, false);

  state.frontPushOrders.push({
    id: state.nextOrderId++,
    playerId,
    frontierCells: Array.from(validCells),
    dirX: dirX / len,
    dirY: dirY / len,
    manpowerCommitted: committed,
    manpowerRemaining: committed,
    ticksRemaining: MAX_ORDER_TICKS,
    maxTicks: MAX_ORDER_TICKS,
    stagnantTicks: 0,
    mountainAccum: 0,
  });
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
    updatePlayerManpowerEconomy(player, false);
  }
}

function handleTick(state: GameState): void {
  if (state.phase !== 'PLAYING' || state.paused) {
    return;
  }

  state.tick++;
  stepFrontExpansion(state);
  recalculateTerritoryAndCapitals(state);

  for (const player of state.players.values()) {
    if (!player.alive) continue;
    if (player.betrayalDebuffTicks > 0) {
      player.betrayalDebuffTicks--;
    }
    updatePlayerManpowerEconomy(player, true);
  }

  stepBots(state);
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
      );
      break;
    case 'AMBUSH_ATTACK':
      declareWar(state, action.playerId, action.targetId);
      handleCreateAttackOrder(
        state,
        action.playerId,
        action.waypoints,
        action.manpowerPercent,
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
      );
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

/**
 * Produces a strictly sanitized client state snapshot:
 * - Secret resource optimum coordinates are never exposed.
 * - Opponent manpower and internal stats are omitted.
 */
export function createClientRenderState(state: GameState): ClientRenderState {
  const players: PublicPlayerInfo[] = [];
  for (const p of state.players.values()) {
    const relationToHuman: DiplomaticRelation =
      p.id === state.humanPlayerId
        ? 'NEUTRAL'
        : getRelation(state, state.humanPlayerId, p.id);

    if (p.id === state.humanPlayerId) {
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
        manpower: p.manpower,
        maxManpower: p.maxManpower,
        manpowerIncomePerSec: p.manpowerIncomePerSec,
        manpowerGrowthEfficiency: p.manpowerGrowthEfficiency,
      });
    } else {
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
      });
    }
  }

  const relationsObj: Record<string, DiplomaticRelation> = {};
  for (const [key, rel] of state.relations) {
    relationsObj[key] = rel;
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
    attackOrders: state.attackOrders.map((o) => ({
      ...o,
      waypoints: o.waypoints.map((pt) => ({ ...pt })),
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
  findHumanBorderCellsFromLasso(points: ReadonlyArray<Point>): number[];
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
  };
}
