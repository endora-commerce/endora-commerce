import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ModulePresenceProvider } from '@endora-commerce/admin-kit/lib';
import type { AdminModulePresenceResponse } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  withSession,
} from '../../helpers/render-with-session';

/**
 * The dashboard on a cold load.
 *
 * `App` mounts `ModulePresenceProvider` and the index route in the same commit
 * the session turns `authenticated` — after a hard reload on `/` and after
 * login alike — so `HomePage` always mounts **before** the presence projection
 * has arrived, while `isPresent` is still answering `false` for every module
 * (the provider is fail-closed until its first response). The tiles used to
 * decide what to fetch once, in a mount effect, against that answer: every
 * request was skipped, the tiles appeared a moment later when presence
 * resolved, and nothing ever went back for their numbers. Leaving the dashboard
 * and returning remounted the page under a resolved provider, which is why the
 * values "appeared after navigating away and back".
 *
 * `HomePage.permission-gating.test.tsx` could not see it: it seeds the provider
 * through `initial`, which is the warm state and never the cold one.
 *
 * ## The seam is `fetch`, and it is replaced before the kit loads
 *
 * The provider under test takes its transport from inside the kit, where no
 * `vi.mock` of a shell path reaches, and the kit's client captures the global
 * `fetch` once at module scope (`admin/test/setup.ts`). `vi.hoisted` runs after
 * the setup file and before this file's imports, which is the one moment a
 * replacement is seen by both the presence provider and the tiles — one
 * transport for both, as in the browser.
 */

type Reply = () => Promise<Response>;

const net = vi.hoisted(() => {
  const state = {
    routes: new Map<string, () => Promise<Response>>(),
    calls: [] as string[],
  };
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    state.calls.push(path);
    const reply = state.routes.get(path);
    if (reply === undefined) {
      throw new Error(`[HomePage.first-load] no reply registered for ${path}`);
    }
    return reply();
  }) as typeof fetch;
  return state;
});

vi.mock('../../../../packages/admin-shell/src/modules/home/RecentActivityCard', () => ({
  RecentActivityCard: () => <div data-testid="recent-activity" />,
}));

const { HomePage } = await import('../../../../packages/admin-shell/src/modules/home/HomePage');

const PRESENCE = '/api/v1/admin/module-presence';
const PRODUCTS = '/api/v1/admin/catalog/products?pageSize=1';
const QUOTES = '/api/v1/admin/quote-requests?status=Pending';
const ORDERS = '/api/v1/admin/orders?status=new';
const INVENTORY = '/api/v1/admin/inventory';
const LOW_STOCK = '/api/v1/admin/inventory/low-stock';

const BUNDLE = passthroughBundle('core', [
  'home.welcomeBack',
  'home.subtitle',
  'home.defaultName',
  'home.kpi.activeProducts',
  'home.kpi.pendingQuotes',
  'home.kpi.openOrders',
  'home.kpi.outOfStock',
  'home.kpi.loading',
  'home.kpi.error',
  'home.kpi.retry',
  'home.kpi.retryLabel',
  'home.quickActions.title',
  'home.quickActions.newProduct',
  'home.quickActions.editPricing',
  'home.quickActions.importInventory',
  'home.quickActions.convertQuote',
  'home.stockAlerts.title',
  'home.stockAlerts.subtitle',
  'home.stockAlerts.empty',
  'home.stockAlerts.seeAll',
  'home.stockAlerts.loading',
  'home.stockAlerts.error',
  'home.stockAlerts.retry',
  'home.stockAlerts.left',
  'home.stockAlerts.out',
]);

function json(body: unknown, status = 200): Reply {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
}

function failing(status = 500): Reply {
  return json({ error: { code: 'INTERNAL', message: 'boom' } }, status);
}

/** A reply the test settles by hand, so the pending state is observable. */
function deferred(): { reply: Reply; settle: (with_: Reply) => Promise<void> } {
  let release!: (response: Response | PromiseLike<Response>) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return {
    reply: () => pending,
    settle: async (with_: Reply): Promise<void> => {
      await act(async () => {
        release(with_());
        await pending.catch(() => undefined);
      });
    },
  };
}

const EVERY_MODULE: AdminModulePresenceResponse = modulePresence({ present: everyDeclaredModule() });

function answerEveryTile(): void {
  net.routes.set(PRODUCTS, json({ data: [], counts: { active: 42 } }));
  net.routes.set(QUOTES, json({ data: [{}, {}, {}] }));
  net.routes.set(ORDERS, json({ data: [{}, {}, {}, {}, {}, {}, {}] }));
  net.routes.set(INVENTORY, json({ data: { outOfStockCount: 5 } }));
  net.routes.set(
    LOW_STOCK,
    json({
      items: [
        {
          productId: 'p-1',
          productSku: 'SKU-1',
          productName: 'Low widget',
          cumulativeOnHand: 2,
          lowStockThreshold: 5,
        },
      ],
    }),
  );
}

/**
 * `presence` omitted is the cold load: the real provider, fetching for itself.
 * Supplied, it is the warm return — the provider already resolved when the page
 * mounts — which is the only state the dashboard used to work in.
 */
function renderHome(presence?: AdminModulePresenceResponse): void {
  renderWithI18n(
    withSession(
      <ModulePresenceProvider {...(presence === undefined ? {} : { initial: presence })}>
        <MemoryRouter initialEntries={['/']}>
          <HomePage />
        </MemoryRouter>
      </ModulePresenceProvider>,
      { session: adminSession({ permissions: ['*'] }) },
    ),
    BUNDLE,
  );
}

function tile(labelKey: string): HTMLElement {
  return screen.getByTestId(`kpi-${labelKey}`);
}

