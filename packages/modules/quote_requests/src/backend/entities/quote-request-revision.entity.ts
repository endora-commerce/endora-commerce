import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * QuoteRequestRevision — coarse-grained snapshot taken at every modify
 * event. Drives the storefront comparison-with-last-seen view (US3).
 *
 * The `itemsSnapshot` jsonb stores the full set of lines as an array
 * of plain objects so the diff calculator can compare two revisions
 * with one read each. Diffs are not persisted — they are computed on
 * the fly by RfqRevisionService.
 */
export interface QuoteRequestRevisionLine {
  productId: string;
  variantId: string | null;
  productName: string;
  productSlug: string | null;
  quantity: number;
  desiredUnitPrice: number | null;
  agreedUnitPrice: number | null;
  lineNote: string | null;
  lineCurrency: string;
  discountPercent: number | null;
  /**
   * Feature 146 (research R6) — the packaging unit of the line. Written from
   * feature 146 on; older snapshots lack both keys and the history matcher
   * treats an absent key as unknown.
   */
  packagingUnitName?: string | null;
  packagingUnitBaseQuantity?: number | null;
  /**
   * Feature 159 (research R-10) — the line's place in the arrangement the
   * customer was shown. Snapshots are written in display order; only groups
   * holding a line can appear. Absent on snapshots written before the
   * feature, read as "ungrouped, legacy order".
   */
  /** Order within the line's section. */
  position?: number;
  /** `null` = ungrouped. */
  groupId?: string | null;
  groupName?: string | null;
  /** The group's order among the quote's groups; `null` when ungrouped. */
  groupPosition?: number | null;
}

@GlobalEntity()
@Entity({ tableName: 'quote_request_revisions' })
export class QuoteRequestRevision {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'createdByAdminUserId'
    | 'createdByCustomerAccountId'
    | 'headerNoteSnapshot'
    | 'previousRevisionId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  quoteRequestId!: string;

  @Property({ type: 'integer' })
  revisionNumber!: number;

  @Property({ type: 'uuid', nullable: true })
  createdByAdminUserId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  createdByCustomerAccountId?: string | null;

  @Property({ type: 'text', nullable: true })
  headerNoteSnapshot?: string | null;

  @Property({ type: 'json' })
  itemsSnapshot!: QuoteRequestRevisionLine[];

  @Property({ type: 'uuid', nullable: true })
  previousRevisionId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
