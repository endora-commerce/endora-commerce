import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SettingDto } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import {
  SettingRowEditor,
  deriveDisplayValue,
  effectiveSource,
  parseValue,
} from '../../../../packages/modules/settings/src/admin/components/SettingRowEditor';

/**
 * T013 — masked editor for the `secret` value type (feature 043, FR-021).
 * The editor is write-only: it never renders the stored value, presents a
 * password input, and reports set / not-set purely from the isSet flags.
 */

const BUNDLE = passthroughBundle('settings', [
  'actions.copyCode.label',
  'actions.copyCode.copied',
  'actions.reset',
  'actions.resetToDefault',
  'context.globalOverrideSet',
  'context.usingDefault',
  'editor.dirty',
  'editor.placeholder.secretSet',
  'editor.placeholder.secretUnset',
  'editor.secretIsSet',
  'editor.secretNotSet',
  'editor.perChannelOverrides',
]);

function secretSetting(overrides: Partial<SettingDto> = {}): SettingDto {
  return {
    id: '7e0c8de2-72e8-4d0e-bb16-7a40f87b97e1',
    code: 'prompt_actions.api_key',
    name: 'Assistant API key',
    description: null,
    valueType: 'secret',
    ownerModule: 'prompt_actions',
    salesChannelCodes: [],
    defaultValue: null,
    globalValue: null,
    globalValueIsSet: false,
    valuesByChannel: [],
    version: '2026-06-10T10:00:00.000Z',
    ...overrides,
  } as SettingDto;
}

function renderEditor(setting: SettingDto, text = ''): void {
  renderWithI18n(
    <SettingRowEditor
      setting={setting}
      draft={{ text, initialText: '' }}
      channelContext={null}
      isCopied={false}
      resetting={false}
      onChange={vi.fn()}
      onCopyCode={vi.fn()}
      onReset={vi.fn()}
    />,
    BUNDLE,
  );
}

describe('SettingRowEditor — secret value type (T013)', () => {
  it('renders a password input (masked), never a text input', () => {
    renderEditor(secretSetting());
    const input = document.querySelector('input[type="password"]');
    expect(input).not.toBeNull();
    expect((input as HTMLInputElement).autocomplete).toBe('new-password');
  });

  it('unset secret: "not set" status + unset placeholder + using-default badge', () => {
    renderEditor(secretSetting());
    expect(screen.getByText('editor.secretNotSet')).toBeTruthy();
    expect(
      (document.querySelector('input[type="password"]') as HTMLInputElement).placeholder,
    ).toBe('editor.placeholder.secretUnset');
    expect(screen.getByText('context.usingDefault')).toBeTruthy();
  });

  it('set secret: shows only the is-set fact — no value anywhere in the DOM', () => {
    renderEditor(secretSetting({ globalValueIsSet: true }));
    expect(screen.getByText('editor.secretIsSet')).toBeTruthy();
    expect(screen.getByText('context.globalOverrideSet')).toBeTruthy();
    expect(
      (document.querySelector('input[type="password"]') as HTMLInputElement).placeholder,
    ).toBe('editor.placeholder.secretSet');
    // The input itself stays empty (write-only) and no preview row exists.
    expect((document.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain('sk-');
  });

  it('typing marks the row dirty without echoing a stored value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithI18n(
      <SettingRowEditor
        setting={secretSetting({ globalValueIsSet: true })}
        draft={{ text: '', initialText: '' }}
        channelContext={null}
        isCopied={false}
        resetting={false}
        onChange={onChange}
        onCopyCode={vi.fn()}
        onReset={vi.fn()}
      />,
      BUNDLE,
    );
    await user.type(document.querySelector('input[type="password"]') as HTMLInputElement, 'x');
    expect(onChange).toHaveBeenCalledWith({ text: 'x' });
  });

  it('clear action (reset) is enabled when a global secret is set', () => {
    renderEditor(secretSetting({ globalValueIsSet: true }));
    const reset = screen.getByRole('button', { name: /actions.reset/ });
    expect((reset as HTMLButtonElement).disabled).toBe(false);
  });

  it('deriveDisplayValue never round-trips a secret into the input', () => {
    const dto = secretSetting({ globalValueIsSet: true, globalValue: null });
    expect(deriveDisplayValue(dto, null)).toBe('');
    expect(deriveDisplayValue(dto, 'b2b')).toBe('');
  });

  it('effectiveSource derives from isSet flags for secrets', () => {
    expect(effectiveSource(secretSetting(), null)).toBe('default');
    expect(effectiveSource(secretSetting({ globalValueIsSet: true }), null)).toBe('global');
    expect(
      effectiveSource(
        secretSetting({
          valuesByChannel: [
            {
              salesChannelId: '0b2cdebc-9e0a-4f23-9e94-0e63a3f1f6a5',
              salesChannelCode: 'b2b',
              value: null,
              isSet: true,
              updatedAt: '2026-06-10T10:00:00.000Z',
            },
          ],
        }),
        'b2b',
      ),
    ).toBe('channel-override');
  });

  it('parseValue passes the typed plaintext through for submission', () => {
    expect(parseValue('secret', 'sk-new-key')).toBe('sk-new-key');
  });
});
