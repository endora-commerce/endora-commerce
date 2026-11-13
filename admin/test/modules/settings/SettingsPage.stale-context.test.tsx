import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { SettingDto, SettingGroupDto } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { answerConfirm } from '../../helpers/confirm-dialog';

/**
 * Issue #271 — a list response that lands after "Editing for" changed must not
 * re-baseline the rows with the context that was selected when it was asked.
 *
 * The list itself does not depend on the context: it carries the default, the
 * global value and every channel's override. What went stale was the context
 * `refresh` closed over, so a response arriving after the switch rebuilt every
 * non-dirty row from the *previous* context — one channel's values under
 * another channel's heading. Seen on the `llms.txt` field while working on
 * `specs/144-seo-search-engine-robots/`.
 */

const setting: SettingDto = {
  id: '00000000-0000-4000-8000-000000000271',
  code: 'seo.example_text',
  name: 'Example text',
  description: 'A channel-scoped string.',
  valueType: 'string',
  ownerModule: 'seo',
  salesChannelCodes: [],
  defaultValue: 'default-text',
  globalValue: 'global-text',
  valuesByChannel: [
    {
      salesChannelId: '00000000-0000-4000-8000-0000000000b2',
      salesChannelCode: 'b2b',
      value: 'b2b-text',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  version: '2026-10-01T00:00:00.000Z',
  hidden: false,
  editable: true,
} as SettingDto;

interface SettingListResponse {
  groups: SettingGroupDto[];
}

const listResponse = {
  groups: [
    {
      id: '00000000-0000-4000-8000-000000000144',
      code: 'seo',
      name: 'SEO',
      ownerModule: 'seo',
      isSystemProtected: false,
      salesChannelCodes: [],
      settings: [setting],
    },
  ],
} as SettingListResponse;

const listSpy = vi.fn<() => Promise<SettingListResponse>>();
const resetSpy = vi.fn(async () => undefined);

vi.mock('../../../../packages/modules/settings/src/admin/api/settings-client', () => ({
  settingsClient: {
    list: () => listSpy(),
    resetValues: () => resetSpy(),
  },
}));

// Same seam as `SettingsPage.activation-moved.test.tsx`: the page builds its
// sales-channel request on the kit's `apiClient`.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: vi.fn(async () => ({ items: [{ code: 'b2b', name: 'B2B', isActive: true }] })),
    },
  };
});

// Imported after the mocks, like the page: the helper loads the kit's `lib`
// barrel — see `setting-row-multiline.test.tsx`.
const { adminSession, modulePresence, withSession } = await import(
  '../../helpers/render-with-session'
);
const { SettingsPage } = await import(
  '../../../../packages/modules/settings/src/admin/pages/SettingsPage'
);

const bundle = passthroughBundle('settings', [
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
  'editor.globalPrefix',
]);

/** The row mounts a zone, which needs the session and contribution providers. */
function renderPage(): void {
  const ui: ReactElement = (
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
  renderWithI18n(
    withSession(ui, {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: ['settings'] }),
    }),
    bundle,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  listSpy.mockReset();
});

describe('SettingsPage — a response from before a channel switch', () => {
  it('baselines the rows with the context selected when it lands, not when it was asked', async () => {
    listSpy.mockResolvedValueOnce(listResponse);
    let releaseLateList: (value: SettingListResponse) => void = () => {};
    listSpy.mockReturnValueOnce(
      new Promise<SettingListResponse>((resolve) => {
        releaseLateList = resolve;
      }),
    );
    renderPage();
    await screen.findByDisplayValue('global-text');

    // A refresh goes out under "All channels" — here the one a reset triggers —
    // and stays in flight while the administrator switches to `b2b`.
    fireEvent.click(screen.getByRole('button', { name: /actions\.reset/ }));
    await answerConfirm(true);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText(/context\.label/), { target: { value: 'b2b' } });

    await act(async () => {
      releaseLateList(listResponse);
    });

    expect(
      screen.getByDisplayValue('b2b-text'),
      'the late response re-baselined the row with the "All channels" value',
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue('global-text')).toBeNull();
  });
});
