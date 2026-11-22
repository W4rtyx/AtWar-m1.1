import {
  AIRFIELD_OPERATION_RANGE,
  RADAR_STATION_VISION_RADIUS,
  isNavalUnitType,
} from './navalAir';
import {
  ArrowProfile,
  Building,
  BuildingType,
  DiplomaticRelation,
  GameState,
  IntelTier,
  PlayerState,
  StrategicStrikeKind,
  TechBranch,
  TechLevel,
  TechStateByBranch,
  TerrainType,
  UnitType,
  WILDERNESS_OWNER,
  getRelationKey,
} from './types';

export interface TechCost {
  readonly knowledge: number;
  readonly money: number;
  readonly industry: number;
}

export interface TechNodeSpec {
  readonly branch: TechBranch;
  readonly level: 1 | 2 | 3 | 4 | 5;
  readonly nameCs: string;
  readonly summaryCs: string;
  readonly cost: TechCost;
}

export interface TechBranchMeta {
  readonly branch: TechBranch;
  readonly titleCs: string;
  readonly accentColor: string;
}

export const TECH_BRANCH_META: Readonly<Record<TechBranch, TechBranchMeta>> = {
  GROUND: { branch: 'GROUND', titleCs: 'Pozemní armáda', accentColor: '#7cb56b' },
  ARTILLERY_SUPPORT: { branch: 'ARTILLERY_SUPPORT', titleCs: 'Dělostřelectvo a podpora', accentColor: '#e09a52' },
  AIR_STRATEGIC: { branch: 'AIR_STRATEGIC', titleCs: 'Letectvo a strategické zbraně', accentColor: '#76bce3' },
  NAVAL: { branch: 'NAVAL', titleCs: 'Námořnictvo', accentColor: '#5298cc' },
  ECONOMY_DEFENSE: { branch: 'ECONOMY_DEFENSE', titleCs: 'Ekonomika a obrana', accentColor: '#c7a456' },
};

