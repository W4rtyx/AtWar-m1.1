import {
  MISSILE_STRIKE_COST,
  NUCLEAR_STRIKE_COST,
  TECH_BRANCH_META,
  TECH_TREE_SPECS,
  TechCost,
  getTechLevel,
} from '../engine/techTree';
import {
  ALL_TECH_BRANCHES,
  ClientRenderState,
  StrategicStrikeKind,
  TICK_RATE,
  TechBranch,
} from '../engine/types';

export interface TechTreeModalCallbacks {
  readonly onResearchTech: (branch: TechBranch, level: number) => void;
  readonly onLaunchStrikeMode: (strikeKind: StrategicStrikeKind) => void;
}

interface NodeRef {
  readonly branch: TechBranch;
  readonly level: 1 | 2 | 3 | 4 | 5;
  readonly cardEl: HTMLElement;
  readonly statusEl: HTMLElement;
  readonly actionBtn: HTMLButtonElement;
}

function formatTechCost(cost: TechCost): string {
  const parts: string[] = [`${cost.knowledge} Znal.`];
  if (cost.money > 0) parts.push(`${cost.money}$`);
  if (cost.industry > 0) parts.push(`${cost.industry} P`);
  return parts.join(' · ');
}

/**
 * Dark strategic Tech Tree modal displaying all 5 branches × Levels 1–5,
 * research prerequisites, current Intel Tier, and L5 strategic strike launchers.
 */
export class TechTreeModalController {
  private readonly overlayEl: HTMLElement;
  private readonly knowledgeValEl: HTMLElement;
  private readonly moneyValEl: HTMLElement;
  private readonly industryValEl: HTMLElement;
  private readonly intelValEl: HTMLElement;
  private readonly missileBtn: HTMLButtonElement;
  private readonly nuclearBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly callbacks: TechTreeModalCallbacks;
  private readonly nodeRefs: NodeRef[] = [];
  private visible = false;

  public constructor(root: HTMLElement, callbacks: TechTreeModalCallbacks) {
    this.callbacks = callbacks;

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'hud-tech-overlay hidden';
    this.overlayEl.innerHTML = `
      <div class="hud-panel hud-tech-modal" role="dialog" aria-label="Technologický strom">
        <div class="hud-tech-header">
          <div class="hud-tech-title-group">
            <h2 class="hud-tech-title">Technologický strom &amp; Doktríny</h2>
            <span class="hud-tech-intel-pill" data-tech="intel">Zpravodajství: Tier 1</span>
          </div>
          <div class="hud-tech-funds">
            <span>Znalosti: <strong data-tech="know">0</strong></span>
            <span>Peníze: <strong data-tech="money">0</strong></span>
            <span>Průmysl: <strong data-tech="ind">0</strong></span>
          </div>
          <button type="button" class="hud-btn hud-dip-close" data-tech="close" title="Zavřít (T / Esc)">✕</button>
        </div>

        <div class="hud-tech-grid" data-tech="grid"></div>

        <div class="hud-tech-footer">
          <span class="hud-tech-footer-hint">Úrovně L1 → L5 se odemykají postupně v každé větvi. Klávesa T zavře/otevře okno.</span>
          <div class="hud-tech-strike-bar">
            <button type="button" class="hud-btn hud-btn-artillery" data-tech="missile">
              Raketový úder (${MISSILE_STRIKE_COST.industry}P · ${MISSILE_STRIKE_COST.money}$)
            </button>
            <button type="button" class="hud-btn hud-btn-danger" data-tech="nuclear">
              Jaderný úder (${NUCLEAR_STRIKE_COST.industry}P · ${NUCLEAR_STRIKE_COST.money}$)
            </button>
          </div>
        </div>
      </div>
    `;

    root.appendChild(this.overlayEl);

    this.knowledgeValEl = this.query('[data-tech="know"]');
    this.moneyValEl = this.query('[data-tech="money"]');
    this.industryValEl = this.query('[data-tech="ind"]');
    this.intelValEl = this.query('[data-tech="intel"]');
    this.missileBtn = this.query<HTMLButtonElement>('[data-tech="missile"]');
    this.nuclearBtn = this.query<HTMLButtonElement>('[data-tech="nuclear"]');
    this.closeBtn = this.query<HTMLButtonElement>('[data-tech="close"]');

    const gridEl = this.query('[data-tech="grid"]');
    for (const branch of ALL_TECH_BRANCHES) {
      const meta = TECH_BRANCH_META[branch];
      const col = document.createElement('div');
      col.className = 'hud-tech-col';

      const colHead = document.createElement('div');
      colHead.className = 'hud-tech-col-head';
      colHead.style.borderTopColor = meta.accentColor;
      colHead.textContent = meta.titleCs;
      col.appendChild(colHead);

      for (const spec of TECH_TREE_SPECS[branch]) {
        const card = document.createElement('div');
        card.className = 'hud-tech-node';

        const top = document.createElement('div');
        top.className = 'hud-tech-node-top';
        const lvlBadge = document.createElement('span');
        lvlBadge.className = 'hud-tech-lvl';
        lvlBadge.textContent = `L${spec.level}`;
        const nameEl = document.createElement('strong');
        nameEl.className = 'hud-tech-node-name';
        nameEl.textContent = spec.nameCs;
        const statusEl = document.createElement('span');
        statusEl.className = 'hud-tech-status';
        statusEl.textContent = 'Zamčeno';
        top.appendChild(lvlBadge);
        top.appendChild(nameEl);
        top.appendChild(statusEl);

        const descEl = document.createElement('div');
        descEl.className = 'hud-tech-node-desc';
        descEl.textContent = spec.summaryCs;

        const bottom = document.createElement('div');
        bottom.className = 'hud-tech-node-foot';
        const costEl = document.createElement('span');
        costEl.className = 'hud-tech-cost';
        costEl.textContent = formatTechCost(spec.cost);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hud-btn hud-tech-research-btn';
        btn.textContent = 'Vyzkoumat';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.callbacks.onResearchTech(spec.branch, spec.level);
        });

        bottom.appendChild(costEl);
        bottom.appendChild(btn);

        card.appendChild(top);
        card.appendChild(descEl);
        card.appendChild(bottom);
        col.appendChild(card);

        this.nodeRefs.push({
          branch: spec.branch,
          level: spec.level,
          cardEl: card,
          statusEl,
          actionBtn: btn,
        });
      }

