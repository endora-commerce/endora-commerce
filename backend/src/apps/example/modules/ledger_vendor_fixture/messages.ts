/**
 * The fixture vendor's own operator vocabulary.
 *
 * D-256 is the reason this file exists here rather than in
 * `@endora-commerce/contracts`: *"the vendor that authors an operator sentence
 * owns both the vocabulary and the mapping that produces it"*. `invoice_ledger`
 * holds no vendor vocabulary and applies a vendor-independent shape floor on the
 * write path, so a vendor's sentences are the vendor's and travel with it.
 *
 * Every sentence below is deliberately **not** a copy of a real vendor's. The
 * point of the fixture is that the free ledger suite can assert the ledger's own
 * behaviour — a mapped sentence survives the floor, a dump does not, a wait keeps
 * the row queued — without any paid module's words being readable in a free file.
 *
 * Each one is under the floor's 500-character backstop and carries no markup, no
 * control character and no leading `{` or `[`, which is what
 * `ledger-vendor-fixture.test.ts` asserts rather than assumes.
 */
export const LEDGER_FIXTURE_DELIVERY_MESSAGES = {
  credentialsMissing:
    'The fixture ledger vendor has no API key for this sales channel, so the invoice was not copied.',
  invoiceMissing: 'The invoice this delivery names no longer exists, so there is nothing to copy.',
  missingNip: 'The buyer tax id is missing, so this invoice cannot be copied to the fixture ledger.',
  originalMissing:
    'This correction has no original invoice recorded, so it cannot be copied to the fixture ledger.',
  originalWait:
    'The original invoice has not reached the fixture ledger yet, so this correction is waiting.',
  rejected: 'The fixture ledger vendor rejected this document.',
  unavailable: 'The fixture ledger vendor is temporarily unavailable.',
} as const;

export type LedgerFixtureDeliveryMessage =
  (typeof LEDGER_FIXTURE_DELIVERY_MESSAGES)[keyof typeof LEDGER_FIXTURE_DELIVERY_MESSAGES];
