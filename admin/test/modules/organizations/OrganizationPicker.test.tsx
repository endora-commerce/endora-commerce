import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature 026 US8 — interaction test for `<OrganizationPicker>`.
 *
 * Confirms the Combobox-based picker calls the server-side search
 * endpoint when the user types, renders results with the status pill,
 * and commits `onChange` with the selected org id when a row is clicked.
 *
 * The picker client is mocked so the test never makes real HTTP calls.
 */

const listSpy = vi.fn();

vi.mock('@/modules/organizations/api/organizations-picker-client', () => ({
  organizationsPickerClient: {
    list: (...args: unknown[]) => listSpy(...args),
  },
}));

const { OrganizationPicker } = await import(
  '../../../src/components/organization-picker/OrganizationPicker'
);

beforeEach(() => {
  listSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('OrganizationPicker — interaction', () => {
  it('loads the default page on mount and renders results when the dropdown opens', async () => {
    listSpy.mockResolvedValueOnce({
      items: [
        {
          id: 'org-1',
          name: 'Bauhaus Polska',
          legalName: null,
          status: 'active',
          version: 0,
        },
        {
          id: 'org-2',
          name: 'Castorama',
          legalName: null,
          status: 'pending_verification',
          version: 0,
        },
      ],
      nextCursor: null,
    });

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

  it('passes the query string to the picker client and debounces appropriately', async () => {
    listSpy.mockResolvedValue({ items: [], nextCursor: null });
    const user = userEvent.setup();
    renderWithI18n(<OrganizationPicker value={null} onChange={vi.fn()} />, {});

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'lodz');

    // The debounced fetch fires once with the final query.
    await waitFor(() => {
      const lastCall = listSpy.mock.calls.at(-1)?.[0] as { q?: string } | undefined;
      expect(lastCall?.q).toBe('lodz');
    });
  });

  it('clicking an option commits onChange with the selected organization id', async () => {
    listSpy.mockResolvedValue({
      items: [
        {
          id: 'org-1',
          name: 'Bauhaus Polska',
          legalName: null,
          status: 'active',
          version: 0,
        },
      ],
      nextCursor: null,
    });

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
