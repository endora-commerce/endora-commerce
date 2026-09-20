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
 * `ledger-size` is printed by the run and is written down nowhere (D-100). The
 * section headers below carry no count for the same reason.
 *
 * ## The sections are what holds each entry open, and that is a correction
 *
 * They read `PUBLISHED_SHIM` and `UNPUBLISHED_SHIM` until T119a — *the target's
 * barrel carries it* against *no barrel carries it* — and that axis is one
 * granularity too coarse to be true. A barrel publishes **symbols**, not files:
 * `@endora-commerce/platform/http` carries `HttpError` and does not carry
 * `registerErrorEnvelope`, so twelve consumers of `http/error-envelope.ts` had
 * no address at all while their entry said *"the reach is a rewrite away from an
 * address that exists"*. Seventeen of the twenty-two entries under that heading
 * said it and none of them was a rewrite away; the sentence sent a reader to
 * attempt the rewrite T119 had already attempted and abandoned. It is the
 * distinction `check:platform-surface`'s own verdict got right for modules in
 * !883 — per symbol of a named file, never per file — and this ledger's prose
 * got wrong.
 *
 * So an entry is filed under **what holds it open**, and its `reason` names the
 * symbols the declared barrels carry, the symbols they do not, and which task's
 * work removes each. The tasks are `specs/110-instance-repository/` tasks.md's
 * own — T119a (done: the platform's unit tests moved into the package), T119b
 * (complete `./composition`, give `demo/` a subpath), T119c (the entity registry
 * generator names each entity class by its own address), T119d (the two
 * `backend/scripts` analyses move into `@endora-commerce/cli`) and T119e (the
 * terminal criterion, owned by `specs/109-backend-test-kit/`). Every `retiredBy`
 * names the task that actually retires the entry — which is the task giving its
 * **last** consumer an address, never the first, since a shim is deleted when the
 * last of them goes. An entry naming two tasks was a state this ledger held until
 * T119d re-derived the last two of them; whether any entry is in it is printed by
 * the run rather than written here (D-100). They all read *"Phase 2"* until T119a,
 * which is the phase T119 itself closed — a ledger of due dates in the past.
 *
 * ## "Has an address" is asked of every declared subpath, not of the five
 *
 * T119's drain, and T119a's first pass over the residue, both measured
 * *addressed* against `PUBLISHED_SUBPATHS` — the five barrels a **module** may
 * name. That is the wrong question for this population: the consumer here is the
 * application and its test tree, and they are entitled to the host-internal
 * subpaths as well. Asked against the subpaths the `exports` map declares, four
 * entries had **no unaddressed symbol at all** — every consumer named something
 * `./composition` already carried — so they needed no ruling, no barrel change
 * and no capability: they needed their consumers re-pointed. They were a section
 * of their own here until T119b did exactly that. A module naming
 * `./composition` is still `host-internal-subpath` and still refused (D-160.14);
 * nothing about that moves.
 *
 * ## What T119a drained
 *
 * The platform's own unit tests moved into the platform package, beside the
 * sources they cover (`specs/106-module-owned-tests/`' convention, applied to
 * the one package in this tree with a `src/` and no tests). Inside the package a
 * test names a **relative** path, so an internal the barrels deliberately do not
 * publish — `normalise`, `parseAcceptLanguage`, `SETTINGS_LRU_TTL_MS`,
 * `duplicateModuleIds`, `validateRegistrations`, `withScopeNotice`,
 * `makePreDispatchOnRoute` — stops being a surface question rather than being
 * given an address it should not have. Nine entries went with them, and
 * `backend/src/http/interceptors/` is gone entirely.
 *
 * The forecast for that move was fourteen. It is nine, and the nine are what the
 * tree supports rather than what the arithmetic wanted: a test moves only when
 * everything it needs is inside the package, and of the 115 files in the eight
 * candidate directories, 65 reach `backend/scripts/**`, an application-owned
 * generated artefact, a module package or a `backend/test/` helper. Five more
 * were held back one at a time and each for its own reason, named in
 * `backend/test/README.md`. `kernel/lifecycle/required-modules.ts` is the entry
 * that looks as though it should have gone and did not: its last consumer is
 * `test/unit/_lifecycle/core-locks-precede-residue.test.ts`, which reads the
 * application's `registered-manifests.ts` and therefore stays — and the symbol
 * it names was on `./composition` already, so that entry was one of the four
 * above rather than one waiting on a surface decision.
 *
 * ## What T119b drained
 *
 * The four with no unaddressed symbol, plus seven whose symbols got one. Twelve
 * names joined `./composition` — `registerErrorEnvelope`, `parseTrustedProxy` /
 * `TrustedProxy`, `ModuleCompositionError`, `ModuleEntry`, `createModuleContext`,
 * `createModuleRegistrationSink`, `ModuleRegistrationSink`, the three decoration
 * errors and `absolutizePublicUrl` — and `demo/`, the one
 * platform directory with a barrel and **no subpath at all**, got `./demo`.
 * Eleven entries retired and `backend/src/http/` and `backend/src/kernel/ports/`
 * are gone entirely.
 *
 * **Not a widening of published surface.** `kernel/index.ts`' own header
 * enumerates this class as the thing it excludes — *"the composition machinery …
 * and the errors they raise"* — `PUBLISHED_SUBPATHS` is unchanged at five, and a
 * module naming `./composition` or `./demo` is `host-internal-subpath`, which is
 * the finding that exists for exactly this and is proven red for both.
 *
 * The forecast for it was ten and it is eleven, and the eleventh is the one
 * worth naming: `http/error-envelope.ts` was filed as T119b **and** T119e, and
 * T119e's half was `HttpErrorFromApplication`, which no longer has a consumer at
 * all. A reason derived once and read later is a reason that can be true of a
 * tree that has moved; this one was re-derived over the branch rather than
 * relayed, which is the only way an entry's holder is ever current.
 *
 * ## What T119c drained
 *
 * The six platform **entity** shims, in one cut, on the strength of one export.
 * `generate-composer.ts`' `specifierFor` spelled all six relatively *on purpose*:
 * five of the classes were on `./kernel` already and `ModuleRegistration` was on
 * no barrel at all, so an address existed for five of six and a generator cannot
 * emit five of six imports one way and the sixth another. T119c gave the sixth
 * one — `./composition`, which is `host-package.md` §1.3's **A** classification
 * *applied* and not revised, **A** meaning *not public API* and this subpath
 * being exactly that — and taught the generator to ask, uniformly, which
 * declared subpath publishes **this symbol out of this file**. 416 consumer
 * specifiers, 335 files.
 *
 * **The per-symbol question is the whole of it, and a per-file one would have
 * been wrong in the direction that compiles.** `packageSpecifierFor` answers
 * *which subpath's `exports` target covers this file's emitted path*, and for
 * everything under `kernel/` that is `./kernel` — `module-registration.entity.js`
 * included, whose class the `./kernel` barrel does not carry. That specifier
 * resolves to a module with no such export.
 *
 * **Two of the six had a T119e half and neither survived re-derivation, which is
 * the finding rather than a bonus.** `sales-channel.entity.ts` was filed as
 * holding `SalesChannelFromApplication`, a name no barrel carries: it is the
 * *local* binding of `import { SalesChannel as SalesChannelFromApplication }`,
 * so the symbol reached is `SalesChannel` and it is on `./kernel`. The same
 * entry, and `module-registration.entity.ts`'s, also recorded *"a namespace or
 * side-effect reach takes the file whole"* over three `await import()` calls,
 * each of which destructures one named export. All three were addressable. An
 * entry's holder is a measurement and reads like a fact; both of these were
 * derived once, correctly for the reader they were derived by, and neither was
 * re-derived until the task that owned them ran.
 *
 * ## What T119d found, which is that it drains nothing
 *
 * The row's remedy is *the two `backend/scripts` analyses that read the
 * platform's internals move into `@endora-commerce/cli`*, and its criterion was
 * that the two entries those analyses hold open — `kernel/i18n/error-translation`
 * and `tenancy/org-scoped.decorator` — retire with them. Re-derived over the
 * branch tree, **neither does, and the count is zero rather than two.** The
 * measurement is one table and it is worth keeping, because the entries' own
 * `reason` strings named T119d as a retiring holder and a future author would
 * otherwise attempt the move a second time — which is the failure mode T119's row
 * records about the 17 entries that said *"the reach is a rewrite away from an
 * address that exists"*.
 *
 * `error-translation.ts` has six consumers, one under `backend/scripts` and five
 * under `backend/test/**`. The script names three symbols and exactly one of
 * them, `ErrorCodeCollision`, is named by nothing else:
 * `buildErrorTranslationTargets` is named by five of the tests and
 * `describeErrorCodeCollisions` by two. `org-scoped.decorator.ts` has **seven**,
 * one under `backend/scripts` and six under `backend/test/**`, and the same
 * shape — the script names `tenantClassifications` and `ScopeClass`, and
 * `tenantClassifications` is called by **four** of the tests. So moving the two
 * checks takes **two symbols** out of the two holder sets and **no file** out of
 * either consumer set.
 *
 * **Both `org-scoped.decorator.ts` numbers are re-derived, and the pair they
 * replace was stale before D-257 moved them** — this is a ledger derived *about*
 * files rather than one any of them edits, so no targeted run over a changed
 * path can flag it. Recorded here as *ten consumers, nine of them tests* and
 * *named by seven of the tests*; measured 2026-09-20 before the repair at **13**
 * consumers (1 script + 12 test files) and **10** callers, and after it at the
 * seven and four above. The six that left are the module-owned tenancy tests of
 * `pim_akeneo`, `pim_pimcore`, `pim_ergonode`, `pim_unopim`, `comarch_xl` and
 * `product_feeds`, which under D-257 stopped reading the registry — the module
 * asserts the classification it declares over its own entity sources, and
 * `check-entity-tenant-classification`'s package-scope host asserts that exactly
 * one survived into the artefact the platform loads — and then moved beside
 * their subjects. The four callers left are all legitimately the host's:
 * `integration/invoice_ledger/tenant-isolation.test.ts`,
 * `integration/tenancy/customer-scoped-organization-completeness.test.ts`,
 * `unit/tenancy/transitive-parent-chains.test.ts` and
 * `unit/tenancy/transitive-parent-module-ownership.test.ts`. Commands, and both
 * matter because they answer different questions:
 * `git grep -l "src/tenancy/org-scoped.decorator.js" -- backend/test
 * backend/scripts` for the consumer set, and `git grep -l
 * "tenantClassifications()" -- backend/test` for the callers — the second
 * over-counts by one, `unit/harness/workspace-package-externalization.test.ts`
 * naming the accessor in prose rather than calling it.
 *
 * **And the move cannot supply an address either**, which is the larger half and
 * the reason this is a finding rather than an arithmetic slip.
 * `@endora-commerce/cli` declares no dependency on the host, and no subpath the
 * host's `exports` map declares — published or host-internal — carries any of the
 * five names. A relocated analysis therefore takes the derivation as a
 * **parameter** from the runner that stays in `backend/scripts`, so the reach is
 * where it was and the estate has been given the appearance of an owner rather
 * than an owner. Nor can the symbols follow the checks into the package:
 * `buildErrorTranslationTargets` and `describeErrorCodeCollisions` are called by
 * `packages/platform/src/composition/compose-app.ts`, and `tenantClassifications`
 * is the accessor of a module-scope array the decorators in its own file write.
 *
 * The row rules out the remaining answer — *a symbol published for a check to
 * read would be a surface justified by our own tooling* — so what T119d leaves is
 * an owner's question and not a rewrite. Two candidates, both recorded here so
 * that whoever answers it starts from the measurement: the error-translation
 * derivation is composition machinery by its own header (*"its input is the
 * resolved manifest set, which is a composition-root input"*) and `compose-app.ts`
 * is its first caller, so a **host-internal** `./composition` home for it is
 * T119b's move applied once more and would be justified by composition rather
 * than by tooling; the tenancy registry has no such argument and is T119e's
 * shape, its three names being ones `published-surface.test.ts` refuses
 * individually and by reason.
 */
export const RELATIVE_HOST_REACHES: Readonly<Record<string, LedgeredHostReach>> = {
  // === HELD BY A TEST NAMING A SYMBOL THE PLATFORM DECIDED NOT TO PUBLISH (T119e) ===
  //
  // `NOT_PUBLISHED` and `kernel/index.ts`' own header refuse these by name, each
  // with a written reason. The residue is therefore not a missing platform surface:
  // it is test files doing what a module may not do and escaping notice because
  // they sit in the application's test tree, where this check's module half cannot
  // see them. The remedy is a capability on `@endora-commerce/test-kit`, never a
  // re-export from it — the kit is public and is a `devDependency` by construction,
  // so a re-export would be D-160.8 defeated by going round it. Owned by
  // `specs/109-backend-test-kit/`; T119e is the criterion.

  'backend/src/kernel/lifecycle/effective-state.ts|packages/platform/src/kernel/lifecycle/effective-state.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/lifecycle/effective-state.ts`. ' +
      'The declared barrels carry `effectiveState`, `toModulePresenceDto`, and none of ' +
      '`ModuleEffectiveState`. What holds it open is T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/kernel/lifecycle/plugin-helpers.ts|packages/platform/src/kernel/lifecycle/plugin-helpers.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/lifecycle/plugin-helpers.ts`. ' +
      'The declared barrels carry `ModuleDisabledError`, `requireModuleEnabled`, ' +
      '`rethrowIfModuleDisabled`, and none of `defineModuleRoutes`, `defineModuleWorker`, ' +
      '`pauseWorkersFor`, `resetModuleWorkersForTesting`, `resumeWorkersFor`, ' +
      '`subscribeForModule`. What holds it open is T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/kernel/sales-channels/sales-channel-membership.service.ts|packages/platform/src/kernel/sales-channels/sales-channel-membership.service.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/sales-channels/sales-channel-membership.service.ts`. ' +
      'The declared barrels carry `MembershipMutationOptions`, `MembershipMutationResult`, ' +
      'and none of `SalesChannelMembershipService`. What holds it open is T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/kernel/sales-channels/sales-channel-resolver.service.ts|packages/platform/src/kernel/sales-channels/sales-channel-resolver.service.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/sales-channels/sales-channel-resolver.service.ts`. The ' +
      'declared barrels carry `ResolverError`, `parseHostMap`, and none of ' +
      '`SalesChannelResolverService`. What holds it open is T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/kernel/settings/manifest-reconciler.ts|packages/platform/src/kernel/settings/manifest-reconciler.ts': {
    reason:
      'a re-export shim over ' +
      '`packages/platform/src/kernel/settings/manifest-reconciler.ts`. The declared barrels ' +
      'carry `ManifestReconciler` (./composition), and none of `BreakingChangeRejected`, ' +
      '`GroupCodeConflict`, `ManifestSchemaInvalid`, `SettingCodeConflict`. What holds it ' +
      'open is T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/kernel/settings/secret-value-codec.ts|packages/platform/src/kernel/settings/secret-value-codec.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/settings/secret-value-codec.ts`. ' +
      'The declared barrels carry `SecretKeyInvalid`, `SecretKeyMissing`, ' +
      '`encryptSecretValue`, `secretValueIsSet`, and none of `isSecretEnvelope`. What holds ' +
      'it open is T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/kernel/settings/settings-cache.ts|packages/platform/src/kernel/settings/settings-cache.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/settings/settings-cache.ts`. The ' +
      'declared barrels carry `SETTINGS_CACHE_KEY_PREFIX`, `SETTINGS_CACHE_NAMESPACE`, ' +
      '`SettingsCacheInvalidation`, and none of `SettingsCache`. What holds it open is ' +
      'T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/kernel/settings/settings.service.ts|packages/platform/src/kernel/settings/settings.service.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/settings/settings.service.ts`. ' +
      'The declared barrels carry `SettingNotRegistered`, `SettingOutOfScopeForChannel`, ' +
      '`SettingValueShapeMismatch`, `SettingsChannelIdInvalid`, and none of ' +
      '`SettingsReadResult`, `SettingsService`. What holds it open is T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/tenancy/escape-hatch.ts|packages/platform/src/tenancy/escape-hatch.ts': {
    reason:
      'a re-export shim over `packages/platform/src/tenancy/escape-hatch.ts`. The declared ' +
      'barrels carry `withSystemScope`, and none of `EscapeHatchAuditRecord`, ' +
      '`setEscapeHatchAuditSink`. What holds it open is T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/tenancy/filters.ts|packages/platform/src/tenancy/filters.ts': {
    reason:
      'a re-export shim over `packages/platform/src/tenancy/filters.ts`, which no declared ' +
      'barrel carries: no subpath the `exports` map declares answers for ' +
      '`CUSTOMER_ORGANIZATION_KEY`, `CUSTOMER_TENANT_KEY`, `customerFilterCond`, ' +
      '`orgFilterCond`. What holds it open is T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/tenancy/tenant-context.ts|packages/platform/src/tenancy/tenant-context.ts': {
    reason:
      'a re-export shim over `packages/platform/src/tenancy/tenant-context.ts`. The ' +
      'declared barrels carry `MissingTenantContextError`, `TenantContext`, ' +
      '`getTenantContext`, and none of `enterTenantContext`, `runInTenantContext`, ' +
      '`runWithTenantContext`, `runWithoutTenantContext`; a namespace or side-effect reach ' +
      'takes the file whole. What holds it open is T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },

  // === HOLDER RE-DERIVED, AND THE ANSWER WAS T119e ALONE ===
  //
  // Same state as the group above and a different history: each of these four was
  // recorded as held by a task of this group *as well as* by T119e, and in each
  // case the extra holder did not survive being re-derived over the tree. The
  // heading used to read *"held by more than one"* and was the derived claim it
  // warned about — T119b's and T119d's re-derivations emptied it while it went on
  // saying otherwise (D-100), which is why what a group records is now its own
  // sentence rather than a count of the rows under it.
  //
  // A shim is deleted when its **last** consumer has an address, so the question
  // an entry answers is never *"is a task about to move a consumer"* but *"is any
  // symbol left that something else names"*. T119d is the worked example and is
  // written out in the two entries that carry it: moving a check out of
  // `backend/scripts` takes one symbol out of each holder set and no file out of
  // either consumer set, because every other name that check reaches for is a name
  // a test under `backend/test/**` reaches for too.

  'backend/src/kernel/i18n/error-translation.ts|packages/platform/src/kernel/i18n/error-translation.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/i18n/error-translation.ts`, ' +
      'which no declared barrel carries: no subpath the `exports` map declares answers for ' +
      '`ErrorCodeCollision`, `ErrorCodeDeclarationSource`, `ErrorTranslationTarget`, ' +
      '`buildErrorTranslationTargets`, `describeErrorCodeCollisions`. **T119d does not ' +
      'retire it and this entry no longer names it**, which is a re-derivation over the ' +
      'branch tree and not a relay. T119d moves the one `backend/scripts` consumer; of the ' +
      'three symbols that consumer names, exactly one — `ErrorCodeCollision` — is named by ' +
      'nothing else. `buildErrorTranslationTargets` is named by five files under ' +
      '`backend/test/**` and `describeErrorCodeCollisions` by two, so moving the script ' +
      'takes one symbol out of the holder set and no file out of the consumer set, and a ' +
      'shim is deleted when its **last** consumer has an address. The second half of the ' +
      're-derivation is why no address arrives with the move: `@endora-commerce/cli` ' +
      'declares no dependency on the host and no declared subpath, published or ' +
      'host-internal, carries any of these five names, so the relocated analysis takes the ' +
      'derivation as a parameter and the reach stays where it was. What holds it open is ' +
      'T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/kernel/lifecycle/registry-cache.ts|packages/platform/src/kernel/lifecycle/registry-cache.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/lifecycle/registry-cache.ts`. ' +
      'The declared barrels carry `publishStateChanged` (./composition), `registryCache` ' +
      '(./composition), and none of `FALLBACK_TTL_MS`, `ModulePresenceNotLoadedError`, ' +
      '`ModuleRegistryCache`, `STATE_CHANGED_CHANNEL`; a namespace or side-effect reach ' +
      'takes the file whole. What holds it open: T119e, for all four. **T119b deliberately ' +
      'did not put `ModuleRegistryCache` on `./composition`**, which its own row named as a ' +
      'candidate. The barrel is held to its consumers in both directions, so a name goes on ' +
      'it only with the rewrite that gives it one — and rewriting the seven integration ' +
      'reaches of `ModuleRegistryCache` would have left this shim standing for the other ' +
      'three symbols and moved `ledger-size` by nothing. What those seven tests want is a ' +
      'handle on the composed registry, which is the capability T119e puts on ' +
      '`@endora-commerce/test-kit`.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/kernel/scope.ts|packages/platform/src/kernel/scope.ts': {
    reason:
      'a re-export shim over `packages/platform/src/kernel/scope.ts`. The declared barrels ' +
      'carry `enterSystemScope`, and none of `enterPlatformScope`, ' +
      '`getCurrentPlatformScope`, `openPlatformScopeCount`; a namespace or side-effect ' +
      'reach took the file whole until T119b re-pointed it: `scripts/acceptance/' +
      'instance-probe.ts` destructures `enterSystemScope` out of three `await import()`s, ' +
      'and that name is on `./kernel`, so the reach was a rewrite and not a surface ' +
      'question. What holds the entry open now is T119e alone, for `enterPlatformScope`, ' +
      '`getCurrentPlatformScope` and `openPlatformScopeCount` — three names `NOT_PUBLISHED` ' +
      'refuses by name.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
  },
  'backend/src/tenancy/org-scoped.decorator.ts|packages/platform/src/tenancy/org-scoped.decorator.ts': {
    reason:
      'a re-export shim over `packages/platform/src/tenancy/org-scoped.decorator.ts`. The ' +
      'declared barrels carry `CustomerScoped`, `GlobalEntity`, `OrgScoped`, `RuleScoped`, ' +
      '`TransitivelyScoped`, and none of `ScopeClass`, `UnresolvableTenantParentError`, ' +
      '`assertTransitiveParentsResolve`, `resolveTransitiveParent`, ' +
      '`tenantClassifications`. **T119d does not retire it and this entry no longer names ' +
      'it**, on the same re-derivation as the `error-translation.ts` entry above. T119d ' +
      'moves the one `backend/scripts` consumer, `lib/package-declarations.ts`, which names ' +
      '`tenantClassifications` and `ScopeClass`; `tenantClassifications` is called by four ' +
      'further files under `backend/test/**`, so only `ScopeClass` leaves the holder set ' +
      'and no file leaves the consumer set. **That was seven until D-257**, which took the ' +
      'six module-owned tenancy tests out of the caller set without publishing anything; ' +
      'the shrink and both derivation commands are in the header above, because nothing a ' +
      'targeted run reaches names this entry. Nor can the registry itself move to the estate ' +
      'that reads it: `tenantClassifications` is the accessor of a module-scope array the ' +
      'decorators in that same file write, and reading a classification recorded in some ' +
      'other copy of it is reading a classification the global filters never apply. ' +
      '`published-surface.test.ts` refuses all three registry names by name, each with its ' +
      'own reason. What holds it open is T119e.',
    retiredBy:
      '`specs/110-instance-repository/` T119e — `@endora-commerce/test-kit` grows the ' +
      'capability the test asks for, so no test names a symbol the platform decided not to ' +
      'publish',
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
