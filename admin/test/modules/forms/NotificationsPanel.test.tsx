import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { FormDefinition, FormDetail } from '@endora-commerce/contracts';
import { CHANNEL_ID, FORM_ID, LANGUAGE, definition, detail, en, renderForms } from './forms-fixtures';

/**
 * The builder's *Notifications* tab (`specs/170-forms-module/` User Story 5, T090; FR-056 – FR-058,
 * A-2): the default recipients and the per-channel lists — saved on their own, live, through
 * `PUT …/notifications` — and the confirmation e-mail, which is part of the form and edits the draft
 * the builder saves and publishes, with its subject and text per storefront language.
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

const { NotificationsPanel } = await import('../../../../packages/modules/forms/src/admin/components/NotificationsPanel');

const SUBMITTER_DEFINITION = definition({
  sections: [
    {
      id: 's1',
      columns: 1,
      fields: [
        { id: 'f1', type: 'text', key: 'name' },
        { id: 'f2', type: 'email', key: 'email', submitterEmail: true },
      ],
    },
  ],
});

interface Harness {
  readonly onSaved: ReturnType<typeof vi.fn>;
  readonly onDefinitionChange: ReturnType<typeof vi.fn>;
  latest(): FormDefinition;
}

function renderPanel(
  options: { form?: FormDetail; definition?: FormDefinition; disabled?: boolean; permissions?: string[]; language?: string } = {},
): Harness {
  let current = options.definition ?? SUBMITTER_DEFINITION;
  const onSaved = vi.fn();
  const onDefinitionChange = vi.fn();
  // The builder's role: it holds the draft and hands each edit back to the panel.
  function Host(): ReactNode {
    const [draft, setDraft] = useState(current);
    return (
      <NotificationsPanel
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
  renderForms(<Host />, { permissions: options.permissions ?? ['forms:read', 'forms:write'] });
  return { onSaved, onDefinitionChange, latest: () => current };
}

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/sales-channels')) {
      return Promise.resolve({
        items: [{ id: CHANNEL_ID, code: 'eu', name: { 'en-US': 'EU store' }, active: true }],
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  putSpy.mockImplementation((_path: string, body: { recipients: string[]; channelRecipients: Record<string, string[]> }) =>
    Promise.resolve({ data: detail({ recipients: body.recipients, channelRecipients: body.channelRecipients, revision: 4 }) }),
  );
});

describe('NotificationsPanel — recipients', () => {
  it('saves the default recipients, one address per line, naming the revision (FR-056)', async () => {
    const user = userEvent.setup();
    const harness = renderPanel();
    const field = screen.getByLabelText(en('notifications.recipients.default'));
    expect((field as HTMLTextAreaElement).value).toBe('shop@example.com');
    await user.clear(field);
    await user.type(field, 'shop@example.com\n  sales@example.com \n\n');
    await user.click(screen.getByRole('button', { name: en('notifications.recipients.save') }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy).toHaveBeenCalledWith(`/api/v1/admin/forms/${FORM_ID}/notifications`, {
      expectedRevision: 3,
      recipients: ['shop@example.com', 'sales@example.com'],
      channelRecipients: {},
    });
    await waitFor(() => expect(harness.onSaved).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(en('notifications.recipients.saved'))).toBeTruthy();
  });

  it('refuses an address that is not one, and more than ten, next to the list, without calling the server', async () => {
    const user = userEvent.setup();
    renderPanel();
    const field = screen.getByLabelText(en('notifications.recipients.default'));
    await user.clear(field);
    await user.type(field, 'not-an-address');
    await user.click(screen.getByRole('button', { name: en('notifications.recipients.save') }));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const described = (field.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain(en('notifications.recipients.error.invalid', { address: 'not-an-address' }));

    await user.clear(field);
    await user.type(field, Array.from({ length: 11 }, (_, i) => `a${i}@example.com`).join('\n'));
    await user.click(screen.getByRole('button', { name: en('notifications.recipients.save') }));
    expect(screen.getByText(en('notifications.recipients.error.tooMany', { max: 10 }))).toBeTruthy();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('adds a list for a sales channel through the channel picker, which replaces the default there (A-2)', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: en('notifications.recipients.addChannel') }));
    const row = screen.getByRole('group', { name: en('notifications.recipients.channelRow', { number: 1 }) });
    await user.click(within(row).getByRole('combobox'));
    await user.click(await screen.findByText('EU store'));
    await user.type(within(row).getByLabelText(en('notifications.recipients.channelList')), 'eu@example.com');
    await user.click(screen.getByRole('button', { name: en('notifications.recipients.save') }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy.mock.calls[0]![1]).toEqual({
      expectedRevision: 3,
      recipients: ['shop@example.com'],
      channelRecipients: { [CHANNEL_ID]: ['eu@example.com'] },
    });
  });

  it('asks for a channel before saving a channel list, and removes one', async () => {
    const user = userEvent.setup();
    renderPanel({ form: detail({ channelRecipients: { [CHANNEL_ID]: ['eu@example.com'] } }) });
    await user.click(screen.getByRole('button', { name: en('notifications.recipients.addChannel') }));
    await user.click(screen.getByRole('button', { name: en('notifications.recipients.save') }));
    expect(screen.getByText(en('notifications.recipients.error.noChannel'))).toBeTruthy();
    expect(putSpy).not.toHaveBeenCalled();

    const second = screen.getByRole('group', { name: en('notifications.recipients.channelRow', { number: 2 }) });
    await user.click(within(second).getByRole('button', { name: en('notifications.recipients.removeChannel') }));
    await user.click(screen.getByRole('button', { name: en('notifications.recipients.save') }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy.mock.calls[0]![1]).toMatchObject({ channelRecipients: { [CHANNEL_ID]: ['eu@example.com'] } });
  });

  it("says the server's sentence when the form changed meanwhile (R-26)", async () => {
    const user = userEvent.setup();
    putSpy.mockRejectedValueOnce(
      new ApiError(409, { error: { code: 'FORM_REVISION_CONFLICT', message: 'Changed by someone else.', requestId: 'r' } }),
    );
    renderPanel();
    await user.click(screen.getByRole('button', { name: en('notifications.recipients.save') }));
    expect(await screen.findByText('Changed by someone else.')).toBeTruthy();
  });

  it('is read-only without forms:write', () => {
    renderPanel({ disabled: true, permissions: ['forms:read'] });
    expect((screen.getByLabelText(en('notifications.recipients.default')) as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: en('notifications.recipients.save') })).toBeNull();
    expect((screen.getByLabelText(en('notifications.confirmation.enabled')) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('NotificationsPanel — confirmation e-mail', () => {
  it('turns the confirmation on with a summary and writes its subject in the default language (FR-058)', async () => {
    const user = userEvent.setup();
    const harness = renderPanel();
    const summary = screen.getByLabelText(en('notifications.confirmation.summary')) as HTMLInputElement;
    expect(summary.disabled).toBe(true);
    await user.click(screen.getByLabelText(en('notifications.confirmation.enabled')));
    expect(harness.latest().behaviour.confirmationEmail).toEqual({ enabled: true, includeSummary: false });
    await user.click(screen.getByLabelText(en('notifications.confirmation.summary')));
    expect(harness.latest().behaviour.confirmationEmail).toEqual({ enabled: true, includeSummary: true });

    await user.type(screen.getByLabelText(en('notifications.confirmation.subject')), 'Thanks');
    expect(harness.latest().texts[LANGUAGE]?.['email.confirmation.subject']).toBe('Thanks');
  });

  it('in another content language edits only the e-mail texts, falling back to the default ones (US7-1)', async () => {
    const user = userEvent.setup();
    const source = definition({
      ...SUBMITTER_DEFINITION,
      texts: { [LANGUAGE]: { 'email.confirmation.subject': 'Thanks' } },
    });
    const harness = renderPanel({ definition: source, language: 'pl-PL' });
    const subject = screen.getByLabelText(en('notifications.confirmation.subject'));
    expect(subject).toHaveAttribute('placeholder', 'Thanks');
    expect(subject).toHaveAccessibleDescription(en('language.fromDefault', { language: LANGUAGE }));
    expect(screen.getByLabelText(en('notifications.confirmation.enabled'))).toBeDisabled();
    expect(screen.getByLabelText(en('notifications.recipients.default'))).toBeDisabled();
    expect(screen.queryByRole('button', { name: en('notifications.recipients.save') })).toBeNull();
    await user.type(subject, 'Dzięki');
    await user.type(screen.getByLabelText(en('notifications.confirmation.body')), 'Odpiszemy');
    const texts = harness.latest().texts;
    expect(texts[LANGUAGE]?.['email.confirmation.subject']).toBe('Thanks');
    expect(texts['pl-PL']?.['email.confirmation.subject']).toBe('Dzięki');
    expect(texts['pl-PL']?.['email.confirmation.body']).toBe('Odpiszemy');
  });

  it('says that no confirmation can be sent while no field is the submitter e-mail', () => {
    renderPanel({ definition: definition() });
    expect(screen.getByText(en('notifications.confirmation.noSubmitterField'))).toBeTruthy();
  });
});
