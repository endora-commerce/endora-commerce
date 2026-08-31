import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { contributions as autopayContributions } from '@endora-commerce/mod-autopay/admin';
import { contributions as paypalContributions } from '@endora-commerce/mod-paypal/admin';
import { contributions as payuContributions } from '@endora-commerce/mod-payu/admin';
import { contributions as stripeContributions } from '@endora-commerce/mod-stripe/admin';
import { contributions as tpayContributions } from '@endora-commerce/mod-tpay/admin';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * One of the admin's own source files, read as text.
 *
 * From the workspace root vitest hands this file, because `import.meta.url` is
 * an `http:` URL under jsdom and `node:fs` cannot read one.
 */
function sourceOf(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/**
 * `autopay`, `paypal`, `payu`, `stripe` and `tpay` own their admin surfaces —
 * feature 091's Phase 4 batch five, and the batch's **five payment gateways**.
 *
 * One file because they are one repair five times over: each screen imported
 * `dictionaryClient` from `@/modules/dictionaries/client` for the same call —
 * the country list a per-method availability rule is chosen from — and each now
 * builds that call from the published `apiClient` and
 * `DictionaryCountriesPageResponse` in its own admin client. Five ledger shards
 * are deleted rather than edited. Writing five near-identical files would have
 * hidden that the differences between them are two: the route and the code.
 *
 * **None of the five contributes a sidebar entry, and none is given one.** That
 * is `plan.md`'s Ruling 1 applied — see
 * `admin/test/modules/carrier-settings.module-owned-surface.test.tsx` for the
 * same reasoning written out, and for the batch's other two members.
 *
 * **What each off-state case asserts, in this file's own words**, since Ruling
 * 1 asks a nav-less batch member's test to say what it drives instead of the
 * sidebar:
 *
 *  * *present, and the operator holds the code the route enforces* — the
 *    screen's own heading is on the page. First, because an absence proves
 *    nothing until a presence has been seen;
 *  * *switched off* — the admin's `app.notFound` treatment is on the page and
 *    the heading is not. The registry still names the module, so the withdrawal
 *    happens at render and an operator's flip needs no rebuild;
 *  * *the operator holds the module's **write** code and not its read code* —
 *    the same not-found treatment. The codes are opaque strings, so this is a
 *    real near-miss and not a straw one, and it is the case a declaration that
 *    copied a neighbour's code would fail;
 *  * *the module comes back* — the heading again, with no rebuild between.
 *
 * The **sidebar** is asserted as an absence in the last `describe` below; the
 * **palette** is the server's answer and is driven in each module's
 * `backend/test/integration/<id>/module-owned-surface-off-state.test.ts`. All
 * five declare a palette action already, so none of them is one of the fifteen
 * Principle XVI entries `specs/deferred-defects.md` still carries.
 *
 * The whole `App` is rendered rather than the screen: the gate is `App.tsx`'s
 * `ModuleRoute`, and a test that mounted the component would prove the
 * component renders, which nobody doubted.
 */

let presentModules = new Set<string>();
let permissions = new Set<string>();



vi.mock('@/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('@/lib/admin-actions/AdminActionsProvider', () => ({
  AdminActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('@/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('@/components/IdleLogout', () => ({
  IdleLogout: () => null,
}));

vi.mock('@/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

/**
 * A gateway configuration wide enough for any of the five screens to render its
 * form: the union of the fields they read, all inert. One object rather than
 * five, because nothing here is asserted — the subject is the gate, not the
 * form, and a per-gateway fixture would suggest otherwise.
 */
const GATEWAY_CONFIG = {
  mode: 'sandbox',
  active: true,
  checkoutDisplayMode: 'redirect',
  savedCardsEnabled: false,
  blikOneClickEnabled: false,
  publicApiBaseConfigured: true,
  webhookUrl: 'https://example.test/api/v1/public/payments/webhook',
  istnUrl: 'https://example.test/itn',
  itnUrl: 'https://example.test/itn',
  serviceIdTest: '',
  serviceIdLive: '',
  sharedKeyTestIsSet: false,
  sharedKeyLiveIsSet: false,
  clientIdTest: '',
  clientIdLive: '',
  clientSecretTestIsSet: false,
  clientSecretLiveIsSet: false,
  secondKeyTestIsSet: false,
  secondKeyLiveIsSet: false,
  posIdTest: '',
  posIdLive: '',
  applePayMerchantId: '',
  applePayMerchantCertIsSet: false,
  applePayMerchantKeyIsSet: false,
  publishableKeyTest: '',
  publishableKeyLive: '',
  secretKeyTestIsSet: false,
  secretKeyLiveIsSet: false,
  webhookSigningSecretTestIsSet: false,
  webhookSigningSecretLiveIsSet: false,
  webhookIdTest: '',
  webhookIdLive: '',
  rsaPublicKeyTest: '',
  rsaPublicKeyLive: '',
};

// Every screen calls its own config and method endpoints on mount, and — since
// this batch — the dictionary country list through its **own** client. The mock
// sits on the kit's barrel, which is the specifier the packaged screens
// resolve; the drained `listCountries` goes through the same `apiClient`, so
// the country branch below is what proves the reach was rebuilt rather than
// rerouted.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async (url: string) => {
        if (url.includes('/dictionary/countries')) {
          return { data: [], pagination: { page: 1, pageSize: 250, total: 0, totalPages: 0 } };
        }
        if (url.includes('/methods')) return { data: { methods: [] } };
        return { data: GATEWAY_CONFIG };
      }),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

