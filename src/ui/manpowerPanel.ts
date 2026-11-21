import { BUILDING_SPECS } from '../engine/buildings';
import { computeOccupancyCurve } from '../engine/economy';
import {
  BuildBatchSize,
  BuildingType,
  ClientRenderState,
  MANPOWER_BUILDING_TYPES,
  PublicBuildingInfo,
  PublicPlayerInfo,
} from '../engine/types';

export interface ManpowerPanelCallbacks {
  readonly onSetTypeOccupancy: (buildingType: BuildingType, occupancyPct: number) => void;
  readonly onSetBuildingOccupancy: (buildingId: number, occupancyPct: number | null) => void;
  readonly onSetAllOccupancy: (occupancyPct: number) => void;
  readonly onCloseBuildingInspector: () => void;
  readonly onStackBuilding: (buildingId: number, batchSize: BuildBatchSize) => void;
  readonly onDemolishBuilding: (buildingId: number, demolishAll: boolean) => void;
}

interface TypeRowRef {
  readonly type: BuildingType;
  readonly countEl: HTMLElement;
  readonly sliderEl: HTMLInputElement;
  readonly readoutEl: HTMLElement;
}

function formatOccupancyReadout(pct: number): string {
  const curve = computeOccupancyCurve(pct);
  const outPct = Math.round(curve.outputMultiplier * 100);
  if (pct > 100) {
    const effPct = Math.round(curve.conversionEfficiency * 100);
    return `${pct} % → ${outPct} % (${effPct} % úč.)`;
  }
  return `${pct} % → ${outPct} %`;
}

/**
 * Collapsible left panel showing Ready (% Ready) / Assigned / Max manpower and accurate
 * building node/stack counts in both collapsed and expanded states, plus 0–200% sliders
 * and selected building inspection.
 */
export class ManpowerPanelController {
  private readonly panelEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly headerBadgeEl: HTMLElement;

  private readonly alwaysReadyEl: HTMLElement;
  private readonly alwaysAssignedEl: HTMLElement;
  private readonly alwaysMaxEl: HTMLElement;
  private readonly alwaysBuildingsEl: HTMLElement;
  private readonly typeRows: TypeRowRef[] = [];

  private readonly inspectorEl: HTMLElement;
  private readonly inspectorTitleEl: HTMLElement;
  private readonly inspectorCoordsEl: HTMLElement;
  private readonly inspectorStackEl: HTMLElement;
  private readonly inspectorSiteBoxEl: HTMLElement;
  private readonly inspectorSiteEffEl: HTMLElement;
  private readonly inspectorOutputEl: HTMLElement;
  private readonly inspectorMpEl: HTMLElement;
  private readonly inspectorEnergyEl: HTMLElement;
  private readonly inspectorConstrRowEl: HTMLElement;
  private readonly inspectorConstrTextEl: HTMLElement;
  private readonly inspectorStackBtn: HTMLButtonElement;
  private readonly inspectorDemolishBtn: HTMLButtonElement;
  private readonly inspectorSliderRowEl: HTMLElement;
  private readonly inspectorSliderEl: HTMLInputElement;
  private readonly inspectorSliderReadoutEl: HTMLElement;
  private readonly inspectorResetBtn: HTMLButtonElement;

  private readonly callbacks: ManpowerPanelCallbacks;
  private collapsed = true;
  private currentSelectedBuildingId: number | null = null;

