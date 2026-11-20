export const MAP_WIDTH = 720;
export const MAP_HEIGHT = 500;
export const TICK_RATE = 10;
export const TICK_DT = 1 / TICK_RATE;
export const WILDERNESS_OWNER = -1;
export const BETRAYAL_DEBUFF_TICKS = 600;

export enum TerrainType {
  WATER = 0,
  PLAINS = 1,
  MOUNTAINS = 2,
}

export type ResourceType = 'CONSTRUCTION_MATERIAL' | 'BASIC_ENERGY';

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
  betrayalDebuffTicks: number;
  nextBotDecisionTick: number;
  territoryCells: number;
  alive: boolean;
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
  readonly betrayalDebuffTicks: number;
  readonly relationToHuman: DiplomaticRelation;
  /** Only populated for the local human player; omitted for AI bots / opponents. */
  readonly manpower?: number;
  readonly maxManpower?: number;
  readonly manpowerIncomePerSec?: number;
  readonly manpowerGrowthEfficiency?: number;
}

export interface AttackOrder {
  id: number;
  playerId: number;
  readonly origin: Point;
  waypoints: Point[];
  frontierArc: number;
  readonly targetOwnerId: number;
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
  attackOrders: AttackOrder[];
  frontPushOrders: FrontPushOrder[];
  readonly publicResourceZones: ResourceZonePublic[];
  readonly secretResourceZones: ResourceZoneSecret[];
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
  readonly attackOrders: ReadonlyArray<Readonly<AttackOrder>>;
  readonly frontPushOrders: ReadonlyArray<Readonly<FrontPushOrder>>;
  readonly publicResourceZones: ReadonlyArray<ResourceZonePublic>;
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
    }
  | {
      readonly type: 'AMBUSH_ATTACK';
      readonly playerId: number;
      readonly targetId: number;
      readonly waypoints: ReadonlyArray<Point>;
      readonly manpowerPercent: number;
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
    }
  | { readonly type: 'DECLARE_WAR'; readonly actorId: number; readonly targetId: number }
  | { readonly type: 'MAKE_PEACE'; readonly actorId: number; readonly targetId: number }
  | { readonly type: 'TOGGLE_ALLIANCE'; readonly actorId: number; readonly targetId: number }
  | { readonly type: 'CANCEL_PLAYER_ORDERS'; readonly playerId: number }
  | { readonly type: 'TOGGLE_PAUSE' }
  | { readonly type: 'RESTART_GAME'; readonly seed?: number }
  | { readonly type: 'TICK' };
