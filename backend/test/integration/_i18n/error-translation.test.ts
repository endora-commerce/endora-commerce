import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ERROR_CODES, type ErrorCode } from '@b2b/contracts';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../../src/http/error-envelope.js';
import { AdminUser } from '../../../src/modules/admin_users/entities/admin-user.entity.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

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
    await h.adminI18n.i18nService.installBundlesForModule(
      '_i18n',
      join(process.cwd(), 'src/modules/_i18n'),
      'i18n',
    );
    await h.adminI18n.i18nService.installBundlesForModule(
      'settings',
      join(process.cwd(), 'src/modules/settings'),
      'i18n',
    );
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
