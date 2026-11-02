import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormDefinition, FormDetail } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { setMobileViewport } from '../../setup';
import { publicFormDefinition } from '../../../../packages/modules/forms/src/backend/services/form-public-read';
import { COPY_ID, FORM_ID, LANGUAGE, detail, en, renderForms } from './forms-fixtures';

/**
 * The form builder (`specs/170-forms-module/` User Story 1, T032; FR-015 – FR-018;
 * `contracts/admin-surfaces.md` §4): fields added from the palette by drag **and** by the keyboard
 * "Add field" menu; fields and sections reordered with the keyboard alone, every move announced;
 * columns and widths laid out by the live preview — the storefront's own renderer (FR-017); a
 * refused publish shows each reason beside its element; warnings never block; close, reopen,
 * duplicate and delete.
 *
 * The preview endpoint is answered with the backend's own public read of the last saved working
 * copy, so what the preview lays out is what the server would serve.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const putSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { FormBuilderPage } = await import('../../../../packages/modules/forms/src/admin/pages/FormBuilderPage');

const API = `/api/v1/admin/forms/${FORM_ID}`;
let current: FormDetail;

function previewOf(form: FormDetail) {
  return {
    ...publicFormDefinition(
      {
        formId: form.id,
        key: form.key,
        status: form.status,
        version: { number: form.publishedVersionNumber + 1, definition: form.definition, defaultLanguage: form.defaultLanguage },
        acceptedEntryCount: 0,
      },
      form.id,
      { language: LANGUAGE, now: new Date(), captcha: null, preview: true },
    ),
    status: form.status,
  };
}

/** A `dataTransfer` the way a browser hands one to the handlers. */
function transfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    get types() {
      return [...data.keys()];
    },
    setData: (format: string, value: string) => void data.set(format, value),
    getData: (format: string) => data.get(format) ?? '',
    effectAllowed: 'all',
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

function renderBuilder(form: FormDetail = detail()) {
  current = form;
  return renderForms(<FormBuilderPage />, { path: `/forms/${FORM_ID}`, pattern: '/forms/:id' });
}

/** The fields of a section as the canvas lists them, by their labels. */
function fieldsIn(sectionName: string): string[] {
  const section = screen.getByRole('group', { name: sectionName });
  return within(section)
    .queryAllByRole('listitem')
    .map((item) => item.getAttribute('data-field-label') ?? '');
}

function savedDefinition(): FormDefinition {
  const body = putSpy.mock.calls.at(-1)![1] as { definition: FormDefinition };
  return body.definition;
}

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, putSpy, deleteSpy]) spy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/forms/languages') {
      return Promise.resolve({ data: { languages: [LANGUAGE, 'pl-PL'], defaultLanguage: LANGUAGE } });
    }
    if (path === API) return Promise.resolve({ data: current });
    if (path === `${API}/versions`) return Promise.resolve({ data: { items: [] } });
    if (path.startsWith(`${API}/preview`)) return Promise.resolve({ data: previewOf(current) });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  putSpy.mockImplementation((_path: string, body: { expectedRevision: number; definition?: FormDefinition }) => {
    current = { ...current, ...(body.definition ? { definition: body.definition } : {}), revision: body.expectedRevision + 1 };
    return Promise.resolve({ data: current });
  });
});

