import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormDefinition, FormDetail } from '@endora-commerce/contracts';
import { FORM_ID, LANGUAGE, definition, detail, en, renderForms } from './forms-fixtures';

/**
 * Issue #1512 (UX audit 2026-11-17, CONTENT-09; owner decision DEC-08) — the form builder mixes two
 * save models, and says which is which on the section rather than in prose: the retention period
 * (Settings) and the recipients (Notifications) write at once, on their own, so their section
 * headings carry the kit's `ImmediateBadge`; every other section goes with the one Save / Publish
 * bar and carries none. The sentences that used to explain it ("no publish is needed", "applies at
 * once, without publishing") are gone, and each section's description is one line (≤ 80 chars).
 * A section save's result is an `InlineStatus` beside its button.
 *
 * Issue #1539 (CONTENT-22) — the content-language bar above the tabs is an unboxed row divided by
 * a rule, not a card of its own, and its untranslated marks use the warning token, not a raw amber.
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
const { FormBuilderPage } = await import('../../../../packages/modules/forms/src/admin/pages/FormBuilderPage');

const CORE_BUNDLE = JSON.parse(readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8')) as Record<
  string,
  string
>;
const IMMEDIATE = CORE_BUNDLE['saveSession.immediateBadge']!;
const API = `/api/v1/admin/forms/${FORM_ID}`;

function DraftHost(props: {
  readonly render: (draft: FormDefinition, setDraft: (next: FormDefinition) => void) => ReactNode;
  readonly initial: FormDefinition;
}): ReactNode {
  const [draft, setDraft] = useState(props.initial);
  return <>{props.render(draft, setDraft)}</>;
}

/** Each outermost editor section's heading text, and whether it carries the Immediate badge. */
function headings(container: Element): Array<{ readonly title: string; readonly immediate: boolean }> {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="editor-section"]')]
    .filter((section) => section.parentElement?.closest('[data-slot="editor-section"]') == null)
    .map((section) => {
      const heading = section.querySelector('h2, h3')!;
      return { title: heading.textContent ?? '', immediate: (heading.textContent ?? '').includes(IMMEDIATE) };
    });
}

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/sales-channels')) return Promise.resolve({ items: [] });
    if (path.startsWith(`${API}/retention-impact`)) return Promise.resolve({ data: { entriesToDelete: 0 } });
    return Promise.resolve({ data: { items: [] } });
  });
});

describe('FormSettingsPanel — the save model is on the section (CONTENT-09)', () => {
  const renderPanel = (onSaved: (detail: FormDetail) => void = () => undefined) =>
    renderForms(
      <DraftHost
        initial={definition()}
        render={(draft, setDraft) => (
          <FormSettingsPanel
            form={detail()}
            definition={draft}
            defaultLanguage={LANGUAGE}
            disabled={false}
            onDefinitionChange={setDraft}
            onSaved={onSaved}
          />
        )}
      />,
      { permissions: ['forms:read', 'forms:write', 'forms:entries_write'] },
    );

  it('badges Retention, and only Retention, as applying immediately', () => {
    const { container } = renderPanel();
    expect(headings(container).map((entry) => entry.immediate)).toEqual([false, false, false, true]);
    const retention = screen.getByRole('region', { name: new RegExp(`^${en('settings.retention.title')}`) });
    expect(within(retention).getByText(IMMEDIATE)).toBeTruthy();
  });

  it('announces a saved retention period in an inline status beside its button', async () => {
    putSpy.mockResolvedValue({ data: detail({ retentionDays: 30, revision: 2 }) });
    renderPanel();
    await userEvent.click(screen.getByLabelText(en('settings.retention.enabled')));
    await userEvent.type(screen.getByLabelText(en('settings.retention.days')), '30');
    const button = screen.getByRole('button', { name: en('settings.retention.save') });
    const status = button.parentElement!.querySelector('[role="status"]')!;
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();
    await userEvent.click(button);
    await waitFor(() => expect(status).toHaveTextContent(en('settings.retention.saved')));
    // The next edit clears it, so a stale "saved" does not linger.
    await userEvent.type(screen.getByLabelText(en('settings.retention.days')), '0');
    expect(status).toBeEmptyDOMElement();
  });
});

