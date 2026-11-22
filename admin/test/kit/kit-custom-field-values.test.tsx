import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * `CustomFieldValuesPanel` is a published component (feature 091, P4e).
 *
 * `admin-component-contribution.md` §9.1 rules it is not, and never was, a zone
 * contribution: its props are `(entityType, values, save)`, so every one of its
 * four call sites hands it the **host's own** stored bag and the host's own
 * writer. `custom_fields`' admin API serves definitions and no values at all —
 * Principle XIV working as designed puts the values on the host's row. What
 * crosses the seam is therefore one `GET` for the definitions and two `core`
 * translation keys, which is P2's shape exactly.
 *
 * So the assertions here are the ones `kit-pickers.test.tsx` and
 * `kit-asset-picker.test.tsx` make for P2 and P4c: the **request** the component
 * builds itself, and the **English sentence** an operator reads out of the
 * shipped `core` bundle. A `passthroughBundle` would pass over a key that never
 * travelled — a missing key does not throw and does not 404, it renders
 * `customFields.title` at the operator — so the bundle is read off `_i18n`'s own
 * `en.json`.
 *
 * The mock is keyed on `@endora-commerce/admin-kit/lib` because `vi.mock` keys
 * on a resolved module id: the component imports `apiClient` through the kit's
 * published `lib` barrel, which resolves to the same file this specifier does.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { CustomFieldValuesPanel } = await import('@endora-commerce/admin-kit/components');

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

const bundle = { core: CORE_EN };

/** Every key the panel reads, and a sentinel for one `core` does not carry. */
const MISSING: string[] = [];
const copy = (key: string): string => {
  const value = CORE_EN[key];
  if (value === undefined) {
    MISSING.push(key);
    return `«core is missing ${key}»`;
  }
  return value;
};

const COPY = {
  title: copy('customFields.title'),
  save: copy('customFields.save'),
};

function definition(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-00000000d001',
    entityType: 'customer',
    key: 'loyalty_tier',
    label: { en: 'Loyalty tier' },
    labelDefault: 'Loyalty tier',
    valueType: 'text',
    required: false,
    sortOrder: 0,
    config: {},
    options: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  getSpy.mockReset();
});

describe('CustomFieldValuesPanel — the two keys it reads live in `core`', () => {
  it('carries both in the shipped bundle, so publication added none', () => {
    // P4e adds no `core` key: `customFields.title` and `customFields.save` were
    // already there, which is what keeps R-1 out of this move.
    expect(MISSING).toEqual([]);
    expect(COPY.title).toBe(CORE_EN['customFields.title']);
    expect(COPY.save).toBe(CORE_EN['customFields.save']);
  });
});

describe('CustomFieldValuesPanel — the request it builds', () => {
  it('asks the definitions endpoint itself, scoped to the entity type', async () => {
    getSpy.mockResolvedValue({ data: [definition()] });

    renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} save={async (): Promise<void> => {}} />,
      bundle,
    );

    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    expect(getSpy.mock.calls[0]?.[0]).toBe(
      '/api/v1/admin/custom-fields/definitions?entityType=customer',
    );
  });

  it('re-asks when the entity type changes', async () => {
    getSpy.mockResolvedValue({ data: [definition({ entityType: 'order' })] });

    const { rerender } = renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} save={async (): Promise<void> => {}} />,
      bundle,
    );
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));

    rerender(
      <CustomFieldValuesPanel entityType="order" values={{}} save={async (): Promise<void> => {}} />,
    );
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
    expect(getSpy.mock.calls[1]?.[0]).toBe(
      '/api/v1/admin/custom-fields/definitions?entityType=order',
    );
  });
});

