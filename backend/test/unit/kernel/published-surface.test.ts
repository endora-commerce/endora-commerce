/**
 * The platform's published surface, as a two-way ratchet (feature 080, T042c).
 *
 * `specs/080-f4-real-scope/contracts/host-package.md` §1.3 classifies every
 * platform file a module reaches as **P** (the host publishes it), **A**
 * (accidental reach — host-internal, harness-only or orchestrator-only) or
 * **O** (the module is reaching for a class where a port exists). §2.1 turns
 * that classification into an `exports` map with five subpaths, one per
 * publishable directory, each resolving to that directory's barrel. So the
 * barrels *are* the classification, and until the package exists nothing in the
 * repository holds them to it: a name added to `kernel/index.ts` becomes public
 * API of `@endora-commerce/platform` with no review step that knows it did.
 *
 * That is not hypothetical. `ManifestReconciler` sat on the kernel barrel from
 * feature 072 until T042c while §1.3 row 46 classified it **A**, and
 * `AuditLogService` sat there while Principle XIII routes every domain write
 * around it (D-160.10). Neither was noticed by a check, a type or a review.
 *
 * **The ratchet is two-way and deliberately duplicates nothing.** The expected
 * sets below are the *only* place the published surface is written down — the
 * barrel is source, not a second copy — so a name that appears in one and not
 * the other fails, in both directions:
 *
 *  - a symbol exported by a barrel and absent from its set fails, which is what
 *    makes "`AuditLogService` came back" red;
 *  - a symbol in a set and absent from the barrel fails, so a set entry cannot
 *    outlive the export it describes.
 *
 * {@link NOT_PUBLISHED} is the other half and is the one a future author reads:
 * every name T042c took *off* a barrel, with the reason it is not published.
 * A name removed with no reason is a name someone re-adds.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

/**
 * Every name a barrel re-exports, from its source text.
 *
 * Deliberately a parse of the file rather than a dynamic `import()` of it:
 * `import()` cannot see a type-only export at all, and more than half of a
 * port-based surface is types. It would report a green over a surface it is
 * blind to.
 */
function barrelExports(relativePath: string): string[] {
  const text = readFileSync(join(SRC, relativePath), 'utf8');
  const names: string[] = [];
  for (const block of text.matchAll(/export\s*\{([^}]*)\}\s*from\s*'[^']+'/gs)) {
    for (const raw of (block[1] ?? '').split(',')) {
      const written = raw.trim();
      if (written === '') continue;
      // `type X`, `X as Y`, `type X as Y` — the exported name is the tail.
      const name = written
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name !== undefined && name !== '') names.push(name);
    }
  }
  return names;
}

/**
 * `src/kernel/index.ts` — the `./kernel` subpath.
 *
 * Grouped by the source file, because that is the granularity §1.3 classifies
 * at and the granularity a reviewer can check. Every group cites its row, and a
 * group whose file is **P** still lists only the symbols a module takes plus
 * the parameter, return and error types of the port methods it publishes: a
 * published method whose thrown error or argument shape is unpublished is a
 * method a consumer cannot call (§8's "the errors and parameter types stay
 * published").
 */
