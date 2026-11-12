import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { parseBundleKeywords } from '@endora-commerce/contracts';
import type { AdminActionView, GetAdminActionsResponse, SupportedAdminLanguage } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, everyDeclaredModule, modulePresence, withSession } from '../helpers/render-with-session';
import { AdminActionsProvider } from '../../../packages/admin-shell/src/lib/admin-actions/AdminActionsProvider';
import { manifest as lifecycleManifest } from '../../../packages/platform/src/lifecycle/manifest';
import enBundle from '../../../packages/platform/src/lifecycle/i18n/en.json';
import plBundle from '../../../packages/platform/src/lifecycle/i18n/pl.json';

/**
 * `specs/176-command-hooks-outbox/` T061 (FR-041, Principle XVI) — the
 * `open-command-hooks` action reaches the *Command hooks* screen from ⌘K.
 *
 * The rows are built from the **shipped** declaration — `_lifecycle`'s
 * manifest `actions` and its own bundles, resolved the way
 * `AdminActionsService` resolves them — so the test pins what an operator can
 * actually type.
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

function servedRows(language: SupportedAdminLanguage): AdminActionView[] {
  const bundle = BUNDLES[language];
  return (lifecycleManifest.actions ?? []).map((action) => ({
    moduleId: lifecycleManifest.id,
    actionId: action.id,
    label: bundle[action.labelKey] ?? `${lifecycleManifest.id}.${action.labelKey}`,
    description: action.descriptionKey ? (bundle[action.descriptionKey] ?? null) : null,
    icon: action.icon,
    targetRoute: action.targetRoute,
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
  'appShell.nav.platformCommandHooks',
]);

async function openPalette(language: SupportedAdminLanguage, permissions: readonly string[]): Promise<HTMLElement> {
  const data = servedRows(language);
  currentResponse = { data, meta: { language, total: data.length, registryVersion: 1 } };
  renderWithI18n(
    withSession(
      <AdminActionsProvider language={language} initial={currentResponse}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<div>Home content</div>} />
              <Route path="/platform/command-hooks" element={<div>Command hooks screen</div>} />
              <Route path="/platform/command-hooks/outbox" element={<div>Command outbox screen</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AdminActionsProvider>,
      {
        session: adminSession({ permissions, preferredLanguage: language }),
        presence: modulePresence({ present: everyDeclaredModule() }),
      },
    ),
    coreBundle,
  );
  await userEvent.click(screen.getByPlaceholderText('appShell.search.placeholder'));
  return screen.findByRole('dialog');
}

function rowsFor(dialog: HTMLElement, query: string): HTMLElement[] {
  const input = dialog.querySelector('.b2b-palette__input input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: query } });
  return [...dialog.querySelectorAll<HTMLElement>('.b2b-palette__item')];
}

describe('AppShell palette — the Command hooks screen is reachable (Constitution XVI)', () => {
  beforeEach(() => {
    resetPromptCapabilityCacheForTesting();
  });

  it('declares open-command-hooks on /platform/command-hooks behind platform.modules.read', () => {
    const action = lifecycleManifest.actions?.find((candidate) => candidate.id === 'open-command-hooks');
    expect(action).toMatchObject({
      targetRoute: '/platform/command-hooks',
      requiredPermission: 'platform.modules.read',
    });
  });

  it.each([
    ['en', ['command hooks', 'hooks']],
    ['pl', ['haki poleceń', 'haki']],
  ] as const)('finds the screen in a %s-language admin and opens it', async (language, queries) => {
    const label = BUNDLES[language]['actions.openCommandHooks.label'] as string;
    const dialog = await openPalette(language, ['*']);
    for (const query of queries) {
      expect({ query, found: rowsFor(dialog, query).some((el) => (el.textContent ?? '').includes(label)) }).toEqual({
        query,
        found: true,
      });
    }
    const row = rowsFor(dialog, queries[0]).find((el) => (el.textContent ?? '').includes(label));
    await userEvent.click(row!);
    expect(await screen.findByText('Command hooks screen')).toBeTruthy();
  });

  // Architect ruling 2 on #1080: an operator who may read the outbox and not the
  // plan reaches the outbox directly — its own action, its own code.
  it('declares open-command-outbox on the outbox tab behind platform.command_outbox.read, with the outbox words', () => {
    const outbox = lifecycleManifest.actions?.find((candidate) => candidate.id === 'open-command-outbox');
    expect(outbox).toMatchObject({
      targetRoute: '/platform/command-hooks/outbox',
      requiredPermission: 'platform.command_outbox.read',
    });
    expect(outbox?.keywords).toEqual(expect.arrayContaining(['outbox', 'dead letter', 'retry']));
    const hooks = lifecycleManifest.actions?.find((candidate) => candidate.id === 'open-command-hooks');
    for (const word of ['outbox', 'dead letter', 'retry']) expect(hooks?.keywords ?? []).not.toContain(word);
  });

  it.each([
    ['en', ['outbox', 'dead letter', 'retry', 'failed deliveries']],
    ['pl', ['outbox', 'nieudane', 'ponów', 'dostarczenia']],
  ] as const)('finds the outbox in a %s-language admin and opens it', async (language, queries) => {
    const label = BUNDLES[language]['actions.openCommandOutbox.label'] as string;
    expect(label).toBeTruthy();
    const dialog = await openPalette(language, ['platform.command_outbox.read']);
    for (const query of queries) {
      expect({ query, found: rowsFor(dialog, query).some((el) => (el.textContent ?? '').includes(label)) }).toEqual({
        query,
        found: true,
      });
    }
    const row = rowsFor(dialog, queries[0]).find((el) => (el.textContent ?? '').includes(label));
    await userEvent.click(row!);
    expect(await screen.findByText('Command outbox screen')).toBeTruthy();
  });

  it('shows the System entry to an operator who holds only platform.command_outbox.read', async () => {
    await openPalette('en', ['platform.command_outbox.read']);
    await userEvent.keyboard('{Escape}');
    expect(screen.getAllByText('appShell.nav.platformCommandHooks').length).toBeGreaterThan(0);
  });
});
