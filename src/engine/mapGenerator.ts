import {
  MAP_HEIGHT,
  MAP_WIDTH,
  ResourceType,
  ResourceZonePublic,
  ResourceZoneSecret,
  TerrainType,
  WILDERNESS_OWNER,
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
  // Smooth latitude compression above 61°N so Scandinavia fits cleanly in 500px height
  const effectiveLat = lat > 61 ? 61 + (lat - 61) * 0.72 : lat;
  const x = 22 + (lon + 11.0) * 12.52;
  const y = 482 - (effectiveLat - 35.5) * 13.82;
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

// High-detail Europe landmass polygons in [lon, lat] degrees
const MAINLAND_EUROPE_POLY = toGridPolygon([
  // Iberia SW -> Portugal -> Galicia -> Bay of Biscay
  [-8.9, 37.0],
  [-9.1, 38.4],
  [-9.5, 38.8],
  [-9.1, 40.1],
  [-8.8, 41.5],
  [-9.3, 42.9],
  [-8.2, 43.7],
  [-5.8, 43.6],
  [-3.2, 43.4],
  [-1.7, 43.4],
  // France Atlantic, Brittany, Normandy, Picardy
  [-1.4, 44.8],
  [-1.2, 46.2],
  [-2.3, 47.3],
  [-4.6, 48.2],
  [-4.7, 48.6],
  [-3.1, 48.8],
  [-1.7, 48.6],
  [-1.9, 49.7],
  [-0.9, 49.4],
  [0.1, 49.5],
  [1.6, 50.8],
  [2.1, 51.0],
  // Flanders, Netherlands, German North Sea & Jutland
  [3.5, 51.4],
  [4.3, 52.1],
  [4.8, 53.0],
  [6.1, 53.4],
  [7.3, 53.5],
  [8.6, 53.9],
  [8.5, 55.1],
  [8.1, 56.1],
  [8.3, 57.1],
  [9.5, 57.5],
  [10.6, 57.7],
  [10.5, 56.8],
  [10.8, 56.4],
  [10.1, 55.8],
  [9.8, 54.6],
  // Mecklenburg, Pomerania, Gdansk Bay, Baltics, Gulf of Riga, Estonia
  [10.9, 54.0],
  [12.3, 54.4],
  [13.8, 53.9],
  [15.4, 54.2],
  [17.2, 54.7],
  [18.7, 54.7],
  [19.1, 54.4],
  [20.2, 54.6],
  [21.1, 55.6],
  [21.1, 56.8],
  [21.9, 57.6],
  [22.7, 57.7],
  [23.3, 57.1],
  [24.2, 57.0],
  [24.4, 58.3],
  [23.6, 59.1],
  [24.8, 59.5],
  [27.0, 59.5],
  [28.5, 59.5],
  [30.1, 59.9],
  // Karelian Isthmus, Finnish Coast, Gulf of Bothnia
  [29.5, 60.4],
  [27.8, 60.5],
  [25.2, 60.2],
  [22.8, 59.9],
  [21.4, 60.7],
  [21.2, 62.1],
  [21.6, 63.2],
  [23.2, 64.2],
  [24.9, 65.2],
  [25.3, 65.8],
  [23.9, 65.8],
  [22.0, 65.5],
  [21.4, 64.6],
  [19.8, 63.6],
  [18.1, 62.5],
  [17.3, 61.3],
  [17.7, 60.5],
  [18.9, 60.1],
  [18.1, 59.3],
  [16.8, 58.2],
  [16.4, 56.8],
  [15.6, 56.1],
  [14.2, 55.4],
  [13.0, 55.4],
  [12.7, 56.1],
  [12.0, 57.4],
  [11.2, 58.9],
  // Oslo Fjord & Norwegian Coast -> Lofoten -> North Cape -> Kola
  [10.7, 59.8],
  [9.8, 59.0],
  [8.1, 58.1],
  [6.6, 58.1],
  [5.4, 59.2],
  [5.0, 60.5],
  [5.2, 61.8],
  [6.4, 62.7],
  [8.6, 63.7],
  [10.8, 64.8],
  [12.4, 66.2],
  [14.2, 67.5],
  [15.8, 68.5],
  [17.9, 69.5],
  [20.8, 70.2],
  [23.8, 70.7],
  [26.0, 71.1],
  [29.2, 70.9],
  [31.2, 70.0],
  [33.4, 69.4],
  [36.5, 69.0],
  [40.2, 68.0],
  [41.4, 66.9],
  [39.5, 66.1],
  [36.5, 66.2],
  [34.5, 66.9],
  [36.2, 65.2],
  [39.8, 64.5],
  [41.8, 65.5],
  [45.5, 66.4],
  // Eastern Europe boundary down to Caucasus, Azov, Black Sea
  [46.0, 43.2],
  [41.2, 43.3],
  [39.3, 44.1],
  [37.5, 44.8],
  [38.4, 45.4],
  [39.3, 47.0],
  [38.0, 47.1],
  [36.2, 46.6],
  [34.9, 46.1],
  [35.6, 45.4],
  [36.4, 45.3],
  [35.2, 44.8],
  [33.7, 44.4],
  [32.9, 45.4],
  [33.6, 46.1],
  [32.1, 46.6],
  [30.5, 46.2],
  [29.4, 45.1],
  [28.6, 44.1],
  [27.9, 43.1],
  [27.7, 42.3],
  [28.1, 41.7],
  [29.1, 41.2],
  // Thrace, Aegean, Chalkidiki, Greece, Peloponnese
  [26.8, 40.6],
  [25.6, 40.9],
  [24.0, 40.4],
  [23.7, 39.9],
  [22.8, 40.4],
  [23.0, 39.5],
  [24.0, 38.2],
  [23.7, 37.7],
  [22.9, 37.9],
  [23.3, 37.4],
  [22.8, 36.6],
  [22.1, 36.8],
  [21.6, 36.8],
  [21.2, 37.9],
  [20.7, 38.8],
  [20.1, 39.7],
  // Albania, Dalmatia, Istria, Venice Lagoon
  [19.4, 40.9],
  [19.2, 41.9],
  [17.5, 42.8],
  [16.0, 43.6],
  [14.8, 44.8],
  [13.9, 44.8],
  [13.6, 45.6],
  [12.4, 45.4],
  // Italy East Coast -> Gargano -> Apulia -> Calabria -> Naples -> Liguria
  [12.3, 44.8],
  [12.6, 44.0],
  [13.8, 43.2],
  [14.6, 42.1],
  [16.1, 41.9],
  [16.0, 41.5],
  [17.3, 40.9],
  [18.4, 40.1],
  [18.1, 39.8],
  [17.3, 40.4],
  [16.6, 39.7],
  [17.1, 39.0],
  [16.3, 38.0],
  [15.6, 38.1],
  [15.9, 39.3],
  [15.1, 40.2],
  [14.2, 40.8],
  [13.0, 41.3],
  [11.8, 42.1],
  [10.4, 43.5],
  [9.6, 44.1],
  [8.9, 44.4],
  [7.7, 43.8],
  // French Riviera, Gulf of Lion, Catalonia, Valencia, Gibraltar
  [6.3, 43.1],
  [5.2, 43.3],
  [3.6, 43.3],
  [3.2, 42.3],
  [2.2, 41.3],
  [0.9, 40.8],
  [0.2, 39.7],
  [0.2, 38.7],
  [-0.7, 37.7],
  [-1.9, 36.8],
  [-4.4, 36.6],
  [-5.5, 36.0],
  [-6.2, 36.5],
  [-7.5, 37.1],
]);

// Water cutout for Danish Straits / Kattegat / Sound so Sweden & Denmark stay cleanly separated
const BALTIC_STRAITS_CUTOUT = toGridPolygon([
  [10.4, 57.8],
  [11.4, 57.6],
  [12.6, 56.1],
  [12.8, 55.4],
  [10.8, 54.4],
  [10.0, 55.0],
  [10.5, 56.2],
]);

const WHITE_SEA_CUTOUT = toGridPolygon([
  [34.5, 66.8],
  [37.4, 65.8],
  [39.8, 64.8],
  [38.5, 64.1],
  [36.0, 64.6],
  [34.4, 65.8],
]);

const ZEALAND_POLY = toGridPolygon([
  [11.1, 55.7],
  [12.3, 56.1],
  [12.6, 55.5],
  [11.9, 55.0],
  [11.2, 55.2],
]);

const GREAT_BRITAIN_POLY = toGridPolygon([
  [-5.7, 50.1],
  [-4.8, 50.9],
  [-4.2, 51.2],
  [-3.1, 51.4],
  [-5.2, 51.8],
  [-4.1, 52.7],
  [-4.7, 53.3],
  [-3.2, 53.4],
  [-3.0, 54.0],
  [-3.6, 54.7],
  [-5.0, 54.8],
  [-5.5, 55.7],
  [-6.2, 56.9],
  [-5.7, 58.3],
  [-4.7, 58.6],
  [-3.1, 58.6],
  [-4.0, 57.6],
  [-1.9, 57.6],
  [-2.6, 56.3],
  [-1.5, 55.4],
  [-0.9, 54.5],
  [0.1, 53.5],
  [0.4, 52.9],
  [1.6, 52.6],
  [1.3, 51.8],
  [0.8, 51.1],
  [-0.8, 50.7],
  [-2.6, 50.6],
  [-3.7, 50.2],
]);

const IRELAND_POLY = toGridPolygon([
  [-9.9, 51.6],
  [-10.4, 52.3],
  [-9.7, 53.2],
  [-10.2, 54.0],
  [-8.6, 54.6],
  [-7.5, 55.3],
  [-6.0, 55.2],
  [-5.5, 54.3],
  [-6.1, 53.3],
  [-6.2, 52.2],
  [-7.9, 51.8],
]);

const SICILY_POLY = toGridPolygon([
  [12.4, 37.9],
  [14.2, 38.1],
  [15.5, 38.2],
  [15.2, 36.7],
  [13.6, 37.1],
]);

const SARDINIA_POLY = toGridPolygon([
  [8.2, 39.1],
  [8.3, 41.0],
  [9.5, 41.2],
  [9.8, 39.7],
  [9.1, 38.9],
]);

const CORSICA_POLY = toGridPolygon([
  [8.6, 41.5],
  [8.8, 42.6],
  [9.4, 43.0],
  [9.5, 41.7],
  [9.1, 41.3],
]);

const MALLORCA_POLY = toGridPolygon([
  [2.4, 39.6],
  [3.1, 39.9],
  [3.4, 39.6],
  [3.0, 39.3],
]);

const CRETE_POLY = toGridPolygon([
  [23.5, 35.6],
  [25.4, 35.4],
  [26.3, 35.2],
  [25.3, 34.9],
  [23.6, 35.2],
]);

const ANATOLIA_NW_POLY = toGridPolygon([
  [26.2, 40.0],
  [28.5, 40.4],
  [32.5, 41.6],
  [37.5, 41.0],
  [42.2, 41.6],
  [45.0, 35.4],
  [27.0, 36.4],
  [26.1, 38.4],
]);

const LAND_POLYGONS: ReadonlyArray<ReadonlyArray<GridPoint>> = [
  MAINLAND_EUROPE_POLY,
  ZEALAND_POLY,
  GREAT_BRITAIN_POLY,
  IRELAND_POLY,
  SICILY_POLY,
  SARDINIA_POLY,
  CORSICA_POLY,
  MALLORCA_POLY,
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
      [6.1, 44.2],
      [7.0, 45.5],
      [9.4, 46.4],
      [12.3, 46.8],
      [15.2, 47.3],
    ]),
    halfWidth: 9.0,
  },
  // Pyrenees
  {
    line: toGridPolygon([
      [-1.7, 43.1],
      [0.8, 42.7],
      [2.9, 42.4],
    ]),
    halfWidth: 6.2,
  },
  // Carpathians
  {
    line: toGridPolygon([
      [18.3, 49.2],
      [21.9, 49.0],
      [24.6, 47.9],
      [26.1, 46.2],
      [24.4, 45.4],
      [22.2, 45.3],
    ]),
    halfWidth: 6.9,
  },
  // Scandinavian Mountains (Scandes)
  {
    line: toGridPolygon([
      [7.1, 60.2],
      [9.5, 62.3],
      [13.4, 65.2],
      [16.8, 67.8],
      [20.2, 69.2],
    ]),
    halfWidth: 8.6,
  },
  // Dinaric Alps & Pindus
  {
    line: toGridPolygon([
      [15.1, 44.8],
      [17.8, 43.2],
      [20.2, 41.2],
      [21.6, 39.2],
    ]),
    halfWidth: 5.2,
  },
  // Balkan / Stara Planina
  {
    line: toGridPolygon([
      [22.6, 43.4],
      [24.8, 42.8],
      [27.1, 42.7],
    ]),
    halfWidth: 4.0,
  },
  // Apennines
  {
    line: toGridPolygon([
      [9.6, 44.2],
      [11.8, 43.4],
      [13.7, 42.1],
      [15.7, 40.3],
    ]),
    halfWidth: 4.3,
  },
  // Caucasus (far SE edge)
  {
    line: toGridPolygon([
      [39.8, 44.0],
      [43.2, 43.0],
      [45.8, 42.1],
    ]),
    halfWidth: 7.4,
  },
];

