import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { answerConfirm } from '../helpers/confirm-dialog';
import { installOffsetParentShim } from '../helpers/layout-shim';

/**
 * Issue #1464 (UX audit CONTENT-06) — the custom-event editor's Delete sat
 * beside Save and fired on one click. It asks first, naming the event; a
 * failure stays in the dialog. Since #1537 (CONTENT-20) it is an entry of the
 * header's "More" menu, as in the Meta and LinkedIn editors, rather than a
 * section of its own below the form — still away from Save, which is in the
 * sticky bar. The shape the three editors share is asserted in
 * `event-mapping-screens.test.tsx`.
 */

installOffsetParentShim();

const ID = '33333333-3333-4333-8333-333333333333';
const remove = vi.fn();

vi.mock('../../../packages/modules/google_analytics/src/admin/api/google-analytics-client', () => ({
  googleAnalyticsClient: {
    actionCatalogue: async () => ({ add_to_cart: { static: ['sku'] } }),
    get: async () => ({
      id: ID,
      salesChannelCode: null,
      eventName: 'cart_add',
      triggerAction: 'add_to_cart',
      buttonId: null,
      enabled: true,
      fields: [],
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      version: 1,
    }),
    remove: (id: string) => remove(id),
    update: vi.fn(),
    create: vi.fn(),
  },
  listSalesChannels: async () => ({ items: [] }),
}));

const { default: CustomEventEditPage } = await import(
  '../../../packages/modules/google_analytics/src/admin/pages/CustomEventEditPage'
);

function bundle(): Record<string, Record<string, string>> {
  const read = (path: string): Record<string, string> =>
    JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
  return {
    google_analytics: read('../packages/modules/google_analytics/i18n/en.json'),
    core: read('../packages/modules/_i18n/i18n/en.json'),
  };
}

async function openDelete(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'More' }));
  await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
}

async function mount(): Promise<void> {
  renderWithI18n(
    <MemoryRouter initialEntries={[`/google-analytics/custom-events/${ID}`]}>
      <Routes>
        <Route path="/google-analytics/custom-events/:id" element={<CustomEventEditPage />} />
        <Route path="/google-analytics" element={<p>events list</p>} />
      </Routes>
    </MemoryRouter>,
    bundle(),
  );
  await screen.findByDisplayValue('cart_add');
}

beforeEach(() => {
  remove.mockReset();
});

describe('GA custom event — Delete asks first, away from Save (#1464)', () => {
  it('keeps Delete out of the Save bar, in the header menu', async () => {
    await mount();
    const bar = document.querySelector('[data-slot="sticky-form-actions"]') as HTMLElement;
    expect(within(bar).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByText('Delete this event')).toBeNull();
  });

  it('names the event, opens on Cancel, and Cancel deletes nothing', async () => {
    await mount();
    await openDelete();
    const dialog = await screen.findByRole('dialog', { name: 'Delete this custom event?' });
    expect(dialog).toHaveTextContent('“cart_add”');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await answerConfirm(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes on confirm and returns to the list', async () => {
    remove.mockResolvedValue(undefined);
    await mount();
    await openDelete();
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete event' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(ID));
    expect(await screen.findByText('events list')).toBeInTheDocument();
  });

  it('keeps a failure in the dialog and stays on the page', async () => {
    remove.mockRejectedValue(new Error('offline'));
    await mount();
    await openDelete();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete event' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The event could not be deleted');
    expect(screen.queryByText('events list')).toBeNull();
  });
});