function requestsTo(path: string): number {
  return net.calls.filter((called) => called === path).length;
}

beforeEach(() => {
  net.routes.clear();
  net.calls.length = 0;
});

describe('HomePage — the first load, before module presence has resolved', () => {
  it('fetches every tile and the stock alerts once presence arrives', async () => {
    const presence = deferred();
    net.routes.set(PRESENCE, presence.reply);
    answerEveryTile();

    renderHome();

    // Fail-closed while unresolved: nothing is advertised, nothing is asked for.
    expect(screen.queryByText('home.kpi.activeProducts')).toBeNull();
    expect(net.calls).toEqual([PRESENCE]);

    await presence.settle(json(EVERY_MODULE));

    await waitFor(() => {
      expect(within(tile('home.kpi.activeProducts')).getByText('42')).toBeInTheDocument();
    });
    expect(within(tile('home.kpi.pendingQuotes')).getByText('3')).toBeInTheDocument();
    expect(within(tile('home.kpi.openOrders')).getByText('7')).toBeInTheDocument();
    expect(within(tile('home.kpi.outOfStock')).getByText('5')).toBeInTheDocument();
    expect(await screen.findByText('Low widget')).toBeInTheDocument();
  });

  it('fetches them when the presence request fails and the provider degrades open', async () => {
    net.routes.set(PRESENCE, failing(503));
    answerEveryTile();

    renderHome();

    await waitFor(() => {
      expect(within(tile('home.kpi.activeProducts')).getByText('42')).toBeInTheDocument();
    });
    expect(await screen.findByText('Low widget')).toBeInTheDocument();
  });

  it('asks each endpoint once per page load, cold or warm', async () => {
    const presence = deferred();
    net.routes.set(PRESENCE, presence.reply);
    answerEveryTile();

    renderHome();
    await presence.settle(json(EVERY_MODULE));
    await screen.findByText('Low widget');
    await waitFor(() => {
      expect(within(tile('home.kpi.outOfStock')).getByText('5')).toBeInTheDocument();
    });

    for (const path of [PRODUCTS, QUOTES, ORDERS, INVENTORY, LOW_STOCK]) {
      expect(requestsTo(path), path).toBe(1);
    }
  });
});

describe('HomePage — a tile says what state its number is in', () => {
  it('reads as loading while its request is pending, not as an empty value', async () => {
    answerEveryTile();
    const products = deferred();
    net.routes.set(PRODUCTS, products.reply);

    renderHome(EVERY_MODULE);

    const pending = tile('home.kpi.activeProducts');
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(within(pending).getByText('home.kpi.loading')).toBeInTheDocument();
    expect(within(pending).queryByText('—')).toBeNull();

    await products.settle(json({ data: [], counts: { active: 42 } }));

    await waitFor(() => {
      expect(within(tile('home.kpi.activeProducts')).getByText('42')).toBeInTheDocument();
    });
    expect(tile('home.kpi.activeProducts')).not.toHaveAttribute('aria-busy', 'true');
    expect(within(tile('home.kpi.activeProducts')).queryByText('home.kpi.loading')).toBeNull();
  });

  it('reports a failed request and recovers on retry, leaving its neighbours alone', async () => {
    answerEveryTile();
    net.routes.set(PRODUCTS, failing());

    renderHome(EVERY_MODULE);

    const failed = await screen.findByTestId('kpi-home.kpi.activeProducts-error');
    expect(within(failed).getByRole('alert')).toHaveTextContent('home.kpi.error');
    // A failure is not a number: neither a stale placeholder nor a zero.
    expect(within(failed).queryByText('—')).toBeNull();
    await waitFor(() => {
      expect(within(tile('home.kpi.openOrders')).getByText('7')).toBeInTheDocument();
    });

    net.routes.set(PRODUCTS, json({ data: [], counts: { active: 42 } }));
    fireEvent.click(within(failed).getByRole('button', { name: 'home.kpi.retryLabel' }));

    await waitFor(() => {
      expect(within(tile('home.kpi.activeProducts')).getByText('42')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('kpi-home.kpi.activeProducts-error')).toBeNull();
    expect(requestsTo(PRODUCTS)).toBe(2);
    expect(requestsTo(ORDERS), 'a retry belongs to one tile, not to the page').toBe(1);
  });
});

describe('HomePage — the stock-alerts card does not report a failure as "nothing is low"', () => {
  it('reads as loading while its request is pending', async () => {
    answerEveryTile();
    const lowStock = deferred();
    net.routes.set(LOW_STOCK, lowStock.reply);

    renderHome(EVERY_MODULE);

    expect(screen.getByTestId('stock-alerts-loading')).toBeInTheDocument();
    expect(screen.queryByText('home.stockAlerts.empty')).toBeNull();

    await lowStock.settle(json({ items: [] }));

    expect(await screen.findByText('home.stockAlerts.empty')).toBeInTheDocument();
    expect(screen.queryByTestId('stock-alerts-loading')).toBeNull();
  });

  it('reports a failed request and recovers on retry', async () => {
    answerEveryTile();
    const rows = net.routes.get(LOW_STOCK) as Reply;
    net.routes.set(LOW_STOCK, failing());

    renderHome(EVERY_MODULE);

    expect(await screen.findByText('home.stockAlerts.error')).toBeInTheDocument();
    expect(screen.queryByText('home.stockAlerts.empty')).toBeNull();

    net.routes.set(LOW_STOCK, rows);
    fireEvent.click(screen.getByRole('button', { name: 'home.stockAlerts.retry' }));

    expect(await screen.findByText('Low widget')).toBeInTheDocument();
    expect(screen.queryByText('home.stockAlerts.error')).toBeNull();
  });
});
