/**
 * The tax rules this module's demo data creates (feature 113, T220).
 *
 * One place holding the data, imported by both bodies: `seed.ts` creates these
 * rows and `reset.ts` withdraws exactly them, by the `code` they are keyed on
 * (contract §2.5 — a predicate over the table would take an operator's own rule
 * with it).
 *
 * The values are `dev-catalog-seed.ts`' verbatim, moved rather than rewritten:
 * `backend/src/seeds/demo-relocated-reference.ts` holds the block this replaced
 * and `test/integration/demo/demo-parity.test.ts` compares the two databases
 * row for row while both exist.
 */

/** One demo tax rule, in `Tax`'s own field names. */
export interface DemoTaxRow {
  readonly code: string;
  readonly name: string;
  readonly rate: string;
  readonly country: string;
  readonly isDefault: boolean;
}

/**
 * The Polish standard VAT rate.
 *
 * `name` is a plain column on `Tax` rather than a per-language map, so contract
 * §2.6's per-language shape has nowhere to go here; the value is a rule label
 * built out of a country code and a percentage, and it reads the same in both
 * shipped languages.
 */
export const DEMO_TAX_ROWS: readonly DemoTaxRow[] = [
  { code: 'pl_vat_23', name: 'PL VAT 23%', rate: '0.23', country: 'PL', isDefault: true },
];

/** The codes `reset` withdraws — derived from the rows, never a second list. */
export const DEMO_TAX_CODES: readonly string[] = DEMO_TAX_ROWS.map((row) => row.code);
