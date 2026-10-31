import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { parseBundleKeywords } from '@endora-commerce/contracts';
import type { AdminActionView, GetAdminActionsResponse, SupportedAdminLanguage } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, everyDeclaredModule, modulePresence, withSession } from '../helpers/render-with-session';
import { AdminActionsProvider } from '../../../packages/admin-shell/src/lib/admin-actions/AdminActionsProvider';
import { manifest as salesChannelsManifest } from '../../../packages/modules/sales_channels/src/manifest';
import enBundle from '../../../packages/modules/sales_channels/i18n/en.json';
import plBundle from '../../../packages/modules/sales_channels/i18n/pl.json';

/**
 * Owner-reported: the ⌘K palette did not find the Sales channels screen
 * (`Kanały sprzedaży`) — Constitution XVI.
 *
 * The rows below are built from **the shipped declaration**, not a hand-written
 * fixture: the manifest's `actions` and the module's own bundles, resolved the
 * way `AdminActionsService` resolves them. So the test pins what an operator
 * can actually type, and drifts with the declaration rather than away from it.
 */

vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 500 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

const BUNDLES: Record<SupportedAdminLanguage, Record<string, string>> = {
  en: enBundle as Record<string, string>,
  pl: plBundle as Record<string, string>,
} as Record<SupportedAdminLanguage, Record<string, string>>;

/** The rows the server sends for this module, in `language`. */
function servedRows(language: SupportedAdminLanguage): AdminActionView[] {
  const bundle = BUNDLES[language];
  return (salesChannelsManifest.actions ?? []).map((action) => ({
    moduleId: salesChannelsManifest.id,
    actionId: action.id,
    label: bundle[action.labelKey] ?? `${salesChannelsManifest.id}.${action.labelKey}`,
    description: action.descriptionKey ? (bundle[action.descriptionKey] ?? null) : null,
    icon: action.icon,
    targetRoute: action.targetRoute,
    // The manifest's English words, then the ones its `keywordsKey` resolves
    // to in `language` (issues #560, #573), as `AdminActionsService` serves them.
    keywords: [
      ...new Set([
        ...(action.keywords ?? []),
        ...(action.keywordsKey ? parseBundleKeywords(bundle[action.keywordsKey] ?? '') : []),
      ]),
    ],
    weight: action.weight ?? 100,
  }));
}

let currentResponse: GetAdminActionsResponse;

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/api', () => ({
  getAdminActions: vi.fn(async () => currentResponse),
}));

const { AppShell, resetPromptCapabilityCacheForTesting } = await import(
  '../../../packages/admin-shell/src/components/AppShell'
);

const coreBundle = passthroughBundle('core', [
  'appShell.brand.text',
  'appShell.search.placeholder',
  'appShell.search.openPalette',
  'appShell.search.shortcutSymbol',
  'appShell.search.commandPalettePlaceholder',
  'appShell.search.noMatches',
  'appShell.palette.group.navigate',
  'appShell.palette.group.actions',
]);

async function paletteRowsForEach(
  language: SupportedAdminLanguage,
  queries: readonly string[],
): Promise<string[][]> {
  const data = servedRows(language);
  currentResponse = { data, meta: { language, total: data.length, registryVersion: 1 } };
  renderWithI18n(
    withSession(
      <AdminActionsProvider language={language} initial={currentResponse}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<div>Home content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AdminActionsProvider>,
      {
        session: adminSession({ permissions: ['*'], preferredLanguage: language }),
        presence: modulePresence({ present: everyDeclaredModule() }),
      },
    ),
    coreBundle,
  );
  await userEvent.click(screen.getByPlaceholderText('appShell.search.placeholder'));
  const dialog = await screen.findByRole('dialog');
  const input = dialog.querySelector('.b2b-palette__input input') as HTMLInputElement;
  return queries.map((query) => {
    fireEvent.change(input, { target: { value: query } });
    return [...dialog.querySelectorAll('.b2b-palette__item')].map((el) => el.textContent ?? '');
  });
}

const POLISH_QUERIES = [
  'kanały',
  'kanaly',
  'Kanały sprzedaży',
  'kanaly sprzedazy',
  'kanał sprzedaży',
  'kanal sprzedazy',
  'kanał',
  'sprzedaży',
] as const;

const ENGLISH_QUERIES = ['sales channels', 'Sales channel', 'channels', 'channel'] as const;

describe('AppShell palette — the Sales channels screen is reachable (Constitution XVI)', () => {
  beforeEach(() => {
    resetPromptCapabilityCacheForTesting();
  });

  // Issue #573 — a Polish search word is served from `pl.json`, so it finds the
  // screen in a Polish-language admin; an English-language admin is served the
  // manifest's English words and its own bundle's.
  it.each(['pl'] as const)(
    'finds the Sales channels roster for every Polish query, in a %s-language admin',
    async (language) => {
      const label = BUNDLES[language]['actions.openSalesChannels.label'] as string;
      const results = await paletteRowsForEach(language, POLISH_QUERIES);
      POLISH_QUERIES.forEach((query, i) => {
        expect({ query, found: results[i]?.some((text) => text.includes(label)) }).toEqual({
          query,
          found: true,
        });
      });
    },
  );

  it.each(['pl', 'en'] as const)(
    'finds the Sales channels roster for every English query, in a %s-language admin',
    async (language) => {
      const label = BUNDLES[language]['actions.openSalesChannels.label'] as string;
      const results = await paletteRowsForEach(language, ENGLISH_QUERIES);
      ENGLISH_QUERIES.forEach((query, i) => {
        expect({ query, found: results[i]?.some((text) => text.includes(label)) }).toEqual({
          query,
          found: true,
        });
      });
    },
  );
});
