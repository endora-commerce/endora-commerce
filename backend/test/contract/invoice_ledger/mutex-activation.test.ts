import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS, ERROR_CODES } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import { ensureSalesChannel } from '../../helpers/sales-channel-fixtures.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T079 / SC-008. Each ledger vendor's `refuse-when-sibling-ledger-vendor-active`
 * interceptor on POST `/api/v1/admin/modules/:id/activation`.
 *
 * Feature 132 — the shipped vendor family is **derived** from the members' own
 * manifest declarations rather than read off `INVOICE_LEDGER_MODULES`, which is
 * deleted. The `ledger_fixture` entry is still injected for Infakt-only cases that
 * need a sibling without activating the real wFirma package.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const INFAKT_ACTIVATION_URL = '/api/v1/admin/modules/infakt/activation';
const WFIRMA_ACTIVATION_URL = '/api/v1/admin/modules/wfirma/activation';
const CHANNEL_API_KEY = 'infakt-mutex-channel-key-008';
const LEDGER_FIXTURE = {
  id: 'ledger_fixture',
  activationSettingCode: 'ledger_fixture.activation',
} as const;

const extraActive = new Set<string>();

/** The vendors this tree ships, from their own declarations. Never a written-down list (D-100). */
async function shippedLedgerVendors(): Promise<readonly { id: string }[]> {
  const entries = await resolvedManifestEntries();
  const vendors = entries
    .filter((entry) =>
      (entry.manifest.capabilities ?? []).includes(CAPABILITY_KEYS.INVOICE_LEDGER_VENDOR),
    )
    .map((entry) => ({ id: entry.manifest.id }));
  expect(vendors.length, 'the derived ledger family must not be empty').toBeGreaterThan(0);
  return vendors;
}

describe('invoice_ledger — vendor mutex [contract]', () => {
  let h: BackendServerHandle;
  let channelId: string;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    extraActive.clear();
    h = await setupBackendServer({
      invoiceLedgerVendorModules: [...(await shippedLedgerVendors()), LEDGER_FIXTURE],
      invoiceLedgerPresence: {
        isOperatorActivated(moduleId) {
          if (extraActive.has(moduleId)) return true;
          return effectiveState.presence(moduleId)?.operatorActivated ?? false;
        },
      },
    });
    // The harness seeds every module operator-active. wFirma must start off so
    // Infakt can become the instance vendor (Phase 2 checkpoint).
    const wfirmaOff = await h.app.inject({
      method: 'POST',
      url: WFIRMA_ACTIVATION_URL,
      ...ADMIN,
      payload: { active: false },
    });
    expect(wfirmaOff.statusCode, wfirmaOff.body).toBe(200);
    channelId = (await ensureSalesChannel(h.em(), 'il-mutex-ch')).id;
  }, 60_000);

  afterAll(async () => {
    extraActive.clear();
    await teardownBackendServer(h);
  });

  it('activates Infakt through the interceptor when no sibling is operator-active', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: INFAKT_ACTIVATION_URL,
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
      url: INFAKT_ACTIVATION_URL,
      ...ADMIN,
      payload: { active: false },
    });
    expect(off.statusCode, off.body).toBe(200);

    extraActive.add('ledger_fixture');

    const refused = await h.app.inject({
      method: 'POST',
      url: INFAKT_ACTIVATION_URL,
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

    extraActive.delete('ledger_fixture');
  });

  it('POST wFirma activate 409s when Infakt is operator-active', async () => {
    const infaktOn = await h.app.inject({
      method: 'POST',
      url: INFAKT_ACTIVATION_URL,
      ...ADMIN,
      payload: { active: true },
    });
    expect(infaktOn.statusCode, infaktOn.body).toBe(200);

    const refused = await h.app.inject({
      method: 'POST',
      url: WFIRMA_ACTIVATION_URL,
      ...ADMIN,
      payload: { active: true },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    const body = refused.json() as {
      error: { code: string; details?: { activeModuleId?: string; salesChannelId?: string } };
    };
    expect(body.error.code).toBe(ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE);
    expect(body.error.details?.activeModuleId).toBe('infakt');
    expect(body.error.details).not.toHaveProperty('salesChannelId');
  });

  it('POST Infakt activate 409s when wFirma is operator-active', async () => {
    await h.app.inject({
      method: 'POST',
      url: INFAKT_ACTIVATION_URL,
      ...ADMIN,
      payload: { active: false },
    });

    const wfirmaOn = await h.app.inject({
      method: 'POST',
      url: WFIRMA_ACTIVATION_URL,
      ...ADMIN,
      payload: { active: true },
    });
    expect(wfirmaOn.statusCode, wfirmaOn.body).toBe(200);

    const refused = await h.app.inject({
      method: 'POST',
      url: INFAKT_ACTIVATION_URL,
      ...ADMIN,
      payload: { active: true },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    const body = refused.json() as {
      error: { code: string; details?: { activeModuleId?: string; salesChannelId?: string } };
    };
    expect(body.error.code).toBe(ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE);
    expect(body.error.details?.activeModuleId).toBe('wfirma');
    expect(body.error.details).not.toHaveProperty('salesChannelId');
  });
});
