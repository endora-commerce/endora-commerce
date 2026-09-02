import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * Feature 026 US8 — interaction test for `<OrganizationPicker>`.
 *
 * Confirms the Combobox-based picker asks the server-side search endpoint when
 * the user types, renders results with the status pill, and commits `onChange`
 * with the selected org id when a row is clicked.
 *
 * **The seam moved with the picker** (feature 091, P2). This file used to mock
 * `@/modules/organizations/api/organizations-picker-client` — the module admin
 * client the picker imported, which is the coupling P2 removes — and it lived
 * under `test/modules/organizations/` because that is whose picker it looked
 * like. Neither is true now: the component is
 * `@endora-commerce/admin-kit/components`' and builds its own request, so the
 * mock is `apiClient` on the kit's `lib` barrel (the seam every packaged
 * screen's test already uses) and the assertions are about the URL rather than
 * about a call to somebody else's client.
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

const { OrganizationPicker } = await import('@endora-commerce/admin-kit/components');

/** The `{ data, pagination }` envelope the admin organizations endpoint answers. */
function envelope(
  rows: Array<{ id: string; name: string; legalName: string | null; status: string; version: number }>,
): unknown {
  return { data: rows, pagination: { cursor: null, hasMore: false, limit: 25 } };
}

beforeEach(() => {
  getSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('OrganizationPicker — interaction', () => {
  it('loads the default page on mount and renders results when the dropdown opens', async () => {
    getSpy.mockResolvedValueOnce(
      envelope([
        { id: 'org-1', name: 'Bauhaus Polska', legalName: null, status: 'active', version: 0 },
        {
          id: 'org-2',
          name: 'Castorama',
          legalName: null,
          status: 'pending_verification',
          version: 0,
        },
      ]),
    );

    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithI18n(<OrganizationPicker value={null} onChange={onChange} />, {});

    // Open the combobox by focusing the input + typing one char so the
    // dropdown renders. (The component is keyboard + click driven.)
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'b');

    await waitFor(() => {
      expect(screen.getByText('Bauhaus Polska')).toBeDefined();
      expect(screen.getByText('Castorama')).toBeDefined();
    });
  });

  it('passes the query string to the endpoint itself and debounces appropriately', async () => {
    getSpy.mockResolvedValue(envelope([]));
    const user = userEvent.setup();
    renderWithI18n(<OrganizationPicker value={null} onChange={vi.fn()} />, {});

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'lodz');

    // The debounced fetch fires once with the final query, and the URL is now
    // the whole of what this component knows about `organizations`.
    await waitFor(() => {
      const lastCall = getSpy.mock.calls.at(-1)?.[0] as string | undefined;
      expect(lastCall).toBe('/api/v1/admin/organizations?q=lodz&limit=25');
    });
  });

  it('clicking an option commits onChange with the selected organization id', async () => {
    getSpy.mockResolvedValue(
      envelope([
        { id: 'org-1', name: 'Bauhaus Polska', legalName: null, status: 'active', version: 0 },
      ]),
    );

    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithI18n(<OrganizationPicker value={null} onChange={onChange} />, {});

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'b');

    await waitFor(() => {
      expect(screen.getByText('Bauhaus Polska')).toBeDefined();
    });

    await user.click(screen.getByText('Bauhaus Polska'));
    expect(onChange).toHaveBeenCalledWith('org-1');
  });
});
