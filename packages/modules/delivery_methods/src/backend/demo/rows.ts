/**
 * The delivery method this module's demo data creates (feature 113, T220).
 *
 * One place holding the data, imported by both bodies: `seed.ts` creates these
 * rows and `reset.ts` withdraws exactly them, by the `code` they are keyed on
 * (contract §2.5). The values are the host seed's verbatim; the frozen copy
 * that was the parity comparison's reference side went with the corpus at
 * T226, and `test/integration/demo/demo-shop.test.ts`' recorded delta is what
 * holds them now.
 */

/** One demo delivery method, in `DeliveryMethod`'s own field names. */
export interface DemoDeliveryMethodRow {
  readonly code: string;
  /** Per-language, covering every shipped language (contract §2.6). */
  readonly name: Readonly<Record<string, string>>;
  readonly cost: string;
  readonly currency: string;
  /** The shipping adapter backing this method (feature 035). */
  readonly adapter: string;
}

export const DEMO_DELIVERY_METHOD_ROWS: readonly DemoDeliveryMethodRow[] = [
  {
    code: 'in_person_pickup',
    name: { 'en-US': 'In-person pickup', 'pl-PL': 'Odbior osobisty' },
    cost: '0',
    currency: 'PLN',
    adapter: 'personal_pickup',
  },
];

/** The codes `reset` withdraws — derived from the rows, never a second list. */
export const DEMO_DELIVERY_METHOD_CODES: readonly string[] = DEMO_DELIVERY_METHOD_ROWS.map(
  (row) => row.code,
);
