/**
 * The fixture vendor's own remote surface.
 *
 * It is declared **here**, not in `@endora-commerce/contracts`, for the reason
 * `specs/conventions/module-composition.md` gives for any port only one module
 * speaks: nobody outside this module calls it. A free published package carrying
 * a fixture's HTTP shape would be the same defect `spec.md` §2.5 names about a
 * paid vendor's vocabulary, one size down.
 *
 * The shape is deliberately the *narrowest* thing a ledger vendor needs — create
 * a document, read one back — rather than a copy of either real vendor's client.
 * A fixture that mirrored a vendor's API would couple the free suite to that
 * vendor's shape by another route.
 */

export interface LedgerFixtureDocumentRequest {
  /** The frozen credential code the delivery row carries. */
  apiKey: string;
  environment: 'sandbox' | 'production';
  /** `null` when the ledger's numbering mode hands numbering to the vendor. */
  number: string | null;
  buyerTaxId: string;
  currency: string;
  /** The original's remote id, for a correction. */
  originalRemoteDocumentId: string | null;
  /** Whether the ledger delegated KSeF to this vendor for this delivery. */
  sendToKsef: boolean;
}

export type LedgerFixtureDocumentResult =
  | {
      ok: true;
      remoteDocumentId: string;
      /** The number the vendor assigned, when the ledger asked it to number. */
      remoteVendorNumber: string | null;
      ksefReferenceNumber: string | null;
    }
  | { ok: false; message: string; transient: boolean };

export interface LedgerFixtureHttpPort {
  createDocument(input: LedgerFixtureDocumentRequest): Promise<LedgerFixtureDocumentResult>;
}

/**
 * The default the module composes with, and it refuses.
 *
 * Same argument as the two real vendors' refusing clients and as
 * `product_feeds`' refusing delivery adapters: a code path that starts talking to
 * a remote without a test opting in has to fail loudly rather than quietly
 * succeed. There is no remote here at all, so "loudly" is the only honest answer.
 */
export function refusingLedgerFixtureHttp(): LedgerFixtureHttpPort {
  return {
    async createDocument() {
      throw new Error(
        'ledger_vendor_fixture: no scripted client was supplied. Register `ledgerFixtureHttp` before driving a delivery.',
      );
    },
  };
}
