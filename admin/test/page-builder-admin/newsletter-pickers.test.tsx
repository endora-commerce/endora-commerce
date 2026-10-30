import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useState, type ReactElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';

/**
 * `specs/169-page-builder-contact-form/` US7, FR-024, FR-025, research R-11
 * (T180) — the editor picks a sign-up topic's tag and a subscriber attribute's
 * custom field from the newsletter's own lists instead of typing codes.
 *
 * - The tag field reads `GET /api/v1/admin/newsletter/tags`, lists the names
 *   and stores the code it always stored; a stored code the list lacks stays
 *   selected; when the list cannot be read (no permission, the module off) the
 *   code is a text box, as before.
 * - The custom-field field reads `…/custom-fields` and writes the key, the
 *   type and the field's label together; without the list, the key is a text
 *   box beside a type select.
 */

const get = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (path: string) => get(path), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const {
  NewsletterTagCodeControl,
  NewsletterCustomFieldControl,
  createNewsletterTagCodeField,
  createNewsletterCustomFieldField,
  withNewsletterAttributePick,
} = await import('@endora-commerce/page-builder-admin');

afterEach(() => {
  cleanup();
  get.mockReset();
});

const TAGS = {
  data: {
    items: [
      { id: '00000000-0000-4000-8000-000000000001', code: 'offers', name: 'Special offers', description: null },
      { id: '00000000-0000-4000-8000-000000000002', code: 'events', name: 'Events', description: null },
    ],
  },
};
const FIELDS = {
  data: {
    items: [
      { id: '00000000-0000-4000-8000-000000000003', key: 'company', label: 'Company name', type: 'text' },
      { id: '00000000-0000-4000-8000-000000000004', key: 'vip', label: 'Trade customer', type: 'boolean' },
    ],
  },
};

function wrap(node: ReactElement): ReactElement {
  return (
    <StrictMode>
      <TranslationProvider language="en" initialBundle={{ core: {} } as Bundle}>
        {node}
      </TranslationProvider>
    </StrictMode>
  );
}

function TagHarness({ initial, onChange }: { initial?: string; onChange: (code: string) => void }): ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <NewsletterTagCodeControl
      label="Newsletter tag"
      value={value}
      onChange={(code: string): void => {
        setValue(code);
        onChange(code);
      }}
    />
  );
}

describe('the newsletter tag field (T180)', () => {
  it('lists the tags by name and stores the code', async () => {
    get.mockResolvedValue(TAGS);
    const onChange = vi.fn();
    render(wrap(<TagHarness onChange={onChange} />));
    const select = await screen.findByRole('combobox');
    expect(get).toHaveBeenCalledWith('/api/v1/admin/newsletter/tags');
    expect([...(select as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(
      expect.arrayContaining(['Special offers', 'Events']),
    );
    fireEvent.change(select, { target: { value: 'events' } });
    expect(onChange).toHaveBeenLastCalledWith('events');
  });

  it('keeps a stored code the list does not hold, selected', async () => {
    get.mockResolvedValue(TAGS);
    render(wrap(<TagHarness initial="archived_topic" onChange={vi.fn()} />));
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;
    expect(select.value).toBe('archived_topic');
    expect([...select.options].map((option) => option.value)).toContain('archived_topic');
  });

  it.each([
    ['no permission', () => Promise.reject(new ApiError(403, { error: { code: 'FORBIDDEN', message: 'no' } }))],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('falls back to the code as text on %s', async (_reason, answer) => {
    get.mockImplementation(answer);
    const onChange = vi.fn();
    render(wrap(<TagHarness initial="offers" onChange={onChange} />));
    await waitFor(() => expect(get).toHaveBeenCalled());
    const box = (await screen.findByRole('textbox')) as HTMLInputElement;
    expect(box.value).toBe('offers');
    fireEvent.change(box, { target: { value: 'events' } });
    expect(onChange).toHaveBeenLastCalledWith('events');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('is a custom Puck field labelled as given', () => {
    const field = createNewsletterTagCodeField('Newsletter tag');
    expect(field.type).toBe('custom');
    expect(field.label).toBe('Newsletter tag');
  });
});

describe('the newsletter custom field field (T180)', () => {
  it('lists the custom fields by label and writes key, type and label together', async () => {
    get.mockResolvedValue(FIELDS);
    const onPick = vi.fn();
    render(wrap(<NewsletterCustomFieldControl label="Custom field" value={{}} onPick={onPick} />));
    // While the list loads the control is the fallback (a key box and a type select); wait for the list.
    const select = (await screen.findByRole('option', { name: 'Company name' })).closest('select')!;
    expect(get).toHaveBeenCalledWith('/api/v1/admin/newsletter/custom-fields');
    expect([...select.options].map((option) => option.textContent)).toEqual(
      expect.arrayContaining(['Company name', 'Trade customer']),
    );
    fireEvent.change(select, { target: { value: 'vip' } });
    expect(onPick).toHaveBeenLastCalledWith({ key: 'vip', type: 'boolean', fieldLabel: 'Trade customer' });
  });

  it('keeps a stored key the list does not hold, selected', async () => {
    get.mockResolvedValue(FIELDS);
    render(wrap(<NewsletterCustomFieldControl label="Custom field" value={{ key: 'retired', type: 'number' }} onPick={vi.fn()} />));
    const select = (await screen.findByRole('option', { name: 'Company name' })).closest('select')!;
    expect(select.value).toBe('retired');
  });

  it('falls back to the key as text beside a type select when the list cannot be read', async () => {
    get.mockRejectedValue(new ApiError(403, { error: { code: 'FORBIDDEN', message: 'no' } }));
    const onPick = vi.fn();
    render(wrap(<NewsletterCustomFieldControl label="Custom field" value={{ key: 'age', type: 'number' }} onPick={onPick} />));
    const box = (await screen.findByRole('textbox')) as HTMLInputElement;
    expect(box.value).toBe('age');
    const type = screen.getByRole('combobox') as HTMLSelectElement;
    expect(type.value).toBe('number');
    expect([...type.options].map((option) => option.value)).toEqual(['text', 'number', 'boolean', 'date']);
    fireEvent.change(box, { target: { value: 'years' } });
    expect(onPick).toHaveBeenLastCalledWith({ key: 'years', type: 'number' });
    fireEvent.change(type, { target: { value: 'date' } });
    expect(onPick).toHaveBeenLastCalledWith({ key: 'age', type: 'date' });
  });

  it('writes the pick into the attribute the field belongs to, leaving the rest of it', () => {
    const props = { id: 'b', attributes: [{ key: 'a', type: 'text', label: 'Own' }, { key: 'old', type: 'text', required: true }] };
    const next = withNewsletterAttributePick(props, 'attributes[1].key', { key: 'vip', type: 'boolean', fieldLabel: 'Trade customer' });
    expect(next).toEqual({
      id: 'b',
      attributes: [
        { key: 'a', type: 'text', label: 'Own' },
        { key: 'vip', type: 'boolean', fieldLabel: 'Trade customer', required: true },
      ],
    });
    expect(props.attributes[1]).toEqual({ key: 'old', type: 'text', required: true });
    expect(withNewsletterAttributePick(props, 'not-an-item-path', { key: 'x' })).toBeNull();
  });

  it('is a custom Puck field labelled as given', () => {
    const field = createNewsletterCustomFieldField('Custom field');
    expect(field.type).toBe('custom');
    expect(field.label).toBe('Custom field');
  });
});
