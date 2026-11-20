import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdminSearchConfigurationView } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * `specs/150-admin-global-search/` T068 — the configuration screen
 * (contracts/admin-ui.md §2.2): one card per record type with translated field
 * labels and the "default" marker, the draft, the at-least-one-field rule
 * (FR-020), restore defaults, the save request with the loaded version, the
 * conflict dialog (FR-026), the forbidden state and axe.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('../../../../packages/modules/admin_search/src/admin/api', () => ({
  getConfiguration: (...a: unknown[]) => getSpy(...a),
  putConfiguration: (...a: unknown[]) => putSpy(...a),
  getCapability: vi.fn(),
  searchRecords: vi.fn(),
}));

const { GlobalSearchConfigurationPage } = await import(
  '../../../../packages/modules/admin_search/src/admin/pages/GlobalSearchConfigurationPage'
);

const KEYS = [
  'page.configuration.title',
  'page.configuration.settingsNote',
  'page.configuration.settingsLink',
  'page.configuration.include',
  'page.configuration.fieldsLegend',
  'page.configuration.default',
  'page.configuration.atLeastOneField',
  'page.configuration.restoreDefaults',
  'page.configuration.save',
  'page.configuration.saving',
  'page.configuration.discard',
  'page.configuration.saved',
  'page.configuration.saveError',
  'page.configuration.loading',
  'page.configuration.loadError',
  'page.configuration.forbidden',
  'page.configuration.retry',
  'page.configuration.conflict.title',
  'page.configuration.conflict.body',
  'page.configuration.conflict.reload',
  'page.configuration.conflict.keepEditing',
];

function view(over: Partial<AdminSearchConfigurationView> = {}): AdminSearchConfigurationView {
  return {
    version: 'v1',
    minimumQueryLength: 3,
    resultsPerEntity: 5,
    entities: [
      {
        entityType: 'orders.order',
        label: 'Orders',
        icon: 'Receipt',
        enabled: true,
        customized: false,
        fields: [
          { code: 'number', label: 'Order number', selected: true, defaultSelected: true },
          { code: 'billingTaxId', label: 'Billing tax ID', selected: false, defaultSelected: false },
        ],
      },
      {
        entityType: 'catalog.category',
        label: 'Categories',
        icon: 'Layers',
        enabled: true,
        customized: true,
        fields: [
          { code: 'name', label: 'Name', selected: false, defaultSelected: true },
          { code: 'slug', label: 'URL key (slug)', selected: true, defaultSelected: true },
        ],
      },
    ],
    ...over,
  };
}

function renderPage(): void {
  renderWithSession(
    <StrictMode>
      <MemoryRouter initialEntries={['/global-search/configuration']}>
        <GlobalSearchConfigurationPage />
      </MemoryRouter>
    </StrictMode>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: everyDeclaredModule() }),
      contributions: [],
      bundle: passthroughBundle('admin_search', KEYS),
    },
  );
}

const card = (entityType: string): HTMLElement => screen.getByTestId(`configuration-${entityType}`);
const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'page.configuration.save' }) as HTMLButtonElement;

