export const MAP_WIDTH = 720;
export const MAP_HEIGHT = 500;
export const TICK_RATE = 10;
export const TICK_DT = 1 / TICK_RATE;
export const WILDERNESS_OWNER = -1;
export const BETRAYAL_DEBUFF_TICKS = 600;
export const BETRAYAL_MONEY_PENALTY_RATIO = 0.25;
export const MIN_BUILDING_SPACING = 9;
export const BARRACKS_DEFENSE_RADIUS = 18;
export const MAX_STACK_PER_NODE = 50;
export const DEMOLISH_REFUND_RATIO = 0.5;
export const BUILDING_COST_SCALING_PER_UNIT = 0.14;
export const FINISH_OFF_MAX_LAND_RATIO = 0.025;
export const FINISH_OFF_MAX_CELLS = 140;
export const MAX_UNIT_STACK = 50;

export type BuildBatchSize = 1 | 5 | 10 | 'MAX';
export type GroundUnitType = 'INFANTRY' | 'TANK' | 'ARTILLERY' | 'PARATROOPERS';
export type NavalUnitType = 'TRANSPORT_SHIP' | 'CRUISER' | 'SUBMARINE' | 'RADAR_SHIP';
export type AirUnitType = 'FIGHTER' | 'BOMBER' | 'RECON_PLANE';
export type UnitType = GroundUnitType | NavalUnitType | AirUnitType;
export type UnitDomain = 'LAND' | 'NAVAL' | 'AIR';
export type UnitStance = 'LOCK' | 'RANGE';
export type EliminationReason = 'TERRITORY_LOST' | 'MANPOWER_DEPLETED';

export const ALL_UNIT_TYPES: ReadonlyArray<UnitType> = [
  'INFANTRY',
  'TANK',
  'ARTILLERY',
  'PARATROOPERS',
  'TRANSPORT_SHIP',
  'CRUISER',
  'SUBMARINE',
  'RADAR_SHIP',
  'FIGHTER',
  'BOMBER',
  'RECON_PLANE',
];

export enum TerrainType {
  WATER = 0,
  PLAINS = 1,
  MOUNTAINS = 2,
}

export type TechBranch =
  | 'GROUND'
  | 'ARTILLERY_SUPPORT'
  | 'AIR_STRATEGIC'
  | 'NAVAL'
  | 'ECONOMY_DEFENSE';

export const ALL_TECH_BRANCHES: ReadonlyArray<TechBranch> = [
  'GROUND',
  'ARTILLERY_SUPPORT',
  'AIR_STRATEGIC',
  'NAVAL',
  'ECONOMY_DEFENSE',
];

export type TechLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type TechStateByBranch = Record<TechBranch, TechLevel>;
export type IntelTier = 1 | 2 | 3 | 4;
export type ArrowProfile = 'STANDARD' | 'SPEARHEAD' | 'BROAD_FRONT';
export type StrategicStrikeKind = 'MISSILE' | 'NUCLEAR';

export type RareLootRewardType = 'MONEY' | 'MATERIAL' | 'INDUSTRY' | 'KNOWLEDGE';

export interface RareLootZonePublic {
  readonly id: number;
  readonly rewardType: RareLootRewardType;
  readonly displayCenterX: number;
  readonly displayCenterY: number;
  readonly displayRadius: number;
  readonly amount: number;
  readonly claimedByPlayerId: number | null;
}

export interface RareLootZoneSecret {
  readonly id: number;
  readonly rewardType: RareLootRewardType;
  readonly exactX: number;
  readonly exactY: number;
  readonly baseCenterX: number;
  readonly baseCenterY: number;
  readonly baseRadius: number;
  readonly l1CenterX: number;
  readonly l1CenterY: number;
  readonly l1Radius: number;
  readonly l5CenterX: number;
  readonly l5CenterY: number;
  readonly l5Radius: number;
  readonly amount: number;
  claimedByPlayerId: number | null;
}

export type ResourceType = 'CONSTRUCTION_MATERIAL' | 'BASIC_ENERGY' | 'INDUSTRIAL';

