import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
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
import { useAdminActions } from '@/lib/admin-actions/useAdminActions';
import { resolveIcon } from '@/lib/admin-actions/icon-map';

interface NavItem {
  to: string;
  label: string;
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
  /** Empty string = no group label (rendered flat). */
  label: string;
  items: NavItem[];
}

/* Design-aligned navigation. The "Home" + "Orders" cluster sits above
 * the first labelled group exactly as the prototype shows. */
const NAV: NavSection[] = [
  {
    key: 'main',
    label: '',
    items: [
      { to: '/', label: 'Home', icon: LayoutDashboard },
    ],
  },
  {
    key: 'sales',
    label: 'Sales',
    items: [
      { to: '/orders', label: 'Orders', icon: ClipboardCheck },
      { to: '/quote-requests', label: 'Quote requests', icon: FileText },
      { to: '/invoices', label: 'Invoices', icon: Receipt },
    ],
  },
  {
    key: 'catalog',
    label: 'Catalog',
    items: [
      { to: '/catalog/products', label: 'Products', icon: Package },
      { to: '/catalog/categories', label: 'Categories', icon: Boxes },
      { to: '/catalog/attributes', label: 'Attributes', icon: Tag },
      { to: '/catalog/attribute-sets', label: 'Attribute Sets', icon: Tag },
      { to: '/catalog/attachment-types', label: 'Attachment Types', icon: FileText },
      { to: '/assets-library', label: 'Assets Library', icon: ImageIcon },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    items: [
      { to: '/inventory', label: 'Stock overview', icon: Box },
      { to: '/warehouses', label: 'Warehouses', icon: WarehouseIcon },
      { to: '/inventory/low-stock', label: 'Low stock', icon: TrendingDown },
      { to: '/inventory/notifications', label: 'Notify-when-available', icon: BellOutline },
      { to: '/inventory/import', label: 'Import stock', icon: PackageOpen },
    ],
  },
  {
    key: 'pricing',
    label: 'Pricing',
    items: [
      { to: '/price-lists', label: 'Price lists', icon: CircleDollarSign },
      { to: '/promotions', label: 'Promotions', icon: PercentDiamond },
      { to: '/taxes', label: 'Taxes', icon: Receipt },
      { to: '/delivery-methods', label: 'Delivery methods', icon: Truck },
      { to: '/payment-methods', label: 'Payment methods', icon: CreditCard },
    ],
  },
  {
    key: 'customers',
    label: 'Customers',
    items: [
      { to: '/organizations', label: 'Organizations', icon: Building2 },
      { to: '/credit-limits', label: 'Credit limits', icon: CreditCard },
      { to: '/comparisons', label: 'Comparisons', icon: Scale },
    ],
  },
  {
    key: 'channels',
    label: 'Channels',
    items: [
      { to: '/sales-channels', label: 'Sales channels', icon: Store },
      { to: '/dictionary', label: 'Dictionary', icon: Languages, requiredPermission: 'dictionary.write' },
      { to: '/admin/dictionaries/audit', label: 'Dictionary audit', icon: ListChecks, requiredPermission: 'dictionary.write' },
      { to: '/seo', label: 'SEO', icon: Search },
    ],
  },
  {
    key: 'content',
    label: 'Content',
    items: [
      { to: '/cms/pages', label: 'CMS Pages', icon: Newspaper, requiredPermission: 'cms.read' },
      { to: '/cms/blocks', label: 'CMS Blocks', icon: Newspaper, requiredPermission: 'cms.read' },
      { to: '/cms/templates', label: 'CMS Templates', icon: Newspaper, requiredPermission: 'cms.read' },
      { to: '/cms/hooks', label: 'CMS Hooks', icon: Webhook, requiredPermission: 'cms.read' },
      { to: '/megamenu', label: 'Megamenu', icon: Newspaper },
      { to: '/blog/posts', label: 'Blog Posts', icon: Newspaper, requiredPermission: 'blog.read' },
      { to: '/blog/categories', label: 'Blog Categories', icon: Newspaper, requiredPermission: 'blog.read' },
      { to: '/blog/tags', label: 'Blog Tags', icon: Newspaper, requiredPermission: 'blog.read' },
    ],
  },
  {
    key: 'system',
    label: 'System',
    items: [
      { to: '/admin-users', label: 'Users', icon: Users },
      { to: '/admin-roles', label: 'Roles', icon: ShieldCheck },
      { to: '/audit-log', label: 'Audit log', icon: ListChecks },
      { to: '/api-keys', label: 'API keys', icon: KeyRound },
      { to: '/webhooks', label: 'Webhooks', icon: Webhook },
      { to: '/integrations', label: 'Integrations', icon: Code2 },
      { to: '/analytics', label: 'Analytics', icon: LineChart },
      { to: '/import-export', label: 'Import / Export', icon: Upload },
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/settings/groups', label: 'Setting groups', icon: Settings },
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
type Crumb = { label: string; href: string | null };

const CRUMB_DICT: Array<{ test: RegExp; build: (m: RegExpMatchArray) => Crumb[] }> = [
  { test: /^\/$/, build: () => [{ label: 'Home', href: null }] },
  { test: /^\/catalog\/products\/?$/, build: () => [
    { label: 'Catalog', href: '/catalog/products' },
    { label: 'Products', href: null },
  ] },
  { test: /^\/catalog\/products\/[^/]+\/?$/, build: () => [
    { label: 'Catalog', href: '/catalog/products' },
    { label: 'Products', href: '/catalog/products' },
    { label: 'Editor', href: null },
  ] },
  { test: /^\/catalog\/categories\/?$/, build: () => [
    { label: 'Catalog', href: '/catalog/products' },
    { label: 'Categories', href: null },
  ] },
  { test: /^\/catalog\/attributes\/?$/, build: () => [
    { label: 'Catalog', href: '/catalog/products' },
    { label: 'Attributes', href: null },
  ] },
  { test: /^\/catalog\/attribute-sets\/?$/, build: () => [
    { label: 'Catalog', href: '/catalog/products' },
    { label: 'Attribute Sets', href: null },
  ] },
  { test: /^\/catalog\/attachment-types\/?$/, build: () => [
    { label: 'Catalog', href: '/catalog/products' },
    { label: 'Attachment Types', href: null },
  ] },
  { test: /^\/assets-library\/?$/, build: () => [
    { label: 'Catalog', href: '/catalog/products' },
    { label: 'Assets Library', href: null },
  ] },
  { test: /^\/inventory\/?$/, build: () => [
    { label: 'Inventory', href: null },
  ] },
  { test: /^\/inventory\/low-stock\/?$/, build: () => [
    { label: 'Inventory', href: '/inventory' },
    { label: 'Low stock', href: null },
  ] },
  { test: /^\/inventory\/notifications\/?$/, build: () => [
    { label: 'Inventory', href: '/inventory' },
    { label: 'Notify-when-available', href: null },
  ] },
  { test: /^\/inventory\/import\/?$/, build: () => [
    { label: 'Inventory', href: '/inventory' },
    { label: 'Import stock', href: null },
  ] },
  { test: /^\/warehouses\/?$/, build: () => [
    { label: 'Inventory', href: '/inventory' },
    { label: 'Warehouses', href: null },
  ] },
  { test: /^\/warehouses\/new\/?$/, build: () => [
    { label: 'Inventory', href: '/inventory' },
    { label: 'Warehouses', href: '/warehouses' },
    { label: 'New', href: null },
  ] },
  { test: /^\/warehouses\/[^/]+\/?$/, build: () => [
    { label: 'Inventory', href: '/inventory' },
    { label: 'Warehouses', href: '/warehouses' },
    { label: 'Edit', href: null },
  ] },
  { test: /^\/price-lists\/?$/, build: () => [
    { label: 'Pricing', href: '/price-lists' },
    { label: 'Price lists', href: null },
  ] },
  { test: /^\/price-lists\/[^/]+\/?$/, build: () => [
    { label: 'Pricing', href: '/price-lists' },
    { label: 'Price lists', href: '/price-lists' },
    { label: 'Detail', href: null },
  ] },
  { test: /^\/promotions\/?$/, build: () => [
    { label: 'Pricing', href: '/price-lists' },
    { label: 'Promotions', href: null },
  ] },
  { test: /^\/taxes\/?$/, build: () => [
    { label: 'Pricing', href: '/price-lists' },
    { label: 'Taxes', href: null },
  ] },
  { test: /^\/delivery-methods\/?$/, build: () => [
    { label: 'Pricing', href: '/price-lists' },
    { label: 'Delivery methods', href: null },
  ] },
  { test: /^\/payment-methods\/?$/, build: () => [
    { label: 'Pricing', href: '/price-lists' },
    { label: 'Payment methods', href: null },
  ] },
  { test: /^\/organizations\/?$/, build: () => [
    { label: 'Customers', href: '/organizations' },
    { label: 'Organizations', href: null },
  ] },
  { test: /^\/organizations\/[^/]+\/?$/, build: () => [
    { label: 'Customers', href: '/organizations' },
    { label: 'Organizations', href: '/organizations' },
    { label: 'Detail', href: null },
  ] },
  { test: /^\/orders\/?$/, build: () => [{ label: 'Orders', href: null }] },
  { test: /^\/orders\/[^/]+\/?$/, build: () => [
    { label: 'Orders', href: '/orders' },
    { label: 'Detail', href: null },
  ] },
  { test: /^\/invoices\/?$/, build: () => [
    { label: 'Customers', href: '/organizations' },
    { label: 'Invoices', href: null },
  ] },
  { test: /^\/credit-limits\/?$/, build: () => [
    { label: 'Customers', href: '/organizations' },
    { label: 'Credit limits', href: null },
  ] },
  { test: /^\/quote-requests\/?$/, build: () => [
    { label: 'Customers', href: '/organizations' },
    { label: 'Quote requests', href: null },
  ] },
  { test: /^\/quote-requests\/[^/]+\/?$/, build: () => [
    { label: 'Customers', href: '/organizations' },
    { label: 'Quote requests', href: '/quote-requests' },
    { label: 'Detail', href: null },
  ] },
  { test: /^\/comparisons\/?$/, build: () => [
    { label: 'Customers', href: '/organizations' },
    { label: 'Comparisons', href: null },
  ] },
  { test: /^\/comparisons\/[^/]+\/?$/, build: () => [
    { label: 'Customers', href: '/organizations' },
    { label: 'Comparisons', href: '/comparisons' },
    { label: 'Detail', href: null },
  ] },
  { test: /^\/sales-channels\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'Sales channels', href: null },
  ] },
  { test: /^\/sales-channels\/[^/]+\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'Sales channels', href: '/sales-channels' },
    { label: 'Detail', href: null },
  ] },
  { test: /^\/cms(?:\/pages)?\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'CMS Pages', href: null },
  ] },
  { test: /^\/cms\/pages\/(?:new|[^/]+)\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'CMS Pages', href: '/cms/pages' },
    { label: 'Editor', href: null },
  ] },
  { test: /^\/cms\/blocks\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'CMS Blocks', href: null },
  ] },
  { test: /^\/cms\/blocks\/(?:new|[^/]+)\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'CMS Blocks', href: '/cms/blocks' },
    { label: 'Editor', href: null },
  ] },
  { test: /^\/cms\/templates\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'CMS Templates', href: null },
  ] },
  { test: /^\/cms\/templates\/(?:new|[^/]+)\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'CMS Templates', href: '/cms/templates' },
    { label: 'Editor', href: null },
  ] },
  { test: /^\/cms\/hooks\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'CMS Hooks', href: null },
  ] },
  { test: /^\/megamenu\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'Megamenu', href: null },
  ] },
  { test: /^\/megamenu\/[^/]+\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'Megamenu', href: '/megamenu' },
    { label: 'Editor', href: null },
  ] },
  { test: /^\/dictionary\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'Dictionary', href: null },
  ] },
  { test: /^\/(?:admin\/)?dictionaries\/audit\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'Dictionary', href: '/dictionary' },
    { label: 'Audit', href: null },
  ] },
  { test: /^\/seo\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'SEO', href: null },
  ] },
  { test: /^\/admin-users\/?$/, build: () => [
    { label: 'System', href: '/admin-users' },
    { label: 'Users', href: null },
  ] },
  { test: /^\/admin-roles\/?$/, build: () => [
    { label: 'System', href: '/admin-users' },
    { label: 'Roles', href: null },
  ] },
  { test: /^\/audit-log\/?$/, build: () => [
    { label: 'System', href: '/admin-users' },
    { label: 'Audit log', href: null },
  ] },
  { test: /^\/api-keys\/?$/, build: () => [
    { label: 'System', href: '/admin-users' },
    { label: 'API keys', href: null },
  ] },
  { test: /^\/webhooks\/?$/, build: () => [
    { label: 'System', href: '/admin-users' },
    { label: 'Webhooks', href: null },
  ] },
  { test: /^\/integrations\/?$/, build: () => [
    { label: 'System', href: '/admin-users' },
    { label: 'Integrations', href: null },
  ] },
  { test: /^\/analytics\/?$/, build: () => [
    { label: 'System', href: '/admin-users' },
    { label: 'Analytics', href: null },
  ] },
  { test: /^\/import-export\/?$/, build: () => [
    { label: 'System', href: '/admin-users' },
    { label: 'Import / Export', href: null },
  ] },
  { test: /^\/settings\/?$/, build: () => [
    { label: 'System', href: '/admin-users' },
    { label: 'Settings', href: null },
  ] },
  { test: /^\/settings\/groups\/?$/, build: () => [
    { label: 'System', href: '/admin-users' },
    { label: 'Setting groups', href: null },
  ] },
  { test: /^\/profile\/?$/, build: () => [
    { label: 'My profile', href: null },
  ] },
];

