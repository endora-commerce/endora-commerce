import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ledgerReads,
  providedPortNames,
  registeredNames,
  resolvedNames,
} from '../../../scripts/check-port-dependencies.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';
import {
  buildDeactivationLedger,
  deactivationConsequencesFor,
  type LedgerEntry,
  nonBindingPortEdgesFrom,
} from '@endora-commerce/platform/lifecycle';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Issue #153 — an operator switching `search` off is told that the storefront
 * product listing stops using the index.
 *
 * The other half of the issue, and the half that is about the product rather
 * than about Principle I. `catalog`'s Postgres fallback was already correct
 * before the port landed; what was wrong is that nothing could *say so*. The
 * listing built its own `SearchQueryService` out of `search`'s class, so the
 * container held no cross-module edge between the two — and a
 * `nonBindingDependencies` entry with no resolution under it is rejected by
 * `findNonBindingIssues` as `nothing-resolves`. The declaration was therefore
 * unavailable, and the deactivation-consequence dialog stayed silent about the
 * most visible thing an operator changes by flipping `search` off.
 *
 * So this test walks the whole chain, from the two module sources to the row
 * the operator reads, and every link is the production one:
 *
 *  1. `search/backend.ts` registers `searchQueryPort` with `di.providePort`,
 *     measured by the check's own scanner — that is what makes the edge
 *     **gated**;
 *  2. `catalog/backend.ts` resolves that literal name, measured by the same
 *     scanner — that is the resolution the declaration needs under it, and its
 *     `site` is what keeps it out of the `gated-port-before-first-request`
 *     shape;
 *  3. `buildDeactivationLedger` classifies the two together with the **real**
 *     manifest declarations;
 *  4. `deactivationConsequencesFor` projects that into the dialog row.
 *
 * Nothing is fabricated in between, which is what lets each link fail on its
 * own, and all three were run red before this file was committed: revert step 2
 * to `new SearchQueryService(…)` and there is no row at all — the #153 state;
 * drop the manifest entry and the row flips to `unavailable`, promising a 503
 * the route does not produce; turn the `providePort` into a plain registration
 * and the first case below fails.
 *
 * That last one is why the gate has a case of its own rather than being left to
 * the classification: a declared degrade is assigned *before* the gate is
 * consulted, so an ungated `searchQueryPort` would still read as `degrades`
 * here while answering a switched-off `search` exactly as it answers a live
 * one.
 */

const layout = await requireModuleLayout('[search-degrade-consequence]');

/**
 * A module's `registerModule` source, in **either** layout.
 *
 * The path used to be spelled `src/modules/<id>/backend.ts`, which stops being
 * where a module lives the moment it becomes a package (feature 080, T040b) —
 * and the failure is `ENOENT`, so it is loud rather than silent. The layout is
 * resolved instead, and the two places a workspace member can keep the file are
 * tried in turn, exactly as `check-port-dependencies` itself does.
 */
const MODULE_SOURCE = (moduleId: string): { file: string; source: string } => {
  const dir = layout.moduleDirectoryOf(moduleId);
  if (dir === null) throw new Error(`[search-degrade-consequence] no such module: ${moduleId}`);
  for (const candidate of [join(dir, 'backend.ts'), join(dir, 'src', 'backend', 'index.ts')]) {
    if (existsSync(candidate)) return { file: candidate, source: readFileSync(candidate, 'utf8') };
  }
  throw new Error(
    `[search-degrade-consequence] ${moduleId} has no backend entry point under ${dir}`,
  );
};

const MANIFESTS = REGISTERED_MANIFESTS.map((entry) => entry.manifest);

/** The sentence `catalog`'s manifest promises; asserted rather than restated. */
const DECLARED_SENTENCE = MANIFESTS.find((manifest) => manifest.id === 'catalog')
  ?.nonBindingDependencies?.find(
    (edge) => edge.moduleId === 'search' && edge.name === 'searchQueryPort',
  )?.whenAbsent;

/**
 * The ledger over the one edge under test, built the way
 * `check-port-dependencies.ts` builds the whole tree's.
 */