export type DefenseBuildingType = 'TRENCH' | 'BUNKER' | 'AA_BATTERY';

export type BuildingType =
  | 'CITY'
  | 'MINE'
  | 'POWER_PLANT'
  | 'FACTORY'
  | 'ARMORY'
  | 'LAB'
  | 'BARRACKS'
  | 'PORT'
  | 'AIRFIELD'
  | 'RADAR_STATION'
  | 'MISSILE_SILO'
  | DefenseBuildingType;

export const DEFENSE_BUILDING_TYPES: ReadonlyArray<DefenseBuildingType> = [
  'TRENCH',
  'BUNKER',
  'AA_BATTERY',
];

export const ALL_BUILDING_TYPES: ReadonlyArray<BuildingType> = [
  'CITY',
  'MINE',
  'POWER_PLANT',
  'FACTORY',
  'ARMORY',
  'LAB',
  'BARRACKS',
  'PORT',
  'AIRFIELD',
  'RADAR_STATION',
  'MISSILE_SILO',
  'TRENCH',
  'BUNKER',
  'AA_BATTERY',
];

export const MANPOWER_BUILDING_TYPES: ReadonlyArray<BuildingType> = [
  'MINE',
  'POWER_PLANT',
  'FACTORY',
  'ARMORY',
  'LAB',
  'BARRACKS',
  'PORT',
  'AIRFIELD',
  'RADAR_STATION',
  'MISSILE_SILO',
  'TRENCH',
  'BUNKER',
  'AA_BATTERY',
];

export interface BuildingCost {
  readonly money: number;
  readonly buildingMaterial: number;
  readonly industry: number;
}

export interface BuildingSpec {
  readonly type: BuildingType;
  readonly nameCs: string;
  readonly shortCode: string;
  readonly descriptionCs: string;
  readonly cost: BuildingCost;
  readonly baseEnergyConsumption: number;
  readonly baseEnergyProduction: number;
  readonly baseManpowerRequired: number;
  readonly baseMoneyPerSec: number;
  readonly baseMaterialPerSec: number;
  readonly baseIndustryPerSec: number;
  readonly baseKnowledgePerSec: number;
  readonly baseMaxManpowerBonus: number;
  readonly baseManpowerIncomeBonus: number;
  readonly energyReserveBonus: number;
  readonly constructionTicks: number;
  readonly requiresCoast: boolean;
  readonly resourceZoneType: ResourceType | null;
}

export interface UnitCost {
  readonly money: number;
  readonly buildingMaterial: number;
  readonly industry: number;
  readonly manpower: number;
}

export interface UnitSpec {
  readonly type: UnitType;
  readonly domain: UnitDomain;
  readonly nameCs: string;
  readonly shortCode: string;
  readonly descriptionCs: string;
  readonly producerBuilding: 'BARRACKS' | 'ARMORY' | 'AIRFIELD' | 'PORT';
  readonly cost: UnitCost;
  readonly productionTicks: number;
  readonly speedPlains: number;
  readonly speedMountains: number;
  readonly hpPerUnit: number;
  readonly attack: number;
  readonly defense: number;
  readonly attackRange: number;
  readonly operationRadius: number;
  readonly visionRadius: number;
  readonly isStealth?: boolean;
  readonly detectsStealth?: boolean;
  readonly airRange?: number;
}

export interface ArtilleryExplosionFx {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  ttlTicks: number;
  readonly maxTtlTicks: number;
  readonly manpowerKilled: number;
}

export interface UiNotice {
  readonly id: number;
  readonly messageCs: string;
  readonly tick: number;
}

export interface UnitProductionJob {
  readonly unitType: UnitType;
  ticksRemaining: number;
  readonly ticksTotal: number;
}

export interface PublicUnitProductionJob {
  readonly unitType: UnitType;
  readonly ticksRemaining: number;
  readonly ticksTotal: number;
}

