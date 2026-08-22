import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFocusTrap } from './hooks/useFocusTrap.js';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Boxes,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  CreditCard,
  Bell as BellOutline,
  Box,
  Factory,
  FileText,
  Rss,
  HelpCircle,
  Home as HomeIcon,
  Image as ImageIcon,
  Menu,
  Inbox,
  KeyRound,
  Languages,
  LayoutDashboard,
  LineChart,
  ListChecks,
  LogOut,
  Newspaper,
  Layers,
  Package,
  PackageOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PercentDiamond,
  PlugZap,
  Receipt,
  ReceiptText,
  Scale,
  Search,
  Settings,
  Eraser,
  Smartphone,
  ShieldCheck,
  Store,
  Tag,
  Sparkles,
  TrendingDown,
  Truck,
  Upload,
  Users,
  Warehouse as WarehouseIcon,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useTranslation';
import { LanguagePicker } from './LanguagePicker.js';
import { useViewportTier } from './hooks/useViewportTier.js';
import { NotificationBell } from './notifications';
import { useAdminActions } from '@/lib/admin-actions/useAdminActions';
import { normalize } from '@/lib/text-normalization';
import { useModulePresence } from '@/lib/module-presence';
import {
  useSurfaceVisibility,
  type GatedSurface,
  type PermissionRequirement,
} from '@/lib/surface-visibility';
import { resolveIcon } from '@/lib/admin-actions/icon-map';
import { getPromptCapability, listUnseenPromptRequests } from '@/lib/prompt-actions/api';
import { PromptModePanel } from './prompt-actions/PromptModePanel';
import { SpeechToTextButton } from './SpeechToTextButton';
import type { PromptActionRequestDto } from '@endora-commerce/contracts';

interface NavItem extends GatedSurface {
  to: string;
  /**
   * Translation key under the `core` scope. Resolved at render time so
   * the label flips when the admin changes preferred language.
   */
  labelKey: string;
  icon: LucideIcon;
  /**
   * The permission code (or any-of set) that gates the entry's visibility, read
   * from the **route that gates the destination** rather than copied from the
   * entry above it. When unset, the entry renders for every authenticated admin
   * because the destination genuinely has no gate. When set, the entry is hidden
   * unless `useAuth().hasPermission(code)` returns true (the wildcard `*`
   * permission held by `platform_admin` satisfies every code).
   *
   * Issue #230 filled the gaps this comment used to record as an open count:
   * `/orders` (`orders:read`) and `/quote-requests` (`rfqs:handle`) were both
   * advertised to roles that would collect a 403 on arrival.
   */
  requiredPermission?: PermissionRequirement;
  /**
   * The module that owns this destination, or `null` for a surface the admin
   * shell owns itself (the dashboard). Feature 073 / FR-031: the sidebar is
   * resolved from the server's effective enabled-set, and permission is not a
   * proxy for module ownership — the two axes are filtered separately by
   * `isSurfaceVisible`. Explicit attribution is what keeps a new entry from
   * being silently unfiltered.
   */
  module: string | null;
}

interface NavSection {
  /** Stable key — used as the localStorage slot for collapse state. */
  key: string;
  /**
   * Translation key under the `core` scope for the section heading.
   * Empty string = no group label (rendered flat).
   */
  labelKey: string;
  items: NavItem[];
}

/* Design-aligned navigation. The "Home" + "Orders" cluster sits above
 * the first labelled group exactly as the prototype shows. */
