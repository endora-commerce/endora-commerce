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
  Code2,
  CreditCard,
  Bell as BellOutline,
  Box,
  Factory,
  FileText,
  HelpCircle,
  Home as HomeIcon,
  Image as ImageIcon,
  Menu,
  KeyRound,
  Languages,
  LayoutDashboard,
  LineChart,
  ListChecks,
  LogOut,
  Newspaper,
  Package,
  PackageOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PercentDiamond,
  Receipt,
  Scale,
  Search,
  Settings,
  Eraser,
  ShieldCheck,
  Store,
  Tag,
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
import { resolveIcon } from '@/lib/admin-actions/icon-map';

interface NavItem {
  to: string;
  /**
   * Translation key under the `core` scope. Resolved at render time so
   * the label flips when the admin changes preferred language.
   */
  labelKey: string;
  icon: LucideIcon;
  /**
   * Optional permission code that gates the entry's visibility. When
   * unset, the entry renders for every authenticated admin. When set,
   * the entry is hidden unless `useAuth().hasPermission(code)` returns
   * true (the wildcard `*` permission held by `platform_admin`
   * satisfies every code).
   */
  requiredPermission?: string;
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
      { to: '/', labelKey: 'appShell.nav.home', icon: LayoutDashboard },
    ],
  },
  {
    key: 'sales',
    labelKey: 'appShell.section.sales',
    items: [
      { to: '/orders', labelKey: 'appShell.nav.orders', icon: ClipboardCheck },
      { to: '/orders/new', labelKey: 'appShell.nav.newOrder', icon: ClipboardCheck },
      { to: '/orders/quick-order', labelKey: 'appShell.nav.quickOrder', icon: ClipboardCheck },
      { to: '/orders/statuses', labelKey: 'appShell.nav.orderStatuses', icon: ClipboardCheck },
      { to: '/quote-requests', labelKey: 'appShell.nav.quoteRequests', icon: FileText },
      { to: '/invoices', labelKey: 'appShell.nav.invoices', icon: Receipt },
    ],
  },
  {
    key: 'catalog',
    labelKey: 'appShell.section.catalog',
    items: [
      { to: '/catalog/products', labelKey: 'appShell.nav.products', icon: Package },
      { to: '/catalog/categories', labelKey: 'appShell.nav.categories', icon: Boxes },
      { to: '/catalog/attributes', labelKey: 'appShell.nav.attributes', icon: Tag },
      { to: '/catalog/attribute-sets', labelKey: 'appShell.nav.attributeSets', icon: Tag },
      { to: '/catalog/attachment-types', labelKey: 'appShell.nav.attachmentTypes', icon: FileText },
      {
        to: '/assets-library',
        labelKey: 'appShell.nav.assetsLibrary',
        icon: ImageIcon,
        requiredPermission: 'assets.read',
      },
    ],
  },
  {
    key: 'inventory',
    labelKey: 'appShell.section.inventory',
    items: [
      { to: '/inventory', labelKey: 'appShell.nav.stockOverview', icon: Box },
      { to: '/warehouses', labelKey: 'appShell.nav.warehouses', icon: WarehouseIcon },
      { to: '/inventory/low-stock', labelKey: 'appShell.nav.lowStock', icon: TrendingDown },
      { to: '/inventory/notifications', labelKey: 'appShell.nav.notifyWhenAvailable', icon: BellOutline },
      { to: '/inventory/import', labelKey: 'appShell.nav.importStock', icon: PackageOpen },
    ],
  },
  {
    key: 'pricing',
    labelKey: 'appShell.section.pricing',
    items: [
      { to: '/price-lists', labelKey: 'appShell.nav.priceLists', icon: CircleDollarSign },
      { to: '/promotions', labelKey: 'appShell.nav.promotions', icon: PercentDiamond },
      { to: '/taxes', labelKey: 'appShell.nav.taxes', icon: Receipt },
      { to: '/delivery-methods', labelKey: 'appShell.nav.deliveryMethods', icon: Truck },
      { to: '/payment-methods', labelKey: 'appShell.nav.paymentMethods', icon: CreditCard },
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
      },
      {
        to: '/customers/online',
        labelKey: 'appShell.nav.customersOnline',
        icon: Users,
        requiredPermission: 'customers:read',
      },
      {
        to: '/organizations',
        labelKey: 'appShell.nav.organizations',
        icon: Building2,
        requiredPermission: 'customers:read',
      },
      { to: '/credit-limits', labelKey: 'appShell.nav.creditLimits', icon: CreditCard },
      {
        to: '/comparisons',
        labelKey: 'appShell.nav.comparisons',
        icon: Scale,
        requiredPermission: 'comparisons:read',
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
      },
      { to: '/dictionary', labelKey: 'appShell.nav.dictionary', icon: Languages, requiredPermission: 'dictionary.write' },
      { to: '/admin/dictionaries/audit', labelKey: 'appShell.nav.dictionaryAudit', icon: ListChecks, requiredPermission: 'dictionary.write' },
      { to: '/seo', labelKey: 'appShell.nav.seo', icon: Search },
    ],
  },
  {
    key: 'content',
    labelKey: 'appShell.section.content',
    items: [
      { to: '/cms/pages', labelKey: 'appShell.nav.cmsPages', icon: Newspaper, requiredPermission: 'cms.read' },
      { to: '/cms/blocks', labelKey: 'appShell.nav.cmsBlocks', icon: Newspaper, requiredPermission: 'cms.read' },
      { to: '/cms/templates', labelKey: 'appShell.nav.cmsTemplates', icon: Newspaper, requiredPermission: 'cms.read' },
      { to: '/cms/hooks', labelKey: 'appShell.nav.cmsHooks', icon: Webhook, requiredPermission: 'cms.read' },
      {
        to: '/megamenu',
        labelKey: 'appShell.nav.megamenu',
        icon: Newspaper,
        requiredPermission: 'megamenu.read',
      },
      { to: '/blog/posts', labelKey: 'appShell.nav.blogPosts', icon: Newspaper, requiredPermission: 'blog.read' },
      { to: '/blog/categories', labelKey: 'appShell.nav.blogCategories', icon: Newspaper, requiredPermission: 'blog.read' },
      { to: '/blog/tags', labelKey: 'appShell.nav.blogTags', icon: Newspaper, requiredPermission: 'blog.read' },
    ],
  },
  {
    key: 'system',
    labelKey: 'appShell.section.system',
    items: [
      { to: '/admin-users', labelKey: 'appShell.nav.users', icon: Users },
      { to: '/admin-roles', labelKey: 'appShell.nav.roles', icon: ShieldCheck },
      // Bulk operations may span many domains (not just products), so the
      // entry lives under System. The URL stays `/catalog/bulk-operations`
      // to keep existing deep-links (e.g. the bulk-edit "queued" ack) valid.
      {
        to: '/catalog/bulk-operations',
        labelKey: 'appShell.nav.bulkOperations',
        icon: ListChecks,
        requiredPermission: 'catalog:read',
      },
      { to: '/audit-log', labelKey: 'appShell.nav.auditLog', icon: ListChecks },
      { to: '/api-keys', labelKey: 'appShell.nav.apiKeys', icon: KeyRound },
      { to: '/webhooks', labelKey: 'appShell.nav.webhooks', icon: Webhook },
      { to: '/integrations', labelKey: 'appShell.nav.integrations', icon: Code2 },
      {
        to: '/analytics',
        labelKey: 'appShell.nav.analytics',
        icon: LineChart,
        requiredPermission: 'analytics:read',
      },
      { to: '/import-export', labelKey: 'appShell.nav.importExport', icon: Upload },
      {
        to: '/settings',
        labelKey: 'appShell.nav.settings',
        icon: Settings,
        requiredPermission: 'settings:read',
      },
      {
        to: '/settings/groups',
        labelKey: 'appShell.nav.settingGroups',
        icon: Settings,
        requiredPermission: 'settings:read',
      },
      {
        to: '/settings/cache',
        labelKey: 'appShell.nav.cache',
        icon: Eraser,
        requiredPermission: 'settings:write',
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
  { test: /^\/orders\/[^/]+\/?$/, build: () => [
    { labelKey: 'appShell.nav.orders', href: '/orders' },
    { labelKey: 'appShell.crumb.detail', href: null },
  ] },
  { test: /^\/invoices\/?$/, build: () => [
    { labelKey: 'appShell.section.customers', href: '/organizations' },
    { labelKey: 'appShell.nav.invoices', href: null },
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
  { test: /^\/integrations\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.integrations', href: null },
  ] },
  { test: /^\/analytics\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.analytics', href: null },
  ] },
  { test: /^\/import-export\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.importExport', href: null },
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
];

function buildCrumbs(pathname: string): Crumb[] {
  for (const entry of CRUMB_DICT) {
    const match = pathname.match(entry.test);
    if (match) return entry.build(match);
  }
  const segments = pathname.split('/').filter(Boolean).map((s) => s.replace('-', ' '));
  return segments.map((literal, idx) => ({
    literal,
    href: idx === segments.length - 1 ? null : '/' + segments.slice(0, idx + 1).join('/'),
  }));
}

interface PaletteItem {
  group: 'Navigate' | 'Actions';
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
}

const PALETTE_ITEMS: PaletteItem[] = [
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.home', sub: 'appShell.palette.sub.dashboard', icon: HomeIcon, to: '/', keywords: 'home dashboard strona główna pulpit' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.products', sub: 'appShell.palette.sub.catalogRows', icon: Package, to: '/catalog/products', keywords: 'products catalog items produkty katalog' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.stockOverview', sub: 'appShell.palette.sub.stockLevels', icon: Factory, to: '/inventory', keywords: 'inventory stock warehouse magazyn stany' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.priceLists', sub: 'appShell.palette.sub.pricingRules', icon: CircleDollarSign, to: '/price-lists', keywords: 'pricing prices price list cennik' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.organizations', sub: 'appShell.palette.sub.customerAccounts', icon: Building2, to: '/organizations', keywords: 'org orgs customer organization organizacja klient' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.orders', sub: 'appShell.palette.sub.openOrders', icon: ClipboardCheck, to: '/orders', keywords: 'orders sales zamówienia sprzedaż' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.quoteRequests', sub: 'appShell.palette.sub.customerRfqs', icon: FileText, to: '/quote-requests', keywords: 'rfq quote zapytanie ofertowe' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.comparisons', sub: 'appShell.palette.sub.compareAudit', icon: Scale, to: '/comparisons', keywords: 'compare comparisons porównanie' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.categories', sub: 'appShell.palette.sub.categoryTree', icon: Boxes, to: '/catalog/categories', keywords: 'category categories tree kategorie' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.attributes', sub: 'appShell.palette.sub.attributeDefinitions', icon: Tag, to: '/catalog/attributes', keywords: 'attribute attributes atrybuty' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.salesChannels', sub: 'appShell.palette.sub.storefrontChannels', icon: Store, to: '/sales-channels', keywords: 'sales channel channels kanał sprzedaży' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.dictionary', sub: 'appShell.palette.sub.dictionary', icon: Languages, to: '/dictionary', keywords: 'dictionary countries currencies languages i18n słownik kraje waluty języki' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.dictionaryAudit', sub: 'appShell.palette.sub.dictionaryAudit', icon: ListChecks, to: '/admin/dictionaries/audit', keywords: 'dictionary audit orphan references audyt słownika' },
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.settings', sub: 'appShell.palette.sub.platformConfiguration', icon: Settings, to: '/settings', keywords: 'settings configuration config ustawienia konfiguracja' },
  // Feature 020 — the Actions group is now sourced from the module
  // registry via useAdminActions(); the previously-hardcoded "New
  // product" and "Import products" entries are declared by the
  // catalog and import_export module manifests respectively.
];

export function AppShell(): ReactNode {
  const { me, logout, hasPermission } = useAuth();
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
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
          <span className="b2b-sidebar__brand-logo">B2</span>
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
            // Permission-gate every entry. Sections with no remaining
            // visible items fold away entirely so the sidebar stays
            // readable for restricted admins.
            const visibleItems = section.items.filter(
              (item) =>
                !item.requiredPermission || hasPermission(item.requiredPermission),
            );
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
          <div className="b2b-topbar__crumbs">
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
            <NotificationBell />
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

function CommandPalette(props: CommandPaletteProps): ReactNode {
  const { open, onClose, onNavigate } = props;
  const t = useTranslation('core');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { actions: registryActions } = useAdminActions(query);

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
        // Keywords are already pre-normalized by the registry; we keep
        // them on the item so the navigate-group filter below can hit
        // them via includes(). Lowercased for the existing filter.
        keywords: a.keywords.join(' ').toLowerCase(),
      })),
    [registryActions],
  );

  // Build a derived view that translates Navigate-group keys at render
  // time and leaves the registry-supplied Actions strings untouched.
  const resolveLabel = (it: PaletteItem): string =>
    it.labelMode === 'key' ? t(it.label) : it.label;
  const resolveSub = (it: PaletteItem): string =>
    it.labelMode === 'key' ? t(it.sub) : it.sub;

  const items = useMemo(() => {
    if (!query.trim()) return [...PALETTE_ITEMS, ...actionItems];
    const q = query.toLowerCase();
    // Navigate group: filter against the *translated* label + sub plus
    // the raw keywords list so a Polish user can search in Polish and
    // an English user in English.
    const filteredNav = PALETTE_ITEMS.filter((i) => {
      const label = resolveLabel(i).toLowerCase();
      const sub = resolveSub(i).toLowerCase();
      return label.includes(q) || sub.includes(q) || i.keywords.includes(q);
    });
    return [...filteredNav, ...actionItems];
  }, [query, actionItems]);

  useEffect(() => {
    setCursor(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
        if (it) onNavigate(it.to);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [open, items, cursor, onClose, onNavigate]);

  if (!open) return null;

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
            onChange={(e): void => setQuery(e.target.value)}
          />
          <span className="b2b-kbd-sm">esc</span>
        </div>
        <div className="b2b-palette__list">
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
                  : t('appShell.palette.group.actions');
              const label = resolveLabel(it);
              const sub = resolveSub(it);
              return (
                <div key={`${it.group}-${it.label}`}>
                  {showGroup ? <div className="b2b-palette__group">{groupHeader}</div> : null}
                  <div
                    className={cn('b2b-palette__item', i === cursor && 'is-cur')}
                    onMouseEnter={(): void => setCursor(i)}
                    onClick={(): void => onNavigate(it.to)}
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
