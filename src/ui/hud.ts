import { BASE_ENERGY_RESERVE_CAPACITY } from '../engine/energyGrid';
import {
  BuildBatchSize,
  BuildingType,
  ClientRenderState,
  PublicPlayerInfo,
  TICK_RATE,
} from '../engine/types';
import { SelectedTarget } from '../render/canvasRenderer';
import {
  BuildMenuCallbacks,
  BuildMenuController,
  BuildingContextCallbacks,
  BuildingContextMenuController,
  TerrainBuildMenuCallbacks,
  TerrainBuildMenuController,
} from './buildMenu';
import { DiplomacyCallbacks, LeaderboardController } from './leaderboard';
import { ManpowerPanelCallbacks, ManpowerPanelController } from './manpowerPanel';
import { UnitPanelCallbacks, UnitPanelController } from './unitPanel';

export type TacticalMode = 'ARROW' | 'UNIT_SELECT' | 'FRONT_SELECT';
export type SimSpeed = 1 | 2 | 5 | 10 | 50;

export interface HudCallbacks
  extends DiplomacyCallbacks,
    BuildMenuCallbacks,
    TerrainBuildMenuCallbacks,
    BuildingContextCallbacks,
    ManpowerPanelCallbacks,
    UnitPanelCallbacks {
  readonly onTogglePause: () => void;
  readonly onRestart: () => void;
  readonly onModeChange: (mode: TacticalMode) => void;
  readonly onManpowerPercentChange: (percent: number) => void;
  readonly onFrontPushDirection: (dirX: number, dirY: number) => void;
  readonly onClearFrontSelection: () => void;
  readonly onCancelOrders: () => void;
  readonly onSpeedChange: (speed: SimSpeed) => void;
  readonly onLaunchTargetAttack: () => void;
  readonly onClearTarget: () => void;
}

