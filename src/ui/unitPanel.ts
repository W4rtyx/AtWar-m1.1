import {
  ALL_UNIT_TYPES,
  ClientRenderState,
  PublicUnitInfo,
  TICK_RATE,
  UnitStance,
  UnitType,
} from '../engine/types';
import { UNIT_SPECS } from '../engine/units';

export interface UnitPanelCallbacks {
  readonly onQuickProduceUnit: (unitType: UnitType) => void;
  readonly onSetUnitsStance: (unitIds: ReadonlyArray<number>, stance: UnitStance) => void;
  readonly onMergeUnits: (unitIds: ReadonlyArray<number>) => void;
  readonly onStartParadrop: (unitId: number) => void;
  readonly onClearUnitSelection: () => void;
}

interface QuickRecruitRef {
  readonly type: UnitType;
  readonly button: HTMLButtonElement;
  readonly countEl: HTMLElement;
}

function formatUnitTooltip(unitType: UnitType): string {
  const s = UNIT_SPECS[unitType];
  const parts: string[] = [];
  if (s.cost.money > 0) parts.push(`${s.cost.money}$`);
  if (s.cost.buildingMaterial > 0) parts.push(`${s.cost.buildingMaterial}M`);
  if (s.cost.industry > 0) parts.push(`${s.cost.industry}P`);
  parts.push(`${s.cost.manpower} MP`);
  return `${s.nameCs} (${parts.join(' · ')}, ${(s.productionTicks / TICK_RATE).toFixed(1)}s) — ${s.descriptionCs}`;
}

/**
 * Compact bottom tactical unit bar:
 * - Always displays owned unit totals and 1-click recruitment buttons when playing.
 * - When units are selected (via click or lasso), shows stack strength, HP, morale,
 *   encirclement status, LOCK / RANGE toggle, Merge button, and Paradrop button.
 */
export class UnitPanelController {
  private readonly panelEl: HTMLElement;
  private readonly callbacks: UnitPanelCallbacks;
  private readonly recruitRefs: QuickRecruitRef[] = [];

  private readonly selectionBoxEl: HTMLElement;
  private readonly selTitleEl: HTMLElement;
  private readonly selMetaEl: HTMLElement;
  private readonly selEncircledEl: HTMLElement;
  private readonly selDropEl: HTMLElement;
  private readonly lockBtn: HTMLButtonElement;
  private readonly rangeBtn: HTMLButtonElement;
  private readonly mergeBtn: HTMLButtonElement;
  private readonly paradropBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;

  private activeSelectedIds: number[] = [];
  private activeParadropUnitId: number | null = null;

