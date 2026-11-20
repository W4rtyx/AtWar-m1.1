import { claimInitialTerritory, isBorderCell } from './frontExpansion';
import { nextRandom } from './mapGenerator';
import { GameState, PlayerState, TerrainType } from './types';

interface BotIdentity {
  readonly name: string;
  readonly colorHex: string;
  readonly colorRgb: readonly [number, number, number];
}

const BOT_IDENTITIES: ReadonlyArray<BotIdentity> = [
  { name: 'Iberský Pakt', colorHex: '#9e5347', colorRgb: [158, 83, 71] },
  { name: 'Alpská Koalice', colorHex: '#5b7d53', colorRgb: [91, 125, 83] },
  { name: 'Severní Unie', colorHex: '#8d7548', colorRgb: [141, 117, 72] },
  { name: 'Východní Marka', colorHex: '#735b87', colorRgb: [115, 91, 135] },
  { name: 'Balkánský Svaz', colorHex: '#9c6e44', colorRgb: [156, 110, 68] },
  { name: 'Kaledonie', colorHex: '#4f7a75', colorRgb: [79, 122, 117] },
  { name: 'Panonská Liga', colorHex: '#8a566f', colorRgb: [138, 86, 111] },
];

function countFreeLandInRadius(
  state: GameState,
  cx: number,
  cy: number,
  radius: number,
): number {
  const { width, height, terrain, owners } = state;
  const rSq = radius * radius;
  let count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    const ny = cy + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = cx + dx;
      if (nx < 0 || nx >= width) continue;
      if (dx * dx + dy * dy <= rSq) {
        const idx = ny * width + nx;
        if (terrain[idx] !== TerrainType.WATER && owners[idx] === 0) {
          count++;
        }
      }
    }
  }
  return count;
}

export function spawnBots(state: GameState, count: number): void {
  const { width, height, terrain, owners } = state;
  const startRadius = 6;
  const rngBox = { rngState: state.rngState };

  for (let i = 0; i < count && i < BOT_IDENTITIES.length; i++) {
    const botId = i + 2;
    const identity = BOT_IDENTITIES[i];

    // Sample candidate land points and pick one with the largest minimum distance to existing capitals
    let bestX = -1;
    let bestY = -1;
    let bestScore = -1;

    for (let attempt = 0; attempt < 260; attempt++) {
      const x = 14 + Math.floor(nextRandom(rngBox) * (width - 28));
      const y = 10 + Math.floor(nextRandom(rngBox) * (height - 20));
      const idx = y * width + x;

      if (terrain[idx] !== TerrainType.PLAINS || owners[idx] !== 0) {
        continue;
      }

      const freeLand = countFreeLandInRadius(state, x, y, startRadius);
      if (freeLand < 26) {
        continue;
      }

      let minDist = Infinity;
      for (const existing of state.players.values()) {
        const d = Math.hypot(x - existing.capitalX, y - existing.capitalY);
        if (d < minDist) {
          minDist = d;
        }
      }

      // Prefer well-spaced capitals with plenty of surrounding plains
      const score = Math.min(minDist, 75) + freeLand * 0.15;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }

    if (bestX === -1) {
      continue;
    }

    const claimed = claimInitialTerritory(state, botId, bestX, bestY, startRadius);
    if (claimed === 0) {
      continue;
    }

    const botState: PlayerState = {
      id: botId,
      name: identity.name,
      isBot: true,
      colorHex: identity.colorHex,
      colorRgb: identity.colorRgb,
      capitalX: bestX,
      capitalY: bestY,
      manpower: 160,
      maxManpower: 300 + claimed * 1.4,
      manpowerIncomePerSec: 10 + claimed * 0.08,
      territoryCells: claimed,
      alive: true,
    };

    state.players.set(botId, botState);
  }

  state.rngState = rngBox.rngState;
}

interface BotTargetCandidate {
  readonly bx: number;
  readonly by: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly isWilderness: boolean;
}

export function stepBots(state: GameState): void {
  const { width, height, owners, terrain } = state;
  const rngBox = { rngState: state.rngState };

  for (const player of state.players.values()) {
    if (!player.isBot || !player.alive) {
      continue;
    }

    // Stagger AI decisions every 16 ticks (~1.6s)
    if ((state.tick + player.id * 3) % 16 !== 0) {
      continue;
    }

    const activeBotOrders = state.attackOrders.filter((o) => o.playerId === player.id).length;
    if (activeBotOrders >= 2 || player.manpower < 48) {
      continue;
    }

    const wildernessTargets: BotTargetCandidate[] = [];
    const enemyTargets: BotTargetCandidate[] = [];

    // Sample border cells to find outward expansion directions
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        if (!isBorderCell(state, x, y, player.id)) {
          continue;
        }

        let sumWildX = 0;
        let sumWildY = 0;
        let wildCount = 0;
        let sumEnemyX = 0;
        let sumEnemyY = 0;
        let enemyCount = 0;

        for (let dy = -3; dy <= 3; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;
            const nIdx = ny * width + nx;
            if (terrain[nIdx] === TerrainType.WATER) continue;
            const nOwner = owners[nIdx];
            if (nOwner === 0) {
              sumWildX += dx;
              sumWildY += dy;
              wildCount++;
            } else if (nOwner !== player.id) {
              sumEnemyX += dx;
              sumEnemyY += dy;
              enemyCount++;
            }
          }
        }

        if (wildCount > 0) {
          const len = Math.hypot(sumWildX, sumWildY);
          if (len > 0.1) {
            wildernessTargets.push({
              bx: x,
              by: y,
              dirX: sumWildX / len,
              dirY: sumWildY / len,
              isWilderness: true,
            });
          }
        } else if (enemyCount > 0) {
          const len = Math.hypot(sumEnemyX, sumEnemyY);
          if (len > 0.1) {
            enemyTargets.push({
              bx: x,
              by: y,
              dirX: sumEnemyX / len,
              dirY: sumEnemyY / len,
              isWilderness: false,
            });
          }
        }
      }
    }

    const pool = wildernessTargets.length > 0 ? wildernessTargets : enemyTargets;
    if (pool.length === 0) {
      continue;
    }

    const chosen = pool[Math.floor(nextRandom(rngBox) * pool.length)];
    const pushDist = chosen.isWilderness ? 14 : 11;
    const toX = Math.max(0, Math.min(width - 1, Math.round(chosen.bx + chosen.dirX * pushDist)));
    const toY = Math.max(0, Math.min(height - 1, Math.round(chosen.by + chosen.dirY * pushDist)));

    const commitRatio = chosen.isWilderness
      ? 0.22 + nextRandom(rngBox) * 0.1
      : 0.28 + nextRandom(rngBox) * 0.12;
    const manpowerCommitted = player.manpower * commitRatio;
    if (manpowerCommitted < 12) {
      continue;
    }

    player.manpower -= manpowerCommitted;
    state.attackOrders.push({
      id: state.nextOrderId++,
      playerId: player.id,
      fromX: chosen.bx,
      fromY: chosen.by,
      toX,
      toY,
      dirX: chosen.dirX,
      dirY: chosen.dirY,
      manpowerCommitted,
      manpowerRemaining: manpowerCommitted,
      ticksRemaining: 65,
      mountainAccum: 0,
    });
  }

  state.rngState = rngBox.rngState;
}
