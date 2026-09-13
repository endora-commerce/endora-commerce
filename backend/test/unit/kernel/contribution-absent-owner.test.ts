import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '@endora-commerce/platform/events';
import {
  composeModules,
  createRootContainer,
  registerValues,
} from '@endora-commerce/platform/composition';

// `inventory`'s warehouse reconcile is a *work* hook that reads its own tables.
// It is not this file's subject and it has a proof of its own
// (`test/unit/inventory/boot-reconcile-presence.test.ts`), so it is stubbed
// away rather than handed a fake EntityManager that would grow a method per
// query.
vi.mock(
  '../../../../packages/modules/inventory/src/backend/services/warehouse-channel-reconciler.js',
  () => ({
    WarehouseChannelReconciler: class {
      run = async (): Promise<void> => undefined;
    },
  }),
);

import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { registerModule as registerCatalog } from '../../../../packages/modules/catalog/src/backend/index.js';
import { registerModule as registerInventory } from '../../../../packages/modules/inventory/src/backend/index.js';
// `orders` is named by its **published** specifier, not by a path into its
// source, and `check:singleton-identity` is what says so: `Order` is a
// `@TransitivelyScoped` parent that `Invoice` names, the platform resolves a
// tenant chain by class *name*, and a second class of that name is an ambiguity
// `assertTransitiveParentsResolve` refuses at ORM init — which would fail every
// file in the process rather than this one.
import { registerModule as registerOrders } from '@endora-commerce/mod-orders/backend';

/**
 * **A contribution to a registry that was never registered is dropped**
 * (owner ruling, 2026-09-12; feature 117, A4).
 *
 * ## What this file is the standing instrument for
 *
 * `backend/acceptance/instance-expected-state.json`'s A4 measured a scaffolded
 * instance migrating 118 migrations and then dying on boot with
 * `ModuleCompositionError: [kernel] module 'catalog' failed in its boot hook:
 * Could not resolve 'promptActionToolRegistry'`.
 *
 * The finding is about the **declaration** rather than about that hook. A
 * module's `dependencies` guarantee the owner is installed — `endora new
 * instance` writes the modules declaring `activation.nonDeactivatable` closed
 * over that array and over **nothing else** — and `contributes-to`
 * deliberately withdraws the guarantee, which is its whole purpose, since
 * declaring `prompt_actions` as a dependency would make an optional assistant
 * undeactivatable for as long as `catalog` and `orders` are present.
 *
 * The deactivation-consequence ledger's four answers are all about an owner an
 * **operator switched off**. There is no answer for an owner an **instance
 * never installed**, and in this repository — where every module is always
 * composed — the difference could not arise until an instance executed it.
 *
 * ## What is asserted, and what is deliberately not
 *
 * The repair is a **platform mechanism**, not a guard in a module, so this file
 * asserts the property against the modules' **unmodified** sources: not one of
 * the three contributors has a line about composition membership in it, and a
 * fourth contributor gets the same answer without writing one. That is the
 * ruling — a module contributes to another module's registry without knowing
 * whether that registry exists in this composition.
 *
 * ## The population is derived, and the coverage is two-way
 *
 * The edges come off the registered manifests on every run, so a fourth
 * `contributes-to` edge is judged by existing (D-100). The coverage table is
 * reconciled both ways: an edge with no composition here fails, and a
 * composition for a contributor no manifest declares fails in the same sweep.
 *
 * ## Both directions of each edge, deliberately
 *
 * A mechanism that dropped the contribution unconditionally would satisfy the
 * absent case and silently empty the assistant's tool catalogue everywhere
 * else. So each contributor is composed twice: once with the owner's names
 * withheld, where the boot must survive and nothing may be pushed, and once
 * with them present, where the contribution must actually arrive.
 *
 * Deliberately a unit test: no database, no Redis, no Meilisearch.
 */

/** One `contributes-to` edge, as the manifests declare it. */
interface ContributionEdge {
  readonly contributor: string;
  readonly owner: string;
  readonly name: string;
}

const DECLARED_EDGES: readonly ContributionEdge[] = REGISTERED_MANIFESTS.flatMap((entry) =>
  (entry.manifest.nonBindingDependencies ?? [])
    .filter((edge) => edge.kind === 'contributes-to')
    .map((edge) => ({
      contributor: entry.manifest.id,
      owner: edge.moduleId,
      name: edge.name,
    })),
);

/**
 * Presence is loaded for every registered module, so a hook that probes it —
 * `inventory`'s warehouse reconcile is one — reaches its own work rather than
 * `ModulePresenceNotLoadedError`. This file's subject is the *availability*
 * axis, so the *activation* axis is pinned wide open: every finding below is
 * then about a name that is not in the composition, never about a module the
 * fixture happened to switch off.
 */
registryCache.__setEnabledForTesting(REGISTERED_MANIFESTS.map((entry) => entry.manifest.id));

const keyOf = (edge: ContributionEdge): string =>
  `${edge.contributor} -> ${edge.owner}:${edge.name}`;

/**
 * What one composition observed.
 *
 * `contributed` is the count the *sink* saw, so "the push was dropped" and "the
 * push happened" are distinguishable: only the first is a correct answer to an
 * absent owner, and only the second to a present one.
 */
