import { BUILDING_SPECS } from '../engine/buildings';
import {
  BARRACKS_DEFENSE_RADIUS,
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
import { Camera } from './camera';

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
  readonly selectedTarget: SelectedTarget | null;
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

  private coastlinePath: Path2D | null = null;
  private stateBorderPath: Path2D = new Path2D();

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
          const shelfRatio = Math.min(1, d / 18);
          let r = 45 - shelfRatio * 22;
          let g = 67 - shelfRatio * 31;
          let b = 86 - shelfRatio * 39;
          if (d === 5 || d === 11) {
            r += 3;
            g += 4;
            b += 5;
          }
          buf[rgbIdx] = r;
          buf[rgbIdx + 1] = g;
          buf[rgbIdx + 2] = b;
        } else if (t === TerrainType.MOUNTAINS) {
          const depth = mtnDepth[idx];
          const nwIdx = Math.max(0, y - 1) * width + Math.max(0, x - 1);
          const seIdx = Math.min(height - 1, y + 1) * width + Math.min(width - 1, x + 1);
          const slope = mtnDepth[seIdx] - mtnDepth[nwIdx];
          const elevLift = Math.min(18, depth * 1.4);
          const contour = depth > 1 && depth % 4 === 0 ? -5 : 0;
          const shade = slope * 6.5;

          buf[rgbIdx] = Math.max(68, Math.min(176, 130 + elevLift - shade + contour));
          buf[rgbIdx + 1] = Math.max(62, Math.min(166, 120 + elevLift - shade + contour));
          buf[rgbIdx + 2] = Math.max(54, Math.min(152, 105 + elevLift - shade + contour));
        } else {
          buf[rgbIdx] = 198;
          buf[rgbIdx + 1] = 192;
          buf[rgbIdx + 2] = 177;
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
        const baseBlend = nearBorder ? 0.72 : 0.56;
        const blend = isMountain ? baseBlend - 0.14 : baseBlend;

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

  public render(
    state: ClientRenderState,
    camera: Camera,
    overlays: RenderOverlayState,
  ): void {
    if (state.stateVersion !== this.lastStateVersion) {
      this.updateMapImageData(state);
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    ctx.fillStyle = '#151e27';
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
      ctx.strokeStyle = 'rgba(18, 28, 38, 0.85)';
      ctx.lineWidth = Math.max(0.55, 1.05 / camera.zoom);
      ctx.stroke(this.coastlinePath);
    }

    ctx.strokeStyle = 'rgba(16, 20, 26, 0.90)';
    ctx.lineWidth = Math.max(0.7, 1.55 / camera.zoom);
    ctx.stroke(this.stateBorderPath);
    ctx.restore();

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
    this.drawFrontPushOrders(ctx, camera, state);
    this.drawSelectedFrontierCells(ctx, camera, state.width, overlays.selectedFrontierCells);
    this.drawAttackOrders(ctx, camera, state, overlays.activeBendOrderId);
    this.drawBuildings(ctx, camera, state.buildings, overlays.selectedBuildingId);
    this.drawCapitals(ctx, camera, state.players, state.humanPlayerId, state.buildings);

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
      const isMaterial = zone.type === 'CONSTRUCTION_MATERIAL';
      const isHighlighted = highlightType !== null && zone.type === highlightType;

      ctx.save();
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radiusPx, 0, Math.PI * 2);
      ctx.fillStyle = isMaterial
        ? isHighlighted
          ? 'rgba(202, 148, 70, 0.22)'
          : 'rgba(202, 148, 70, 0.08)'
        : isHighlighted
          ? 'rgba(86, 160, 178, 0.22)'
          : 'rgba(86, 160, 178, 0.08)';
      ctx.fill();

      ctx.setLineDash([5, 4]);
      ctx.lineWidth = isHighlighted ? 2.0 : 1.25;
      ctx.strokeStyle = isMaterial
        ? isHighlighted
          ? 'rgba(230, 176, 90, 0.95)'
          : 'rgba(202, 148, 70, 0.72)'
        : isHighlighted
          ? 'rgba(118, 200, 220, 0.95)'
          : 'rgba(94, 173, 191, 0.72)';
      ctx.stroke();

      if (camera.zoom >= 1.1 || isHighlighted) {
        ctx.setLineDash([]);
        ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = isMaterial ? 'STAV. MAT.' : 'ENERGIE';
        ctx.fillStyle = 'rgba(18, 22, 28, 0.76)';
        const textW = ctx.measureText(label).width + 8;
        ctx.fillRect(screen.x - textW / 2, screen.y - 7, textW, 14);
        ctx.fillStyle = isMaterial ? '#e2b26a' : '#80c6d6';
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

  private drawBuildings(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    buildings: ReadonlyArray<PublicBuildingInfo>,
    selectedBuildingId: number | null,
  ): void {
    const r = Math.max(5.5, Math.min(9.5, camera.zoom * 2.2));
    for (const b of buildings) {
      const sc = camera.worldToScreen(b.x + 0.5, b.y + 0.5);
      const isSelected = selectedBuildingId === b.id;
      const isBuildingInitial = b.stackCount === 0 && b.underConstructionCount > 0;

      ctx.save();

      if (isSelected && b.type === 'BARRACKS') {
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, BARRACKS_DEFENSE_RADIUS * camera.zoom, 0, Math.PI * 2);
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = 'rgba(130, 198, 150, 0.65)';
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, r + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#f0dca0';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      ctx.globalAlpha = isBuildingInitial ? 0.68 : 1;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(19, 24, 31, 0.92)';
      ctx.fill();
      ctx.lineWidth = b.effectiveOccupancyPct > 105 ? 1.7 : 1.2;
      ctx.strokeStyle =
        isSelected
          ? '#f0dca0'
          : isBuildingInitial
            ? '#70a8bf'
            : b.effectiveOccupancyPct > 105
              ? '#d99a4a'
              : '#8ba4b8';
      ctx.stroke();

      this.drawBuildingGlyph(ctx, b.type, sc.x, sc.y, r * 0.66);
      ctx.globalAlpha = 1;

      if (b.underConstructionCount > 0) {
        const progress =
          1 - b.constructionTicksRemaining / Math.max(1, b.constructionTicksTotal);
        ctx.beginPath();
        ctx.arc(
          sc.x,
          sc.y,
          r + 1.8,
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
        const bx = sc.x + r * 0.68;
        const by = sc.y - r * 0.72;
        ctx.fillStyle = b.underConstructionCount > 0 ? '#1d3947' : '#252d36';
        ctx.strokeStyle = b.underConstructionCount > 0 ? '#6fc4da' : '#9eb2c4';
        ctx.lineWidth = 0.9;
        ctx.fillRect(bx - bw / 2, by - 5.5, bw, 11);
        ctx.strokeRect(bx - bw / 2, by - 5.5, bw, 11);
        ctx.fillStyle = '#edf3f7';
        ctx.fillText(stackBadge, bx, by + 0.4);
      }

      const spec = BUILDING_SPECS[b.type];
      if (!b.isCapital && (camera.zoom >= 1.35 || isSelected)) {
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
        const labelY = sc.y + r + 2;
        ctx.fillStyle = 'rgba(16, 20, 26, 0.84)';
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
    ctx.lineWidth = Math.max(1.1, s * 0.28);

    switch (type) {
      case 'CITY':
        ctx.fillStyle = '#e7dfd1';
        ctx.fillRect(cx - s * 0.72, cy - s * 0.1, s * 0.38, s * 0.72);
        ctx.fillRect(cx - s * 0.22, cy - s * 0.68, s * 0.44, s * 1.3);
        ctx.fillRect(cx + s * 0.34, cy + s * 0.06, s * 0.38, s * 0.56);
        break;
      case 'MINE':
        ctx.strokeStyle = '#e2ac5c';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.65, cy - s * 0.45);
        ctx.lineTo(cx + s * 0.65, cy - s * 0.45);
        ctx.moveTo(cx, cy - s * 0.45);
        ctx.lineTo(cx, cy + s * 0.7);
        ctx.stroke();
        break;
      case 'POWER_PLANT':
        ctx.fillStyle = '#75cce0';
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.16, cy - s * 0.78);
        ctx.lineTo(cx - s * 0.48, cy + s * 0.08);
        ctx.lineTo(cx + s * 0.05, cy + s * 0.08);
        ctx.lineTo(cx - s * 0.18, cy + s * 0.78);
        ctx.lineTo(cx + s * 0.48, cy - s * 0.08);
        ctx.lineTo(cx - s * 0.04, cy - s * 0.08);
        ctx.closePath();
        ctx.fill();
        break;
      case 'FACTORY':
        ctx.fillStyle = '#cfa07a';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.75, cy + s * 0.62);
        ctx.lineTo(cx - s * 0.75, cy - s * 0.25);
        ctx.lineTo(cx - s * 0.15, cy + s * 0.15);
        ctx.lineTo(cx - s * 0.15, cy - s * 0.25);
        ctx.lineTo(cx + s * 0.45, cy + s * 0.15);
        ctx.lineTo(cx + s * 0.45, cy - s * 0.55);
        ctx.lineTo(cx + s * 0.75, cy - s * 0.55);
        ctx.lineTo(cx + s * 0.75, cy + s * 0.62);
        ctx.closePath();
        ctx.fill();
        break;
      case 'LAB':
        ctx.strokeStyle = '#8ec0eb';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.24, cy - s * 0.7);
        ctx.lineTo(cx + s * 0.24, cy - s * 0.7);
        ctx.moveTo(cx - s * 0.18, cy - s * 0.7);
        ctx.lineTo(cx - s * 0.6, cy + s * 0.62);
        ctx.lineTo(cx + s * 0.6, cy + s * 0.62);
        ctx.lineTo(cx + s * 0.18, cy - s * 0.7);
        ctx.stroke();
        break;
      case 'BARRACKS':
        ctx.strokeStyle = '#8ec79b';
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * 0.72);
        ctx.lineTo(cx + s * 0.6, cy - s * 0.35);
        ctx.lineTo(cx + s * 0.45, cy + s * 0.32);
        ctx.lineTo(cx, cy + s * 0.75);
        ctx.lineTo(cx - s * 0.45, cy + s * 0.32);
        ctx.lineTo(cx - s * 0.6, cy - s * 0.35);
        ctx.closePath();
        ctx.stroke();
        break;
      case 'PORT':
        ctx.strokeStyle = '#75b5de';
        ctx.beginPath();
        ctx.arc(cx, cy - s * 0.46, s * 0.22, 0, Math.PI * 2);
        ctx.moveTo(cx, cy - s * 0.24);
        ctx.lineTo(cx, cy + s * 0.68);
        ctx.moveTo(cx - s * 0.45, cy);
        ctx.lineTo(cx + s * 0.45, cy);
        ctx.moveTo(cx - s * 0.58, cy + s * 0.35);
        ctx.quadraticCurveTo(cx, cy + s * 0.9, cx + s * 0.58, cy + s * 0.35);
        ctx.stroke();
        break;
      case 'AIRFIELD':
        ctx.strokeStyle = '#d3dce6';
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * 0.74);
        ctx.lineTo(cx, cy + s * 0.72);
        ctx.moveTo(cx - s * 0.72, cy + s * 0.12);
        ctx.lineTo(cx, cy - s * 0.25);
        ctx.lineTo(cx + s * 0.72, cy + s * 0.12);
        ctx.moveTo(cx - s * 0.32, cy + s * 0.65);
        ctx.lineTo(cx + s * 0.32, cy + s * 0.65);
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

    ctx.save();

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

    ctx.beginPath();
    ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
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
    ctx.save();

    if (target.kind === 'WILDERNESS') {
      const rPx = 22 * camera.zoom;
      ctx.beginPath();
      ctx.arc(anchorSc.x, anchorSc.y, rPx, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(235, 198, 108, 0.08)';
      ctx.fill();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = 'rgba(235, 198, 108, 0.88)';
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(anchorSc.x - 8, anchorSc.y);
      ctx.lineTo(anchorSc.x + 8, anchorSc.y);
      ctx.moveTo(anchorSc.x, anchorSc.y - 8);
      ctx.lineTo(anchorSc.x, anchorSc.y + 8);
      ctx.strokeStyle = '#f0d88b';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      this.drawArrowBadge(ctx, anchorSc.x, anchorSc.y - rPx - 12, 'CÍL: Volné území');
    } else {
      const player = state.players.find((p) => p.id === target.ownerId && p.alive);
      if (player) {
        const capSc = camera.worldToScreen(player.capitalX + 0.5, player.capitalY + 0.5);
        const capR = Math.max(10, 6 * camera.zoom);
        const accent =
          player.relationToHuman === 'WAR'
            ? '#e26a62'
            : player.relationToHuman === 'ALLIED'
              ? '#6ac288'
              : '#ebd082';

        ctx.beginPath();
        ctx.arc(capSc.x, capSc.y, capR, 0, Math.PI * 2);
        ctx.setLineDash([5, 3]);
        ctx.lineWidth = 2.0;
        ctx.strokeStyle = accent;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(anchorSc.x, anchorSc.y, Math.max(8, 10 * camera.zoom), 0, Math.PI * 2);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = accent;
        ctx.stroke();
        ctx.setLineDash([]);

        const relTxt =
          player.relationToHuman === 'WAR'
            ? 'VÁLKA'
            : player.relationToHuman === 'ALLIED'
              ? 'SPOJENEC'
              : 'NEUTRÁLNÍ';
        this.drawArrowBadge(
          ctx,
          anchorSc.x,
          anchorSc.y - Math.max(18, 12 * camera.zoom),
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
