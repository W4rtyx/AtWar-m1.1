import {
  BUILDING_SPECS,
  computeBatchQuote,
  countPlayerUnitsOfType,
  getValidBuildingsForCell,
  isCoastalLandCell,
  validateBuildingPlacement,
} from '../engine/buildings';
import { DEFENSE_SPECS, isDefenseBuildingType } from '../engine/defenses';
import {
  ALL_BUILDING_TYPES,
  BuildBatchSize,
  BuildingCost,
  BuildingType,
  ClientRenderState,
  DEMOLISH_REFUND_RATIO,
  MAX_STACK_PER_NODE,
  PublicBuildingInfo,
  PublicPlayerInfo,
  TICK_RATE,
  TerrainType,
  UnitType,
} from '../engine/types';
import { UNIT_SPECS, getProducibleUnitsForBuilding } from '../engine/units';

export interface BuildMenuCallbacks {
  readonly onSelectBuildType: (type: BuildingType | null) => void;
  readonly onBatchSizeChange: (batch: BuildBatchSize) => void;
}

export interface TerrainBuildMenuCallbacks {
  readonly onPlaceBuildingAt: (
    type: BuildingType,
    x: number,
    y: number,
    batchSize: BuildBatchSize,
  ) => void;
  readonly onBatchSizeChange: (batch: BuildBatchSize) => void;
}

export interface BuildingContextCallbacks {
  readonly onStackBuilding: (buildingId: number, batchSize: BuildBatchSize) => void;
  readonly onDemolishBuilding: (buildingId: number, demolishAll: boolean) => void;
  readonly onInspectBuilding: (buildingId: number) => void;
  readonly onProduceUnit: (buildingId: number, unitType: UnitType) => void;
}

const BATCH_OPTIONS: ReadonlyArray<BuildBatchSize> = [1, 5, 10, 'MAX'];

function formatCostText(cost: BuildingCost, isFreeOnly: boolean): string {
  if (isFreeOnly && cost.money === 0 && cost.buildingMaterial === 0 && cost.industry === 0) {
    return 'ZDARMA (1.)';
  }
  const parts: string[] = [];
  if (cost.money > 0) parts.push(`${cost.money}$`);
  if (cost.buildingMaterial > 0) parts.push(`${cost.buildingMaterial}M`);
  if (cost.industry > 0) parts.push(`${cost.industry}P`);
  if (parts.length === 0) return 'ZDARMA';
  return isFreeOnly ? `${parts.join('·')}+1.Zd` : parts.join('·');
}

function formatUnitCostText(unitType: UnitType): string {
  const c = UNIT_SPECS[unitType].cost;
  const parts: string[] = [];
  if (c.money > 0) parts.push(`${c.money}$`);
  if (c.buildingMaterial > 0) parts.push(`${c.buildingMaterial}M`);
  if (c.industry > 0) parts.push(`${c.industry}P`);
  parts.push(`${c.manpower} MP`);
  return parts.join(' · ');
}

interface BuildButtonRef {
  readonly type: BuildingType;
  readonly button: HTMLButtonElement;
  readonly countEl: HTMLElement;
  readonly costEl: HTMLElement;
}

interface BatchButtonRef {
  readonly batch: BuildBatchSize;
  readonly button: HTMLButtonElement;
}

/**
 * Compact collapsible bottom building palette (defaults to a slim bar with batch selector
 * and hotkey/RMB hint so the viewport stays clear; expands into Economy/Military and Defenses).
 */
export class BuildMenuController {
  private readonly panelEl: HTMLElement;
  private readonly gridWrapEl: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly activeHintEl: HTMLElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly callbacks: BuildMenuCallbacks;
  private readonly buttons: BuildButtonRef[] = [];
  private readonly batchButtons: BatchButtonRef[] = [];
  private expanded = false;

