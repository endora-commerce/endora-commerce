import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 068 T068 — the `pim_ergonode` configuration type is registered on the
 * credentials registry and behaves the way FR-002 requires over HTTP: the type
 * is offered by `GET /types`, `apiKey` is stored as a secret and comes back as
 * `isSet` only, and `endpointUrl` — an address, not a credential — comes back
 * with its value so an operator can see which instance they are pointed at.
 *
 * The plaintext key must appear in no response body, which is asserted against
 * the raw body rather than the parsed DTO.
 *
 * Feature 072 (T143a) — this file used to register the descriptor itself,
 * because both composition roots did it on `pim_ergonode`'s behalf and the
 * harness's copy was written separately from production's. The module declares
 * its own type now, from `ctx.onBoot`, so the registration under test is the
 * one a deployment runs: nothing here touches the registry, and `GET /types`
 * offering the type is the assertion that the module did.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const CODE = 'contract-pim-ergonode';
const API_KEY = 'ergonode-secret-key-068';
const ENDPOINT = 'https://pim.example.test';

type FieldDto = { key: string; secret: boolean; isSet?: boolean; value?: unknown };

describe('Ergonode credential type [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/credentials/${CODE}`, ...ADMIN });
    await teardownBackendServer(h);
  });

  it('is registered at boot by the module that owns it, not by a composition root', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = join(here, '..', '..', '..', 'src');
    // `pim_ergonode` is a package (feature 080, T040b), so its composition file
    // is the `./backend` subpath's entry point rather than `src/modules/<id>/
    // backend.ts`. This path is built from segments, which is why no import
    // rewrite saw it during the move — it went red here, on a `readFileSync`,
    // rather than in a specifier the type-checker reads.
    const backend = readFileSync(
      join(
        here,
        '..',
        '..',
        '..',
        '..',
        'packages',
        'modules',
        'pim_ergonode',
        'src',
        'backend',
        'index.ts',
      ),
      'utf8',
    );
    expect(backend).toContain('ergonodeConfigurationType');
    expect(backend).toContain('ctx.onBoot(');
    for (const root of [
      join(src, 'composition.ts'),
      join(here, '..', '..', 'helpers', 'test-server.ts'),
    ]) {
      expect(readFileSync(root, 'utf8')).not.toContain('ergonodeConfigurationType');
    }
  });

  it('GET /types offers pim_ergonode with the ergonode provider and its two fields', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/credentials/types',
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);

    const types = res.json().types as {
      code: string;
      ownerModule: string;
      providers: { code: string; fields: FieldDto[] }[];
    }[];
    const ergonode = types.find((type) => type.code === 'pim_ergonode');
    expect(ergonode).toBeDefined();
    expect(ergonode?.ownerModule).toBe('pim_ergonode');

    const provider = ergonode?.providers.find((candidate) => candidate.code === 'ergonode');
    expect(provider).toBeDefined();
    expect(provider?.fields.map((field) => field.key)).toEqual(['endpointUrl', 'apiKey']);
    expect(provider?.fields.find((field) => field.key === 'endpointUrl')?.secret).toBe(false);
    expect(provider?.fields.find((field) => field.key === 'apiKey')?.secret).toBe(true);
  });

  it('masks apiKey but returns endpointUrl on create and on read back', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: CODE,
        name: 'Ergonode contract',
        typeCode: 'pim_ergonode',
        providerCode: 'ergonode',
        values: { endpointUrl: ENDPOINT, apiKey: API_KEY },
      },
      ...ADMIN,
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain(API_KEY);

    const read = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/credentials/${CODE}`,
      ...ADMIN,
    });
    expect(read.statusCode).toBe(200);
    expect(read.body).not.toContain(API_KEY);

    const fields = (read.json() as { fields: FieldDto[] }).fields;
    const apiKey = fields.find((field) => field.key === 'apiKey');
    expect(apiKey?.secret).toBe(true);
    expect(apiKey?.isSet).toBe(true);
    expect(apiKey && 'value' in apiKey).toBe(false);

    const endpointUrl = fields.find((field) => field.key === 'endpointUrl');
    expect(endpointUrl?.secret).toBe(false);
    expect(endpointUrl?.value).toBe(ENDPOINT);
    expect(endpointUrl && 'isSet' in endpointUrl).toBe(false);
  });

  it('rejects a configuration missing the required endpointUrl (422, per-field)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: 'contract-pim-ergonode-invalid',
        name: 'Missing endpoint',
        typeCode: 'pim_ergonode',
        providerCode: 'ergonode',
        values: { apiKey: API_KEY },
      },
      ...ADMIN,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('CREDENTIAL_VALIDATION_FAILED');
    const details = res.json().error.details as { path: string }[];
    expect(details.some((detail) => detail.path === 'endpointUrl')).toBe(true);
  });
});
