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
  PercentDiamond,
  Plus,
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

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
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
      { to: '/orders', label: 'Orders', icon: ClipboardCheck },
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
      { to: '/quote-requests', label: 'Quote requests', icon: FileText },
      { to: '/comparisons', label: 'Comparisons', icon: Scale },
      { to: '/invoices', label: 'Invoices', icon: Receipt },
    ],
  },
  {
    key: 'channels',
    label: 'Channels',
    items: [
      { to: '/sales-channels', label: 'Sales channels', icon: Store },
      { to: '/cms/pages', label: 'CMS Pages', icon: Newspaper },
      { to: '/cms/blocks', label: 'CMS Blocks', icon: Newspaper },
      { to: '/cms/templates', label: 'CMS Templates', icon: Newspaper },
      { to: '/cms/hooks', label: 'CMS Hooks', icon: Webhook },
      { to: '/i18n', label: 'Languages', icon: Languages },
      { to: '/seo', label: 'SEO', icon: Search },
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
  { test: /^\/i18n\/?$/, build: () => [
    { label: 'Channels', href: '/sales-channels' },
    { label: 'Languages', href: null },
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
  { group: 'Navigate', label: 'Settings', sub: 'Platform configuration', icon: Settings, to: '/settings', keywords: 'settings configuration config' },
  { group: 'Actions', label: 'New product', sub: 'Create a new catalog row', icon: Plus, to: '/catalog/products/new', keywords: 'create new product add' },
  { group: 'Actions', label: 'Import products', sub: 'Bulk upload', icon: Upload, to: '/import-export', keywords: 'csv import upload' },
];

export function AppShell(): ReactNode {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  // ⌘K opens the palette anywhere in the admin.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, []);

  const crumbs = useMemo(() => buildCrumbs(location.pathname), [location.pathname]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px 1fr', minHeight: '100vh' }}>
      {/* ============ Sidebar ============ */}
      <aside className="b2b-sidebar">
        <NavLink
          to="/"
          end
          className="b2b-sidebar__brand"
          style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
          aria-label="Go to dashboard"
        >
          <span className="b2b-sidebar__brand-logo">B2</span>
          <span>Endora B2B</span>
        </NavLink>

        <div className="b2b-sidebar__search">
          <Search size={14} className="b2b-sidebar__search-icon" />
          <input
            className="b2b-sidebar__search-input"
            placeholder="Search or jump to…"
            readOnly
            onClick={(): void => setPaletteOpen(true)}
            onFocus={(): void => setPaletteOpen(true)}
          />
          <span className="b2b-sidebar__search-kbd">⌘K</span>
        </div>

        <nav className="b2b-sidebar__nav">
          {NAV.map((section) => {
            const isOpen = !collapsed.has(section.key);
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
                    <span>{section.label}</span>
                  </button>
                ) : null}
                <div className="b2b-sidebar__items">
                  {section.items.map((item) => {
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
              title="Edit profile"
              aria-label="Edit profile"
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
              title="Sign out"
              aria-label="Sign out"
              onClick={(): void => void logout()}
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : null}
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
            {me ? (
              <NavLink
                to="/profile"
                className="b2b-avatar"
                title={`${fullName || me.adminUser.email} — edit profile`}
                aria-label="Edit profile"
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

  const items = useMemo(() => {
    if (!query.trim()) return PALETTE_ITEMS;
    const t = query.toLowerCase();
    return PALETTE_ITEMS.filter(
      (i) =>
        i.label.toLowerCase().includes(t) ||
        i.sub.toLowerCase().includes(t) ||
        i.keywords.includes(t),
    );
  }, [query]);

  useEffect(() => {
    setCursor(0);
  }, [query, open]);

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
