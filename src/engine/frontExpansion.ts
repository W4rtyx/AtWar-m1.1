import { GameState, PlayerState, TerrainType } from './types';

export const PLAINS_SPEED = 1.0;
export const MOUNTAINS_SPEED = 0.35;

const WILDERNESS_BASE_COST = 1.4;
const ENEMY_BASE_COST = 3.2;

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
    owners[startIdx] !== 0
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
      if (terrain[nIdx] === TerrainType.WATER || owners[nIdx] !== 0) continue;
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
  readonly score: number;
}

interface ExpandableOrder {
  playerId: number;
  manpowerCommitted: number;
  manpowerRemaining: number;
  ticksRemaining: number;
  mountainAccum: number;
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
    Math.max(2.6, order.manpowerCommitted * 0.13),
  );
  let budgetSpent = 0;
  let anyClaimed = false;

  for (const cand of candidates) {
    if (order.manpowerRemaining < WILDERNESS_BASE_COST) {
      break;
    }

    const prevOwner = state.owners[cand.idx];
    if (prevOwner === order.playerId) {
      continue;
    }

    const cellTerrain = state.terrain[cand.idx];
    if (cellTerrain === TerrainType.WATER) {
      continue;
    }

    const baseCost = prevOwner === 0 ? WILDERNESS_BASE_COST : ENEMY_BASE_COST;
    const terrainSpeed =
      cellTerrain === TerrainType.MOUNTAINS ? MOUNTAINS_SPEED : PLAINS_SPEED;
    const effectiveCost = baseCost / terrainSpeed;

    if (budgetSpent + effectiveCost > tickBudget) {
      // Allow mountain accumulation when the remaining tick budget can't cover a full mountain step
      if (cellTerrain === TerrainType.MOUNTAINS && budgetSpent === 0) {
        const stepCharge = Math.min(tickBudget, order.manpowerRemaining);
        order.mountainAccum += stepCharge;
        if (order.mountainAccum >= effectiveCost && order.manpowerRemaining >= effectiveCost) {
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

    if (prevOwner > 0) {
      const defender: PlayerState | undefined = state.players.get(prevOwner);
      if (defender && defender.alive) {
        defender.manpower = Math.max(0, defender.manpower - 0.85);
      }
    }

    if (onClaim) {
      onClaim(cand.idx);
    }
  }

  return anyClaimed;
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

    order.ticksRemaining--;
    const arrowLength = Math.hypot(order.toX - order.fromX, order.toY - order.fromY);
    const maxProj = Math.max(arrowLength + 28, 44);
    const halfCorridor = Math.max(12, Math.min(20, arrowLength * 0.35));

    const candidateBestScore = new Map<number, number>();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (owners[idx] !== order.playerId) {
          continue;
        }

        const relX = x - order.fromX;
        const relY = y - order.fromY;
        const proj = relX * order.dirX + relY * order.dirY;
        if (proj < -6 || proj > maxProj) {
          continue;
        }
        const perp = Math.abs(relX * -order.dirY + relY * order.dirX);
        if (perp > halfCorridor) {
          continue;
        }

        for (const [dx, dy] of NEIGHBOR_OFFSETS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (terrain[nIdx] === TerrainType.WATER || owners[nIdx] === order.playerId) {
            continue;
          }

          const stepLen = Math.hypot(dx, dy);
          const dot = (dx * order.dirX + dy * order.dirY) / stepLen;
          if (dot < -0.15) {
            continue;
          }

          const nRelX = nx - order.fromX;
          const nRelY = ny - order.fromY;
          const nPerp = Math.abs(nRelX * -order.dirY + nRelY * order.dirX);
          const friendly = countFriendlyNeighbors(state, nx, ny, order.playerId);
          const terrainBonus = terrain[nIdx] === TerrainType.MOUNTAINS ? -0.45 : 0;
          const score = dot * 3.0 - nPerp * 0.12 + friendly * 0.45 + terrainBonus;

          const existingScore = candidateBestScore.get(nIdx);
          if (existingScore === undefined || score > existingScore) {
            candidateBestScore.set(nIdx, score);
          }
        }
      }
    }

    const candidates: ExpansionCandidate[] = [];
    for (const [idx, score] of candidateBestScore) {
      candidates.push({ idx, score });
    }

    const claimed = applyExpansionCandidates(state, order, candidates);
    if (claimed) {
      mapChanged = true;
    }

    if (
      order.manpowerRemaining >= WILDERNESS_BASE_COST &&
      order.ticksRemaining > 0 &&
      candidates.length > 0
    ) {
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
    const candidateBestScore = new Map<number, number>();

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
        if (terrain[nIdx] === TerrainType.WATER || owners[nIdx] === order.playerId) {
          continue;
        }

        hasTarget = true;
        const stepLen = Math.hypot(dx, dy);
        const dot = (dx * order.dirX + dy * order.dirY) / stepLen;
        if (dot < 0.2) {
          continue;
        }

        const friendly = countFriendlyNeighbors(state, nx, ny, order.playerId);
        const terrainBonus = terrain[nIdx] === TerrainType.MOUNTAINS ? -0.45 : 0;
        const score = dot * 2.6 + friendly * 0.5 + terrainBonus;

        const existingScore = candidateBestScore.get(nIdx);
        if (existingScore === undefined || score > existingScore) {
          candidateBestScore.set(nIdx, score);
        }
      }

      if (hasTarget) {
        activeFrontierSet.add(cellIdx);
      }
    }

    const candidates: ExpansionCandidate[] = [];
    for (const [idx, score] of candidateBestScore) {
      candidates.push({ idx, score });
    }

    const claimed = applyExpansionCandidates(state, order, candidates, (claimedIdx) => {
      activeFrontierSet.add(claimedIdx);
    });
    if (claimed) {
      mapChanged = true;
    }

    order.frontierCells = Array.from(activeFrontierSet);

    if (
      order.manpowerRemaining >= WILDERNESS_BASE_COST &&
      order.ticksRemaining > 0 &&
      order.frontierCells.length > 0 &&
      candidates.length > 0
    ) {
      remainingOrders.push(order);
    }
  }

  state.frontPushOrders = remainingOrders;
  return mapChanged;
}

export function stepFrontExpansion(state: GameState): void {
  const changedByAttacks = stepAttackOrders(state);
  const changedByPushes = stepFrontPushOrders(state);
  if (changedByAttacks || changedByPushes) {
    state.stateVersion++;
  }
}
