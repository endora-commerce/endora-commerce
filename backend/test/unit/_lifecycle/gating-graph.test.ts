import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@b2b/contracts';
import { defineModuleManifest } from '@b2b/contracts';
import {
  ModuleGatingGraph,
  acknowledgedPortEdgesFrom,
  gatingGraph,
  nonBindingPortEdgesFrom,
} from '../../../src/modules/_lifecycle/services/gating-graph.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

/**
 * The graph the flip-time refusals read — feature 073, FR-008, Amendment A1
 * (T045/T046).
 *
 * Every assertion below names **shipped modules**. That is the point of the
 * file: the coverage that existed when `assertActivationWritable` shipped
 * without any dependency refusal at all was fixture-shaped, and fixtures cannot
 * notice that `catalog` resolves a port owned by a module an operator can
 * switch off — the manifests are where that fact lives.
 */

const MANIFESTS = REGISTERED_MANIFESTS.map((entry) => entry.manifest);
const graph = new ModuleGatingGraph(MANIFESTS);

/** Everything present, which is the shipped default state of a deployment. */
const allPresent = (): boolean => true;
const onlyPresent =
  (...ids: string[]) =>
  (id: string): boolean =>
    ids.includes(id);

describe('acknowledgedPortEdgesFrom — the withheld edges, from the manifests', () => {
  it('reads the eight real edges the manifests deliberately keep out of `dependencies`', () => {
    // The last two arrived with issue #90, when `check-port-dependencies`
    // learned to follow a module-local cradle alias and two edges that had
    // always been resolved through one became visible: the lifecycle admin
    // surfaces reaching for `requireAdmin`, and the request hook resolving a
    // signed-in customer's Organization.
    const keys = acknowledgedPortEdgesFrom(MANIFESTS)
      .map((edge) => `${edge.moduleId}:${edge.port}`)
      .sort();
    expect(keys).toEqual([
      '_lifecycle:requireAdmin',
      'auth:customerOrgResolver',
      'catalog:pricingService',
      'organizations:addressService',
      'organizations:customerAuthService',
      'organizations:customerRoleService',
      'organizations:passwordResetService',
      'organizations:totpEnrolmentService',
    ]);
  });

  it('every acknowledged edge names a module that ships', () => {
    const ids = new Set(MANIFESTS.map((manifest) => manifest.id));
    for (const edge of acknowledgedPortEdgesFrom(MANIFESTS)) {
      expect(ids, `${edge.moduleId} acknowledges "${edge.dependsOn}"`).toContain(
        edge.dependsOn,
      );
    }
  });

  it('carries a reason long enough to be an argument rather than a label', () => {
    for (const edge of acknowledgedPortEdgesFrom(MANIFESTS)) {
      expect(edge.reason.length).toBeGreaterThan(30);
    }
  });
});

describe('dependents — the deactivation direction', () => {
  it('names `organizations` among the modules that need `settings`', () => {
    // The live defect this task closes: `organizations` is the tenancy root and
    // non-deactivatable, `settings` was made deactivatable on purpose by D-36,
    // and until now the Admin UI let an operator take the first down by
    // switching off the second.
    expect(graph.dependentsOf('settings')).toContain('organizations');
  });

  it('names `catalog` among the modules that need `price_lists` — the acknowledged edge', () => {
    // The trap. `catalog` is absent from `dependentsOf('price_lists')` in the
    // manifest graph, so a refusal computed from `ModuleDepGraph` alone lets an
    // operator switch the pricing engine off under a live resolver in a core
    // commerce module.
    expect(graph.dependentsOf('price_lists')).toContain('catalog');
    expect(graph.declaredDependenciesOf('catalog')).not.toContain('price_lists');
  });

  it('names `organizations` among the modules that need `addresses` and `customer_accounts`', () => {
    expect(graph.dependentsOf('addresses')).toContain('organizations');
    expect(graph.dependentsOf('customer_accounts')).toContain('organizations');
  });

  it('reports only the dependents that are effectively present', () => {
    // With every manifest dependent of `price_lists` switched off, the one
    // blocker left is the acknowledged one. This is the case a manifest-only
    // implementation gets wrong while still returning a 409 for other reasons.
    const blocking = graph.presentDependentsOf('price_lists', onlyPresent('catalog'));
    expect(blocking).toEqual(['catalog']);
  });

  it('reports nothing for a module nothing depends on', () => {
    expect(graph.presentDependentsOf('pim_ergonode', allPresent)).toEqual([]);
  });
});

