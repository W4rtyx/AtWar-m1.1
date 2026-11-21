import {
  ClientRenderState,
  Point,
  PublicPlayerInfo,
  PublicUnitInfo,
  TerrainType,
  UnitType,
  WILDERNESS_OWNER,
} from '../engine/types';
import { AIRFIELD_PARADROP_RANGE, UNIT_SPECS } from '../engine/units';
import { Camera } from './camera';

export interface UnitSelectionRect {
  readonly startX: number;
  readonly startY: number;
  readonly currX: number;
  readonly currY: number;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawUnitGlyph(
  ctx: CanvasRenderingContext2D,
  type: UnitType,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  accentColor: string,
): void {
  ctx.save();
  ctx.strokeStyle = accentColor;
  ctx.fillStyle = accentColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, halfH * 0.24);

  switch (type) {
    case 'INFANTRY': {
      // High-contrast NATO crossed infantry diagonals + top bar
      const gx = halfW * 0.72;
      const gy = halfH * 0.62;
      ctx.beginPath();
      ctx.moveTo(cx - gx, cy - gy);
      ctx.lineTo(cx + gx, cy + gy);
      ctx.moveTo(cx + gx, cy - gy);
      ctx.lineTo(cx - gx, cy + gy);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx - gx * 0.85, cy - gy - 1.5);
      ctx.lineTo(cx + gx * 0.85, cy - gy - 1.5);
      ctx.lineWidth = Math.max(1.1, halfH * 0.16);
      ctx.stroke();
      break;
    }
    case 'TANK': {
      // Bold armored tank silhouette: tracks, hull, turret, barrel
      const trackW = halfW * 1.45;
      const trackH = halfH * 0.56;
      drawRoundedRectPath(
        ctx,
        cx - trackW * 0.5,
        cy + halfH * 0.05,
        trackW,
        trackH,
        trackH * 0.45,
      );
      ctx.fill();

      // Turret dome
      ctx.beginPath();
      ctx.roundRect(
        cx - halfW * 0.36,
        cy - halfH * 0.48,
        halfW * 0.64,
        halfH * 0.52,
        2,
      );
      ctx.fill();

      // Cannon barrel pointing forward right
      ctx.beginPath();
      ctx.moveTo(cx + halfW * 0.2, cy - halfH * 0.24);
      ctx.lineTo(cx + halfW * 0.88, cy - halfH * 0.34);
      ctx.lineWidth = Math.max(1.8, halfH * 0.24);
      ctx.stroke();
      break;
    }
    case 'ARTILLERY': {
      // Bold wheeled howitzer carriage + angled heavy cannon barrel
      const wheelR = Math.max(2.1, halfH * 0.3);
      ctx.beginPath();
      ctx.arc(cx - halfW * 0.15, cy + halfH * 0.38, wheelR, 0, Math.PI * 2);
      ctx.fill();

      // Trail spade to left
      ctx.beginPath();
      ctx.moveTo(cx - halfW * 0.15, cy + halfH * 0.38);
      ctx.lineTo(cx - halfW * 0.72, cy + halfH * 0.58);
      ctx.lineWidth = Math.max(1.5, halfH * 0.22);
      ctx.stroke();

      // Elevated gun barrel
      ctx.beginPath();
      ctx.moveTo(cx - halfW * 0.15, cy + halfH * 0.2);
      ctx.lineTo(cx + halfW * 0.74, cy - halfH * 0.58);
      ctx.lineWidth = Math.max(2.1, halfH * 0.28);
      ctx.stroke();

      // Muzzle ring
      ctx.beginPath();
      ctx.arc(cx + halfW * 0.74, cy - halfH * 0.58, Math.max(1.3, halfH * 0.16), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'PARATROOPERS': {
      // Open parachute canopy + suspension lines + trooper chevron
      const domeR = halfW * 0.66;
      const domeY = cy - halfH * 0.08;
      ctx.beginPath();
      ctx.arc(cx, domeY, domeR, Math.PI, 0);
      ctx.closePath();
      ctx.fill();

      ctx.lineWidth = Math.max(1.0, halfH * 0.15);
      ctx.beginPath();
      ctx.moveTo(cx - domeR * 0.9, domeY);
      ctx.lineTo(cx, cy + halfH * 0.55);
      ctx.moveTo(cx + domeR * 0.9, domeY);
      ctx.lineTo(cx, cy + halfH * 0.55);
      ctx.moveTo(cx, domeY);
      ctx.lineTo(cx, cy + halfH * 0.55);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy + halfH * 0.6, Math.max(1.4, halfH * 0.18), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}

function drawPadlockIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  ctx.save();
  ctx.fillStyle = '#182028';
  ctx.strokeStyle = '#f2c66d';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Shackle
  ctx.beginPath();
  ctx.arc(x, y - 0.8, 2.2, Math.PI, 0);
  ctx.strokeStyle = '#f6dca0';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Body
  ctx.fillStyle = '#f2c66d';
  ctx.fillRect(x - 2.6, y - 0.4, 5.2, 3.6);
  ctx.restore();
}

export function drawUnits(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  state: ClientRenderState,
  selectedUnitIds: ReadonlySet<number>,
): void {
  if (state.units.length === 0) return;

  const playerMap = new Map<number, PublicPlayerInfo>();
  for (const p of state.players) {
    playerMap.set(p.id, p);
  }

  const scale = Math.max(0.88, Math.min(1.28, Math.sqrt(camera.zoom) * 0.72));
  const plaqueW = Math.round(24 * scale);
  const plaqueH = Math.round(18 * scale);

  // Pass 1: Selected range/attack rings, move lines, and active combat fire tracers
  for (const unit of state.units) {
    const sc = camera.worldToScreen(unit.x, unit.y);
    const isSelected = selectedUnitIds.has(unit.id);
    const isOwn = unit.ownerId === state.humanPlayerId;

    if (isSelected && isOwn) {
      if (unit.stance === 'RANGE' && unit.operationRadius > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, unit.operationRadius * camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(110, 200, 232, 0.05)';
        ctx.fill();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = 'rgba(120, 210, 240, 0.55)';
        ctx.stroke();
        ctx.restore();
      }

      if (unit.type === 'ARTILLERY') {
        const atkR = UNIT_SPECS.ARTILLERY.attackRange * camera.zoom;
        ctx.save();
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, atkR, 0, Math.PI * 2);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = 'rgba(232, 168, 92, 0.52)';
        ctx.stroke();
        ctx.restore();
      }

      if (unit.targetX !== null && unit.targetY !== null) {
        const dst = camera.worldToScreen(unit.targetX, unit.targetY);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sc.x, sc.y);
        ctx.lineTo(dst.x, dst.y);
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = unit.attachedOrderId !== null ? '#9cd6f0' : '#f0dca0';
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(dst.x, dst.y - 4.5);
        ctx.lineTo(dst.x + 4.5, dst.y);
        ctx.lineTo(dst.x, dst.y + 4.5);
        ctx.lineTo(dst.x - 4.5, dst.y);
        ctx.closePath();
        ctx.fillStyle = unit.attachedOrderId !== null ? '#9cd6f0' : '#f0dca0';
        ctx.fill();
        ctx.restore();
      }
    }

    if (
      unit.combatCooldownTicks > 0 &&
      unit.lastCombatTargetX !== null &&
      unit.lastCombatTargetY !== null
    ) {
      const tgt = camera.worldToScreen(unit.lastCombatTargetX, unit.lastCombatTargetY);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sc.x, sc.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.setLineDash(unit.type === 'ARTILLERY' ? [4, 3] : [2, 3]);
      ctx.lineWidth = unit.type === 'ARTILLERY' ? 1.8 : 1.3;
      ctx.strokeStyle =
        unit.type === 'ARTILLERY'
          ? 'rgba(248, 175, 92, 0.88)'
          : 'rgba(246, 224, 130, 0.82)';
      ctx.stroke();
      ctx.restore();
    }
  }

