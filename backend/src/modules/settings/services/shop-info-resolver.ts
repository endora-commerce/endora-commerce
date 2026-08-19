import type { ShopInfo } from '@b2b/contracts';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';

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
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Feature 075 / D-87 — the resolved request channel's id, passed in by the
   * route. It used to be the channel *code*, looked back up here with a raw
   * `select id from sales_channels`: a re-resolution of a channel the resolver
   * middleware had already resolved (feature 053, FR-011), across a boundary
   * no import specifier named.
   */
  async resolve(salesChannelId: string): Promise<ShopInfo> {
    const empty: ShopInfo = {
      name: '',
      address: '',
      contactEmail: '',
      supportEmail: '',
      phone: '',
    };
    const codes = Object.values(FIELD_TO_CODE);
    const resolved = await this.settingsService.getMany(codes, salesChannelId);

    const out = { ...empty };
    for (const [field, code] of Object.entries(FIELD_TO_CODE) as Array<
      [keyof ShopInfo, string]
    >) {
      const r = resolved.get(code);
      out[field] = r && r.ok && typeof r.value === 'string' ? r.value : '';
    }
    return out;
  }
}