export interface Unit {
  readonly id: number;
  readonly ownerId: number;
  type: UnitType;
  x: number;
  y: number;
  count: number;
  hp: number;
  maxHp: number;
  morale: number;
  stance: UnitStance;
  operationRadius: number;
  targetX: number | null;
  targetY: number | null;
  waypoints: Point[];
  fireMissionX: number | null;
  fireMissionY: number | null;
  fireMissionTicksRemaining: number;
  attachedOrderId: number | null;
  attachedOrderKind: 'ATTACK' | 'FRONT_PUSH' | null;
  manualOrder: boolean;
  mergeTargetUnitId: number | null;
  isEncircled: boolean;
  supplyLevel: number;
  canParadrop: boolean;
  inAirTransit: boolean;
  dropVulnerabilityTicks: number;
  combatCooldownTicks: number;
  lastCombatTargetX: number | null;
  lastCombatTargetY: number | null;
  breakoutAccum: number;
  cargoUnitType: GroundUnitType | null;
  homeAirfieldId: number | null;
}

export interface PublicUnitInfo {
  readonly id: number;
  readonly ownerId: number;
  readonly type: UnitType;
  readonly domain: UnitDomain;
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly morale: number;
  readonly stance: UnitStance;
  readonly operationRadius: number;
  readonly targetX: number | null;
  readonly targetY: number | null;
  readonly waypoints: ReadonlyArray<Point>;
  readonly fireMissionX: number | null;
  readonly fireMissionY: number | null;
  readonly fireMissionTicksRemaining: number;
  readonly attachedOrderId: number | null;
  readonly isEncircled: boolean;
  readonly supplyLevel: number;
  readonly canParadrop: boolean;
  readonly inAirTransit: boolean;
  readonly dropVulnerabilityTicks: number;
  readonly combatCooldownTicks: number;
  readonly lastCombatTargetX: number | null;
  readonly lastCombatTargetY: number | null;
  readonly cargoUnitType: GroundUnitType | null;
}

export interface Building {
  readonly id: number;
  readonly type: BuildingType;
  ownerId: number;
  readonly x: number;
  readonly y: number;
  readonly isCapital: boolean;
  level: number;
  revealedEfficiencyPct: number | null;
  stackCount: number;
  underConstructionCount: number;
  constructionTicksRemaining: number;
  readonly constructionTicksTotal: number;
  totalInvestedMoney: number;
  totalInvestedMaterial: number;
  totalInvestedIndustry: number;
  occupancyOverride: number | null;
  effectiveOccupancyPct: number;
  effectiveOutputPct: number;
  allocatedManpower: number;
  currentEnergyUse: number;
  currentEnergyProd: number;
  unitQueue: UnitProductionJob[];
  paradropCooldownTicks: number;
}

export interface PublicBuildingInfo {
  readonly id: number;
  readonly type: BuildingType;
  readonly ownerId: number;
  readonly x: number;
  readonly y: number;
  readonly isCapital: boolean;
  readonly level: number;
  readonly revealedEfficiencyPct: number | null;
  readonly stackCount: number;
  readonly underConstructionCount: number;
  readonly constructionTicksRemaining: number;
  readonly constructionTicksTotal: number;
  readonly totalInvestedMoney: number;
  readonly totalInvestedMaterial: number;
  readonly totalInvestedIndustry: number;
  readonly occupancyOverride: number | null;
  readonly effectiveOccupancyPct: number;
  readonly effectiveOutputPct: number;
  readonly allocatedManpower: number;
  readonly currentEnergyUse: number;
  readonly currentEnergyProd: number;
  readonly unitQueue: ReadonlyArray<PublicUnitProductionJob>;
  readonly paradropCooldownTicks: number;
}

export type OccupancyByType = Record<BuildingType, number>;

export type DiplomaticRelation = 'NEUTRAL' | 'WAR' | 'ALLIED';

export function getRelationKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export interface ResourceZonePublic {
  readonly id: number;
  readonly type: ResourceType;
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
}

export interface ResourceZoneSecret {
  readonly zoneId: number;
  readonly optimumX: number;
  readonly optimumY: number;
  readonly baseYield: number;
}

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export type Point = Point2D;

