import {
  CLOSE_SONAR_RADIUS,
  RADAR_STATION_VISION_RADIUS,
  isAirUnitType,
  isNavalUnitType,
} from './navalAir';
import {
  Building,
  GameState,
  MAP_HEIGHT,
  MAP_WIDTH,
  Unit,
  UnitSpec,
  UnitType,
  getRelationKey,
} from './types';

export const FOG_GRID_STEP = 4;
export const FOG_GRID_WIDTH = Math.ceil(MAP_WIDTH / FOG_GRID_STEP); // 180
export const FOG_GRID_HEIGHT = Math.ceil(MAP_HEIGHT / FOG_GRID_STEP); // 125
export const BORDER_VISION_RADIUS = 18;

interface VisionCircle {
  readonly x: number;
  readonly y: number;
  readonly rSq: number;
  readonly detectsStealth: boolean;
}

function getRelationVis(state: GameState, a: number, b: number): string {
  if (a === b || a < 0 || b < 0) return 'NEUTRAL';
  return state.relations.get(getRelationKey(a, b)) ?? 'NEUTRAL';
}

function isFriendlyOrAllied(
  state: GameState,
  viewerPlayerId: number,
  ownerId: number,
): boolean {
  if (ownerId < 0) return false;
  return (
    ownerId === viewerPlayerId ||
    getRelationVis(state, viewerPlayerId, ownerId) === 'ALLIED'
  );
}

function collectViewerVisionCircles(
  state: GameState,
  viewerPlayerId: number,
  unitSpecs: Readonly<Record<UnitType, UnitSpec>>,
): VisionCircle[] {
  const circles: VisionCircle[] = [];

  for (const u of state.units) {
    if (u.count <= 0 || u.hp <= 0) continue;
    if (!isFriendlyOrAllied(state, viewerPlayerId, u.ownerId)) continue;
    const spec = unitSpecs[u.type];
    const r = spec.visionRadius;
    circles.push({
      x: u.x,
      y: u.y,
      rSq: r * r,
      detectsStealth: spec.detectsStealth === true,
    });
  }

  for (const b of state.buildings) {
    if (b.stackCount <= 0) continue;
    if (!isFriendlyOrAllied(state, viewerPlayerId, b.ownerId)) continue;
    if (b.type === 'RADAR_STATION') {
      const r = RADAR_STATION_VISION_RADIUS;
      circles.push({
        x: b.x + 0.5,
        y: b.y + 0.5,
        rSq: r * r,
        detectsStealth: true,
      });
    } else if (b.type === 'PORT') {
      const r = 24;
      circles.push({
        x: b.x + 0.5,
        y: b.y + 0.5,
        rSq: r * r,
        detectsStealth: false,
      });
    } else if (b.type === 'AIRFIELD') {
      const r = 26;
      circles.push({
        x: b.x + 0.5,
        y: b.y + 0.5,
        rSq: r * r,
        detectsStealth: false,
      });
    }
  }

  return circles;
}

/**
 * Computes coarse 180x125 visibility grid (0 = FOG, 1 = VISIBLE) for viewerPlayerId
 * from owned/allied territory borders, ground/naval/air units, and RADAR_STATIONs.
 */
