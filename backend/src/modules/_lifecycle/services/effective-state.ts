import type { RegistryState } from '@b2b/contracts';
import { registryCache, type ModuleRegistryCache } from './registry-cache.js';

/**
 * Effective module state — the conjunction of the two presence axes
 * (Constitution XVII, feature 073, data-model §2.1).
 *
 * Platform availability is owned by whoever operates the deployment and lives
 * in `module_registrations`. Operator activation is owned by the business and
 * lives in a Setting the module declares. A module is present only when both
 * are true, and every gating seam resolves *this* value rather than one axis.
 *
 * This is deliberately the only place the two are combined: no caller — not
 * the four wrappers, not the Admin UI, not the storefront — recombines them,
 * which is what makes "off means absent" one decision instead of several
 * implementations that can disagree.
 */

/** Per-module view of both axes, kept separate because the Admin UI must
 *  render "not installed here" differently from "we turned it off". */
export interface ModulePresenceState {
  readonly moduleId: string;
  readonly platformAvailable: boolean;
  readonly platformState: RegistryState | 'not-installed';
  readonly operatorActivated: boolean;
  readonly deactivatable: boolean;
  readonly nonDeactivatableReason: string | null;
}

export interface EffectiveModuleState {
  /** The hot path. Synchronous, in-memory, called on every gated request. */
  isPresent(moduleId: string): boolean;
  presence(moduleId: string): ModulePresenceState | undefined;
  all(): readonly ModulePresenceState[];
  isDegraded(): boolean;
}

export class ModuleEffectiveState implements EffectiveModuleState {
  constructor(private readonly cache: ModuleRegistryCache) {}

  /**
   * FR-004: no I/O, no await, no database read. Two in-memory lookups.
   *
   * Fail-closed falls out of the conjunction rather than from a special case:
   * a cold cache has an empty platform set, so nothing is present until the
   * first successful refresh.
   */
  isPresent(moduleId: string): boolean {
    return this.cache.isEnabled(moduleId) && this.operatorActivated(moduleId);
  }

  presence(moduleId: string): ModulePresenceState | undefined {
    const declaration = this.cache.activationDeclaration(moduleId);
    const platformState = this.cache.platformStateOf(moduleId);
    // Unknown to both the registry and the manifests ⇒ we say nothing about
    // it. `isPresent` already answers `false` for such an id.
    if (!declaration && platformState === 'not-installed') return undefined;
    return {
      moduleId,
      platformAvailable: this.cache.isEnabled(moduleId),
      platformState,
      operatorActivated: this.operatorActivated(moduleId),
      deactivatable: declaration?.settingCode != null,
      nonDeactivatableReason: declaration?.nonDeactivatableReason ?? null,
    };
  }

  all(): readonly ModulePresenceState[] {
    const states: ModulePresenceState[] = [];
    for (const moduleId of this.cache.knownModuleIds()) {
      const presence = this.presence(moduleId);
      if (presence) states.push(presence);
    }
    return states;
  }

  isDegraded(): boolean {
    return this.cache.isDegraded();
  }

  /**
   * The operator axis, with the two rules that keep it from eating itself:
   *
   *  - a module that declared itself non-deactivatable is activated whatever
   *    is stored, so resolving presence never has to ask "is `settings` on?";
   *  - a module that has declared no control at all cannot be switched off by
   *    an operator, so it is governed by the platform axis alone until its
   *    batch converts it. This is not a fall-open: there is no control to
   *    resolve, and the ratchet fails CI for a converted module that omits one.
   */
  private operatorActivated(moduleId: string): boolean {
    const declaration = this.cache.activationDeclaration(moduleId);
    if (declaration && declaration.settingCode === null) return true;
    const stored = this.cache.activationValue(moduleId);
    if (stored !== undefined) return stored;
    return declaration?.default ?? true;
  }
}

/** Process singleton read by the four lifecycle wrappers. */
export const effectiveState = new ModuleEffectiveState(registryCache);
