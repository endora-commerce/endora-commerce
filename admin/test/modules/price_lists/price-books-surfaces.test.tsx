import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setMobileViewport } from '../../setup';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../../src/modules.generated.js';

/**
 * The price-book editor's routes, navigation and palette (feature 161, T042;
 * FR-028, FR-029; `research.md` R3).
 *
 * Five routes, static segments before `:id`; the sidebar entry returns from
 * P1's temporary landing on `/price-lists/display-modes` to the book list on
 * `/price-lists`; four palette actions (the fourth, *Pricing settings*, by the Checkpoint 10 ruling). Each route is driven on its own,
 * through the real `<App/>` over the generated registry, on both axes a route
 * has: the permission code and the module's presence. A positive case comes
 * first everywhere, because an absence proves nothing until the presence has
 * been seen.
 *
 * The palette's *filter* is the server's (`AdminActionsService`, both presence
 * axes and the permission); `backend/test/unit/price_lists/palette-actions.test.ts`
 * drives it over this module's declared actions. What is asserted here is the
 * declaration and its agreement with the routes it advertises, so the palette
 * never offers a screen the advertised code cannot open.
 */

vi.mock('../../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../../packages/admin-shell/src/lib/admin-actions/AdminActionsProvider', () => ({
  AdminActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('../../../../packages/admin-shell/src/components/IdleLogout', () => ({
  IdleLogout: () => null,
}));

vi.mock('../../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

// Every screen reads on mount; the book's own read answers the fixture book, so
// its page renders the book's name as its heading.
// (The fixture cannot be imported inside the factory: it reaches this very
// module through the session helpers, so it is handed over after the imports.)
const served = vi.hoisted(() => ({ book: null as { id: string } | null }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async (url: string) =>
        served.book && url === `/api/v1/admin/price-books/${served.book.id}` ? { data: served.book } : { data: { items: [] } },
      ),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../../../packages/admin-shell/src/App');
const { contributions } = await import('@endora-commerce/mod-price-lists/admin');
const { manifest } = await import('@endora-commerce/mod-price-lists');

const { BOOKS } = await import('../../helpers/price-book-fixtures');
served.book = BOOKS.L2;
const BOOK_ID = BOOKS.L2.id;

const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.pricing',
    'app.moduleScreenLoading',
    'app.notFound',
    'priceLists.displayModes.title',
  ]),
  ...passthroughBundle('price_lists', [
    'nav.priceLists.label',
    'priceBooks.list.title',
    'priceBooks.create.title',
    'priceBooks.explainer.title',
    'priceBooks.list.pricingSettings',
  ]),
};

function renderAt(path: string, options: { permissions: readonly string[]; present?: boolean }): RenderResult {
  setMobileViewport(false);
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <App
          contributions={MODULE_ADMIN_CONTRIBUTIONS}
          modulePresence={
            options.present === false
              ? modulePresence({ absent: ['price_lists'] })
              : modulePresence({ present: ['price_lists'] })
          }
        />
      </MemoryRouter>,
      { session: adminSession({ permissions: [...options.permissions] }) },
    ),
    bundle,
  );
}

const sidebarHrefs = (): (string | null)[] =>
  [...document.querySelectorAll('.b2b-sidebar a')].map((a) => a.getAttribute('href'));

const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;

/**
 * Matched unanchored, as the sibling surface tests match: `<App/>` mounts its
 * own translation provider, which renders a key it holds no bundle for as
 * `<scope>.<key>`.
 */
const headingIsRendered = (key: string): boolean =>
  screen.queryAllByText(new RegExp(key.replace(/\./g, '\\.'))).length > 0;

const READ = 'price_lists:read';
const WRITE = 'price_lists:write';

/** Every route, its heading, and the code it opens on. */
const ROUTES: readonly { path: string; heading: string; code: string }[] = [
  { path: '/price-lists', heading: 'priceBooks.list.title', code: READ },
  { path: '/price-lists/new', heading: 'priceBooks.create.title', code: WRITE },
  { path: '/price-lists/explain', heading: 'priceBooks.explainer.title', code: READ },
  { path: '/price-lists/display-modes', heading: 'priceLists.displayModes.title', code: READ },
  // The book's page is headed by the book's own name.
  { path: `/price-lists/${BOOK_ID}`, heading: BOOKS.L2.name, code: READ },
];

