import {
  MAP_HEIGHT,
  MAP_WIDTH,
  ResourceType,
  ResourceZonePublic,
  ResourceZoneSecret,
  TerrainType,
} from './types';

export interface GeneratedEuropeMap {
  readonly width: number;
  readonly height: number;
  readonly totalLandCells: number;
  readonly terrain: Uint8Array;
  readonly owners: Int16Array;
  readonly publicResourceZones: ResourceZonePublic[];
  readonly secretResourceZones: ResourceZoneSecret[];
}

/** Deterministic xorshift32 PRNG returning [0, 1) and updating seed wrapper. */
export function nextRandom(rngBox: { rngState: number }): number {
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

type LonLat = readonly [number, number];
type GridPoint = readonly [number, number];

function geoToGrid(lon: number, lat: number): GridPoint {
  // Smooth latitude compression above 61°N so Scandinavia fits cleanly in 220px height
  const effectiveLat = lat > 61 ? 61 + (lat - 61) * 0.72 : lat;
  const x = 10 + (lon + 11.0) * 5.56;
  const y = 212 - (effectiveLat - 35.5) * 6.08;
  return [x, y];
}

function toGridPolygon(coords: ReadonlyArray<LonLat>): GridPoint[] {
  return coords.map(([lon, lat]) => geoToGrid(lon, lat));
}

function pointInPolygon(px: number, py: number, poly: ReadonlyArray<GridPoint>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToPolyline(px: number, py: number, line: ReadonlyArray<GridPoint>): number {
  let minDist = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const d = distToSegment(px, py, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]);
    if (d < minDist) {
      minDist = d;
    }
  }
  return minDist;
}

// Continental Europe, peninsulas, and major islands in [lon, lat] degrees
const MAINLAND_EUROPE_POLY = toGridPolygon([
  // Iberia SW -> NW -> Pyrenees -> France Atlantic
  [-9.3, 37.0],
  [-9.5, 38.7],
  [-8.9, 41.2],
  [-9.3, 42.9],
  [-7.5, 43.7],
  [-4.0, 43.5],
  [-1.7, 43.4],
  [-1.3, 45.6],
  [-2.2, 47.2],
  [-4.6, 48.4],
  [-1.8, 48.7],
  [-1.9, 49.7],
  [0.2, 49.5],
  [1.9, 50.9],
  [3.4, 51.4],
  // Low Countries & German North Sea coast
  [4.8, 53.0],
  [7.0, 53.4],
  [8.6, 54.0],
  // Jutland (Denmark)
  [8.1, 55.6],
  [8.2, 57.0],
  [10.5, 57.7],
  [10.6, 56.5],
  [10.0, 55.4],
  [9.8, 54.4],
  // Baltic coast (Germany, Poland, Baltics, Gulf of Finland)
  [11.2, 54.1],
  [14.0, 53.9],
  [16.5, 54.5],
  [18.7, 54.7],
  [19.5, 54.4],
  [21.0, 55.7],
  [21.6, 57.6],
  [22.6, 57.7],
  [24.1, 57.1],
  [24.4, 58.3],
  [23.5, 59.1],
  [25.5, 59.5],
  [28.0, 59.5],
  [29.8, 60.0],
  // Karelia, Kola & Eastern Arctic edge
  [28.6, 60.7],
  [27.2, 60.5],
  [24.6, 60.1],
  [22.2, 60.1],
  [21.2, 61.3],
  [21.6, 63.1],
  [24.5, 65.0],
  [25.3, 65.8],
  [23.8, 65.8],
  [21.8, 65.4],
  [21.3, 64.5],
  [19.5, 63.5],
  [17.8, 62.3],
  [17.5, 60.6],
  [18.8, 60.0],
  [18.1, 59.3],
  [16.6, 57.8],
  [15.6, 56.1],
  [13.8, 55.4],
  [12.8, 55.9],
  [12.0, 57.5],
  [11.1, 59.1],
  [10.4, 59.7],
  [9.3, 58.9],
  [7.1, 58.0],
  [5.4, 59.1],
  [5.0, 60.8],
  [5.6, 62.3],
  [8.4, 63.6],
  [10.8, 64.9],
  [12.8, 66.8],
  [15.4, 68.4],
  [18.8, 69.8],
  [23.5, 70.6],
  [26.2, 71.1],
  [29.8, 70.8],
  [31.5, 69.8],
  [35.2, 69.1],
  [40.8, 67.6],
  [41.5, 66.2],
  [37.2, 66.2],
  [34.8, 66.9],
  [36.5, 65.0],
  [39.5, 64.5],
  [44.8, 66.2],
  // Eastern border down to Black Sea / Azov / Caucasus
  [45.5, 44.0],
  [40.0, 43.4],
  [38.5, 45.1],
  [39.3, 47.1],
  [37.5, 47.0],
  [35.2, 46.2],
  [35.8, 45.3],
  [36.4, 45.2],
  [34.8, 44.6],
  [33.5, 44.4],
  [33.0, 45.4],
  [33.5, 46.1],
  [31.6, 46.6],
  [30.2, 46.0],
  [28.6, 44.5],
  [27.8, 43.0],
  [28.0, 41.9],
  [29.1, 41.2],
  // Thrace, Aegean, Greece & Peloponnese
  [26.8, 40.6],
  [25.6, 40.8],
  [24.0, 40.2],
  [22.8, 40.5],
  [23.4, 39.1],
  [24.0, 38.0],
  [23.4, 37.8],
  [22.5, 38.2],
  [22.8, 36.7],
  [21.6, 36.8],
  [21.3, 38.0],
  [20.2, 39.6],
  // Dalmatia & Adriatic
  [19.4, 41.4],
  [18.6, 42.3],
  [16.2, 43.6],
  [14.7, 45.0],
  [13.6, 45.5],
  [12.3, 45.3],
  // Italy boot
  [12.6, 44.0],
  [14.2, 42.4],
  [16.1, 41.9],
  [16.5, 41.2],
  [18.4, 40.1],
  [18.1, 39.8],
  [17.0, 40.4],
  [16.7, 39.4],
  [17.1, 38.9],
  [16.1, 37.9],
  [15.6, 38.2],
  [15.9, 39.4],
  [14.3, 40.8],
  [12.4, 41.7],
  [10.5, 43.4],
  [9.0, 44.4],
  [7.6, 43.8],
  // French Riviera, Gulf of Lion, Spanish Med & Gibraltar
  [5.4, 43.2],
  [3.4, 43.2],
  [3.2, 42.3],
  [2.1, 41.3],
  [0.5, 40.5],
  [-0.2, 38.9],
  [-0.8, 37.7],
  [-2.2, 36.7],
  [-5.5, 36.0],
  [-6.4, 36.6],
  [-7.8, 37.0],
]);

