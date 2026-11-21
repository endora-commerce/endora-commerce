import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { SettingDto, SettingGroupDto } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #1518 (UX audit 2026-11-17, SHELL-09) — a settings row carries what is
 * a fact about the setting and nothing else (Signal-to-Noise, Prägnanz):
 *
 * - no value-type badge (`boolean`, `string_list`): the control says it;
 * - no source badge ("Using default", "Global value set", …) and no footer that
 *   restates the default of every row: one muted line, shown only when the
 *   value in force differs from the default or channels override it;
 * - a changed row is marked by a bar at its edge, not a badge and a tint;
 * - a read-only row draws no badge and no reason of its own: the group says it
 *   once, and the row's control is described by that one sentence;
 * - the channel context sits in the toolbar beside the search, not in a card.
 */

const channelsGetSpy = vi.fn(async () => ({ items: [] }));
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return { ...actual, apiClient: { ...actual.apiClient, get: channelsGetSpy } };
});

const listMock = vi.fn();
vi.mock('../../../../packages/modules/settings/src/admin/api/settings-client', () => ({
  settingsClient: { list: (...args: unknown[]) => listMock(...args) },
}));

const { adminSession, modulePresence, withSession } = await import('../../helpers/render-with-session');
const { SettingRowEditor } = await import(
  '../../../../packages/modules/settings/src/admin/components/SettingRowEditor'
);
const { SettingsPage } = await import(
  '../../../../packages/modules/settings/src/admin/pages/SettingsPage'
);

const BUNDLE = passthroughBundle('settings', [
  'page.title',
  'search.placeholder',
  'search.shortcut',
  'context.label',
  'context.allChannels',
  'context.usingDefault',
  'context.globalOverrideSet',
  'context.channelOverridePresent',
  'context.inheritsGlobal',
  'groups.expandAll',
  'groups.collapseAll',
  'actions.copyCode.label',
  'actions.reset',
  'actions.resetToDefault',
  'editor.dirty',
  'editor.readOnly',
  'editor.readOnlyReason',
  'editor.defaultPrefix',
  'editor.globalPrefix',
  'editor.perChannelOverrides',
  'editor.secretIsSet',
  'editor.secretNotSet',
  'editor.booleanValue.on',
  'editor.booleanValue.off',
  'tabs.settings',
  'tabs.groups',
  'tabs.cache',
]);

function setting(overrides: Partial<SettingDto> = {}): SettingDto {
  return {
    id: '7e0c8de2-72e8-4d0e-bb16-7a40f87b9518',
    code: 'demo.limit',
    name: 'Limit',
    description: null,
    valueType: 'number',
    ownerModule: 'demo',
    salesChannelCodes: [],
    defaultValue: 30,
    globalValue: null,
    valuesByChannel: [],
    version: '2026-11-21T10:00:00.000Z',
    editable: true,
    activationControl: false,
    ...overrides,
  } as SettingDto;
}

function hosted(ui: ReactElement): ReactElement {
  return withSession(<MemoryRouter>{ui}</MemoryRouter>, {
    session: adminSession({ permissions: ['*'] }),
    presence: modulePresence({ present: ['settings'] }),
  });
}

function renderRow(
  s: SettingDto,
  opts: { text?: string; initialText?: string; channelContext?: string | null; readOnly?: boolean } = {},
): HTMLElement {
  const { container } = renderWithI18n(
    hosted(
      <SettingRowEditor
        setting={s}
        draft={{ text: opts.text ?? '', initialText: opts.initialText ?? '' }}
        channelContext={opts.channelContext ?? null}
        isCopied={false}
        resetting={false}
        readOnly={opts.readOnly ?? false}
        onChange={vi.fn()}
        onCopyCode={vi.fn()}
        onReset={vi.fn()}
      />,
    ),
    BUNDLE,
  );
  return container.firstElementChild as HTMLElement;
}

const SOURCE_BADGES = [
  'context.usingDefault',
  'context.globalOverrideSet',
  'context.channelOverridePresent',
];

