import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';

/**
 * Feature 155 / T099 (US2, FR-002) — the packaging-units editor's "Minimum (units)"
 * column: shown, edited, cleared to `null`, refused outside 1…1 000 000, and sent as
 * `minOrderUnits`. Rendered inside `<StrictMode>` with the real `en` / `pl` bundles.
 */
const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();

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
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { PackagingUnitsEditor } = await import(
  '../../../../packages/modules/catalog/src/admin/components/PackagingUnitsEditor'
);

const BASE = '/api/v1/admin/catalog/products/p1/packaging-units';
const UNIT = {
  id: '00000000-0000-4000-8000-000000000001',
  productId: 'p1',
  name: 'Paleta',
  baseQuantity: 480,
  minOrderUnits: 3,
  position: 0,
  isDefault: true,
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

function renderEditor(language: 'en' | 'pl' = 'en'): void {
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  render(
    <StrictMode>
      <TranslationProvider language={language} initialBundle={{ catalog }}>
        <PackagingUnitsEditor productId="p1" canWrite />
      </TranslationProvider>
    </StrictMode>,
  );
}

async function minimumCell(): Promise<HTMLInputElement> {
  const row = (await screen.findByDisplayValue('Paleta')).closest('tr')!;
  return within(row).getByRole('spinbutton', { name: 'Minimum (units)' }) as HTMLInputElement;
}

describe('PackagingUnitsEditor — minimum units (155)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    postSpy.mockReset();
    patchSpy.mockReset();
    getSpy.mockResolvedValue({ data: [UNIT] });
    patchSpy.mockResolvedValue({ data: UNIT });
  });
  afterEach(() => vi.clearAllMocks());

  it('shows the column and the current minimum, bounded 1…1 000 000', async () => {
    renderEditor();
    expect(await screen.findByRole('columnheader', { name: 'Minimum (units)' })).toBeInTheDocument();
    const input = await minimumCell();
    expect(input).toHaveValue(3);
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '1000000');
    expect(input).toHaveAttribute('step', '1');
  });

  it('sends a changed minimum as minOrderUnits', async () => {
    renderEditor();
    const user = userEvent.setup();
    const input = await minimumCell();
    await user.clear(input);
    await user.type(input, '5');
    await user.tab();

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`${BASE}/${UNIT.id}`, { minOrderUnits: 5 });
  });

  it('sends null when the minimum is cleared', async () => {
    renderEditor();
    const user = userEvent.setup();
    const input = await minimumCell();
    await user.clear(input);
    await user.tab();

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`${BASE}/${UNIT.id}`, { minOrderUnits: null });
  });

  it('sends nothing when the minimum is left as it was', async () => {
    renderEditor();
    const user = userEvent.setup();
    const input = await minimumCell();
    await user.click(input);
    await user.tab();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it.each(['0', '1000001'])('refuses %s with an inline error and no request', async (raw) => {
    renderEditor();
    const user = userEvent.setup();
    const input = await minimumCell();
    await user.clear(input);
    await user.type(input, raw);
    await user.tab();

    const message = await screen.findByText(
      'The minimum must be a whole number from 1 to 1000000, or empty for none.',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(message.id);
    expect(patchSpy).not.toHaveBeenCalled();
  });

  /**
   * Round B UI review — a refused value stays in the uncontrolled cell, so its
   * invalid state must stay with it: another save on the card (here a rename)
   * used to clear `aria-invalid` and the message while `0` was still in the box.
   * It is cleared once the value changes.
   */
  it('keeps a refused minimum marked invalid across another save, until its value changes', async () => {
    renderEditor();
    const user = userEvent.setup();
    const input = await minimumCell();
    await user.clear(input);
    await user.type(input, '0');
    await user.tab();
    const messageText = 'The minimum must be a whole number from 1 to 1000000, or empty for none.';
    await screen.findByText(messageText);

    const loadsBefore = getSpy.mock.calls.length;
    const name = screen.getByDisplayValue('Paleta');
    await user.clear(name);
    await user.type(name, 'Pallet');
    await user.tab();
    await waitFor(() => expect(patchSpy).toHaveBeenCalledWith(`${BASE}/${UNIT.id}`, { name: 'Pallet' }));
    await waitFor(() => expect(getSpy.mock.calls.length).toBeGreaterThan(loadsBefore));

    const cell = input;
    expect(cell).toHaveValue(0);
    expect(cell).toHaveAttribute('aria-invalid', 'true');
    const message = screen.getByText(messageText);
    expect(cell.getAttribute('aria-describedby')).toContain(message.id);

    await user.clear(cell);
    await user.type(cell, '4');
    expect(cell).not.toHaveAttribute('aria-invalid');
  });

  it('sends minOrderUnits with a new unit only when one is entered', async () => {
    getSpy.mockResolvedValue({ data: [] });
    postSpy.mockResolvedValue({ data: UNIT });
    renderEditor();
    const user = userEvent.setup();
    await screen.findByText('No packaging units yet.');

    await user.type(screen.getByPlaceholderText('Unit name (e.g. Paleta)'), 'Paleta');
    await user.type(screen.getByPlaceholderText('Pieces'), '480');
    await user.type(screen.getByPlaceholderText('Minimum (optional)'), '2');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith(BASE, {
      name: 'Paleta',
      baseQuantity: 480,
      minOrderUnits: 2,
    });
  });

  it('renders the column in Polish', async () => {
    renderEditor('pl');
    expect(
      await screen.findByRole('columnheader', { name: 'Minimum (w jednostkach)' }),
    ).toBeInTheDocument();
  });
});
