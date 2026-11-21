import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CustomerGroup } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import en from '../../../../packages/modules/customer_accounts/i18n/en.json';
import core from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — the customer
 * groups screen said "saved" and "deleted" in a success banner above the form.
 * A save is now said beside the header's *New customer group*, where the
 * dialog hands focus back (UX audit slice S2 moved the form into a dialog); a
 * deletion, whose row has already gone, to the screen reader only. Both
 * regions are mounted before they have text; a refused delete is said inside
 * the confirmation and empties them.
 */

installOffsetParentShim();

const list = vi.fn<() => Promise<CustomerGroup[]>>();
const upsert = vi.fn();
const remove = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, useAuth: () => ({ hasPermission: () => true }) };
});

vi.mock('../../../../packages/modules/customer_accounts/src/admin/api/customer-groups-client', () => ({
  customerGroupsClient: {
    list: () => list(),
    upsert: (...args: unknown[]) => upsert(...args),
    remove: (...args: unknown[]) => remove(...args),
  },
}));

const { CustomerGroupsPage } = await import(
  '../../../../packages/modules/customer_accounts/src/admin/pages/CustomerGroupsPage'
);

const GROUP = {
  id: 'g1',
  code: 'wholesale',
  name: 'Wholesale',
  description: null,
} as unknown as CustomerGroup;
const OTHER = { id: 'g2', code: 'retail', name: 'Retail', description: null } as unknown as CustomerGroup;

const saved = (code: string): string => en['groups.message.saved'].replace('{code}', code);
const successBanners = (): Element[] =>
  Array.from(document.querySelectorAll('[data-slot="alert"][data-variant="success"]'));

async function renderPage(): Promise<void> {
  renderWithI18n(<CustomerGroupsPage />, { customer_accounts: en, core });
  await screen.findByText('Wholesale');
}

beforeEach(() => {
  list.mockReset().mockResolvedValue([GROUP]);
  upsert.mockReset().mockResolvedValue(GROUP);
  remove.mockReset().mockResolvedValue(undefined);
});

describe('CustomerGroupsPage — action results beside their control (SALES-17)', () => {
  it('mounts both result regions empty before anything happened', async () => {
    await renderPage();
    // The save result beside New, the deletion's for the screen reader, and the list's own.
    const regions = screen.getAllByRole('status');
    expect(regions.length).toBeGreaterThanOrEqual(2);
    for (const region of regions) expect(region.textContent).toBe('');
  });

  it('says a save beside the header New, with no success banner', async () => {
    const user = userEvent.setup();
    await renderPage();
    const create = screen.getByRole('button', { name: en['groups.action.new'] });
    const region = within(create.parentElement!).getByRole('status');
    await user.click(create);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: en['groups.field.name'] }), 'Retail');
    await user.click(within(dialog).getByRole('button', { name: en['groups.action.save'] }));
    await waitFor(() => expect(region).toHaveTextContent(saved('retail')));
    expect(successBanners()).toEqual([]);
  });

  it('announces a deletion without a banner, and a refused delete empties the results', async () => {
    list.mockResolvedValue([GROUP, OTHER]);
    const user = userEvent.setup();
    await renderPage();
    const askDelete = async (name: string): Promise<HTMLElement> => {
      await user.click(screen.getByRole('button', { name: en['groups.rowActions'].replace('{name}', name) }));
      await user.click(await screen.findByRole('menuitem', { name: en['groups.action.delete'] }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: en['groups.action.delete'] }));
      return dialog;
    };
    await askDelete('Wholesale');
    await waitFor(() =>
      expect(screen.getAllByRole('status').some((r) => r.textContent === en['groups.message.deleted'])).toBe(true),
    );
    expect(successBanners()).toEqual([]);

    remove.mockRejectedValueOnce(new Error('boom'));
    const dialog = await askDelete('Retail');
    expect(await within(dialog).findByText(en['groups.error.delete'])).toBeInTheDocument();
    for (const region of screen.getAllByRole('status')) expect(region.textContent).toBe('');
  });
});