const NAV: NavSection[] = [
  {
    key: 'main',
    labelKey: '',
    items: [
      { to: '/', labelKey: 'appShell.nav.home', icon: LayoutDashboard, module: null },
    ],
  },
  {
    key: 'sales',
    labelKey: 'appShell.section.sales',
    items: [
      { to: '/orders', labelKey: 'appShell.nav.orders', icon: ClipboardCheck, requiredPermission: 'orders:read', module: 'orders' },
      // Quick order is not a second destination — it is the other way of
      // getting lines into the same order, so it lives behind a tab on the
      // order-entry page rather than on its own sidebar row.
      { to: '/orders/new', labelKey: 'appShell.nav.newOrder', icon: ClipboardCheck, requiredPermission: 'orders:write', module: 'orders' },
      { to: '/orders/statuses', labelKey: 'appShell.nav.orderStatuses', icon: ClipboardCheck, requiredPermission: 'orders:read', module: 'orders' },
      { to: '/returns', labelKey: 'appShell.nav.returns', icon: Package, requiredPermission: 'returns:read', module: 'returns' },
      { to: '/quote-requests', labelKey: 'appShell.nav.quoteRequests', icon: FileText, requiredPermission: 'rfqs:handle', module: 'quote_requests' },
      // Templates are how an invoice is rendered, not a separate destination:
      // they are reached through the tab strip on the invoices page.
      { to: '/invoices', labelKey: 'appShell.nav.invoices', icon: Receipt, requiredPermission: 'invoices:read', module: 'invoices' },
      { to: '/ksef', labelKey: 'appShell.nav.ksef', icon: ReceiptText, requiredPermission: 'ksef:read', module: 'ksef' },
    ],
  },
  {
    key: 'catalog',
    labelKey: 'appShell.section.catalog',
    items: [
      { to: '/catalog/products', labelKey: 'appShell.nav.products', icon: Package, requiredPermission: 'catalog:read', module: 'catalog' },
      { to: '/catalog/categories', labelKey: 'appShell.nav.categories', icon: Boxes, requiredPermission: 'catalog:read', module: 'catalog' },
      { to: '/catalog/attributes', labelKey: 'appShell.nav.attributes', icon: Tag, requiredPermission: 'catalog:read', module: 'catalog' },
      { to: '/catalog/attribute-sets', labelKey: 'appShell.nav.attributeSets', icon: Tag, requiredPermission: 'catalog:read', module: 'catalog' },
      { to: '/catalog/attachment-types', labelKey: 'appShell.nav.attachmentTypes', icon: FileText, requiredPermission: 'catalog:read', module: 'catalog' },
      {
        to: '/assets-library',
        labelKey: 'appShell.nav.assetsLibrary',
        icon: ImageIcon,
        requiredPermission: 'assets.read',
        module: 'assets_library',
      },
      // Feature 068 — the Ergonode PIM connector sits in Catalog rather than
      // Channels: it is where catalogue content comes *from*, and the three
      // surfaces it writes (products, attributes, categories) are its
      // neighbours here.
      //
      // One row, not three: attribute and category mapping are the other two
      // views of this same integration and are reached through the tab strip on
      // its page. Three sidebar rows for one connector read as three
      // destinations and pushed everything below them two lines down.
      {
        to: '/pim-ergonode',
        labelKey: 'appShell.nav.pimErgonode',
        icon: PlugZap,
        requiredPermission: 'pim_ergonode:read',
        module: 'pim_ergonode',
      },
      // A feed publishes the catalogue, so it belongs beside the catalogue
      // rather than under Channels. Templates are a view of the same surface
      // and are reached through the tab strip there, not a second sidebar row.
      {
        to: '/product-feeds',
        labelKey: 'appShell.nav.productFeeds',
        icon: Rss,
        requiredPermission: 'product_feeds:read',
        module: 'product_feeds',
      },
    ],
  },
  {
    key: 'inventory',
    labelKey: 'appShell.section.inventory',
    items: [
      { to: '/inventory', labelKey: 'appShell.nav.stockOverview', icon: Box, requiredPermission: 'orders:read', module: 'inventory' },
      { to: '/warehouses', labelKey: 'appShell.nav.warehouses', icon: WarehouseIcon, requiredPermission: 'orders:read', module: 'inventory' },
      { to: '/inventory/low-stock', labelKey: 'appShell.nav.lowStock', icon: TrendingDown, requiredPermission: 'orders:read', module: 'inventory' },
      { to: '/inventory/notifications', labelKey: 'appShell.nav.notifyWhenAvailable', icon: BellOutline, requiredPermission: 'orders:read', module: 'inventory' },
      { to: '/inventory/import', labelKey: 'appShell.nav.importStock', icon: PackageOpen, requiredPermission: 'catalog:write', module: 'inventory' },
    ],
  },
  {
    key: 'pricing',
    labelKey: 'appShell.section.pricing',
    items: [
      { to: '/price-lists', labelKey: 'appShell.nav.priceLists', icon: CircleDollarSign, requiredPermission: 'price_lists:read', module: 'price_lists' },
      { to: '/promotions', labelKey: 'appShell.nav.promotions', icon: PercentDiamond, requiredPermission: 'promotions:read', module: 'promotions' },
      { to: '/promotion-rules', labelKey: 'appShell.nav.promotionRules', icon: PercentDiamond, requiredPermission: 'promotions:read', module: 'promotions' },
      { to: '/taxes', labelKey: 'appShell.nav.taxes', icon: Receipt, requiredPermission: 'catalog:write', module: 'taxes' },
      { to: '/delivery-methods', labelKey: 'appShell.nav.deliveryMethods', icon: Truck, requiredPermission: 'catalog:read', module: 'delivery_methods' },
      { to: '/payment-methods', labelKey: 'appShell.nav.paymentMethods', icon: CreditCard, requiredPermission: 'catalog:read', module: 'payment_methods' },
      // Stripe settings are no longer a top-level sidebar entry — they are
      // reached as an "integration" from the Payment methods page (below).
    ],
  },
  {
    key: 'customers',
    labelKey: 'appShell.section.customers',
    items: [
      {
        to: '/customers',
        labelKey: 'appShell.nav.customers',
        icon: Users,
        requiredPermission: 'customers:read',
        module: 'customers',
      },
      {
        to: '/customers/online',
        labelKey: 'appShell.nav.customersOnline',
        icon: Users,
        requiredPermission: 'customers:read',
        module: 'customers',
      },
      // Any-of, because the route is any-of: the organizations list is gated by
      // `requireAdminAny(['customers:read', 'customers:manage'])`
      // (`backend/src/modules/organizations/routes.admin.ts:148`). Naming only
      // the read code — as this entry did — hid the screen from a role holding
      // just `customers:manage`.
      {
        to: '/organizations',
        labelKey: 'appShell.nav.organizations',
        icon: Building2,
        requiredPermission: ['customers:read', 'customers:manage'],
        module: 'organizations',
      },
      // Feature 076 (D-79) — customer groups belong to the customer, so the
      // screen is filed here and the module that owns it is the one that owns
      // the account. `customer_accounts` is non-deactivatable, so this entry
      // never disappears; the permission is what decides who sees it.
      {
        to: '/customer-groups',
        labelKey: 'appShell.nav.customerGroups',
        icon: Users,
        requiredPermission: 'customer_groups:read',
        module: 'customer_accounts',
      },
      { to: '/credit-limits', labelKey: 'appShell.nav.creditLimits', icon: CreditCard, requiredPermission: 'credit_limits:manage', module: 'credit_limits' },
      {
        to: '/comparisons',
        labelKey: 'appShell.nav.comparisons',
        icon: Scale,
        requiredPermission: 'comparisons:read',
        module: 'comparisons',
      },
    ],
  },
  {
    key: 'channels',
    labelKey: 'appShell.section.channels',
    items: [
      {
        to: '/sales-channels',
        labelKey: 'appShell.nav.salesChannels',
        icon: Store,
        requiredPermission: 'sales_channels:read',
        module: 'sales_channels',
      },
      { to: '/dictionary', labelKey: 'appShell.nav.dictionary', icon: Languages, requiredPermission: 'dictionary.write', module: 'dictionaries' },
      { to: '/admin/dictionaries/audit', labelKey: 'appShell.nav.dictionaryAudit', icon: ListChecks, requiredPermission: 'dictionary.write', module: 'dictionaries' },
      { to: '/seo', labelKey: 'appShell.nav.seo', icon: Search, requiredPermission: 'catalog:write', module: 'seo' },
    ],
  },
  {
    key: 'content',
    labelKey: 'appShell.section.content',
    items: [
      { to: '/cms/pages', labelKey: 'appShell.nav.cmsPages', icon: Newspaper, requiredPermission: 'cms.read', module: 'cms' },
      { to: '/cms/blocks', labelKey: 'appShell.nav.cmsBlocks', icon: Newspaper, requiredPermission: 'cms.read', module: 'cms' },
      { to: '/cms/templates', labelKey: 'appShell.nav.cmsTemplates', icon: Newspaper, requiredPermission: 'cms.read', module: 'cms' },
      { to: '/cms/hooks', labelKey: 'appShell.nav.cmsHooks', icon: Webhook, requiredPermission: 'cms.read', module: 'cms' },
      {
        to: '/megamenu',
        labelKey: 'appShell.nav.megamenu',
        icon: Newspaper,
        requiredPermission: 'megamenu.read',
        module: 'megamenu',
      },
      { to: '/blog/posts', labelKey: 'appShell.nav.blogPosts', icon: Newspaper, requiredPermission: 'blog.read', module: 'blog' },
      { to: '/blog/categories', labelKey: 'appShell.nav.blogCategories', icon: Newspaper, requiredPermission: 'blog.read', module: 'blog' },
      { to: '/blog/tags', labelKey: 'appShell.nav.blogTags', icon: Newspaper, requiredPermission: 'blog.read', module: 'blog' },
    ],
  },
  {
    key: 'messaging',
    labelKey: 'appShell.section.messaging',
    items: [
      {
        to: '/transactional-emails',
        labelKey: 'appShell.nav.transactionalEmails',
        icon: Inbox,
        requiredPermission: 'transactional_emails:read',
        module: 'transactional_emails',
      },
      {
        to: '/transactional-emails/blocks',
        labelKey: 'appShell.nav.emailBlocks',
        icon: Inbox,
        requiredPermission: 'transactional_emails:read',
        module: 'transactional_emails',
      },
      {
        to: '/transactional-emails/templates',
        labelKey: 'appShell.nav.emailTemplates',
        icon: Inbox,
        requiredPermission: 'transactional_emails:read',
        module: 'transactional_emails',
      },
    ],
  },
  {
    key: 'newsletter',
    labelKey: 'appShell.section.newsletter',
    items: [
      { to: '/newsletter/subscribers', labelKey: 'appShell.nav.newsletterSubscribers', icon: Inbox, requiredPermission: 'newsletter:read', module: 'newsletter' },
      { to: '/newsletter/campaigns', labelKey: 'appShell.nav.newsletterCampaigns', icon: Inbox, requiredPermission: 'newsletter:read', module: 'newsletter' },
      { to: '/newsletter/automations', labelKey: 'appShell.nav.newsletterAutomations', icon: Inbox, requiredPermission: 'newsletter:read', module: 'newsletter' },
      { to: '/newsletter/tags', labelKey: 'appShell.nav.newsletterTags', icon: Inbox, requiredPermission: 'newsletter:read', module: 'newsletter' },
      { to: '/newsletter/blocks', labelKey: 'appShell.nav.newsletterBlocks', icon: Inbox, requiredPermission: 'newsletter:read', module: 'newsletter' },
      { to: '/newsletter/provider', labelKey: 'appShell.nav.newsletterProvider', icon: Inbox, requiredPermission: 'newsletter:write', module: 'newsletter' },
    ],
  },
  // Reporting and paid-acquisition surfaces. They were originally filed under
  // System because each arrived as a lone integration, but together they are a
  // domain an operator navigates to on purpose — not a system setting.
  {
    key: 'analyticsAds',
    labelKey: 'appShell.section.analyticsAds',
    items: [
      {
        to: '/analytics',
        labelKey: 'appShell.nav.analytics',
        icon: LineChart,
        requiredPermission: 'analytics:read',
        module: 'analytics',
      },
      {
        to: '/google-analytics',
        labelKey: 'appShell.nav.googleAnalytics',
        icon: Sparkles,
        requiredPermission: 'google_analytics:read',
        module: 'google_analytics',
      },
      {
        to: '/linkedin-ads',
        labelKey: 'appShell.nav.linkedinAds',
        icon: Sparkles,
        requiredPermission: 'linkedin_ads:read',
        module: 'linkedin_ads',
      },
      {
        to: '/meta-ads',
        labelKey: 'appShell.nav.metaAds',
        icon: Sparkles,
        requiredPermission: 'meta_ads:read',
        module: 'meta_ads',
      },
    ],
  },
  {
    key: 'system',
    labelKey: 'appShell.section.system',
    items: [
      // `module: null`, deliberately (D-36). This is the screen that switches
      // modules on and off; attributing it to a module would mean the surface
      // could switch itself out of existence, and nothing would be left to
      // switch it back. It is gated on a permission, never on presence.
      {
        to: '/platform/modules',
        labelKey: 'appShell.nav.platformModules',
        icon: Boxes,
        requiredPermission: 'platform.modules.read',
        module: null,
      },
      { to: '/admin-users', labelKey: 'appShell.nav.users', icon: Users, requiredPermission: 'admin_users:manage', module: 'admin_users' },
      // `admin_users:manage`, not an `admin_roles:*` code: `admin_roles` ships no
      // routes at all, and the screen is fed by `/api/v1/admin/admin-roles` in
      // `admin_users` (`admin_users/routes.admin.ts:177`). The module attribution
      // and the permission answer to two different questions here, which is the
      // whole reason they are two fields.
      { to: '/admin-roles', labelKey: 'appShell.nav.roles', icon: ShieldCheck, requiredPermission: 'admin_users:manage', module: 'admin_roles' },
      // Bulk operations may span many domains (not just products), so the
      // entry lives under System. The URL stays `/catalog/bulk-operations`
      // to keep existing deep-links (e.g. the bulk-edit "queued" ack) valid.
      {
        to: '/catalog/bulk-operations',
        labelKey: 'appShell.nav.bulkOperations',
        icon: ListChecks,
        requiredPermission: 'catalog:read',
        module: 'catalog',
      },
      // Custom fields extend Organizations, Orders, Customers, Categories and
      // more, so the entry belongs to System rather than to any one domain.
      {
        to: '/custom-fields',
        labelKey: 'appShell.nav.customFields',
        icon: Layers,
        requiredPermission: 'custom_fields:read',
        module: 'custom_fields',
      },
      { to: '/audit-log', labelKey: 'appShell.nav.auditLog', icon: ListChecks, requiredPermission: 'audit_log:read', module: 'audit_logs' },
      { to: '/api-keys', labelKey: 'appShell.nav.apiKeys', icon: KeyRound, requiredPermission: 'integrations:manage', module: 'api_keys' },
      { to: '/webhooks', labelKey: 'appShell.nav.webhooks', icon: Webhook, requiredPermission: 'integrations:manage', module: 'webhooks' },
      {
        to: '/credentials',
        labelKey: 'appShell.nav.credentials',
        icon: KeyRound,
        requiredPermission: 'credentials:read',
        module: 'credentials',
      },
      { to: '/import-export', labelKey: 'appShell.nav.importExport', icon: Upload, requiredPermission: 'catalog:write', module: 'import_export' },
      {
        to: '/settings',
        labelKey: 'appShell.nav.settings',
        icon: Settings,
        requiredPermission: 'settings:read',
        module: 'settings',
      },
      {
        to: '/settings/groups',
        labelKey: 'appShell.nav.settingGroups',
        icon: Settings,
        requiredPermission: 'settings:read',
        module: 'settings',
      },
      {
        to: '/settings/cache',
        labelKey: 'appShell.nav.cache',
        icon: Eraser,
        requiredPermission: 'settings:write',
        module: 'settings',
      },
      {
        to: '/settings/pwa',
        labelKey: 'appShell.nav.pwa',
        icon: Smartphone,
        requiredPermission: 'pwa:read',
        module: 'pwa',
      },
    ],
  },
];

