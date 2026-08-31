import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GetAdminActionsResponse, ModulePresence } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, everyDeclaredModule, modulePresence, withSession } from '../helpers/render-with-session';
import { AdminActionsProvider } from '../../src/lib/admin-actions/AdminActionsProvider';

/**
 * Issue #233 item 3 — the palette's two indexes matched differently.
 *
 * The ⌘K dialog merges three groups. The server-fed Actions group has always
 * filtered through `lib/text-normalization.ts`, which folds diacritics and
 * the stroked letters NFD leaves alone; the static Navigate group and the
 * pinned Assistant row filtered with a bare `toLowerCase().includes()`. So
 * `zamowienia` — how a Polish operator types it on a hurry, or on a keyboard
 * without the AltGr habit — found the Actions row for orders and not the
 * Navigate row for the same screen. Half the palette silently stopped matching.
 *
 * Every case below runs both halves through **one** render of **one** dialog,
 * so a fix applied to one index and not the other fails here rather than in
 * production. That is the property worth pinning: not "Navigate folds", but
 * "the two groups answer the same question the same way" (Law of Similarity —
 * rows that look identical must behave identically).
 *
 * Postel's Law is the reason the behaviour is required at all: search accepts
 * what the operator typed and normalises it, rather than demanding the exact
 * spelling the data happens to carry.
 */

const grantedPermissions = new Set<string>(['*']);
let capabilityStatus: 'ready' | 'disabled' = 'disabled';



