import {
  ClientRenderState,
  MAP_HEIGHT,
  MAP_WIDTH,
  Point2D,
  PublicPlayerInfo,
  ResourceZonePublic,
  TerrainType,
} from '../engine/types';
import { Camera } from './camera';

export interface ArrowPreview {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly committedManpower: number;
  readonly manpowerPercent: number;
}

export interface FrontPushPreview {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

export interface RenderOverlayState {
  readonly hoverCell: Point2D | null;
  readonly arrowPreview: ArrowPreview | null;
  readonly frontLassoPoints: ReadonlyArray<Point2D>;
  readonly selectedFrontierCells: ReadonlyArray<number>;
  readonly frontPushPreview: FrontPushPreview | null;
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

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const t = terrain[idx];
        const rgbIdx = idx * 3;
        const grain = ((x * 73856093) ^ (y * 19349663)) & 7;
        const noise = grain - 3.5;

        if (t === TerrainType.WATER) {
          // Check if adjacent to land for subtle coastal shallow band
          let nearCoast = false;
          for (let dy = -2; dy <= 2 && !nearCoast; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= width) continue;
              if (terrain[ny * width + nx] !== TerrainType.WATER) {
                nearCoast = true;
                break;
              }
            }
          }
          if (nearCoast) {
            buf[rgbIdx] = 36 + noise * 0.4;
            buf[rgbIdx + 1] = 51 + noise * 0.4;
            buf[rgbIdx + 2] = 66 + noise * 0.4;
          } else {
            buf[rgbIdx] = 28 + noise * 0.4;
            buf[rgbIdx + 1] = 40 + noise * 0.4;
            buf[rgbIdx + 2] = 53 + noise * 0.4;
          }
        } else if (t === TerrainType.MOUNTAINS) {
          // Relief shading based on NW neighbor elevation
          const nwIdx = Math.max(0, y - 1) * width + Math.max(0, x - 1);
          const seIdx = Math.min(height - 1, y + 1) * width + Math.min(width - 1, x + 1);
          const nwIsMtn = terrain[nwIdx] === TerrainType.MOUNTAINS ? 1 : 0;
          const seIsMtn = terrain[seIdx] === TerrainType.MOUNTAINS ? 1 : 0;
          const shade = (seIsMtn - nwIsMtn) * 14;
          buf[rgbIdx] = Math.max(60, Math.min(165, 118 - shade + noise * 1.1));
          buf[rgbIdx + 1] = Math.max(55, Math.min(155, 108 - shade + noise * 1.0));
          buf[rgbIdx + 2] = Math.max(48, Math.min(142, 95 - shade + noise * 0.9));
        } else {
          // Wilderness plains: muted warm sandstone-gray
          buf[rgbIdx] = 196 + noise * 0.8;
          buf[rgbIdx + 1] = 190 + noise * 0.8;
          buf[rgbIdx + 2] = 174 + noise * 0.7;
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

        if (owner === 0) {
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

        // Preserve mountain relief shading inside owned territories
        const isMountain = terrain[idx] === TerrainType.MOUNTAINS;
        const blend = isMountain ? 0.56 : 0.72;
        let r = pColor[0] * blend + base[rgbIdx] * (1 - blend);
        let g = pColor[1] * blend + base[rgbIdx + 1] * (1 - blend);
        let b = pColor[2] * blend + base[rgbIdx + 2] * (1 - blend);

        // Check 4-neighbors for crisp cartographic border lines
        let landBorder = false;
        let coastBorder = false;

        if (x > 0) {
          const nOwner = owners[idx - 1];
          if (nOwner !== owner) {
            if (terrain[idx - 1] === TerrainType.WATER) coastBorder = true;
            else landBorder = true;
          }
        }
        if (x < width - 1) {
          const nOwner = owners[idx + 1];
          if (nOwner !== owner) {
            if (terrain[idx + 1] === TerrainType.WATER) coastBorder = true;
            else landBorder = true;
          }
        }
        if (y > 0) {
          const nOwner = owners[idx - width];
          if (nOwner !== owner) {
            if (terrain[idx - width] === TerrainType.WATER) coastBorder = true;
            else landBorder = true;
          }
        }
        if (y < height - 1) {
          const nOwner = owners[idx + width];
          if (nOwner !== owner) {
            if (terrain[idx + width] === TerrainType.WATER) coastBorder = true;
            else landBorder = true;
          }
        }

        if (landBorder) {
          r *= 0.48;
          g *= 0.48;
          b *= 0.48;
        } else if (coastBorder) {
          r *= 0.74;
          g *= 0.74;
          b *= 0.74;
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

    // Clear ocean background
    ctx.fillStyle = '#161d24';
    ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    // Draw pixelated cartographic grid without blur
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

    // Subtle map frame
    ctx.strokeStyle = '#33414f';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      camera.offsetX,
      camera.offsetY,
      state.width * camera.zoom,
      state.height * camera.zoom,
    );

    // Public resource zones (circles only — optimum point is never in ClientRenderState)
    this.drawResourceZones(ctx, camera, state.publicResourceZones);

    // Selected frontier highlight & active front push orders
    this.drawFrontPushOrders(ctx, camera, state);
    this.drawSelectedFrontierCells(ctx, camera, state.width, overlays.selectedFrontierCells);

    // Active attack arrows
    this.drawAttackOrders(ctx, camera, state);

    // Capitals & state labels
    this.drawCapitals(ctx, camera, state.players);

    // Interactive overlays
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
        ? 'rgba(202, 148, 70, 0.11)'
        : 'rgba(86, 160, 178, 0.11)';
      ctx.fill();

      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = isMaterial
        ? 'rgba(202, 148, 70, 0.72)'
        : 'rgba(94, 173, 191, 0.72)';
      ctx.stroke();

      if (camera.zoom >= 2.1) {
        ctx.setLineDash([]);
        ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = isMaterial ? 'STAV. MAT.' : 'ENERGIE';
        ctx.fillStyle = 'rgba(18, 22, 28, 0.75)';
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
    const cellSize = Math.max(2, camera.zoom);
    ctx.fillStyle = 'rgba(240, 220, 140, 0.75)';
    ctx.strokeStyle = 'rgba(28, 24, 14, 0.85)';
    ctx.lineWidth = 0.8;
    for (const idx of cells) {
      const cx = idx % mapWidth;
      const cy = (idx - cx) / mapWidth;
      const screen = camera.worldToScreen(cx, cy);
      ctx.fillRect(screen.x, screen.y, cellSize, cellSize);
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
      const cellSize = Math.max(2, camera.zoom);
      ctx.save();
      ctx.fillStyle = 'rgba(235, 200, 110, 0.42)';
      for (const idx of order.frontierCells) {
        const cx = idx % state.width;
        const cy = (idx - cx) / state.width;
        sumX += cx + 0.5;
        sumY += cy + 0.5;
        const sc = camera.worldToScreen(cx, cy);
        ctx.fillRect(sc.x, sc.y, cellSize, cellSize);
      }
      const avgX = sumX / order.frontierCells.length;
      const avgY = sumY / order.frontierCells.length;
      const centerSc = camera.worldToScreen(avgX, avgY);
      const endSc = camera.worldToScreen(avgX + order.dirX * 10, avgY + order.dirY * 10);
      this.drawVectorArrow(ctx, centerSc.x, centerSc.y, endSc.x, endSc.y, '#ebd082', 2.4);
      ctx.restore();
    }
  }

  private drawAttackOrders(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    state: ClientRenderState,
  ): void {
    const playerColors = new Map<number, string>();
    for (const p of state.players) {
      playerColors.set(p.id, p.colorHex);
    }

    for (const order of state.attackOrders) {
      const start = camera.worldToScreen(order.fromX + 0.5, order.fromY + 0.5);
      const end = camera.worldToScreen(order.toX + 0.5, order.toY + 0.5);
      const isHuman = order.playerId === state.humanPlayerId;
      const color = isHuman ? '#d6e6f2' : (playerColors.get(order.playerId) ?? '#c8c8c8');
      this.drawVectorArrow(
        ctx,
        start.x,
        start.y,
        end.x,
        end.y,
        color,
        isHuman ? 3 : 2.2,
      );

      // Show remaining manpower only on human player's orders (never leak enemy manpower)
      if (isHuman && camera.zoom >= 2.0) {
        this.drawArrowBadge(
          ctx,
          (start.x + end.x) * 0.5,
          (start.y + end.y) * 0.5,
          `${Math.round(order.manpowerRemaining)} MP`,
        );
      }
    }
  }

  private drawVectorArrow(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    fillColor: string,
    lineWidth: number,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 4) return;
    const ux = dx / len;
    const uy = dy / len;
    const headLen = Math.min(13, Math.max(7, len * 0.28));
    const headWidth = headLen * 0.65;
    const shaftEndX = x2 - ux * (headLen * 0.72);
    const shaftEndY = y2 - uy * (headLen * 0.72);

    ctx.save();
    ctx.lineCap = 'round';

    // Dark outer casing for crisp readability over any territory color
    ctx.strokeStyle = 'rgba(15, 20, 26, 0.86)';
    ctx.lineWidth = lineWidth + 2.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();

    // Inner colored shaft
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();

    // Arrowhead
    const px = -uy;
    const py = ux;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux * headLen + px * headWidth, y2 - uy * headLen + py * headWidth);
    ctx.lineTo(x2 - ux * headLen - px * headWidth, y2 - uy * headLen - py * headWidth);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(15, 20, 26, 0.9)';
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
    ctx.fillStyle = 'rgba(18, 23, 29, 0.85)';
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
      const r = Math.max(3.5, Math.min(6, camera.zoom * 0.95));

      ctx.save();
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, r + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#14191f';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
      ctx.fillStyle = player.colorHex;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(sc.x, sc.y, Math.max(1.5, r * 0.42), 0, Math.PI * 2);
      ctx.fillStyle = '#f0ece1';
      ctx.fill();

      if (camera.zoom >= 2.0) {
        ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = player.name;
        const w = ctx.measureText(label).width + 8;
        const labelY = sc.y + r + 4;
        ctx.fillStyle = 'rgba(17, 21, 27, 0.78)';
        ctx.fillRect(sc.x - w / 2, labelY, w, 15);
        ctx.fillStyle = player.isBot ? '#d0cbc0' : '#a7d2ec';
        ctx.fillText(label, sc.x, labelY + 2);
      }
      ctx.restore();
    }
  }

  private drawStartHoverPreview(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    state: ClientRenderState,
    hoverCell: Point2D,
  ): void {
    const ix = Math.floor(hoverCell.x);
    const iy = Math.floor(hoverCell.y);
    if (ix < 0 || ix >= state.width || iy < 0 || iy >= state.height) return;
    const isWater = state.terrain[iy * state.width + ix] === TerrainType.WATER;
    const sc = camera.worldToScreen(ix + 0.5, iy + 0.5);

    ctx.save();
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, 6 * camera.zoom, 0, Math.PI * 2);
    if (isWater) {
      ctx.fillStyle = 'rgba(170, 75, 70, 0.16)';
      ctx.strokeStyle = 'rgba(200, 95, 90, 0.75)';
    } else {
      ctx.fillStyle = 'rgba(59, 110, 140, 0.25)';
      ctx.strokeStyle = 'rgba(145, 196, 224, 0.9)';
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
    const s = camera.worldToScreen(preview.fromX + 0.5, preview.fromY + 0.5);
    const e = camera.worldToScreen(preview.toX + 0.5, preview.toY + 0.5);
    this.drawVectorArrow(ctx, s.x, s.y, e.x, e.y, '#9bc6e2', 3);
    this.drawArrowBadge(
      ctx,
      e.x,
      e.y - 16,
      `${preview.manpowerPercent}% · ${Math.round(preview.committedManpower)} MP`,
    );
  }

  private drawLassoStroke(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    points: ReadonlyArray<Point2D>,
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
    const s = camera.worldToScreen(preview.fromX, preview.fromY);
    const e = camera.worldToScreen(preview.toX, preview.toY);
    this.drawVectorArrow(ctx, s.x, s.y, e.x, e.y, '#f0dca0', 2.8);
  }
}
