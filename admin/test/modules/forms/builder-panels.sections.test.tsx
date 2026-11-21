import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormDefinition, FormDetail } from '@endora-commerce/contracts';
import { FORM_ID, LANGUAGE, definition, detail, en, renderForms } from './forms-fixtures';

/**
 * Issue #1437 (UX audit 2026-11-17, DS-03) — the form builder's tabs are one card
 * each with `EditorSection`s inside, divided by the section's own rule, and a list
 * of items inside a card is rows divided by a rule, not a bordered box per item:
 * a frame inside a card reads as a separate object (Common Region).
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { FormSettingsPanel } = await import('../../../../packages/modules/forms/src/admin/components/FormSettingsPanel');
const { NotificationsPanel } = await import('../../../../packages/modules/forms/src/admin/components/NotificationsPanel');
const { FieldInspector } = await import('../../../../packages/modules/forms/src/admin/components/FieldInspector');
const { FormBuilderPage } = await import('../../../../packages/modules/forms/src/admin/pages/FormBuilderPage');

const API = `/api/v1/admin/forms/${FORM_ID}`;

function framed(element: Element): boolean {
  return /(^|\s)border(\s|$)/.test(element.className) && /\brounded/.test(element.className);
}

/** The editor sections a container renders, outermost only. */
function sectionsIn(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="editor-section"]')].filter(
    (section) => section.parentElement?.closest('[data-slot="editor-section"]') == null,
  );
}

function DraftHost(props: { readonly render: (draft: FormDefinition, setDraft: (next: FormDefinition) => void) => ReactNode; readonly initial: FormDefinition }): ReactNode {
  const [draft, setDraft] = useState(props.initial);
  return <>{props.render(draft, setDraft)}</>;
}

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/sales-channels')) return Promise.resolve({ items: [] });
    return Promise.resolve({ data: { items: [] } });
  });
});

describe('FormSettingsPanel — sections, not separators (DS-03)', () => {
  it('renders its four groups as sibling editor sections named by their headings, with no separator between them', () => {
    const { container } = renderForms(
      <DraftHost
        initial={definition()}
        render={(draft, setDraft) => (
          <FormSettingsPanel
            form={detail()}
            definition={draft}
            defaultLanguage={LANGUAGE}
            disabled={false}
            onDefinitionChange={setDraft}
            onSaved={() => undefined}
          />
        )}
      />,
      { permissions: ['forms:read', 'forms:write', 'forms:entries_write'] },
    );
    const sections = sectionsIn(container);
    expect(sections.map((section) => section.querySelector('h2, h3')?.textContent)).toEqual([
      en('settings.confirmation.title'),
      en('settings.restrictions.title'),
      en('settings.spam.title'),
      en('settings.retention.title'),
    ]);
    // Siblings, so each section after the first draws the one rule above itself.
    const parent = sections[0]!.parentElement;
    for (const section of sections) expect(section.parentElement).toBe(parent);
    expect(container.querySelector('[data-orientation="horizontal"][role="none"], [role="separator"]')).toBeNull();
    expect(screen.getByRole('radiogroup', { name: en('settings.confirmation.title') })).toBeTruthy();
    expect(screen.getByRole('region', { name: en('settings.restrictions.title') })).toHaveAccessibleDescription(
      en('settings.restrictions.description'),
    );
  });
});

