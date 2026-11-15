import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import {
  INERT_SAVE_SESSION,
  SaveSessionProvider,
  useSaveSession,
  type SaveSessionValue,
} from '@endora-commerce/admin-kit/lib';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 180, WP-7 — `quick_order`'s ordering defaults take part in the organization detail's
 * one Save (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §2; FR-060).
 *
 * Under a live session a change of a select is a staged change of the part `ordering-defaults`:
 * no Save button of the panel's own, no `PUT` on change, written by the session's run through the
 * existing `PUT …/quick-order/preferences`. Where the host hands no session yet — the customer
 * detail until its own work package (WP-8) — the panel keeps its own Save.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: (...args: unknown[]) => putSpy(...args), patch: vi.fn(), delete: vi.fn() },
}));

const quickOrder = await import('@endora-commerce/mod-quick-order/admin');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const CORE = read('../packages/modules/_i18n/i18n/en.json');
const OWN = read('../packages/modules/quick_order/i18n/en.json');
const EN = { core: CORE, quick_order: OWN };

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const PM = '00000000-0000-4000-8000-00000000e001';
const DM = '00000000-0000-4000-8000-00000000e002';
const PAYMENT = CORE['defaultPreferences.paymentMethod']!;
const DELIVERY = CORE['defaultPreferences.deliveryMethod']!;

let session: SaveSessionValue | null = null;

function Host(): ReactElement {
  const live = useSaveSession();
  session = live;
  return <AdminZone name="organization.detail.after" props={{ organizationId: ORG_ID, saveSession: live.handle }} />;
}

function renderWith(ui: ReactElement): void {
  render(
    <TranslationProvider language="en" initialBundle={EN}>
      {withSession(<MemoryRouter>{ui}</MemoryRouter>, {
        session: adminSession({ permissions: ['orders:write'] }),
        presence: modulePresence({ present: ['quick_order'] }),
        contributions: [{ moduleId: 'quick_order', contributions: quickOrder.contributions }],
      })}
    </TranslationProvider>,
  );
}

const renderOrganization = (): void =>
  renderWith(
    <SaveSessionProvider resetKey={ORG_ID} hostModule="organizations">
      <Host />
    </SaveSessionProvider>,
  );

async function choose(label: string, value: string): Promise<void> {
  const select = (await screen.findByLabelText(label)) as HTMLSelectElement;
  fireEvent.change(select, { target: { value } });
}

beforeEach(() => {
  session = null;
  getSpy.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/admin/quick-order/preferences')) return { data: null };
    if (url.includes('/addresses')) return url.includes('/customers/') ? { data: { personal: [], organization: [] } } : { data: [] };
    if (url.startsWith('/api/v1/admin/payment-methods')) return { data: [{ id: PM, code: 'card', name: { en: 'Card' } }] };
    if (url.startsWith('/api/v1/admin/delivery-methods')) return { data: [{ id: DM, code: 'courier', name: { en: 'Courier' } }] };
    throw new Error(`unexpected url ${url}`);
  });
  putSpy.mockReset().mockResolvedValue({ data: {} });
});
afterEach(() => cleanup());

describe('ordering defaults under the organization detail session (feature 180, WP-7)', () => {
  it('renders no Save of its own, stages a change instead of writing it, and counts each field', async () => {
    renderOrganization();
    await choose(PAYMENT, PM);
    expect(screen.queryByRole('button', { name: CORE['defaultPreferences.save']! })).toBeNull();
    expect(putSpy).not.toHaveBeenCalled();
    expect(session?.dirtyCount).toBe(1);
    await choose(DELIVERY, DM);
    expect(session?.dirtyCount).toBe(2);
    expect(session?.dirtyParticipants().map((part) => [part.id, part.label])).toEqual([
      ['quick_order:ordering-defaults', OWN['defaultPreferences.partLabel']],
    ]);
    // Back to the stored value: nothing left to save for that field.
    await choose(DELIVERY, '');
    expect(session?.dirtyCount).toBe(1);
  });

  it('is written by the session run, through the existing PUT', async () => {
    renderOrganization();
    await choose(PAYMENT, PM);
    let result = '';
    await act(async () => {
      result = (await session!.run(null)).result;
    });
    expect(result).toBe('saved');
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith('/api/v1/admin/quick-order/preferences', {
      scope: 'organization',
      scopeId: ORG_ID,
      defaultPaymentMethodId: PM,
      defaultDeliveryMethodId: null,
      defaultBillingAddressId: null,
      defaultShippingAddressId: null,
    });
    expect(session?.dirtyCount).toBe(0);
    expect((screen.getByLabelText(PAYMENT) as HTMLSelectElement).value).toBe(PM);
  });

  it('a failed write keeps the change staged and says why at the panel', async () => {
    putSpy.mockRejectedValueOnce(new Error('The server failed.'));
    renderOrganization();
    await choose(PAYMENT, PM);
    let result = '';
    await act(async () => {
      result = (await session!.run(null)).result;
    });
    expect(result).toBe('failed');
    expect(session?.dirtyCount).toBe(1);
    expect(await screen.findByText('The server failed.')).toBeInTheDocument();
  });

  it('takes part in the customer detail\'s session too, scope customer (pairs with WP-8, #1241)', async () => {
    // A test-only host: the customer detail's own provider arrives with #1241.
    function CustomerHost(): ReactElement {
      const live = useSaveSession();
      session = live;
      return <AdminZone name="customer.detail.after" props={{ customerId: CUSTOMER_ID, saveSession: live.handle }} />;
    }
    renderWith(
      <SaveSessionProvider resetKey={CUSTOMER_ID} hostModule="customers">
        <CustomerHost />
      </SaveSessionProvider>,
    );
    await choose(PAYMENT, PM);
    expect(screen.queryByRole('button', { name: CORE['defaultPreferences.save']! })).toBeNull();
    expect(putSpy).not.toHaveBeenCalled();
    expect(session?.dirtyParticipants().map((part) => part.id)).toEqual(['quick_order:ordering-defaults']);
    await act(async () => {
      await session!.run(null);
    });
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy.mock.calls[0]?.[1]).toMatchObject({ scope: 'customer', scopeId: CUSTOMER_ID, defaultPaymentMethodId: PM });
  });

  it('keeps its own Save where the customer host still hands the inert handle (master before #1241)', async () => {
    renderWith(<AdminZone name="customer.detail.after" props={{ customerId: CUSTOMER_ID, saveSession: INERT_SAVE_SESSION }} />);
    await choose(PAYMENT, PM);
    expect(putSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: CORE['defaultPreferences.save']! }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy.mock.calls[0]?.[1]).toMatchObject({ scope: 'customer', scopeId: CUSTOMER_ID, defaultPaymentMethodId: PM });
  });
});