describe('dependencies — the activation direction', () => {
  it('ignores acknowledged edges, because they are mutual by construction', () => {
    // `catalog` acknowledges `price_lists`, `price_lists` declares `catalog`.
    // Reading the acknowledged edge here would mean neither can be switched on
    // while the other is off — a pair with no way back.
    expect(graph.absentDependenciesOf('catalog', onlyPresent())).not.toContain(
      'price_lists',
    );
    expect(graph.acknowledgedDependenciesOf('catalog')).toEqual(['price_lists']);
  });

  it('names the declared dependencies that are absent', () => {
    const present = new Set(MANIFESTS.map((manifest) => manifest.id));
    present.delete('price_lists');
    expect(
      graph.absentDependenciesOf('pim_ergonode', (id) => present.has(id)),
    ).toEqual(['price_lists']);
  });

  it('reports nothing when everything the module needs is present', () => {
    expect(graph.absentDependenciesOf('pim_ergonode', allPresent)).toEqual([]);
  });
});

/**
 * D-44 — a `nonBindingDependencies` edge is real to the container and invisible
 * to this graph, in **both** directions.
 *
 * Synthetic manifests rather than shipped ones on purpose: the property is that
 * the graph does not read the field at all, and a fixture pair is the only way
 * to state it without waiting for a module to declare one. The shipped
 * declarations are held to the same property by the last case.
 */
describe('non-binding edges — declared, and absent from both directions', () => {
  const host = defineModuleManifest({
    id: 'assistant',
    name: 'Assistant',
    version: '1.0.0',
    dependencies: [],
  });
  const contributor = defineModuleManifest({
    id: 'shop',
    name: 'Shop',
    version: '1.0.0',
    dependencies: [],
    nonBindingDependencies: [
      {
        moduleId: 'assistant',
        name: 'toolRegistry',
        kind: 'contributes-to',
        reason: 'Pushes an inert tool descriptor into the assistant catalogue at boot.',
      },
    ],
  });
  const fixture = new ModuleGatingGraph([host, contributor]);

  it('flattens the edges the way the port check keys them', () => {
    expect(nonBindingPortEdgesFrom([host, contributor])).toEqual([
      {
        moduleId: 'shop',
        dependsOn: 'assistant',
        name: 'toolRegistry',
        kind: 'contributes-to',
        whenAbsent: null,
        reason: 'Pushes an inert tool descriptor into the assistant catalogue at boot.',
      },
    ]);
  });

  it('does not make the contributor a dependent of the host', () => {
    // The whole point: the host keeps a live activation control. An
    // `acknowledgedDependencies` entry in the same position would appear here.
    expect(fixture.dependentsOf('assistant')).toEqual([]);
    expect(fixture.presentDependentsOf('assistant', allPresent)).toEqual([]);
  });

  it('does not make the host a dependency of the contributor', () => {
    expect(fixture.declaredDependenciesOf('shop')).toEqual([]);
    expect(fixture.acknowledgedDependenciesOf('shop')).toEqual([]);
    expect(fixture.absentDependenciesOf('shop', onlyPresent())).toEqual([]);
  });

  it('leaves every shipped non-binding target out of `dependentsOf`', () => {
    // The shipped half of the same property, so a later edit that folds the
    // field into the constructor fails here rather than in an operator's 409.
    for (const edge of nonBindingPortEdgesFrom(MANIFESTS)) {
      expect(
        graph.dependentsOf(edge.dependsOn),
        `${edge.moduleId} declares ${edge.dependsOn}:${edge.name} as non-binding`,
      ).not.toContain(edge.moduleId);
    }
  });

  it('names a module that ships, and carries an argument rather than a label', () => {
    const ids = new Set(MANIFESTS.map((manifest: ModuleManifest) => manifest.id));
    for (const edge of nonBindingPortEdgesFrom(MANIFESTS)) {
      expect(ids, `${edge.moduleId} → ${edge.dependsOn}`).toContain(edge.dependsOn);
      expect(edge.reason.length).toBeGreaterThan(30);
      if (edge.kind === 'degrades-without') expect(edge.whenAbsent).not.toBeNull();
    }
  });
});

describe('the process singleton', () => {
  it('defaults to the registered core manifests rather than to an empty graph', () => {
    // An empty graph is a refusal that never fires, which is the fall-open this
    // task removes; the default has to know the edges before anything installs
    // a deployment-specific manifest set.
    expect(gatingGraph().dependentsOf('settings')).toContain('organizations');
    expect(gatingGraph().dependentsOf('price_lists')).toContain('catalog');
  });
});
