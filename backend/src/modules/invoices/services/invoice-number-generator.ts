import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import { z } from 'zod';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import { InvoiceNumberCounter } from '../entities/invoice-number-counter.entity.js';

export type InvoiceKind = 'proforma' | 'invoice' | 'correction';

/**
 * Resolves the format pattern for a (kind, salesChannel) — settings-backed in
 * production, but injectable so the formatter and counter can be unit-tested in
 * isolation.
 */
export interface NumberPatternResolver {
  resolvePattern(kind: InvoiceKind, salesChannelId: string): Promise<string>;
}

/**
 * The shipped defaults, which **must** stay identical to the manifest
 * `defaultValue`s (`manifest.ts`): the manifest default is what production
 * resolves, and this map is only reached when the settings read throws.
 *
 * The `/` on both sides of `{channel}` is load-bearing, not cosmetic. A
 * discriminator concatenated straight onto the sequence loses the boundary
 * between the two variable-length fields, so `FV {channel}{seq}/{YYYY}` renders
 * `FV A12/2026` for both (`a1`, seq 2) and (`a`, seq 12) — see D-95.1
 * property 3.
 */
const DEFAULT_PATTERNS: Record<InvoiceKind, string> = {
  invoice: 'FV {seq}/{channel}/{YYYY}',
  proforma: 'PRO {seq}/{channel}/{YYYY}',
  correction: 'KOR {seq}/{channel}/{YYYY}',
};

/** The pre-D-95 defaults, kept for the system-default channel (D-95.3 move 3). */
export const PRE_CHANNEL_DEFAULT_PATTERNS: Record<InvoiceKind, string> = {
  invoice: 'FV {seq}/{YYYY}',
  proforma: 'PRO {seq}/{YYYY}',
  correction: 'KOR {seq}/{YYYY}',
};

/**
 * The pattern a stored setting value really means: a blank value is not an
 * empty pattern, it is "unset", and it resolves to the default. Two channels
 * can therefore collide while their stored values differ, which is why the
 * collision predicate compares what would be *resolved* and never the raw row.
 */
export function effectivePattern(kind: InvoiceKind, stored: string | null | undefined): string {
  return stored && stored.trim() ? stored : DEFAULT_PATTERNS[kind];
}

/** The render context. `channel` is required — see {@link formatInvoiceNumber}. */
export interface InvoiceNumberContext {
  readonly seq: number;
  readonly date: Date;
  /** The discriminator `{channel}` renders: the channel `code`, uppercased. */
  readonly channel: string;
}

/**
 * Render an invoice-number pattern. Supported tokens:
 *   {seq}      — sequence number
 *   {seq:N}    — zero-padded to width N
 *   {channel}  — the sales channel discriminator (feature 078, D-95)
 *   {YYYY}     — 4-digit year
 *   {YY}       — 2-digit year
 *   {MM}       — 2-digit month
 * Everything else is literal (so prefix/suffix are just literal text).
 *
 * `channel` is a **required** member of the context, not an optional one
 * defaulting to `''`: an absent discriminator makes every channel render
 * identically, which is the defect this token exists to remove. A caller that
 * cannot name a channel must fail rather than render.
 *
 * Pure — the collision predicate and the boot report both call it directly.
 */
export function formatInvoiceNumber(pattern: string, ctx: InvoiceNumberContext): string {
  const year = ctx.date.getFullYear();
  const month = ctx.date.getMonth() + 1;
  return pattern.replace(
    /\{(seq(?::(\d+))?|channel|YYYY|YY|MM)\}/g,
    (_m, token: string, pad?: string) => {
      if (token === 'YYYY') return String(year);
      if (token === 'YY') return String(year % 100).padStart(2, '0');
      if (token === 'MM') return String(month).padStart(2, '0');
      if (token === 'channel') return ctx.channel;
      // seq or seq:N
      if (pad) return String(ctx.seq).padStart(Number(pad), '0');
      return String(ctx.seq);
    },
  );
}

/**
 * The discriminator a channel code renders as: uppercase, and otherwise
 * verbatim. The code charset is `/^[a-z][a-z0-9_-]*$/`, so uppercasing is
 * injective — no two channels can produce the same discriminator. Stripping or
 * folding any character would break that and is forbidden.
 */
export function channelDiscriminator(code: string): string {
  return code.toUpperCase();
}

/**
 * Draws gap-free, per-(channel, kind, year) sequence numbers under a pessimistic
 * row lock and assembles the human-readable number from the configured pattern.
 */
export class InvoiceNumberGenerator {
  constructor(private readonly patterns?: NumberPatternResolver) {}

  /** Must run inside an open transaction (`em.transactional(...)`). */
  async next(
    tx: EntityManager,
    kind: InvoiceKind,
    salesChannelId: string,
    issuedAt: Date,
  ): Promise<string> {
    // command-coverage-ignore: gap-free sequence-counter increment under a row
    // lock, invoked within the audited issue()/createCorrection() transaction;
    // internal numbering bookkeeping, not a standalone audited write.
    const periodYear = issuedAt.getFullYear();
    let counter = await tx.findOne(
      InvoiceNumberCounter,
      { salesChannelId, kind, periodYear },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!counter) {
      counter = tx.create(InvoiceNumberCounter, { salesChannelId, kind, periodYear, currentValue: 0 });
    }
    counter.currentValue += 1;
    await tx.persistAndFlush(counter);

    const pattern = await this.resolvePattern(kind, salesChannelId);
    return formatInvoiceNumber(pattern, {
      seq: counter.currentValue,
      date: issuedAt,
      channel: await this.resolveDiscriminator(tx, salesChannelId),
    });
  }

  /**
   * The `{channel}` discriminator for a channel id, read from the kernel's
   * `sales_channels` row.
   *
   * An absent row **fails** rather than rendering an empty discriminator. A
   * fallback here would put every channel back on one string and restore the
   * defect this feature removes; a `salesChannelId` with no row behind it is a
   * data defect in whatever produced it (`Order.salesChannelId` is non-nullable
   * and a system-default channel always exists), and it is reported, not
   * absorbed.
   */
  private async resolveDiscriminator(tx: EntityManager, salesChannelId: string): Promise<string> {
    const channel = await tx.findOne(SalesChannel, { id: salesChannelId });
    if (!channel) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        `Sales channel "${salesChannelId}" has no row, so an invoice number cannot be ` +
          `rendered for it.`,
      );
    }
    return channelDiscriminator(channel.code);
  }

  private async resolvePattern(kind: InvoiceKind, salesChannelId: string): Promise<string> {
    if (!this.patterns) return DEFAULT_PATTERNS[kind];
    try {
      return effectivePattern(kind, await this.patterns.resolvePattern(kind, salesChannelId));
    } catch {
      return DEFAULT_PATTERNS[kind];
    }
  }
}

/**
 * Settings-backed pattern resolver: reads `invoices.numbering.<kind>.pattern`
 * per sales channel, falling back to the built-in default.
 */
export function createSettingsPatternResolver(settingsService: {
  get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T>;
}): NumberPatternResolver {
  return {
    async resolvePattern(kind, salesChannelId) {
      try {
        return await settingsService.get(
          `invoices.numbering.${kind}.pattern`,
          salesChannelId,
          z.string(),
        );
      } catch {
        return DEFAULT_PATTERNS[kind];
      }
    },
  };
}

export { DEFAULT_PATTERNS };
