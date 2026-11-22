import { BUILDING_SPECS } from '../engine/buildings';
import { getDefenseRadius, isDefenseBuildingType } from '../engine/defenses';
import {
  AIRFIELD_OPERATION_RANGE,
  RADAR_STATION_VISION_RADIUS,
  supportsFireMission,
} from '../engine/navalAir';
import {
  BuildingType,
  ClientRenderState,
  MAP_HEIGHT,
  MAP_WIDTH,
  MIN_BUILDING_SPACING,
  Point,
  PublicBuildingInfo,
  PublicPlayerInfo,
  ResourceType,
  ResourceZonePublic,
  TerrainType,
  WILDERNESS_OWNER,
} from '../engine/types';
import { FOG_GRID_HEIGHT, FOG_GRID_WIDTH } from '../engine/visibility';
import { Camera } from './camera';
import {
  MoveOrderPing,
  UnitSelectionRect,
  drawArtilleryExplosions,
  drawArtilleryFireMissionOverlay,
  drawMoveOrderPings,
  drawParadropOverlay,
  drawUnitSelectionRect,
  drawUnits,
} from './unitRenderer';

export interface ArrowPreview {
  readonly waypoints: ReadonlyArray<Point>;
  readonly committedManpower: number;
  readonly manpowerPercent: number;
}

export interface FrontPushPreview {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

export interface AmbushOverlay {
  readonly screenX: number;
  readonly screenY: number;
  readonly targetName: string;
  readonly isBetrayal: boolean;
  readonly progress: number;
  readonly remainingSec: number;
}

export interface BuildPlacementPreview {
  readonly buildingType: BuildingType;
  readonly x: number;
  readonly y: number;
  readonly valid: boolean;
  readonly reasonCs: string | null;
  readonly inMatchingZone: boolean;
  readonly isFreePowerPlant: boolean;
  readonly stackTargetId: number | null;
  readonly plannedUnits: number;
}

export type SelectedTarget =
  | {
      readonly kind: 'STATE';
      readonly ownerId: number;
      readonly anchorX: number;
      readonly anchorY: number;
    }
  | {
      readonly kind: 'WILDERNESS';
      readonly anchorX: number;
      readonly anchorY: number;
    };

export interface RenderOverlayState {
  readonly hoverCell: Point | null;
  readonly arrowPreview: ArrowPreview | null;
  readonly frontLassoPoints: ReadonlyArray<Point>;
  readonly selectedFrontierCells: ReadonlyArray<number>;
  readonly frontPushPreview: FrontPushPreview | null;
  readonly activeBendOrderId: number | null;
  readonly ambush: AmbushOverlay | null;
  readonly buildPreview: BuildPlacementPreview | null;
  readonly selectedBuildingId: number | null;
  readonly hoveredBuildingId?: number | null;
  readonly selectedTarget: SelectedTarget | null;
  readonly selectedUnitIds: ReadonlySet<number>;
  readonly unitSelectRect: UnitSelectionRect | null;
  readonly paradropUnitId: number | null;
  readonly artilleryFireMode: boolean;
  readonly moveOrderPings: ReadonlyArray<MoveOrderPing>;
}

function computeDistanceField(
  width: number,
  height: number,
  isZeroFn: (idx: number) => boolean,
  maxDist: number,
): Uint8Array {
  const dist = new Uint8Array(width * height);
  const total = width * height;

  for (let i = 0; i < total; i++) {
    dist[i] = isZeroFn(i) ? 0 : maxDist;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let d = dist[idx];
      if (d === 0) continue;
      if (x > 0) d = Math.min(d, dist[idx - 1] + 1);
      if (y > 0) d = Math.min(d, dist[idx - width] + 1);
      dist[idx] = d;
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const idx = y * width + x;
      let d = dist[idx];
      if (d === 0) continue;
      if (x < width - 1) d = Math.min(d, dist[idx + 1] + 1);
      if (y < height - 1) d = Math.min(d, dist[idx + width] + 1);
      dist[idx] = d;
    }
  }

  return dist;
}

function slicePolylineByProgress(
  waypoints: ReadonlyArray<Point>,
  progress: number,
): Point[] {
  if (waypoints.length < 2 || progress <= 0.01) return [];
  if (progress >= 0.995) return waypoints.map((p) => ({ x: p.x, y: p.y }));

  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const l = Math.hypot(
      waypoints[i].x - waypoints[i - 1].x,
      waypoints[i].y - waypoints[i - 1].y,
    );
    segLens.push(l);
    totalLen += l;
  }

  if (totalLen < 1e-4) return [];
  const targetDist = totalLen * Math.max(0, Math.min(1, progress));
  const out: Point[] = [{ x: waypoints[0].x, y: waypoints[0].y }];
  let accum = 0;

  for (let i = 0; i < segLens.length; i++) {
    const l = segLens[i];
    if (accum + l >= targetDist) {
      const t = l > 1e-5 ? (targetDist - accum) / l : 0;
      const a = waypoints[i];
      const b = waypoints[i + 1];
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      break;
    }
    out.push({ x: waypoints[i + 1].x, y: waypoints[i + 1].y });
    accum += l;
  }

  return out;
}

function addChamferedVertexEdges(
  path: Path2D,
  vx: number,
  vy: number,
  tActive: boolean,
  rActive: boolean,
  bActive: boolean,
  lActive: boolean,
): void {
  const count = (tActive ? 1 : 0) + (rActive ? 1 : 0) + (bActive ? 1 : 0) + (lActive ? 1 : 0);
  if (count === 0) return;

  const tx = vx;
  const ty = vy - 0.5;
  const rx = vx + 0.5;
  const ry = vy;
  const bx = vx;
  const by = vy + 0.5;
  const lx = vx - 0.5;
  const ly = vy;

  if (count === 2) {
    if (tActive && bActive) {
      path.moveTo(tx, ty);
      path.lineTo(bx, by);
    } else if (lActive && rActive) {
      path.moveTo(lx, ly);
      path.lineTo(rx, ry);
    } else if (tActive && rActive) {
      path.moveTo(tx, ty);
      path.lineTo(rx, ry);
    } else if (rActive && bActive) {
      path.moveTo(rx, ry);
      path.lineTo(bx, by);
    } else if (bActive && lActive) {
      path.moveTo(bx, by);
      path.lineTo(lx, ly);
    } else if (lActive && tActive) {
      path.moveTo(lx, ly);
      path.lineTo(tx, ty);
    }
    return;
  }

  // Junction (triple-point / coastal termination): connect active midpoints cleanly to vertex
  if (tActive) {
    path.moveTo(tx, ty);
    path.lineTo(vx, vy);
  }
  if (rActive) {
    path.moveTo(rx, ry);
    path.lineTo(vx, vy);
  }
  if (bActive) {
    path.moveTo(bx, by);
    path.lineTo(vx, vy);
  }
  if (lActive) {
    path.moveTo(lx, ly);
    path.lineTo(vx, vy);
  }
}

