import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';

/**
 * Issue #89 — `CustomerGroupPicker` has a test.
 *
 * The group set is small and unpaged, so the picker loads it once on mount from
 * `GET /api/v1/admin/customer-groups` and filters client-side. What is asserted
 * is that request and the four states an operator can see in its listbox: the
 * list loading, no groups, groups, and a failed request.
 *
 * The mock keys on `@endora-commerce/admin-kit/lib`, the barrel the component
 * imports `apiClient` from; `admin/test/setup.ts` makes `fetch` throw, so a
 * component that bypassed the barrel would fail every test here loudly.
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

const { CustomerGroupPicker } = await import('@endora-commerce/admin-kit/components');
const { ApiError } = await import('@endora-commerce/admin-kit/lib');

/** Renders with the shipped `core` bundle, so the assertions name real copy (#561). */
function renderPicker(ui: ReactElement, language: 'en' | 'pl' = 'en'): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(ui, shippedCoreBundle(language), { language });
}

afterEach(() => {
  getSpy.mockReset();
});

async function open(): Promise<HTMLElement> {
  await userEvent.setup().click(screen.getByRole('combobox', { name: 'Select customer group' }));
  return screen.getByRole('listbox');
}

describe('CustomerGroupPicker', () => {
  it('fetches the groups once and shows a loading row until they arrive', async () => {
    let resolve: (v: unknown) => void = () => {};
    getSpy.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPicker(<CustomerGroupPicker value={null} onChange={vi.fn()} />);

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/customer-groups');
    expect((await open()).textContent).toContain('Loading…');

    resolve({ data: [] });
    await waitFor(() =>
      expect(screen.getByRole('listbox').textContent).toContain('No customer groups.'),
    );
  });

  it('says so when there are no groups', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderPicker(<CustomerGroupPicker value={null} onChange={vi.fn()} />);

    const listbox = await open();
    await waitFor(() => expect(listbox.textContent).toContain('No customer groups.'));
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('lists the groups with their code, filters by typing, and commits the id', async () => {
    getSpy.mockResolvedValue({
      data: [
        { id: 'g-1', code: 'VIP', name: 'Key accounts' },
        { id: 'g-2', code: 'WHS', name: 'Wholesale' },
      ],
    });
    const onChange = vi.fn();
    renderPicker(<CustomerGroupPicker value={null} onChange={onChange} />);

    await open();
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Key accountsVIP', 'WholesaleWHS']);

    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox', { name: 'Select customer group' }), 'whole');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    await user.click(screen.getByRole('option'));
    expect(onChange).toHaveBeenCalledWith('g-2');
    // Client-side filtering: typing asked the server nothing more.
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('shows the server message when the groups fail to load', async () => {
    getSpy.mockRejectedValue(
      new ApiError(403, { error: { code: 'FORBIDDEN', message: 'You cannot read customer groups.' } }),
    );
    renderPicker(<CustomerGroupPicker value={null} onChange={vi.fn()} />);

    const listbox = await open();
    await waitFor(() => expect(listbox.textContent).toContain('You cannot read customer groups.'));
    expect(listbox.textContent).not.toContain('No customer groups.');
  });

  it('does not let a caller-supplied empty message hide a failed load', async () => {
    getSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPicker(
      <CustomerGroupPicker value={null} onChange={vi.fn()} emptyMessage="No groups yet." />,
    );

    const listbox = await open();
    await waitFor(() => expect(listbox.textContent).toContain('Failed to load groups.'));
    expect(listbox.textContent).not.toContain('No groups yet.');
  });

  it('speaks Polish to a Polish admin', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderPicker(<CustomerGroupPicker value={null} onChange={vi.fn()} />, 'pl');

    const input = screen.getByRole('combobox', { name: 'Wybierz grupę klientów' });
    expect(input.getAttribute('placeholder')).toBe('Wybierz grupę klientów…');
    await userEvent.setup().click(input);
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toBe('Brak grup klientów.');
    });
  });

  it('says in Polish that the groups failed to load', async () => {
    getSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPicker(<CustomerGroupPicker value={null} onChange={vi.fn()} />, 'pl');

    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Wybierz grupę klientów' }));
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toBe('Nie udało się wczytać grup klientów.');
    });
    expect(screen.getByRole('status').textContent).toBe('Nie udało się wczytać grup klientów.');
  });
});