describe('CustomFieldValuesPanel — it renders the host\'s bag and hands it back', () => {
  it('renders the definition-driven form out of the `core` bundle', async () => {
    getSpy.mockResolvedValue({ data: [definition()] });

    renderWithI18n(
      <CustomFieldValuesPanel
        entityType="customer"
        values={{ loyalty_tier: 'gold' }}
        save={async (): Promise<void> => {}}
      />,
      bundle,
    );

    await waitFor(() => expect(screen.getByText(COPY.title)).toBeTruthy());
    expect(screen.getByRole('button', { name: COPY.save })).toBeTruthy();
    expect(screen.getByLabelText('Loyalty tier')).toHaveValue('gold');
  });

  it('hands the edited bag to the host\'s own `save`', async () => {
    getSpy.mockResolvedValue({ data: [definition()] });
    const save = vi.fn().mockResolvedValue(undefined);

    renderWithI18n(
      <CustomFieldValuesPanel
        entityType="customer"
        values={{ loyalty_tier: 'gold' }}
        save={save}
      />,
      bundle,
    );

    const input = await screen.findByLabelText('Loyalty tier');
    await userEvent.clear(input);
    await userEvent.type(input, 'silver');
    await userEvent.click(screen.getByRole('button', { name: COPY.save }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toEqual({ loyalty_tier: 'silver' });
  });

  it('marks a required field and offers the defined select options', async () => {
    getSpy.mockResolvedValue({
      data: [
        definition({
          key: 'segment',
          label: { en: 'Segment' },
          labelDefault: 'Segment',
          valueType: 'select',
          required: true,
          options: [
            {
              id: '00000000-0000-4000-8000-00000000e001',
              value: 'smb',
              label: { en: 'SMB' },
              labelDefault: 'SMB',
              isDefault: false,
              sortOrder: 0,
            },
          ],
        }),
      ],
    });

    renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} save={async (): Promise<void> => {}} />,
      bundle,
    );

    const select = await screen.findByLabelText(/Segment/);
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'SMB' })).toBeTruthy();
  });

  it('shows the message when the host\'s own write fails', async () => {
    getSpy.mockResolvedValue({ data: [definition()] });
    const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
      '@endora-commerce/admin-kit/lib',
    );
    const save = vi.fn().mockRejectedValue(
      new ApiError(422, {
        error: { code: 'VALIDATION', message: 'Loyalty tier is required', requestId: 'r' },
      } as never),
    );

    renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} save={save} />,
      bundle,
    );

    await userEvent.click(await screen.findByRole('button', { name: COPY.save }));
    await waitFor(() => expect(screen.getByText('Loyalty tier is required')).toBeTruthy());
  });
});

describe('CustomFieldValuesPanel — a cleared field is reported as `null`, never `undefined`', () => {
  /**
   * Issue #176. A host sends the bag as JSON, and JSON drops a key whose value
   * is `undefined` — so a cleared number, date or choice used to leave the
   * request without the key, and the server reads an absent key as "not
   * edited" and keeps the stored value. `null` survives serialisation and is
   * what the server reads as "clear this".
   *
   * The second assertion in each case is the one the defect lived behind: not
   * the bag in memory, but the bag as it reaches the wire.
   */
  const option = {
    id: '00000000-0000-4000-8000-00000000e003',
    value: 'smb',
    label: { en: 'SMB' },
    labelDefault: 'SMB',
    isDefault: false,
    sortOrder: 0,
  };

  const cases = [
    {
      valueType: 'number',
      stored: 42,
      clear: async (input: HTMLElement): Promise<void> => userEvent.clear(input),
    },
    {
      valueType: 'date',
      stored: '2026-03-01',
      clear: async (input: HTMLElement): Promise<void> => userEvent.clear(input),
    },
    {
      valueType: 'select',
      stored: 'smb',
      clear: async (input: HTMLElement): Promise<void> => {
        await userEvent.selectOptions(input, '');
      },
    },
  ] as const;

  for (const { valueType, stored, clear } of cases) {
    // `other` has no definition, so the panel never rendered it as editable and
    // — since feature 175 (FR-038) — does not send it: the server's merge keeps it.
    it(`hands \`save\` a null for a cleared ${valueType}, and no key it did not render as editable`, async () => {
      getSpy.mockResolvedValue({
        data: [definition({ key: 'field', label: { en: 'Field' }, labelDefault: 'Field', valueType, options: [option] })],
      });
      const save = vi.fn().mockResolvedValue(undefined);

      renderWithI18n(
        <CustomFieldValuesPanel entityType="customer" values={{ field: stored, other: 'kept' }} save={save} />,
        bundle,
      );

      await clear(await screen.findByLabelText('Field'));
      await userEvent.click(screen.getByRole('button', { name: COPY.save }));

      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      const bag = save.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(bag).toStrictEqual({ field: null });
      expect(JSON.parse(JSON.stringify(bag))).toStrictEqual({ field: null });
    });

    it(`tells an embedding host a null for a cleared ${valueType}`, async () => {
      getSpy.mockResolvedValue({
        data: [definition({ key: 'field', label: { en: 'Field' }, labelDefault: 'Field', valueType, options: [option] })],
      });
      const onChange = vi.fn();

      renderWithI18n(
        <CustomFieldValuesPanel entityType="customer" values={{ field: stored }} onChange={onChange} />,
        bundle,
      );

      await clear(await screen.findByLabelText('Field'));
      expect(onChange.mock.lastCall?.[0]).toStrictEqual({ field: null });
    });
  }
});

