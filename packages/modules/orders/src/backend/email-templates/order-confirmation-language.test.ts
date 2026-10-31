import { readFileSync } from 'node:fs';

import type { SupportedLanguage } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import { ORDERS_PROSE_EN } from '../orders-prose.js';
import { noCarrierShippingLineRenderer, noGatewayPaymentLineRenderer } from './adapter-line-baselines.js';
import { buildOrderConfirmationEmail, resolveOrderConfirmationProse } from './order-confirmation.js';

/**
 * Issue #95 (`orders`) — the in-code order-confirmation builder chose between
 * a Polish and an English literal per line on a boolean. The language is a
 * parameter now and the sentences are this module's bundle's, so a third
 * shipped language has somewhere to go. The Polish e-mail is what a Polish
 * buyer received before, byte for byte; so is the English one.
 */

const bundle = (language: SupportedLanguage): Record<string, string> =>
  JSON.parse(
    readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;

const bundleTranslate = (key: string, language: SupportedLanguage): Promise<string> =>
  Promise.resolve(bundle(language)[key] ?? bundle('en')[key] ?? `orders.${key}`);

const renderers = { payment: noGatewayPaymentLineRenderer, shipping: noCarrierShippingLineRenderer };

const input = (language: string, discount = true) => ({
  to: 'b@example.com',
  language,
  order: {
    id: 'o-1',
    businessId: 'ORD-1042',
    deliveryMethodSnapshot: { code: 'courier', name: 'Kurier', cost: 12 },
    paymentMethodSnapshot: {
      code: 'cod',
      name: 'Za pobraniem',
      kind: 'pickup',
      adapter: 'pickup',
      additionalPrice: 5,
    },
    paymentRendererKey: null,
    subtotal: '100.00',
    taxTotal: '23.00',
    discountTotal: discount ? '10.00' : '0.00',
    deliveryTotal: '12.00',
    total: '130.00',
    currency: 'PLN',
    promotionCode: discount ? 'SAVE10' : null,
    deliveryAddress: {
      recipientName: 'Jan Kowalski',
      street: 'ul. Wysyłkowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
      phone: '500600700',
    },
    billingAddress: {
      recipientName: 'Jan Kowalski',
      companyName: 'Firma Sp. z o.o.',
      taxId: '5260001246',
      street: 'ul. Rozliczeniowa 2',
      city: 'Kraków',
      postalCode: '30-002',
      country: 'PL',
    },
  },
  items: [{ productSnapshot: { sku: 'SKU-1', name: 'Widget' }, quantity: 2, unitPrice: '40.00', lineTotal: '98.40' }],
});

const ADDRESSES_PL =
  '\n\nAdres dostawy:\n  Jan Kowalski\n  ul. Wysyłkowa 1\n  00-001 Warszawa\n  PL\n  tel. 500600700' +
  '\n\nAdres rozliczeniowy:\n  Firma Sp. z o.o.\n  NIP: 5260001246\n  Jan Kowalski\n  ul. Rozliczeniowa 2\n  30-002 Kraków\n  PL';

describe('order confirmation — the language is a parameter (issue #95)', () => {
  it('writes the Polish e-mail byte for byte as before, from the Polish bundle', async () => {
    const prose = await resolveOrderConfirmationProse(bundleTranslate, 'pl-PL');
    const mail = buildOrderConfirmationEmail(input('pl-PL'), renderers, prose);

    expect(mail.subject).toBe('Potwierdzenie zamówienia ORD-1042');
    expect(mail.text).toBe(
      'Dziękujemy za zamówienie.\n\nZamówienie: ORD-1042\n\nProdukty:\n  2 × Widget (SKU-1) — 98.40 PLN' +
        '\n\nMetoda dostawy: Kurier — 12.00 PLN\nMetoda płatności: Za pobraniem (+5.00 PLN)' +
        '\n\nZastosowane rabaty:\n  SAVE10: -10.00 PLN' +
        '\n\nPodsumowanie:\n  Suma częściowa: 100.00 PLN\n  VAT: 23.00 PLN\n  Dostawa: 12.00 PLN\n  Rabat: -10.00 PLN\n  Razem: 130.00 PLN' +
        ADDRESSES_PL,
    );
    expect(buildOrderConfirmationEmail(input('pl-PL', false), renderers, prose).text).toContain(
      '\n\nZastosowane rabaty:\n  brak\n\nPodsumowanie:\n',
    );
  });

  it('writes the English e-mail as before, from the English bundle', async () => {
    const prose = await resolveOrderConfirmationProse(bundleTranslate, 'en-US');
    const mail = buildOrderConfirmationEmail(input('en-US'), renderers, prose);

    expect(mail.subject).toBe('Order confirmation ORD-1042');
    expect(mail.text.split('\n\n').slice(0, 5)).toEqual([
      'Thank you for your order.',
      'Order: ORD-1042',
      'Products:\n  2 × Widget (SKU-1) — 98.40 PLN',
      'Delivery method: Kurier — 12.00 PLN\nPayment method: Za pobraniem (+5.00 PLN)',
      'Applied discounts:\n  SAVE10: -10.00 PLN',
    ]);
    expect(mail.text).toContain('\n\nSummary:\n');
    expect(mail.text).toContain('\n\nShipping address:\n');
    expect(mail.text).toContain('\n\nBilling address:\n');
  });

  it('writes a language no bundle ships for in English', async () => {
    const prose = await resolveOrderConfirmationProse(bundleTranslate, 'de-DE');
    expect(buildOrderConfirmationEmail(input('de-DE'), renderers, prose).subject).toBe(
      'Order confirmation ORD-1042',
    );
  });

  it('writes English in code when no translator is wired', async () => {
    const prose = await resolveOrderConfirmationProse(undefined, 'pl-PL');
    expect(buildOrderConfirmationEmail(input('pl-PL'), renderers, prose).subject).toBe(
      'Order confirmation ORD-1042',
    );
  });

  it("keeps the in-code English tier equal to the English bundle, and ships Polish", () => {
    const en = bundle('en');
    const pl = bundle('pl');
    for (const [key, english] of Object.entries(ORDERS_PROSE_EN)) {
      expect(en[key], key).toBe(english);
      expect(pl[key], key).toBeTypeOf('string');
    }
  });
});