function smoothCoastlinePass(
  terrain: Uint8Array,
  width: number,
  height: number,
): number {
  const copy = new Uint8Array(terrain);
  let totalLand = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let landNeighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (copy[ny * width + nx] !== TerrainType.WATER) {
            landNeighbors++;
          }
        }
      }

      if (copy[idx] === TerrainType.WATER && landNeighbors >= 6) {
        terrain[idx] = TerrainType.PLAINS;
      } else if (copy[idx] !== TerrainType.WATER && landNeighbors <= 2) {
        terrain[idx] = TerrainType.WATER;
      }

      if (terrain[idx] !== TerrainType.WATER) {
        totalLand++;
      }
    }
  }

  return totalLand;
}

function generateResourceZones(
  terrain: Uint8Array,
  width: number,
  height: number,
  rngBox: { rngState: number },
): {
  publicResourceZones: ResourceZonePublic[];
  secretResourceZones: ResourceZoneSecret[];
} {
  const targetZones = 26;
  const publicResourceZones: ResourceZonePublic[] = [];
  const secretResourceZones: ResourceZoneSecret[] = [];
  const minZoneSeparation = 42;

  let attempts = 0;
  while (publicResourceZones.length < targetZones && attempts < 6000) {
    attempts++;
    const cx = 28 + Math.floor(nextRandom(rngBox) * (width - 56));
    const cy = 22 + Math.floor(nextRandom(rngBox) * (height - 44));
    if (terrain[cy * width + cx] === TerrainType.WATER) {
      continue;
    }

    const radius = 18 + Math.floor(nextRandom(rngBox) * 6); // 18..23

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

    // Check that >= 55% of the circle area is valid land (allows islands and peninsulas)
    let totalInCircle = 0;
    let landInCircle = 0;
    const rSq = radius * radius;
    for (let dy = -radius; dy <= radius; dy += 2) {
      const ny = cy + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -radius; dx <= radius; dx += 2) {
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
    if (totalInCircle === 0 || landInCircle / totalInCircle < 0.55) {
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
  owners.fill(WILDERNESS_OWNER);
  const rngBox = { rngState: seed || 133742 };

  // Step 1: Rasterize land polygons and water cutouts
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

      terrain[y * width + x] = isLand ? TerrainType.PLAINS : TerrainType.WATER;
    }
  }

  // Smooth jagged polygon raster corners on 720x500
  const totalLandCells = smoothCoastlinePass(terrain, width, height);

  // Step 2: Carve major mountain ranges on land cells
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (terrain[idx] === TerrainType.WATER) {
        continue;
      }
      const px = x + 0.5;
      const py = y + 0.5;
      const wobble =
        Math.sin(x * 0.14 + y * 0.11) * 1.15 +
        Math.cos(x * 0.08 - y * 0.16) * 0.95 +
        Math.sin(x * 0.25 + y * 0.22) * 0.45;
      for (const ridge of MOUNTAIN_RIDGES) {
        const d = distToPolyline(px, py, ridge.line);
        if (d <= ridge.halfWidth + wobble) {
          terrain[idx] = TerrainType.MOUNTAINS;
          break;
        }
      }
    }
  }

  // Step 3: Generate circular resource zones (public bounds + hidden optima)
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
