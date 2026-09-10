import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { lockedOwners } from '@endora-commerce/cli/lib/switchable-modules.js';
import { activationDeclarationsFrom } from '@endora-commerce/platform/composition';
import { requiredModulesFrom } from '@endora-commerce/platform/composition';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * The ordering constraint of feature 074, turned into a standing invariant —
 * FR-047, FR-048.
 *
 * Three modules are **hubs**: dozens of manifests name them in `dependencies`
 * for a capability the kernel has served since D-32, and until Phase 1 those
 * declarations were the only thing refusing an operator's deactivation. The
 * refusal was accidental — it came from what other modules wrote about
 * themselves — and a later commit whose message says "hygiene" deletes those
 * lines. The moment the last one naming `settings` goes, `settings.enabled`
 * becomes a live control with nothing in front of it: a two-click platform
 * outage.
 *
 * Phase 1 replaces the accidental guard with a declared one, and this file is
 * what stops the replacement from being undone by merge order. It does not
 * assert that the residue still exists — it will not, once Phase 3 lands.
 * It asserts the property that has to hold **before and after** that deletion:
 * every core module's refusal comes from its own manifest, so deleting every
 * `dependencies` edge that names it changes nothing an operator can reach.
 *
 * It is deliberately a second file rather than a case inside
 * `non-deactivatable-set.test.ts`. The two ask different questions — that one
 * asks "is the classification right?", this one asks "can the classification be
 * undone by a commit that never mentions it?" — and a reviewer who breaks the
 * ordering should see a file name that says so.
 */

/**
 * The three hubs, with the residue counts measured on `origin/master` at
 * `049e5560` (D-44 F1/F2). The counts are documentation: nothing below reads
 * them, because a test that asserted them would fail on the very commit it
 * exists to protect.
 */
const HUBS = ['settings', 'sales_channels', 'audit_logs'] as const;

const manifests: readonly ModuleManifest[] = REGISTERED_MANIFESTS.map((entry) => entry.manifest);

const coreIds = manifests
  .filter((m) => m.activation !== undefined && 'nonDeactivatable' in m.activation)
  .map((m) => m.id)
  .sort();

/**
 * The Phase 3 commit, simulated: every `dependencies` entry naming a hub is
 * removed. Nothing else changes, and no other array is touched — the 44
 * unbacked edges that are not residue stay where they are (FR-052).
 */
function withHubEdgesDeleted(): ModuleManifest[] {
  return manifests.map((m) => ({
    ...m,
    dependencies: m.dependencies.filter(
      (dependency) => !(HUBS as readonly string[]).includes(dependency),
    ),
  }));
}

describe('the core locks survive the residue deletion (FR-047, FR-048)', () => {
  it.each(HUBS)('%s carries a lock of its own, not one its dependents lend it', (hub) => {
    const declaration = activationDeclarationsFrom(manifests).find((d) => d.moduleId === hub);
    expect(declaration, `${hub} declares no activation block`).toBeDefined();
    // `settingCode === null` is the shape `assertActivationWritable` refuses on
    // before it consults any graph, and `assertDeactivatable` refuses on for the
    // platform axis. Neither reads a dependent.
    expect(declaration!.settingCode, `${hub} still has a live operator control`).toBeNull();
    expect(declaration!.nonDeactivatableReason ?? '').not.toBe('');
  });

  it('every core module stays locked once every hub edge is deleted', () => {
    const after = activationDeclarationsFrom(withHubEdgesDeleted());
    const stillLocked = after
      .filter((declaration) => declaration.settingCode === null)
      .map((declaration) => declaration.moduleId)
      .sort();
    expect(stillLocked).toEqual(coreIds);
  });

  /**
   * The vacuity guard, and it is **derived** (D-100).
   *
   * It read `expect(coreIds.length).toBe(23)` — a count of a derived fact
   * written into an assertion, in a file whose whole subject is derivation. The
   * ruling it cited names no number: `requiredModulesFrom`'s own header says the
   * required set is *"derived, never written down ... so an owner who withdraws
   * a lock changes this refusal in the same run, with no list to edit"*, and the
   * same sentence holds for an owner who **adds** one. Feature 089 added
   * `pim_connector` and this file went red for a tree that was entirely correct,
   * pointing a reader at the ordering hazard when nothing had been reordered.
   *
   * What the guard is actually for is stated in its old comment and survives
   * intact: the two cases above pass on an empty core set, which is the state
   * the ordering hazard produces. So the floor is *non-emptiness plus the hubs*,
   * and the sharpness a literal was standing in for comes from **agreement**
   * instead — three readers of the same manifests, written for three different
   * questions and living in three packages:
   *
   *   - `activationDeclarationsFrom` (the resolver's `settingCode === null`),
   *     which cases 1 and 2 above already exercise;
   *   - `requiredModulesFrom` (`@endora-commerce/platform`), the refusal that
   *     stops a composition reaching its boot phase without the module;
   *   - `lockedOwners` (`@endora-commerce/cli`), which the static-check estate
   *     asks before it exempts a boot hook or reads a `catch` as `OWNER LOCKED`.
   *
   * They are not a restatement of one another as *code* — the third tests
   * `activation?.nonDeactivatable === true` where the other two test for the
   * key's presence — but they are held to agree rather than to differ, because
   * `defineModuleManifest` refuses the one input that would split them
   * (`nonDeactivatable: false` carries no `reason` and fails
   * `assertActivationRules`). What the agreement buys is that a future edit to
   * any one of the three, or a lock withdrawn from a manifest, is red here
   * whatever the size of the set — measured, by making `settings` switchable in
   * the artefact the index imports: two of the five cases go red, this one
   * among them.
   */
  it('is not vacuous, and the three readers of the lock agree', () => {
    expect(coreIds.length).toBeGreaterThan(0);
    for (const hub of HUBS) expect(coreIds).toContain(hub);

    const required = requiredModulesFrom(manifests)
      .map((entry) => entry.moduleId)
      .sort();
    expect(required, 'the platform composes a different locked set than the resolver').toEqual(
      coreIds,
    );

    const locked = [...lockedOwners(manifests)].sort();
    expect(locked, 'the check estate reads a different locked set than the platform').toEqual(
      coreIds,
    );
  });
});