// Gulf of Bothnia & Sea of Azov cutouts are naturally formed by the coastline loop above;
// Water cutout for Skagerrak/Kattegat/Danish Straits so Sweden & Denmark are clearly separated
const BALTIC_STRAITS_CUTOUT = toGridPolygon([
  [10.4, 57.8],
  [11.3, 57.6],
  [12.6, 56.1],
  [12.8, 55.4],
  [10.8, 54.4],
  [10.1, 55.1],
  [10.5, 56.3],
]);

// White Sea inner cutout (keep Kola peninsula crisp)
const WHITE_SEA_CUTOUT = toGridPolygon([
  [34.6, 66.8],
  [37.4, 65.8],
  [39.8, 64.8],
  [38.5, 64.1],
  [36.2, 64.6],
  [34.5, 65.8],
]);

// Great Britain (shifted ~0.6° W at Dover so English Channel water is clearly visible)
const GREAT_BRITAIN_POLY = toGridPolygon([
  [-5.7, 50.1],
  [-5.2, 51.3],
  [-4.4, 51.6],
  [-5.2, 52.0],
  [-4.1, 52.7],
  [-4.7, 53.3],
  [-3.1, 53.4],
  [-3.5, 54.6],
  [-5.0, 54.8],
  [-5.6, 55.8],
  [-6.2, 56.8],
  [-5.6, 58.2],
  [-4.8, 58.6],
  [-3.1, 58.6],
  [-4.0, 57.6],
  [-1.9, 57.6],
  [-2.4, 56.2],
  [-1.6, 55.5],
  [-0.9, 54.5],
  [0.1, 53.5],
  [1.6, 52.7],
  [1.4, 51.9],
  [0.9, 51.2],
  [0.7, 51.0],
  [-0.9, 50.7],
  [-2.6, 50.6],
  [-3.7, 50.2],
]);

const IRELAND_POLY = toGridPolygon([
  [-10.1, 51.7],
  [-10.4, 52.6],
  [-9.8, 53.4],
  [-10.1, 54.2],
  [-8.5, 54.7],
  [-7.6, 55.3],
  [-6.1, 55.2],
  [-5.5, 54.4],
  [-6.1, 53.3],
  [-6.2, 52.2],
  [-7.8, 51.8],
]);