const STORAGE_KEY = 'b2b-admin.nav.collapsed-groups';
const RAIL_STORAGE_KEY = 'b2b-admin.nav.rail-mode';

/**
 * Rail (icon-only) mode persistence. The whole sidebar shrinks to a
 * 64px-wide column showing just icons; section labels disappear and
 * each section becomes a single icon (the first item's icon). Hovering
 * or clicking the icon reveals a popover with the section's items.
 */
function loadRailMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistRailMode(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function loadCollapsed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === 'string'));
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

function persistCollapsed(value: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(value)));
  } catch {
    /* ignore */
  }
}

/**
 * Map URL pathname → breadcrumb trail. Each crumb carries a label and
 * an optional `href`; the trailing segment (current page) carries
 * `null` so the renderer can disable it. Hrefs are picked so every
 * intermediate crumb routes the operator back to a useful list page
 * (e.g. "Catalog" → /catalog/products).
 */
/**
 * Either a translation key (preferred — resolved via `useTranslation('core')`)
 * or a verbatim literal (used by the URL-segment fallback when the path
 * doesn't match any CRUMB_DICT entry). The renderer picks whichever is set.
 *
 * The static CRUMB_DICT entries always set `labelKey` and reuse the
 * `appShell.nav.*` / `appShell.section.*` keys plus a small
 * `appShell.crumb.*` namespace for the editor / detail / new / edit
 * leaves that aren't represented in the side navigation.
 */
type Crumb =
  | { labelKey: string; literal?: undefined; href: string | null }
  | { labelKey?: undefined; literal: string; href: string | null };

