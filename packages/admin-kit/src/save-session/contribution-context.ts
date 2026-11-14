/**
 * Which zone contribution is rendering (feature 180, research R8).
 *
 * `AdminZone` wraps every contribution it renders in this context, carrying the registry
 * entry's `module` — never a declared field (D-142), so a participant cannot register under
 * another module's presence — and the place it rendered. `useSaveParticipant` reads it to build
 * the participant's id (`${module}:${key}`) and to re-check the module's presence while a draft
 * outlives its panel.
 *
 * Outside any `AdminZone` the value is `null`, which is how a **host-owned section** (FR-006) is
 * told apart from a contribution.
 */
import { createContext, useContext } from 'react';
import type { AdminZoneName } from '@endora-commerce/contracts';

import type { PermissionRequirement } from '../lib/surface-visibility.js';

export interface ZoneContributionInfo {
  readonly module: string;
  readonly zone: AdminZoneName;
  /** The contribution's declared weight; zone order is weight, then module id. */
  readonly weight: number;
  readonly requiredPermission?: PermissionRequirement;
}

export const ZoneContributionContext = createContext<ZoneContributionInfo | null>(null);

export function useZoneContribution(): ZoneContributionInfo | null {
  return useContext(ZoneContributionContext);
}

type CrashListener = (crashed: { readonly module: string; readonly zone: string }) => void;

const crashListeners = new Set<CrashListener>();

/**
 * Called by `ZoneErrorBoundary` when a contribution throws. Every live save session drops that
 * contribution's participants, with a notice when one held unsaved changes — the boundary has
 * replaced the panel, so nothing could show or save the draft any more.
 */
export function reportZoneContributionCrash(crashed: { readonly module: string; readonly zone: string }): void {
  for (const listener of crashListeners) listener(crashed);
}

/** @internal — the save-session store's subscription. */
export function onZoneContributionCrash(listener: CrashListener): () => void {
  crashListeners.add(listener);
  return () => {
    crashListeners.delete(listener);
  };
}