describe('setting row — only what carries a fact (SHELL-09)', () => {
  it('draws no value-type badge', () => {
    const row = renderRow(setting({ valueType: 'string_list', defaultValue: [] }));
    expect(row.textContent).not.toContain('string_list');
    const booleanRow = renderRow(setting({ code: 'demo.flag', valueType: 'boolean', defaultValue: false }));
    expect(booleanRow.textContent).not.toMatch(/\bboolean\b/);
  });

  it('keeps the setting code in the copy button, where it is an identifier', () => {
    renderRow(setting());
    expect(screen.getByRole('button', { name: 'actions.copyCode.label: demo.limit' })).toBeTruthy();
  });

  it('shows no source badge and no facts line for a row at its default', () => {
    const row = renderRow(setting(), { text: '30', initialText: '30' });
    for (const badge of SOURCE_BADGES) expect(row.textContent).not.toContain(badge);
    expect(row.textContent).not.toContain('editor.defaultPrefix');
    expect(row.textContent).not.toContain('editor.perChannelOverrides');
  });

  it('says the default once the value in force differs from it', () => {
    const row = renderRow(setting({ globalValue: 45 }), { text: '45', initialText: '45' });
    for (const badge of SOURCE_BADGES) expect(row.textContent).not.toContain(badge);
    const facts = row.querySelector('[data-setting-facts]');
    expect(facts?.textContent).toContain('editor.defaultPrefix');
    expect(facts?.textContent).toContain('30');
  });

  it('counts channel overrides on the same line, and only when there are some', () => {
    const row = renderRow(
      setting({
        valuesByChannel: [
          {
            salesChannelId: '00000000-0000-4000-8000-0000000000b2',
            salesChannelCode: 'b2b',
            value: 10,
            updatedAt: '2026-11-21T10:00:00.000Z',
          },
        ],
      } as Partial<SettingDto>),
    );
    const facts = row.querySelectorAll('[data-setting-facts]');
    expect(facts).toHaveLength(1);
    expect(facts[0]?.textContent).toContain('editor.perChannelOverrides');
    expect(facts[0]?.textContent).not.toContain('editor.defaultPrefix');
  });

  it('says a channel row inherits the all-channels value, which is a fact an edit changes', () => {
    const row = renderRow(setting({ globalValue: 45 }), { channelContext: 'b2b', text: '45', initialText: '45' });
    const facts = row.querySelector('[data-setting-facts]');
    expect(facts?.textContent).toContain('context.inheritsGlobal');
    expect(facts?.textContent).toContain('editor.defaultPrefix');
  });

  it('marks a changed row with an edge bar and a hidden word, not a badge', () => {
    const row = renderRow(setting(), { text: '31', initialText: '30' });
    expect(row.getAttribute('data-dirty')).toBe('true');
    const bar = row.querySelector('[data-dirty-bar]');
    expect(bar?.getAttribute('aria-hidden')).toBe('true');
    const word = within(row).getByText('editor.dirty');
    expect(word.className).toContain('sr-only');
    expect(row.className).not.toContain('bg-amber');
  });

  it('draws neither a read-only badge nor a read-only reason on the row', () => {
    const row = renderRow(setting(), { readOnly: true });
    expect(row.textContent).not.toContain('editor.readOnly');
    expect((row.querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('Settings page — group and toolbar (SHELL-09)', () => {
  const readOnlyGroup: SettingGroupDto = {
    id: '00000000-0000-4000-8000-000000001518',
    code: 'demo',
    name: 'Demo',
    ownerModule: 'demo',
    isSystemProtected: true,
    salesChannelCodes: [],
    settings: [
      setting({ code: 'demo.one', name: 'One', editable: false }),
      setting({ code: 'demo.two', name: 'Two', editable: false }),
    ],
  };

  async function renderPage(): Promise<void> {
    listMock.mockResolvedValue({ groups: [structuredClone(readOnlyGroup)] });
    renderWithI18n(hosted(<SettingsPage />), BUNDLE);
    await waitFor(() => expect(screen.getByLabelText('One')).toBeTruthy());
  }

  it('states the read-only reason once per group and describes each row by it', async () => {
    await renderPage();
    const reasons = screen.getAllByText('editor.readOnlyReason');
    expect(reasons).toHaveLength(1);
    const reasonId = reasons[0]!.id;
    expect(reasonId).not.toBe('');
    for (const name of ['One', 'Two']) {
      const described = screen.getByLabelText(name).getAttribute('aria-describedby') ?? '';
      expect(described.split(' ')).toContain(reasonId);
    }
  });

  it('prints no hard-coded "system" badge on a protected group', async () => {
    await renderPage();
    expect(document.body.textContent).not.toMatch(/\bsystem\b/);
  });

  it('puts the channel context in the toolbar beside the search', async () => {
    await renderPage();
    const select = document.getElementById('settings-channel-context');
    const search = document.querySelector('input[type="search"]');
    expect(select).not.toBeNull();
    const toolbar = select!.closest('[data-settings-toolbar]');
    expect(toolbar).not.toBeNull();
    expect(toolbar!.contains(search)).toBe(true);
  });
});