const PUBLISHED_KERNEL_SURFACE: Readonly<Record<string, readonly string[]>> = {
  /** Row 6 — what 66 modules take through the barrel today. */
  'module-context.js': ['ModuleContext'],
  'lazy-port.js': ['lazyPort'],
  /**
   * Row 6's "+4" includes both readers; the error is what
   * `resolvePublicApiBaseUrl` throws in production (issue #218), so a caller
   * cannot handle the refusal without it.
   */
  'public-api-base-url.js': [
    'PublicApiBaseUrlNotConfiguredError',
    'configuredPublicApiBaseUrl',
    'resolvePublicApiBaseUrl',
  ],
  /** Row 11. */
  'lifecycle/effective-state.js': ['effectiveState', 'toModulePresenceDto'],
  /** Row 7, the **P** half of the by-symbol split (§1.4c). */
  'lifecycle/plugin-helpers.js': [
    'ModuleDisabledError',
    'rethrowIfModuleDisabled',
    'requireModuleEnabled',
    'WorkerLogger',
  ],
  /** Row 13. */
  'scope.js': ['enterSystemScope'],
  /**
   * D-160.10 — the port replaces the class. `RecordAuditInput` and
   * `AuditLogFilter` are the argument shapes of its own methods.
   */
  'ports/audit.js': ['AuditPort', 'RecordAuditInput', 'AuditLogFilter'],
  /** Row 37 — the return shape of every {@link AuditPort} method. */
  'audit/audit-log-entry.entity.js': ['AuditLogEntry'],
  /** Row 44; `InProcessCacheLayer` is what a caller registers. */
  'cache/in-process-cache-registry.js': [
    'InProcessCacheRegistry',
    'inProcessCaches',
    'InProcessCacheLayer',
  ],
  /** Rows 20 and 38. */
  'crypto/password-hasher.js': ['hashPassword', 'verifyPassword'],
  'crypto/totp.js': ['enroll', 'verifyTotp'],
  /** Row 9 — the singleton case (§3). */
  'sales-channels/sales-channel.entity.js': ['SalesChannel'],
  /** Row 34 — the four symbols modules take. */
  'sales-channels/sales-channels-cache.js': [
    'SalesChannelsCache',
    'SalesChannelsCacheInvalidation',
    'SALES_CHANNELS_CACHE_KEY_PREFIX',
    'SALES_CHANNELS_CACHE_NAMESPACE',
  ],
  /** Row 24 is **O**; these two are not the class (§1.4e, §8). */
  'sales-channels/sales-channel-resolver.service.js': ['parseHostMap', 'ResolverError'],
  /** Row 52. */
  'sales-channels/no-system-default-channel.error.js': ['NoSystemDefaultChannel'],
  /** Row 15 is **O**; these two are `SalesChannelMembershipPort`'s own shapes. */
  'sales-channels/sales-channel-membership.service.js': [
    'MembershipMutationOptions',
    'MembershipMutationResult',
  ],
  /** Row 14. */
  'sales-channels/sales-channel-resolver.middleware.js': [
    'getResolvedChannel',
    'currentSalesChannel',
  ],
  /** Row 29. */
  'sales-channels/request-channel-assortment.js': [
    'productIdsInRequestChannel',
    'outOfRequestChannel',
  ],
  /** Rows 22, 36, 25. */
  'settings/setting.entity.js': ['Setting'],
  'settings/setting-group.entity.js': ['SettingGroup'],
  'settings/setting-value.entity.js': ['SettingValue'],
  /** Row 8 is **O**; the four errors are what a `settingsReadPort` caller catches. */
  'settings/settings.service.js': [
    'SettingNotRegistered',
    'SettingOutOfScopeForChannel',
    'SettingValueShapeMismatch',
    'SettingsChannelIdInvalid',
  ],
  /** Row 35 — the three symbols modules take. */
  'settings/settings-cache.js': [
    'SettingsCacheInvalidation',
    'SETTINGS_CACHE_KEY_PREFIX',
    'SETTINGS_CACHE_NAMESPACE',
  ],
  /** Row 39. */
  'settings/secret-value-codec.js': [
    'encryptSecretValue',
    'secretValueIsSet',
    'SecretKeyMissing',
    'SecretKeyInvalid',
  ],
  /** Rows 3, 27, 53, 8-as-a-port, 16 — the port types themselves. */
  'ports/require-admin.js': [
    'AdminPermissionChecker',
    'RequireAdminAnyFactory',
    'RequireAdminFactory',
  ],
  'ports/organizations.js': ['OrganizationReadPort', 'OrganizationSnapshot'],
  'ports/require-customer.js': ['RequireCustomerGuard'],
  'ports/settings.js': ['SettingsReadPort', 'SettingsReadResult'],
  'ports/sales-channel.js': [
    'ResolvedChannel',
    'SalesChannelMembershipPort',
    'SalesChannelResolutionPort',
  ],
};

/** `src/http/index.ts` — the `./http` subpath, as MR !880 built it. */
const PUBLISHED_HTTP_SURFACE: readonly string[] = [
  'HttpError',
  'productAudienceOf',
  'markPersonalisedPricing',
  'StorefrontRevalidator',
  'encodeCursor',
  'decodeCursor',
];

/** `src/events/index.ts` — the `./events` subpath, as MR !880 built it. */
const PUBLISHED_EVENTS_SURFACE: readonly string[] = ['EventBus', 'EventBase'];

