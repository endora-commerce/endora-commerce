import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode, useState, type ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';

/**
 * `specs/170-forms-module/` T052 (FR-004, US2-2) — the form picker of the `forms.Form` block.
 *
 * - It lists the forms the editor may see (`GET /api/v1/admin/forms?pageSize=100`), each by name
 *   with its status, and stores the form's id.
 * - It refetches when the window regains focus, so a form created in another tab can be picked
 *   without reloading the editor; "Create a new form" opens `/forms/new` in a new tab.
 * - A stored id the list does not hold stays selected, said to be a form that was not found.
 * - Without `forms:read` (403) it says why there is nothing to pick, and keeps the stored id.
 *
 * Lives beside the newsletter pickers' test: `page-builder-admin` has no test runner of its own.
 */

const get = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (path: string) => get(path), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { FormPickerControl, createFormPickerField } = await import('@endora-commerce/page-builder-admin');

// The picker's words are the `core` bundle's: `page-builder-admin` belongs to no module.
const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

afterEach(() => {
  cleanup();
  get.mockReset();
});

const ID_A = '00000000-0000-4000-8000-0000000170a1';
const ID_B = '00000000-0000-4000-8000-0000000170b2';
const UNKNOWN = '00000000-0000-4000-8000-0000000170cc';

function list(items: Array<{ id: string; name: string; status: string }>) {
  return { data: { items: items.map((item) => ({ key: 'k', ...item })), total: items.length } };
}

function wrap(node: ReactElement): ReactElement {
  return (
    <StrictMode>
      <TranslationProvider language="en" initialBundle={{ core: CORE_EN } as Bundle}>
        {node}
      </TranslationProvider>
    </StrictMode>
  );
}

function Harness({ initial, onChange }: { initial?: string; onChange: (id: string) => void }): ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <FormPickerControl
      label="Form"
      value={value}
      onChange={(id: string): void => {
        setValue(id);
        onChange(id);
      }}
    />
  );
}

describe('the form picker (T052)', () => {
  it('lists the forms by name and status and stores the id', async () => {
    get.mockResolvedValue(
      list([
        { id: ID_A, name: 'Ask about racking', status: 'published' },
        { id: ID_B, name: 'Trade application', status: 'draft' },
      ]),
    );
    const onChange = vi.fn();
    render(wrap(<Harness onChange={onChange} />));
    // While the list loads the stored id is kept in a disabled select; then the forms are listed.
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).options).toHaveLength(3));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(get).toHaveBeenCalledWith('/api/v1/admin/forms?pageSize=100');
    expect([...select.options].map((option) => option.textContent)).toEqual([
      CORE_EN['pageBuilder.formPicker.choose'],
      `Ask about racking (${CORE_EN['pageBuilder.formPicker.status.published']})`,
      `Trade application (${CORE_EN['pageBuilder.formPicker.status.draft']})`,
    ]);
    fireEvent.change(select, { target: { value: ID_B } });
    expect(onChange).toHaveBeenCalledWith(ID_B);
  });

  it('reads the list again when the window regains focus, so a form made in another tab can be picked', async () => {
    get.mockResolvedValue(list([{ id: ID_A, name: 'Ask about racking', status: 'published' }]));
    render(wrap(<Harness onChange={vi.fn()} />));
    await waitFor(() => expect(screen.getByRole('option', { name: /Ask about racking/ })).toBeTruthy());
    expect(screen.queryByRole('option', { name: /Brand new form/ })).toBeNull();
    get.mockResolvedValue(
      list([
        { id: ID_A, name: 'Ask about racking', status: 'published' },
        { id: ID_B, name: 'Brand new form', status: 'published' },
      ]),
    );
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(screen.getByRole('option', { name: /Brand new form/ })).toBeTruthy());
  });

  it('opens the forms screen in a new tab to create a form', async () => {
    get.mockResolvedValue(list([]));
    render(wrap(<Harness onChange={vi.fn()} />));
    const link = await screen.findByRole('link', { name: new RegExp(CORE_EN['pageBuilder.formPicker.create']!) });
    expect(link.getAttribute('href')).toBe('/forms/new');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('keeps a stored id the list does not hold, said to be a form that was not found', async () => {
    get.mockResolvedValue(list([{ id: ID_A, name: 'Ask about racking', status: 'published' }]));
    render(wrap(<Harness initial={UNKNOWN} onChange={vi.fn()} />));
    await waitFor(() => expect(screen.getByText(CORE_EN['pageBuilder.formPicker.notFound']!)).toBeTruthy());
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(UNKNOWN);
    expect(screen.getByText(CORE_EN['pageBuilder.formPicker.notFound']!)).toBeTruthy();
  });

  it('says why there is nothing to pick without permission, and keeps the stored id', async () => {
    get.mockRejectedValue(new ApiError(403, { error: { code: 'FORBIDDEN', message: 'no' } }));
    const onChange = vi.fn();
    render(wrap(<Harness initial={ID_A} onChange={onChange} />));
    expect(await screen.findByText(CORE_EN['pageBuilder.formPicker.forbidden']!)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is a custom field on the Data tab', () => {
    const field = createFormPickerField('Form');
    expect(field.type).toBe('custom');
    expect(field.label).toBe('Form');
  });
});
