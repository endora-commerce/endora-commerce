import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';

interface NavItem {
  to: string;
  label: string;
}

const NAV: NavItem[] = [
  { to: '/catalog/products', label: 'Products' },
  { to: '/catalog/categories', label: 'Categories' },
  { to: '/catalog/attributes', label: 'Attributes' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/organizations', label: 'Organizations' },
  { to: '/orders', label: 'Orders' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/credit-limits', label: 'Credit limits' },
  { to: '/quote-requests', label: 'Quote requests' },
  { to: '/price-lists', label: 'Price lists' },
  { to: '/taxes', label: 'Taxes' },
  { to: '/promotions', label: 'Promotions' },
  { to: '/delivery-methods', label: 'Delivery methods' },
  { to: '/payment-methods', label: 'Payment methods' },
  { to: '/admin-users', label: 'Users' },
  { to: '/admin-roles', label: 'Roles' },
  { to: '/audit-log', label: 'Audit log' },
  { to: '/api-keys', label: 'API Keys' },
  { to: '/webhooks', label: 'Webhooks' },
  { to: '/integrations', label: 'Integrations' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/import-export', label: 'Import / Export' },
  { to: '/seo', label: 'SEO' },
  { to: '/i18n', label: 'Languages & Currencies' },
  { to: '/cms', label: 'CMS pages' },
];

export function AppShell(): ReactNode {
  const { me, logout } = useAuth();
  const fullName = me ? `${me.adminUser.firstName} ${me.adminUser.lastName}`.trim() : '';
  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <div className="app-shell__brand">B2B Admin</div>
        {me ? (
          <div
            style={{
              borderBottom: '1px solid var(--color-border)',
              paddingBottom: 12,
              marginBottom: 12,
              fontSize: '0.85rem',
            }}
          >
            <div style={{ fontWeight: 600 }}>{fullName || me.adminUser.email}</div>
            <div className="muted">{me.adminUser.email}</div>
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              {me.role ? me.role.name : 'no role'}
            </div>
            <button
              className="btn"
              type="button"
              style={{ marginTop: 8, width: '100%' }}
              onClick={(): void => void logout()}
            >
              Sign out
            </button>
          </div>
        ) : null}
        <nav>
          <ul>
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }): string =>
                    isActive ? 'nav-link nav-link--active' : 'nav-link'
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main className="app-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
