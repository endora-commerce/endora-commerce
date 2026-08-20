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
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Feature 075 / D-87 — the resolved request channel's id, passed in by the
   * route. It used to be the channel *code*, looked back up here with a raw
   * `select id from sales_channels`: a re-resolution of a channel the resolver
   * middleware had already resolved (feature 053, FR-011), across a boundary
   * no import specifier named.
   */
  async resolve(salesChannelId: string): Promise<ProductCardButtonsConfig> {
    const resolved = await this.settingsService.getMany(
      [ADD_TO_CART_CODE, ADD_TO_SHOPPING_LIST_CODE, ADD_TO_QUOTE_CODE],
      salesChannelId,
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
}
