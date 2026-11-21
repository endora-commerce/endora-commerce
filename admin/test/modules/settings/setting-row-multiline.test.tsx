import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SettingDto, SettingGroupDto } from '@endora-commerce/contracts';
import type { ReactElement } from 'react';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * `specs/144-seo-search-engine-robots/` FR-004 — a `string` setting its
 * manifest declares `multiline` is edited in a multi-line field, and the text
 * the operator typed is the text that is saved: every line break, the blank
 * line, the leading spaces and the trailing line break.
 *
 * Two levels, because they answer different questions. The row decides which
 * field is rendered and behaves like every other row around it; the page is
 * where a draft becomes a request, so "round-trips unchanged" is asserted on
 * the request body the page sends and not on a helper called in isolation.
 */

const channelsGetSpy = vi.fn(async () => ({ items: [] }));
// The kit's barrel, not `@/lib/api-client` — see `SettingsPage.diacritics.test.tsx`.
// The tab strip between the module's screens needs a router and a session this
// file does not mount; it is covered by `settings-section-tabs.test.tsx` (#1550).
vi.mock('../../../../packages/modules/settings/src/admin/components/SettingsSectionTabs', () => ({
  SettingsSectionTabs: () => null,
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return { ...actual, apiClient: { ...actual.apiClient, get: channelsGetSpy } };
});

const listMock = vi.fn();
const setValueMock = vi.fn();
vi.mock('../../../../packages/modules/settings/src/admin/api/settings-client', () => ({
  settingsClient: {
    list: (...args: unknown[]) => listMock(...args),
    setValue: (...args: unknown[]) => setValueMock(...args),
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
const { SettingRowEditor, deriveDisplayValue, parseValue } = await import(
  '../../../../packages/modules/settings/src/admin/components/SettingRowEditor'
);

const BUNDLE = passthroughBundle('settings', [
  'page.title',
  'search.placeholder',
  'search.shortcut',
  'context.label',
  'context.allChannels',
  'context.empty',
  'context.usingDefault',
  'context.globalOverrideSet',
  'groups.expandAll',
  'groups.collapseAll',
  'state.loading',
  'actions.copyCode.label',
  'actions.copyCode.copied',
  'actions.reset',
  'actions.resetToDefault',
  'actions.saveChanges',
  'actions.saveAll',
  'actions.discard',
  'editor.dirty',
  'editor.readOnly',
  'editor.readOnlyReason',
  'editor.defaultPrefix',
  'editor.globalPrefix',
  'editor.perChannelOverrides',
]);

/**
 * Whitespace at every edge an editor might be tempted to tidy: a leading line
 * break and leading spaces, a blank line in the middle, indentation, and a
 * trailing break. It starts with whitespace on purpose — a fixture that began
 * with a letter let a `trimStart()` on the saved value go unnoticed.
 */
const THREE_LINES = '\n  User-agent: *\n\n  Disallow: /private\nAllow: /\n';

function stringSetting(overrides: Partial<SettingDto> = {}): SettingDto {
  return {
    id: '7e0c8de2-72e8-4d0e-bb16-7a40f87b97e1',
    code: 'demo.notes',
    name: 'Notes',
    description: null,
    valueType: 'string',
    ownerModule: 'demo',
    salesChannelCodes: [],
    defaultValue: '',
    globalValue: null,
    valuesByChannel: [],
    version: '2026-10-11T10:00:00.000Z',
    editable: true,
    activationControl: false,
    ...overrides,
  } as SettingDto;
}

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

function rowHandlers() {
  return {
    onChange: vi.fn<(patch: { text?: string; initialText?: string }) => void>(),
    onReset: vi.fn<() => void>(),
  };
}
type RowHandlers = ReturnType<typeof rowHandlers>;

function renderRow(
  setting: SettingDto,
  options: { text?: string; initialText?: string; readOnly?: boolean } = {},
): RowHandlers {
  const handlers = rowHandlers();
  const text = options.text ?? deriveDisplayValue(setting, null);
  renderWithI18n(
    hosted(
      <SettingRowEditor
        setting={setting}
        draft={{ text, initialText: options.initialText ?? text }}
        channelContext={null}
        isCopied={false}
        resetting={false}
        readOnly={options.readOnly ?? false}
        onChange={handlers.onChange}
        onCopyCode={vi.fn()}
        onReset={handlers.onReset}
      />,
    ),
    BUNDLE,
  );
  return handlers;
}

const textarea = (): HTMLTextAreaElement | null => document.querySelector('textarea');
const textInput = (): HTMLInputElement | null => document.querySelector('input[type="text"]');

describe('SettingRowEditor — multi-line string settings', () => {
  it('renders a textarea for a string setting declared multiline', () => {
    renderRow(stringSetting({ multiline: true }));
    expect(textarea()).not.toBeNull();
    expect(textInput()).toBeNull();
  });

  it.each([
    ['multiline: false', { multiline: false }],
    ['no multiline field at all (a backend that predates it)', {}],
  ] as const)('renders the single-line input for a string setting with %s', (_label, overrides) => {
    renderRow(stringSetting(overrides));
    expect(textInput()).not.toBeNull();
    expect(textarea()).toBeNull();
  });

  it('keeps the dropdown for an enum setting even if a response claims multiline', () => {
    renderRow(
      stringSetting({ multiline: true, enumOptions: ['a', 'b'], defaultValue: 'a' }),
    );
    expect(document.querySelector('select')).not.toBeNull();
    expect(textarea()).toBeNull();
  });

  it('shows a stored multi-line value exactly, line breaks included', () => {
    const setting = stringSetting({ multiline: true, globalValue: THREE_LINES });
    expect(deriveDisplayValue(setting, null)).toBe(THREE_LINES);
    renderRow(setting);
    expect(textarea()!.value).toBe(THREE_LINES);
  });

  it('names the field after the setting, so it is not an unlabelled textarea', () => {
    renderRow(stringSetting({ multiline: true }));
    // Through the row's `<label>` since issue #1478, not an `aria-label`.
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBe(textarea());
    expect(screen.getByText('Notes').getAttribute('for')).toBe(textarea()!.id);
  });

  it('names it with the name the row shows — the owner bundle\'s, when it has one', () => {
    const setting = stringSetting({ multiline: true });
    renderWithI18n(
      hosted(
        <SettingRowEditor
          setting={setting}
          draft={{ text: '', initialText: '' }}
          channelContext={null}
          isCopied={false}
          resetting={false}
          onChange={vi.fn()}
          onCopyCode={vi.fn()}
          onReset={vi.fn()}
        />,
      ),
      { ...BUNDLE, demo: { 'settingLabels.demo.notes.name': 'Notatki' } },
    );
    expect(screen.getByRole('textbox', { name: 'Notatki' })).toBe(textarea());
  });

  it('keeps the value previews under the field to one short line', () => {
    const long = `${'x'.repeat(200)}\nsecond line`;
    renderRow(stringSetting({ multiline: true, defaultValue: THREE_LINES, globalValue: long }));
    const previews = [...document.querySelectorAll('code')].map((el) => el.textContent ?? '');
    expect(previews).toHaveLength(2);
    for (const preview of previews) {
      expect(preview).not.toContain('\n');
      expect(preview.length).toBeLessThanOrEqual(61);
      // Cut short, and says so.
      expect(preview.endsWith('…')).toBe(true);
    }
    // The first line that has text, without its indentation.
    expect(previews[0]).toBe('User-agent: *…');
    expect(previews[1]).toBe(`${'x'.repeat(60)}…`);
    // The field itself still holds everything.
    expect(textarea()!.value).toBe(long);
  });

  it('previews a short one-line value of a multi-line setting whole, and an empty one as ""', () => {
    renderRow(stringSetting({ multiline: true, defaultValue: '', globalValue: 'Allow: /' }));
    const previews = [...document.querySelectorAll('code')].map((el) => el.textContent ?? '');
    expect(previews).toEqual(['""', 'Allow: /']);
  });

  it('leaves the preview of a single-line setting as it was', () => {
    const long = 'y'.repeat(200);
    renderRow(stringSetting({ globalValue: long }));
    const previews = [...document.querySelectorAll('code')].map((el) => el.textContent ?? '');
    expect(previews).toEqual(['""', long]);
  });

  it('reports what was typed, Enter included, as a line break in the draft', async () => {
    const user = userEvent.setup();
    const { onChange } = renderRow(stringSetting({ multiline: true }), { text: 'a' });
    await user.type(textarea()!, '{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ text: 'a\n' });
  });

  it('submits the text untouched — no trimming, no line folding', () => {
    expect(parseValue('string', THREE_LINES)).toBe(THREE_LINES);
  });

  it('marks the row dirty when the text differs from the baseline, as other rows do', () => {
    renderRow(stringSetting({ multiline: true }), { text: 'a\nb', initialText: 'a' });
    expect(screen.getByText('editor.dirty')).toBeTruthy();
  });

  it('read-only: the field is disabled and edits are dropped', () => {
    const { onChange } = renderRow(
      stringSetting({ multiline: true, globalValue: THREE_LINES, editable: false }),
      { readOnly: true },
    );
    expect(textarea()!.disabled).toBe(true);
    expect(textarea()!.value).toBe(THREE_LINES);
    fireEvent.change(textarea()!, { target: { value: 'x' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('editor.readOnly')).toBeTruthy();
  });

  it('reset is offered when a global value is set and withheld when it is not', async () => {
    const user = userEvent.setup();
    const { onReset } = renderRow(stringSetting({ multiline: true, globalValue: THREE_LINES }));
    const reset = screen.getByRole('button', { name: /actions.reset/ }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    await user.click(reset);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('reset is disabled on a multi-line row still at its default', () => {
    renderRow(stringSetting({ multiline: true }));
    const reset = screen.getByRole('button', { name: /actions.reset/ }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
  });
});

describe('SettingsPage — a multi-line value round-trips through edit and save', () => {
  const GROUP: SettingGroupDto = {
    id: '00000000-0000-0000-0000-0000000000aa',
    code: 'demo',
    name: 'Demo',
    isSystemProtected: false,
    ownerModule: 'demo',
    salesChannelCodes: [],
    settings: [
      stringSetting({ multiline: true }),
      stringSetting({
        id: '7e0c8de2-72e8-4d0e-bb16-7a40f87b97e2',
        code: 'demo.title',
        name: 'Title',
      }),
    ],
  } as SettingGroupDto;

  beforeEach(() => {
    listMock.mockReset();
    setValueMock.mockReset();
  });

  it('sends exactly the text in the field, and shows it again after the reload', async () => {
    listMock.mockResolvedValueOnce({ groups: [structuredClone(GROUP)] });
    renderWithI18n(hosted(<SettingsPage />), BUNDLE);
    await waitFor(() => expect(textarea()).not.toBeNull());
    // One multi-line row, one single-line row: the flag is per setting.
    expect(document.querySelectorAll('textarea')).toHaveLength(1);
    expect(document.querySelectorAll('input[type="text"]')).toHaveLength(1);

    const saved = structuredClone(GROUP);
    saved.settings[0] = stringSetting({
      multiline: true,
      globalValue: THREE_LINES,
      version: '2026-10-11T10:05:00.000Z',
    });
    setValueMock.mockResolvedValue(saved.settings[0]);
    listMock.mockResolvedValue({ groups: [saved] });

    fireEvent.change(textarea()!, { target: { value: THREE_LINES } });
    const save = screen.getAllByRole('button', { name: /actions\.saveChanges/ });
    fireEvent.click(save[save.length - 1]!);

    await waitFor(() => expect(setValueMock).toHaveBeenCalledTimes(1));
    expect(setValueMock).toHaveBeenCalledWith('demo.notes', {
      scope: 'all',
      value: THREE_LINES,
      expectedVersion: '2026-10-11T10:00:00.000Z',
    });

    // After the save the page re-reads; the field holds the stored text and the
    // row is clean, so nothing is waiting to be saved a second time.
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(textarea()!.value).toBe(THREE_LINES));
    await waitFor(() => expect(screen.queryByText('editor.dirty')).toBeNull());
  });
});
