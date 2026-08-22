import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { describe, expect, it } from 'vitest';
import type { AdminUserPreferencePort, AdminUserRecord } from '@endora-commerce/contracts';
import {
  registerI18nAdminRoutes,
  type I18nAdminDeps,
} from '../../../src/modules/_i18n/routes.admin.js';

/**
 * Feature 075, Phase C — `_i18n` writes the admin's language choice over
 * `admin_users`' published port (FR-010).
 *
 * `PATCH /api/v1/admin/me/preferred-language` used to be typed against
 * `AdminUserService`, the class, imported across the module boundary. One
 * method of it was ever called; the rest of the class — creation, roles,
 * deletion, impersonation — travelled with the type and made `_i18n`
 * uncompilable without `admin_users`.
 *
 * The assertion is that a stub implementing `AdminUserPreferencePort` and
 * nothing else is enough to serve the route, and that the route hands it
 * exactly the admin id the context resolved plus the body's value — including
 * `null`, which is how an admin goes back to following the platform default.
 */

function record(preferredLanguage: string | null): AdminUserRecord {
  return {
    id: 'admin-1',
    email: 'admin@example.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
    adminRoleId: null,
    status: 'active',
    twoFactorEnabled: false,
    lastLoginAt: null,
    preferredLanguage,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    deletedAt: null,
  };
}

async function buildApp(): Promise<{
  app: FastifyInstance;
  calls: Array<[string, string | null]>;
}> {
  const calls: Array<[string, string | null]> = [];
  const adminUserPreference: AdminUserPreferencePort = {
    setPreferredLanguage: async (id, preferredLanguage) => {
      calls.push([id, preferredLanguage]);
      return record(preferredLanguage);
    },
  };

  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await registerI18nAdminRoutes(app, {
    i18nService: {} as unknown as I18nAdminDeps['i18nService'],
    adminUserPreference,
    requireAdmin: () => async () => undefined,
    resolveAdminContext: () => ({ adminUserId: 'admin-1' }),
  });
  await app.ready();
  return { app, calls };
}

describe('_i18n admin routes — the language preference is written over the port', () => {
  it('sets a language through the preference port alone', async () => {
    const { app, calls } = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      payload: { preferredLanguage: 'pl' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { preferredLanguage: 'pl' } });
    expect(calls).toEqual([['admin-1', 'pl']]);
    await app.close();
  });

  it('clears the override by passing null through unchanged', async () => {
    const { app, calls } = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      payload: { preferredLanguage: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { preferredLanguage: null } });
    expect(calls).toEqual([['admin-1', null]]);
    await app.close();
  });
});