describe('price_lists — routes', () => {
  it('declares the five routes, static segments before `:id`, each on its code', () => {
    expect(contributions.routes?.map((route) => [route.path, route.requiredPermission])).toEqual([
      ['/price-lists', READ],
      ['/price-lists/new', WRITE],
      ['/price-lists/explain', READ],
      ['/price-lists/display-modes', READ],
      ['/price-lists/:id', READ],
    ]);
    for (const route of contributions.routes ?? []) expect(typeof route.component).toBe('function');
    expect(contributions.routes?.find((route) => route.index === true)?.path).toBe('/price-lists');
  });

  it('opens every screen to an operator holding both codes', async () => {
    for (const route of ROUTES) {
      const rendered = renderAt(route.path, { permissions: [READ, WRITE] });
      await waitFor(() => expect(headingIsRendered(route.heading), route.path).toBe(true));
      rendered.unmount();
    }
  });

  it('opens the read screens, and not the create screen, to a reader', async () => {
    for (const route of ROUTES) {
      const rendered = renderAt(route.path, { permissions: [READ] });
      if (route.code === READ) {
        await waitFor(() => expect(headingIsRendered(route.heading), route.path).toBe(true));
      } else {
        await waitFor(() => expect(notFoundIsRendered(), route.path).toBe(true));
        expect(headingIsRendered(route.heading)).toBe(false);
      }
      rendered.unmount();
    }
  });

  it('opens nothing to an operator without the pricing codes', async () => {
    for (const route of ROUTES) {
      const rendered = renderAt(route.path, { permissions: ['catalog:read'] });
      await waitFor(() => expect(notFoundIsRendered(), route.path).toBe(true));
      expect(headingIsRendered(route.heading)).toBe(false);
      rendered.unmount();
    }
  });

  it('answers every address as for an absent module where the platform does not offer it (FR-029)', async () => {
    for (const route of ROUTES) {
      const rendered = renderAt(route.path, { permissions: [READ, WRITE], present: false });
      await waitFor(() => expect(notFoundIsRendered(), route.path).toBe(true));
      expect(headingIsRendered(route.heading)).toBe(false);
      rendered.unmount();
    }
  });
});

describe('price_lists — navigation', () => {
  it('has one sidebar entry, and it opens the book list on /price-lists', () => {
    expect(contributions.nav?.map((item) => [item.to, item.requiredPermission, item.section])).toEqual([
      ['/price-lists', READ, 'pricing'],
    ]);
    renderAt('/', { permissions: [READ] });
    expect(sidebarHrefs()).toContain('/price-lists');
    expect(sidebarHrefs()).not.toContain('/price-lists/display-modes');
  });

  it('has no sidebar entry without the read code or without the module', () => {
    const noCode = renderAt('/', { permissions: [WRITE] });
    expect(sidebarHrefs()).not.toContain('/price-lists');
    noCode.unmount();
    renderAt('/', { permissions: [READ], present: false });
    expect(sidebarHrefs()).not.toContain('/price-lists');
  });
});

describe('price_lists — Pricing settings from the list (Principle XVI)', () => {
  it('links Pricing settings from the price-book list header, for a reader too', async () => {
    renderAt('/price-lists', { permissions: [READ] });
    const link = await screen.findByRole('link', { name: /priceBooks\.list\.pricingSettings/ });
    expect(link).toHaveAttribute('href', '/price-lists/display-modes');
  });
});

describe('price_lists — palette actions (Principle XVI)', () => {
  it('declares the four actions on the codes their target routes open on', () => {
    const actions = manifest.actions ?? [];
    expect(actions.map((action) => [action.id, action.targetRoute, action.requiredPermission])).toEqual([
      ['open-price-lists', '/price-lists', READ],
      ['new-price-book', '/price-lists/new', WRITE],
      ['open-price-explainer', '/price-lists/explain', READ],
      // Coordinator ruling, Checkpoint 10 review (Principle XVI): *Pricing
      // settings* has no sidebar entry, so the palette is how it is reached.
      ['open-pricing-settings', '/price-lists/display-modes', READ],
    ]);
    // An action is only as reachable as the route it names (issue #232).
    for (const action of actions) {
      const route = contributions.routes?.find((r) => r.path === action.targetRoute);
      expect(route, action.id).toBeDefined();
      expect(route?.requiredPermission, action.id).toBe(action.requiredPermission);
    }
  });

  it('labels and describes every action in both shipped languages', () => {
    for (const language of ['en', 'pl'] as const) {
      const bundleOnDisk = JSON.parse(
        readFileSync(resolve(process.cwd(), `../packages/modules/price_lists/i18n/${language}.json`), 'utf8'),
      ) as Record<string, string>;
      for (const action of manifest.actions ?? []) {
        expect(bundleOnDisk[action.labelKey], `${language} ${action.labelKey}`).toBeTruthy();
        expect(bundleOnDisk[action.descriptionKey!], `${language} ${action.descriptionKey}`).toBeTruthy();
      }
      // The description no longer advertises P1's temporary landing.
      expect(bundleOnDisk['actions.openPriceLists.description']).not.toMatch(/display mode|tryby/i);
    }
  });
});
