import { getTechLevel } from './techTree';
import {
  GameState,
  RareLootRewardType,
  RareLootZonePublic,
  RareLootZoneSecret,
  TerrainType,
  WILDERNESS_OWNER,
} from './types';

function nextLootRand(rngBox: { rngState: number }): number {
  let x = rngBox.rngState | 0;
  if (x === 0) {
    x = 0x6d2b79f5;
  }
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rngBox.rngState = x;
  return (x >>> 0) / 4294967296;
}

const LOOT_REWARD_CYCLE: ReadonlyArray<{
  readonly rewardType: RareLootRewardType;
  readonly amount: number;
}> = [
  { rewardType: 'KNOWLEDGE', amount: 140 },
  { rewardType: 'INDUSTRY', amount: 220 },
  { rewardType: 'MONEY', amount: 460 },
  { rewardType: 'MATERIAL', amount: 340 },
  { rewardType: 'KNOWLEDGE', amount: 180 },
  { rewardType: 'INDUSTRY', amount: 280 },
  { rewardType: 'MONEY', amount: 520 },
];

const BASE_SEARCH_RADIUS = 24;
const L1_SEARCH_RADIUS = 11;
const L5_SEARCH_RADIUS = 4;

function offsetCircleContainingPoint(
  exactX: number,
  exactY: number,
  radius: number,
  minOffset: number,
  maxOffset: number,
  width: number,
  height: number,
  rngBox: { rngState: number },
): { readonly cx: number; readonly cy: number; readonly radius: number } {
  const angle = nextLootRand(rngBox) * Math.PI * 2;
  const dist = minOffset + nextLootRand(rngBox) * Math.max(0.5, maxOffset - minOffset);
  const cx = Math.max(radius * 0.5, Math.min(width - 1, Math.round(exactX + Math.cos(angle) * dist)));
  const cy = Math.max(radius * 0.5, Math.min(height - 1, Math.round(exactY + Math.sin(angle) * dist)));
  return { cx, cy, radius };
}

/** Generates 7 secret Rare Loot zones across land tiles on Europe map. */
export function generateRareLootZones(
  terrain: Uint8Array,
  width: number,
  height: number,
  rngBox: { rngState: number },
): RareLootZoneSecret[] {
  const zones: RareLootZoneSecret[] = [];
  const targetCount = LOOT_REWARD_CYCLE.length;
  let attempts = 0;

  while (zones.length < targetCount && attempts < 1400) {
    attempts++;
    const x = 45 + Math.floor(nextLootRand(rngBox) * (width - 90));
    const y = 40 + Math.floor(nextLootRand(rngBox) * (height - 80));
    if (terrain[y * width + x] === TerrainType.WATER) continue;

    let tooClose = false;
    for (const prev of zones) {
      if (Math.hypot(prev.exactX - x, prev.exactY - y) < 62) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const reward = LOOT_REWARD_CYCLE[zones.length];
    const base = offsetCircleContainingPoint(x, y, BASE_SEARCH_RADIUS, 6, 15, width, height, rngBox);
    const l1 = offsetCircleContainingPoint(x, y, L1_SEARCH_RADIUS, 3, 7, width, height, rngBox);
    const l5 = offsetCircleContainingPoint(x, y, L5_SEARCH_RADIUS, 1, 2, width, height, rngBox);

    zones.push({
      id: zones.length + 1,
      rewardType: reward.rewardType,
      exactX: x,
      exactY: y,
      baseCenterX: base.cx,
      baseCenterY: base.cy,
      baseRadius: base.radius,
      l1CenterX: l1.cx,
      l1CenterY: l1.cy,
      l1Radius: l1.radius,
      l5CenterX: l5.cx,
      l5CenterY: l5.cy,
      l5Radius: l5.radius,
      amount: reward.amount,
      claimedByPlayerId: null,
    });
  }

  return zones;
}

/**
 * Produces strictly sanitized public Rare Loot zone search circles:
 * Never exposes `exactX` or `exactY` to clients (anti-F12 protection).
 * Search radius shrinks with ECONOMY_DEFENSE L1 and L5 technologies.
 */
export function toPublicRareLootZones(
  state: GameState,
  viewerPlayerId: number,
): RareLootZonePublic[] {
  const viewer = state.players.get(viewerPlayerId);
  const ecoLevel = getTechLevel(viewer, 'ECONOMY_DEFENSE');

  return state.secretLootZones.map((zone) => {
    const useL5 = ecoLevel >= 5;
    const useL1 = !useL5 && ecoLevel >= 1;
    const displayCenterX = useL5
      ? zone.l5CenterX
      : useL1
        ? zone.l1CenterX
        : zone.baseCenterX;
    const displayCenterY = useL5
      ? zone.l5CenterY
      : useL1
        ? zone.l1CenterY
        : zone.baseCenterY;
    const displayRadius = useL5
      ? zone.l5Radius
      : useL1
        ? zone.l1Radius
        : zone.baseRadius;

    return {
      id: zone.id,
      rewardType: zone.rewardType,
      displayCenterX,
      displayCenterY,
      displayRadius,
      amount: zone.amount,
      claimedByPlayerId: zone.claimedByPlayerId,
    };
  });
}

/** Checks whether any player now owns the exact secret cell of an unclaimed Rare Loot zone. */
export function checkAndAwardCapturedLootZones(state: GameState): boolean {
  let anyAwarded = false;
  for (const zone of state.secretLootZones) {
    if (zone.claimedByPlayerId !== null) continue;
    const ownerId = state.owners[zone.exactY * state.width + zone.exactX];
    if (ownerId < 0 || ownerId === WILDERNESS_OWNER) continue;
    const player = state.players.get(ownerId);
    if (!player || !player.alive || player.isEliminated) continue;

    zone.claimedByPlayerId = ownerId;
    anyAwarded = true;

    switch (zone.rewardType) {
      case 'MONEY':
        player.money += zone.amount;
        break;
      case 'MATERIAL':
        player.buildingMaterial += zone.amount;
        break;
      case 'INDUSTRY':
        player.industry += zone.amount;
        break;
      case 'KNOWLEDGE':
        player.knowledge += zone.amount;
        break;
    }

    if (ownerId === state.humanPlayerId) {
      const label =
        zone.rewardType === 'MONEY'
          ? 'Peněz'
          : zone.rewardType === 'MATERIAL'
            ? 'Stavebního materiálu'
            : zone.rewardType === 'INDUSTRY'
              ? 'Průmyslu'
              : 'Znalostí (Knowledge)';
      state.lastNotice = {
        id: state.nextNoticeId++,
        messageCs: `Nalezeno vzácné naleziště: +${zone.amount} ${label}!`,
        tick: state.tick,
      };
    }
  }

  if (anyAwarded) {
    state.stateVersion++;
  }
  return anyAwarded;
}
