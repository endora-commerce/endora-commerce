import type { HomepageConfig } from '@b2b/contracts';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';

const HOMEPAGE_SETTING_CODE = 'homepage_cms_page_slug';

/**
 * Resolves the storefront home-page configuration for a sales channel from the
 * `homepage_cms_page_slug` setting. An unset / not-registered / out-of-scope
 * setting resolves to `{ cmsPageSlug: null }` so the storefront falls back to
 * its built-in landing page and a missing setting never 500s a public page.
 *
 * There is no "missing channel" arm any more (feature 075 / D-87): the channel
 * arrives resolved, and the resolver middleware has already refused an unknown
 * or inactive one before a handler runs.
 */
export class HomepageResolver {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Feature 075 / D-87 — the resolved request channel's id, passed in by the
   * route. It used to be the channel *code*, looked back up here with a raw
   * `select id from sales_channels`: a re-resolution of a channel the resolver
   * middleware had already resolved (feature 053, FR-011), across a boundary
   * no import specifier named.
   */
  async resolve(salesChannelId: string): Promise<HomepageConfig> {
    const resolved = await this.settingsService.getMany([HOMEPAGE_SETTING_CODE], salesChannelId);
    const r = resolved.get(HOMEPAGE_SETTING_CODE);
    const slug = r && r.ok && typeof r.value === 'string' ? r.value.trim() : '';
    return { cmsPageSlug: slug === '' ? null : slug };
  }
}
