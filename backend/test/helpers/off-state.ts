import { expect } from 'vitest';
import type { InjectOptions } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Setting } from '@endora-commerce/platform/kernel';
import { effectiveState } from '../../src/kernel/lifecycle/effective-state.js';
import { registryCache } from '../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../src/lifecycle/registered-manifests.js';

/**
 * Shared off-state harness — feature 073, FR-052 / Constitution XVII.
 *
 * Every module ships a test proving that while it is off it is absent from
 * every surface, that its configuration is not editable, and that switching it
 * back on restores everything. That is ~66 tests, so the shape of *this* file
 * decides whether the suite survives them.
 *
 * Two rules follow from that, and neither is negotiable:
 *
 *  1. **It never boots a server.** It flips state against the one the caller
 *     already has, through `registryCache.__setEnabledForTesting`, which
 *     touches neither Redis nor the database. 555 of 908 backend test files
 *     already call `setupBackendServer()` under `singleFork: true`, and the
 *     measured baseline reaches PostgreSQL's `max_connections` partway through
 *     the run (`specs/073-lifecycle-gating-completion/baseline.md`). There is
 *     no headroom to spend.
 *  2. **It drives both axes.** A module that is *platform-available but
 *     deactivated* is the case an operator actually creates, and until this
 *     feature no seam could even see it. Asserting only the platform axis
 *     would pass on code that ignores activation entirely.
 *
 * Rule 2 has one exception since feature 074, and it is asserted rather than
 * skipped. A module that declares itself `nonDeactivatable` has no operator
 * axis to drive: `effectiveState` forces it activated whatever the activation
 * map holds, so seeding a deactivation would leave the module **present** and
 * every assertion under it would be measuring the module switched on. The
 * harness therefore proves the door is shut — the module stays present under a
 * seeded deactivation — and then drives the platform axis, which a deployment
 * that never installs the module still reaches. A caller gets that behaviour
 * from the manifest; there is no flag to pass and no way to ask for the wrong
 * one.
 *
 * The caller declares the surfaces; the harness refuses to run against an
 * empty declaration, so an off-state test cannot pass vacuously.
 */

/**
 * Which axis is being driven off. Both produce absence; they are not
 * interchangeable, because a `nonDeactivatable` module has no off state on the
 * operator axis at all.
 */
export type OffStateAxis = 'deactivated' | 'platform-unavailable';

/**
 * Run `body` with `moduleId` genuinely off on `axis`, and restore afterwards.
 *
 * The point of this helper is the line in the middle: after the flip it asserts
 * that the module **is** absent, before the body observes anything. Issue #141
 * is what that line is for — four tests seeded an off state that never took and
 * then asserted behaviour a switched-*on* module produces anyway, so all four
 * were green while measuring nothing:
 *
 *  - `{ deactivated: ['admin_users'] }` is inert. The module declares itself
 *    `nonDeactivatable`, so `ModuleEffectiveState` returns `true` for its
 *    operator axis whatever is stored — the seed wrote a value nothing reads.
 *  - an *exemption* test ("this surface keeps answering while its module is
 *    off") asserts the same outcome in both states by construction, so the flip
 *    going inert is invisible to it. The positive control is the only thing
 *    that can tell the two apart.
 *
 * Misuse throws rather than failing an expectation: asking for the operator
 * axis of a module that has none is a wiring mistake in the test, and the
 * message says which axis to use instead.
 */
