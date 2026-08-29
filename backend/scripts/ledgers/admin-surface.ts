/**
 * Reaches into admin platform surface `@endora-commerce/admin-kit` does not
 * publish (feature 091, Phase 1b; `contracts/admin-kit-surface.md` R15).
 *
 * Two-way: an unledgered reach fails, and so does an entry describing a reach
 * this run no longer sees — including a **symbol** an entry names and the walk
 * does not, because the verdict is per symbol and an entry that only counted
 * them could not be checked against the barrel it disagrees with.
 *
 * R15 said this ledger opens **empty**. It does not, and the correction is
 * recorded in the contract: Phase 1b publishes 1690 of the 1782 measured host
 * reaches, and the 92 that remain fall into exactly two groups, each with a
 * retiring condition that is somebody's next merge request rather than a
 * sentence of intent.
 *
 * ## Group A — the six pickers (19 sites)
 *
 * `organization-picker`, `sales-channel-picker`, `asset-picker` and
 * `cms-picker` each fetch from **another module's** API client, so publishing
 * them would make the kit depend on module code and break R6 (*"the kit holds
 * no module knowledge"*). They are FR-007's own worked example — a picker over
 * another module's data is that module's contribution, not the platform's — so
 * the answer is a design one and not a `git mv`. **Retires with Phase 2**, when
 * a module package can ship an `./admin` layer and contribute the picker to a
 * zone.
 *
 * ## Group B — the admin's session and module-presence state (73 sites)
 *
 * `lib/auth`, `lib/module-presence`, `lib/surface-visibility` and
 * `lib/use-page-size-preference`, plus the two tab components that read
 * presence. These are not blocked by a design question; they are blocked by a
 * **measurement**. 23 of the admin's test files mock them at the module path
 * (`vi.mock('@/lib/auth', …)`), deliberately — `TaxesPage.permission-gating.test.tsx`
 * says so in its own comment: *"the mocks stop at `useAuth` and
 * `useModulePresence` deliberately, so the real `useSurfaceVisibility` is the
 * thing under test rather than a stub of it."* `vi.mock` keys on a module id,
 * so moving `surface-visibility` into the package alongside `auth` puts that
 * seam **inside** the package, where the test's mock cannot reach it: measured,
 * 104 tests across 23 files, every one of them a permission gate.
 *
 * **Retires when those tests drive the real providers instead of replacing the
 * modules** — which is its own merge request, is a better test either way, and
 * is not something to do inside a change whose subject is a file move.
 *
 * Nothing here is an exception to a rule. Every entry is a reach that should
 * one day be a bare specifier into a published subpath, and both groups have a
 * named event that removes them.
 */

export interface UnpublishedAdminReach {
  /** The symbols the reach names. Named, not counted — the verdict is per symbol. */
  readonly symbols: readonly string[];
  /** Why this reach stands, and what removes it. */
  readonly reason: string;
}

const PICKERS =
  'A picker over another module’s data: the component fetches from that module’s own API ' +
  'client, so publishing it would put module knowledge in the kit (R6). It is FR-007’s ' +
  'worked example — retires when Phase 2 lets the owning module contribute it to a zone.';

const SESSION =
  'The admin application’s session/presence state. 23 admin test files mock it at this ' +
  'module path on purpose, and `vi.mock` keys on a module id, so moving it into the package ' +
  'takes the seam out of their reach — 104 tests, measured. Retires when those tests drive ' +
  'the real providers instead of replacing the modules.';

