import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Resolves the admin-configurable business-ID prefix/suffix for Quote
 * Requests. In production these wrap
 * `SettingsService.get('quote_requests.business_id.*')` (wired in
 * composition); the generator treats any resolver failure as an empty string
 * so RFQ creation never fails because a setting is missing. Unlike Orders,
 * Quote Requests are not Sales-Channel scoped, so the resolver takes no
 * arguments.
 */
export interface QuoteRequestBusinessIdSettingsResolver {
  resolvePrefix(): Promise<string>;
  resolveSuffix(): Promise<string>;
}

/** Draws the next value from the monotonic business-ID sequence. */
export type DrawSequence = (em: EntityManager) => Promise<string>;

/**
 * Generates the customer-facing business Quote Request ID:
 * `${prefix}${sequence}${suffix}`. The numeric core comes from the
 * `quote_requests_business_id_seq` Postgres sequence (monotonic, never
 * resets), so the ID is unique regardless of later prefix/suffix changes. The
 * sequence draw is injected so the generator is unit-testable without a
 * database. Mirrors `orders/services/business-id-generator.ts`.
 */
export class QuoteRequestBusinessIdGenerator {
  constructor(
    private readonly drawSequence: DrawSequence,
    private readonly settings?: QuoteRequestBusinessIdSettingsResolver,
  ) {}

  async generate(em: EntityManager): Promise<string> {
    const sequence = await this.drawSequence(em);
    const prefix = await this.resolve((s) => s.resolvePrefix());
    const suffix = await this.resolve((s) => s.resolveSuffix());
    return `${prefix}${sequence}${suffix}`;
  }

  /** Resolve a prefix/suffix, swallowing missing/out-of-scope settings as ''. */
  private async resolve(
    pick: (s: QuoteRequestBusinessIdSettingsResolver) => Promise<string>,
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
 * Production factory: draws `nextval('quote_requests_business_id_seq')` on the
 * EntityManager's connection.
 */
export function createQuoteRequestBusinessIdGenerator(
  settings?: QuoteRequestBusinessIdSettingsResolver,
): QuoteRequestBusinessIdGenerator {
  const draw: DrawSequence = async (em) => {
    const rows = (await em.execute(
      `select nextval('quote_requests_business_id_seq') as n`,
    )) as Array<{ n: string | number }>;
    return String(rows[0]?.n ?? '');
  };
  return new QuoteRequestBusinessIdGenerator(draw, settings);
}
