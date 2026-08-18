import { describe, expect, it } from 'vitest';
import { publishesInterface } from '../../helpers/published-port-source.js';
import { PLATFORM_OWNED_NAMES } from '../../../scripts/check-port-dependencies.js';

/**
 * D-98.5 — which modules a deployment ships is a composition-root input, so
 * there is no `_lifecycle` port over the manifests.
 *
 * The decisive fact is an ordering one: the root builds the resolved registry
 * before module presence is loaded and passes it *into* the lifecycle
 * orchestrator, so a `_lifecycle`-owned port over that value would make the
 * orchestrator's own input come out of the orchestrator. `_lifecycle` owns what
 * it adds — the dependency graph, the install hooks, the registry rows, the
 * operator surface — not the list.
 *
 * And the rule the deletion settles, which is the part worth keeping: a module
 * may read the manifest **set** as a root-supplied value, declaring the narrow
 * view it needs; it may not read another module's manifest by id. The published
 * interface offered a `list()` every consumer used and a `get(moduleId)` none
 * did, and the second is how a module reasons about a neighbour with no
 * declared edge, no gate and no ledger row.
 */
describe('module manifests are platform-owned (D-98.5)', () => {
  it('publishes no manifest read port for a module to resolve', () => {
    expect(publishesInterface('modules.ts', 'ModuleManifestReadPort')).toBe(false);
    expect(publishesInterface('modules.ts', 'RegisteredModuleManifest')).toBe(false);
  });

  it('keeps the registry a composition-root input instead', () => {
    expect(PLATFORM_OWNED_NAMES.has('resolvedModuleRegistry')).toBe(true);
  });
});
