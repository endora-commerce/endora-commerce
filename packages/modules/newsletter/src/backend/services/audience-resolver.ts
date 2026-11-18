import type { EntityManager } from '@mikro-orm/postgresql';

export interface AudienceTarget {
  type: 'all' | 'group' | 'tag' | 'tag_list';
  tagIds?: string[];
  /** Campaign id, required for `group` targeting. */
  campaignId?: string;
}

/**
 * Resolves a campaign/automation target to the set of eligible subscriber ids
 * (feature 048, US2). Eligibility = `status = 'active'` AND not present in
 * `newsletter_suppressions` (the suppression list overrides all targeting —
 * FR-015/035). Pending/unsubscribed/deactivated subscribers are excluded by the
 * status filter.
 */
export class NewsletterAudienceResolver {
  constructor(private readonly emFactory: () => EntityManager) {}

  async resolve(target: AudienceTarget): Promise<string[]> {
    const where = this.#where(target);
    if (!where) return [];
    const rows = (await this.#execute(`select s.id from newsletter_subscribers s where ${where.sql}`, where.params)) as Array<{
      id: string;
    }>;
    return rows.map((r) => r.id);
  }

  /**
   * How many subscribers {@link resolve} would return for `target` right now —
   * the figure the admin's send confirmation names (issue #1462). One `count`
   * over the same eligibility predicate, so the estimate and the dispatch
   * cannot disagree about who is reachable.
   */
  async count(target: AudienceTarget): Promise<number> {
    const where = this.#where(target);
    if (!where) return 0;
    const rows = (await this.#execute(
      `select count(*)::int as n from newsletter_subscribers s where ${where.sql}`,
      where.params,
    )) as Array<{ n: number | string }>;
    return Number(rows[0]?.n ?? 0);
  }

  /** The eligibility predicate, or `null` when the target can match nobody. */
  #where(target: AudienceTarget): { sql: string; params: unknown[] } | null {
    const conditions: string[] = [
      `s.status = 'active'`,
      `not exists (select 1 from newsletter_suppressions sup where sup.email = s.email)`,
    ];
    const params: unknown[] = [];

    if (target.type === 'tag' || target.type === 'tag_list') {
      const tagIds = target.tagIds ?? [];
      if (tagIds.length === 0) return null;
      const placeholders = tagIds.map(() => '?').join(', ');
      params.push(...tagIds);
      conditions.push(
        `exists (select 1 from newsletter_subscriber_tags st where st.subscriber_id = s.id and st.tag_id in (${placeholders}))`,
      );
    } else if (target.type === 'group') {
      if (!target.campaignId) return null;
      params.push(target.campaignId);
      conditions.push(
        `exists (select 1 from newsletter_campaign_subscribers cs where cs.subscriber_id = s.id and cs.campaign_id = ?)`,
      );
    }
    return { sql: conditions.join(' and '), params };
  }

  async #execute(sql: string, params: unknown[]): Promise<unknown[]> {
    const em = this.emFactory();
    return (await em.getConnection().execute(sql, params, 'all', em.getTransactionContext())) as unknown[];
  }
}