describe('GlobalSearchConfigurationPage (spec 150)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    putSpy.mockReset();
    getSpy.mockResolvedValue(view());
  });

  it('renders one card per record type with translated field labels and the default marker', async () => {
    renderPage();
    await waitFor(() => expect(card('orders.order')).toBeTruthy());
    expect(within(card('orders.order')).getByText('Orders')).toBeTruthy();
    expect(within(card('orders.order')).getByLabelText(/Order number/)).toBeTruthy();
    expect(within(card('orders.order')).getAllByText('(page.configuration.default)')).toHaveLength(1);
    expect((within(card('orders.order')).getByLabelText(/Order number/) as HTMLInputElement).checked).toBe(true);
    expect((within(card('orders.order')).getByLabelText(/Billing tax ID/) as HTMLInputElement).checked).toBe(false);
    expect(saveButton().disabled).toBe(true);
  });

  it('blocks Save with an inline error when an included type has no field (FR-020)', async () => {
    renderPage();
    await waitFor(() => expect(card('orders.order')).toBeTruthy());
    fireEvent.click(within(card('orders.order')).getByLabelText(/Order number/));
    expect(within(card('orders.order')).getByRole('alert').textContent).toBe('page.configuration.atLeastOneField');
    expect(saveButton().disabled).toBe(true);
    // Excluding the type instead is allowed.
    fireEvent.click(within(card('orders.order')).getByLabelText('page.configuration.include'));
    expect(within(card('orders.order')).queryByRole('alert')).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it('sends only the changed types, with the loaded version', async () => {
    putSpy.mockResolvedValue(view({ version: 'v2' }));
    renderPage();
    await waitFor(() => expect(card('orders.order')).toBeTruthy());
    fireEvent.click(within(card('orders.order')).getByLabelText(/Billing tax ID/));
    fireEvent.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    expect(putSpy.mock.calls[0]?.[1]).toEqual({
      expectedVersion: 'v1',
      entities: [{ entityType: 'orders.order', enabled: true, fields: ['number', 'billingTaxId'] }],
    });
    await waitFor(() => expect(screen.getAllByText('page.configuration.saved').length).toBeGreaterThan(0));
  });

  // Issue #1499 (UX audit SALES-17, DEC-12 a): "Saved" is said once, beside Save,
  // in a region mounted before it has text, and not in a success banner at the top.
  it('says "Saved" beside the Save button, with no success banner', async () => {
    putSpy.mockResolvedValue(view({ version: 'v2' }));
    renderPage();
    await waitFor(() => expect(card('orders.order')).toBeTruthy());
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    expect(region.parentElement?.contains(saveButton())).toBe(true);
    fireEvent.click(within(card('orders.order')).getByLabelText(/Billing tax ID/));
    fireEvent.click(saveButton());
    await waitFor(() => expect(region).toHaveTextContent('page.configuration.saved'));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
  });

  it('restores a customised type to its defaults by removing its entry', async () => {
    putSpy.mockResolvedValue(view());
    renderPage();
    await waitFor(() => expect(card('catalog.category')).toBeTruthy());
    const restore = within(card('catalog.category')).getByRole('button', { name: 'page.configuration.restoreDefaults' });
    expect((restore as HTMLButtonElement).disabled).toBe(false);
    expect((within(card('orders.order')).getByRole('button', { name: 'page.configuration.restoreDefaults' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(restore);
    expect((within(card('catalog.category')).getByLabelText(/^Name/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    expect(putSpy.mock.calls[0]?.[1]).toEqual({ expectedVersion: 'v1', entities: [{ entityType: 'catalog.category' }] });
  });

  it('discards the draft', async () => {
    renderPage();
    await waitFor(() => expect(card('orders.order')).toBeTruthy());
    fireEvent.click(within(card('orders.order')).getByLabelText(/Billing tax ID/));
    fireEvent.click(screen.getByRole('button', { name: 'page.configuration.discard' }));
    expect((within(card('orders.order')).getByLabelText(/Billing tax ID/) as HTMLInputElement).checked).toBe(false);
    expect(saveButton().disabled).toBe(true);
  });

  it('opens the reload dialog on a version conflict, and reloads from it (FR-026)', async () => {
    putSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'changed', requestId: 'r' } } as never),
    );
    renderPage();
    await waitFor(() => expect(card('orders.order')).toBeTruthy());
    fireEvent.click(within(card('orders.order')).getByLabelText(/Billing tax ID/));
    fireEvent.click(saveButton());
    const dialog = await waitFor(() => screen.getByRole('dialog'));
    expect(within(dialog).getByText('page.configuration.conflict.body')).toBeTruthy();
    getSpy.mockResolvedValue(view({ version: 'v3' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'page.configuration.conflict.reload' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(getSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('says so when the role may not configure global search', async () => {
    getSpy.mockRejectedValue(
      new ApiError(403, { error: { code: 'FORBIDDEN', message: 'no', requestId: 'r' } } as never),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText(/page.configuration.forbidden/)).toBeTruthy());
  });

  it('has no axe violations', async () => {
    renderPage();
    await waitFor(() => expect(card('orders.order')).toBeTruthy());
    fireEvent.click(within(card('orders.order')).getByLabelText(/Order number/));
    await expectNoAxeViolations(document.body);
  });
});