/**
 * Every name T042c took off the kernel barrel, and why it is not published.
 *
 * Four reasons, and the distinction is the point of writing them down:
 *
 *  - **composition** — the host's own composition root calls it, once, and a
 *    packaged module never does. D-45 gives a module one registration pass and
 *    one boot phase, both run by the host; there is no shape in which a module
 *    builds a container, composes a module list or opens the request scope.
 *  - **seam-superseded** — the module-facing spelling is a `ModuleContext`
 *    member (`ctx.worker`, `ctx.subscribe`, `ctx.di.providePort`, `ctx.log`).
 *    Publishing the underlying function re-opens by bare specifier a seam the
 *    context closed, which is §1.4c's argument for the worker wrappers and
 *    `check:subscribe-seam`'s for the subscription one.
 *  - **accidental-reach** — §1.3 classifies it **A** outright.
 *  - **unreached** — a symbol of a **P** file that no module takes. §1.3's
 *    verdict is per file and its symbol column is per symbol; publishing the
 *    rest of a P file's exports because the file is P would publish the
 *    internals of every one of them.
 */
const NOT_PUBLISHED: Readonly<Record<string, string>> = {
  // --- composition ------------------------------------------------------
  createRootContainer: 'composition — the host builds the container, once.',
  registerOrm: 'composition — the ORM is a host input; §1.4f keeps `db/` unpublishable.',
  registerValues: 'composition — a root value no module defaults (D-45).',
  getRootContainer: 'composition — the ambient root is the host process, not a module.',
  setRootContainer: 'composition — as above.',
  disposeRootContainer: 'composition — shutdown belongs to the host process.',
  installShutdownDisposal: 'composition — as above.',
  KernelCradle: 'composition — the root container type, not a module context.',
  KernelContainer: 'composition — as above.',
  composeModules: 'composition — the host composes the module list (D-45).',
  ComposedModules: 'composition — the return of `composeModules`.',
  ComposeModulesOptions: 'composition — the argument of `composeModules`.',
  ModuleEntry: 'composition — an entry in the list the host composes.',
  ContributionWindowClosedError:
    'composition — thrown at the root that contributes after the window (D-45).',
  ModuleCompositionError: 'composition — the host attributes a failed boot hook with it.',
  createModuleContext: 'composition — the host constructs the context it hands a module.',
  createModuleRegistrationSink: 'composition — as above.',
  createRegistrationOwnership: 'composition — as above.',
  ModuleContextOptions: 'composition — the argument of `createModuleContext`.',
  ModuleRegistrationSink: 'composition — a `createModuleContext` input.',
  ModuleLifecycleLogger: 'composition — a `createModuleContext` input.',
  RegistrationOwnership: 'composition — a `createModuleContext` input.',
  requiredModulesFrom: 'composition — `composeModules` refuses before a module registers.',
  absentRequiredModules: 'composition — as above.',
  assertRequiredModulesPresent: 'composition — as above.',
  RequiredModuleAbsentError: 'composition — the refusal is the host’s, before boot.',
  RequiredModule: 'composition — a `requiredModulesFrom` shape.',
  RequiredModuleFinding: 'composition — a `requiredModulesFrom` shape.',
  RequiredModulePresence: 'composition — a `requiredModulesFrom` shape.',
  registerRequestScopeHook: 'composition — the host opens the request scope (FR-020).',
  RequestScopeHookOptions: 'composition — the argument of the above.',
  attachPlatformLogger: 'composition — the host attaches the logger to the app.',
  DefaultChannelReconciler: 'composition — root-composed at boot; a module reads the channel.',
  DefaultChannelReconciliationResult: 'composition — the return of the above.',
  registerSalesChannelResolverMiddleware: 'composition — the host registers the middleware.',
  assertPublicApiBaseUrlConfigured:
    'composition — the production refusal at the top of `composeApp()` (issue #218).',

  // --- seam-superseded --------------------------------------------------
  registerPort: 'seam-superseded — a module registers through `ctx.di.providePort`.',
  moduleLogger: 'seam-superseded — a module logs through `ctx.log`.',
  platformLogger: 'seam-superseded — as above.',
  currentPlatformLogger: 'seam-superseded — as above.',
  PlatformLogger: 'seam-superseded — the type of `ctx.log`, reachable through it.',
  DuplicateRegistrationError: 'seam-superseded — raised *at* a module by `ctx.di.register`.',
  ForeignRegistrationError: 'seam-superseded — as above (issue #203).',
  EagerResolutionError: 'seam-superseded — raised at a module resolving during registration.',
  Registration: 'seam-superseded — built through `ctx.asFunction(...)`.',
  RegistrationBuilder: 'seam-superseded — as above.',
  ModuleBootHook: 'seam-superseded — passed to `ctx.onBoot`, whose signature declares it.',

  // --- accidental-reach -------------------------------------------------
  ManifestReconciler: 'accidental-reach — §1.3 row 46; a component does not reach itself.',
  ReconciliationResult: 'accidental-reach — the return of the above.',

  // --- unreached --------------------------------------------------------
  AuditLogService: 'superseded by `AuditPort` (D-160.10) — the class is not published.',
  enterPlatformScope: 'unreached — `enterSystemScope` is the module-facing entry (row 13).',
  getCurrentPlatformScope: 'unreached — no module asks which scope it is in.',
  openPlatformScopeCount: 'unreached — a harness assertion over scope balance.',
  EnterPlatformScopeOptions: 'unreached — the argument of `enterPlatformScope`.',
  PlatformScope: 'unreached — the return of `getCurrentPlatformScope`.',
  SharedDropMarks: 'unreached — the cross-process half of the cache registry.',
  toCachedChannel: 'unreached — how the cache is filled, not how it is read.',
  CachedChannel: 'unreached — as above.',
  SALES_CHANNELS_LRU_TTL_MS: 'unreached — a cache tuning constant no module reads.',
  SETTINGS_LRU_TTL_MS: 'unreached — as above.',
  SettingsCache: 'unreached — a module reads through `settingsReadPort` (§1.4d).',
  SETTING_VALUE_TYPES: 'unreached — the `Setting` column enum, read through the entity.',
  SettingValueTypeDb: 'unreached — as above.',
  decryptSecretValue: 'unreached — the store decrypts; a module writes and asks "is it set?".',
  isSecretEnvelope: 'unreached — as above.',
  SecretEnvelope: 'unreached — as above.',
};

