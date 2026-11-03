import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { FormDefinition, FormDetail } from '@endora-commerce/contracts';
import { FORM_ID, LANGUAGE, definition, detail, en, renderForms } from './forms-fixtures';

/**
 * The builder's *Settings* tab (`specs/170-forms-module/` User Story 6, T095; FR-018, FR-038,
 * FR-042, FR-043, contracts/admin-surfaces.md §4): what happens after sending — a message, another
 * address or a CMS page, whose picker is offered only while `cms` is present — the restrictions
 * (maximum, window, signed-in only) with their messages, and the CAPTCHA switch, which warns with a
 * way to `/settings` while no provider is set up. Every control edits the builder's draft.
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

interface Harness {
  readonly onDefinitionChange: ReturnType<typeof vi.fn>;
  readonly onSaved: ReturnType<typeof vi.fn>;
  latest(): FormDefinition;
}

function renderPanel(
  options: {
    form?: FormDetail;
    definition?: FormDefinition;
    disabled?: boolean;
    present?: string[];
    permissions?: string[];
    language?: string;
  } = {},
): Harness {
  const onSaved = vi.fn();
  let current = options.definition ?? definition();
  const onDefinitionChange = vi.fn();
  // The builder's role: it holds the draft and hands each edit back to the panel.
  function Host(): ReactNode {
    const [draft, setDraft] = useState(current);
    return (
      <FormSettingsPanel
        form={options.form ?? detail()}
        definition={draft}
        language={options.language ?? LANGUAGE}
        defaultLanguage={LANGUAGE}
        disabled={options.disabled ?? false}
        onDefinitionChange={(next) => {
          current = next;
          onDefinitionChange(next);
          setDraft(next);
        }}
        onSaved={onSaved}
      />
    );
  }
  renderForms(<Host />, {
    present: options.present ?? [],
    permissions: options.permissions ?? ['forms:read', 'forms:write', 'forms:entries_read', 'forms:entries_write'],
  });
  return { onDefinitionChange, onSaved, latest: () => current };
}

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockResolvedValue({ data: [], nextCursor: null });
  putSpy.mockReset();
});

describe('FormSettingsPanel — restrictions (FR-043)', () => {
  it('sets and clears the maximum number of entries', async () => {
    const harness = renderPanel();
    const input = screen.getByLabelText(en('settings.restrictions.maxEntries'));
    await userEvent.type(input, '500');
    expect(harness.latest().restrictions.maxEntries).toBe(500);
    await userEvent.clear(input);
    expect(harness.latest().restrictions.maxEntries).toBeNull();
  });

  it('says so when the maximum is not a whole number in range, and keeps the last good one', async () => {
    const harness = renderPanel();
    const input = screen.getByLabelText(en('settings.restrictions.maxEntries'));
    fireEvent.change(input, { target: { value: '0' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(en('settings.restrictions.maxEntriesInvalid', { max: '1000000' }))).toBeInTheDocument();
    expect(harness.latest().restrictions.maxEntries).toBeNull();
  });

  it('sets the availability window as instants, and refuses an end before the start inline', () => {
    const harness = renderPanel();
    const from = screen.getByLabelText(en('settings.restrictions.availableFrom'));
    const until = screen.getByLabelText(en('settings.restrictions.availableUntil'));
    fireEvent.change(from, { target: { value: '2026-12-01T09:00' } });
    expect(harness.latest().restrictions.availableFrom).toBe(new Date('2026-12-01T09:00').toISOString());
    fireEvent.change(until, { target: { value: '2026-11-30T09:00' } });
    expect(until).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(en('settings.restrictions.windowInvalid'))).toBeInTheDocument();
    // A window the server would refuse is not written into the draft.
    expect(harness.latest().restrictions.availableUntil).toBeNull();
    fireEvent.change(until, { target: { value: '2026-12-31T18:00' } });
    expect(harness.latest().restrictions.availableUntil).toBe(new Date('2026-12-31T18:00').toISOString());
    expect(until).not.toHaveAttribute('aria-invalid');
    fireEvent.change(from, { target: { value: '' } });
    expect(harness.latest().restrictions.availableFrom).toBeNull();
  });

  it('shows a saved window in the operator’s time zone', () => {
    const at = '2026-12-01T09:30:00.000Z';
    renderPanel({
      definition: definition({ restrictions: { maxEntries: null, availableFrom: at, availableUntil: null, signedInOnly: false } }),
    });
    const value = (screen.getByLabelText(en('settings.restrictions.availableFrom')) as HTMLInputElement).value;
    expect(new Date(value).toISOString()).toBe(at);
  });

  it('limits the form to signed-in customers', async () => {
    const harness = renderPanel();
    await userEvent.click(screen.getByLabelText(en('settings.restrictions.signedInOnly')));
    expect(harness.latest().restrictions.signedInOnly).toBe(true);
  });

  it('edits each restriction’s message in the default language', async () => {
    const harness = renderPanel();
    await userEvent.type(screen.getByLabelText(en('settings.restrictions.fullMessage')), 'All seats taken');
    await userEvent.type(screen.getByLabelText(en('settings.restrictions.closedMessage')), 'Closed');
    await userEvent.type(screen.getByLabelText(en('settings.restrictions.notYetOpenMessage')), 'Soon');
    await userEvent.type(screen.getByLabelText(en('settings.restrictions.signInMessage')), 'Members only');
    expect(harness.latest().texts[LANGUAGE]).toMatchObject({
      'messages.full': 'All seats taken',
      'messages.closed': 'Closed',
      'messages.notYetOpen': 'Soon',
      'messages.signIn': 'Members only',
    });
  });
});

describe('FormSettingsPanel — CAPTCHA (FR-042, US6-4)', () => {
  it('switches the CAPTCHA requirement', async () => {
    const harness = renderPanel();
    await userEvent.click(screen.getByLabelText(en('settings.spam.captcha')));
    expect(harness.latest().behaviour.captchaRequired).toBe(true);
  });

  it('warns while no provider is set up, with a way to the settings screen', () => {
    const required = definition({
      behaviour: { confirmation: { type: 'message' }, captchaRequired: true, confirmationEmail: { enabled: false, includeSummary: false } },
    });
    renderPanel({ definition: required, form: detail({ warnings: [{ code: 'captcha_not_configured' }] }) });
    expect(screen.getByText(en('settings.spam.notConfigured'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en('settings.spam.openSettings') })).toHaveAttribute('href', '/settings');
  });

  it('says nothing of the provider when one is set up, or when the form asks for no check', () => {
    renderPanel({ form: detail({ warnings: [{ code: 'captcha_not_configured' }] }) });
    expect(screen.queryByRole('link', { name: en('settings.spam.openSettings') })).toBeNull();
  });
});

describe('FormSettingsPanel — after sending (FR-038)', () => {
  const group = () => screen.getByRole('radiogroup', { name: en('settings.confirmation.title') });

  it('edits the message in the default language', async () => {
    const harness = renderPanel();
    expect(within(group()).getByLabelText(en('settings.confirmation.message'))).toBeChecked();
    await userEvent.type(screen.getByLabelText(en('settings.confirmation.messageText')), 'Thanks!');
    expect(harness.latest().texts[LANGUAGE]?.['messages.success']).toBe('Thanks!');
  });

  it('goes to another address', async () => {
    const harness = renderPanel();
    await userEvent.click(within(group()).getByLabelText(en('settings.confirmation.redirect')));
    expect(harness.latest().behaviour.confirmation).toEqual({ type: 'redirect', url: '' });
    await userEvent.type(screen.getByLabelText(en('settings.confirmation.url')), 'https://example.com/thanks');
    expect(harness.latest().behaviour.confirmation).toEqual({ type: 'redirect', url: 'https://example.com/thanks' });
  });

  it('marks an address that is not absolute', async () => {
    renderPanel({
      definition: definition({
        behaviour: { confirmation: { type: 'redirect', url: '' }, captchaRequired: false, confirmationEmail: { enabled: false, includeSummary: false } },
      }),
    });
    const url = screen.getByLabelText(en('settings.confirmation.url'));
    await userEvent.type(url, '/thanks');
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(en('settings.confirmation.urlInvalid'))).toBeInTheDocument();
  });

  it('offers a CMS page picker while cms is present', async () => {
    renderPanel({ present: ['cms'] });
    await userEvent.click(within(group()).getByLabelText(en('settings.confirmation.page')));
    expect(screen.getByRole('combobox', { name: en('settings.confirmation.pageLabel') })).toBeInTheDocument();
    expect(screen.queryByText(en('settings.confirmation.cmsAbsent'))).toBeNull();
  });

  it('hides the picker with a note while cms is absent, the message standing in', () => {
    renderPanel({
      definition: definition({
        behaviour: {
          confirmation: { type: 'page', cmsPageId: '00000000-0000-4000-8000-00000000c0de' },
          captchaRequired: false,
          confirmationEmail: { enabled: false, includeSummary: false },
        },
      }),
    });
    expect(screen.queryByRole('combobox', { name: en('settings.confirmation.pageLabel') })).toBeNull();
    expect(screen.getByText(en('settings.confirmation.cmsAbsent'))).toBeInTheDocument();
    // The message the shopper is shown instead stays editable.
    expect(screen.getByLabelText(en('settings.confirmation.messageText'))).toBeInTheDocument();
  });
});

describe('FormSettingsPanel — read only', () => {
  it('disables every control for an operator who cannot write', () => {
    renderPanel({ disabled: true });
    expect(screen.getByLabelText(en('settings.restrictions.maxEntries'))).toBeDisabled();
    expect(screen.getByLabelText(en('settings.spam.captcha'))).toBeDisabled();
    expect(within(screen.getByRole('radiogroup', { name: en('settings.confirmation.title') })).getByLabelText(en('settings.confirmation.redirect'))).toBeDisabled();
  });
});

describe('FormSettingsPanel — another content language (US7-1)', () => {
  it('locks every setting that is not a text, and writes the messages in that language', async () => {
    const source = definition({ texts: { [LANGUAGE]: { 'messages.closed': 'We are closed.' } } });
    const harness = renderPanel({ definition: source, language: 'pl-PL', form: detail({ retentionDays: 30 }) });
    expect(screen.getByText(en('language.lockedShort', { language: LANGUAGE }))).toBeTruthy();
    expect(screen.getByLabelText(en('settings.restrictions.maxEntries'))).toBeDisabled();
    expect(screen.getByLabelText(en('settings.spam.captcha'))).toBeDisabled();
    expect(screen.getByLabelText(en('settings.restrictions.signedInOnly'))).toBeDisabled();
    expect(within(screen.getByRole('radiogroup', { name: en('settings.confirmation.title') })).getByLabelText(en('settings.confirmation.redirect'))).toBeDisabled();
    expect(screen.getByLabelText(en('settings.retention.days'))).toBeDisabled();
    expect(screen.queryByRole('button', { name: en('settings.retention.save') })).toBeNull();

    const closed = screen.getByLabelText(en('settings.restrictions.closedMessage'));
    expect(closed).toHaveAttribute('placeholder', 'We are closed.');
    await userEvent.type(closed, 'Zamknięte');
    await userEvent.type(screen.getByLabelText(en('settings.confirmation.messageText')), 'Dziękujemy!');
    expect(harness.latest().texts['pl-PL']).toEqual({ 'messages.closed': 'Zamknięte', 'messages.success': 'Dziękujemy!' });
    expect(harness.latest().texts[LANGUAGE]).toEqual({ 'messages.closed': 'We are closed.' });
  });
});

describe('FormSettingsPanel — retention (User Story 9, FR-054)', () => {
  const RETENTION_URL = `/api/v1/admin/forms/${FORM_ID}/retention`;
  const impactCalls = () => getSpy.mock.calls.filter(([url]) => String(url).includes('/retention-impact'));
  const impact = (entriesToDelete: number) =>
    getSpy.mockImplementation(async (url: string) =>
      url.includes('/retention-impact') ? { data: { entriesToDelete } } : { data: [], nextCursor: null },
    );
  const section = () => screen.getByRole('region', { name: en('settings.retention.title') });

  it('shows the saved period and saves a new one live, after asking how many entries it would delete', async () => {
    impact(0);
    const saved = detail({ retentionDays: 30, revision: 4 });
    putSpy.mockResolvedValue({ data: saved });
    const harness = renderPanel({ form: detail({ retentionDays: 90 }) });
    const days = within(section()).getByLabelText(en('settings.retention.days'));
    expect((days as HTMLInputElement).value).toBe('90');

    await userEvent.clear(days);
    await userEvent.type(days, '30');
    await userEvent.click(within(section()).getByRole('button', { name: en('settings.retention.save') }));

    expect(String(impactCalls()[0]![0])).toContain('days=30');
    expect(putSpy).toHaveBeenCalledWith(RETENTION_URL, { expectedRevision: 3, retentionDays: 30 });
    expect(harness.onSaved).toHaveBeenCalledWith(saved);
    expect(await within(section()).findByText(en('settings.retention.saved'))).toBeTruthy();
    // Retention is not part of the draft.
    expect(harness.onDefinitionChange).not.toHaveBeenCalled();
  });

  it('warns how many entries the period will delete and saves only once that is confirmed', async () => {
    impact(12);
    putSpy.mockResolvedValue({ data: detail({ retentionDays: 7 }) });
    renderPanel();
    await userEvent.click(within(section()).getByLabelText(en('settings.retention.enabled')));
    const days = within(section()).getByLabelText(en('settings.retention.days'));
    await userEvent.type(days, '7');
    await userEvent.click(within(section()).getByRole('button', { name: en('settings.retention.save') }));

    expect(await within(section()).findByText(en('settings.retention.confirm', { count: 12 }))).toBeTruthy();
    expect(putSpy).not.toHaveBeenCalled();

    await userEvent.click(within(section()).getByRole('button', { name: en('settings.retention.cancel') }));
    expect(within(section()).queryByText(en('settings.retention.confirm', { count: 12 }))).toBeNull();
    expect(putSpy).not.toHaveBeenCalled();

    await userEvent.click(within(section()).getByRole('button', { name: en('settings.retention.save') }));
    await userEvent.click(await within(section()).findByRole('button', { name: en('settings.retention.confirmSave') }));
    expect(putSpy).toHaveBeenCalledWith(RETENTION_URL, { expectedRevision: 3, retentionDays: 7 });
  });

  it('marks a period out of range and sends nothing', async () => {
    renderPanel({ form: detail({ retentionDays: 30 }) });
    const days = within(section()).getByLabelText(en('settings.retention.days'));
    await userEvent.clear(days);
    await userEvent.type(days, '5000');
    expect(days.getAttribute('aria-invalid')).toBe('true');
    expect(within(section()).getByText(en('settings.retention.daysInvalid', { max: 3650 }))).toBeTruthy();
    await userEvent.click(within(section()).getByRole('button', { name: en('settings.retention.save') }));
    expect(impactCalls()).toHaveLength(0);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('keeps every entry again when the switch is turned off — nothing to warn about', async () => {
    putSpy.mockResolvedValue({ data: detail({ retentionDays: null }) });
    renderPanel({ form: detail({ retentionDays: 30 }) });
    await userEvent.click(within(section()).getByLabelText(en('settings.retention.enabled')));
    expect(within(section()).queryByLabelText(en('settings.retention.days'))).toBeNull();
    await userEvent.click(within(section()).getByRole('button', { name: en('settings.retention.save') }));
    expect(impactCalls()).toHaveLength(0);
    expect(putSpy).toHaveBeenCalledWith(RETENTION_URL, { expectedRevision: 3, retentionDays: null });
  });

  it('shows the server’s refusal, e.g. FORM_SCOPE_REQUIRED for a scoped administrator', async () => {
    impact(0);
    putSpy.mockRejectedValue(
      new ApiError(403, { error: { code: 'FORM_SCOPE_REQUIRED', message: 'Only an administrator who can see every organisation may do this.', requestId: 'r' } }),
    );
    renderPanel({ form: detail({ retentionDays: 30 }) });
    const days = within(section()).getByLabelText(en('settings.retention.days'));
    await userEvent.clear(days);
    await userEvent.type(days, '10');
    await userEvent.click(within(section()).getByRole('button', { name: en('settings.retention.save') }));
    expect(await within(section()).findByText('Only an administrator who can see every organisation may do this.')).toBeTruthy();
  });

  it('is read-only without forms:entries_write', () => {
    renderPanel({ form: detail({ retentionDays: 30 }), permissions: ['forms:read', 'forms:write'] });
    expect(within(section()).queryByRole('button', { name: en('settings.retention.save') })).toBeNull();
    expect(within(section()).getByText(en('settings.retention.readOnly'))).toBeTruthy();
    expect((within(section()).getByLabelText(en('settings.retention.days')) as HTMLInputElement).disabled).toBe(true);
  });
});
