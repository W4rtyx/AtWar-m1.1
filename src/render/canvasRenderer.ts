import {
  ClientRenderState,
  MAP_HEIGHT,
  MAP_WIDTH,
  Point,
  PublicPlayerInfo,
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

export interface RenderOverlayState {
  readonly hoverCell: Point | null;
  readonly arrowPreview: ArrowPreview | null;
  readonly frontLassoPoints: ReadonlyArray<Point>;
  readonly selectedFrontierCells: ReadonlyArray<number>;
  readonly frontPushPreview: FrontPushPreview | null;
  readonly activeBendOrderId: number | null;
  readonly ambush: AmbushOverlay | null;
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

export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly offscreenCanvas: HTMLCanvasElement;
  private readonly offscreenCtx: CanvasRenderingContext2D;
  private readonly imageData: ImageData;
  private readonly baseTerrainRgb: Uint8ClampedArray;

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
          // Soft coastal tint on shoreline plains for smooth transitions
          let waterNeighbors = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              if (nx < 0 || nx >= width) continue;
              if (terrain[ny * width + nx] === TerrainType.WATER) {
                waterNeighbors++;
              }
            }
          }
          const coastTint = waterNeighbors * 2.2;
          buf[rgbIdx] = 198 - coastTint;
          buf[rgbIdx + 1] = 192 - coastTint * 0.9;
          buf[rgbIdx + 2] = 177 - coastTint * 0.6;
        }
      }
    }

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

        // Crisp 4-neighbor border detection without blurry halo
        let landBorder = false;
        let coastBorder = false;
        let nearBorder = false;

        if (x > 0) {
          const nOwner = owners[idx - 1];
          if (nOwner !== owner) {
            if (terrain[idx - 1] === TerrainType.WATER) coastBorder = true;
            else landBorder = true;
          } else if (x > 1 && owners[idx - 2] !== owner && terrain[idx - 2] !== TerrainType.WATER) {
            nearBorder = true;
          }
        }
        if (x < width - 1) {
          const nOwner = owners[idx + 1];
          if (nOwner !== owner) {
            if (terrain[idx + 1] === TerrainType.WATER) coastBorder = true;
            else landBorder = true;
          } else if (
            x < width - 2 &&
            owners[idx + 2] !== owner &&
            terrain[idx + 2] !== TerrainType.WATER
          ) {
            nearBorder = true;
          }
        }
        if (y > 0) {
          const nOwner = owners[idx - width];
          if (nOwner !== owner) {
            if (terrain[idx - width] === TerrainType.WATER) coastBorder = true;
            else landBorder = true;
          } else if (
            y > 1 &&
            owners[idx - width * 2] !== owner &&
            terrain[idx - width * 2] !== TerrainType.WATER
          ) {
            nearBorder = true;
          }
        }
        if (y < height - 1) {
          const nOwner = owners[idx + width];
          if (nOwner !== owner) {
            if (terrain[idx + width] === TerrainType.WATER) coastBorder = true;
            else landBorder = true;
          } else if (
            y < height - 2 &&
            owners[idx + width * 2] !== owner &&
            terrain[idx + width * 2] !== TerrainType.WATER
          ) {
            nearBorder = true;
          }
        }

        const isMountain = terrain[idx] === TerrainType.MOUNTAINS;
        const baseBlend = nearBorder || landBorder ? 0.76 : 0.56;
        const blend = isMountain ? baseBlend - 0.14 : baseBlend;

        let r = pColor[0] * blend + base[rgbIdx] * (1 - blend);
        let g = pColor[1] * blend + base[rgbIdx + 1] * (1 - blend);
        let b = pColor[2] * blend + base[rgbIdx + 2] * (1 - blend);

        if (landBorder) {
          r *= 0.4;
          g *= 0.4;
          b *= 0.4;
        } else if (coastBorder) {
          r *= 0.68;
          g *= 0.68;
          b *= 0.68;
        }

        data[rgbaIdx] = r;
        data[rgbaIdx + 1] = g;
        data[rgbaIdx + 2] = b;
        data[rgbaIdx + 3] = 255;
      }
    }

    this.offscreenCtx.putImageData(this.imageData, 0, 0);
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

    // Crisp, unblurred terrain & borders (720x500 direct blit)
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.offscreenCanvas,
      camera.offsetX,
      camera.offsetY,
      state.width * camera.zoom,
      state.height * camera.zoom,
    );
    ctx.restore();

    ctx.strokeStyle = '#33414f';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      camera.offsetX,
      camera.offsetY,
      state.width * camera.zoom,
      state.height * camera.zoom,
    );

    this.drawResourceZones(ctx, camera, state.publicResourceZones);
    this.drawFrontPushOrders(ctx, camera, state);
    this.drawSelectedFrontierCells(ctx, camera, state.width, overlays.selectedFrontierCells);
    this.drawAttackOrders(ctx, camera, state, overlays.activeBendOrderId);
    this.drawCapitals(ctx, camera, state.players);

    if (state.phase === 'SELECT_START' && overlays.hoverCell) {
      this.drawStartHoverPreview(ctx, camera, state, overlays.hoverCell);
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
    if (overlays.ambush) {
      this.drawAmbushCountdown(ctx, overlays.ambush);
    }

    ctx.restore();
  }

  private drawResourceZones(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    zones: ReadonlyArray<ResourceZonePublic>,
  ): void {
    for (const zone of zones) {
      const screen = camera.worldToScreen(zone.centerX + 0.5, zone.centerY + 0.5);
      const radiusPx = zone.radius * camera.zoom;
      const isMaterial = zone.type === 'CONSTRUCTION_MATERIAL';

      ctx.save();
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radiusPx, 0, Math.PI * 2);
      ctx.fillStyle = isMaterial
        ? 'rgba(202, 148, 70, 0.08)'
        : 'rgba(86, 160, 178, 0.08)';
      ctx.fill();

      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = isMaterial
        ? 'rgba(202, 148, 70, 0.72)'
        : 'rgba(94, 173, 191, 0.72)';
      ctx.stroke();

      if (camera.zoom >= 1.1) {
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

    // Static outer casing along exact waypoints
    this.traceSmoothSpline(ctx, trimmedPts);
    ctx.strokeStyle = 'rgba(13, 18, 24, 0.86)';
    ctx.lineWidth = lineWidth + 2.6;
    ctx.stroke();

    // Base route shaft (fixed thickness — never jitters)
    this.traceSmoothSpline(ctx, trimmedPts);
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Smooth advancing progress overlay along the stationary path
    const progressPts = slicePolylineByProgress(trimmedPts, progress);
    if (progressPts.length >= 2) {
      this.traceSmoothSpline(ctx, progressPts);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = fillColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

    // Stationary arrowhead
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

  private drawCapitals(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    players: ReadonlyArray<PublicPlayerInfo>,
  ): void {
    for (const player of players) {
      if (!player.alive) continue;
      const sc = camera.worldToScreen(player.capitalX + 0.5, player.capitalY + 0.5);
      const r = Math.max(3.8, Math.min(6.5, camera.zoom * 1.4));

      ctx.save();
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

      if (camera.zoom >= 0.95) {
        ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const suffix = player.betrayalDebuffTicks > 0 ? ' [ZRÁDCE]' : '';
        const label = `${player.name}${suffix}`;
        const w = ctx.measureText(label).width + 10;
        const labelY = sc.y + r + 4;
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

    // Warning banner right beside the countdown ring
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
