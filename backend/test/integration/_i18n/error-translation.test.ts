import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../../helpers/package-entities.js';
import { dirname } from 'node:path';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { ERROR_CODES, type ErrorCode } from '@endora-commerce/contracts';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../../src/http/error-envelope.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/** A registered module's own directory — a package root or an application one. */
function moduleDirectoryOf(moduleId: string): string {
  const entry = REGISTERED_MANIFESTS.find((candidate) => candidate.manifest.id === moduleId);
  if (entry === undefined) {
    throw new Error(`[i18n-error-translation] no registered module "${moduleId}"`);
  }
  return dirname(entry.filePath);
}

describe('i18n error-envelope translation', () => {
  let h: BackendServerHandle;
  let app: FastifyInstance;

  beforeAll(async () => {
    h = await setupBackendServer({
      extraModules: [
        async (instance) => {
          instance.get('/_test/i18n-error/settings', async () => {
            throw new HttpError(
              404,
              ERROR_CODES.SETTING_NOT_REGISTERED,
              'Setting "x" not registered',
            );
          });
          instance.get('/_test/i18n-error/unregistered', async () => {
            throw new HttpError(
              418,
              'UNREGISTERED_TEST_CODE' as ErrorCode,
              'Original English literal.',
            );
          });
        },
      ],
    });
    app = h.app;
    // Both bundles are read from the module's **own directory**, derived from
    // the registered manifest the way the boot reconciler derives it — never
    // from `src/modules/<id>`, which stopped being where either module lives
    // (feature 080, T040b). The `settings` half had already gone stale that
    // way, and its staleness was invisible: `loadModuleBundles` reads an absent
    // directory as "this module ships no translatable strings", so the install
    // was a silent no-op and the assertions below passed on the bundle
    // `setupBackendServer`'s own reconcile had installed.
    for (const moduleId of ['_i18n', 'settings']) {
      await h.adminI18n.i18nService.installBundlesForModule(
        moduleId,
        moduleDirectoryOf(moduleId),
        'i18n',
      );
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('renders a registered error in Polish for a Polish-preferred admin', async () => {
    const em = h.em();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = 'pl';
    await em.flush();

    const res = await app.inject({
      method: 'GET',
      url: '/_test/i18n-error/settings',
      cookies: { b2b_session: 'stub-admin-session' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: {
        code: ERROR_CODES.SETTING_NOT_REGISTERED,
        message: 'Ustawienie nie jest zarejestrowane.',
      },
    });
  });

  it('renders a registered error in English for an English-preferred admin', async () => {
    const em = h.em();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = 'en';
    await em.flush();

    const res = await app.inject({
      method: 'GET',
      url: '/_test/i18n-error/settings',
      cookies: { b2b_session: 'stub-admin-session' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: {
        code: ERROR_CODES.SETTING_NOT_REGISTERED,
        message: 'Setting is not registered.',
      },
    });
  });

  it('keeps the original literal when the error code has no registry entry', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/_test/i18n-error/unregistered',
      cookies: { b2b_session: 'stub-admin-session' },
    });

    expect(res.statusCode).toBe(418);
    expect(res.json()).toMatchObject({
      error: {
        code: 'UNREGISTERED_TEST_CODE',
        message: 'Original English literal.',
      },
    });
  });
});
