import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { paymentStatusSchema } from '@endora-commerce/contracts';

/**
 * Feature 085 Phase G (FR-022) — the money axis is rendered in the operator's
 * language wherever it is shown.
 *
 * The admin orders list printed `o.paymentStatus` raw, so an operator read
 * `awaiting_payment` in a screen that is otherwise entirely translated. The
 * column now resolves `orderDetail.paymentStatus.<code>` — the key set the
 * order detail screen already ships — and this asserts the shipped bundles
 * carry a sentence for **every** value the platform can produce, in **both**
 * shipped languages.
 *
 * Read off disk rather than through the loader: what the screen renders is the
 * file, and a key present in `en` alone is precisely the failure this guards.
 */

const I18N_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/modules/_i18n/i18n',
);

function bundle(language: string): Record<string, string> {
  return JSON.parse(readFileSync(join(I18N_DIR, `${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
}

describe('payment-status labels ship in both languages', () => {
  const en = bundle('en');
  const pl = bundle('pl');

  it.each(paymentStatusSchema.options)('has a sentence for %s in en and pl', (code) => {
    const key = `orderDetail.paymentStatus.${code}`;
    expect(en[key], `${key} missing from en.json`).toBeTruthy();
    expect(pl[key], `${key} missing from pl.json`).toBeTruthy();
    // The Polish bundle may not simply repeat the wire code — which is what a
    // "translation" added by copying the key's tail would do, and what the
    // column used to render in every language.
    expect(pl[key]).not.toBe(code);
  });

  it('labels the list column and its new filter in both languages', () => {
    for (const key of ['orders.column.payment', 'orders.field.paymentStatus']) {
      expect(en[key], `${key} missing from en.json`).toBeTruthy();
      expect(pl[key], `${key} missing from pl.json`).toBeTruthy();
      expect(pl[key]).not.toBe(en[key]);
    }
  });
});
