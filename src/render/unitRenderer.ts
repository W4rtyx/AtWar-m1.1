import {
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

function resolveUnitFacingAngle(unit: PublicUnitInfo, isOwn: boolean): number {
  if (
    unit.combatCooldownTicks > 0 &&
    unit.lastCombatTargetX !== null &&
    unit.lastCombatTargetY !== null
  ) {
    return Math.atan2(unit.lastCombatTargetY - unit.y, unit.lastCombatTargetX - unit.x);
  }
  if (unit.targetX !== null && unit.targetY !== null) {
    const dx = unit.targetX - unit.x;
    const dy = unit.targetY - unit.y;
    if (Math.hypot(dx, dy) > 0.4) {
      return Math.atan2(dy, dx);
    }
  }
  return isOwn ? -0.28 : Math.PI - 0.35;
}

function drawUnitPedestal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ownerHex: string,
  isOwn: boolean,
  isSelected: boolean,
  isEncircled: boolean,
  isDropVulnerable: boolean,
  relationToHuman?: string,
): void {
  const rimDepth = Math.max(3, ry * 0.36);

  // 1. Cast ground shadow
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx + 1.5, cy + rimDepth + 1.8, rx * 1.08, ry * 1.06, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(4, 7, 11, 0.56)';
  ctx.fill();

  // 2. Selection / encircled / paradrop aura ring around base
  if (isSelected) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + rimDepth * 0.2, rx + 4.2, ry + 3.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(245, 223, 150, 0.16)';
    ctx.fill();
    ctx.strokeStyle = '#f5df96';
    ctx.lineWidth = 2.0;
    ctx.stroke();
  } else if (isEncircled) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + rimDepth * 0.2, rx + 3.4, ry + 2.8, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(235, 92, 84, 0.92)';
    ctx.lineWidth = 1.7;
    ctx.stroke();
  } else if (isDropVulnerable) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + rimDepth * 0.2, rx + 3.2, ry + 2.6, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(118, 214, 244, 0.86)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 3. 3D Extruded pedestal lower wall
  ctx.beginPath();
  ctx.ellipse(cx, cy + rimDepth, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#0d131a';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Team color side band
  ctx.beginPath();
  ctx.ellipse(cx, cy + rimDepth * 0.55, rx * 0.98, ry * 0.98, 0, 0, Math.PI);
  ctx.strokeStyle = ownerHex;
  ctx.lineWidth = Math.max(1.8, rimDepth * 0.55);
  ctx.stroke();

  // 4. Beveled upper pedestal deck with radial gradient
  const deckGrad = ctx.createRadialGradient(
    cx - rx * 0.3,
    cy - ry * 0.4,
    rx * 0.12,
    cx,
    cy,
    rx * 1.05,
  );
  if (isOwn) {
    deckGrad.addColorStop(0, '#2a4156');
    deckGrad.addColorStop(0.65, '#192938');
    deckGrad.addColorStop(1, '#101a24');
  } else {
    deckGrad.addColorStop(0, '#3a2429');
    deckGrad.addColorStop(0.65, '#27171b');
    deckGrad.addColorStop(1, '#180f12');
  }

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = deckGrad;
  ctx.fill();

  // Top faction rim bevel
  ctx.lineWidth = isSelected ? 2.0 : 1.6;
  ctx.strokeStyle = isSelected
    ? '#f7e49e'
    : isEncircled
      ? '#eb766c'
      : isOwn
        ? ownerHex
        : relationToHuman === 'WAR'
          ? '#eb7268'
          : ownerHex;
  ctx.stroke();

  // Inner metallic highlight arc
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.08, rx * 0.82, ry * 0.74, 0, Math.PI * 1.08, Math.PI * 1.92);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function drawUnitModel3D(
  ctx: CanvasRenderingContext2D,
  unit: PublicUnitInfo,
  cx: number,
  cy: number,
  scale: number,
  ownerHex: string,
  facingRad: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  const cosF = Math.cos(facingRad);
  const sinF = Math.sin(facingRad);
  const flipX = cosF < -0.15 ? -1 : 1;

  switch (unit.type) {
    case 'TANK': {
      // Oblique 3/4 armored tank with tracks, sloped hull, rotating turret + barrel
      const s = scale * 1.08;
      ctx.save();
      ctx.scale(flipX, 1);

      // Ground hull shadow
      ctx.fillStyle = 'rgba(4, 7, 11, 0.5)';
      ctx.beginPath();
      ctx.ellipse(0.5 * s, 3.6 * s, 10.5 * s, 4.4 * s, 0, 0, Math.PI * 2);
      ctx.fill();

      // Far track (slightly higher)
      drawRoundedRectPath(ctx, -9.2 * s, -4.4 * s, 18.0 * s, 3.4 * s, 1.5 * s);
      ctx.fillStyle = '#181e24';
      ctx.fill();

      // Main hull chassis (3D beveled olive/steel gradient)
      const hullGrad = ctx.createLinearGradient(-8 * s, -5 * s, 8 * s, 3 * s);
      hullGrad.addColorStop(0, '#96a58e');
      hullGrad.addColorStop(0.45, '#687761');
      hullGrad.addColorStop(1, '#3d483a');
      drawRoundedRectPath(ctx, -8.8 * s, -3.5 * s, 17.6 * s, 5.2 * s, 1.4 * s);
      ctx.fillStyle = hullGrad;
      ctx.fill();
      ctx.strokeStyle = '#1b221a';
      ctx.lineWidth = 0.95;
      ctx.stroke();

      // Faction stripe across front glacis
      ctx.fillStyle = ownerHex;
      ctx.fillRect(4.5 * s, -3.0 * s, 2.2 * s, 4.2 * s);

      // Foreground near track (extruded dark tread + specular road wheels)
      drawRoundedRectPath(ctx, -9.5 * s, 0.4 * s, 18.8 * s, 3.9 * s, 1.8 * s);
      ctx.fillStyle = '#20262c';
      ctx.fill();
      ctx.strokeStyle = '#0e1216';
      ctx.lineWidth = 0.9;
      ctx.stroke();

      ctx.fillStyle = '#687480';
      for (let wx = -6.8; wx <= 6.8; wx += 3.4) {
        ctx.beginPath();
        ctx.arc(wx * s, 2.35 * s, 1.1 * s, 0, Math.PI * 2);
        ctx.fill();
      }

      // Elevated 3D turret shadow + dome
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(-0.4 * s, -2.2 * s, 5.3 * s, 2.8 * s, 0, 0, Math.PI * 2);
      ctx.fill();

      const turretGrad = ctx.createLinearGradient(-4 * s, -7.2 * s, 4 * s, -1.5 * s);
      turretGrad.addColorStop(0, '#c0ceb4');
      turretGrad.addColorStop(0.55, '#7e8f75');
      turretGrad.addColorStop(1, '#485443');
      drawRoundedRectPath(ctx, -4.8 * s, -6.8 * s, 9.2 * s, 4.6 * s, 2.1 * s);
      ctx.fillStyle = turretGrad;
      ctx.fill();
      ctx.strokeStyle = '#1e251d';
      ctx.lineWidth = 0.9;
      ctx.stroke();

      // Cupola highlight rim
      ctx.beginPath();
      ctx.ellipse(-1.4 * s, -6.2 * s, 2.0 * s, 0.9 * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#dce6d2';
      ctx.fill();

      // Rotating 3D cannon barrel (angled slightly in vertical relief toward facing)
      const tilt = Math.max(-0.32, Math.min(0.28, sinF * flipX * 0.25));
      ctx.save();
      ctx.translate(3.4 * s, -4.6 * s);
      ctx.rotate(-0.1 + tilt);
      const barrelGrad = ctx.createLinearGradient(0, -1.1 * s, 0, 1.1 * s);
      barrelGrad.addColorStop(0, '#dde4dc');
      barrelGrad.addColorStop(0.5, '#869484');
      barrelGrad.addColorStop(1, '#394238');
      ctx.fillStyle = barrelGrad;
      ctx.fillRect(0, -1.05 * s, 8.6 * s, 2.1 * s);
      // Muzzle brake
      ctx.fillStyle = '#2d352d';
      ctx.fillRect(7.6 * s, -1.45 * s, 1.7 * s, 2.9 * s);

      if (unit.combatCooldownTicks >= 4) {
        ctx.beginPath();
        ctx.arc(10.2 * s, 0, 3.0 * s, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 224, 128, 0.95)';
        ctx.fill();
      }
      ctx.restore();
      ctx.restore();
      break;
    }

    case 'ARTILLERY': {
      // 3D Field Howitzer: twin spades, dual armored wheels, shield plate & elevated long cannon
      const s = scale * 1.06;
      ctx.save();
      ctx.scale(flipX, 1);

      // Ground shadow
      ctx.fillStyle = 'rgba(4, 7, 11, 0.48)';
      ctx.beginPath();
      ctx.ellipse(0, 3.8 * s, 9.6 * s, 3.8 * s, 0, 0, Math.PI * 2);
      ctx.fill();

      // Spread trail spades anchored left
      ctx.strokeStyle = '#313a42';
      ctx.lineWidth = 2.6 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-1.0 * s, 0.5 * s);
      ctx.lineTo(-9.2 * s, 2.8 * s);
      ctx.moveTo(-1.5 * s, 1.2 * s);
      ctx.lineTo(-8.4 * s, 4.1 * s);
      ctx.stroke();

      ctx.strokeStyle = '#7b8792';
      ctx.lineWidth = 1.1 * s;
      ctx.beginPath();
      ctx.moveTo(-1.5 * s, 0.2 * s);
      ctx.lineTo(-8.8 * s, 2.5 * s);
      ctx.stroke();

      // Rear wheel (depth)
      ctx.beginPath();
      ctx.arc(-0.4 * s, -0.3 * s, 3.3 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#1b2026';
      ctx.fill();

      // Gun shield (slanted 3D armor plate)
      const shieldGrad = ctx.createLinearGradient(0, -6.8 * s, 4 * s, 1.5 * s);
      shieldGrad.addColorStop(0, '#d8b47c');
      shieldGrad.addColorStop(0.5, '#9d7c4c');
      shieldGrad.addColorStop(1, '#584429');
      ctx.beginPath();
      ctx.moveTo(0.2 * s, -6.8 * s);
      ctx.lineTo(3.6 * s, -5.6 * s);
      ctx.lineTo(2.4 * s, 1.4 * s);
      ctx.lineTo(-0.9 * s, 0.5 * s);
      ctx.closePath();
      ctx.fillStyle = shieldGrad;
      ctx.fill();
      ctx.strokeStyle = '#241c11';
      ctx.lineWidth = 0.9;
      ctx.stroke();

      // Long elevated howitzer barrel
      ctx.save();
      ctx.translate(-0.2 * s, -2.0 * s);
      ctx.rotate(-0.56);
      const tubeGrad = ctx.createLinearGradient(0, -1.4 * s, 0, 1.4 * s);
      tubeGrad.addColorStop(0, '#f2ddc0');
      tubeGrad.addColorStop(0.5, '#b68f5c');
      tubeGrad.addColorStop(1, '#523e24');
      ctx.fillStyle = tubeGrad;
      // Breech block + main barrel
      ctx.fillRect(-3.6 * s, -1.65 * s, 5.2 * s, 3.3 * s);
      ctx.fillRect(1.2 * s, -1.15 * s, 10.2 * s, 2.3 * s);
      ctx.fillStyle = '#332818';
      ctx.fillRect(10.6 * s, -1.45 * s, 1.6 * s, 2.9 * s);

      if (unit.combatCooldownTicks >= 3) {
        ctx.beginPath();
        ctx.arc(13.2 * s, 0, 3.6 * s, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 198, 92, 0.96)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(13.2 * s, 0, 1.7 * s, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
      ctx.restore();

      // Foreground spoked tire with metallic hub
      ctx.beginPath();
      ctx.arc(0.4 * s, 1.6 * s, 3.7 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#14191f';
      ctx.fill();
      ctx.strokeStyle = '#4c5763';
      ctx.lineWidth = 1.0 * s;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0.4 * s, 1.6 * s, 1.65 * s, 0, Math.PI * 2);
      ctx.fillStyle = ownerHex;
      ctx.fill();
      ctx.restore();
      break;
    }

    case 'INFANTRY': {
      // Plastic 3-soldier staggered tactical squad with 3D helmets, shoulders & rifles
      const s = scale * 1.04;
      const troopers = [
        { ox: -4.8, oy: -2.0, size: 0.86 },
        { ox: 4.8, oy: -1.6, size: 0.86 },
        { ox: 0.0, oy: 1.5, size: 1.02 },
      ];

      for (const tr of troopers) {
        const tx = tr.ox * s;
        const ty = tr.oy * s;
        const r = tr.size * s;

        // Cast ground shadow
        ctx.fillStyle = 'rgba(4, 7, 11, 0.45)';
        ctx.beginPath();
        ctx.ellipse(tx + 0.5 * r, ty + 3.2 * r, 3.1 * r, 1.5 * r, 0, 0, Math.PI * 2);
        ctx.fill();

        // Torso / armor vest with gradient
        const vestGrad = ctx.createLinearGradient(tx - 2.8 * r, ty - 1.5 * r, tx + 2.8 * r, ty + 3.0 * r);
        vestGrad.addColorStop(0, '#c6d4e0');
        vestGrad.addColorStop(0.5, '#7e90a1');
        vestGrad.addColorStop(1, '#3d4954');
        drawRoundedRectPath(ctx, tx - 2.7 * r, ty - 1.4 * r, 5.4 * r, 4.1 * r, 1.7 * r);
        ctx.fillStyle = vestGrad;
        ctx.fill();
        ctx.strokeStyle = '#171e26';
        ctx.lineWidth = 0.85;
        ctx.stroke();

        // Faction collar band
        ctx.fillStyle = ownerHex;
        ctx.fillRect(tx - 1.7 * r, ty - 0.8 * r, 3.4 * r, 1.15 * r);

        // Angled rifle silhouette
        ctx.strokeStyle = '#e7edf2';
        ctx.lineWidth = 1.25 * r;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tx + 0.6 * r * flipX, ty + 0.4 * r);
        ctx.lineTo(tx + 4.3 * r * flipX, ty - 2.3 * r);
        ctx.stroke();

        // 3D Rounded steel helmet with specular dome highlight
        const helmGrad = ctx.createRadialGradient(
          tx - 0.8 * r,
          ty - 3.9 * r,
          0.3 * r,
          tx,
          ty - 3.1 * r,
          2.6 * r,
        );
        helmGrad.addColorStop(0, '#f4f8fc');
        helmGrad.addColorStop(0.55, '#a6b6c4');
        helmGrad.addColorStop(1, '#4c5966');
        ctx.beginPath();
        ctx.arc(tx, ty - 3.1 * r, 2.35 * r, 0, Math.PI * 2);
        ctx.fillStyle = helmGrad;
        ctx.fill();
        ctx.strokeStyle = '#182028';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      break;
    }

    case 'PARATROOPERS': {
      // Shaded 3D ribbed parachute canopy + harness cords + beveled airborne trooper
      const s = scale * 1.05;
      const canopyY = -4.2 * s;
      const canopyRx = 8.4 * s;
      const canopyRy = 5.4 * s;

      // Suspension harness cords
      ctx.strokeStyle = 'rgba(218, 240, 250, 0.85)';
      ctx.lineWidth = 0.95 * s;
      ctx.beginPath();
      ctx.moveTo(-canopyRx * 0.85, canopyY + 0.6 * s);
      ctx.lineTo(-0.8 * s, 2.2 * s);
      ctx.moveTo(-canopyRx * 0.35, canopyY + 0.3 * s);
      ctx.lineTo(-0.3 * s, 2.2 * s);
      ctx.moveTo(canopyRx * 0.35, canopyY + 0.3 * s);
      ctx.lineTo(0.3 * s, 2.2 * s);
      ctx.moveTo(canopyRx * 0.85, canopyY + 0.6 * s);
      ctx.lineTo(0.8 * s, 2.2 * s);
      ctx.stroke();

      // 3D Parachute dome
      const domeGrad = ctx.createRadialGradient(
        -2.2 * s,
        canopyY - 3.4 * s,
        1.0 * s,
        0,
        canopyY,
        canopyRx,
      );
      domeGrad.addColorStop(0, '#f0fbff');
      domeGrad.addColorStop(0.55, '#8dd4ec');
      domeGrad.addColorStop(1, '#3b738f');

      ctx.beginPath();
      ctx.ellipse(0, canopyY, canopyRx, canopyRy, 0, Math.PI, 0);
      ctx.quadraticCurveTo(canopyRx * 0.45, canopyY + 1.2 * s, 0, canopyY);
      ctx.quadraticCurveTo(-canopyRx * 0.45, canopyY + 1.2 * s, -canopyRx, canopyY);
      ctx.closePath();
      ctx.fillStyle = domeGrad;
      ctx.fill();
      ctx.strokeStyle = '#1f4152';
      ctx.lineWidth = 0.95;
      ctx.stroke();

      // Canopy ribs
      ctx.strokeStyle = 'rgba(30, 62, 78, 0.55)';
      ctx.lineWidth = 0.8 * s;
      ctx.beginPath();
      ctx.moveTo(0, canopyY - canopyRy);
      ctx.quadraticCurveTo(-3.2 * s, canopyY - 2.6 * s, -canopyRx * 0.35, canopyY + 0.3 * s);
      ctx.moveTo(0, canopyY - canopyRy);
      ctx.quadraticCurveTo(3.2 * s, canopyY - 2.6 * s, canopyRx * 0.35, canopyY + 0.3 * s);
      ctx.stroke();

      // Trooper figure below harness
      drawRoundedRectPath(ctx, -2.5 * s, 0.2 * s, 5.0 * s, 4.0 * s, 1.5 * s);
      ctx.fillStyle = '#536778';
      ctx.fill();
      ctx.strokeStyle = '#161e26';
      ctx.lineWidth = 0.85;
      ctx.stroke();

      ctx.fillStyle = ownerHex;
      ctx.fillRect(-1.5 * s, 1.3 * s, 3.0 * s, 1.1 * s);

      ctx.beginPath();
      ctx.arc(0, -0.7 * s, 2.0 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#d8eef8';
      ctx.fill();
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
    // Outer expanding tactical wave
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, 5 + t * 18, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(246, 222, 138, ${(alpha * 0.85).toFixed(3)})`;
    ctx.lineWidth = 2.0 - t * 0.8;
    ctx.stroke();

    // Inner bright waypoint diamond
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
  const pedestalRx = 14.2 * scale;
  const pedestalRy = 8.8 * scale;
  const pulse = nowMs > 0 ? 0.5 + 0.5 * Math.sin(nowMs * 0.008) : 0.7;

  // Pass 1: Operational/attack range rings, clear move trajectories with chevrons, and firing/shelling FX
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
        ctx.strokeStyle = 'rgba(238, 172, 92, 0.55)';
        ctx.stroke();
        ctx.restore();
      }

      if (unit.targetX !== null && unit.targetY !== null) {
        const dst = camera.worldToScreen(unit.targetX, unit.targetY);
        const routeColor = unit.attachedOrderId !== null ? '#9cd6f0' : '#f4de8c';
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sc.x, sc.y);
        ctx.lineTo(dst.x, dst.y);
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2.0;
        ctx.strokeStyle = routeColor;
        ctx.stroke();
        ctx.setLineDash([]);

        drawChevronsAlongSegment(ctx, sc.x, sc.y, dst.x, dst.y, routeColor);

        // Pulsing waypoint reticle
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
    }

    if (
      unit.combatCooldownTicks > 0 &&
      unit.lastCombatTargetX !== null &&
      unit.lastCombatTargetY !== null
    ) {
      const tgt = camera.worldToScreen(unit.lastCombatTargetX, unit.lastCombatTargetY);
      ctx.save();
      if (unit.type === 'ARTILLERY') {
        // Parabolic glowing howitzer shell arc + traveling shell + blast flare
        const sDist = Math.hypot(tgt.x - sc.x, tgt.y - sc.y);
        const arcLift = Math.min(60, Math.max(16, sDist * 0.34));
        const ctrlX = (sc.x + tgt.x) * 0.5;
        const ctrlY = Math.min(sc.y, tgt.y) - arcLift;

        ctx.beginPath();
        ctx.moveTo(sc.x, sc.y - 4 * scale);
        ctx.quadraticCurveTo(ctrlX, ctrlY, tgt.x, tgt.y);
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.9;
        ctx.strokeStyle = 'rgba(255, 184, 92, 0.85)';
        ctx.stroke();
        ctx.setLineDash([]);

        // Animated shell orb along Bezier curve
        const flightT = Math.max(0.08, Math.min(1, (6 - unit.combatCooldownTicks) / 5));
        const invT = 1 - flightT;
        const shellX = invT * invT * sc.x + 2 * invT * flightT * ctrlX + flightT * flightT * tgt.x;
        const shellY =
          invT * invT * (sc.y - 4 * scale) + 2 * invT * flightT * ctrlY + flightT * flightT * tgt.y;

        ctx.beginPath();
        ctx.arc(shellX, shellY, 2.7, 0, Math.PI * 2);
        ctx.fillStyle = '#fff2c4';
        ctx.fill();

        // Impact blast burst on last half of cooldown cycle
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

  // Pass 2: Shaded 3D pedestals, plastic 3D unit models, HP/Morale bars, ×N badges & stance icons
  for (const unit of state.units) {
    const sc = camera.worldToScreen(unit.x, unit.y);
    const isSelected = selectedUnitIds.has(unit.id);
    const owner = playerMap.get(unit.ownerId);
    const ownerHex = owner?.colorHex ?? '#8a99a8';
    const isOwn = unit.ownerId === state.humanPlayerId;
    const facingRad = resolveUnitFacingAngle(unit, isOwn);

    drawUnitPedestal(
      ctx,
      sc.x,
      sc.y + 2 * scale,
      pedestalRx,
      pedestalRy,
      ownerHex,
      isOwn,
      isSelected,
      unit.isEncircled,
      unit.dropVulnerabilityTicks > 0,
      owner?.relationToHuman,
    );

    drawUnitModel3D(ctx, unit, sc.x, sc.y - 1 * scale, scale, ownerHex, facingRad);

    ctx.save();

    // HP bar + subtle Morale micro-strip underneath pedestal
    const hpRatio = Math.max(0, Math.min(1, unit.hp / Math.max(1, unit.maxHp)));
    const moraleRatio = Math.max(0, Math.min(1, unit.morale / 100));
    const barW = Math.round(24 * scale);
    const barH = 3.2;
    const barX = sc.x - barW * 0.5;
    const barY = sc.y + pedestalRy + 5.5 * scale;

    ctx.fillStyle = 'rgba(8, 12, 16, 0.92)';
    ctx.fillRect(barX - 0.5, barY - 0.5, barW + 1, barH + 2.8);
    ctx.fillStyle =
      hpRatio > 0.55 ? '#66c989' : hpRatio > 0.28 ? '#dfb25c' : '#df675d';
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    // Thin morale indicator bar directly beneath HP
    ctx.fillStyle =
      moraleRatio > 0.6 ? '#76c5ee' : moraleRatio > 0.3 ? '#e2a854' : '#df675d';
    ctx.fillRect(barX, barY + barH + 0.5, barW * moraleRatio, 1.5);

    // Stack count badge ×N (top-right of pedestal)
    if (unit.count > 1) {
      const badgeText = `×${unit.count}`;
      ctx.font = '700 9.5px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const bw = Math.max(16, ctx.measureText(badgeText).width + 6);
      const bx = sc.x + pedestalRx * 0.72;
      const by = sc.y - pedestalRy - 3.5 * scale;
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
      drawPadlockIcon(ctx, sc.x - pedestalRx * 0.78, sc.y - pedestalRy - 2.5 * scale);
    }

    // Encircled indicator (bottom-right)
    if (unit.isEncircled) {
      const ex = sc.x + pedestalRx * 0.85;
      const ey = sc.y + pedestalRy * 0.65;
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
