import { ClientRenderState, PublicPlayerInfo } from '../engine/types';

export type TacticalMode = 'ARROW' | 'FRONT_SELECT';

export interface HudCallbacks {
  readonly onTogglePause: () => void;
  readonly onRestart: () => void;
  readonly onModeChange: (mode: TacticalMode) => void;
  readonly onManpowerPercentChange: (percent: number) => void;
  readonly onFrontPushDirection: (dirX: number, dirY: number) => void;
  readonly onClearFrontSelection: () => void;
}

export class HudController {
  private readonly root: HTMLElement;
  private readonly callbacks: HudCallbacks;

  private phaseBadge!: HTMLElement;
  private statsGroup!: HTMLElement;
  private manpowerValueEl!: HTMLElement;
  private manpowerIncomeEl!: HTMLElement;
  private territoryValueEl!: HTMLElement;
  private ordersValueEl!: HTMLElement;
  private pauseBtn!: HTMLButtonElement;
  private restartBtn!: HTMLButtonElement;

  private startBanner!: HTMLElement;
  private bottomRow!: HTMLElement;
  private sliderEl!: HTMLInputElement;
  private sliderReadoutEl!: HTMLElement;
  private modeArrowBtn!: HTMLButtonElement;
  private modeFrontBtn!: HTMLButtonElement;

  private frontPadEl!: HTMLElement;
  private frontCountEl!: HTMLElement;

  private currentMode: TacticalMode = 'ARROW';
  private currentPercent = 35;

  public constructor(root: HTMLElement, callbacks: HudCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.buildDom();
  }

  private buildDom(): void {
    this.root.innerHTML = `
      <div class="hud-panel hud-top-bar">
        <div class="hud-brand">
          <span class="hud-title">At War // Evropa</span>
          <span class="hud-phase-badge" data-el="phase-badge">Fáze 1: Výběr startu</span>
        </div>

        <div class="hud-stats hidden" data-el="stats-group">
          <div class="hud-stat">
            <span class="hud-stat-label">Manpower</span>
            <span class="hud-stat-value" data-el="manpower-val">0 / 0</span>
            <span class="hud-stat-sub" data-el="manpower-inc">(+0/s)</span>
          </div>
          <div class="hud-stat">
            <span class="hud-stat-label">Území</span>
            <span class="hud-stat-value" data-el="territory-val">0 %</span>
          </div>
          <div class="hud-stat">
            <span class="hud-stat-label">Aktivní rozkazy</span>
            <span class="hud-stat-value" data-el="orders-val">0</span>
          </div>
        </div>

        <div class="hud-actions">
          <button type="button" class="hud-btn" data-action="pause" disabled>Pauza</button>
          <button type="button" class="hud-btn" data-action="restart">Restart</button>
        </div>
      </div>

      <div class="hud-panel hud-prompt-banner" data-el="start-banner">
        Klikněte levým tlačítkem na libovolnou volnou pevninu Evropy pro založení hlavního města.
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
              Útočná šipka
            </button>
            <button type="button" class="hud-btn" data-mode="FRONT_SELECT">
              Výběr úseku fronty
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
            <span class="hud-legend-key">LMB tažení</span>
            <span>Útočná šipka ze svého území</span>
          </div>
          <div class="hud-legend-row">
            <span class="hud-legend-key">Shift + LMB / Režim</span>
            <span>Označit úsek fronty + směr tlaku</span>
          </div>
          <div class="hud-legend-row">
            <span class="hud-legend-key">RMB / WASD / Kolečko</span>
            <span>Posun mapy a zoom</span>
          </div>
          <div class="hud-legend-row">
            <span class="hud-legend-key">Terén &amp; Kruhy</span>
            <span>Pláně 100 % · Hory 35 % · Zóny surovin</span>
          </div>
        </div>
      </div>
    `;

    this.phaseBadge = this.query('[data-el="phase-badge"]');
    this.statsGroup = this.query('[data-el="stats-group"]');
    this.manpowerValueEl = this.query('[data-el="manpower-val"]');
    this.manpowerIncomeEl = this.query('[data-el="manpower-inc"]');
    this.territoryValueEl = this.query('[data-el="territory-val"]');
    this.ordersValueEl = this.query('[data-el="orders-val"]');
    this.pauseBtn = this.query<HTMLButtonElement>('[data-action="pause"]');
    this.restartBtn = this.query<HTMLButtonElement>('[data-action="restart"]');
    this.startBanner = this.query('[data-el="start-banner"]');
    this.bottomRow = this.query('[data-el="tactical-bar"]');
    this.sliderEl = this.query<HTMLInputElement>('[data-el="mp-slider"]');
    this.sliderReadoutEl = this.query('[data-el="mp-readout"]');
    this.modeArrowBtn = this.query<HTMLButtonElement>('[data-mode="ARROW"]');
    this.modeFrontBtn = this.query<HTMLButtonElement>('[data-mode="FRONT_SELECT"]');
    this.frontPadEl = this.query('[data-el="front-pad"]');
    this.frontCountEl = this.query('[data-el="front-count"]');

    this.pauseBtn.addEventListener('click', () => this.callbacks.onTogglePause());
    this.restartBtn.addEventListener('click', () => this.callbacks.onRestart());

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

    this.startBanner.classList.toggle('hidden', isPlaying);
    this.statsGroup.classList.toggle('hidden', !isPlaying);
    this.bottomRow.classList.toggle('hidden', !isPlaying);

    this.pauseBtn.disabled = !isPlaying;
    this.pauseBtn.textContent = state.paused ? 'Pokračovat' : 'Pauza';
    this.pauseBtn.classList.toggle('paused', state.paused && isPlaying);

    if (!isPlaying) {
      return;
    }

    const human: PublicPlayerInfo | undefined = state.players.find(
      (p) => p.id === state.humanPlayerId,
    );

    const manpower = human?.manpower ?? 0;
    const maxManpower = human?.maxManpower ?? 0;
    const income = human?.manpowerIncomePerSec ?? 0;
    const cells = human?.territoryCells ?? 0;
    const pctLand = state.totalLandCells > 0 ? (cells / state.totalLandCells) * 100 : 0;

    const activeHumanOrders =
      state.attackOrders.filter((o) => o.playerId === state.humanPlayerId).length +
      state.frontPushOrders.filter((o) => o.playerId === state.humanPlayerId).length;

    this.manpowerValueEl.textContent = `${Math.floor(manpower)} / ${Math.round(maxManpower)}`;
    this.manpowerIncomeEl.textContent = `(+${income.toFixed(1)}/s)`;
    this.territoryValueEl.textContent = `${cells} (${pctLand.toFixed(1)} %)`;
    this.ordersValueEl.textContent = `${activeHumanOrders}`;

    const commitAmount = Math.round(manpower * (this.currentPercent / 100));
    this.sliderReadoutEl.textContent = `${this.currentPercent} % (${commitAmount} MP)`;

    const hasFront = selectedFrontierCount > 0;
    this.frontPadEl.classList.toggle('hidden', !hasFront);
    if (hasFront) {
      this.frontCountEl.textContent = `Úsek: ${selectedFrontierCount} b.`;
    }
  }
}
