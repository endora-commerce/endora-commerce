import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SettingDto, SettingGroupDto } from '@endora-commerce/contracts';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * The generic Settings screen shows a setting's name and description, and a
 * group's heading, in the administrator's language when the owning module's
 * bundle carries the keys — and exactly what the manifest declared otherwise.
 *
 * `fixture_mod` is not a real module on purpose: this is a capability of the
 * screen for every module, and no shipped setting is translated by it.
 */

const channelsGetSpy = vi.fn(async () => ({ items: [] }));
// The kit's barrel, for the reason `SettingsPage.diacritics.test.tsx` gives.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return { ...actual, apiClient: { ...actual.apiClient, get: channelsGetSpy } };
});

const listMock = vi.fn();
vi.mock('../../../../packages/modules/settings/src/admin/api/settings-client', () => ({
  settingsClient: {
    list: (...args: unknown[]) => listMock(...args),
  },
}));

// Imported after the mocks above, like the page itself: the helper loads the
// kit's `lib` barrel, and a static import would evaluate it before the mock's
// spy exists.
const { adminSession, modulePresence, withSession } = await import(
  '../../helpers/render-with-session'
);
const { SettingsPage } = await import(
  '../../../../packages/modules/settings/src/admin/pages/SettingsPage'
);
const { SettingRowEditor } = await import(
  '../../../../packages/modules/settings/src/admin/components/SettingRowEditor'
);

const CHROME_KEYS = [
  'page.title',
  'page.description',
  'search.placeholder',
  'search.shortcut',
  'search.noResults',
  'context.label',
  'context.allChannels',
  'context.empty',
  'context.usingDefault',
  'context.globalOverrideSet',
  'groups.expandAll',
  'groups.collapseAll',
  'groups.empty',
  'state.loading',
  'actions.copyCode.label',
  'actions.copyCode.copied',
  'actions.reset',
  'actions.resetToDefault',
  'editor.defaultPrefix',
  'editor.perChannelOverrides',
  'activation.title',
  'activation.managedOnPlatformScreen',
  'activation.openPlatformScreen',
];

const chrome = passthroughBundle('settings', CHROME_KEYS);

/** What `fixture_mod` ships in `i18n/pl.json`. */
const PL: Bundle = {
  ...chrome,
  fixture_mod: {
    'settingGroups.fixture_group.name': 'Grupa wzorcowa',
    'settingLabels.fixture_mod.translated.name': 'Nazwa po polsku',
    'settingLabels.fixture_mod.translated.description': 'Opis po polsku.',
    'settingLabels.fixture_mod.enabled.name': 'Moduł wzorcowy włączony',
  },
};

/** What it ships in `i18n/en.json` — one key more than the Polish file. */
const EN: Bundle = {
  ...chrome,
  fixture_mod: {
    'settingGroups.fixture_group.name': 'Fixture group (bundle)',
    'settingLabels.fixture_mod.translated.name': 'Translated (bundle)',
    'settingLabels.fixture_mod.translated.description': 'Description (bundle).',
    'settingLabels.fixture_mod.english_only.name': 'English only (bundle)',
    'settingLabels.fixture_mod.enabled.name': 'Fixture module enabled (bundle)',
  },
};

function setting(overrides: Partial<SettingDto> & Pick<SettingDto, 'code' | 'name'>): SettingDto {
  return {
    id: `00000000-0000-4000-8000-0000000000${overrides.code.length.toString().padStart(2, '0')}`,
    description: null,
    valueType: 'string',
    ownerModule: 'fixture_mod',
    salesChannelCodes: [],
    defaultValue: '',
    globalValue: null,
    valuesByChannel: [],
    version: '2026-10-11T00:00:00.000Z',
    ...overrides,
  } as SettingDto;
}

const TRANSLATED = setting({
  code: 'fixture_mod.translated',
  name: 'Declared name',
  description: 'Declared description.',
});
const ENGLISH_ONLY = setting({ code: 'fixture_mod.english_only', name: 'Declared english-only' });
const UNTRANSLATED = setting({
  code: 'fixture_mod.untranslated',
  name: 'Declared untranslated',
  description: 'Declared untranslated description.',
});
const ACTIVATION = setting({
  code: 'fixture_mod.enabled',
  name: 'Declared enabled',
  valueType: 'boolean',
  defaultValue: true,
  activationControl: true,
});

const GROUP: SettingGroupDto = {
  id: '00000000-0000-4000-8000-0000000000aa',
  code: 'fixture_group',
  name: 'Declared group',
  isSystemProtected: false,
  ownerModule: 'fixture_mod',
  salesChannelCodes: [],
  settings: [TRANSLATED, ENGLISH_ONLY, UNTRANSLATED, ACTIVATION],
};

