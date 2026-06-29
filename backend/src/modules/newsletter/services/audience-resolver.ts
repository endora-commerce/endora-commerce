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
    const em = this.emFactory();
    const conditions: string[] = [
      `s.status = 'active'`,
      `not exists (select 1 from newsletter_suppressions sup where sup.email = s.email)`,
    ];
    const params: unknown[] = [];

    if (target.type === 'tag' || target.type === 'tag_list') {
      const tagIds = target.tagIds ?? [];
      if (tagIds.length === 0) return [];
      const placeholders = tagIds.map(() => '?').join(', ');
      params.push(...tagIds);
      conditions.push(
        `exists (select 1 from newsletter_subscriber_tags st where st.subscriber_id = s.id and st.tag_id in (${placeholders}))`,
      );
    } else if (target.type === 'group') {
      if (!target.campaignId) return [];
      params.push(target.campaignId);
      conditions.push(
        `exists (select 1 from newsletter_campaign_subscribers cs where cs.subscriber_id = s.id and cs.campaign_id = ?)`,
      );
    }

    const sql = `select s.id from newsletter_subscribers s where ${conditions.join(' and ')}`;
    const rows = (await em
      .getConnection()
      .execute(sql, params, 'all', em.getTransactionContext())) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
}
