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

const ADMINISTRATOR = { id: '00000000-0000-4000-8000-0000000000a1', kind: 'administrator', name: 'Administrator' } as const;

function session(
  role: MeResult['customerAccount']['organizationRole'] = ADMINISTRATOR,
  permissions: string[] = ['carts.create', 'carts.approve', 'carts.order_without_approval'],
  isPersonal = false,
): MeResult {
  return {
    customerAccount: {
      id: 'acc-1',
      organizationId: 'org-1',
      email: 'anna@example.com',
      firstName: 'Anna',
      lastName: 'Nowak',
      organizationRole: role,
      permissions,
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      twoFactorEnabled: false,
    },
    organization: {
      id: 'org-1',
      name: 'Acme',
      taxId: '1234567890',
      status: 'active',
      vatStatus: 'vat_payer',
      isPersonal,
      registeredAddress: { street: 'Main 1', city: 'Gdansk', postalCode: '80-001', country: 'PL' },
    },
    impersonation: null,
  };
}

let me: MeResult = session();
let pendingCarts: number | Error = 2;
const cartListCalls: unknown[] = [];

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
vi.mock('../../lib/api/cart', () => ({
  listOrganizationCarts: async (_jar: unknown, filter: unknown) => {
    cartListCalls.push(filter);
    if (pendingCarts instanceof Error) throw pendingCarts;
    return { data: [], meta: { page: 1, pageSize: 20, totalCount: pendingCarts } };
  },
}));

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
  me = session();
  pendingCarts = 2;
  cartListCalls.length = 0;
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

/**
 * Feature 170 (FR-057, FR-070a, PR-3, PR-10) — *Members* and *Roles* follow the
 * Administrator role, *Carts to approve* follows `carts.approve`, and none of
 * the three is offered in a personal Organization, whose member holds
 * Administrator: that gate is the Organization's kind, never the role. `carts`
 * and `organizations` are non-deactivatable, so no presence gate applies.
 */
describe('account navigation — the organization area (feature 170)', () => {
  const MEMBERS = 'href="/organization/members"';
  const ROLES = 'href="/organization/roles"';
  const CARTS = 'href="/organization/carts?approval=pending"';

  it('offers members, roles and the carts to approve, with their count, to an administrator', async () => {
    const html = await accountNav();
    expect(html).toContain(MEMBERS);
    expect(html).toContain(ROLES);
    expect(html).toContain(CARTS);
    expect(html.replaceAll('<!-- -->', '')).toContain('Carts to approve (2)');
    expect(cartListCalls).toEqual([{ approvalStatus: ['pending'] }]);
  });

  it('offers only the carts to approve to an approver who is not the administrator', async () => {
    me = session({ id: '00000000-0000-4000-8000-0000000000c1', kind: 'custom', name: 'Purchasing' }, ['carts.approve']);
    const html = await accountNav();
    expect(html).toContain(CARTS);
    expect(html).not.toContain(MEMBERS);
    expect(html).not.toContain(ROLES);
  });

  it('offers none of the three to a member without carts.approve, and counts nothing', async () => {
    me = session({ id: '00000000-0000-4000-8000-0000000000b1', kind: 'member', name: 'Member' }, ['carts.create']);
    const html = await accountNav();
    for (const href of [MEMBERS, ROLES, CARTS]) expect(html).not.toContain(href);
    expect(cartListCalls).toEqual([]);
  });

  it('offers none of the three in a personal Organization, although its member is the Administrator', async () => {
    me = session(ADMINISTRATOR, ['carts.create', 'carts.approve', 'carts.order_without_approval'], true);
    const html = await accountNav();
    for (const href of [MEMBERS, ROLES, CARTS]) expect(html).not.toContain(href);
    // Nor the Organization's own pages (issue #757): a personal Organization is not a company.
    expect(html).not.toContain('href="/organization"');
    expect(html).not.toContain('href="/organization/addresses"');
    expect(html).toContain('href="/addresses"');
    expect(cartListCalls).toEqual([]);
  });

  it('shows no count when nothing is waiting', async () => {
    pendingCarts = 0;
    const html = (await accountNav()).replaceAll('<!-- -->', '');
    expect(html).toContain(CARTS);
    expect(html).toMatch(/>Carts to approve<\/a>/);
  });

  it('keeps the link without a count when the count cannot be read', async () => {
    pendingCarts = new Error('HTTP 503');
    const html = (await accountNav()).replaceAll('<!-- -->', '');
    expect(html).toMatch(/>Carts to approve<\/a>/);
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
    { moduleId: 'customers', layout: () => import('../../app/(auth)/register-customer/layout') },
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