describe('FormBuilderPage — fields', () => {
  it('adds a field from the palette by dragging it onto a section', async () => {
    renderBuilder();
    const section = await screen.findByRole('group', { name: en('canvas.section', { number: 2 }) });
    const dataTransfer = transfer();
    fireEvent.dragStart(screen.getByRole('button', { name: en('palette.add', { type: en('fieldTypes.phone') }) }), {
      dataTransfer,
    });
    fireEvent.dragOver(section, { dataTransfer });
    fireEvent.drop(section, { dataTransfer });
    expect(fieldsIn(en('canvas.section', { number: 2 }))).toEqual(['Message', en('fieldTypes.phone')]);
    await userEvent.click(screen.getByRole('button', { name: en('builder.save') }));
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    const [, second] = savedDefinition().sections;
    expect(second!.fields.map((field) => field.type)).toEqual(['textarea', 'phone']);
    const added = second!.fields[1]!;
    expect('key' in added && added.key).toMatch(/^phone/);
  });

  it('adds a field with the keyboard through the section’s Add field menu', async () => {
    renderBuilder();
    const section = await screen.findByRole('group', { name: en('canvas.section', { number: 1 }) });
    await userEvent.click(within(section).getByRole('button', { name: en('canvas.addField') }));
    await userEvent.click(await screen.findByRole('menuitem', { name: en('fieldTypes.email') }));
    expect(fieldsIn(en('canvas.section', { number: 1 }))).toEqual(['Name', 'E-mail', en('fieldTypes.email')]);
    // The new field is the one being edited.
    expect(screen.getByRole('heading', { name: en('inspector.title', { type: en('fieldTypes.email') }) })).toBeTruthy();
  });

  it('reorders fields within and between sections, and sections, with the keyboard alone — announced', async () => {
    renderBuilder();
    const first = en('canvas.section', { number: 1 });
    await screen.findByRole('group', { name: first });

    const nameHandle = screen.getByRole('button', { name: en('reorder.itemHandle', { name: 'Name' }) });
    nameHandle.focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard(' ');
    expect(fieldsIn(first)).toEqual(['E-mail', 'Name']);
    expect(screen.getByRole('status').textContent).toContain('Name');

    const messageHandle = screen.getByRole('button', { name: en('reorder.itemHandle', { name: 'Message' }) });
    messageHandle.focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard(' ');
    expect(fieldsIn(first)).toEqual(['E-mail', 'Name', 'Message']);

    const secondHandle = screen.getByRole('button', {
      name: en('reorder.groupHandle', { name: en('canvas.section', { number: 2 }) }),
    });
    secondHandle.focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard(' ');

    await userEvent.click(screen.getByRole('button', { name: en('builder.save') }));
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    expect(savedDefinition().sections.map((section) => [section.id, section.fields.map((field) => field.id)])).toEqual([
      ['s2', []],
      ['s1', ['f2', 'f1', 'f3']],
    ]);
  });

  it('lays out columns and widths in the live preview (US1-2, US1-3, FR-017)', async () => {
    renderBuilder();
    const section = await screen.findByRole('group', { name: en('canvas.section', { number: 1 }) });
    await userEvent.selectOptions(within(section).getByLabelText(en('canvas.columns')), '3');
    await userEvent.click(within(section).getByRole('button', { name: en('canvas.edit', { name: 'Name' }) }));
    await userEvent.selectOptions(screen.getByLabelText(en('inspector.width')), '2');
    await userEvent.click(screen.getByRole('button', { name: en('builder.save') }));
    const preview = await screen.findByRole('region', { name: en('preview.title') });
    await waitFor(() => expect(preview.querySelector('.cmsc-pb-form__grid--cols-3')).not.toBeNull());
    expect(preview.querySelector('.cmsc-pb-form__cell--span-2')).not.toBeNull();
    expect(within(preview).getByLabelText(/Name/)).toBeTruthy();
  });

  it('renames a key with a warning once the form has been published', async () => {
    renderBuilder(detail({ status: 'published', publishedVersionNumber: 1, publishedDefinition: detail().definition }));
    await userEvent.click(await screen.findByRole('button', { name: en('canvas.edit', { name: 'Name' }) }));
    const key = screen.getByLabelText(en('inspector.key'));
    await userEvent.clear(key);
    await userEvent.type(key, 'full_name');
    expect(screen.getByText(en('inspector.keyRenameWarning'))).toBeTruthy();
  });
});