  // Pass 2: High-contrast military unit counters, HP bars, stack badges & stance locks
  for (const unit of state.units) {
    const sc = camera.worldToScreen(unit.x, unit.y);
    const isSelected = selectedUnitIds.has(unit.id);
    const owner = playerMap.get(unit.ownerId);
    const ownerHex = owner?.colorHex ?? '#8a99a8';
    const isOwn = unit.ownerId === state.humanPlayerId;

    const left = sc.x - plaqueW * 0.5;
    const top = sc.y - plaqueH * 0.5;

    ctx.save();

    // Selection halo / encircled / drop-vulnerability ring
    if (isSelected) {
      drawRoundedRectPath(ctx, left - 3, top - 3, plaqueW + 6, plaqueH + 6, 5);
      ctx.strokeStyle = '#f5df96';
      ctx.lineWidth = 2.0;
      ctx.stroke();
    } else if (unit.isEncircled) {
      drawRoundedRectPath(ctx, left - 2.5, top - 2.5, plaqueW + 5, plaqueH + 5, 5);
      ctx.strokeStyle = 'rgba(232, 86, 78, 0.92)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    } else if (unit.dropVulnerabilityTicks > 0) {
      drawRoundedRectPath(ctx, left - 2, top - 2, plaqueW + 4, plaqueH + 4, 4);
      ctx.strokeStyle = 'rgba(116, 212, 240, 0.86)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // Shadow
    drawRoundedRectPath(ctx, left + 1, top + 1.5, plaqueW, plaqueH, 4);
    ctx.fillStyle = 'rgba(8, 11, 16, 0.65)';
    ctx.fill();

    // Counter plaque body
    drawRoundedRectPath(ctx, left, top, plaqueW, plaqueH, 4);
    ctx.fillStyle = isOwn ? '#172634' : '#241b1e';
    ctx.fill();

    // Top faction header strip inside plaque
    ctx.save();
    drawRoundedRectPath(ctx, left, top, plaqueW, plaqueH, 4);
    ctx.clip();
    ctx.fillStyle = ownerHex;
    ctx.fillRect(left, top, plaqueW, Math.max(3, plaqueH * 0.22));
    ctx.restore();

    // Crisp plaque outline
    drawRoundedRectPath(ctx, left, top, plaqueW, plaqueH, 4);
    ctx.lineWidth = isSelected ? 1.7 : 1.25;
    ctx.strokeStyle = isSelected
      ? '#f5df96'
      : unit.isEncircled
        ? '#eb766c'
        : isOwn
          ? '#9bc9e6'
          : owner?.relationToHuman === 'WAR'
            ? '#e07b73'
            : '#b7c3cf';
    ctx.stroke();

    // High-contrast tactical glyph
    const glyphColor =
      unit.type === 'TANK'
        ? '#f0d39a'
        : unit.type === 'ARTILLERY'
          ? '#f0ae76'
          : unit.type === 'PARATROOPERS'
            ? '#a3e2f5'
            : '#edf3f8';
    drawUnitGlyph(
      ctx,
      unit.type,
      sc.x,
      sc.y + plaqueH * 0.08,
      plaqueW * 0.38,
      plaqueH * 0.34,
      glyphColor,
    );

    // HP bar underneath plaque
    const hpRatio = Math.max(0, Math.min(1, unit.hp / Math.max(1, unit.maxHp)));
    const barW = plaqueW - 2;
    const barH = 3.2;
    const barX = left + 1;
    const barY = top + plaqueH + 2;
    ctx.fillStyle = 'rgba(10, 14, 18, 0.9)';
    ctx.fillRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);
    ctx.fillStyle =
      hpRatio > 0.55 ? '#66c989' : hpRatio > 0.28 ? '#dfb25c' : '#df675d';
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    // Stack count badge ×N
    if (unit.count > 1) {
      const badgeText = `×${unit.count}`;
      ctx.font = '700 9.5px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const bw = Math.max(15, ctx.measureText(badgeText).width + 6);
      const bx = left + plaqueW - 1;
      const by = top - 1;
      ctx.fillStyle = isOwn ? '#1e394b' : '#402022';
      ctx.strokeStyle = isSelected ? '#f5df96' : '#cfdbe6';
      ctx.lineWidth = 1;
      ctx.fillRect(bx - bw * 0.5, by - 5.5, bw, 11);
      ctx.strokeRect(bx - bw * 0.5, by - 5.5, bw, 11);
      ctx.fillStyle = '#f5f7f9';
      ctx.fillText(badgeText, bx, by + 0.5);
    }

    // Stance lock icon (top-left)
    if (unit.stance === 'LOCK') {
      drawPadlockIcon(ctx, left + 1, top + 1);
    }

    // Encircled indicator (bottom-right)
    if (unit.isEncircled) {
      const ex = left + plaqueW - 1;
      const ey = top + plaqueH - 1;
      ctx.beginPath();
      ctx.arc(ex, ey, 5.2, 0, Math.PI * 2);
      ctx.fillStyle = '#8b241f';
      ctx.fill();
      ctx.strokeStyle = '#ffaba3';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = '800 8.5px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff3f1';
      ctx.fillText('!', ex, ey + 0.5);
    }

    ctx.restore();
  }
}

