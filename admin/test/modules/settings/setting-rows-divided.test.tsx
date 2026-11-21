import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import type { SettingDto } from '@endora-commerce/contracts';
import type { ReactElement } from 'react';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #1437 (UX audit 2026-11-17, DS-03) — a settings group is one card, and
 * its settings are rows divided by a rule inside it. Each row used to draw its
 * own `rounded-md border` box (a dashed one for an activation pointer), so a
 * group of ten settings read as ten cards in a card (Common Region). A changed
 * row is marked by a bar at its edge plus a visually hidden *Unsaved* (issue
 * #1518), so the state is never carried by a border colour alone.
 */

const { adminSession, modulePresence, withSession } = await import('../../helpers/render-with-session');
const { SettingRowEditor } = await import(
  '../../../../packages/modules/settings/src/admin/components/SettingRowEditor'
);
const { ActivationPointerRow } = await import(
  '../../../../packages/modules/settings/src/admin/components/ActivationPointerRow'
);

const BUNDLE = passthroughBundle('settings', [
  'actions.copyCode.label',
  'actions.reset',
  'actions.resetToDefault',
  'editor.dirty',
  'editor.readOnly',
  'editor.readOnlyReason',
  'editor.defaultPrefix',
  'activation.badge',
  'activation.pointer',
  'activation.link',
]);

function setting(overrides: Partial<SettingDto> = {}): SettingDto {
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

function hosted(ui: ReactElement): ReactElement {
  return withSession(<MemoryRouter>{ui}</MemoryRouter>, {
    session: adminSession({ permissions: ['*'] }),
    presence: modulePresence({ present: ['settings'] }),
  });
}

function framed(element: Element): boolean {
  return /(^|\s)border(\s|$|-dashed)/.test(element.className);
}

function renderRow(text: string, initialText: string): HTMLElement {
  const { container } = renderWithI18n(
    hosted(
      <SettingRowEditor
        setting={setting()}
        draft={{ text, initialText }}
        channelContext={null}
        isCopied={false}
        resetting={false}
        readOnly={false}
        onChange={vi.fn()}
        onCopyCode={vi.fn()}
        onReset={vi.fn()}
      />,
    ),
    BUNDLE,
  );
  return container.firstElementChild as HTMLElement;
}

describe('settings rows — divided rows inside the group card (DS-03)', () => {
  it('draws no border around a setting row', () => {
    expect(framed(renderRow('', ''))).toBe(false);
  });

  it('marks a changed row with its edge bar and hidden word, not with a border colour', () => {
    const row = renderRow('changed', '');
    expect(framed(row)).toBe(false);
    expect(row.textContent).toContain('editor.dirty');
  });

  it('draws no dashed box around an activation pointer row', () => {
    const { container } = renderWithI18n(
      hosted(<ActivationPointerRow setting={setting({ activationControl: true })} />),
      BUNDLE,
    );
    expect(framed(container.firstElementChild as HTMLElement)).toBe(false);
  });

  it('separates a group\'s settings with a rule (the screen\'s list is divide-y)', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), '../packages/modules/settings/src/admin/pages/SettingsPage.tsx'),
      'utf8',
    );
    expect(source).toMatch(/<div className="divide-y">\s*\{group\.settings\.map\(/);
  });
});