const SICILY_POLY = toGridPolygon([
  [12.4, 37.8],
  [14.2, 38.1],
  [15.5, 38.2],
  [15.2, 36.8],
  [13.6, 37.2],
]);

const SARDINIA_POLY = toGridPolygon([
  [8.2, 39.2],
  [8.3, 40.9],
  [9.5, 41.2],
  [9.7, 39.7],
  [9.1, 39.0],
]);

const CORSICA_POLY = toGridPolygon([
  [8.6, 41.6],
  [8.8, 42.6],
  [9.4, 42.9],
  [9.5, 41.7],
  [9.1, 41.4],
]);

const CRETE_POLY = toGridPolygon([
  [23.5, 35.5],
  [25.6, 35.4],
  [26.3, 35.2],
  [25.2, 35.0],
  [23.6, 35.2],
]);

const ANATOLIA_NW_POLY = toGridPolygon([
  [26.2, 40.0],
  [28.5, 40.3],
  [32.5, 41.6],
  [37.5, 41.0],
  [42.0, 41.6],
  [44.0, 35.5],
  [27.2, 36.5],
  [26.2, 38.4],
]);

const LAND_POLYGONS: ReadonlyArray<ReadonlyArray<GridPoint>> = [
  MAINLAND_EUROPE_POLY,
  GREAT_BRITAIN_POLY,
  IRELAND_POLY,
  SICILY_POLY,
  SARDINIA_POLY,
  CORSICA_POLY,
  CRETE_POLY,
  ANATOLIA_NW_POLY,
];

const WATER_CUTOUT_POLYGONS: ReadonlyArray<ReadonlyArray<GridPoint>> = [
  BALTIC_STRAITS_CUTOUT,
  WHITE_SEA_CUTOUT,
];

interface MountainRidge {
  readonly line: ReadonlyArray<GridPoint>;
  readonly halfWidth: number;
}

const MOUNTAIN_RIDGES: ReadonlyArray<MountainRidge> = [
  // Alps
  {
    line: toGridPolygon([
      [6.4, 44.3],
      [7.1, 45.6],
      [9.4, 46.4],
      [12.1, 46.8],
      [14.8, 47.2],
    ]),
    halfWidth: 4.1,
  },
  // Pyrenees
  {
    line: toGridPolygon([
      [-1.5, 43.1],
      [0.8, 42.7],
      [2.8, 42.4],
    ]),
    halfWidth: 2.8,
  },
  // Carpathians
  {
    line: toGridPolygon([
      [18.5, 49.2],
      [21.8, 49.0],
      [24.5, 47.9],
      [26.0, 46.2],
      [24.4, 45.4],
      [22.2, 45.3],
    ]),
    halfWidth: 3.1,
  },
  // Scandinavian Mountains (Scandes)
  {
    line: toGridPolygon([
      [7.2, 60.3],
      [9.4, 62.2],
      [13.4, 65.2],
      [16.8, 67.8],
      [20.2, 69.2],
    ]),
    halfWidth: 3.8,
  },
  // Dinaric Alps & Balkan Mountains
  {
    line: toGridPolygon([
      [15.2, 44.8],
      [17.8, 43.2],
      [20.2, 41.2],
      [21.6, 39.2],
    ]),
    halfWidth: 2.3,
  },
  // Apennines
  {
    line: toGridPolygon([
      [9.8, 44.2],
      [11.8, 43.4],
      [13.6, 42.1],
      [15.6, 40.4],
    ]),
    halfWidth: 1.9,
  },
  // Caucasus (far SE edge)
  {
    line: toGridPolygon([
      [39.8, 44.0],
      [43.2, 43.0],
      [45.5, 42.2],
    ]),
    halfWidth: 3.2,
  },
];

