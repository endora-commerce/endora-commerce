import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SettingDto } from '@endora-commerce/contracts';
import type { ReactElement } from 'react';
import type { Bundle, SupportedAdminLanguage } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle } from '../../helpers/core-bundle';
import { expectNoAxeViolations } from '../../helpers/axe';
import settingsEn from '../../../../packages/modules/settings/i18n/en.json';
import settingsPl from '../../../../packages/modules/settings/i18n/pl.json';

/**
 * Issue #1479 (UX audit 2026-11-17, SHELL-02) — on `/settings` a boolean
 * setting is the kit's `Switch` (DS-09, #1442), staged into the page's one Save
 * like every other field, and an enum setting's options read as the owning
 * module's labels, in English and Polish, not as machine codes. The row used to
 * offer the literal, untranslated words `true` and `false`.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(async () => ({ items: [] })) } };
});

const { adminSession, modulePresence, withSession } = await import(
  '../../helpers/render-with-session'
);
const { SettingRowEditor, deriveDisplayValue, parseValue } = await import(
  '../../../../packages/modules/settings/src/admin/components/SettingRowEditor'
);

const OWNER_EN = {
  'settingLabels.demo.mode.options.single': 'Single opt-in',
  'settingLabels.demo.mode.options.double': 'Double opt-in',
};
const OWNER_PL = {
  'settingLabels.demo.mode.options.single': 'Pojedyncza zgoda',
  'settingLabels.demo.mode.options.double': 'Podwójna zgoda',
};

function bundleFor(language: SupportedAdminLanguage): Bundle {
  return {
    ...shippedCoreBundle(language),
    settings: (language === 'pl' ? settingsPl : settingsEn) as Record<string, string>,
    demo: language === 'pl' ? OWNER_PL : OWNER_EN,
  };
}

function setting(overrides: Partial<SettingDto>): SettingDto {
  return {
    id: '7e0c8de2-72e8-4d0e-bb16-7a40f87b97e1',
    code: 'demo.flag',
    name: 'Demo flag',
    description: null,
    valueType: 'boolean',
    ownerModule: 'demo',
    salesChannelCodes: [],
    defaultValue: false,
    globalValue: null,
    valuesByChannel: [],
    version: '2026-11-17T10:00:00.000Z',
    editable: true,
    activationControl: false,
    ...overrides,
  } as SettingDto;
}

function hosted(ui: ReactElement): ReactElement {
  return withSession(ui, {
    session: adminSession({ permissions: ['*'] }),
    presence: modulePresence({ present: ['settings'] }),
  });
}

function renderRow(
  row: SettingDto,
  options: { readOnly?: boolean; language?: SupportedAdminLanguage; text?: string } = {},
): { container: HTMLElement; onChange: ReturnType<typeof vi.fn> } {
  const text = options.text ?? deriveDisplayValue(row, null);
  const onChange = vi.fn();
  const language = options.language ?? 'en';
  const { container } = renderWithI18n(
    hosted(
      <SettingRowEditor
        setting={row}
        draft={{ text, initialText: deriveDisplayValue(row, null) }}
        channelContext={null}
        isCopied={false}
        resetting={false}
        readOnly={options.readOnly ?? false}
        onChange={onChange}
        onCopyCode={vi.fn()}
        onReset={vi.fn()}
      />,
    ),
    bundleFor(language),
    { language },
  );
  return { container, onChange };
}

describe('SettingRowEditor — a boolean setting is a switch', () => {
  it('renders a switch named by the setting, in the row layout, and no true/false select', () => {
    const { container } = renderRow(setting({ globalValue: true }));
    const toggle = screen.getByRole('switch', { name: 'Demo flag' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.closest('[data-layout="row"]')).not.toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(container.querySelector('option')).toBeNull();
  });

  it('a press stages the draft and writes nothing — the page Save does', async () => {
    const { onChange } = renderRow(setting({ defaultValue: false }));
    await userEvent.click(screen.getByRole('switch', { name: 'Demo flag' }));
    expect(onChange).toHaveBeenCalledWith({ text: 'true' });
    expect(parseValue('boolean', 'true')).toBe(true);
  });

  it('reflects a dirty draft, not the stored value', () => {
    renderRow(setting({ defaultValue: false }), { text: 'true' });
    expect(screen.getByRole('switch', { name: 'Demo flag' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('switching off stages "false"', async () => {
    const { onChange } = renderRow(setting({ globalValue: true }));
    await userEvent.click(screen.getByRole('switch', { name: 'Demo flag' }));
    expect(onChange).toHaveBeenCalledWith({ text: 'false' });
  });

  it('read-only: the switch is disabled, says why, and a press stages nothing', async () => {
    const { onChange } = renderRow(setting({ editable: false }), { readOnly: true });
    const toggle = screen.getByRole('switch', { name: 'Demo flag' }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    const described = (toggle.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain(settingsEn['editor.readOnlyReason']);
    await userEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ['en', 'On', 'Off'],
    ['pl', 'Włączone', 'Wyłączone'],
  ] as const)('the default and global values read as on / off in %s', (language, on, off) => {
    const { container } = renderRow(setting({ defaultValue: false, globalValue: true }), {
      language,
    });
    const codes = [...container.querySelectorAll('code')].map((el) => el.textContent);
    expect(codes).toEqual([off, on]);
    expect(container.textContent).not.toMatch(/\btrue\b|\bfalse\b/);
  });
});

describe('SettingRowEditor — enum options are labelled by the owning module', () => {
  const ENUM = setting({
    code: 'demo.mode',
    name: 'Opt-in mode',
    valueType: 'string',
    enumOptions: ['single', 'double', 'triple'],
    defaultValue: 'double',
  });

  it.each([
    ['en', ['Single opt-in', 'Double opt-in']],
    ['pl', ['Pojedyncza zgoda', 'Podwójna zgoda']],
  ] as const)('in %s, with an undeclared option shown as its value', (language, labels) => {
    renderRow(ENUM, { language });
    const select = screen.getByRole('combobox', { name: 'Opt-in mode' }) as HTMLSelectElement;
    const options = [...select.options].map((o) => [o.value, o.textContent]);
    expect(options).toEqual([
      ['single', labels[0]],
      ['double', labels[1]],
      // Not declared in the owner's bundle: the code, never a missing-key placeholder.
      ['triple', 'triple'],
    ]);
    expect(select.value).toBe('double');
  });

  it("the default value under the field reads as its option's label", () => {
    const { container } = renderRow(ENUM);
    expect(container.querySelector('code')?.textContent).toBe('Double opt-in');
  });
});

describe('SettingRowEditor — switch row axe', () => {
  it.each([
    ['on', { globalValue: true }, {}],
    ['off', {}, {}],
    ['read-only', { editable: false }, { readOnly: true }],
    ['with a description', { description: 'Shown to buyers.' }, {}],
  ] as const)('%s has no WCAG 2.2 AA violation axe can see', async (_kind, overrides, options) => {
    const { container } = renderRow(setting(overrides as Partial<SettingDto>), options);
    await expectNoAxeViolations(container);
  });
});