export const TECH_TREE_SPECS: Readonly<Record<TechBranch, ReadonlyArray<TechNodeSpec>>> = {
  GROUND: [
    {
      branch: 'GROUND',
      level: 1,
      nameCs: 'Vylepšená pěchota',
      summaryCs: '+15 % útok a HP všech pěších divizí (INFANTRY).',
      cost: { knowledge: 35, money: 140, industry: 0 },
    },
    {
      branch: 'GROUND',
      level: 2,
      nameCs: 'Střední tanky',
      summaryCs: '+20 % útok/průbojnost a HP tankových svazků (TANK).',
      cost: { knowledge: 75, money: 220, industry: 45 },
    },
    {
      branch: 'GROUND',
      level: 3,
      nameCs: 'Průbojný profil šipky',
      summaryCs: 'Odemyká útočný profil Špička (SPEARHEAD): užší koridor a +25 % rychlost průlomu.',
      cost: { knowledge: 130, money: 320, industry: 85 },
    },
    {
      branch: 'GROUND',
      level: 4,
      nameCs: 'Těžká obrněná doktrína',
      summaryCs: '+25 % odolnost tanků proti TRENCH/BUNKER a +15 % rychlost přesunu.',
      cost: { knowledge: 210, money: 460, industry: 145 },
    },
    {
      branch: 'GROUND',
      level: 5,
      nameCs: 'Elitní mechanizovaný sbor',
      summaryCs: 'Aura +15 % síly frontových šipek v dosahu tanku a zajetí poražených obklíčených oddílů.',
      cost: { knowledge: 320, money: 680, industry: 240 },
    },
  ],
  ARTILLERY_SUPPORT: [
    {
      branch: 'ARTILLERY_SUPPORT',
      level: 1,
      nameCs: 'Delší dostřel dělostřelectva',
      summaryCs: '+20 % dostřel a operační dosah u ARTILLERY.',
      cost: { knowledge: 35, money: 130, industry: 25 },
    },
    {
      branch: 'ARTILLERY_SUPPORT',
      level: 2,
      nameCs: 'Těžká munice',
      summaryCs: '+25 % poškození obranám a silnější Manpower Suppression.',
      cost: { knowledge: 75, money: 210, industry: 65 },
    },
    {
      branch: 'ARTILLERY_SUPPORT',
      level: 3,
      nameCs: 'Zesílená PVO',
      summaryCs: 'AA_BATTERY získává +30 % dosah a +30 % poškození letectvu a výsadkům.',
      cost: { knowledge: 135, money: 310, industry: 110 },
    },
    {
      branch: 'ARTILLERY_SUPPORT',
      level: 4,
      nameCs: 'Raketové dělostřelectvo',
      summaryCs: '−25 % spotřeba Průmyslu za salvu a rychlejší palba ARTILLERY.',
      cost: { knowledge: 215, money: 440, industry: 175 },
    },
    {
      branch: 'ARTILLERY_SUPPORT',
      level: 5,
      nameCs: 'Dálkové raketové silo',
      summaryCs: 'Odemyká stavbu MISSILE_SILO (dostřel 360 b.) pro dálkové raketové údery na týl nepřítele.',
      cost: { knowledge: 330, money: 700, industry: 280 },
    },
  ],
  AIR_STRATEGIC: [
    {
      branch: 'AIR_STRATEGIC',
      level: 1,
      nameCs: 'Průzkumná optika',
      summaryCs: 'Intel Tier 2: odhaluje ekonomické budovy nepřítele pod průzkumem RECON_PLANE.',
      cost: { knowledge: 40, money: 140, industry: 20 },
    },
    {
      branch: 'AIR_STRATEGIC',
      level: 2,
      nameCs: 'Dálkový dolet letišť',
      summaryCs: '+25 % operační dolet (airRange) všech vlastních letišť AIRFIELD.',
      cost: { knowledge: 80, money: 230, industry: 55 },
    },
    {
      branch: 'AIR_STRATEGIC',
      level: 3,
      nameCs: 'Těžké bombardéry',
      summaryCs: '+30 % poškození BOMBER proti budovám, obranám a svazkům.',
      cost: { knowledge: 140, money: 340, industry: 120 },
    },
    {
      branch: 'AIR_STRATEGIC',
      level: 4,
      nameCs: 'Vzdušná nadvláda',
      summaryCs: 'Intel Tier 3: +35 % účinnost FIGHTER a letecké odhalování skrytých TRENCH/BUNKER.',
      cost: { knowledge: 225, money: 480, industry: 185 },
    },
    {
      branch: 'AIR_STRATEGIC',
      level: 5,
      nameCs: 'Jaderná doktrína',
      summaryCs: 'Odemyká strategický jaderný úder z MISSILE_SILO nebo AIRFIELD (masivní ničení infrastruktury a MP).',
      cost: { knowledge: 360, money: 780, industry: 340 },
    },
  ],
  NAVAL: [
    {
      branch: 'NAVAL',
      level: 1,
      nameCs: 'Rychlé transporty',
      summaryCs: '+25 % rychlost a HP lodí TRANSPORT_SHIP při vylodění.',
      cost: { knowledge: 35, money: 130, industry: 20 },
    },
    {
      branch: 'NAVAL',
      level: 2,
      nameCs: 'Námořní dělostřelectvo',
      summaryCs: '+25 % dostřel a útok křižníků (CRUISER).',
      cost: { knowledge: 75, money: 220, industry: 60 },
    },
    {
      branch: 'NAVAL',
      level: 3,
      nameCs: 'Sonar a protiponorkový boj',
      summaryCs: 'Intel Tier 4 na moři: CRUISER, RADAR_SHIP a RECON odhalují ponorky na velkou vzdálenost.',
      cost: { knowledge: 130, money: 310, industry: 100 },
    },
    {
      branch: 'NAVAL',
      level: 4,
      nameCs: 'Tiché ponorky',
      summaryCs: '+35 % přepadová síla SUBMARINE a o 25 % těžší detekce nepřítelem.',
      cost: { knowledge: 205, money: 430, industry: 160 },
    },
    {
      branch: 'NAVAL',
      level: 5,
      nameCs: 'Námořní dominance',
      summaryCs: '+25 % HP a útok všech lodí; pobřežní palba CRUISER stojí −25 % Průmyslu.',
      cost: { knowledge: 310, money: 640, industry: 230 },
    },
  ],
  ECONOMY_DEFENSE: [
    {
      branch: 'ECONOMY_DEFENSE',
      level: 1,
      nameCs: 'Geologický průzkum',
      summaryCs: 'Zpřesňuje kruhy Rare Loot zón na mapě a zvyšuje výnos MINE o +10 %.',
      cost: { knowledge: 30, money: 120, industry: 0 },
    },
    {
      branch: 'ECONOMY_DEFENSE',
      level: 2,
      nameCs: 'Modernizace těžby a sítě',
      summaryCs: '+20 % produkce MINE a POWER_PLANT, +25 % strop zásobníku energie.',
      cost: { knowledge: 70, money: 210, industry: 40 },
    },
    {
      branch: 'ECONOMY_DEFENSE',
      level: 3,
      nameCs: 'Protitanková blokáda (Pevnost L2)',
      summaryCs: 'Intel Tier 3 a silně zesílený BUNKER: mimořádně brzdí a ničí tankové svazky.',
      cost: { knowledge: 125, money: 320, industry: 95 },
    },
    {
      branch: 'ECONOMY_DEFENSE',
      level: 4,
      nameCs: 'Pokročilý průmysl',
      summaryCs: '+25 % produkce FACTORY a nižší ztráta účinnosti při 200% přetížení.',
      cost: { knowledge: 200, money: 450, industry: 150 },
    },
    {
      branch: 'ECONOMY_DEFENSE',
      level: 5,
      nameCs: 'Radarová síť a věda',
      summaryCs: 'Intel Tier 4: +30 % dosah RADAR_STATION, +25 % produkce LAB a finální zpřesnění Rare Loot.',
      cost: { knowledge: 315, money: 660, industry: 220 },
    },
  ],
};