export function computePlayerVisibilityGrid(
  state: GameState,
  viewerPlayerId: number,
  unitSpecs: Readonly<Record<UnitType, UnitSpec>>,
): Uint8Array {
  const gw = Math.ceil(state.width / FOG_GRID_STEP);
  const gh = Math.ceil(state.height / FOG_GRID_STEP);
  const grid = new Uint8Array(gw * gh);

  // 1. Stamp owned/allied territory + BORDER_VISION_RADIUS perimeter
  const borderCoarseR = Math.ceil(BORDER_VISION_RADIUS / FOG_GRID_STEP);
  const borderRSq =
    (BORDER_VISION_RADIUS + FOG_GRID_STEP * 0.5) *
    (BORDER_VISION_RADIUS + FOG_GRID_STEP * 0.5);

  const ownedCoarse = new Uint8Array(gw * gh);
  for (let y = 0; y < state.height; y += 2) {
    const row = y * state.width;
    const gy = Math.floor(y / FOG_GRID_STEP);
    const gRow = gy * gw;
    for (let x = 0; x < state.width; x += 2) {
      const owner = state.owners[row + x];
      if (isFriendlyOrAllied(state, viewerPlayerId, owner)) {
        const gx = Math.floor(x / FOG_GRID_STEP);
        ownedCoarse[gRow + gx] = 1;
        grid[gRow + gx] = 1;
      }
    }
  }

  // Only stamp border circle around boundary coarse cells for speed
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const gIdx = gy * gw + gx;
      if (ownedCoarse[gIdx] === 0) continue;

      const isEdge =
        gx === 0 ||
        gx === gw - 1 ||
        gy === 0 ||
        gy === gh - 1 ||
        ownedCoarse[gIdx - 1] === 0 ||
        ownedCoarse[gIdx + 1] === 0 ||
        ownedCoarse[gIdx - gw] === 0 ||
        ownedCoarse[gIdx + gw] === 0;
      if (!isEdge) continue;

      const cx = gx * FOG_GRID_STEP + FOG_GRID_STEP * 0.5;
      const cy = gy * FOG_GRID_STEP + FOG_GRID_STEP * 0.5;
      const minGx = Math.max(0, gx - borderCoarseR);
      const maxGx = Math.min(gw - 1, gx + borderCoarseR);
      const minGy = Math.max(0, gy - borderCoarseR);
      const maxGy = Math.min(gh - 1, gy + borderCoarseR);

      for (let ny = minGy; ny <= maxGy; ny++) {
        const wy = ny * FOG_GRID_STEP + FOG_GRID_STEP * 0.5;
        const dy = wy - cy;
        const nRow = ny * gw;
        for (let nx = minGx; nx <= maxGx; nx++) {
          if (grid[nRow + nx] === 1) continue;
          const wx = nx * FOG_GRID_STEP + FOG_GRID_STEP * 0.5;
          const dx = wx - cx;
          if (dx * dx + dy * dy <= borderRSq) {
            grid[nRow + nx] = 1;
          }
        }
      }
    }
  }

  // 2. Stamp unit, ship, aircraft, and radar vision circles
  const circles = collectViewerVisionCircles(state, viewerPlayerId, unitSpecs);
  for (const c of circles) {
    const r = Math.sqrt(c.rSq);
    const minGx = Math.max(0, Math.floor((c.x - r) / FOG_GRID_STEP));
    const maxGx = Math.min(gw - 1, Math.floor((c.x + r) / FOG_GRID_STEP));
    const minGy = Math.max(0, Math.floor((c.y - r) / FOG_GRID_STEP));
    const maxGy = Math.min(gh - 1, Math.floor((c.y + r) / FOG_GRID_STEP));

    for (let gy = minGy; gy <= maxGy; gy++) {
      const wy = gy * FOG_GRID_STEP + FOG_GRID_STEP * 0.5;
      const dy = wy - c.y;
      const gRow = gy * gw;
      for (let gx = minGx; gx <= maxGx; gx++) {
        if (grid[gRow + gx] === 1) continue;
        const wx = gx * FOG_GRID_STEP + FOG_GRID_STEP * 0.5;
        const dx = wx - c.x;
        if (dx * dx + dy * dy <= c.rSq) {
          grid[gRow + gx] = 1;
        }
      }
    }
  }

  return grid;
}

export function isWorldPointVisibleInGrid(
  state: GameState,
  grid: Uint8Array,
  wx: number,
  wy: number,
): boolean {
  const gw = Math.ceil(state.width / FOG_GRID_STEP);
  const gh = Math.ceil(state.height / FOG_GRID_STEP);
  const gx = Math.max(0, Math.min(gw - 1, Math.floor(wx / FOG_GRID_STEP)));
  const gy = Math.max(0, Math.min(gh - 1, Math.floor(wy / FOG_GRID_STEP)));
  return grid[gy * gw + gx] === 1;
}

