import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import corePl from '../../../../packages/modules/_i18n/i18n/pl.json';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';

/**
 * Feature 155 / T100 (US5; FR-003, FR-004, FR-034) — the bulk edit's "Returnable" section:
 * `{ returnable: true }` / `false` when touched, nothing when untouched, and the hint that
 * products are not returnable until marked — which is what makes the bulk action
 * discoverable to an operator whose existing catalogue just became non-returnable.
 * Rendered inside `<StrictMode>` with the real `en` / `pl` bundles.
 */
const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ProductsBulkEditDialog } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductsBulkEditDialog'
);

const IDS = ['11111111-2222-4333-8444-555555555551', '11111111-2222-4333-8444-555555555552'];

function renderDialog(language: 'en' | 'pl' = 'en'): void {
  const bundle = {
    core: (language === 'en' ? coreEn : corePl) as Record<string, string>,
    catalog: (language === 'en' ? catalogEn : catalogPl) as Record<string, string>,
  };
  render(
    <StrictMode>
      <TranslationProvider language={language} initialBundle={bundle}>
        {/* The result links to its bulk operation, so the dialog needs a router. */}
        <MemoryRouter>
          <ProductsBulkEditDialog productIds={IDS} onClose={vi.fn()} />
        </MemoryRouter>
      </TranslationProvider>
    </StrictMode>,
  );
}

function sectionToggle(name: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name: new RegExp(`^${name}`) }) as HTMLInputElement;
}

describe('ProductsBulkEditDialog — Returnable (155)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    postSpy.mockReset();
    getSpy.mockImplementation((path: string) => {
      if (path.includes('attributes/by-flag')) return Promise.resolve({ data: { items: [] } });
      if (path.includes('sales-channels')) return Promise.resolve({ items: [] });
      return Promise.resolve({ data: [] });
    });
    postSpy.mockResolvedValue({
      data: {
        bulkOperationId: 'op-r',
        summary: { succeeded: 2, skipped: 0, failed: 0, total: 2 },
        results: IDS.map((productId) => ({ productId, status: 'succeeded' })),
      },
    });
  });
  afterEach(() => vi.clearAllMocks());

  it('shows the hint that products are not returnable until marked, before anything is touched', async () => {
    renderDialog();
    await screen.findByText('Returnable', { selector: 'label' });
    expect(
      screen.getByText(/Products are not returnable until you mark them/),
    ).toBeInTheDocument();
  });

  it('sends { returnable: true } by default once the section is touched', async () => {
    renderDialog();
    const user = userEvent.setup();
    await screen.findByText('Returnable', { selector: 'label' });
    await user.click(sectionToggle('Returnable'));
    expect(screen.getByRole('radio', { name: 'Yes — returnable' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/products/bulk-update', {
      productIds: IDS,
      fields: { returnable: true },
    });
  });

  it('sends { returnable: false } when "not returnable" is chosen', async () => {
    renderDialog();
    const user = userEvent.setup();
    await screen.findByText('Returnable', { selector: 'label' });
    await user.click(sectionToggle('Returnable'));
    await user.click(screen.getByRole('radio', { name: 'No — not returnable' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const body = postSpy.mock.calls[0]![1] as { fields: Record<string, unknown> };
    expect(body.fields).toEqual({ returnable: false });
  });

  it('sends no returnable key while the section is untouched', async () => {
    renderDialog();
    const user = userEvent.setup();
    await screen.findByText('Returnable', { selector: 'label' });
    expect(screen.getByRole('radio', { name: 'Yes — returnable' })).toBeDisabled();
    await user.click(sectionToggle('Status'));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const body = postSpy.mock.calls[0]![1] as { fields: Record<string, unknown> };
    expect(body.fields).not.toHaveProperty('returnable');
  });

  it('renders the section and the hint in Polish', async () => {
    renderDialog('pl');
    await screen.findByText('Podlega zwrotowi', { selector: 'label' });
    expect(screen.getByRole('radio', { name: 'Tak — podlega zwrotowi' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Nie — nie podlega zwrotowi' })).toBeInTheDocument();
    expect(
      screen.getByText(/Produkty nie podlegają zwrotowi, dopóki ich nie oznaczysz/),
    ).toBeInTheDocument();
  });
});
