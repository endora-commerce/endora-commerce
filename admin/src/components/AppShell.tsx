import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
}

const NAV: NavItem[] = [
  { to: '/quote-requests', label: 'Quote requests' },
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
  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <div className="app-shell__brand">B2B Admin</div>
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
