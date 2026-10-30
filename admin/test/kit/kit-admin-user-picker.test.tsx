import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * Issue #89 — `AdminUserPicker` has a test.
 *
 * The picker searches `GET /api/v1/admin/admin-users` itself, so what is
 * asserted is the request it builds and the four states an operator can see in
 * its listbox: a search in flight, no match, matches, and a failed request.
 *
 * The mock keys on `@endora-commerce/admin-kit/lib`, the barrel the component
 * imports `apiClient` from. `admin/test/setup.ts` makes `fetch` throw, so a
 * component that bypassed the barrel would land in the failure state on every
 * test below rather than pass by accident.
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

const { AdminUserPicker } = await import('@endora-commerce/admin-kit/components');
const { ApiError } = await import('@endora-commerce/admin-kit/lib');

afterEach(() => {
  getSpy.mockReset();
});

const ADA = { id: 'u-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' };
const NAMELESS = { id: 'u-2', email: 'ops@example.com', firstName: '', lastName: '' };

async function search(text: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByRole('combobox', { name: 'Select admin user' }), text);
}

describe('AdminUserPicker', () => {
  it('shows a loading row while the search is in flight', async () => {
    let resolve: (v: unknown) => void = () => {};
    getSpy.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithI18n(<AdminUserPicker value={null} onChange={vi.fn()} />);

    await search('ada');
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('listbox').textContent).toContain('Loading…');

    resolve({ data: [] });
    await waitFor(() => expect(screen.getByRole('listbox').textContent).not.toContain('Loading…'));
  });

  it('asks for one debounced, trimmed page and says when nothing matches', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderWithI18n(<AdminUserPicker value={null} onChange={vi.fn()} />);

    await search('  zed ');
    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/admin-users?pageSize=20&q=zed');
    });
    // Typing four characters fires one request, not four.
    expect(getSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toContain('No matching admin users.');
    });
  });

  it('lists the matches by name, falling back to the e-mail, and commits the id', async () => {
    getSpy.mockResolvedValue({ data: [ADA, NAMELESS] });
    const onChange = vi.fn();
    renderWithI18n(<AdminUserPicker value={null} onChange={onChange} />);

    await search('a');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Ada Lovelaceada@example.com',
      'ops@example.comops@example.com',
    ]);

    await userEvent.setup().click(options[0]!);
    expect(onChange).toHaveBeenCalledWith('u-1');
  });

  it('shows the server message when the search fails', async () => {
    getSpy.mockRejectedValue(
      new ApiError(500, { error: { code: 'INTERNAL', message: 'Admin users are unavailable.' } }),
    );
    renderWithI18n(<AdminUserPicker value={null} onChange={vi.fn()} />);

    await search('ada');
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toContain('Admin users are unavailable.');
    });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('falls back to a generic message for a failure that is not an API error', async () => {
    getSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    renderWithI18n(<AdminUserPicker value={null} onChange={vi.fn()} />);

    await search('ada');
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toContain('Search failed.');
    });
  });

  it('does not let a caller-supplied empty message hide a failed search', async () => {
    getSpy.mockRejectedValue(
      new ApiError(500, { error: { code: 'INTERNAL', message: 'Admin users are unavailable.' } }),
    );
    renderWithI18n(
      <AdminUserPicker value={null} onChange={vi.fn()} emptyMessage="Nobody by that name." />,
    );

    await search('ada');
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toContain('Admin users are unavailable.');
    });
    expect(screen.getByRole('listbox').textContent).not.toContain('Nobody by that name.');
  });
});
