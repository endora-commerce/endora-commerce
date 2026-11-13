import type { EntityManager } from '@mikro-orm/postgresql';
import {
  QuoteRequestRevision,
  type QuoteRequestRevisionLine,
} from '../entities/quote-request-revision.entity.js';
import type { QuoteRequest } from '../entities/quote-request.entity.js';
import type { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import { QuoteRequestItemGroup } from '../entities/quote-request-item-group.entity.js';
import { disambiguatingGroupName, pairSnapshotLines } from './snapshot-pairing.js';

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
      /** Feature 159 (research N-32) — only for a product on several lines; `null` = ungrouped. */
      groupName?: string | null;
      quantity: number;
      agreedUnitPrice: number | null;
    }
  | { kind: 'line_removed'; productId: string; productName: string; groupName?: string | null }
  | {
      kind: 'line_quantity';
      productId: string;
      productName: string;
      groupName?: string | null;
      before: number;
      after: number;
    }
  | {
      kind: 'line_agreed_unit_price';
      productId: string;
      productName: string;
      groupName?: string | null;
      before: number | null;
      after: number | null;
    }
  /**
   * Feature 159 (research R-11) — the arrangement of the lines as shown differs.
   * No other key: it names nothing the customer reply does not carry.
   */
  | { kind: 'grouping' };

export interface RecordRevisionInput {
  rfq: QuoteRequest;
  /** In display order (feature 159): the snapshot keeps the order it is given. */
  items: QuoteRequestItem[];
  actor: { adminUserId?: string | null; customerAccountId?: string | null };
  previousRevisionId?: string | null;
}

