/**
 * Explicit owners for the tables no entity claims.
 *
 * Rule 2 of
 * specs/065-manifest-aware-migrations/contracts/fk-dependency-check.md §2.1:
 * ownership resolves by entity `tableName` first, then by this map, then it
 * fails. There is deliberately **no** "whichever migration created it" fallback
 * — that produced provably wrong owners (`sales_channel_products` → `core`).
 *
 * Every key is asserted to be a really-created table that no entity claims, so
 * a stale entry fails the build (fk-dependency-drift.test.ts, case V2).
 */
export const TABLE_OWNER_OVERRIDES: Readonly<Record<string, string>> = {
  // Attribute options were split out of a JSONB column; the catalog entity
  // reaches them through ProductAttribute, so no entity declares the table.
  attribute_options: 'catalog',

  // CMS scoping bridges — owned by the module whose content they scope.
  cms_block_sales_channels: 'cms',
  cms_hook_sales_channels: 'cms',
  cms_page_sales_channels: 'cms',
  cms_template_sales_channels: 'cms',

  // Legacy outbound-integration table, read through the webhooks module.
  external_integrations: 'webhooks',

  // Price-list child tables, reached through PriceList.
  price_list_assignments: 'price_lists',
  price_list_items: 'price_lists',

  // Catalog junction tables.
  product_assets: 'catalog',
  product_categories: 'catalog',

  // `pim_pimcore`'s first-migration tables. The module's init migration creates
  // them and its **own** second migration takes them away — five dropped, and
  // `pimcore_inbound_events` renamed to `pimcore_delivered_records`, which an
  // entity does claim. So no entity claims these six and none ever will: the
  // connector's design moved from mapping-and-pull to complete-record delivery
  // between the two migrations, and both landed in the same merge request.
  //
  // They are still this module's tables for the window in which they exist, and
  // that window is what the ownership map is for: the FK edges declared inside
  // them (into `custom_field_definitions`, `categories`, `price_lists`) have to
  // resolve to an owner for the migration order to be computable. The graph
  // reads `create table` and models no `drop`, which is why these six need an
  // answer at all — see fk-graph.ts's `createdTables`.
  pimcore_attribute_mappings: 'pim_pimcore',
  pimcore_attribute_set_mappings: 'pim_pimcore',
  pimcore_category_mappings: 'pim_pimcore',
  pimcore_inbound_events: 'pim_pimcore',
  pimcore_price_bindings: 'pim_pimcore',
  pimcore_product_links: 'pim_pimcore',

  // Sales-channel membership bridges (Principle XII — read only through
  // SalesChannelMembershipService).
  sales_channel_categories: 'sales_channels',
  sales_channel_cms_pages: 'sales_channels',
  sales_channel_customer_accounts: 'sales_channels',
  sales_channel_delivery_methods: 'sales_channels',
  sales_channel_organizations: 'sales_channels',
  sales_channel_payment_methods: 'sales_channels',
  sales_channel_products: 'sales_channels',
  sales_channel_promotions: 'sales_channels',
  sales_channel_taxes: 'sales_channels',

  // Settings scoping bridges. Kernel-owned since feature 072 T018: they are the
  // pivot tables of `Setting.salesChannels` / `SettingGroup.salesChannels`, and
  // both of those entities live in the kernel now.
  setting_group_sales_channels: 'kernel',
  setting_sales_channels: 'kernel',
};