export const MISSILE_STRIKE_RANGE = 360;
export const NUCLEAR_SILO_RANGE = 420;
export const MISSILE_STRIKE_COOLDOWN_TICKS = 120;
export const NUCLEAR_STRIKE_COOLDOWN_TICKS = 240;
export const MISSILE_STRIKE_COST = { money: 200, industry: 140 };
export const NUCLEAR_STRIKE_COST = { money: 600, industry: 320 };

export function createInitialTechState(): TechStateByBranch {
  return {
    GROUND: 0,
    ARTILLERY_SUPPORT: 0,
    AIR_STRATEGIC: 0,
    NAVAL: 0,
    ECONOMY_DEFENSE: 0,
  };
}

export function getTechLevel(
  player: { readonly techLevels?: Readonly<TechStateByBranch> } | undefined,
  branch: TechBranch,
): TechLevel {
  return player?.techLevels?.[branch] ?? 0;
}

export function getTechNodeSpec(
  branch: TechBranch,
  level: 1 | 2 | 3 | 4 | 5,
): TechNodeSpec {
  return TECH_TREE_SPECS[branch][level - 1];
}

export interface ResearchCheckResult {
  readonly valid: boolean;
  readonly nextLevel: 1 | 2 | 3 | 4 | 5;
  readonly reasonCs: string | null;
  readonly spec: TechNodeSpec;
}

