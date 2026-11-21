import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import newsletterEn from '../../../../packages/modules/newsletter/i18n/en.json';

/**
 * Issue #1533 (UX audit CONTENT-15, with the DS-03 leftovers of the same
 * screen family) — the automation builder's single-tag trigger is a radio
 * group, as the campaign's single-tag audience is, and its steps are one
 * ordered list divided by rules rather than a bordered box per step inside
 * the card.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, useAuth: () => ({ hasPermission: () => true }) };
});

vi.mock('@endora-commerce/page-builder-admin/email', () => ({
  EmailEditorPane: (): ReactNode => <div data-testid="email-canvas" />,
  EmailSubjectWithVariables: ({ id, value }: { id: string; value: string }): ReactNode => (
    <input id={id} value={value} readOnly />
  ),
  EmailVariablesProvider: ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
  listEmailTemplatesForApply: async () => [],
  loadEmailTemplateCanvas: async () => null,
  saveCanvasAsEmailTemplate: async () => undefined,
  mergeEmailVariables: () => [],
}));

const TAGS = [
  { id: '00000000-0000-4000-8000-0000000000a1', code: 'vip', name: 'VIP', subscriberCount: 3 },
  { id: '00000000-0000-4000-8000-0000000000a2', code: 'b2b', name: 'B2B', subscriberCount: 5 },
];

const getAutomation = vi.fn();

vi.mock('../../../../packages/modules/newsletter/src/admin/api/newsletter-client', () => ({
  newsletterClient: {
    listTags: async () => ({ items: TAGS }),
    listCustomFields: async () => ({ items: [] }),
    getAutomation: (...args: unknown[]) => getAutomation(...args),
    createAutomation: vi.fn(),
    updateAutomation: vi.fn(),
    activateAutomation: vi.fn(),
  },
}));

const { AutomationBuilder } = await import('../../../../packages/modules/newsletter/src/admin/pages/AutomationBuilder');

const ID = '22222222-2222-4222-8222-222222222222';

const BUNDLE = {
  ...passthroughBundle('newsletter', Object.keys(newsletterEn)),
  ...passthroughBundle('core', ['common.action.save']),
};

beforeEach(() => {
  getAutomation.mockReset().mockResolvedValue({
    id: ID,
    name: 'Welcome',
    status: 'draft',
    triggerType: 'tag_list',
    triggerTagIds: [TAGS[1]!.id, TAGS[0]!.id],
    steps: [
      { type: 'send', subject: 'Hello', content: { root: { props: {} }, content: [] } },
      { type: 'wait', days: 2 },
    ],
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  });
});

async function renderBuilder(): Promise<void> {
  renderWithI18n(
    <MemoryRouter initialEntries={[`/newsletter/automations/${ID}`]}>
      <Routes>
        <Route path="/newsletter/automations/:id" element={<AutomationBuilder />} />
      </Routes>
    </MemoryRouter>,
    BUNDLE,
  );
  await screen.findByDisplayValue('Welcome');
}

describe('AutomationBuilder — trigger and steps (#1533)', () => {
  it('narrows a tag-list trigger to one tag as radios, keeping the first tag chosen', async () => {
    await renderBuilder();
    const tags = screen.getByRole('group', { name: 'automation.field.triggerTags' });
    expect(within(tags).getAllByRole('checkbox', { checked: true })).toHaveLength(2);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'automation.field.trigger' }), 'tag');
    const single = screen.getByRole('group', { name: 'automation.field.triggerTags' });
    expect(within(single).queryByRole('checkbox')).toBeNull();
    const checked = within(single).getAllByRole('radio', { checked: true });
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAccessibleName('B2B');

    await userEvent.click(within(single).getByRole('radio', { name: 'VIP' }));
    expect(within(single).getByRole('radio', { name: 'VIP' })).toBeChecked();
    expect(within(single).getByRole('radio', { name: 'B2B' })).not.toBeChecked();
  });

  it('lists the steps in order inside the steps card, with no box per step', async () => {
    await renderBuilder();
    const section = screen.getByRole('region', { name: 'automation.steps.title' });
    const items = within(within(section).getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.className).not.toMatch(/\bborder\b|\brounded\b/);
  });
});