export const UNPUBLISHED_ADMIN_REACHES: Readonly<Record<string, UnpublishedAdminReach>> = {
  'admin/src/modules/api_keys/ApiKeysPage.tsx::admin/src/components/organization-picker/index.ts': { symbols: ['OrganizationPicker'], reason: PICKERS },
  'admin/src/modules/api_keys/ApiKeysPage.tsx::admin/src/components/sales-channel-picker/SalesChannelPicker.tsx': { symbols: ['SalesChannelPicker'], reason: PICKERS },
  'admin/src/modules/blog/pages/BlogCategoryEditor.tsx::admin/src/components/asset-picker/AssetFieldPicker.tsx': { symbols: ['AssetFieldPicker'], reason: PICKERS },
  'admin/src/modules/catalog/ProductsList.tsx::admin/src/lib/use-page-size-preference.ts': { symbols: ['usePageSizePreference'], reason: SESSION },
  'admin/src/modules/comparisons/pages/ComparisonsListPage.tsx::admin/src/components/sales-channel-picker/SalesChannelPicker.tsx': { symbols: ['SalesChannelPicker'], reason: PICKERS },
  'admin/src/modules/credit_limits/CreditLimitsPage.tsx::admin/src/components/organization-picker/OrganizationPicker.tsx': { symbols: ['OrganizationPicker'], reason: PICKERS },
  'admin/src/modules/customer_accounts/CustomerGroupsPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/customers/CustomersList.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/customers/panels/ManagementPanels.tsx::admin/src/components/organization-picker/OrganizationPicker.tsx': { symbols: ['OrganizationPicker'], reason: PICKERS },
  'admin/src/modules/delivery_methods/DeliveryMethodsPage.tsx::admin/src/lib/surface-visibility.ts': { symbols: ['useSurfaceVisibility'], reason: SESSION },
  'admin/src/modules/inventory/AvailabilityNotificationsPage.tsx::admin/src/lib/surface-visibility.ts': { symbols: ['useSurfaceVisibility'], reason: SESSION },
  'admin/src/modules/inventory/InventoryPage.tsx::admin/src/lib/surface-visibility.ts': { symbols: ['useSurfaceVisibility'], reason: SESSION },
  'admin/src/modules/inventory/InventoryPage.tsx::admin/src/lib/use-page-size-preference.ts': { symbols: ['usePageSizePreference'], reason: SESSION },
  'admin/src/modules/inventory/LowStockPage.tsx::admin/src/lib/surface-visibility.ts': { symbols: ['useSurfaceVisibility'], reason: SESSION },
  'admin/src/modules/inventory/StockImportWizard.tsx::admin/src/lib/surface-visibility.ts': { symbols: ['useSurfaceVisibility'], reason: SESSION },
  'admin/src/modules/invoices/InvoiceDetail.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/invoices/InvoicesList.tsx::admin/src/components/InvoiceSectionTabs.tsx': { symbols: ['InvoiceSectionTabs'], reason: SESSION },
  'admin/src/modules/invoices/templates/InvoiceTemplatesPage.tsx::admin/src/components/InvoiceSectionTabs.tsx': { symbols: ['InvoiceSectionTabs'], reason: SESSION },
  'admin/src/modules/invoices/templates/InvoiceTemplatesPage.tsx::admin/src/components/sales-channel-picker/SalesChannelPicker.tsx': { symbols: ['SalesChannelPicker'], reason: PICKERS },
  'admin/src/modules/ksef/components/InvoiceKsefPanel.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/ksef/components/SubmissionsTable.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/ksef/components/SubmissionsTable.tsx::admin/src/lib/use-page-size-preference.ts': { symbols: ['usePageSizePreference'], reason: SESSION },
  'admin/src/modules/ksef/pages/KsefPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/megamenu/components/MenuItemConfigPanel.tsx::admin/src/components/asset-picker/AssetFieldPicker.tsx': { symbols: ['AssetFieldPicker'], reason: PICKERS },
  'admin/src/modules/megamenu/components/MenuItemConfigPanel.tsx::admin/src/components/cms-picker/CmsBlockPicker.tsx': { symbols: ['CmsBlockPicker'], reason: PICKERS },
  'admin/src/modules/megamenu/components/MenuItemConfigPanel.tsx::admin/src/components/cms-picker/CmsPagePicker.tsx': { symbols: ['CmsPagePicker'], reason: PICKERS },
  'admin/src/modules/newsletter/pages/AutomationBuilder.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/newsletter/pages/AutomationsPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/newsletter/pages/BlocksPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/newsletter/pages/CampaignEditor.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/newsletter/pages/CampaignStats.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/newsletter/pages/CampaignsPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/newsletter/pages/ProviderSettingsPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/newsletter/pages/SubscribersPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/newsletter/pages/TagsPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/orders/OrderCreatePage.tsx::admin/src/components/OrderEntryTabs.tsx': { symbols: ['OrderEntryTabs'], reason: SESSION },
  'admin/src/modules/orders/OrderDetail.tsx::admin/src/lib/surface-visibility.ts': { symbols: ['useSurfaceVisibility'], reason: SESSION },
  'admin/src/modules/orders/OrderShipmentsTab.tsx::admin/src/lib/surface-visibility.ts': { symbols: ['useSurfaceVisibility'], reason: SESSION },
  'admin/src/modules/orders/OrdersList.tsx::admin/src/lib/use-page-size-preference.ts': { symbols: ['usePageSizePreference'], reason: SESSION },
  'admin/src/modules/organizations/OrganizationSalesRepsTab.tsx::admin/src/lib/surface-visibility.ts': { symbols: ['useSurfaceVisibility'], reason: SESSION },
  'admin/src/modules/organizations/OrganizationsList.tsx::admin/src/components/organization-picker/index.ts': { symbols: ['OrganizationStatusBadge'], reason: PICKERS },
  'admin/src/modules/organizations/panels/HierarchyPanel.tsx::admin/src/components/organization-picker/OrganizationPicker.tsx': { symbols: ['OrganizationPicker'], reason: PICKERS },
  'admin/src/modules/organizations/panels/ModerationActionsPanel.tsx::admin/src/components/organization-picker/index.ts': { symbols: ['OrganizationStatusBadge'], reason: PICKERS },
  'admin/src/modules/payment_methods/PaymentMethodsPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/pim_ergonode/ErgonodeAttributeMappingPage.tsx::admin/src/lib/use-page-size-preference.ts': { symbols: ['usePageSizePreference'], reason: SESSION },
  'admin/src/modules/pim_ergonode/ErgonodeCategoryMappingPage.tsx::admin/src/lib/use-page-size-preference.ts': { symbols: ['usePageSizePreference'], reason: SESSION },
  'admin/src/modules/pim_ergonode/ErgonodeConnectionPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/pim_ergonode/ErgonodeRunDetailPage.tsx::admin/src/lib/use-page-size-preference.ts': { symbols: ['usePageSizePreference'], reason: SESSION },
  'admin/src/modules/pim_ergonode/ErgonodeRunsPage.tsx::admin/src/lib/use-page-size-preference.ts': { symbols: ['usePageSizePreference'], reason: SESSION },
  'admin/src/modules/pim_ergonode/components/ErgonodeSectionTabs.tsx::admin/src/lib/module-presence/index.ts': { symbols: ['useModulePresence'], reason: SESSION },
  'admin/src/modules/product_feeds/CategoryMappingPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/product_feeds/FeedRunDetailPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/product_feeds/FeedTemplateEditorPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/product_feeds/FeedTemplateImportPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/product_feeds/FeedTemplateStartFromPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/product_feeds/FeedTemplatesListPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/product_feeds/ProductFeedCreatePage.tsx::admin/src/components/sales-channel-picker/SalesChannelPicker.tsx': { symbols: ['SalesChannelPicker'], reason: PICKERS },
  'admin/src/modules/product_feeds/ProductFeedCreatePage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/product_feeds/ProductFeedDetailPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/product_feeds/ProductFeedsListPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/product_feeds/TaxonomyRevisionsPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/product_feeds/components/FeedDeliveryPanel.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/product_feeds/components/FeedLinkCard.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/product_feeds/components/FeedSectionTabs.tsx::admin/src/lib/module-presence/index.ts': { symbols: ['useModulePresence'], reason: SESSION },
  'admin/src/modules/product_feeds/components/FeedSettingsForm.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/promotions/PromotionEditPage.tsx::admin/src/lib/use-page-size-preference.ts': { symbols: ['usePageSizePreference'], reason: SESSION },
  'admin/src/modules/promotions/PromotionsPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/quick_order/QuickOrderOnBehalfPage.tsx::admin/src/components/OrderEntryTabs.tsx': { symbols: ['OrderEntryTabs'], reason: SESSION },
  'admin/src/modules/quick_order/QuickOrderOnBehalfPage.tsx::admin/src/components/organization-picker/OrganizationPicker.tsx': { symbols: ['OrganizationPicker'], reason: PICKERS },
  'admin/src/modules/quote_requests/RfqList.tsx::admin/src/components/organization-picker/OrganizationPicker.tsx': { symbols: ['OrganizationPicker'], reason: PICKERS },
  'admin/src/modules/quote_requests/RfqList.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/quote_requests/RfqList.tsx::admin/src/lib/use-page-size-preference.ts': { symbols: ['usePageSizePreference'], reason: SESSION },
  'admin/src/modules/returns/ReturnsList.tsx::admin/src/lib/use-page-size-preference.ts': { symbols: ['usePageSizePreference'], reason: SESSION },
  'admin/src/modules/sales_channels/pages/SalesChannelsListPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/settings/components/AssetIdSettingInput.tsx::admin/src/components/asset-picker/AssetFieldPicker.tsx': { symbols: ['AssetFieldPicker'], reason: PICKERS },
  'admin/src/modules/taxes/TaxesPage.tsx::admin/src/lib/surface-visibility.ts': { symbols: ['useSurfaceVisibility'], reason: SESSION },
  'admin/src/modules/transactional_emails/components/BrandingPanel.tsx::admin/src/components/asset-picker/AssetFieldPicker.tsx': { symbols: ['AssetFieldPicker'], reason: PICKERS },
  'admin/src/modules/transactional_emails/components/BrandingPanel.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/transactional_emails/pages/EmailBlocksPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/transactional_emails/pages/EmailEditor.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/transactional_emails/pages/EmailFragmentEditor.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/transactional_emails/pages/EmailTemplatesPage.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/transactional_emails/pages/EmailsList.tsx::admin/src/lib/auth.tsx': { symbols: ['useAuth'], reason: SESSION },
  'admin/src/modules/warehouses/ChannelMembershipPanel.tsx::admin/src/lib/surface-visibility.ts': { symbols: ['useSurfaceVisibility'], reason: SESSION },
  'admin/src/modules/warehouses/WarehouseEditor.tsx::admin/src/lib/surface-visibility.ts': { symbols: ['useSurfaceVisibility'], reason: SESSION },
  'admin/src/modules/warehouses/WarehousesList.tsx::admin/src/lib/surface-visibility.ts': { symbols: ['useSurfaceVisibility'], reason: SESSION },
  'admin/src/modules/webhooks/WebhooksPage.tsx::admin/src/components/organization-picker/index.ts': { symbols: ['OrganizationPicker'], reason: PICKERS },
};