/**
 * `App.tsx` imports every host screen statically, and one of them (`cms`' Puck
 * editor) reaches `@dnd-kit/dom`, which constructs a `ResizeObserver` at module
 * scope. jsdom has none. The stub is a module-load accommodation and nothing
 * this file asserts touches it.
 */
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../src/App');

const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.pricing',
    'app.moduleScreenLoading',
    'app.notFound',
  ]),
  ...passthroughBundle('autopay', ['page.title', 'page.subtitle']),
  ...passthroughBundle('paypal', ['page.title', 'page.subtitle']),
  ...passthroughBundle('payu', ['page.title', 'page.subtitle']),
  ...passthroughBundle('tpay', ['page.title', 'page.subtitle']),
};

function renderAt(path: string): RenderResult {
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <App modulePresence={modulePresence({ present: [...presentModules] })} />
      </MemoryRouter>,
      { session: adminSession({ permissions: [...permissions] }) },
    ),
    bundle,
  );
}

/** The admin's own unknown-path answer, rendered by `ModuleRoute`'s gate. */
const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;

interface Gateway {
  readonly id: string;
  readonly route: string;
  /**
   * What the screen puts on the page when it renders.
   *
   * Four of the five render `t('page.title')` and are matched by its
   * passthrough placeholder. `stripe` renders the literal string `Stripe`,
   * because that screen calls no `useTranslation` at all — the 29 English
   * sentences behind that fact are its entry in
   * `HARDCODED_STRINGS_BASELINE`, re-keyed by this batch and drained by
   * nobody yet.
   */
  readonly heading: RegExp;
  /** The code the screen's own configuration endpoint enforces. */
  readonly code: string;
  /** The module's write code — a real near-miss, held instead of `code`. */
  readonly nearMiss: string;
  readonly contributions: AdminContributions;
  readonly page: string;
  readonly specifier: string;
}

const GATEWAYS: readonly Gateway[] = [
  {
    id: 'autopay',
    route: '/settings/autopay',
    heading: /page\.title/,
    code: 'autopay:read',
    nearMiss: 'autopay:write',
    contributions: autopayContributions,
    page: '../packages/modules/autopay/src/admin/pages/AutopaySettingsPage.tsx',
    specifier: '@endora-commerce/mod-autopay/admin',
  },
  {
    id: 'paypal',
    route: '/settings/paypal',
    heading: /page\.title/,
    code: 'paypal:read',
    nearMiss: 'paypal:write',
    contributions: paypalContributions,
    page: '../packages/modules/paypal/src/admin/pages/PaypalSettingsPage.tsx',
    specifier: '@endora-commerce/mod-paypal/admin',
  },
  {
    id: 'payu',
    route: '/settings/payu',
    heading: /page\.title/,
    code: 'payu:read',
    nearMiss: 'payu:write',
    contributions: payuContributions,
    page: '../packages/modules/payu/src/admin/pages/PayuSettingsPage.tsx',
    specifier: '@endora-commerce/mod-payu/admin',
  },
  {
    id: 'stripe',
    route: '/settings/stripe',
    heading: /^Stripe$/,
    code: 'stripe:read',
    nearMiss: 'stripe:write',
    contributions: stripeContributions,
    page: '../packages/modules/stripe/src/admin/pages/StripeSettingsPage.tsx',
    specifier: '@endora-commerce/mod-stripe/admin',
  },
  {
    id: 'tpay',
    route: '/settings/tpay',
    heading: /page\.title/,
    code: 'tpay:read',
    nearMiss: 'tpay:write',
    contributions: tpayContributions,
    page: '../packages/modules/tpay/src/admin/pages/TpaySettingsPage.tsx',
    specifier: '@endora-commerce/mod-tpay/admin',
  },
];

