import { Invoice, InvoiceLine, InvoiceNumberCounter } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HttpError } from '@endora-commerce/platform/http';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { Setting } from '@endora-commerce/platform/kernel';

import { SettingValue } from '@endora-commerce/platform/kernel';

import type { SalesChannel } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

import {
  ensureSalesChannel,
  systemDefaultSalesChannel,
} from '../../helpers/sales-channel-fixtures.js';

/**
 * **The `invoices` services below are imported from the package's `dist`, not from
 * its `src`, and it is the only spelling that works here** (feature 080, T040b,
 * batch four; D-160.6.1).
 *
 * Each of them value-imports one of this module's entity classes — a decorated
 * `@Entity()` file — so importing the *service* from source evaluates the *entity*
 * from source, a second time, beside the copy the ORM registered out of `dist`.
 * For most packages that duplication is silent. For this one it is a hard refusal
 * at ORM init: `KsefSubmission` is `@TransitivelyScoped` through `Invoice`, and
 * `assertTransitiveParentsResolve` resolves a chain by **class name**, so two
 * `Invoice` classes are an ambiguity it refuses rather than guesses at —
 * `UnresolvableTenantParentError`, in `setupBackendServer`, taking every test file
 * in the process with it.
 *
 * `dist` is the same module instance the composed platform holds, so the provider
 * this file constructs operates on the entity classes the ORM knows. That is the
 * assertion these tests were always making; before the move it was true for free.
 */
import { CorrectiveInvoiceProvider } from '../../../../packages/modules/invoices/dist/backend/services/corrective-invoice.js';

import { seedInvoiceableOrder, setSellerSettings } from './helpers.js';


/**
 * Feature 078, D-95.2 — `409 INVOICE_NUMBER_ALREADY_ISSUED` at issuance.
 *
 * This is the layer that carries the guarantee: it is the one chokepoint every
 * invoice number passes through. Unlike the settings refusal it refuses only an
 * **actual** duplicate — a row the database has rejected — so a pre-flight
 * "could this collide" never blocks a sale that would have succeeded.
 *
 * The colliding configuration is written straight into the store, because the
 * settings write path now refuses it. That is the point: this test measures
 * what happens when the configuration got there anyway.
 */

const INVOICE_CODE = 'invoices.numbering.invoice.pattern';
const CORRECTION_CODE = 'invoices.numbering.correction.pattern';
const OTHER_ORGANIZATION_ID = 'bbbbbbbb-0000-4000-8000-0000000000ff';