export function canResearchTech(
  player: PlayerState | undefined,
  branch: TechBranch,
  requestedLevel?: number,
): ResearchCheckResult {
  const currLevel = getTechLevel(player, branch);
  const nextRaw = Math.min(5, currLevel + 1) as 1 | 2 | 3 | 4 | 5;
  const spec = getTechNodeSpec(branch, nextRaw);

  if (!player || !player.alive || player.isEliminated) {
    return { valid: false, nextLevel: nextRaw, reasonCs: 'Stát není aktivní.', spec };
  }
  if (currLevel >= 5) {
    return { valid: false, nextLevel: 5, reasonCs: 'Větev je již plně vyzkoumána.', spec };
  }
  if (requestedLevel !== undefined && requestedLevel !== currLevel + 1) {
    const reqSafe = Math.max(1, Math.min(5, Math.floor(requestedLevel))) as 1 | 2 | 3 | 4 | 5;
    return {
      valid: false,
      nextLevel: nextRaw,
      reasonCs:
        requestedLevel <= currLevel
          ? 'Technologie je již odemčena.'
          : `Nejdřív vyzkoumejte úroveň L${currLevel + 1}.`,
      spec: getTechNodeSpec(branch, reqSafe),
    };
  }
  if (
    player.knowledge < spec.cost.knowledge ||
    player.money < spec.cost.money ||
    player.industry < spec.cost.industry
  ) {
    return {
      valid: false,
      nextLevel: nextRaw,
      reasonCs: 'Nedostatek surovin (Znalosti / Peníze / Průmysl).',
      spec,
    };
  }
  return { valid: true, nextLevel: nextRaw, reasonCs: null, spec };
}

function getHpTechMultiplier(levels: Readonly<TechStateByBranch>, unitType: UnitType): number {
  let mul = 1;
  if (unitType === 'INFANTRY' && levels.GROUND >= 1) mul *= 1.15;
  if (unitType === 'TANK' && levels.GROUND >= 2) mul *= 1.2;
  if (unitType === 'TRANSPORT_SHIP' && levels.NAVAL >= 1) mul *= 1.25;
  if (isNavalUnitType(unitType) && levels.NAVAL >= 5) mul *= 1.25;
  return mul;
}

function getOpRadiusTechMultiplier(
  levels: Readonly<TechStateByBranch>,
  unitType: UnitType,
): number {
  let mul = 1;
  if (unitType === 'ARTILLERY' && levels.ARTILLERY_SUPPORT >= 1) mul *= 1.2;
  if (unitType === 'CRUISER' && levels.NAVAL >= 2) mul *= 1.25;
  return mul;
}

export function researchTech(
  state: GameState,
  playerId: number,
  branch: TechBranch,
  requestedLevel?: number,
): boolean {
  if (state.phase !== 'PLAYING') {
    return false;
  }
  const player = state.players.get(playerId);
  const check = canResearchTech(player, branch, requestedLevel);
  if (!player || !check.valid) {
    if (playerId === state.humanPlayerId && check.reasonCs) {
      state.lastNotice = {
        id: state.nextNoticeId++,
        messageCs: check.reasonCs,
        tick: state.tick,
      };
      state.stateVersion++;
    }
    return false;
  }

  const prevLevels: TechStateByBranch = { ...player.techLevels };
  player.knowledge -= check.spec.cost.knowledge;
  player.money -= check.spec.cost.money;
  player.industry -= check.spec.cost.industry;
  player.techLevels[branch] = check.nextLevel;

  // Upgrade existing owned units proportionally so active armies reflect newly unlocked doctrine
  for (const unit of state.units) {
    if (unit.ownerId !== playerId || unit.count <= 0 || unit.hp <= 0) continue;
    const prevHpMul = getHpTechMultiplier(prevLevels, unit.type);
    const nextHpMul = getHpTechMultiplier(player.techLevels, unit.type);
    if (nextHpMul !== prevHpMul) {
      const ratio = nextHpMul / prevHpMul;
      unit.maxHp = Math.round(unit.maxHp * ratio);
      unit.hp = Math.round(unit.hp * ratio);
    }
    const prevOpMul = getOpRadiusTechMultiplier(prevLevels, unit.type);
    const nextOpMul = getOpRadiusTechMultiplier(player.techLevels, unit.type);
    if (nextOpMul !== prevOpMul) {
      unit.operationRadius = Math.round(unit.operationRadius * (nextOpMul / prevOpMul));
    }
  }

  if (playerId === state.humanPlayerId) {
    state.lastNotice = {
      id: state.nextNoticeId++,
      messageCs: `Vyzkoumáno: ${check.spec.nameCs} (L${check.nextLevel})`,
      tick: state.tick,
    };
  }
  state.stateVersion++;
  return true;
}