  public constructor(callbacks: ManpowerPanelCallbacks) {
    this.callbacks = callbacks;

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'hud-panel hud-manpower-panel hidden';
    this.panelEl.innerHTML = `
      <div class="hud-lb-header">
        <div class="hud-mp-title-wrap">
          <span class="hud-lb-title">Manpower</span>
          <span class="hud-mp-badge" data-mp="header-badge">0 % ready</span>
        </div>
        <button type="button" class="hud-btn hud-lb-toggle" data-mp="toggle">Rozbalit</button>
      </div>
      <div class="hud-mp-always-bar">
        <div class="hud-mp-always-metrics">
          <span>Ready: <strong data-mp="always-ready">0 (0 %)</strong></span>
          <span>Assigned: <strong data-mp="always-assigned">0</strong></span>
          <span>Max: <strong data-mp="always-max">0</strong></span>
        </div>
        <div class="hud-mp-always-buildings" data-mp="always-buildings">Budovy: 1 (1 uzel)</div>
      </div>
      <div class="hud-mp-body hidden" data-mp="body">
        <div class="hud-mp-presets">
          <button type="button" class="hud-btn hud-mp-preset-btn" data-preset="0">0 %</button>
          <button type="button" class="hud-btn hud-mp-preset-btn" data-preset="100">100 % Opt.</button>
          <button type="button" class="hud-btn hud-mp-preset-btn" data-preset="150">150 %</button>
          <button type="button" class="hud-btn hud-mp-preset-btn" data-preset="200">200 % (+20%)</button>
        </div>
        <div class="hud-mp-rows" data-mp="rows"></div>
        <div class="hud-building-inspector hidden" data-mp="inspector">
          <div class="hud-insp-header">
            <div>
              <div class="hud-insp-title" data-mp="insp-title">Budova</div>
              <div class="hud-insp-coords" data-mp="insp-coords">[0, 0]</div>
            </div>
            <button type="button" class="hud-btn hud-dip-close" data-mp="insp-close">✕</button>
          </div>
          <div class="hud-insp-constr hidden" data-mp="insp-constr-row">
            <span data-mp="insp-constr-text">Výstavba: 0 %</span>
          </div>
          <div class="hud-insp-metrics">
            <div class="hud-insp-metric">
              <span>Stack</span>
              <strong data-mp="insp-stack">×1</strong>
            </div>
            <div class="hud-insp-metric" data-mp="insp-site-box">
              <span>Výnosnost lokality</span>
              <strong data-mp="insp-site-eff">100 %</strong>
            </div>
            <div class="hud-insp-metric">
              <span>Aktuální výkon</span>
              <strong data-mp="insp-output">100 %</strong>
            </div>
            <div class="hud-insp-metric">
              <span>Assigned MP / En.</span>
              <strong data-mp="insp-mp">0 MP</strong>
              <span class="hud-insp-sub" data-mp="insp-energy">0.0/s</span>
            </div>
          </div>
          <div class="hud-insp-actions">
            <button type="button" class="hud-btn hud-mp-reset-btn" data-mp="insp-stack-1">
              +1× Stack
            </button>
            <button type="button" class="hud-btn hud-btn-danger hud-mp-reset-btn" data-mp="insp-demolish-1">
              Demontovat 1×
            </button>
          </div>
          <div class="hud-insp-slider-wrap" data-mp="insp-slider-row">
            <div class="hud-mp-row-top">
              <span>Individuální obsazenost</span>
              <span class="hud-mp-readout" data-mp="insp-readout">Dle typu</span>
            </div>
            <div class="hud-insp-slider-controls">
              <input
                type="range"
                class="hud-slider hud-mp-slider"
                min="0"
                max="200"
                step="10"
                value="100"
                data-mp="insp-slider"
              />
              <button type="button" class="hud-btn hud-mp-reset-btn" data-mp="insp-reset">
                Dle typu
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bodyEl = this.query('[data-mp="body"]');
    this.toggleBtn = this.query<HTMLButtonElement>('[data-mp="toggle"]');
    this.headerBadgeEl = this.query('[data-mp="header-badge"]');
    this.alwaysReadyEl = this.query('[data-mp="always-ready"]');
    this.alwaysAssignedEl = this.query('[data-mp="always-assigned"]');
    this.alwaysMaxEl = this.query('[data-mp="always-max"]');
    this.alwaysBuildingsEl = this.query('[data-mp="always-buildings"]');

    this.inspectorEl = this.query('[data-mp="inspector"]');
    this.inspectorTitleEl = this.query('[data-mp="insp-title"]');
    this.inspectorCoordsEl = this.query('[data-mp="insp-coords"]');
    this.inspectorStackEl = this.query('[data-mp="insp-stack"]');
    this.inspectorSiteBoxEl = this.query('[data-mp="insp-site-box"]');
    this.inspectorSiteEffEl = this.query('[data-mp="insp-site-eff"]');
    this.inspectorOutputEl = this.query('[data-mp="insp-output"]');
    this.inspectorMpEl = this.query('[data-mp="insp-mp"]');
    this.inspectorEnergyEl = this.query('[data-mp="insp-energy"]');
    this.inspectorConstrRowEl = this.query('[data-mp="insp-constr-row"]');
    this.inspectorConstrTextEl = this.query('[data-mp="insp-constr-text"]');
    this.inspectorStackBtn = this.query<HTMLButtonElement>('[data-mp="insp-stack-1"]');
    this.inspectorDemolishBtn = this.query<HTMLButtonElement>('[data-mp="insp-demolish-1"]');
    this.inspectorSliderRowEl = this.query('[data-mp="insp-slider-row"]');
    this.inspectorSliderEl = this.query<HTMLInputElement>('[data-mp="insp-slider"]');
    this.inspectorSliderReadoutEl = this.query('[data-mp="insp-readout"]');
    this.inspectorResetBtn = this.query<HTMLButtonElement>('[data-mp="insp-reset"]');

    const rowsContainer = this.query('[data-mp="rows"]');
    for (const bType of MANPOWER_BUILDING_TYPES) {
      const spec = BUILDING_SPECS[bType];
      const row = document.createElement('div');
      row.className = 'hud-mp-row';

      const top = document.createElement('div');
      top.className = 'hud-mp-row-top';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'hud-mp-type-name';
      nameSpan.textContent = spec.nameCs;

      const countSpan = document.createElement('span');
      countSpan.className = 'hud-mp-count';
      countSpan.textContent = '(0×)';

      const readoutSpan = document.createElement('span');
      readoutSpan.className = 'hud-mp-readout';
      readoutSpan.textContent = formatOccupancyReadout(100);

      const leftWrap = document.createElement('span');
      leftWrap.className = 'hud-mp-label-wrap';
      leftWrap.appendChild(nameSpan);
      leftWrap.appendChild(countSpan);

      top.appendChild(leftWrap);
      top.appendChild(readoutSpan);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'hud-slider hud-mp-slider';
      slider.min = '0';
      slider.max = '200';
      slider.step = '10';
      slider.value = '100';

      slider.addEventListener('input', () => {
        const val = Number(slider.value);
        this.callbacks.onSetTypeOccupancy(bType, val);
      });

      row.appendChild(top);
      row.appendChild(slider);
      rowsContainer.appendChild(row);

      this.typeRows.push({
        type: bType,
        countEl: countSpan,
        sliderEl: slider,
        readoutEl: readoutSpan,
      });
    }

    this.toggleBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.setCollapsed(!this.collapsed);
    });

    const presetButtons = this.panelEl.querySelectorAll<HTMLButtonElement>('[data-preset]');
    for (const btn of presetButtons) {
      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const pct = Number(btn.dataset.preset);
        if (Number.isFinite(pct)) {
          this.callbacks.onSetAllOccupancy(pct);
        }
      });
    }

    this.inspectorStackBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.currentSelectedBuildingId !== null) {
        this.callbacks.onStackBuilding(this.currentSelectedBuildingId, 1);
      }
    });

    this.inspectorDemolishBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.currentSelectedBuildingId !== null) {
        this.callbacks.onDemolishBuilding(this.currentSelectedBuildingId, false);
      }
    });

    this.inspectorSliderEl.addEventListener('input', () => {
      if (this.currentSelectedBuildingId === null) return;
      const val = Number(this.inspectorSliderEl.value);
      this.callbacks.onSetBuildingOccupancy(this.currentSelectedBuildingId, val);
    });

    this.inspectorResetBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.currentSelectedBuildingId === null) return;
      this.callbacks.onSetBuildingOccupancy(this.currentSelectedBuildingId, null);
    });

    const inspCloseBtn = this.query<HTMLButtonElement>('[data-mp="insp-close"]');
    inspCloseBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.callbacks.onCloseBuildingInspector();
    });

    this.panelEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.panelEl.querySelector<T>(selector);
    if (!el) {
      throw new Error(`Missing manpower panel element: ${selector}`);
    }
    return el;
  }

  public getPanelElement(): HTMLElement {
    return this.panelEl;
  }

  public isCollapsed(): boolean {
    return this.collapsed;
  }

  public setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.bodyEl.classList.toggle('hidden', this.collapsed);
    this.toggleBtn.textContent = this.collapsed ? 'Rozbalit' : 'Sbalit';
  }

  public update(state: ClientRenderState, selectedBuildingId: number | null): void {
    const isPlaying = state.phase === 'PLAYING';
    this.panelEl.classList.toggle('hidden', !isPlaying);
    if (!isPlaying) return;

    this.currentSelectedBuildingId = selectedBuildingId;

    const human: PublicPlayerInfo | undefined = state.players.find(
      (p) => p.id === state.humanPlayerId,
    );
    const readyMp = Math.floor(human?.activeManpower ?? 0);
    const assignedMp = Math.round(human?.allocatedManpower ?? 0);
    const totalMp = Math.max(1, Math.floor(human?.manpower ?? 0));
    const maxMp = Math.round(human?.maxManpower ?? 0);
    const readyPct = Math.round((readyMp / totalMp) * 100);

    let totalCompleted = 0;
    let totalQueued = 0;
    const completedCounts = new Map<BuildingType, number>();
    const queuedCounts = new Map<BuildingType, number>();
    for (const b of state.buildings) {
      totalCompleted += b.stackCount;
      totalQueued += b.underConstructionCount;
      completedCounts.set(b.type, (completedCounts.get(b.type) ?? 0) + b.stackCount);
      queuedCounts.set(b.type, (queuedCounts.get(b.type) ?? 0) + b.underConstructionCount);
    }

    this.headerBadgeEl.textContent = `${readyPct} % ready`;
    this.alwaysReadyEl.textContent = `${readyMp} (${readyPct} %)`;
    this.alwaysAssignedEl.textContent = `${assignedMp}`;
    this.alwaysMaxEl.textContent = `${maxMp}`;
    const queuedPart = totalQueued > 0 ? ` (+${totalQueued} stav.)` : '';
    const nodeWord =
      state.buildings.length === 1 ? 'uzel' : state.buildings.length < 5 ? 'uzly' : 'uzlů';
    this.alwaysBuildingsEl.textContent = `Budovy: ${totalCompleted}${queuedPart} (${state.buildings.length} ${nodeWord})`;

    if (this.collapsed) {
      return;
    }

    const occByType = human?.buildingOccupancyByType;
    for (const ref of this.typeRows) {
      const pct = occByType ? occByType[ref.type] : 100;
      const done = completedCounts.get(ref.type) ?? 0;
      const queued = queuedCounts.get(ref.type) ?? 0;
      ref.countEl.textContent = queued > 0 ? `(${done}× +${queued})` : `(${done}×)`;
      ref.readoutEl.textContent = formatOccupancyReadout(pct);
      ref.readoutEl.classList.toggle('overload', pct > 100);
      if (document.activeElement !== ref.sliderEl) {
        ref.sliderEl.value = String(pct);
      }
    }

    const selectedBuilding: PublicBuildingInfo | undefined =
      selectedBuildingId !== null
        ? state.buildings.find((b) => b.id === selectedBuildingId)
        : undefined;

    if (!selectedBuilding) {
      this.inspectorEl.classList.add('hidden');
      return;
    }

    this.inspectorEl.classList.remove('hidden');
    const spec = BUILDING_SPECS[selectedBuilding.type];
    const titleSuffix = selectedBuilding.isCapital ? ' (Hl. město)' : '';
    this.inspectorTitleEl.textContent = `${spec.nameCs}${titleSuffix}`;
    this.inspectorCoordsEl.textContent = `[${selectedBuilding.x}, ${selectedBuilding.y}]`;

    const qText =
      selectedBuilding.underConstructionCount > 0
        ? ` (+${selectedBuilding.underConstructionCount})`
        : '';
    this.inspectorStackEl.textContent = `×${selectedBuilding.stackCount}${qText}`;

    const hasConstr = selectedBuilding.underConstructionCount > 0;
    this.inspectorConstrRowEl.classList.toggle('hidden', !hasConstr);
    if (hasConstr) {
      const pctDone = Math.round(
        (1 -
          selectedBuilding.constructionTicksRemaining /
            Math.max(1, selectedBuilding.constructionTicksTotal)) *
          100,
      );
      this.inspectorConstrTextEl.textContent = `Výstavba: ${pctDone} % (${selectedBuilding.underConstructionCount} ve frontě)`;
    }

    this.inspectorSiteBoxEl.classList.toggle('hidden', spec.resourceZoneType === null);
    if (selectedBuilding.revealedEfficiencyPct === null) {
      this.inspectorSiteEffEl.textContent = 'Po dostavbě';
      this.inspectorSiteEffEl.classList.remove('low-site', 'high-site');
    } else {
      this.inspectorSiteEffEl.textContent = `${selectedBuilding.revealedEfficiencyPct} %`;
      this.inspectorSiteEffEl.classList.toggle(
        'low-site',
        selectedBuilding.revealedEfficiencyPct < 50,
      );
      this.inspectorSiteEffEl.classList.toggle(
        'high-site',
        selectedBuilding.revealedEfficiencyPct >= 85,
      );
    }

    this.inspectorOutputEl.textContent =
      selectedBuilding.type === 'CITY'
        ? `${Math.min(100, selectedBuilding.effectiveOutputPct)} % (max)`
        : `${selectedBuilding.effectiveOutputPct} %`;
    this.inspectorMpEl.textContent = `${Math.round(selectedBuilding.allocatedManpower)} MP`;
    this.inspectorEnergyEl.textContent =
      selectedBuilding.currentEnergyProd > 0
        ? `+${selectedBuilding.currentEnergyProd.toFixed(1)}/s`
        : `−${selectedBuilding.currentEnergyUse.toFixed(1)}/s`;

    const totalUnits = selectedBuilding.stackCount + selectedBuilding.underConstructionCount;
    const removable = selectedBuilding.isCapital ? Math.max(0, totalUnits - 1) : totalUnits;
    this.inspectorDemolishBtn.disabled = removable <= 0;

    const usesOccupancy =
      selectedBuilding.type !== 'CITY' &&
      (spec.baseManpowerRequired > 0 || spec.baseEnergyConsumption > 0);
    this.inspectorSliderRowEl.classList.toggle('hidden', !usesOccupancy);
    if (usesOccupancy) {
      const typeDefault = occByType ? occByType[selectedBuilding.type] : 100;
      const shownPct = selectedBuilding.occupancyOverride ?? typeDefault;
      const overrideLabel =
        selectedBuilding.occupancyOverride !== null
          ? formatOccupancyReadout(shownPct)
          : `${shownPct} % (dle typu)`;
      this.inspectorSliderReadoutEl.textContent = overrideLabel;
      this.inspectorSliderReadoutEl.classList.toggle('overload', shownPct > 100);
      this.inspectorResetBtn.disabled = selectedBuilding.occupancyOverride === null;
      if (document.activeElement !== this.inspectorSliderEl) {
        this.inspectorSliderEl.value = String(shownPct);
      }
    }
  }
}
