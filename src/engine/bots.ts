import { createInitialPlayerState, syncPlayerActiveManpower } from './economy';
import {
  MAX_ORDER_TICKS,
  buildSmoothAttackWaypoints,
  claimInitialTerritory,
  computePolylineLength,
  countFriendlyNeighbors,
  getRelation,
  isBorderCell,
  setWarRelation,
} from './frontExpansion';
import { nextRandom } from './mapGenerator';
import {
  GameState,
  Point,
  TerrainType,
  WILDERNESS_OWNER,
} from './types';

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
  { name: 'Pobaltí', colorHex: '#59746b', colorRgb: [89, 116, 107] },
  { name: 'Kyjevská Rus', colorHex: '#7e664b', colorRgb: [126, 102, 75] },
  { name: 'Italská Liga', colorHex: '#6c7c4e', colorRgb: [108, 124, 78] },
  { name: 'Akvitánie', colorHex: '#7d5a5a', colorRgb: [125, 90, 90] },
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
  for (let dy = -radius; dy <= radius; dy += 2) {
    const ny = cy + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -radius; dx <= radius; dx += 2) {
      const nx = cx + dx;
      if (nx < 0 || nx >= width) continue;
      if (dx * dx + dy * dy <= rSq) {
        const idx = ny * width + nx;
        if (terrain[idx] !== TerrainType.WATER && owners[idx] === WILDERNESS_OWNER) {
          count++;
        }
      }
    }
  }
  return count;
}

