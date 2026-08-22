import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { HttpError } from '../../../src/http/error-envelope.js';
import { Country } from '../../../src/modules/dictionaries/entities/country.entity.js';

/**
 * Feature 060 / US1 (T010) — a pre-interceptor veto is a normal business
 * outcome: the client receives the standard envelope with the interceptor's
 * error code, and the owning module's logic (including its write) never runs.
 */

const FIXTURE_MODULE = 'interceptor_fixture';
const adminCookie = { b2b_session: 'stub-admin-session' };

describe('API interceptor veto (feature 060 / US1)', () => {
  let h: BackendServerHandle;
  let baselineEnabled: string[] = [];
  let handlerObservedVeto = 0;

  beforeAll(async () => {
    h = await setupBackendServer({
      configureInterceptors: (registry) => {
        registry.register({
          module: FIXTURE_MODULE,
          id: 'compliance-gate',
          target: 'POST /api/v1/admin/dictionary/countries',
          phase: 'pre',
          handler: async ({ body }) => {
            const code = (body as { code?: string }).code;
            if (code === 'ZV') {
              handlerObservedVeto += 1;
              throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Country creation vetoed by compliance fixture.', {
                vetoedCode: code,
              });
            }
          },
        });
      },
    });
    baselineEnabled = registryCache.enabledIds();
    registryCache.__setEnabledForTesting([...baselineEnabled, FIXTURE_MODULE]);
  });

  afterAll(async () => {
    registryCache.__setEnabledForTesting(baselineEnabled);
    await teardownBackendServer(h);
  });

  it('returns the interceptor business error in the standard envelope and skips the endpoint', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/dictionary/countries',
      cookies: adminCookie,
      payload: {
        code: 'ZV',
        alpha3Code: 'ZZV',
        numericCode: '997',
        label: 'Vetoed Country',
        region: 'Europe',
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe(ERROR_CODES.FORBIDDEN);
    // The message may be localized by the error-envelope i18n bridge (veto
    // errors behave exactly like endpoint-raised business errors); code and
    // details are preserved verbatim.
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.details).toEqual({ vetoedCode: 'ZV' });
    expect(typeof body.error.requestId).toBe('string');
    expect(handlerObservedVeto).toBe(1);
    // The endpoint's write never happened — no row exists (FR-003/FR-009).
    const row = await h.em().findOne(Country, { code: 'ZV' });
    expect(row).toBeNull();
  });

  it('lets non-matching requests through unchanged', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/dictionary/countries',
      cookies: adminCookie,
      payload: {
        code: 'ZU',
        alpha3Code: 'ZZU',
        numericCode: '996',
        label: 'Allowed Country',
        region: 'Europe',
      },
    });
    expect(res.statusCode).toBe(201);
    const row = await h.em().findOne(Country, { code: 'ZU' });
    expect(row).not.toBeNull();
  });
});
