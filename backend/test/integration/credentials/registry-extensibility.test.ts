import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigurationTypeDescriptor } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { ConfigurationTypeRegistry } from '../../../../packages/modules/credentials/src/backend/services/configuration-type-registry.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';

/** Where each module's sources really are — resolved, never spelled (T040a). */
const MODULE_LAYOUT = await requireModuleLayout('[registry-extensibility]');

/**
 * Feature 058 US3 (T046 / T049) — the configuration-type registry is the single
 * extension seam. A throwaway type registered on the process-wide singleton
 * becomes selectable in `GET /types` and creatable, with ZERO changes to the
 * credentials core; unregistering restores the prior state. Also asserts the
 * core carries no per-code / per-providerCode business branching (Principle XIV).
 */
/**
 * The registry **the platform composed**, never a fresh import of the module's
 * own singleton.
 *
 * `credentials` is a package, so the running platform resolves its
 * `registry-singleton.js` at `dist`; importing the same file from the package's
 * `src` builds a *second* `ConfigurationTypeRegistry`, and a type registered on
 * it is invisible to every route this file then asserts against. `tsc` cannot
 * see the split — the two objects have identical shapes — so the test would
 * pass on the negative assertions and fail on the positive ones, or worse, read
 * as a module correctly refusing an unknown type. Feature 080's batch two
 * measured exactly that with `ShippingAdapterRegistry` (!982); the type import
 * above erases, so it constructs nothing.
 */
function registryOf(handle: BackendServerHandle): ConfigurationTypeRegistry {
  return (handle.container.cradle as unknown as {
    configurationTypeRegistry: ConfigurationTypeRegistry;
  }).configurationTypeRegistry;
}

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
    registryOf(h).unregister(THROWAWAY);
    await teardownBackendServer(h);
  });

  it('a type registered on the singleton appears in GET /types and is creatable', async () => {
    // Not present before registration.
    const before = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credentials/types', ...ADMIN });
    expect((before.json().types as { code: string }[]).some((t) => t.code === THROWAWAY)).toBe(false);

    // Register via the cross-module seam (the exact path an overlay module uses).
    registryOf(h).register(throwaway);

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
    registryOf(h).unregister(THROWAWAY);

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
    // The module's directory is **resolved**, never spelled: `credentials`
    // became a workspace package in feature 080's T040b, and a literal
    // `src/modules/credentials` is `ENOENT` from that commit on. The `src/
    // backend` hop is the package layout; an application module has neither.
    const moduleDirectory = MODULE_LAYOUT.moduleDirectoryOf('credentials');
    if (moduleDirectory === null) {
      throw new Error('[registry-extensibility] no such module: credentials');
    }
    const modulesRoot = existsSync(join(moduleDirectory, 'src', 'backend'))
      ? join(moduleDirectory, 'src', 'backend')
      : moduleDirectory;
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
