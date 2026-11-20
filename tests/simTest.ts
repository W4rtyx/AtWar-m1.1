import {
  MAX_ORDER_TICKS,
  annexEncircledPockets,
  getRelation,
  setWarRelation,
} from '../src/engine/frontExpansion';
import {
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

  // Create two human regions separated by a 7-cell bot salient on solid inland plains
  paintBlock(state, bx - 14, by - 12, bx + 20, by + 12, humanId);
  const botCells = paintBlock(state, bx, by - 4, bx + 6, by + 4, botId);
  assert(botCells.length >= 40, 'Bot salient should contain land cells');

  // Bot initiates war against human
  setWarRelation(state, botId, humanId);
  assert(
    getRelation(state, humanId, botId) === 'WAR' &&
      getRelation(state, botId, humanId) === 'WAR',
    'WAR relation must be bidirectional',
  );

  // Human draws a counter-attack arrow starting on left own land, crossing bot salient, ending on right own land
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

  assert(state.attackOrders.length === 1, 'Counter-attack order should be created');
  assert(
    state.attackOrders[0].targetOwnerIds.includes(botId),
    'Arrow crossing WAR bot salient must include botId in targetOwnerIds',
  );

  const initialBotCount = botCells.length;
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
    remainingBotCells < initialBotCount,
    `Player counter-attack must capture bot salient cells (${remainingBotCells}/${initialBotCount})`,
  );
  console.log('PASS [a]: Bidirectional WAR & cross-salient counter-attack verified.');
}

function testEncirclementAndMicroDotAnnexation(): void {
  const state = createInitialGameState(5151);
  const start = findPlainsLandSpot(state, 220, 270);
  dispatchAction(state, { type: 'SELECT_START_POSITION', x: start.x, y: start.y });

  const humanId = state.humanPlayerId;
  const enemyId = 3;
  setWarRelation(state, humanId, enemyId);

  const center = findInlandPlainsCenter(state, 22, 14);
  const cx = center.x;
  const cy = center.y;

  paintBlock(state, cx - 12, cy - 10, cx + 18, cy + 10, humanId);
  const pocketCells = paintBlock(state, cx - 2, cy - 2, cx + 2, cy + 2, enemyId);
  const dotCells = paintBlock(state, cx + 10, cy, cx + 11, cy, enemyId);

  const annexed = annexEncircledPockets(state);
  assert(annexed, 'annexEncircledPockets should detect surrounded pocket & micro-dot');

  for (const idx of pocketCells.concat(dotCells)) {
    assert(
      state.owners[idx] === humanId,
      `Surrounded cell ${idx} should be annexed to human`,
    );
  }
  console.log('PASS [b]: Encirclement pocket & micro-dot annexation verified.');
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

  assert(state.attackOrders.length === 1, 'Long arrow order created');
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
  console.log('PASS [c]: Long arrow termination & unused manpower refund verified.');
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
  console.log('PASS [d]: Anti-death-spiral manpower safeguard verified.');
}

function main(): void {
  testBidirectionalWarAndCrossArrowCounterAttack();
  testEncirclementAndMicroDotAnnexation();
  testLongBlockedArrowTerminationAndRefund();
  testAntiDeathSpiralUnderMultiBotAttack();
  console.log('ALL 4 SIMULATION TESTS PASSED.');
}

main();
