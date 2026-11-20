import {
  BUILDING_SPECS,
  demolishBuilding,
  getUnitBuildCost,
  placeBuilding,
  stackBuilding,
} from '../src/engine/buildings';
import {
  CAPITAL_BASE_MATERIAL_PER_SEC,
  areNeighbors,
} from '../src/engine/economy';
import {
  MAX_ORDER_TICKS,
  annexEncircledPockets,
  getRelation,
  setWarRelation,
} from '../src/engine/frontExpansion';
import {
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

function testUnlimitedEnergyReserveAndProgressiveCosts(): void {
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
  assert(human.energyReserveMax === null, 'energyReserveMax must be null (unlimited late-game reserve)');

  human.money = 50000;
  human.buildingMaterial = 25000;
  human.maxManpower = 800;
  human.manpower = 800;

  const ppSpot = findSpacedOwnedSpot(state, humanId, human.capitalX, human.capitalY, 13, false);
  assert(ppSpot !== null, 'Should find spot for 10x POWER_PLANT stack');
  dispatchAction(state, {
    type: 'PLACE_BUILDING',
    playerId: humanId,
    buildingType: 'POWER_PLANT',
    x: ppSpot!.x,
    y: ppSpot!.y,
    batchSize: 10,
  });

  const pp = state.buildings.find((b) => b.ownerId === humanId && b.type === 'POWER_PLANT');
  assert(pp !== undefined, '10x POWER_PLANT node must exist');
  const totalWait = BUILDING_SPECS.POWER_PLANT.constructionTicks * 10 + 180;
  for (let t = 0; t < totalWait; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(pp!.stackCount === 10, `All 10 Power Plants must complete (got ${pp!.stackCount})`);
  assert(
    human.energyReserve > 1500 && human.energyReserveMax === null,
    `Energy reserve must grow past 1500 without artificial cap (got ${human.energyReserve.toFixed(1)})`,
  );
  console.log('PASS [m]: Progressive building costs (+14%) & unlimited late-game energy reserve verified.');
}

function testTargetedFullAttackAndMicroDotCleanup(): void {
  const state = createInitialGameState(9303);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const botId = 2;
  const human = state.players.get(humanId)!;
  for (const p of state.players.values()) {
    if (p.isBot) p.nextBotDecisionTick = 9999;
  }

  const arena = findInlandPlainsCenter(state, 24, 18);
  paintBlock(state, arena.x - 16, arena.y - 12, arena.x - 1, arena.y + 12, humanId);
  paintBlock(state, arena.x, arena.y - 12, arena.x + 16, arena.y + 12, botId);
  dispatchAction(state, { type: 'TICK' });

  human.money = 2000;
  human.manpower = 480;
  const mineSpot = findSpacedOwnedSpot(state, humanId, arena.x - 11, arena.y - 7, 4, false);
  assert(mineSpot !== null, 'Should find spot for human MINE in attack test');
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
  human.manpower = 450;
  dispatchAction(state, { type: 'TICK' });

  // Must refuse TARGETED_ATTACK against NEUTRAL state
  dispatchAction(state, {
    type: 'TARGETED_ATTACK',
    playerId: humanId,
    targetOwnerId: botId,
    anchorX: arena.x + 4,
    anchorY: arena.y,
    manpowerPercent: 35,
    fullAttack: true,
  });
  assert(
    state.frontPushOrders.length === 0,
    'TARGETED_ATTACK must not attack NEUTRAL foreign states',
  );

  // Declare WAR and carve isolated 6-cell residual bot micro-dot inside human block
  setWarRelation(state, humanId, botId);
  const microCells = paintBlock(state, arena.x - 9, arena.y + 4, arena.x - 8, arena.y + 6, botId);
  assert(microCells.length === 6, 'Isolated residual micro-dot must have 6 cells');

  const allocBefore = human.allocatedManpower;
  const activeBefore = human.activeManpower;
  assert(allocBefore > 0 && activeBefore > 100, 'Must have both allocated and active manpower');

  dispatchAction(state, {
    type: 'TARGETED_ATTACK',
    playerId: humanId,
    targetOwnerId: botId,
    anchorX: arena.x + 4,
    anchorY: arena.y,
    manpowerPercent: 35,
    fullAttack: true,
  });

  const fullOrder = state.frontPushOrders.find((o) => o.playerId === humanId);
  assert(fullOrder !== undefined, 'FULL TARGETED_ATTACK must create frontPushOrder when AT WAR');
  assert(
    fullOrder!.fullAttack === true && fullOrder!.sweepAllBorders === true,
    'FULL attack order must enable fullAttack and sweepAllBorders',
  );
  assert(
    Math.abs(fullOrder!.manpowerCommitted - activeBefore * 0.95) < 1.0,
    `FULL attack must deploy ~95% of active forces (expected ${(activeBefore * 0.95).toFixed(1)}, got ${fullOrder!.manpowerCommitted.toFixed(1)})`,
  );
  assert(
    Math.abs(human.allocatedManpower - allocBefore) < 0.01,
    'FULL attack must keep building allocatedManpower protected',
  );

  for (let t = 0; t < 8; t++) {
    dispatchAction(state, { type: 'TICK' });
  }
  assert(
    microCells.every((idx) => state.owners[idx] === humanId),
    'All 6 isolated residual micro-dot cells must be absorbed after FULL assault',
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

  console.log('PASS [n]: Targeted FULL attack (95% active MP), micro-dot cleanup & stale border pruning verified.');
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
  testUnlimitedEnergyReserveAndProgressiveCosts();
  testTargetedFullAttackAndMicroDotCleanup();
  console.log('ALL 14 SIMULATION TESTS PASSED.');
}

main();