interface Composition {
  readonly runBootHooks: () => Promise<void>;
  readonly contributed: () => number;
}

function compose(
  moduleId: string,
  registerModule: (ctx: never) => void,
  ownerNames: readonly string[],
  withOwner: boolean,
  extraValues: Record<string, unknown> = {},
): Composition {
  const container = createRootContainer();
  let contributed = 0;
  const sink = {
    register: (): void => {
      contributed += 1;
    },
  };
  registerValues(container, {
    emFactory: (): EntityManager => ({}) as EntityManager,
    eventBus: new EventBus(),
    auditLogService: {},
    redis: {},
    ...extraValues,
    // Withholding the name is what an instance that never installed the owner
    // looks like. Registering it as `undefined` would be a different
    // composition altogether — the name would be *registered*, and the
    // mechanism correctly leaves a registered name alone.
    ...(withOwner ? Object.fromEntries(ownerNames.map((name) => [name, sink])) : {}),
  });
  const composed = composeModules(
    [{ id: moduleId, version: '1.0.0', registerModule: registerModule as never }],
    {
      container,
      eventBus: new EventBus(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    },
  );
  return { runBootHooks: () => composed.runBootHooks(), contributed: () => contributed };
}

/**
 * One composer per contributor.
 *
 * The names are grouped by **contributor** rather than per edge, because a
 * module's boot hooks all run in one `runBootHooks()`: withholding one of
 * `catalog`'s two `prompt_actions` sinks while supplying the other would
 * compose a state no instance is ever in.
 *
 * Every `extraValues` name below is owned by a module the contributor declares
 * in `dependencies`, so an instance always has it — they are supplied here to
 * keep the edge under test the only variable.
 */
const COMPOSERS: Readonly<
  Record<string, (withOwner: boolean, ownerNames: readonly string[]) => Composition>
> = {
  catalog: (withOwner, ownerNames) =>
    compose('catalog', registerCatalog, ownerNames, withOwner, {
      assetReferenceRegistry: { register: () => {} },
      salesChannelMembershipPort: {},
      salesChannelBridgeRegistry: { register: () => {} },
      auditReferenceRegistry: { register: () => {} },
    }),
  orders: (withOwner, ownerNames) =>
    compose('orders', registerOrders, ownerNames, withOwner, {
      emailDefaultsPort: { register: () => {} },
      salesChannelAttributionRegistry: { register: () => {} },
    }),
  inventory: (withOwner, ownerNames) =>
    compose('inventory', registerInventory, ownerNames, withOwner, {
      countryReferenceRegistry: { register: () => {} },
      auditReferenceRegistry: { register: () => {} },
      emailDefaultsPort: { register: () => {} },
    }),
};

const BY_CONTRIBUTOR = new Map<string, ContributionEdge[]>();
for (const edge of DECLARED_EDGES) {
  const existing = BY_CONTRIBUTOR.get(edge.contributor);
  if (existing === undefined) BY_CONTRIBUTOR.set(edge.contributor, [edge]);
  else existing.push(edge);
}

afterEach(() => {
  registryCache.__setEnabledForTesting(REGISTERED_MANIFESTS.map((entry) => entry.manifest.id));
});

describe('a contributes-to push survives an absent owner (feature 117, A4)', () => {
  it('reads a non-empty population off the registered manifests', () => {
    // The refusal a vacuous pass would need: with no edge derived, every
    // assertion below is over an empty table and this file reports a cheerful
    // green about nothing (issue #113).
    expect(
      DECLARED_EDGES.length,
      'no manifest declares a `contributes-to` edge — this file is judging nothing',
    ).toBeGreaterThan(0);
  });

  it('covers every declared edge, and covers no edge nobody declares', () => {
    expect(
      Object.keys(COMPOSERS).sort(),
      'a contributes-to edge with no composition here is an edge nothing proves survives an ' +
        'absent owner; a composition for a contributor no manifest declares is stale',
    ).toEqual([...BY_CONTRIBUTOR.keys()].sort());
  });

  for (const [contributor, edges] of BY_CONTRIBUTOR) {
    const ownerNames = edges.map((edge) => edge.name);
    const description = edges.map(keyOf).join(', ');

    it(`boots with the owner absent: ${description}`, async () => {
      const composer = COMPOSERS[contributor];
      expect(composer, `no composition for '${contributor}'`).toBeDefined();
      const composition = composer!(false, ownerNames);

      // The defect, stated as the assertion: this threw
      // `Could not resolve '<name>'`, `runBootHooks` re-threw it as
      // `ModuleCompositionError`, and `index.ts` turned that into exit 1
      // before the health route existed.
      await expect(composition.runBootHooks()).resolves.toBeUndefined();
      expect(
        composition.contributed(),
        'a contribution with no registry to receive it is dropped, not delivered somewhere else',
      ).toBe(0);
    });

    it(`still contributes when the owner is composed: ${description}`, async () => {
      const composition = COMPOSERS[contributor]!(true, ownerNames);
      await composition.runBootHooks();

      // The other direction, and the reason it is here: a mechanism that
      // dropped unconditionally passes the test above and silently empties the
      // tool catalogue in every complete composition.
      expect(
        composition.contributed(),
        'the contribution must still arrive when its owner is part of the composition',
      ).toBeGreaterThan(0);
    });
  }
});
