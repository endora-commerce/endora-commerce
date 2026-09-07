/**
 * Classes a design system **host renders and no published design system
 * defines** — `check:class-vocabulary`'s `undefined-render` (feature 110,
 * T129b; owner ruling D-219).
 *
 * ## What an entry is, and why the ledger arrives populated
 *
 * Every entry is an element rendering **unstyled, in every instance, today**,
 * and nothing else in this repository says so: Tailwind emits no diagnostic for
 * a class it does not recognise, CSS resolves an undefined selector to nothing,
 * and the screen merely looks slightly wrong. That is the defect D-219 names
 * this check as the mitigation for, so the check has to land; landing it red
 * over 24 sites the ruling did not ask this merge request to repair would mean
 * it does not, which is the state that keeps a rule out of CI forever.
 *
 * Twenty-four sites, and they fall into three shapes worth naming because the
 * repair differs:
 *
 *   - **a variant that does not exist** — `b2b-badge--muted`, `b2b-btn--outline`,
 *     `b2b-field--sm`, `b2b-alert--error`. The base class is defined and the
 *     modifier is not, so the element renders as the base: subtly wrong rather
 *     than obviously broken, which is why five screens have shipped like this.
 *     The repair is one rule in the design system or one corrected class;
 *   - **a block that was never in the vocabulary** — `b2b-alert`, `b2b-chip`,
 *     `b2b-code`, `b2b-grid`, `b2b-grid--cols-3`, `b2b-input`. A screen invented
 *     a name in the design system's namespace. The repair is the kit primitive
 *     (`ui/alert`, `ui/input`, `ui/badge`) or a definition;
 *   - **a CMS block name** — `cms-content-editor`, `cms-page-builder__canvas`.
 *     The design system defines `cms-content-editor__builder` and
 *     `cms-page-builder` but not these two, so the element they name is the
 *     unstyled one.
 *
 * **Two-way**, keyed `<file>::<token>`: an entry describing a render that is
 * gone, or one whose class has since been defined, is `stale-ledger-entry`.
 * There is no `permanent` member and it is expected to empty — an entry saying
 * *"this render is right to be undefined"* would mean the predicate has outgrown
 * its population, and the repair for that is to narrow the predicate rather than
 * to add the entry.
 *
 * **The key is `(file, token)` and never a line.** A line-keyed entry goes stale
 * on any insertion above the site, which is the churn `check:module-boundary`'s
 * shards and `check:default-language-prose` both avoid by construction.
 */
export type UndefinedClassRenderLedger = Readonly<Record<string, string>>;

export const UNDEFINED_CLASS_RENDERS: UndefinedClassRenderLedger = {
  // -- a variant that does not exist ------------------------------------
  'packages/admin-kit/src/components/PaginationFooter.tsx::b2b-field--sm':
    'renders as an unmodified `b2b-field`; the design system defines no `--sm` size',
  'packages/modules/price_lists/src/admin/components/ApplicationRuleBuilder.tsx::b2b-field--sm':
    'the same missing size, one screen over',
  'packages/modules/inventory/src/admin/pages/AvailabilityNotificationsPage.tsx::b2b-badge--muted':
    'renders as an unmodified `b2b-badge`; the neutral variant is `b2b-badge--neutral`',
  'packages/modules/inventory/src/admin/pages/InventoryPage.tsx::b2b-badge--muted':
    'the same missing variant',
  'packages/modules/inventory/src/admin/pages/WarehousesList.tsx::b2b-badge--muted':
    'the same missing variant',
  'packages/modules/price_lists/src/admin/components/LinkedPriceListsPanel.tsx::b2b-badge--muted':
    'the same missing variant',
  'packages/modules/price_lists/src/admin/pages/PriceListDetailPage.tsx::b2b-badge--muted':
    'the same missing variant',
  'packages/modules/price_lists/src/admin/pages/PriceListsPage.tsx::b2b-badge--muted':
    'the same missing variant',
  'packages/modules/product_feeds/src/admin/components/FeedLinkCard.tsx::b2b-btn--outline':
    'renders as an unmodified `b2b-btn`; the design system defines `--primary`, `--ghost` and `--danger`',
  'packages/modules/product_feeds/src/admin/pages/FeedRunDetailPage.tsx::b2b-btn--outline':
    'the same missing variant',
  'packages/modules/catalog/src/admin/components/PackagingUnitsEditor.tsx::b2b-alert--error':
    'a modifier of `b2b-alert`, which is itself undefined — see the entry below',

  // -- a block that was never in the vocabulary --------------------------
  'packages/modules/catalog/src/admin/components/PackagingUnitsEditor.tsx::b2b-alert':
    'no `b2b-alert` block exists; the kit publishes `ui/alert`',
  'packages/modules/catalog/src/admin/components/PackagingUnitsEditor.tsx::b2b-input':
    'no `b2b-input` block exists; the kit publishes `ui/input`',
  'packages/admin-shell/src/components/prompt-actions/PromptModePanel.tsx::b2b-input':
    'the same missing block, in the host application',
  'packages/modules/catalog/src/admin/components/ProductScopeEditor.tsx::b2b-chip':
    'no `b2b-chip` block exists; `b2b-filterchip` is the defined one',
  'packages/admin-shell/src/modules/profile/ProfilePage.tsx::b2b-grid':
    'no `b2b-grid` block exists; the tree lays out with Tailwind utilities',
  'packages/modules/inventory/src/admin/pages/WarehouseEditor.tsx::b2b-grid':
    'the same missing block',
  'packages/modules/inventory/src/admin/pages/WarehouseEditor.tsx::b2b-grid--cols-3':
    'a modifier of the same missing block',
  'packages/modules/pim_pimcore/src/admin/pages/PimcoreConnectionPage.tsx::b2b-code':
    'no `b2b-code` block exists; the deleted shim had an unprefixed `.code` and nothing replaced it',
  'packages/modules/product_feeds/src/admin/components/FeedLinkCard.tsx::b2b-code':
    'the same missing block',
  'packages/modules/product_feeds/src/admin/components/RunIssueGroups.tsx::b2b-code':
    'the same missing block',
  'packages/modules/product_feeds/src/admin/pages/FeedTemplateImportPage.tsx::b2b-code':
    'the same missing block',

  // -- a CMS block name --------------------------------------------------
  'packages/modules/cms/src/admin/components/CmsContentEditorLayout.tsx::cms-content-editor':
    'the design system defines `cms-content-editor__builder` and not the block itself',
  'packages/modules/cms/src/admin/components/PageBuilderEditor.tsx::cms-page-builder__canvas':
    'the design system defines `cms-page-builder` and not this element',
};
