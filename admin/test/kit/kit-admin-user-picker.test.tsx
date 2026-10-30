import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';

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

/** Renders with the shipped `core` bundle, so the assertions name real copy (#561). */
function renderPicker(ui: ReactElement, language: 'en' | 'pl' = 'en'): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(ui, shippedCoreBundle(language), { language });
}

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
    renderPicker(<AdminUserPicker value={null} onChange={vi.fn()} />);

    await search('ada');
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('listbox').textContent).toContain('Loading…');

    resolve({ data: [] });
    await waitFor(() => expect(screen.getByRole('listbox').textContent).not.toContain('Loading…'));
  });

  it('asks for one debounced, trimmed page and says when nothing matches', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderPicker(<AdminUserPicker value={null} onChange={vi.fn()} />);

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
    renderPicker(<AdminUserPicker value={null} onChange={onChange} />);

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
    renderPicker(<AdminUserPicker value={null} onChange={vi.fn()} />);

    await search('ada');
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toContain('Admin users are unavailable.');
    });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('falls back to a generic message for a failure that is not an API error', async () => {
    getSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPicker(<AdminUserPicker value={null} onChange={vi.fn()} />);

    await search('ada');
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toContain('Search failed.');
    });
  });

  it('does not let a caller-supplied empty message hide a failed search', async () => {
    getSpy.mockRejectedValue(
      new ApiError(500, { error: { code: 'INTERNAL', message: 'Admin users are unavailable.' } }),
    );
    renderPicker(
      <AdminUserPicker value={null} onChange={vi.fn()} emptyMessage="Nobody by that name." />,
    );

    await search('ada');
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toContain('Admin users are unavailable.');
    });
    expect(screen.getByRole('listbox').textContent).not.toContain('Nobody by that name.');
  });

  it('asks for a search term before any search has answered, instead of claiming no match', async () => {
    // Opening the picker asks for the first page after the debounce; until an
    // answer arrives nothing has been searched, so "no matching admin users"
    // would be false (#563).
    getSpy.mockReturnValue(new Promise(() => {}));
    renderPicker(<AdminUserPicker value={null} onChange={vi.fn()} emptyMessage="Nobody by that name." />);

    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Select admin user' }));
    const listbox = screen.getByRole('listbox');
    expect(listbox.textContent).toBe('Type a name or e-mail address to search.');
    expect(listbox.textContent).not.toContain('No matching admin users.');
    expect(screen.getByRole('status').textContent).toBe('Type a name or e-mail address to search.');
  });

  it('announces a failed search through the live region', async () => {
    getSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPicker(<AdminUserPicker value={null} onChange={vi.fn()} />);

    await search('ada');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Search failed.'));
  });

  it('speaks Polish to a Polish admin', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderPicker(<AdminUserPicker value={null} onChange={vi.fn()} />, 'pl');

    const input = screen.getByRole('combobox', { name: 'Wybierz administratora' });
    expect(input.getAttribute('placeholder')).toBe(
      'Szukaj administratorów po imieniu, nazwisku lub adresie e-mail…',
    );
    const user = userEvent.setup();
    await user.click(input);
    expect(screen.getByRole('listbox').textContent).toBe(
      'Wpisz imię, nazwisko lub adres e-mail, aby wyszukać.',
    );
    await user.type(input, 'zed');
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toBe('Brak pasujących administratorów.');
    });

    getSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    await user.type(input, 'x');
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toBe('Wyszukiwanie nie powiodło się.');
    });
  });
});
