import {
  BUILDING_SPECS,
  demolishBuilding,
  getUnitBuildCost,
  getValidBuildingsForCell,
  placeBuilding,
  stackBuilding,
} from '../src/engine/buildings';
import { getAirDefenseCoverageAt } from '../src/engine/defenses';
import {
  CAPITAL_BASE_MATERIAL_PER_SEC,
  areNeighbors,
} from '../src/engine/economy';
import {
  BASE_ENERGY_RESERVE_CAPACITY,
  ENERGY_RESERVE_PER_POWER_PLANT,
} from '../src/engine/energyGrid';
import {
  MAX_ORDER_TICKS,
  annexEncircledPockets,
  getRelation,
  setWarRelation,
} from '../src/engine/frontExpansion';
import {
  BOT_COUNT,
  createClientRenderState,
  createEngineController,
  createInitialGameState,
  dispatchAction,
  planSimulationTicks,
} from '../src/engine/simulation';
import {
  BETRAYAL_DEBUFF_TICKS,
  DEMOLISH_REFUND_RATIO,
  GameState,
  MAX_STACK_PER_NODE,
  MIN_BUILDING_SPACING,
  TICK_DT,
  TerrainType,
  WILDERNESS_OWNER,
  getRelationKey,
} from '../src/engine/types';
import {
  UNIT_SPECS,
  queueUnitProduction,
  spawnUnitStack,
} from '../src/engine/units';

declare const console: { log(message: string): void };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function findPlainsLandSpot(
  state: GameState,
  targetX: number,
  targetY: number,
): { x: number; y: number } {
  for (let r = 0; r < 120; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = targetX + dx;
        const y = targetY + dy;
        if (x < 40 || x >= state.width - 40 || y < 40 || y >= state.height - 40) continue;
        if (
          state.terrain[y * state.width + x] === TerrainType.PLAINS &&
          state.owners[y * state.width + x] === WILDERNESS_OWNER
        ) {
          return { x, y };
        }
      }
    }
  }
  throw new Error('Could not find valid plains start spot');
}

function findInlandPlainsCenter(
  state: GameState,
  halfW: number,
  halfH: number,
): { x: number; y: number } {
  for (let cy = 220; cy < state.height - halfH - 20; cy += 4) {
    for (let cx = 360; cx < state.width - halfW - 20; cx += 4) {
      let allLand = true;
      for (let y = cy - halfH; y <= cy + halfH && allLand; y += 2) {
        for (let x = cx - halfW; x <= cx + halfW; x += 2) {
          if (state.terrain[y * state.width + x] === TerrainType.WATER) {
            allLand = false;
            break;
          }
        }
      }
      if (allLand) {
        return { x: cx, y: cy };
      }
    }
  }
  throw new Error('Could not find inland plains rectangle');
}

function paintBlock(
  state: GameState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ownerId: number,
): number[] {
  const painted: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = y * state.width + x;
      if (state.terrain[idx] !== TerrainType.WATER) {
        state.owners[idx] = ownerId;
        painted.push(idx);
      }
    }
  }
  return painted;
}