  public constructor(callbacks: UnitPanelCallbacks) {
    this.callbacks = callbacks;

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'hud-panel hud-unit-panel hidden';
    this.panelEl.innerHTML = `
      <div class="hud-unit-recruit-row">
        <span class="hud-build-title">Jednotky</span>
        <div class="hud-unit-recruit-btns" data-up="recruit-btns"></div>
      </div>
      <div class="hud-unit-sel-box hidden" data-up="sel-box">
        <div class="hud-unit-sel-info">
          <strong class="hud-unit-sel-title" data-up="sel-title">Vybráno: 0</strong>
          <span class="hud-unit-sel-meta" data-up="sel-meta">HP 100 % · Morálka 100 %</span>
          <span class="hud-unit-badge-encircled hidden" data-up="sel-encircled">OBKLÍČENO</span>
          <span class="hud-unit-badge-drop hidden" data-up="sel-drop">VÝSADEK</span>
        </div>
        <div class="hud-unit-sel-actions">
          <button type="button" class="hud-btn hud-unit-act-btn" data-up="stance-lock" title="Držet pozici (L)">
            LOCK
          </button>
          <button type="button" class="hud-btn hud-unit-act-btn" data-up="stance-range" title="Volný režim v dosahu — připojuje se k šipkám (L)">
            RANGE
          </button>
          <button type="button" class="hud-btn hud-unit-act-btn" data-up="merge" title="Sloučit vybrané svazky stejného typu (G)">
            Sloučit (G)
          </button>
          <button type="button" class="hud-btn hud-unit-act-btn hud-btn-drop hidden" data-up="paradrop" title="Vysadit parašutisty do týlu (P)">
            Výsadek (P)
          </button>
          <button type="button" class="hud-btn hud-unit-act-btn" data-up="clear" title="Zrušit výběr (Esc)">
            ✕
          </button>
        </div>
      </div>
    `;

    const recruitWrap = this.query('[data-up="recruit-btns"]');
    for (const uType of ALL_UNIT_TYPES) {
      const spec = UNIT_SPECS[uType];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-btn hud-unit-recruit-btn';
      btn.title = formatUnitTooltip(uType);

      const lbl = document.createElement('span');
      lbl.className = 'hud-unit-rec-lbl';
      lbl.textContent = `+${spec.shortCode}`;

      const cnt = document.createElement('span');
      cnt.className = 'hud-unit-rec-cnt';
      cnt.textContent = '(0)';

      btn.appendChild(lbl);
      btn.appendChild(cnt);
      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || btn.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onQuickProduceUnit(uType);
      });
      recruitWrap.appendChild(btn);
      this.recruitRefs.push({ type: uType, button: btn, countEl: cnt });
    }

    this.selectionBoxEl = this.query('[data-up="sel-box"]');
    this.selTitleEl = this.query('[data-up="sel-title"]');
    this.selMetaEl = this.query('[data-up="sel-meta"]');
    this.selEncircledEl = this.query('[data-up="sel-encircled"]');
    this.selDropEl = this.query('[data-up="sel-drop"]');
    this.lockBtn = this.query<HTMLButtonElement>('[data-up="stance-lock"]');
    this.rangeBtn = this.query<HTMLButtonElement>('[data-up="stance-range"]');
    this.mergeBtn = this.query<HTMLButtonElement>('[data-up="merge"]');
    this.paradropBtn = this.query<HTMLButtonElement>('[data-up="paradrop"]');
    this.clearBtn = this.query<HTMLButtonElement>('[data-up="clear"]');

    this.lockBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.activeSelectedIds.length > 0) {
        this.callbacks.onSetUnitsStance(this.activeSelectedIds, 'LOCK');
      }
    });
    this.rangeBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.activeSelectedIds.length > 0) {
        this.callbacks.onSetUnitsStance(this.activeSelectedIds, 'RANGE');
      }
    });
    this.mergeBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.mergeBtn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.activeSelectedIds.length > 1) {
        this.callbacks.onMergeUnits(this.activeSelectedIds);
      }
    });
    this.paradropBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.paradropBtn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.activeParadropUnitId !== null) {
        this.callbacks.onStartParadrop(this.activeParadropUnitId);
      }
    });
    this.clearBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.callbacks.onClearUnitSelection();
    });

    this.panelEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.panelEl.querySelector<T>(selector);
    if (!el) {
      throw new Error(`Missing unit panel element: ${selector}`);
    }
    return el;
  }

  public getPanelElement(): HTMLElement {
    return this.panelEl;
  }

  public update(
    state: ClientRenderState,
    selectedUnitIds: ReadonlySet<number>,
    paradropUnitId: number | null,
  ): void {
    const isPlaying = state.phase === 'PLAYING';
    this.panelEl.classList.toggle('hidden', !isPlaying);
    if (!isPlaying) return;

    const human = state.players.find((p) => p.id === state.humanPlayerId);
    const money = human?.money ?? 0;
    const mat = human?.buildingMaterial ?? 0;
    const ind = human?.industry ?? 0;
    const activeMp = human?.activeManpower ?? 0;

    const completedProducers = new Set<string>();
    const queuedByType = new Map<UnitType, number>();
    let readyAirfields = 0;
    let minAirfieldCooldown = Infinity;

    for (const b of state.buildings) {
      if (b.ownerId !== state.humanPlayerId || b.stackCount <= 0) continue;
      completedProducers.add(b.type);
      if (b.type === 'AIRFIELD') {
        if (b.paradropCooldownTicks <= 0) {
          readyAirfields++;
        } else if (b.paradropCooldownTicks < minAirfieldCooldown) {
          minAirfieldCooldown = b.paradropCooldownTicks;
        }
      }
      for (const job of b.unitQueue) {
        queuedByType.set(job.unitType, (queuedByType.get(job.unitType) ?? 0) + 1);
      }
    }

    const ownedCounts = new Map<UnitType, number>();
    const selectedUnits: PublicUnitInfo[] = [];
    for (const u of state.units) {
      if (u.ownerId !== state.humanPlayerId) continue;
      ownedCounts.set(u.type, (ownedCounts.get(u.type) ?? 0) + u.count);
      if (selectedUnitIds.has(u.id)) {
        selectedUnits.push(u);
      }
    }

    for (const ref of this.recruitRefs) {
      const spec = UNIT_SPECS[ref.type];
      const count = ownedCounts.get(ref.type) ?? 0;
      const queued = queuedByType.get(ref.type) ?? 0;
      ref.countEl.textContent = queued > 0 ? `(${count}+${queued})` : `(${count})`;

      const hasProducer = completedProducers.has(spec.producerBuilding);
      const affordable =
        money >= spec.cost.money &&
        mat >= spec.cost.buildingMaterial &&
        ind >= spec.cost.industry &&
        activeMp >= spec.cost.manpower;
      ref.button.disabled = !hasProducer || !affordable;
      ref.button.classList.toggle('no-producer', !hasProducer);
      ref.button.title = hasProducer
        ? formatUnitTooltip(ref.type)
        : `${formatUnitTooltip(ref.type)} — Vyžaduje dokončenou budovu (${spec.producerBuilding})`;
    }

    this.activeSelectedIds = selectedUnits.map((u) => u.id);
    this.selectionBoxEl.classList.toggle('hidden', selectedUnits.length === 0);
    if (selectedUnits.length === 0) {
      this.activeParadropUnitId = null;
      return;
    }

    let totalStack = 0;
    let totalHp = 0;
    let totalMaxHp = 0;
    let weightedMorale = 0;
    let anyEncircled = false;
    let anyVulnerable = false;
    let lockCount = 0;
    let rangeCount = 0;
    const typeCounts = new Map<UnitType, number>();
    let paradropCandidate: PublicUnitInfo | null = null;

    for (const u of selectedUnits) {
      totalStack += u.count;
      totalHp += u.hp;
      totalMaxHp += u.maxHp;
      weightedMorale += u.morale * u.count;
      if (u.isEncircled) anyEncircled = true;
      if (u.dropVulnerabilityTicks > 0) anyVulnerable = true;
      if (u.stance === 'LOCK') lockCount++;
      else rangeCount++;
      typeCounts.set(u.type, (typeCounts.get(u.type) ?? 0) + 1);
      if (u.type === 'PARATROOPERS' && u.canParadrop && !paradropCandidate) {
        paradropCandidate = u;
      }
    }

    let canMergeSameType = false;
    for (const groupSize of typeCounts.values()) {
      if (groupSize >= 2) {
        canMergeSameType = true;
        break;
      }
    }

    const hpPct = Math.round((totalHp / Math.max(1, totalMaxHp)) * 100);
    const avgMorale = Math.round(weightedMorale / Math.max(1, totalStack));

    if (selectedUnits.length === 1) {
      const u = selectedUnits[0];
      const spec = UNIT_SPECS[u.type];
      const attachedTxt = u.attachedOrderId !== null ? ' · Připojeno k šipce' : '';
      this.selTitleEl.textContent = `${spec.nameCs} ×${u.count}${attachedTxt}`;
    } else {
      this.selTitleEl.textContent = `${selectedUnits.length} svazků (celkem ×${totalStack})`;
    }

    this.selMetaEl.textContent = `HP ${hpPct} % · Morálka ${avgMorale} %`;
    this.selEncircledEl.classList.toggle('hidden', !anyEncircled);
    this.selDropEl.classList.toggle('hidden', !anyVulnerable);

    this.lockBtn.classList.toggle('active', lockCount > 0 && rangeCount === 0);
    this.rangeBtn.classList.toggle('active', rangeCount > 0 && lockCount === 0);
    this.mergeBtn.disabled = !canMergeSameType;

    this.activeParadropUnitId = paradropCandidate ? paradropCandidate.id : null;
    this.paradropBtn.classList.toggle('hidden', paradropCandidate === null);
    if (paradropCandidate !== null) {
      const hasReadyAirfield = readyAirfields > 0;
      this.paradropBtn.disabled = !hasReadyAirfield;
      this.paradropBtn.classList.toggle('active', paradropUnitId === paradropCandidate.id);
      this.paradropBtn.textContent = hasReadyAirfield
        ? paradropUnitId === paradropCandidate.id
          ? 'Vyberte cíl výsadku...'
          : 'Výsadek (P)'
        : Number.isFinite(minAirfieldCooldown)
          ? `Výsadek (${(minAirfieldCooldown / TICK_RATE).toFixed(1)}s)`
          : 'Výsadek (bez letiště)';
    }
  }
}
