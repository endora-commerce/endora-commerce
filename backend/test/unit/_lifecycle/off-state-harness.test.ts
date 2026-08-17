import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from '@fastify/type-provider-zod';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import { defineModuleRoutes } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';
import { activationDeclarationsFrom } from '../../../src/kernel/lifecycle/activation-resolver.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

/**
 * The off-state harness is about to be used by ~66 modules, so it gets its own
 * test — including the case that matters most: it must **fail** against a
 * module that ignores the gate. A harness that cannot go red is worse than no
 * harness, because every conversion after it would report a green vacuously.
 *
 * Deliberately a unit test over a bare Fastify app: no `setupBackendServer`,
 * no database, no Redis. That is the same budget discipline the harness itself
 * exists to enforce.
 */

const GATED = 'fixture_gated';
const UNGATED = 'fixture_ungated';
/**
 * A real module that declares itself non-deactivatable (feature 074). Named
 * rather than invented, because the branch it exercises is selected from
 * `REGISTERED_MANIFESTS`: a fixture id would take the ordinary path and the
 * case would assert nothing.
 */
const CORE = 'audit_logs';

describe('expectModuleAbsent', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorEnvelope(app);
    const gated = defineModuleRoutes(GATED, async (scoped) => {
      scoped.get('/api/v1/admin/fixture-gated/ping', async () => ({ ok: true }));
    });
    await gated(app);
    const core = defineModuleRoutes(CORE, async (scoped) => {
      scoped.get('/api/v1/admin/fixture-core/ping', async () => ({ ok: true }));
    });
    await core(app);
    // The real activation declarations, which a booted server loads before the
    // first module registers. Without them `effectiveState` cannot tell a core
    // module from an unconverted one, and the core branch below would assert
    // the opposite of what it says.
    registryCache.setActivationDeclarations(
      activationDeclarationsFrom(REGISTERED_MANIFESTS.map((entry) => entry.manifest)),
    );
    // The failure mode the ratchet exists to catch: a module that registers
    // its routes outside the wrapper.
    app.get('/api/v1/admin/fixture-ungated/ping', async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(() => {
    registryCache.__setEnabledForTesting([]);
  });

  afterAll(async () => {
    // Put the singleton back the way this file found it: an empty declaration
    // set is what a unit file that never booted a server expects.
    registryCache.setActivationDeclarations([]);
    await app.close();
  });

  it('passes for a module gated at the route-registration seam', async () => {
    registryCache.__setEnabledForTesting([GATED, UNGATED]);
    await expectModuleAbsent({ app }, GATED, {
      routes: ['/api/v1/admin/fixture-gated/ping'],
    });
  });

  it('fails for a module whose routes bypass the wrapper', async () => {
    registryCache.__setEnabledForTesting([GATED, UNGATED]);
    await expect(
      expectModuleAbsent({ app }, UNGATED, {
        routes: ['/api/v1/admin/fixture-ungated/ping'],
      }),
    ).rejects.toThrow(/should refuse while "fixture_ungated" is off/);
  });

  it('restores the registry state even when an assertion fails', async () => {
    registryCache.__setEnabledForTesting([GATED, UNGATED]);
    await expect(
      expectModuleAbsent({ app }, UNGATED, {
        routes: ['/api/v1/admin/fixture-ungated/ping'],
      }),
    ).rejects.toThrow();
    expect(registryCache.enabledIds()).toEqual([GATED, UNGATED]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/fixture-gated/ping' });
    expect(res.statusCode).toBe(200);
  });

  it('refuses an empty surface declaration rather than passing vacuously', async () => {
    registryCache.__setEnabledForTesting([GATED]);
    await expect(expectModuleAbsent({ app }, GATED, { routes: [] })).rejects.toThrow(
      /passes vacuously/,
    );
  });

  it('refuses to run against a module that was never on', async () => {
    registryCache.__setEnabledForTesting([]);
    await expect(
      expectModuleAbsent({ app }, GATED, { routes: ['/api/v1/admin/fixture-gated/ping'] }),
    ).rejects.toThrow(/not enabled before the test runs/);
  });

  it('proves the operator axis is shut for a core module instead of measuring it off', async () => {
    // Feature 074. Seeding a deactivation for a `nonDeactivatable` module leaves
    // it present, so the ordinary path would have asserted a 503 that could
    // never come — and if the harness had simply skipped the axis, the platform
    // half would still have to run. It does both: the closed door is asserted,
    // then the axis a deployment can still reach is driven.
    registryCache.__setEnabledForTesting([GATED, UNGATED, CORE]);
    await expectModuleAbsent({ app }, CORE, {
      routes: ['/api/v1/admin/fixture-core/ping'],
    });
  });

  it('still fails for a core module whose platform axis is not gated', async () => {
    // The core branch must not become a way to pass without a seam. The
    // ungated route is registered outside the wrapper, so the platform half
    // catches it exactly as it does for an ordinary module.
    registryCache.__setEnabledForTesting([GATED, UNGATED, CORE]);
    await expect(
      expectModuleAbsent({ app }, CORE, {
        routes: ['/api/v1/admin/fixture-ungated/ping'],
      }),
    ).rejects.toThrow(/platform-unavailable/);
  });

  it('exercises the deactivated-while-platform-available axis, not just the platform one', async () => {
    // A seam that resolved the platform axis alone would pass the second half
    // of the harness and fail here — which is exactly what T017 changed.
    registryCache.__setEnabledForTesting([GATED], { deactivated: [GATED] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/fixture-gated/ping' });
    expect(res.statusCode).toBe(503);
    expect(registryCache.isEnabled(GATED)).toBe(true);
  });
});

/**
 * Issue #141 — the seeded off state has to be shown to have taken.
 *
 * Every case below is about the same defect from a different side: a test can
 * ask for an off state, be given none, and still go green. `withModuleOff` is
 * where that stops, so its own red proofs live here.
 */
describe('withModuleOff', () => {
  const CORE = 'fixture_non_deactivatable';

  afterEach(() => {
    registryCache.setActivationDeclarations([]);
    registryCache.__setEnabledForTesting([]);
  });

  function declareNonDeactivatable(): void {
    registryCache.setActivationDeclarations([
      {
        moduleId: CORE,
        settingCode: null,
        default: true,
        nonDeactivatableReason: 'the platform cannot run without it',
      },
    ]);
  }

  it('leaves a non-deactivatable module present when the operator axis is seeded off', () => {
    // The defect itself, stated as a fact about the platform rather than about
    // any one test: `{ deactivated: [id] }` writes a value that
    // `ModuleEffectiveState` does not read for such a module.
    declareNonDeactivatable();
    registryCache.__setEnabledForTesting([CORE], { deactivated: [CORE] });
    expect(effectiveState.isPresent(CORE)).toBe(true);
  });

  it('refuses the operator axis for it, naming the axis that does work', async () => {
    declareNonDeactivatable();
    registryCache.__setEnabledForTesting([CORE]);
    await expect(withModuleOff(CORE, 'deactivated', () => undefined)).rejects.toThrow(
      /non-deactivatable[\s\S]*platform-unavailable/,
    );
  });

  it('takes the same module off on the platform axis', async () => {
    declareNonDeactivatable();
    registryCache.__setEnabledForTesting([CORE]);
    await withModuleOff(CORE, 'platform-unavailable', () => {
      expect(effectiveState.isPresent(CORE)).toBe(false);
    });
    expect(effectiveState.isPresent(CORE)).toBe(true);
  });

  it('keeps the platform axis untouched while driving the operator one', async () => {
    registryCache.__setEnabledForTesting([GATED, UNGATED]);
    await withModuleOff(GATED, 'deactivated', () => {
      expect(registryCache.isEnabled(GATED), 'the platform axis moved too').toBe(true);
      expect(effectiveState.isPresent(GATED)).toBe(false);
    });
  });

  it('restores the baseline even when the body throws', async () => {
    registryCache.__setEnabledForTesting([GATED, UNGATED]);
    await expect(
      withModuleOff(GATED, 'deactivated', () => {
        throw new Error('the body failed');
      }),
    ).rejects.toThrow('the body failed');
    expect(registryCache.enabledIds()).toEqual([GATED, UNGATED]);
    expect(effectiveState.isPresent(GATED)).toBe(true);
  });

  it('refuses to run against a module that was never on', async () => {
    registryCache.__setEnabledForTesting([]);
    await expect(withModuleOff(GATED, 'deactivated', () => undefined)).rejects.toThrow(
      /not enabled before the test runs/,
    );
  });
});