function testDeclareWarFromUiController(): void {
  const engine = createEngineController(4242);
  const preState = engine.getRenderState();
  let startX = 240;
  let startY = 260;
  for (let y = 200; y < 340; y++) {
    let found = false;
    for (let x = 200; x < 360; x++) {
      if (preState.terrain[y * preState.width + x] === TerrainType.PLAINS) {
        startX = x;
        startY = y;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  engine.dispatch({ type: 'SELECT_START_POSITION', x: startX, y: startY });
  const before = engine.getRenderState();
  const targetBot = before.players.find((p) => p.isBot && p.alive);
  assert(targetBot !== undefined, 'Bot opponent should exist');
  assert(
    targetBot!.relationToHuman === 'NEUTRAL',
    `Initial relation should be NEUTRAL (got ${targetBot!.relationToHuman})`,
  );

  engine.dispatch({
    type: 'DECLARE_WAR',
    actorId: before.humanPlayerId,
    targetId: targetBot!.id,
  });

  const after = engine.getRenderState();
  const updatedBot = after.players.find((p) => p.id === targetBot!.id);
  assert(
    updatedBot?.relationToHuman === 'WAR',
    `DECLARE_WAR UI action must immediately set relationToHuman to WAR (got ${updatedBot?.relationToHuman})`,
  );
  console.log('PASS [a]: UI DECLARE_WAR action immediately sets WAR in client render state.');
}

function testStrictDeterministicPocketAnnexation(): void {
  const state = createInitialGameState(5151);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const enemyId = 3;
  const thirdStateId = 4;
  setWarRelation(state, humanId, enemyId);

  const center = findInlandPlainsCenter(state, 26, 18);
  const cx = center.x;
  const cy = center.y;

  // 1. 100% landlocked pocket surrounded solely by humanId -> MUST annex
  paintBlock(state, cx - 16, cy - 12, cx + 16, cy + 12, humanId);
  const purePocket = paintBlock(state, cx - 2, cy - 2, cx + 2, cy + 2, enemyId);

  // 2. Pocket touching WATER -> MUST NOT annex
  let waterCellX = -1;
  let waterCellY = -1;
  for (let y = 120; y < 380 && waterCellX === -1; y++) {
    for (let x = 120; x < 620; x++) {
      if (
        state.terrain[y * state.width + x] === TerrainType.WATER &&
        state.terrain[y * state.width + (x + 1)] !== TerrainType.WATER &&
        state.terrain[y * state.width + (x + 6)] !== TerrainType.WATER &&
        state.terrain[(y - 2) * state.width + (x + 2)] !== TerrainType.WATER &&
        state.terrain[(y + 2) * state.width + (x + 2)] !== TerrainType.WATER
      ) {
        waterCellX = x + 1;
        waterCellY = y;
        break;
      }
    }
  }
  assert(waterCellX !== -1, 'Should find a coastal land tile adjacent to water');
  paintBlock(state, waterCellX, waterCellY - 3, waterCellX + 6, waterCellY + 3, humanId);
  const coastalPocket = paintBlock(
    state,
    waterCellX,
    waterCellY - 1,
    waterCellX + 2,
    waterCellY + 1,
    enemyId,
  );

  // 3. Pocket touching map edge (x === 0) -> MUST NOT annex
  let edgeY = -1;
  for (let y = 40; y < state.height - 40; y++) {
    if (
      state.terrain[y * state.width] !== TerrainType.WATER &&
      state.terrain[y * state.width + 1] !== TerrainType.WATER
    ) {
      edgeY = y;
      break;
    }
  }
  let edgePocket: number[] = [];
  if (edgeY !== -1) {
    paintBlock(state, 0, edgeY - 3, 5, edgeY + 3, humanId);
    edgePocket = paintBlock(state, 0, edgeY - 1, 2, edgeY + 1, enemyId);
  }

  // 4. Pocket bordered by TWO different states (humanId and thirdStateId) -> MUST NOT annex
  const sharedPocket = paintBlock(state, cx + 10, cy - 2, cx + 12, cy + 2, enemyId);
  paintBlock(state, cx + 13, cy - 4, cx + 18, cy + 4, thirdStateId);

  const annexed = annexEncircledPockets(state);
  assert(annexed, 'Pure enclosed pocket should trigger annexation');

  for (const idx of purePocket) {
    assert(
      state.owners[idx] === humanId,
      `100% landlocked pocket cell ${idx} must be annexed to human`,
    );
  }
  for (const idx of coastalPocket) {
    assert(
      state.owners[idx] === enemyId,
      `Coastal pocket cell ${idx} touching water must NOT be annexed`,
    );
  }
  for (const idx of edgePocket) {
    assert(
      state.owners[idx] === enemyId,
      `Map-edge pocket cell ${idx} must NOT be annexed`,
    );
  }
  for (const idx of sharedPocket) {
    assert(
      state.owners[idx] === enemyId,
      `Multi-neighbor pocket cell ${idx} must NOT be annexed`,
    );
  }
  console.log('PASS [b]: Strictly deterministic pocket annexation verified.');
}

function testOrganicDoubleTapSurgeShape(): void {
  const state = createInitialGameState(8484);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;
  const center = findInlandPlainsCenter(state, 35, 35);
  const cx = center.x;
  const cy = center.y;

  // Clear a large plains arena to wilderness and place a clean human circular base
  paintBlock(state, cx - 34, cy - 34, cx + 34, cy + 34, WILDERNESS_OWNER);
  for (let y = cy - 10; y <= cy + 10; y++) {
    for (let x = cx - 10; x <= cx + 10; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= 100) {
        state.owners[y * state.width + x] = humanId;
      }
    }
  }

  const beforeOwned = new Set<number>();
  for (let y = cy - 34; y <= cy + 34; y++) {
    for (let x = cx - 34; x <= cx + 34; x++) {
      const idx = y * state.width + x;
      if (state.owners[idx] === humanId) {
        beforeOwned.add(idx);
      }
    }
  }

  human.manpower = 420;
  dispatchAction(state, {
    type: 'BORDER_SURGE_PUSH',
    playerId: humanId,
    x: cx + 14,
    y: cy,
    manpowerPercent: 60,
  });

  assert(state.frontPushOrders.length === 1, 'BORDER_SURGE_PUSH order created');
  for (let t = 0; t < 8; t++) {
    dispatchAction(state, { type: 'TICK' });
  }

  let newCells = 0;
  let minX = state.width;
  let maxX = -1;
  let minY = state.height;
  let maxY = -1;

  for (let y = cy - 34; y <= cy + 34; y++) {
    for (let x = cx - 34; x <= cx + 34; x++) {
      const idx = y * state.width + x;
      if (state.owners[idx] === humanId && !beforeOwned.has(idx)) {
        newCells++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  assert(newCells >= 35, `Double-tap surge should capture organic territory (got ${newCells})`);
  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const fillRatio = newCells / (boxW * boxH);
  const cornersFilled =
    (state.owners[minY * state.width + minX] === humanId ? 1 : 0) +
    (state.owners[minY * state.width + maxX] === humanId ? 1 : 0) +
    (state.owners[maxY * state.width + minX] === humanId ? 1 : 0) +
    (state.owners[maxY * state.width + maxX] === humanId ? 1 : 0);

  assert(
    cornersFilled < 4 && fillRatio < 0.88,
    `Surge expansion must be organic/rounded rather than rectangular (fill=${fillRatio.toFixed(2)}, corners=${cornersFilled})`,
  );
  console.log(
    `PASS [c]: Organic double-tap surge verified (cells=${newCells}, fill=${fillRatio.toFixed(2)}, corners=${cornersFilled}/4).`,
  );
}

function testBidirectionalWarAndCrossArrowCounterAttack(): void {
  const state = createInitialGameState(4242);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const botId = 2;
  const bot = state.players.get(botId);
  const human = state.players.get(humanId);
  assert(bot !== undefined && human !== undefined, 'Human and bot should exist');

  const center = findInlandPlainsCenter(state, 24, 14);
  const bx = center.x;
  const by = center.y;

  paintBlock(state, bx - 14, by - 12, bx + 20, by + 12, humanId);
  const botCells = paintBlock(state, bx, by - 4, bx + 6, by + 4, botId);
  assert(botCells.length >= 40, 'Bot salient should contain land cells');

  setWarRelation(state, botId, humanId);
  assert(
    getRelation(state, humanId, botId) === 'WAR' &&
      getRelation(state, botId, humanId) === 'WAR',
    'WAR relation must be bidirectional',
  );

  human!.manpower = 400;
  dispatchAction(state, {
    type: 'CREATE_ATTACK_ORDER',
    playerId: humanId,
    waypoints: [
      { x: bx - 5, y: by },
      { x: bx + 3, y: by },
      { x: bx + 13, y: by },
    ],
    manpowerPercent: 50,
  });

  for (let t = 0; t < 20; t++) {
    dispatchAction(state, { type: 'TICK' });
  }

  let remainingBotCells = 0;
  for (const idx of botCells) {
    if (state.owners[idx] === botId) {
      remainingBotCells++;
    }
  }
  assert(
    remainingBotCells < botCells.length,
    `Player counter-attack must capture bot salient cells (${remainingBotCells}/${botCells.length})`,
  );
  console.log('PASS [d]: Bidirectional WAR & cross-salient counter-attack verified.');
}

function testLongBlockedArrowTerminationAndRefund(): void {
  const state = createInitialGameState(6262);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;
  const neutralBotId = 4;

  const center = findInlandPlainsCenter(state, 16, 16);
  const ox = center.x;
  const oy = center.y;

  paintBlock(state, ox - 14, oy - 14, ox + 14, oy + 14, neutralBotId);
  paintBlock(state, ox - 3, oy - 3, ox + 3, oy + 3, humanId);

  human.manpower = 400;
  const preCommit = human.manpower;
  dispatchAction(state, {
    type: 'CREATE_ATTACK_ORDER',
    playerId: humanId,
    waypoints: [
      { x: ox, y: oy },
      { x: ox + 220, y: oy },
    ],
    manpowerPercent: 50,
  });

  const postCommit = human.manpower;
  assert(postCommit < preCommit, 'Manpower deducted upon order launch');

  for (let t = 0; t < MAX_ORDER_TICKS + 5; t++) {
    dispatchAction(state, { type: 'TICK' });
  }

  const remainingHumanOrders = state.attackOrders.filter(
    (o) => o.playerId === humanId,
  );
  assert(
    remainingHumanOrders.length === 0,
    'Blocked long arrow must terminate cleanly',
  );
  assert(
    human.manpower > postCommit + 150,
    `Unused manpower must be refunded to player (${human.manpower} vs postCommit ${postCommit})`,
  );
  console.log('PASS [e]: Long arrow termination & unused manpower refund verified.');
}

function testAntiDeathSpiralUnderMultiBotAttack(): void {
  const state = createInitialGameState(7373);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;

  const center = findInlandPlainsCenter(state, 32, 32);
  const cx = center.x;
  const cy = center.y;

  paintBlock(state, cx - 22, cy - 22, cx + 22, cy + 22, humanId);
  paintBlock(state, cx - 30, cy - 10, cx - 23, cy + 10, 2);
  paintBlock(state, cx + 23, cy - 10, cx + 30, cy + 10, 3);
  paintBlock(state, cx - 10, cy - 30, cx + 10, cy - 23, 4);

  setWarRelation(state, 2, humanId);
  setWarRelation(state, 3, humanId);
  setWarRelation(state, 4, humanId);

  dispatchAction(state, { type: 'TICK' });
  human.manpower = 4;

  for (const [bId, bx, by, tx, ty] of [
    [2, cx - 24, cy, cx - 10, cy],
    [3, cx + 24, cy, cx + 10, cy],
    [4, cx, cy - 24, cx, cy - 10],
  ] as const) {
    const bot = state.players.get(bId)!;
    bot.manpower = 400;
    dispatchAction(state, {
      type: 'CREATE_ATTACK_ORDER',
      playerId: bId,
      waypoints: [
        { x: bx, y: by },
        { x: tx, y: ty },
      ],
      manpowerPercent: 50,
    });
  }

  for (let t = 0; t < 35; t++) {
    dispatchAction(state, { type: 'TICK' });
  }

  assert(
    human.manpower >= 30,
    `Human manpower must recover from 4 MP instead of death-spiraling (got ${human.manpower.toFixed(1)})`,
  );

  dispatchAction(state, {
    type: 'CREATE_ATTACK_ORDER',
    playerId: humanId,
    waypoints: [
      { x: cx - 18, y: cy },
      { x: cx - 28, y: cy },
    ],
    manpowerPercent: 50,
  });
  assert(
    state.attackOrders.some((o) => o.playerId === humanId),
    'Recovered player must be able to issue a counter-attack order',
  );
  console.log('PASS [f]: Anti-death-spiral manpower safeguard verified.');
}

function findSpacedOwnedSpot(
  state: GameState,
  playerId: number,
  nearX: number,
  nearY: number,
  maxSearchR: number,
  requireOutsideAllZones: boolean,
): { x: number; y: number } | null {
  for (let r = 0; r <= maxSearchR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = nearX + dx;
        const y = nearY + dy;
        if (x < 0 || x >= state.width || y < 0 || y >= state.height) continue;
        const idx = y * state.width + x;
        if (state.terrain[idx] === TerrainType.WATER || state.owners[idx] !== playerId) {
          continue;
        }
        let tooClose = false;
        for (const b of state.buildings) {
          if (Math.hypot(b.x - x, b.y - y) < MIN_BUILDING_SPACING) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        if (requireOutsideAllZones) {
          let insideZone = false;
          for (const z of state.publicResourceZones) {
            if (Math.hypot(x - z.centerX, y - z.centerY) <= z.radius) {
              insideZone = true;
              break;
            }
          }
          if (insideZone) continue;
        }
        return { x, y };
      }
    }
  }
  return null;
}

function testSpeedUpRealTimeRatio(): void {
  const simulateRealSecond = (fps: number, simSpeed: number): number => {
    const dt = 1 / fps;
    let accum = 0;
    let totalTicks = 0;
    for (let frameIdx = 0; frameIdx < fps; frameIdx++) {
      const plan = planSimulationTicks(accum, dt, simSpeed);
      totalTicks += plan.ticksToRun;
      accum = plan.nextAccumulatorSec;
    }
    return totalTicks;
  };

  for (const fps of [60, 30]) {
    const ticks1x = simulateRealSecond(fps, 1);
    const ticks10x = simulateRealSecond(fps, 10);
    const ticks50x = simulateRealSecond(fps, 50);
    assert(ticks1x === 10, `At ${fps} FPS 1x must advance 10 ticks/s (got ${ticks1x})`);
    assert(ticks10x === 100, `At ${fps} FPS 10x must advance 100 ticks/s (got ${ticks10x})`);
    assert(ticks50x === 500, `At ${fps} FPS 50x must advance 500 ticks/s (got ${ticks50x})`);
  }

  const engine = createEngineController(9191);
  const pre = engine.getRenderState();
  let startX = 240;
  let startY = 260;
  for (let y = 200; y < 340; y++) {
    let found = false;
    for (let x = 200; x < 360; x++) {
      if (pre.terrain[y * pre.width + x] === TerrainType.PLAINS) {
        startX = x;
        startY = y;
        found = true;
        break;
      }
    }
    if (found) break;
  }
  engine.dispatch({ type: 'SELECT_START_POSITION', x: startX, y: startY });

  assert(
    planSimulationTicks(0, 1 / 60, 50).ticksToRun >= 8,
    '50x speed-up at 60 FPS must allow >= 8 ticks per frame without premature throttling',
  );

  let accum = 0;
  const tStart = Date.now();
  for (let f = 0; f < 60; f++) {
    const plan = planSimulationTicks(accum, 1 / 60, 10);
    for (let t = 0; t < plan.ticksToRun; t++) {
      engine.dispatch({ type: 'TICK' });
    }
    accum = plan.nextAccumulatorSec;
  }
  const elapsedMs = Date.now() - tStart;
  const after = engine.getRenderState();
  assert(
    Math.abs(after.tick * TICK_DT - 10) < 0.001,
    `10x speed-up over 1.0 real second must advance timer to 10.0s (got ${(after.tick * TICK_DT).toFixed(2)}s)`,
  );
  assert(
    elapsedMs < 1500,
    `100 simulation ticks must execute quickly without freezing UI (took ${elapsedMs}ms)`,
  );
  console.log(
    `PASS [g]: Real-time 1x/10x/50x speed-up scaling verified (100 ticks in ${elapsedMs}ms).`,
  );
}

function testBuildingsFreePowerPlantAndResourceZones(): void {
  const controller = createEngineController(3131);
  const pre = controller.getRenderState();
  let sx = 240;
  let sy = 260;
  for (let y = 200; y < 340; y++) {
    let ok = false;
    for (let x = 200; x < 360; x++) {
      if (pre.terrain[y * pre.width + x] === TerrainType.PLAINS) {
        sx = x;
        sy = y;
        ok = true;
        break;
      }
    }
    if (ok) break;
  }
  controller.dispatch({ type: 'SELECT_START_POSITION', x: sx, y: sy });
  const sanitized = controller.getRenderState();
  const rawJson = JSON.stringify({
    players: sanitized.players,
    buildings: sanitized.buildings,
    publicResourceZones: sanitized.publicResourceZones,
    tradeAgreements: sanitized.tradeAgreements,
  });
  assert(!rawJson.includes('optimumX'), 'ClientRenderState must never expose optimumX');
  assert(!rawJson.includes('optimumY'), 'ClientRenderState must never expose optimumY');
  assert(
    !('secretResourceZones' in sanitized),
    'ClientRenderState must never contain secretResourceZones',
  );
  assert(
    sanitized.buildings.every((b) => b.ownerId === sanitized.humanPlayerId),
    'ClientRenderState must not leak opponent buildings',
  );

  const state = createInitialGameState(3232);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;
  human.money = 5000;
  human.buildingMaterial = 2500;
  human.industry = 1000;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 9999;
  }

  // 1st Power Plant MUST be free
  const pp1Spot = findSpacedOwnedSpot(state, humanId, human.capitalX, human.capitalY, 13, false);
  assert(pp1Spot !== null, 'Should find valid spot near capital for 1st Power Plant');
  const moneyBeforeFree = human.money;
  const matBeforeFree = human.buildingMaterial;
  const pp1 = placeBuilding(state, humanId, 'POWER_PLANT', pp1Spot!.x, pp1Spot!.y);
  assert(pp1 !== null, '1st Power Plant placement must succeed');
  assert(human.freePowerPlantUsed === true, 'freePowerPlantUsed must flip true');
  assert(
    human.money === moneyBeforeFree && human.buildingMaterial === matBeforeFree,
    '1st Power Plant must cost 0 money and 0 buildingMaterial',
  );

  // Spacing check: < MIN_BUILDING_SPACING must fail
  const tooClose = placeBuilding(state, humanId, 'MINE', pp1Spot!.x + 3, pp1Spot!.y);
  assert(tooClose === null, 'Placement closer than MIN_BUILDING_SPACING must be rejected');

  // 2nd Power Plant MUST deduct progressive unit cost
  const expectedPp2 = getUnitBuildCost('POWER_PLANT', 1, false);
  const pp2Spot = findSpacedOwnedSpot(state, humanId, human.capitalX, human.capitalY, 14, false);
  assert(pp2Spot !== null, 'Should find spot for 2nd Power Plant');
  const pp2 = placeBuilding(state, humanId, 'POWER_PLANT', pp2Spot!.x, pp2Spot!.y);
  assert(pp2 !== null, '2nd Power Plant placement must succeed');
  assert(
    human.money === moneyBeforeFree - expectedPp2.money &&
      human.buildingMaterial === matBeforeFree - expectedPp2.buildingMaterial,
    `2nd Power Plant must deduct ${expectedPp2.money} money and ${expectedPp2.buildingMaterial} buildingMaterial`,
  );

  // Locate a CONSTRUCTION_MATERIAL zone with an optimum spot and a distant in-zone edge spot
  let chosenOpt: { x: number; y: number } | null = null;
  let chosenEdge: { x: number; y: number } | null = null;
  for (const pub of state.publicResourceZones) {
    if (pub.type !== 'CONSTRUCTION_MATERIAL') continue;
    const sec = state.secretResourceZones.find((s) => s.zoneId === pub.id);
    if (!sec) continue;
    // Paint circle to human cleanly
    let edgeCand: { x: number; y: number } | null = null;
    for (let dy = -pub.radius; dy <= pub.radius; dy++) {
      for (let dx = -pub.radius; dx <= pub.radius; dx++) {
        if (dx * dx + dy * dy > pub.radius * pub.radius) continue;
        const x = pub.centerX + dx;
        const y = pub.centerY + dy;
        if (x < 0 || x >= state.width || y < 0 || y >= state.height) continue;
        if (state.terrain[y * state.width + x] === TerrainType.WATER) continue;
        const dOpt = Math.hypot(x - sec.optimumX, y - sec.optimumY);
        if (dOpt >= MIN_BUILDING_SPACING + 2) {
          let clear = true;
          for (const b of state.buildings) {
            if (Math.hypot(b.x - x, b.y - y) < MIN_BUILDING_SPACING + 1) {
              clear = false;
              break;
            }
          }
          if (clear && (!edgeCand || dOpt > Math.hypot(edgeCand.x - sec.optimumX, edgeCand.y - sec.optimumY))) {
            edgeCand = { x, y };
          }
        }
      }
    }
    let optClear = state.terrain[sec.optimumY * state.width + sec.optimumX] !== TerrainType.WATER;
    for (const b of state.buildings) {
      if (Math.hypot(b.x - sec.optimumX, b.y - sec.optimumY) < MIN_BUILDING_SPACING + 1) {
        optClear = false;
      }
    }
    if (optClear && edgeCand) {
      paintBlock(
        state,
        Math.max(0, pub.centerX - pub.radius),
        Math.max(0, pub.centerY - pub.radius),
        Math.min(state.width - 1, pub.centerX + pub.radius),
        Math.min(state.height - 1, pub.centerY + pub.radius),
        humanId,
      );
      chosenOpt = { x: sec.optimumX, y: sec.optimumY };
      chosenEdge = edgeCand;
      break;
    }
  }
  assert(chosenOpt !== null && chosenEdge !== null, 'Should find valid material zone opt & edge');

  const optMine = placeBuilding(state, humanId, 'MINE', chosenOpt!.x, chosenOpt!.y);
  const edgeMine = placeBuilding(state, humanId, 'MINE', chosenEdge!.x, chosenEdge!.y);
  assert(optMine !== null && edgeMine !== null, 'Both in-zone mines should build');

  const outsideArea = findInlandPlainsCenter(state, 16, 16);
  paintBlock(state, outsideArea.x - 10, outsideArea.y - 10, outsideArea.x + 10, outsideArea.y + 10, humanId);
  const outSpot = findSpacedOwnedSpot(state, humanId, outsideArea.x, outsideArea.y, 8, true);
  assert(outSpot !== null, 'Should find outside-zone land spot');
  const outsideMine = placeBuilding(state, humanId, 'MINE', outSpot!.x, outSpot!.y);
  assert(outsideMine !== null, 'Outside-zone mine should build');

  assert(
    optMine!.revealedEfficiencyPct === null &&
      edgeMine!.revealedEfficiencyPct === null &&
      outsideMine!.revealedEfficiencyPct === null,
    'Resource zone efficiency must stay hidden (null) until first construction completes',
  );

  for (let t = 0; t < BUILDING_SPECS.MINE.constructionTicks; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    optMine!.stackCount === 1 && edgeMine!.stackCount === 1 && outsideMine!.stackCount === 1,
    'Mines must complete construction after constructionTicks',
  );
  assert(
    optMine!.revealedEfficiencyPct !== null &&
      edgeMine!.revealedEfficiencyPct !== null &&
      outsideMine!.revealedEfficiencyPct !== null,
    'Completed mines must reveal site efficiency',
  );
  assert(
    optMine!.revealedEfficiencyPct! >= 95,
    `Mine on secret optimum should reveal >= 95% efficiency (got ${optMine!.revealedEfficiencyPct}%)`,
  );
  assert(
    optMine!.revealedEfficiencyPct! > edgeMine!.revealedEfficiencyPct! &&
      edgeMine!.revealedEfficiencyPct! > outsideMine!.revealedEfficiencyPct! &&
      outsideMine!.revealedEfficiencyPct === 35,
    `Site efficiencies must order opt (${optMine!.revealedEfficiencyPct}) > edge (${edgeMine!.revealedEfficiencyPct}) > outside (${outsideMine!.revealedEfficiencyPct}===35)`,
  );

  // Port coastal check
  const inlandPortFail = placeBuilding(state, humanId, 'PORT', outsideArea.x, outsideArea.y);
  assert(inlandPortFail === null, 'PORT must be rejected inland away from water');

  let coastSpot: { x: number; y: number } | null = null;
  for (let y = 120; y < 380 && !coastSpot; y++) {
    for (let x = 120; x < 620; x++) {
      if (
        state.terrain[y * state.width + x] === TerrainType.WATER &&
        state.terrain[y * state.width + (x + 1)] !== TerrainType.WATER
      ) {
        const cx = x + 1;
        let farEnough = true;
        for (const b of state.buildings) {
          if (Math.hypot(b.x - cx, b.y - y) < MIN_BUILDING_SPACING) {
            farEnough = false;
            break;
          }
        }
        if (farEnough) {
          state.owners[y * state.width + cx] = humanId;
          coastSpot = { x: cx, y };
          break;
        }
      }
    }
  }
  assert(coastSpot !== null, 'Should find valid coastal cell');
  const coastPort = placeBuilding(state, humanId, 'PORT', coastSpot!.x, coastSpot!.y);
  assert(coastPort !== null, 'PORT must succeed on coastal land cell');

  // LAB capture keeps previously gained knowledge
  const labSpot = findSpacedOwnedSpot(state, humanId, outsideArea.x, outsideArea.y, 10, false);
  assert(labSpot !== null, 'Should find spot for LAB');
  const lab = placeBuilding(state, humanId, 'LAB', labSpot!.x, labSpot!.y);
  assert(lab !== null, 'LAB placement must succeed');
  assert(lab!.stackCount === 0 && lab!.underConstructionCount === 1, 'LAB must enter construction');
  for (let t = 0; t < BUILDING_SPECS.LAB.constructionTicks + 15; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(lab!.stackCount === 1, 'LAB must finish construction');
  const gainedKnowledge = human.knowledge;
  assert(gainedKnowledge > 1, `Human should have gained knowledge (got ${gainedKnowledge})`);
  const endX = Math.min(state.width - 4, Math.max(lab!.x + 2, outsideArea.x + 13));
  paintBlock(state, outsideArea.x + 11, lab!.y - 3, endX + 3, lab!.y + 3, WILDERNESS_OWNER);
  paintBlock(state, lab!.x - 1, lab!.y - 1, endX, lab!.y + 1, 2);
  dispatchAction(state, { type: 'TICK' });
  assert(lab!.ownerId === 2, 'Captured LAB must transfer ownership to capturer');
  assert(
    human.knowledge >= gainedKnowledge,
    'Previously earned knowledge must NEVER be lost when LAB is lost',
  );
  console.log('PASS [h]: Free 1st Power Plant, resource zone optima, coastal Port & LAB capture verified.');
}

function testManpowerAllocationAnd200Overload(): void {
  const state = createInitialGameState(6464);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;
  const arena = findInlandPlainsCenter(state, 24, 24);
  paintBlock(state, arena.x - 18, arena.y - 18, arena.x + 18, arena.y + 18, humanId);
  dispatchAction(state, { type: 'TICK' });

  human.money = 2000;
  human.buildingMaterial = 1000;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 9999;
  }

  const ppSpot = findSpacedOwnedSpot(state, humanId, arena.x, arena.y, 16, false);
  assert(ppSpot !== null, 'Should find valid spaced spot for POWER_PLANT');
  dispatchAction(state, {
    type: 'PLACE_BUILDING',
    playerId: humanId,
    buildingType: 'POWER_PLANT',
    x: ppSpot!.x,
    y: ppSpot!.y,
  });

  const mineSpot = findSpacedOwnedSpot(state, humanId, arena.x, arena.y, 16, false);
  assert(mineSpot !== null, 'Should find valid spaced spot for MINE');
  dispatchAction(state, {
    type: 'PLACE_BUILDING',
    playerId: humanId,
    buildingType: 'MINE',
    x: mineSpot!.x,
    y: mineSpot!.y,
  });

  const waitTicks = Math.max(
    BUILDING_SPECS.POWER_PLANT.constructionTicks,
    BUILDING_SPECS.MINE.constructionTicks,
  );
  for (let t = 0; t < waitTicks; t++) {
    dispatchAction(state, { type: 'TICK' });
  }

  human.energyReserve = 200;
  human.manpower = Math.min(human.maxManpower, 450);

  const mine = state.buildings.find((b) => b.ownerId === humanId && b.type === 'MINE');
  assert(mine !== undefined && mine.stackCount === 1, 'MINE should be constructed');

  dispatchAction(state, {
    type: 'SET_BUILDING_OCCUPANCY',
    playerId: humanId,
    buildingId: mine!.id,
    occupancyPct: 100,
  });

  const netMat100 = human.buildingMaterialIncomePerSec - CAPITAL_BASE_MATERIAL_PER_SEC;
  const energy100 = mine!.currentEnergyUse;
  const alloc100 = human.allocatedManpower;
  const active100 = human.activeManpower;
  assert(netMat100 > 0 && energy100 > 0, 'MINE should produce material and use energy at 100%');

  dispatchAction(state, {
    type: 'SET_BUILDING_OCCUPANCY',
    playerId: humanId,
    buildingId: mine!.id,
    occupancyPct: 200,
  });

  const netMat200 = human.buildingMaterialIncomePerSec - CAPITAL_BASE_MATERIAL_PER_SEC;
  const energy200 = mine!.currentEnergyUse;
  const alloc200 = human.allocatedManpower;
  const active200 = human.activeManpower;

  const outputRatio = netMat200 / netMat100;
  const energyRatio = energy200 / energy100;
  assert(
    Math.abs(outputRatio - 1.2) < 0.01,
    `200% occupancy must grant +20% output = 1.20x (got ${outputRatio.toFixed(4)})`,
  );
  assert(
    Math.abs(energyRatio - 1.5) < 0.01,
    `200% overload at 80% efficiency must draw 1.50x energy (got ${energyRatio.toFixed(4)})`,
  );
  assert(
    Math.abs(alloc200 - alloc100 - 35) < 0.01 &&
      Math.abs(active100 - active200 - 35) < 0.01,
    '200% MINE occupancy must shift +35 MP from activeManpower to allocatedManpower',
  );

  // Full 100% attack order must ONLY commit activeManpower, leaving building staff intact
  dispatchAction(state, {
    type: 'CREATE_ATTACK_ORDER',
    playerId: humanId,
    waypoints: [
      { x: arena.x + 15, y: arena.y },
      { x: arena.x + 28, y: arena.y },
    ],
    manpowerPercent: 100,
  });
  const humanOrder = state.attackOrders.find((o) => o.playerId === humanId);
  assert(humanOrder !== undefined, 'Attack order should be created');
  assert(
    Math.abs(humanOrder!.manpowerCommitted - active200) < 0.01,
    `Attack order must commit only activeManpower (${active200.toFixed(1)}, got ${humanOrder!.manpowerCommitted.toFixed(1)})`,
  );
  assert(
    Math.abs(human.allocatedManpower - alloc200) < 0.01 && human.activeManpower < 0.01,
    'Building allocatedManpower must remain protected when active forces deploy',
  );
  console.log('PASS [i]: 200% manpower overload (+20% output at 80% efficiency) & active/building separation verified.');
}

function testHomeFrontVsBareWilderness(): void {
  const state = createInitialGameState(7575);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const botId = 2;
  const human = state.players.get(humanId)!;
  const bot = state.players.get(botId)!;

  // Give bot a huge bare wilderness landmass (~3,600+ extra cells) with NO extra cities/buildings
  const widePlains = findInlandPlainsCenter(state, 34, 34);
  for (let y = widePlains.y - 32; y <= widePlains.y + 32; y++) {
    for (let x = widePlains.x - 32; x <= widePlains.x + 32; x++) {
      const idx = y * state.width + x;
      if (state.terrain[idx] !== TerrainType.WATER && state.owners[idx] === WILDERNESS_OWNER) {
        state.owners[idx] = botId;
      }
    }
  }

  // Build compact home-front homeland cleanly around human capital (well away from widePlains)
  for (let y = Math.max(0, human.capitalY - 13); y <= Math.min(state.height - 1, human.capitalY + 13); y++) {
    for (let x = Math.max(0, human.capitalX - 13); x <= Math.min(state.width - 1, human.capitalX + 13); x++) {
      const idx = y * state.width + x;
      if (state.terrain[idx] !== TerrainType.WATER && state.owners[idx] === WILDERNESS_OWNER) {
        state.owners[idx] = humanId;
      }
    }
  }

  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 9999;
  }

  human.money = 3000;
  human.buildingMaterial = 1500;
  for (const bType of ['POWER_PLANT', 'MINE', 'CITY', 'CITY', 'BARRACKS'] as const) {
    const spot = findSpacedOwnedSpot(state, humanId, human.capitalX, human.capitalY, 13, false);
    assert(spot !== null, `Should find valid home-front spot for ${bType}`);
    dispatchAction(state, {
      type: 'PLACE_BUILDING',
      playerId: humanId,
      buildingType: bType,
      x: spot!.x,
      y: spot!.y,
    });
  }
  const humanBuildingCount = state.buildings.filter((b) => b.ownerId === humanId).length;
  assert(
    humanBuildingCount >= 6,
    `Human home-front should have at least 6 buildings including capital (got ${humanBuildingCount})`,
  );

  for (let t = 0; t < BUILDING_SPECS.CITY.constructionTicks; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  dispatchAction(state, { type: 'TICK' });
  human.manpower = Math.round(human.maxManpower * 0.5);
  bot.manpower = Math.round(bot.maxManpower * 0.5);
  dispatchAction(state, { type: 'TICK' });

  assert(
    bot.territoryCells > human.territoryCells * 2,
    `Bare-wilderness bot should hold >2x cells (${bot.territoryCells} vs ${human.territoryCells})`,
  );
  assert(
    human.maxManpower > bot.maxManpower,
    `Home-front state must exceed bare wilderness in maxManpower (${human.maxManpower} vs ${bot.maxManpower})`,
  );
  assert(
    human.manpowerIncomePerSec > bot.manpowerIncomePerSec,
    `Home-front state must exceed bare wilderness in manpower growth (${human.manpowerIncomePerSec.toFixed(1)} vs ${bot.manpowerIncomePerSec.toFixed(1)})`,
  );
  assert(
    human.moneyIncomePerSec > bot.moneyIncomePerSec &&
      human.buildingMaterialIncomePerSec > bot.buildingMaterialIncomePerSec,
    'Home-front infrastructure must beat bare wilderness in money and building material rates',
  );
  console.log('PASS [j]: Home-front Cities/Mines/Barracks outweigh bare wilderness land.');
}

function testNeighborTradeAndBetrayalFine(): void {
  const state = createInitialGameState(8686);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const neighborId = 2;
  const human = state.players.get(humanId)!;
  const neighbor = state.players.get(neighborId)!;

  const arena = findInlandPlainsCenter(state, 24, 16);
  paintBlock(state, arena.x - 16, arena.y - 8, arena.x - 1, arena.y + 8, humanId);
  paintBlock(state, arena.x, arena.y - 8, arena.x + 16, arena.y + 8, neighborId);
  dispatchAction(state, { type: 'TICK' });

  assert(areNeighbors(state, humanId, neighborId), 'Human and Bot 2 must detect shared border');

  let farBotId: number | null = null;
  for (const p of state.players.values()) {
    if (p.id !== humanId && p.id !== neighborId && p.alive && !areNeighbors(state, humanId, p.id)) {
      farBotId = p.id;
      break;
    }
  }
  if (farBotId !== null) {
    dispatchAction(state, { type: 'TOGGLE_TRADE', actorId: humanId, targetId: farBotId });
    assert(
      !state.tradeAgreements.has(getRelationKey(humanId, farBotId)),
      'Trade agreement with non-neighbor must be rejected',
    );
  }

  dispatchAction(state, { type: 'TOGGLE_TRADE', actorId: humanId, targetId: neighborId });
  const tradeKey = getRelationKey(humanId, neighborId);
  assert(state.tradeAgreements.has(tradeKey), 'Trade agreement with neighbor must activate');
  assert(
    human.tradeIncomePerSec > 0 && neighbor.tradeIncomePerSec > 0,
    'Trade must generate passive income for both neighbors',
  );

  neighbor.nextBotDecisionTick = state.tick + 500;
  const tradeBeforeFactory = human.tradeIncomePerSec;
  human.money = 1000;
  human.buildingMaterial = 500;
  const facSpot = findSpacedOwnedSpot(state, humanId, arena.x - 8, arena.y, 7, false);
  assert(facSpot !== null, 'Should find valid spot for FACTORY inside human border block');
  dispatchAction(state, {
    type: 'PLACE_BUILDING',
    playerId: humanId,
    buildingType: 'FACTORY',
    x: facSpot!.x,
    y: facSpot!.y,
  });
  const fac = state.buildings.find((b) => b.ownerId === humanId && b.type === 'FACTORY');
  assert(fac !== undefined, 'FACTORY must enter construction');
  for (let t = 0; t < BUILDING_SPECS.FACTORY.constructionTicks; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(fac!.stackCount === 1, 'FACTORY must complete after constructionTicks');
  assert(
    human.tradeIncomePerSec > tradeBeforeFactory,
    `FACTORY must boost trade income (${human.tradeIncomePerSec.toFixed(2)} > ${tradeBeforeFactory.toFixed(2)})`,
  );

  // Ally and then betray -> 25% treasury loss + debuff + cancelled trade
  dispatchAction(state, { type: 'TOGGLE_ALLIANCE', actorId: humanId, targetId: neighborId });
  assert(getRelation(state, humanId, neighborId) === 'ALLIED', 'Must be ALLIED before betrayal');

  human.money = 1000;
  const preBetrayMoney = human.money;
  dispatchAction(state, { type: 'DECLARE_WAR', actorId: humanId, targetId: neighborId });

  assert(
    Math.abs(human.money - preBetrayMoney * 0.75) < 0.01,
    `Alliance betrayal must fine 25% treasury (expected 750, got ${human.money.toFixed(2)})`,
  );
  assert(
    human.betrayalDebuffTicks === BETRAYAL_DEBUFF_TICKS,
    'Alliance betrayal must apply combat betrayalDebuffTicks',
  );
  assert(
    !state.tradeAgreements.has(tradeKey) && human.tradeIncomePerSec === 0,
    'Declaring war must cancel active trade agreement',
  );
  console.log('PASS [k]: Neighbor trade, Factory boost, and 25% alliance betrayal fine verified.');
}

function testBatchStackingConstructionAndDemolish(): void {
  const state = createInitialGameState(9101);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 9999;
  }

  const arena = findInlandPlainsCenter(state, 24, 24);
  paintBlock(state, arena.x - 18, arena.y - 18, arena.x + 18, arena.y + 18, humanId);
  dispatchAction(state, { type: 'TICK' });

  human.money = 10000;
  human.buildingMaterial = 5000;
  human.industry = 2000;
  human.maxManpower = 800;
  human.manpower = 800;

  const mineSpot = findSpacedOwnedSpot(state, humanId, arena.x, arena.y, 12, false);
  assert(mineSpot !== null, 'Should find valid spot for 5x MINE batch');

  let expected5Cost = 0;
  for (let i = 0; i < 5; i++) {
    expected5Cost += getUnitBuildCost('MINE', i, false).money;
  }
  const moneyBefore5 = human.money;
  dispatchAction(state, {
    type: 'PLACE_BUILDING',
    playerId: humanId,
    buildingType: 'MINE',
    x: mineSpot!.x,
    y: mineSpot!.y,
    batchSize: 5,
  });

  const mine = state.buildings.find((b) => b.ownerId === humanId && b.type === 'MINE');
  assert(mine !== undefined, '5x MINE node must be created');
  assert(mine!.stackCount === 0 && mine!.underConstructionCount === 5, 'Must start with 0 built, 5 queued');
  assert(mine!.revealedEfficiencyPct === null, 'Efficiency stays null until first MINE finishes');
  assert(
    mine!.totalInvestedMoney === expected5Cost && human.money === moneyBefore5 - expected5Cost,
    '5x progressive batch cost must be deducted and recorded accurately',
  );

  for (let t = 0; t < BUILDING_SPECS.MINE.constructionTicks; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    mine!.stackCount === 1 && mine!.underConstructionCount === 4,
    'First unit must complete after constructionTicks leaving 4 queued',
  );
  assert(mine!.revealedEfficiencyPct !== null, 'Efficiency must reveal on first unit completion');
  assert(human.allocatedManpower >= 35, 'Completed MINE must bind staffing manpower');

  dispatchAction(state, {
    type: 'STACK_BUILDING',
    playerId: humanId,
    buildingId: mine!.id,
    batchSize: 5,
  });
  assert(mine!.underConstructionCount === 9, 'STACK_BUILDING +5x must queue 5 extra units');

  const moneyBeforeDem1 = human.money;
  const totalUnits1 = mine!.stackCount + mine!.underConstructionCount;
  const expectedRefund1 = Math.floor(
    mine!.totalInvestedMoney * (1 / totalUnits1) * DEMOLISH_REFUND_RATIO,
  );
  dispatchAction(state, {
    type: 'DEMOLISH_BUILDING',
    playerId: humanId,
    buildingId: mine!.id,
    demolishAll: false,
  });
  assert(
    mine!.stackCount === 1 && mine!.underConstructionCount === 8,
    'Demolish 1x must remove one queued unit first',
  );
  assert(
    human.money === moneyBeforeDem1 + expectedRefund1,
    'Demolish 1x must refund 50% proportional cost',
  );

  // Mid-construction ownership transfer on a separate node
  let mine2Spot: { x: number; y: number } | null = null;
  for (let dy = -14; dy <= 14 && !mine2Spot; dy += 2) {
    for (let dx = -14; dx <= 14; dx += 2) {
      const tx = arena.x + dx;
      const ty = arena.y + dy;
      if (state.owners[ty * state.width + tx] !== humanId) continue;
      let farEnough = true;
      for (const b of state.buildings) {
        if (Math.hypot(b.x - tx, b.y - ty) < MIN_BUILDING_SPACING + 2) {
          farEnough = false;
          break;
        }
      }
      if (farEnough) {
        mine2Spot = { x: tx, y: ty };
        break;
      }
    }
  }
  assert(mine2Spot !== null, 'Should find well-spaced spot for second MINE node');
  dispatchAction(state, {
    type: 'PLACE_BUILDING',
    playerId: humanId,
    buildingType: 'MINE',
    x: mine2Spot!.x,
    y: mine2Spot!.y,
    batchSize: 5,
  });
  const mine2 = state.buildings.find((b) => b.id !== mine!.id && b.type === 'MINE');
  assert(mine2 !== undefined, 'Second MINE node must exist');
  for (let t = 0; t < 5; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(mine2!.stackCount === 0 && mine2!.underConstructionCount === 5, 'mine2 still under construction');
  state.owners[mine2!.y * state.width + mine2!.x] = 2;
  dispatchAction(state, { type: 'TICK' });
  assert(
    mine2!.ownerId === 2 && mine2!.underConstructionCount === 5,
    'Captured node mid-construction must transfer ownership intact',
  );

  // Demolish all on mine -> removes node, refunds 50%, releases manpower
  const moneyBeforeDemAll = human.money;
  const expectedRefundAll = Math.floor(mine!.totalInvestedMoney * DEMOLISH_REFUND_RATIO);
  const allocBeforeDemAll = human.allocatedManpower;
  dispatchAction(state, {
    type: 'DEMOLISH_BUILDING',
    playerId: humanId,
    buildingId: mine!.id,
    demolishAll: true,
  });
  assert(
    !state.buildings.some((b) => b.id === mine!.id),
    'demolishAll must remove non-capital node',
  );
  assert(
    human.money === moneyBeforeDemAll + expectedRefundAll,
    'demolishAll must refund 50% of remaining invested money',
  );
  assert(
    human.allocatedManpower < allocBeforeDemAll,
    'Demolishing completed MINE must immediately release allocated manpower',
  );

  // Capital demolish protection + MAX stack cap
  const cap = state.buildings.find((b) => b.ownerId === humanId && b.isCapital);
  assert(cap !== undefined, 'Capital building must exist');
  assert(
    demolishBuilding(state, humanId, cap!.id, true) === false,
    'Starter capital must never be demolished',
  );
  human.money = 2_000_000;
  human.buildingMaterial = 2_000_000;
  const addedMax = stackBuilding(state, humanId, cap!.id, 'MAX');
  assert(
    addedMax === MAX_STACK_PER_NODE - 1 &&
      cap!.stackCount + cap!.underConstructionCount === MAX_STACK_PER_NODE,
    'MAX stacking onto node must fill up to MAX_STACK_PER_NODE',
  );
  assert(
    stackBuilding(state, humanId, cap!.id, 1) === 0,
    'Cannot stack past MAX_STACK_PER_NODE',
  );
  console.log('PASS [l]: Batch stacking (1x/5x/10x/MAX), construction progress, capture transfer & demolish refund verified.');
}

function testEnergyReserveCapAndCascadingBlackout(): void {
  const c0 = getUnitBuildCost('MINE', 0, false);
  const c1 = getUnitBuildCost('MINE', 1, false);
  const c2 = getUnitBuildCost('MINE', 2, false);
  const cFree = getUnitBuildCost('POWER_PLANT', 0, true);
  assert(
    c0.money === 160 && c1.money > c0.money && c2.money > c1.money,
    `Progressive unit cost scaling (+14%) must hold (${c0.money} < ${c1.money} < ${c2.money})`,
  );
  assert(cFree.money === 0 && cFree.buildingMaterial === 0, 'Free Power Plant must cost 0');

  const state = createInitialGameState(9202);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 9999;
  }

  dispatchAction(state, { type: 'TICK' });
  assert(
    human.energyReserveMax === BASE_ENERGY_RESERVE_CAPACITY,
    `0 completed Power Plants must cap reserve at ${BASE_ENERGY_RESERVE_CAPACITY} (got ${human.energyReserveMax})`,
  );

  const arena = findInlandPlainsCenter(state, 24, 24);
  paintBlock(state, arena.x - 18, arena.y - 18, arena.x + 18, arena.y + 18, humanId);
  dispatchAction(state, { type: 'TICK' });

  human.money = 25000;
  human.buildingMaterial = 15000;
  human.industry = 5000;
  human.maxManpower = 900;
  human.manpower = 900;

  // Build 1st Power Plant -> reserve max becomes 1500 + 2500 = 4000
  const ppSpot = findSpacedOwnedSpot(state, humanId, arena.x, arena.y, 12, false);
  assert(ppSpot !== null, 'Should find valid spot for Power Plant');
  dispatchAction(state, {
    type: 'PLACE_BUILDING',
    playerId: humanId,
    buildingType: 'POWER_PLANT',
    x: ppSpot!.x,
    y: ppSpot!.y,
    batchSize: 1,
  });
  for (let t = 0; t < BUILDING_SPECS.POWER_PLANT.constructionTicks; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  const pp = state.buildings.find((b) => b.ownerId === humanId && b.type === 'POWER_PLANT');
  assert(pp !== undefined && pp.stackCount === 1, '1st Power Plant must complete');
  assert(
    human.energyReserveMax === BASE_ENERGY_RESERVE_CAPACITY + ENERGY_RESERVE_PER_POWER_PLANT,
    `1 Power Plant must cap reserve at 4000 (got ${human.energyReserveMax})`,
  );

  // Stack 2nd unit onto Power Plant -> reserve max becomes 6500 and strictly clamps excess
  dispatchAction(state, {
    type: 'STACK_BUILDING',
    playerId: humanId,
    buildingId: pp!.id,
    batchSize: 1,
  });
  for (let t = 0; t < BUILDING_SPECS.POWER_PLANT.constructionTicks; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(pp!.stackCount === 2, '2nd Power Plant unit must complete');
  const cap2 = BASE_ENERGY_RESERVE_CAPACITY + 2 * ENERGY_RESERVE_PER_POWER_PLANT;
  assert(
    human.energyReserveMax === cap2,
    `2 Power Plants must cap reserve at ${cap2} (got ${human.energyReserveMax})`,
  );

  human.energyReserve = cap2 + 55000;
  dispatchAction(state, { type: 'TICK' });
  assert(
    human.energyReserve === cap2,
    `Cannot hoard excess energy beyond plant-based cap (${human.energyReserve} === ${cap2})`,
  );

  // Scale to 3 PP units (>= 16.8/s even outside energy zones) + 1 FACTORY + 1 LAB (12.0/s total demand)
  dispatchAction(state, {
    type: 'STACK_BUILDING',
    playerId: humanId,
    buildingId: pp!.id,
    batchSize: 1,
  });
  for (const bType of ['FACTORY', 'LAB'] as const) {
    const spot = findSpacedOwnedSpot(state, humanId, arena.x, arena.y, 16, false);
    assert(spot !== null, `Should find spot for ${bType}`);
    dispatchAction(state, {
      type: 'PLACE_BUILDING',
      playerId: humanId,
      buildingType: bType,
      x: spot!.x,
      y: spot!.y,
    });
  }
  for (let t = 0; t < BUILDING_SPECS.LAB.constructionTicks; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(pp!.stackCount === 3, `3rd Power Plant unit must complete (got ${pp!.stackCount})`);

  dispatchAction(state, { type: 'TICK' });
  const preBlackoutMaxMp = human.maxManpower;
  const preBlackoutIndRate = human.industryIncomePerSec;
  const buildingsCountBefore = state.buildings.length;
  assert(
    !human.blackoutActive && human.blackoutSeverity === 0 && preBlackoutIndRate > 4,
    'Healthy grid before outage must have active production and 0 blackout',
  );

  // Turn Power Plants down to 0% occupancy and drain reserve to trigger cascading blackout
  dispatchAction(state, {
    type: 'SET_BUILDING_TYPE_OCCUPANCY',
    playerId: humanId,
    buildingType: 'POWER_PLANT',
    occupancyPct: 0,
  });
  human.energyReserve = 1.0;
  human.manpower = Math.round(preBlackoutMaxMp * 0.75);
  dispatchAction(state, { type: 'TICK' });
  const activeAtBlackoutStart = human.activeManpower;

  for (let t = 0; t < 15; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(human.blackoutActive === true, 'Blackout must activate when reserve hits 0 with deficit');
  const earlySeverity = human.blackoutSeverity;
  assert(earlySeverity > 0 && earlySeverity < 0.8, `Severity must ramp gradually (got ${earlySeverity})`);

  for (let t = 0; t < 65; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    human.blackoutActive === true && human.blackoutSeverity > earlySeverity,
    `Blackout severity must keep climbing while deficit continues (${human.blackoutSeverity.toFixed(3)} > ${earlySeverity.toFixed(3)})`,
  );
  assert(
    human.energySupplyRatio < 0.7,
    `Supply ratio must fall during blackout (got ${human.energySupplyRatio.toFixed(2)})`,
  );
  assert(
    human.industryIncomePerSec < preBlackoutIndRate * 0.75,
    `Industry production must drop under blackout (${human.industryIncomePerSec.toFixed(2)} < ${(preBlackoutIndRate * 0.75).toFixed(2)})`,
  );
  assert(
    human.maxManpower < preBlackoutMaxMp,
    `maxManpower must drop under blackout (${human.maxManpower} < ${preBlackoutMaxMp})`,
  );
  assert(
    human.activeManpower < activeAtBlackoutStart,
    `activeManpower must erode under prolonged blackout (${human.activeManpower.toFixed(1)} < ${activeAtBlackoutStart.toFixed(1)})`,
  );
  assert(
    state.buildings.length === buildingsCountBefore,
    'Buildings and cities must NOT physically collapse or disappear during blackout',
  );

  // Restore Power Plants to 100% -> blackout clears and economy recovers cleanly
  dispatchAction(state, {
    type: 'SET_BUILDING_TYPE_OCCUPANCY',
    playerId: humanId,
    buildingType: 'POWER_PLANT',
    occupancyPct: 100,
  });
  for (let t = 0; t < 110; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    !human.blackoutActive && human.blackoutSeverity === 0,
    `Grid must recover to 0 blackout severity (got active=${human.blackoutActive}, sev=${human.blackoutSeverity})`,
  );
  assert(
    human.energySupplyRatio === 1 && human.energyReserve > 0,
    'Energy supply ratio and reserve buffer must recover after positive energy restored',
  );
  assert(
    human.maxManpower === preBlackoutMaxMp && human.industryIncomePerSec >= preBlackoutIndRate * 0.99,
    `Capacity & production must recover to baseline (${human.maxManpower} === ${preBlackoutMaxMp})`,
  );

  console.log('PASS [m]: Power-plant energy reserve cap, cascading blackout & non-destructive recovery verified.');
}

function testFinishOffTargetAndMultiPocketCleanup(): void {
  const state = createInitialGameState(9303);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const botId = 2;
  const human = state.players.get(humanId)!;
  const bot = state.players.get(botId)!;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 9999;
  }

  const arena = findInlandPlainsCenter(state, 24, 18);
  paintBlock(state, arena.x - 16, arena.y - 12, arena.x - 1, arena.y + 12, humanId);
  paintBlock(state, arena.x, arena.y - 12, arena.x + 16, arena.y + 12, botId);

  // Inflate botId above 2.5% land AND > 140 cells to test large-target rejection
  let grantedExtra = 0;
  for (let i = 0; i < state.owners.length && grantedExtra < 5500; i++) {
    if (state.terrain[i] !== TerrainType.WATER && state.owners[i] === WILDERNESS_OWNER) {
      state.owners[i] = botId;
      grantedExtra++;
    }
  }
  state.stateVersion++;
  dispatchAction(state, { type: 'TICK' });
  assert(bot.territoryCells > 5000, 'Large opponent setup should exceed 2.5% land threshold');

  const snapLarge = createClientRenderState(state);
  const botLargePub = snapLarge.players.find((p) => p.id === botId)!;
  assert(
    botLargePub.finishOffEligible === false && botLargePub.finishOffRequiredManpower === null,
    'Large opponents (> 140 cells & > 2.5% land) must NOT be finishOffEligible',
  );
  dispatchAction(state, {
    type: 'FINISH_OFF_TARGET',
    playerId: humanId,
    targetOwnerId: botId,
  });
  assert(
    state.frontPushOrders.length === 0,
    'FINISH_OFF_TARGET must refuse large opponents',
  );

  // Build 1 human MINE first so allocatedManpower > 0 is protected during Finish Off
  human.money = 2000;
  human.manpower = 480;
  const mineSpot = findSpacedOwnedSpot(state, humanId, arena.x - 11, arena.y - 7, 4, false);
  assert(mineSpot !== null, 'Should find spot for human MINE in finish-off test');
  dispatchAction(state, {
    type: 'PLACE_BUILDING',
    playerId: humanId,
    buildingType: 'MINE',
    x: mineSpot!.x,
    y: mineSpot!.y,
  });
  for (let t = 0; t < BUILDING_SPECS.MINE.constructionTicks; t++) {
    dispatchAction(state, { type: 'TICK' });
  }

  // Clear botId cells and recreate botId as 3 disconnected residual pockets bordering humanId
  for (let i = 0; i < state.owners.length; i++) {
    if (state.owners[i] === botId) {
      state.owners[i] = WILDERNESS_OWNER;
    }
  }
  paintBlock(state, arena.x - 16, arena.y - 12, arena.x + 16, arena.y + 12, humanId);
  const p1 = paintBlock(state, arena.x + 4, arena.y - 6, arena.x + 7, arena.y - 4, botId);
  const p2 = paintBlock(state, arena.x + 6, arena.y + 1, arena.x + 8, arena.y + 3, botId);
  const p3 = paintBlock(state, arena.x - 9, arena.y + 5, arena.x - 7, arena.y + 7, botId);
  const allPocketCells = [...p1, ...p2, ...p3];
  assert(allPocketCells.length === 30, '3 disconnected residual pockets must total 30 cells');
  bot.capitalX = arena.x + 5;
  bot.capitalY = arena.y - 5;
  state.stateVersion++;
  dispatchAction(state, { type: 'TICK' });
  assert(bot.territoryCells === 30, `Bot should hold 30 cells across 3 pockets (got ${bot.territoryCells})`);

  const snapSmall = createClientRenderState(state);
  const botSmallPub = snapSmall.players.find((p) => p.id === botId)!;
  assert(
    botSmallPub.finishOffEligible === true &&
      botSmallPub.finishOffRequiredManpower !== null &&
      botSmallPub.finishOffRequiredManpower > 0,
    'Small adjacent opponent must expose finishOffEligible and dynamic MP estimate',
  );
  const reqMp = botSmallPub.finishOffRequiredManpower!;

  // Insufficient Ready MP -> FINISH_OFF_TARGET must not launch
  human.manpower = human.allocatedManpower + Math.max(1, reqMp - 25);
  dispatchAction(state, {
    type: 'FINISH_OFF_TARGET',
    playerId: humanId,
    targetOwnerId: botId,
  });
  assert(
    state.frontPushOrders.length === 0,
    'FINISH_OFF_TARGET must reject when human activeManpower < finishOffRequiredManpower',
  );

  // Sufficient Ready MP -> auto-declares WAR & sweeps all 3 pockets simultaneously
  human.manpower = human.allocatedManpower + reqMp + 80;
  const allocBefore = human.allocatedManpower;
  assert(allocBefore > 0, 'Must have active building allocatedManpower');

  dispatchAction(state, {
    type: 'FINISH_OFF_TARGET',
    playerId: humanId,
    targetOwnerId: botId,
  });

  assert(
    getRelation(state, humanId, botId) === 'WAR',
    'FINISH_OFF_TARGET must set WAR relation',
  );
  const finishOrder = state.frontPushOrders.find((o) => o.playerId === humanId);
  assert(finishOrder !== undefined, 'FINISH_OFF_TARGET must create frontPushOrder');
  assert(
    finishOrder!.finishOff === true && finishOrder!.sweepAllBorders === true,
    'FINISH_OFF_TARGET order must enable finishOff and sweepAllBorders',
  );
  assert(
    Math.abs(human.allocatedManpower - allocBefore) < 0.01,
    'FINISH_OFF_TARGET must keep building allocatedManpower protected',
  );

  for (let t = 0; t < 35 && bot.territoryCells > 0; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    bot.territoryCells === 0 && !bot.alive && allPocketCells.every((idx) => state.owners[idx] === humanId),
    `All 3 separated opponent pockets must be eliminated by Finish Off (remaining=${bot.territoryCells})`,
  );

  // Verify EngineController.pruneHumanBorderCells clears stale selected border segments
  const ctrl = createEngineController(9404);
  const preCtrl = ctrl.getRenderState();
  let inlandX = 360;
  let inlandY = 260;
  let foundInland = false;
  for (let cy = 200; cy < preCtrl.height - 60 && !foundInland; cy += 4) {
    for (let cx = 360; cx < preCtrl.width - 60; cx += 4) {
      let ok = true;
      for (let dy = -26; dy <= 26 && ok; dy += 2) {
        for (let dx = -26; dx <= 26; dx += 2) {
          if (preCtrl.terrain[(cy + dy) * preCtrl.width + (cx + dx)] === TerrainType.WATER) {
            ok = false;
            break;
          }
        }
      }
      if (ok) {
        inlandX = cx;
        inlandY = cy;
        foundInland = true;
        break;
      }
    }
  }
  assert(foundInland, 'Should find inland spot for border-pruning check');
  ctrl.dispatch({ type: 'SELECT_START_POSITION', x: inlandX, y: inlandY });
  const eastStrip = ctrl.findHumanBorderCellsFromLasso([
    { x: inlandX + 14, y: inlandY - 6 },
    { x: inlandX + 14, y: inlandY + 6 },
  ]);
  assert(eastStrip.length >= 6, 'Should select eastern border cells');
  ctrl.dispatch({
    type: 'BORDER_SURGE_PUSH',
    playerId: ctrl.getRenderState().humanPlayerId,
    x: inlandX + 26,
    y: inlandY,
    manpowerPercent: 85,
  });
  for (let t = 0; t < 16; t++) {
    ctrl.dispatch({ type: 'TICK' });
  }
  const prunedStrip = ctrl.pruneHumanBorderCells(eastStrip, eastStrip.length);
  assert(
    prunedStrip.length === 0,
    `Stale border selection must prune to empty after borders advance (remaining ${prunedStrip.length})`,
  );

  console.log('PASS [n]: FINISH_OFF_TARGET dynamic MP cost, multi-pocket cleanup & stale border pruning verified.');
}

function testDefenseBuildingsTrenchBunkerAndAA(): void {
  const countOwned = (state: GameState, ownerId: number): number => {
    let n = 0;
    for (let i = 0; i < state.owners.length; i++) {
      if (state.owners[i] === ownerId) n++;
    }
    return n;
  };

  const runAttackTrial = (
    defenseType: 'NONE' | 'TRENCH' | 'BUNKER',
  ): { readonly cellsCaptured: number; readonly costPerCell: number } => {
    const state = createInitialGameState(9505);
    const start = findPlainsLandSpot(state, 220, 270);
    dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

    const humanId = state.humanPlayerId;
    const botId = 2;
    const human = state.players.get(humanId)!;
    const bot = state.players.get(botId)!;
    for (const p of state.players.values()) {
      if (p.isBot) p.nextBotDecisionTick = 9999;
    }

    const arena = findInlandPlainsCenter(state, 24, 16);
    paintBlock(state, arena.x - 16, arena.y - 10, arena.x - 1, arena.y + 10, humanId);
    paintBlock(state, arena.x, arena.y - 10, arena.x + 16, arena.y + 10, botId);
    setWarRelation(state, humanId, botId);
    dispatchAction(state, { type: 'TICK' });

    bot.money = 5000;
    bot.buildingMaterial = 5000;
    bot.industry = 5000;
    bot.energyReserve = 2000;
    bot.manpower = 800;

    if (defenseType !== 'NONE') {
      const def = placeBuilding(state, botId, defenseType, arena.x + 3, arena.y, 1);
      assert(def !== null && def.level === 1, `${defenseType} placement must succeed with level 1`);
      for (let t = 0; t < BUILDING_SPECS[defenseType].constructionTicks; t++) {
        dispatchAction(state, { type: 'TICK' });
      }
      assert(def!.stackCount === 1, `${defenseType} must finish construction`);
    }

    bot.energyReserve = 2000;
    bot.manpower = 400 + bot.allocatedManpower;
    human.maxManpower = 1000;
    human.manpower = 600;
    dispatchAction(state, { type: 'TICK' });
    human.manpower = 600;

    const beforeCells = countOwned(state, humanId);
    dispatchAction(state, {
      type: 'CREATE_ATTACK_ORDER',
      playerId: humanId,
      waypoints: [
        { x: arena.x - 1, y: arena.y },
        { x: arena.x + 14, y: arena.y },
      ],
      manpowerPercent: 50,
      targetOwnerId: botId,
    });
    const order = state.attackOrders.find((o) => o.playerId === humanId);
    assert(order !== undefined, `Attack order in ${defenseType} trial must launch`);

    for (let t = 0; t < 12; t++) {
      dispatchAction(state, { type: 'TICK' });
    }
    const cellsCaptured = countOwned(state, humanId) - beforeCells;
    const mpSpent = order!.manpowerCommitted - order!.manpowerRemaining;
    return {
      cellsCaptured,
      costPerCell: mpSpent / Math.max(1, cellsCaptured),
    };
  };

  const undefended = runAttackTrial('NONE');
  const trench = runAttackTrial('TRENCH');
  const bunker = runAttackTrial('BUNKER');

  assert(
    undefended.cellsCaptured > trench.cellsCaptured && trench.cellsCaptured > bunker.cellsCaptured,
    `Defenses must progressively slow enemy advance: none(${undefended.cellsCaptured}) > trench(${trench.cellsCaptured}) > bunker(${bunker.cellsCaptured})`,
  );
  assert(
    trench.costPerCell > undefended.costPerCell && bunker.costPerCell > trench.costPerCell,
    `Defenses must inflict higher attacker MP cost/cell: none(${undefended.costPerCell.toFixed(2)}) < trench(${trench.costPerCell.toFixed(2)}) < bunker(${bunker.costPerCell.toFixed(2)})`,
  );

  // Verify AA_BATTERY radius coverage, stacking and 50% demolish refund
  const state = createInitialGameState(9506);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });
  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 9999;
  }
  const aaArena = findInlandPlainsCenter(state, 24, 14);
  paintBlock(state, aaArena.x - 16, aaArena.y - 10, aaArena.x + 16, aaArena.y + 10, humanId);
  dispatchAction(state, { type: 'TICK' });

  human.money = 8000;
  human.buildingMaterial = 4000;
  human.industry = 4000;
  human.energyReserve = 2000;
  const aaSpot = findSpacedOwnedSpot(state, humanId, aaArena.x, aaArena.y, 10, false);
  assert(aaSpot !== null, 'Should find valid spot for AA_BATTERY');
  dispatchAction(state, {
    type: 'PLACE_BUILDING',
    playerId: humanId,
    buildingType: 'AA_BATTERY',
    x: aaSpot!.x,
    y: aaSpot!.y,
    batchSize: 5,
  });
  const aa = state.buildings.find((b) => b.ownerId === humanId && b.type === 'AA_BATTERY');
  assert(aa !== undefined && aa.underConstructionCount === 5, '5x AA_BATTERY batch should queue');
  for (let t = 0; t < BUILDING_SPECS.AA_BATTERY.constructionTicks; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(aa!.stackCount === 1, 'First AA_BATTERY unit must complete');
  assert(
    getAirDefenseCoverageAt(state.buildings, humanId, aa!.x + 5, aa!.y) > 0,
    'AA_BATTERY must provide air-defense coverage inside radius',
  );
  assert(
    getAirDefenseCoverageAt(state.buildings, humanId, aa!.x + 40, aa!.y) === 0,
    'AA_BATTERY coverage must be 0 outside radius',
  );

  const moneyBeforeDem = human.money;
  const expectedRef = Math.floor(aa!.totalInvestedMoney * DEMOLISH_REFUND_RATIO);
  dispatchAction(state, {
    type: 'DEMOLISH_BUILDING',
    playerId: humanId,
    buildingId: aa!.id,
    demolishAll: true,
  });
  assert(
    !state.buildings.some((b) => b.id === aa!.id) && human.money === moneyBeforeDem + expectedRef,
    'Demolishing AA_BATTERY stack must remove node and refund 50%',
  );

  console.log(
    `PASS [o]: TRENCH & BUNKER slow front and raise casualties (${undefended.cellsCaptured} -> ${trench.cellsCaptured} -> ${bunker.cellsCaptured} cells) + AA_BATTERY verified.`,
  );
}

function testUnitProductionMovementMergeAndParadropAA(): void {
  const state = createInitialGameState(9601);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const enemyId = 2;
  const human = state.players.get(humanId)!;
  const enemy = state.players.get(enemyId)!;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 9999;
  }

  const arena = findInlandPlainsCenter(state, 32, 24);
  paintBlock(state, arena.x - 28, arena.y - 18, arena.x + 8, arena.y + 18, humanId);
  paintBlock(state, arena.x + 9, arena.y - 18, arena.x + 28, arena.y + 18, enemyId);
  setWarRelation(state, humanId, enemyId);
  dispatchAction(state, { type: 'TICK' });

  human.money = 12000;
  human.buildingMaterial = 6000;
  human.industry = 6000;
  human.energyReserve = 2500;
  human.maxManpower = 1500;
  human.manpower = 1200;

  const ppSpot = findSpacedOwnedSpot(state, humanId, arena.x - 16, arena.y - 8, 8, false)!;
  placeBuilding(state, humanId, 'POWER_PLANT', ppSpot.x, ppSpot.y, 5);
  const barSpot = findSpacedOwnedSpot(state, humanId, arena.x - 16, arena.y + 6, 8, false)!;
  const barracks = placeBuilding(state, humanId, 'BARRACKS', barSpot.x, barSpot.y, 1)!;
  const armSpot = findSpacedOwnedSpot(state, humanId, arena.x - 4, arena.y - 8, 8, false)!;
  const armory = placeBuilding(state, humanId, 'ARMORY', armSpot.x, armSpot.y, 1)!;
  const afSpot = findSpacedOwnedSpot(state, humanId, arena.x - 4, arena.y + 6, 8, false)!;
  const airfield = placeBuilding(state, humanId, 'AIRFIELD', afSpot.x, afSpot.y, 1)!;

  for (let t = 0; t < BUILDING_SPECS.AIRFIELD.constructionTicks + 5; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    barracks.stackCount === 1 && armory.stackCount === 1 && airfield.stackCount === 1,
    'Barracks, Armory, and Airfield must finish construction',
  );

  // Produce all 4 ground unit types
  const moneyBefore = human.money;
  dispatchAction(state, {
    type: 'PRODUCE_UNIT',
    playerId: humanId,
    buildingId: barracks.id,
    unitType: 'INFANTRY',
  });
  dispatchAction(state, {
    type: 'PRODUCE_UNIT',
    playerId: humanId,
    buildingId: armory.id,
    unitType: 'TANK',
  });
  dispatchAction(state, {
    type: 'PRODUCE_UNIT',
    playerId: humanId,
    buildingId: armory.id,
    unitType: 'ARTILLERY',
  });
  dispatchAction(state, {
    type: 'PRODUCE_UNIT',
    playerId: humanId,
    buildingId: airfield.id,
    unitType: 'PARATROOPERS',
  });

  const expectedCost =
    UNIT_SPECS.INFANTRY.cost.money +
    UNIT_SPECS.TANK.cost.money +
    UNIT_SPECS.ARTILLERY.cost.money +
    UNIT_SPECS.PARATROOPERS.cost.money;
  assert(
    Math.abs(human.money - (moneyBefore - expectedCost)) < 1,
    'Unit production must deduct exact money cost',
  );

  for (let t = 0; t < 110; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  const humanUnits = state.units.filter((u) => u.ownerId === humanId);
  assert(
    humanUnits.some((u) => u.type === 'INFANTRY') &&
      humanUnits.some((u) => u.type === 'TANK') &&
      humanUnits.some((u) => u.type === 'ARTILLERY') &&
      humanUnits.some((u) => u.type === 'PARATROOPERS'),
    'All 4 ground unit types (INFANTRY, TANK, ARTILLERY, PARATROOPERS) must spawn after productionTicks',
  );

  // Move & Merge two TANK stacks
  const tank1 = humanUnits.find((u) => u.type === 'TANK')!;
  const tank2 = spawnUnitStack(state, humanId, 'TANK', tank1.x + 6, tank1.y);
  dispatchAction(state, {
    type: 'MERGE_UNITS',
    playerId: humanId,
    unitIds: [tank1.id, tank2.id],
  });
  const remainingTanks = state.units.filter((u) => u.ownerId === humanId && u.type === 'TANK');
  assert(
    remainingTanks.length === 1 &&
      remainingTanks[0].count === 2 &&
      remainingTanks[0].hp === 2 * UNIT_SPECS.TANK.hpPerUnit,
    `Nearby same-type units must merge into x2 stack (got len=${remainingTanks.length}, count=${remainingTanks[0]?.count})`,
  );

  const moveTargetX = remainingTanks[0].x - 10;
  const moveTargetY = remainingTanks[0].y;
  const startTankX = remainingTanks[0].x;
  dispatchAction(state, {
    type: 'MOVE_UNITS',
    playerId: humanId,
    unitIds: [remainingTanks[0].id],
    targetX: moveTargetX,
    targetY: moveTargetY,
  });
  for (let t = 0; t < 12; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    remainingTanks[0].x < startTankX - 3,
    `MOVE_UNITS must move tank across plains (${startTankX.toFixed(1)} -> ${remainingTanks[0].x.toFixed(1)})`,
  );

  // Verify TANK slows down on MOUNTAINS compared to PLAINS
  const mtnTank = spawnUnitStack(state, humanId, 'TANK', arena.x - 10, arena.y + 12, 1);
  for (let x = arena.x - 12; x <= arena.x + 2; x++) {
    for (let y = arena.y + 10; y <= arena.y + 14; y++) {
      state.terrain[y * state.width + x] = TerrainType.MOUNTAINS;
    }
  }
  const mtnStartX = mtnTank.x;
  dispatchAction(state, {
    type: 'MOVE_UNITS',
    playerId: humanId,
    unitIds: [mtnTank.id],
    targetX: arena.x + 2,
    targetY: arena.y + 12,
  });
  for (let t = 0; t < 12; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  const plainsDist = startTankX - remainingTanks[0].x;
  const mountainDist = mtnTank.x - mtnStartX;
  assert(
    UNIT_SPECS.TANK.speedMountains < UNIT_SPECS.TANK.speedPlains &&
      mountainDist > 0 &&
      mountainDist < plainsDist * 0.55,
    `TANK must move significantly slower in mountains (${mountainDist.toFixed(2)}) than plains (${plainsDist.toFixed(2)})`,
  );

  // Uncontested paradrop away from AA (before enemy builds AA)
  const para1 = humanUnits.find((u) => u.type === 'PARATROOPERS')!;
  dispatchAction(state, {
    type: 'PARADROP_UNIT',
    playerId: humanId,
    unitId: para1.id,
    targetX: arena.x + 16,
    targetY: arena.y - 12,
  });
  assert(
    para1.canParadrop === false &&
      para1.dropVulnerabilityTicks > 0 &&
      airfield.paradropCooldownTicks > 0 &&
      para1.hp === para1.maxHp,
    'Uncontested paradrop must land cleanly, set vulnerability + cooldown, and consume one-time drop',
  );

  const parkedArty = state.units.find((u) => u.ownerId === humanId && u.type === 'ARTILLERY');
  if (parkedArty) {
    parkedArty.x = human.capitalX + 0.5;
    parkedArty.y = human.capitalY + 0.5;
    parkedArty.targetX = null;
    parkedArty.targetY = null;
    parkedArty.waypoints = [];
  }

  // Build enemy 2x AA_BATTERY and wait for airfield cooldown, then drop para2 into AA coverage
  enemy.money = 5000;
  enemy.buildingMaterial = 5000;
  enemy.industry = 5000;
  enemy.energyReserve = 2000;
  enemy.manpower = 600;
  const aaSpot = { x: arena.x + 20, y: arena.y + 8 };
  const aa = placeBuilding(state, enemyId, 'AA_BATTERY', aaSpot.x, aaSpot.y, 1)!;
  assert(aa !== null, 'Enemy AA_BATTERY placement must succeed');
  stackBuilding(state, enemyId, aa.id, 1);
  for (let t = 0; t < 110; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(aa.stackCount === 2, 'Enemy 2x AA_BATTERY must complete');
  assert(airfield.paradropCooldownTicks === 0, 'Airfield paradrop cooldown must expire');

  const para2 = spawnUnitStack(state, humanId, 'PARATROOPERS', airfield.x + 0.5, airfield.y + 0.5, 2);
  dispatchAction(state, {
    type: 'PARADROP_UNIT',
    playerId: humanId,
    unitId: para2.id,
    targetX: aa.x + 2,
    targetY: aa.y,
  });
  assert(
    para2.hp < para2.maxHp * 0.7,
    `Enemy AA_BATTERY must heavily damage paratroopers landing inside AA coverage (hp=${para2.hp.toFixed(1)} vs max=${para2.maxHp})`,
  );

  console.log('PASS [p]: Production, MOVE_UNITS, stack MERGE, Paradrop cooldown & AA_BATTERY interception verified.');
}

function testLockVsRangeAutoAttachAndArrowUnitBalance(): void {
  const state = createInitialGameState(9602);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const enemyId = 2;
  const human = state.players.get(humanId)!;
  const enemy = state.players.get(enemyId)!;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 9999;
  }

  const arena = findInlandPlainsCenter(state, 28, 18);
  paintBlock(state, arena.x - 20, arena.y - 12, arena.x - 1, arena.y + 12, humanId);
  paintBlock(state, arena.x, arena.y - 12, arena.x + 20, arena.y + 12, WILDERNESS_OWNER);

  const lockUnit = spawnUnitStack(state, humanId, 'TANK', arena.x - 10, arena.y - 4, 2, {
    stance: 'LOCK',
  });
  const rangeUnit = spawnUnitStack(state, humanId, 'TANK', arena.x - 10, arena.y + 4, 2, {
    stance: 'RANGE',
  });
  const lockStartX = lockUnit.x;
  const rangeStartX = rangeUnit.x;

  human.manpower = 450;
  dispatchAction(state, {
    type: 'CREATE_ATTACK_ORDER',
    playerId: humanId,
    waypoints: [
      { x: arena.x - 2, y: arena.y },
      { x: arena.x + 14, y: arena.y },
    ],
    manpowerPercent: 50,
  });

  for (let t = 0; t < 15; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    rangeUnit.attachedOrderId !== null && rangeUnit.x > rangeStartX + 2,
    `RANGE unit within operationRadius must auto-attach and advance (${rangeStartX} -> ${rangeUnit.x.toFixed(1)})`,
  );
  assert(
    lockUnit.attachedOrderId === null && Math.abs(lockUnit.x - lockStartX) < 0.01,
    `LOCK unit must hold position and never attach (${lockStartX} vs ${lockUnit.x})`,
  );

  // Let order finish and check field vs base repair rate
  for (let t = 0; t < MAX_ORDER_TICKS; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    rangeUnit.attachedOrderId === null,
    'RANGE unit must detach cleanly after order finishes and hold newly captured ground',
  );

  // Repair comparison: field vs near friendly CITY/FACTORY
  const fieldUnit = spawnUnitStack(state, humanId, 'INFANTRY', arena.x + 12, arena.y + 10, 1);
  const baseUnit = spawnUnitStack(state, humanId, 'INFANTRY', human.capitalX + 1, human.capitalY + 1, 1);
  fieldUnit.hp = fieldUnit.maxHp * 0.4;
  baseUnit.hp = baseUnit.maxHp * 0.4;
  for (let t = 0; t < 20; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    baseUnit.hp > fieldUnit.hp + 4,
    `Repair near friendly base must outpace field repair (${baseUnit.hp.toFixed(1)} vs ${fieldUnit.hp.toFixed(1)})`,
  );

  // Arrow-vs-unit balance against fortified enemy border (TRENCH + BUNKER)
  const runFortifiedTrial = (withUnits: boolean): { readonly captured: number; readonly costPerCell: number } => {
    const s = createInitialGameState(9603);
    const st = findPlainsLandSpot(s, 220, 270);
    dispatchAction(s, { type: 'SELECT_START_POSITION', x: st.x, y: st.y });
    const hId = s.humanPlayerId;
    const eId = 2;
    const h = s.players.get(hId)!;
    const e = s.players.get(eId)!;
    for (const p of s.players.values()) {
      if (p.isBot) p.nextBotDecisionTick = 9999;
    }

    const box = findInlandPlainsCenter(s, 24, 16);
    paintBlock(s, box.x - 16, box.y - 10, box.x - 1, box.y + 10, hId);
    paintBlock(s, box.x, box.y - 10, box.x + 16, box.y + 10, eId);
    setWarRelation(s, hId, eId);
    dispatchAction(s, { type: 'TICK' });

    e.money = 5000;
    e.buildingMaterial = 5000;
    e.industry = 5000;
    e.energyReserve = 2000;
    e.manpower = 800;
    placeBuilding(s, eId, 'TRENCH', box.x + 3, box.y - 5, 1);
    placeBuilding(s, eId, 'BUNKER', box.x + 3, box.y + 5, 1);
    for (let t = 0; t < BUILDING_SPECS.BUNKER.constructionTicks + 2; t++) {
      dispatchAction(s, { type: 'TICK' });
    }

    e.manpower = 450 + e.allocatedManpower;
    h.maxManpower = 1000;
    h.manpower = 600;
    dispatchAction(s, { type: 'TICK' });
    h.manpower = 600;

    if (withUnits) {
      spawnUnitStack(s, hId, 'INFANTRY', box.x - 3, box.y - 3, 2);
      spawnUnitStack(s, hId, 'TANK', box.x - 3, box.y + 2, 2);
      spawnUnitStack(s, hId, 'ARTILLERY', box.x - 9, box.y, 2);
    }

    let beforeOwned = 0;
    for (let i = 0; i < s.owners.length; i++) {
      if (s.owners[i] === hId) beforeOwned++;
    }

    dispatchAction(s, {
      type: 'CREATE_ATTACK_ORDER',
      playerId: hId,
      waypoints: [
        { x: box.x - 1, y: box.y },
        { x: box.x + 14, y: box.y },
      ],
      manpowerPercent: 55,
      targetOwnerId: eId,
    });
    const ord = s.attackOrders.find((o) => o.playerId === hId)!;

    for (let t = 0; t < 16; t++) {
      dispatchAction(s, { type: 'TICK' });
    }
    let afterOwned = 0;
    for (let i = 0; i < s.owners.length; i++) {
      if (s.owners[i] === hId) afterOwned++;
    }
    const captured = afterOwned - beforeOwned;
    const spent = ord.manpowerCommitted - ord.manpowerRemaining;
    return { captured, costPerCell: spent / Math.max(1, captured) };
  };

  const bare = runFortifiedTrial(false);
  const supported = runFortifiedTrial(true);
  assert(
    supported.captured > bare.captured && supported.costPerCell < bare.costPerCell,
    `Tactical units supporting arrow must beat bare arrow vs fortifications (cells: ${supported.captured} vs ${bare.captured}, cost/cell: ${supported.costPerCell.toFixed(2)} vs ${bare.costPerCell.toFixed(2)})`,
  );
  // Suppress unused variable warning for enemy
  assert(enemy.id === enemyId, 'Enemy identity intact');

  console.log(
    `PASS [q]: LOCK vs RANGE auto-attach, field/base repair & arrow-vs-unit balance (${bare.captured} vs ${supported.captured} cells) verified.`,
  );
}

function testEncirclementSurvivalLootAndFogOfWar(): void {
  const state = createInitialGameState(9604);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const enemyId = 2;
  const enemy = state.players.get(enemyId)!;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 9999;
  }

  const arena = findInlandPlainsCenter(state, 36, 26);
  paintBlock(state, arena.x - 30, arena.y - 20, arena.x + 30, arena.y + 20, enemyId);
  setWarRelation(state, humanId, enemyId);

  // Place a deep enemy tank far outside human border/unit vision (Fog of War test)
  const hiddenTank = spawnUnitStack(state, enemyId, 'TANK', arena.x + 22, arena.y, 3);
  hiddenTank.targetX = arena.x + 10;
  hiddenTank.targetY = arena.y + 5;

  const fogSnap = createClientRenderState(state);
  assert(
    !fogSnap.units.some((u) => u.id === hiddenTank.id),
    'Enemy unit outside border/unit vision MUST be omitted from ClientRenderState (Fog of War)',
  );

  // Move a human INFANTRY scout within visionRadius (30) -> enemy tank becomes visible (without target leak)
  const scout = spawnUnitStack(state, humanId, 'INFANTRY', arena.x + 4, arena.y, 1);
  const revealedSnap = createClientRenderState(state);
  const revealedEnemy = revealedSnap.units.find((u) => u.id === hiddenTank.id);
  assert(
    revealedEnemy !== undefined,
    'Enemy unit inside friendly INFANTRY visionRadius must appear in ClientRenderState',
  );
  assert(
    revealedEnemy!.targetX === null && revealedEnemy!.targetY === null,
    'Visible enemy unit must NEVER leak destination targetX/targetY to client',
  );

  // Remove scout and test encirclement under captured tile
  state.units = state.units.filter((u) => u.id === scout.id);
  const trapped = scout;
  trapped.x = arena.x;
  trapped.y = arena.y;
  paintBlock(state, arena.x - 2, arena.y - 2, arena.x + 2, arena.y + 2, humanId);
  dispatchAction(state, { type: 'TICK' });
  assert(!trapped.isEncircled, 'Unit on own territory starts supplied and not encircled');

  // Enemy captures all tiles under and around trapped unit
  paintBlock(state, arena.x - 4, arena.y - 4, arena.x + 4, arena.y + 4, enemyId);
  annexEncircledPockets(state);
  assert(state.units.some((u) => u.id === trapped.id), 'Unit must NOT vanish when territory under it is lost');

  dispatchAction(state, { type: 'TICK' });
  assert(trapped.isEncircled === true, 'Unit on enemy land must enter isEncircled combat state');

  for (let t = 0; t < 18; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    trapped.supplyLevel < 0.3 && trapped.morale < 96 && trapped.hp < trapped.maxHp,
    `Encircled unit without energy supply must lose supply/morale/HP (sup=${trapped.supplyLevel.toFixed(2)}, mor=${trapped.morale.toFixed(1)}, hp=${trapped.hp.toFixed(1)})`,
  );

  // Encircled unit cannot freely cross enemy land without fighting through
  const xBeforeBreak = trapped.x;
  dispatchAction(state, {
    type: 'MOVE_UNITS',
    playerId: humanId,
    unitIds: [trapped.id],
    targetX: trapped.x + 24,
    targetY: trapped.y,
  });
  for (let t = 0; t < 10; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    trapped.x - xBeforeBreak < 2.2,
    `Encircled unit must NOT glide freely across enemy land (moved ${(trapped.x - xBeforeBreak).toFixed(2)} cells)`,
  );

  // Enemy crushes encircled unit and claims battle loot
  const moneyBeforeLoot = enemy.money;
  const matBeforeLoot = enemy.buildingMaterial;
  spawnUnitStack(state, enemyId, 'TANK', trapped.x + 1, trapped.y, 4);
  for (let t = 0; t < 50 && state.units.some((u) => u.id === trapped.id); t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    !state.units.some((u) => u.id === trapped.id),
    'Overwhelmed encircled unit should fall in battle',
  );
  assert(
    enemy.money > moneyBeforeLoot && enemy.buildingMaterial > matBeforeLoot,
    `Defeating encircled unit must award resource loot (${enemy.money} > ${moneyBeforeLoot}, ${enemy.buildingMaterial} > ${matBeforeLoot})`,
  );

  console.log('PASS [r]: Encirclement survival, breakout restriction, battle loot & Fog of War verified.');
}

function testZeroManpowerEliminationAndDynamicOccupancyEnergy(): void {
  const state = createInitialGameState(9605);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 9999;
  }

  const arena = findInlandPlainsCenter(state, 24, 24);
  paintBlock(state, arena.x - 16, arena.y - 16, arena.x + 16, arena.y + 16, humanId);
  dispatchAction(state, { type: 'TICK' });

  human.money = 12000;
  human.buildingMaterial = 6000;
  human.industry = 4000;
  human.energyReserve = 3000;
  human.maxManpower = 1200;
  human.manpower = 1000;

  const ppSpot = findSpacedOwnedSpot(state, humanId, arena.x, arena.y, 12, false)!;
  placeBuilding(state, humanId, 'POWER_PLANT', ppSpot.x, ppSpot.y, 5);
  const facSpot = findSpacedOwnedSpot(state, humanId, arena.x, arena.y, 12, false)!;
  const factory = placeBuilding(state, humanId, 'FACTORY', facSpot.x, facSpot.y, 1)!;
  const capCity = state.buildings.find((b) => b.ownerId === humanId && b.isCapital)!;

  for (let t = 0; t < BUILDING_SPECS.FACTORY.constructionTicks + 5; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(factory.stackCount === 1, 'Factory must finish construction');

  // Dynamic occupancy energy scaling: 0% -> 0, 50% -> 0.5x, 100% -> 1.0x, 200% -> 1.5x
  dispatchAction(state, {
    type: 'SET_BUILDING_OCCUPANCY',
    playerId: humanId,
    buildingId: factory.id,
    occupancyPct: 0,
  });
  dispatchAction(state, {
    type: 'SET_BUILDING_OCCUPANCY',
    playerId: humanId,
    buildingId: capCity.id,
    occupancyPct: 0,
  });
  assert(
    factory.currentEnergyUse === 0 && capCity.currentEnergyUse === 0,
    `0% occupancy must consume 0 energy (factory=${factory.currentEnergyUse}, city=${capCity.currentEnergyUse})`,
  );

  dispatchAction(state, {
    type: 'SET_BUILDING_OCCUPANCY',
    playerId: humanId,
    buildingId: factory.id,
    occupancyPct: 50,
  });
  assert(
    Math.abs(factory.currentEnergyUse - BUILDING_SPECS.FACTORY.baseEnergyConsumption * 0.5) < 0.01,
    `50% occupancy must consume 0.5x energy (got ${factory.currentEnergyUse})`,
  );

  dispatchAction(state, {
    type: 'SET_BUILDING_OCCUPANCY',
    playerId: humanId,
    buildingId: factory.id,
    occupancyPct: 200,
  });
  assert(
    Math.abs(factory.currentEnergyUse - BUILDING_SPECS.FACTORY.baseEnergyConsumption * 1.5) < 0.01,
    `200% occupancy must consume 1.5x energy (got ${factory.currentEnergyUse})`,
  );

  // Immediate defeat / elimination when total Manpower drops to 0
  const bot3 = state.players.get(3)!;
  const bot4 = state.players.get(4)!;
  const bot2 = state.players.get(2)!;
  assert(bot3.alive && bot4.alive && bot2.alive, 'Bots 2, 3, 4 must start alive');

  // Case A: Bot 3 in blackout drops to 0 MP with no WAR neighbor -> territory reverts to wilderness
  bot3.blackoutActive = true;
  bot3.blackoutSeverity = 1;
  bot3.energyReserve = 0;
  bot3.manpower = 0.05;
  spawnUnitStack(state, 3, 'INFANTRY', bot3.capitalX, bot3.capitalY, 1);
  for (let t = 0; t < 15 && bot3.alive; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    bot3.isEliminated === true &&
      bot3.alive === false &&
      bot3.eliminationReason === 'MANPOWER_DEPLETED' &&
      bot3.territoryCells === 0 &&
      !state.units.some((u) => u.ownerId === 3),
    `State at 0 Manpower must immediately be eliminated (alive=${bot3.alive}, reason=${bot3.eliminationReason}, cells=${bot3.territoryCells})`,
  );

  // Case B: Bot 4 bordering WAR neighbor Bot 2 hits 0 MP -> territory transfers to conqueror Bot 2
  const b4Arena = findInlandPlainsCenter(state, 16, 16);
  paintBlock(state, b4Arena.x - 6, b4Arena.y - 4, b4Arena.x - 1, b4Arena.y + 4, 2);
  const b4Cells = paintBlock(state, b4Arena.x, b4Arena.y - 4, b4Arena.x + 4, b4Arena.y + 4, 4);
  setWarRelation(state, 4, 2);
  dispatchAction(state, { type: 'TICK' });
  bot4.manpower = 0;
  dispatchAction(state, { type: 'TICK' });
  assert(
    bot4.isEliminated === true &&
      bot4.eliminationReason === 'MANPOWER_DEPLETED' &&
      b4Cells.every((idx) => state.owners[idx] === 2),
    'WAR conqueror bordering 0-MP collapsed state must inherit its territory',
  );

  // Human player reaching 0 MP exposes defeat in ClientRenderState
  human.manpower = 0;
  dispatchAction(state, { type: 'TICK' });
  const defeatSnap = createClientRenderState(state);
  const humanPub = defeatSnap.players.find((p) => p.id === humanId)!;
  assert(
    humanPub.isEliminated === true &&
      humanPub.alive === false &&
      humanPub.eliminationReason === 'MANPOWER_DEPLETED',
    'Human hitting 0 Manpower must report immediate defeat in ClientRenderState',
  );

  console.log('PASS [s]: Dynamic occupancy energy scaling & immediate 0-Manpower elimination verified.');
}

function testLassoUnitSelectionPriorityOverFront(): void {
  const controller = createEngineController(9606);
  const pre = controller.getRenderState();
  let sx = 360;
  let sy = 260;
  let foundInland = false;
  for (let cy = 180; cy < pre.height - 60 && !foundInland; cy += 4) {
    for (let cx = 360; cx < pre.width - 60; cx += 4) {
      if (pre.terrain[cy * pre.width + cx] !== TerrainType.PLAINS) continue;
      let allLand = true;
      for (let dy = -24; dy <= 24 && allLand; dy += 2) {
        for (let dx = -24; dx <= 24; dx += 2) {
          if (pre.terrain[(cy + dy) * pre.width + (cx + dx)] === TerrainType.WATER) {
            allLand = false;
            break;
          }
        }
      }
      if (allLand) {
        sx = cx;
        sy = cy;
        foundInland = true;
        break;
      }
    }
  }
  assert(foundInland, 'Should find genuinely inland plains center');
  controller.dispatch({ type: 'SELECT_START_POSITION', x: sx, y: sy });

  const playing = controller.getRenderState();
  const humanId = playing.humanPlayerId;

  // Test terrain-aware build filtering: inland excludes PORT; coastal includes PORT
  const validInland = getValidBuildingsForCell(playing, humanId, sx, sy);
  assert(
    !validInland.includes('PORT') && validInland.includes('BARRACKS') && validInland.includes('TRENCH'),
    'Inland right-click build options must exclude PORT and include land buildings & defenses',
  );

  const coastState = createInitialGameState(9607);
  let csx = -1;
  let csy = -1;
  for (let y = 120; y < 380 && csx === -1; y++) {
    for (let x = 120; x < 620; x++) {
      if (
        coastState.terrain[y * coastState.width + x] === TerrainType.WATER &&
        coastState.terrain[y * coastState.width + (x + 1)] !== TerrainType.WATER
      ) {
        csx = x + 1;
        csy = y;
        break;
      }
    }
  }
  assert(csx !== -1, 'Should find coastal land tile');
  coastState.owners[csy * coastState.width + csx] = humanId;
  const validCoast = getValidBuildingsForCell(coastState, humanId, csx, csy);
  assert(
    validCoast.includes('PORT'),
    'Coastal right-click build options must include PORT',
  );

  controller.dispatch({
    type: 'PLACE_BUILDING',
    playerId: humanId,
    buildingType: 'BARRACKS',
    x: sx + 10,
    y: sy,
  });
  for (let t = 0; t < BUILDING_SPECS.BARRACKS.constructionTicks; t++) {
    controller.dispatch({ type: 'TICK' });
  }

  for (let t = 0; t < 240; t++) {
    const snap = controller.getRenderState();
    const h = snap.players.find((p) => p.id === humanId);
    if (
      h &&
      (h.money ?? 0) >= UNIT_SPECS.INFANTRY.cost.money &&
      (h.buildingMaterial ?? 0) >= UNIT_SPECS.INFANTRY.cost.buildingMaterial &&
      (h.activeManpower ?? 0) >= UNIT_SPECS.INFANTRY.cost.manpower
    ) {
      break;
    }
    controller.dispatch({ type: 'TICK' });
  }

  controller.dispatch({
    type: 'QUICK_PRODUCE_UNIT',
    playerId: humanId,
    unitType: 'INFANTRY',
  });
  for (let t = 0; t < UNIT_SPECS.INFANTRY.productionTicks + 4; t++) {
    controller.dispatch({ type: 'TICK' });
  }

  const withUnit = controller.getRenderState();
  const inf = withUnit.units.find((u) => u.ownerId === humanId && u.type === 'INFANTRY');
  assert(inf !== undefined, 'QUICK_PRODUCE_UNIT must produce INFANTRY unit');

  // Move infantry onto the eastern human frontier, then draw a lasso spanning both unit and border cells
  controller.dispatch({
    type: 'MOVE_UNITS',
    playerId: humanId,
    unitIds: [inf!.id],
    targetX: sx + 13,
    targetY: sy,
  });
  for (let t = 0; t < 15; t++) {
    controller.dispatch({ type: 'TICK' });
  }

  const afterMove = controller.getRenderState();
  const movedInf = afterMove.units.find((u) => u.id === inf!.id)!;
  const lasso = [
    { x: movedInf.x - 5, y: movedInf.y - 6 },
    { x: movedInf.x + 5, y: movedInf.y - 6 },
    { x: movedInf.x + 5, y: movedInf.y + 6 },
    { x: movedInf.x - 5, y: movedInf.y + 6 },
  ];
  const hitUnits = controller.findHumanUnitsInLasso(lasso);
  const hitFront = controller.findHumanBorderCellsFromLasso(lasso);
  assert(
    hitUnits.includes(movedInf.id) && hitFront.length > 0,
    `Overlapping lasso must detect unit (${hitUnits.length}) and border (${hitFront.length}) so UI prioritizes unit`,
  );

  console.log('PASS [t]: Terrain build filtering, QUICK_PRODUCE_UNIT & lasso unit priority verified.');
}

function testAllAiBotsSpawnSurviveAndStayActive(): void {
  const state = createInitialGameState(1337);
  const start = findPlainsLandSpot(state, 360, 260);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const initialBots = [...state.players.values()].filter((p) => p.isBot && p.alive && !p.isEliminated);
  assert(
    initialBots.length === BOT_COUNT,
    `Expected all ${BOT_COUNT} AI bots to spawn alive at start, got ${initialBots.length}`,
  );

  for (let t = 0; t < 1250; t++) {
    dispatchAction(state, { type: 'TICK' });
  }

  const allBots = [...state.players.values()].filter((p) => p.isBot);
  const aliveBots = allBots.filter((p) => p.alive && !p.isEliminated);
  const mpEliminated = allBots.filter((p) => p.eliminationReason === 'MANPOWER_DEPLETED');
  const powerBuilt = allBots.filter((p) => p.freePowerPlantUsed);

  assert(
    mpEliminated.length === 0,
    `No AI bot should die of MANPOWER_DEPLETED blackout, got ${mpEliminated.length}`,
  );
  assert(
    powerBuilt.length === BOT_COUNT,
    `Expected all ${BOT_COUNT} AI bots to build starter power plant, got ${powerBuilt.length}`,
  );
  assert(
    aliveBots.length === BOT_COUNT,
    `Expected all ${BOT_COUNT} AI bots alive at tick 1250, got ${aliveBots.length}`,
  );
  for (const bot of aliveBots) {
    assert(
      bot.territoryCells > 300,
      `Bot ${bot.name} failed to expand/hold territory (${bot.territoryCells} cells)`,
    );
  }

  const client = createClientRenderState(state);
  const publicBots = client.players.filter((p) => p.isBot && p.alive);
  assert(
    publicBots.length === BOT_COUNT,
    `Public leaderboard must list all ${BOT_COUNT} live bots, got ${publicBots.length}`,
  );
  for (const pub of publicBots) {
    assert(
      pub.money === undefined && pub.manpower === undefined,
      `Anti-cheat failed: private bot stats leaked for ${pub.name}`,
    );
  }

  console.log(
    `PASS [u]: All ${BOT_COUNT}/${BOT_COUNT} AI bots spawn, build power, survive & expand cleanly.`,
  );
}

function testRangeUnitDisciplineAndArtilleryAutoShelling(): void {
  const state = createInitialGameState(9707);

  // Locate a solid inland patch centered in Central/Eastern Europe plains so no water interferes
  let sx = -1;
  let sy = -1;
  for (let y = 170; y < 290 && sx === -1; y += 5) {
    for (let x = 390; x < 540; x += 5) {
      let ok = true;
      for (let dy = -20; dy <= 20 && ok; dy += 5) {
        for (let dx = -12; dx <= 80; dx += 5) {
          if (state.terrain[(y + dy) * state.width + (x + dx)] === TerrainType.WATER) {
            ok = false;
            break;
          }
        }
      }
      if (ok) {
        sx = x;
        sy = y;
        break;
      }
    }
  }
  assert(sx !== -1, 'Expected spacious land patch for unit discipline & artillery test');

  dispatchAction(state, { type: 'SELECT_START_POSITION', x: sx, y: sy });
  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;
  human.energyReserve = human.energyReserveMax;

  // Freeze unrelated bot AI decisions during deterministic coordinate test
  let enemyBot = null;
  for (const p of state.players.values()) {
    if (p.isBot) {
      p.nextBotDecisionTick = 999999;
      if (!enemyBot && p.alive) {
        enemyBot = p;
      }
    }
  }
  assert(enemyBot !== null, 'Expected an enemy bot');
  const enemy = enemyBot!;

  // Claim a corridor at x + 55..x + 65 well outside unit operationRadius (40)
  for (let y = sy - 8; y <= sy + 8; y++) {
    for (let x = sx + 55; x <= sx + 66; x++) {
      state.owners[y * state.width + x] = humanId;
    }
  }

  // 1. Spawn a RANGE infantry at (sx - 4, sy); launch an AttackOrder 70+ cells east (> operationRadius 40)
  const rangeInf = spawnUnitStack(state, humanId, 'INFANTRY', sx - 4, sy, 2, {
    stance: 'RANGE',
  });
  const startX = rangeInf.x;
  const startY = rangeInf.y;

  dispatchAction(state, {
    type: 'CREATE_ATTACK_ORDER',
    playerId: humanId,
    waypoints: [
      { x: sx + 62, y: sy },
      { x: sx + 78, y: sy },
    ],
    manpowerPercent: 25,
    targetOwnerId: WILDERNESS_OWNER,
  });

  for (let t = 0; t < 25; t++) {
    dispatchAction(state, { type: 'TICK' });
  }

  assert(
    Math.hypot(rangeInf.x - startX, rangeInf.y - startY) < 0.05 &&
      rangeInf.attachedOrderId === null,
    `RANGE unit must stay stationary when attack/border shifts outside operationRadius (moved=${Math.hypot(rangeInf.x - startX, rangeInf.y - startY).toFixed(2)})`,
  );

  // 2. Switching a moving unit to LOCK immediately halts movement & prevents auto-attach
  dispatchAction(state, {
    type: 'MOVE_UNITS',
    playerId: humanId,
    unitIds: [rangeInf.id],
    targetX: sx + 22,
    targetY: sy,
  });
  for (let t = 0; t < 4; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(rangeInf.x > startX + 0.5 && rangeInf.targetX !== null, 'Unit should move toward RMB order');

  dispatchAction(state, {
    type: 'SET_UNITS_STANCE',
    playerId: humanId,
    unitIds: [rangeInf.id],
    stance: 'LOCK',
  });
  assert(
    rangeInf.stance === 'LOCK' && rangeInf.targetX === null && rangeInf.targetY === null,
    'Switching to LOCK must halt unit immediately and clear targets',
  );

  // Launch an own AttackOrder right next to the LOCK unit & another RANGE unit
  const nearbyRange = spawnUnitStack(state, humanId, 'INFANTRY', sx + 2, sy + 3, 2, {
    stance: 'RANGE',
  });
  const nearX = nearbyRange.x;
  const lockX = rangeInf.x;
  const lockY = rangeInf.y;

  dispatchAction(state, {
    type: 'CREATE_ATTACK_ORDER',
    playerId: humanId,
    waypoints: [
      { x: sx + 10, y: sy },
      { x: sx + 30, y: sy },
    ],
    manpowerPercent: 25,
    targetOwnerId: WILDERNESS_OWNER,
  });

  let sawAttached = false;
  for (let t = 0; t < 20; t++) {
    dispatchAction(state, { type: 'TICK' });
    if (nearbyRange.attachedOrderId !== null) {
      sawAttached = true;
    }
  }

  assert(
    Math.hypot(rangeInf.x - lockX, rangeInf.y - lockY) === 0,
    'LOCK unit must never move automatically even when attack arrow is adjacent',
  );
  assert(
    sawAttached && nearbyRange.x > nearX + 1.2,
    `RANGE unit must auto-attach and advance with active arrow inside operationRadius (sawAttached=${sawAttached}, dx=${(nearbyRange.x - nearX).toFixed(2)})`,
  );

  // 3. ARTILLERY automatically shells enemy WAR BUNKER in attackRange (26 cells)
  setWarRelation(state, humanId, enemy.id);
  const bunkerX = sx + 18;
  const bunkerY = sy - 8;
  for (let y = bunkerY - 6; y <= bunkerY + 6; y++) {
    for (let x = bunkerX - 6; x <= bunkerX + 6; x++) {
      state.owners[y * state.width + x] = enemy.id;
    }
  }
  enemy.money = 5000;
  enemy.buildingMaterial = 5000;
  enemy.industry = 5000;
  const enemyBunker = placeBuilding(state, enemy.id, 'BUNKER', bunkerX, bunkerY, 1)!;
  assert(enemyBunker !== null, 'Expected enemy BUNKER placement');
  enemyBunker.stackCount = 4;
  enemyBunker.underConstructionCount = 0;
  enemyBunker.constructionTicksRemaining = 0;
  enemy.energyReserve = enemy.energyReserveMax;
  enemy.manpower = enemy.maxManpower;
  const mpBefore = enemy.manpower;

  const arty = spawnUnitStack(state, humanId, 'ARTILLERY', bunkerX - 15, bunkerY, 4, {
    stance: 'LOCK',
  });

  let sawShellLock = false;
  let sawMpDrain = false;
  for (let t = 0; t < 20; t++) {
    dispatchAction(state, { type: 'TICK' });
    if (
      arty.combatCooldownTicks > 0 &&
      arty.lastCombatTargetX === bunkerX + 0.5 &&
      arty.lastCombatTargetY === bunkerY + 0.5
    ) {
      sawShellLock = true;
    }
    if (enemy.manpower < mpBefore) {
      sawMpDrain = true;
    }
  }

  const remainingBunker = state.buildings.find((b) => b.id === enemyBunker.id);
  const stacksAfter = remainingBunker ? remainingBunker.stackCount : 0;

  assert(
    sawShellLock && arty.combatCooldownTicks > 0,
    `Artillery must automatically lock and shell WAR enemy BUNKER in range (cooldown=${arty.combatCooldownTicks}, target=${arty.lastCombatTargetX})`,
  );
  assert(
    sawMpDrain && stacksAfter < 4,
    `Artillery bombardment must attrit enemy manpower (${mpBefore.toFixed(1)} -> ${enemy.manpower.toFixed(1)}) and damage bunker stacks (4 -> ${stacksAfter})`,
  );

  console.log(
    `PASS [v]: RANGE discipline, LOCK halt & ARTILLERY bunker auto-shelling verified (bunker stacks 4 -> ${stacksAfter}).`,
  );
}

function testLandPathfindingAroundBayAndIslandRejection(): void {
  const state = createInitialGameState(9806);
  const start = findPlainsLandSpot(state, 360, 260);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });
  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;
  human.energyReserve = human.energyReserveMax;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 999999;
  }

  // Paint a controlled inland arena (420, 240) with a water bay blocking the straight line
  // and a clear northern land bridge around the bay, plus an isolated southern island
  const bx = 420;
  const by = 240;
  for (let y = by - 36; y <= by + 36; y++) {
    for (let x = bx - 36; x <= bx + 36; x++) {
      const idx = y * state.width + x;
      state.terrain[idx] = TerrainType.PLAINS;
      state.owners[idx] = humanId;
    }
  }

  // Deep water bay right across y = by - 6 .. by + 34 blocking direct E-W crossing
  for (let y = by - 6; y <= by + 34; y++) {
    for (let x = bx - 5; x <= bx + 5; x++) {
      const idx = y * state.width + x;
      state.terrain[idx] = TerrainType.WATER;
      state.owners[idx] = WILDERNESS_OWNER;
    }
  }

  // Isolated island surrounded by >= 10 cells of WATER moat in SE quadrant of arena
  for (let y = by + 12; y <= by + 34; y++) {
    for (let x = bx + 12; x <= bx + 34; x++) {
      const idx = y * state.width + x;
      state.terrain[idx] = TerrainType.WATER;
      state.owners[idx] = WILDERNESS_OWNER;
    }
  }
  for (let y = by + 22; y <= by + 30; y++) {
    for (let x = bx + 22; x <= bx + 30; x++) {
      const idx = y * state.width + x;
      state.terrain[idx] = TerrainType.PLAINS;
      state.owners[idx] = humanId;
    }
  }

  const tank = spawnUnitStack(state, humanId, 'TANK', bx - 16, by + 6, 1, { stance: 'LOCK' });
  const goalX = bx + 16;
  const goalY = by + 4;

  dispatchAction(state, {
    type: 'MOVE_UNITS',
    playerId: humanId,
    unitIds: [tank.id],
    targetX: goalX,
    targetY: goalY,
  });

  assert(
    tank.waypoints.length >= 2 && tank.targetX !== null,
    `Expected multi-waypoint A* land route around bay (waypoints=${tank.waypoints.length})`,
  );

  let minYReached = tank.y;
  for (let t = 0; t < 240 && tank.targetX !== null; t++) {
    dispatchAction(state, { type: 'TICK' });
    const cTerrain = state.terrain[Math.floor(tank.y) * state.width + Math.floor(tank.x)];
    assert(cTerrain !== TerrainType.WATER, 'Pathfound tank must never step into WATER');
    if (tank.y < minYReached) {
      minYReached = tank.y;
    }
  }

  const distToGoal = Math.hypot(tank.x - goalX, tank.y - goalY);
  assert(
    distToGoal <= 2.2 && minYReached < by - 6,
    `Tank must walk north around bay cleanly without coastal jamming (dist=${distToGoal.toFixed(2)}, minY=${minYReached.toFixed(1)} vs bayTop=${by - 6})`,
  );

  // Attempting to march across open sea to isolated island must cleanly reject with UI notice
  dispatchAction(state, {
    type: 'MOVE_UNITS',
    playerId: humanId,
    unitIds: [tank.id],
    targetX: bx + 26,
    targetY: by + 26,
  });
  assert(
    tank.targetX === null &&
      state.lastNotice !== null &&
      state.lastNotice.messageCs.includes('přístav/loď'),
    `Disconnected island move order must reject with port/ship notice (got "${state.lastNotice?.messageCs ?? 'none'}")`,
  );

  console.log(
    `PASS [w]: Coarse A* land pathfinding around bay (${tank.x.toFixed(1)},${tank.y.toFixed(1)}) & island rejection verified.`,
  );
}

function testManualArtilleryFireMissionBarrage(): void {
  const state = createInitialGameState(9807);
  const start = findPlainsLandSpot(state, 360, 260);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });
  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;
  human.energyReserve = human.energyReserveMax;

  let enemy = null;
  for (const p of state.players.values()) {
    if (p.isBot) {
      p.nextBotDecisionTick = 999999;
      if (!enemy && p.alive) enemy = p;
    }
  }
  assert(enemy !== null, 'Expected alive bot enemy');
  const enemyId = enemy!.id;
  setWarRelation(state, humanId, enemyId);

  const ax = 440;
  const ay = 230;
  for (let y = ay - 20; y <= ay + 20; y++) {
    for (let x = ax - 24; x <= ax + 34; x++) {
      const idx = y * state.width + x;
      state.terrain[idx] = TerrainType.PLAINS;
      state.owners[idx] = x >= ax ? enemyId : humanId;
    }
  }

  enemy!.money = 5000;
  enemy!.buildingMaterial = 5000;
  enemy!.industry = 5000;
  enemy!.energyReserve = enemy!.energyReserveMax;
  const enemyBunker = placeBuilding(state, enemyId, 'BUNKER', ax + 14, ay, 1)!;
  assert(enemyBunker !== null, 'Expected enemy BUNKER inside target zone');
  enemyBunker.stackCount = 3;
  enemyBunker.underConstructionCount = 0;
  enemyBunker.constructionTicksRemaining = 0;

  const enemyInf = spawnUnitStack(state, enemyId, 'INFANTRY', ax + 15, ay + 2, 2, {
    stance: 'LOCK',
  });
  const enemyInfHpBefore = enemyInf.hp;

  enemy!.manpower = enemy!.maxManpower;
  const enemyMpBefore = enemy!.manpower;

  // Create active enemy offensive arrow inside blast radius
  state.attackOrders.push({
    id: state.nextOrderId++,
    playerId: enemyId,
    origin: { x: ax + 12, y: ay },
    waypoints: [
      { x: ax + 12, y: ay },
      { x: ax - 10, y: ay },
    ],
    frontierArc: 0,
    targetOwnerIds: [humanId],
    wildernessOnly: false,
    currentSegmentIndex: 0,
    segmentProgress: 0,
    totalPathLength: 22,
    manpowerCommitted: 120,
    manpowerRemaining: 120,
    ticksRemaining: 60,
    maxTicks: 60,
    stagnantTicks: 0,
    mountainAccum: 0,
  });

  const arty = spawnUnitStack(state, humanId, 'ARTILLERY', ax - 4, ay, 4, { stance: 'LOCK' });

  // Verify out-of-range manual mission gets rejected with notice
  dispatchAction(state, {
    type: 'ARTILLERY_FIRE_MISSION',
    playerId: humanId,
    unitIds: [arty.id],
    targetX: ax + 42,
    targetY: ay,
  });
  assert(
    arty.fireMissionTicksRemaining === 0 &&
      state.lastNotice !== null &&
      state.lastNotice.messageCs.includes('mimo dostřel'),
    'Out-of-range fire mission must be rejected with UI notice',
  );

  // Launch manual artillery fire mission within range (dist = 18 <= 34)
  dispatchAction(state, {
    type: 'ARTILLERY_FIRE_MISSION',
    playerId: humanId,
    unitIds: [arty.id],
    targetX: ax + 14,
    targetY: ay,
  });
  assert(arty.fireMissionTicksRemaining > 0, 'Manual artillery fire mission must activate');

  let sawExplosion = false;
  let sawEnemyInfDamaged = false;
  let sawOrderDisrupted = false;
  for (let t = 0; t < 24; t++) {
    dispatchAction(state, { type: 'TICK' });
    if (state.artilleryExplosions.length > 0) sawExplosion = true;
    const infCurr = state.units.find((u) => u.id === enemyInf.id);
    if (!infCurr || infCurr.hp < enemyInfHpBefore - 5) sawEnemyInfDamaged = true;
    const ordCurr = state.attackOrders.find((o) => o.playerId === enemyId);
    if (!ordCurr || ordCurr.manpowerRemaining < 105) sawOrderDisrupted = true;
  }

  const bunkerCurr = state.buildings.find((b) => b.id === enemyBunker.id);
  const bunkerStacksAfter = bunkerCurr ? bunkerCurr.stackCount : 0;

  assert(sawExplosion, 'Artillery fire mission must spawn ArtilleryExplosionFx bursts');
  assert(sawEnemyInfDamaged, 'Fire mission splash must damage enemy units in blast circle');
  assert(sawOrderDisrupted, 'Fire mission must disrupt enemy offensive orders in sector');
  assert(
    bunkerStacksAfter < 3 && enemy!.manpower < enemyMpBefore,
    `Fire mission must degrade BUNKER stacks (3 -> ${bunkerStacksAfter}) and enemy manpower`,
  );

  console.log(
    `PASS [x]: Manual ARTILLERY Fire Mission barrage verified (bunker stacks 3 -> ${bunkerStacksAfter}).`,
  );
}