const CRUMB_DICT: Array<{ test: RegExp; build: (m: RegExpMatchArray) => Crumb[] }> = [
  { test: /^\/$/, build: () => [{ labelKey: 'appShell.nav.home', href: null }] },
  { test: /^\/catalog\/products\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/catalog/products' },
    { labelKey: 'appShell.nav.products', href: null },
  ] },
  { test: /^\/catalog\/products\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/catalog/products' },
    { labelKey: 'appShell.nav.products', href: '/catalog/products' },
    { labelKey: 'appShell.crumb.editor', href: null },
  ] },
  { test: /^\/catalog\/categories\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/catalog/products' },
    { labelKey: 'appShell.nav.categories', href: null },
  ] },
  { test: /^\/catalog\/attributes\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/catalog/products' },
    { labelKey: 'appShell.nav.attributes', href: null },
  ] },
  { test: /^\/catalog\/attribute-sets\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/catalog/products' },
    { labelKey: 'appShell.nav.attributeSets', href: null },
  ] },
  { test: /^\/catalog\/attachment-types\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/catalog/products' },
    { labelKey: 'appShell.nav.attachmentTypes', href: null },
  ] },
  // Feature 068 — Ergonode PIM. Deepest trail first: `/runs/:id` before
  // `/runs`, so the more specific pattern is the one that matches.
  { test: /^\/pim-ergonode\/runs\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/catalog/products' },
    { labelKey: 'appShell.nav.pimErgonode', href: '/pim-ergonode' },
    { labelKey: 'appShell.nav.pimErgonodeRuns', href: '/pim-ergonode/runs' },
    { labelKey: 'appShell.crumb.importRun', href: null },
  ] },
  { test: /^\/pim-ergonode\/runs\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/catalog/products' },
    { labelKey: 'appShell.nav.pimErgonode', href: '/pim-ergonode' },
    { labelKey: 'appShell.nav.pimErgonodeRuns', href: null },
  ] },
  { test: /^\/pim-ergonode\/attribute-mappings\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/catalog/products' },
    { labelKey: 'appShell.nav.pimErgonode', href: '/pim-ergonode' },
    { labelKey: 'appShell.nav.pimErgonodeAttributeMappings', href: null },
  ] },
  { test: /^\/pim-ergonode\/category-mappings\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/catalog/products' },
    { labelKey: 'appShell.nav.pimErgonode', href: '/pim-ergonode' },
    { labelKey: 'appShell.nav.pimErgonodeCategoryMappings', href: null },
  ] },
  { test: /^\/pim-ergonode\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/catalog/products' },
    { labelKey: 'appShell.nav.pimErgonode', href: null },
  ] },
  { test: /^\/product-feeds\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/product-feeds' },
    { labelKey: 'appShell.nav.productFeeds', href: null },
  ] },
  { test: /^\/product-feeds\/new\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/product-feeds' },
    { labelKey: 'appShell.nav.productFeeds', href: '/product-feeds' },
    { labelKey: 'appShell.crumb.new', href: null },
  ] },
  { test: /^\/product-feeds\/templates\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/product-feeds' },
    { labelKey: 'appShell.nav.feedTemplates', href: null },
  ] },
  { test: /^\/product-feeds\/templates\/new\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/product-feeds' },
    { labelKey: 'appShell.nav.feedTemplates', href: '/product-feeds/templates' },
    { labelKey: 'appShell.crumb.new', href: null },
  ] },
  { test: /^\/product-feeds\/templates\/import\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/product-feeds' },
    { labelKey: 'appShell.nav.feedTemplates', href: '/product-feeds/templates' },
    { labelKey: 'appShell.crumb.import', href: null },
  ] },
  { test: /^\/product-feeds\/templates\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/product-feeds' },
    { labelKey: 'appShell.nav.feedTemplates', href: '/product-feeds/templates' },
    { labelKey: 'appShell.crumb.editor', href: null },
  ] },
  { test: /^\/product-feeds\/[^/]+\/runs\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/product-feeds' },
    { labelKey: 'appShell.nav.productFeeds', href: '/product-feeds' },
    { labelKey: 'appShell.crumb.feedRun', href: null },
  ] },
  { test: /^\/product-feeds\/category-mapping\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/product-feeds' },
    { labelKey: 'appShell.nav.productFeeds', href: '/product-feeds' },
    { labelKey: 'appShell.nav.feedCategoryMapping', href: null },
  ] },
  { test: /^\/product-feeds\/taxonomy-revisions\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/product-feeds' },
    { labelKey: 'appShell.nav.productFeeds', href: '/product-feeds' },
    { labelKey: 'appShell.nav.feedCategoryMapping', href: '/product-feeds/category-mapping' },
    { labelKey: 'appShell.nav.feedTaxonomyRevisions', href: null },
  ] },
  { test: /^\/product-feeds\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/product-feeds' },
    { labelKey: 'appShell.nav.productFeeds', href: '/product-feeds' },
    { labelKey: 'appShell.crumb.editor', href: null },
  ] },
  { test: /^\/assets-library\/?$/, build: () => [
    { labelKey: 'appShell.section.catalog', href: '/catalog/products' },
    { labelKey: 'appShell.nav.assetsLibrary', href: null },
  ] },
  { test: /^\/inventory\/?$/, build: () => [
    { labelKey: 'appShell.section.inventory', href: null },
  ] },
  { test: /^\/inventory\/low-stock\/?$/, build: () => [
    { labelKey: 'appShell.section.inventory', href: '/inventory' },
    { labelKey: 'appShell.nav.lowStock', href: null },
  ] },
  { test: /^\/inventory\/notifications\/?$/, build: () => [
    { labelKey: 'appShell.section.inventory', href: '/inventory' },
    { labelKey: 'appShell.nav.notifyWhenAvailable', href: null },
  ] },
  { test: /^\/inventory\/import\/?$/, build: () => [
    { labelKey: 'appShell.section.inventory', href: '/inventory' },
    { labelKey: 'appShell.nav.importStock', href: null },
  ] },
  { test: /^\/warehouses\/?$/, build: () => [
    { labelKey: 'appShell.section.inventory', href: '/inventory' },
    { labelKey: 'appShell.nav.warehouses', href: null },
  ] },
  { test: /^\/warehouses\/new\/?$/, build: () => [
    { labelKey: 'appShell.section.inventory', href: '/inventory' },
    { labelKey: 'appShell.nav.warehouses', href: '/warehouses' },
    { labelKey: 'appShell.crumb.new', href: null },
  ] },
  { test: /^\/warehouses\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.inventory', href: '/inventory' },
    { labelKey: 'appShell.nav.warehouses', href: '/warehouses' },
    { labelKey: 'appShell.crumb.edit', href: null },
  ] },
  { test: /^\/price-lists\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.priceLists', href: null },
  ] },
  { test: /^\/price-lists\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.priceLists', href: '/price-lists' },
    { labelKey: 'appShell.crumb.detail', href: null },
  ] },
  { test: /^\/promotions\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.promotions', href: null },
  ] },
  { test: /^\/promotions\/new\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.promotions', href: '/promotions' },
    { labelKey: 'promotions.edit.titleNew', href: null },
  ] },
  { test: /^\/promotions\/[^/]+\/stats\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.promotions', href: '/promotions' },
    { labelKey: 'promotionStats.title', href: null },
  ] },
  { test: /^\/promotions\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.promotions', href: '/promotions' },
    { labelKey: 'promotions.edit.titleEdit', href: null },
  ] },
  { test: /^\/taxes\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.taxes', href: null },
  ] },
  { test: /^\/delivery-methods\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.deliveryMethods', href: null },
  ] },
  { test: /^\/payment-methods\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.paymentMethods', href: null },
  ] },
  { test: /^\/settings\/tpay\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.paymentMethods', href: '/payment-methods' },
    { labelKey: 'appShell.nav.tpay', href: null },
  ] },
  { test: /^\/settings\/stripe\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.paymentMethods', href: '/payment-methods' },
    { labelKey: 'appShell.nav.stripe', href: null },
  ] },
  { test: /^\/settings\/payu\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.paymentMethods', href: '/payment-methods' },
    { labelKey: 'appShell.nav.payu', href: null },
  ] },
  { test: /^\/settings\/autopay\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.paymentMethods', href: '/payment-methods' },
    { labelKey: 'appShell.nav.autopay', href: null },
  ] },
  { test: /^\/settings\/paypal\/?$/, build: () => [
    { labelKey: 'appShell.section.pricing', href: '/price-lists' },
    { labelKey: 'appShell.nav.paymentMethods', href: '/payment-methods' },
    { labelKey: 'appShell.nav.paypal', href: null },
  ] },
  { test: /^\/organizations\/?$/, build: () => [
    { labelKey: 'appShell.section.customers', href: '/organizations' },
    { labelKey: 'appShell.nav.organizations', href: null },
  ] },
  { test: /^\/organizations\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.customers', href: '/organizations' },
    { labelKey: 'appShell.nav.organizations', href: '/organizations' },
    { labelKey: 'appShell.crumb.detail', href: null },
  ] },
  { test: /^\/orders\/?$/, build: () => [{ labelKey: 'appShell.nav.orders', href: null }] },
  // These three must precede the generic /orders/:id rule below — buildCrumbs
  // returns on first match, so without them the named sub-pages were labelled
  // "Orders / Detail" as if their path segment were an order id.
  { test: /^\/orders\/new\/?$/, build: () => [
    { labelKey: 'appShell.nav.orders', href: '/orders' },
    { labelKey: 'appShell.nav.newOrder', href: null },
  ] },
  { test: /^\/orders\/quick-order\/?$/, build: () => [
    { labelKey: 'appShell.nav.orders', href: '/orders' },
    { labelKey: 'appShell.nav.quickOrder', href: null },
  ] },
  { test: /^\/orders\/statuses\/?$/, build: () => [
    { labelKey: 'appShell.nav.orders', href: '/orders' },
    { labelKey: 'appShell.nav.orderStatuses', href: null },
  ] },
  { test: /^\/orders\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.nav.orders', href: '/orders' },
    { labelKey: 'appShell.crumb.detail', href: null },
  ] },
  { test: /^\/invoices\/?$/, build: () => [
    { labelKey: 'appShell.section.customers', href: '/organizations' },
    { labelKey: 'appShell.nav.invoices', href: null },
  ] },
  { test: /^\/invoices\/(?!templates)[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.customers', href: '/organizations' },
    { labelKey: 'appShell.nav.invoices', href: '/invoices' },
    { labelKey: 'appShell.crumb.detail', href: null },
  ] },
  { test: /^\/credit-limits\/?$/, build: () => [
    { labelKey: 'appShell.section.customers', href: '/organizations' },
    { labelKey: 'appShell.nav.creditLimits', href: null },
  ] },
  { test: /^\/quote-requests\/?$/, build: () => [
    { labelKey: 'appShell.section.customers', href: '/organizations' },
    { labelKey: 'appShell.nav.quoteRequests', href: null },
  ] },
  { test: /^\/quote-requests\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.customers', href: '/organizations' },
    { labelKey: 'appShell.nav.quoteRequests', href: '/quote-requests' },
    { labelKey: 'appShell.crumb.detail', href: null },
  ] },
  { test: /^\/comparisons\/?$/, build: () => [
    { labelKey: 'appShell.section.customers', href: '/organizations' },
    { labelKey: 'appShell.nav.comparisons', href: null },
  ] },
  { test: /^\/comparisons\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.customers', href: '/organizations' },
    { labelKey: 'appShell.nav.comparisons', href: '/comparisons' },
    { labelKey: 'appShell.crumb.detail', href: null },
  ] },
  { test: /^\/sales-channels\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.salesChannels', href: null },
  ] },
  { test: /^\/sales-channels\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.salesChannels', href: '/sales-channels' },
    { labelKey: 'appShell.crumb.detail', href: null },
  ] },
  { test: /^\/cms(?:\/pages)?\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.cmsPages', href: null },
  ] },
  { test: /^\/cms\/pages\/(?:new|[^/]+)\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.cmsPages', href: '/cms/pages' },
    { labelKey: 'appShell.crumb.editor', href: null },
  ] },
  { test: /^\/cms\/blocks\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.cmsBlocks', href: null },
  ] },
  { test: /^\/cms\/blocks\/(?:new|[^/]+)\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.cmsBlocks', href: '/cms/blocks' },
    { labelKey: 'appShell.crumb.editor', href: null },
  ] },
  { test: /^\/cms\/templates\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.cmsTemplates', href: null },
  ] },
  { test: /^\/cms\/templates\/(?:new|[^/]+)\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.cmsTemplates', href: '/cms/templates' },
    { labelKey: 'appShell.crumb.editor', href: null },
  ] },
  { test: /^\/cms\/hooks\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.cmsHooks', href: null },
  ] },
  { test: /^\/megamenu\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.megamenu', href: null },
  ] },
  { test: /^\/megamenu\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.megamenu', href: '/megamenu' },
    { labelKey: 'appShell.crumb.editor', href: null },
  ] },
  { test: /^\/dictionary\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.dictionary', href: null },
  ] },
  { test: /^\/(?:admin\/)?dictionaries\/audit\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.dictionary', href: '/dictionary' },
    { labelKey: 'appShell.crumb.audit', href: null },
  ] },
  { test: /^\/seo\/?$/, build: () => [
    { labelKey: 'appShell.section.channels', href: '/sales-channels' },
    { labelKey: 'appShell.nav.seo', href: null },
  ] },
  { test: /^\/admin-users\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.users', href: null },
  ] },
  { test: /^\/admin-roles\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.roles', href: null },
  ] },
  { test: /^\/audit-log\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.auditLog', href: null },
  ] },
  { test: /^\/api-keys\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.apiKeys', href: null },
  ] },
  { test: /^\/webhooks\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.webhooks', href: null },
  ] },
  { test: /^\/google-analytics(\/.*)?$/, build: () => [
    { labelKey: 'appShell.nav.googleAnalytics', href: '/google-analytics' },
  ] },
  { test: /^\/linkedin-ads(\/.*)?$/, build: () => [
    { labelKey: 'appShell.nav.linkedinAds', href: '/linkedin-ads' },
  ] },
  { test: /^\/meta-ads(\/.*)?$/, build: () => [
    { labelKey: 'appShell.nav.metaAds', href: '/meta-ads' },
  ] },
  { test: /^\/analytics\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.analytics', href: null },
  ] },
  { test: /^\/import-export\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.importExport', href: null },
  ] },
  { test: /^\/platform\/modules\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.platformModules', href: null },
  ] },
  { test: /^\/settings\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.settings', href: null },
  ] },
  { test: /^\/settings\/groups\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.settingGroups', href: null },
  ] },
  { test: /^\/profile\/?$/, build: () => [
    { labelKey: 'appShell.crumb.myProfile', href: null },
  ] },
  { test: /^\/transactional-emails\/?$/, build: () => [
    { labelKey: 'appShell.section.messaging', href: '/transactional-emails' },
    { labelKey: 'appShell.nav.transactionalEmails', href: null },
  ] },
  { test: /^\/transactional-emails\/blocks\/?$/, build: () => [
    { labelKey: 'appShell.section.messaging', href: '/transactional-emails' },
    { labelKey: 'appShell.nav.emailBlocks', href: null },
  ] },
  { test: /^\/transactional-emails\/blocks\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.messaging', href: '/transactional-emails' },
    { labelKey: 'appShell.nav.emailBlocks', href: '/transactional-emails/blocks' },
    { labelKey: 'appShell.crumb.editor', href: null },
  ] },
  { test: /^\/transactional-emails\/templates\/?$/, build: () => [
    { labelKey: 'appShell.section.messaging', href: '/transactional-emails' },
    { labelKey: 'appShell.nav.emailTemplates', href: null },
  ] },
  { test: /^\/transactional-emails\/templates\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.messaging', href: '/transactional-emails' },
    { labelKey: 'appShell.nav.emailTemplates', href: '/transactional-emails/templates' },
    { labelKey: 'appShell.crumb.editor', href: null },
  ] },
  { test: /^\/transactional-emails\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.section.messaging', href: '/transactional-emails' },
    { labelKey: 'appShell.nav.transactionalEmails', href: '/transactional-emails' },
    { labelKey: 'appShell.crumb.editor', href: null },
  ] },
];

function buildCrumbs(pathname: string): Crumb[] {
  for (const entry of CRUMB_DICT) {
    const match = pathname.match(entry.test);
    if (match) return entry.build(match);
  }
  // Keep real path segments in hrefs; only humanize the visible label.
  const segments = pathname.split('/').filter(Boolean);
  return segments.map((segment, idx) => ({
    literal: segment.replace(/-/g, ' '),
    href: idx === segments.length - 1 ? null : `/${segments.slice(0, idx + 1).join('/')}`,
  }));
}

