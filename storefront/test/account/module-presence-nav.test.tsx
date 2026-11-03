import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { MeResult } from '../../lib/api/account';
import type { ModulePresenceSet } from '../../lib/api/module-presence';

/**
 * Issue #666 — Principle XVII, item 5: a module that is off contributes no
 * storefront element. The account navigation, the header icons, the footer and
 * the mobile tab bar each offered a link to returns, quote requests, shopping
 * lists, quick order (and, in the header, comparison) whatever the platform
 * said, and the pages behind them rendered against an API that answered 503.
 *
 * Each link is asserted absent while its own module is off and the others are
 * on, so a gate wired to the wrong id fails here; the non-deactivatable
 * surfaces (`orders`, `organizations`, `addresses`) stay unconditional. The
 * degrade case goes through the real `getModulePresence` against an
 * unreachable backend: it reports everything present, so the navigation stays
 * whole and each page's own fetch decides.
 */

const NOT_FOUND = 'NEXT_NOT_FOUND';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('../../lib/dictionary/DictionaryProvider', () => ({
  useDictionary: () => ({ countries: [], currencies: [], languages: [], resolveByCode: async () => null }),
}));
vi.mock('../../lib/api/cms', () => ({
  getCmsBlockByCode: async () => {
    throw new Error('cms is off');
  },
}));

const me: MeResult = {
  customerAccount: {
    id: 'acc-1',
    organizationId: 'org-1',
    email: 'anna@example.com',
    firstName: 'Anna',
    lastName: 'Nowak',
    role: 'organization_admin',
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    twoFactorEnabled: false,
  },
  organization: {
    id: 'org-1',
    name: 'Acme',
    taxId: '1234567890',
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: 'Main 1', city: 'Gdansk', postalCode: '80-001', country: 'PL' },
  },
  impersonation: null,
};

/** A presence set in which exactly the named modules are off. */
function presenceWithout(...absent: string[]): ModulePresenceSet {
  return {
    isPresent: (id: string) => !absent.includes(id),
    presentIds: [],
    absentIds: absent,
  };
}

let modules: ModulePresenceSet = presenceWithout();
let modulesFromBackend = false;

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session-cookie',
  getAnonCartCookie: async () => undefined,
  clearSessionCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', async () => {
  const { getModulePresence } = await import('../../lib/api/module-presence');
  return {
    getServerContext: async () => ({
      locale: 'en-US',
      ctx: { locale: 'en-US' },
      modules: modulesFromBackend ? await getModulePresence() : modules,
    }),
  };
});
vi.mock('../../lib/api/account', () => ({ getMe: async () => me }));
vi.mock('../../lib/api/auth', () => ({ logoutCustomer: async () => undefined }));

const { default: AccountLayout } = await import('../../app/(account)/layout');
const { Header } = await import('../../components/Header');
const { Footer } = await import('../../components/Footer');
const { MobileTabBar } = await import('../../components/mobile/MobileTabBar');

async function accountNav(): Promise<string> {
  return renderToString(<>{(await AccountLayout({ children: null })) as ReactNode}</>);
}

function header(): string {
  return renderToString(
    <Header
      config={{ defaultLanguageCode: 'en-US' } as never}
      locale="en-US"
      salesChannelCode="retail"
      cartItemCount={0}
      megamenu={null}
      user={me}
      modules={modules}
    />,
  );
}

function footer(): string {
  return renderToString(<Footer locale="en-US" modules={modules} />);
}