export function isArrowProfileUnlocked(
  player: { readonly techLevels?: Readonly<TechStateByBranch> } | undefined,
  profile: ArrowProfile,
): boolean {
  if (profile === 'SPEARHEAD') {
    return getTechLevel(player, 'GROUND') >= 3;
  }
  return true;
}

export function isBuildingTechUnlocked(
  player: { readonly techLevels?: Readonly<TechStateByBranch> } | undefined,
  buildingType: BuildingType,
): boolean {
  if (buildingType === 'MISSILE_SILO') {
    return getTechLevel(player, 'ARTILLERY_SUPPORT') >= 5;
  }
  return true;
}

export function getEffectiveUnitMaxHpPerUnit(
  player: { readonly techLevels?: Readonly<TechStateByBranch> } | undefined,
  unitType: UnitType,
  baseHp: number,
): number {
  const levels = player?.techLevels ?? createInitialTechState();
  return Math.round(baseHp * getHpTechMultiplier(levels, unitType));
}

export function getEffectiveUnitAttack(
  player: { readonly techLevels?: Readonly<TechStateByBranch> } | undefined,
  unitType: UnitType,
  baseAttack: number,
): number {
  let mul = 1;
  if (unitType === 'INFANTRY' && getTechLevel(player, 'GROUND') >= 1) mul *= 1.15;
  if (unitType === 'TANK' && getTechLevel(player, 'GROUND') >= 2) mul *= 1.2;
  if (unitType === 'CRUISER' && getTechLevel(player, 'NAVAL') >= 2) mul *= 1.25;
  if (unitType === 'SUBMARINE' && getTechLevel(player, 'NAVAL') >= 4) mul *= 1.35;
  if (isNavalUnitType(unitType) && getTechLevel(player, 'NAVAL') >= 5) mul *= 1.25;
  if (unitType === 'FIGHTER' && getTechLevel(player, 'AIR_STRATEGIC') >= 4) mul *= 1.35;
  return baseAttack * mul;
}

export function getEffectiveUnitSpeed(
  player: { readonly techLevels?: Readonly<TechStateByBranch> } | undefined,
  unitType: UnitType,
  baseSpeed: number,
): number {
  let mul = 1;
  if (unitType === 'TANK' && getTechLevel(player, 'GROUND') >= 4) mul *= 1.15;
  if (unitType === 'TRANSPORT_SHIP' && getTechLevel(player, 'NAVAL') >= 1) mul *= 1.25;
  return baseSpeed * mul;
}

export function getEffectiveUnitAttackRange(
  player: { readonly techLevels?: Readonly<TechStateByBranch> } | undefined,
  unitType: UnitType,
  baseRange: number,
): number {
  if (baseRange <= 0) return 0;
  let mul = 1;
  if (unitType === 'ARTILLERY' && getTechLevel(player, 'ARTILLERY_SUPPORT') >= 1) mul *= 1.2;
  if (unitType === 'CRUISER' && getTechLevel(player, 'NAVAL') >= 2) mul *= 1.25;
  return baseRange * mul;
}

export function getEffectiveUnitOperationRadius(
  player: { readonly techLevels?: Readonly<TechStateByBranch> } | undefined,
  unitType: UnitType,
  baseRadius: number,
): number {
  const levels = player?.techLevels ?? createInitialTechState();
  return Math.round(baseRadius * getOpRadiusTechMultiplier(levels, unitType));
}

