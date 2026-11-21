import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { SettingDto } from '@endora-commerce/contracts';
import type { ReactElement } from 'react';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { shippedCoreBundle } from '../../helpers/core-bundle';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1478 (UX audit SHELL-01) — every control on `/settings` is named by
 * the setting's name and described by its description, its notice and its
 * read-only reason (WCAG 2.2 SC 1.3.1, 3.3.2, 4.1.2). The name used to be a
 * `<span>` beside controls with no `id`, so a screen reader announced ~270
 * anonymous "edit text" and "combo box" fields. The row now renders through the
 * kit's `FormField` (#1432).
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
const { SettingRowEditor, deriveDisplayValue } = await import(
  '../../../../packages/modules/settings/src/admin/components/SettingRowEditor'
);

const BUNDLE = {
  ...shippedCoreBundle('en'),
  ...passthroughBundle('settings', [
    'actions.copyCode.label',
    'actions.copyCode.copied',
    'actions.reset',
    'actions.resetToDefault',
    'context.usingDefault',
    'editor.readOnly',
    'editor.readOnlyReason',
    'editor.defaultPrefix',
    'editor.globalPrefix',
    'editor.perChannelOverrides',
    'editor.placeholder.json',
    'editor.placeholder.stringList',
    'editor.placeholder.secretUnset',
  ]),
};

function setting(overrides: Partial<SettingDto>): SettingDto {
  return {
    id: '7e0c8de2-72e8-4d0e-bb16-7a40f87b97e1',
    code: 'demo.field',
    name: 'Demo field',
    description: null,
    valueType: 'string',
    ownerModule: 'demo',
    salesChannelCodes: [],
    defaultValue: '',
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
  options: { readOnly?: boolean; readOnlyReasonId?: string } = {},
): HTMLElement {
  const text = deriveDisplayValue(row, null);
  const { container } = renderWithI18n(
    hosted(
      <>
        {/* The page's group states the reason once (issue #1518). */}
        {options.readOnlyReasonId !== undefined ? (
          <p id={options.readOnlyReasonId}>editor.readOnlyReason</p>
        ) : null}
        <SettingRowEditor
          setting={row}
          draft={{ text, initialText: text }}
          channelContext={null}
          isCopied={false}
          resetting={false}
          readOnly={options.readOnly ?? false}
          {...(options.readOnlyReasonId !== undefined
            ? { readOnlyReasonId: options.readOnlyReasonId }
            : {})}
          onChange={vi.fn()}
          onCopyCode={vi.fn()}
          onReset={vi.fn()}
        />
      </>,
    ),
    BUNDLE,
  );
  return container;
}

function descriptions(el: Element): string {
  return (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ');
}

describe('SettingRowEditor — every control is named by the setting', () => {
  it.each([
    // Issue #1479 (SHELL-02) — a switch, no longer a `true`/`false` select.
    ['boolean', { valueType: 'boolean', defaultValue: false }, 'switch'],
    ['enum', { enumOptions: ['a', 'b'], defaultValue: 'a' }, 'combobox'],
    ['json', { valueType: 'json', defaultValue: {} }, 'textbox'],
    ['multi-line string', { multiline: true }, 'textbox'],
    ['string list', { valueType: 'string_list', defaultValue: [] }, 'textbox'],
    ['number', { valueType: 'number', defaultValue: 3 }, 'spinbutton'],
    ['string', {}, 'textbox'],
  ] as const)('%s', (_kind, overrides, role) => {
    renderRow(setting(overrides as Partial<SettingDto>));
    const control = screen.getByRole(role, { name: 'Demo field' });
    expect(control.id).not.toBe('');
    expect(document.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.textContent).toBe(
      'Demo field',
    );
  });

  it('secret — a password field has no role, so it is found through its label', () => {
    renderRow(setting({ valueType: 'secret', defaultValue: null }));
    const input = screen.getByLabelText('Demo field');
    expect(input.getAttribute('type')).toBe('password');
  });

  it('a composite editor is a group named by the setting', () => {
    renderRow(setting({ code: 'demo.placeholder_image_url' }));
    expect(screen.getByRole('group', { name: 'Demo field' })).toBeTruthy();
  });

  it('the copy button and the badges stay outside the accessible name', () => {
    renderRow(setting({ valueType: 'boolean', defaultValue: false }));
    // Named exactly — not "Demo field boolean context.usingDefault".
    expect(screen.getByRole('switch', { name: 'Demo field' })).toBeTruthy();
  });
});

describe('SettingRowEditor — descriptions are linked to the control', () => {
  it('links the setting description', () => {
    renderRow(setting({ description: 'Shown on every invoice.' }));
    expect(descriptions(screen.getByRole('textbox', { name: 'Demo field' }))).toContain(
      'Shown on every invoice.',
    );
  });

  it('links the notice that the stored value is not in force', () => {
    renderRow(
      setting({
        valueType: 'boolean',
        defaultValue: false,
        globalValue: true,
        notice: { code: 'unmet', message: 'Not in force: no key.' },
      } as Partial<SettingDto>),
    );
    expect(descriptions(screen.getByRole('switch', { name: 'Demo field' }))).toContain(
      'Not in force: no key.',
    );
  });

  it('links the read-only reason, and the control is disabled', () => {
    renderRow(setting({ editable: false }), { readOnly: true, readOnlyReasonId: 'group-reason' });
    const input = screen.getByRole('textbox', { name: 'Demo field' }) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(descriptions(input)).toContain('editor.readOnlyReason');
  });

  it('a row without a description describes nothing', () => {
    renderRow(setting({}));
    expect(
      screen.getByRole('textbox', { name: 'Demo field' }).hasAttribute('aria-describedby'),
    ).toBe(false);
  });
});

describe('SettingRowEditor — axe', () => {
  it.each([
    ['string with a description', { description: 'Shown on every invoice.' }],
    ['boolean', { valueType: 'boolean', defaultValue: false }],
    ['json', { valueType: 'json', defaultValue: {} }],
    ['secret', { valueType: 'secret', defaultValue: null }],
  ] as const)('%s has no WCAG 2.2 AA violation axe can see', async (_kind, overrides) => {
    const container = renderRow(setting(overrides as Partial<SettingDto>));
    await expectNoAxeViolations(container);
  });
});
