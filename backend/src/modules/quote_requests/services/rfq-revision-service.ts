import type { EntityManager } from '@mikro-orm/postgresql';
import {
  QuoteRequestRevision,
  type QuoteRequestRevisionLine,
} from '../entities/quote-request-revision.entity.js';
import type { QuoteRequest } from '../entities/quote-request.entity.js';
import type { QuoteRequestItem } from '../entities/quote-request-item.entity.js';

/**
 * Coarse-grained revision snapshot writer + diff calculator. Each
 * `modify` event in the lifecycle creates one row in
 * quote_request_revisions; the customer-facing comparison view
 * (`comparisonAgainstLastSeen`) is computed on the fly by
 * `diffRevisions` rather than being persisted.
 */
export type RfqDiffEntry =
  | { kind: 'header_note'; before: string | null; after: string | null }
  | {
      kind: 'line_added';
      productId: string;
      productName: string;
      quantity: number;
      agreedUnitPrice: number | null;
    }
  | { kind: 'line_removed'; productId: string; productName: string }
  | {
      kind: 'line_quantity';
      productId: string;
      productName: string;
      before: number;
      after: number;
    }
  | {
      kind: 'line_agreed_unit_price';
      productId: string;
      productName: string;
      before: number | null;
      after: number | null;
    };

export interface RecordRevisionInput {
  rfq: QuoteRequest;
  items: QuoteRequestItem[];
  actor: { adminUserId?: string | null; customerAccountId?: string | null };
  previousRevisionId?: string | null;
}

export class RfqRevisionService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async record(input: RecordRevisionInput): Promise<QuoteRequestRevision> {
    const em = this.emFactory();
    const itemsSnapshot = input.items.map(toSnapshotLine);
    const nextNumber = input.rfq.currentRevisionNumber + 1;
    const rev = em.create(QuoteRequestRevision, {
      quoteRequestId: input.rfq.id,
      revisionNumber: nextNumber,
      createdByAdminUserId: input.actor.adminUserId ?? null,
      createdByCustomerAccountId: input.actor.customerAccountId ?? null,
      headerNoteSnapshot: input.rfq.headerNote ?? null,
      itemsSnapshot,
      previousRevisionId: input.previousRevisionId ?? null,
    });
    await em.persistAndFlush(rev);
    return rev;
  }

  /** Returns the latest revision for an RFQ, if any. */
  async latestForRfq(quoteRequestId: string): Promise<QuoteRequestRevision | null> {
    const em = this.emFactory();
    const found = await em.find(
      QuoteRequestRevision,
      { quoteRequestId },
      { orderBy: { revisionNumber: 'desc' }, limit: 1 },
    );
    return found[0] ?? null;
  }

  /** Returns the revision whose `revisionNumber === n`, if any. */
  async byNumber(quoteRequestId: string, n: number): Promise<QuoteRequestRevision | null> {
    const em = this.emFactory();
    const found = await em.find(
      QuoteRequestRevision,
      { quoteRequestId, revisionNumber: n },
      { limit: 1 },
    );
    return found[0] ?? null;
  }

  /**
   * Pure diff calculator. Takes two snapshots (`before`, `after`) plus
   * their header notes and returns the list of diff entries in the
   * order header → line_added → line_removed → line_quantity →
   * line_agreed_unit_price. Stable by productId so renderers can
   * group/sort easily.
   */
  diffRevisions(args: {
    beforeHeaderNote: string | null;
    afterHeaderNote: string | null;
    beforeItems: QuoteRequestRevisionLine[];
    afterItems: QuoteRequestRevisionLine[];
  }): RfqDiffEntry[] {
    const out: RfqDiffEntry[] = [];

    if ((args.beforeHeaderNote ?? null) !== (args.afterHeaderNote ?? null)) {
      out.push({
        kind: 'header_note',
        before: args.beforeHeaderNote ?? null,
        after: args.afterHeaderNote ?? null,
      });
    }

    const beforeByProduct = new Map(args.beforeItems.map((l) => [l.productId, l]));
    const afterByProduct = new Map(args.afterItems.map((l) => [l.productId, l]));

    for (const [productId, after] of afterByProduct) {
      if (!beforeByProduct.has(productId)) {
        out.push({
          kind: 'line_added',
          productId,
          productName: after.productName,
          quantity: after.quantity,
          agreedUnitPrice: after.agreedUnitPrice,
        });
      }
    }

    for (const [productId, before] of beforeByProduct) {
      if (!afterByProduct.has(productId)) {
        out.push({
          kind: 'line_removed',
          productId,
          productName: before.productName,
        });
      }
    }

    for (const [productId, after] of afterByProduct) {
      const before = beforeByProduct.get(productId);
      if (!before) continue;
      if (before.quantity !== after.quantity) {
        out.push({
          kind: 'line_quantity',
          productId,
          productName: after.productName,
          before: before.quantity,
          after: after.quantity,
        });
      }
      const beforePrice = before.agreedUnitPrice;
      const afterPrice = after.agreedUnitPrice;
      if (beforePrice !== afterPrice) {
        out.push({
          kind: 'line_agreed_unit_price',
          productId,
          productName: after.productName,
          before: beforePrice,
          after: afterPrice,
        });
      }
    }

    return out;
  }
}

function toSnapshotLine(item: QuoteRequestItem): QuoteRequestRevisionLine {
  return {
    productId: item.productId,
    variantId: item.variantId ?? null,
    productName: item.productName,
    productSlug: item.productSlug ?? null,
    quantity: item.quantity,
    desiredUnitPrice: item.desiredUnitPrice != null ? Number(item.desiredUnitPrice) : null,
    agreedUnitPrice: item.agreedUnitPrice != null ? Number(item.agreedUnitPrice) : null,
    lineNote: item.lineNote ?? null,
    lineCurrency: item.lineCurrency,
    discountPercent: item.discountPercent != null ? Number(item.discountPercent) : null,
  };
}