function tabBar(): string {
  return renderToString(
    <MobileTabBar
      labels={{
        navigation: 'Mobile',
        home: 'Home',
        quoteRequest: 'Quote',
        quickOrder: 'Quick order',
        cart: 'Cart',
        account: 'Account',
      }}
      present={{ quoteRequests: modules.isPresent('quote_requests'), quickOrder: modules.isPresent('quick_order') }}
    />,
  );
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  modules = presenceWithout();
  modulesFromBackend = false;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ACCOUNT_LINKS = [
  { moduleId: 'returns', href: '/returns' },
  { moduleId: 'quote_requests', href: '/quote-requests' },
  { moduleId: 'shopping_lists', href: '/shopping-lists' },
  { moduleId: 'quick_order', href: '/quick-order' },
] as const;

describe('account navigation — module presence (issue #666)', () => {
  it('offers every module link while every module is present', async () => {
    const html = await accountNav();
    for (const { href } of ACCOUNT_LINKS) expect(html).toContain(`href="${href}"`);
  });

  for (const { moduleId, href } of ACCOUNT_LINKS) {
    it(`drops ${href} while ${moduleId} is off, and only that link`, async () => {
      modules = presenceWithout(moduleId);
      const html = await accountNav();
      expect(html).not.toContain(`href="${href}"`);
      for (const other of ACCOUNT_LINKS.filter((l) => l.moduleId !== moduleId)) {
        expect(html).toContain(`href="${other.href}"`);
      }
    });
  }

  it('keeps the links of the non-deactivatable modules whatever else is off', async () => {
    modules = presenceWithout(...ACCOUNT_LINKS.map((l) => l.moduleId));
    const html = await accountNav();
    for (const href of ['/account', '/addresses', '/orders', '/organization', '/organization/addresses']) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('keeps the whole navigation when the presence projection cannot be read', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    modulesFromBackend = true;
    const html = await accountNav();
    for (const { href } of ACCOUNT_LINKS) expect(html).toContain(`href="${href}"`);
  });
});

describe('module pages — not found while their module is off (issue #666)', () => {
  const GATED_SEGMENTS = [
    { moduleId: 'returns', layout: () => import('../../app/(account)/returns/layout') },
    { moduleId: 'quote_requests', layout: () => import('../../app/(account)/quote-requests/layout') },
    { moduleId: 'shopping_lists', layout: () => import('../../app/(account)/shopping-lists/layout') },
    { moduleId: 'quick_order', layout: () => import('../../app/(account)/quick-order/layout') },
    { moduleId: 'newsletter', layout: () => import('../../app/(account)/newsletter/layout') },
    { moduleId: 'quote_requests', layout: () => import('../../app/(commerce)/quote-request/layout') },
    { moduleId: 'quote_requests', layout: () => import('../../app/(commerce)/quote-requests/layout') },
    { moduleId: 'comparisons', layout: () => import('../../app/compare/layout') },
  ] as const;

  for (const [index, { moduleId, layout }] of GATED_SEGMENTS.entries()) {
    it(`segment #${index + 1} answers not-found while ${moduleId} is off`, async () => {
      const { default: Layout } = await layout();
      modules = presenceWithout(moduleId);
      await expect(Layout({ children: 'page' })).rejects.toThrow(NOT_FOUND);
    });

    it(`segment #${index + 1} renders its page while ${moduleId} is present`, async () => {
      const { default: Layout } = await layout();
      modules = presenceWithout();
      expect(renderToString(<>{await Layout({ children: 'page' })}</>)).toBe('page');
    });
  }

  it('renders the page when the presence projection cannot be read', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    modulesFromBackend = true;
    const { default: Layout } = await import('../../app/(account)/returns/layout');
    expect(renderToString(<>{await Layout({ children: 'page' })}</>)).toBe('page');
  });
});

describe('header — module presence (issue #666)', () => {
  const HEADER_LINKS = [
    { moduleId: 'shopping_lists', href: 'href="/shopping-lists"' },
    { moduleId: 'quote_requests', href: 'href="/quote-request"' },
    { moduleId: 'comparisons', href: 'href="/compare"' },
  ] as const;

  it('shows the shopping-list, quote-request and comparison icons while present', () => {
    const html = header();
    for (const { href } of HEADER_LINKS) expect(html).toContain(href);
  });

  for (const { moduleId, href } of HEADER_LINKS) {
    it(`drops the ${moduleId} icon while it is off`, () => {
      modules = presenceWithout(moduleId);
      const html = header();
      expect(html).not.toContain(href);
      for (const other of HEADER_LINKS.filter((l) => l.moduleId !== moduleId)) expect(html).toContain(other.href);
    });
  }
});

describe('footer — module presence (issue #666)', () => {
  const FOOTER_LINKS = [
    { moduleId: 'quick_order', href: 'href="/quick-order"' },
    { moduleId: 'quote_requests', href: 'href="/quote-requests"' },
    { moduleId: 'shopping_lists', href: 'href="/shopping-lists"' },
  ] as const;

  for (const { moduleId, href } of FOOTER_LINKS) {
    it(`drops ${href} while ${moduleId} is off, and only that link`, () => {
      expect(footer()).toContain(href);
      modules = presenceWithout(moduleId);
      const html = footer();
      expect(html).not.toContain(href);
      for (const other of FOOTER_LINKS.filter((l) => l.moduleId !== moduleId)) expect(html).toContain(other.href);
      expect(html).toContain('href="/orders"');
    });
  }
});

describe('mobile tab bar — module presence (issue #666)', () => {
  const TABS = [
    { moduleId: 'quote_requests', href: 'href="/quote-request"' },
    { moduleId: 'quick_order', href: 'href="/quick-order"' },
  ] as const;

  for (const { moduleId, href } of TABS) {
    it(`drops the ${moduleId} tab while it is off`, () => {
      expect(tabBar()).toContain(href);
      modules = presenceWithout(moduleId);
      const html = tabBar();
      expect(html).not.toContain(href);
      for (const other of TABS.filter((l) => l.moduleId !== moduleId)) expect(html).toContain(other.href);
      for (const always of ['href="/"', 'href="/cart"', 'href="/account"']) expect(html).toContain(always);
    });
  }
});