function formatGameTimer(tick: number): string {
  const totalSeconds = Math.floor(tick / TICK_RATE);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatSignedRate(rate: number): string {
  const prefix = rate >= 0 ? '+' : '−';
  return `${prefix}${Math.abs(rate).toFixed(1)}/s`;
}

export class HudController {
  private readonly root: HTMLElement;
  private readonly callbacks: HudCallbacks;
  public readonly leaderboard: LeaderboardController;
  public readonly manpowerPanel: ManpowerPanelController;
  public readonly buildMenu: BuildMenuController;
  public readonly terrainBuildMenu: TerrainBuildMenuController;
  public readonly buildingMenu: BuildingContextMenuController;
  public readonly unitPanel: UnitPanelController;

  private phaseBadge!: HTMLElement;
  private statsGroup!: HTMLElement;
  private moneyValueEl!: HTMLElement;
  private moneyRateEl!: HTMLElement;
  private knowledgeValueEl!: HTMLElement;
  private knowledgeRateEl!: HTMLElement;
  private materialValueEl!: HTMLElement;
  private materialRateEl!: HTMLElement;
  private industryValueEl!: HTMLElement;
  private industryRateEl!: HTMLElement;
  private energyValueEl!: HTMLElement;
  private energyRateEl!: HTMLElement;
  private energyPillEl!: HTMLElement;
  private manpowerValueEl!: HTMLElement;
  private manpowerIncomeEl!: HTMLElement;
  private mpSuppressionEl!: HTMLElement;
  private optimumBadgeEl!: HTMLElement;
  private allocToggleBtn!: HTMLButtonElement;
  private buildingsValueEl!: HTMLElement;
  private territoryValueEl!: HTMLElement;
  private ordersValueEl!: HTMLElement;
  private blackoutAlertEl!: HTMLElement;
  private betrayalAlertEl!: HTMLElement;
  private timerValueEl!: HTMLElement;
  private speedButtons!: NodeListOf<HTMLButtonElement>;
  private pauseBtn!: HTMLButtonElement;
  private restartBtn!: HTMLButtonElement;

  private startBanner!: HTMLElement;
  private noticeToastEl!: HTMLElement;
  private lastNoticeId = -1;
  private noticeHideAtMs = 0;
  private bottomRow!: HTMLElement;
  private bottomStack!: HTMLElement;
  private sliderEl!: HTMLInputElement;
  private sliderReadoutEl!: HTMLElement;
  private modeArrowBtn!: HTMLButtonElement;
  private modeUnitBtn!: HTMLButtonElement;
  private modeFrontBtn!: HTMLButtonElement;
  private cancelOrdersBtn!: HTMLButtonElement;

  private defeatOverlayEl!: HTMLElement;
  private defeatReasonEl!: HTMLElement;
  private defeatMetaEl!: HTMLElement;
  private defeatRestartBtn!: HTMLButtonElement;
  private defeatDismissBtn!: HTMLButtonElement;
  private defeatDismissed = false;

  private targetBarEl!: HTMLElement;
  private targetTitleEl!: HTMLElement;
  private targetWarBtn!: HTMLButtonElement;
  private targetAttackBtn!: HTMLButtonElement;
  private targetFinishOffBtn!: HTMLButtonElement;
  private targetCancelBtn!: HTMLButtonElement;
  private currentTargetOwnerId: number | null = null;

  private frontPadEl!: HTMLElement;
  private frontCountEl!: HTMLElement;

  private currentMode: TacticalMode = 'ARROW';
  private currentPercent = 35;
  private currentSpeed: SimSpeed = 1;

  public constructor(root: HTMLElement, callbacks: HudCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.buildDom();

    this.manpowerPanel = new ManpowerPanelController({
      onSetTypeOccupancy: callbacks.onSetTypeOccupancy,
      onSetBuildingOccupancy: callbacks.onSetBuildingOccupancy,
      onSetAllOccupancy: callbacks.onSetAllOccupancy,
      onCloseBuildingInspector: callbacks.onCloseBuildingInspector,
      onStackBuilding: callbacks.onStackBuilding,
      onDemolishBuilding: callbacks.onDemolishBuilding,
    });

    this.leaderboard = new LeaderboardController(this.root, {
      onDeclareWar: callbacks.onDeclareWar,
      onMakePeace: callbacks.onMakePeace,
      onToggleAlliance: callbacks.onToggleAlliance,
      onToggleTrade: callbacks.onToggleTrade,
      onFinishOff: callbacks.onFinishOff,
    });

    this.buildMenu = new BuildMenuController({
      onSelectBuildType: callbacks.onSelectBuildType,
      onBatchSizeChange: callbacks.onBatchSizeChange,
    });

    this.terrainBuildMenu = new TerrainBuildMenuController(this.root, {
      onPlaceBuildingAt: callbacks.onPlaceBuildingAt,
      onBatchSizeChange: callbacks.onBatchSizeChange,
    });

    this.buildingMenu = new BuildingContextMenuController(this.root, {
      onStackBuilding: callbacks.onStackBuilding,
      onDemolishBuilding: callbacks.onDemolishBuilding,
      onInspectBuilding: callbacks.onInspectBuilding,
      onProduceUnit: callbacks.onProduceUnit,
    });

    this.unitPanel = new UnitPanelController({
      onQuickProduceUnit: callbacks.onQuickProduceUnit,
      onSetUnitsStance: callbacks.onSetUnitsStance,
      onMergeUnits: callbacks.onMergeUnits,
      onStartParadrop: callbacks.onStartParadrop,
      onStartArtilleryFire: callbacks.onStartArtilleryFire,
      onCancelArtilleryFire: callbacks.onCancelArtilleryFire,
      onClearUnitSelection: callbacks.onClearUnitSelection,
    });

    const middleSlot = this.query('[data-el="middle-slot"]');
    middleSlot.appendChild(this.manpowerPanel.getPanelElement());
    middleSlot.appendChild(this.leaderboard.getPanelElement());

    this.bottomStack.insertBefore(this.buildMenu.getPanelElement(), this.bottomRow);
    this.bottomStack.insertBefore(this.targetBarEl, this.buildMenu.getPanelElement());

    const bottomRightStack = this.query('[data-el="bottom-right-stack"]');
    bottomRightStack.insertBefore(
      this.unitPanel.getPanelElement(),
      bottomRightStack.firstElementChild,
    );
  }

  private buildDom(): void {
    this.root.innerHTML = `
      <div class="hud-panel hud-top-bar">
        <div class="hud-top-row-main">
          <div class="hud-brand">
            <span class="hud-title">At War // Evropa</span>
            <span class="hud-phase-badge" data-el="phase-badge">Fáze 1: Výběr startu</span>
            <span class="hud-timer" data-el="game-timer">00:00</span>
          </div>

          <div class="hud-actions">
            <div class="hud-speed-group" role="group" aria-label="Rychlost simulace">
              <button type="button" class="hud-btn hud-speed-btn active" data-speed="1">1x</button>
              <button type="button" class="hud-btn hud-speed-btn" data-speed="2">2x</button>
              <button type="button" class="hud-btn hud-speed-btn" data-speed="5">5x</button>
              <button type="button" class="hud-btn hud-speed-btn" data-speed="10">10x</button>
              <button type="button" class="hud-btn hud-speed-btn" data-speed="50">50x</button>
            </div>
            <button type="button" class="hud-btn" data-action="pause" disabled>Pauza</button>
            <button type="button" class="hud-btn" data-action="restart">Restart</button>
          </div>
        </div>

        <div class="hud-resource-strip hidden" data-el="stats-group">
          <div class="hud-res-pill">
            <span class="hud-stat-label">Peníze</span>
            <span class="hud-stat-value" data-el="money-val">0</span>
            <span class="hud-stat-sub" data-el="money-rate">+0.0/s</span>
          </div>
          <div class="hud-res-pill">
            <span class="hud-stat-label">Znalosti</span>
            <span class="hud-stat-value" data-el="knowledge-val">0</span>
            <span class="hud-stat-sub" data-el="knowledge-rate">+0.0/s</span>
          </div>
          <div class="hud-res-pill">
            <span class="hud-stat-label">Stav. mat.</span>
            <span class="hud-stat-value" data-el="material-val">0</span>
            <span class="hud-stat-sub" data-el="material-rate">+0.0/s</span>
          </div>
          <div class="hud-res-pill">
            <span class="hud-stat-label">Průmysl</span>
            <span class="hud-stat-value" data-el="industry-val">0</span>
            <span class="hud-stat-sub" data-el="industry-rate">+0.0/s</span>
          </div>
          <div class="hud-res-pill" data-el="energy-pill">
            <span class="hud-stat-label">Energie</span>
            <span class="hud-stat-value" data-el="energy-val">0</span>
            <span class="hud-stat-sub" data-el="energy-rate">+0.0/s</span>
          </div>
          <div class="hud-res-pill hud-res-pill-mp">
            <span class="hud-stat-label">MP (Ready · Assg · Max)</span>
            <span class="hud-stat-value" data-el="manpower-val">0 (0 %) · 0 · 0</span>
            <span class="hud-stat-sub" data-el="manpower-inc">+0.0/s</span>
            <span class="hud-betrayal-pill hidden" data-el="mp-suppression-badge">Potlačeno −0 %</span>
            <span class="hud-optimum-badge" data-el="optimum-badge">Opt 100 %</span>
            <button type="button" class="hud-btn hud-alloc-toggle-btn" data-action="toggle-alloc">
              Alokace
            </button>
          </div>
          <div class="hud-res-pill">
            <span class="hud-stat-label">Budovy</span>
            <span class="hud-stat-value" data-el="buildings-val">1</span>
          </div>
          <div class="hud-res-pill">
            <span class="hud-stat-label">Území</span>
            <span class="hud-stat-value" data-el="territory-val">0 %</span>
          </div>
          <div class="hud-res-pill">
            <span class="hud-stat-label">Útoky</span>
            <span class="hud-stat-value" data-el="orders-val">0</span>
          </div>
          <span class="hud-blackout-pill hidden" data-el="blackout-alert">BLACKOUT 0 %</span>
          <span class="hud-betrayal-pill hidden" data-el="betrayal-alert">ZRÁDCE −35 % obrana (0s)</span>
        </div>
      </div>

      <div class="hud-middle-slot" data-el="middle-slot">
        <div class="hud-panel hud-prompt-banner" data-el="start-banner">
          Klikněte levým tlačítkem na libovolnou volnou pevninu Evropy pro založení hlavního města.
        </div>
        <div class="hud-notice-toast hidden" data-el="notice-toast"></div>
      </div>

      <div class="hud-bottom-row">
        <div class="hud-bottom-stack" data-el="bottom-stack">
          <div class="hud-panel hud-target-bar hidden" data-el="target-bar">
            <span class="hud-target-title" data-el="target-title">Cíl: -</span>
            <div class="hud-target-actions">
              <button type="button" class="hud-btn hud-btn-danger hidden" data-target-action="war">
                Vyhlásit válku
              </button>
              <button type="button" class="hud-btn" data-target-action="attack">
                Útok (35 %)
              </button>
              <button type="button" class="hud-btn hud-btn-finish-off hidden" data-target-action="finish-off">
                Dorazit (0 MP)
              </button>
              <button type="button" class="hud-btn" data-target-action="cancel">
                Zrušit (RMB)
              </button>
            </div>
          </div>

          <div class="hud-panel hud-tactical-bar hidden" data-el="tactical-bar">
            <div class="hud-control-group">
              <label class="hud-stat-label" for="mp-slider">Nasazení</label>
              <input
                id="mp-slider"
                class="hud-slider"
                type="range"
                min="10"
                max="100"
                step="5"
                value="35"
                data-el="mp-slider"
              />
              <span class="hud-slider-readout" data-el="mp-readout">35 % (0 MP)</span>
            </div>

            <div class="hud-divider"></div>

            <div class="hud-control-group">
              <button type="button" class="hud-btn active" data-mode="ARROW">
                Šipka
              </button>
              <button type="button" class="hud-btn" data-mode="UNIT_SELECT" title="Výběr jednotek tažením rámce (V)">
                Jednotky (V)
              </button>
              <button type="button" class="hud-btn" data-mode="FRONT_SELECT">
                Fronta (M)
              </button>
              <button
                type="button"
                class="hud-btn hud-btn-danger"
                data-action="cancel-orders"
                disabled
                title="Odvolat všechny aktivní šipky a vrátit zálohy (X)"
              >
                Zrušit útoky (X)
              </button>
            </div>

            <div class="hud-front-pad hidden" data-el="front-pad">
              <span class="hud-front-count" data-el="front-count">Fronta: 0</span>
              <button type="button" class="hud-btn hud-dir-btn" data-dir="0,-1" title="Tlačit na sever">↑ Sever</button>
              <button type="button" class="hud-btn hud-dir-btn" data-dir="0,1" title="Tlačit na jih">↓ Jih</button>
              <button type="button" class="hud-btn hud-dir-btn" data-dir="-1,0" title="Tlačit na západ">← Západ</button>
              <button type="button" class="hud-btn hud-dir-btn" data-dir="1,0" title="Tlačit na východ">→ Východ</button>
              <button type="button" class="hud-btn hud-dir-btn" data-action="clear-front" title="Zrušit výběr (Esc)">✕</button>
            </div>
          </div>
        </div>

        <div class="hud-bottom-right-stack" data-el="bottom-right-stack">
          <div class="hud-panel hud-legend">
            <div class="hud-legend-row">
              <span class="hud-legend-key">LMB klik / laso</span>
              <span>Jednotky (přednost) · Cíl / šipka (2s Ambush)</span>
            </div>
            <div class="hud-legend-row">
              <span class="hud-legend-key">RMB na mapu</span>
              <span>Přesun vybraných jednotek · Budova · Diplomacie</span>
            </div>
            <div class="hud-legend-row">
              <span class="hud-legend-key">B pod kurzorem</span>
              <span>Radiální stavební menu platné pro daný terén</span>
            </div>
            <div class="hud-legend-row">
              <span class="hud-legend-key">L / G / P / F / V</span>
              <span>LOCK/RANGE · Sloučit · Výsadek · Palba · Výběr</span>
            </div>
          </div>
        </div>
      </div>

      <div class="hud-defeat-overlay hidden" data-el="defeat-overlay">
        <div class="hud-panel hud-defeat-modal">
          <div class="hud-defeat-badge">PORÁŽKA</div>
          <h2 class="hud-defeat-title">Váš stát padl</h2>
          <p class="hud-defeat-reason" data-el="defeat-reason">
            Stát ztratil veškerou populaci a Manpower.
          </p>
          <div class="hud-defeat-meta" data-el="defeat-meta">Doba partie: 00:00</div>
          <div class="hud-defeat-actions">
            <button type="button" class="hud-btn hud-btn-ally" data-el="defeat-restart">
              Nová partie
            </button>
            <button type="button" class="hud-btn" data-el="defeat-dismiss">
              Sledovat mapu
            </button>
          </div>
        </div>
      </div>
    `;

    this.phaseBadge = this.query('[data-el="phase-badge"]');
    this.statsGroup = this.query('[data-el="stats-group"]');
    this.moneyValueEl = this.query('[data-el="money-val"]');
    this.moneyRateEl = this.query('[data-el="money-rate"]');
    this.knowledgeValueEl = this.query('[data-el="knowledge-val"]');
    this.knowledgeRateEl = this.query('[data-el="knowledge-rate"]');
    this.materialValueEl = this.query('[data-el="material-val"]');
    this.materialRateEl = this.query('[data-el="material-rate"]');
    this.industryValueEl = this.query('[data-el="industry-val"]');
    this.industryRateEl = this.query('[data-el="industry-rate"]');
    this.energyValueEl = this.query('[data-el="energy-val"]');
    this.energyRateEl = this.query('[data-el="energy-rate"]');
    this.energyPillEl = this.query('[data-el="energy-pill"]');
    this.manpowerValueEl = this.query('[data-el="manpower-val"]');
    this.manpowerIncomeEl = this.query('[data-el="manpower-inc"]');
    this.mpSuppressionEl = this.query('[data-el="mp-suppression-badge"]');
    this.optimumBadgeEl = this.query('[data-el="optimum-badge"]');
    this.allocToggleBtn = this.query<HTMLButtonElement>('[data-action="toggle-alloc"]');
    this.buildingsValueEl = this.query('[data-el="buildings-val"]');
    this.territoryValueEl = this.query('[data-el="territory-val"]');
    this.ordersValueEl = this.query('[data-el="orders-val"]');
    this.blackoutAlertEl = this.query('[data-el="blackout-alert"]');
    this.betrayalAlertEl = this.query('[data-el="betrayal-alert"]');
    this.timerValueEl = this.query('[data-el="game-timer"]');
    this.speedButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-speed]');
    this.pauseBtn = this.query<HTMLButtonElement>('[data-action="pause"]');
    this.restartBtn = this.query<HTMLButtonElement>('[data-action="restart"]');
    this.startBanner = this.query('[data-el="start-banner"]');
    this.noticeToastEl = this.query('[data-el="notice-toast"]');
    this.bottomStack = this.query('[data-el="bottom-stack"]');
    this.bottomRow = this.query('[data-el="tactical-bar"]');
    this.sliderEl = this.query<HTMLInputElement>('[data-el="mp-slider"]');
    this.sliderReadoutEl = this.query('[data-el="mp-readout"]');
    this.modeArrowBtn = this.query<HTMLButtonElement>('[data-mode="ARROW"]');
    this.modeUnitBtn = this.query<HTMLButtonElement>('[data-mode="UNIT_SELECT"]');
    this.modeFrontBtn = this.query<HTMLButtonElement>('[data-mode="FRONT_SELECT"]');
    this.cancelOrdersBtn = this.query<HTMLButtonElement>('[data-action="cancel-orders"]');
    this.frontPadEl = this.query('[data-el="front-pad"]');
    this.frontCountEl = this.query('[data-el="front-count"]');

    this.defeatOverlayEl = this.query('[data-el="defeat-overlay"]');
    this.defeatReasonEl = this.query('[data-el="defeat-reason"]');
    this.defeatMetaEl = this.query('[data-el="defeat-meta"]');
    this.defeatRestartBtn = this.query<HTMLButtonElement>('[data-el="defeat-restart"]');
    this.defeatDismissBtn = this.query<HTMLButtonElement>('[data-el="defeat-dismiss"]');

    this.targetBarEl = this.query('[data-el="target-bar"]');
    this.targetTitleEl = this.query('[data-el="target-title"]');
    this.targetWarBtn = this.query<HTMLButtonElement>('[data-target-action="war"]');
    this.targetAttackBtn = this.query<HTMLButtonElement>('[data-target-action="attack"]');
    this.targetFinishOffBtn = this.query<HTMLButtonElement>('[data-target-action="finish-off"]');
    this.targetCancelBtn = this.query<HTMLButtonElement>('[data-target-action="cancel"]');

    this.pauseBtn.addEventListener('click', () => this.callbacks.onTogglePause());
    this.restartBtn.addEventListener('click', () => this.callbacks.onRestart());
    this.cancelOrdersBtn.addEventListener('click', () => this.callbacks.onCancelOrders());
    this.allocToggleBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.manpowerPanel.setCollapsed(!this.manpowerPanel.isCollapsed());
    });

    this.targetBarEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    this.targetWarBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.currentTargetOwnerId !== null) {
        this.callbacks.onDeclareWar(this.currentTargetOwnerId);
      }
    });
    this.targetAttackBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.callbacks.onLaunchTargetAttack();
    });
    this.targetFinishOffBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.targetFinishOffBtn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.currentTargetOwnerId !== null) {
        this.callbacks.onFinishOff(this.currentTargetOwnerId);
      }
    });
    this.targetCancelBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.callbacks.onClearTarget();
    });

    for (const btn of this.speedButtons) {
      btn.addEventListener('click', () => {
        const val = Number(btn.dataset.speed) as SimSpeed;
        this.setSpeed(val);
      });
    }

    this.sliderEl.addEventListener('input', () => {
      this.currentPercent = Number(this.sliderEl.value);
      this.callbacks.onManpowerPercentChange(this.currentPercent);
    });

    this.modeArrowBtn.addEventListener('click', () => this.setMode('ARROW'));
    this.modeUnitBtn.addEventListener('click', () => this.setMode('UNIT_SELECT'));
    this.modeFrontBtn.addEventListener('click', () => this.setMode('FRONT_SELECT'));

    this.defeatOverlayEl.addEventListener('mousedown', (e) => e.stopPropagation());
    this.defeatRestartBtn.addEventListener('click', () => {
      this.defeatDismissed = false;
      this.callbacks.onRestart();
    });
    this.defeatDismissBtn.addEventListener('click', () => {
      this.defeatDismissed = true;
      this.defeatOverlayEl.classList.add('hidden');
    });

    const dirButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-dir]');
    for (const btn of dirButtons) {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.dir;
        if (!raw) return;
        const [dxStr, dyStr] = raw.split(',');
        this.callbacks.onFrontPushDirection(Number(dxStr), Number(dyStr));
      });
    }

    const clearFrontBtn = this.query<HTMLButtonElement>('[data-action="clear-front"]');
    clearFrontBtn.addEventListener('click', () => this.callbacks.onClearFrontSelection());
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) {
      throw new Error(`Missing HUD element: ${selector}`);
    }
    return el;
  }

  public setSpeed(speed: SimSpeed): void {
    this.currentSpeed = speed;
    for (const btn of this.speedButtons) {
      btn.classList.toggle('active', Number(btn.dataset.speed) === speed);
    }
    this.callbacks.onSpeedChange(speed);
  }

  public getSpeed(): SimSpeed {
    return this.currentSpeed;
  }

  public setMode(mode: TacticalMode): void {
    this.currentMode = mode;
    this.modeArrowBtn.classList.toggle('active', mode === 'ARROW');
    this.modeUnitBtn.classList.toggle('active', mode === 'UNIT_SELECT');
    this.modeFrontBtn.classList.toggle('active', mode === 'FRONT_SELECT');
    this.callbacks.onModeChange(mode);
  }

  public getMode(): TacticalMode {
    return this.currentMode;
  }

  public getManpowerPercent(): number {
    return this.currentPercent;
  }

  public update(
    state: ClientRenderState,
    selectedFrontierCount: number,
    selectedBuildType: BuildingType | null = null,
    selectedBuildingId: number | null = null,
    buildBatchSize: BuildBatchSize = 1,
    selectedTarget: SelectedTarget | null = null,
    selectedUnitIds: ReadonlySet<number> = new Set(),
    paradropUnitId: number | null = null,
    artilleryFireMode: boolean = false,
  ): void {
    const isPlaying = state.phase === 'PLAYING';

    this.phaseBadge.textContent = isPlaying
      ? state.paused
        ? 'Fáze 2: Pozastaveno'
        : 'Fáze 2: Ekonomika a fronty'
      : 'Fáze 1: Výběr startu';
    this.phaseBadge.classList.toggle('phase-playing', isPlaying);

    this.timerValueEl.textContent = formatGameTimer(state.tick);
    this.startBanner.classList.toggle('hidden', isPlaying);
    this.statsGroup.classList.toggle('hidden', !isPlaying);
    this.bottomRow.classList.toggle('hidden', !isPlaying);

    this.pauseBtn.disabled = !isPlaying;
    this.pauseBtn.textContent = state.paused ? 'Pokračovat' : 'Pauza';
    this.pauseBtn.classList.toggle('paused', state.paused && isPlaying);

    this.leaderboard.update(state);
    this.manpowerPanel.update(state, selectedBuildingId);
    this.buildMenu.update(state, selectedBuildType, buildBatchSize);
    this.terrainBuildMenu.update(state, buildBatchSize);
    this.buildingMenu.update(state);
    this.unitPanel.update(state, selectedUnitIds, paradropUnitId, artilleryFireMode);

    if (state.lastNotice && state.lastNotice.id !== this.lastNoticeId) {
      this.lastNoticeId = state.lastNotice.id;
      this.noticeToastEl.textContent = state.lastNotice.messageCs;
      this.noticeToastEl.classList.remove('hidden');
      this.noticeHideAtMs = (typeof performance !== 'undefined' ? performance.now() : 0) + 4200;
    } else if (
      this.noticeHideAtMs > 0 &&
      typeof performance !== 'undefined' &&
      performance.now() > this.noticeHideAtMs
    ) {
      this.noticeToastEl.classList.add('hidden');
      this.noticeHideAtMs = 0;
    }

    if (!isPlaying) {
      this.defeatDismissed = false;
      this.defeatOverlayEl.classList.add('hidden');
      this.blackoutAlertEl.classList.add('hidden');
      this.betrayalAlertEl.classList.add('hidden');
      this.targetBarEl.classList.add('hidden');
      return;
    }

    const human: PublicPlayerInfo | undefined = state.players.find(
      (p) => p.id === state.humanPlayerId,
    );

    if (human?.isEliminated) {
      if (!this.defeatDismissed) {
        this.defeatReasonEl.textContent =
          human.eliminationReason === 'MANPOWER_DEPLETED'
            ? 'Populace a celkový Manpower vašeho státu klesly na 0 — nemá kdo obsluhovat elektrárny ani bránit hranice.'
            : 'Vaše říše ztratila veškeré území na mapě.';
        this.defeatMetaEl.textContent = `Doba partie: ${formatGameTimer(state.tick)}`;
        this.defeatOverlayEl.classList.remove('hidden');
      }
    } else {
      this.defeatDismissed = false;
      this.defeatOverlayEl.classList.add('hidden');
    }

    const money = human?.money ?? 0;
    const moneyRate = human?.moneyIncomePerSec ?? 0;
    const knowledge = human?.knowledge ?? 0;
    const knowledgeRate = human?.knowledgeIncomePerSec ?? 0;
    const material = human?.buildingMaterial ?? 0;
    const materialRate = human?.buildingMaterialIncomePerSec ?? 0;
    const industry = human?.industry ?? 0;
    const industryRate = human?.industryIncomePerSec ?? 0;
    const energyRes = human?.energyReserve ?? 0;
    const energyMax = human?.energyReserveMax ?? BASE_ENERGY_RESERVE_CAPACITY;
    const energyNet = human?.energyNetPerSec ?? 0;
    const blackoutActive = human?.blackoutActive ?? false;
    const blackoutSeverity = human?.blackoutSeverity ?? 0;
    const energySupplyRatio = human?.energySupplyRatio ?? 1;

    const totalManpower = Math.max(1, Math.floor(human?.manpower ?? 0));
    const readyManpower = Math.floor(human?.activeManpower ?? 0);
    const assignedManpower = Math.round(human?.allocatedManpower ?? 0);
    const maxManpower = Math.round(human?.maxManpower ?? 0);
    const readyPct = Math.round((readyManpower / totalManpower) * 100);
    const income = human?.manpowerIncomePerSec ?? 0;
    const efficiency = human?.manpowerGrowthEfficiency ?? 0;
    const cells = human?.territoryCells ?? 0;
    const pctLand = state.totalLandCells > 0 ? (cells / state.totalLandCells) * 100 : 0;

    let completedBuildings = 0;
    let queuedBuildings = 0;
    for (const b of state.buildings) {
      if (b.ownerId !== state.humanPlayerId) continue;
      completedBuildings += b.stackCount;
      queuedBuildings += b.underConstructionCount;
    }

    const activeHumanOrders =
      state.attackOrders.filter((o) => o.playerId === state.humanPlayerId).length +
      state.frontPushOrders.filter((o) => o.playerId === state.humanPlayerId).length;

    this.moneyValueEl.textContent = `${Math.floor(money)}`;
    this.moneyRateEl.textContent = formatSignedRate(moneyRate);

    this.knowledgeValueEl.textContent = `${Math.floor(knowledge)}`;
    this.knowledgeRateEl.textContent = formatSignedRate(knowledgeRate);

    this.materialValueEl.textContent = `${Math.floor(material)}`;
    this.materialRateEl.textContent = formatSignedRate(materialRate);

    this.industryValueEl.textContent = `${Math.floor(industry)}`;
    this.industryRateEl.textContent = formatSignedRate(industryRate);

    this.energyValueEl.textContent = `${Math.floor(energyRes)} / ${Math.round(energyMax)}`;
    this.energyRateEl.textContent = formatSignedRate(energyNet);
    this.energyRateEl.classList.toggle('rate-negative', energyNet < 0);
    this.energyPillEl.classList.toggle('energy-deficit', energyNet < -0.05 && !blackoutActive);
    this.energyPillEl.classList.toggle('energy-blackout', blackoutActive);

    if (blackoutActive) {
      this.blackoutAlertEl.classList.remove('hidden', 'is-deficit');
      this.blackoutAlertEl.classList.add('is-blackout');
      this.blackoutAlertEl.textContent = `BLACKOUT ${Math.round(blackoutSeverity * 100)} % (výkon −${Math.round((1 - energySupplyRatio) * 100)} %)`;
    } else if (blackoutSeverity > 0.02) {
      this.blackoutAlertEl.classList.remove('hidden', 'is-blackout');
      this.blackoutAlertEl.classList.add('is-deficit');
      this.blackoutAlertEl.textContent = `ZOTAVENÍ SÍTĚ ${Math.round((1 - blackoutSeverity) * 100)} %`;
    } else if (energyNet < -0.05) {
      const secLeft = Math.ceil(energyRes / Math.max(0.1, -energyNet));
      this.blackoutAlertEl.classList.remove('hidden', 'is-blackout');
      this.blackoutAlertEl.classList.add('is-deficit');
      this.blackoutAlertEl.textContent = `DEFICIT ENERGIE (${secLeft}s)`;
    } else {
      this.blackoutAlertEl.classList.add('hidden');
    }

    this.manpowerValueEl.textContent = `${readyManpower} (${readyPct} %) · ${assignedManpower} · ${maxManpower}`;
    this.manpowerIncomeEl.textContent = `+${income.toFixed(1)}/s`;
    const suppressionPct = Math.round((human?.manpowerSuppressionIntensity ?? 0) * 100);
    this.mpSuppressionEl.classList.toggle('hidden', suppressionPct < 1);
    if (suppressionPct >= 1) {
      this.mpSuppressionEl.textContent = `Potlačeno −${suppressionPct} %`;
    }

    const optPct = Math.round(efficiency * 100);
    this.optimumBadgeEl.textContent = `Opt ${optPct} %`;
    this.optimumBadgeEl.classList.toggle('optimum-mid', optPct >= 45 && optPct < 80);
    this.optimumBadgeEl.classList.toggle('optimum-low', optPct < 45);
    this.allocToggleBtn.classList.toggle('active', !this.manpowerPanel.isCollapsed());

    this.buildingsValueEl.textContent =
      queuedBuildings > 0 ? `${completedBuildings} (+${queuedBuildings})` : `${completedBuildings}`;
    this.territoryValueEl.textContent = `${cells} (${pctLand.toFixed(1)} %)`;
    this.ordersValueEl.textContent = `${activeHumanOrders}`;
    this.cancelOrdersBtn.disabled = activeHumanOrders === 0;

    const betrayalTicks = human?.betrayalDebuffTicks ?? 0;
    this.betrayalAlertEl.classList.toggle('hidden', betrayalTicks <= 0);
    if (betrayalTicks > 0) {
      this.betrayalAlertEl.textContent = `ZRÁDCE −35 % obrana (${Math.ceil(betrayalTicks / TICK_RATE)}s)`;
    }

    const commitAmount = Math.round(readyManpower * (this.currentPercent / 100));
    this.sliderReadoutEl.textContent = `${this.currentPercent} % (${commitAmount} MP)`;

    const hasFront = selectedFrontierCount > 0;
    this.frontPadEl.classList.toggle('hidden', !hasFront);
    if (hasFront) {
      this.frontCountEl.textContent = `Úsek: ${selectedFrontierCount} b.`;
    }

    this.syncTargetActionBar(state, selectedTarget);
  }

  private syncTargetActionBar(
    state: ClientRenderState,
    selectedTarget: SelectedTarget | null,
  ): void {
    if (!selectedTarget) {
      this.currentTargetOwnerId = null;
      this.targetBarEl.classList.add('hidden');
      return;
    }

    if (selectedTarget.kind === 'WILDERNESS') {
      this.currentTargetOwnerId = null;
      this.targetTitleEl.textContent = `Cíl: Volné území [${Math.floor(selectedTarget.anchorX)}, ${Math.floor(selectedTarget.anchorY)}]`;
      this.targetWarBtn.classList.add('hidden');
      this.targetFinishOffBtn.classList.add('hidden');
      this.targetAttackBtn.classList.remove('hidden');
      this.targetAttackBtn.textContent = `Útok (${this.currentPercent} %)`;
      this.targetBarEl.classList.remove('hidden');
      return;
    }

    const human = state.players.find((p) => p.id === state.humanPlayerId);
    const readyMp = Math.floor(human?.activeManpower ?? 0);
    const targetPlayer = state.players.find(
      (p) => p.id === selectedTarget.ownerId && p.alive,
    );
    if (!targetPlayer) {
      this.currentTargetOwnerId = null;
      this.targetBarEl.classList.add('hidden');
      return;
    }

    this.currentTargetOwnerId = targetPlayer.id;
    const isWar = targetPlayer.relationToHuman === 'WAR';
    const isAllied = targetPlayer.relationToHuman === 'ALLIED';
    const relLabel = isWar ? 'VÁLKA' : isAllied ? 'SPOJENEC' : 'NEUTRÁLNÍ';

    this.targetTitleEl.textContent = `Cíl: ${targetPlayer.name} [${relLabel}]`;
    this.targetWarBtn.classList.toggle('hidden', isWar);
    this.targetWarBtn.textContent = isAllied
      ? 'Zradit a vyhlásit válku'
      : 'Vyhlásit válku';
    this.targetAttackBtn.classList.toggle('hidden', !isWar);
    if (isWar) {
      this.targetAttackBtn.textContent = `Útok (${this.currentPercent} %)`;
    }

    const canFinishOff =
      targetPlayer.finishOffEligible && targetPlayer.finishOffRequiredManpower !== null;
    this.targetFinishOffBtn.classList.toggle('hidden', !canFinishOff);
    if (canFinishOff && targetPlayer.finishOffRequiredManpower !== null) {
      const req = targetPlayer.finishOffRequiredManpower;
      this.targetFinishOffBtn.textContent = isWar
        ? `Dorazit (${req} MP)`
        : isAllied
          ? `Zradit a dorazit (${req} MP)`
          : `Válka a dorazit (${req} MP)`;
      this.targetFinishOffBtn.disabled = readyMp < req;
      this.targetFinishOffBtn.title =
        readyMp < req
          ? `Vyžaduje ${req} Ready MP (máte ${readyMp} MP)`
          : 'Spustí koordinovaný útok ze všech okolních hranic na doražení zbytků soupeře';
    }
    this.targetBarEl.classList.remove('hidden');
  }
}
