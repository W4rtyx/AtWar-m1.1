import './style.css';
import { validateBuildingPlacement } from './engine/buildings';
import {
  buildSmoothAttackWaypoints,
  computePolylineLength,
} from './engine/frontExpansion';
import { createEngineController, planSimulationTicks } from './engine/simulation';
import {
  ALL_BUILDING_TYPES,
  BuildBatchSize,
  BuildingType,
  ClientRenderState,
  Point,
  PublicBuildingInfo,
  TICK_DT,
  TerrainType,
  WILDERNESS_OWNER,
} from './engine/types';
import { Camera } from './render/camera';
import {
  AmbushOverlay,
  ArrowPreview,
  BuildPlacementPreview,
  CanvasRenderer,
  FrontPushPreview,
  SelectedTarget,
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
  let buildBatchSize: BuildBatchSize = 1;
  let selectedBuildType: BuildingType | null = null;
  let selectedBuildingId: number | null = null;
  let selectedTarget: SelectedTarget | null = null;
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

  function syncHud(stateOverride?: ClientRenderState): void {
    hud.update(
      stateOverride ?? engine.getRenderState(),
      selectedFrontierCells.length,
      selectedBuildType,
      selectedBuildingId,
      buildBatchSize,
      selectedTarget,
    );
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
      selectedTarget = null;
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
      syncHud();
    },
    onMakePeace: (targetId) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'MAKE_PEACE',
        actorId: state.humanPlayerId,
        targetId,
      });
      syncHud();
    },
    onToggleAlliance: (targetId) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'TOGGLE_ALLIANCE',
        actorId: state.humanPlayerId,
        targetId,
      });
      syncHud();
    },
    onToggleTrade: (targetId) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'TOGGLE_TRADE',
        actorId: state.humanPlayerId,
        targetId,
      });
      syncHud();
    },
    onSelectBuildType: (bType) => {
      selectedBuildType = bType;
      if (bType !== null) {
        selectedTarget = null;
        clearFrontSelection();
        clearInteractionPreviews();
      }
      syncHud();
    },
    onBatchSizeChange: (batch) => {
      buildBatchSize = batch;
      syncHud();
    },
    onStackBuilding: (buildingId, batch) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'STACK_BUILDING',
        playerId: state.humanPlayerId,
        buildingId,
        batchSize: batch,
      });
      syncHud();
    },
    onDemolishBuilding: (buildingId, demolishAll) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'DEMOLISH_BUILDING',
        playerId: state.humanPlayerId,
        buildingId,
        demolishAll,
      });
      const post = engine.getRenderState();
      if (selectedBuildingId !== null && !post.buildings.some((b) => b.id === selectedBuildingId)) {
        selectedBuildingId = null;
      }
      syncHud(post);
    },
    onInspectBuilding: (buildingId) => {
      selectedBuildingId = buildingId;
      hud.manpowerPanel.setCollapsed(false);
      syncHud();
    },
    onSetTypeOccupancy: (buildingType, occupancyPct) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'SET_BUILDING_TYPE_OCCUPANCY',
        playerId: state.humanPlayerId,
        buildingType,
        occupancyPct,
      });
      syncHud();
    },
    onSetBuildingOccupancy: (buildingId, occupancyPct) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'SET_BUILDING_OCCUPANCY',
        playerId: state.humanPlayerId,
        buildingId,
        occupancyPct,
      });
      syncHud();
    },
    onSetAllOccupancy: (occupancyPct) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'SET_ALL_OCCUPANCY',
        playerId: state.humanPlayerId,
        occupancyPct,
      });
      syncHud();
    },
    onCloseBuildingInspector: () => {
      selectedBuildingId = null;
      syncHud();
    },
    onLaunchTargetAttack: () => {
      if (!selectedTarget) return;
      const state = engine.getRenderState();
      const targetOwnerId =
        selectedTarget.kind === 'STATE' ? selectedTarget.ownerId : WILDERNESS_OWNER;
      engine.dispatch({
        type: 'TARGETED_ATTACK',
        playerId: state.humanPlayerId,
        targetOwnerId,
        anchorX: selectedTarget.anchorX,
        anchorY: selectedTarget.anchorY,
        manpowerPercent,
      });
      clearFrontSelection();
      syncHud();
    },
    onFinishOff: (targetId) => {
      const state = engine.getRenderState();
      engine.dispatch({
        type: 'FINISH_OFF_TARGET',
        playerId: state.humanPlayerId,
        targetOwnerId: targetId,
      });
      clearFrontSelection();
      selectedTarget = null;
      syncHud();
    },
    onClearTarget: () => {
      selectedTarget = null;
      syncHud();
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
    hud.buildingMenu.close();

    if (state.phase === 'SELECT_START') {
      engine.dispatch({
        type: 'SELECT_START_POSITION',
        x: Math.floor(worldPt.x),
        y: Math.floor(worldPt.y),
      });
      return;
    }

    if (selectedBuildType !== null) {
      const ix = Math.floor(worldPt.x);
      const iy = Math.floor(worldPt.y);
      engine.dispatch({
        type: 'PLACE_BUILDING',
        playerId: state.humanPlayerId,
        buildingType: selectedBuildType,
        x: ix,
        y: iy,
        batchSize: buildBatchSize,
      });
      const post = engine.getRenderState();
      if (post.stateVersion !== state.stateVersion) {
        let matched: PublicBuildingInfo | undefined = post.buildings.find(
          (b) => b.x === ix && b.y === iy,
        );
        if (!matched) {
          let bestDist = 7;
          for (const b of post.buildings) {
            const d = Math.hypot(b.x - ix, b.y - iy);
            if (d <= bestDist && b.type === selectedBuildType) {
              bestDist = d;
              matched = b;
            }
          }
        }
        if (matched) {
          selectedBuildingId = matched.id;
          hud.manpowerPanel.setCollapsed(false);
        }
        if (!e.shiftKey) {
          selectedBuildType = null;
        }
      }
      syncHud(post);
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
      syncHud(state);
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
    clearFrontSelection();
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
        if (selectedTarget !== null) {
          selectedTarget = null;
          return;
        }
        const hitBuilding = findHumanBuildingAtScreen(state, e.clientX, e.clientY);
        if (hitBuilding) {
          hud.leaderboard.closeProfile();
          hud.buildingMenu.open(hitBuilding.id, e.clientX + 8, e.clientY + 8);
          return;
        }
        const ix = Math.floor(worldPt.x);
        const iy = Math.floor(worldPt.y);
        if (ix >= 0 && ix < state.width && iy >= 0 && iy < state.height) {
          const owner = state.owners[iy * state.width + ix];
          if (owner >= 0 && owner !== state.humanPlayerId) {
            hud.buildingMenu.close();
            hud.leaderboard.openProfile(owner, e.clientX + 8, e.clientY + 8);
          } else {
            hud.leaderboard.closeProfile();
            hud.buildingMenu.close();
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
        const ix = Math.floor(worldPt.x);
        const iy = Math.floor(worldPt.y);
        if (ix >= 0 && ix < state.width && iy >= 0 && iy < state.height) {
          const cellTerrain = state.terrain[iy * state.width + ix];
          const owner = state.owners[iy * state.width + ix];
          if (cellTerrain === TerrainType.WATER) {
            selectedTarget = null;
          } else if (owner === WILDERNESS_OWNER) {
            selectedTarget = { kind: 'WILDERNESS', anchorX: ix, anchorY: iy };
          } else if (owner >= 0 && owner !== state.humanPlayerId) {
            selectedTarget = { kind: 'STATE', ownerId: owner, anchorX: ix, anchorY: iy };
          } else {
            selectedTarget = null;
          }
        }
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
          clearFrontSelection();
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
      selectedTarget = null;
      clearFrontSelection();
      clearInteractionPreviews();
      hud.leaderboard.closeProfile();
      hud.buildingMenu.close();
      return;
    }

    const buildHotkeyIdx =
      e.code.startsWith('Digit')
        ? e.code === 'Digit0'
          ? 9
          : Number(e.code.slice(5)) - 1
        : e.code === 'Minus'
          ? 10
          : -1;
    if (buildHotkeyIdx >= 0 && buildHotkeyIdx < ALL_BUILDING_TYPES.length) {
      const state = engine.getRenderState();
      if (state.phase === 'PLAYING') {
        const bType = ALL_BUILDING_TYPES[buildHotkeyIdx];
        selectedBuildType = selectedBuildType === bType ? null : bType;
        if (selectedBuildType !== null) {
          selectedTarget = null;
          clearFrontSelection();
          clearInteractionPreviews();
        }
      }
      return;
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
      const maxAccumulator = Math.max(1.0, simSpeed * 0.35);
      const preAccum = Math.min(maxAccumulator, accumulatorSec + dtSec * simSpeed);
      const plan = planSimulationTicks(accumulatorSec, dtSec, simSpeed);
      const frameTickBudgetMs = simSpeed >= 50 ? 28 : simSpeed >= 10 ? 20 : 12;
      const tickBudgetStart = performance.now();
      let ticksRun = 0;

      while (ticksRun < plan.ticksToRun) {
        if (ticksRun > 0 && performance.now() - tickBudgetStart >= frameTickBudgetMs) {
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

    if (selectedTarget) {
      if (selectedTarget.kind === 'STATE') {
        const targetOwnerId = selectedTarget.ownerId;
        const stillAlive = renderState.players.some(
          (p) => p.id === targetOwnerId && p.alive,
        );
        if (!stillAlive) {
          selectedTarget = null;
        }
      } else {
        const ax = Math.floor(selectedTarget.anchorX);
        const ay = Math.floor(selectedTarget.anchorY);
        if (
          ax >= 0 &&
          ax < renderState.width &&
          ay >= 0 &&
          ay < renderState.height &&
          renderState.owners[ay * renderState.width + ax] === renderState.humanPlayerId
        ) {
          selectedTarget = null;
        }
      }
    }

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
            clearFrontSelection();
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
    if (selectedTarget !== null && selectedTarget.kind === 'STATE') {
      const targetOwner = selectedTarget.ownerId;
      if (!finalState.players.some((p) => p.id === targetOwner && p.alive)) {
        selectedTarget = null;
      }
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
        buildBatchSize,
      );
      buildPreview = {
        buildingType: selectedBuildType,
        x: ix,
        y: iy,
        valid: check.valid,
        reasonCs: check.reasonCs,
        inMatchingZone: check.inMatchingZone,
        isFreePowerPlant: check.isFreePowerPlant,
        stackTargetId: check.stackTargetId,
        plannedUnits: check.plannedUnits,
      };
    }

    syncHud(finalState);
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
      selectedTarget,
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

bootstrap();