export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly offscreenCanvas: HTMLCanvasElement;
  private readonly offscreenCtx: CanvasRenderingContext2D;
  private readonly imageData: ImageData;
  private readonly baseTerrainRgb: Uint8ClampedArray;
  private readonly selectedTargetCanvas: HTMLCanvasElement;
  private readonly selectedTargetCtx: CanvasRenderingContext2D;
  private readonly selectedTargetImageData: ImageData;
  private readonly fogCanvas: HTMLCanvasElement;
  private readonly fogCtx: CanvasRenderingContext2D;
  private readonly fogImageData: ImageData;

  private coastlinePath: Path2D | null = null;
  private stateBorderPath: Path2D = new Path2D();
  private selectedTargetOutlinePath: Path2D | null = null;
  private selectedTargetCacheKey = '';
  private lastFogStateVersion = -1;

  private lastStateVersion = -1;
  private baseBuilt = false;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private dpr = 1;

  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.ctx = ctx;

    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = MAP_WIDTH;
    this.offscreenCanvas.height = MAP_HEIGHT;
    const offCtx = this.offscreenCanvas.getContext('2d');
    if (!offCtx) {
      throw new Error('Could not initialize offscreen 2D canvas context');
    }
    this.offscreenCtx = offCtx;

    this.imageData = this.offscreenCtx.createImageData(MAP_WIDTH, MAP_HEIGHT);
    this.baseTerrainRgb = new Uint8ClampedArray(MAP_WIDTH * MAP_HEIGHT * 3);

    this.selectedTargetCanvas = document.createElement('canvas');
    this.selectedTargetCanvas.width = MAP_WIDTH;
    this.selectedTargetCanvas.height = MAP_HEIGHT;
    const selCtx = this.selectedTargetCanvas.getContext('2d');
    if (!selCtx) {
      throw new Error('Could not initialize selection highlight 2D canvas context');
    }
    this.selectedTargetCtx = selCtx;
    this.selectedTargetImageData = this.selectedTargetCtx.createImageData(MAP_WIDTH, MAP_HEIGHT);

    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = FOG_GRID_WIDTH;
    this.fogCanvas.height = FOG_GRID_HEIGHT;
    const fCtx = this.fogCanvas.getContext('2d');
    if (!fCtx) {
      throw new Error('Could not initialize Fog of War 2D canvas context');
    }
    this.fogCtx = fCtx;
    this.fogImageData = this.fogCtx.createImageData(FOG_GRID_WIDTH, FOG_GRID_HEIGHT);
  }

  public resize(viewportWidth: number, viewportHeight: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.canvas.width = Math.max(1, Math.floor(viewportWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(viewportHeight * this.dpr));
    this.canvas.style.width = `${viewportWidth}px`;
    this.canvas.style.height = `${viewportHeight}px`;
  }

  private buildBaseTerrainBuffer(state: ClientRenderState): void {
    const { width, height, terrain } = state;
    const buf = this.baseTerrainRgb;

    const waterDist = computeDistanceField(
      width,
      height,
      (idx) => terrain[idx] !== TerrainType.WATER,
      20,
    );

    const mtnDepth = computeDistanceField(
      width,
      height,
      (idx) => terrain[idx] !== TerrainType.MOUNTAINS,
      18,
    );

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const t = terrain[idx];
        const rgbIdx = idx * 3;

        if (t === TerrainType.WATER) {
          const d = waterDist[idx];
          const shelfRatio = Math.min(1, d / 19);
          // Call of War bathymetric navy-slate ocean with crisp coastal drop-off
          let r = 42 - shelfRatio * 22;
          let g = 65 - shelfRatio * 30;
          let b = 82 - shelfRatio * 34;
          if (d <= 2) {
            r -= 4;
            g -= 5;
            b -= 5;
          } else if (d === 6 || d === 13) {
            r += 2;
            g += 3;
            b += 4;
          }
          buf[rgbIdx] = r;
          buf[rgbIdx + 1] = g;
          buf[rgbIdx + 2] = b;
        } else if (t === TerrainType.MOUNTAINS) {
          // Softened, low-contrast Call of War hillshade relief that blends naturally with state tints
          const depth = mtnDepth[idx];
          const xPrev = Math.max(0, x - 1);
          const xNext = Math.min(width - 1, x + 1);
          const yPrev = Math.max(0, y - 1);
          const yNext = Math.min(height - 1, y + 1);
          const gradX = mtnDepth[y * width + xNext] - mtnDepth[y * width + xPrev];
          const gradY = mtnDepth[yNext * width + x] - mtnDepth[yPrev * width + x];
          const nwIdx = yPrev * width + xPrev;
          const seIdx = yNext * width + xNext;
          const rawSlope = (mtnDepth[seIdx] - mtnDepth[nwIdx]) * 0.65 + (gradX + gradY) * 0.35;
          const shade = Math.max(-10, Math.min(10, rawSlope * 3.2));
          const elevLift = Math.min(12, depth * 1.05);
          const contour = depth > 2 && depth % 5 === 0 ? -2.5 : 0;

          buf[rgbIdx] = Math.max(96, Math.min(182, 152 + elevLift - shade + contour));
          buf[rgbIdx + 1] = Math.max(92, Math.min(176, 146 + elevLift - shade + contour));
          buf[rgbIdx + 2] = Math.max(82, Math.min(164, 134 + elevLift - shade + contour));
        } else {
          // Muted cartographic parchment-olive plains with subtle topographic texture
          const grain = Math.sin(x * 0.19 + y * 0.13) * 1.6 + Math.cos(x * 0.09 - y * 0.17) * 1.4;
          buf[rgbIdx] = 182 + grain;
          buf[rgbIdx + 1] = 177 + grain;
          buf[rgbIdx + 2] = 158 + grain * 0.7;
        }
      }
    }

    // Build smooth chamfered vector coastline once
    const coast = new Path2D();
    for (let vy = 1; vy < height; vy++) {
      for (let vx = 1; vx < width; vx++) {
        const tlWater = terrain[(vy - 1) * width + (vx - 1)] === TerrainType.WATER;
        const trWater = terrain[(vy - 1) * width + vx] === TerrainType.WATER;
        const blWater = terrain[vy * width + (vx - 1)] === TerrainType.WATER;
        const brWater = terrain[vy * width + vx] === TerrainType.WATER;

        addChamferedVertexEdges(
          coast,
          vx,
          vy,
          tlWater !== trWater,
          trWater !== brWater,
          blWater !== brWater,
          tlWater !== blWater,
        );
      }
    }
    this.coastlinePath = coast;
    this.baseBuilt = true;
  }

  private updateMapImageData(state: ClientRenderState): void {
    if (!this.baseBuilt) {
      this.buildBaseTerrainBuffer(state);
    }

    const { width, height, terrain, owners, players } = state;
    const playerColorMap = new Map<number, readonly [number, number, number]>();
    for (const p of players) {
      playerColorMap.set(p.id, p.colorRgb);
    }

    const data = this.imageData.data;
    const base = this.baseTerrainRgb;

    // Fill clean interior colors without baking pixelated dark edges into the bitmap
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const rgbaIdx = idx * 4;
        const rgbIdx = idx * 3;
        const owner = owners[idx];

        if (owner === WILDERNESS_OWNER) {
          data[rgbaIdx] = base[rgbIdx];
          data[rgbaIdx + 1] = base[rgbIdx + 1];
          data[rgbaIdx + 2] = base[rgbIdx + 2];
          data[rgbaIdx + 3] = 255;
          continue;
        }

        const pColor = playerColorMap.get(owner);
        if (!pColor) {
          data[rgbaIdx] = base[rgbIdx];
          data[rgbaIdx + 1] = base[rgbIdx + 1];
          data[rgbaIdx + 2] = base[rgbIdx + 2];
          data[rgbaIdx + 3] = 255;
          continue;
        }

        let nearBorder = false;
        if (
          (x > 1 && owners[idx - 2] !== owner && terrain[idx - 2] !== TerrainType.WATER) ||
          (x < width - 2 && owners[idx + 2] !== owner && terrain[idx + 2] !== TerrainType.WATER) ||
          (y > 1 && owners[idx - width * 2] !== owner && terrain[idx - width * 2] !== TerrainType.WATER) ||
          (y < height - 2 && owners[idx + width * 2] !== owner && terrain[idx + width * 2] !== TerrainType.WATER)
        ) {
          nearBorder = true;
        }

        const isMountain = terrain[idx] === TerrainType.MOUNTAINS;
        const baseBlend = nearBorder ? 0.78 : 0.46;
        const blend = isMountain ? Math.max(0.34, baseBlend - 0.08) : baseBlend;

        data[rgbaIdx] = pColor[0] * blend + base[rgbIdx] * (1 - blend);
        data[rgbaIdx + 1] = pColor[1] * blend + base[rgbIdx + 1] * (1 - blend);
        data[rgbaIdx + 2] = pColor[2] * blend + base[rgbIdx + 2] * (1 - blend);
        data[rgbaIdx + 3] = 255;
      }
    }

    this.offscreenCtx.putImageData(this.imageData, 0, 0);

    // Build crisp chamfered vector state borders over the smooth bitmap
    const borders = new Path2D();
    for (let vy = 1; vy < height; vy++) {
      for (let vx = 1; vx < width; vx++) {
        const tlIdx = (vy - 1) * width + (vx - 1);
        const trIdx = (vy - 1) * width + vx;
        const blIdx = vy * width + (vx - 1);
        const brIdx = vy * width + vx;

        const tlLand = terrain[tlIdx] !== TerrainType.WATER;
        const trLand = terrain[trIdx] !== TerrainType.WATER;
        const blLand = terrain[blIdx] !== TerrainType.WATER;
        const brLand = terrain[brIdx] !== TerrainType.WATER;

        const tlO = owners[tlIdx];
        const trO = owners[trIdx];
        const blO = owners[blIdx];
        const brO = owners[brIdx];

        const tActive = tlLand && trLand && tlO !== trO && (tlO >= 0 || trO >= 0);
        const rActive = trLand && brLand && trO !== brO && (trO >= 0 || brO >= 0);
        const bActive = blLand && brLand && blO !== brO && (blO >= 0 || brO >= 0);
        const lActive = tlLand && blLand && tlO !== blO && (tlO >= 0 || blO >= 0);

        addChamferedVertexEdges(borders, vx, vy, tActive, rActive, bActive, lActive);
      }
    }
    this.stateBorderPath = borders;
    this.lastStateVersion = state.stateVersion;
  }

  private getTargetAccentColor(
    state: ClientRenderState,
    target: SelectedTarget,
  ): { readonly rgba: readonly [number, number, number, number]; readonly stroke: string } {
    if (target.kind === 'WILDERNESS') {
      return { rgba: [235, 198, 108, 66], stroke: '#f0d88b' };
    }
    const player = state.players.find((p) => p.id === target.ownerId);
    if (player?.relationToHuman === 'WAR') {
      return { rgba: [235, 92, 84, 86], stroke: '#f07870' };
    }
    if (player?.relationToHuman === 'ALLIED') {
      return { rgba: [96, 198, 132, 78], stroke: '#7ad89a' };
    }
    return { rgba: [238, 206, 116, 82], stroke: '#f2d684' };
  }

  private rebuildSelectedTargetCache(
    state: ClientRenderState,
    target: SelectedTarget,
  ): void {
    const cacheKey =
      target.kind === 'STATE'
        ? `${state.stateVersion}:S:${target.ownerId}`
        : `${state.stateVersion}:W:${Math.floor(target.anchorX)}:${Math.floor(target.anchorY)}`;

    if (cacheKey === this.selectedTargetCacheKey) {
      return;
    }

    const { width, height, terrain, owners } = state;
    const total = width * height;
    const mask = new Uint8Array(total);
    const { rgba } = this.getTargetAccentColor(state, target);
    const outData = this.selectedTargetImageData.data;
    outData.fill(0);

    if (target.kind === 'STATE') {
      for (let i = 0; i < total; i++) {
        if (terrain[i] !== TerrainType.WATER && owners[i] === target.ownerId) {
          mask[i] = 1;
          const o = i * 4;
          outData[o] = rgba[0];
          outData[o + 1] = rgba[1];
          outData[o + 2] = rgba[2];
          outData[o + 3] = rgba[3];
        }
      }
    } else {
      const cx = Math.floor(target.anchorX);
      const cy = Math.floor(target.anchorY);
      const rad = 36;
      const rSq = rad * rad;
      const minX = Math.max(0, cx - rad);
      const maxX = Math.min(width - 1, cx + rad);
      const minY = Math.max(0, cy - rad);
      const maxY = Math.min(height - 1, cy + rad);
      for (let y = minY; y <= maxY; y++) {
        const dy = y - cy;
        const row = y * width;
        for (let x = minX; x <= maxX; x++) {
          const dx = x - cx;
          if (dx * dx + dy * dy > rSq) continue;
          const idx = row + x;
          if (terrain[idx] !== TerrainType.WATER && owners[idx] === WILDERNESS_OWNER) {
            mask[idx] = 1;
            const o = idx * 4;
            outData[o] = rgba[0];
            outData[o + 1] = rgba[1];
            outData[o + 2] = rgba[2];
            outData[o + 3] = rgba[3];
          }
        }
      }
    }

    this.selectedTargetCtx.putImageData(this.selectedTargetImageData, 0, 0);

    const outline = new Path2D();
    for (let vy = 1; vy < height; vy++) {
      for (let vx = 1; vx < width; vx++) {
        const tl = mask[(vy - 1) * width + (vx - 1)] === 1;
        const tr = mask[(vy - 1) * width + vx] === 1;
        const bl = mask[vy * width + (vx - 1)] === 1;
        const br = mask[vy * width + vx] === 1;
        addChamferedVertexEdges(outline, vx, vy, tl !== tr, tr !== br, bl !== br, tl !== bl);
      }
    }

    this.selectedTargetOutlinePath = outline;
    this.selectedTargetCacheKey = cacheKey;
  }

  private drawFogOfWar(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    state: ClientRenderState,
  ): void {
    if (state.phase !== 'PLAYING' || state.visibilityGrid.length === 0) {
      return;
    }

    const gw = state.visibilityGridWidth;
    const gh = state.visibilityGridHeight;
    if (state.stateVersion !== this.lastFogStateVersion) {
      const grid = state.visibilityGrid;
      const fogData = this.fogImageData.data;

      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          let visSum = 0;
          let count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = gy + dy;
            if (ny < 0 || ny >= gh) continue;
            const row = ny * gw;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = gx + dx;
              if (nx < 0 || nx >= gw) continue;
              const weight = dx === 0 && dy === 0 ? 3 : 1;
              visSum += (grid[row + nx] === 1 ? 1 : 0) * weight;
              count += weight;
            }
          }
          const fogFactor = 1 - visSum / Math.max(1, count);
          const alpha = Math.round(fogFactor * 118);
          const o = (gy * gw + gx) * 4;
          fogData[o] = 10;
          fogData[o + 1] = 16;
          fogData[o + 2] = 26;
          fogData[o + 3] = alpha;
        }
      }
      this.fogCtx.putImageData(this.fogImageData, 0, 0);
      this.lastFogStateVersion = state.stateVersion;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      this.fogCanvas,
      camera.offsetX,
      camera.offsetY,
      state.width * camera.zoom,
      state.height * camera.zoom,
    );
    ctx.restore();
  }

  public render(
    state: ClientRenderState,
    camera: Camera,
    overlays: RenderOverlayState,
  ): void {
    if (state.stateVersion !== this.lastStateVersion) {
      this.updateMapImageData(state);
    }

    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
    const pulse = nowMs > 0 ? 0.5 + 0.5 * Math.sin(nowMs * 0.0055) : 0.7;

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    ctx.fillStyle = '#121b23';
    ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    // Smooth terrain & interior fills (no blocky pixel squares)
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      this.offscreenCanvas,
      camera.offsetX,
      camera.offsetY,
      state.width * camera.zoom,
      state.height * camera.zoom,
    );
    ctx.restore();

    // Crisp vector coastline & state border contours (chamfered, never blurry)
    ctx.save();
    ctx.translate(camera.offsetX, camera.offsetY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (this.coastlinePath) {
      ctx.strokeStyle = 'rgba(14, 22, 30, 0.92)';
      ctx.lineWidth = Math.max(0.65, 1.2 / camera.zoom);
      ctx.stroke(this.coastlinePath);
    }

    ctx.strokeStyle = 'rgba(12, 16, 20, 0.94)';
    ctx.lineWidth = Math.max(0.85, 1.8 / camera.zoom);
    ctx.stroke(this.stateBorderPath);
    ctx.restore();

    // Full-territory highlight & pulsing perimeter outline for selected state / wilderness zone
    if (overlays.selectedTarget) {
      this.rebuildSelectedTargetCache(state, overlays.selectedTarget);
      const { stroke } = this.getTargetAccentColor(state, overlays.selectedTarget);

      ctx.save();
      ctx.globalAlpha = 0.55 + pulse * 0.32;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        this.selectedTargetCanvas,
        camera.offsetX,
        camera.offsetY,
        state.width * camera.zoom,
        state.height * camera.zoom,
      );
      ctx.restore();

      if (this.selectedTargetOutlinePath) {
        ctx.save();
        ctx.translate(camera.offsetX, camera.offsetY);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.globalAlpha = 0.32 + pulse * 0.25;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(2.2, 4.6 / camera.zoom);
        ctx.stroke(this.selectedTargetOutlinePath);

        ctx.globalAlpha = 0.85 + pulse * 0.15;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(1.05, 2.0 / camera.zoom);
        ctx.stroke(this.selectedTargetOutlinePath);
        ctx.restore();
      }
    }

    ctx.strokeStyle = '#33414f';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      camera.offsetX,
      camera.offsetY,
      state.width * camera.zoom,
      state.height * camera.zoom,
    );

    const highlightZoneType =
      overlays.buildPreview !== null
        ? BUILDING_SPECS[overlays.buildPreview.buildingType].resourceZoneType
        : null;

    this.drawResourceZones(ctx, camera, state.publicResourceZones, highlightZoneType);
    this.drawFogOfWar(ctx, camera, state);
    this.drawFrontPushOrders(ctx, camera, state);
    this.drawSelectedFrontierCells(ctx, camera, state.width, overlays.selectedFrontierCells);
    this.drawAttackOrders(ctx, camera, state, overlays.activeBendOrderId);
    this.drawBuildings(
      ctx,
      camera,
      state.buildings,
      overlays.selectedBuildingId,
      overlays.hoveredBuildingId ?? null,
      state.humanPlayerId,
      state.players,
    );
    this.drawCapitals(ctx, camera, state.players, state.humanPlayerId, state.buildings);
    drawMoveOrderPings(ctx, camera, overlays.moveOrderPings, nowMs);
    drawUnits(ctx, camera, state, overlays.selectedUnitIds, nowMs);
    drawArtilleryExplosions(ctx, camera, state.artilleryExplosions);

    if (overlays.artilleryFireMode) {
      const selectedFireUnits = state.units.filter(
        (u) =>
          u.ownerId === state.humanPlayerId &&
          supportsFireMission(u.type) &&
          overlays.selectedUnitIds.has(u.id),
      );
      if (selectedFireUnits.length > 0) {
        drawArtilleryFireMissionOverlay(
          ctx,
          camera,
          state,
          selectedFireUnits,
          overlays.hoverCell,
        );
      }
    }

    if (overlays.paradropUnitId !== null) {
      const dropUnit = state.units.find((u) => u.id === overlays.paradropUnitId);
      if (dropUnit) {
        drawParadropOverlay(ctx, camera, state, dropUnit, overlays.hoverCell);
      }
    }
    if (overlays.unitSelectRect) {
      drawUnitSelectionRect(ctx, camera, overlays.unitSelectRect);
    }

    if (state.phase === 'SELECT_START' && overlays.hoverCell) {
      this.drawStartHoverPreview(ctx, camera, state, overlays.hoverCell);
    }
    if (overlays.buildPreview) {
      this.drawBuildPlacementPreview(ctx, camera, overlays.buildPreview);
    }
    if (overlays.arrowPreview) {
      this.drawArrowPreview(ctx, camera, overlays.arrowPreview);
    }
    if (overlays.frontLassoPoints.length > 1) {
      this.drawLassoStroke(ctx, camera, overlays.frontLassoPoints);
    }
    if (overlays.frontPushPreview) {
      this.drawFrontPushPreview(ctx, camera, overlays.frontPushPreview);
    }
    if (overlays.selectedTarget) {
      this.drawSelectedTarget(ctx, camera, state, overlays.selectedTarget);
    }
    if (overlays.ambush) {
      this.drawAmbushCountdown(ctx, overlays.ambush);
    }

    ctx.restore();
  }

  private drawResourceZones(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    zones: ReadonlyArray<ResourceZonePublic>,
    highlightType: ResourceType | null = null,
  ): void {
    for (const zone of zones) {
      const screen = camera.worldToScreen(zone.centerX + 0.5, zone.centerY + 0.5);
      const radiusPx = zone.radius * camera.zoom;
      const isHighlighted = highlightType !== null && zone.type === highlightType;

      const fillRgb =
        zone.type === 'CONSTRUCTION_MATERIAL'
          ? '202, 148, 70'
          : zone.type === 'INDUSTRIAL'
            ? '216, 118, 68'
            : '86, 160, 178';
      const strokeRgb =
        zone.type === 'CONSTRUCTION_MATERIAL'
          ? isHighlighted
            ? '230, 176, 90'
            : '202, 148, 70'
          : zone.type === 'INDUSTRIAL'
            ? isHighlighted
              ? '238, 146, 92'
              : '214, 120, 74'
            : isHighlighted
              ? '118, 200, 220'
              : '94, 173, 191';

      ctx.save();
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radiusPx, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${fillRgb}, ${isHighlighted ? 0.22 : 0.08})`;
      ctx.fill();

      ctx.setLineDash([5, 4]);
      ctx.lineWidth = isHighlighted ? 2.0 : 1.25;
      ctx.strokeStyle = `rgba(${strokeRgb}, ${isHighlighted ? 0.95 : 0.72})`;
      ctx.stroke();

      if (camera.zoom >= 1.1 || isHighlighted) {
        ctx.setLineDash([]);
        ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label =
          zone.type === 'CONSTRUCTION_MATERIAL'
            ? 'STAV. MAT.'
            : zone.type === 'INDUSTRIAL'
              ? 'PRŮMYSL'
              : 'ENERGIE';
        ctx.fillStyle = 'rgba(18, 22, 28, 0.76)';
        const textW = ctx.measureText(label).width + 8;
        ctx.fillRect(screen.x - textW / 2, screen.y - 7, textW, 14);
        ctx.fillStyle =
          zone.type === 'CONSTRUCTION_MATERIAL'
            ? '#e2b26a'
            : zone.type === 'INDUSTRIAL'
              ? '#eb9f73'
              : '#80c6d6';
        ctx.fillText(label, screen.x, screen.y + 0.5);
      }
      ctx.restore();
    }
  }

  private drawSelectedFrontierCells(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    mapWidth: number,
    cells: ReadonlyArray<number>,
  ): void {
    if (cells.length === 0) return;
    ctx.save();
    const radius = Math.max(1.8, camera.zoom * 0.65);
    ctx.fillStyle = 'rgba(240, 220, 140, 0.75)';
    for (const idx of cells) {
      const cx = idx % mapWidth;
      const cy = (idx - cx) / mapWidth;
      const screen = camera.worldToScreen(cx + 0.5, cy + 0.5);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFrontPushOrders(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    state: ClientRenderState,
  ): void {
    for (const order of state.frontPushOrders) {
      if (order.frontierCells.length === 0) continue;
      let sumX = 0;
      let sumY = 0;
      const radius = Math.max(1.6, camera.zoom * 0.55);
      ctx.save();
      ctx.fillStyle = 'rgba(235, 200, 110, 0.44)';
      for (const idx of order.frontierCells) {
        const cx = idx % state.width;
        const cy = (idx - cx) / state.width;
        sumX += cx + 0.5;
        sumY += cy + 0.5;
        const sc = camera.worldToScreen(cx + 0.5, cy + 0.5);
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      const avgX = sumX / order.frontierCells.length;
      const avgY = sumY / order.frontierCells.length;
      const p1 = { x: avgX, y: avgY };
      const p2 = { x: avgX + order.dirX * 18, y: avgY + order.dirY * 18 };
      this.drawCurvedVectorArrow(ctx, camera, [p1, p2], '#ebd082', 2.4, 1);
      ctx.restore();
    }
  }

  private drawAttackOrders(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    state: ClientRenderState,
    activeBendOrderId: number | null,
  ): void {
    const playerColors = new Map<number, string>();
    for (const p of state.players) {
      playerColors.set(p.id, p.colorHex);
    }

    for (const order of state.attackOrders) {
      if (order.waypoints.length < 2) continue;
      const isHuman = order.playerId === state.humanPlayerId;
      const color = isHuman ? '#d6e6f2' : (playerColors.get(order.playerId) ?? '#c8c8c8');

      this.drawCurvedVectorArrow(
        ctx,
        camera,
        order.waypoints,
        color,
        isHuman ? 3.2 : 2.2,
        order.segmentProgress,
      );

      if (isHuman) {
        const midIdx = Math.floor(order.waypoints.length / 2);
        const midWp = order.waypoints[midIdx];
        const midSc = camera.worldToScreen(midWp.x, midWp.y);

        if (order.waypoints.length >= 3) {
          const isBeingBent = activeBendOrderId === order.id;
          ctx.save();
          ctx.beginPath();
          ctx.arc(midSc.x, midSc.y, isBeingBent ? 5.5 : 4, 0, Math.PI * 2);
          ctx.fillStyle = isBeingBent ? '#f0dca0' : '#263645';
          ctx.fill();
          ctx.lineWidth = 1.4;
          ctx.strokeStyle = '#d6e6f2';
          ctx.stroke();
          ctx.restore();
        }

        if (camera.zoom >= 1.0) {
          const pctProgress = Math.round(order.segmentProgress * 100);
          this.drawArrowBadge(
            ctx,
            midSc.x,
            midSc.y - 14,
            `${Math.round(order.manpowerRemaining)} MP · ${pctProgress}%`,
          );
        }
      }
    }
  }

  private traceSmoothSpline(
    ctx: CanvasRenderingContext2D,
    screenPoints: ReadonlyArray<Point>,
  ): void {
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);

    if (screenPoints.length === 2) {
      ctx.lineTo(screenPoints[1].x, screenPoints[1].y);
      return;
    }

    for (let i = 1; i < screenPoints.length - 1; i++) {
      const curr = screenPoints[i];
      const next = screenPoints[i + 1];
      const midX = (curr.x + next.x) * 0.5;
      const midY = (curr.y + next.y) * 0.5;
      ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
    }

    const last = screenPoints[screenPoints.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  private drawCurvedVectorArrow(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    waypoints: ReadonlyArray<Point>,
    fillColor: string,
    lineWidth: number,
    progress: number,
  ): void {
    if (waypoints.length < 2) return;
    const screenPts = waypoints.map((wp) => camera.worldToScreen(wp.x, wp.y));
    const tip = screenPts[screenPts.length - 1];
    const prev = screenPts[screenPts.length - 2];

    const dx = tip.x - prev.x;
    const dy = tip.y - prev.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 2) return;
    const ux = dx / segLen;
    const uy = dy / segLen;

    const headLen = Math.min(14, Math.max(7, lineWidth * 3.4));
    const headWidth = headLen * 0.65;

    const trimmedPts = screenPts.slice();
    trimmedPts[trimmedPts.length - 1] = {
      x: tip.x - ux * (headLen * 0.68),
      y: tip.y - uy * (headLen * 0.68),
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    this.traceSmoothSpline(ctx, trimmedPts);
    ctx.strokeStyle = 'rgba(13, 18, 24, 0.86)';
    ctx.lineWidth = lineWidth + 2.6;
    ctx.stroke();

    this.traceSmoothSpline(ctx, trimmedPts);
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    const progressPts = slicePolylineByProgress(trimmedPts, progress);
    if (progressPts.length >= 2) {
      this.traceSmoothSpline(ctx, progressPts);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = fillColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

    const px = -uy;
    const py = ux;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ux * headLen + px * headWidth, tip.y - uy * headLen + py * headWidth);
    ctx.lineTo(tip.x - ux * headLen - px * headWidth, tip.y - uy * headLen - py * headWidth);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(13, 18, 24, 0.9)';
    ctx.stroke();

    ctx.restore();
  }

  private drawArrowBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string,
  ): void {
    ctx.save();
    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(17, 22, 28, 0.86)';
    ctx.strokeStyle = '#4e677c';
    ctx.lineWidth = 1;
    ctx.fillRect(x - w / 2, y - 8, w, 16);
    ctx.strokeRect(x - w / 2, y - 8, w, 16);
    ctx.fillStyle = '#e4dfd2';
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  private getBuildingCategoryColors(
    type: BuildingType,
  ): { readonly fill: string; readonly border: string } {
    switch (type) {
      case 'CITY':
        return { fill: '#1a2736', border: '#dfd9ca' };
      case 'LAB':
        return { fill: '#1a2338', border: '#75a6dd' };
      case 'MINE':
        return { fill: '#282015', border: '#d89b4a' };
      case 'POWER_PLANT':
        return { fill: '#16272e', border: '#5fb9d4' };
      case 'FACTORY':
        return { fill: '#2c1e16', border: '#d6824d' };
      case 'BARRACKS':
        return { fill: '#172734', border: '#6ea8d6' };
      case 'ARMORY':
        return { fill: '#30191d', border: '#cf6b65' };
      case 'PORT':
        return { fill: '#142934', border: '#5caecc' };
      case 'AIRFIELD':
        return { fill: '#1e2730', border: '#9ebad0' };
      case 'RADAR_STATION':
        return { fill: '#132a2c', border: '#6edcd0' };
      case 'TRENCH':
        return { fill: '#242a1c', border: '#a3b36d' };
      case 'BUNKER':
        return { fill: '#26292e', border: '#bcc5ce' };
      case 'AA_BATTERY':
        return { fill: '#1a2a2d', border: '#74bfb4' };
    }
  }

  private traceBuildingBadgeShape(
    ctx: CanvasRenderingContext2D,
    type: BuildingType,
    cx: number,
    cy: number,
    r: number,
  ): void {
    ctx.beginPath();
    switch (type) {
      case 'CITY':
      case 'LAB': {
        // Crisp architectural square badge
        const hs = r * 0.92;
        const rad = Math.max(2, r * 0.25);
        ctx.moveTo(cx - hs + rad, cy - hs);
        ctx.lineTo(cx + hs - rad, cy - hs);
        ctx.quadraticCurveTo(cx + hs, cy - hs, cx + hs, cy - hs + rad);
        ctx.lineTo(cx + hs, cy + hs - rad);
        ctx.quadraticCurveTo(cx + hs, cy + hs, cx + hs - rad, cy + hs);
        ctx.lineTo(cx - hs + rad, cy + hs);
        ctx.quadraticCurveTo(cx - hs, cy + hs, cx - hs, cy + hs - rad);
        ctx.lineTo(cx - hs, cy - hs + rad);
        ctx.quadraticCurveTo(cx - hs, cy - hs, cx - hs + rad, cy - hs);
        ctx.closePath();
        break;
      }
      case 'MINE':
      case 'POWER_PLANT':
      case 'FACTORY': {
        // 6-sided industrial hexagon
        for (let i = 0; i < 6; i++) {
          const ang = -Math.PI / 2 + (i * Math.PI) / 3;
          const px = cx + Math.cos(ang) * (r * 1.04);
          const py = cy + Math.sin(ang) * (r * 1.04);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;
      }
      case 'BARRACKS':
      case 'ARMORY':
      case 'PORT':
      case 'AIRFIELD':
      case 'RADAR_STATION': {
        // Heraldic military shield
        ctx.moveTo(cx - r * 0.94, cy - r * 0.88);
        ctx.lineTo(cx + r * 0.94, cy - r * 0.88);
        ctx.lineTo(cx + r * 0.94, cy + r * 0.14);
        ctx.quadraticCurveTo(cx + r * 0.82, cy + r * 0.84, cx, cy + r * 1.08);
        ctx.quadraticCurveTo(cx - r * 0.82, cy + r * 0.84, cx - r * 0.94, cy + r * 0.14);
        ctx.closePath();
        break;
      }
      case 'TRENCH': {
        // Wide octagonal defensive redoubt
        const rx = r * 1.08;
        const ry = r * 0.86;
        ctx.moveTo(cx - rx * 0.55, cy - ry);
        ctx.lineTo(cx + rx * 0.55, cy - ry);
        ctx.lineTo(cx + rx, cy - ry * 0.35);
        ctx.lineTo(cx + rx, cy + ry * 0.45);
        ctx.lineTo(cx + rx * 0.55, cy + ry);
        ctx.lineTo(cx - rx * 0.55, cy + ry);
        ctx.lineTo(cx - rx, cy + ry * 0.45);
        ctx.lineTo(cx - rx, cy - ry * 0.35);
        ctx.closePath();
        break;
      }
      case 'BUNKER': {
        // Heavy armored diamond bastion
        ctx.moveTo(cx, cy - r * 1.12);
        ctx.lineTo(cx + r * 1.08, cy);
        ctx.lineTo(cx, cy + r * 1.12);
        ctx.lineTo(cx - r * 1.08, cy);
        ctx.closePath();
        break;
      }
      case 'AA_BATTERY': {
        // Upward air-defense triangle
        ctx.moveTo(cx, cy - r * 1.12);
        ctx.lineTo(cx + r * 1.08, cy + r * 0.88);
        ctx.lineTo(cx - r * 1.08, cy + r * 0.88);
        ctx.closePath();
        break;
      }
    }
  }

  private drawBuildings(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    buildings: ReadonlyArray<PublicBuildingInfo>,
    selectedBuildingId: number | null,
    hoveredBuildingId: number | null,
    humanPlayerId: number,
    players: ReadonlyArray<PublicPlayerInfo>,
  ): void {
    const r = Math.max(5.5, Math.min(9.5, camera.zoom * 2.2));
    const playerById = new Map<number, PublicPlayerInfo>();
    for (const p of players) {
      playerById.set(p.id, p);
    }

    for (const b of buildings) {
      const sc = camera.worldToScreen(b.x + 0.5, b.y + 0.5);
      const isOwn = b.ownerId === humanPlayerId;
      const ownerPlayer = !isOwn ? playerById.get(b.ownerId) : undefined;
      const isSelected = isOwn && selectedBuildingId === b.id;
      const isHovered = isOwn && hoveredBuildingId === b.id;
      const isBuildingInitial = b.stackCount === 0 && b.underConstructionCount > 0;
      const colors = this.getBuildingCategoryColors(b.type);

      ctx.save();

      const defRadius =
        b.type === 'RADAR_STATION'
          ? RADAR_STATION_VISION_RADIUS
          : b.type === 'AIRFIELD'
            ? AIRFIELD_OPERATION_RANGE
            : getDefenseRadius(b.type);
      if (
        isOwn &&
        isDefenseBuildingType(b.type) &&
        b.stackCount > 0 &&
        (camera.zoom >= 0.85 || isSelected)
      ) {
        const ringColor =
          b.type === 'TRENCH'
            ? isSelected
              ? 'rgba(205, 190, 134, 0.58)'
              : 'rgba(205, 190, 134, 0.24)'
            : b.type === 'BUNKER'
              ? isSelected
                ? 'rgba(218, 152, 98, 0.65)'
                : 'rgba(218, 152, 98, 0.28)'
              : isSelected
                ? 'rgba(118, 194, 232, 0.65)'
                : 'rgba(118, 194, 232, 0.26)';
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, defRadius * camera.zoom, 0, Math.PI * 2);
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = isSelected ? 1.4 : 1.0;
        ctx.strokeStyle = ringColor;
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (
        isOwn &&
        ((b.type === 'AIRFIELD' && (isSelected || isHovered)) ||
          (isSelected && (b.type === 'BARRACKS' || b.type === 'RADAR_STATION'))) &&
        defRadius > 0
      ) {
        const rangePx = defRadius * camera.zoom;
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, rangePx, 0, Math.PI * 2);
        if (b.type === 'AIRFIELD') {
          ctx.fillStyle = 'rgba(92, 198, 240, 0.05)';
          ctx.fill();
        }
        ctx.setLineDash(b.type === 'AIRFIELD' ? [7, 5] : [5, 4]);
        ctx.lineWidth = b.type === 'AIRFIELD' ? 1.5 : 1.25;
        ctx.strokeStyle =
          b.type === 'AIRFIELD'
            ? 'rgba(92, 198, 240, 0.72)'
            : b.type === 'RADAR_STATION'
              ? 'rgba(110, 220, 208, 0.62)'
              : 'rgba(130, 198, 150, 0.65)';
        ctx.stroke();
        ctx.setLineDash([]);

        if (b.type === 'AIRFIELD' || b.type === 'RADAR_STATION') {
          const badge =
            b.type === 'AIRFIELD'
              ? `Dolet letiště · ${defRadius} b.`
              : `Radar · ${defRadius} b.`;
          ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = b.type === 'AIRFIELD' ? 'rgba(154, 228, 250, 0.92)' : 'rgba(148, 232, 220, 0.88)';
          ctx.fillText(badge, sc.x, sc.y - rangePx - 4);
        }
      }

      if (isSelected) {
        this.traceBuildingBadgeShape(ctx, b.type, sc.x, sc.y, r + 3.2);
        ctx.strokeStyle = '#f0dca0';
        ctx.lineWidth = 1.7;
        ctx.stroke();
      }

      ctx.globalAlpha = isBuildingInitial ? 0.68 : 1;
      // Subtle military map marker drop shadow
      this.traceBuildingBadgeShape(ctx, b.type, sc.x + 1.1, sc.y + 1.5, r);
      ctx.fillStyle = 'rgba(8, 11, 15, 0.58)';
      ctx.fill();

      this.traceBuildingBadgeShape(ctx, b.type, sc.x, sc.y, r);
      ctx.fillStyle = isOwn ? colors.fill : '#2b191d';
      ctx.fill();
      ctx.lineWidth = isOwn && b.effectiveOccupancyPct > 105 ? 1.85 : 1.45;
      ctx.strokeStyle =
        isSelected
          ? '#f0dca0'
          : !isOwn
            ? ownerPlayer?.relationToHuman === 'WAR'
              ? '#e26a62'
              : (ownerPlayer?.colorHex ?? '#c97f78')
            : isBuildingInitial
              ? '#70a8bf'
              : b.effectiveOccupancyPct > 105
                ? '#e6a550'
                : colors.border;
      ctx.stroke();

      this.drawBuildingGlyph(ctx, b.type, sc.x, sc.y, r * 0.64);
      ctx.globalAlpha = 1;

      if (b.underConstructionCount > 0) {
        const progress =
          1 - b.constructionTicksRemaining / Math.max(1, b.constructionTicksTotal);
        ctx.beginPath();
        ctx.arc(
          sc.x,
          sc.y,
          r + 2.0,
          -Math.PI / 2,
          -Math.PI / 2 + Math.max(0.05, Math.min(1, progress)) * Math.PI * 2,
        );
        ctx.lineWidth = 2.0;
        ctx.strokeStyle = '#7bd3e8';
        ctx.stroke();
      }

      if (b.stackCount > 1 || b.underConstructionCount > 0) {
        const stackBadge =
          b.stackCount === 0
            ? `+${b.underConstructionCount}`
            : b.underConstructionCount > 0
              ? `×${b.stackCount}+${b.underConstructionCount}`
              : `×${b.stackCount}`;
        ctx.font = '700 8.5px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const bw = ctx.measureText(stackBadge).width + 6;
        const bx = sc.x + r * 0.72;
        const by = sc.y - r * 0.76;
        ctx.fillStyle = b.underConstructionCount > 0 ? '#1d3947' : '#252d36';
        ctx.strokeStyle = b.underConstructionCount > 0 ? '#6fc4da' : '#9eb2c4';
        ctx.lineWidth = 0.9;
        ctx.fillRect(bx - bw / 2, by - 5.5, bw, 11);
        ctx.strokeRect(bx - bw / 2, by - 5.5, bw, 11);
        ctx.fillStyle = '#edf3f7';
        ctx.fillText(stackBadge, bx, by + 0.4);
      }

      const spec = BUILDING_SPECS[b.type];
      if (!b.isCapital && (camera.zoom >= 1.75 || isSelected)) {
        const label =
          spec.resourceZoneType !== null && b.revealedEfficiencyPct !== null
            ? `${spec.shortCode} ${b.revealedEfficiencyPct}%`
            : b.stackCount === 0
              ? `${spec.shortCode} (stav.)`
              : spec.shortCode;
        ctx.font = '600 9.5px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const w = ctx.measureText(label).width + 6;
        const labelY = sc.y + r + 2.5;
        ctx.fillStyle = 'rgba(16, 20, 26, 0.86)';
        ctx.fillRect(sc.x - w / 2, labelY, w, 13);
        ctx.fillStyle =
          b.revealedEfficiencyPct !== null && b.revealedEfficiencyPct < 50
            ? '#dfaa7d'
            : '#d8e3ec';
        ctx.fillText(label, sc.x, labelY + 1.5);
      }

      ctx.restore();
    }
  }

  private drawBuildingGlyph(
    ctx: CanvasRenderingContext2D,
    type: BuildingType,
    cx: number,
    cy: number,
    s: number,
  ): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.15, s * 0.24);

    switch (type) {
      case 'CITY':
        // Canonical skyline silhouette with center tower & crown
        ctx.fillStyle = '#e7dfd1';
        ctx.fillRect(cx - s * 0.72, cy - s * 0.08, s * 0.36, s * 0.72);
        ctx.fillRect(cx - s * 0.24, cy - s * 0.66, s * 0.48, s * 1.3);
        ctx.fillRect(cx + s * 0.36, cy + s * 0.06, s * 0.36, s * 0.58);
        ctx.fillRect(cx - s * 0.08, cy - s * 0.84, s * 0.16, s * 0.2);
        break;
      case 'MINE':
        // Crisp pickaxe + ore mound
        ctx.strokeStyle = '#e2ac5c';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.64, cy - s * 0.32);
        ctx.quadraticCurveTo(cx, cy - s * 0.68, cx + s * 0.64, cy - s * 0.32);
        ctx.moveTo(cx, cy - s * 0.48);
        ctx.lineTo(cx, cy + s * 0.72);
        ctx.stroke();
        break;
      case 'POWER_PLANT':
        // High-contrast lightning bolt
        ctx.fillStyle = '#75cce0';
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.18, cy - s * 0.8);
        ctx.lineTo(cx - s * 0.52, cy + s * 0.06);
        ctx.lineTo(cx + s * 0.02, cy + s * 0.06);
        ctx.lineTo(cx - s * 0.2, cy + s * 0.8);
        ctx.lineTo(cx + s * 0.52, cy - s * 0.06);
        ctx.lineTo(cx - s * 0.02, cy - s * 0.06);
        ctx.closePath();
        ctx.fill();
        break;
      case 'FACTORY':
        // Sawtooth industrial roof & twin smokestacks
        ctx.fillStyle = '#efa16b';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.76, cy + s * 0.64);
        ctx.lineTo(cx - s * 0.76, cy - s * 0.24);
        ctx.lineTo(cx - s * 0.18, cy + s * 0.14);
        ctx.lineTo(cx - s * 0.18, cy - s * 0.24);
        ctx.lineTo(cx + s * 0.38, cy + s * 0.14);
        ctx.lineTo(cx + s * 0.38, cy - s * 0.58);
        ctx.lineTo(cx + s * 0.74, cy - s * 0.58);
        ctx.lineTo(cx + s * 0.74, cy + s * 0.64);
        ctx.closePath();
        ctx.fill();
        break;
      case 'ARMORY':
        // Crossed heavy ordnance barrels + central hub
        ctx.strokeStyle = '#f28c85';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.6, cy + s * 0.54);
        ctx.lineTo(cx + s * 0.6, cy - s * 0.54);
        ctx.moveTo(cx - s * 0.6, cy - s * 0.54);
        ctx.lineTo(cx + s * 0.6, cy + s * 0.54);
        ctx.stroke();
        ctx.fillStyle = '#f7c5be';
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1.7, s * 0.28), 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'LAB':
        // Clean Erlenmeyer research flask
        ctx.strokeStyle = '#8ec0eb';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.26, cy - s * 0.72);
        ctx.lineTo(cx + s * 0.26, cy - s * 0.72);
        ctx.moveTo(cx - s * 0.18, cy - s * 0.72);
        ctx.lineTo(cx - s * 0.18, cy - s * 0.22);
        ctx.lineTo(cx - s * 0.62, cy + s * 0.64);
        ctx.lineTo(cx + s * 0.62, cy + s * 0.64);
        ctx.lineTo(cx + s * 0.18, cy - s * 0.22);
        ctx.lineTo(cx + s * 0.18, cy - s * 0.72);
        ctx.stroke();
        break;
      case 'BARRACKS':
        // Crisp double military chevron (clearly distinct from badge border)
        ctx.strokeStyle = '#8ec79b';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.62, cy + s * 0.14);
        ctx.lineTo(cx, cy - s * 0.46);
        ctx.lineTo(cx + s * 0.62, cy + s * 0.14);
        ctx.moveTo(cx - s * 0.62, cy + s * 0.58);
        ctx.lineTo(cx, cy - s * 0.02);
        ctx.lineTo(cx + s * 0.62, cy + s * 0.58);
        ctx.stroke();
        break;
      case 'PORT':
        // Clean naval anchor silhouette
        ctx.strokeStyle = '#75b5de';
        ctx.beginPath();
        ctx.arc(cx, cy - s * 0.48, s * 0.22, 0, Math.PI * 2);
        ctx.moveTo(cx, cy - s * 0.26);
        ctx.lineTo(cx, cy + s * 0.68);
        ctx.moveTo(cx - s * 0.46, cy);
        ctx.lineTo(cx + s * 0.46, cy);
        ctx.moveTo(cx - s * 0.58, cy + s * 0.34);
        ctx.quadraticCurveTo(cx, cy + s * 0.92, cx + s * 0.58, cy + s * 0.34);
        ctx.stroke();
        break;
      case 'AIRFIELD':
        // Top-down swept-wing aircraft silhouette
        ctx.fillStyle = '#d3dce6';
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * 0.78);
        ctx.lineTo(cx + s * 0.16, cy - s * 0.22);
        ctx.lineTo(cx + s * 0.76, cy + s * 0.18);
        ctx.lineTo(cx + s * 0.76, cy + s * 0.34);
        ctx.lineTo(cx + s * 0.16, cy + s * 0.18);
        ctx.lineTo(cx + s * 0.14, cy + s * 0.56);
        ctx.lineTo(cx + s * 0.36, cy + s * 0.74);
        ctx.lineTo(cx - s * 0.36, cy + s * 0.74);
        ctx.lineTo(cx - s * 0.14, cy + s * 0.56);
        ctx.lineTo(cx - s * 0.16, cy + s * 0.18);
        ctx.lineTo(cx - s * 0.76, cy + s * 0.34);
        ctx.lineTo(cx - s * 0.76, cy + s * 0.18);
        ctx.lineTo(cx - s * 0.16, cy - s * 0.22);
        ctx.closePath();
        ctx.fill();
        break;
      case 'RADAR_STATION':
        // Radar dish + pulse arcs
        ctx.strokeStyle = '#6edcd0';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.44, cy + s * 0.68);
        ctx.lineTo(cx, cy + s * 0.18);
        ctx.lineTo(cx + s * 0.44, cy + s * 0.68);
        ctx.moveTo(cx - s * 0.42, cy + s * 0.68);
        ctx.lineTo(cx + s * 0.42, cy + s * 0.68);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx - s * 0.12, cy - s * 0.14, s * 0.5, -Math.PI * 0.68, Math.PI * 0.18);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + s * 0.18, cy - s * 0.28, s * 0.34, -Math.PI * 0.45, Math.PI * 0.15);
        ctx.stroke();
        break;
      case 'TRENCH':
        // Zig-zag earthwork parapet + sandbag baseline
        ctx.strokeStyle = '#d5c589';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.76, cy + s * 0.22);
        ctx.lineTo(cx - s * 0.36, cy - s * 0.38);
        ctx.lineTo(cx + s * 0.02, cy + s * 0.22);
        ctx.lineTo(cx + s * 0.4, cy - s * 0.38);
        ctx.lineTo(cx + s * 0.76, cy + s * 0.16);
        ctx.moveTo(cx - s * 0.68, cy + s * 0.58);
        ctx.lineTo(cx + s * 0.68, cy + s * 0.58);
        ctx.stroke();
        break;
      case 'BUNKER':
        // Concrete pillbox casemate + firing slit
        ctx.fillStyle = '#d99b6a';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.74, cy + s * 0.58);
        ctx.lineTo(cx - s * 0.52, cy - s * 0.44);
        ctx.lineTo(cx + s * 0.52, cy - s * 0.44);
        ctx.lineTo(cx + s * 0.74, cy + s * 0.58);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#151b22';
        ctx.lineWidth = Math.max(1.3, s * 0.26);
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.38, cy + s * 0.02);
        ctx.lineTo(cx + s * 0.38, cy + s * 0.02);
        ctx.stroke();
        break;
      case 'AA_BATTERY':
        // Twin elevated flak barrels + radar arc
        ctx.strokeStyle = '#89d2ee';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.56, cy + s * 0.62);
        ctx.lineTo(cx + s * 0.56, cy + s * 0.62);
        ctx.moveTo(cx - s * 0.14, cy + s * 0.62);
        ctx.lineTo(cx + s * 0.24, cy - s * 0.66);
        ctx.moveTo(cx + s * 0.18, cy + s * 0.62);
        ctx.lineTo(cx + s * 0.58, cy - s * 0.42);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx - s * 0.12, cy - s * 0.18, s * 0.52, Math.PI * 1.05, Math.PI * 1.72);
        ctx.stroke();
        break;
    }

    ctx.restore();
  }

  private drawBuildPlacementPreview(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    preview: BuildPlacementPreview,
  ): void {
    const sc = camera.worldToScreen(preview.x + 0.5, preview.y + 0.5);
    const r = Math.max(7, Math.min(11, camera.zoom * 2.4));
    const spacingR = MIN_BUILDING_SPACING * camera.zoom;
    const defenseR =
      (preview.buildingType === 'RADAR_STATION'
        ? RADAR_STATION_VISION_RADIUS
        : preview.buildingType === 'AIRFIELD'
          ? AIRFIELD_OPERATION_RANGE
          : getDefenseRadius(preview.buildingType)) * camera.zoom;

    ctx.save();

    if (defenseR > 0) {
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, defenseR, 0, Math.PI * 2);
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = preview.valid
        ? 'rgba(122, 206, 234, 0.46)'
        : 'rgba(216, 98, 90, 0.32)';
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (preview.stackTargetId === null) {
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, spacingR, 0, Math.PI * 2);
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = preview.valid
        ? 'rgba(105, 198, 134, 0.45)'
        : 'rgba(216, 98, 90, 0.45)';
      ctx.stroke();
      ctx.setLineDash([]);
    }

    this.traceBuildingBadgeShape(ctx, preview.buildingType, sc.x, sc.y, r);
    ctx.fillStyle = preview.valid
      ? 'rgba(42, 108, 66, 0.72)'
      : 'rgba(128, 44, 40, 0.72)';
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = preview.valid ? '#84e0a0' : '#ea8c84';
    ctx.stroke();

    this.drawBuildingGlyph(ctx, preview.buildingType, sc.x, sc.y, r * 0.64);

    const spec = BUILDING_SPECS[preview.buildingType];
    const batchTag = preview.plannedUnits > 1 ? ` +${preview.plannedUnits}×` : '';
    let statusText: string;
    if (!preview.valid && preview.reasonCs) {
      statusText = `${spec.nameCs} — ${preview.reasonCs}`;
    } else if (preview.stackTargetId !== null) {
      statusText = `Stack${batchTag} ${spec.nameCs} do uzlu`;
    } else if (preview.isFreePowerPlant) {
      statusText = preview.inMatchingZone
        ? `${spec.nameCs}${batchTag} (1. ZDARMA) · V zóně zdroje`
        : `${spec.nameCs}${batchTag} (1. ZDARMA) · Mimo zónu`;
    } else if (spec.resourceZoneType !== null) {
      statusText = preview.inMatchingZone
        ? `${spec.nameCs}${batchTag} · V zóně zdroje`
        : `${spec.nameCs}${batchTag} · Mimo zónu (nouzový režim)`;
    } else {
      statusText = `${spec.nameCs}${batchTag} · Kliknutím postavíte`;
    }

    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const boxW = ctx.measureText(statusText).width + 14;
    const boxY = sc.y - r - 18;
    ctx.fillStyle = 'rgba(16, 20, 26, 0.90)';
    ctx.strokeStyle = preview.valid ? '#589c6f' : '#a84e48';
    ctx.lineWidth = 1.1;
    ctx.fillRect(sc.x - boxW / 2, boxY - 9, boxW, 18);
    ctx.strokeRect(sc.x - boxW / 2, boxY - 9, boxW, 18);
    ctx.fillStyle = preview.valid ? '#caeeda' : '#f2c2be';
    ctx.fillText(statusText, sc.x, boxY + 0.5);

    ctx.restore();
  }

  private drawSelectedTarget(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    state: ClientRenderState,
    target: SelectedTarget,
  ): void {
    const anchorSc = camera.worldToScreen(target.anchorX + 0.5, target.anchorY + 0.5);
    const { stroke } = this.getTargetAccentColor(state, target);
    ctx.save();

    if (target.kind === 'WILDERNESS') {
      ctx.beginPath();
      ctx.moveTo(anchorSc.x - 8, anchorSc.y);
      ctx.lineTo(anchorSc.x + 8, anchorSc.y);
      ctx.moveTo(anchorSc.x, anchorSc.y - 8);
      ctx.lineTo(anchorSc.x, anchorSc.y + 8);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      this.drawArrowBadge(ctx, anchorSc.x, anchorSc.y - 18, 'CÍL: Volné území');
    } else {
      const player = state.players.find((p) => p.id === target.ownerId && p.alive);
      if (player) {
        const capSc = camera.worldToScreen(player.capitalX + 0.5, player.capitalY + 0.5);

        ctx.beginPath();
        ctx.moveTo(anchorSc.x - 6, anchorSc.y);
        ctx.lineTo(anchorSc.x + 6, anchorSc.y);
        ctx.moveTo(anchorSc.x, anchorSc.y - 6);
        ctx.lineTo(anchorSc.x, anchorSc.y + 6);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = stroke;
        ctx.stroke();

        const relTxt =
          player.relationToHuman === 'WAR'
            ? 'VÁLKA'
            : player.relationToHuman === 'ALLIED'
              ? 'SPOJENEC'
              : 'NEUTRÁLNÍ';
        this.drawArrowBadge(
          ctx,
          capSc.x,
          capSc.y - 18,
          `CÍL: ${player.name} [${relTxt}]`,
        );
      }
    }

    ctx.restore();
  }

  private drawCapitals(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    players: ReadonlyArray<PublicPlayerInfo>,
    humanPlayerId: number,
    humanBuildings: ReadonlyArray<PublicBuildingInfo>,
  ): void {
    const humanHasCapitalIcon = humanBuildings.some((b) => b.isCapital);

    for (const player of players) {
      if (!player.alive) continue;
      const sc = camera.worldToScreen(player.capitalX + 0.5, player.capitalY + 0.5);
      const r = Math.max(3.8, Math.min(6.5, camera.zoom * 1.4));
      const skipHumanDot = player.id === humanPlayerId && humanHasCapitalIcon;

      ctx.save();
      if (!skipHumanDot) {
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, r + 1.8, 0, Math.PI * 2);
        ctx.fillStyle =
          player.relationToHuman === 'WAR'
            ? '#a83c36'
            : player.relationToHuman === 'ALLIED'
              ? '#478b5e'
              : '#14191f';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
        ctx.fillStyle = player.colorHex;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(sc.x, sc.y, Math.max(1.6, r * 0.42), 0, Math.PI * 2);
        ctx.fillStyle = '#f0ece1';
        ctx.fill();
      }

      if (camera.zoom >= 0.95) {
        ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const suffix = player.betrayalDebuffTicks > 0 ? ' [ZRÁDCE]' : '';
        const label = `${player.name}${suffix}`;
        const w = ctx.measureText(label).width + 10;
        const labelOffset = skipHumanDot ? Math.max(8, camera.zoom * 2.2) + 4 : r + 4;
        const labelY = sc.y + labelOffset;
        ctx.fillStyle = 'rgba(16, 20, 26, 0.84)';
        ctx.fillRect(sc.x - w / 2, labelY, w, 15);
        ctx.strokeStyle =
          player.relationToHuman === 'WAR'
            ? 'rgba(195, 78, 72, 0.78)'
            : player.relationToHuman === 'ALLIED'
              ? 'rgba(84, 158, 108, 0.78)'
              : 'rgba(72, 86, 102, 0.55)';
        ctx.lineWidth = 0.9;
        ctx.strokeRect(sc.x - w / 2, labelY, w, 15);
        ctx.fillStyle = player.isBot ? '#d2cdc1' : '#9ed0ec';
        ctx.fillText(label, sc.x, labelY + 2);
      }
      ctx.restore();
    }
  }

  private drawStartHoverPreview(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    state: ClientRenderState,
    hoverCell: Point,
  ): void {
    const ix = Math.floor(hoverCell.x);
    const iy = Math.floor(hoverCell.y);
    if (ix < 0 || ix >= state.width || iy < 0 || iy >= state.height) return;
    const isWater = state.terrain[iy * state.width + ix] === TerrainType.WATER;
    const sc = camera.worldToScreen(ix + 0.5, iy + 0.5);

    ctx.save();
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, 14 * camera.zoom, 0, Math.PI * 2);
    if (isWater) {
      ctx.fillStyle = 'rgba(170, 75, 70, 0.16)';
      ctx.strokeStyle = 'rgba(200, 95, 90, 0.78)';
    } else {
      ctx.fillStyle = 'rgba(59, 110, 140, 0.25)';
      ctx.strokeStyle = 'rgba(145, 196, 224, 0.92)';
    }
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawArrowPreview(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    preview: ArrowPreview,
  ): void {
    if (preview.waypoints.length < 2) return;
    this.drawCurvedVectorArrow(ctx, camera, preview.waypoints, '#9bc6e2', 3.2, 1);
    const tip = preview.waypoints[preview.waypoints.length - 1];
    const tipSc = camera.worldToScreen(tip.x, tip.y);
    this.drawArrowBadge(
      ctx,
      tipSc.x,
      tipSc.y - 16,
      `${preview.manpowerPercent} % · ${Math.round(preview.committedManpower)} MP`,
    );
  }

  private drawAmbushCountdown(
    ctx: CanvasRenderingContext2D,
    ambush: AmbushOverlay,
  ): void {
    const cx = ambush.screenX + 28;
    const cy = ambush.screenY - 28;
    const radius = 18;
    const accent = ambush.isBetrayal ? '#e08e45' : '#d96256';
    const label = ambush.isBetrayal
      ? `ZRADA ALIANCE (${ambush.targetName}) za ${ambush.remainingSec.toFixed(1)} s — pusť pro zrušení`
      : `AMBUSH / VÁLKA (${ambush.targetName}) za ${ambush.remainingSec.toFixed(1)} s — pusť pro zrušení`;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18, 22, 28, 0.9)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(70, 78, 90, 0.65)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      radius,
      -Math.PI / 2,
      -Math.PI / 2 + Math.min(1, Math.max(0, ambush.progress)) * Math.PI * 2,
    );
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = accent;
    ctx.stroke();

    ctx.font = '700 10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f0ece1';
    ctx.fillText(`${ambush.remainingSec.toFixed(1)}s`, cx, cy + 0.5);

    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    const textW = ctx.measureText(label).width + 14;
    const boxX = cx + radius + 8;
    const boxY = cy - 12;
    ctx.fillStyle = 'rgba(20, 22, 26, 0.92)';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.2;
    ctx.fillRect(boxX, boxY, textW, 24);
    ctx.strokeRect(boxX, boxY, textW, 24);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#f2e8df';
    ctx.fillText(label, boxX + 7, cy + 0.5);
    ctx.restore();
  }

  private drawLassoStroke(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    points: ReadonlyArray<Point>,
  ): void {
    ctx.save();
    ctx.beginPath();
    const first = camera.worldToScreen(points[0].x, points[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i++) {
      const pt = camera.worldToScreen(points[i].x, points[i].y);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.strokeStyle = 'rgba(240, 220, 140, 0.92)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.restore();
  }

  private drawFrontPushPreview(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    preview: FrontPushPreview,
  ): void {
    this.drawCurvedVectorArrow(
      ctx,
      camera,
      [
        { x: preview.fromX, y: preview.fromY },
        { x: preview.toX, y: preview.toY },
      ],
      '#f0dca0',
      2.8,
      1,
    );
  }
}