      gridEl.appendChild(col);
    }

    this.overlayEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (e.target === this.overlayEl) {
        this.close();
      }
    });
    this.closeBtn.addEventListener('click', () => this.close());
    this.missileBtn.addEventListener('click', () => {
      this.close();
      this.callbacks.onLaunchStrikeMode('MISSILE');
    });
    this.nuclearBtn.addEventListener('click', () => {
      this.close();
      this.callbacks.onLaunchStrikeMode('NUCLEAR');
    });
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.overlayEl.querySelector<T>(selector);
    if (!el) throw new Error(`Missing tech tree element: ${selector}`);
    return el;
  }

  public isOpen(): boolean {
    return this.visible;
  }

  public toggle(): void {
    this.visible = !this.visible;
    this.overlayEl.classList.toggle('hidden', !this.visible);
  }

  public open(): void {
    this.visible = true;
    this.overlayEl.classList.remove('hidden');
  }

  public close(): void {
    this.visible = false;
    this.overlayEl.classList.add('hidden');
  }

  public countAvailableNodes(state: ClientRenderState): number {
    if (state.phase !== 'PLAYING') return 0;
    const human = state.players.find((p) => p.id === state.humanPlayerId);
    if (!human || !human.alive || human.isEliminated) return 0;
    const know = human.knowledge ?? 0;
    const money = human.money ?? 0;
    const ind = human.industry ?? 0;

    let count = 0;
    for (const branch of ALL_TECH_BRANCHES) {
      const curr = getTechLevel(human, branch);
      if (curr >= 5) continue;
      const next = TECH_TREE_SPECS[branch][curr];
      if (know >= next.cost.knowledge && money >= next.cost.money && ind >= next.cost.industry) {
        count++;
      }
    }
    return count;
  }

  public update(state: ClientRenderState): void {
    if (state.phase !== 'PLAYING') {
      if (this.visible) this.close();
      return;
    }
    if (!this.visible) return;

    const human = state.players.find((p) => p.id === state.humanPlayerId);
    const know = human?.knowledge ?? 0;
    const money = human?.money ?? 0;
    const ind = human?.industry ?? 0;
    const tier = human?.intelTier ?? 1;

    this.knowledgeValEl.textContent = `${Math.floor(know)}`;
    this.moneyValEl.textContent = `${Math.floor(money)}$`;
    this.industryValEl.textContent = `${Math.floor(ind)} P`;
    this.intelValEl.textContent = `Zpravodajství: Tier ${tier}/4`;

    for (const ref of this.nodeRefs) {
      const currLevel = getTechLevel(human, ref.branch);
      const spec = TECH_TREE_SPECS[ref.branch][ref.level - 1];
      const unlocked = currLevel >= ref.level;
      const isNext = currLevel + 1 === ref.level;
      const affordable =
        know >= spec.cost.knowledge &&
        money >= spec.cost.money &&
        ind >= spec.cost.industry;

      ref.cardEl.classList.toggle('is-unlocked', unlocked);
      ref.cardEl.classList.toggle('is-available', isNext && affordable);
      ref.cardEl.classList.toggle('is-next', isNext);
      ref.cardEl.classList.toggle('is-locked', !unlocked && !isNext);

      if (unlocked) {
        ref.statusEl.textContent = 'Odemčeno';
        ref.actionBtn.classList.add('hidden');
      } else if (isNext) {
        ref.statusEl.textContent = affordable ? 'Dostupné' : 'Nedostatek';
        ref.actionBtn.classList.remove('hidden');
        ref.actionBtn.disabled = !affordable;
        ref.actionBtn.textContent = affordable ? 'Vyzkoumat' : 'Chybí zdroje';
      } else {
        ref.statusEl.textContent = `Vyžaduje L${ref.level - 1}`;
        ref.actionBtn.classList.add('hidden');
      }
    }

    const hasMissileTech = getTechLevel(human, 'ARTILLERY_SUPPORT') >= 5;
    const hasNuclearTech = getTechLevel(human, 'AIR_STRATEGIC') >= 5;

    let readySilo = false;
    let readyNuclearLauncher = false;
    let minMissileCd = Infinity;
    let minNuclearCd = Infinity;
    for (const b of state.buildings) {
      if (b.ownerId !== state.humanPlayerId || b.stackCount <= 0) continue;
      if (b.type === 'MISSILE_SILO') {
        if (b.paradropCooldownTicks <= 0) {
          readySilo = true;
          readyNuclearLauncher = true;
        } else {
          minMissileCd = Math.min(minMissileCd, b.paradropCooldownTicks);
          minNuclearCd = Math.min(minNuclearCd, b.paradropCooldownTicks);
        }
      } else if (b.type === 'AIRFIELD') {
        if (b.paradropCooldownTicks <= 0) {
          readyNuclearLauncher = true;
        } else {
          minNuclearCd = Math.min(minNuclearCd, b.paradropCooldownTicks);
        }
      }
    }

    const canPayMissile =
      ind >= MISSILE_STRIKE_COST.industry && money >= MISSILE_STRIKE_COST.money;
    this.missileBtn.disabled = !hasMissileTech || !readySilo || !canPayMissile;
    this.missileBtn.textContent = !hasMissileTech
      ? 'Raketový úder (Děl. L5)'
      : !readySilo
        ? Number.isFinite(minMissileCd)
          ? `Raketové silo (${(minMissileCd / TICK_RATE).toFixed(0)}s)`
          : 'Raketový úder (bez SILA)'
        : `Raketový úder (${MISSILE_STRIKE_COST.industry}P · ${MISSILE_STRIKE_COST.money}$)`;

    const canPayNuclear =
      ind >= NUCLEAR_STRIKE_COST.industry && money >= NUCLEAR_STRIKE_COST.money;
    this.nuclearBtn.disabled = !hasNuclearTech || !readyNuclearLauncher || !canPayNuclear;
    this.nuclearBtn.textContent = !hasNuclearTech
      ? 'Jaderný úder (Letectvo L5)'
      : !readyNuclearLauncher
        ? Number.isFinite(minNuclearCd)
          ? `Jaderný nosič (${(minNuclearCd / TICK_RATE).toFixed(0)}s)`
          : 'Jaderný úder (bez sila/letiště)'
        : `Jaderný úder (${NUCLEAR_STRIKE_COST.industry}P · ${NUCLEAR_STRIKE_COST.money}$)`;
  }
}
