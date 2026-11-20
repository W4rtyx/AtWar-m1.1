import './style.css';
import { createEngineController } from './engine/simulation';
import { Point2D, TICK_DT } from './engine/types';
import { Camera } from './render/camera';
import {
  ArrowPreview,
  CanvasRenderer,
  FrontPushPreview,
} from './render/canvasRenderer';
import { HudController, TacticalMode } from './ui/hud';

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
  let selectedFrontierCells: number[] = [];
  let frontLassoPoints: Point2D[] = [];
  let hoverCell: Point2D | null = null;
  let arrowDragStart: Point2D | null = null;
  let arrowPreview: ArrowPreview | null = null;
  let frontPushStart: Point2D | null = null;
  let frontPushPreview: FrontPushPreview | null = null;

  let isPanning = false;
  let lastPanX = 0;
  let lastPanY = 0;
  const keysPressed = new Set<string>();

  const hud = new HudController(hudRoot, {
    onTogglePause: () => {
      engine.dispatch({ type: 'TOGGLE_PAUSE' });
    },
    onRestart: () => {
      selectedFrontierCells = [];
      frontLassoPoints = [];
      arrowDragStart = null;
      arrowPreview = null;
      frontPushStart = null;
      frontPushPreview = null;
      engine.dispatch({ type: 'RESTART_GAME' });
    },
    onModeChange: (mode) => {
      tacticalMode = mode;
      arrowDragStart = null;
      arrowPreview = null;
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
      selectedFrontierCells = [];
    },
    onClearFrontSelection: () => {
      selectedFrontierCells = [];
      frontLassoPoints = [];
      frontPushStart = null;
      frontPushPreview = null;
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

  function isNearSelectedFrontier(worldPt: Point2D, mapWidth: number): boolean {
    for (const idx of selectedFrontierCells) {
      const cx = (idx % mapWidth) + 0.5;
      const cy = Math.floor(idx / mapWidth) + 0.5;
      if (Math.hypot(worldPt.x - cx, worldPt.y - cy) <= 7.5) {
        return true;
      }
    }
    return false;
  }

  canvas.addEventListener('mousedown', (e) => {
    const state = engine.getRenderState();
    const worldPt = camera.screenToWorld(e.clientX, e.clientY);

    if (e.button === 2 || e.button === 1) {
      isPanning = true;
      lastPanX = e.clientX;
      lastPanY = e.clientY;
      return;
    }

    if (e.button !== 0) {
      return;
    }

    if (state.phase === 'SELECT_START') {
      engine.dispatch({
        type: 'SELECT_START_POSITION',
        x: Math.floor(worldPt.x),
        y: Math.floor(worldPt.y),
      });
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
      }
      return;
    }

    // Attack arrow drag start
    arrowDragStart = {
      x: Math.floor(worldPt.x),
      y: Math.floor(worldPt.y),
    };
    const human = state.players.find((p) => p.id === state.humanPlayerId);
    const committed = (human?.manpower ?? 0) * (manpowerPercent / 100);
    arrowPreview = {
      fromX: arrowDragStart.x,
      fromY: arrowDragStart.y,
      toX: arrowDragStart.x,
      toY: arrowDragStart.y,
      committedManpower: committed,
      manpowerPercent,
    };
  });

  window.addEventListener('mousemove', (e) => {
    if (isPanning) {
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
      if (Math.hypot(worldPt.x - last.x, worldPt.y - last.y) >= 0.7) {
        frontLassoPoints.push(worldPt);
        selectedFrontierCells = engine.findHumanBorderCellsFromLasso(frontLassoPoints);
      }
      return;
    }

    if (arrowDragStart) {
      const state = engine.getRenderState();
      const human = state.players.find((p) => p.id === state.humanPlayerId);
      const committed = (human?.manpower ?? 0) * (manpowerPercent / 100);
      arrowPreview = {
        fromX: arrowDragStart.x,
        fromY: arrowDragStart.y,
        toX: Math.floor(worldPt.x),
        toY: Math.floor(worldPt.y),
        committedManpower: committed,
        manpowerPercent,
      };
    }
  });

  window.addEventListener('mouseup', (e) => {
    if ((e.button === 2 || e.button === 1) && isPanning) {
      isPanning = false;
      return;
    }

    if (e.button !== 0) {
      return;
    }

    const state = engine.getRenderState();
    const worldPt = camera.screenToWorld(e.clientX, e.clientY);

    if (frontPushStart) {
      const dx = worldPt.x - frontPushStart.x;
      const dy = worldPt.y - frontPushStart.y;
      if (Math.hypot(dx, dy) >= 2.5 && selectedFrontierCells.length > 0) {
        engine.dispatch({
          type: 'CREATE_FRONT_PUSH_ORDER',
          playerId: state.humanPlayerId,
          frontierCells: selectedFrontierCells,
          dirX: dx,
          dirY: dy,
          manpowerPercent,
        });
        selectedFrontierCells = [];
      } else {
        // Short click near frontier re-seeds a fresh lasso selection
        selectedFrontierCells = engine.findHumanBorderCellsFromLasso([worldPt]);
      }
      frontPushStart = null;
      frontPushPreview = null;
      return;
    }

    if (frontLassoPoints.length > 0) {
      frontLassoPoints.push(worldPt);
      selectedFrontierCells = engine.findHumanBorderCellsFromLasso(frontLassoPoints);
      frontLassoPoints = [];
      return;
    }

    if (arrowDragStart) {
      const toX = Math.floor(worldPt.x);
      const toY = Math.floor(worldPt.y);
      if (Math.hypot(toX - arrowDragStart.x, toY - arrowDragStart.y) >= 3) {
        engine.dispatch({
          type: 'CREATE_ATTACK_ORDER',
          playerId: state.humanPlayerId,
          fromX: arrowDragStart.x,
          fromY: arrowDragStart.y,
          toX,
          toY,
          manpowerPercent,
        });
      }
      arrowDragStart = null;
      arrowPreview = null;
    }
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
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
      engine.dispatch({ type: 'TOGGLE_PAUSE' });
      return;
    }

    if (e.code === 'Escape') {
      selectedFrontierCells = [];
      frontLassoPoints = [];
      arrowDragStart = null;
      arrowPreview = null;
      frontPushStart = null;
      frontPushPreview = null;
      return;
    }

    if (e.code === 'KeyM') {
      const next: TacticalMode =
        hud.getMode() === 'ARROW' ? 'FRONT_SELECT' : 'ARROW';
      hud.setMode(next);
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
        selectedFrontierCells = [];
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    keysPressed.delete(e.code);
  });

  let lastFrameMs = performance.now();
  let accumulatorSec = 0;

  function frame(nowMs: number): void {
    const dtSec = Math.min(0.1, Math.max(0, (nowMs - lastFrameMs) / 1000));
    lastFrameMs = nowMs;

    camera.updateKeyboardPan(
      keysPressed,
      dtSec,
      window.innerWidth,
      window.innerHeight,
    );

    const preState = engine.getRenderState();
    if (preState.phase === 'PLAYING' && !preState.paused) {
      accumulatorSec = Math.min(0.5, accumulatorSec + dtSec);
      while (accumulatorSec >= TICK_DT) {
        engine.dispatch({ type: 'TICK' });
        accumulatorSec -= TICK_DT;
      }
    } else {
      accumulatorSec = 0;
    }

    const renderState = engine.getRenderState();
    hud.update(renderState, selectedFrontierCells.length);
    renderer.render(renderState, camera, {
      hoverCell,
      arrowPreview,
      frontLassoPoints,
      selectedFrontierCells,
      frontPushPreview,
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

bootstrap();