export function isSubmarineDetectedByPlayer(
  state: GameState,
  viewerPlayerId: number,
  sub: Unit,
  unitSpecs: Readonly<Record<UnitType, UnitSpec>>,
): boolean {
  for (const spotter of state.units) {
    if (spotter.count <= 0 || spotter.hp <= 0) continue;
    if (!isFriendlyOrAllied(state, viewerPlayerId, spotter.ownerId)) continue;
    const spec = unitSpecs[spotter.type];
    const dist = Math.hypot(sub.x - spotter.x, sub.y - spotter.y);

    if (spec.detectsStealth === true && dist <= spec.visionRadius) {
      return true;
    }
    if (spotter.type === 'CRUISER' && dist <= CLOSE_SONAR_RADIUS) {
      return true;
    }
    if (isNavalUnitType(spotter.type) && dist <= 7) {
      return true;
    }
    if (isAirUnitType(spotter.type) && dist <= 12) {
      return true;
    }
  }

  for (const b of state.buildings) {
    if (b.stackCount <= 0 || b.type !== 'RADAR_STATION') continue;
    if (!isFriendlyOrAllied(state, viewerPlayerId, b.ownerId)) continue;
    if (Math.hypot(sub.x - (b.x + 0.5), sub.y - (b.y + 0.5)) <= RADAR_STATION_VISION_RADIUS) {
      return true;
    }
  }

  return false;
}

export function isUnitVisibleToPlayer(
  state: GameState,
  viewerPlayerId: number,
  unit: Unit,
  unitSpecs: Readonly<Record<UnitType, UnitSpec>>,
  visibilityGrid?: Uint8Array,
): boolean {
  if (unit.count <= 0 || unit.hp <= 0) {
    return false;
  }
  if (isFriendlyOrAllied(state, viewerPlayerId, unit.ownerId)) {
    return true;
  }

  // Stealth submarines are hidden from generic borders/units and require sonar/radar/recon detection
  if (unitSpecs[unit.type].isStealth === true) {
    return isSubmarineDetectedByPlayer(state, viewerPlayerId, unit, unitSpecs);
  }

  if (visibilityGrid && isWorldPointVisibleInGrid(state, visibilityGrid, unit.x, unit.y)) {
    return true;
  }

  for (const spotter of state.units) {
    if (spotter.count <= 0 || spotter.hp <= 0) continue;
    if (!isFriendlyOrAllied(state, viewerPlayerId, spotter.ownerId)) continue;
    if (Math.hypot(unit.x - spotter.x, unit.y - spotter.y) <= unitSpecs[spotter.type].visionRadius) {
      return true;
    }
  }

  for (const b of state.buildings) {
    if (b.stackCount <= 0 || b.type !== 'RADAR_STATION') continue;
    if (!isFriendlyOrAllied(state, viewerPlayerId, b.ownerId)) continue;
    if (Math.hypot(unit.x - (b.x + 0.5), unit.y - (b.y + 0.5)) <= RADAR_STATION_VISION_RADIUS) {
      return true;
    }
  }

  const ux = Math.floor(unit.x);
  const uy = Math.floor(unit.y);
  const r = BORDER_VISION_RADIUS;
  const rSq = r * r;
  const minX = Math.max(0, ux - r);
  const maxX = Math.min(state.width - 1, ux + r);
  const minY = Math.max(0, uy - r);
  const maxY = Math.min(state.height - 1, uy + r);

  for (let y = minY; y <= maxY; y++) {
    const dy = y + 0.5 - unit.y;
    const row = y * state.width;
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - unit.x;
      if (dx * dx + dy * dy > rSq) continue;
      if (isFriendlyOrAllied(state, viewerPlayerId, state.owners[row + x])) {
        return true;
      }
    }
  }

  return false;
}

export function isBuildingVisibleToPlayer(
  state: GameState,
  viewerPlayerId: number,
  building: Building,
  visibilityGrid: Uint8Array,
): boolean {
  if (building.stackCount <= 0 && building.underConstructionCount <= 0) {
    return false;
  }
  if (building.ownerId === viewerPlayerId) {
    return true;
  }
  return isWorldPointVisibleInGrid(
    state,
    visibilityGrid,
    building.x + 0.5,
    building.y + 0.5,
  );
}