  public constructor(callbacks: BuildMenuCallbacks) {
    this.callbacks = callbacks;

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'hud-panel hud-build-bar hidden';

    const headerEl = document.createElement('div');
    headerEl.className = 'hud-build-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'hud-build-title-group';

    const titleEl = document.createElement('span');
    titleEl.className = 'hud-build-title';
    titleEl.textContent = 'Stavba';
    titleGroup.appendChild(titleEl);

    const rmbHintEl = document.createElement('span');
    rmbHintEl.className = 'hud-build-rmb-hint';
    rmbHintEl.textContent = 'RMB na vlastní území = radiální menu';
    titleGroup.appendChild(rmbHintEl);

    const batchGroup = document.createElement('div');
    batchGroup.className = 'hud-batch-group';
    for (const batch of BATCH_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `hud-btn hud-batch-btn${batch === 1 ? ' active' : ''}`;
      btn.textContent = batch === 'MAX' ? 'MAX' : `${batch}×`;
      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onBatchSizeChange(batch);
      });
      batchGroup.appendChild(btn);
      this.batchButtons.push({ batch, button: btn });
    }
    titleGroup.appendChild(batchGroup);

    this.activeHintEl = document.createElement('span');
    this.activeHintEl.className = 'hud-build-active-pill hidden';
    titleGroup.appendChild(this.activeHintEl);

    headerEl.appendChild(titleGroup);

    const rightBtns = document.createElement('div');
    rightBtns.className = 'hud-build-header-actions';

    this.cancelBtn = document.createElement('button');
    this.cancelBtn.type = 'button';
    this.cancelBtn.className = 'hud-btn hud-btn-danger hud-build-cancel hidden';
    this.cancelBtn.textContent = 'Zrušit (Esc)';
    this.cancelBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.callbacks.onSelectBuildType(null);
    });
    rightBtns.appendChild(this.cancelBtn);

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.type = 'button';
    this.toggleBtn.className = 'hud-btn hud-build-toggle';
    this.toggleBtn.textContent = 'Paleta ▾';
    this.toggleBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.setExpanded(!this.expanded);
    });
    rightBtns.appendChild(this.toggleBtn);

    headerEl.appendChild(rightBtns);
    this.panelEl.appendChild(headerEl);

    this.gridWrapEl = document.createElement('div');
    this.gridWrapEl.className = 'hud-build-grid-wrap hidden';

    const econRow = document.createElement('div');
    econRow.className = 'hud-build-grid';
    const defRow = document.createElement('div');
    defRow.className = 'hud-build-grid hud-build-grid-def';

    ALL_BUILDING_TYPES.forEach((bType, idx) => {
      const spec = BUILDING_SPECS[bType];
      const hotkeyLabel = idx < 9 ? String(idx + 1) : idx === 9 ? '0' : idx === 10 ? '-' : '=';
      const isDef = isDefenseBuildingType(bType);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isDef
        ? 'hud-btn hud-build-btn hud-build-btn-defense'
        : 'hud-btn hud-build-btn';

      const defExtra = isDef
        ? ` | ${DEFENSE_SPECS[bType].roleLabelCs} (${DEFENSE_SPECS[bType].techTreeBranchCs})`
        : '';
      btn.title = `${spec.nameCs} [${hotkeyLabel}] — ${spec.descriptionCs}${defExtra}`;

      const topRow = document.createElement('span');
      topRow.className = 'hud-build-btn-top';

      const keyBadge = document.createElement('span');
      keyBadge.className = 'hud-build-hotkey';
      keyBadge.textContent = hotkeyLabel;

      const nameEl = document.createElement('span');
      nameEl.className = 'hud-build-name';
      nameEl.textContent = spec.nameCs;

      const countEl = document.createElement('span');
      countEl.className = 'hud-build-owned';
      countEl.textContent = '(0)';

      topRow.appendChild(keyBadge);
      topRow.appendChild(nameEl);
      topRow.appendChild(countEl);

      const costEl = document.createElement('span');
      costEl.className = 'hud-build-cost';
      costEl.textContent = formatCostText(spec.cost, bType === 'POWER_PLANT');

      btn.appendChild(topRow);
      btn.appendChild(costEl);

      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const isAlreadySelected = btn.classList.contains('active');
        this.callbacks.onSelectBuildType(isAlreadySelected ? null : bType);
      });

      if (isDef) {
        defRow.appendChild(btn);
      } else {
        econRow.appendChild(btn);
      }
      this.buttons.push({ type: bType, button: btn, countEl, costEl });
    });

    this.gridWrapEl.appendChild(econRow);
    this.gridWrapEl.appendChild(defRow);
    this.panelEl.appendChild(this.gridWrapEl);

    this.panelEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
  }

  public getPanelElement(): HTMLElement {
    return this.panelEl;
  }

  public isExpanded(): boolean {
    return this.expanded;
  }

  public setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.gridWrapEl.classList.toggle('hidden', !this.expanded);
    this.toggleBtn.textContent = this.expanded ? 'Skrýt ▴' : 'Paleta ▾';
  }

  public update(
    state: ClientRenderState,
    selectedBuildType: BuildingType | null,
    batchSize: BuildBatchSize = 1,
  ): void {
    const isPlaying = state.phase === 'PLAYING';
    this.panelEl.classList.toggle('hidden', !isPlaying);
    if (!isPlaying) return;

    const human: PublicPlayerInfo | undefined = state.players.find(
      (p) => p.id === state.humanPlayerId,
    );
    const funds = {
      money: human?.money ?? 0,
      buildingMaterial: human?.buildingMaterial ?? 0,
      industry: human?.industry ?? 0,
    };
    const freeUsed = human?.freePowerPlantUsed ?? false;

    for (const bRef of this.batchButtons) {
      bRef.button.classList.toggle('active', bRef.batch === batchSize);
    }
    this.cancelBtn.classList.toggle('hidden', selectedBuildType === null);
    this.activeHintEl.classList.toggle('hidden', selectedBuildType === null);
    if (selectedBuildType !== null) {
      this.activeHintEl.textContent = `Režim: ${BUILDING_SPECS[selectedBuildType].nameCs}`;
    }

    if (!this.expanded && selectedBuildType === null) {
      return;
    }

    const ownedCompleted = new Map<BuildingType, number>();
    const ownedQueued = new Map<BuildingType, number>();
    for (const b of state.buildings) {
      if (b.ownerId !== state.humanPlayerId) continue;
      ownedCompleted.set(b.type, (ownedCompleted.get(b.type) ?? 0) + b.stackCount);
      ownedQueued.set(b.type, (ownedQueued.get(b.type) ?? 0) + b.underConstructionCount);
    }

    for (const ref of this.buttons) {
      const doneCount = ownedCompleted.get(ref.type) ?? 0;
      const queuedCount = ownedQueued.get(ref.type) ?? 0;
      ref.countEl.textContent =
        queuedCount > 0 ? `(${doneCount}+${queuedCount})` : `(${doneCount})`;
      ref.countEl.classList.toggle('has-queued', queuedCount > 0);

      const scaledCount = countPlayerUnitsOfType(state.buildings, state.humanPlayerId, ref.type);
      const quote = computeBatchQuote(
        ref.type,
        scaledCount,
        freeUsed,
        batchSize,
        MAX_STACK_PER_NODE,
        funds,
      );
      const displayQuote =
        quote.unitsToBuild > 0
          ? quote
          : computeBatchQuote(ref.type, scaledCount, freeUsed, 1, MAX_STACK_PER_NODE, funds);

      const affordable =
        quote.unitsToBuild > 0 &&
        funds.money >= quote.totalCost.money &&
        funds.buildingMaterial >= quote.totalCost.buildingMaterial &&
        funds.industry >= quote.totalCost.industry;

      const costStr = formatCostText(displayQuote.totalCost, displayQuote.usesFreePowerPlant);
      ref.costEl.textContent =
        batchSize === 'MAX'
          ? quote.unitsToBuild > 0
            ? `${quote.unitsToBuild}× · ${costStr}`
            : `0× · ${costStr}`
          : batchSize > 1
            ? `${quote.unitsToBuild}× · ${costStr}`
            : costStr;

      ref.costEl.classList.toggle('free-bonus', displayQuote.usesFreePowerPlant);
      ref.button.classList.toggle('active', selectedBuildType === ref.type);
      ref.button.classList.toggle('unaffordable', !affordable);
    }
  }
}

