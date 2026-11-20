import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — the ordering
 * defaults panel, on a host that still runs no save session, keeps its own
 * Save. Its "Saved" was a success banner at the top of the panel; it is now an
 * always-mounted polite region beside that Save, emptied by the next edit.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      put: (...args: unknown[]) => putSpy(...args),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { DefaultPreferencesPanel } = await import(
  '../../../../packages/modules/quick_order/src/admin/components/DefaultPreferencesPanel'
);

const BUNDLE = passthroughBundle('core', [
  'defaultPreferences.title',
  'defaultPreferences.paymentMethod',
  'defaultPreferences.save',
  'defaultPreferences.saved',
  'defaultPreferences.saveError',
]);

beforeEach(() => {
  getSpy.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/admin/quick-order/preferences')) return { data: null };
    if (url.includes('/addresses')) return { data: { personal: [], organization: [] } };
    if (url.startsWith('/api/v1/admin/payment-methods')) return { data: [{ id: 'pm1', code: 'transfer', name: { en: 'Transfer' } }] };
    if (url.startsWith('/api/v1/admin/delivery-methods')) return { data: [] };
    throw new Error(`unexpected url ${url}`);
  });
  putSpy.mockReset().mockResolvedValue({});
});

describe('DefaultPreferencesPanel — standalone Save result (SALES-17)', () => {
  it('says "Saved" beside its Save, with no success banner, and the next edit empties it', async () => {
    renderWithI18n(
      <DefaultPreferencesPanel scope="customer" scopeId="00000000-0000-4000-8000-0000000000c1" />,
      BUNDLE,
    );
    const save = await screen.findByRole('button', { name: 'defaultPreferences.save' });
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    expect(region.parentElement?.contains(save)).toBe(true);

    fireEvent.click(save);
    await waitFor(() => expect(region).toHaveTextContent('defaultPreferences.saved'));
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();

    fireEvent.change(screen.getByLabelText('defaultPreferences.paymentMethod'), { target: { value: 'pm1' } });
    expect(region.textContent).toBe('');
  });
});