describe('NotificationsPanel — channel lists as divided rows (DS-03)', () => {
  it('renders the two groups as editor sections and each channel list as a row, not a bordered box', async () => {
    const user = userEvent.setup();
    const { container } = renderForms(
      <DraftHost
        initial={definition()}
        render={(draft, setDraft) => (
          <NotificationsPanel
            form={detail()}
            definition={draft}
            defaultLanguage={LANGUAGE}
            disabled={false}
            onDefinitionChange={setDraft}
            onSaved={() => undefined}
          />
        )}
      />,
      { permissions: ['forms:read', 'forms:write'] },
    );
    expect(sectionsIn(container).map((section) => section.querySelector('h2, h3')?.textContent)).toEqual([
      en('notifications.recipients.title'),
      en('notifications.confirmation.title'),
    ]);
    expect(container.querySelector('[role="none"][data-orientation="horizontal"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: en('notifications.recipients.addChannel') }));
    await user.click(screen.getByRole('button', { name: en('notifications.recipients.addChannel') }));
    const rows = [
      screen.getByRole('group', { name: en('notifications.recipients.channelRow', { number: 1 }) }),
      screen.getByRole('group', { name: en('notifications.recipients.channelRow', { number: 2 }) }),
    ];
    const list = rows[0]!.parentElement!;
    expect(list.className).toMatch(/\bdivide-y\b/);
    expect(rows[1]!.parentElement).toBe(list);
    for (const row of rows) expect(framed(row)).toBe(false);
  });
});

describe('FieldInspector — address parts as divided rows (DS-03)', () => {
  it('lists the parts of an address field as rows divided by a rule, not a bordered box each', () => {
    const form = definition({
      sections: [
        {
          id: 's1',
          columns: 1,
          fields: [
            {
              id: 'f_addr',
              type: 'address',
              key: 'address',
              parts: {
                street: { enabled: true, required: true },
                line2: { enabled: false, required: false },
                postalCode: { enabled: true, required: true },
                city: { enabled: true, required: true },
                country: { enabled: true, required: false },
              },
            },
          ],
        },
      ],
      texts: { [LANGUAGE]: { 'fields.f_addr.label': 'Address' } },
    });
    renderForms(
      <DraftHost
        initial={form}
        render={(draft, setDraft) => (
          <FieldInspector
            definition={draft}
            fieldId="f_addr"
            language={LANGUAGE}
            defaultLanguage={LANGUAGE}
            publishedKeys={new Map()}
            onChange={setDraft}
            onRemove={() => undefined}
          />
        )}
      />,
    );
    const parts = screen.getByRole('group', { name: en('inspector.parts') });
    const list = parts.querySelector('[data-address-parts]');
    expect(list).not.toBeNull();
    expect(list!.className).toMatch(/\bdivide-y\b/);
    expect(list!.children.length).toBeGreaterThanOrEqual(5);
    for (const row of list!.children) expect(framed(row)).toBe(false);
  });
});

describe('FormBuilderPage — published versions as divided rows (DS-03)', () => {
  let current: FormDetail;

  beforeEach(() => {
    current = detail({ status: 'published', publishedVersionNumber: 2 });
    getSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/forms/languages') return Promise.resolve({ data: { languages: [LANGUAGE], defaultLanguage: LANGUAGE } });
      if (path === API) return Promise.resolve({ data: current });
      if (path === `${API}/versions`) {
        return Promise.resolve({
          data: {
            items: [
              { number: 2, publishedAt: '2026-11-03T10:00:00.000Z' },
              { number: 1, publishedAt: '2026-11-02T10:00:00.000Z' },
            ],
          },
        });
      }
      if (path.startsWith(`${API}/preview`)) return Promise.reject(new Error('no preview here'));
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
  });

  it('lists the versions inside the card as divided rows with no frame around the list', async () => {
    renderForms(<FormBuilderPage />, { path: `/forms/${FORM_ID}`, pattern: '/forms/:id' });
    await screen.findByLabelText(en('builder.name'));
    await userEvent.click(screen.getByRole('tab', { name: en('builder.tabs.versions') }));
    const panel = screen.getByRole('tabpanel', { name: en('builder.tabs.versions') });
    const first = await within(panel).findByText(en('versions.item', { number: 2 }));
    const list = first.closest('ul')!;
    expect(list.className).toMatch(/\bdivide-y\b/);
    expect(framed(list)).toBe(false);
    expect(list.children).toHaveLength(2);
    expect(within(list).getByText(en('versions.live'))).toBeTruthy();
  });

  it('says a never-published form has no versions with the kit empty state, not a dashed box', async () => {
    current = detail();
    getSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/forms/languages') return Promise.resolve({ data: { languages: [LANGUAGE], defaultLanguage: LANGUAGE } });
      if (path === API) return Promise.resolve({ data: current });
      if (path === `${API}/versions`) return Promise.resolve({ data: { items: [] } });
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderForms(<FormBuilderPage />, { path: `/forms/${FORM_ID}`, pattern: '/forms/:id' });
    await screen.findByLabelText(en('builder.name'));
    await userEvent.click(screen.getByRole('tab', { name: en('builder.tabs.versions') }));
    const panel = screen.getByRole('tabpanel', { name: en('builder.tabs.versions') });
    const empty = await within(panel).findByText(en('versions.empty'));
    expect(empty.closest('[data-empty-state="no-data"]')).not.toBeNull();
    expect(panel.querySelector('.border-dashed')).toBeNull();
  });
});
