import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  everyDeclaredPermission,
  modulePresence,
  withSession,
} from '../helpers/render-with-session';

/**
 * T056 — US4 admin gating + the SC-006 baseline: the assistant entry exists
 * only when the operator holds prompt_actions:use AND the capability probe
 * reports ready; in every other case the palette is byte-identical to the
 * pre-043 baseline (same items, no assistant fetch without permission).
 */

let permissionGranted = true;
let capabilityStatus: 'ready' | 'disabled' | 'not_configured' = 'ready';
const capabilitySpy = vi.fn(async () => ({ status: capabilityStatus, bulkLimit: 500 }));
const unseenSpy = vi.fn(async () => []);


// Feature 073 — every admin surface resolves its own presence from the module
// projection. These cases are about layout and routing, not about presence, so
// the projection is seeded with every module the shell's own declarations name;
// the filtering itself is covered in AppShell.module-presence.test.tsx.
//
// It is a **seeded provider**, not a stubbed hook, since feature 091's P3:
// `useSurfaceVisibility` reads `useAuth` and `useModulePresence` inside
// `@endora-commerce/admin-kit`, where a `vi.mock` on `@/lib/…` cannot reach
// them. `withSession` supplies both through their `initial` props.

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: (...a: unknown[]) => capabilitySpy(...(a as [])),
  listUnseenPromptRequests: (...a: unknown[]) => unseenSpy(...(a as [])),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

const shellModule = await import('../../../packages/admin-shell/src/components/AppShell');
const { AppShell, resetPromptCapabilityCacheForTesting } = shellModule;

const coreBundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.search.openPalette',
    'appShell.search.commandPalettePlaceholder',
    'appShell.search.noMatches',
    'appShell.palette.group.navigate',
    'appShell.palette.group.actions',
    'appShell.profileMenu.signOut',
  ]),
  ...passthroughBundle('prompt_actions', [
    'palette.entry.label',
    'palette.entry.description',
    'palette.group.label',
    'panel.inputPlaceholder',
    'panel.unseenNotice',
  ]),
};

function renderShell(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: permissionGranted ? everyDeclaredPermission() : everyDeclaredPermission().filter((code) => code !== 'prompt_actions:use') }), presence: modulePresence({ present: everyDeclaredModule() }) },
    ),
    coreBundle,
  );
}

async function openPalette(): Promise<void> {
  const user = userEvent.setup();
  await user.keyboard('{Meta>}k{/Meta}');
}

function paletteItemLabels(): string[] {
  return [...document.querySelectorAll('.b2b-palette__item > div > div:first-child')].map(
    (el) => el.textContent ?? '',
  );
}