/**
 * Radial cursor build menu opened via hotkey `B` at current cursor position `(screenX, screenY)`.
 * Displays buildings valid for the cursor terrain with wide non-overlapping elliptical spacing and owned counts.
 */
export class TerrainBuildMenuController {
  private readonly menuEl: HTMLElement;
  private readonly itemsLayerEl: HTMLElement;
  private readonly terrainLabelEl: HTMLElement;
  private readonly zoneLabelEl: HTMLElement;
  private readonly batchButtons: BatchButtonRef[] = [];
  private readonly callbacks: TerrainBuildMenuCallbacks;

  private openWorldX: number | null = null;
  private openWorldY: number | null = null;
  private centerScreenX = 0;
  private centerScreenY = 0;
  private lastStructureKey = '';

  public constructor(root: HTMLElement, callbacks: TerrainBuildMenuCallbacks) {
    this.callbacks = callbacks;

    this.menuEl = document.createElement('div');
    this.menuEl.className = 'hud-radial-menu hidden';
    this.menuEl.innerHTML = `
      <div class="hud-radial-ring"></div>
      <div class="hud-radial-items" data-rad="items"></div>
      <div class="hud-panel hud-radial-hub">
        <div class="hud-radial-hub-top">
          <span class="hud-radial-terrain" data-rad="terrain">Rovina</span>
          <button type="button" class="hud-btn hud-dip-close" data-rad="close">✕</button>
        </div>
        <div class="hud-radial-zone hidden" data-rad="zone"></div>
        <div class="hud-radial-batch" data-rad="batch"></div>
      </div>
    `;

    root.appendChild(this.menuEl);

    this.itemsLayerEl = this.query('[data-rad="items"]');
    this.terrainLabelEl = this.query('[data-rad="terrain"]');
    this.zoneLabelEl = this.query('[data-rad="zone"]');

    const batchContainer = this.query('[data-rad="batch"]');
    for (const batch of BATCH_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-btn hud-batch-btn';
      btn.textContent = batch === 'MAX' ? 'MAX' : `${batch}×`;
      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onBatchSizeChange(batch);
      });
      batchContainer.appendChild(btn);
      this.batchButtons.push({ batch, button: btn });
    }

    const closeBtn = this.query<HTMLButtonElement>('[data-rad="close"]');
    closeBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });

    this.menuEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.menuEl.querySelector<T>(selector);
    if (!el) {
      throw new Error(`Missing radial build menu element: ${selector}`);
    }
    return el;
  }

  public open(
    worldX: number,
    worldY: number,
    screenX: number,
    screenY: number,
    state: ClientRenderState,
  ): boolean {
    const ix = Math.max(0, Math.min(state.width - 1, Math.floor(worldX)));
    const iy = Math.max(0, Math.min(state.height - 1, Math.floor(worldY)));

    this.openWorldX = ix;
    this.openWorldY = iy;
    const padX = 258;
    const padY = 210;
    this.centerScreenX = Math.max(padX, Math.min(window.innerWidth - padX, screenX));
    this.centerScreenY = Math.max(padY + 28, Math.min(window.innerHeight - padY, screenY));
    this.lastStructureKey = '';

    this.menuEl.style.left = `${this.centerScreenX}px`;
    this.menuEl.style.top = `${this.centerScreenY}px`;
    this.menuEl.classList.remove('hidden');
    return true;
  }

  public close(): void {
    this.openWorldX = null;
    this.openWorldY = null;
    this.lastStructureKey = '';
    this.menuEl.classList.add('hidden');
  }

  public isOpen(): boolean {
    return this.openWorldX !== null && this.openWorldY !== null;
  }

  public update(state: ClientRenderState, batchSize: BuildBatchSize): void {
    if (state.phase !== 'PLAYING' || this.openWorldX === null || this.openWorldY === null) {
      this.close();
      return;
    }

    const ix = this.openWorldX;
    const iy = this.openWorldY;
    const validTypes = getValidBuildingsForCell(state, state.humanPlayerId, ix, iy);

    for (const ref of this.batchButtons) {
      ref.button.classList.toggle('active', ref.batch === batchSize);
    }

    const terrainVal = state.terrain[iy * state.width + ix];
    const cellOwner = state.owners[iy * state.width + ix];
    const coastal = isCoastalLandCell(state.terrain, state.width, state.height, ix, iy, 2);
    const terrainText =
      terrainVal === TerrainType.WATER
        ? 'Voda'
        : terrainVal === TerrainType.MOUNTAINS
          ? coastal
            ? 'Hory · Pobřeží'
            : 'Hory'
          : coastal
            ? 'Rovina · Pobřeží'
            : 'Rovina';
    this.terrainLabelEl.textContent = `${terrainText} [${ix},${iy}]`;

    let zoneText = '';
    for (const z of state.publicResourceZones) {
      if (Math.hypot(ix - z.centerX, iy - z.centerY) <= z.radius) {
        zoneText =
          z.type === 'CONSTRUCTION_MATERIAL'
            ? 'Zóna: Stav. materiál'
            : z.type === 'INDUSTRIAL'
              ? 'Zóna: Průmysl'
              : 'Zóna: Energie';
        break;
      }
    }
    if (validTypes.length === 0) {
      zoneText =
        terrainVal === TerrainType.WATER
          ? 'Voda — nelze stavět'
          : cellOwner !== state.humanPlayerId
            ? 'Mimo vlastní území'
            : 'Zde nelze stavět';
    }
    this.zoneLabelEl.classList.toggle('hidden', zoneText.length === 0);
    this.zoneLabelEl.textContent = zoneText;

    const human = state.players.find((p) => p.id === state.humanPlayerId);
    const key = `${ix}|${iy}|${batchSize}|${validTypes.length}|${state.stateVersion}|${Math.floor(human?.money ?? 0)}|${Math.floor(human?.buildingMaterial ?? 0)}|${Math.floor(human?.industry ?? 0)}`;
    if (key === this.lastStructureKey) {
      return;
    }
    this.lastStructureKey = key;

    const ownedCounts = new Map<BuildingType, number>();
    for (const b of state.buildings) {
      if (b.ownerId !== state.humanPlayerId) continue;
      ownedCounts.set(b.type, (ownedCounts.get(b.type) ?? 0) + b.stackCount);
    }

    this.itemsLayerEl.innerHTML = '';
    if (validTypes.length === 0) {
      return;
    }

    const radiusX = 198;
    const radiusY = 158;
    const total = validTypes.length;

    validTypes.forEach((bType, idx) => {
      const angle = -Math.PI / 2 + (idx / total) * Math.PI * 2;
      const offsetX = Math.round(Math.cos(angle) * radiusX);
      const offsetY = Math.round(Math.sin(angle) * radiusY);

      const spec = BUILDING_SPECS[bType];
      const check = validateBuildingPlacement(state, human, bType, ix, iy, batchSize);
      const owned = ownedCounts.get(bType) ?? 0;
      const isDef = isDefenseBuildingType(bType);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `hud-btn hud-radial-item${isDef ? ' is-defense' : ''}${check.inMatchingZone ? ' in-zone' : ''}`;
      btn.style.left = `${offsetX}px`;
      btn.style.top = `${offsetY}px`;
      btn.disabled = !check.valid;
      btn.title = `${spec.nameCs} — ${spec.descriptionCs}${!check.valid && check.reasonCs ? ` (${check.reasonCs})` : ''}`;

      const top = document.createElement('span');
      top.className = 'hud-radial-item-top';
      top.textContent = `${spec.shortCode} (${owned})`;

      const sub = document.createElement('span');
      sub.className = 'hud-radial-item-name';
      sub.textContent = spec.nameCs;

      const cost = document.createElement('span');
      cost.className = `hud-radial-item-cost${check.isFreePowerPlant ? ' free-bonus' : ''}`;
      cost.textContent = check.valid
        ? formatCostText(check.effectiveCost, check.isFreePowerPlant)
        : (check.reasonCs ?? formatCostText(check.effectiveCost, check.isFreePowerPlant));

      btn.appendChild(top);
      btn.appendChild(sub);
      btn.appendChild(cost);

      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || btn.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onPlaceBuildingAt(bType, ix, iy, batchSize);
        this.close();
      });

      this.itemsLayerEl.appendChild(btn);
    });
  }
}