export class RfqRevisionService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * `within` is the caller's transactional EntityManager: a revision is part of
   * the change it snapshots, and a transition that holds the request's row
   * (`underRowLock`) writes it there (`specs/179-rfq-and-customer-notifications/`
   * research R-6). Without it the revision is written, and committed, on an
   * EntityManager of this service's own.
   */
  async record(input: RecordRevisionInput, within?: EntityManager): Promise<QuoteRequestRevision> {
    // command-coverage-ignore: immutable per-revision snapshot of the RFQ state
    // (version history), written as part of the audited parent RFQ action.
    const em = within ?? this.emFactory();
    // Feature 159 (research R-10) — each line records its place in the
    // arrangement the customer is shown; only groups holding a line appear.
    const groups = await em.find(QuoteRequestItemGroup, { quoteRequestId: input.rfq.id });
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const itemsSnapshot = input.items.map((item) => toSnapshotLine(item, groupById));
    // Caller sets `rfq.currentRevisionNumber` to the number of the
    // revision being recorded BEFORE calling record(). This service
    // never auto-bumps so the number on the rfq row and on the
    // revision row are guaranteed to match.
    const rev = em.create(QuoteRequestRevision, {
      quoteRequestId: input.rfq.id,
      revisionNumber: input.rfq.currentRevisionNumber,
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

  /**
   * Feature 146 (threat model T9) — the named revisions of one request, by id
   * or by number; nothing else. An empty ask reads nothing.
   */
  async findForHistory(
    quoteRequestId: string,
    ask: { ids?: readonly string[]; numbers?: readonly number[] },
  ): Promise<QuoteRequestRevision[]> {
    const ids = [...new Set(ask.ids ?? [])];
    const numbers = [...new Set(ask.numbers ?? [])];
    if (ids.length === 0 && numbers.length === 0) return [];
    const em = this.emFactory();
    const or: Array<Record<string, unknown>> = [];
    if (ids.length > 0) or.push({ id: { $in: ids } });
    if (numbers.length > 0) or.push({ revisionNumber: { $in: numbers } });
    return em.find(QuoteRequestRevision, { quoteRequestId, $or: or });
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
   * line_agreed_unit_price → grouping, each kind in the snapshots' line
   * order. Lines pair one to one (feature 159: a product may sit on several
   * lines, in different groups — see `snapshot-pairing.ts`).
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

    // Feature 159 (research N-32) — lines pair one to one (a product may sit
    // on several lines, in different groups), and an entry about a product on
    // more than one line names its group.
    const { paired, removed } = pairSnapshotLines(args.beforeItems, args.afterItems);
    const groupNameOf = disambiguatingGroupName(args.beforeItems, args.afterItems);
    const named = (item: QuoteRequestRevisionLine): { groupName?: string | null } => {
      const groupName = groupNameOf(item);
      return groupName !== undefined ? { groupName } : {};
    };

    args.afterItems.forEach((after, index) => {
      if (paired[index] !== null) return;
      out.push({
        kind: 'line_added',
        productId: after.productId,
        productName: after.productName,
        ...named(after),
        quantity: after.quantity,
        agreedUnitPrice: after.agreedUnitPrice,
      });
    });

    for (const before of removed) {
      out.push({ kind: 'line_removed', productId: before.productId, productName: before.productName, ...named(before) });
    }

    args.afterItems.forEach((after, index) => {
      const before = paired[index];
      if (!before) return;
      if (before.quantity !== after.quantity) {
        out.push({
          kind: 'line_quantity',
          productId: after.productId,
          productName: after.productName,
          ...named(after),
          before: before.quantity,
          after: after.quantity,
        });
      }
      const beforePrice = before.agreedUnitPrice;
      const afterPrice = after.agreedUnitPrice;
      if (beforePrice !== afterPrice) {
        out.push({
          kind: 'line_agreed_unit_price',
          productId: after.productId,
          productName: after.productName,
          ...named(after),
          before: beforePrice,
          after: afterPrice,
        });
      }
    });

    if (groupingChanged(args.beforeItems, args.afterItems, paired)) out.push({ kind: 'grouping' });

    return out;
  }
}

/**
 * The arrangement as shown, over the lines both snapshots hold (`ids` names
 * each line by its pair; a line without one is added or removed — reported as
 * such, not as a grouping change): sections in order (by group id and name),
 * each with its lines in order.
 */
function arrangement(lines: readonly QuoteRequestRevisionLine[], ids: ReadonlyArray<number | null>): string {
  const sections: { key: string; lines: number[] }[] = [];
  lines.forEach((line, index) => {
    const id = ids[index];
    if (id === null || id === undefined) return;
    const key = line.groupId ? `${line.groupId}:${line.groupName ?? ''}` : '';
    let section = sections.find((candidate) => candidate.key === key);
    if (!section) {
      section = { key, lines: [] };
      sections.push(section);
    }
    section.lines.push(id);
  });
  return JSON.stringify(sections);
}

/**
 * Feature 159 — whether the customer is shown a different arrangement. A
 * snapshot written before the feature carries no `position` and an unordered
 * line list, so against it only a grouped arrangement counts as a change.
 */
function groupingChanged(
  before: readonly QuoteRequestRevisionLine[],
  after: readonly QuoteRequestRevisionLine[],
  /** Index-aligned with `after`: the `before` line each line is, or `null`. */
  paired: ReadonlyArray<QuoteRequestRevisionLine | null>,
): boolean {
  const legacy = before.length > 0 && before.every((line) => line.position === undefined);
  if (legacy) return after.some((line) => (line.groupId ?? null) !== null);
  const afterIds = paired.map((line, index) => (line === null ? null : index));
  const beforeIds = before.map((line) => {
    const index = paired.indexOf(line);
    return index < 0 ? null : index;
  });
  return arrangement(before, beforeIds) !== arrangement(after, afterIds);
}

function toSnapshotLine(
  item: QuoteRequestItem,
  groupById: ReadonlyMap<string, Pick<QuoteRequestItemGroup, 'name' | 'position'>>,
): QuoteRequestRevisionLine {
  const group = item.groupId ? groupById.get(item.groupId) : undefined;
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
    packagingUnitName: item.packagingUnitName ?? null,
    packagingUnitBaseQuantity: item.packagingUnitBaseQuantity ?? null,
    position: item.position ?? 0,
    groupId: group ? item.groupId! : null,
    groupName: group?.name ?? null,
    groupPosition: group?.position ?? null,
  };
}
