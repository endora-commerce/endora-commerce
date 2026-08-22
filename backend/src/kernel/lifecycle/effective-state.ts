import type { ModulePresence, RegistryState } from '@endora-commerce/contracts';
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
  /**
   * Issue #225 — the generation of the presence every read above answers from.
   * It changes when a refresh installs presence that differs from the presence
   * before it, and it is what a consumer caching a projection of presence
   * compares against so its cache cannot outlive the refresh that followed the
   * state change it was rebuilt for.
   */
  presenceVersion(): number;
  /**
   * The module whose activation control is stored under `settingCode`, or
   * `undefined` when the code is an ordinary setting. The settings write path
   * asks this so an activation code cannot be flipped through the generic
   * screen, bypassing the audited Command (FR-009).
   */
  activationControlOwner(settingCode: string): string | undefined;
  /** The Setting that holds `moduleId`'s activation, if it declares one. */
  activationSettingCode(moduleId: string): string | null;
  /**
   * Tri-state presence, for the callers that must tell "this module is absent"
   * from "this is not a module at all".
   *
   * `isPresent` collapses both into `false`, which is right for a gating seam:
   * an unknown id gets nothing. It is wrong for a caller that classifies
   * *existing rows* by their owner — a `settings` row may be owned by a
   * hand-created group or by a string that was never a module id, and locking
   * those rows as "belonging to a switched-off module" would take an operator's
   * configuration away for a module that does not exist.
   */
  presenceOf(moduleId: string): boolean | undefined;
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

  presenceVersion(): number {
    return this.cache.presenceVersion();
  }

  activationControlOwner(settingCode: string): string | undefined {
    return this.cache.activationDeclarationByCode(settingCode)?.moduleId;
  }

  activationSettingCode(moduleId: string): string | null {
    return this.cache.activationDeclaration(moduleId)?.settingCode ?? null;
  }

  presenceOf(moduleId: string): boolean | undefined {
    const presence = this.presence(moduleId);
    if (!presence) return undefined;
    return presence.platformAvailable && presence.operatorActivated;
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

/**
 * The wire projection of one module's presence.
 *
 * It lives here rather than beside the `/admin/module-presence` handler because
 * a second surface now reports a module's presence as the reason something else
 * is unavailable — the payment-method admin list, issue #96 — and two copies of
 * this mapping are two ways for "off" to mean different things on two screens.
 */
export function toModulePresenceDto(state: ModulePresenceState): ModulePresence {
  return {
    id: state.moduleId,
    present: state.platformAvailable && state.operatorActivated,
    platformState: state.platformState,
    activated: state.operatorActivated,
    deactivatable: state.deactivatable,
    nonDeactivatableReason: state.nonDeactivatableReason,
  };
}

/** Process singleton read by the four lifecycle wrappers. */
export const effectiveState = new ModuleEffectiveState(registryCache);