function testFactoryArmorySeparationAndCityNoOverload(): void {
  const state = createInitialGameState(9808);
  const start = findPlainsLandSpot(state, 360, 260);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });
  const humanId = state.humanPlayerId;
  const human = state.players.get(humanId)!;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 999999;
  }

  const indZone = state.publicResourceZones.find((z) => z.type === 'INDUSTRIAL');
  assert(indZone !== undefined, 'Map generator must spawn INDUSTRIAL resource zones');
  const secretInd = state.secretResourceZones.find((s) => s.zoneId === indZone!.id)!;

  // Claim human territory around secret industrial optimum
  for (let y = secretInd.optimumY - 22; y <= secretInd.optimumY + 22; y++) {
    for (let x = secretInd.optimumX - 22; x <= secretInd.optimumX + 22; x++) {
      if (x < 0 || x >= state.width || y < 0 || y >= state.height) continue;
      if (state.terrain[y * state.width + x] !== TerrainType.WATER) {
        state.owners[y * state.width + x] = humanId;
      }
    }
  }

  human.money = 12000;
  human.buildingMaterial = 6000;
  human.industry = 4000;
  human.energyReserve = 2500;
  human.maxManpower = 2000;
  human.manpower = 1500;

  const ppSpot = findSpacedOwnedSpot(state, humanId, secretInd.optimumX - 14, secretInd.optimumY, 10, false)!;
  placeBuilding(state, humanId, 'POWER_PLANT', ppSpot.x, ppSpot.y, 5);

  assert(
    BUILDING_SPECS.FACTORY.resourceZoneType === 'INDUSTRIAL',
    'FACTORY must target INDUSTRIAL resource zones',
  );
  const factory = placeBuilding(
    state,
    humanId,
    'FACTORY',
    secretInd.optimumX,
    secretInd.optimumY,
    1,
  )!;
  assert(factory !== null, 'FACTORY must build cleanly at industrial zone optimum');

  const armSpot = findSpacedOwnedSpot(state, humanId, secretInd.optimumX + 12, secretInd.optimumY, 10, false)!;
  const armory = placeBuilding(state, humanId, 'ARMORY', armSpot.x, armSpot.y, 1)!;
  assert(armory !== null, 'ARMORY must build cleanly');

  for (let t = 0; t < BUILDING_SPECS.ARMORY.constructionTicks + 4; t++) {
    dispatchAction(state, { type: 'TICK' });
  }

  assert(
    factory.stackCount === 1 &&
      factory.revealedEfficiencyPct !== null &&
      factory.revealedEfficiencyPct >= 85 &&
      human.industryIncomePerSec > 0,
    `FACTORY inside INDUSTRIAL optimum must produce industry with high site efficiency (${factory.revealedEfficiencyPct}%, +${human.industryIncomePerSec.toFixed(1)}/s)`,
  );

  // FACTORY must NOT produce military vehicles; ARMORY produces TANK & ARTILLERY
  const rejectedTankFromFactory = queueUnitProduction(state, humanId, factory.id, 'TANK', 1);
  assert(rejectedTankFromFactory === 0, 'FACTORY must reject TANK production');

  const indBeforeArmory = human.industry;
  dispatchAction(state, {
    type: 'PRODUCE_UNIT',
    playerId: humanId,
    buildingId: armory.id,
    unitType: 'TANK',
  });
  dispatchAction(state, {
    type: 'PRODUCE_UNIT',
    playerId: humanId,
    buildingId: armory.id,
    unitType: 'ARTILLERY',
  });
  assert(
    armory.unitQueue.length === 2 && human.industry < indBeforeArmory,
    'ARMORY must queue heavy armor/artillery and consume accumulated Industry',
  );

  for (let t = 0; t < UNIT_SPECS.TANK.productionTicks + UNIT_SPECS.ARTILLERY.productionTicks + 4; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    state.units.some((u) => u.ownerId === humanId && u.type === 'TANK') &&
      state.units.some((u) => u.ownerId === humanId && u.type === 'ARTILLERY'),
    'ARMORY must complete production of TANK and ARTILLERY',
  );

  // CITY must strictly forbid > 100% overload
  const capCity = state.buildings.find((b) => b.ownerId === humanId && b.isCapital)!;
  dispatchAction(state, {
    type: 'SET_BUILDING_TYPE_OCCUPANCY',
    playerId: humanId,
    buildingType: 'CITY',
    occupancyPct: 200,
  });
  dispatchAction(state, {
    type: 'SET_BUILDING_OCCUPANCY',
    playerId: humanId,
    buildingId: capCity.id,
    occupancyPct: 200,
  });
  assert(
    human.buildingOccupancyByType.CITY <= 100 &&
      capCity.effectiveOccupancyPct <= 100 &&
      Math.abs(capCity.currentEnergyUse - BUILDING_SPECS.CITY.baseEnergyConsumption) < 0.01,
    `CITY must strictly clamp occupancy <= 100% with no 200% overload (got type=${human.buildingOccupancyByType.CITY}, eff=${capCity.effectiveOccupancyPct})`,
  );

  console.log(
    `PASS [y]: FACTORY (${factory.revealedEfficiencyPct}% zone), ARMORY tank/arty production & CITY <= 100% cap verified.`,
  );
}