describe('the platform’s published surface', () => {
  it('the kernel barrel exports exactly the classification’s P set', () => {
    const expected = [...new Set(Object.values(PUBLISHED_KERNEL_SURFACE).flat())].sort();
    const actual = [...new Set(barrelExports('kernel/index.ts'))].sort();
    expect(actual).toEqual(expected);
  });

  it('the http barrel exports exactly the six symbols §1.3 marks P', () => {
    expect([...new Set(barrelExports('http/index.ts'))].sort()).toEqual(
      [...PUBLISHED_HTTP_SURFACE].sort(),
    );
  });

  it('the events barrel exports exactly EventBus and EventBase', () => {
    expect([...new Set(barrelExports('events/index.ts'))].sort()).toEqual(
      [...PUBLISHED_EVENTS_SURFACE].sort(),
    );
  });

  /**
   * The named half of the ratchet. The set comparison above already fails when
   * one of these returns, but it fails as a diff of ninety names; this one says
   * which name came back and why it was taken off, which is the sentence the
   * author of that merge request needs.
   */
  it('publishes none of the names T042c removed, and each carries its reason', () => {
    const exported = new Set([
      ...barrelExports('kernel/index.ts'),
      ...barrelExports('http/index.ts'),
      ...barrelExports('events/index.ts'),
    ]);
    const returned = Object.entries(NOT_PUBLISHED)
      .filter(([name]) => exported.has(name))
      .map(([name, reason]) => `${name} — removed because: ${reason}`);
    expect(returned).toEqual([]);
  });

  /**
   * D-160.10, stated on its own so the ruling has a test rather than a row in a
   * list. Publishing the class type freezes into the platform contract the
   * shape Principle XIII routes *around*: a domain write goes through
   * `CommandBus.run`, and the audit row is the bus's to write.
   */
  it('publishes AuditPort and not the AuditLogService class (D-160.10)', () => {
    const exported = barrelExports('kernel/index.ts');
    expect(exported).toContain('AuditPort');
    expect(exported).not.toContain('AuditLogService');
  });

  /**
   * The vacuous-pass guard. Every assertion above is over a parse of a file
   * path; a barrel that moved, was renamed or stopped matching the
   * `export { … } from '…'` shape would make `barrelExports` return `[]`, and
   * an empty set compared against an empty set is a green that read nothing.
   */
  it('read a non-empty barrel for each of the three published directories', () => {
    expect(barrelExports('kernel/index.ts').length).toBeGreaterThan(50);
    expect(barrelExports('http/index.ts').length).toBeGreaterThan(0);
    expect(barrelExports('events/index.ts').length).toBeGreaterThan(0);
  });
});
