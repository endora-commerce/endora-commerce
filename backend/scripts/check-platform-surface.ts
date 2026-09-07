/**
 * CI check — a module reaches only the platform surface the host publishes
 * (D-160.8). **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/platform-surface.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts) — its findings, its specifier spellings, its refusals and its
 * population walks. This file resolves this repository's module walk roots, its
 * application roots, its platform barrels and its floors, and it holds the two
 * ledgers below: a ledger is a statement about *this* tree's debt and does not
 * travel. The forwarding specifier is **bare**, never a path into `dist`.
 *
 * ## Two consumer populations, one rule (feature 115, D115-5)
 *
 * The rule is *a reach into the host names a published subpath or a declared
 * host-internal one, never a file inside the package by relative path*. Until
 * feature 115 it was asked of **modules** only, and the application — which is
 * the consumer that writes 84 such reaches — was outside the population by
 * construction: `layout.moduleIdOfPath` answers `null` for every one of its
 * files, so `violations=0` was honest about a population that did not contain
 * them. `RELATIVE_HOST_REACHES` is that half's ledger and
 * `relative-host-reach` is its finding.
 *
 * It is a second population and not a second check because this file already
 * derives all four inputs a separate script would have to re-derive — where the
 * platform's sources are, the name it publishes under, the subpaths its
 * `exports` map declares, and the barrels — and two derivations of one
 * population are two answers waiting to disagree (D-100). The precedent is one
 * package over: `check:module-boundary`'s predicate 1b walks the admin
 * application outside the module root and attributes a reach out of it to
 * `ADMIN_HOST_OWNER`, with a shard of its own and a coverage floor of its own.
 *
 * **What the application half does not read**, stated rather than discovered
 * later: `backend/test/**`, which is a different population with a different
 * answer and whose reaches drain as a mechanical rewrite; a bare specifier into
 * the host, whatever the subpath, because the host is entitled to the
 * host-internal one and the three-way answer is a *module's* question; and a
 * relative specifier that resolves to no source file inside the platform, which
 * is `tsc`'s question and not this one's.
 *
 * Normative: `specs/115-lifecycle-container-move/contracts/host-reach-check.md`.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  applicationReachRefusal,
  checkApplicationReaches,
  checkPlatformSurface,
  collectPlatformSurfaceSources as walk,
  hostDependentCoverage,
  hostReachCoverage,
  isPackageToolingConfig,
  keyOf,
  platformSurfaceRefusal,
  remedyOf,
  resolveTarget,
  type LedgeredHostReach,
  type LedgeredReach,
  type ModulePackageDeclaration,
} from '@endora-commerce/cli/rules/platform-surface.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import {
  barrelKeyOf,
  publishedSurface,
  PUBLISHED_SUBPATHS,
  type HostPackage,
} from './lib/platform-surface.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { platformSubpathsAt } from './lib/platform-root.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/platform-surface.js';

/**
 * Not a module's file at all.
 *
 * `src/apps/<deployment>/` holds a deployment's divergence declaration and its
 * generated override manifest **beside** its overlay modules, and the walk
 * covers that root whole. The rule is about modules, and a deployment's own
 * files are never packaged (D-104).
 *
 * They are ledgered rather than filtered out on purpose: a filter would make
 * every file the attribution loses invisible, and a *module* file that stopped
 * resolving to its id would hide among them behind a full-length `read:` line
 * — which is #215 one layer in (!879).
 */
const DEPLOYMENT_FILE =
  'a per-deployment file, not a module\'s: `src/apps/<deployment>/` holds the ' +
  'divergence declaration and the generated divergence report beside its overlay ' +
  'modules, and none of them is ever packaged (D-104). Ledgered rather than filtered so a ' +
  'module file the attribution loses cannot hide among them.';

export const UNPUBLISHED_PLATFORM_REACHES: Readonly<Record<string, LedgeredReach>> = {
  // === DEPLOYMENT_FILE (4) ===
  'backend/src/apps/acceptance/divergence.ts|(unattributed)': { symbols: ['?'], reason: DEPLOYMENT_FILE },
  'backend/src/apps/acceptance/divergence.generated.ts|(unattributed)': { symbols: ['?'], reason: DEPLOYMENT_FILE },
  'backend/src/apps/example/divergence.ts|(unattributed)': { symbols: ['?'], reason: DEPLOYMENT_FILE },
  'backend/src/apps/example/divergence.generated.ts|(unattributed)': { symbols: ['?'], reason: DEPLOYMENT_FILE },

};

/**
 * The application's own reaches into the platform, written as relative paths
 * (`specs/115-lifecycle-container-move/contracts/host-reach-check.md`).
 *
 * Keyed `<application file>|<canonical platform source file>`. The key's second
 * half is the file, never the specifier: re-spelling
 * `../../packages/platform/dist/x.js` as `../../packages/platform/src/x.ts` is
 * the same reach and must not clear an entry, which is the one way this repair
 * could regress in silence (§4).
 *
 * **Two-way and expected to empty** (R4.2/R4.3). An unledgered reach fails the
 * build and a key describing no reach fails it too. Every entry has an available
 * remedy — a subpath the `exports` map already declares, or one this feature
 * adds — so this is not a permanence ledger and takes no `permanent` entries. An
 * entry saying "this reach is correct" would mean the predicate has outgrown its
 * population: narrow the predicate, never add the entry (R4.5).
 *
 * `ledger-size` is printed by the run and is written down nowhere (D-100).
 */
