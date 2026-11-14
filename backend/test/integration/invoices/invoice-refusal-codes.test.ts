import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CorrectiveInvoiceInput } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from './helpers.js';
// From `dist`, for the reason `corrective-invoice.test.ts` gives: the provider
// value-imports this module's entities, and a second copy from `src` is refused
// at ORM init.
import { CorrectiveInvoiceProvider } from '../../../../packages/modules/invoices/dist/backend/services/corrective-invoice.js';
import {
  InvoiceNumberGenerator,
  createSettingsPatternResolver,
} from '../../../../packages/modules/invoices/dist/backend/services/invoice-number-generator.js';
import { SellerSettingsResolver } from '../../../../packages/modules/invoices/dist/backend/services/seller-settings.js';

/**
 * Issue #633 (#86) — the business refusals of invoice and correction issuance
 * were `VALIDATION_FAILED` with an English sentence. The envelope never
 * replaces that code's message, so the operator read English whatever their
 * language, and the two `details.code` tokens keyed no sentence. Each now has a
 * code of its own, an English and a Polish sentence, and the values the
 * sentence names in `details`.
 *
 * The refusals are raised by the real services on a harness route, so the
 * composed envelope, routing and installed bundles render them; the language is
 * chosen with `Accept-Language`, as for the order method gates in #621. The
 * sentences are written out here rather than read from the bundle: a test that
 * loads the file it checks asserts only that JSON parses.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

type Case = () => Promise<unknown>;

let CH: string;

describe('invoice refusals carry their own code and sentence (issue #633)', () => {
  let h: BackendServerHandle;
  let provider: CorrectiveInvoiceProvider;
  const cases = new Map<string, Case>();

  beforeAll(async () => {
    h = await setupBackendServer({
      extraModules: [
        async (instance) => {
          instance.get<{ Params: { name: string } }>('/_test/i633/:name', async (request) => {
            await cases.get(request.params.name)!();
            return { ok: true };
          });
        },
      ],
    });
    CH = await ensureSalesChannelId(h.em(), 'inv-refusal-codes');
    await setSellerSettings(h);
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.invoice.pattern',
      ['inv-refusal-codes'],
      'FVREF {seq}/{YYYY}',
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.correction.pattern',
      ['inv-refusal-codes'],
      'KOR-REF {seq}/{YYYY}',
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );
    provider = new CorrectiveInvoiceProvider(
      h.em,
      () => new InvoiceNumberGenerator(createSettingsPatternResolver(h.settings.settingsService)),
    );
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** An issued VAT invoice: 900.00 + 4505.00 net at 23 %, optionally a delivery and a discount line. */
  async function issueBaseInvoice(
    deliveryTotal = 0,
    discountTotal = 0,
  ): Promise<{ orderId: string; itemIds: [string, string] }> {
    const { orderId, itemIds } = await seedInvoiceableOrder(h.em(), {
      salesChannelId: CH,
      deliveryTotal,
      discountTotal,
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode, res.body).toBe(201);
    return { orderId, itemIds };
  }

  async function refusal(
    name: string,
    raise: Case,
    language: 'en' | 'pl',
    status: number,
    code: string,
  ): Promise<ErrorBody['error']> {
    cases.set(name, raise);
    const res = await h.app.inject({
      method: 'GET',
      url: `/_test/i633/${name}`,
      headers: { 'accept-language': language },
    });
    expect(res.statusCode, res.body).toBe(status);
    const error = (res.json() as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  function correction(input: CorrectiveInvoiceInput): Case {
    return () => provider.createCorrection(input);
  }

  describe('INVOICE_SELLER_DATA_MISSING — issuance without the seller data', () => {
    const SENTENCE = {
      en: "Configure the seller's VAT number (NIP) and company data in the invoice settings before issuing invoices.",
      pl: 'Przed wystawieniem faktur skonfiguruj NIP sprzedawcy i dane firmy w ustawieniach faktur.',
    };
    // The real resolver over a settings reader that holds nothing, which is
    // what an instance that never configured its seller answers.
    const unconfigured = new SellerSettingsResolver({
      get: async () => {
        throw new Error('not configured');
      },
    });

    it.each(['en', 'pl'] as const)('%s', async (language) => {
      const error = await refusal(
        `seller-${language}`,
        () => unconfigured.resolve(CH),
        language,
        422,
        'INVOICE_SELLER_DATA_MISSING',
      );
      expect(error.details).toEqual({ setting: 'invoices.seller.company_data' });
      expect(error.message).toBe(SENTENCE[language]);
      if (language === 'pl') expect(error.message).not.toBe(SENTENCE.en);
    });
  });

  describe('INVOICE_CORRECTION_CURRENCY_MISMATCH — a correction in another currency', () => {
    it.each(['en', 'pl'] as const)('%s', async (language) => {
      const { orderId, itemIds } = await issueBaseInvoice();
      const error = await refusal(
        `currency-${language}`,
        correction({
          orderId,
          lines: [
            { orderItemId: itemIds[0], productName: 'Example Server', quantity: 1, amount: 250 },
          ],
          total: 250,
          currency: 'EUR',
        }),
        language,
        422,
        'INVOICE_CORRECTION_CURRENCY_MISMATCH',
      );
      expect(error.details).toEqual({
        requestedCurrency: 'EUR',
        invoiceCurrency: 'PLN',
        originalInvoiceId: expect.any(String),
      });
      expect(error.message).toBe(
        {
          en: "A correction must be issued in the corrected invoice's currency (PLN), not EUR.",
          pl: 'Korektę należy wystawić w walucie korygowanej faktury (PLN), a nie w EUR.',
        }[language],
      );
    });
  });

  describe('INVOICE_CORRECTION_TOTAL_EXCEEDS_LINES — a total its lines do not add up to', () => {
    it.each(['en', 'pl'] as const)('more than the lines (%s)', async (language) => {
      const { orderId, itemIds } = await issueBaseInvoice();
      const error = await refusal(
        `total-${language}`,
        correction({
          orderId,
          lines: [
            { orderItemId: itemIds[0], productName: 'Example Server', quantity: 1, amount: 250 },
          ],
          total: 500,
          currency: 'PLN',
        }),
        language,
        400,
        'INVOICE_CORRECTION_TOTAL_EXCEEDS_LINES',
      );
      expect(error.details).toEqual({ total: '500.00', linesTotal: '250.00', currency: 'PLN' });
      expect(error.message).toBe(
        {
          en: 'The correction total (500.00 PLN) is more than its lines add up to (250.00 PLN).',
          pl: 'Suma korekty (500.00 PLN) jest wyższa niż suma jej pozycji (250.00 PLN).',
        }[language],
      );
    });

    it.each(['en', 'pl'] as const)('less than the charges it credits (%s)', async (language) => {
      const { orderId, itemIds } = await issueBaseInvoice(20);
      const error = await refusal(
        `below-charges-${language}`,
        correction({
          orderId,
          lines: [
            { orderItemId: itemIds[0], productName: 'Example Server', quantity: 1, amount: 0 },
          ],
          total: 5,
          currency: 'PLN',
          charges: { delivery: 20 },
        }),
        language,
        400,
        'INVOICE_CORRECTION_TOTAL_EXCEEDS_LINES',
      );
      expect(error.details).toEqual({
        code: 'below_charges',
        total: '5.00',
        linesTotal: '20.00',
        currency: 'PLN',
      });
      expect(error.message).toBe(
        {
          en: 'The correction total (5.00 PLN) is less than the charges it credits (20.00 PLN).',
          pl: 'Suma korekty (5.00 PLN) jest niższa niż zwracane w niej opłaty (20.00 PLN).',
        }[language],
      );
    });
  });

  describe('INVOICE_CORRECTION_EXCEEDS_RATE_REMAINING — more goods than the invoice charges at a rate', () => {
    it.each(['en', 'pl'] as const)('%s', async (language) => {
      // The invoice charges 6648.15 gross at 23 % and takes 100.00 off on a 0 %
      // discount line, so it totals 6548.15. A refund of that total carrying
      // 150.00 of discount credits 6698.15 of goods: within the invoice, above
      // what it charges at the rate.
      const { orderId, itemIds } = await issueBaseInvoice(0, 100);
      const error = await refusal(
        `rate-${language}`,
        correction({
          orderId,
          lines: [
            {
              orderItemId: itemIds[1],
              productName: 'Example Labour Hours',
              quantity: 53,
              amount: 6548.15,
              discount: 150,
            },
          ],
          total: 6548.15,
          currency: 'PLN',
        }),
        language,
        422,
        'INVOICE_CORRECTION_EXCEEDS_RATE_REMAINING',
      );
      expect(error.details).toEqual({
        taxRate: '0.2300',
        vatRatePercent: '23',
        remaining: '6648.15',
        currency: 'PLN',
      });
      expect(error.message).toBe(
        {
          en: 'This refund is more than the invoice still charges at 23% VAT (6648.15 PLN). Lower the amount.',
          pl: 'Ten zwrot przekracza kwotę, którą faktura nadal nalicza w stawce VAT 23% (6648.15 PLN). Zmniejsz kwotę.',
        }[language],
      );
    });
  });

  describe('INVOICE_CORRECTION_EXCEEDS_CHARGE_REMAINING — more of a charge than the invoice charges', () => {
    it.each(['en', 'pl'] as const)('the delivery (%s)', async (language) => {
      const { orderId, itemIds } = await issueBaseInvoice(20);
      const error = await refusal(
        `charge-${language}`,
        correction({
          orderId,
          lines: [
            { orderItemId: itemIds[0], productName: 'Example Server', quantity: 1, amount: 0 },
          ],
          total: 100,
          currency: 'PLN',
          charges: { delivery: 100 },
        }),
        language,
        422,
        'INVOICE_CORRECTION_EXCEEDS_CHARGE_REMAINING',
      );
      expect(error.details).toEqual({
        code: 'delivery',
        chargeKind: 'delivery',
        remaining: '20.00',
        currency: 'PLN',
      });
      expect(error.message).toBe(
        {
          en: 'This refund of the delivery is more than the invoice still charges for it (20.00 PLN). Lower the amount.',
          pl: 'Zwrot kosztów dostawy przekracza kwotę, którą faktura nadal za nią nalicza (20.00 PLN). Zmniejsz kwotę.',
        }[language],
      );
    });
  });

  it('routes every minted code to invoices, the module that raises it', () => {
    for (const code of [
      'INVOICE_SELLER_DATA_MISSING',
      'INVOICE_CORRECTION_CURRENCY_MISMATCH',
      'INVOICE_CORRECTION_TOTAL_EXCEEDS_LINES',
      'INVOICE_CORRECTION_EXCEEDS_RATE_REMAINING',
      'INVOICE_CORRECTION_EXCEEDS_CHARGE_REMAINING',
    ]) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('invoices');
    }
  });
});
