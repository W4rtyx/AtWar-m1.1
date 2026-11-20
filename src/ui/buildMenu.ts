import {
  BUILDING_SPECS,
  computeBatchQuote,
  countPlayerUnitsOfType,
} from '../engine/buildings';
import { isDefenseBuildingType } from '../engine/defenses';
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
} from '../engine/types';

export interface BuildMenuCallbacks {
  readonly onSelectBuildType: (type: BuildingType | null) => void;
  readonly onBatchSizeChange: (batch: BuildBatchSize) => void;
}

export interface BuildingContextCallbacks {
  readonly onStackBuilding: (buildingId: number, batchSize: BuildBatchSize) => void;
  readonly onDemolishBuilding: (buildingId: number, demolishAll: boolean) => void;
  readonly onInspectBuilding: (buildingId: number) => void;
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

/** Compact bottom-left building palette with batch selector (1x/5x/10x/MAX) and progressive prices. */
export class BuildMenuController {
  private readonly panelEl: HTMLElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly callbacks: BuildMenuCallbacks;
  private readonly buttons: BuildButtonRef[] = [];
  private readonly batchButtons: BatchButtonRef[] = [];

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
    titleEl.textContent = 'Stavba a stackování';
    titleGroup.appendChild(titleEl);

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
    headerEl.appendChild(titleGroup);

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
    headerEl.appendChild(this.cancelBtn);
    this.panelEl.appendChild(headerEl);

    const gridEl = document.createElement('div');
    gridEl.className = 'hud-build-grid';

    ALL_BUILDING_TYPES.forEach((bType, idx) => {
      const spec = BUILDING_SPECS[bType];
      const hotkeyLabel = idx < 9 ? String(idx + 1) : idx === 9 ? '0' : '-';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isDefenseBuildingType(bType)
        ? 'hud-btn hud-build-btn hud-build-btn-defense'
        : 'hud-btn hud-build-btn';
      btn.title = `${spec.nameCs} [${hotkeyLabel}] — ${spec.descriptionCs} Kliknutím na existující stejný uzel stackujete.`;

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

      gridEl.appendChild(btn);
      this.buttons.push({ type: bType, button: btn, countEl, costEl });
    });

    this.panelEl.appendChild(gridEl);

    this.panelEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
  }

  public getPanelElement(): HTMLElement {
    return this.panelEl;
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

    const ownedCompleted = new Map<BuildingType, number>();
    const ownedQueued = new Map<BuildingType, number>();
    for (const b of state.buildings) {
      ownedCompleted.set(b.type, (ownedCompleted.get(b.type) ?? 0) + b.stackCount);
      ownedQueued.set(b.type, (ownedQueued.get(b.type) ?? 0) + b.underConstructionCount);
    }

    for (const ref of this.buttons) {
      const doneCount = ownedCompleted.get(ref.type) ?? 0;
      const queuedCount = ownedQueued.get(ref.type) ?? 0;
      ref.countEl.textContent =
        queuedCount > 0 ? `(${doneCount} +${queuedCount})` : `(${doneCount})`;
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

interface StackActionButtonRef {
  readonly batch: BuildBatchSize;
  readonly button: HTMLButtonElement;
  readonly labelEl: HTMLElement;
  readonly costEl: HTMLElement;
}

/**
 * Right-click building context menu for stacking additional structures (1x/5x/10x/MAX),
 * checking construction status / revealed efficiency, and demolishing with 50% refund.
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
  private readonly stackButtons: StackActionButtonRef[] = [];
  private readonly demolishOneBtn: HTMLButtonElement;
  private readonly demolishAllBtn: HTMLButtonElement;

  private openBuildingId: number | null = null;
  private posX = 0;
  private posY = 0;

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
    this.posX = Math.max(12, Math.min(window.innerWidth - 266, screenX));
    this.posY = Math.max(54, Math.min(window.innerHeight - 290, screenY));
    this.popoverEl.style.left = `${this.posX}px`;
    this.popoverEl.style.top = `${this.posY}px`;
  }

  public close(): void {
    this.openBuildingId = null;
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
      (b) => b.id === this.openBuildingId,
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
