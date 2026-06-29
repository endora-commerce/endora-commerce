import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import { z } from 'zod';
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

const DEFAULT_PATTERNS: Record<InvoiceKind, string> = {
  invoice: 'FV {seq}/{YYYY}',
  proforma: 'PRO {seq}/{YYYY}',
  correction: 'KOR {seq}/{YYYY}',
};

/**
 * Render an invoice-number pattern. Supported tokens:
 *   {seq}      — sequence number
 *   {seq:N}    — zero-padded to width N
 *   {YYYY}     — 4-digit year
 *   {YY}       — 2-digit year
 *   {MM}       — 2-digit month
 * Everything else is literal (so prefix/suffix are just literal text).
 */
export function formatInvoiceNumber(
  pattern: string,
  ctx: { seq: number; date: Date },
): string {
  const year = ctx.date.getFullYear();
  const month = ctx.date.getMonth() + 1;
  return pattern.replace(/\{(seq(?::(\d+))?|YYYY|YY|MM)\}/g, (_m, token: string, pad?: string) => {
    if (token === 'YYYY') return String(year);
    if (token === 'YY') return String(year % 100).padStart(2, '0');
    if (token === 'MM') return String(month).padStart(2, '0');
    // seq or seq:N
    if (pad) return String(ctx.seq).padStart(Number(pad), '0');
    return String(ctx.seq);
  });
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
    return formatInvoiceNumber(pattern, { seq: counter.currentValue, date: issuedAt });
  }

  private async resolvePattern(kind: InvoiceKind, salesChannelId: string): Promise<string> {
    if (!this.patterns) return DEFAULT_PATTERNS[kind];
    try {
      const p = await this.patterns.resolvePattern(kind, salesChannelId);
      return p && p.trim() ? p : DEFAULT_PATTERNS[kind];
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
