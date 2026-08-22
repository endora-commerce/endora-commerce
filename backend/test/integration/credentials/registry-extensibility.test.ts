import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigurationTypeDescriptor } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { configurationTypeRegistry } from '../../../src/modules/credentials/services/registry-singleton.js';

/**
 * Feature 058 US3 (T046 / T049) — the configuration-type registry is the single
 * extension seam. A throwaway type registered on the process-wide singleton
 * becomes selectable in `GET /types` and creatable, with ZERO changes to the
 * credentials core; unregistering restores the prior state. Also asserts the
 * core carries no per-code / per-providerCode business branching (Principle XIV).
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const THROWAWAY = 'throwaway_type_058';

const throwaway: ConfigurationTypeDescriptor = {
  code: THROWAWAY,
  label: 'Throwaway',
  ownerModule: 'test',
  providers: [
    {
      code: 'only',
      label: 'Only',
      fields: [
        { key: 'token', label: 'Token', kind: 'string', required: true, secret: true },
        { key: 'endpoint', label: 'Endpoint', kind: 'string', required: false, secret: false },
      ],
    },
  ],
};

describe('Credentials registry extensibility [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
  });
  afterAll(async () => {
    configurationTypeRegistry.unregister(THROWAWAY);
    await teardownBackendServer(h);
  });

  it('a type registered on the singleton appears in GET /types and is creatable', async () => {
    // Not present before registration.
    const before = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credentials/types', ...ADMIN });
    expect((before.json().types as { code: string }[]).some((t) => t.code === THROWAWAY)).toBe(false);

    // Register via the cross-module seam (the exact path an overlay module uses).
    configurationTypeRegistry.register(throwaway);

    const after = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credentials/types', ...ADMIN });
    expect((after.json().types as { code: string }[]).some((t) => t.code === THROWAWAY)).toBe(true);

    // A configuration of the throwaway type can be created and read back masked.
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: 'throwaway-config',
        name: 'Throwaway config',
        typeCode: THROWAWAY,
        providerCode: 'only',
        values: { token: 'sk-throwaway', endpoint: 'https://example.test' },
      },
      ...ADMIN,
    });
    expect(created.statusCode).toBe(201);
    const dto = created.json() as { inert: boolean; fields: { key: string; isSet?: boolean }[] };
    expect(dto.inert).toBe(false);
    expect(dto.fields.find((f) => f.key === 'token')?.isSet).toBe(true);
    expect(created.body).not.toContain('sk-throwaway');
  });

  it('unregistering restores the not-registered state (the stored config becomes inert)', async () => {
    configurationTypeRegistry.unregister(THROWAWAY);

    const types = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credentials/types', ...ADMIN });
    expect((types.json().types as { code: string }[]).some((t) => t.code === THROWAWAY)).toBe(false);

    // The previously-created config is still listed, now marked inert (FR-016).
    const one = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credentials/throwaway-config', ...ADMIN });
    expect(one.statusCode).toBe(200);
    const dto = one.json() as { inert: boolean; typeLabel: string | null; fields: unknown[] };
    expect(dto.inert).toBe(true);
    expect(dto.typeLabel).toBeNull();
    expect(dto.fields).toEqual([]);
  });

  it('the credentials core carries no per-code / per-providerCode business branching (Principle XIV)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const modulesRoot = join(here, '..', '..', '..', 'src', 'modules', 'credentials');
    const coreFiles = [
      join(modulesRoot, 'services', 'credentials.service.ts'),
      join(modulesRoot, 'services', 'field-validator.ts'),
      join(modulesRoot, 'commands', 'create-configuration.command.ts'),
      join(modulesRoot, 'commands', 'update-configuration.command.ts'),
      join(modulesRoot, 'commands', 'delete-configuration.command.ts'),
      join(modulesRoot, 'routes.admin.ts'),
    ];
    // Provider/type codes the core must never hard-code a branch on.
    const forbidden = ['llm', 'email_adapter', 'anthropic', 'openai', 'google', 'deepseek', 'smtp', 'amazon_ses', 'sendgrid'];
    for (const file of coreFiles) {
      const src = readFileSync(file, 'utf8');
      for (const code of forbidden) {
        expect(
          src.includes(`'${code}'`),
          `${file} must not branch on the literal provider/type code '${code}' (Principle XIV)`,
        ).toBe(false);
      }
    }
  });
});
