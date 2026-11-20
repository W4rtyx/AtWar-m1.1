import { spawnBots, stepBots } from './bots';
import { claimInitialTerritory, isBorderCell, stepFrontExpansion } from './frontExpansion';
import { generateEuropeMap } from './mapGenerator';
import {
  Action,
  ClientRenderState,
  GameState,
  PlayerState,
  Point2D,
  PublicPlayerInfo,
  TICK_DT,
  TerrainType,
} from './types';

const HUMAN_PLAYER_ID = 1;
const HUMAN_START_RADIUS = 6;
const BOT_COUNT = 7;

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
    if (owner > 0) {
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
      // Relocate capital to another owned cell when previous capital was captured
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
  if (state.terrain[idx] === TerrainType.WATER || state.owners[idx] !== 0) {
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
    manpower: 180,
    maxManpower: 300 + claimed * 1.4,
    manpowerIncomePerSec: 10 + claimed * 0.08,
    territoryCells: claimed,
    alive: true,
  };

  state.players.set(HUMAN_PLAYER_ID, humanPlayer);
  spawnBots(state, BOT_COUNT);
  recalculateTerritoryAndCapitals(state);
  state.phase = 'PLAYING';
  state.paused = false;
  state.stateVersion++;
}

function handleCreateAttackOrder(
  state: GameState,
  playerId: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  manpowerPercent: number,
): void {
  if (state.phase !== 'PLAYING') {
    return;
  }
  const player = state.players.get(playerId);
  if (!player || !player.alive) {
    return;
  }

  const clampedFromX = Math.max(0, Math.min(state.width - 1, fromX));
  const clampedFromY = Math.max(0, Math.min(state.height - 1, fromY));
  if (!isNearPlayerTerritory(state, clampedFromX, clampedFromY, playerId, 2)) {
    return;
  }

  const dx = toX - clampedFromX;
  const dy = toY - clampedFromY;
  const len = Math.hypot(dx, dy);
  if (len < 3) {
    return;
  }

  const clampedPct = Math.max(10, Math.min(100, manpowerPercent));
  const committed = player.manpower * (clampedPct / 100);
  if (committed < 2) {
    return;
  }

  player.manpower -= committed;
  state.attackOrders.push({
    id: state.nextOrderId++,
    playerId,
    fromX: clampedFromX,
    fromY: clampedFromY,
    toX: Math.max(0, Math.min(state.width - 1, toX)),
    toY: Math.max(0, Math.min(state.height - 1, toY)),
    dirX: dx / len,
    dirY: dy / len,
    manpowerCommitted: committed,
    manpowerRemaining: committed,
    ticksRemaining: 90,
    mountainAccum: 0,
  });
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
  if (committed < 2) {
    return;
  }

  player.manpower -= committed;
  state.frontPushOrders.push({
    id: state.nextOrderId++,
    playerId,
    frontierCells: Array.from(validCells),
    dirX: dirX / len,
    dirY: dirY / len,
    manpowerCommitted: committed,
    manpowerRemaining: committed,
    ticksRemaining: 90,
    mountainAccum: 0,
  });
}

function handleCancelPlayerOrders(state: GameState, playerId: number): void {
  const player = state.players.get(playerId);
  if (!player) return;

  let refund = 0;
  state.attackOrders = state.attackOrders.filter((order) => {
    if (order.playerId === playerId) {
      refund += order.manpowerRemaining * 0.5;
      return false;
    }
    return true;
  });
  state.frontPushOrders = state.frontPushOrders.filter((order) => {
    if (order.playerId === playerId) {
      refund += order.manpowerRemaining * 0.5;
      return false;
    }
    return true;
  });

  if (refund > 0) {
    player.manpower = Math.min(player.maxManpower, player.manpower + refund);
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
    player.manpowerIncomePerSec = 10 + player.territoryCells * 0.08;
    player.maxManpower = 300 + player.territoryCells * 1.4;
    player.manpower = Math.min(
      player.maxManpower,
      player.manpower + player.manpowerIncomePerSec * TICK_DT,
    );
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
        action.fromX,
        action.fromY,
        action.toX,
        action.toY,
        action.manpowerPercent,
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
        manpower: p.manpower,
        maxManpower: p.maxManpower,
        manpowerIncomePerSec: p.manpowerIncomePerSec,
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
      });
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
    attackOrders: state.attackOrders.map((o) => ({ ...o })),
    frontPushOrders: state.frontPushOrders.map((o) => ({
      ...o,
      frontierCells: [...o.frontierCells],
    })),
    publicResourceZones: state.publicResourceZones,
    stateVersion: state.stateVersion,
  };
}

function pointInLasso(px: number, py: number, poly: ReadonlyArray<Point2D>): boolean {
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
  points: ReadonlyArray<Point2D>,
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
  findHumanBorderCellsFromLasso(points: ReadonlyArray<Point2D>): number[];
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
    findHumanBorderCellsFromLasso(points: ReadonlyArray<Point2D>): number[] {
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
        ) < 24;

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
              ? Math.hypot(cx - points[0].x, cy - points[0].y) <= 4.5
              : distToPolylinePoints(cx, cy, points) <= 3.8;
          if (insideLoop || nearStroke) {
            result.push(y * width + x);
          }
        }
      }
      return result;
    },
  };
}
