import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #1461 (UX audit CONTENT-02) — the newsletter campaign and automation
 * editors compare their fields with the last saved version and ask Save /
 * Discard / Stay before the back link throws a draft away.
 */
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, useAuth: () => ({ hasPermission: () => true }) };
});

vi.mock('@endora-commerce/page-builder-admin/email', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/page-builder-admin/email')>(
    '@endora-commerce/page-builder-admin/email',
  );
  return {
    ...actual,
    // Puck needs an iframe and a layout engine; nothing here is about the canvas.
    EmailEditorPane: (): ReactElement => <div data-testid="canvas-stub" />,
  };
});

const { newsletterClient } = await import('../../../../packages/modules/newsletter/src/admin/api/newsletter-client');
const { CampaignEditor } = await import('../../../../packages/modules/newsletter/src/admin/pages/CampaignEditor');
const { AutomationBuilder } = await import('../../../../packages/modules/newsletter/src/admin/pages/AutomationBuilder');

const core = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

/** The shipped `core` copy of the unsaved-changes guard (issue #1461). */
function ux(key: string): string {
  const value = core[`form.unsavedChanges.${key}`];
  if (!value) throw new Error(`_i18n/i18n/en.json carries no "form.unsavedChanges.${key}"`);
  return value;
}

const campaign = {
  id: 'campaign-1',
  name: 'Autumn sale',
  language: 'en-US',
  subject: 'Autumn',
  content: { root: { props: {} }, content: [] },
  targetType: 'all',
  targetTagIds: [],
  status: 'draft',
  version: 2,
};

beforeEach(() => {
  vi.spyOn(newsletterClient, 'listTags').mockResolvedValue({ items: [] } as never);
  vi.spyOn(newsletterClient, 'listCustomFields').mockResolvedValue({ items: [] } as never);
  vi.spyOn(newsletterClient, 'listSubscribers').mockResolvedValue({ items: [] } as never);
  vi.spyOn(newsletterClient, 'getCampaignGroup').mockResolvedValue({ items: [] });
  vi.spyOn(newsletterClient, 'getCampaign').mockResolvedValue(campaign as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The screens' own copy as it ships (issue #1463), so the back link and the
// name field are found by what the operator reads.
const newsletter = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../packages/modules/newsletter/i18n/en.json'), 'utf8'),
) as Record<string, string>;

function renderAt(path: string, route: string, element: ReactElement, list: string): void {
  renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
        <Route path={list} element={<p>List screen</p>} />
      </Routes>
    </MemoryRouter>,
    { core, newsletter },
  );
}

describe('CampaignEditor — unsaved changes', () => {
  it('is clean as loaded; a renamed campaign says so and Back asks, Stay keeps the edit', async () => {
    renderAt('/newsletter/campaigns/campaign-1', '/newsletter/campaigns/:id', <CampaignEditor />, '/newsletter/campaigns');
    const name = (await screen.findByDisplayValue('Autumn sale')) as HTMLInputElement;
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe('');
    fireEvent.change(name, { target: { value: 'Winter sale' } });
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe(ux('hint'));
    fireEvent.click(screen.getByRole('link', { name: /Campaigns/ }));
    const dialog = screen.getByRole('dialog', { name: ux('title') });
    fireEvent.click(within(dialog).getByRole('button', { name: ux('stay') }));
    expect(screen.queryByText('List screen')).toBeNull();
    expect(name.value).toBe('Winter sale');
  });

  it('Discard leaves for the list', async () => {
    renderAt('/newsletter/campaigns/campaign-1', '/newsletter/campaigns/:id', <CampaignEditor />, '/newsletter/campaigns');
    fireEvent.change(await screen.findByDisplayValue('Autumn sale'), { target: { value: 'Winter sale' } });
    fireEvent.click(screen.getByRole('link', { name: /Campaigns/ }));
    fireEvent.click(screen.getByRole('button', { name: ux('discard') }));
    expect(await screen.findByText('List screen')).toBeTruthy();
  });

  it('a typed name makes it dirty, and Back asks first', () => {
    renderAt('/newsletter/automations/new', '/newsletter/automations/:id', <AutomationBuilder />, '/newsletter/automations');
    fireEvent.change(screen.getByRole('textbox', { name: newsletter['automation.field.name']! }), { target: { value: 'Welcome' } });
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe(ux('hint'));
    fireEvent.click(screen.getByRole('link', { name: /Automations/ }));
    expect(screen.getByRole('dialog', { name: ux('title') })).toBeTruthy();
  });
});

describe('AutomationBuilder — unsaved changes', () => {
  it('a new automation is clean until something is typed into it', async () => {
    renderAt('/newsletter/automations/new', '/newsletter/automations/:id', <AutomationBuilder />, '/newsletter/automations');
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe('');
    fireEvent.click(screen.getByRole('link', { name: /Automations/ }));
    expect(await screen.findByText('List screen')).toBeTruthy();
  });

  it('a typed name makes it dirty, and Back asks first', () => {
    renderAt('/newsletter/automations/new', '/newsletter/automations/:id', <AutomationBuilder />, '/newsletter/automations');
    fireEvent.change(screen.getByRole('textbox', { name: newsletter['automation.field.name']! }), { target: { value: 'Welcome' } });
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe(ux('hint'));
    fireEvent.click(screen.getByRole('link', { name: /Automations/ }));
    expect(screen.getByRole('dialog', { name: ux('title') })).toBeTruthy();
  });
});