export function spawnBots(state: GameState, count: number): void {
  const { width, height, terrain, owners } = state;
  const startRadius = 14;
  const rngBox = { rngState: state.rngState };

  for (let i = 0; i < count && i < BOT_IDENTITIES.length; i++) {
    const botId = i + 2;
    const identity = BOT_IDENTITIES[i];

    let bestX = -1;
    let bestY = -1;
    let bestScore = -1;

    for (let attempt = 0; attempt < 320; attempt++) {
      const x = 32 + Math.floor(nextRandom(rngBox) * (width - 64));
      const y = 24 + Math.floor(nextRandom(rngBox) * (height - 48));
      const idx = y * width + x;

      if (terrain[idx] !== TerrainType.PLAINS || owners[idx] !== WILDERNESS_OWNER) {
        continue;
      }

      const freeLand = countFreeLandInRadius(state, x, y, startRadius);
      if (freeLand < 110) {
        continue;
      }

      let minDist = Infinity;
      for (const existing of state.players.values()) {
        const d = Math.hypot(x - existing.capitalX, y - existing.capitalY);
        if (d < minDist) {
          minDist = d;
        }
      }

      const score = Math.min(minDist, 145) + freeLand * 0.08;
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

    const botState = createInitialPlayerState({
      id: botId,
      name: identity.name,
      isBot: true,
      colorHex: identity.colorHex,
      colorRgb: identity.colorRgb,
      capitalX: bestX,
      capitalY: bestY,
      territoryCells: claimed,
      nextBotDecisionTick: 6 + i * 2,
    });

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
  readonly targetOwnerId: number;
  readonly tacticalScore: number;
}

function hasActiveWarOpponent(state: GameState, botId: number): boolean {
  for (const other of state.players.values()) {
    if (other.id !== botId && other.alive && getRelation(state, botId, other.id) === 'WAR') {
      return true;
    }
  }
  return false;
}

export function stepBots(state: GameState): void {
  const { width, height, owners, terrain } = state;
  const rngBox = { rngState: state.rngState };

  for (const player of state.players.values()) {
    if (!player.isBot || !player.alive || player.isEliminated) {
      continue;
    }

    if (state.tick < player.nextBotDecisionTick) {
      continue;
    }
    player.nextBotDecisionTick =
      state.tick + 14 + Math.floor(nextRandom(rngBox) * 6);

    // One well-coordinated attack at a time to avoid scattered manpower waste
    const activeBotOrders = state.attackOrders.filter((o) => o.playerId === player.id).length;
    const activeMp = Math.max(0, player.manpower - player.allocatedManpower);
    if (activeBotOrders >= 1 || activeMp < player.maxManpower * 0.38) {
      continue;
    }

    const wildernessTargets: BotTargetCandidate[] = [];
    const warTargets: BotTargetCandidate[] = [];
    const neutralTargets: BotTargetCandidate[] = [];

    for (let y = 0; y < height; y += 3) {
      for (let x = 0; x < width; x += 3) {
        if (!isBorderCell(state, x, y, player.id)) {
          continue;
        }

        let sumWildX = 0;
        let sumWildY = 0;
        let wildCount = 0;
        let sumWarX = 0;
        let sumWarY = 0;
        let warCount = 0;
        let warOwnerId = -1;
        let warPlainsCount = 0;
        let sumNeutralX = 0;
        let sumNeutralY = 0;
        let neutralCount = 0;
        let neutralOwnerId = -1;

        for (let dy = -6; dy <= 6; dy += 2) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -6; dx <= 6; dx += 2) {
            const nx = x + dx;
            if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;
            const nIdx = ny * width + nx;
            const nTerrain = terrain[nIdx];
            if (nTerrain === TerrainType.WATER) continue;
            const nOwner = owners[nIdx];
            if (nOwner === WILDERNESS_OWNER) {
              sumWildX += dx;
              sumWildY += dy;
              wildCount++;
            } else if (nOwner >= 0 && nOwner !== player.id) {
              const rel = getRelation(state, player.id, nOwner);
              if (rel === 'WAR') {
                sumWarX += dx;
                sumWarY += dy;
                warCount++;
                warOwnerId = nOwner;
                if (nTerrain === TerrainType.PLAINS) warPlainsCount++;
              } else if (rel === 'NEUTRAL') {
                sumNeutralX += dx;
                sumNeutralY += dy;
                neutralCount++;
                neutralOwnerId = nOwner;
              }
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
              targetOwnerId: WILDERNESS_OWNER,
              tacticalScore: wildCount,
            });
          }
        } else if (warCount > 0 && warOwnerId >= 0) {
          const len = Math.hypot(sumWarX, sumWarY);
          if (len > 0.1) {
            const enemyNeighbors = countFriendlyNeighbors(state, x, y, warOwnerId);
            const targetState = state.players.get(warOwnerId);
            const betrayalBonus = targetState && targetState.betrayalDebuffTicks > 0 ? 4 : 0;
            warTargets.push({
              bx: x,
              by: y,
              dirX: sumWarX / len,
              dirY: sumWarY / len,
              isWilderness: false,
              targetOwnerId: warOwnerId,
              tacticalScore:
                warPlainsCount * 1.4 - enemyNeighbors * 0.8 + betrayalBonus + nextRandom(rngBox),
            });
          }
        } else if (neutralCount > 0 && neutralOwnerId >= 0) {
          const len = Math.hypot(sumNeutralX, sumNeutralY);
          if (len > 0.1) {
            neutralTargets.push({
              bx: x,
              by: y,
              dirX: sumNeutralX / len,
              dirY: sumNeutralY / len,
              isWilderness: false,
              targetOwnerId: neutralOwnerId,
              tacticalScore: neutralCount,
            });
          }
        }
      }
    }

    let chosen: BotTargetCandidate | null = null;
    if (wildernessTargets.length > 0) {
      chosen =
        wildernessTargets[Math.floor(nextRandom(rngBox) * wildernessTargets.length)];
    } else if (
      warTargets.length > 0 &&
      activeMp >= player.maxManpower * 0.44
    ) {
      warTargets.sort((a, b) => b.tacticalScore - a.tacticalScore);
      const topSlice = Math.min(4, warTargets.length);
      chosen = warTargets[Math.floor(nextRandom(rngBox) * topSlice)];
    } else if (
      neutralTargets.length > 0 &&
      !hasActiveWarOpponent(state, player.id) &&
      activeMp >= player.maxManpower * 0.48 &&
      nextRandom(rngBox) < 0.35
    ) {
      chosen = neutralTargets[Math.floor(nextRandom(rngBox) * neutralTargets.length)];
    }

    if (!chosen) {
      continue;
    }

    // Bidirectional WAR registration before launching any attack on a foreign state
    if (chosen.targetOwnerId >= 0) {
      setWarRelation(state, player.id, chosen.targetOwnerId);
    }

    const pushDist = chosen.isWilderness ? 42 : 30;
    const rawPts: Point[] = [
      { x: chosen.bx + 0.5, y: chosen.by + 0.5 },
      {
        x: Math.max(0, Math.min(width - 1, chosen.bx + chosen.dirX * pushDist)),
        y: Math.max(0, Math.min(height - 1, chosen.by + chosen.dirY * pushDist)),
      },
    ];
    const bendOffset = (nextRandom(rngBox) - 0.5) * 12;
    const waypoints = buildSmoothAttackWaypoints(rawPts, bendOffset);
    const totalPathLength = computePolylineLength(waypoints);
    if (totalPathLength < 6) {
      continue;
    }

    const commitRatio = chosen.isWilderness ? 0.2 : 0.25;
    const manpowerCommitted = activeMp * commitRatio;
    if (manpowerCommitted < 16) {
      continue;
    }

    player.manpower -= manpowerCommitted;
    syncPlayerActiveManpower(player);
    state.attackOrders.push({
      id: state.nextOrderId++,
      playerId: player.id,
      origin: waypoints[0],
      waypoints,
      frontierArc: 0,
      targetOwnerIds: chosen.targetOwnerId >= 0 ? [chosen.targetOwnerId] : [],
      wildernessOnly: chosen.targetOwnerId < 0,
      currentSegmentIndex: 0,
      segmentProgress: 0,
      totalPathLength,
      manpowerCommitted,
      manpowerRemaining: manpowerCommitted,
      ticksRemaining: MAX_ORDER_TICKS,
      maxTicks: MAX_ORDER_TICKS,
      stagnantTicks: 0,
      mountainAccum: 0,
    });
  }

  state.rngState = rngBox.rngState;
}
