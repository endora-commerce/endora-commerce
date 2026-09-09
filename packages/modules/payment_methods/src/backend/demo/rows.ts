/**
 * The payment methods this module's demo data creates (feature 113, T220).
 *
 * One place holding the data, imported by both bodies: `seed.ts` creates these
 * rows and `reset.ts` withdraws exactly them, by the `code` they are keyed on
 * (contract §2.5). The values are the host seed's verbatim; the frozen copy
 * that was the parity comparison's reference side went with the corpus at
 * T226, and `test/integration/demo/demo-shop.test.ts`' recorded delta is what
 * holds them now.
 *
 * **The granted credit limit that goes with `credit_limit` is not here**, and
 * it is not an omission: a grant is a row in `credit_limits` against a
 * particular organisation, which is two modules' rows and therefore a
 * composition step (§5.1), not this module's demo data. Until it moves it stays
 * in the host residue beside the demo organisation it is granted to.
 */

/** One demo payment method, in `PaymentMethod`'s own field names. */
export interface DemoPaymentMethodRow {
  readonly code: string;
  /** Per-language, covering every shipped language (contract §2.6). */
  readonly name: Readonly<Record<string, string>>;
  readonly kind: 'bank_transfer' | 'pickup' | 'credit_limit' | 'gateway';
  readonly adapter: string;
  readonly statusOnPending: string;
  readonly statusOnSuccess: string;
  readonly statusOnFailure: string;
}

export const DEMO_PAYMENT_METHOD_ROWS: readonly DemoPaymentMethodRow[] = [
  {
    code: 'bank_transfer',
    name: { 'en-US': 'Bank transfer', 'pl-PL': 'Przelew bankowy' },
    kind: 'bank_transfer',
    adapter: 'bank_transfer',
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    // Feature 085 (FR-003) — the shipped default; a declined payment holds the
    // order rather than ending it.
    statusOnFailure: 'on_hold',
  },
  {
    // The platform's headline B2B payment path, seeded so a fresh dev
    // environment shows it (feature 080, D5). `credit_limit` has been a
    // first-class `paymentMethodKindSchema` member and a registered adapter all
    // along, and checkout already offers it — but only when an operator has
    // created the row, which no seed did, so the capability read as missing.
    //
    // `statusOnSuccess: 'paid'` is what a settled deferred payment means; the
    // reservation itself is opened inside the placement transaction and the
    // order waits in `new` until the proforma is settled.
    code: 'credit_limit',
    name: { 'en-US': 'Credit limit', 'pl-PL': 'Limit kupiecki' },
    kind: 'credit_limit',
    adapter: 'credit_limit',
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'on_hold',
  },
];

/** The codes `reset` withdraws — derived from the rows, never a second list. */
export const DEMO_PAYMENT_METHOD_CODES: readonly string[] = DEMO_PAYMENT_METHOD_ROWS.map(
  (row) => row.code,
);