function buildCrumbs(pathname: string): Crumb[] {
  for (const entry of CRUMB_DICT) {
    const match = pathname.match(entry.test);
    if (match) return entry.build(match);
  }
  const segments = pathname.split('/').filter(Boolean).map((s) => s.replace('-', ' '));
  return segments.map((label, idx) => ({
    label,
    href: idx === segments.length - 1 ? null : '/' + segments.slice(0, idx + 1).join('/'),
  }));
}

interface PaletteItem {
  group: 'Navigate' | 'Actions';
  label: string;
  sub: string;
  icon: LucideIcon;
  to: string;
  keywords: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  { group: 'Navigate', label: 'Home', sub: 'Dashboard', icon: HomeIcon, to: '/', keywords: 'home dashboard' },
  { group: 'Navigate', label: 'Products', sub: 'Catalog rows', icon: Package, to: '/catalog/products', keywords: 'products catalog items' },
  { group: 'Navigate', label: 'Inventory', sub: 'Stock levels per warehouse', icon: Factory, to: '/inventory', keywords: 'inventory stock warehouse' },
  { group: 'Navigate', label: 'Price lists', sub: 'Pricing rules + assignments', icon: CircleDollarSign, to: '/price-lists', keywords: 'pricing prices price list' },
  { group: 'Navigate', label: 'Organizations', sub: 'Customer accounts', icon: Building2, to: '/organizations', keywords: 'org orgs customer organization' },
  { group: 'Navigate', label: 'Orders', sub: 'Open and recent orders', icon: ClipboardCheck, to: '/orders', keywords: 'orders sales' },
  { group: 'Navigate', label: 'Quote requests', sub: 'Customer RFQs', icon: FileText, to: '/quote-requests', keywords: 'rfq quote' },
  { group: 'Navigate', label: 'Comparisons', sub: 'Compare-feature audit', icon: Scale, to: '/comparisons', keywords: 'compare comparisons' },
  { group: 'Navigate', label: 'Categories', sub: 'Tree of catalog categories', icon: Boxes, to: '/catalog/categories', keywords: 'category categories tree' },
  { group: 'Navigate', label: 'Attributes', sub: 'Attribute definitions', icon: Tag, to: '/catalog/attributes', keywords: 'attribute attributes' },
  { group: 'Navigate', label: 'Sales channels', sub: 'Storefront channels', icon: Store, to: '/sales-channels', keywords: 'sales channel channels' },
  { group: 'Navigate', label: 'Dictionary', sub: 'Countries currencies languages', icon: Languages, to: '/dictionary', keywords: 'dictionary countries currencies languages i18n' },
  { group: 'Navigate', label: 'Dictionary audit', sub: 'Unresolved registry references', icon: ListChecks, to: '/admin/dictionaries/audit', keywords: 'dictionary audit orphan references' },
  { group: 'Navigate', label: 'Settings', sub: 'Platform configuration', icon: Settings, to: '/settings', keywords: 'settings configuration config' },
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
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleRailMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [toggleRailMode]);

  const crumbs = useMemo(() => buildCrumbs(location.pathname), [location.pathname]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: railMode ? '64px 1fr' : '248px 1fr',
        minHeight: '100vh',
      }}
    >
      {/* ============ Sidebar ============ */}
      <aside className={cn('b2b-sidebar', railMode && 'b2b-sidebar--rail')}>
        <NavLink
          to="/"
          end
          className="b2b-sidebar__brand"
          style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
          aria-label="Go to dashboard"
          title={railMode ? 'Endora B2B' : undefined}
        >
          <span className="b2b-sidebar__brand-logo">B2</span>
          <span className="b2b-sidebar__brand-text">Endora B2B</span>
        </NavLink>

        <div className="b2b-sidebar__search">
          {railMode ? (
            <button
              type="button"
              className="b2b-sidebar__search-rail"
              onClick={(): void => setPaletteOpen(true)}
              title={t('appShell.search.openPalette') || 'Search (⌘K)'}
              aria-label="Search (⌘K)"
            >
              <Search size={16} />
            </button>
          ) : (
            <>
              <Search size={14} className="b2b-sidebar__search-icon" />
              <input
                className="b2b-sidebar__search-input"
                placeholder="Search or jump to…"
                readOnly
                onClick={(): void => setPaletteOpen(true)}
                onFocus={(): void => setPaletteOpen(true)}
              />
              <span className="b2b-sidebar__search-kbd">⌘K</span>
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
            // Feature 019 — section labels go through useTranslation('core').
            // The empty-label "main" cluster keeps no label; every other
            // group resolves `appShell.section.<key>`. The English literal
            // in NAV is the fallback when a translation is absent.
            const translatedLabel = section.label
              ? t(`appShell.section.${section.key}`)
              : '';
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
                  !isOpen && section.label && 'b2b-sidebar__group--collapsed',
                )}
              >
                {section.label ? (
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
                        <span style={{ flex: 1 }}>{item.label}</span>
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
      </aside>

      {/* ============ Main column (topbar + content) ============ */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="b2b-topbar">
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
                    {c.label}
                  </NavLink>
                ) : (
                  <span className="crumb-cur">{c.label}</span>
                )}
              </span>
            ))}
          </div>
          <div className="b2b-topbar__actions">
            <button
              type="button"
              className="b2b-topbar__icon-btn"
              title="Search (⌘K)"
              onClick={(): void => setPaletteOpen(true)}
            >
              <Search size={16} />
            </button>
            <button type="button" className="b2b-topbar__icon-btn" title="Notifications">
              <Bell size={16} />
              <span className="dot" />
            </button>
            <button type="button" className="b2b-topbar__icon-btn" title="Help">
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
  const headerLabel = translatedLabel || visibleItems[0]?.label || '';

  // Single-item section: render a plain link with no popover. The
  // hover area is the link itself; tooltip carries the label.
  if (visibleItems.length === 1) {
    const only = visibleItems[0]!;
    const Icon = only.icon;
    return (
      <div className="b2b-sidebar__rail-row">
        <NavLink
          to={only.to}
          end={only.to === '/'}
          className={({ isActive }): string =>
            cn('b2b-nav-item b2b-nav-item--rail', isActive && 'is-active')
          }
          title={only.label}
          aria-label={only.label}
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
                <span>{item.label}</span>
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

  const items = useMemo(() => {
    if (!query.trim()) return [...PALETTE_ITEMS, ...actionItems];
    const t = query.toLowerCase();
    // Navigate group keeps the existing case-insensitive substring
    // filter. The Actions group has already been filtered by
    // useAdminActions(query) which applies diacritic-insensitive
    // matching against label, description, and keywords.
    const filteredNav = PALETTE_ITEMS.filter(
      (i) =>
        i.label.toLowerCase().includes(t) ||
        i.sub.toLowerCase().includes(t) ||
        i.keywords.includes(t),
    );
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
            placeholder="Search products, organizations, actions…"
            value={query}
            onChange={(e): void => setQuery(e.target.value)}
          />
          <span className="b2b-kbd-sm">esc</span>
        </div>
        <div className="b2b-palette__list">
          {items.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
              No matches.
            </div>
          ) : (
            items.map((it, i) => {
              const showGroup = it.group !== lastGroup;
              lastGroup = it.group;
              const Icon = it.icon;
              return (
                <div key={`${it.group}-${it.label}`}>
                  {showGroup ? <div className="b2b-palette__group">{it.group}</div> : null}
                  <div
                    className={cn('b2b-palette__item', i === cursor && 'is-cur')}
                    onMouseEnter={(): void => setCursor(i)}
                    onClick={(): void => onNavigate(it.to)}
                  >
                    <Icon size={16} />
                    <div>
                      <div>{it.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{it.sub}</div>
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