export function getEffectiveAirfieldRange(
  player: { readonly techLevels?: Readonly<TechStateByBranch> } | undefined,
): number {
  const bonus = getTechLevel(player, 'AIR_STRATEGIC') >= 2 ? 1.25 : 1.0;
  return Math.round(AIRFIELD_OPERATION_RANGE * bonus);
}

export function getEffectiveRadarVisionRadius(
  player: { readonly techLevels?: Readonly<TechStateByBranch> } | undefined,
): number {
  const bonus = getTechLevel(player, 'ECONOMY_DEFENSE') >= 5 ? 1.3 : 1.0;
  return Math.round(RADAR_STATION_VISION_RADIUS * bonus);
}

export function getEffectiveFireMissionIndustryCost(
  player: { readonly techLevels?: Readonly<TechStateByBranch> } | undefined,
  unitType: UnitType,
  baseCost: number,
): number {
  if (baseCost <= 0) return 0;
  let mul = 1;
  if (unitType === 'ARTILLERY' && getTechLevel(player, 'ARTILLERY_SUPPORT') >= 4) mul *= 0.75;
  if (unitType === 'CRUISER' && getTechLevel(player, 'NAVAL') >= 5) mul *= 0.75;
  return Math.max(1, Math.round(baseCost * mul));
}

export function getPlayerBaseIntelTier(
  player: { readonly techLevels?: Readonly<TechStateByBranch> } | undefined,
): IntelTier {
  const nav = getTechLevel(player, 'NAVAL');
  const eco = getTechLevel(player, 'ECONOMY_DEFENSE');
  const air = getTechLevel(player, 'AIR_STRATEGIC');
  if (nav >= 3 || eco >= 5) {
    return 4;
  }
  if (air >= 4 || eco >= 3) {
    return 3;
  }
  if (air >= 1) {
    return 2;
  }
  return 1;
}

function getRel(state: GameState, a: number, b: number): DiplomaticRelation {
  if (a === b || a < 0 || b < 0) return 'NEUTRAL';
  return state.relations.get(getRelationKey(a, b)) ?? 'NEUTRAL';
}

