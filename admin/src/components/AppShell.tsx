import { useCallback, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Boxes,
  Building2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Code2,
  CreditCard,
  Factory,
  FileText,
  Scale,
  Globe,
  Image,
  KeyRound,
  Languages,
  LineChart,
  ListChecks,
  Newspaper,
  Package,
  PercentDiamond,
  Receipt,
  Search,
  Settings,
  Store,
  ShieldCheck,
  Tag,
  Truck,
  UserCog,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
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
  label: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    key: 'catalog',
    label: 'Catalog',
    items: [
      { to: '/catalog/products', label: 'Products', icon: Package },
      { to: '/catalog/categories', label: 'Categories', icon: Boxes },
      { to: '/catalog/attributes', label: 'Attributes', icon: Tag },
      { to: '/catalog/attribute-sets', label: 'Attribute Sets', icon: Tag },
      { to: '/catalog/attachment-types', label: 'Attachment Types', icon: FileText },
      { to: '/inventory', label: 'Inventory', icon: Factory },
    ],
  },
  {
    key: 'customers',
    label: 'Customers',
    items: [
      { to: '/organizations', label: 'Organizations', icon: Building2 },
      { to: '/orders', label: 'Orders', icon: ClipboardCheck },
      { to: '/invoices', label: 'Invoices', icon: Receipt },
      { to: '/credit-limits', label: 'Credit limits', icon: CreditCard },
      { to: '/quote-requests', label: 'Quote requests', icon: FileText },
      { to: '/comparisons', label: 'Comparisons', icon: Scale },
    ],
  },
  {
    key: 'pricing',
    label: 'Pricing & promos',
    items: [
      { to: '/price-lists', label: 'Price lists', icon: CircleDollarSign },
      { to: '/taxes', label: 'Taxes', icon: PercentDiamond },
      { to: '/promotions', label: 'Promotions', icon: Tag },
      { to: '/delivery-methods', label: 'Delivery methods', icon: Truck },
      { to: '/payment-methods', label: 'Payment methods', icon: CreditCard },
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    items: [
      { to: '/admin-users', label: 'Users', icon: Users },
      { to: '/admin-roles', label: 'Roles', icon: ShieldCheck },
      { to: '/audit-log', label: 'Audit log', icon: ListChecks },
      { to: '/api-keys', label: 'API keys', icon: KeyRound },
      { to: '/webhooks', label: 'Webhooks', icon: Webhook },
      { to: '/integrations', label: 'Integrations', icon: Code2 },
      { to: '/analytics', label: 'Analytics', icon: LineChart },
      { to: '/import-export', label: 'Import / Export', icon: Image },
      { to: '/seo', label: 'SEO', icon: Search },
      { to: '/i18n', label: 'Languages', icon: Languages },
      { to: '/cms', label: 'CMS pages', icon: Newspaper },
      { to: '/sales-channels', label: 'Sales channels', icon: Store },
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
    if (Array.isArray(parsed)) return new Set(parsed.filter((v): v is string => typeof v === 'string'));
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

export function AppShell(): ReactNode {
  const { me, logout } = useAuth();
  const fullName = me ? `${me.adminUser.firstName} ${me.adminUser.lastName}`.trim() : '';
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());

  const toggleSection = useCallback((key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistCollapsed(next);
      return next;
    });
  }, []);

  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr] bg-muted/30">
      <aside className="flex flex-col gap-4 border-r bg-background p-4">
        <div className="flex items-center gap-2 px-2 py-1 text-base font-semibold">
          <Globe className="size-5 text-primary" />
          <span>B2B Admin</span>
        </div>

        {me ? (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <UserCog className="size-4 text-muted-foreground" />
              <span className="truncate">{fullName || me.adminUser.email}</span>
            </div>
            <div className="text-xs text-muted-foreground">{me.adminUser.email}</div>
            <div className="text-xs text-muted-foreground">{me.role?.name ?? 'no role'}</div>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={(): void => void logout()}
            >
              Sign out
            </Button>
          </div>
        ) : null}

        <Separator />

        <nav className="flex-1 space-y-2 overflow-y-auto pr-1 text-sm">
          {NAV.map((section) => {
            const isOpen = !collapsed.has(section.key);
            return (
              <Collapsible
                key={section.key}
                open={isOpen}
                onOpenChange={(): void => toggleSection(section.key)}
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronRight
                      className={cn(
                        'size-3.5 shrink-0 transition-transform duration-150',
                        isOpen && 'rotate-90',
                      )}
                    />
                    <span className="flex-1 text-left">{section.label}</span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
                  <ul className="mt-1 space-y-0.5 pl-1.5">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <li key={item.to}>
                          <NavLink
                            to={item.to}
                            className={({ isActive }): string =>
                              cn(
                                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                                isActive
                                  ? 'bg-accent font-medium text-accent-foreground'
                                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                              )
                            }
                          >
                            <Icon className="size-4 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </NavLink>
                        </li>
                      );
                    })}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </nav>

        <Separator />
        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <Settings className="size-3.5" />
          <span>v0.0.0 · dev</span>
        </div>
      </aside>

      <main className="overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