interface PaletteItem extends GatedSurface {
  group: 'Navigate' | 'Actions' | 'Assistant';
  /**
   * For static Navigate items: a translation key under the `core` scope.
   * For registry-driven Actions items (feature 020): an already-resolved
   * string the registry produced via the module's labelKey.
   */
  label: string;
  /** Translation key (Navigate) or resolved string (Actions). */
  sub: string;
  /**
   * `'key'` when `label`/`sub` are translation keys (Navigate group);
   * `'literal'` when they are already-resolved strings (Actions group).
   */
  labelMode: 'key' | 'literal';
  icon: LucideIcon;
  to: string;
  keywords: string;
  /**
   * The module that owns the destination, or `null` for a shell surface.
   *
   * Feature 073 / FR-032 closed the module-state half of the palette leak: the
   * server-fed Actions group has filtered on `module_registrations.state` since
   * feature 020, while this array was merged in unfiltered — `/inventory`,
   * `/comparisons`, `/newsletter/*`, `/webhooks`, `/credentials` and
   * `/promotions` among them. A palette entry for an absent module is a link to
   * a 503.
   */
  module?: string | null;
  /**
   * The permission the destination's route enforces. Issue #230 — the other
   * half of the same leak, and the half that survives after module state has
   * done its job: an operator whose modules are all present still saw palette
   * entries for screens their role cannot open, which Principle XVI item 2
   * forbids in as many words. `PaletteItem` had no such field at all, so no
   * amount of data could have gated these rows.
   *
   * Unset means the destination genuinely has no gate (the dashboard) or, for
   * a registry-driven Actions row, that the server already filtered it —
   * `AdminActionsService` resolves both axes before the row reaches us.
   */
  requiredPermission?: PermissionRequirement;
}

/**
 * The palette's one matching rule, for every group it renders.
 *
 * Issue #233. The dialog merges three indexes and used to match with two
 * different rules: the server-fed Actions group filters through `normalize`
 * (`lib/text-normalization.ts`, applied in `lib/admin-actions/useAdminActions.ts`),
 * which folds diacritics *and* the stroked letters NFD leaves standing, while
 * the static Navigate group and the pinned Assistant row used a bare
 * `toLowerCase().includes()`. Typing `zamowienia` therefore found the Actions
 * row for orders and not the Navigate row for the same screen — and Polish
 * operators routinely type without diacritics, so half the palette silently
 * stopped answering them. Issue #236 then found a fourth copy in the
 * page-builder drawer, which is why the fold now lives at
 * `lib/text-normalization.ts` and not under `lib/admin-actions/`.
 *
 * `normalize` is **imported, not re-implemented**: the whole defect was one
 * question answered twice, and a copy is how the two answers drifted apart. It
 * folds `ł` through an explicit stroked-letter map, which matters — `ł` has no
 * NFD decomposition, so the obvious `normalize('NFD').replace(...)` one-liner
 * leaves `płatności` unmatched by `platnosci`.
 *
 * **Both sides are folded.** Folding only the haystack breaks the operator who
 * does type `zamówienia`; folding only the query breaks the one who does not.
 * (Postel's Law — accept what was typed and normalise it.)
 *
 * `needle` must already be normalised; the caller folds the query once per
 * keystroke rather than once per row. `normalize` trims, so a query with a
 * leading space matches what the operator meant rather than nothing at all
 * (issue #236).
 */
function matchesQuery(needle: string, ...haystacks: string[]): boolean {
  return haystacks.some((haystack) => normalize(haystack).includes(needle));
}

/**
 * The static Navigate group.
 *
 * **Every `requiredPermission` here is read from the backend route that gates
 * the destination, not from the sidebar entry beside it.** Copying a neighbour
 * is how a wrong code gets propagated twice, and several of these are not what
 * the neighbourhood suggests:
 *
 *  - `/inventory` and `/warehouses` are gated by `orders:read`, not by anything
 *    named after inventory (`inventory/routes.admin.ts:103,183`);
 *  - `/payment-methods` and `/delivery-methods` by `catalog:read`
 *    (`payment_methods/routes.ts:108`, `delivery_methods/routes.ts:97`);
 *  - `/api-keys` and `/webhooks` by one shared `integrations:manage`
 *    (`api_keys/routes.ts:20`, `webhooks/routes.ts:21`);
 *  - `/dictionary` and its audit view by `dictionary.write` — the module
 *    declares no read code, so reading the dictionary requires the write one
 *    (`dictionaries/routes.admin.ts:72`);
 *  - `/organizations` by `requireAdminAny(['customers:read',
 *    'customers:manage'])`, which is why the field takes an any-of array.
 *
 * **Denied entries are hidden, not shown disabled** — the same treatment module
 * absence already gets, and applied identically in the sidebar and in the
 * dashboard's quick actions. Three reasons, in order of weight:
 *
 *  1. The Actions group in this very dialog already hides on permission;
 *     `AdminActionsService` filters server-side before the row is sent. Showing
 *     Navigate rows disabled would make one palette use two opposite treatments
 *     for two groups the operator does not distinguish — identical-looking rows
 *     that behave differently (Law of Similarity).
 *  2. On an empty query the palette lists every Navigate entry. For a
 *     single-domain role that is a wall of unusable rows in the surface whose
 *     entire job is to shorten the path to the one thing you asked for (Hick).
 *  3. Keyboard and pointer must reach the same conclusion. The Arrow/Enter loop
 *     below indexes `items` directly, so a disabled row would still be
 *     selectable by keyboard and `Enter` would navigate into a 403 — a
 *     disabled-row design would need `aria-disabled`, a linked reason and cursor
 *     skipping to be honest. Hiding makes the two paths identical by
 *     construction and leaves nothing for a screen reader to announce.
 *
 * The cost of hiding is real and is answered elsewhere: "you do not have access
 * to this" is actionable in a way "this module is not installed" is not, so it
 * belongs at the point of failure — the 403 an operator reaches by bookmark or
 * deep link — rather than in an index the operator is scanning for something
 * else. That screen is not part of this change; see the report.
 */