describe('NotificationsPanel — the save model is on the section (CONTENT-09)', () => {
  it('badges the recipients as applying immediately, and not the confirmation e-mail', async () => {
    putSpy.mockResolvedValue({ data: detail({ recipients: ['shop@example.com'], revision: 2 }) });
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
    expect(headings(container).map((entry) => entry.immediate)).toEqual([true, false]);

    const button = screen.getByRole('button', { name: en('notifications.recipients.save') });
    const status = button.parentElement!.querySelector('[role="status"]')!;
    expect(status).toHaveAttribute('aria-live', 'polite');
    const field = screen.getByLabelText(en('notifications.recipients.default'));
    await userEvent.clear(field);
    await userEvent.type(field, 'shop@example.com');
    await userEvent.click(button);
    await waitFor(() => expect(status).toHaveTextContent(en('notifications.recipients.saved')));
    await userEvent.type(screen.getByLabelText(en('notifications.recipients.default')), 'x');
    expect(status).toBeEmptyDOMElement();
  });
});

describe('The panels’ copy — no prose save model, one line each (CONTENT-09, #1436)', () => {
  const DESCRIPTIONS = [
    'settings.confirmation.description',
    'settings.restrictions.description',
    'settings.spam.description',
    'settings.retention.description',
    'notifications.recipients.description',
    'notifications.confirmation.description',
  ];
  const HINTS = ['notifications.recipients.hint', 'notifications.recipients.channelsHint', 'settings.retention.daysHint'];

  it('keeps every section description and the notification hints within one line', () => {
    for (const key of [...DESCRIPTIONS, ...HINTS]) expect(en(key).length, key).toBeLessThanOrEqual(80);
  });

  it('keeps the condition under which a reply reaches the submitter', () => {
    expect(en('notifications.recipients.description')).toMatch(/if the form has a submitter e-mail field/);
  });

  it('no longer explains in prose what the badge and the Save bar say', () => {
    for (const key of [...DESCRIPTIONS, ...HINTS]) expect(en(key), key).not.toMatch(/publish|at once|immediately/i);
  });
});

describe('FormBuilderPage — the content-language bar (CONTENT-22)', () => {
  let current: FormDetail;

  beforeEach(() => {
    const form = detail();
    current = detail({
      definition: { ...form.definition, texts: { ...form.definition.texts, 'pl-PL': { 'form.title': 'Kontakt' } } },
    });
    getSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/forms/languages') {
        return Promise.resolve({ data: { languages: [LANGUAGE, 'pl-PL'], defaultLanguage: LANGUAGE } });
      }
      if (path === API) return Promise.resolve({ data: current });
      if (path.startsWith(`${API}/preview`)) return Promise.reject(new Error('no preview here'));
      return Promise.resolve({ data: { items: [] } });
    });
  });

  it('is an unboxed row divided by a rule, with the untranslated marks in the warning token', async () => {
    renderForms(<FormBuilderPage />, { path: `/forms/${FORM_ID}`, pattern: '/forms/:id' });
    const strip = await screen.findByRole('tablist', { name: 'Content language' });
    const bar = strip.closest<HTMLElement>('[data-language-bar]');
    expect(bar).not.toBeNull();
    expect(bar!.closest('[data-slot="card"]')).toBeNull();
    expect(bar!.className).toMatch(/\bborder-b\b/);
    expect(bar!.className).not.toMatch(/\brounded/);

    const mark = screen.getByRole('button', { name: en('language.goToMissing', { language: 'pl-PL', count: 3 }) });
    expect(mark.className).not.toMatch(/amber/);
    expect(mark.className).toContain('text-[var(--warn-soft-fg)]');

    await userEvent.click(within(strip).getByRole('tab', { name: 'pl-PL' }));
    const locked = screen.getByText(en('language.structureLocked', { language: 'pl-PL', default: LANGUAGE }));
    expect(bar!.contains(locked)).toBe(true);
  });
});
