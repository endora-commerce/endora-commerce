// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `specs/179-rfq-and-customer-notifications/` T081 — the mobile drawer's
 * account footer (FR-051, `contracts/customer-notifications-storefront-api.md`
 * §3, *Indicator — drawer*). The footer renders only once the drawer is open,
 * so this is an interaction test: open the drawer, read the footer.
 *
 * While the buyer is signed in and the centre is present the footer gains a
 * *Notifications* row to the page, the count in text. The burger trigger
 * carries no dot.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout; the drawer's rows observe their size.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {}, prefetch: () => {} }),
}));

const { MegamenuMobileDrawer } = await import('../components/Megamenu/MegamenuMobileDrawer');

const labels = {
  open: 'Open menu',
  close: 'Close menu',
  title: 'Menu',
  seeAll: 'See all',
  allIn: 'All in {label}',
  account: 'Account',
  login: 'Sign in',
  go: 'Go',
};

let host: HTMLElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

function mountOpen(account: { initials: string; name: string; subtitle: string; notifications: string | null }): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<MegamenuMobileDrawer megamenu={{ items: [] } as never} labels={labels} account={account} />));
  const trigger = host.querySelector('button[aria-label="Open menu"]') as HTMLButtonElement;
  expect(trigger.innerHTML).not.toContain('icon-btn__count');
  act(() => trigger.click());
  return host;
}

const account = { initials: 'AN', name: 'Anna Nowak', subtitle: 'Acme' };

describe('drawer footer notifications row', () => {
  it('links to the notifications page with the count in text', () => {
    const el = mountOpen({ ...account, notifications: 'Notifications (2)' });
    const row = el.querySelector('.mm__foot a[href="/account/notifications"]');
    expect(row?.textContent).toBe('Notifications (2)');
  });

  it('is left out while the centre is absent', () => {
    const el = mountOpen({ ...account, notifications: null });
    expect(el.querySelector('a[href="/account/notifications"]')).toBeNull();
  });
});