function generateResourceZones(
  terrain: Uint8Array,
  width: number,
  height: number,
  rngBox: { rngState: number },
): {
  publicResourceZones: ResourceZonePublic[];
  secretResourceZones: ResourceZoneSecret[];
} {
  const targetZones = 9;
  const publicResourceZones: ResourceZonePublic[] = [];
  const secretResourceZones: ResourceZoneSecret[] = [];
  const minZoneSeparation = 36;

  let attempts = 0;
  while (publicResourceZones.length < targetZones && attempts < 2500) {
    attempts++;
    const cx = 18 + Math.floor(nextRandom(rngBox) * (width - 36));
    const cy = 14 + Math.floor(nextRandom(rngBox) * (height - 28));
    if (terrain[cy * width + cx] === TerrainType.WATER) {
      continue;
    }

    const radius = 11 + Math.floor(nextRandom(rngBox) * 4); // 11..14

    // Ensure sufficient spacing from other resource zones
    let tooClose = false;
    for (const existing of publicResourceZones) {
      const dist = Math.hypot(cx - existing.centerX, cy - existing.centerY);
      if (dist < minZoneSeparation) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) {
      continue;
    }

    // Check that >= 70% of the circle area is valid land
    let totalInCircle = 0;
    let landInCircle = 0;
    const rSq = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= width) continue;
        if (dx * dx + dy * dy <= rSq) {
          totalInCircle++;
          if (terrain[ny * width + nx] !== TerrainType.WATER) {
            landInCircle++;
          }
        }
      }
    }
    if (totalInCircle === 0 || landInCircle / totalInCircle < 0.72) {
      continue;
    }

    // Place secret 100% optimum off-center inside the circle on land
    let optX = cx;
    let optY = cy;
    let foundOptimum = false;
    for (let optAttempt = 0; optAttempt < 40; optAttempt++) {
      const angle = nextRandom(rngBox) * Math.PI * 2;
      const offsetDist = radius * (0.32 + nextRandom(rngBox) * 0.45);
      const candidateX = Math.round(cx + Math.cos(angle) * offsetDist);
      const candidateY = Math.round(cy + Math.sin(angle) * offsetDist);
      if (
        candidateX >= 0 &&
        candidateX < width &&
        candidateY >= 0 &&
        candidateY < height &&
        (candidateX !== cx || candidateY !== cy) &&
        terrain[candidateY * width + candidateX] !== TerrainType.WATER
      ) {
        optX = candidateX;
        optY = candidateY;
        foundOptimum = true;
        break;
      }
    }
    if (!foundOptimum) {
      continue;
    }

    const id = publicResourceZones.length + 1;
    const type: ResourceType =
      id % 2 === 1 ? 'CONSTRUCTION_MATERIAL' : 'BASIC_ENERGY';

    publicResourceZones.push({
      id,
      type,
      centerX: cx,
      centerY: cy,
      radius,
    });
    secretResourceZones.push({
      zoneId: id,
      optimumX: optX,
      optimumY: optY,
      baseYield: 100,
    });
  }

  return { publicResourceZones, secretResourceZones };
}

export function generateEuropeMap(seed: number): GeneratedEuropeMap {
  const width = MAP_WIDTH;
  const height = MAP_HEIGHT;
  const terrain = new Uint8Array(width * height);
  const owners = new Int16Array(width * height);
  const rngBox = { rngState: seed || 133742 };

  // Step 1: Rasterize land and water cutout polygons
  let totalLandCells = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let isLand = false;

      for (const poly of LAND_POLYGONS) {
        if (pointInPolygon(px, py, poly)) {
          isLand = true;
          break;
        }
      }

      if (isLand) {
        for (const cutout of WATER_CUTOUT_POLYGONS) {
          if (pointInPolygon(px, py, cutout)) {
            isLand = false;
            break;
          }
        }
      }

      const idx = y * width + x;
      if (isLand) {
        terrain[idx] = TerrainType.PLAINS;
        totalLandCells++;
      } else {
        terrain[idx] = TerrainType.WATER;
      }
    }
  }

  // Step 2: Carve major mountain ranges on land cells
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (terrain[idx] === TerrainType.WATER) {
        continue;
      }
      const px = x + 0.5;
      const py = y + 0.5;
      // Deterministic spatial wobble so ridge edges look natural rather than tubular
      const wobble =
        Math.sin(x * 0.45 + y * 0.35) * 0.55 + Math.cos(x * 0.27 - y * 0.51) * 0.45;
      for (const ridge of MOUNTAIN_RIDGES) {
        const d = distToPolyline(px, py, ridge.line);
        if (d <= ridge.halfWidth + wobble * 0.85) {
          terrain[idx] = TerrainType.MOUNTAINS;
          break;
        }
      }
    }
  }

  // Step 3: Generate 8-10 circular resource zones (public bounds + hidden optima)
  const { publicResourceZones, secretResourceZones } = generateResourceZones(
    terrain,
    width,
    height,
    rngBox,
  );

  return {
    width,
    height,
    totalLandCells,
    terrain,
    owners,
    publicResourceZones,
    secretResourceZones,
  };
}
