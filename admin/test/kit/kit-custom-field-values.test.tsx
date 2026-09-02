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

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Failed to load.');
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
