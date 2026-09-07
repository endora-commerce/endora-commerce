import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GetAdminActionsResponse } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, everyDeclaredModule, modulePresence, withSession } from '../helpers/render-with-session';
import { AdminActionsProvider } from '../../../packages/admin-shell/src/lib/admin-actions/AdminActionsProvider';

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



vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
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

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/api', () => ({
  getAdminActions: vi.fn(async () => ACTIONS_RESPONSE),
}));

const shellModule = await import('../../../packages/admin-shell/src/components/AppShell');
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
    //
    // The two `appShell.*orders*` keys stood here until feature 091's Phase 4
    // batch 15 retired them with the `/orders` Navigate row they labelled. The
    // dashboard pair is what is left, and it is what the Navigate half of every
    // case below now reads — see the note on the first one.
    'appShell.nav.home': 'Strona główna',
    'appShell.palette.sub.dashboard': 'Pulpit',
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
  return (await paletteRowsForEach([query]))[0] as string[];
}

/**
 * The same, for **several** queries against one dialog.
 *
 * Feature 091's Phase 4 batch 15 left the Navigate group with one row — the
 * dashboard, the admin application's own — and no shipped action shares a
 * foldable token with it, so a case that exercises both indexes now needs two
 * queries. Typing them into the same input keeps the property this file is
 * built on and which a second `renderShell()` would have lost: **one render of
 * one dialog**, so a fold applied to one index and not the other fails here
 * rather than in production.
 */
async function paletteRowsForEach(queries: readonly string[]): Promise<string[][]> {
  renderShell();
  await userEvent.click(screen.getByPlaceholderText('appShell.search.placeholder'));
  const dialog = await screen.findByRole('dialog');
  const input = dialog.querySelector('.b2b-palette__input input') as HTMLInputElement;
  return queries.map((query) => {
    fireEvent.change(input, { target: { value: query } });
    return [...dialog.querySelectorAll('.b2b-palette__item')].map((el) => el.textContent ?? '');
  });
}

describe('AppShell palette — one matching rule for every group (issue #233)', () => {
  beforeEach(() => {
    resetPromptCapabilityCacheForTesting();
    capabilityStatus = 'disabled';
  });

  it('matches both the Navigate and the Actions row for an unaccented query', async () => {
    // **The two halves take two queries since feature 091's Phase 4 batch 15**,
    // and the reason is worth stating because the one-query shape is what this
    // file was written around. That batch moved the `/orders` Navigate row into
    // `orders`' manifest, leaving `PALETTE_ITEMS` with exactly one row — the
    // dashboard, `module: null`, the admin application's own, which no batch can
    // drain and which the stroked-`ł` case below already re-based onto for the
    // same reason. Measured over every shipped `actions.*` Polish string: none
    // shares a foldable token with `Strona główna` or `Pulpit`, so no single
    // query can reach both groups any more.
    //
    // What the case still proves is the property it exists for — a fold applied
    // to one index and not the other fails here — because each assertion names
    // the group whose index it exercises, and both queries are typed into the
    // **same** input of the **same** dialog. `paletteRowsForEach` is what keeps
    // that: a second `renderShell()` would have been a second dialog, which is
    // precisely the arrangement this file was written to avoid.
    const [actions, navigate] = await paletteRowsForEach(['zamowienia', 'glowna']);
    // Actions — has folded since feature 020.
    expect(actions?.some((text) => text.includes('Otwórz zamówienia'))).toBe(true);
    // Navigate — the half that did not.
    expect(navigate?.some((text) => text.includes('Strona główna'))).toBe(true);
  });

  it('matches both rows for the fully accented spelling as well', async () => {
    // Guards the other half of "normalise both sides": folding only the
    // haystack would drop this one, because the stored keyword folds to
    // `zamowienia` while the query still carries its diacritics.
    const [actions, navigate] = await paletteRowsForEach(['zamówienia', 'główna']);
    expect(actions?.some((text) => text.includes('Otwórz zamówienia'))).toBe(true);
    expect(navigate?.some((text) => text.includes('Strona główna'))).toBe(true);
  });

  it('folds the stroked ł, which NFD decomposition leaves standing', async () => {
    // `Strona główna` is the label of the `/` Navigate entry. A naive
    // `normalize('NFD').replace(/\p{Diacritic}/gu, '')` yields `strona główna`
    // — still no match for `glowna` — so this case is what separates the shared
    // helper from a plausible-looking reimplementation of it.
    //
    // **It has moved twice and this one is meant to be the last.** It was
    // `płatności` on `/payment-methods` until feature 091's batch 7 moved that
    // row into `@endora-commerce/mod-payment-methods`; the replacement was
    // `słownik` on `/dictionary`, chosen because `dictionaries` was then the
    // drain's *last* batch — and the re-derivation of 2026-09-01 made it batch
    // 10, three days later, so the same positive control went red again for
    // the same reason. The dashboard row is the one entry in `PALETTE_ITEMS`
    // that carries `module: null`: it is the admin application's own, no batch
    // can drain it, and its shipped Polish label carries a stroked `ł`. That is
    // a structural answer rather than another guess about the schedule.
    const rows = await paletteRowsFor('glowna');
    expect(rows.some((text) => text.includes('Strona główna'))).toBe(true);
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
    const [actions, navigate] = await paletteRowsForEach([' zamowienia ', ' glowna ']);
    expect(actions?.some((text) => text.includes('Otwórz zamówienia'))).toBe(true);
    expect(navigate?.some((text) => text.includes('Strona główna'))).toBe(true);
  });

  it('lists every row for a whitespace-only query, as it does for an empty one', async () => {
    // **The one case that still reaches both groups from one render**, which is
    // the property the first case's note says it gives up: an empty query
    // filters nothing, so the Navigate row and the Actions row are both in the
    // list this render produced.
    const rows = await paletteRowsFor('   ');
    expect(rows.some((text) => text.includes('Otwórz zamówienia'))).toBe(true);
    expect(rows.some((text) => text.includes('Strona główna'))).toBe(true);
  });

  it('still filters — an unrelated query matches no row in any group', async () => {
    const rows = await paletteRowsFor('xyzzy');
    expect(rows).toEqual([]);
    expect(screen.getByText('appShell.search.noMatches')).toBeTruthy();
  });
});
