import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { SettingDto, SettingGroupDto } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #349, E-349-1 — switching `mfa.admin.totp_enforced` on signs out every
 * administrator without a second factor, so the Settings screen asks first, as
 * the role screen does for a role's box. What to ask comes from the owning
 * module through the read (`confirmation`), translated from its bundle at
 * `settingLabels.<code>.confirmation.<token>` with the read's `params`, and the
 * API's sentence otherwise. The screen asks only when the draft is the value
 * the confirmation names; declining saves nothing.
 */

function flag(confirmation?: SettingDto['confirmation']): SettingDto {
  return {
    id: '00000000-0000-4000-8000-000000000349',
    code: 'fixture_mod.enforced',
    name: 'Enforced',
    description: null,
    valueType: 'boolean',
    ownerModule: 'fixture_mod',
    salesChannelCodes: [],
    defaultValue: false,
    globalValue: false,
    valuesByChannel: [],
    version: '2026-11-08T00:00:00.000Z',
    editable: true,
    ...(confirmation ? { confirmation } : {}),
  } as SettingDto;
}

function listOf(setting: SettingDto): { groups: SettingGroupDto[] } {
  return {
    groups: [
      {
        id: '00000000-0000-4000-8000-000000000350',
        code: 'fixture',
        name: 'Fixture',
        ownerModule: 'fixture_mod',
        isSystemProtected: false,
        salesChannelCodes: [],
        settings: [setting],
      },
    ],
  } as { groups: SettingGroupDto[] };
}

const listSpy = vi.fn<() => Promise<{ groups: SettingGroupDto[] }>>();
const setValueSpy = vi.fn(async () => ({}) as SettingDto);

vi.mock('../../../../packages/modules/settings/src/admin/api/settings-client', () => ({
  settingsClient: {
    list: () => listSpy(),
    setValue: (...args: unknown[]) => setValueSpy(...(args as [])),
    resetValues: async () => undefined,
  },
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: vi.fn(async () => ({ items: [] })),
    },
  };
});

const { adminSession, modulePresence, withSession } = await import(
  '../../helpers/render-with-session'
);
const { SettingsPage } = await import(
  '../../../../packages/modules/settings/src/admin/pages/SettingsPage'
);

const bundle = {
  ...passthroughBundle('settings', [
    'page.title',
    'page.description',
    'search.placeholder',
    'search.shortcut',
    'search.noResults',
    'context.label',
    'context.allChannels',
    'context.empty',
    'context.globalOverrideSet',
    'groups.expandAll',
    'groups.collapseAll',
    'state.loading',
    'actions.reset',
    'actions.resetToDefault',
    'actions.discard',
    'actions.saveAll',
    'actions.saveChanges',
    'editor.globalPrefix',
    'editor.savedNotice',
  ]),
  fixture_mod: {
    'settingLabels.fixture_mod.enforced.confirmation.signs_out':
      'Wylogowani zostaną administratorzy: {count}. Kontynuować?',
  },
};

function renderPage(): void {
  const ui: ReactElement = (
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
  renderWithI18n(
    withSession(ui, {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: ['settings', 'fixture_mod'] }),
    }),
    bundle,
  );
}

const CONFIRMATION = {
  whenValue: true,
  code: 'signs_out',
  message: 'Administrators will be signed out: 2. Continue?',
  params: { count: 2 },
};

async function switchOnAndSave(): Promise<void> {
  const select = (await screen.findByDisplayValue('false')) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'true' } });
  fireEvent.click(await screen.findByRole('button', { name: 'actions.saveChanges' }));
}

afterEach(() => {
  vi.restoreAllMocks();
  listSpy.mockReset();
  setValueSpy.mockClear();
});

describe('SettingsPage — a write the owning module asks to confirm', () => {
  it('asks with the translated sentence and its count, then saves', async () => {
    listSpy.mockResolvedValue(listOf(flag(CONFIRMATION)));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await switchOnAndSave();
    await waitFor(() => expect(setValueSpy).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith('Wylogowani zostaną administratorzy: 2. Kontynuować?');
  });

  it('saves nothing when the operator declines', async () => {
    listSpy.mockResolvedValue(listOf(flag(CONFIRMATION)));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await switchOnAndSave();
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(setValueSpy).not.toHaveBeenCalled();
  });

  it('asks nothing when the read carries no confirmation', async () => {
    listSpy.mockResolvedValue(listOf(flag()));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await switchOnAndSave();
    await waitFor(() => expect(setValueSpy).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
  });
});
