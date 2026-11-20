import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CustomerGroup } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import en from '../../../../packages/modules/customer_accounts/i18n/en.json';
import core from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — the customer
 * groups screen said "saved" and "deleted" in a success banner above the form.
 * A save is now said beside the form's title, a deletion (whose row has already
 * gone) to the screen reader only, both in regions mounted before they have
 * text; errors stay a page-level banner and empty them.
 */

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
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(2);
    for (const region of regions) expect(region.textContent).toBe('');
  });

  it('says a save beside the form title, with no success banner', async () => {
    const user = userEvent.setup();
    await renderPage();
    const title = screen.getByText(en['groups.form.newTitle']);
    const region = within(title.parentElement!).getByRole('status');
    await user.type(screen.getByLabelText(en['groups.field.code']), 'retail');
    await user.type(screen.getByLabelText(en['groups.field.name']), 'Retail');
    await user.click(screen.getByRole('button', { name: en['groups.action.save'] }));
    await waitFor(() => expect(region).toHaveTextContent(saved('retail')));
    expect(successBanners()).toEqual([]);
  });

  it('announces a deletion without a banner, and an error empties the results', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: en['groups.action.delete'] }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: en['groups.action.delete'] }));
    await waitFor(() =>
      expect(screen.getAllByRole('status').some((r) => r.textContent === en['groups.message.deleted'])).toBe(true),
    );
    expect(successBanners()).toEqual([]);

    remove.mockRejectedValueOnce(new Error('boom'));
    await user.click(screen.getByRole('button', { name: en['groups.action.delete'] }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: en['groups.action.delete'] }));
    await waitFor(() => expect(document.querySelector('[data-slot="alert"][data-variant="destructive"]')).not.toBeNull());
    for (const region of screen.getAllByRole('status')) expect(region.textContent).toBe('');
  });
});
