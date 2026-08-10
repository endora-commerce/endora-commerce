import { expect } from 'vitest';
import type { InjectOptions } from 'fastify';
import { registryCache } from '../../src/modules/_lifecycle/services/registry-cache.js';

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
 * The caller declares the surfaces; the harness refuses to run against an
 * empty declaration, so an off-state test cannot pass vacuously.
 */

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

interface ServerLike {
  app: {
    inject(opts: InjectOptions): Promise<{
      statusCode: number;
      headers: Record<string, unknown>;
      json(): { error?: { code?: string } };
    }>;
  };
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

    // Axis 1 — the operator switched it off; the platform still offers it.
    // This is the case Constitution XVII calls out by name.
    registryCache.__setEnabledForTesting(baseline, { deactivated: [moduleId] });
    await expectRoutesRefused(server, moduleId, surfaces, 'deactivated');
    await expectPresenceReports(server, moduleId, surfaces, false, 'deactivated');
    await expectSettingWriteRefused(server, moduleId, surfaces, 'deactivated');

    // Axis 2 — the deployment does not offer it at all.
    registryCache.__setEnabledForTesting(baseline.filter((id) => id !== moduleId));
    await expectRoutesRefused(server, moduleId, surfaces, 'platform-unavailable');
    await expectPresenceReports(server, moduleId, surfaces, false, 'platform-unavailable');
    await expectSettingWriteRefused(server, moduleId, surfaces, 'platform-unavailable');
  } finally {
    registryCache.__setEnabledForTesting(baseline);
  }

  // Off is non-destructive and reversible: everything answers again.
  await expectRoutesAnswering(server, moduleId, surfaces, 'restored');
  await expectPresenceReports(server, moduleId, surfaces, true, 'restored');
}