const PALETTE_ITEMS: PaletteItem[] = [
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.home', sub: 'appShell.palette.sub.dashboard', icon: HomeIcon, to: '/', keywords: 'home dashboard strona główna pulpit' , module: null },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.products', sub: 'appShell.palette.sub.catalogRows', icon: Package, to: '/catalog/products', keywords: 'products catalog items produkty katalog', requiredPermission: 'catalog:read' , module: 'catalog' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.stockOverview', sub: 'appShell.palette.sub.stockLevels', icon: Factory, to: '/inventory', keywords: 'inventory stock warehouse magazyn stany', requiredPermission: 'orders:read' , module: 'inventory' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.priceLists', sub: 'appShell.palette.sub.pricingRules', icon: CircleDollarSign, to: '/price-lists', keywords: 'pricing prices price list cennik', requiredPermission: 'price_lists:read' , module: 'price_lists' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.organizations', sub: 'appShell.palette.sub.customerAccounts', icon: Building2, to: '/organizations', keywords: 'org orgs customer organization organizacja klient', requiredPermission: ['customers:read', 'customers:manage'] , module: 'organizations' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.creditLimits', sub: 'appShell.palette.sub.creditLimits', icon: CreditCard, to: '/credit-limits', keywords: 'credit limit limits balance terms limity kredytowe saldo', requiredPermission: 'credit_limits:manage' , module: 'credit_limits' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.orders', sub: 'appShell.palette.sub.openOrders', icon: ClipboardCheck, to: '/orders', keywords: 'orders sales zamówienia sprzedaż', requiredPermission: 'orders:read' , module: 'orders' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.quoteRequests', sub: 'appShell.palette.sub.customerRfqs', icon: FileText, to: '/quote-requests', keywords: 'rfq quote zapytanie ofertowe', requiredPermission: 'rfqs:handle' , module: 'quote_requests' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.comparisons', sub: 'appShell.palette.sub.compareAudit', icon: Scale, to: '/comparisons', keywords: 'compare comparisons porównanie', requiredPermission: 'comparisons:read' , module: 'comparisons' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.categories', sub: 'appShell.palette.sub.categoryTree', icon: Boxes, to: '/catalog/categories', keywords: 'category categories tree kategorie', requiredPermission: 'catalog:read' , module: 'catalog' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.attributes', sub: 'appShell.palette.sub.attributeDefinitions', icon: Tag, to: '/catalog/attributes', keywords: 'attribute attributes atrybuty', requiredPermission: 'catalog:read' , module: 'catalog' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.salesChannels', sub: 'appShell.palette.sub.storefrontChannels', icon: Store, to: '/sales-channels', keywords: 'sales channel channels kanał sprzedaży', requiredPermission: 'sales_channels:read' , module: 'sales_channels' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.paymentMethods', sub: 'appShell.palette.sub.paymentMethods', icon: CreditCard, to: '/payment-methods', keywords: 'payment methods pay gateway checkout metody płatności płatności bramka', requiredPermission: 'catalog:read' , module: 'payment_methods' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.deliveryMethods', sub: 'appShell.palette.sub.deliveryMethods', icon: Truck, to: '/delivery-methods', keywords: 'delivery shipping methods courier metody dostawy wysyłka kurier', requiredPermission: 'catalog:read' , module: 'delivery_methods' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.dictionary', sub: 'appShell.palette.sub.dictionary', icon: Languages, to: '/dictionary', keywords: 'dictionary countries currencies languages i18n słownik kraje waluty języki', requiredPermission: 'dictionary.write' , module: 'dictionaries' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.dictionaryAudit', sub: 'appShell.palette.sub.dictionaryAudit', icon: ListChecks, to: '/admin/dictionaries/audit', keywords: 'dictionary audit orphan references audyt słownika', requiredPermission: 'dictionary.write' , module: 'dictionaries' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.settings', sub: 'appShell.palette.sub.platformConfiguration', icon: Settings, to: '/settings', keywords: 'settings configuration config ustawienia konfiguracja', requiredPermission: 'settings:read' , module: 'settings' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.apiKeys', sub: 'appShell.palette.sub.apiKeys', icon: KeyRound, to: '/api-keys', keywords: 'api keys bearer token integration klucze api token integracja', requiredPermission: 'integrations:manage' , module: 'api_keys' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.webhooks', sub: 'appShell.palette.sub.webhooks', icon: Webhook, to: '/webhooks', keywords: 'webhook webhooks events signing secret integration webhooki zdarzenia integracja', requiredPermission: 'integrations:manage' , module: 'webhooks' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.credentials', sub: 'appShell.palette.sub.credentials', icon: KeyRound, to: '/credentials', keywords: 'credentials credential secrets provider llm smtp poświadczenia sekrety dostawca', requiredPermission: 'credentials:read' , module: 'credentials' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.promotions', sub: 'appShell.palette.sub.promotions', icon: PercentDiamond, to: '/promotions', keywords: 'promotion promotions discount coupon marketing promocje rabaty kupony', requiredPermission: 'promotions:read' , module: 'promotions' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.promotionRules', sub: 'appShell.palette.sub.promotionRules', icon: PercentDiamond, to: '/promotion-rules', keywords: 'promotion rules rule builder reguły promocji', requiredPermission: 'promotions:read' , module: 'promotions' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.newsletterSubscribers', sub: 'appShell.palette.sub.newsletterSubscribers', icon: Newspaper, to: '/newsletter/subscribers', keywords: 'newsletter subscribers marketing subskrybenci newslettera', requiredPermission: 'newsletter:read' , module: 'newsletter' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.newsletterCampaigns', sub: 'appShell.palette.sub.newsletterCampaigns', icon: Newspaper, to: '/newsletter/campaigns', keywords: 'newsletter campaigns email marketing kampanie newslettera', requiredPermission: 'newsletter:read' , module: 'newsletter' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.newsletterAutomations', sub: 'appShell.palette.sub.newsletterAutomations', icon: Newspaper, to: '/newsletter/automations', keywords: 'newsletter automations workflow automatyzacje newslettera', requiredPermission: 'newsletter:read' , module: 'newsletter' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.transactionalEmails', sub: 'appShell.palette.sub.transactionalEmails', icon: Inbox, to: '/transactional-emails', keywords: 'transactional emails notifications maile transakcyjne powiadomienia', requiredPermission: 'transactional_emails:read' , module: 'transactional_emails' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.emailBlocks', sub: 'appShell.palette.sub.emailBlocks', icon: Inbox, to: '/transactional-emails/blocks', keywords: 'email blocks fragments bloki maili', requiredPermission: 'transactional_emails:read' , module: 'transactional_emails' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.emailTemplates', sub: 'appShell.palette.sub.emailTemplates', icon: Inbox, to: '/transactional-emails/templates', keywords: 'email templates layout szablony maili', requiredPermission: 'transactional_emails:read' , module: 'transactional_emails' },
  // Feature 020 — the Actions group is now sourced from the module
  // registry via useAdminActions(); the previously-hardcoded "New
  // product" and "Import products" entries are declared by the
  // catalog and import_export module manifests respectively.
];

