import type { EntityManager } from '@mikro-orm/postgresql';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';

const ADD_TO_CART_CODE = 'storefront.product_card.show_add_to_cart';
const ADD_TO_SHOPPING_LIST_CODE = 'storefront.product_card.show_add_to_shopping_list';
// Owned by the quote_requests module's manifest; read here by code so the
// three product-card button toggles resolve through one endpoint.
const ADD_TO_QUOTE_CODE = 'quote_requests.show_add_to_quote_on_card';

export interface ProductCardButtonsConfig {
  showAddToCart: boolean;
  showAddToShoppingList: boolean;
  showAddToQuote: boolean;
}

/**
 * Resolves the storefront product-card button visibility toggles for a sales
 * channel. Each flag defaults to `true` (button shown) when its setting is
 * unset / not-registered / out-of-scope, so a settings hiccup never hides a
 * storefront affordance and never 500s a public page.
 */
export class ProductCardButtonsResolver {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly settingsService: SettingsService,
  ) {}

  async resolve(salesChannelCode: string | undefined): Promise<ProductCardButtonsConfig> {
    const fallback: ProductCardButtonsConfig = {
      showAddToCart: true,
      showAddToShoppingList: true,
      showAddToQuote: true,
    };
    const channelId = await this.resolveChannelId(salesChannelCode);
    if (!channelId) return fallback;

    const resolved = await this.settingsService.getMany(
      [ADD_TO_CART_CODE, ADD_TO_SHOPPING_LIST_CODE, ADD_TO_QUOTE_CODE],
      channelId,
    );
    const flag = (code: string): boolean => {
      const r = resolved.get(code);
      return r && r.ok && typeof r.value === 'boolean' ? r.value : true;
    };
    return {
      showAddToCart: flag(ADD_TO_CART_CODE),
      showAddToShoppingList: flag(ADD_TO_SHOPPING_LIST_CODE),
      showAddToQuote: flag(ADD_TO_QUOTE_CODE),
    };
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
