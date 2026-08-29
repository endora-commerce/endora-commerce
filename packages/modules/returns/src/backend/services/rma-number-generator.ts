import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Resolves the admin-configurable RMA-number prefix/suffix for a Sales Channel.
 * In production these wrap `SettingsService.get('returns.rma_number_*')` (wired
 * in composition); the generator treats any resolver failure as an empty string
 * so authorization never fails because a setting is missing or out of scope.
 */
export interface RmaNumberSettingsResolver {
  resolvePrefix(salesChannelId: string): Promise<string>;
  resolveSuffix(salesChannelId: string): Promise<string>;
}

/** Draws the next value from the monotonic RMA sequence. */
export type DrawRmaSequence = (tx: EntityManager) => Promise<string>;

/**
 * Feature 046 — generates the RMA number `${prefix}${sequence}${suffix}`. The
 * numeric core comes from the `return_cases_rma_seq` Postgres sequence
 * (monotonic, never resets), so the number is unique regardless of later
 * prefix/suffix changes. The sequence draw is injected so the generator is
 * unit-testable without a database (mirrors `BusinessIdGenerator`).
 */
export class RmaNumberGenerator {
  constructor(
    private readonly drawSequence: DrawRmaSequence,
    private readonly settings?: RmaNumberSettingsResolver,
  ) {}

  async generate(tx: EntityManager, salesChannelId: string): Promise<string> {
    const sequence = await this.drawSequence(tx);
    const prefix = await this.resolve((s) => s.resolvePrefix(salesChannelId));
    const suffix = await this.resolve((s) => s.resolveSuffix(salesChannelId));
    return `${prefix}${sequence}${suffix}`;
  }

  /** Resolve a prefix/suffix, swallowing missing/out-of-scope settings as ''. */
  private async resolve(
    pick: (s: RmaNumberSettingsResolver) => Promise<string>,
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
 * Production factory: draws `nextval('return_cases_rma_seq')` on the
 * transaction's connection so the value is allocated inside the authorize
 * transaction without row locking.
 */
export function createRmaNumberGenerator(
  settings?: RmaNumberSettingsResolver,
): RmaNumberGenerator {
  const draw: DrawRmaSequence = async (tx) => {
    const rows = (await tx.execute(
      `select nextval('return_cases_rma_seq') as n`,
    )) as Array<{ n: string | number }>;
    return String(rows[0]?.n ?? '');
  };
  return new RmaNumberGenerator(draw, settings);
}
