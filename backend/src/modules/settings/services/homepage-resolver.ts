import type { EntityManager } from '@mikro-orm/postgresql';
import type { HomepageConfig } from '@b2b/contracts';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';

const HOMEPAGE_SETTING_CODE = 'homepage_cms_page_slug';

/**
 * Resolves the storefront home-page configuration for a sales channel from the
 * `homepage_cms_page_slug` setting. An unset / not-registered / out-of-scope
 * setting (or a missing channel) resolves to `{ cmsPageSlug: null }` so the
 * storefront falls back to its built-in landing page and a missing setting
 * never 500s a public page.
 */
export class HomepageResolver {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly settingsService: SettingsService,
  ) {}

  async resolve(salesChannelCode: string | undefined): Promise<HomepageConfig> {
    const channelId = await this.resolveChannelId(salesChannelCode);
    if (!channelId) return { cmsPageSlug: null };

    const resolved = await this.settingsService.getMany([HOMEPAGE_SETTING_CODE], channelId);
    const r = resolved.get(HOMEPAGE_SETTING_CODE);
    const slug = r && r.ok && typeof r.value === 'string' ? r.value.trim() : '';
    return { cmsPageSlug: slug === '' ? null : slug };
  }

  private async resolveChannelId(code: string | undefined): Promise<string | null> {
    const conn = this.emFactory().getConnection();
    if (code) {
      const rows = (await conn.execute(
        `select id::text as id from sales_channels where code = ? limit 1`,
        [code],
      )) as Array<{ id: string }>;
      return rows[0]?.id ?? null;
    }
    const rows = (await conn.execute(
      `select id::text as id from sales_channels where system_default = true limit 1`,
    )) as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  }
}
