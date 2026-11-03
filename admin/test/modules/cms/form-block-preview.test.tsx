import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, waitFor } from '@testing-library/react';
import { Render } from '@puckeditor/core';
import { CatalogPreviewProvider, defaultPageBuilderConfig } from '@endora-commerce/cms-components';
import type { AvailablePublicFormDefinition } from '@endora-commerce/contracts';

/**
 * `specs/170-forms-module/` T063 (US2-3, contracts/blocks-and-storefront.md §3, §6) — the
 * `forms.Form` block on the editor's canvas. The editor reads the form through the admin preview
 * (`GET /api/v1/admin/forms/:id/preview`): the published version, or the working copy of a draft,
 * and a note says why a shopper would not see it as it is — a draft, a closed form, a form that is
 * gone, a form the editor may not view.
 */

const get = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (path: string) => get(path), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { fetchAdminFormRead } = await import('../../../../packages/modules/cms/src/admin/components/AdminCatalogPreviewProvider');

afterEach(() => {
  get.mockReset();
});

const FORM_ID = '00000000-0000-4000-8000-0000000170f1';
const NOTES = { draft: 'DRAFT NOTE', closed: 'CLOSED NOTE', not_found: 'NOT FOUND NOTE', forbidden: 'FORBIDDEN NOTE' };

const AVAILABLE: AvailablePublicFormDefinition = {
  formId: FORM_ID,
  key: 'ask',
  version: 2,
  language: 'en-US',
  availability: 'open',
  signedInOnly: false,
  captcha: null,
  texts: { title: 'Ask us' },
  confirmation: { type: 'message' },
  sections: [{ id: 's1', columns: 1, fields: [{ id: 'f1', type: 'text', key: 'name', width: 1, required: true, label: 'Name' }] }],
};

describe('the editor’s read of a form (T063)', () => {
  it('reads the published version, with no note for a published form', async () => {
    get.mockResolvedValue({ data: { ...AVAILABLE, status: 'published' } });
    const read = await fetchAdminFormRead(FORM_ID, NOTES);
    expect(get).toHaveBeenCalledWith(`/api/v1/admin/forms/${FORM_ID}/preview?source=published`);
    expect(read).toMatchObject({ availability: 'open', key: 'ask' });
    expect(read.editorNote).toBeUndefined();
  });

  it('notes a closed form', async () => {
    get.mockResolvedValue({ data: { ...AVAILABLE, availability: 'closed', status: 'closed' } });
    expect((await fetchAdminFormRead(FORM_ID, NOTES)).editorNote).toEqual({ code: 'closed', message: 'CLOSED NOTE' });
  });

  it('shows a draft’s working copy, noted as a draft', async () => {
    get
      .mockResolvedValueOnce({ data: { formId: FORM_ID, availability: 'unavailable', status: 'draft' } })
      .mockResolvedValueOnce({ data: { ...AVAILABLE, version: 1, status: 'draft' } });
    const read = await fetchAdminFormRead(FORM_ID, NOTES);
    expect(get).toHaveBeenLastCalledWith(`/api/v1/admin/forms/${FORM_ID}/preview?source=working`);
    expect(read).toMatchObject({ availability: 'open', editorNote: { code: 'draft', message: 'DRAFT NOTE' } });
  });

  it.each([
    [404, 'FORM_NOT_FOUND', { code: 'not_found', message: 'NOT FOUND NOTE' }],
    [403, 'FORBIDDEN', { code: 'forbidden', message: 'FORBIDDEN NOTE' }],
  ])('answers %i as unavailable with its note', async (status, code, note) => {
    get.mockRejectedValue(new ApiError(status, { error: { code: code as never, message: 'no' } }));
    expect(await fetchAdminFormRead(FORM_ID, NOTES)).toEqual({ formId: FORM_ID, availability: 'unavailable', editorNote: note });
  });
});

describe('forms.Form on the canvas (T063)', () => {
  function canvas(fetchForm: (id: string) => Promise<unknown>) {
    const api = {
      fetchProductsBySlugs: vi.fn(async () => []),
      fetchProductsList: vi.fn(async () => []),
      fetchCategoryTree: vi.fn(async () => []),
      fetchForm: vi.fn(fetchForm),
    };
    const data = { root: { props: {} }, content: [{ type: 'forms.Form', props: { id: 'form-1', formId: FORM_ID } }], zones: {} };
    return render(
      createElement(CatalogPreviewProvider, {
        api: api as never,
        children: createElement(Render as never, { config: defaultPageBuilderConfig as never, data: data as never }),
      }),
    );
  }

  it('renders the form with the note of a draft', async () => {
    const { container } = canvas(async () => ({ ...AVAILABLE, editorNote: { code: 'draft', message: 'DRAFT NOTE' } }));
    await waitFor(() => expect(container.textContent).toContain('DRAFT NOTE'));
    expect(container.querySelector('[name="name"]')).not.toBeNull();
  });

  it('renders only the note of a form that was not found', async () => {
    const { container } = canvas(async () => ({
      formId: FORM_ID,
      availability: 'unavailable',
      editorNote: { code: 'not_found', message: 'NOT FOUND NOTE' },
    }));
    await waitFor(() => expect(container.textContent).toContain('NOT FOUND NOTE'));
    expect(container.querySelector('form')).toBeNull();
  });
});
