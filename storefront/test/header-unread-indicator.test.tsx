import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { MeResult } from '../lib/api/account';
import type { ModulePresenceSet } from '../lib/api/module-presence';

/**
 * `specs/179-rfq-and-customer-notifications/` T081 — the unread indicator on
 * the account entry (FR-051, FR-051b, spec § *Header bell decision*).
 *
 * No bell: the desktop account pill and the tab bar's account tab carry the
 * count, reusing the existing badge classes (`.icon-btn__count`,
 * `.m-tabbar__badge`), capped at `9+`, hidden from assistive technology, with
 * the exact count in visually hidden text after the entry's visible name —
 * never an `aria-label` that replaces it, never a live region. Nothing for a
 * count of 0, a guest, the module being off, or the minimal checkout header.
 * The drawer's footer row is an interaction (the drawer opens on a click) and
 * is in `header-unread-indicator.drawer.test.tsx`.
 */

let pathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../lib/dictionary/DictionaryProvider', () => ({
  useDictionary: () => ({ countries: [], currencies: [], languages: [], resolveByCode: async () => null }),
}));

const { Header } = await import('../components/Header');
const { MobileTabBar } = await import('../components/mobile/MobileTabBar');
const { CheckoutHeaderView } = await import('../components/checkout/CheckoutHeader');

const me = {
  customerAccount: {
    id: 'acc-1',
    organizationId: 'org-1',
    email: 'anna@example.com',
    firstName: 'Anna',
    lastName: 'Nowak',
  },
  organization: { id: 'org-1', name: 'Acme', isPersonal: false },
  impersonation: null,
} as unknown as MeResult;

let absent: string[] = [];
function modules(): ModulePresenceSet {
  return { isPresent: (id: string) => !absent.includes(id), presentIds: [], absentIds: absent };
}

function header(count: number, user: MeResult | null = me, locale = 'en-US'): string {
  return renderToString(
    <Header
      config={{ defaultLanguageCode: 'en-US' } as never}
      locale={locale}
      salesChannelCode="retail"
      cartItemCount={0}
      megamenu={null}
      user={user}
      modules={modules()}
      unreadNotificationCount={count}
    />,
  );
}

/** The desktop account pill: the link to `/account`. */
function pill(html: string): string {
  const start = html.lastIndexOf('<a', html.indexOf('class="industria-header__user"'));
  return html.slice(start, html.indexOf('</a>', start) + 4);
}

const labels = {
  navigation: 'Mobile',
  home: 'Home',
  quoteRequest: 'Quote',
  quickOrder: 'Quick Order',
  cart: 'Cart',
  account: 'Account',
};

function tabBar(count: number): string {
  return renderToString(
    <MobileTabBar
      labels={labels}
      present={{ quoteRequests: true, quickOrder: true }}
      accountUnread={{ count, label: `Unread notifications: ${count}` }}
    />,
  );
}

function accountTab(html: string): string {
  const start = html.lastIndexOf('<a', html.indexOf('href="/account"'));
  return html.slice(start, html.indexOf('</a>', start) + 4);
}

beforeEach(() => {
  absent = [];
  pathname = '/';
});

describe('account pill indicator', () => {
  it('reuses .icon-btn__count on the avatar, hidden from assistive technology', () => {
    const link = pill(header(2));
    expect(link).toMatch(/<span[^>]*class="[^"]*icon-btn__count[^"]*"[^>]*>2<\/span>/);
    // The avatar (initials and badge) is decoration; the name says who it is.
    expect(link).toMatch(/<span[^>]*class="industria-header__user__avatar[^"]*"[^>]*aria-hidden="true"/);
  });

  it('carries the exact count as visually hidden text after the visible name', () => {
    const link = pill(header(2));
    const name = link.indexOf('Anna Nowak');
    const hidden = link.indexOf('<span class="sr-only">Unread notifications: 2</span>');
    expect(name).toBeGreaterThan(-1);
    expect(hidden).toBeGreaterThan(name);
  });

  it('caps the badge at 9+ while the hidden text keeps the exact count', () => {
    const link = pill(header(12));
    expect(link).toMatch(/icon-btn__count[^"]*"[^>]*>9\+<\/span>/);
    expect(link).toContain('Unread notifications: 12');
  });

  it('never replaces the name with an aria-label, and has no live region', () => {
    const link = pill(header(2));
    expect(link).not.toContain('aria-label');
    expect(link).not.toContain('aria-live');
    expect(link).not.toContain('role="status"');
  });

  it('is in Polish for a Polish buyer', () => {
    expect(pill(header(3, me, 'pl-PL'))).toContain('Nieprzeczytane powiadomienia: 3');
  });

  it('shows nothing for no unread entries, a guest, or the module being off', () => {
    expect(pill(header(0))).not.toContain('icon-btn__count');
    expect(pill(header(0))).not.toContain('Unread notifications');
    expect(header(2, null)).not.toContain('Unread notifications');
    absent = ['customer_notifications'];
    expect(pill(header(2))).not.toContain('icon-btn__count');
    expect(header(2)).not.toContain('Unread notifications');
  });

  it('has no indicator in the minimal checkout header', () => {
    const html = renderToString(<CheckoutHeaderView locale="en-US" />);
    expect(html).not.toContain('Unread notifications');
    expect(html).not.toContain('icon-btn__count');
  });
});

describe('tab bar account tab indicator', () => {
  it('reuses .m-tabbar__badge, hidden, plus the hidden text inside the tab link', () => {
    const tab = accountTab(tabBar(2));
    expect(tab).toMatch(/<span class="m-tabbar__badge" aria-hidden="true">2<\/span>/);
    expect(tab).toContain('<span class="sr-only">Unread notifications: 2</span>');
    expect(tab.indexOf('Account')).toBeLessThan(tab.indexOf('Unread notifications: 2'));
    expect(tab).not.toContain('aria-label');
  });

  it('caps the badge at 9+', () => {
    const tab = accountTab(tabBar(10));
    expect(tab).toContain('>9+</span>');
    expect(tab).toContain('Unread notifications: 10');
  });

  it('shows nothing for no unread entries or without the prop (guest, module off)', () => {
    expect(accountTab(tabBar(0))).not.toContain('m-tabbar__badge');
    expect(accountTab(tabBar(0))).not.toContain('Unread notifications');
    const without = renderToString(
      <MobileTabBar labels={labels} present={{ quoteRequests: true, quickOrder: true }} />,
    );
    expect(accountTab(without)).not.toContain('m-tabbar__badge');
  });

  it('does not interrupt checkout', () => {
    pathname = '/checkout';
    expect(accountTab(tabBar(2))).not.toContain('Unread notifications');
  });
});