export async function withModuleOff<T>(
  moduleId: string,
  axis: OffStateAxis,
  body: () => Promise<T> | T,
): Promise<T> {
  const baseline = registryCache.enabledIds();
  if (!baseline.includes(moduleId)) {
    throw new Error(
      `[off-state] "${moduleId}" is not enabled before the test runs, so ` +
        `switching it off proves nothing. Seed the registry cache first.`,
    );
  }
  if (axis === 'deactivated' && registryCache.activationDeclaration(moduleId)?.settingCode === null) {
    throw new Error(
      `[off-state] "${moduleId}" declares itself non-deactivatable, so the ` +
        `operator axis has no off state for it and seeding one changes nothing. ` +
        `Drive the platform axis instead: withModuleOff('${moduleId}', 'platform-unavailable', …).`,
    );
  }

  if (axis === 'deactivated') {
    registryCache.__setEnabledForTesting(baseline, { deactivated: [moduleId] });
  } else {
    registryCache.__setEnabledForTesting(baseline.filter((id) => id !== moduleId));
  }

  try {
    expect(
      effectiveState.isPresent(moduleId),
      `[off-state:${axis}] "${moduleId}" is still present after the flip — ` +
        `whatever the body asserts, it is not measuring an off module`,
    ).toBe(false);
    if (axis === 'deactivated') {
      // The axes are orthogonal: the case Constitution XVII calls out by name
      // is the one where the platform still offers the module.
      expect(
        effectiveState.presence(moduleId)?.platformAvailable,
        `[off-state:deactivated] "${moduleId}" lost its platform axis too — ` +
          `that is the other case, and it is asserted separately`,
      ).toBe(true);
    }
    return await body();
  } finally {
    registryCache.__setEnabledForTesting(baseline);
  }
}

/** A request to make while the module is off. A bare string means `GET`. */
export interface OffStateProbe {
  method?: InjectOptions['method'];
  url: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  payload?: unknown;
}

export interface OffStateSurfaces {
  /**
   * Routes the module owns — admin and storefront alike. Each must answer the
   * `MODULE_DISABLED` envelope while off and stop doing so once restored.
   * Required and non-empty.
   */
  readonly routes: readonly (string | OffStateProbe)[];
  /**
   * The admin presence projection (`GET /api/v1/admin/module-presence`). Give
   * it the admin's session cookies; the module must be reported absent while
   * off and present again after restoration.
   */
  readonly adminPresence?: { readonly cookies: Record<string, string> };
  /**
   * One ordinary (non-activation) setting the module owns. Writing it while
   * the module is off must be refused — Constitution XVII counts an editable
   * configuration surface as the module still being observable. The module's
   * own activation control is the single exception and is covered by the
   * activation endpoint's own contract test, not here.
   */
  readonly settingWrite?: {
    readonly code: string;
    readonly value: unknown;
    readonly cookies: Record<string, string>;
  };
}

/**
 * The two surfaces the harness reads. `permissionCatalogueService` is optional
 * only because the harness's own unit test drives a bare `{ app }` fixture;
 * every real caller passes the `BackendServerHandle`, which carries it, so the
 * catalogue sweep runs everywhere it can mean something rather than everywhere
 * somebody remembered to ask for it.
 */
interface ServerLike {
  app: {
    inject(opts: InjectOptions): Promise<{
      statusCode: number;
      headers: Record<string, unknown>;
      json(): { error?: { code?: string } };
    }>;
  };
  permissionCatalogueService?: {
    listAssignable(): ReadonlyArray<{ code: string }>;
    listOwnedCodes(moduleId: string): string[];
  };
}

/**
 * Whether the module's own manifest closes the operator axis (feature 074).
 * Read from the manifest rather than taken as an argument: a caller who could
 * assert the wrong axis would eventually assert the wrong axis.
 */
function isCore(moduleId: string): boolean {
  const activation = REGISTERED_MANIFESTS.find(
    (entry) => entry.manifest.id === moduleId,
  )?.manifest.activation;
  return activation !== undefined && 'nonDeactivatable' in activation;
}

function toInject(probe: string | OffStateProbe): InjectOptions {
  const p: OffStateProbe = typeof probe === 'string' ? { url: probe } : probe;
  return {
    method: p.method ?? 'GET',
    url: p.url,
    ...(p.headers ? { headers: p.headers } : {}),
    ...(p.cookies ? { cookies: p.cookies } : {}),
    ...(p.payload !== undefined ? { payload: p.payload as InjectOptions['payload'] } : {}),
  } as InjectOptions;
}

