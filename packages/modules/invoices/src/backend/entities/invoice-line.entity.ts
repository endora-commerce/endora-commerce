import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Issue #904 — what an invoice line is (`invoice_lines.line_kind`). A
 * `price_reduction` is a correction's line; the others are an issued
 * document's.
 */
export const INVOICE_LINE_KINDS = ['goods', 'delivery', 'payment_surcharge', 'discount', 'price_reduction'] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];

/**
 * Immutable snapshot of one invoice line at issuance (feature 047). Independent
 * of later order edits. For corrections, holds the corrected delta lines.
 */
@GlobalEntity()
@Entity({ tableName: 'invoice_lines' })
@Index({ properties: ['invoiceId', 'ordinal'] })
export class InvoiceLine {
  [OptionalProps]?: 'id' | 'orderItemId' | 'lineKind';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  invoiceId!: string;

  @Property({ type: 'integer' })
  ordinal!: number;

  @Property({ type: 'string', length: 512 })
  name!: string;

  @Property({ type: 'string', length: 32 })
  unit!: string;

  @Property({ type: 'decimal', precision: 12, scale: 3 })
  quantity!: string;

  @Property({ type: 'decimal', precision: 14, scale: 4 })
  unitNetPrice!: string;

  @Property({ type: 'decimal', precision: 5, scale: 4 })
  taxRate!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  netValue!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  grossValue!: string;

  @Property({ type: 'uuid', nullable: true })
  orderItemId?: string | null;

  /**
   * Issue #904 — the line's kind, written for every line of an invoice or a
   * proforma issued from now on, the 0 % delivery and surcharge lines included.
   * `null`: a line issued before, or one no writer names yet (a correction's
   * goods and discount lines), told apart as it always was — by its
   * `orderItemId` and its sign. A correction's credited delivery or surcharge
   * (issue #876) is written with its kind: it names no order item and is
   * positive, so nothing else would tell the two apart.
   */
  @Property({ type: 'string', length: 24, nullable: true })
  lineKind?: InvoiceLineKind | null = null;
}
