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
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Feature 075 / D-87 — the resolved request channel's id, passed in by the
   * route. It used to be the channel *code*, looked back up here with a raw
   * `select id from sales_channels`: a re-resolution of a channel the resolver
   * middleware had already resolved (feature 053, FR-011), across a boundary
   * no import specifier named.
   */
  async resolve(salesChannelId: string): Promise<SpeculationRulesConfig> {
    const resolved = await this.settingsService.getMany(
      [ENABLED_CODE, EAGERNESS_CODE],
      salesChannelId,
    );
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
}
