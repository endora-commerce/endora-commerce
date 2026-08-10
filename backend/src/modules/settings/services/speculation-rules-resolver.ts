import type { EntityManager } from '@mikro-orm/postgresql';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';

const ENABLED_CODE = 'storefront.speculation_rules.enabled';
const EAGERNESS_CODE = 'storefront.speculation_rules.eagerness';

const VALID_EAGERNESS = new Set(['conservative', 'moderate', 'eager']);

export interface SpeculationRulesConfig {
  enabled: boolean;
  /** One of conservative | moderate | eager; defaults to 'moderate'. */
  eagerness: string;
}

/**
 * Resolves the storefront Speculation Rules configuration
 * (`storefront.speculation_rules.*`) for a sales channel. A missing /
 * not-registered / out-of-scope setting falls back to enabled + 'moderate' so
 * the hint is on by default and a settings hiccup never 500s a public page.
 *
 * The toggle is a hint for the storefront template only — whether it has any
 * effect depends on the active Storefront UI theme implementing the mechanism.
 */
export class SpeculationRulesResolver {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly settingsService: SettingsService,
  ) {}

  async resolve(salesChannelCode: string | undefined): Promise<SpeculationRulesConfig> {
    const channelId = await this.resolveChannelId(salesChannelCode);
    if (!channelId) return { enabled: true, eagerness: 'moderate' };

    const resolved = await this.settingsService.getMany([ENABLED_CODE, EAGERNESS_CODE], channelId);
    const enabledRow = resolved.get(ENABLED_CODE);
    const eagernessRow = resolved.get(EAGERNESS_CODE);

    const enabled =
      enabledRow && enabledRow.ok && typeof enabledRow.value === 'boolean'
        ? enabledRow.value
        : true;
    const rawEagerness =
      eagernessRow && eagernessRow.ok && typeof eagernessRow.value === 'string'
        ? eagernessRow.value.trim()
        : '';
    const eagerness = VALID_EAGERNESS.has(rawEagerness) ? rawEagerness : 'moderate';
    return { enabled, eagerness };
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
