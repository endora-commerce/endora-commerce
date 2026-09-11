import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, INVOICE_LEDGER_MODULES } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { ensureSalesChannel } from '../../helpers/sales-channel-fixtures.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T079 / SC-008. Infakt's `refuse-when-sibling-ledger-vendor-active`
 * interceptor on POST `/api/v1/admin/modules/:id/activation`.
 *
 * Production `INVOICE_LEDGER_MODULES` stays Infakt-only. The sibling is the
 * test entry `ledger_fixture`, injected through the presence reader and an
 * extra registry table row — not a second vendor module package.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const ACTIVATION_URL = '/api/v1/admin/modules/infakt/activation';
const CHANNEL_API_KEY = 'infakt-mutex-channel-key-008';
const LEDGER_FIXTURE = {
  id: 'ledger_fixture',
  activationSettingCode: 'ledger_fixture.activation',
} as const;

const extraActive = new Set<string>();

describe('invoice_ledger — vendor mutex [contract]', () => {
  let h: BackendServerHandle;
  let channelId: string;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    extraActive.clear();
    h = await setupBackendServer({
      invoiceLedgerVendorModules: [...INVOICE_LEDGER_MODULES, LEDGER_FIXTURE],
      invoiceLedgerPresence: {
        isOperatorActivated(moduleId) {
          if (extraActive.has(moduleId)) return true;
          return effectiveState.presence(moduleId)?.operatorActivated ?? false;
        },
      },
    });
    channelId = (await ensureSalesChannel(h.em(), 'il-mutex-ch')).id;
  }, 60_000);

  afterAll(async () => {
    extraActive.clear();
    await teardownBackendServer(h);
  });

  it('activates Infakt through the interceptor when no sibling is operator-active', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: ACTIVATION_URL,
      ...ADMIN,
      payload: { active: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      module: { id: 'infakt', activated: true, present: true },
    });
  });

  it('assertCanActivate(ledger_fixture) on the live port names Infakt (FR-003)', async () => {
    await expect(h.invoiceLedgerRegistry.assertCanActivate('ledger_fixture')).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.statusCode).toBe(409);
        expect(httpError.code).toBe(ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE);
        expect(httpError.details).toEqual({ activeModuleId: 'infakt' });
        expect(httpError.details).not.toHaveProperty('salesChannelId');
        return true;
      },
    );
  });

  it('saves a second Infakt channel API key while Infakt is the instance vendor', async () => {
    const saved = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/infakt/connection/channels/${channelId}`,
      ...ADMIN,
      payload: { apiKey: CHANNEL_API_KEY, environment: 'sandbox' },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const view = (
      saved.json() as {
        data: {
          channelOverrides: Array<{ salesChannelId: string; apiKeyLastFour: string | null }>;
        };
      }
    ).data;
    expect(view.channelOverrides).toEqual([
      expect.objectContaining({
        salesChannelId: channelId,
        apiKeyLastFour: CHANNEL_API_KEY.slice(-4),
      }),
    ]);
    expect(JSON.stringify(saved.json())).not.toContain(CHANNEL_API_KEY);
  });

  it('POST Infakt activate 409s when the test sibling is operator-active', async () => {
    const off = await h.app.inject({
      method: 'POST',
      url: ACTIVATION_URL,
      ...ADMIN,
      payload: { active: false },
    });
    expect(off.statusCode, off.body).toBe(200);

    extraActive.add('ledger_fixture');

    const refused = await h.app.inject({
      method: 'POST',
      url: ACTIVATION_URL,
      ...ADMIN,
      payload: { active: true },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    const body = refused.json() as {
      error: { code: string; details?: { activeModuleId?: string; salesChannelId?: string } };
    };
    expect(body.error.code).toBe(ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE);
    expect(body.error.details?.activeModuleId).toBe('ledger_fixture');
    expect(body.error.details).not.toHaveProperty('salesChannelId');
  });
});