interface StackActionButtonRef {
  readonly batch: BuildBatchSize;
  readonly button: HTMLButtonElement;
  readonly labelEl: HTMLElement;
  readonly costEl: HTMLElement;
}

/**
 * Right-click building context menu for stacking additional structures (1x/5x/10x/MAX),
 * recruiting units at Barracks/Armory/Airfield, and demolishing with 50% refund.
 */
export class BuildingContextMenuController {
  private readonly popoverEl: HTMLElement;
  private readonly callbacks: BuildingContextCallbacks;

  private readonly titleEl: HTMLElement;
  private readonly coordsEl: HTMLElement;
  private readonly stackValEl: HTMLElement;
  private readonly siteValEl: HTMLElement;
  private readonly constrWrapEl: HTMLElement;
  private readonly constrTextEl: HTMLElement;
  private readonly unitSectionEl: HTMLElement;
  private readonly unitGridEl: HTMLElement;
  private readonly unitQueueEl: HTMLElement;
  private readonly stackButtons: StackActionButtonRef[] = [];
  private readonly demolishOneBtn: HTMLButtonElement;
  private readonly demolishAllBtn: HTMLButtonElement;

  private openBuildingId: number | null = null;
  private posX = 0;
  private posY = 0;
  private lastUnitMenuKey = '';

