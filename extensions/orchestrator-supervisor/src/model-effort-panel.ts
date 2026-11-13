/**
 * Shared reasoning-effort picker UI and helpers for the Orchestrator and Subagents panels.
 *
 * Implements the second-stage effort selection menu displayed after a model is chosen in
 * a slot picker. Supported efforts are derived exclusively from host-proven capabilities
 * on the candidate; unknown capabilities expose Default only, and the UI never guesses
 * support from model names.
 */

import { MODEL_EFFORTS, type ModelEffort } from './model-effort.ts';

export { MODEL_EFFORTS, type ModelEffort };

export type EffortMenuOption = 'Default' | ModelEffort;

export interface EffortCapableCandidate {
  id: string;
  supportedEfforts?: ModelEffort[];
}

export function resolveEffortMenuOptions(
  candidate: EffortCapableCandidate,
  currentOverride?: ModelEffort,
): { options: EffortMenuOption[]; initialIndex: number } {
  const supported = Array.isArray(candidate.supportedEfforts)
    ? candidate.supportedEfforts
    : [];
  const options: EffortMenuOption[] = ['Default', ...supported];
  let initialIndex = 0;
  if (currentOverride && supported.includes(currentOverride)) {
    const found = options.indexOf(currentOverride);
    if (found >= 0) initialIndex = found;
  }
  return { options, initialIndex };
}

export function computeEffortPatch(
  candidateId: string,
  chosenEffort: EffortMenuOption,
  currentEfforts?: Record<string, ModelEffort>,
): { modelEfforts?: Record<string, ModelEffort> } {
  if (chosenEffort === 'Default') {
    if (currentEfforts && candidateId in currentEfforts) {
      const next = { ...currentEfforts };
      delete next[candidateId];
      return { modelEfforts: next };
    }
    return {};
  }
  return {
    modelEfforts: {
      ...(currentEfforts ?? {}),
      [candidateId]: chosenEffort,
    },
  };
}

export function formatSlotLabel(
  slotNumber: number,
  candidateId: string,
  modelEfforts?: Record<string, ModelEffort>,
): string {
  if (!candidateId) return `${slotNumber}. (vacío)`;
  const effort = modelEfforts?.[candidateId];
  return `${slotNumber}. ${candidateId} [${effort ?? 'Por defecto'}]`;
}

export interface RenderEffortPickerOptions {
  width: number;
  targetSlot: number;
  candidateId: string;
  options: readonly EffortMenuOption[];
  selectedIndex: number;
  style: {
    accent: (text: string) => string;
    bold: (text: string) => string;
    dim: (text: string) => string;
  };
  lib: {
    truncateToWidth: (text: string, width: number, suffix?: string) => string;
    visibleWidth: (text: string) => number;
  };
}

export function renderEffortPicker(options: RenderEffortPickerOptions): string[] {
  const { width, targetSlot, candidateId, options: effortOptions, selectedIndex, style, lib } = options;
  const available = Math.max(1, width);
  const lines: string[] = [];
  const push = (text: string): void => {
    lines.push(lib.truncateToWidth(text, available, '…'));
  };
  const rule = (): void => { push(style.dim('─'.repeat(available))); };

  rule();
  push(style.bold(style.accent(` Elegir nivel de razonamiento: slot ${targetSlot}`)));
  rule();
  push(` > ${candidateId}`);
  rule();

  for (let i = 0; i < effortOptions.length; i++) {
    const isSelected = i === selectedIndex;
    const marker = isSelected ? '→ ' : '  ';
    const label = effortOptions[i] === 'Default' ? 'Por defecto' : effortOptions[i];
    push(`${marker}${label}`);
  }

  rule();
  push(style.dim(' ↑↓/jk mover · enter asignar · esc volver'));
  rule();

  return lines;
}