describe.each(GATEWAYS)('$id owns its admin surface, and its proof is the route', (gateway) => {
  const headingIsRendered = (): boolean => screen.queryAllByText(gateway.heading).length > 0;

  it('renders the screen while the module is present and the code is held', async () => {
    presentModules = new Set([gateway.id]);
    permissions = new Set([gateway.code]);
    renderAt(gateway.route);
    await waitFor(() => expect(headingIsRendered()).toBe(true));
  });

  it('renders the not-found treatment while the module is switched off', async () => {
    presentModules = new Set();
    permissions = new Set([gateway.code]);
    renderAt(gateway.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(headingIsRendered()).toBe(false);
  });

  it('renders the not-found treatment for an operator holding only the write code', async () => {
    presentModules = new Set([gateway.id]);
    permissions = new Set([gateway.nearMiss]);
    renderAt(gateway.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(headingIsRendered()).toBe(false);
  });

  it('restores the screen when the module comes back, with no rebuild', async () => {
    presentModules = new Set();
    permissions = new Set([gateway.code]);
    const off = renderAt(gateway.route);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    off.unmount();

    presentModules = new Set([gateway.id]);
    renderAt(gateway.route);
    await waitFor(() => expect(headingIsRendered()).toBe(true));
  });

  it('declares one lazily-loaded route, one gate, and no nav entry', async () => {
    // FR-013, and the declaration this file is about. `nav` being absent is the
    // contribution set saying so, which is what Ruling 1 asks a nav-less batch
    // member's test to derive rather than assert by omission.
    const routes = gateway.contributions.routes ?? [];
    expect(routes.map((route) => route.path)).toEqual([gateway.route]);
    expect(routes.map((route) => route.requiredPermission)).toEqual([gateway.code]);
    expect(gateway.contributions.nav ?? []).toEqual([]);
    expect(gateway.contributions.zones ?? []).toEqual([]);
    const loaded = await routes[0]!.component();
    expect(typeof loaded.default).toBe('function');
  });

  it('takes no `@/` reach out of the package, and names no other module', () => {
    // Two assertions on one text, and the second is the drain. The alias
    // resolves to `admin/src` and to nothing a package can reach, so a
    // surviving `@/` would be a screen that compiles here and not in a
    // consumer's install; and `dictionaryClient` is the specific reach this
    // batch paid, so its absence is what the deleted ledger shard now rests on.
    const source = sourceOf(gateway.page);
    expect(source).not.toMatch(/^import .* from '@\//m);
    expect(source).not.toContain('dictionaryClient');
    expect(source).not.toContain('@endora-commerce/mod-dictionaries');
  });

  it('resolves through its package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain(`from '${gateway.specifier}'`);
  });
});

describe('the shell no longer names any of the five by hand', () => {
  it('has no host route for any of the screens, and none ever had a nav entry', () => {
    const app = sourceOf('src/App.tsx');
    const shell = sourceOf('src/components/AppShell.tsx');
    for (const gateway of GATEWAYS) {
      expect(app).not.toContain(`modules/${gateway.id}`);
      expect(app).not.toContain(`path="${gateway.route}"`);
      expect(shell).not.toContain(`to: '${gateway.route}'`);
    }
  });

  it('keeps the registry free of relative package paths', () => {
    expect(sourceOf('src/modules.generated.ts')).not.toContain('packages/modules');
  });

  it('leaves the five gateways each holding their own country call', () => {
    // The drain, asserted where it was paid: one `listCountries` per package,
    // built from the published `apiClient`. Duplicated deliberately — the only
    // place five modules could share it is `@endora-commerce/admin-kit`, and
    // the kit holds no module knowledge (R6), `/api/v1/admin/dictionary/
    // countries` being `dictionaries`' knowledge.
    for (const gateway of GATEWAYS) {
      const client = sourceOf(
        `../packages/modules/${gateway.id}/src/admin/api/${gateway.id}-client.ts`,
      );
      expect(client).toContain('export const listCountries');
      expect(client).toContain('/api/v1/admin/dictionary/countries?pageSize=250&sort=label');
    }
  });
});
