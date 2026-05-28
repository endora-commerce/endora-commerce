import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Resolves the admin-configurable business-ID prefix/suffix for a Sales
 * Channel. In production these wrap `SettingsService.get('orders.business_id.*')`
 * (wired in composition); the generator treats any resolver failure as an
 * empty string so order placement never fails because a setting is missing or
 * out of channel scope.
 */
export interface BusinessIdSettingsResolver {
  resolvePrefix(salesChannelId: string): Promise<string>;
  resolveSuffix(salesChannelId: string): Promise<string>;
}

/** Draws the next value from the monotonic business-ID sequence. */
export type DrawSequence = (tx: EntityManager) => Promise<string>;

/**
 * Feature 036 — generates the customer-facing business Order ID:
 * `${prefix}${sequence}${suffix}`. The numeric core comes from the
 * `orders_business_id_seq` Postgres sequence (monotonic, never resets), so the
 * ID is unique regardless of later prefix/suffix changes. The sequence draw is
 * injected so the generator is unit-testable without a database.
 */
export class BusinessIdGenerator {
  constructor(
    private readonly drawSequence: DrawSequence,
    private readonly settings?: BusinessIdSettingsResolver,
  ) {}

  async generate(tx: EntityManager, salesChannelId: string): Promise<string> {
    const sequence = await this.drawSequence(tx);
    const prefix = await this.resolve((s) => s.resolvePrefix(salesChannelId));
    const suffix = await this.resolve((s) => s.resolveSuffix(salesChannelId));
    return `${prefix}${sequence}${suffix}`;
  }

  /** Resolve a prefix/suffix, swallowing missing/out-of-scope settings as ''. */
  private async resolve(
    pick: (s: BusinessIdSettingsResolver) => Promise<string>,
  ): Promise<string> {
    if (!this.settings) return '';
    try {
      return (await pick(this.settings)) ?? '';
    } catch {
      return '';
    }
  }
}

/**
 * Production factory: draws `nextval('orders_business_id_seq')` on the
 * transaction's connection so the value is allocated inside the place-order
 * transaction without row locking.
 */
export function createBusinessIdGenerator(
  settings?: BusinessIdSettingsResolver,
): BusinessIdGenerator {
  const draw: DrawSequence = async (tx) => {
    const rows = (await tx.execute(
      `select nextval('orders_business_id_seq') as n`,
    )) as Array<{ n: string | number }>;
    return String(rows[0]?.n ?? '');
  };
  return new BusinessIdGenerator(draw, settings);
}
