import type { EntityManager } from '@mikro-orm/postgresql';
import { ModuleDisabledError } from '../../_lifecycle/plugin-helpers.js';

/**
 * Resolves the admin-configurable business-ID prefix/suffix for a Sales
 * Channel. In production these wrap `SettingsService.get('orders.business_id.*')`
 * (wired in composition); the generator treats any resolver failure as an
 * empty string so order placement never fails because a setting is missing or
 * out of channel scope.
 *
 * `null` = the order was placed with no sales channel, so the affix is read
 * platform-wide (feature 072, D-41). It used to be the literal `'default'`, a
 * channel **code** against a `uuid` column, which the catch below then read as
 * "no prefix configured".
 */
export interface BusinessIdSettingsResolver {
  resolvePrefix(salesChannelId: string | null): Promise<string>;
  resolveSuffix(salesChannelId: string | null): Promise<string>;
}

/**
 * Conditions already reported. Per process and never reset, so a settings
 * outage costs one line rather than one per order.
 */
const warnedConditions = new Set<string>();

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

  async generate(tx: EntityManager, salesChannelId: string | null): Promise<string> {
    const sequence = await this.drawSequence(tx);
    const prefix = await this.resolve((s) => s.resolvePrefix(salesChannelId));
    const suffix = await this.resolve((s) => s.resolveSuffix(salesChannelId));
    return `${prefix}${sequence}${suffix}`;
  }

  /**
   * Resolve a prefix/suffix, swallowing any resolver failure as `''`.
   *
   * The catch-all is deliberate and stays (feature 072, D-43), and the sequence
   * draw is why: `drawSequence` runs *before* this, so a throw rolls the
   * transaction back after `nextval` has been consumed — the sequence gaps and
   * the order is refused over a cosmetic prefix. What changes is that it is no
   * longer silent, and that a disabled module still refuses: converting
   * fail-closed into fail-open is what a bare `catch` around a port call does.
   */
  private async resolve(
    pick: (s: BusinessIdSettingsResolver) => Promise<string>,
  ): Promise<string> {
    if (!this.settings) return '';
    try {
      return (await pick(this.settings)) ?? '';
    } catch (error) {
      if (error instanceof ModuleDisabledError) throw error;
      const name = (error as { name?: string }).name ?? 'Error';
      const condition = `orders-business-id:${name}`;
      if (!warnedConditions.has(condition)) {
        warnedConditions.add(condition);
        console.warn(
          `[orders] business-ID affix settings unreadable (${name}) — orders are ` +
            `numbered without the configured prefix/suffix (logged once per process).`,
        );
      }
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
