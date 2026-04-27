import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Boxes,
  Building2,
  CircleDollarSign,
  ClipboardCheck,
  Code2,
  CreditCard,
  Factory,
  FileText,
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
  ShieldCheck,
  Tag,
  Truck,
  UserCog,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    label: 'Catalog',
    items: [
      { to: '/catalog/products', label: 'Products', icon: Package },
      { to: '/catalog/categories', label: 'Categories', icon: Boxes },
      { to: '/catalog/attributes', label: 'Attributes', icon: Tag },
      { to: '/inventory', label: 'Inventory', icon: Factory },
    ],
  },
  {
    label: 'Customers',
    items: [
      { to: '/organizations', label: 'Organizations', icon: Building2 },
      { to: '/orders', label: 'Orders', icon: ClipboardCheck },
      { to: '/invoices', label: 'Invoices', icon: Receipt },
      { to: '/credit-limits', label: 'Credit limits', icon: CreditCard },
      { to: '/quote-requests', label: 'Quote requests', icon: FileText },
    ],
  },
  {
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
    ],
  },
];

export function AppShell(): ReactNode {
  const { me, logout } = useAuth();
  const fullName = me ? `${me.adminUser.firstName} ${me.adminUser.lastName}`.trim() : '';

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

        <nav className="flex-1 space-y-4 overflow-y-auto pr-1 text-sm">
          {NAV.map((section) => (
            <div key={section.label} className="space-y-1">
              <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.label}
              </div>
              <ul className="space-y-0.5">
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
                              ? 'bg-accent text-accent-foreground font-medium'
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
            </div>
          ))}
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