function label(probe: string | OffStateProbe): string {
  const p: OffStateProbe = typeof probe === 'string' ? { url: probe } : probe;
  return `${p.method ?? 'GET'} ${p.url}`;
}

async function expectRoutesRefused(
  server: ServerLike,
  moduleId: string,
  surfaces: OffStateSurfaces,
  phase: string,
): Promise<void> {
  for (const probe of surfaces.routes) {
    const res = await server.app.inject(toInject(probe));
    expect(
      res.statusCode,
      `[off-state:${phase}] ${label(probe)} should refuse while "${moduleId}" is off`,
    ).toBe(503);
    expect(
      res.json().error?.code,
      `[off-state:${phase}] ${label(probe)} should carry the MODULE_DISABLED envelope`,
    ).toBe('MODULE_DISABLED');
    expect(
      res.headers['retry-after'],
      `[off-state:${phase}] ${label(probe)} should tell a client when to come back`,
    ).toBe('60');
  }
}

async function expectRoutesAnswering(
  server: ServerLike,
  moduleId: string,
  surfaces: OffStateSurfaces,
  phase: string,
): Promise<void> {
  for (const probe of surfaces.routes) {
    const res = await server.app.inject(toInject(probe));
    // The route may legitimately answer 401/404/422 for the probe's payload —
    // what it must not do is claim the module is absent.
    expect(
      res.json().error?.code,
      `[off-state:${phase}] ${label(probe)} should not report "${moduleId}" as disabled`,
    ).not.toBe('MODULE_DISABLED');
  }
}

async function expectPresenceReports(
  server: ServerLike,
  moduleId: string,
  surfaces: OffStateSurfaces,
  present: boolean,
  phase: string,
): Promise<void> {
  if (!surfaces.adminPresence) return;
  const res = await server.app.inject({
    method: 'GET',
    url: '/api/v1/admin/module-presence',
    cookies: surfaces.adminPresence.cookies,
  });
  expect(
    res.statusCode,
    `[off-state:${phase}] the admin presence projection must answer`,
  ).toBe(200);
  const body = res.json() as unknown as { modules?: Array<{ id: string; present: boolean }> };
  const entry = body.modules?.find((m) => m.id === moduleId);
  expect(entry, `[off-state:${phase}] "${moduleId}" missing from the presence projection`).toBeDefined();
  expect(
    entry?.present,
    `[off-state:${phase}] the admin must resolve "${moduleId}" as ${present ? 'present' : 'absent'}`,
  ).toBe(present);
}

/**
 * Constitution XVII item 5, on the surface it had never been checked on: a
 * module that is off contributes **no permission** to `/admin-roles`.
 *
 * This is issue #213's obligation, and it is asserted automatically rather than
 * declared per module for the reason the whole file exists — an off-state
 * obligation a caller has to opt into is an off-state obligation half the
 * callers will not opt into. `listOwnedCodes` is read from the catalogue rather
 * than from the manifest, because a module's codes are not all in its manifest:
 * `blog.read`, `orders:write` and thirteen others live in the core
 * `PERMISSION_CATALOGUE`, and a manifest-only sweep would have measured nothing
 * for exactly the modules the defect was reported against.
 *
 * A **shared** code is excluded while it still has a present owner:
 * `integrations:manage` gates both `api_keys` and `webhooks`, and switching one
 * of them off must leave the other's gate grantable. The exclusion is computed
 * from the live presence set rather than listed, so a second owner added later
 * is handled without editing this file.
 *
 * A module that owns no code of its own is skipped, and that is honest rather
 * than vacuous: there is nothing for it to contribute either way.
 */