describe('CustomFieldValuesPanel — an empty entity type and a failed load are not the same screen', () => {
  /**
   * These two cases are the whole point of the repair, so they are written as a
   * pair: the same empty `defs`, reached two ways, must render two different
   * things. Before it, both rendered nothing — the `defs.length === 0` return
   * sat above the error `Alert` — so a broken request was indistinguishable
   * from "no custom fields are defined for this entity type". The case that
   * pinned that behaviour was deleted with the repair, as its own comment
   * instructed.
   *
   * The one case the old ordering was argued to be accidentally right for, a
   * 503 from a switched-off owner, cannot occur: `custom_fields` declares
   * `activation.nonDeactivatable`, so it is in the composition's required set
   * (issue #258) and refused every disable and uninstall (D-69). There is no
   * absent state for the panel to render, which is why the repair has two
   * branches and not three.
   */
  it('renders nothing when the entity type has no definitions', async () => {
    getSpy.mockResolvedValue({ data: [] });

    const { container } = renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} save={async (): Promise<void> => {}} />,
      bundle,
    );

    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('shows the server\'s own sentence when the definitions load fails', async () => {
    const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
      '@endora-commerce/admin-kit/lib',
    );
    getSpy.mockRejectedValue(
      new ApiError(500, {
        error: {
          code: 'INTERNAL',
          message: 'The custom-field definitions could not be read',
          requestId: 'r',
        },
      } as never),
    );

    const { container } = renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} save={async (): Promise<void> => {}} />,
      bundle,
    );

    // The assertion that matters: not "something rendered", but that what
    // rendered is telling the operator the read failed.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The custom-field definitions could not be read');
    // And that it is distinguishable from the honest-empty case above, which
    // renders literally nothing.
    expect(container.textContent).not.toBe('');
    expect(screen.getByText(COPY.title)).toBeTruthy();
    // Nothing to edit and nothing to write, so no save affordance is offered.
    expect(screen.queryByRole('button', { name: COPY.save })).toBeNull();
  });

  it('falls back to its own sentence when the failure carries no envelope', async () => {
    getSpy.mockRejectedValue(new Error('network'));

    renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} save={async (): Promise<void> => {}} />,
      bundle,
    );

    // The kit's sentence, out of the shipped bundle rather than an English
    // literal (issue #1433).
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(CORE_EN['customFields.loadFailed']);
  });

  it('clears a previous entity type\'s failure when the next read succeeds', async () => {
    // The empty branch is now decided by `error`, so a failure that outlived the
    // read which succeeded would render an alert over a screen that is fine.
    getSpy.mockRejectedValueOnce(new Error('network'));

    const { rerender } = renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} save={async (): Promise<void> => {}} />,
      bundle,
    );
    await screen.findByRole('alert');

    getSpy.mockResolvedValue({ data: [] });
    rerender(
      <CustomFieldValuesPanel entityType="order" values={{}} save={async (): Promise<void> => {}} />,
    );

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('CustomFieldValuesPanel — embedded in a form of the host\'s own (feature 143)', () => {
  it('renders the fields and no button, and tells the host the editable bag on every change', async () => {
    getSpy.mockResolvedValue({ data: [definition()] });
    const onChange = vi.fn();

    renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{ other: 1 }} onChange={onChange} />,
      bundle,
    );

    const input = await screen.findByLabelText('Loyalty tier');
    expect(screen.queryByRole('button', { name: COPY.save })).toBeNull();
    await userEvent.type(input, 'go');
    // `other` has no definition and is not sent (feature 175, FR-038).
    expect(onChange).toHaveBeenLastCalledWith({ loyalty_tier: 'go' });
  });

  it('shows a refusal at the field it names, in either mode', async () => {
    getSpy.mockResolvedValue({ data: [definition()] });

    renderWithI18n(
      <CustomFieldValuesPanel
        entityType="customer"
        values={{}}
        onChange={(): void => {}}
        fieldErrors={{ loyalty_tier: 'Field "loyalty_tier" is required.' }}
      />,
      bundle,
    );

    const input = await screen.findByLabelText('Loyalty tier');
    const refusal = screen.getByRole('alert');
    expect(refusal).toHaveTextContent('Field "loyalty_tier" is required.');
    expect(input.parentElement).toContainElement(refusal);
  });

  it('labels a field and its options in the language it is given, the default label otherwise', async () => {
    getSpy.mockResolvedValue({
      data: [
        definition({ label: { en: 'Loyalty tier', pl: 'Poziom lojalności' } }),
        definition({
          id: '00000000-0000-4000-8000-00000000d002',
          key: 'segment',
          label: {},
          labelDefault: 'Segment',
          valueType: 'select',
          options: [
            {
              id: '00000000-0000-4000-8000-00000000e002',
              value: 'smb',
              label: { pl: 'MŚP' },
              labelDefault: 'SMB',
              isDefault: false,
              sortOrder: 0,
            },
          ],
        }),
      ],
    });

    renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} onChange={(): void => {}} language="pl" />,
      bundle,
    );

    expect(await screen.findByLabelText('Poziom lojalności')).toBeTruthy();
    expect(screen.getByLabelText('Segment')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'MŚP' })).toBeTruthy();
  });
});

