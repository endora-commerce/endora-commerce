import type { EntityManager } from '@mikro-orm/postgresql';
import type { ShopInfo } from '@b2b/contracts';
import type { SettingsService } from './settings.service.js';

/**
 * Maps the `shop.*` settings to the public {@link ShopInfo} surface consumed
 * by the storefront. Every field degrades to an empty string when the setting
 * is unset, out of scope, or not registered — the storefront decides what to
 * render, and a missing setting must never 500 a public page.
 */
const FIELD_TO_CODE: Record<keyof ShopInfo, string> = {
  name: 'shop.name',
  address: 'shop.address',
  contactEmail: 'shop.contact_email',
  supportEmail: 'shop.support_email',
  phone: 'shop.phone',
};

export class ShopInfoResolver {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly settingsService: SettingsService,
  ) {}

  async resolve(salesChannelCode: string | undefined): Promise<ShopInfo> {
    const channelId = await this.resolveChannelId(salesChannelCode);
    const empty: ShopInfo = {
      name: '',
      address: '',
      contactEmail: '',
      supportEmail: '',
      phone: '',
    };
    if (!channelId) return empty;

    const codes = Object.values(FIELD_TO_CODE);
    const resolved = await this.settingsService.getMany(codes, channelId);

    const out = { ...empty };
    for (const [field, code] of Object.entries(FIELD_TO_CODE) as Array<
      [keyof ShopInfo, string]
    >) {
      const r = resolved.get(code);
      out[field] = r && r.ok && typeof r.value === 'string' ? r.value : '';
    }
    return out;
  }

  private async resolveChannelId(
    code: string | undefined,
  ): Promise<string | null> {
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
