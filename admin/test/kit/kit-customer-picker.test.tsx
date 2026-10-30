import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * Issue #89 — `CustomerPicker` has a test.
 *
 * The picker searches `GET /api/v1/admin/customers` itself, narrowed by the
 * caller's `status` and `organizationId`. What is asserted is the request it
 * builds and the four states an operator can see in its listbox: a search in
 * flight, no match, matches, and a failed request.
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

const { CustomerPicker } = await import('@endora-commerce/admin-kit/components');
const { ApiError } = await import('@endora-commerce/admin-kit/lib');

afterEach(() => {
  getSpy.mockReset();
});

const FAILURE = new ApiError(500, {
  error: { code: 'INTERNAL', message: 'Customers could not be searched.' },
});

async function search(text: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByRole('combobox', { name: 'Select customer' }), text);
}

describe('CustomerPicker', () => {
  it('shows a loading row while the search is in flight', async () => {
    let resolve: (v: unknown) => void = () => {};
    getSpy.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithI18n(<CustomerPicker value={null} onChange={vi.fn()} />);

    await search('kow');
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('listbox').textContent).toContain('Loading…');

    resolve({ data: [] });
    await waitFor(() => expect(screen.getByRole('listbox').textContent).not.toContain('Loading…'));
  });

  it('carries the status and organization narrowing, and says when nothing matches', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderWithI18n(
      <CustomerPicker value={null} onChange={vi.fn()} status="active" organizationId="org-9" />,
    );

    await search('kow');
    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith(
        '/api/v1/admin/customers?pageSize=20&status=active&organizationId=org-9&q=kow',
      );
    });
    expect(getSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toContain('No matching customers.');
    });
  });

  it('lists the matches with e-mail and organization, and commits the account id', async () => {
    getSpy.mockResolvedValue({
      data: [
        {
          id: 'c-1',
          email: 'jan@acme.pl',
          firstName: 'Jan',
          lastName: 'Kowalski',
          organizationName: 'Acme',
        },
        { id: 'c-2', email: 'buyer@acme.pl', firstName: '', lastName: '', organizationName: 'Acme' },
      ],
    });
    const onChange = vi.fn();
    renderWithI18n(<CustomerPicker value={null} onChange={onChange} />);

    await search('a');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Jan Kowalskijan@acme.pl · Acme',
      'buyer@acme.plAcme',
    ]);

    await userEvent.setup().click(options[0]!);
    expect(onChange).toHaveBeenCalledWith('c-1');
  });

  it('shows the server message when the search fails', async () => {
    getSpy.mockRejectedValue(FAILURE);
    renderWithI18n(<CustomerPicker value={null} onChange={vi.fn()} />);

    await search('kow');
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toContain('Customers could not be searched.');
    });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('does not let a caller-supplied empty message hide a failed search', async () => {
    // `QuickOrderOnBehalfPage` passes its own `emptyMessage`; before #89 a
    // failed search there read as "no accounts", which sends the operator
    // looking for a customer that does exist.
    getSpy.mockRejectedValue(FAILURE);
    renderWithI18n(
      <CustomerPicker value={null} onChange={vi.fn()} emptyMessage="No accounts in this organization." />,
    );

    await search('kow');
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toContain('Customers could not be searched.');
    });
    expect(screen.getByRole('listbox').textContent).not.toContain('No accounts in this organization.');
  });
});