  public constructor(root: HTMLElement, callbacks: BuildingContextCallbacks) {
    this.callbacks = callbacks;

    this.popoverEl = document.createElement('div');
    this.popoverEl.className = 'hud-panel hud-building-popover hidden';
    this.popoverEl.innerHTML = `
      <div class="hud-dip-header">
        <div>
          <div class="hud-dip-name" data-bm="title">Budova</div>
          <div class="hud-insp-coords" data-bm="coords">[0, 0]</div>
        </div>
        <button type="button" class="hud-btn hud-dip-close" data-bm="close">✕</button>
      </div>
      <div class="hud-bm-meta">
        <span>Stack: <strong data-bm="stack">×1</strong></span>
        <span>Lokalita: <strong data-bm="site">100 %</strong></span>
      </div>
      <div class="hud-bm-constr hidden" data-bm="constr-wrap">
        <span data-bm="constr-text">Výstavba: 0 %</span>
      </div>
      <div class="hud-bm-unit-section hidden" data-bm="unit-section">
        <div class="hud-bm-section-label">Výroba jednotek</div>
        <div class="hud-bm-unit-grid" data-bm="unit-grid"></div>
        <div class="hud-bm-unit-queue hidden" data-bm="unit-queue"></div>
      </div>
      <div class="hud-bm-section-label">Přistavět do stacku</div>
      <div class="hud-bm-stack-grid" data-bm="stack-grid"></div>
      <div class="hud-bm-actions">
        <button type="button" class="hud-btn hud-btn-danger" data-bm="demolish-one">
          Demontovat 1× (+50 % sur.)
        </button>
        <button type="button" class="hud-btn hud-btn-danger" data-bm="demolish-all">
          Zbourat vše
        </button>
        <button type="button" class="hud-btn" data-bm="inspect">
          Správa Manpoweru
        </button>
      </div>
    `;

    root.appendChild(this.popoverEl);

    this.titleEl = this.query('[data-bm="title"]');
    this.coordsEl = this.query('[data-bm="coords"]');
    this.stackValEl = this.query('[data-bm="stack"]');
    this.siteValEl = this.query('[data-bm="site"]');
    this.constrWrapEl = this.query('[data-bm="constr-wrap"]');
    this.constrTextEl = this.query('[data-bm="constr-text"]');
    this.unitSectionEl = this.query('[data-bm="unit-section"]');
    this.unitGridEl = this.query('[data-bm="unit-grid"]');
    this.unitQueueEl = this.query('[data-bm="unit-queue"]');
    this.demolishOneBtn = this.query<HTMLButtonElement>('[data-bm="demolish-one"]');
    this.demolishAllBtn = this.query<HTMLButtonElement>('[data-bm="demolish-all"]');

    const stackGrid = this.query('[data-bm="stack-grid"]');
    for (const batch of BATCH_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-btn hud-bm-stack-btn';

      const lbl = document.createElement('span');
      lbl.className = 'hud-bm-stack-lbl';
      lbl.textContent = batch === 'MAX' ? '+MAX' : `+${batch}×`;

      const cost = document.createElement('span');
      cost.className = 'hud-bm-stack-cost';
      cost.textContent = '0$';

      btn.appendChild(lbl);
      btn.appendChild(cost);
      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || btn.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        if (this.openBuildingId !== null) {
          this.callbacks.onStackBuilding(this.openBuildingId, batch);
        }
      });