export interface PlayerState {
  id: number;
  name: string;
  isBot: boolean;
  colorHex: string;
  colorRgb: readonly [number, number, number];
  capitalX: number;
  capitalY: number;
  manpower: number;
  maxManpower: number;
  manpowerIncomePerSec: number;
  manpowerGrowthEfficiency: number;
  allocatedManpower: number;
  activeManpower: number;
  money: number;
  moneyIncomePerSec: number;
  tradeIncomePerSec: number;
  knowledge: number;
  knowledgeIncomePerSec: number;
  buildingMaterial: number;
  buildingMaterialIncomePerSec: number;
  industry: number;
  industryIncomePerSec: number;
  energyReserve: number;
  energyReserveMax: number;
  energyProductionPerSec: number;
  energyConsumptionPerSec: number;
  energyNetPerSec: number;
  energySupplyRatio: number;
  blackoutActive: boolean;
  blackoutSeverity: number;
  freePowerPlantUsed: boolean;
  buildingOccupancyByType: OccupancyByType;
  betrayalDebuffTicks: number;
  manpowerSuppressionTicks: number;
  manpowerSuppressionIntensity: number;
  techLevels: TechStateByBranch;
  nextBotDecisionTick: number;
  territoryCells: number;
  alive: boolean;
  isEliminated: boolean;
  eliminationReason: EliminationReason | null;
}

export interface PublicPlayerInfo {
  readonly id: number;
  readonly name: string;
  readonly isBot: boolean;
  readonly colorHex: string;
  readonly colorRgb: readonly [number, number, number];
  readonly capitalX: number;
  readonly capitalY: number;
  readonly territoryCells: number;
  readonly alive: boolean;
  readonly isEliminated: boolean;
  readonly eliminationReason: EliminationReason | null;
  readonly betrayalDebuffTicks: number;
  readonly relationToHuman: DiplomaticRelation;
  readonly isNeighborOfHuman: boolean;
  readonly hasTradeWithHuman: boolean;
  readonly tradeIncomeWithHumanPerSec: number;
  readonly finishOffEligible: boolean;
  readonly finishOffRequiredManpower: number | null;
  /** Only populated for the local human player; omitted for AI bots / opponents. */
  readonly manpower?: number;
  readonly maxManpower?: number;
  readonly manpowerIncomePerSec?: number;
  readonly manpowerGrowthEfficiency?: number;
  readonly allocatedManpower?: number;
  readonly activeManpower?: number;
  readonly money?: number;
  readonly moneyIncomePerSec?: number;
  readonly tradeIncomePerSec?: number;
  readonly knowledge?: number;
  readonly knowledgeIncomePerSec?: number;
  readonly buildingMaterial?: number;
  readonly buildingMaterialIncomePerSec?: number;
  readonly industry?: number;
  readonly industryIncomePerSec?: number;
  readonly energyReserve?: number;
  readonly energyReserveMax?: number;
  readonly energyProductionPerSec?: number;
  readonly energyConsumptionPerSec?: number;
  readonly energyNetPerSec?: number;
  readonly energySupplyRatio?: number;
  readonly blackoutActive?: boolean;
  readonly blackoutSeverity?: number;
  readonly freePowerPlantUsed?: boolean;
  readonly buildingOccupancyByType?: Readonly<OccupancyByType>;
  readonly manpowerSuppressionTicks?: number;
  readonly manpowerSuppressionIntensity?: number;
  readonly techLevels?: Readonly<TechStateByBranch>;
  readonly intelTier?: IntelTier;
}

export interface AttackOrder {
  id: number;
  playerId: number;
  readonly origin: Point;
  waypoints: Point[];
  frontierArc: number;
  targetOwnerId: number;
  targetOwnerIds: number[];
  readonly wildernessOnly: boolean;
  readonly profile?: ArrowProfile;
  currentSegmentIndex: number;
  segmentProgress: number;
  totalPathLength: number;
  manpowerCommitted: number;
  manpowerRemaining: number;
  ticksRemaining: number;
  maxTicks: number;
  stagnantTicks: number;
  mountainAccum: number;
}