export function executeStrategicStrike(
  state: GameState,
  playerId: number,
  strikeKind: StrategicStrikeKind,
  targetX: number,
  targetY: number,
): boolean {
  if (state.phase !== 'PLAYING') {
    return false;
  }
  const player = state.players.get(playerId);
  if (!player || !player.alive || player.isEliminated) {
    return false;
  }

  const pushNotice = (msg: string): void => {
    if (playerId === state.humanPlayerId) {
      state.lastNotice = {
        id: state.nextNoticeId++,
        messageCs: msg,
        tick: state.tick,
      };
      state.stateVersion++;
    }
  };

  if (strikeKind === 'MISSILE' && getTechLevel(player, 'ARTILLERY_SUPPORT') < 5) {
    pushNotice('Vyžaduje výzkum Dálkového raketového sila (L5).');
    return false;
  }
  if (strikeKind === 'NUCLEAR' && getTechLevel(player, 'AIR_STRATEGIC') < 5) {
    pushNotice('Vyžaduje výzkum Jaderné doktríny (Letectvo L5).');
    return false;
  }

  const cost = strikeKind === 'NUCLEAR' ? NUCLEAR_STRIKE_COST : MISSILE_STRIKE_COST;
  if (player.industry < cost.industry || player.money < cost.money) {
    pushNotice(
      `Nedostatek surovin pro ${strikeKind === 'NUCLEAR' ? 'jaderný' : 'raketový'} úder (${cost.industry} P · ${cost.money} $).`,
    );
    return false;
  }

  const tx = Math.max(0.5, Math.min(state.width - 0.5, targetX));
  const ty = Math.max(0.5, Math.min(state.height - 0.5, targetY));
  const ix = Math.floor(tx);
  const iy = Math.floor(ty);
  const targetOwner = state.owners[iy * state.width + ix];
  if (
    targetOwner >= 0 &&
    targetOwner !== playerId &&
    getRel(state, playerId, targetOwner) !== 'WAR'
  ) {
    pushNotice('Nelze zaútočit na neutrální nebo spojenecký stát (nejdřív vyhlaste válku).');
    return false;
  }

  let launcher: Building | null = null;
  let bestDist = Infinity;
  const airfieldRange = getEffectiveAirfieldRange(player);

  for (const b of state.buildings) {
    if (b.ownerId !== playerId || b.stackCount <= 0 || b.paradropCooldownTicks > 0) continue;
    const d = Math.hypot(b.x + 0.5 - tx, b.y + 0.5 - ty);
    if (strikeKind === 'MISSILE') {
      if (b.type === 'MISSILE_SILO' && d <= MISSILE_STRIKE_RANGE && d < bestDist) {
        bestDist = d;
        launcher = b;
      }
    } else {
      const maxRange =
        b.type === 'MISSILE_SILO'
          ? NUCLEAR_SILO_RANGE
          : b.type === 'AIRFIELD'
            ? airfieldRange
            : 0;
      if (maxRange > 0 && d <= maxRange && d < bestDist) {
        bestDist = d;
        launcher = b;
      }
    }
  }

  if (!launcher) {
    pushNotice(
      strikeKind === 'MISSILE'
        ? 'Žádné připravené raketové silo (MISSILE_SILO) v dostřelu cíle.'
        : 'Žádné připravené silo nebo letiště v dosahu jaderného úderu.',
    );
    return false;
  }

  player.industry -= cost.industry;
  player.money -= cost.money;
  launcher.paradropCooldownTicks =
    strikeKind === 'NUCLEAR' ? NUCLEAR_STRIKE_COOLDOWN_TICKS : MISSILE_STRIKE_COOLDOWN_TICKS;

  const blastRadius = strikeKind === 'NUCLEAR' ? 18 : 10.5;
  const deadBuildingIds = new Set<number>();

  for (const b of state.buildings) {
    if (b.ownerId === playerId) continue;
    if (b.stackCount <= 0 && b.underConstructionCount <= 0) continue;
    if (getRel(state, playerId, b.ownerId) !== 'WAR') continue;
    const dist = Math.hypot(b.x + 0.5 - tx, b.y + 0.5 - ty);
    if (dist > blastRadius) continue;

    if (b.isCapital) {
      b.stackCount = 1;
      b.underConstructionCount = 0;
      continue;
    }

    if (strikeKind === 'NUCLEAR') {
      deadBuildingIds.add(b.id);
    } else {
      const lostStacks = Math.min(b.stackCount, dist <= 5 ? 3 : 2);
      b.stackCount = Math.max(0, b.stackCount - lostStacks);
      if (b.stackCount === 0 && b.underConstructionCount > 0) {
        b.underConstructionCount = Math.max(0, b.underConstructionCount - 1);
      }
      if (b.stackCount <= 0 && b.underConstructionCount <= 0) {
        deadBuildingIds.add(b.id);
      }
    }
  }

  if (deadBuildingIds.size > 0) {
    state.buildings = state.buildings.filter((b) => !deadBuildingIds.has(b.id));
  }

  for (const u of state.units) {
    if (u.count <= 0 || u.hp <= 0 || u.ownerId === playerId) continue;
    if (getRel(state, playerId, u.ownerId) !== 'WAR') continue;
    const dist = Math.hypot(u.x - tx, u.y - ty);
    if (dist > blastRadius) continue;

    const falloff = Math.max(0.3, 1 - 0.65 * (dist / blastRadius));
    const dmg =
      strikeKind === 'NUCLEAR'
        ? Math.max(u.maxHp * 0.72, 160) * falloff
        : Math.max(u.maxHp * 0.35, 55) * falloff;
    const prevCount = Math.max(1, u.count);
    const hpPerSingle = u.maxHp / prevCount;
    u.hp = Math.max(0, u.hp - dmg);
    u.morale = Math.max(0, u.morale - (strikeKind === 'NUCLEAR' ? 45 : 22) * falloff);
    if (u.hp <= 0) {
      u.count = 0;
    } else {
      const nextCount = Math.max(1, Math.min(prevCount, Math.ceil(u.hp / Math.max(1, hpPerSingle))));
      u.count = nextCount;
      u.maxHp = Math.round(nextCount * hpPerSingle);
      u.hp = Math.min(u.hp, u.maxHp);
    }
  }
  state.units = state.units.filter((u) => u.count > 0 && u.hp > 0);

  const impactedByOwner = new Map<number, number>();
  const rCeil = Math.ceil(blastRadius);
  const rSq = blastRadius * blastRadius;
  const minX = Math.max(0, ix - rCeil);
  const maxX = Math.min(state.width - 1, ix + rCeil);
  const minY = Math.max(0, iy - rCeil);
  const maxY = Math.min(state.height - 1, iy + rCeil);
  for (let y = minY; y <= maxY; y++) {
    const dy = y + 0.5 - ty;
    const row = y * state.width;
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - tx;
      if (dx * dx + dy * dy > rSq) continue;
      if (state.terrain[row + x] === TerrainType.WATER) continue;
      const cellOwner = state.owners[row + x];
      if (
        cellOwner >= 0 &&
        cellOwner !== playerId &&
        cellOwner !== WILDERNESS_OWNER &&
        getRel(state, playerId, cellOwner) === 'WAR'
      ) {
        impactedByOwner.set(cellOwner, (impactedByOwner.get(cellOwner) ?? 0) + 1);
      }
    }
  }

  let totalManpowerKilled = 0;
  const refArea = Math.max(1, Math.PI * rSq * 0.45);
  for (const [enemyId, cells] of impactedByOwner) {
    const enemy = state.players.get(enemyId);
    if (!enemy || !enemy.alive || enemy.isEliminated) continue;
    const coverage = Math.min(1, cells / refArea);
    enemy.manpowerSuppressionTicks = Math.min(
      300,
      enemy.manpowerSuppressionTicks + (strikeKind === 'NUCLEAR' ? 240 : 140),
    );
    enemy.manpowerSuppressionIntensity = Math.min(
      0.65,
      Math.max(
        enemy.manpowerSuppressionIntensity,
        strikeKind === 'NUCLEAR' ? 0.65 : 0.45,
      ),
    );

    const activeMp = Math.max(0, enemy.manpower - enemy.allocatedManpower);
    if (activeMp <= 0) continue;
    const pctLoss = strikeKind === 'NUCLEAR' ? 0.48 * coverage : 0.18 * coverage;
    const floorLoss = (strikeKind === 'NUCLEAR' ? 260 : 85) * coverage;
    const mpLoss = Math.min(activeMp, Math.max(floorLoss, activeMp * pctLoss));
    enemy.manpower = Math.max(enemy.allocatedManpower, enemy.manpower - mpLoss);
    enemy.activeManpower = Math.max(0, enemy.manpower - enemy.allocatedManpower);
    totalManpowerKilled += Math.round(mpLoss);
  }

  state.artilleryExplosions.push({
    id: state.nextFxId++,
    x: tx,
    y: ty,
    radius: blastRadius,
    ttlTicks: strikeKind === 'NUCLEAR' ? 24 : 15,
    maxTtlTicks: strikeKind === 'NUCLEAR' ? 24 : 15,
    manpowerKilled: totalManpowerKilled,
  });

  if (playerId === state.humanPlayerId) {
    state.lastNotice = {
      id: state.nextNoticeId++,
      messageCs:
        strikeKind === 'NUCLEAR'
          ? `Jaderný úder zasáhl sektor [${ix}, ${iy}] (ztráty MP nepřítele: −${totalManpowerKilled}).`
          : `Raketový úder zasáhl cíl [${ix}, ${iy}] (ztráty MP: −${totalManpowerKilled}).`,
      tick: state.tick,
    };
  }
  state.stateVersion++;
  return true;
}
