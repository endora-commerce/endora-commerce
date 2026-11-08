import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SettingDto } from '@endora-commerce/contracts';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #930 — a setting can be stored "on" and not be in force: the owning
 * module says so through the read's `notice`, and the row shows it, in the
 * administrator's language when the owner's bundle carries
 * `settingLabels.<code>.notice.<token>`, and as the API's sentence otherwise.
 * A setting that reads "on" while doing nothing is the #349 defect class.
 */
const { adminSession, modulePresence, withSession } = await import(
  '../../helpers/render-with-session'
);
const { SettingRowEditor } = await import(
  '../../../../packages/modules/settings/src/admin/components/SettingRowEditor'
);

const chrome = passthroughBundle('settings', [
  'actions.copyCode.label',
  'actions.copyCode.copied',
  'actions.reset',
  'actions.resetToDefault',
  'editor.defaultPrefix',
  'editor.perChannelOverrides',
]);

const PL: Bundle = {
  ...chrome,
  fixture_mod: {
    'settingLabels.fixture_mod.flag.notice.unmet': 'Nie obowiązuje: brak klucza.',
  },
};
const EN: Bundle = { ...chrome, fixture_mod: {} };

function flag(notice?: SettingDto['notice']): SettingDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'fixture_mod.flag',
    name: 'Flag',
    description: null,
    valueType: 'boolean',
    ownerModule: 'fixture_mod',
    salesChannelCodes: [],
    defaultValue: false,
    globalValue: true,
    valuesByChannel: [],
    version: '2026-11-08T00:00:00.000Z',
    ...(notice ? { notice } : {}),
  } as SettingDto;
}

function inPolish(setting: SettingDto, bundle: Bundle = PL): void {
  const ui: ReactElement = (
    <SettingRowEditor
      setting={setting}
      draft={{ text: 'true', initialText: 'true' }}
      channelContext={null}
      isCopied={false}
      resetting={false}
      onChange={vi.fn()}
      onCopyCode={vi.fn()}
      onReset={vi.fn()}
    />
  );
  render(
    <TranslationProvider language="pl" initialBundle={bundle} initialFallbackBundle={EN}>
      <MemoryRouter>
        {withSession(ui, {
          session: adminSession({ permissions: ['*'] }),
          presence: modulePresence({ present: ['settings'] }),
        })}
      </MemoryRouter>
    </TranslationProvider>,
  );
}

describe('SettingRowEditor — a notice from the owning module', () => {
  it("renders it in the administrator's language", () => {
    inPolish(flag({ code: 'unmet', message: 'Not in force: no key.' }));
    expect(screen.getByRole('status').textContent).toContain('Nie obowiązuje: brak klucza.');
    expect(screen.queryByText('Not in force: no key.')).toBeNull();
  });

  it("renders the API's sentence when the owner ships no key", () => {
    inPolish(flag({ code: 'unmet', message: 'Not in force: no key.' }), { ...chrome, fixture_mod: {} });
    expect(screen.getByRole('status').textContent).toContain('Not in force: no key.');
  });

  it('renders nothing when there is no notice', () => {
    inPolish(flag());
    expect(screen.queryByRole('status')).toBeNull();
  });
});