export const RELATIVE_HOST_REACHES: Readonly<Record<string, LedgeredHostReach>> = {
  // === LIFECYCLE_SHIM (9) ===
  //
  // `_lifecycle`'s remaining 20-line re-export shims, each forwarding one platform
  // file the host half still names at its old application path. They are the half
  // this feature drains: Phase 2 gave the operator surface a declared address
  // (`./lifecycle`, host-internal — D115-4), Phases 3–5 moved the manifest
  // registry, the divergence parser and the five command bodies behind it, and
  // Phase 6 re-pointed the application's own reaches onto the subpath — at which
  // point three shims had no importer left anywhere and went with their entries.
  //
  // The nine here are held open by `backend/test/**` alone, which Phase 7 drains.
  // Their **production** consumers name the subpath already, so what an entry
  // records now is a test-tree rewrite and not a missing address.
  'backend/src/lifecycle/routes.admin.ts|packages/platform/src/lifecycle/routes.admin.ts': {
    reason:
      'a `_lifecycle` re-export shim: the application still names ' +
      '`packages/platform/src/lifecycle/routes.admin.ts` at its old application path. ' +
      '`@endora-commerce/platform/lifecycle` has carried it since Phase 2 and every ' +
      'production consumer names it; what holds this shim open is `backend/test/**`',
    retiredBy:
      'feature 115 Phase 7 — the test tree names the `./lifecycle` subpath and the shim is ' +
      'deleted',
  },
  'backend/src/lifecycle/services/deactivation-ledger.ts|packages/platform/src/lifecycle/services/deactivation-ledger.ts': {
    reason:
      'a `_lifecycle` re-export shim: the application still names ' +
      '`packages/platform/src/lifecycle/services/deactivation-ledger.ts` at its old application path. ' +
      '`@endora-commerce/platform/lifecycle` has carried it since Phase 2 and every ' +
      'production consumer names it; what holds this shim open is `backend/test/**`',
    retiredBy:
      'feature 115 Phase 7 — the test tree names the `./lifecycle` subpath and the shim is ' +
      'deleted',
  },
  'backend/src/lifecycle/services/dep-graph.ts|packages/platform/src/lifecycle/services/dep-graph.ts': {
    reason:
      'a `_lifecycle` re-export shim: the application still names ' +
      '`packages/platform/src/lifecycle/services/dep-graph.ts` at its old application path. ' +
      '`@endora-commerce/platform/lifecycle` has carried it since Phase 2 and every ' +
      'production consumer names it; what holds this shim open is `backend/test/**`',
    retiredBy:
      'feature 115 Phase 7 — the test tree names the `./lifecycle` subpath and the shim is ' +
      'deleted',
  },
  'backend/src/lifecycle/services/gating-graph.ts|packages/platform/src/lifecycle/services/gating-graph.ts': {
    reason:
      'a `_lifecycle` re-export shim: the application still names ' +
      '`packages/platform/src/lifecycle/services/gating-graph.ts` at its old application path. ' +
      '`@endora-commerce/platform/lifecycle` has carried it since Phase 2 and every ' +
      'production consumer names it; what holds this shim open is `backend/test/**`',
    retiredBy:
      'feature 115 Phase 7 — the test tree names the `./lifecycle` subpath and the shim is ' +
      'deleted',
  },
  'backend/src/lifecycle/services/lock.ts|packages/platform/src/lifecycle/services/lock.ts': {
    reason:
      'a `_lifecycle` re-export shim: the application still names ' +
      '`packages/platform/src/lifecycle/services/lock.ts` at its old application path. ' +
      '`@endora-commerce/platform/lifecycle` has carried it since Phase 2 and every ' +
      'production consumer names it; what holds this shim open is `backend/test/**`',
    retiredBy:
      'feature 115 Phase 7 — the test tree names the `./lifecycle` subpath and the shim is ' +
      'deleted',
  },
  'backend/src/lifecycle/services/manifest-loader.ts|packages/platform/src/lifecycle/services/manifest-loader.ts': {
    reason:
      'a `_lifecycle` re-export shim: the application still names ' +
      '`packages/platform/src/lifecycle/services/manifest-loader.ts` at its old application path. ' +
      '`@endora-commerce/platform/lifecycle` has carried it since Phase 2 and every ' +
      'production consumer names it; what holds this shim open is `backend/test/**`',
    retiredBy:
      'feature 115 Phase 7 — the test tree names the `./lifecycle` subpath and the shim is ' +
      'deleted',
  },
  'backend/src/lifecycle/services/orchestrator.ts|packages/platform/src/lifecycle/services/orchestrator.ts': {
    reason:
      'a `_lifecycle` re-export shim: the application still names ' +
      '`packages/platform/src/lifecycle/services/orchestrator.ts` at its old application path. ' +
      '`@endora-commerce/platform/lifecycle` has carried it since Phase 2 and every ' +
      'production consumer names it; what holds this shim open is `backend/test/**`',
    retiredBy:
      'feature 115 Phase 7 — the test tree names the `./lifecycle` subpath and the shim is ' +
      'deleted',
  },
  'backend/src/lifecycle/services/presence-load.ts|packages/platform/src/lifecycle/services/presence-load.ts': {
    reason:
      'a `_lifecycle` re-export shim: the application still names ' +
      '`packages/platform/src/lifecycle/services/presence-load.ts` at its old application path. ' +
      '`@endora-commerce/platform/lifecycle` has carried it since Phase 2 and every ' +
      'production consumer names it; what holds this shim open is `backend/test/**`',
    retiredBy:
      'feature 115 Phase 7 — the test tree names the `./lifecycle` subpath and the shim is ' +
      'deleted',
  },
  'backend/src/lifecycle/services/static-registry.ts|packages/platform/src/lifecycle/services/static-registry.ts': {
    reason:
      'a `_lifecycle` re-export shim: the application still names ' +
      '`packages/platform/src/lifecycle/services/static-registry.ts` at its old application path. ' +
      '`@endora-commerce/platform/lifecycle` has carried it since Phase 2 and every ' +
      'production consumer names it; what holds this shim open is `backend/test/**`',
    retiredBy:
      'feature 115 Phase 7 — the test tree names the `./lifecycle` subpath and the shim is ' +
      'deleted',
  },

  // === PUBLISHED_SHIM (41) ===
  //
  // A re-export shim at `backend/src/<subpath>/…` whose target a published barrel
  // already carries, so the address exists today and the remedy is a rewrite: the
  // shim's consumers name `@endora-commerce/platform/<subpath>` and the shim goes.
  // This is the bulk of the debt and it is not this feature's — 110's Phase 2 is
  // where the application stops holding a private copy of the platform's layout.
  'backend/src/commands/actor.ts|packages/platform/src/commands/actor.ts': {
    reason:
      'a re-export shim over `packages/platform/src/commands/actor.ts`, which ' +
      '`@endora-commerce/platform/commands` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/commands/command-bus.ts|packages/platform/src/commands/command-bus.ts': {
    reason:
      'a re-export shim over `packages/platform/src/commands/command-bus.ts`, which ' +
      '`@endora-commerce/platform/commands` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/commands/command.ts|packages/platform/src/commands/command.ts': {
    reason:
      'a re-export shim over `packages/platform/src/commands/command.ts`, which ' +
      '`@endora-commerce/platform/commands` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/commands/reversible.ts|packages/platform/src/commands/reversible.ts': {
    reason:
      'a re-export shim over `packages/platform/src/commands/reversible.ts`, which ' +
      '`@endora-commerce/platform/commands` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/events/bus.ts|packages/platform/src/events/bus.ts': {
    reason:
      'a re-export shim over `packages/platform/src/events/bus.ts`, which ' +
      '`@endora-commerce/platform/events` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/http/cursor.ts|packages/platform/src/http/cursor.ts': {
    reason:
      'a re-export shim over `packages/platform/src/http/cursor.ts`, which ' +
      '`@endora-commerce/platform/http` already carries — the reach is a rewrite away from an ' +
      'address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/http/error-envelope.ts|packages/platform/src/http/error-envelope.ts': {
    reason:
      'a re-export shim over `packages/platform/src/http/error-envelope.ts`, which ' +
      '`@endora-commerce/platform/http` already carries — the reach is a rewrite away from an ' +
      'address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/http/product-audience.ts|packages/platform/src/http/product-audience.ts': {
    reason:
      'a re-export shim over `packages/platform/src/http/product-audience.ts`, which ' +
      '`@endora-commerce/platform/http` already carries — the reach is a rewrite away from an ' +
      'address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/http/storefront-revalidator.ts|packages/platform/src/http/storefront-revalidator.ts': {
    reason:
      'a re-export shim over `packages/platform/src/http/storefront-revalidator.ts`, which ' +
      '`@endora-commerce/platform/http` already carries — the reach is a rewrite away from an ' +
      'address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/audit/audit-log-entry.entity.ts|packages/platform/src/kernel/audit/audit-log-entry.entity.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/audit/audit-log-entry.entity.ts`, ' +
      'which `@endora-commerce/platform/kernel` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/cache/in-process-cache-registry.ts|packages/platform/src/kernel/cache/in-process-cache-registry.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/cache/in-process-cache-registry.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/crypto/password-hasher.ts|packages/platform/src/kernel/crypto/password-hasher.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/crypto/password-hasher.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/lifecycle/effective-state.ts|packages/platform/src/kernel/lifecycle/effective-state.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/lifecycle/effective-state.ts`, ' +
      'which `@endora-commerce/platform/kernel` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/lifecycle/plugin-helpers.ts|packages/platform/src/kernel/lifecycle/plugin-helpers.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/lifecycle/plugin-helpers.ts`, ' +
      'which `@endora-commerce/platform/kernel` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/logging.ts|packages/platform/src/kernel/logging.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/logging.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/module-context.ts|packages/platform/src/kernel/module-context.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/module-context.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/ports/audit.ts|packages/platform/src/kernel/ports/audit.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/ports/audit.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/ports/organizations.ts|packages/platform/src/kernel/ports/organizations.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/ports/organizations.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/ports/require-admin.ts|packages/platform/src/kernel/ports/require-admin.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/ports/require-admin.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/ports/require-customer.ts|packages/platform/src/kernel/ports/require-customer.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/ports/require-customer.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/ports/sales-channel.ts|packages/platform/src/kernel/ports/sales-channel.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/ports/sales-channel.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/ports/settings.ts|packages/platform/src/kernel/ports/settings.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/ports/settings.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/public-api-base-url.ts|packages/platform/src/kernel/public-api-base-url.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/public-api-base-url.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/sales-channels/no-system-default-channel.error.ts|packages/platform/src/kernel/sales-channels/no-system-default-channel.error.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/sales-channels/no-system-default-channel.error.ts`, ' +
      'which `@endora-commerce/platform/kernel` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/sales-channels/request-channel-assortment.ts|packages/platform/src/kernel/sales-channels/request-channel-assortment.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/sales-channels/request-channel-assortment.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/sales-channels/sales-channel-membership.service.ts|packages/platform/src/kernel/sales-channels/sales-channel-membership.service.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/sales-channels/sales-channel-membership.service.ts`, ' +
      'which `@endora-commerce/platform/kernel` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/sales-channels/sales-channel-resolver.middleware.ts|packages/platform/src/kernel/sales-channels/sales-channel-resolver.middleware.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/sales-channels/sales-channel-resolver.middleware.ts`, ' +
      'which `@endora-commerce/platform/kernel` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/sales-channels/sales-channel-resolver.service.ts|packages/platform/src/kernel/sales-channels/sales-channel-resolver.service.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/sales-channels/sales-channel-resolver.service.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/sales-channels/sales-channel.entity.ts|packages/platform/src/kernel/sales-channels/sales-channel.entity.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/sales-channels/sales-channel.entity.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/sales-channels/sales-channels-cache.ts|packages/platform/src/kernel/sales-channels/sales-channels-cache.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/sales-channels/sales-channels-cache.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/scope.ts|packages/platform/src/kernel/scope.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/scope.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/settings/secret-value-codec.ts|packages/platform/src/kernel/settings/secret-value-codec.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/settings/secret-value-codec.ts`, ' +
      'which `@endora-commerce/platform/kernel` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/settings/setting-group.entity.ts|packages/platform/src/kernel/settings/setting-group.entity.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/settings/setting-group.entity.ts`, ' +
      'which `@endora-commerce/platform/kernel` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/settings/setting-value.entity.ts|packages/platform/src/kernel/settings/setting-value.entity.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/settings/setting-value.entity.ts`, ' +
      'which `@endora-commerce/platform/kernel` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/settings/setting.entity.ts|packages/platform/src/kernel/settings/setting.entity.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/settings/setting.entity.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/settings/settings-cache.ts|packages/platform/src/kernel/settings/settings-cache.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/settings/settings-cache.ts`, which ' +
      '`@endora-commerce/platform/kernel` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/kernel/settings/settings.service.ts|packages/platform/src/kernel/settings/settings.service.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/settings/settings.service.ts`, ' +
      'which `@endora-commerce/platform/kernel` already carries — the reach is a rewrite away ' +
      'from an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/tenancy/derived-scope.ts|packages/platform/src/tenancy/derived-scope.ts': {
    reason:
      'a re-export shim over `packages/platform/src/tenancy/derived-scope.ts`, which ' +
      '`@endora-commerce/platform/tenancy` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/tenancy/escape-hatch.ts|packages/platform/src/tenancy/escape-hatch.ts': {
    reason:
      'a re-export shim over `packages/platform/src/tenancy/escape-hatch.ts`, which ' +
      '`@endora-commerce/platform/tenancy` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/tenancy/org-scoped.decorator.ts|packages/platform/src/tenancy/org-scoped.decorator.ts': {
    reason:
      'a re-export shim over `packages/platform/src/tenancy/org-scoped.decorator.ts`, which ' +
      '`@endora-commerce/platform/tenancy` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },
  'backend/src/tenancy/tenant-context.ts|packages/platform/src/tenancy/tenant-context.ts': {
    reason:
      'a re-export shim over `packages/platform/src/tenancy/tenant-context.ts`, which ' +
      '`@endora-commerce/platform/tenancy` already carries — the reach is a rewrite away from ' +
      'an address that exists',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — the application names the bare specifier and ' +
      'the shim is deleted',
  },

  // === UNPUBLISHED_SHIM (28) ===
  //
  // The same shape with one difference that decides the order of the repair: no
  // barrel carries the target, so there is no address to rewrite the reach to yet.
  // Each needs a subpath declared first — host-internal unless a module genuinely
  // needs the symbol, which is D-160.14's line and never a widening of
  // `PUBLISHED_SUBPATHS` taken to make a check pass. 110's Phase 2, after the
  // subpath question is answered for each of them.
  'backend/src/demo/index.ts|packages/platform/src/demo/index.ts': {
    reason:
      'a re-export shim over `packages/platform/src/demo/index.ts`, which no barrel carries — ' +
      'the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/http/interceptors/dispatch.ts|packages/platform/src/http/interceptors/dispatch.ts': {
    reason:
      'a re-export shim over `packages/platform/src/http/interceptors/dispatch.ts`, which no ' +
      'barrel carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/http/interceptors/index.ts|packages/platform/src/http/interceptors/index.ts': {
    reason:
      'a re-export shim over `packages/platform/src/http/interceptors/index.ts`, which no ' +
      'barrel carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/http/interceptors/registry.ts|packages/platform/src/http/interceptors/registry.ts': {
    reason:
      'a re-export shim over `packages/platform/src/http/interceptors/registry.ts`, which no ' +
      'barrel carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/http/interceptors/route-table.ts|packages/platform/src/http/interceptors/route-table.ts': {
    reason:
      'a re-export shim over `packages/platform/src/http/interceptors/route-table.ts`, which ' +
      'no barrel carries — the reach needs a declared subpath before it has an address to ' +
      'name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/http/interceptors/validation.ts|packages/platform/src/http/interceptors/validation.ts': {
    reason:
      'a re-export shim over `packages/platform/src/http/interceptors/validation.ts`, which ' +
      'no barrel carries — the reach needs a declared subpath before it has an address to ' +
      'name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/http/server.ts|packages/platform/src/http/server.ts': {
    reason:
      'a re-export shim over `packages/platform/src/http/server.ts`, which no barrel carries ' +
      '— the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/http/test-actor-carrier.ts|packages/platform/src/http/test-actor-carrier.ts': {
    reason:
      'a re-export shim over `packages/platform/src/http/test-actor-carrier.ts`, which no ' +
      'barrel carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/http/trusted-proxy.ts|packages/platform/src/http/trusted-proxy.ts': {
    reason:
      'a re-export shim over `packages/platform/src/http/trusted-proxy.ts`, which no barrel ' +
      'carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/audit/audit-log-service.ts|packages/platform/src/kernel/audit/audit-log-service.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/audit/audit-log-service.ts`, which ' +
      'no barrel carries — the reach needs a declared subpath before it has an address to ' +
      'name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/compose.ts|packages/platform/src/kernel/compose.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/compose.ts`, which no barrel ' +
      'carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/container.ts|packages/platform/src/kernel/container.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/container.ts`, which no barrel ' +
      'carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  // The one entry this ledger **gained** rather than drained, and it is worth a
  // sentence: `specs/117-instance-bring-up/` FR-030 moved the error-code routing
  // derivation out of `_i18n` and into the platform, beside `request-language.ts`
  // below — the producer of the other `ErrorEnvelopeOptions` member a composition
  // root injects. Before the move the root reached it by a **bare** specifier
  // into the module's package, which is why it needed no entry here and why it
  // was a value import of a module the same root is about to become platform
  // code beside (D-52, D-53). One relative reach in exchange for one module
  // import, and this one retires with its 84 neighbours.
  'backend/src/kernel/i18n/error-translation.ts|packages/platform/src/kernel/i18n/error-translation.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/i18n/error-translation.ts`, which ' +
      'no barrel carries — no module calls the derivation, so `host-package.md` §1.3 ' +
      'classifies it unreached and the reach needs a host-internal subpath before it has an ' +
      'address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — T118 moves the caller into the platform, at ' +
      'which point the reach is the package naming its own file and the shim is deleted',
  },
  'backend/src/kernel/i18n/request-language.ts|packages/platform/src/kernel/i18n/request-language.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/i18n/request-language.ts`, which ' +
      'no barrel carries — the reach needs a declared subpath before it has an address to ' +
      'name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/lifecycle/activation-resolver.ts|packages/platform/src/kernel/lifecycle/activation-resolver.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/lifecycle/activation-resolver.ts`, ' +
      'which no barrel carries — the reach needs a declared subpath before it has an address ' +
      'to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/lifecycle/module-registration.entity.ts|packages/platform/src/kernel/lifecycle/module-registration.entity.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/lifecycle/module-registration.entity.ts`, which no ' +
      'barrel carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/lifecycle/registry-cache.ts|packages/platform/src/kernel/lifecycle/registry-cache.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/lifecycle/registry-cache.ts`, ' +
      'which no barrel carries — the reach needs a declared subpath before it has an address ' +
      'to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/lifecycle/required-modules.ts|packages/platform/src/kernel/lifecycle/required-modules.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/lifecycle/required-modules.ts`, ' +
      'which no barrel carries — the reach needs a declared subpath before it has an address ' +
      'to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/lifecycle/unique-module-ids.ts|packages/platform/src/kernel/lifecycle/unique-module-ids.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/lifecycle/unique-module-ids.ts`, ' +
      'which no barrel carries — the reach needs a declared subpath before it has an address ' +
      'to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/request-scope-hook.ts|packages/platform/src/kernel/request-scope-hook.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/request-scope-hook.ts`, which no ' +
      'barrel carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/sales-channels/compose.ts|packages/platform/src/kernel/sales-channels/compose.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/sales-channels/compose.ts`, which ' +
      'no barrel carries — the reach needs a declared subpath before it has an address to ' +
      'name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/sales-channels/default-channel-reconciler.ts|packages/platform/src/kernel/sales-channels/default-channel-reconciler.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/sales-channels/default-channel-reconciler.ts`, which no ' +
      'barrel carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/settings/compose.ts|packages/platform/src/kernel/settings/compose.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/settings/compose.ts`, which no ' +
      'barrel carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/kernel/settings/manifest-reconciler.ts|packages/platform/src/kernel/settings/manifest-reconciler.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/settings/manifest-reconciler.ts`, ' +
      'which no barrel carries — the reach needs a declared subpath before it has an address ' +
      'to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/seeds/dev-seed-guard.ts|packages/platform/src/demo/guard.ts': {
    reason:
      'a re-export shim over `packages/platform/src/demo/guard.ts`, which no barrel carries — ' +
      'the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/seeds/seed-scope.ts|packages/platform/src/demo/scope.ts': {
    reason:
      'a re-export shim over `packages/platform/src/demo/scope.ts`, which no barrel carries — ' +
      'the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/tenancy/filters.ts|packages/platform/src/tenancy/filters.ts': {
    reason:
      'a re-export shim over `packages/platform/src/tenancy/filters.ts`, which no barrel ' +
      'carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/tenancy/resolve-tenant-context.ts|packages/platform/src/tenancy/resolve-tenant-context.ts': {
    reason:
      'a re-export shim over `packages/platform/src/tenancy/resolve-tenant-context.ts`, which ' +
      'no barrel carries — the reach needs a declared subpath before it has an address to ' +
      'name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
  'backend/src/tenancy/scoped-em.ts|packages/platform/src/tenancy/scoped-em.ts': {
    reason:
      'a re-export shim over `packages/platform/src/tenancy/scoped-em.ts`, which no barrel ' +
      'carries — the reach needs a declared subpath before it has an address to name',
    retiredBy:
      'specs/110-instance-repository/ Phase 2 — a subpath for the target first, then the bare ' +
      'specifier',
  },
};

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const prefix = '[platform-surface]';
  const layout = await requireModuleLayout(prefix);

  // Every root a module's source can live in, derived (feature 080, T040a):
  // the application's own tree, the per-deployment overlay tree, and each
  // module that has become a workspace package.
  // Repo-relative, one namespace — see the header. `layout.keyOf` has two bases
  // and a resolver cannot straddle them.
  const repoKeyOf = (absolutePath: string): string =>
    relative(layout.repoRoot, absolutePath).split('\\').join('/');

  const moduleFiles = layout.moduleWalkRoots.flatMap((root) =>
    walk(root).filter((file) => !isPackageToolingConfig(root, file)),
  );
  const sources = new Map<string, string>();
  for (const file of moduleFiles) sources.set(repoKeyOf(file), readFileSync(file, 'utf8'));

  // What a specifier can resolve to: the whole source tree, module files and
  // platform files alike. A relative specifier naming nothing in it is a
  // finding, never a skip.
  const files = new Set<string>(
    layout.sourceRoots.flatMap((root) => walk(root)).map((file) => repoKeyOf(file)),
  );
  for (const key of sources.keys()) files.add(key);

  // The published surface, read out of the barrels — the same parse
  // `published-surface.test.ts` holds those barrels to §1.3 with, resolved
  // against the same file list a module reach is resolved against.
  // The platform's own sources, wherever the workspace says they are. `null` is
  // a stop and not an empty surface: this check *is* the platform's barrels, so
  // a run without them would refuse every reach in the tree.
  const platformRoot = layout.platformRoot;
  if (platformRoot === null) {
    console.error(
      `${prefix} no workspace member declares \`endora.type: "platform"\` — there are no ` +
        'barrels to read and no published surface to judge a reach against',
    );
    process.exit(2);
  }
  // Shim key → the platform file it forwards to. Built from the platform tree,
  // so a shim with no counterpart is simply absent from it rather than mapped
  // to a file that is not there.
  const canonicalTargets = new Map<string, string>();
  for (const file of walk(platformRoot)) {
    const withinPlatform = relative(platformRoot, file).split('\\').join('/');
    canonicalTargets.set(`${repoKeyOf(layout.srcRoot)}/${withinPlatform}`, repoKeyOf(file));
  }
  const canonicalTargetOf = (key: string): string => canonicalTargets.get(key) ?? key;

  const barrelSources = new Map<string, string>();
  const missing: string[] = [];
  for (const subpath of PUBLISHED_SUBPATHS) {
    const absolute = join(platformRoot, barrelKeyOf(subpath));
    if (!existsSync(absolute)) {
      missing.push(barrelKeyOf(subpath));
      continue;
    }
    barrelSources.set(repoKeyOf(absolute), readFileSync(absolute, 'utf8'));
  }
  const surface = publishedSurface(barrelSources, (fromKey, specifier) =>
    resolveTarget(fromKey, specifier, files),
  );
  const refusal = platformSurfaceRefusal({ missingBarrels: missing, surface });
  if (refusal !== null) {
    console.error(`${prefix} ${refusal}`);
    process.exit(2);
  }

  // The host as a packaged module names it (feature 080, T060): the npm name off
  // its own manifest, and one entry per published subpath pointing at the barrel
  // this run just read. Both derived — a scope written here would break on D-161
  // and a subpath list would break on the sixth published directory.
  //
  // `declaredSubpaths` is the *manifest's* own answer and deliberately a second
  // list (D-160.14). `./composition` is declared by the `exports` map and
  // carried by no barrel, so `node` and `tsc` both resolve it and only this
  // check can refuse a module that names it — as `host-internal-subpath`, which
  // is neither "published" nor "the map refuses this path".
  const hostName = layout.platformPackageName;
  if (hostName === null) {
    console.error(
      `${prefix} the workspace member holding the platform publishes under no name — a ` +
        'packaged module reaches the platform by that name, so every one of those reaches ' +
        'would leave the population unjudged',
    );
    process.exit(2);
  }
  const host: HostPackage = {
    name: hostName,
    subpathTargets: new Map(
      PUBLISHED_SUBPATHS.map((subpath) => [
        subpath,
        repoKeyOf(join(platformRoot, barrelKeyOf(subpath))),
      ]),
    ),
    declaredSubpaths: new Set(platformSubpathsAt(layout.repoRoot)),
  };

  // The population is the module tree, and the rest of `src/` is a small
  // fraction of it: a walk that read only the remainder would find no reach at
  // all and print the same green as a clean tree (issue #215). Derived from the
  // manifest index, so nothing here is a number anybody chose.
  const attribute = (key: string): string | null =>
    layout.moduleIdOfPath(join(layout.repoRoot, key));

  const coverage = await refuseVacuousModulePopulation({
    prefix,
    manifestIndexPath: layout.manifestIndexPath,
    files: [...sources.keys()],
    moduleIdOf: attribute,
  });

  // The **application** as a second consumer population (feature 115, D115-5).
  //
  // The rule is this check's own sentence one population over — *a reach into
  // the host names a published or a declared address* — and the application is
  // the consumer nothing was asking it of: `attribute` answers `null` for every
  // one of its files, so `violations=0` was honest about a population that did
  // not contain them.
  //
  // The two roots are the contract's (§2) and are the application's own, never
  // the repository's: `layout.srcRoot` is where the manifest index says the
  // application's sources are, and `scripts/` beside it is the only other tree
  // whose files this repository executes as part of the application. The test
  // tree is out — it is a different population with a different answer, and its
  // reaches drain as a mechanical rewrite — and it is out *by not being walked*
  // rather than by an exclusion, which is why `scripts` is spelled and `test`
  // is not.
  //
  // Every file a module owns stays in `sources` above and is judged by the
  // existing rules; a file inside the platform is the package reaching itself.
  const applicationSources = new Map<string, string>();
  for (const root of [layout.srcRoot, join(layout.applicationRoot, 'scripts')]) {
    for (const file of walk(root)) {
      if (layout.moduleWalkRoots.some((moduleRoot) => file.startsWith(`${moduleRoot}/`))) continue;
      if (attribute(repoKeyOf(file)) !== null) continue;
      if (file.startsWith(`${platformRoot}/`)) continue;
      applicationSources.set(repoKeyOf(file), readFileSync(file, 'utf8'));
    }
  }

  const applicationRefusal = applicationReachRefusal({
    canonicalTargets: canonicalTargets.size,
    applicationFiles: applicationSources.size,
  });
  if (applicationRefusal !== null) {
    console.error(`${prefix} ${applicationRefusal}`);
    process.exit(2);
  }

  const applicationReaches = checkApplicationReaches(
    {
      sources: applicationSources,
      // The member's own directory — the directory holding the manifest that
      // declares `endora.type: "platform"`. `platformSourceRootOf` builds its
      // answer by joining `src` to it, so `dirname` is that derivation's exact
      // inverse rather than a guess about the layout.
      platformMemberRoot: repoKeyOf(dirname(platformRoot)),
      platformSourceRoot: repoKeyOf(platformRoot),
      files,
      surface,
      host,
    },
    RELATIVE_HOST_REACHES,
  );

  const result = checkPlatformSurface(
    {
      sources,
      files,
      surface,
      moduleIdOf: attribute,
      canonicalTargetOf,
      host,
      platformSourceRoot: repoKeyOf(platformRoot),
    },
    UNPUBLISHED_PLATFORM_REACHES,
  );

  // The floor that follows the sweep. Every module package's manifest is
  // rendered from the bare specifiers its sources import (`manifests:generate`),
  // so a package that declares the host and contributed no host reach means this
  // walk stopped reading them — which is exactly what happened, unseen, for two
  // batches. A manifest that will not parse is exit 2 and never a package
  // credited with declaring nothing (issue #113).
  const declarations: ModulePackageDeclaration[] = [];
  for (const root of layout.moduleRoots) {
    if (root.origin !== 'workspace-package' || root.moduleId === null) continue;
    const manifestPath = join(root.directory, 'package.json');
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    } catch (error: unknown) {
      console.error(
        `${prefix} ${manifestPath} could not be read (${String(error)}) — it is what says ` +
          'whether this package reaches the host, and a package credited with declaring ' +
          'nothing lowers the floor it belongs to',
      );
      process.exit(2);
    }
    const names = ['dependencies', 'peerDependencies'].flatMap((field) => {
      const block = manifest[field];
      return typeof block === 'object' && block !== null && !Array.isArray(block)
        ? Object.keys(block as Record<string, unknown>)
        : [];
    });
    declarations.push({ moduleId: root.moduleId, dependsOnHost: names.includes(hostName) });
  }
  const hostDependents = hostDependentCoverage(declarations, result.hostReachModules);

  if (listMode) {
    for (const finding of applicationReaches.findings) {
      const tag = RELATIVE_HOST_REACHES[keyOf(finding)] === undefined ? 'HOST    ' : 'LEDGERED';
      console.log(`${tag} ${finding.file}:${finding.line}  ${finding.target}  (${finding.kind})`);
    }
    for (const finding of result.findings) {
      const tag =
        UNPUBLISHED_PLATFORM_REACHES[keyOf(finding)]?.symbols.includes(finding.symbol) === true
          ? 'LEDGERED'
          : 'REACH   ';
      console.log(
        `${tag} ${finding.file}:${finding.line}  [${finding.moduleId ?? '-'}] ` +
          `${finding.target}#${finding.symbol}  (${finding.kind})`,
      );
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244). `files` is the module
  // sources opened; `sites` is the (specifier, symbol) reaches judged inside
  // them, which is the finer population and the one that moves when a barrel
  // changes. The two `sources=` derivations have different authors: the module
  // count comes from the generated manifest index, and the barrel count from
  // D-160.7's subpath list reconciled against the tree.
  //
  // `files` and `sites` carry **both** populations (host-reach-check.md §6):
  // `files` grows by the application files opened and `sites` by the
  // application reaches examined. `platform-barrels` is deliberately unchanged
  // — `PUBLISHED_SUBPATHS` is untouched by feature 115, and a token that moved
  // would say the published surface had.
  const hostReaches = hostReachCoverage(
    RELATIVE_HOST_REACHES,
    (file) => existsSync(join(layout.repoRoot, file)),
    new Set(applicationSources.keys()),
  );
  reportReadSize({
    prefix,
    files: sources.size + applicationSources.size,
    sites: result.reaches + applicationReaches.reaches,
    coverage: [
      coverage,
      {
        source: 'platform-barrels',
        expected: PUBLISHED_SUBPATHS.length,
        covered: surface.barrelsWithExports,
      },
      ...(hostDependents === null ? [] : [hostDependents]),
      ...(hostReaches === null ? [] : [hostReaches]),
    ],
  });
  console.log(
    `${prefix} module reaches into unpublished platform surface=${result.findings.length} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(UNPUBLISHED_PLATFORM_REACHES).length} ` +
      `stale=${result.staleKeys.length + result.staleSymbols.length}`,
  );
  console.log(
    `${prefix} application reaches into the platform by relative path=` +
      `${applicationReaches.findings.length} violations=${applicationReaches.violations.length} ` +
      `ledgered=${applicationReaches.ledgered.length} ` +
      `ledger-size=${Object.keys(RELATIVE_HOST_REACHES).length} ` +
      `stale=${applicationReaches.staleKeys.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nA module reached platform surface the host does not publish (feature 080 §1,\n' +
        'D-160.8). Take the published symbol from the directory barrel, take the port\n' +
        'where the contract says the class is `O`, or repair the call site before the\n' +
        'module can be packaged — an `exports` map will refuse it at resolution time.\n' +
        '\nOne kind is the exception and is the reason it has a kind of its own: a\n' +
        '`host-internal-subpath` reach *does* resolve, for `node` and for `tsc` alike\n' +
        '(D-160.14). Nothing but this check stands between a module and the composition\n' +
        'surface the host keeps for itself, so its remedy is never "widen the map".\n',
    );
    for (const finding of result.violations) {
      console.error(
        `  - ${finding.file}:${finding.line}  [${finding.moduleId ?? '-'}] ` +
          `${remedyOf(finding)}  (${finding.kind})`,
      );
    }
  }
  if (result.staleKeys.length > 0) {
    console.error('\nStale ledger keys (no longer describe a reach — delete them):');
    for (const key of result.staleKeys) console.error(`  - ${key}`);
  }
  if (result.staleSymbols.length > 0) {
    console.error('\nStale ledger symbols (the reach no longer takes them — delete them):');
    for (const key of result.staleSymbols) console.error(`  - ${key}`);
  }

  if (applicationReaches.violations.length > 0) {
    console.error(
      '\nThe application reached inside `@endora-commerce/platform` by relative path\n' +
        '(feature 115, D115-5). A relative path into the package resolves in this checkout\n' +
        'and in no instance built from published packages, which is the defect D-207 names.\n' +
        'Name a published subpath, or a host-internal one the map declares — never a file.\n',
    );
    for (const finding of applicationReaches.violations) {
      console.error(`  - ${finding.file}:${finding.line}  ${remedyOf(finding)}`);
    }
  }
  if (applicationReaches.staleKeys.length > 0) {
    console.error('\nStale RELATIVE_HOST_REACHES keys (no longer describe a reach — delete them):');
    for (const key of applicationReaches.staleKeys) console.error(`  - ${key}`);
  }

  const failed =
    result.violations.length > 0 ||
    result.staleKeys.length > 0 ||
    result.staleSymbols.length > 0 ||
    applicationReaches.violations.length > 0 ||
    applicationReaches.staleKeys.length > 0;
  process.exit(failed ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