function expectPermissionCatalogueReflects(
  server: ServerLike,
  moduleId: string,
  grantable: boolean,
  phase: string,
): void {
  const catalogue = server.permissionCatalogueService;
  if (!catalogue) return;
  const ownedByAnotherPresentModule = new Set(
    registryCache
      .enabledIds()
      .filter((id) => id !== moduleId && effectiveState.isPresent(id))
      .flatMap((id) => catalogue.listOwnedCodes(id)),
  );
  const exclusive = catalogue
    .listOwnedCodes(moduleId)
    .filter((code) => !ownedByAnotherPresentModule.has(code));
  if (exclusive.length === 0) return;

  const assignable = new Set(catalogue.listAssignable().map((entry) => entry.code));
  if (grantable) {
    expect(
      exclusive.filter((code) => !assignable.has(code)),
      `[off-state:${phase}] "${moduleId}" owns these codes but /admin-roles does not offer them`,
    ).toEqual([]);
  } else {
    expect(
      exclusive.filter((code) => assignable.has(code)),
      `[off-state:${phase}] "${moduleId}" is off, so /admin-roles must not offer ` +
        `its permission codes (Constitution XVII item 5)`,
    ).toEqual([]);
  }
}

async function expectSettingWriteRefused(
  server: ServerLike,
  moduleId: string,
  surfaces: OffStateSurfaces,
  phase: string,
): Promise<void> {
  if (!surfaces.settingWrite) return;
  const res = await server.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/settings/${surfaces.settingWrite.code}/value`,
    cookies: surfaces.settingWrite.cookies,
    payload: { value: surfaces.settingWrite.value },
  });
  expect(
    res.statusCode,
    `[off-state:${phase}] "${surfaces.settingWrite.code}" must not be editable while "${moduleId}" is off`,
  ).toBeGreaterThanOrEqual(400);
}

/**
 * Assert that `moduleId` is absent on every declared surface while it is off —
 * on **each axis independently** — and fully restored afterwards.
 *
 * The `/admin-roles` permission catalogue is swept on every call and takes no
 * declaration: issue #213 found all 65 modules contributing their codes to it
 * while deactivated, and the reason it went unnoticed is that this harness had
 * never looked at that surface. See `expectPermissionCatalogueReflects`.
 *
 * ```ts
 * await expectModuleAbsent(server, 'pim_ergonode', {
 *   routes: ['/api/v1/admin/pim-ergonode/connection'],
 *   adminPresence: { cookies: ADMIN.cookies },
 * });
 * ```
 *
 * The registry state is restored even if an assertion fails, so one red
 * off-state test cannot cascade into every file that runs after it.
 */
/**
 * Seed the **platform** axis off for `moduleId` while its **operator** axis stays on, so a
 * test can assert that the two are reported separately.
 *
 * ## Why this needs a helper at all
 *
 * `__setEnabledForTesting(ids)` seeds the operator axis only for the ids it is given, so a
 * module left out of the list has no stored activation value and falls back to its
 * **manifest default**. Three off-state tests relied on that fallback being `true` to get
 * "platform off, operator on" — the one combination that makes the Admin UI's distinction
 * between *"not installed here"* and *"we turned it off"* visible. When feature 132 flipped
 * those three connectors to `default: false` (FR-017), the fallback became `false`, both
 * axes read off, and the case stopped distinguishing anything while still passing its first
 * two assertions.
 *
 * So the operator axis is **arranged** here rather than inherited: an explicit
 * `global_value = true` row, then `__refreshActivationForTesting`, which is the same seam
 * the activation route's propagation uses. A test that says what it needs cannot be
 * changed by a default moving underneath it.
 */
export async function withPlatformAxisOffOnly(opts: {
  readonly em: () => EntityManager;
  readonly moduleId: string;
  /** Every module id the cache should hold — the caller's `ALL_IDS`. */
  readonly allModuleIds: readonly string[];
}): Promise<void> {
  const settingCode = effectiveState.activationSettingCode(opts.moduleId);
  if (settingCode === null) {
    throw new Error(
      `'${opts.moduleId}' declares no activation control, so it has no operator axis to ` +
        'keep on — this helper is for a module that does.',
    );
  }

  await opts
    .em()
    .nativeUpdate(Setting, { code: settingCode }, { globalValue: true });

  // Platform axis: everything except the subject. This resets the operator axis, which is
  // why the refresh below has to come after it.
  registryCache.__setEnabledForTesting(
    opts.allModuleIds.filter((id) => id !== opts.moduleId),
  );
  await registryCache.__refreshActivationForTesting(opts.em);
}

export async function expectModuleAbsent(
  server: ServerLike,
  moduleId: string,
  surfaces: OffStateSurfaces,
): Promise<void> {
  if (surfaces.routes.length === 0) {
    throw new Error(
      `[off-state] "${moduleId}" declared no routes. An off-state test that ` +
        `asserts nothing passes vacuously — list the module's routes.`,
    );
  }
  const baseline = registryCache.enabledIds();
  if (!baseline.includes(moduleId)) {
    throw new Error(
      `[off-state] "${moduleId}" is not enabled before the test runs, so ` +
        `switching it off proves nothing. Seed the registry cache first.`,
    );
  }

  try {
    // Precondition: the module answers to begin with. Without this an
    // always-broken route would read as a successful absence.
    await expectRoutesAnswering(server, moduleId, surfaces, 'before');
    await expectPresenceReports(server, moduleId, surfaces, true, 'before');
    expectPermissionCatalogueReflects(server, moduleId, true, 'before');

    // Axis 1 — the operator switched it off; the platform still offers it.
    // This is the case Constitution XVII calls out by name.
    if (isCore(moduleId)) {
      // …except that this module declares itself non-deactivatable, so seeding
      // an activation value does nothing and the assertion worth making is that
      // it does nothing. Anything else here would be a green measured with the
      // module running. `withModuleOff` refuses this axis for a core module by
      // design (issue #141), so the seeding stays inline — the point is that the
      // flip is inert, which is precisely what the helper will not let a caller
      // assume elsewhere.
      registryCache.__setEnabledForTesting(baseline, { deactivated: [moduleId] });
      expect(
        effectiveState.isPresent(moduleId),
        `[off-state:deactivated] "${moduleId}" declares itself non-deactivatable, so no ` +
          `seeded activation value may make it absent`,
      ).toBe(true);
      await expectRoutesAnswering(server, moduleId, surfaces, 'deactivated');
      expectPermissionCatalogueReflects(server, moduleId, true, 'deactivated');
      registryCache.__setEnabledForTesting(baseline);
    } else {
      // `withModuleOff` asserts the flip actually took before anything observes
      // a surface (issue #141), and restores in its own `finally`.
      await withModuleOff(moduleId, 'deactivated', async () => {
        await expectRoutesRefused(server, moduleId, surfaces, 'deactivated');
        await expectPresenceReports(server, moduleId, surfaces, false, 'deactivated');
        await expectSettingWriteRefused(server, moduleId, surfaces, 'deactivated');
        expectPermissionCatalogueReflects(server, moduleId, false, 'deactivated');
      });
    }

    // Axis 2 — the deployment does not offer it at all. This one holds for every
    // module, `nonDeactivatable` included: that declaration binds the operator
    // axis, not the platform's.
    await withModuleOff(moduleId, 'platform-unavailable', async () => {
      await expectRoutesRefused(server, moduleId, surfaces, 'platform-unavailable');
      await expectPresenceReports(server, moduleId, surfaces, false, 'platform-unavailable');
      await expectSettingWriteRefused(server, moduleId, surfaces, 'platform-unavailable');
      expectPermissionCatalogueReflects(server, moduleId, false, 'platform-unavailable');
    });
  } finally {
    registryCache.__setEnabledForTesting(baseline);
  }

  // Off is non-destructive and reversible: everything answers again.
  await expectRoutesAnswering(server, moduleId, surfaces, 'restored');
  await expectPresenceReports(server, moduleId, surfaces, true, 'restored');
  expectPermissionCatalogueReflects(server, moduleId, true, 'restored');
}