describe('CustomFieldValuesPanel — admin access (feature 175, FR-037, FR-038)', () => {
  /**
   * `read` and `hidden` are a convenience of this panel, not access control
   * (OD-8): the API still accepts both. What the panel owes is to render a
   * `read` field without an input, to omit a `hidden` one, and — the half that
   * fixes a real overwrite race — to hand `save` / `onChange` only the keys it
   * rendered as editable, so the server's merge keeps every other stored value,
   * including one an integration wrote after the page was loaded.
   */
  const READ_COPY = {
    read: copy('customFields.adminAccess.read'),
    hidden: copy('customFields.adminAccess.hidden'),
  };

  const editable = definition();
  const readOnly = definition({
    id: '00000000-0000-4000-8000-00000000d175',
    key: 'erp_code',
    label: { en: 'ERP code' },
    labelDefault: 'ERP code',
    adminAccess: 'read',
  });
  const hidden = definition({
    id: '00000000-0000-4000-8000-00000000d176',
    key: 'sync_checksum',
    label: { en: 'Sync checksum' },
    labelDefault: 'Sync checksum',
    adminAccess: 'hidden',
  });
  const stored = { loyalty_tier: 'gold', erp_code: 'ERP-001', sync_checksum: 'abc123' };

  it('carries the access-level words in the shipped `core` bundle', () => {
    expect(MISSING).toEqual([]);
    expect(READ_COPY.read).toBeTruthy();
    expect(READ_COPY.hidden).toBeTruthy();
  });

  it('renders a `read` field as its value with no input, and does not render a `hidden` one', async () => {
    getSpy.mockResolvedValue({ data: [editable, readOnly, hidden] });

    renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={stored} save={async (): Promise<void> => {}} />,
      bundle,
    );

    await screen.findByLabelText('Loyalty tier');
    expect(screen.getByText('ERP code')).toBeTruthy();
    expect(screen.getByText('ERP-001')).toBeTruthy();
    expect(screen.queryByLabelText('ERP code')).toBeNull();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryByText('Sync checksum')).toBeNull();
    expect(screen.queryByText('abc123')).toBeNull();
  });

  it('shows a dash for a `read` field with no stored value', async () => {
    getSpy.mockResolvedValue({ data: [readOnly] });

    renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} onChange={(): void => {}} />,
      bundle,
    );

    expect(await screen.findByText('ERP code')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('hands `save` only the `edit` keys — a stored `read` or `hidden` value is not in the bag', async () => {
    getSpy.mockResolvedValue({ data: [editable, readOnly, hidden] });
    const save = vi.fn().mockResolvedValue(undefined);

    renderWithI18n(<CustomFieldValuesPanel entityType="customer" values={stored} save={save} />, bundle);

    const input = await screen.findByLabelText('Loyalty tier');
    await userEvent.clear(input);
    await userEvent.type(input, 'silver');
    await userEvent.click(screen.getByRole('button', { name: COPY.save }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toStrictEqual({ loyalty_tier: 'silver' });
  });

  it('tells an embedding host only the `edit` keys on every change', async () => {
    getSpy.mockResolvedValue({ data: [editable, readOnly, hidden] });
    const onChange = vi.fn();

    renderWithI18n(<CustomFieldValuesPanel entityType="customer" values={stored} onChange={onChange} />, bundle);

    await userEvent.type(await screen.findByLabelText('Loyalty tier'), '!');
    expect(onChange.mock.lastCall?.[0]).toStrictEqual({ loyalty_tier: 'gold!' });
  });

  it('names a refusal of a non-`edit` field with its label and level, and points to the Custom fields screen', async () => {
    getSpy.mockResolvedValue({ data: [editable, readOnly, hidden] });

    renderWithI18n(
      <CustomFieldValuesPanel
        entityType="customer"
        values={stored}
        onChange={(): void => {}}
        fieldErrors={{ sync_checksum: 'Value is too long.' }}
      />,
      bundle,
    );

    await screen.findByLabelText('Loyalty tier');
    const refusal = screen.getByRole('alert');
    expect(refusal).toHaveTextContent('Sync checksum');
    expect(refusal).toHaveTextContent(READ_COPY.hidden);
    expect(refusal).toHaveTextContent('Value is too long.');
    expect(refusal).toHaveTextContent('Custom fields screen');
  });

  it('names a refusal of a non-`edit` field the host\'s own `save` answered with', async () => {
    getSpy.mockResolvedValue({ data: [editable, readOnly] });
    const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
      '@endora-commerce/admin-kit/lib',
    );
    const save = vi.fn().mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'CUSTOM_FIELD_VALUE_INVALID',
          message: 'Custom field validation failed.',
          requestId: 'r',
          // The entry shape every host's custom-field 422 carries.
          details: [{ path: 'erp_code', issue: 'Not a valid code.' }],
        },
      } as never),
    );

    renderWithI18n(<CustomFieldValuesPanel entityType="customer" values={stored} save={save} />, bundle);

    await userEvent.click(await screen.findByRole('button', { name: COPY.save }));
    await waitFor(() => expect(screen.getByText(/Not a valid code\./)).toBeTruthy());
    const refusal = screen.getByText(/Not a valid code\./);
    expect(refusal).toHaveTextContent('ERP code');
    expect(refusal).toHaveTextContent(READ_COPY.read);
    expect(refusal).toHaveTextContent('Custom fields screen');
  });

  it('renders nothing when every definition is `hidden`', async () => {
    getSpy.mockResolvedValue({ data: [hidden] });

    const { container } = renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={stored} save={async (): Promise<void> => {}} />,
      bundle,
    );

    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});

