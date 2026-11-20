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
} from '../src/engine/simulation';
import {
  GameState,
  TerrainType,
  WILDERNESS_OWNER,
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

function main(): void {
  testDeclareWarFromUiController();
  testStrictDeterministicPocketAnnexation();
  testOrganicDoubleTapSurgeShape();
  testBidirectionalWarAndCrossArrowCounterAttack();
  testLongBlockedArrowTerminationAndRefund();
  testAntiDeathSpiralUnderMultiBotAttack();
  console.log('ALL 6 SIMULATION TESTS PASSED.');
}

main();