describe('AppShell palette — assistant gating (T056)', () => {
  beforeEach(() => {
    resetPromptCapabilityCacheForTesting();
    capabilitySpy.mockClear();
    unseenSpy.mockClear();
    permissionGranted = true;
    capabilityStatus = 'ready';
  });

  it('shows the assistant entry when permitted and ready; activating it opens prompt mode', async () => {
    renderShell();
    await openPalette();
    await waitFor(() => expect(screen.getByText('palette.entry.label')).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByText('palette.entry.label'));
    await waitFor(() => expect(screen.getByTestId('prompt-mode-panel')).toBeTruthy());
    // Esc returns to the classic palette instead of closing.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('prompt-mode-panel')).toBeNull());
    expect(document.querySelector('.b2b-palette')).not.toBeNull();
  });

  it('opens prompt mode and seeds the input when typing the /ai shortcut', async () => {
    renderShell();
    await openPalette();
    await waitFor(() => expect(screen.getByText('palette.entry.label')).toBeTruthy());

    const input = document.querySelector('.b2b-palette__input input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/ai Update Gloves 0198 stock to 110' } });

    await waitFor(() => expect(screen.getByTestId('prompt-mode-panel')).toBeTruthy());
    const promptInput = screen.getByTestId('prompt-input') as HTMLInputElement;
    expect(promptInput.value).toBe('Update Gloves 0198 stock to 110');
  });

  it('does not hijack /ai when the assistant is unavailable', async () => {
    permissionGranted = false;
    renderShell();
    await openPalette();
    await waitFor(() => expect(document.querySelector('.b2b-palette')).not.toBeNull());

    const input = document.querySelector('.b2b-palette__input input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/ai do something' } });

    expect(screen.queryByTestId('prompt-mode-panel')).toBeNull();
    expect(input.value).toBe('/ai do something');
  });

  it('hides the entry without the permission — and never even probes the capability', async () => {
    permissionGranted = false;
    renderShell();
    await openPalette();
    await waitFor(() => expect(document.querySelector('.b2b-palette')).not.toBeNull());
    expect(screen.queryByText('palette.entry.label')).toBeNull();
    expect(capabilitySpy).not.toHaveBeenCalled();
    expect(unseenSpy).not.toHaveBeenCalled();
  });

  it('SC-006 — with the assistant disabled the palette renders the identical baseline item list', async () => {
    // Baseline: feature inaccessible (no permission — pre-043 behavior).
    permissionGranted = false;
    renderShell();
    await openPalette();
    await waitFor(() => expect(document.querySelector('.b2b-palette')).not.toBeNull());
    const baseline = paletteItemLabels();
    document.body.innerHTML = '';

    // Feature present but disabled via settings: identical output.
    resetPromptCapabilityCacheForTesting();
    permissionGranted = true;
    capabilityStatus = 'disabled';
    renderShell();
    await openPalette();
    await waitFor(() => expect(capabilitySpy).toHaveBeenCalled());
    expect(paletteItemLabels()).toEqual(baseline);
    expect(screen.queryByText('palette.entry.label')).toBeNull();
  });

  it('hides the entry while not_configured (US4/AC2 — no broken entry point)', async () => {
    capabilityStatus = 'not_configured';
    renderShell();
    await openPalette();
    await waitFor(() => expect(capabilitySpy).toHaveBeenCalled());
    expect(screen.queryByText('palette.entry.label')).toBeNull();
  });

  // The owner's report: enable the assistant and attach credentials on the
  // Settings screen, press Ctrl+K, and the assistant is still not offered —
  // until the page is reloaded. The backend answered `ready` from the first
  // read after the save; the palette had asked once, earlier in the same page
  // session, and never asked again.
  it('offers the assistant on the next open after it is configured, without a remount', async () => {
    capabilityStatus = 'not_configured';
    renderShell();
    await openPalette();
    await waitFor(() => expect(capabilitySpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('palette.entry.label')).toBeNull();

    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('.b2b-palette')).toBeNull());

    // The operator saves the settings; nothing in the shell is told.
    capabilityStatus = 'ready';
    await openPalette();
    await waitFor(() => expect(screen.getByText('palette.entry.label')).toBeTruthy());
    expect(capabilitySpy).toHaveBeenCalledTimes(2);
  });

  // The same staleness in the other direction: an entry that stays offered
  // after the assistant is switched off answers every prompt with a 409.
  it('withdraws the assistant on the next open after it is switched off', async () => {
    renderShell();
    await openPalette();
    await waitFor(() => expect(screen.getByText('palette.entry.label')).toBeTruthy());

    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('.b2b-palette')).toBeNull());

    capabilityStatus = 'disabled';
    await openPalette();
    await waitFor(() => expect(screen.queryByText('palette.entry.label')).toBeNull());
  });

  // A probe that fails says nothing about the assistant being usable, so the
  // entry is withdrawn — and the next open asks again rather than remembering
  // the failure for the rest of the session.
  it('withdraws the assistant when the probe fails, and asks again on the next open', async () => {
    renderShell();
    await openPalette();
    await waitFor(() => expect(screen.getByText('palette.entry.label')).toBeTruthy());

    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('.b2b-palette')).toBeNull());

    capabilitySpy.mockRejectedValueOnce(new Error('503'));
    await openPalette();
    await waitFor(() => expect(screen.queryByText('palette.entry.label')).toBeNull());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('.b2b-palette')).toBeNull());
    await openPalette();
    await waitFor(() => expect(screen.getByText('palette.entry.label')).toBeTruthy());
  });

  // The shifted chord belongs to in-page search (e.g. the Settings filter),
  // so the palette must ignore it rather than swallowing the keypress.
  it('leaves Ctrl+Shift+K alone — the palette stays closed', async () => {
    renderShell();
    const user = userEvent.setup();
    await user.keyboard('{Control>}{Shift>}K{/Shift}{/Control}');
    expect(document.querySelector('.b2b-palette')).toBeNull();

    // …and the unshifted chord still opens it.
    await openPalette();
    await waitFor(() => expect(document.querySelector('.b2b-palette')).not.toBeNull());
  });
});