export interface FrontPushOrder {
  id: number;
  playerId: number;
  frontierCells: number[];
  readonly targetOwnerId: number;
  readonly originCenter: Point;
  readonly focalPoint?: Point;
  readonly sweepAllBorders?: boolean;
  readonly finishOff?: boolean;
  dirX: number;
  dirY: number;
  manpowerCommitted: number;
  manpowerRemaining: number;
  ticksRemaining: number;
  maxTicks: number;
  stagnantTicks: number;
  mountainAccum: number;
}

export type GamePhase = 'SELECT_START' | 'PLAYING';

export interface GameState {
  tick: number;
  phase: GamePhase;
  paused: boolean;
  readonly width: number;
  readonly height: number;
  readonly totalLandCells: number;
  readonly terrain: Uint8Array;
  readonly owners: Int16Array;
  readonly players: Map<number, PlayerState>;
  readonly humanPlayerId: number;
  readonly relations: Map<string, DiplomaticRelation>;
  readonly tradeAgreements: Set<string>;
  readonly neighborPairs: Set<string>;
  buildings: Building[];
  nextBuildingId: number;
  units: Unit[];
  nextUnitId: number;
  artilleryExplosions: ArtilleryExplosionFx[];
  nextFxId: number;
  lastNotice: UiNotice | null;
  nextNoticeId: number;
  lastTerritorySyncVersion: number;
  attackOrders: AttackOrder[];
  frontPushOrders: FrontPushOrder[];
  readonly publicResourceZones: ResourceZonePublic[];
  readonly secretResourceZones: ResourceZoneSecret[];
  readonly secretLootZones: RareLootZoneSecret[];
  nextOrderId: number;
  rngState: number;
  stateVersion: number;
}

export interface ClientRenderState {
  readonly tick: number;
  readonly phase: GamePhase;
  readonly paused: boolean;
  readonly width: number;
  readonly height: number;
  readonly totalLandCells: number;
  readonly terrain: Uint8Array;
  readonly owners: Int16Array;
  readonly players: ReadonlyArray<PublicPlayerInfo>;
  readonly humanPlayerId: number;
  readonly relations: Readonly<Record<string, DiplomaticRelation>>;
  readonly tradeAgreements: ReadonlyArray<string>;
  readonly buildings: ReadonlyArray<PublicBuildingInfo>;
  readonly units: ReadonlyArray<PublicUnitInfo>;
  readonly artilleryExplosions: ReadonlyArray<Readonly<ArtilleryExplosionFx>>;
  readonly lastNotice: UiNotice | null;
  readonly attackOrders: ReadonlyArray<Readonly<AttackOrder>>;
  readonly frontPushOrders: ReadonlyArray<Readonly<FrontPushOrder>>;
  readonly publicResourceZones: ReadonlyArray<ResourceZonePublic>;
  readonly rareLootZones: ReadonlyArray<RareLootZonePublic>;
  readonly visibilityGrid: Uint8Array;
  readonly visibilityGridWidth: number;
  readonly visibilityGridHeight: number;
  readonly stateVersion: number;
}