describe('FormBuilderPage — publish, warnings and the form’s status', () => {
  it('shows each publish refusal next to its element, and in the publish bar (US1-4)', async () => {
    postSpy.mockRejectedValue(
      new ApiError(400, {
        error: {
          code: 'FORM_DEFINITION_INVALID',
          message: 'This form cannot be published yet.',
          details: { issues: [{ code: 'missing_default_language_label', elementId: 'f2', path: 'sections[0].fields[1]' }] },
        },
      }),
    );
    renderBuilder();
    await userEvent.click(await screen.findByRole('button', { name: en('builder.publish') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`${API}/publish`, { expectedRevision: 3 }));
    const bar = await screen.findByRole('region', { name: en('builder.publishBar') });
    expect(within(bar).getByText(en('builder.publishRefused'))).toBeTruthy();
    const field = screen.getAllByRole('listitem').find((item) => item.getAttribute('data-field-label') === 'E-mail')!;
    expect(within(field).getByText(en('issues.missing_default_language_label'))).toBeTruthy();
    // The reason in the bar takes the operator to the element.
    await userEvent.click(within(bar).getByRole('button', { name: new RegExp(en('issues.missing_default_language_label')) }));
    expect(screen.getByRole('heading', { name: en('inspector.title', { type: en('fieldTypes.email') }) })).toBeTruthy();
  });

  it('saves the working copy before publishing it', async () => {
    postSpy.mockImplementation(() => Promise.resolve({ data: { ...current, status: 'published', publishedVersionNumber: 1 } }));
    renderBuilder();
    const section = await screen.findByRole('group', { name: en('canvas.section', { number: 1 }) });
    await userEvent.selectOptions(within(section).getByLabelText(en('canvas.columns')), '2');
    await userEvent.click(screen.getByRole('button', { name: en('builder.publish') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`${API}/publish`, { expectedRevision: 4 }));
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(en('status.published'))).toBeTruthy();
  });

  it('shows the warnings without blocking the publish (FR-018)', async () => {
    renderBuilder(
      detail({
        warnings: [{ code: 'captcha_not_configured' }, { code: 'untranslated', language: 'pl-PL', missing: 2 }],
      }),
    );
    expect(await screen.findByText(en('warnings.captcha_not_configured'))).toBeTruthy();
    expect(screen.getByText(en('warnings.untranslated', { language: 'pl-PL', count: 2 }))).toBeTruthy();
    expect(screen.getByRole('button', { name: en('builder.publish') })).toBeEnabled();
  });

  it('closes and reopens a published form (US1-7)', async () => {
    postSpy.mockImplementation((path: string) => {
      const status = path.endsWith('/close') ? 'closed' : 'published';
      current = { ...current, status, revision: current.revision + 1 };
      return Promise.resolve({ data: current });
    });
    renderBuilder(detail({ status: 'published', publishedVersionNumber: 1, publishedDefinition: detail().definition }));
    await userEvent.click(await screen.findByRole('button', { name: en('builder.close') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`${API}/close`, { expectedRevision: 3 }));
    await userEvent.click(await screen.findByRole('button', { name: en('builder.reopen') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`${API}/reopen`, { expectedRevision: 4 }));
  });

  it('duplicates the form and opens the copy (FR-014)', async () => {
    postSpy.mockResolvedValue({ data: detail({ id: COPY_ID, key: 'contact_copy' }) });
    renderBuilder();
    await userEvent.click(await screen.findByRole('button', { name: en('builder.duplicate') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`${API}/duplicate`, {}));
  });

  it('deletes the form behind a dialog and returns to the list (FR-013)', async () => {
    deleteSpy.mockResolvedValue(undefined);
    renderBuilder();
    await userEvent.click(await screen.findByRole('button', { name: en('builder.delete') }));
    const dialog = await screen.findByRole('dialog', { name: en('delete.title', { name: 'Contact' }) });
    await userEvent.click(within(dialog).getByRole('button', { name: en('delete.confirm') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${API}?expectedRevision=3`));
    expect(await screen.findByText('forms list screen')).toBeTruthy();
  });
});

describe('FormBuilderPage — notifications (User Story 5, T090)', () => {
  it('opens the Notifications tab; a recipients save takes the new revision and keeps the unsaved draft', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/forms/languages') {
        return Promise.resolve({ data: { languages: [LANGUAGE, 'pl-PL'], defaultLanguage: LANGUAGE } });
      }
      if (path === API) return Promise.resolve({ data: current });
      if (path.startsWith(`${API}/preview`)) return Promise.resolve({ data: previewOf(current) });
      if (path.startsWith('/api/v1/admin/sales-channels')) return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderBuilder();
    const name = await screen.findByLabelText(en('builder.name'));
    await userEvent.clear(name);
    await userEvent.type(name, 'Renamed, not saved');
    await userEvent.click(screen.getByRole('tab', { name: en('builder.tabs.notifications') }));
    const panel = screen.getByRole('tabpanel', { name: en('builder.tabs.notifications') });
    await userEvent.click(within(panel).getByLabelText(en('notifications.confirmation.enabled')));
    await userEvent.click(within(panel).getByRole('button', { name: en('notifications.recipients.save') }));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith(`${API}/notifications`, {
        expectedRevision: 3,
        recipients: ['shop@example.com'],
        channelRecipients: {},
      }),
    );
    expect(await within(panel).findByText(en('notifications.recipients.saved'))).toBeTruthy();
    // The draft — the name and the confirmation switch — is still unsaved, against the new revision.
    expect(screen.getByText(en('builder.unsaved'))).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: en('builder.save') }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(2));
    const body = putSpy.mock.calls[1]![1] as { expectedRevision: number; name: string; definition: FormDefinition };
    expect(body.expectedRevision).toBe(4);
    expect(body.name).toBe('Renamed, not saved');
    expect(body.definition.behaviour.confirmationEmail.enabled).toBe(true);
  });
});

describe('FormBuilderPage — settings and translations (User Stories 6 and 7, T099, T103)', () => {
  it('edits the restrictions on the Settings tab and a Polish text on the Translations tab, both saved with the form', async () => {
    renderBuilder();
    await screen.findByLabelText(en('builder.name'));
    await userEvent.click(screen.getByRole('tab', { name: en('builder.tabs.settings') }));
    const settings = screen.getByRole('tabpanel', { name: en('builder.tabs.settings') });
    await userEvent.click(within(settings).getByLabelText(en('settings.restrictions.signedInOnly')));

    await userEvent.click(screen.getByRole('tab', { name: en('builder.tabs.translations') }));
    const translations = screen.getByRole('tabpanel', { name: en('builder.tabs.translations') });
    await userEvent.click(await within(translations).findByRole('tab', { name: 'pl-PL' }));
    await userEvent.type(within(translations).getByRole('textbox', { name: new RegExp(en('translations.text.title')) }), 'Kontakt');

    await userEvent.click(screen.getByRole('button', { name: en('builder.save') }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const saved = savedDefinition();
    expect(saved.restrictions.signedInOnly).toBe(true);
    expect(saved.texts['pl-PL']?.['form.title']).toBe('Kontakt');
    expect(saved.texts[LANGUAGE]?.['form.title']).toBe('Contact');
  });
});
