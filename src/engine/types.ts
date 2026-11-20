export const MAP_WIDTH = 320;
export const MAP_HEIGHT = 220;
export const TICK_RATE = 10;
export const TICK_DT = 1 / TICK_RATE;

export enum TerrainType {
  WATER = 0,
  PLAINS = 1,
  MOUNTAINS = 2,
}

export type ResourceType = 'CONSTRUCTION_MATERIAL' | 'BASIC_ENERGY';

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
  /** Only populated for the local human player; omitted for AI bots / opponents. */
  readonly manpower?: number;
  readonly maxManpower?: number;
  readonly manpowerIncomePerSec?: number;
}

export interface AttackOrder {
  id: number;
  playerId: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  dirX: number;
  dirY: number;
  manpowerCommitted: number;
  manpowerRemaining: number;
  ticksRemaining: number;
  mountainAccum: number;
}

export interface FrontPushOrder {
  id: number;
  playerId: number;
  frontierCells: number[];
  dirX: number;
  dirY: number;
  manpowerCommitted: number;
  manpowerRemaining: number;
  ticksRemaining: number;
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
      readonly fromX: number;
      readonly fromY: number;
      readonly toX: number;
      readonly toY: number;
      readonly manpowerPercent: number;
    }
  | {
      readonly type: 'CREATE_FRONT_PUSH_ORDER';
      readonly playerId: number;
      readonly frontierCells: ReadonlyArray<number>;
      readonly dirX: number;
      readonly dirY: number;
      readonly manpowerPercent: number;
    }
  | { readonly type: 'CANCEL_PLAYER_ORDERS'; readonly playerId: number }
  | { readonly type: 'TOGGLE_PAUSE' }
  | { readonly type: 'RESTART_GAME'; readonly seed?: number }
  | { readonly type: 'TICK' };
