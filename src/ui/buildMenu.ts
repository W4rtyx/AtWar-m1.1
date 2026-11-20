import { BUILDING_SPECS, getEffectiveBuildingCost } from '../engine/buildings';
import {
  ALL_BUILDING_TYPES,
  BuildingCost,
  BuildingType,
  ClientRenderState,
  PublicPlayerInfo,
} from '../engine/types';

export interface BuildMenuCallbacks {
  readonly onSelectBuildType: (type: BuildingType | null) => void;
}

function formatCostText(cost: BuildingCost, isFreePowerPlant: boolean): string {
  if (isFreePowerPlant) {
    return 'ZDARMA (1.)';
  }
  const parts: string[] = [];
  if (cost.money > 0) parts.push(`${cost.money}$`);
  if (cost.buildingMaterial > 0) parts.push(`${cost.buildingMaterial}M`);
  if (cost.industry > 0) parts.push(`${cost.industry}P`);
  return parts.join(' · ');
}

interface BuildButtonRef {
  readonly type: BuildingType;
  readonly button: HTMLButtonElement;
  readonly costEl: HTMLElement;
}

/** Compact bottom-left building palette allowing selection of physical map buildings. */
export class BuildMenuController {
  private readonly panelEl: HTMLElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly callbacks: BuildMenuCallbacks;
  private readonly buttons: BuildButtonRef[] = [];

  public constructor(callbacks: BuildMenuCallbacks) {
    this.callbacks = callbacks;

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'hud-panel hud-build-bar hidden';

    const headerEl = document.createElement('div');
    headerEl.className = 'hud-build-header';
    const titleEl = document.createElement('span');
    titleEl.className = 'hud-build-title';
    titleEl.textContent = 'Stavba budov';
    headerEl.appendChild(titleEl);

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
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-btn hud-build-btn';
      btn.title = `${spec.nameCs} [${idx + 1}] — ${spec.descriptionCs}`;

      const topRow = document.createElement('span');
      topRow.className = 'hud-build-btn-top';

      const keyBadge = document.createElement('span');
      keyBadge.className = 'hud-build-hotkey';
      keyBadge.textContent = String(idx + 1);

      const nameEl = document.createElement('span');
      nameEl.className = 'hud-build-name';
      nameEl.textContent = spec.nameCs;

      topRow.appendChild(keyBadge);
      topRow.appendChild(nameEl);

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
      this.buttons.push({ type: bType, button: btn, costEl });
    });

    this.panelEl.appendChild(gridEl);

    this.panelEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
  }

  public getPanelElement(): HTMLElement {
    return this.panelEl;
  }

  public update(state: ClientRenderState, selectedBuildType: BuildingType | null): void {
    const isPlaying = state.phase === 'PLAYING';
    this.panelEl.classList.toggle('hidden', !isPlaying);
    if (!isPlaying) return;

    const human: PublicPlayerInfo | undefined = state.players.find(
      (p) => p.id === state.humanPlayerId,
    );
    const money = human?.money ?? 0;
    const mat = human?.buildingMaterial ?? 0;
    const ind = human?.industry ?? 0;
    const freeUsed = human?.freePowerPlantUsed ?? false;

    this.cancelBtn.classList.toggle('hidden', selectedBuildType === null);

    for (const ref of this.buttons) {
      const isFreePowerPlant = ref.type === 'POWER_PLANT' && !freeUsed;
      const cost = getEffectiveBuildingCost(ref.type, freeUsed);
      const affordable =
        money >= cost.money && mat >= cost.buildingMaterial && ind >= cost.industry;

      ref.costEl.textContent = formatCostText(cost, isFreePowerPlant);
      ref.costEl.classList.toggle('free-bonus', isFreePowerPlant);
      ref.button.classList.toggle('active', selectedBuildType === ref.type);
      ref.button.classList.toggle('unaffordable', !affordable);
    }
  }
}
