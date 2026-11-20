import { PlayerState } from './types';

export const BASE_ENERGY_RESERVE_CAPACITY = 1500;
export const ENERGY_RESERVE_PER_POWER_PLANT = 2500;
export const BLACKOUT_RAMP_PER_SEC = 0.09;
export const BLACKOUT_RECOVERY_PER_SEC = 0.14;
export const BLACKOUT_MAX_MP_PENALTY = 0.45;
export const BLACKOUT_COMBAT_PENALTY = 0.38;
export const BLACKOUT_MP_DRAIN_RATIO_PER_SEC = 0.025;

export interface EnergyGridStepParams {
  readonly currentReserve: number;
  readonly currentSeverity: number;
  readonly energyProd: number;
  readonly energyCons: number;
  readonly completedPowerPlantUnits: number;
  readonly applyTickGrowth: boolean;
  readonly dtSec: number;
}

export interface EnergyGridStepResult {
  readonly energyReserve: number;
  readonly energyReserveMax: number;
  readonly energyNetPerSec: number;
  readonly energySupplyRatio: number;
  readonly blackoutActive: boolean;
  readonly blackoutSeverity: number;
  readonly maxManpowerMultiplier: number;
  readonly combatEfficiencyMultiplier: number;
}

/** Computes total energy reserve ceiling from base grid storage plus completed power plants. */
export function computeEnergyReserveMax(completedPowerPlantUnits: number): number {
  return (
    BASE_ENERGY_RESERVE_CAPACITY +
    Math.max(0, completedPowerPlantUnits) * ENERGY_RESERVE_PER_POWER_PLANT
  );
}

/**
 * Evaluates grid reserve clamping, progressive cascading blackout ramp on empty deficit,
 * and smooth grid recovery once positive balance or stored reserve returns.
 */
export function stepEnergyGrid(params: EnergyGridStepParams): EnergyGridStepResult {
  const energyReserveMax = computeEnergyReserveMax(params.completedPowerPlantUnits);
  const energyNetPerSec = params.energyProd - params.energyCons;
  const nextReserve = params.applyTickGrowth
    ? Math.max(0, Math.min(energyReserveMax, params.currentReserve + energyNetPerSec * params.dtSec))
    : Math.max(0, Math.min(energyReserveMax, params.currentReserve));

  const blackoutActive = nextReserve <= 0 && energyNetPerSec < -1e-6;

  let nextSeverity: number;
  if (params.applyTickGrowth) {
    if (blackoutActive) {
      const deficitRatio = Math.min(1, -energyNetPerSec / Math.max(1, params.energyCons));
      nextSeverity = Math.min(
        1,
        params.currentSeverity +
          BLACKOUT_RAMP_PER_SEC * (0.55 + 0.45 * deficitRatio) * params.dtSec,
      );
    } else {
      nextSeverity = Math.max(0, params.currentSeverity - BLACKOUT_RECOVERY_PER_SEC * params.dtSec);
    }
  } else {
    nextSeverity = Math.max(0, Math.min(1, params.currentSeverity));
  }

  let energySupplyRatio: number;
  if (!blackoutActive && nextSeverity <= 0) {
    energySupplyRatio = 1;
  } else {
    const rawCoverage = Math.min(1, params.energyProd / Math.max(0.01, params.energyCons));
    const floorRatio = blackoutActive
      ? Math.max(0.15, Math.min(0.6, rawCoverage * 0.7))
      : 0.35;
    energySupplyRatio = Math.max(floorRatio, 1 - nextSeverity * (1 - floorRatio));
  }

  const maxManpowerMultiplier = 1 - BLACKOUT_MAX_MP_PENALTY * nextSeverity;
  const combatEfficiencyMultiplier = 1 - BLACKOUT_COMBAT_PENALTY * nextSeverity;

  return {
    energyReserve: nextReserve,
    energyReserveMax,
    energyNetPerSec,
    energySupplyRatio,
    blackoutActive,
    blackoutSeverity: nextSeverity,
    maxManpowerMultiplier,
    combatEfficiencyMultiplier,
  };
}

/** Returns blackout-adjusted combat efficiency multiplier (0.62..1.0) for offense and defense. */
export function getCombatBlackoutMultiplier(player: PlayerState | undefined): number {
  if (!player) return 1;
  return Math.max(
    1 - BLACKOUT_COMBAT_PENALTY,
    1 - BLACKOUT_COMBAT_PENALTY * player.blackoutSeverity,
  );
}
