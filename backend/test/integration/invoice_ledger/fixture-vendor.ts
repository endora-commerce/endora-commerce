import { expect } from 'vitest';
import { CAPABILITY_KEYS } from '@endora-commerce/contracts';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { LEDGER_FIXTURE } from '../../helpers/ledger-fixture-client.js';
import { switchCapabilityFamilyOff } from '../../helpers/capability-families.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ADMIN, prepareLedgerNumbering, setLedgerNumberingMode } from './helpers.js';

/**
 * Driving `ledger_vendor_fixture` — the free ledger suite's own vendor
 * (feature 134, D-256).
 *
 * This is the vendor-neutral twin of `../infakt/helpers.ts` and
 * `../wfirma/helpers.ts`, and the difference that matters is where it lives: the
 * two of those are **D-252 host files** and leave this repository with their
 * package, while this one is `invoice_ledger`'s and stays. That is the whole
 * point of the fixture — the free module's suite keeps a subject after wave 4
 * instead of losing one.
 *
 * A caller must compose with `deployment: 'example'`, because the fixture is an
 * overlay module and composes only when the deployment that owns it is selected.
 */

/**
 * Every shipped member of the exclusive ledger-vendor family off, then the
 * fixture on.
 *
 * `switchCapabilityFamilyOff` derives the population from the members' own
 * manifest declarations, so this function names no sibling and a fifth vendor is
 * handled by existing (D-100). It cannot use `clearFamilyFor`, whose derivation
 * reads the **core** manifest index and therefore cannot see an overlay module's
 * own capability declaration — a real limit of that helper, recorded here rather
 * than worked around silently.
 */
export async function activateLedgerFixture(h: BackendServerHandle): Promise<void> {
  await switchCapabilityFamilyOff(h, CAPABILITY_KEYS.INVOICE_LEDGER_VENDOR);
  const res = await h.app.inject({
    method: 'POST',
    url: `/api/v1/admin/modules/${LEDGER_FIXTURE.moduleId}/activation`,
    ...ADMIN,
    payload: { active: true },
  });
  expect(res.statusCode, `activating the ledger fixture: ${res.body}`).toBe(200);
}

export async function deactivateLedgerFixture(h: BackendServerHandle): Promise<void> {
  const res = await h.app.inject({
    method: 'POST',
    url: `/api/v1/admin/modules/${LEDGER_FIXTURE.moduleId}/activation`,
    ...ADMIN,
    payload: { active: false },
  });
  expect(res.statusCode, `deactivating the ledger fixture: ${res.body}`).toBe(200);
}

/**
 * The fixture's credential, written through `credentials`' own port.
 *
 * The fixture serves no connection route, deliberately: a connection screen is a
 * vendor's own admin surface and nothing the free ledger publishes reads one, so
 * a fixture that had one would be testing itself. What the ledger does read is
 * the stored credential, through the code frozen on the delivery row — and that
 * is what this writes.
 */
export async function saveLedgerFixtureCredential(
  h: BackendServerHandle,
  opts?: { webhookSecret?: string },
): Promise<void> {
  const values: Record<string, unknown> = {
    apiKey: LEDGER_FIXTURE.apiKey,
    environment: 'sandbox',
  };
  if (opts?.webhookSecret !== undefined) values['webhookSecret'] = opts.webhookSecret;
  await withSystemScope('seed ledger fixture credential', async () => {
    const existing = await h.credentials.service.getByCode(LEDGER_FIXTURE.credentialCode);
    if (existing) {
      await h.credentials.service.update(LEDGER_FIXTURE.credentialCode, { values });
      return;
    }
    await h.credentials.service.create({
      code: LEDGER_FIXTURE.credentialCode,
      name: 'Ledger vendor fixture',
      typeCode: LEDGER_FIXTURE.credentialCode,
      providerCode: LEDGER_FIXTURE.credentialCode,
      values,
    });
  });
}

/** `prepare*VatCopy`'s vendor-neutral twin: numbering, then the vendor. */
export async function prepareLedgerFixtureVatCopy(
  h: BackendServerHandle,
  channelCode: string,
  invoicePattern: string,
  proformaPattern?: string,
): Promise<string> {
  const channelId = await prepareLedgerNumbering(h, {
    channelCode,
    invoicePattern,
    ...(proformaPattern !== undefined ? { proformaPattern } : {}),
    correctionPattern: 'KOR-FIX {seq}/{YYYY}',
  });
  await activateLedgerFixture(h);
  await saveLedgerFixtureCredential(h);
  await setLedgerNumberingMode(h, 'endora');
  return channelId;
}

/** Drive one delivery through the fixture's processor — no BullMQ in this harness. */
export function processFixtureDelivery(
  h: BackendServerHandle,
  deliveryId: string,
): Promise<void> {
  return h.ledgerDeliveryProcessor(LEDGER_FIXTURE.deliveryProcessor)(deliveryId);
}