vi.mock('@/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('@/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('@/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: capabilityStatus, bulkLimit: 500 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

/**
 * `useAdminActions` is deliberately **not** mocked: it is the half that already
 * works, and stubbing it would turn "the Actions row still matches" into an
 * assertion about the stub. Only the network call underneath it is replaced.
 */
const ACTIONS_RESPONSE: GetAdminActionsResponse = {
  data: [
    {
      moduleId: 'orders',
      actionId: 'open-orders',
      // Verbatim from `backend/src/modules/orders/i18n/pl.json` and the
      // `open-orders` entry of that module's manifest.
      label: 'Otwórz zamówienia',
      description: 'Przeglądaj i zarządzaj zamówieniami klientów',
      icon: 'ShoppingCart',
      targetRoute: '/orders',
      keywords: ['orders', 'sales', 'zamówienia', 'sprzedaż'],
      weight: 220,
    },
  ],
  meta: { language: 'pl', total: 1, registryVersion: 1 },
};

vi.mock('@/lib/admin-actions/api', () => ({
  getAdminActions: vi.fn(async () => ACTIONS_RESPONSE),
}));

const shellModule = await import('../../src/components/AppShell');
const { AppShell, resetPromptCapabilityCacheForTesting } = shellModule;

/**
 * Passthrough for the chrome, real Polish for the strings under test. The
 * defect is about what the operator actually reads, so the labels have to be
 * the shipped copy rather than their keys.
 */
const coreBundle = {
  core: {
    ...passthroughBundle('core', [
      'appShell.brand.text',
      'appShell.search.placeholder',
      'appShell.search.openPalette',
      'appShell.search.shortcutSymbol',
      'appShell.search.commandPalettePlaceholder',
      'appShell.search.noMatches',
      'appShell.palette.group.navigate',
      'appShell.palette.group.actions',
    ]).core,
    // Verbatim from `packages/modules/_i18n/i18n/pl.json`.
    'appShell.nav.orders': 'Zamówienia',
    'appShell.palette.sub.openOrders': 'Otwarte i ostatnie zamówienia',
    'appShell.nav.paymentMethods': 'Metody płatności',
    'appShell.palette.sub.paymentMethods': 'Bramki i metody płatności',
  },
  prompt_actions: {
    'palette.group.label': 'palette.group.label',
    'panel.inputPlaceholder': 'panel.inputPlaceholder',
    'panel.unseenNotice': 'panel.unseenNotice',
    // Verbatim from `backend/src/modules/prompt_actions/i18n/pl.json`.
    'palette.entry.label': 'Zapytaj asystenta',
    'palette.entry.description': 'Opisz, co chcesz zrobić, własnymi słowami',
  },
};

function renderShell(): void {
  renderWithI18n(
    withSession(
      <AdminActionsProvider language="pl" initial={ACTIONS_RESPONSE}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<div>Home content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AdminActionsProvider>,
      { session: adminSession({ permissions: [...grantedPermissions], preferredLanguage: 'pl' }), presence: modulePresence({ present: everyDeclaredModule() }) },
    ),
    coreBundle,
  );
}

/**
 * Scoped to the dialog on purpose: the Navigate labels also appear in the
 * sidebar, and a document-wide query would pass on the sidebar row while the
 * palette matched nothing — which is the defect under test.
 */
async function paletteRowsFor(query: string): Promise<string[]> {
  renderShell();
  await userEvent.click(screen.getByPlaceholderText('appShell.search.placeholder'));
  const dialog = await screen.findByRole('dialog');
  const input = dialog.querySelector('.b2b-palette__input input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: query } });
  return [...dialog.querySelectorAll('.b2b-palette__item')].map((el) => el.textContent ?? '');
}

describe('AppShell palette — one matching rule for every group (issue #233)', () => {
  beforeEach(() => {
    resetPromptCapabilityCacheForTesting();
    capabilityStatus = 'disabled';
  });

  it('matches both the Navigate and the Actions row for an unaccented query', async () => {
    const rows = await paletteRowsFor('zamowienia');
    // Actions — has folded since feature 020.
    expect(rows.some((text) => text.includes('Otwórz zamówienia'))).toBe(true);
    // Navigate — the half that did not.
    expect(rows.some((text) => text.includes('Zamówienia'))).toBe(true);
  });

  it('matches both rows for the fully accented spelling as well', async () => {
    // Guards the other half of "normalise both sides": folding only the
    // haystack would drop this one, because the stored keyword folds to
    // `zamowienia` while the query still carries its diacritics.
    const rows = await paletteRowsFor('zamówienia');
    expect(rows.some((text) => text.includes('Otwórz zamówienia'))).toBe(true);
    expect(rows.some((text) => text.includes('Zamówienia'))).toBe(true);
  });

  it('folds the stroked ł, which NFD decomposition leaves standing', async () => {
    // `płatności` is a real keyword on the `/payment-methods` Navigate entry.
    // A naive `normalize('NFD').replace(/\p{Diacritic}/gu, '')` yields
    // `płatnosci` — still no match — so this case is what separates the shared
    // helper from a plausible-looking reimplementation of it.
    const rows = await paletteRowsFor('platnosci');
    expect(rows.some((text) => text.includes('Metody płatności'))).toBe(true);
  });

  it('folds the pinned Assistant row too, so no group is left behind', async () => {
    capabilityStatus = 'ready';
    // `zrobić` lives in the assistant's Polish description.
    const rows = await paletteRowsFor('zrobic');
    expect(rows.some((text) => text.includes('Zapytaj asystenta'))).toBe(true);
  });

  it('ignores whitespace around the query, in every group', async () => {
    // Issue #236 item 3. The query was folded but never trimmed, so one
    // leading space — a stray keystroke, or the space left behind by pasting
    // a copied label — emptied the palette with no explanation, on the one
    // surface whose entire job is to be forgiving (Postel's Law).
    const rows = await paletteRowsFor(' zamowienia ');
    expect(rows.some((text) => text.includes('Otwórz zamówienia'))).toBe(true);
    expect(rows.some((text) => text.includes('Zamówienia'))).toBe(true);
  });

  it('lists every row for a whitespace-only query, as it does for an empty one', async () => {
    const rows = await paletteRowsFor('   ');
    expect(rows.some((text) => text.includes('Otwórz zamówienia'))).toBe(true);
    expect(rows.some((text) => text.includes('Zamówienia'))).toBe(true);
  });

  it('still filters — an unrelated query matches no row in any group', async () => {
    const rows = await paletteRowsFor('xyzzy');
    expect(rows).toEqual([]);
    expect(screen.getByText('appShell.search.noMatches')).toBeTruthy();
  });
});
