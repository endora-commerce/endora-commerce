import type {
  LedgerFixtureDocumentRequest,
  LedgerFixtureDocumentResult,
  LedgerFixtureHttpPort,
} from '../../src/apps/example/modules/ledger_vendor_fixture/ports.js';

/**
 * The scripted double for `ledger_vendor_fixture`'s one outward port — the free
 * ledger suite's equivalent of `ScriptedInfaktClient` and `ScriptedWfirmaClient`,
 * over a vendor that is not going anywhere.
 *
 * It lives in `backend/test/helpers/` rather than inside the module, because the
 * module is `backend/src` — production source for the `example` deployment — and
 * a scripted double is not something a deployment ships. The two real vendors
 * publish theirs on a `./test-support` subpath precisely because their host tests
 * are in another repository; this one has no such problem.
 *
 * `implements LedgerFixtureHttpPort` is load-bearing: it is what makes a change
 * to the port a local type error here, which is the consumer-side half of
 * FR-063's argument.
 */
export class ScriptedLedgerFixtureClient implements LedgerFixtureHttpPort {
  /** Every `createDocument` call, in order. */
  readonly createCalls: LedgerFixtureDocumentRequest[] = [];

  /**
   * What the next call answers. Defaults to success; a test that wants a refusal
   * assigns one and the next call consumes the *standing* value — the two real
   * scripted clients behave the same way, so a test moved from one to the other
   * keeps its meaning.
   */
  next: LedgerFixtureDocumentResult | null = null;

  /** The remote id the next success reports. Incremented so ids never collide. */
  nextRemoteDocumentId: string | null = null;

  /** The number the vendor assigns when the ledger's numbering mode is `vendor`. */
  nextRemoteVendorNumber: string | null = null;

  /** The KSeF reference the vendor reports when the ledger delegated KSeF. */
  nextKsefReferenceNumber: string | null = null;

  private sequence = 0;

  async createDocument(input: LedgerFixtureDocumentRequest): Promise<LedgerFixtureDocumentResult> {
    this.createCalls.push(input);
    if (this.next !== null) return this.next;
    this.sequence += 1;
    return {
      ok: true,
      remoteDocumentId: this.nextRemoteDocumentId ?? `fixture-doc-${this.sequence}`,
      remoteVendorNumber: this.nextRemoteVendorNumber,
      ksefReferenceNumber: input.sendToKsef ? this.nextKsefReferenceNumber : null,
    };
  }

  /** Forget every recorded call and every standing script. */
  reset(): void {
    this.createCalls.length = 0;
    this.next = null;
    this.nextRemoteDocumentId = null;
    this.nextRemoteVendorNumber = null;
    this.nextKsefReferenceNumber = null;
  }
}
