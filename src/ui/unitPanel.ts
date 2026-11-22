import { getFireMissionSalvoIndustryCost, supportsFireMission } from '../engine/navalAir';
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
  readonly onStartArtilleryFire: () => void;
  readonly onCancelArtilleryFire: (unitIds: ReadonlyArray<number>) => void;
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
  private readonly selOrderBadgeEl: HTMLElement;
  private readonly selEncircledEl: HTMLElement;
  private readonly selDropEl: HTMLElement;
  private readonly hpValEl: HTMLElement;
  private readonly hpBarEl: HTMLElement;
  private readonly hpHintEl: HTMLElement;
  private readonly moraleValEl: HTMLElement;
  private readonly moraleBarEl: HTMLElement;
  private readonly moraleHintEl: HTMLElement;
  private readonly orderHintEl: HTMLElement;
  private readonly lockBtn: HTMLButtonElement;
  private readonly rangeBtn: HTMLButtonElement;
  private readonly mergeBtn: HTMLButtonElement;
  private readonly paradropBtn: HTMLButtonElement;
  private readonly fireMissionBtn: HTMLButtonElement;
  private readonly cancelFireBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;

  private activeSelectedIds: number[] = [];
  private activeParadropUnitId: number | null = null;
  private activeArtilleryIds: number[] = [];

  public constructor(callbacks: UnitPanelCallbacks) {
    this.callbacks = callbacks;

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'hud-panel hud-unit-panel hidden';
    this.panelEl.innerHTML = `
      <div class="hud-unit-sel-box hidden" data-up="sel-box">
        <div class="hud-unit-sel-header">
          <strong class="hud-unit-sel-title" data-up="sel-title">Vybráno: 0</strong>
          <div class="hud-unit-badges">
            <span class="hud-unit-badge-order hidden" data-up="sel-order">ŠIPKA</span>
            <span class="hud-unit-badge-encircled hidden" data-up="sel-encircled" title="Jednotka je odříznutá na nepřátelském území bez zásobování — každou sekundu ztrácí morálku i HP!">OBKLÍČENO</span>
            <span class="hud-unit-badge-drop hidden" data-up="sel-drop" title="Výsadkáři po dopadu mají dočasně zvýšenou zranitelnost.">VÝSADEK</span>
          </div>
          <button type="button" class="hud-btn hud-unit-act-btn" data-up="clear" title="Zrušit výběr jednotek (Esc)">
            ✕
          </button>
        </div>

        <div class="hud-unit-metrics">
          <div
            class="hud-unit-metric"
            title="Síla / HP vyjadřuje zbývající odolnost svazku a počet bojeschopných kusů. Při ztrátě HP ubývají kusy ve svazku."
          >
            <div class="hud-unit-metric-top">
              <span class="hud-unit-metric-lbl">Síla / HP</span>
              <strong class="hud-unit-metric-val" data-up="hp-val">100 %</strong>
            </div>
            <div class="hud-unit-meter"><div class="hud-unit-meter-fill is-hp" data-up="hp-bar"></div></div>
            <div class="hud-unit-metric-hint" data-up="hp-hint">Odolnost a počet bojeschopných kusů svazku</div>
          </div>

          <div
            class="hud-unit-metric"
            title="Morálka určuje bojeschopnost jednotky (útočný výkon i rychlost přesunu). V obklíčení bez zásobování klesá, na vlastním zásobovaném území se obnovuje."
          >
            <div class="hud-unit-metric-top">
              <span class="hud-unit-metric-lbl">Morálka</span>
              <strong class="hud-unit-metric-val" data-up="morale-val">100 %</strong>
            </div>
            <div class="hud-unit-meter"><div class="hud-unit-meter-fill is-morale" data-up="morale-bar"></div></div>
            <div class="hud-unit-metric-hint" data-up="morale-hint">Bojeschopnost · v obklíčení klesá, doma roste</div>
          </div>
        </div>

        <div class="hud-unit-sel-actions">
          <button type="button" class="hud-btn hud-unit-act-btn" data-up="stance-lock" title="Držet pozici (L) — jednotka stojí pevně na místě a nikdy se sama neposouvá.">
            LOCK (Držet)
          </button>
          <button type="button" class="hud-btn hud-unit-act-btn" data-up="stance-range" title="Volný režim (L) — připojí se pouze k vlastní šipce nebo k nepříteli uvnitř svého dosahu.">
            RANGE (Dosah)
          </button>
          <button type="button" class="hud-btn hud-unit-act-btn" data-up="merge" title="Sloučit vybrané svazky stejného typu do jednoho (G)">
            Sloučit (G)
          </button>
          <button type="button" class="hud-btn hud-unit-act-btn hud-btn-drop hidden" data-up="paradrop" title="Vysadit parašutisty do týlu z letiště (P)">
            Výsadek (P)
          </button>
          <button type="button" class="hud-btn hud-unit-act-btn hud-btn-artillery hidden" data-up="fire-mission" title="Zvolit cíl plošného ostřelování dělostřelectvem v dostřelu (F)">
            Ostřelovat cíl (F)
          </button>
          <button type="button" class="hud-btn hud-unit-act-btn hud-btn-danger hidden" data-up="cancel-fire" title="Zastavit aktuální palebnou misi dělostřelectva">
            Stop palby
          </button>
        </div>

        <div class="hud-unit-order-hint" data-up="order-hint">
          Pravý klik (RMB) na průchodnou mapu okamžitě vyšle vybrané jednotky.
        </div>
      </div>

      <div class="hud-unit-recruit-row">
        <span class="hud-build-title">Verbování</span>
        <div class="hud-unit-recruit-btns" data-up="recruit-btns"></div>
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
    this.selOrderBadgeEl = this.query('[data-up="sel-order"]');
    this.selEncircledEl = this.query('[data-up="sel-encircled"]');
    this.selDropEl = this.query('[data-up="sel-drop"]');
    this.hpValEl = this.query('[data-up="hp-val"]');
    this.hpBarEl = this.query('[data-up="hp-bar"]');
    this.hpHintEl = this.query('[data-up="hp-hint"]');
    this.moraleValEl = this.query('[data-up="morale-val"]');
    this.moraleBarEl = this.query('[data-up="morale-bar"]');
    this.moraleHintEl = this.query('[data-up="morale-hint"]');
    this.orderHintEl = this.query('[data-up="order-hint"]');
    this.lockBtn = this.query<HTMLButtonElement>('[data-up="stance-lock"]');
    this.rangeBtn = this.query<HTMLButtonElement>('[data-up="stance-range"]');
    this.mergeBtn = this.query<HTMLButtonElement>('[data-up="merge"]');
    this.paradropBtn = this.query<HTMLButtonElement>('[data-up="paradrop"]');
    this.fireMissionBtn = this.query<HTMLButtonElement>('[data-up="fire-mission"]');
    this.cancelFireBtn = this.query<HTMLButtonElement>('[data-up="cancel-fire"]');
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
    this.fireMissionBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.fireMissionBtn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.activeArtilleryIds.length > 0) {
        this.callbacks.onStartArtilleryFire();
      }
    });
    this.cancelFireBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.activeArtilleryIds.length > 0) {
        this.callbacks.onCancelArtilleryFire(this.activeArtilleryIds);
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
    artilleryFireMode: boolean = false,
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
      this.activeArtilleryIds = [];
      return;
    }

    let totalStack = 0;
    let totalHp = 0;
    let totalMaxHp = 0;
    let weightedMorale = 0;
    let anyEncircled = false;
    let anyVulnerable = false;
    let anyAttached = false;
    let anyMoving = false;
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
      if (u.attachedOrderId !== null) anyAttached = true;
      if (u.targetX !== null && u.targetY !== null) anyMoving = true;
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
      this.selTitleEl.textContent = `${spec.nameCs} ×${u.count}`;
    } else {
      this.selTitleEl.textContent = `${selectedUnits.length} svazků (×${totalStack} kusů)`;
    }

    this.selOrderBadgeEl.classList.toggle('hidden', !anyAttached);
    this.selEncircledEl.classList.toggle('hidden', !anyEncircled);
    this.selDropEl.classList.toggle('hidden', !anyVulnerable);

    this.hpValEl.textContent = `${Math.round(totalHp)} / ${Math.round(totalMaxHp)} (${hpPct} %)`;
    this.hpBarEl.style.width = `${Math.max(0, Math.min(100, hpPct))}%`;
    this.hpBarEl.classList.toggle('warn', hpPct <= 55 && hpPct > 28);
    this.hpBarEl.classList.toggle('crit', hpPct <= 28);
    this.hpHintEl.textContent =
      hpPct > 75
        ? `Odolnost svazku (${totalStack} bojeschopných kusů)`
        : hpPct > 35
          ? `Poškozený svazek (${totalStack} ks) — u vlastních měst/kasáren se opravuje`
          : `Kritické ztráty (${totalStack} ks) — bez opravy svazek zanikne`;

    this.moraleValEl.textContent = `${avgMorale} %`;
    this.moraleBarEl.style.width = `${Math.max(0, Math.min(100, avgMorale))}%`;
    this.moraleBarEl.classList.toggle('warn', avgMorale <= 60 && avgMorale > 30);
    this.moraleBarEl.classList.toggle('crit', avgMorale <= 30);
    this.moraleHintEl.textContent = anyEncircled
      ? 'Obklíčeno bez zásobování — morálka klesá a snižuje útok i rychlost!'
      : avgMorale >= 85
        ? 'Plná bojeschopnost (na vlastním zásobovaném území se obnovuje)'
        : 'Snížená morálka zpomaluje přesun i palbu — zotaví se na vlastním území';

    this.orderHintEl.textContent = anyMoving
      ? 'Přesun na zadaný cíl · RMB na jiný bod změní trasu'
      : 'RMB na libovolnou průchodnou mapu vyšle vybrané jednotky';

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

    const fireSupportSelected = selectedUnits.filter((u) => supportsFireMission(u.type));
    this.activeArtilleryIds = fireSupportSelected.map((u) => u.id);
    this.fireMissionBtn.classList.toggle('hidden', fireSupportSelected.length === 0);
    const anyFiring = fireSupportSelected.some((u) => u.fireMissionTicksRemaining > 0);
    this.cancelFireBtn.classList.toggle('hidden', !anyFiring);
    if (fireSupportSelected.length > 0) {
      const onlyBomber = fireSupportSelected.every((u) => u.type === 'BOMBER');
      const totalAmmoCost = fireSupportSelected.reduce(
        (sum, u) => sum + getFireMissionSalvoIndustryCost(u.type, u.count),
        0,
      );
      const hasEnoughAmmo = ind >= totalAmmoCost;
      this.fireMissionBtn.classList.toggle('active', artilleryFireMode);
      this.fireMissionBtn.classList.toggle('hud-btn-danger', !hasEnoughAmmo && !artilleryFireMode);
      this.fireMissionBtn.title = hasEnoughAmmo
        ? `${onlyBomber ? 'Cíl leteckého náletu' : 'Cíl dělostřelecké / námořní palby'} (F) — cena munice: ${totalAmmoCost} Průmyslu za salvu/nálet`
        : `Nedostatek Průmyslu pro munici (potřeba ${totalAmmoCost} P, k dispozici ${Math.floor(ind)} P)`;
      this.fireMissionBtn.textContent = artilleryFireMode
        ? 'Vyberte cíl palby / náletu...'
        : hasEnoughAmmo
          ? onlyBomber
            ? `Nálet (F · ${totalAmmoCost}P)`
            : `Ostřelovat (F · ${totalAmmoCost}P)`
          : `Nedostatek Průmyslu (${totalAmmoCost}P)`;
    }
  }
}