export function AppShell(): ReactNode {
  const { me, logout, hasPermission } = useAuth();
  // Feature 073 — the effective enabled-set. A module that is off contributes
  // no sidebar entry and no palette entry; neither surface recombines the two
  // presence axes, because the server already did.
  const { isPresent: isModulePresent } = useModulePresence();
  const isVisible = useSurfaceVisibility();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());
  const [railMode, setRailMode] = useState<boolean>(() => loadRailMode());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const viewportTier = useViewportTier();
  const isMobile = viewportTier === 'mobile';
  useFocusTrap(sidebarRef, isMobile && navDrawerOpen);

  const toggleRailMode = useCallback((): void => {
    setRailMode((prev) => {
      const next = !prev;
      persistRailMode(next);
      return next;
    });
  }, []);
  const t = useTranslation('core');

  const fullName = me ? `${me.adminUser.firstName} ${me.adminUser.lastName}`.trim() : '';
  const role = me?.role?.name ?? 'Admin';

  const toggleSection = useCallback((key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistCollapsed(next);
      return next;
    });
  }, []);

  // ⌘K opens the palette anywhere in the admin; ⌘B toggles the
  // sidebar rail (matches the shadcn / VS Code shortcut convention).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // `!e.shiftKey` keeps ⌘K off Ctrl/⌘+Shift+K, which pages claim for
      // their own in-page search (e.g. the Settings page's filter box).
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (
        !isMobile &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'b'
      ) {
        e.preventDefault();
        toggleRailMode();
      } else if (e.key === 'Escape' && navDrawerOpen) {
        setNavDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [toggleRailMode, isMobile, navDrawerOpen]);

  useEffect(() => {
    setNavDrawerOpen(false);
  }, [location.pathname]);

  const crumbs = useMemo(() => buildCrumbs(location.pathname), [location.pathname]);
  const isCmsRoute = location.pathname.startsWith('/cms');

  return (
    <div
      className={cn(
        'b2b-app-layout',
        isMobile ? null : railMode ? 'b2b-app-layout--rail' : 'b2b-app-layout--expanded',
      )}
    >
      {isMobile && navDrawerOpen ? (
        <button
          type="button"
          className="b2b-nav-drawer-backdrop"
          aria-label={t('appShell.mobileMenu.close')}
          onClick={(): void => setNavDrawerOpen(false)}
        />
      ) : null}
      {/* ============ Sidebar ============ */}
      <aside
        ref={sidebarRef}
        className={cn(
          'b2b-sidebar',
          railMode && !isMobile && 'b2b-sidebar--rail',
          isMobile && navDrawerOpen && 'b2b-sidebar--drawer-open',
        )}
        aria-hidden={isMobile && !navDrawerOpen ? true : undefined}
        role="navigation"
        aria-label={t('appShell.mobileMenu.title')}
      >
        <NavLink
          to="/"
          end
          className="b2b-sidebar__brand"
          style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
          aria-label={t('appShell.brand.dashboardLink')}
          title={railMode ? t('appShell.brand.text') : undefined}
        >
          <span className="b2b-sidebar__brand-logo">EC</span>
          <span className="b2b-sidebar__brand-text">{t('appShell.brand.text')}</span>
        </NavLink>

        <div className="b2b-sidebar__search">
          {railMode ? (
            <button
              type="button"
              className="b2b-sidebar__search-rail"
              onClick={(): void => setPaletteOpen(true)}
              title={t('appShell.search.openPalette')}
              aria-label={t('appShell.search.openPalette')}
            >
              <Search size={16} />
            </button>
          ) : (
            <>
              <Search size={14} className="b2b-sidebar__search-icon" />
              <input
                className="b2b-sidebar__search-input"
                placeholder={t('appShell.search.placeholder')}
                readOnly
                onClick={(): void => setPaletteOpen(true)}
                onFocus={(): void => setPaletteOpen(true)}
              />
              <span className="b2b-sidebar__search-kbd">{t('appShell.search.shortcutSymbol')}</span>
            </>
          )}
        </div>

        <nav className="b2b-sidebar__nav">
          {NAV.map((section) => {
            const isOpen = !collapsed.has(section.key);
            // Permission-gate every entry, then presence-gate it (feature 073 /
            // FR-031). Sections with no remaining visible items fold away
            // entirely, which is what makes a whole domain disappear when every
            // module in it is off — the same behaviour restricted admins have
            // always had.
            //
            // Issue #230 — the predicate is `isSurfaceVisible`, shared with the
            // command palette and the dashboard quick actions. The palette used
            // to run a second, weaker copy of it; a shared helper is what stops
            // the three from disagreeing again.
            const visibleItems = section.items.filter(isVisible);
            if (visibleItems.length === 0) return null;
            // Feature 019 / 021 — section labels go through useTranslation('core').
            // The empty-labelKey "main" cluster keeps no label; every other
            // group resolves its declared `labelKey`. Polish strings live
            // in backend/src/modules/_i18n/i18n/pl.json under the same key.
            const translatedLabel = section.labelKey ? t(section.labelKey) : '';
            // In rail mode the section reduces to one icon (the first
            // visible item's icon). Hover or click reveals a popover
            // listing every visible item in the section.
            if (railMode) {
              return (
                <RailSection
                  key={section.key}
                  section={section}
                  visibleItems={visibleItems}
                  translatedLabel={translatedLabel}
                />
              );
            }
            return (
              <div
                key={section.key}
                className={cn(
                  'b2b-sidebar__group',
                  !isOpen && section.labelKey && 'b2b-sidebar__group--collapsed',
                )}
              >
                {section.labelKey ? (
                  <button
                    type="button"
                    className="b2b-sidebar__group-label"
                    onClick={(): void => toggleSection(section.key)}
                  >
                    <ChevronDown size={11} />
                    <span>{translatedLabel}</span>
                  </button>
                ) : null}
                <div className="b2b-sidebar__items">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    // Force exact-match (`end`) when another item in the same
                    // section nests under this item's path. Without this, a
                    // parent route like `/inventory` lights up alongside its
                    // children (`/inventory/low-stock`, `/inventory/import`,
                    // …) because NavLink's default match is prefix-based.
                    // The home link (`/`) is the canonical example and is
                    // covered by the same rule (every other item starts with
                    // `/`).
                    const hasNestedSibling = section.items.some(
                      (other) =>
                        other !== item &&
                        other.to.startsWith(item.to === '/' ? '/' : `${item.to}/`),
                    );
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === '/' || hasNestedSibling}
                        className={({ isActive }): string =>
                          cn('b2b-nav-item', isActive && 'is-active')
                        }
                      >
                        <Icon size={16} />
                        <span style={{ flex: 1 }}>{t(item.labelKey)}</span>
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {me ? (
          <div className="b2b-sidebar__foot">
            <NavLink
              to="/profile"
              className="b2b-sidebar__foot-identity"
              title={
                railMode
                  ? `${fullName || me.adminUser.email} — ${t('appShell.profileMenu.profile')}`
                  : t('appShell.profileMenu.profile')
              }
              aria-label={t('appShell.profileMenu.profile')}
            >
              <div className="b2b-avatar">
                {(fullName || me.adminUser.email).slice(0, 2).toUpperCase()}
              </div>
              <div className="meta">
                <div className="name">{fullName || me.adminUser.email}</div>
                <div className="role">{role}</div>
              </div>
            </NavLink>
            <button
              type="button"
              className="icon-btn"
              title={t('appShell.profileMenu.signOut')}
              aria-label={t('appShell.profileMenu.signOut')}
              onClick={(): void => void logout()}
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : null}
        {!isMobile ? (
        <button
          type="button"
          className="b2b-sidebar__rail-toggle"
          onClick={toggleRailMode}
          title={
            railMode
              ? (t('appShell.sidebarToggle.expand') || 'Expand sidebar (⌘B)')
              : (t('appShell.sidebarToggle.collapse') || 'Collapse sidebar (⌘B)')
          }
          aria-label={
            railMode
              ? (t('appShell.sidebarToggle.expand') || 'Expand sidebar')
              : (t('appShell.sidebarToggle.collapse') || 'Collapse sidebar')
          }
          aria-pressed={railMode}
        >
          {railMode ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          {!railMode ? (
            <span className="b2b-sidebar__rail-toggle-label">
              {t('appShell.sidebarToggle.collapse') || 'Collapse'}
            </span>
          ) : null}
        </button>
        ) : null}
      </aside>

      {/* ============ Main column (topbar + content) ============ */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="b2b-topbar">
          {isMobile ? (
            <button
              type="button"
              className="b2b-topbar__menu-btn"
              aria-label={t('appShell.mobileMenu.open')}
              aria-expanded={navDrawerOpen}
              onClick={(): void => setNavDrawerOpen((open) => !open)}
            >
              <Menu size={20} />
            </button>
          ) : null}
          <div className={isCmsRoute ? 'b2b-topbar__crumbs-inner b2b-page b2b-page--wide' : 'b2b-topbar__crumbs'}>
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 ? <ChevronRight size={12} className="crumb-sep" /> : null}
                {c.href ? (
                  <NavLink
                    to={c.href}
                    className="crumb-link"
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {c.labelKey !== undefined ? t(c.labelKey) : c.literal}
                  </NavLink>
                ) : (
                  <span className="crumb-cur">
                    {c.labelKey !== undefined ? t(c.labelKey) : c.literal}
                  </span>
                )}
              </span>
            ))}
          </div>
          <div className="b2b-topbar__actions">
            <button
              type="button"
              className="b2b-topbar__icon-btn"
              title={t('appShell.search.openPalette')}
              aria-label={t('appShell.search.openPalette')}
              onClick={(): void => setPaletteOpen(true)}
            >
              <Search size={16} />
            </button>
            {/*
              Issue #112 — the bell is a surface like any other: it renders only
              where the operator holds the code its feed is gated on and the
              owning module is present. It used to render for every
              authenticated admin and poll every 30 s, so a restricted role got a
              permanent 403 and a deactivated `admin_notifications` a 503.
            */}
            {isModulePresent('admin_notifications') && hasPermission('admin:read') ? (
              <NotificationBell />
            ) : null}
            <button
              type="button"
              className="b2b-topbar__icon-btn b2b-topbar__hide-mobile"
              title={t('appShell.topbar.help')}
              aria-label={t('appShell.topbar.help')}
            >
              <HelpCircle size={16} />
            </button>
            <div style={{ width: 1, height: 22, background: 'var(--border-color)', margin: '0 4px' }} />
            {/*
              Feature 019 / FR-017 — language picker. Same backend round-trip
              as ProfilePage's language section, exposed inline so the user
              can switch the UI language from any screen without navigating.
            */}
            <LanguagePicker />
            {me ? (
              <NavLink
                to="/profile"
                className="b2b-avatar"
                title={`${fullName || me.adminUser.email} — ${t('appShell.profileMenu.profile')}`}
                aria-label={t('appShell.profileMenu.profile')}
                style={{ textDecoration: 'none', cursor: 'pointer' }}
              >
                {(fullName || me.adminUser.email).slice(0, 2).toUpperCase()}
              </NavLink>
            ) : null}
          </div>
        </div>
        <main className="b2b-main" style={{ flex: 1, overflow: 'auto' }}>
          <div className="b2b-impersonation-slot" data-impersonation-banner />
          <Outlet />
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={(): void => setPaletteOpen(false)}
        onNavigate={(to): void => {
          navigate(to);
          setPaletteOpen(false);
        }}
      />
    </div>
  );
}

/* ============================================================
   RailSection — icon-only sidebar entry with hover/click popover
   ============================================================
   When the sidebar is in rail mode, every NAV section renders as a
   single icon (the first visible item's icon). Hovering or clicking
   the icon reveals a popover with every visible item in the section,
   styled like a mini-version of the regular nav. Sections with one
   item collapse to a plain link with no popover.

   Hover-out has a small grace period so the cursor can travel from
   the icon to the popover without it disappearing. Click toggles the
   popover sticky-open; clicking elsewhere closes it. The active-route
   highlight propagates to the rail icon: if any item in the section
   matches the current URL, the icon shows the is-active style. */
interface RailSectionProps {
  section: NavSection;
  visibleItems: NavItem[];
  translatedLabel: string;
}

function RailSection(props: RailSectionProps): ReactNode {
  const { section, visibleItems, translatedLabel } = props;
  const t = useTranslation('core');
  const [hover, setHover] = useState(false);
  const [sticky, setSticky] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const open = hover || sticky;
  const location = useLocation();

  // Active-state for the rail icon: light up when ANY visible item in
  // the section matches the current URL (exact for the home route,
  // prefix-with-segment-boundary for everything else).
  const sectionActive = visibleItems.some((item) => {
    if (item.to === '/') return location.pathname === '/';
    return (
      location.pathname === item.to ||
      location.pathname.startsWith(`${item.to}/`)
    );
  });

  const cancelClose = useCallback((): void => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback((): void => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setHover(false), 120);
  }, [cancelClose]);

  // Click outside the wrapper closes the sticky popover.
  useEffect(() => {
    if (!sticky) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setSticky(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return (): void => window.removeEventListener('mousedown', onDown);
  }, [sticky]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  const railSource = visibleItems[0] ?? section.items[0];
  if (!railSource) return null;
  const RailIcon = railSource.icon;
  const headerLabel = translatedLabel || (visibleItems[0]?.labelKey ? t(visibleItems[0]!.labelKey) : '');

  // Single-item section: render a plain link with no popover. The
  // hover area is the link itself; tooltip carries the label.
  if (visibleItems.length === 1) {
    const only = visibleItems[0]!;
    const Icon = only.icon;
    const onlyLabel = t(only.labelKey);
    return (
      <div className="b2b-sidebar__rail-row">
        <NavLink
          to={only.to}
          end={only.to === '/'}
          className={({ isActive }): string =>
            cn('b2b-nav-item b2b-nav-item--rail', isActive && 'is-active')
          }
          title={onlyLabel}
          aria-label={onlyLabel}
        >
          <Icon size={18} />
        </NavLink>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="b2b-sidebar__rail-row"
      onMouseEnter={(): void => {
        cancelClose();
        setHover(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={cn(
          'b2b-nav-item b2b-nav-item--rail',
          sectionActive && 'is-active',
          open && 'is-open',
        )}
        onClick={(): void => setSticky((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={headerLabel}
        title={headerLabel}
      >
        <RailIcon size={18} />
      </button>
      {open ? (
        <div className="b2b-sidebar__rail-popover" role="menu">
          {headerLabel ? (
            <div className="b2b-sidebar__rail-popover-header">{headerLabel}</div>
          ) : null}
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const hasNestedSibling = visibleItems.some(
              (other) =>
                other !== item &&
                other.to.startsWith(item.to === '/' ? '/' : `${item.to}/`),
            );
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/' || hasNestedSibling}
                role="menuitem"
                className={({ isActive }): string =>
                  cn('b2b-sidebar__rail-popover-item', isActive && 'is-active')
                }
                onClick={(): void => {
                  setSticky(false);
                  setHover(false);
                }}
              >
                <Icon size={14} />
                <span>{t(item.labelKey)}</span>
              </NavLink>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (to: string) => void;
}

/** Sentinel route for the assistant entry row — switches the palette mode
 *  instead of navigating (feature 043; module_actions are navigation-only). */
const PROMPT_MODE_SENTINEL = '__prompt_actions_mode__';

/** Module-level capability cache: one fetch per session unless it failed. */
let promptCapabilityCache: 'ready' | 'unavailable' | null = null;

/** Test seam — interaction tests exercise multiple capability states. */
export function resetPromptCapabilityCacheForTesting(): void {
  promptCapabilityCache = null;
}

function CommandPalette(props: CommandPaletteProps): ReactNode {
  const { open, onClose, onNavigate } = props;
  const t = useTranslation('core');
  const tp = useTranslation('prompt_actions');
  const { hasPermission } = useAuth();
  const isVisible = useSurfaceVisibility();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<'search' | 'prompt'>('search');
  const [assistantReady, setAssistantReady] = useState(promptCapabilityCache === 'ready');
  const [unseen, setUnseen] = useState<PromptActionRequestDto[]>([]);
  const [initialRequest, setInitialRequest] = useState<PromptActionRequestDto | undefined>(
    undefined,
  );
  // Seed text carried into prompt mode by the `/ai <command>` palette shortcut.
  const [initialPrompt, setInitialPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { actions: registryActions } = useAdminActions(query);

  // Feature 043 — capability probe, only when the operator may use the
  // assistant. With the feature disabled/unconfigured (or the permission
  // missing) the palette renders exactly as before (FR-015/FR-020, SC-006).
  const mayUseAssistant = hasPermission('prompt_actions:use');
  useEffect(() => {
    if (!open || !mayUseAssistant || promptCapabilityCache !== null) return;
    void getPromptCapability()
      .then((cap) => {
        promptCapabilityCache = cap.status === 'ready' ? 'ready' : 'unavailable';
        setAssistantReady(promptCapabilityCache === 'ready');
      })
      .catch(() => {
        promptCapabilityCache = 'unavailable';
      });
  }, [open, mayUseAssistant]);

  // FR-018 — completion notice: prompts that finished while the palette was
  // closed surface on the next open until acknowledged.
  useEffect(() => {
    if (!open || !mayUseAssistant || !assistantReady) {
      setUnseen([]);
      return;
    }
    void listUnseenPromptRequests()
      .then(setUnseen)
      .catch(() => setUnseen([]));
  }, [open, mayUseAssistant, assistantReady]);

  // Map registry-supplied actions into the local PaletteItem shape so
  // the rendering loop stays uniform across Navigate (static) and
  // Actions (registry-driven) groups.
  const actionItems = useMemo<PaletteItem[]>(
    () =>
      registryActions.map((a) => ({
        group: 'Actions',
        labelMode: 'literal',
        label: a.label,
        sub: a.description ?? '',
        icon: resolveIcon(a.icon),
        to: a.targetRoute,
        // Carried for shape uniformity only: an Actions row is filtered by
        // `useAdminActions(query)` before it reaches this mapper, so nothing
        // below reads this field. Kept unfolded — `matchesQuery` normalises
        // its haystack at compare time, and a second, differently-normalised
        // copy of the same data is what issue #233 was about.
        keywords: a.keywords.join(' '),
      })),
    [registryActions],
  );

  // Feature 073 / FR-032 plus issue #230 — the Navigate group, filtered on both
  // axes by the same predicate the sidebar uses. The Actions group needs nothing
  // here: the server already resolves both axes for it.
  const navigateItems = useMemo<PaletteItem[]>(
    () => PALETTE_ITEMS.filter(isVisible),
    [isVisible],
  );

  // Build a derived view that translates Navigate-group keys at render
  // time and leaves the registry-supplied Actions strings untouched.
  const resolveLabel = (it: PaletteItem): string =>
    it.labelMode === 'key' ? t(it.label) : it.label;
  const resolveSub = (it: PaletteItem): string =>
    it.labelMode === 'key' ? t(it.sub) : it.sub;

  // Feature 043 — pinned assistant entry (only when enabled + configured +
  // permitted). Always listed first; matched generously while typing.
  const assistantItems = useMemo<PaletteItem[]>(() => {
    if (!mayUseAssistant || !assistantReady) return [];
    return [
      {
        group: 'Assistant',
        labelMode: 'literal',
        label: tp('palette.entry.label'),
        sub: tp('palette.entry.description'),
        icon: Sparkles,
        to: PROMPT_MODE_SENTINEL,
        keywords: 'assistant ai prompt ask asystent zapytaj',
      },
    ];
  }, [mayUseAssistant, assistantReady, tp]);

  const items = useMemo(() => {
    if (!query.trim()) return [...assistantItems, ...navigateItems, ...actionItems];
    // Folded once here, then compared against every row — see `matchesQuery`.
    const q = normalize(query);
    const filteredAssistant = assistantItems.filter((i) =>
      matchesQuery(q, i.label, i.sub, i.keywords),
    );
    // Navigate group: filter against the *translated* label + sub plus
    // the raw keywords list so a Polish user can search in Polish and
    // an English user in English.
    const filteredNav = navigateItems.filter((i) =>
      matchesQuery(q, resolveLabel(i), resolveSub(i), i.keywords),
    );
    return [...filteredAssistant, ...filteredNav, ...actionItems];
    // `resolveLabel` / `resolveSub` are render-scoped closures over `t`; the
    // list re-derives on every language change through the parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, actionItems, assistantItems, navigateItems]);

  // Activating the assistant row switches the palette body instead of
  // navigating (feature 043); everything else keeps the navigation path.
  const activate = useCallback(
    (to: string): void => {
      if (to === PROMPT_MODE_SENTINEL) {
        setInitialPrompt('');
        setMode('prompt');
        return;
      }
      onNavigate(to);
    },
    [onNavigate],
  );

  // `/ai` shortcut: typing `/ai` (optionally followed by a command) in the
  // palette input launches prompt mode directly, carrying any typed command
  // into the assistant input — equivalent to opening "Ask the assistant" and
  // typing it. Only intercepts when the assistant is actually usable.
  const handleQueryChange = useCallback(
    (value: string): void => {
      const match = /^\/ai(?:\s+(.*))?$/i.exec(value);
      if (match && mayUseAssistant && assistantReady) {
        setQuery('');
        setInitialPrompt(match[1] ?? '');
        setMode('prompt');
        return;
      }
      setQuery(value);
    },
    [mayUseAssistant, assistantReady],
  );

  useEffect(() => {
    setCursor(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setMode('search');
      setInitialRequest(undefined);
      setInitialPrompt('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (mode === 'prompt') {
      // Prompt mode owns its own inputs; only Esc is handled here — it
      // returns to the classic palette rather than closing (research §R9).
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setMode('search');
        }
      };
      window.addEventListener('keydown', onKey);
      return (): void => window.removeEventListener('keydown', onKey);
    }
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(items.length - 1, c + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[cursor];
        if (it) activate(it.to);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [open, mode, items, cursor, onClose, activate]);

  if (!open) return null;

  if (mode === 'prompt') {
    return (
      <>
        <div className="b2b-scrim" onClick={onClose} />
        <div className="b2b-palette" role="dialog" aria-modal="true">
          <PromptModePanel
            onExit={(): void => {
              setInitialRequest(undefined);
              setInitialPrompt('');
              setMode('search');
            }}
            {...(initialRequest ? { initialRequest } : {})}
            {...(initialPrompt ? { initialPrompt } : {})}
          />
        </div>
      </>
    );
  }

  let lastGroup = '';
  return (
    <>
      <div className="b2b-scrim" onClick={onClose} />
      <div className="b2b-palette" role="dialog" aria-modal="true">
        <div className="b2b-palette__input">
          <Search size={18} style={{ color: 'var(--fg-muted)' }} />
          <input
            ref={inputRef}
            placeholder={t('appShell.search.commandPalettePlaceholder')}
            value={query}
            onChange={(e): void => handleQueryChange(e.target.value)}
          />
          <SpeechToTextButton
            startTitle={t('appShell.search.voiceInput')}
            stopTitle={t('appShell.search.voiceInputStop')}
            onTranscript={(text): void => {
              setQuery((q) => (q ? `${q} ${text}` : text));
              inputRef.current?.focus();
            }}
          />
          <span className="b2b-kbd-sm">esc</span>
        </div>
        <div className="b2b-palette__list">
          {unseen.length > 0 ? (
            <div
              data-testid="prompt-unseen-notice"
              className="b2b-palette__item"
              style={{ cursor: 'pointer' }}
              onClick={(): void => {
                setInitialRequest(unseen[0]);
                setUnseen((u) => u.slice(1));
                setMode('prompt');
              }}
            >
              <Sparkles size={16} />
              <div>
                <div>{tp('panel.unseenNotice')}</div>
              </div>
            </div>
          ) : null}
          {items.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
              {t('appShell.search.noMatches')}
            </div>
          ) : (
            items.map((it, i) => {
              const showGroup = it.group !== lastGroup;
              lastGroup = it.group;
              const Icon = it.icon;
              const groupHeader =
                it.group === 'Navigate'
                  ? t('appShell.palette.group.navigate')
                  : it.group === 'Assistant'
                    ? tp('palette.group.label')
                    : t('appShell.palette.group.actions');
              const label = resolveLabel(it);
              const sub = resolveSub(it);
              return (
                <div key={`${it.group}-${it.label}`}>
                  {showGroup ? <div className="b2b-palette__group">{groupHeader}</div> : null}
                  <div
                    className={cn('b2b-palette__item', i === cursor && 'is-cur')}
                    onMouseEnter={(): void => setCursor(i)}
                    onClick={(): void => activate(it.to)}
                  >
                    <Icon size={16} />
                    <div>
                      <div>{label}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{sub}</div>
                    </div>
                    <span className="meta">{i === cursor ? <span className="b2b-kbd-sm">↵</span> : null}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
