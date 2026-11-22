import { ARTILLERY_BLAST_RADIUS } from '../engine/combat';
import {
  ArtilleryExplosionFx,
  ClientRenderState,
  Point,
  PublicPlayerInfo,
  PublicUnitInfo,
  TerrainType,
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

export interface MoveOrderPing {
  readonly x: number;
  readonly y: number;
  readonly createdAtMs: number;
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

function resolveFacingDirection(unit: PublicUnitInfo, isOwn: boolean): number {
  if (
    unit.combatCooldownTicks > 0 &&
    unit.lastCombatTargetX !== null &&
    unit.lastCombatTargetY !== null
  ) {
    return unit.lastCombatTargetX >= unit.x ? 1 : -1;
  }
  if (unit.waypoints.length > 0) {
    return unit.waypoints[0].x >= unit.x ? 1 : -1;
  }
  if (unit.targetX !== null) {
    return unit.targetX >= unit.x ? 1 : -1;
  }
  return isOwn ? 1 : -1;
}

function drawUnitSilhouette(
  ctx: CanvasRenderingContext2D,
  unit: PublicUnitInfo,
  cx: number,
  cy: number,
  w: number,
  h: number,
  dirX: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (unit.type) {
    case 'TANK': {
      // Canonical armored tank silhouette: crisp ink outline, treads + road wheels, sloped hull, turret & gun barrel
      ctx.save();
      ctx.scale(dirX, 1);

      // Treads bar
      drawRoundedRectPath(ctx, -w * 0.66, h * 0.04, w * 1.28, h * 0.44, h * 0.22);
      ctx.fillStyle = '#c8aa66';
      ctx.fill();
      ctx.strokeStyle = '#0c1015';
      ctx.lineWidth = 1.0;
      ctx.stroke();

      // Road wheel cutouts
      ctx.fillStyle = '#18140d';
      for (const wx of [-0.44, -0.15, 0.14, 0.43]) {
        ctx.beginPath();
        ctx.arc(wx * w, h * 0.26, Math.max(1.0, h * 0.09), 0, Math.PI * 2);
        ctx.fill();
      }

      // Upper sloped hull
      ctx.beginPath();
      ctx.moveTo(-w * 0.58, h * 0.06);
      ctx.lineTo(-w * 0.42, -h * 0.18);
      ctx.lineTo(w * 0.48, -h * 0.18);
      ctx.lineTo(w * 0.62, h * 0.06);
      ctx.closePath();
      ctx.fillStyle = '#e8cf86';
      ctx.fill();
      ctx.strokeStyle = '#0c1015';
      ctx.lineWidth = 0.85;
      ctx.stroke();

      // Turret + commander cupola
      drawRoundedRectPath(ctx, -w * 0.28, -h * 0.46, w * 0.54, h * 0.3, 1.8);
      ctx.fillStyle = '#f5e2a4';
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(-w * 0.18, -h * 0.56, w * 0.18, h * 0.12);

      // Long horizontal barrel + muzzle brake
      ctx.strokeStyle = '#0c1015';
      ctx.lineWidth = Math.max(2.9, h * 0.25);
      ctx.beginPath();
      ctx.moveTo(w * 0.2, -h * 0.31);
      ctx.lineTo(w * 0.82, -h * 0.31);
      ctx.stroke();
      ctx.strokeStyle = '#f5e2a4';
      ctx.lineWidth = Math.max(1.7, h * 0.15);
      ctx.beginPath();
      ctx.moveTo(w * 0.2, -h * 0.31);
      ctx.lineTo(w * 0.8, -h * 0.31);
      ctx.stroke();
      ctx.fillStyle = '#f5e2a4';
      ctx.fillRect(w * 0.74, -h * 0.39, w * 0.11, h * 0.16);

      if (unit.combatCooldownTicks >= 4) {
        ctx.beginPath();
        ctx.arc(w * 0.88, -h * 0.31, Math.max(1.8, h * 0.16), 0, Math.PI * 2);
        ctx.fillStyle = '#fff3b8';
        ctx.fill();
      }
      ctx.restore();
      break;
    }

    case 'ARTILLERY': {
      // Canonical wheeled field howitzer silhouette: split trail spade, spoked wheel, shield & elevated barrel
      ctx.save();
      ctx.scale(dirX, 1);

      // Trail spade
      ctx.strokeStyle = '#0c1015';
      ctx.lineWidth = Math.max(2.6, h * 0.22);
      ctx.beginPath();
      ctx.moveTo(-w * 0.12, h * 0.26);
      ctx.lineTo(-w * 0.72, h * 0.48);
      ctx.stroke();
      ctx.strokeStyle = '#d49458';
      ctx.lineWidth = Math.max(1.5, h * 0.13);
      ctx.stroke();

      // Long elevated howitzer barrel with dark outline + muzzle brake
      ctx.strokeStyle = '#0c1015';
      ctx.lineWidth = Math.max(3.1, h * 0.27);
      ctx.beginPath();
      ctx.moveTo(-w * 0.2, h * 0.12);
      ctx.lineTo(w * 0.7, -h * 0.54);
      ctx.stroke();
      ctx.strokeStyle = '#f3be7c';
      ctx.lineWidth = Math.max(1.9, h * 0.17);
      ctx.stroke();

      // Gun shield
      ctx.strokeStyle = '#0c1015';
      ctx.lineWidth = Math.max(2.8, h * 0.24);
      ctx.beginPath();
      ctx.moveTo(w * 0.02, -h * 0.38);
      ctx.lineTo(w * 0.14, h * 0.18);
      ctx.stroke();
      ctx.strokeStyle = '#e8a25e';
      ctx.lineWidth = Math.max(1.6, h * 0.14);
      ctx.stroke();

      // Carriage wheel + rim highlight
      const wheelR = Math.max(2.7, h * 0.28);
      ctx.beginPath();
      ctx.arc(-w * 0.08, h * 0.3, wheelR, 0, Math.PI * 2);
      ctx.fillStyle = '#14110d';
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, h * 0.13);
      ctx.strokeStyle = '#f2b876';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(-w * 0.08, h * 0.3, Math.max(1.0, wheelR * 0.35), 0, Math.PI * 2);
      ctx.fillStyle = '#f2b876';
      ctx.fill();

      if (unit.combatCooldownTicks >= 3) {
        ctx.beginPath();
        ctx.arc(w * 0.76, -h * 0.58, Math.max(2.2, h * 0.2), 0, Math.PI * 2);
        ctx.fillStyle = '#ffe6a3';
        ctx.fill();
      }
      ctx.restore();
      break;
    }

    case 'INFANTRY': {
      // Canonical combat infantry silhouette: steel helmet + crossed rifles
      const rx = w * 0.56;
      const ry = h * 0.44;
      ctx.strokeStyle = '#0c1015';
      ctx.lineWidth = Math.max(2.9, h * 0.26);
      ctx.beginPath();
      ctx.moveTo(-rx, -ry * 0.4);
      ctx.lineTo(rx, ry);
      ctx.moveTo(rx, -ry * 0.4);
      ctx.lineTo(-rx, ry);
      ctx.stroke();

      ctx.strokeStyle = '#e3eef6';
      ctx.lineWidth = Math.max(1.6, h * 0.15);
      ctx.stroke();

      // Steel helmet dome centered above crossed rifles
      const helmR = Math.max(2.6, w * 0.28);
      ctx.beginPath();
      ctx.arc(0, -h * 0.16, helmR, Math.PI, 0);
      ctx.lineTo(helmR * 1.18, -h * 0.16);
      ctx.lineTo(-helmR * 1.18, -h * 0.16);
      ctx.closePath();
      ctx.fillStyle = '#b4d6ec';
      ctx.fill();
      ctx.strokeStyle = '#0c1015';
      ctx.lineWidth = 0.9;
      ctx.stroke();
      break;
    }

    case 'PARATROOPERS': {
      // Canonical airborne silhouette: ribbed parachute dome canopy, suspension lines & trooper wings
      const domeR = w * 0.56;
      const domeY = -h * 0.08;
      ctx.beginPath();
      ctx.arc(0, domeY, domeR, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#9ce2f6';
      ctx.fill();
      ctx.strokeStyle = '#0c1015';
      ctx.lineWidth = 1.0;
      ctx.stroke();

      ctx.strokeStyle = '#336a80';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(-domeR * 0.45, domeY);
      ctx.quadraticCurveTo(-domeR * 0.3, domeY - domeR * 0.72, 0, domeY - domeR);
      ctx.moveTo(domeR * 0.45, domeY);
      ctx.quadraticCurveTo(domeR * 0.3, domeY - domeR * 0.72, 0, domeY - domeR);
      ctx.stroke();

      ctx.strokeStyle = '#d8f6ff';
      ctx.lineWidth = Math.max(1.1, h * 0.1);
      ctx.beginPath();
      ctx.moveTo(-domeR * 0.88, domeY);
      ctx.lineTo(0, h * 0.42);
      ctx.moveTo(domeR * 0.88, domeY);
      ctx.lineTo(0, h * 0.42);
      ctx.moveTo(0, domeY);
      ctx.lineTo(0, h * 0.42);
      ctx.stroke();

      // Descending trooper & chevron wings
      ctx.beginPath();
      ctx.arc(0, h * 0.48, Math.max(1.6, h * 0.14), 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#8ad8f0';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-w * 0.3, h * 0.42);
      ctx.lineTo(0, h * 0.58);
      ctx.lineTo(w * 0.3, h * 0.42);
      ctx.stroke();
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

  ctx.beginPath();
  ctx.arc(x, y - 0.8, 2.2, Math.PI, 0);
  ctx.strokeStyle = '#f6dca0';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = '#f2c66d';
  ctx.fillRect(x - 2.6, y - 0.4, 5.2, 3.6);
  ctx.restore();
}

function drawChevronsAlongSegment(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 16) return;
  const ang = Math.atan2(dy, dx);
  const step = 28;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let d = step; d < dist - 10; d += step) {
    const px = x1 + (dx / dist) * d;
    const py = y1 + (dy / dist) * d;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(-3.5, -3.5);
    ctx.lineTo(1.5, 0);
    ctx.lineTo(-3.5, 3.5);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

export function drawMoveOrderPings(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  pings: ReadonlyArray<MoveOrderPing>,
  nowMs: number,
): void {
  const durationMs = 1400;
  for (const ping of pings) {
    const age = nowMs - ping.createdAtMs;
    if (age < 0 || age > durationMs) continue;
    const t = age / durationMs;
    const alpha = Math.max(0, 1 - t);
    const sc = camera.worldToScreen(ping.x, ping.y);

    ctx.save();
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, 5 + t * 18, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(246, 222, 138, ${(alpha * 0.85).toFixed(3)})`;
    ctx.lineWidth = 2.0 - t * 0.8;
    ctx.stroke();

    const r = 5.0 * (1 - t * 0.3);
    ctx.beginPath();
    ctx.moveTo(sc.x, sc.y - r);
    ctx.lineTo(sc.x + r, sc.y);
    ctx.lineTo(sc.x, sc.y + r);
    ctx.lineTo(sc.x - r, sc.y);
    ctx.closePath();
    ctx.fillStyle = `rgba(255, 238, 170, ${(alpha * 0.92).toFixed(3)})`;
    ctx.fill();
    ctx.restore();
  }
}

export function drawArtilleryExplosions(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  explosions: ReadonlyArray<Readonly<ArtilleryExplosionFx>>,
): void {
  for (const fx of explosions) {
    const sc = camera.worldToScreen(fx.x, fx.y);
    const rPx = Math.max(8, fx.radius * camera.zoom);
    const elapsed = 1 - fx.ttlTicks / Math.max(1, fx.maxTtlTicks);
    const alpha = Math.max(0, 1 - elapsed);

    ctx.save();
    // Shockwave perimeter
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, rPx * (0.35 + elapsed * 0.72), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 194, 96, ${(alpha * 0.88).toFixed(3)})`;
    ctx.lineWidth = 2.2 - elapsed * 1.1;
    ctx.stroke();

    // Glowing fireball core
    const grad = ctx.createRadialGradient(sc.x, sc.y, 1, sc.x, sc.y, rPx * 0.82);
    grad.addColorStop(0, `rgba(255, 244, 196, ${(alpha * 0.85).toFixed(3)})`);
    grad.addColorStop(0.45, `rgba(255, 138, 56, ${(alpha * 0.56).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(180, 48, 22, 0)');
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, rPx * 0.82, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    if (fx.manpowerKilled > 0) {
      const floatY = sc.y - 6 - elapsed * 16;
      const label = `-${fx.manpowerKilled} MP`;
      ctx.font = '700 10.5px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = `rgba(14, 10, 10, ${(alpha * 0.92).toFixed(3)})`;
      ctx.strokeText(label, sc.x, floatY);
      ctx.fillStyle = `rgba(255, 166, 118, ${alpha.toFixed(3)})`;
      ctx.fillText(label, sc.x, floatY);
    }

    ctx.restore();
  }
}

export function drawUnits(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  state: ClientRenderState,
  selectedUnitIds: ReadonlySet<number>,
  nowMs: number = 0,
): void {
  if (state.units.length === 0) return;

  const playerMap = new Map<number, PublicPlayerInfo>();
  for (const p of state.players) {
    playerMap.set(p.id, p);
  }

  const scale = Math.max(0.88, Math.min(1.28, Math.sqrt(camera.zoom) * 0.72));
  const plaqueW = Math.round(26 * scale);
  const plaqueH = Math.round(19 * scale);
  const pulse = nowMs > 0 ? 0.5 + 0.5 * Math.sin(nowMs * 0.008) : 0.7;

  // Pass 1: Range rings, multi-waypoint land routes, active fire missions & combat tracers
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
        ctx.lineWidth = 1.15;
        ctx.strokeStyle = 'rgba(238, 172, 92, 0.58)';
        ctx.stroke();
        ctx.restore();
      }

      // Trace full land path waypoints if present, otherwise target point
      if (unit.targetX !== null && unit.targetY !== null) {
        const routeWorld: Point[] =
          unit.waypoints.length > 0
            ? [...unit.waypoints]
            : [{ x: unit.targetX, y: unit.targetY }];
        const routeScreen = [sc, ...routeWorld.map((wp) => camera.worldToScreen(wp.x, wp.y))];
        const routeColor = unit.attachedOrderId !== null ? '#9cd6f0' : '#f4de8c';
        const dst = routeScreen[routeScreen.length - 1];

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(routeScreen[0].x, routeScreen[0].y);
        for (let i = 1; i < routeScreen.length; i++) {
          ctx.lineTo(routeScreen[i].x, routeScreen[i].y);
        }
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2.0;
        ctx.strokeStyle = routeColor;
        ctx.stroke();
        ctx.setLineDash([]);

        for (let i = 0; i < routeScreen.length - 1; i++) {
          drawChevronsAlongSegment(
            ctx,
            routeScreen[i].x,
            routeScreen[i].y,
            routeScreen[i + 1].x,
            routeScreen[i + 1].y,
            routeColor,
          );
        }

        ctx.beginPath();
        ctx.arc(dst.x, dst.y, 7.5 + pulse * 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = routeColor;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(dst.x, dst.y - 4.5);
        ctx.lineTo(dst.x + 4.5, dst.y);
        ctx.lineTo(dst.x, dst.y + 4.5);
        ctx.lineTo(dst.x - 4.5, dst.y);
        ctx.closePath();
        ctx.fillStyle = routeColor;
        ctx.fill();
        ctx.restore();
      }

      if (
        unit.fireMissionTicksRemaining > 0 &&
        unit.fireMissionX !== null &&
        unit.fireMissionY !== null
      ) {
        const tgt = camera.worldToScreen(unit.fireMissionX, unit.fireMissionY);
        const blastPx = ARTILLERY_BLAST_RADIUS * camera.zoom;
        ctx.save();
        ctx.beginPath();
        ctx.arc(tgt.x, tgt.y, blastPx, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 146, 62, 0.14)';
        ctx.fill();
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = 'rgba(255, 178, 86, 0.88)';
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = '#ffd996';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(tgt.x - 6, tgt.y);
        ctx.lineTo(tgt.x + 6, tgt.y);
        ctx.moveTo(tgt.x, tgt.y - 6);
        ctx.lineTo(tgt.x, tgt.y + 6);
        ctx.stroke();
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
      if (unit.type === 'ARTILLERY') {
        const sDist = Math.hypot(tgt.x - sc.x, tgt.y - sc.y);
        const arcLift = Math.min(60, Math.max(16, sDist * 0.34));
        const ctrlX = (sc.x + tgt.x) * 0.5;
        const ctrlY = Math.min(sc.y, tgt.y) - arcLift;

        ctx.beginPath();
        ctx.moveTo(sc.x, sc.y - 3 * scale);
        ctx.quadraticCurveTo(ctrlX, ctrlY, tgt.x, tgt.y);
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.9;
        ctx.strokeStyle = 'rgba(255, 184, 92, 0.88)';
        ctx.stroke();
        ctx.setLineDash([]);

        const flightT = Math.max(0.08, Math.min(1, (6 - unit.combatCooldownTicks) / 5));
        const invT = 1 - flightT;
        const shellX = invT * invT * sc.x + 2 * invT * flightT * ctrlX + flightT * flightT * tgt.x;
        const shellY =
          invT * invT * (sc.y - 3 * scale) + 2 * invT * flightT * ctrlY + flightT * flightT * tgt.y;

        ctx.beginPath();
        ctx.arc(shellX, shellY, 2.7, 0, Math.PI * 2);
        ctx.fillStyle = '#fff2c4';
        ctx.fill();

        const blastR = (3.5 + flightT * 6.5) * scale;
        ctx.beginPath();
        ctx.arc(tgt.x, tgt.y, blastR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 146, 62, 0.34)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 224, 140, 0.92)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(sc.x, sc.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(248, 224, 134, 0.86)';
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Pass 2: Clean crisp tactical counter plaques, HP/Morale bars, ×N badges & stance icons
  for (const unit of state.units) {
    const sc = camera.worldToScreen(unit.x, unit.y);
    const isSelected = selectedUnitIds.has(unit.id);
    const owner = playerMap.get(unit.ownerId);
    const ownerHex = owner?.colorHex ?? '#8a99a8';
    const isOwn = unit.ownerId === state.humanPlayerId;
    const dirX = resolveFacingDirection(unit, isOwn);

    const left = sc.x - plaqueW * 0.5;
    const top = sc.y - plaqueH * 0.5;

    ctx.save();

    // Selection halo / encircled / drop aura
    if (isSelected) {
      drawRoundedRectPath(ctx, left - 3, top - 3, plaqueW + 6, plaqueH + 6, 5);
      ctx.strokeStyle = '#f5df96';
      ctx.lineWidth = 2.0;
      ctx.stroke();
    } else if (unit.isEncircled) {
      drawRoundedRectPath(ctx, left - 2.5, top - 2.5, plaqueW + 5, plaqueH + 5, 5);
      ctx.strokeStyle = 'rgba(232, 86, 78, 0.92)';
      ctx.lineWidth = 1.7;
      ctx.stroke();
    } else if (unit.dropVulnerabilityTicks > 0) {
      drawRoundedRectPath(ctx, left - 2.2, top - 2.2, plaqueW + 4.4, plaqueH + 4.4, 4.5);
      ctx.strokeStyle = 'rgba(116, 212, 240, 0.86)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // Drop shadow
    drawRoundedRectPath(ctx, left + 1.2, top + 1.8, plaqueW, plaqueH, 4);
    ctx.fillStyle = 'rgba(6, 9, 14, 0.7)';
    ctx.fill();

    // Crisp slate counter body
    drawRoundedRectPath(ctx, left, top, plaqueW, plaqueH, 4);
    ctx.fillStyle = isOwn ? '#152534' : '#2a181c';
    ctx.fill();

    // Top faction accent strip inside counter
    ctx.save();
    drawRoundedRectPath(ctx, left, top, plaqueW, plaqueH, 4);
    ctx.clip();
    ctx.fillStyle = ownerHex;
    ctx.fillRect(left, top, plaqueW, Math.max(3, plaqueH * 0.2));
    ctx.restore();

    // Team border
    drawRoundedRectPath(ctx, left, top, plaqueW, plaqueH, 4);
    ctx.lineWidth = isSelected ? 1.8 : 1.5;
    ctx.strokeStyle = isSelected
      ? '#f5df96'
      : unit.isEncircled
        ? '#eb766c'
        : isOwn
          ? ownerHex
          : owner?.relationToHuman === 'WAR'
            ? '#eb7268'
            : ownerHex;
    ctx.stroke();

    // Clean, sharp silhouette centered on plaque
    drawUnitSilhouette(
      ctx,
      unit,
      sc.x,
      sc.y + plaqueH * 0.08,
      plaqueW * 0.44,
      plaqueH * 0.36,
      dirX,
    );

    // HP bar + subtle Morale micro-strip underneath plaque
    const hpRatio = Math.max(0, Math.min(1, unit.hp / Math.max(1, unit.maxHp)));
    const moraleRatio = Math.max(0, Math.min(1, unit.morale / 100));
    const barW = plaqueW - 2;
    const barH = 3.2;
    const barX = left + 1;
    const barY = top + plaqueH + 2;

    ctx.fillStyle = 'rgba(8, 12, 16, 0.92)';
    ctx.fillRect(barX - 0.5, barY - 0.5, barW + 1, barH + 2.8);
    ctx.fillStyle =
      hpRatio > 0.55 ? '#66c989' : hpRatio > 0.28 ? '#dfb25c' : '#df675d';
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    ctx.fillStyle =
      moraleRatio > 0.6 ? '#76c5ee' : moraleRatio > 0.3 ? '#e2a854' : '#df675d';
    ctx.fillRect(barX, barY + barH + 0.5, barW * moraleRatio, 1.5);

    // Stack count badge ×N
    if (unit.count > 1) {
      const badgeText = `×${unit.count}`;
      ctx.font = '700 9.5px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const bw = Math.max(16, ctx.measureText(badgeText).width + 6);
      const bx = left + plaqueW - 1;
      const by = top - 1;
      drawRoundedRectPath(ctx, bx - bw * 0.5, by - 5.5, bw, 11, 3);
      ctx.fillStyle = isOwn ? '#173144' : '#3d1c20';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#f5df96' : '#cfdbe6';
      ctx.lineWidth = 1;
      ctx.stroke();
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
        (af) =>
          Math.hypot(af.x + 0.5 - (ix + 0.5), af.y + 0.5 - (iy + 0.5)) <=
          AIRFIELD_PARADROP_RANGE,
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

export function drawArtilleryFireMissionOverlay(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  state: ClientRenderState,
  artilleryUnits: ReadonlyArray<PublicUnitInfo>,
  hoverCell: Point | null,
): void {
  if (artilleryUnits.length === 0) return;
  const maxRange = UNIT_SPECS.ARTILLERY.attackRange;

  ctx.save();
  for (const unit of artilleryUnits) {
    const sc = camera.worldToScreen(unit.x, unit.y);
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, maxRange * camera.zoom, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(245, 162, 74, 0.05)';
    ctx.fill();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(248, 182, 92, 0.78)';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (hoverCell) {
    const sc = camera.worldToScreen(hoverCell.x, hoverCell.y);
    const ix = Math.floor(hoverCell.x);
    const iy = Math.floor(hoverCell.y);
    const inBounds = ix >= 0 && ix < state.width && iy >= 0 && iy < state.height;
    const inRange = artilleryUnits.some(
      (u) => Math.hypot(hoverCell.x - u.x, hoverCell.y - u.y) <= maxRange,
    );

    let valid = false;
    let statusLabel = 'Mimo dostřel dělostřelectva';
    if (inBounds) {
      const ownerId = state.owners[iy * state.width + ix];
      const ownerPlayer =
        ownerId >= 0 ? state.players.find((p) => p.id === ownerId) : undefined;
      const isNonWarForeign =
        ownerId >= 0 &&
        ownerId !== state.humanPlayerId &&
        ownerPlayer?.relationToHuman !== 'WAR';

      if (!inRange) {
        statusLabel = 'Cíl mimo dostřel vybraného dělostřelectva';
      } else if (isNonWarForeign) {
        statusLabel = 'Nelze ostřelovat neutrální stát (nejdřív válka)';
      } else {
        valid = true;
        statusLabel = 'CÍLENÁ PALBA DĚLOSTŘELECTVA (klik LMB)';
      }
    }

    const blastPx = ARTILLERY_BLAST_RADIUS * camera.zoom;
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, blastPx, 0, Math.PI * 2);
    ctx.fillStyle = valid ? 'rgba(255, 160, 72, 0.2)' : 'rgba(216, 86, 80, 0.18)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = valid ? '#ffbf66' : '#ef8d86';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(sc.x - 9, sc.y);
    ctx.lineTo(sc.x + 9, sc.y);
    ctx.moveTo(sc.x, sc.y - 9);
    ctx.lineTo(sc.x, sc.y + 9);
    ctx.strokeStyle = valid ? '#ffe8b8' : '#f5b8b4';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(statusLabel).width + 12;
    const labelY = sc.y - blastPx - 16;
    ctx.fillStyle = 'rgba(15, 20, 26, 0.92)';
    ctx.fillRect(sc.x - w * 0.5, labelY - 9, w, 18);
    ctx.strokeStyle = valid ? '#d98e46' : '#b85a54';
    ctx.lineWidth = 1;
    ctx.strokeRect(sc.x - w * 0.5, labelY - 9, w, 18);
    ctx.fillStyle = valid ? '#ffe3b3' : '#f5c2be';
    ctx.fillText(statusLabel, sc.x, labelY + 0.5);
  }

  ctx.restore();
}