describe('invoices — the duplicate-number refusal at issuance', () => {
  let h: BackendServerHandle;
  let first: SalesChannel;
  let second: SalesChannel;
  let corrective: CorrectiveInvoiceProvider;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSellerSettings(h);
    first = await systemDefaultSalesChannel(h.em());
    second = await ensureSalesChannel(h.em(), 'dup-b');
    corrective = new CorrectiveInvoiceProvider(h.em, () => h.invoices.numberGenerator);
    await forcePattern(INVOICE_CODE, first, 'FVDUP {seq}/{YYYY}');
    await forcePattern(INVOICE_CODE, second, 'FVDUP {seq}/{YYYY}');
    await forcePattern(CORRECTION_CODE, first, 'KORDUP {seq}/{YYYY}');
    await forcePattern(CORRECTION_CODE, second, 'KORDUP {seq}/{YYYY}');
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function forcePattern(
    code: string,
    channel: SalesChannel,
    pattern: string,
  ): Promise<void> {
    const em = h.em();
    const setting = await em.findOne(Setting, { code });
    const existing = await em.findOne(SettingValue, { setting, salesChannel: channel.id });
    if (existing) existing.value = pattern;
    else em.create(SettingValue, { setting: setting!, salesChannel: channel, value: pattern });
    await em.flush();
    await h.settings.cache.invalidateAfterWrite(code);
  }

  /**
   * `null` when the channel has drawn nothing this year — the absence stays
   * visible, because "the counter row is gone again" is exactly what the
   * rollback assertion is about.
   */
  async function counterValue(
    salesChannelId: string,
    kind: 'invoice' | 'correction',
  ): Promise<number | null> {
    const row = await h.em().findOne(InvoiceNumberCounter, {
      salesChannelId,
      kind,
      periodYear: new Date().getFullYear(),
    });
    return row === null ? null : row.currentValue;
  }

  async function issue(salesChannelId: string, organizationId?: string): Promise<string> {
    const { orderId } = await withSystemScope('seed', () =>
      seedInvoiceableOrder(h.em(), {
        salesChannelId,
        ...(organizationId ? { organizationId } : {}),
      }),
    );
    const detail = await withSystemScope('issue', () =>
      h.invoices.invoiceService.issue(orderId, 'invoice'),
    );
    return detail.number;
  }

  async function refusedIssue(
    salesChannelId: string,
    organizationId?: string,
  ): Promise<{ error: HttpError; orderId: string }> {
    const { orderId } = await withSystemScope('seed', () =>
      seedInvoiceableOrder(h.em(), {
        salesChannelId,
        ...(organizationId ? { organizationId } : {}),
      }),
    );
    try {
      await withSystemScope('issue', () => h.invoices.invoiceService.issue(orderId, 'invoice'));
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      return { error: err as HttpError, orderId };
    }
    throw new Error('expected the issuance to be refused');
  }

  it('refuses the duplicate, names the channel that holds the number, and leaves no gap', async () => {
    // The bus delivers asynchronously, so this is measured by *which* order an
    // event names rather than by how many have arrived by a given line.
    const issuedOrderIds: string[] = [];
    const off = h.eventBus.on('invoice.issued.v1', (payload) => {
      issuedOrderIds.push((payload as unknown as { orderId: string }).orderId);
    });

    const held = await issue(first.id);
    expect(held).toBe(`FVDUP 1/${new Date().getFullYear()}`);

    const before = await counterValue(second.id, 'invoice');
    // Nothing has been drawn on the second channel yet, so the counter row does
    // not exist — the refused draw must leave it that way.
    expect(before).toBeNull();
    const invoicesBefore = await withSystemScope('count', () => h.em().count(Invoice, {}));
    const linesBefore = await h.em().count(InvoiceLine, {});

    const { error: err, orderId: refusedOrderId } = await refusedIssue(second.id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    off();

    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('INVOICE_NUMBER_ALREADY_ISSUED');
    const details = err.details as Record<string, unknown>;
    expect(details['code']).toBe('other_channel');
    expect(details['number']).toBe(held);
    expect(details['channelCode']).toBe(first.code);
    // Only the number and the channel travel — never the buyer, the order or
    // the amount.
    expect(Object.keys(details).sort()).toEqual([
      'channel',
      'channelCode',
      'code',
      'number',
    ]);

    // Nothing was written, and the counter draw rolled back with the insert.
    expect(await withSystemScope('count', () => h.em().count(Invoice, {}))).toBe(invoicesBefore);
    expect(await h.em().count(InvoiceLine, {})).toBe(linesBefore);
    expect(issuedOrderIds).not.toContain(refusedOrderId);
    expect(await counterValue(second.id, 'invoice')).toBeNull();

    // The next successful issuance on that channel draws the sequence the
    // refused one would have had.
    await forcePattern(INVOICE_CODE, second, 'FVDUPB {seq}/{YYYY}');
    expect(await issue(second.id)).toBe(`FVDUPB 1/${new Date().getFullYear()}`);
  });

  it('refuses across organizations without exposing anything but the number and channel', async () => {
    await forcePattern(INVOICE_CODE, second, 'FVDUPX {seq}/{YYYY}');
    const held = await issue(first.id, OTHER_ORGANIZATION_ID);
    await forcePattern(INVOICE_CODE, second, held.replace(/\d+/, '{seq}'));

    const { error: err } = await refusedIssue(second.id);
    expect(err.code).toBe('INVOICE_NUMBER_ALREADY_ISSUED');
    const details = err.details as Record<string, unknown>;
    expect(details['channelCode']).toBe(first.code);
    expect(JSON.stringify(details)).not.toContain(OTHER_ORGANIZATION_ID);
  });

  it('leaves the per-order uniqueness refusal exactly as it was', async () => {
    const { orderId } = await withSystemScope('seed', () =>
      seedInvoiceableOrder(h.em(), { salesChannelId: first.id }),
    );
    await withSystemScope('issue', () => h.invoices.invoiceService.issue(orderId, 'invoice'));
    await expect(
      withSystemScope('issue', () => h.invoices.invoiceService.issue(orderId, 'invoice')),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('refuses a corrective invoice that would duplicate a number', async () => {
    const year = new Date().getFullYear();
    // Two channels of this test's own, so the correction series start at 1 and
    // the invoice series cannot collide with the ones above.
    const c = await ensureSalesChannel(h.em(), 'dup-c');
    const d = await ensureSalesChannel(h.em(), 'dup-d');
    await forcePattern(INVOICE_CODE, c, 'FVDUPC {seq}/{YYYY}');
    await forcePattern(INVOICE_CODE, d, 'FVDUPD {seq}/{YYYY}');
    await forcePattern(CORRECTION_CODE, c, 'KORDUP {seq}/{YYYY}');
    await forcePattern(CORRECTION_CODE, d, 'KORDUP {seq}/{YYYY}');

    const onC = await withSystemScope('seed', () =>
      seedInvoiceableOrder(h.em(), { salesChannelId: c.id }),
    );
    await withSystemScope('issue', () =>
      h.invoices.invoiceService.issue(onC.orderId, 'invoice'),
    );
    const held = await withSystemScope('correct', () =>
      corrective.createCorrection({
        orderId: onC.orderId,
        currency: 'PLN',
        total: 10,
        lines: [{ orderItemId: onC.itemIds[0], productName: 'TM-1', quantity: 1, amount: 10 }],
      }),
    );
    expect(held).toMatchObject({ number: `KORDUP 1/${year}` });

    // The second channel's correction series would render the same string.
    const onD = await withSystemScope('seed', () =>
      seedInvoiceableOrder(h.em(), { salesChannelId: d.id }),
    );
    await withSystemScope('issue', () =>
      h.invoices.invoiceService.issue(onD.orderId, 'invoice'),
    );
    let refused: unknown;
    try {
      await withSystemScope('correct', () =>
        corrective.createCorrection({
          orderId: onD.orderId,
          currency: 'PLN',
          total: 10,
          lines: [{ orderItemId: onD.itemIds[0], productName: 'TM-1', quantity: 1, amount: 10 }],
        }),
      );
    } catch (err) {
      refused = err;
    }
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).code).toBe('INVOICE_NUMBER_ALREADY_ISSUED');
    expect((refused as HttpError).statusCode).toBe(409);
  });
});