/**
 * The row mounts the `settings.setting.after` zone, and a zone refuses to
 * render outside the session and contribution providers. Nobody contributes
 * here: what a contribution is handed is `setting-row-zone.test.tsx`'s subject.
 */
function hosted(ui: ReactElement): ReactElement {
  return withSession(ui, {
    session: adminSession({ permissions: ['*'] }),
    presence: modulePresence({ present: ['settings'] }),
  });
}

function inPolish(ui: ReactElement): ReturnType<typeof render> {
  return render(
    <TranslationProvider language="pl" initialBundle={PL} initialFallbackBundle={EN}>
      <MemoryRouter>{hosted(ui)}</MemoryRouter>
    </TranslationProvider>,
  );
}

function row(s: SettingDto): ReactElement {
  return (
    <SettingRowEditor
      setting={s}
      draft={{ text: '', initialText: '' }}
      channelContext={null}
      isCopied={false}
      resetting={false}
      onChange={vi.fn()}
      onCopyCode={vi.fn()}
      onReset={vi.fn()}
    />
  );
}

describe('SettingRowEditor — name and description from the owning module', () => {
  it("renders both in the administrator's language", () => {
    inPolish(row(TRANSLATED));
    expect(screen.getByText('Nazwa po polsku')).toBeTruthy();
    expect(screen.getByText('Opis po polsku.')).toBeTruthy();
    expect(screen.queryByText('Declared name')).toBeNull();
    expect(screen.queryByText('Declared description.')).toBeNull();
  });

  it('renders the English bundle copy when the Polish bundle lacks the key', () => {
    inPolish(row(ENGLISH_ONLY));
    expect(screen.getByText('English only (bundle)')).toBeTruthy();
  });

  it('renders the declared strings when the owner ships no key', () => {
    inPolish(row(UNTRANSLATED));
    expect(screen.getByText('Declared untranslated')).toBeTruthy();
    expect(screen.getByText('Declared untranslated description.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('settingLabels.');
  });

  it('keeps the setting code, which is an identifier and not a label', () => {
    inPolish(row(TRANSLATED));
    expect(
      screen.getByRole('button', { name: 'actions.copyCode.label: fixture_mod.translated' }),
    ).toBeTruthy();
  });
});

describe('SettingsPage — group heading, rows and filter', () => {
  async function renderPage(): Promise<void> {
    listMock.mockResolvedValue({ groups: [structuredClone(GROUP)] });
    inPolish(<SettingsPage />);
    await waitFor(() => expect(screen.getByText('Nazwa po polsku')).toBeTruthy());
  }

  function searchFor(query: string): void {
    const input = document.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) throw new Error('settings search input not found');
    fireEvent.change(input, { target: { value: query } });
  }

  it("renders the group heading in the administrator's language", async () => {
    await renderPage();
    expect(screen.getByText('Grupa wzorcowa')).toBeTruthy();
    expect(screen.queryByText('Declared group')).toBeNull();
  });

  it('renders the activation pointer row under its translated name', async () => {
    await renderPage();
    expect(screen.getByText('Moduł wzorcowy włączony')).toBeTruthy();
    expect(screen.queryByText('Declared enabled')).toBeNull();
  });

  it('finds a setting by the name it is shown under', async () => {
    await renderPage();
    searchFor('nazwa po polsku');
    await waitFor(() => expect(screen.queryByText('Declared untranslated')).toBeNull());
    expect(screen.getByText('Nazwa po polsku')).toBeTruthy();
  });

  it('finds a setting by its translated description', async () => {
    await renderPage();
    searchFor('opis po');
    await waitFor(() => expect(screen.queryByText('Declared untranslated')).toBeNull());
    expect(screen.getByText('Nazwa po polsku')).toBeTruthy();
  });

  it('still finds a setting by its declared name, which is what documentation quotes', async () => {
    await renderPage();
    searchFor('declared name');
    await waitFor(() => expect(screen.queryByText('Declared untranslated')).toBeNull());
    expect(screen.getByText('Nazwa po polsku')).toBeTruthy();
  });

  it('matches the translated group heading, surfacing the whole group', async () => {
    await renderPage();
    searchFor('wzorcowa');
    await waitFor(() => expect(screen.getByText('Declared untranslated')).toBeTruthy());
    expect(screen.getByText('Nazwa po polsku')).toBeTruthy();
  });
});