function main(): void {
  testDeclareWarFromUiController();
  testStrictDeterministicPocketAnnexation();
  testOrganicDoubleTapSurgeShape();
  testBidirectionalWarAndCrossArrowCounterAttack();
  testLongBlockedArrowTerminationAndRefund();
  testAntiDeathSpiralUnderMultiBotAttack();
  testSpeedUpRealTimeRatio();
  testBuildingsFreePowerPlantAndResourceZones();
  testManpowerAllocationAnd200Overload();
  testHomeFrontVsBareWilderness();
  testNeighborTradeAndBetrayalFine();
  testBatchStackingConstructionAndDemolish();
  testEnergyReserveCapAndCascadingBlackout();
  testFinishOffTargetAndMultiPocketCleanup();
  testDefenseBuildingsTrenchBunkerAndAA();
  testUnitProductionMovementMergeAndParadropAA();
  testLockVsRangeAutoAttachAndArrowUnitBalance();
  testEncirclementSurvivalLootAndFogOfWar();
  testZeroManpowerEliminationAndDynamicOccupancyEnergy();
  testLassoUnitSelectionPriorityOverFront();
  testAllAiBotsSpawnSurviveAndStayActive();
  testRangeUnitDisciplineAndArtilleryAutoShelling();
  testLandPathfindingAroundBayAndIslandRejection();
  testManualArtilleryFireMissionBarrage();
  testFactoryArmorySeparationAndCityNoOverload();
  console.log('ALL 25 SIMULATION TESTS PASSED.');
}

main();