describe('CustomFieldValuesPanel — only the keys the operator changed leave the panel (issue #1007)', () => {
  /**
   * Every host's write merges per key: a key the request leaves out keeps the
   * value it holds when the write commits. A key the request carries is written
   * as the request has it — so a bag of every key the panel loaded would write a
   * stale value over one another writer changed after the page was loaded. The
   * panel hands on the `edit` keys whose value differs from what it loaded.
   */
  const tier = definition();
  const region = definition({
    id: '00000000-0000-4000-8000-00000000d007',
    key: 'region',
    label: { en: 'Region' },
    labelDefault: 'Region',
    sortOrder: 1,
  });
  const stored = { loyalty_tier: 'gold', region: 'north' };

  it('hands `save` the changed key and not the unchanged one', async () => {
    getSpy.mockResolvedValue({ data: [tier, region] });
    const save = vi.fn().mockResolvedValue(undefined);

    renderWithI18n(<CustomFieldValuesPanel entityType="customer" values={stored} save={save} />, bundle);

    const input = await screen.findByLabelText('Loyalty tier');
    await userEvent.clear(input);
    await userEvent.type(input, 'silver');
    await userEvent.click(screen.getByRole('button', { name: COPY.save }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toStrictEqual({ loyalty_tier: 'silver' });
  });

  it('hands `save` a cleared key, and nothing for a key edited back to what was loaded', async () => {
    getSpy.mockResolvedValue({ data: [tier, region] });
    const save = vi.fn().mockResolvedValue(undefined);

    renderWithI18n(<CustomFieldValuesPanel entityType="customer" values={stored} save={save} />, bundle);

    const input = await screen.findByLabelText('Loyalty tier');
    await userEvent.type(input, 'x');
    await userEvent.type(input, '{Backspace}');
    await userEvent.clear(screen.getByLabelText('Region'));
    await userEvent.click(screen.getByRole('button', { name: COPY.save }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toStrictEqual({ region: '' });
  });

  it('does not send a key again once a save has written it', async () => {
    getSpy.mockResolvedValue({ data: [tier, region] });
    const save = vi.fn().mockResolvedValue(undefined);

    renderWithI18n(<CustomFieldValuesPanel entityType="customer" values={stored} save={save} />, bundle);

    const input = await screen.findByLabelText('Loyalty tier');
    await userEvent.type(input, '+');
    await userEvent.click(screen.getByRole('button', { name: COPY.save }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByLabelText('Region'), '-east');
    await userEvent.click(screen.getByRole('button', { name: COPY.save }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[0]?.[0]).toStrictEqual({ loyalty_tier: 'gold+' });
    expect(save.mock.calls[1]?.[0]).toStrictEqual({ region: 'north-east' });
  });

  it('sends the key again after a refused save', async () => {
    getSpy.mockResolvedValue({ data: [tier, region] });
    const save = vi.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValue(undefined);

    renderWithI18n(<CustomFieldValuesPanel entityType="customer" values={stored} save={save} />, bundle);

    await userEvent.type(await screen.findByLabelText('Loyalty tier'), '+');
    await userEvent.click(screen.getByRole('button', { name: COPY.save }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: COPY.save }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[0]).toStrictEqual({ loyalty_tier: 'gold+' });
  });

  it('tells an embedding host the changed key and not the unchanged one', async () => {
    getSpy.mockResolvedValue({ data: [tier, region] });
    const onChange = vi.fn();

    renderWithI18n(<CustomFieldValuesPanel entityType="customer" values={stored} onChange={onChange} />, bundle);

    await userEvent.type(await screen.findByLabelText('Region'), '!');
    expect(onChange.mock.lastCall?.[0]).toStrictEqual({ region: 'north!' });
  });
});

describe('CustomFieldValuesPanel — a section, not a card (issue #1437, DS-03)', () => {
  it('renders as a section of the host card by default: an h2 region, no card of its own', async () => {
    getSpy.mockResolvedValue({ data: [definition()] });
    renderWithI18n(<CustomFieldValuesPanel entityType="customer" values={{}} onChange={(): void => {}} />, bundle);

    const heading = await screen.findByRole('heading', { level: 2, name: COPY.title });
    expect(heading.closest('[data-slot=card]')).toBeNull();
    expect(heading.closest('section')?.getAttribute('data-slot')).toBe('editor-section');
  });

  it('draws its own card with `chrome="card"`, for a panel standing alone on a page', async () => {
    getSpy.mockResolvedValue({ data: [definition()] });
    renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} onChange={(): void => {}} chrome="card" />,
      bundle,
    );

    const heading = await screen.findByRole('heading', { level: 2, name: COPY.title });
    expect(heading.closest('[data-slot=card]')).not.toBeNull();
  });

  it('takes the heading level a host card needs through `titleAs`', async () => {
    getSpy.mockResolvedValue({ data: [definition()] });
    renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} onChange={(): void => {}} titleAs="h3" />,
      bundle,
    );

    expect(await screen.findByRole('heading', { level: 3, name: COPY.title })).toBeTruthy();
  });
});

/**
 * Issue #1808 (item 6) — the order detail showed a field by its raw code
 * (`zrodlo_pozyskania`): the definition's Polish label was there, but the host
 * passed no `language`, so the panel looked the label up in English and fell
 * back to the default label, which the operator had typed as the code. With no
 * `language` the panel now speaks the admin's own language.
 */
describe('CustomFieldValuesPanel — the labels follow the admin language (issue #1808)', () => {
  const sourceField = (): Record<string, unknown> =>
    definition({
      entityType: 'order',
      key: 'zrodlo_pozyskania',
      label: { pl: 'Źródło pozyskania' },
      labelDefault: 'zrodlo_pozyskania',
    });

  it('shows the label in the admin language when the host passes none', async () => {
    getSpy.mockResolvedValue({ data: [sourceField()] });

    renderWithI18n(
      <CustomFieldValuesPanel entityType="order" values={{ zrodlo_pozyskania: 'Targi' }} save={async (): Promise<void> => {}} />,
      bundle,
      { language: 'pl' },
    );

    expect(await screen.findByLabelText('Źródło pozyskania')).toHaveValue('Targi');
    expect(screen.queryByText('zrodlo_pozyskania')).toBeNull();
  });

  it('falls back to the default label when the language has an empty one', async () => {
    getSpy.mockResolvedValue({
      data: [definition({ label: { en: '' }, labelDefault: 'Loyalty tier' })],
    });

    renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" values={{}} save={async (): Promise<void> => {}} />,
      bundle,
    );

    expect(await screen.findByLabelText('Loyalty tier')).toBeTruthy();
  });

  it('still honours an explicit `language` over the admin language', async () => {
    getSpy.mockResolvedValue({
      data: [definition({ label: { en: 'Loyalty tier', pl: 'Poziom lojalności' } })],
    });

    renderWithI18n(
      <CustomFieldValuesPanel entityType="customer" language="en" values={{}} save={async (): Promise<void> => {}} />,
      bundle,
      { language: 'pl' },
    );

    expect(await screen.findByLabelText('Loyalty tier')).toBeTruthy();
  });
});