      stackGrid.appendChild(btn);
      this.stackButtons.push({ batch, button: btn, labelEl: lbl, costEl: cost });
    }

    const closeBtn = this.query<HTMLButtonElement>('[data-bm="close"]');
    closeBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });

    this.demolishOneBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.demolishOneBtn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.openBuildingId !== null) {
        this.callbacks.onDemolishBuilding(this.openBuildingId, false);
      }
    });

    this.demolishAllBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.demolishAllBtn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.openBuildingId !== null) {
        this.callbacks.onDemolishBuilding(this.openBuildingId, true);
      }
    });

    const inspectBtn = this.query<HTMLButtonElement>('[data-bm="inspect"]');
    inspectBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.openBuildingId !== null) {
        const bid = this.openBuildingId;
        this.close();
        this.callbacks.onInspectBuilding(bid);
      }
    });

    this.popoverEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.popoverEl.querySelector<T>(selector);
    if (!el) {
      throw new Error(`Missing building context menu element: ${selector}`);
    }
    return el;
  }

  public open(buildingId: number, screenX: number, screenY: number): void {
    this.openBuildingId = buildingId;
    this.lastUnitMenuKey = '';
    this.posX = Math.max(12, Math.min(window.innerWidth - 270, screenX));
    this.posY = Math.max(54, Math.min(window.innerHeight - 360, screenY));
    this.popoverEl.style.left = `${this.posX}px`;
    this.popoverEl.style.top = `${this.posY}px`;
  }

  public close(): void {
    this.openBuildingId = null;
    this.lastUnitMenuKey = '';
    this.popoverEl.classList.add('hidden');
  }

  public isOpen(): boolean {
    return this.openBuildingId !== null;
  }

  public update(state: ClientRenderState): void {
    if (state.phase !== 'PLAYING' || this.openBuildingId === null) {
      this.close();
      return;
    }

    const building: PublicBuildingInfo | undefined = state.buildings.find(
      (b) => b.id === this.openBuildingId && b.ownerId === state.humanPlayerId,
    );
    if (!building) {
      this.close();
      return;
    }

    this.popoverEl.classList.remove('hidden');

    const spec = BUILDING_SPECS[building.type];
    const human = state.players.find((p) => p.id === state.humanPlayerId);
    const funds = {
      money: human?.money ?? 0,
      buildingMaterial: human?.buildingMaterial ?? 0,
      industry: human?.industry ?? 0,
    };
    const activeMp = human?.activeManpower ?? 0;
    const freeUsed = human?.freePowerPlantUsed ?? false;

    this.titleEl.textContent = building.isCapital
      ? `${spec.nameCs} (Hl. město)`
      : `${spec.nameCs} #${building.id}`;
    this.coordsEl.textContent = `[${building.x}, ${building.y}] · max ${MAX_STACK_PER_NODE}×`;

    const queuedSuffix =
      building.underConstructionCount > 0 ? ` (+${building.underConstructionCount} stav.)` : '';
    this.stackValEl.textContent = `×${building.stackCount}${queuedSuffix}`;
    this.siteValEl.textContent =
      building.revealedEfficiencyPct !== null ? `${building.revealedEfficiencyPct} %` : 'Po dostavbě';

    const hasConstruction = building.underConstructionCount > 0;
    this.constrWrapEl.classList.toggle('hidden', !hasConstruction);
    if (hasConstruction) {
      const donePct = Math.round(
        (1 - building.constructionTicksRemaining / Math.max(1, building.constructionTicksTotal)) *
          100,
      );
      this.constrTextEl.textContent = `Stavba aktuálního kusu: ${donePct} % (${building.underConstructionCount} ve frontě)`;
    }

    // Unit production section for completed BARRACKS, FACTORY, AIRFIELD
    const producible = building.stackCount > 0 ? getProducibleUnitsForBuilding(building.type) : [];
    this.unitSectionEl.classList.toggle('hidden', producible.length === 0);
    if (producible.length > 0) {
      const unitMenuKey = `${building.id}|${building.type}|${building.stackCount}|${building.unitQueue.length}|${Math.floor(funds.money)}|${Math.floor(funds.buildingMaterial)}|${Math.floor(funds.industry)}|${Math.floor(activeMp)}`;
      if (unitMenuKey !== this.lastUnitMenuKey) {
        this.lastUnitMenuKey = unitMenuKey;
        this.unitGridEl.innerHTML = '';
        for (const uType of producible) {
          const uSpec = UNIT_SPECS[uType];
          const canAfford =
            funds.money >= uSpec.cost.money &&
            funds.buildingMaterial >= uSpec.cost.buildingMaterial &&
            funds.industry >= uSpec.cost.industry &&
            activeMp >= uSpec.cost.manpower;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'hud-btn hud-bm-unit-btn';
          btn.disabled = !canAfford;
          btn.title = uSpec.descriptionCs;

          const top = document.createElement('span');
          top.className = 'hud-bm-stack-lbl';
          top.textContent = `+ ${uSpec.nameCs} (${(uSpec.productionTicks / TICK_RATE).toFixed(1)}s)`;

          const sub = document.createElement('span');
          sub.className = 'hud-bm-stack-cost';
          sub.textContent = formatUnitCostText(uType);

          btn.appendChild(top);
          btn.appendChild(sub);
          btn.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || btn.disabled) return;
            e.preventDefault();
            e.stopPropagation();
            if (this.openBuildingId !== null) {
              this.callbacks.onProduceUnit(this.openBuildingId, uType);
            }
          });
          this.unitGridEl.appendChild(btn);
        }
      }

      if (building.unitQueue.length > 0) {
        const head = building.unitQueue[0];
        const pct = Math.round(
          (1 - head.ticksRemaining / Math.max(1, head.ticksTotal)) * 100,
        );
        this.unitQueueEl.classList.remove('hidden');
        this.unitQueueEl.textContent = `Výcvik: ${UNIT_SPECS[head.unitType].nameCs} ${pct} % (ve frontě ${building.unitQueue.length})`;
      } else if (building.type === 'AIRFIELD' && building.paradropCooldownTicks > 0) {
        this.unitQueueEl.classList.remove('hidden');
        this.unitQueueEl.textContent = `Cooldown výsadku: ${(building.paradropCooldownTicks / TICK_RATE).toFixed(1)} s`;
      } else {
        this.unitQueueEl.classList.add('hidden');
      }
    }

    const room = Math.max(
      0,
      MAX_STACK_PER_NODE - (building.stackCount + building.underConstructionCount),
    );
    const scaledCount = countPlayerUnitsOfType(state.buildings, state.humanPlayerId, building.type);

    for (const ref of this.stackButtons) {
      const quote = computeBatchQuote(
        building.type,
        scaledCount,
        freeUsed,
        ref.batch,
        room,
        funds,
      );
      const canAfford =
        room > 0 &&
        quote.unitsToBuild > 0 &&
        funds.money >= quote.totalCost.money &&
        funds.buildingMaterial >= quote.totalCost.buildingMaterial &&
        funds.industry >= quote.totalCost.industry;

      ref.labelEl.textContent =
        ref.batch === 'MAX' ? `+${quote.unitsToBuild}× MAX` : `+${Math.min(ref.batch, Math.max(1, room))}×`;
      ref.costEl.textContent =
        room <= 0
          ? 'Plný'
          : formatCostText(quote.totalCost, quote.usesFreePowerPlant);
      ref.button.disabled = !canAfford;
    }

    const totalUnits = building.stackCount + building.underConstructionCount;
    const removable = building.isCapital ? Math.max(0, totalUnits - 1) : totalUnits;
    const paidUnits = building.isCapital ? Math.max(0, totalUnits - 1) : totalUnits;
    const oneRatio = paidUnits > 0 ? 1 / paidUnits : 0;
    const oneRefundMoney = Math.floor(
      building.totalInvestedMoney * oneRatio * DEMOLISH_REFUND_RATIO,
    );
    const oneRefundMat = Math.floor(
      building.totalInvestedMaterial * oneRatio * DEMOLISH_REFUND_RATIO,
    );
    const oneRefundInd = Math.floor(
      building.totalInvestedIndustry * oneRatio * DEMOLISH_REFUND_RATIO,
    );

    this.demolishOneBtn.disabled = removable <= 0;
    this.demolishOneBtn.textContent =
      removable <= 0
        ? 'Hl. město nelze zbourat'
        : `Demontovat 1× (+${oneRefundMoney}$${oneRefundMat > 0 ? ` +${oneRefundMat}M` : ''}${oneRefundInd > 0 ? ` +${oneRefundInd}P` : ''})`;

    this.demolishAllBtn.classList.toggle('hidden', removable <= 1);
    this.demolishAllBtn.textContent = building.isCapital
      ? `Demontovat přístavby (${removable}×)`
      : `Zbourat uzel (${removable}×)`;
  }
}
