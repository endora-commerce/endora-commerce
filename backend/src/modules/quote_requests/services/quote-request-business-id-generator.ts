import type { EntityManager } from '@mikro-orm/postgresql';
import { ModuleDisabledError } from '../../../kernel/lifecycle/plugin-helpers.js';

/**
 * Conditions already reported. Per process and never reset, so a settings
 * outage costs one line rather than one per quote request.
 */
const warnedConditions = new Set<string>();

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

  /**
   * Resolve a prefix/suffix, swallowing any resolver failure as `''`.
   *
   * The catch-all is deliberate and stays (feature 072, D-43): `drawSequence`
   * runs before it, so a throw rolls the transaction back after `nextval` has
   * been consumed — the sequence gaps and the RFQ is refused over a cosmetic
   * prefix. What changes is that it is observable, and that a disabled module
   * still refuses rather than being turned into a missing affix.
   */
  private async resolve(
    pick: (s: QuoteRequestBusinessIdSettingsResolver) => Promise<string>,
  ): Promise<string> {
    if (!this.settings) return '';
    try {
      return (await pick(this.settings)) ?? '';
    } catch (error) {
      if (error instanceof ModuleDisabledError) throw error;
      const name = (error as { name?: string }).name ?? 'Error';
      const condition = `rfq-business-id:${name}`;
      if (!warnedConditions.has(condition)) {
        warnedConditions.add(condition);
        console.warn(
          `[quote_requests] business-ID affix settings unreadable (${name}) — quote ` +
            `requests are numbered without the configured prefix/suffix ` +
            `(logged once per process).`,
        );
      }
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
