import './style.css';
import { validateBuildingPlacement } from './engine/buildings';
import {
  buildSmoothAttackWaypoints,
  computePolylineLength,
} from './engine/frontExpansion';
import { createEngineController, planSimulationTicks } from './engine/simulation';
import {
  ALL_BUILDING_TYPES,
  BuildingType,
  ClientRenderState,
  Point,
  PublicBuildingInfo,
  TICK_DT,
  WILDERNESS_OWNER,
} from './engine/types';
import { Camera } from './render/camera';
import {
  AmbushOverlay,
  ArrowPreview,
  BuildPlacementPreview,
  CanvasRenderer,
  FrontPushPreview,
} from './render/canvasRenderer';
import { HudController, SimSpeed, TacticalMode } from './ui/hud';

interface BendHandleDrag {
  readonly orderId: number;
  readonly waypointIndex: number;
}

const AMBUSH_HOLD_MS = 2000;

function bootstrap(): void {
  const canvas = document.getElementById('map-canvas');
  const hudRoot = document.getElementById('hud-root');
  if (!(canvas instanceof HTMLCanvasElement) || !(hudRoot instanceof HTMLElement)) {
    throw new Error('Required root DOM elements are missing');
  }

  // Keep simulation engine enclosed — never expose GameState on window
  const engine = createEngineController();
  const camera = new Camera();
  const renderer = new CanvasRenderer(canvas);

  let tacticalMode: TacticalMode = 'ARROW';
  let manpowerPercent = 35;
  let simSpeed: SimSpeed = 1;
  let selectedBuildType: BuildingType | null = null;
  let selectedBuildingId: number | null = null;
  let selectedFrontierCells: number[] = [];
  let initialSelectedCount = 0;
  let frontLassoPoints: Point[] = [];
  let hoverCell: Point | null = null;

  let rawArrowPoints: Point[] = [];
  let arrowBendOffset = 0;
  let arrowPreview: ArrowPreview | null = null;
  let activeBendDrag: BendHandleDrag | null = null;

  let ambushTargetId: number | null = null;
  let ambushElapsedMs = 0;
  let lastMouseScreenX = 0;
  let lastMouseScreenY = 0;

  let frontPushStart: Point | null = null;
  let frontPushPreview: FrontPushPreview | null = null;

  let isPanning = false;
  let rmbDownScreenX = 0;
  let rmbDownScreenY = 0;
  let rmbDragged = false;
  let lastPanX = 0;
  let lastPanY = 0;
  const keysPressed = new Set<string>();

  let lastFrameMs = performance.now();
  let accumulatorSec = 0;
  let lastPrunedVersion = -1;

  function resetAmbush(): void {
    ambushTargetId = null;
    ambushElapsedMs = 0;
  }

  function clearFrontSelection(): void {
    selectedFrontierCells = [];
    initialSelectedCount = 0;
    frontLassoPoints = [];
    frontPushStart = null;
    frontPushPreview = null;
  }

  function clearInteractionPreviews(): void {
    rawArrowPoints = [];
    arrowBendOffset = 0;
    arrowPreview = null;
    activeBendDrag = null;
    frontLassoPoints = [];
    frontPushStart = null;
    frontPushPreview = null;
    resetAmbush();
  }

  const hud = new HudController(hudRoot, {
    onTogglePause: () => {
      accumulatorSec = 0;
      lastFrameMs = performance.now();
      engine.dispatch({ type: 'TOGGLE_PAUSE' });
    },
    onRestart: () => {
      accumulatorSec = 0;
      lastFrameMs = performance.now();
      selectedBuildType = null;
      selectedBuildingId = null;
      clearFrontSelection();
      clearInteractionPreviews();
      engine.dispatch({ type: 'RESTART_GAME' });
    },
    onModeChange: (mode) => {
      tacticalMode = mode;
      selectedBuildType = null;
      rawArrowPoints = [];
      arrowBendOffset = 0;
      arrowPreview = null;
      activeBendDrag = null;
      resetAmbush();
    },
    onManpowerPercentChange: (percent) => {
      manpowerPercent = percent;
    },
    onFrontPushDirection: (dirX, dirY) => {
      if (selectedFrontierCells.length === 0) return;
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'CREATE_FRONT_PUSH_ORDER',
        playerId: state.humanPlayerId,
        frontierCells: selectedFrontierCells,
        dirX,
        dirY,
        manpowerPercent,
      });
      clearFrontSelection();
    },
    onClearFrontSelection: () => {
      clearFrontSelection();
    },
    onCancelOrders: () => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'CANCEL_PLAYER_ORDERS',
        playerId: state.humanPlayerId,
      });
    },
    onSpeedChange: (speed) => {
      simSpeed = speed;
      accumulatorSec = 0;
      lastFrameMs = performance.now();
    },
    onDeclareWar: (targetId) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'DECLARE_WAR',
        actorId: state.humanPlayerId,
        targetId,
      });
      hud.update(
        engine.getRenderState(),
        selectedFrontierCells.length,
        selectedBuildType,
        selectedBuildingId,
      );
    },
    onMakePeace: (targetId) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'MAKE_PEACE',
        actorId: state.humanPlayerId,
        targetId,
      });
      hud.update(
        engine.getRenderState(),
        selectedFrontierCells.length,
        selectedBuildType,
        selectedBuildingId,
      );
    },
    onToggleAlliance: (targetId) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'TOGGLE_ALLIANCE',
        actorId: state.humanPlayerId,
        targetId,
      });
      hud.update(
        engine.getRenderState(),
        selectedFrontierCells.length,
        selectedBuildType,
        selectedBuildingId,
      );
    },
    onToggleTrade: (targetId) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'TOGGLE_TRADE',
        actorId: state.humanPlayerId,
        targetId,
      });
      hud.update(
        engine.getRenderState(),
        selectedFrontierCells.length,
        selectedBuildType,
        selectedBuildingId,
      );
    },
    onSelectBuildType: (bType) => {
      selectedBuildType = bType;
      if (bType !== null) {
        clearFrontSelection();
        clearInteractionPreviews();
      }
      hud.update(
        engine.getRenderState(),
        selectedFrontierCells.length,
        selectedBuildType,
        selectedBuildingId,
      );
    },
    onSetTypeOccupancy: (buildingType, occupancyPct) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'SET_BUILDING_TYPE_OCCUPANCY',
        playerId: state.humanPlayerId,
        buildingType,
        occupancyPct,
      });
      hud.update(
        engine.getRenderState(),
        selectedFrontierCells.length,
        selectedBuildType,
        selectedBuildingId,
      );
    },
    onSetBuildingOccupancy: (buildingId, occupancyPct) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'SET_BUILDING_OCCUPANCY',
        playerId: state.humanPlayerId,
        buildingId,
        occupancyPct,
      });
      hud.update(
        engine.getRenderState(),
        selectedFrontierCells.length,
        selectedBuildType,
        selectedBuildingId,
      );
    },
    onSetAllOccupancy: (occupancyPct) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'SET_ALL_OCCUPANCY',
        playerId: state.humanPlayerId,
        occupancyPct,
      });
      hud.update(
        engine.getRenderState(),
        selectedFrontierCells.length,
        selectedBuildType,
        selectedBuildingId,
      );
    },
    onCloseBuildingInspector: () => {
      selectedBuildingId = null;
      hud.update(
        engine.getRenderState(),
        selectedFrontierCells.length,
        selectedBuildType,
        selectedBuildingId,
      );
    },
  });

  function handleResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.resize(w, h);
    camera.clampToViewport(w, h);
  }

  const initialState = engine.getRenderState();
  renderer.resize(window.innerWidth, window.innerHeight);
  camera.fitToScreen(
    window.innerWidth,
    window.innerHeight,
    initialState.width,
    initialState.height,
  );

  window.addEventListener('resize', handleResize);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function isNearSelectedFrontier(worldPt: Point, mapWidth: number): boolean {
    for (const idx of selectedFrontierCells) {
      const cx = (idx % mapWidth) + 0.5;
      const cy = Math.floor(idx / mapWidth) + 0.5;
      if (Math.hypot(worldPt.x - cx, worldPt.y - cy) <= 10) {
        return true;
      }
    }
    return false;
  }

  function findBendHandleAtScreen(
    state: ClientRenderState,
    screenX: number,
    screenY: number,
  ): BendHandleDrag | null {
    for (const order of state.attackOrders) {
      if (order.playerId !== state.humanPlayerId || order.waypoints.length < 3) {
        continue;
      }
      const midIdx = Math.floor(order.waypoints.length / 2);
      const midPt = order.waypoints[midIdx];
      const sc = camera.worldToScreen(midPt.x, midPt.y);
      if (Math.hypot(screenX - sc.x, screenY - sc.y) <= 10) {
        return { orderId: order.id, waypointIndex: midIdx };
      }
    }
    return null;
  }

  function findHumanBuildingAtScreen(
    state: ClientRenderState,
    screenX: number,
    screenY: number,
  ): PublicBuildingInfo | null {
    let best: PublicBuildingInfo | null = null;
    let bestDist = 12;
    for (const building of state.buildings) {
      const sc = camera.worldToScreen(building.x + 0.5, building.y + 0.5);
      const d = Math.hypot(screenX - sc.x, screenY - sc.y);
      if (d <= bestDist) {
        bestDist = d;
        best = building;
      }
    }
    return best;
  }

  function getNonWarForeignOwnerAtPoint(
    state: ClientRenderState,
    pt: Point,
  ): { readonly id: number; readonly name: string; readonly isAllied: boolean } | null {
    const ix = Math.floor(pt.x);
    const iy = Math.floor(pt.y);
    if (ix < 0 || ix >= state.width || iy < 0 || iy >= state.height) {
      return null;
    }
    const owner = state.owners[iy * state.width + ix];
    if (owner < 0 || owner === state.humanPlayerId) {
      return null;
    }
    const target = state.players.find((p) => p.id === owner);
    if (!target || !target.alive) {
      return null;
    }
    if (target.relationToHuman === 'WAR') {
      return null;
    }
    return {
      id: target.id,
      name: target.name,
      isAllied: target.relationToHuman === 'ALLIED',
    };
  }

  function getNonWarForeignOwnerAlongArrow(
    state: ClientRenderState,
    points: ReadonlyArray<Point>,
  ): { readonly id: number; readonly name: string; readonly isAllied: boolean } | null {
    if (points.length === 0) return null;
    const tipTarget = getNonWarForeignOwnerAtPoint(state, points[points.length - 1]);
    if (tipTarget) return tipTarget;

    // Also inspect the full arrow spine in case the player dragged across a foreign state back to own territory
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const found = getNonWarForeignOwnerAtPoint(state, {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        });
        if (found) return found;
      }
    }
    return null;
  }

  function refreshArrowPreview(state: ClientRenderState): void {
    if (rawArrowPoints.length < 2) {
      arrowPreview = null;
      return;
    }
    const waypoints = buildSmoothAttackWaypoints(rawArrowPoints, arrowBendOffset);
    const human = state.players.find((p) => p.id === state.humanPlayerId);
    const committed = (human?.activeManpower ?? 0) * (manpowerPercent / 100);
    arrowPreview = {
      waypoints,
      committedManpower: committed,
      manpowerPercent,
    };
  }

  canvas.addEventListener('mousedown', (e) => {
    const state = engine.getRenderState();
    const worldPt = camera.screenToWorld(e.clientX, e.clientY);
    lastMouseScreenX = e.clientX;
    lastMouseScreenY = e.clientY;

    if (e.button === 2 || e.button === 1) {
      isPanning = true;
      rmbDownScreenX = e.clientX;
      rmbDownScreenY = e.clientY;
      rmbDragged = false;
      lastPanX = e.clientX;
      lastPanY = e.clientY;
      return;
    }

    if (e.button !== 0) {
      return;
    }

    hud.leaderboard.closeProfile();

    if (state.phase === 'SELECT_START') {
      engine.dispatch({
        type: 'SELECT_START_POSITION',
        x: Math.floor(worldPt.x),
        y: Math.floor(worldPt.y),
      });
      return;
    }

    if (selectedBuildType !== null) {
      const prevLastId =
        state.buildings.length > 0 ? state.buildings[state.buildings.length - 1].id : 0;
      engine.dispatch({
        type: 'PLACE_BUILDING',
        playerId: state.humanPlayerId,
        buildingType: selectedBuildType,
        x: Math.floor(worldPt.x),
        y: Math.floor(worldPt.y),
      });
      const post = engine.getRenderState();
      const newest =
        post.buildings.length > 0 ? post.buildings[post.buildings.length - 1] : undefined;
      if (newest && newest.id > prevLastId) {
        selectedBuildingId = newest.id;
        hud.manpowerPanel.setCollapsed(false);
        if (!e.shiftKey) {
          selectedBuildType = null;
        }
      }
      hud.update(post, selectedFrontierCells.length, selectedBuildType, selectedBuildingId);
      return;
    }

    const useFrontTool = e.shiftKey || tacticalMode === 'FRONT_SELECT';
    if (useFrontTool) {
      if (
        selectedFrontierCells.length > 0 &&
        isNearSelectedFrontier(worldPt, state.width)
      ) {
        frontPushStart = worldPt;
        frontPushPreview = {
          fromX: worldPt.x,
          fromY: worldPt.y,
          toX: worldPt.x,
          toY: worldPt.y,
        };
      } else {
        frontLassoPoints = [worldPt];
        selectedFrontierCells = engine.findHumanBorderCellsFromLasso(frontLassoPoints);
        initialSelectedCount = selectedFrontierCells.length;
      }
      return;
    }

    const bendHandle = findBendHandleAtScreen(state, e.clientX, e.clientY);
    if (bendHandle) {
      activeBendDrag = bendHandle;
      return;
    }

    const clickedBuilding = findHumanBuildingAtScreen(state, e.clientX, e.clientY);
    if (clickedBuilding) {
      selectedBuildingId = clickedBuilding.id;
      hud.manpowerPanel.setCollapsed(false);
      hud.update(state, selectedFrontierCells.length, selectedBuildType, selectedBuildingId);
      return;
    }

    selectedBuildingId = null;
    rawArrowPoints = [worldPt];
    arrowBendOffset = 0;
    arrowPreview = null;
    resetAmbush();
  });

  canvas.addEventListener('dblclick', (e) => {
    const state = engine.getRenderState();
    if (state.phase !== 'PLAYING' || e.button !== 0) return;
    if (selectedBuildType !== null) return;
    if (findHumanBuildingAtScreen(state, e.clientX, e.clientY) !== null) return;
    const worldPt = camera.screenToWorld(e.clientX, e.clientY);
    engine.dispatch({
      type: 'BORDER_SURGE_PUSH',
      playerId: state.humanPlayerId,
      x: worldPt.x,
      y: worldPt.y,
      manpowerPercent: Math.max(manpowerPercent, 65),
    });
  });

  window.addEventListener('mousemove', (e) => {
    lastMouseScreenX = e.clientX;
    lastMouseScreenY = e.clientY;

    if (isPanning) {
      if (Math.hypot(e.clientX - rmbDownScreenX, e.clientY - rmbDownScreenY) > 5) {
        rmbDragged = true;
      }
      const dx = e.clientX - lastPanX;
      const dy = e.clientY - lastPanY;
      lastPanX = e.clientX;
      lastPanY = e.clientY;
      camera.pan(dx, dy);
      camera.clampToViewport(window.innerWidth, window.innerHeight);
      return;
    }

    const worldPt = camera.screenToWorld(e.clientX, e.clientY);
    hoverCell = worldPt;

    if (activeBendDrag) {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'BEND_ATTACK_ORDER',
        playerId: state.humanPlayerId,
        orderId: activeBendDrag.orderId,
        waypointIndex: activeBendDrag.waypointIndex,
        x: worldPt.x,
        y: worldPt.y,
      });
      return;
    }

    if (frontPushStart) {
      frontPushPreview = {
        fromX: frontPushStart.x,
        fromY: frontPushStart.y,
        toX: worldPt.x,
        toY: worldPt.y,
      };
      return;
    }

    if (frontLassoPoints.length > 0) {
      const last = frontLassoPoints[frontLassoPoints.length - 1];
      if (Math.hypot(worldPt.x - last.x, worldPt.y - last.y) >= 1.2) {
        frontLassoPoints.push(worldPt);
        selectedFrontierCells = engine.findHumanBorderCellsFromLasso(frontLassoPoints);
        initialSelectedCount = selectedFrontierCells.length;
      }
      return;
    }

    if (rawArrowPoints.length > 0) {
      const last = rawArrowPoints[rawArrowPoints.length - 1];
      if (Math.hypot(worldPt.x - last.x, worldPt.y - last.y) >= 2.2) {
        rawArrowPoints.push(worldPt);
      }
      refreshArrowPreview(engine.getRenderState());
    }
  });

  window.addEventListener('mouseup', (e) => {
    const state = engine.getRenderState();
    const worldPt = camera.screenToWorld(e.clientX, e.clientY);

    if ((e.button === 2 || e.button === 1) && isPanning) {
      isPanning = false;
      if (e.button === 2 && !rmbDragged && state.phase === 'PLAYING') {
        if (selectedBuildType !== null) {
          selectedBuildType = null;
          return;
        }
        const ix = Math.floor(worldPt.x);
        const iy = Math.floor(worldPt.y);
        if (ix >= 0 && ix < state.width && iy >= 0 && iy < state.height) {
          const owner = state.owners[iy * state.width + ix];
          if (owner >= 0 && owner !== state.humanPlayerId) {
            hud.leaderboard.openProfile(owner, e.clientX + 8, e.clientY + 8);
          } else {
            hud.leaderboard.closeProfile();
          }
        }
      }
      return;
    }

    if (e.button !== 0) {
      return;
    }

    if (activeBendDrag) {
      activeBendDrag = null;
      return;
    }

    if (frontPushStart) {
      const dx = worldPt.x - frontPushStart.x;
      const dy = worldPt.y - frontPushStart.y;
      if (Math.hypot(dx, dy) >= 4 && selectedFrontierCells.length > 0) {
        engine.dispatch({
          type: 'CREATE_FRONT_PUSH_ORDER',
          playerId: state.humanPlayerId,
          frontierCells: selectedFrontierCells,
          dirX: dx,
          dirY: dy,
          manpowerPercent,
        });
        clearFrontSelection();
      } else {
        selectedFrontierCells = engine.findHumanBorderCellsFromLasso([worldPt]);
        initialSelectedCount = selectedFrontierCells.length;
      }
      frontPushStart = null;
      frontPushPreview = null;
      return;
    }

    if (frontLassoPoints.length > 0) {
      frontLassoPoints.push(worldPt);
      selectedFrontierCells = engine.findHumanBorderCellsFromLasso(frontLassoPoints);
      initialSelectedCount = selectedFrontierCells.length;
      frontLassoPoints = [];
      return;
    }

    if (rawArrowPoints.length > 0) {
      const last = rawArrowPoints[rawArrowPoints.length - 1];
      if (Math.hypot(worldPt.x - last.x, worldPt.y - last.y) >= 1.0) {
        rawArrowPoints.push(worldPt);
      }

      const pathLen = computePolylineLength(rawArrowPoints);
      if (pathLen < 6) {
        // Short click on/near border triggers a targeted local surge
        engine.dispatch({
          type: 'BORDER_SURGE_PUSH',
          playerId: state.humanPlayerId,
          x: worldPt.x,
          y: worldPt.y,
          manpowerPercent,
        });
      } else {
        const waypoints = buildSmoothAttackWaypoints(rawArrowPoints, arrowBendOffset);
        if (waypoints.length >= 2 && computePolylineLength(waypoints) >= 6) {
          const spineNonWar = getNonWarForeignOwnerAlongArrow(state, waypoints);
          // Early release before 2s Ambush: never declares war, still advances into wilderness along path
          engine.dispatch({
            type: 'CREATE_ATTACK_ORDER',
            playerId: state.humanPlayerId,
            waypoints,
            manpowerPercent,
            targetOwnerId: spineNonWar ? WILDERNESS_OWNER : undefined,
          });
        }
      }

      rawArrowPoints = [];
      arrowBendOffset = 0;
      arrowPreview = null;
      resetAmbush();
    }
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (rawArrowPoints.length >= 2) {
        const delta = e.deltaY < 0 ? 5.5 : -5.5;
        arrowBendOffset = Math.max(-70, Math.min(70, arrowBendOffset + delta));
        refreshArrowPreview(engine.getRenderState());
        return;
      }

      const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
      camera.zoomAtScreenPoint(factor, e.clientX, e.clientY);
      camera.clampToViewport(window.innerWidth, window.innerHeight);
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    keysPressed.add(e.code);

    if (e.code === 'Space') {
      e.preventDefault();
      accumulatorSec = 0;
      lastFrameMs = performance.now();
      engine.dispatch({ type: 'TOGGLE_PAUSE' });
      return;
    }

    if (e.code === 'Escape') {
      selectedBuildType = null;
      selectedBuildingId = null;
      clearFrontSelection();
      clearInteractionPreviews();
      hud.leaderboard.closeProfile();
      return;
    }

    if (e.code.startsWith('Digit')) {
      const digit = Number(e.code.slice(5));
      if (digit >= 1 && digit <= ALL_BUILDING_TYPES.length) {
        const state = engine.getRenderState();
        if (state.phase === 'PLAYING') {
          const bType = ALL_BUILDING_TYPES[digit - 1];
          selectedBuildType = selectedBuildType === bType ? null : bType;
          if (selectedBuildType !== null) {
            clearFrontSelection();
            clearInteractionPreviews();
          }
        }
        return;
      }
    }

    if (e.code === 'KeyM') {
      const next: TacticalMode =
        hud.getMode() === 'ARROW' ? 'FRONT_SELECT' : 'ARROW';
      hud.setMode(next);
      return;
    }

    if (e.code === 'KeyX') {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'CANCEL_PLAYER_ORDERS',
        playerId: state.humanPlayerId,
      });
      return;
    }

    if (rawArrowPoints.length >= 2 && (e.code === 'KeyQ' || e.code === 'KeyE')) {
      const delta = e.code === 'KeyQ' ? -6 : 6;
      arrowBendOffset = Math.max(-70, Math.min(70, arrowBendOffset + delta));
      refreshArrowPreview(engine.getRenderState());
      return;
    }

    if (selectedFrontierCells.length > 0) {
      let dirX = 0;
      let dirY = 0;
      if (e.code === 'ArrowUp') dirY = -1;
      else if (e.code === 'ArrowDown') dirY = 1;
      else if (e.code === 'ArrowLeft') dirX = -1;
      else if (e.code === 'ArrowRight') dirX = 1;

      if (dirX !== 0 || dirY !== 0) {
        e.preventDefault();
        const state = engine.getRenderState();
        engine.dispatch({
          type: 'CREATE_FRONT_PUSH_ORDER',
          playerId: state.humanPlayerId,
          frontierCells: selectedFrontierCells,
          dirX,
          dirY,
          manpowerPercent,
        });
        clearFrontSelection();
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    keysPressed.delete(e.code);
  });

  function frame(nowMs: number): void {
    const rawDtMs = Math.min(100, Math.max(0, nowMs - lastFrameMs));
    const dtSec = rawDtMs / 1000;
    lastFrameMs = nowMs;

    camera.updateKeyboardPan(
      keysPressed,
      dtSec,
      window.innerWidth,
      window.innerHeight,
    );

    if (engine.isPlayingAndUnpaused()) {
      const maxAccumulator = Math.max(1.0, simSpeed * 0.25);
      const preAccum = Math.min(maxAccumulator, accumulatorSec + dtSec * simSpeed);
      const plan = planSimulationTicks(accumulatorSec, dtSec, simSpeed);
      const tickBudgetStart = performance.now();
      let ticksRun = 0;

      while (ticksRun < plan.ticksToRun) {
        if (ticksRun > 0 && performance.now() - tickBudgetStart >= 12) {
          break;
        }
        engine.dispatch({ type: 'TICK' });
        ticksRun++;
      }
      accumulatorSec = Math.max(0, preAccum - ticksRun * TICK_DT);
    } else {
      accumulatorSec = 0;
    }

    const renderState = engine.getRenderState();

    // Auto-clear stale front selection when borders advance or disappear
    if (
      selectedFrontierCells.length > 0 &&
      frontLassoPoints.length === 0 &&
      renderState.stateVersion !== lastPrunedVersion
    ) {
      lastPrunedVersion = renderState.stateVersion;
      selectedFrontierCells = engine.pruneHumanBorderCells(
        selectedFrontierCells,
        initialSelectedCount,
      );
      if (selectedFrontierCells.length === 0) {
        initialSelectedCount = 0;
      }
    }

    let ambushOverlay: AmbushOverlay | null = null;
    let ambushTriggered = false;
    if (renderState.phase === 'PLAYING' && rawArrowPoints.length >= 2) {
      const previewWaypoints = buildSmoothAttackWaypoints(rawArrowPoints, arrowBendOffset);
      const nonWarTarget = getNonWarForeignOwnerAlongArrow(renderState, previewWaypoints);
      if (nonWarTarget) {
        if (ambushTargetId !== nonWarTarget.id) {
          ambushTargetId = nonWarTarget.id;
          ambushElapsedMs = 0;
        } else {
          ambushElapsedMs += rawDtMs;
        }

        if (ambushElapsedMs >= AMBUSH_HOLD_MS) {
          const waypoints = buildSmoothAttackWaypoints(rawArrowPoints, arrowBendOffset);
          if (waypoints.length >= 2 && computePolylineLength(waypoints) >= 6) {
            engine.dispatch({
              type: 'AMBUSH_ATTACK',
              playerId: renderState.humanPlayerId,
              targetId: nonWarTarget.id,
              waypoints,
              manpowerPercent,
            });
            ambushTriggered = true;
          }
          rawArrowPoints = [];
          arrowBendOffset = 0;
          arrowPreview = null;
          resetAmbush();
        } else {
          ambushOverlay = {
            screenX: lastMouseScreenX,
            screenY: lastMouseScreenY,
            targetName: nonWarTarget.name,
            isBetrayal: nonWarTarget.isAllied,
            progress: ambushElapsedMs / AMBUSH_HOLD_MS,
            remainingSec: Math.max(0, (AMBUSH_HOLD_MS - ambushElapsedMs) / 1000),
          };
        }
      } else {
        resetAmbush();
      }
    } else {
      resetAmbush();
    }

    const finalState = ambushTriggered ? engine.getRenderState() : renderState;
    if (
      selectedBuildingId !== null &&
      !finalState.buildings.some((b) => b.id === selectedBuildingId)
    ) {
      selectedBuildingId = null;
    }

    let buildPreview: BuildPlacementPreview | null = null;
    if (finalState.phase === 'PLAYING' && selectedBuildType !== null && hoverCell) {
      const ix = Math.floor(hoverCell.x);
      const iy = Math.floor(hoverCell.y);
      const human = finalState.players.find((p) => p.id === finalState.humanPlayerId);
      const check = validateBuildingPlacement(
        finalState,
        human,
        selectedBuildType,
        ix,
        iy,
      );
      buildPreview = {
        buildingType: selectedBuildType,
        x: ix,
        y: iy,
        valid: check.valid,
        reasonCs: check.reasonCs,
        inMatchingZone: check.inMatchingZone,
        isFreePowerPlant: check.isFreePowerPlant,
      };
    }

    hud.update(finalState, selectedFrontierCells.length, selectedBuildType, selectedBuildingId);
    renderer.render(finalState, camera, {
      hoverCell,
      arrowPreview,
      frontLassoPoints,
      selectedFrontierCells,
      frontPushPreview,
      activeBendOrderId: activeBendDrag?.orderId ?? null,
      ambush: ambushOverlay,
      buildPreview,
      selectedBuildingId,
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

bootstrap();