export type Action =
  | { readonly type: 'SELECT_START_POSITION'; readonly x: number; readonly y: number }
  | {
      readonly type: 'CREATE_ATTACK_ORDER';
      readonly playerId: number;
      readonly waypoints: ReadonlyArray<Point>;
      readonly manpowerPercent: number;
      readonly targetOwnerId?: number;
      readonly profile?: ArrowProfile;
    }
  | {
      readonly type: 'AMBUSH_ATTACK';
      readonly playerId: number;
      readonly targetId: number;
      readonly waypoints: ReadonlyArray<Point>;
      readonly manpowerPercent: number;
      readonly profile?: ArrowProfile;
    }
  | {
      readonly type: 'BEND_ATTACK_ORDER';
      readonly playerId: number;
      readonly orderId: number;
      readonly waypointIndex: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: 'CREATE_FRONT_PUSH_ORDER';
      readonly playerId: number;
      readonly frontierCells: ReadonlyArray<number>;
      readonly dirX: number;
      readonly dirY: number;
      readonly manpowerPercent: number;
      readonly targetOwnerId?: number;
    }
  | {
      readonly type: 'BORDER_SURGE_PUSH';
      readonly playerId: number;
      readonly x: number;
      readonly y: number;
      readonly manpowerPercent: number;
      readonly targetOwnerId?: number;
    }
  | {
      readonly type: 'PLACE_BUILDING';
      readonly playerId: number;
      readonly buildingType: BuildingType;
      readonly x: number;
      readonly y: number;
      readonly batchSize?: BuildBatchSize;
    }
  | {
      readonly type: 'STACK_BUILDING';
      readonly playerId: number;
      readonly buildingId: number;
      readonly batchSize: BuildBatchSize;
    }
  | {
      readonly type: 'DEMOLISH_BUILDING';
      readonly playerId: number;
      readonly buildingId: number;
      readonly demolishAll: boolean;
    }
  | {
      readonly type: 'TARGETED_ATTACK';
      readonly playerId: number;
      readonly targetOwnerId: number;
      readonly anchorX: number;
      readonly anchorY: number;
      readonly manpowerPercent: number;
    }
  | {
      readonly type: 'FINISH_OFF_TARGET';
      readonly playerId: number;
      readonly targetOwnerId: number;
    }
  | {
      readonly type: 'SET_BUILDING_TYPE_OCCUPANCY';
      readonly playerId: number;
      readonly buildingType: BuildingType;
      readonly occupancyPct: number;
    }
  | {
      readonly type: 'SET_BUILDING_OCCUPANCY';
      readonly playerId: number;
      readonly buildingId: number;
      readonly occupancyPct: number | null;
    }
  | {
      readonly type: 'SET_ALL_OCCUPANCY';
      readonly playerId: number;
      readonly occupancyPct: number;
    }
  | { readonly type: 'DECLARE_WAR'; readonly actorId: number; readonly targetId: number }
  | { readonly type: 'MAKE_PEACE'; readonly actorId: number; readonly targetId: number }
  | { readonly type: 'TOGGLE_ALLIANCE'; readonly actorId: number; readonly targetId: number }
  | { readonly type: 'TOGGLE_TRADE'; readonly actorId: number; readonly targetId: number }
  | { readonly type: 'CANCEL_PLAYER_ORDERS'; readonly playerId: number }
  | { readonly type: 'TOGGLE_PAUSE' }
  | { readonly type: 'RESTART_GAME'; readonly seed?: number }
  | { readonly type: 'TICK' }
  | {
      readonly type: 'PRODUCE_UNIT';
      readonly playerId: number;
      readonly buildingId: number;
      readonly unitType: UnitType;
      readonly count?: number;
    }
  | {
      readonly type: 'QUICK_PRODUCE_UNIT';
      readonly playerId: number;
      readonly unitType: UnitType;
      readonly count?: number;
    }
  | {
      readonly type: 'MOVE_UNITS';
      readonly playerId: number;
      readonly unitIds: ReadonlyArray<number>;
      readonly targetX: number;
      readonly targetY: number;
    }
  | {
      readonly type: 'SET_UNITS_STANCE';
      readonly playerId: number;
      readonly unitIds: ReadonlyArray<number>;
      readonly stance: UnitStance;
    }
  | {
      readonly type: 'MERGE_UNITS';
      readonly playerId: number;
      readonly unitIds: ReadonlyArray<number>;
    }
  | {
      readonly type: 'PARADROP_UNIT';
      readonly playerId: number;
      readonly unitId: number;
      readonly targetX: number;
      readonly targetY: number;
    }
  | {
      readonly type: 'ARTILLERY_FIRE_MISSION';
      readonly playerId: number;
      readonly unitIds: ReadonlyArray<number>;
      readonly targetX: number;
      readonly targetY: number;
    }
  | {
      readonly type: 'CANCEL_FIRE_MISSION';
      readonly playerId: number;
      readonly unitIds: ReadonlyArray<number>;
    }
  | {
      readonly type: 'RESEARCH_TECH';
      readonly playerId: number;
      readonly branch: TechBranch;
      readonly level?: number;
    }
  | {
      readonly type: 'LAUNCH_STRATEGIC_STRIKE';
      readonly playerId: number;
      readonly strikeKind: StrategicStrikeKind;
      readonly targetX: number;
      readonly targetY: number;
    };
