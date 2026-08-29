import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { activationDeclarationsFrom } from '../../../src/kernel/lifecycle/activation-resolver.js';
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

  it('is not vacuous — the core set is the 23 the ruling names', () => {
    // Without this the two cases above would pass on an empty core set, which
    // is precisely the state the ordering hazard produces.
    expect(coreIds.length).toBe(23);
    for (const hub of HUBS) expect(coreIds).toContain(hub);
  });
});
