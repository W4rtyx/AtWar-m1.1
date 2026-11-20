import { ClientRenderState, PublicPlayerInfo, TICK_RATE } from '../engine/types';
import { DiplomacyCallbacks, LeaderboardController } from './leaderboard';

export type TacticalMode = 'ARROW' | 'FRONT_SELECT';
export type SimSpeed = 1 | 2 | 5 | 10 | 50;

export interface HudCallbacks extends DiplomacyCallbacks {
  readonly onTogglePause: () => void;
  readonly onRestart: () => void;
  readonly onModeChange: (mode: TacticalMode) => void;
  readonly onManpowerPercentChange: (percent: number) => void;
  readonly onFrontPushDirection: (dirX: number, dirY: number) => void;
  readonly onClearFrontSelection: () => void;
  readonly onCancelOrders: () => void;
  readonly onSpeedChange: (speed: SimSpeed) => void;
}

function formatGameTimer(tick: number): string {
  const totalSeconds = Math.floor(tick / TICK_RATE);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export class HudController {
  private readonly root: HTMLElement;
  private readonly callbacks: HudCallbacks;
  public readonly leaderboard: LeaderboardController;

  private phaseBadge!: HTMLElement;
  private statsGroup!: HTMLElement;
  private manpowerValueEl!: HTMLElement;
  private manpowerIncomeEl!: HTMLElement;
  private optimumBadgeEl!: HTMLElement;
  private territoryValueEl!: HTMLElement;
  private ordersValueEl!: HTMLElement;
  private betrayalAlertEl!: HTMLElement;
  private timerValueEl!: HTMLElement;
  private speedButtons!: NodeListOf<HTMLButtonElement>;
  private pauseBtn!: HTMLButtonElement;
  private restartBtn!: HTMLButtonElement;

  private startBanner!: HTMLElement;
  private bottomRow!: HTMLElement;
  private sliderEl!: HTMLInputElement;
  private sliderReadoutEl!: HTMLElement;
  private modeArrowBtn!: HTMLButtonElement;
  private modeFrontBtn!: HTMLButtonElement;
  private cancelOrdersBtn!: HTMLButtonElement;

  private frontPadEl!: HTMLElement;
  private frontCountEl!: HTMLElement;

  private currentMode: TacticalMode = 'ARROW';
  private currentPercent = 35;
  private currentSpeed: SimSpeed = 1;

  public constructor(root: HTMLElement, callbacks: HudCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.buildDom();
    this.leaderboard = new LeaderboardController(this.root, {
      onDeclareWar: callbacks.onDeclareWar,
      onMakePeace: callbacks.onMakePeace,
      onToggleAlliance: callbacks.onToggleAlliance,
    });

    const middleSlot = this.query('[data-el="middle-slot"]');
    middleSlot.appendChild(this.leaderboard.getPanelElement());
  }

  private buildDom(): void {
    this.root.innerHTML = `
      <div class="hud-panel hud-top-bar">
        <div class="hud-brand">
          <span class="hud-title">At War // Evropa</span>
          <span class="hud-phase-badge" data-el="phase-badge">Fáze 1: Výběr startu</span>
          <span class="hud-timer" data-el="game-timer">00:00</span>
        </div>

        <div class="hud-stats hidden" data-el="stats-group">
          <div class="hud-stat">
            <span class="hud-stat-label">Manpower</span>
            <span class="hud-stat-value" data-el="manpower-val">0 / 0</span>
          </div>
          <div class="hud-stat">
            <span class="hud-stat-label">Růst</span>
            <span class="hud-stat-sub" data-el="manpower-inc">+0.0/s</span>
            <span class="hud-optimum-badge" data-el="optimum-badge">Optimum 100 %</span>
          </div>
          <div class="hud-stat">
            <span class="hud-stat-label">Území</span>
            <span class="hud-stat-value" data-el="territory-val">0 %</span>
          </div>
          <div class="hud-stat">
            <span class="hud-stat-label">Útoky</span>
            <span class="hud-stat-value" data-el="orders-val">0</span>
          </div>
          <span class="hud-betrayal-pill hidden" data-el="betrayal-alert">ZRÁDCE −35 % obrana (0s)</span>
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

      <div class="hud-middle-slot" data-el="middle-slot">
        <div class="hud-panel hud-prompt-banner" data-el="start-banner">
          Klikněte levým tlačítkem na libovolnou volnou pevninu Evropy pro založení hlavního města.
        </div>
      </div>

      <div class="hud-bottom-row">
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
              Zakřivená šipka
            </button>
            <button type="button" class="hud-btn" data-mode="FRONT_SELECT">
              Výběr úseku fronty
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

        <div class="hud-panel hud-legend">
          <div class="hud-legend-row">
            <span class="hud-legend-key">LMB tažení / 2s držení</span>
            <span>Útok (2s Ambush vyhlásí válku)</span>
          </div>
          <div class="hud-legend-row">
            <span class="hud-legend-key">RMB na stát / Tabulka</span>
            <span>Diplomacie: Válka, Mír, Aliance</span>
          </div>
          <div class="hud-legend-row">
            <span class="hud-legend-key">Kolečko / Q·E / Uzel</span>
            <span>Ohnutí šipky či zoom mapy</span>
          </div>
          <div class="hud-legend-row">
            <span class="hud-legend-key">Shift + LMB / RMB tah</span>
            <span>Výběr fronty a posun mapy</span>
          </div>
        </div>
      </div>
    `;

    this.phaseBadge = this.query('[data-el="phase-badge"]');
    this.statsGroup = this.query('[data-el="stats-group"]');
    this.manpowerValueEl = this.query('[data-el="manpower-val"]');
    this.manpowerIncomeEl = this.query('[data-el="manpower-inc"]');
    this.optimumBadgeEl = this.query('[data-el="optimum-badge"]');
    this.territoryValueEl = this.query('[data-el="territory-val"]');
    this.ordersValueEl = this.query('[data-el="orders-val"]');
    this.betrayalAlertEl = this.query('[data-el="betrayal-alert"]');
    this.timerValueEl = this.query('[data-el="game-timer"]');
    this.speedButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-speed]');
    this.pauseBtn = this.query<HTMLButtonElement>('[data-action="pause"]');
    this.restartBtn = this.query<HTMLButtonElement>('[data-action="restart"]');
    this.startBanner = this.query('[data-el="start-banner"]');
    this.bottomRow = this.query('[data-el="tactical-bar"]');
    this.sliderEl = this.query<HTMLInputElement>('[data-el="mp-slider"]');
    this.sliderReadoutEl = this.query('[data-el="mp-readout"]');
    this.modeArrowBtn = this.query<HTMLButtonElement>('[data-mode="ARROW"]');
    this.modeFrontBtn = this.query<HTMLButtonElement>('[data-mode="FRONT_SELECT"]');
    this.cancelOrdersBtn = this.query<HTMLButtonElement>('[data-action="cancel-orders"]');
    this.frontPadEl = this.query('[data-el="front-pad"]');
    this.frontCountEl = this.query('[data-el="front-count"]');

    this.pauseBtn.addEventListener('click', () => this.callbacks.onTogglePause());
    this.restartBtn.addEventListener('click', () => this.callbacks.onRestart());
    this.cancelOrdersBtn.addEventListener('click', () => this.callbacks.onCancelOrders());

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
    this.modeFrontBtn.addEventListener('click', () => this.setMode('FRONT_SELECT'));

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
  ): void {
    const isPlaying = state.phase === 'PLAYING';

    this.phaseBadge.textContent = isPlaying
      ? state.paused
        ? 'Fáze 2: Pozastaveno'
        : 'Fáze 2: Expanze a fronty'
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

    if (!isPlaying) {
      this.betrayalAlertEl.classList.add('hidden');
      return;
    }

    const human: PublicPlayerInfo | undefined = state.players.find(
      (p) => p.id === state.humanPlayerId,
    );

    const manpower = human?.manpower ?? 0;
    const maxManpower = human?.maxManpower ?? 0;
    const income = human?.manpowerIncomePerSec ?? 0;
    const efficiency = human?.manpowerGrowthEfficiency ?? 0;
    const cells = human?.territoryCells ?? 0;
    const pctLand = state.totalLandCells > 0 ? (cells / state.totalLandCells) * 100 : 0;
    const fillPct = maxManpower > 0 ? Math.round((manpower / maxManpower) * 100) : 0;

    const activeHumanOrders =
      state.attackOrders.filter((o) => o.playerId === state.humanPlayerId).length +
      state.frontPushOrders.filter((o) => o.playerId === state.humanPlayerId).length;

    this.manpowerValueEl.textContent = `${Math.floor(manpower)} / ${Math.round(maxManpower)} (${fillPct} %)`;
    this.manpowerIncomeEl.textContent = `+${income.toFixed(1)}/s`;

    const optPct = Math.round(efficiency * 100);
    this.optimumBadgeEl.textContent = `Optimum ${optPct} %`;
    this.optimumBadgeEl.classList.toggle('optimum-mid', optPct >= 45 && optPct < 80);
    this.optimumBadgeEl.classList.toggle('optimum-low', optPct < 45);

    this.territoryValueEl.textContent = `${cells} (${pctLand.toFixed(1)} %)`;
    this.ordersValueEl.textContent = `${activeHumanOrders}`;
    this.cancelOrdersBtn.disabled = activeHumanOrders === 0;

    const betrayalTicks = human?.betrayalDebuffTicks ?? 0;
    this.betrayalAlertEl.classList.toggle('hidden', betrayalTicks <= 0);
    if (betrayalTicks > 0) {
      this.betrayalAlertEl.textContent = `ZRÁDCE −35 % obrana (${Math.ceil(betrayalTicks / TICK_RATE)}s)`;
    }

    const commitAmount = Math.round(manpower * (this.currentPercent / 100));
    this.sliderReadoutEl.textContent = `${this.currentPercent} % (${commitAmount} MP)`;

    const hasFront = selectedFrontierCount > 0;
    this.frontPadEl.classList.toggle('hidden', !hasFront);
    if (hasFront) {
      this.frontCountEl.textContent = `Úsek: ${selectedFrontierCount} b.`;
    }
  }
}