function ledgerForTheEdge(): { entries: LedgerEntry[]; unassignedCount: number } {
  const catalog = MODULE_SOURCE('catalog');
  const search = MODULE_SOURCE('search');

  // The two maps the check keeps apart, kept apart here for the same reason:
  // ownership says whose module the name belongs to, `providePort` says whether
  // reading it asks a presence gate. Collapsing them would make an ungated
  // registration read as a gated one and hide the shape the third red proof
  // above is about.
  const owners = new Map<string, string>();
  for (const name of registeredNames(search.source, search.file)) {
    owners.set(name, 'search');
  }
  const providedPorts = new Map<string, string>();
  for (const name of providedPortNames(search.source, search.file)) {
    providedPorts.set(name, 'search');
  }

  const reads = ledgerReads({
    resolutions: resolvedNames(catalog.source, catalog.file).filter(
      (resolution) => resolution.name === 'searchQueryPort',
    ),
    seams: [],
    owners,
    providedPorts,
  });

  const ledger = buildDeactivationLedger({
    reads,
    declaredDependencies: new Map(
      MANIFESTS.map((manifest) => [manifest.id, manifest.dependencies ?? []] as const),
    ),
    nonBinding: nonBindingPortEdgesFrom(MANIFESTS),
    // D-101 §5 — acknowledged edges into locked owners are in the population.
    // `search` owns none, so this changes nothing here and says so.
    acknowledged: [],
    neverAbsentOwners: new Set(
      MANIFESTS.filter(
        (manifest) =>
          (manifest.activation as { nonDeactivatable?: boolean } | undefined)
            ?.nonDeactivatable === true,
      ).map((manifest) => manifest.id),
    ),
    contributionPolicies: {},
    excludedNames: new Set(),
  });

  return {
    entries: ledger.entries.filter((entry) => entry.dependsOn === 'search'),
    unassignedCount: ledger.unassigned.length,
  };
}

describe('catalog → search:searchQueryPort — the consequence an operator is shown', () => {
  it('`search` publishes the listing query as a gated port', () => {
    const search = MODULE_SOURCE('search');

    expect(
      providedPortNames(search.source, search.file),
      '`searchQueryPort` must be a `di.providePort` registration — an ungated ' +
        'one answers a switched-off module the same as a live one',
    ).toContain('searchQueryPort');
  });

  it('`catalog` resolves that name, at the point of use, from its own module source', () => {
    const catalog = MODULE_SOURCE('catalog');

    const resolutions = resolvedNames(catalog.source, catalog.file).filter(
      (resolution) => resolution.name === 'searchQueryPort',
    );

    // The `nothing-resolves` premise: without a resolution the declaration
    // below is refused by `findNonBindingIssues`, which is exactly the state
    // issue #153 reported.
    expect(
      resolutions.length,
      '`catalog` resolves nothing from `search`, so the degrade cannot be declared',
    ).toBeGreaterThan(0);
    for (const resolution of resolutions) {
      expect(resolution.kind, 'a captured gate keeps answering after its owner is off').toBe(
        'deferred',
      );
      expect(
        resolution.site,
        'a gate asked before the first request stops the next start, not one request',
      ).toBe('call');
    }
  });

  it('classifies the edge as a degrade carrying `catalog`’s own sentence', () => {
    const { entries, unassignedCount } = ledgerForTheEdge();

    expect(DECLARED_SENTENCE, 'the manifest declares no sentence to show').toBeDefined();
    expect(DECLARED_SENTENCE).toContain('PostgreSQL');
    expect(unassignedCount, 'the edge must answer one of the four outcomes').toBe(0);
    expect(entries).toEqual([
      {
        moduleId: 'catalog',
        dependsOn: 'search',
        name: 'searchQueryPort',
        outcome: 'degrades',
        whenAbsent: DECLARED_SENTENCE,
      },
    ]);
  });

  it('shows the operator a degraded catalogue rather than an unavailable one', () => {
    const { entries } = ledgerForTheEdge();

    const rows = deactivationConsequencesFor(entries, 'search', () => true);

    expect(rows).toEqual([
      {
        moduleId: 'catalog',
        // `unavailable` here would promise a 503 the public listing does not
        // produce — the wrong warning is worse than the silence it replaced.
        effect: 'degraded',
        description: DECLARED_SENTENCE,
      },
    ]);
  });

  it('says nothing about a dependent the deployment does not have', () => {
    // The projection is filtered by presence, so the control is worth stating:
    // an absent `catalog` contributes no row, and a row that appears anyway
    // would mean the dialog is reading the declarations rather than the
    // deployment.
    const { entries } = ledgerForTheEdge();

    expect(deactivationConsequencesFor(entries, 'search', () => false)).toEqual([]);
  });
});
