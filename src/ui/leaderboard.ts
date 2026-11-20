import {
  ClientRenderState,
  DiplomaticRelation,
  PublicPlayerInfo,
  TICK_RATE,
} from '../engine/types';

export interface DiplomacyCallbacks {
  readonly onDeclareWar: (targetId: number) => void;
  readonly onMakePeace: (targetId: number) => void;
  readonly onToggleAlliance: (targetId: number) => void;
}

function relationLabel(rel: DiplomaticRelation): string {
  switch (rel) {
    case 'WAR':
      return 'Válka';
    case 'ALLIED':
      return 'Aliance';
    case 'NEUTRAL':
      return 'Neutrální';
  }
}

export class LeaderboardController {
  private readonly panelEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly profileEl: HTMLElement;
  private readonly callbacks: DiplomacyCallbacks;

  private collapsed = false;
  private openProfileTargetId: number | null = null;
  private profileX = 0;
  private profileY = 0;
  private lastRenderKey = '';

  public constructor(root: HTMLElement, callbacks: DiplomacyCallbacks) {
    this.callbacks = callbacks;

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'hud-panel hud-leaderboard hidden';
    this.panelEl.innerHTML = `
      <div class="hud-lb-header">
        <span class="hud-lb-title">Státy Evropy</span>
        <button type="button" class="hud-btn hud-lb-toggle" data-action="toggle-lb">Sbalit</button>
      </div>
      <div class="hud-lb-list" data-el="lb-list"></div>
    `;

    this.profileEl = document.createElement('div');
    this.profileEl.className = 'hud-panel hud-diplomacy-popover hidden';

    root.appendChild(this.panelEl);
    root.appendChild(this.profileEl);

    const list = this.panelEl.querySelector<HTMLElement>('[data-el="lb-list"]');
    const toggleBtn = this.panelEl.querySelector<HTMLButtonElement>('[data-action="toggle-lb"]');
    if (!list || !toggleBtn) {
      throw new Error('Failed to initialize leaderboard DOM');
    }
    this.listEl = list;
    this.collapseBtn = toggleBtn;

    this.collapseBtn.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.listEl.classList.toggle('hidden', this.collapsed);
      this.collapseBtn.textContent = this.collapsed ? 'Rozbalit' : 'Sbalit';
    });

    this.listEl.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const row = target.closest<HTMLElement>('[data-player-id]');
      if (!row) return;
      const id = Number(row.dataset.playerId);
      if (!Number.isFinite(id)) return;
      const rect = row.getBoundingClientRect();
      this.openProfile(id, rect.left - 252, rect.top);
    });

    this.profileEl.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest<HTMLButtonElement>('[data-dip-action]');
      if (!btn) return;
      const action = btn.dataset.dipAction;
      if (action === 'close') {
        this.closeProfile();
        return;
      }
      if (this.openProfileTargetId === null) return;
      const tid = this.openProfileTargetId;
      if (action === 'war') {
        this.callbacks.onDeclareWar(tid);
      } else if (action === 'peace') {
        this.callbacks.onMakePeace(tid);
      } else if (action === 'alliance') {
        this.callbacks.onToggleAlliance(tid);
      }
      this.lastRenderKey = '';
    });
  }

  public getPanelElement(): HTMLElement {
    return this.panelEl;
  }

  public openProfile(targetId: number, screenX: number, screenY: number): void {
    this.openProfileTargetId = targetId;
    this.profileX = Math.max(12, Math.min(window.innerWidth - 256, screenX));
    this.profileY = Math.max(54, Math.min(window.innerHeight - 190, screenY));
    this.lastRenderKey = '';
  }

  public closeProfile(): void {
    this.openProfileTargetId = null;
    this.profileEl.classList.add('hidden');
  }

  public isProfileOpen(): boolean {
    return this.openProfileTargetId !== null;
  }

  public update(state: ClientRenderState): void {
    const isPlaying = state.phase === 'PLAYING';
    this.panelEl.classList.toggle('hidden', !isPlaying);

    if (!isPlaying) {
      this.closeProfile();
      return;
    }

    const renderKey = `${state.stateVersion}|${Math.floor(state.tick / 5)}|${this.openProfileTargetId ?? 'none'}|${this.collapsed}`;
    if (renderKey === this.lastRenderKey) {
      return;
    }
    this.lastRenderKey = renderKey;

    const alivePlayers = state.players
      .filter((p) => p.alive)
      .slice()
      .sort((a, b) => b.territoryCells - a.territoryCells);

    if (!this.collapsed) {
      const rowsHtml = alivePlayers
        .map((p, index) => this.renderRowHtml(p, index + 1, state))
        .join('');
      this.listEl.innerHTML = rowsHtml;
    }

    if (this.openProfileTargetId !== null) {
      const target = state.players.find((p) => p.id === this.openProfileTargetId);
      if (!target || !target.alive || target.id === state.humanPlayerId) {
        this.closeProfile();
      } else {
        this.renderProfilePopover(target, state);
      }
    }
  }

  private renderRowHtml(
    player: PublicPlayerInfo,
    rank: number,
    state: ClientRenderState,
  ): string {
    const isHuman = player.id === state.humanPlayerId;
    const pct =
      state.totalLandCells > 0
        ? ((player.territoryCells / state.totalLandCells) * 100).toFixed(1)
        : '0.0';

    const relClass = isHuman
      ? 'rel-self'
      : player.relationToHuman === 'WAR'
        ? 'rel-war'
        : player.relationToHuman === 'ALLIED'
          ? 'rel-allied'
          : 'rel-neutral';

    const badgeText = isHuman
      ? 'Vy'
      : relationLabel(player.relationToHuman);

    const betrayalTag =
      player.betrayalDebuffTicks > 0
        ? `<span class="hud-betrayal-tag" title="Bojový postih za zradu aliance">ZRÁDCE ${Math.ceil(player.betrayalDebuffTicks / TICK_RATE)}s</span>`
        : '';

    const interactiveAttr = isHuman ? '' : `data-player-id="${player.id}"`;
    const clickableClass = isHuman ? 'hud-lb-row-self' : 'hud-lb-row-clickable';

    return `
      <div class="hud-lb-row ${relClass} ${clickableClass}" ${interactiveAttr}>
        <span class="hud-lb-rank">${rank}.</span>
        <span class="hud-lb-swatch" style="background:${player.colorHex}"></span>
        <span class="hud-lb-name">${player.name}${betrayalTag}</span>
        <span class="hud-lb-pct">${pct} %</span>
        <span class="hud-lb-rel ${relClass}">${badgeText}</span>
      </div>
    `;
  }

  private renderProfilePopover(
    target: PublicPlayerInfo,
    state: ClientRenderState,
  ): void {
    const pct =
      state.totalLandCells > 0
        ? ((target.territoryCells / state.totalLandCells) * 100).toFixed(1)
        : '0.0';

    const rel = target.relationToHuman;
    const relClass =
      rel === 'WAR' ? 'rel-war' : rel === 'ALLIED' ? 'rel-allied' : 'rel-neutral';

    let actionsHtml = '';
    if (rel === 'NEUTRAL') {
      actionsHtml = `
        <button type="button" class="hud-btn hud-btn-danger" data-dip-action="war">
          Vyhlásit válku
        </button>
        <button type="button" class="hud-btn hud-btn-ally" data-dip-action="alliance">
          Uzavřít alianci
        </button>
      `;
    } else if (rel === 'ALLIED') {
      actionsHtml = `
        <button type="button" class="hud-btn hud-btn-danger" data-dip-action="war">
          Zradit a vyhlásit válku (−35 % obrana)
        </button>
        <button type="button" class="hud-btn" data-dip-action="alliance">
          Zrušit alianci
        </button>
      `;
    } else {
      actionsHtml = `
        <button type="button" class="hud-btn hud-btn-ally" data-dip-action="peace">
          Uzavřít mír
        </button>
      `;
    }

    const betrayalInfo =
      target.betrayalDebuffTicks > 0
        ? `<div class="hud-dip-warning">Zrádce aliance: −35 % obrana (${Math.ceil(target.betrayalDebuffTicks / TICK_RATE)}s)</div>`
        : '';

    this.profileEl.style.left = `${this.profileX}px`;
    this.profileEl.style.top = `${this.profileY}px`;
    this.profileEl.innerHTML = `
      <div class="hud-dip-header">
        <div class="hud-dip-title-wrap">
          <span class="hud-lb-swatch" style="background:${target.colorHex}"></span>
          <span class="hud-dip-name">${target.name}</span>
        </div>
        <button type="button" class="hud-btn hud-dip-close" data-dip-action="close">✕</button>
      </div>
      <div class="hud-dip-meta">
        <span>Území: <strong>${pct} %</strong></span>
        <span class="hud-lb-rel ${relClass}">${relationLabel(rel)}</span>
      </div>
      ${betrayalInfo}
      <div class="hud-dip-actions">
        ${actionsHtml}
      </div>
    `;
    this.profileEl.classList.remove('hidden');
  }
}