export function drawUnitSelectionRect(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  rect: UnitSelectionRect,
): void {
  const p1 = camera.worldToScreen(rect.startX, rect.startY);
  const p2 = camera.worldToScreen(rect.currX, rect.currY);
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const w = Math.abs(p2.x - p1.x);
  const h = Math.abs(p2.y - p1.y);
  if (w < 2 && h < 2) return;

  ctx.save();
  ctx.fillStyle = 'rgba(130, 210, 238, 0.14)';
  ctx.fillRect(x, y, w, h);
  ctx.setLineDash([5, 3]);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(240, 220, 140, 0.92)';
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

export function drawParadropOverlay(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  state: ClientRenderState,
  unit: PublicUnitInfo,
  hoverCell: Point | null,
): void {
  const readyAirfields = state.buildings.filter(
    (b) =>
      b.ownerId === state.humanPlayerId &&
      b.type === 'AIRFIELD' &&
      b.stackCount > 0 &&
      b.paradropCooldownTicks <= 0,
  );

  ctx.save();
  for (const af of readyAirfields) {
    const sc = camera.worldToScreen(af.x + 0.5, af.y + 0.5);
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, AIRFIELD_PARADROP_RANGE * camera.zoom, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(116, 212, 240, 0.05)';
    ctx.fill();
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(116, 212, 240, 0.65)';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (hoverCell && unit.canParadrop) {
    const ix = Math.floor(hoverCell.x);
    const iy = Math.floor(hoverCell.y);
    const sc = camera.worldToScreen(ix + 0.5, iy + 0.5);
    const inBounds = ix >= 0 && ix < state.width && iy >= 0 && iy < state.height;
    let valid = false;
    let statusLabel = 'Výsadek mimo dosah letiště';

    if (inBounds) {
      const idx = iy * state.width + ix;
      const isWater = state.terrain[idx] === TerrainType.WATER;
      const ownerId = state.owners[idx];
      const inRange = readyAirfields.some(
        (af) => Math.hypot(af.x + 0.5 - (ix + 0.5), af.y + 0.5 - (iy + 0.5)) <= AIRFIELD_PARADROP_RANGE,
      );
      const ownerPlayer =
        ownerId >= 0 ? state.players.find((p) => p.id === ownerId) : undefined;
      const isNeutralForeign =
        ownerId >= 0 &&
        ownerId !== state.humanPlayerId &&
        ownerPlayer?.relationToHuman === 'NEUTRAL';

      if (isWater) {
        statusLabel = 'Nelze vysadit na vodu';
      } else if (!inRange) {
        statusLabel = 'Mimo dolet připraveného letiště';
      } else if (isNeutralForeign) {
        statusLabel = 'Nelze vysadit na neutrální stát (nejdřív válka)';
      } else {
        valid = true;
        statusLabel =
          ownerId >= 0 && ownerId !== state.humanPlayerId && ownerPlayer?.relationToHuman === 'WAR'
            ? 'VÝSADEK DO TÝLU NEPŘÍTELE (klik LMB)'
            : ownerId === WILDERNESS_OWNER
              ? 'VÝSADEK NA VOLNÉ ÚZEMÍ (klik LMB)'
              : 'TAKTOVÝ PŘESUN VÝSADKEM (klik LMB)';
      }
    }

    ctx.beginPath();
    ctx.arc(sc.x, sc.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = valid ? 'rgba(84, 198, 134, 0.22)' : 'rgba(216, 86, 80, 0.22)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = valid ? '#8ce8b0' : '#ef8d86';
    ctx.stroke();

    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(statusLabel).width + 12;
    ctx.fillStyle = 'rgba(15, 20, 26, 0.9)';
    ctx.fillRect(sc.x - w * 0.5, sc.y - 30, w, 18);
    ctx.strokeStyle = valid ? '#67ba87' : '#b85a54';
    ctx.lineWidth = 1;
    ctx.strokeRect(sc.x - w * 0.5, sc.y - 30, w, 18);
    ctx.fillStyle = valid ? '#cbf2da' : '#f5c2be';
    ctx.fillText(statusLabel, sc.x, sc.y - 20.5);
  }

  ctx.restore();
}
