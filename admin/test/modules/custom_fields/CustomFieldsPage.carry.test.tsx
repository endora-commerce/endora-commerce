import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError, AuthProvider } from '@endora-commerce/admin-kit/lib';
import type { CustomFieldDefinitionDto } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { chooseRowAction } from './row-actions';
import { adminSession } from '../../helpers/render-with-session';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import pl from '../../../../packages/modules/custom_fields/i18n/pl.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import { CARRY_ENTITY_TYPES, carryDefinition, sentence } from './carry-fixtures';

/**
 * Feature 162 (T042, US4) — `/custom-fields` offers the carry options, sends
 * them, explains a refusal in words, and shows which targets a definition
 * carries to, marked where the target no longer fits
 * (`specs/162-custom-fields-value-carry/contracts/admin-surfaces.md` §1.1 – §1.3).
 */

const EN = en as Record<string, string>;
const PL = pl as Record<string, string>;

const QR_REGION = carryDefinition('00000000-0000-4000-8000-0000000c0001', { carryTo: ['order'] });
/** Lacks "south", which the Quote Request field offers — the carry to it is incompatible. */
const ORDER_REGION = carryDefinition('00000000-0000-4000-8000-0000000c0002', {
  entityType: 'order',
  optionValues: ['north'],
});
const OPPORTUNITY_REGION = carryDefinition('00000000-0000-4000-8000-0000000c0003', { entityType: 'opportunity' });

const db = vi.hoisted(() => ({ definitions: [] as CustomFieldDefinitionDto[], failAll: false }));
const client = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
}));

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: async () => CARRY_ENTITY_TYPES,
    list: async (entityType?: string) => {
      client.list(entityType);
      if (entityType === undefined && db.failAll) throw new Error('offline');
      return db.definitions.filter((d) => entityType === undefined || d.entityType === entityType);
    },
    get: async (id: string) => db.definitions.find((d) => d.id === id),
    create: (...args: unknown[]) => client.create(...args),
    update: (...args: unknown[]) => client.update(...args),
    remove: async () => ({}),
    createOption: async () => ({}),
    updateOption: async () => ({}),
    removeOption: async () => ({}),
  },
}));

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);

let nativeDialogs: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  db.definitions = [QR_REGION, ORDER_REGION, OPPORTUNITY_REGION];
  db.failAll = false;
  client.create.mockReset().mockResolvedValue({});
  client.update.mockReset().mockResolvedValue({});
  client.list.mockReset();
  nativeDialogs = [
    vi.spyOn(window, 'confirm').mockImplementation(() => false),
    vi.spyOn(window, 'alert').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  for (const spy of nativeDialogs) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function renderPage(
  entityType: 'quote_request' | 'order' | 'opportunity' | 'category',
  bundle: Record<string, string> = EN,
): Promise<void> {
  renderWithI18n(
    <StrictMode>
      <AuthProvider initial={adminSession({ permissions: ['custom_fields:read', 'custom_fields:write'] })}>
        <CustomFieldsPage />
      </AuthProvider>
    </StrictMode>,
    { custom_fields: bundle, core: coreEn as Record<string, string> },
  );
  const recordType = sentence(bundle, 'customFields.form.entity');
  const label = sentence(bundle, CARRY_ENTITY_TYPES.find((info) => info.entityType === entityType)!.labelKey);
  await waitFor(() =>
    expect(within(screen.getByLabelText(recordType)).getAllByRole('option').map((o) => o.textContent)).toContain(label),
  );
  fireEvent.change(screen.getByLabelText(recordType), { target: { value: entityType } });
  // The selected type's rows and the every-type read the marks need have both arrived.
  await waitFor(() => expect(client.list).toHaveBeenCalledWith(entityType));
  await waitFor(() => expect(client.list).toHaveBeenCalledWith(undefined));
}

const toggle = (entityType: string, bundle: Record<string, string> = EN): string =>
  sentence(bundle, 'customFields.carry.toggle', { entityType });

async function openEditor(key = 'region', bundle: Record<string, string> = EN): Promise<HTMLElement> {
  const title = sentence(bundle, 'customFields.editor.title', { key });
  await chooseRowAction(key, 'edit', bundle);
  return screen.findByRole('dialog', { name: title });
}

/** Opens the definition form in its create view (issue #447), the key and default label filled when given. */
async function openCreate(key?: string, bundle: Record<string, string> = EN): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: sentence(bundle, 'customFields.form.newField') }));
  const dialog = await screen.findByRole('dialog', { name: sentence(bundle, 'customFields.form.createTitle') });
  if (key !== undefined) {
    fireEvent.change(within(dialog).getByPlaceholderText('po_number'), { target: { value: key } });
    const labels = within(dialog).getByRole('group', { name: sentence(bundle, 'customFields.editor.section.labels') });
    fireEvent.change(within(labels).getByLabelText(sentence(bundle, 'customFields.editor.labelDefault')), {
      target: { value: key },
    });
  }
  return dialog;
}

describe('CustomFieldsPage — carry options (US4)', () => {
  it('offers one carry checkbox per carry target in the create form and sends the ticked ones', async () => {
    await renderPage('quote_request');
    const dialog = await openCreate('region_copy');
    const toOrder = within(dialog).getByRole('checkbox', { name: toggle('Order') });
    expect(within(dialog).getByRole('checkbox', { name: toggle('Opportunity') })).not.toBeChecked();
    fireEvent.click(toOrder);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create.mock.calls[0]![0]).toMatchObject({ key: 'region_copy', carryTo: ['order'] });
  });

  it('creates a field that carries nothing when no box is ticked', async () => {
    await renderPage('quote_request');
    const dialog = await openCreate('plain');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create.mock.calls[0]![0]).toMatchObject({ key: 'plain', carryTo: [] });
  });

  it('offers no carry option for a type without carry targets (US4-4)', async () => {
    await renderPage('category');
    const dialog = await openCreate();
    expect(within(dialog).queryByRole('checkbox', { name: /Carry value to/ })).toBeNull();
  });

  it('never offers an Order field a Quote Request target', async () => {
    await renderPage('order');
    const dialog = await openCreate();
    expect(within(dialog).getByRole('checkbox', { name: toggle('Opportunity') })).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: toggle('Quote request') })).toBeNull();
  });

  it('follows the record type chosen in the create form, keeping no target the new type does not offer', async () => {
    await renderPage('quote_request');
    const dialog = await openCreate('region_copy');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: toggle('Order') }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: toggle('Opportunity') }));
    fireEvent.change(within(dialog).getByLabelText('Record type'), { target: { value: 'opportunity' } });
    expect(within(dialog).queryByRole('checkbox', { name: toggle('Opportunity') })).toBeNull();
    expect(within(dialog).getByRole('checkbox', { name: toggle('Order') })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: toggle('Quote request') })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create.mock.calls[0]![0]).toMatchObject({ entityType: 'opportunity', carryTo: ['order'] });
  });

  it('shows the stored carry in the editor and sends nothing when it is left alone', async () => {
    await renderPage('quote_request');
    const dialog = await openEditor();
    expect(within(dialog).getByRole('checkbox', { name: toggle('Order') })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: toggle('Opportunity') })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.update).not.toHaveBeenCalled();
  });

  it('sends the whole new carry list, and only it, when the carry changed', async () => {
    await renderPage('quote_request');
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: toggle('Opportunity') }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1));
    expect(client.update).toHaveBeenCalledWith(QR_REGION.id, { carryTo: ['order', 'opportunity'] });
  });

  it('keeps the editor open and names the missing options when the server refuses (US4-3)', async () => {
    client.update.mockRejectedValueOnce(
      new ApiError(422, {
        error: {
          code: 'CUSTOM_FIELD_CARRY_INCOMPATIBLE' as never,
          message: 'CUSTOM_FIELD_CARRY_INCOMPATIBLE raw',
          details: {
            code: 'options_missing',
            targetEntityType: 'opportunity',
            key: 'region',
            missingOptionValues: 'south, west',
            missingOptionValueList: ['south', 'west'],
          },
        },
      }),
    );
    await renderPage('quote_request');
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: toggle('Opportunity') }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    const refusal = sentence(EN, 'errors.CUSTOM_FIELD_CARRY_INCOMPATIBLE.options_missing', {
      key: 'region',
      targetEntityType: 'Opportunity',
      missingOptionValues: 'south, west',
    });
    const message = await within(dialog).findByText(refusal);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).queryByText(/CUSTOM_FIELD_CARRY_INCOMPATIBLE/)).toBeNull();

    // R16 — the sentence sits in the carry group it is about, which it describes,
    // and takes the focus, so it is never left scrolled out of sight.
    const group = within(dialog).getByRole('group', { name: sentence(EN, 'customFields.carry.legend') });
    expect(group).toContainElement(message);
    expect(group).toHaveAccessibleDescription(refusal);
    await waitFor(() => expect(message).toHaveFocus());
    const ticked = within(group).getByRole('checkbox', { name: toggle('Opportunity') });
    expect(ticked).toHaveAttribute('aria-invalid', 'true');
    expect(ticked).toHaveAccessibleDescription(
      `${sentence(EN, 'customFields.carry.help', { entityType: 'Opportunity' })} ${refusal}`,
    );
    expect(within(group).getByRole('checkbox', { name: toggle('Order') })).toHaveAttribute('aria-invalid', 'true');
    // The footer says beside Save that nothing was saved, and where to look; the
    // sentence itself is said once.
    const footer = within(dialog).getByRole('button', { name: 'Save' }).parentElement as HTMLElement;
    expect(
      within(footer).getByText(
        sentence(EN, 'customFields.carry.refusalSummary', { section: sentence(EN, 'customFields.carry.legend') }),
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText(refusal)).toHaveLength(1);

    // Changing the boxes withdraws the refusal they no longer match.
    fireEvent.click(ticked);
    expect(within(dialog).queryByText(refusal)).toBeNull();
    expect(group).not.toHaveAttribute('aria-describedby');
    expect(within(group).getByRole('checkbox', { name: toggle('Order') })).not.toHaveAttribute('aria-invalid');
  });

  it('names the missing field and its type when the create form is refused (US4-2)', async () => {
    client.create.mockRejectedValueOnce(
      new ApiError(422, {
        error: {
          code: 'CUSTOM_FIELD_CARRY_INCOMPATIBLE' as never,
          message: 'raw',
          details: { code: 'target_missing', targetEntityType: 'order', key: 'fresh_key' },
        },
      }),
    );
    await renderPage('quote_request');
    const dialog = await openCreate('fresh_key');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: toggle('Order') }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
    const refusal = sentence(EN, 'errors.CUSTOM_FIELD_CARRY_INCOMPATIBLE.target_missing', {
      key: 'fresh_key',
      targetEntityType: 'Order',
    });
    const message = await within(dialog).findByText(refusal);
    // R16 — said at the form, inside the carry group it describes, and focused;
    // a summary beside the submit button points at it.
    const group = within(dialog).getByRole('group', { name: sentence(EN, 'customFields.carry.legend') });
    expect(group).toHaveAccessibleDescription(refusal);
    expect(group).toContainElement(message);
    await waitFor(() => expect(message).toHaveFocus());
    expect(within(dialog).getByRole('checkbox', { name: toggle('Order') })).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByRole('checkbox', { name: toggle('Opportunity') })).not.toHaveAttribute('aria-invalid');
    expect(screen.getAllByText(refusal)).toHaveLength(1);
    expect(message.closest('[role="alert"]')).toBeNull();
    expect(within(dialog).getByTestId('save-error')).toHaveTextContent(
      sentence(EN, 'customFields.carry.refusalSummary', { section: sentence(EN, 'customFields.carry.legend') }),
    );
    // The form keeps what was typed, so the operator can fix it and try again.
    expect(within(dialog).getByPlaceholderText('po_number')).toHaveValue('fresh_key');
    expect(within(dialog).getByRole('checkbox', { name: toggle('Order') })).toBeChecked();
  });

  it('falls back to the server sentence for an unknown refusal token', async () => {
    client.update.mockRejectedValueOnce(
      new ApiError(422, {
        error: { code: 'CUSTOM_FIELD_CARRY_INCOMPATIBLE' as never, message: 'Server sentence.', details: { code: 'brand_new' } },
      }),
    );
    await renderPage('quote_request');
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: toggle('Opportunity') }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Server sentence.')).toBeInTheDocument();
  });
});

/**
 * Owner ruling V2 (2026-10-21, T066) — the editor dialog explains each carry
 * checkbox with its own help line. Since issue #447 a field is created in the
 * same definition form, so the create view reads exactly as the edit view
 * does; the narrow create-form row, and its one shared help line, are gone.
 */
describe.each([
  ['en', EN],
  ['pl', PL],
] as const)('CustomFieldsPage — carry help lines (%s)', (_language, bundle) => {
  const typeName = (entityType: 'order' | 'opportunity'): string =>
    sentence(bundle, CARRY_ENTITY_TYPES.find((info) => info.entityType === entityType)!.labelKey);

  it('describes each carry checkbox of the create form by its own help line, as the editor does', async () => {
    await renderPage('quote_request', bundle);
    const dialog = await openCreate(undefined, bundle);
    const fieldset = within(dialog).getByRole('group', { name: sentence(bundle, 'customFields.carry.legend') });
    for (const target of ['order', 'opportunity'] as const) {
      expect(within(fieldset).getByRole('checkbox', { name: toggle(typeName(target), bundle) })).toHaveAccessibleDescription(
        sentence(bundle, 'customFields.carry.help', { entityType: typeName(target) }),
      );
    }
  });

  it('describes each carry checkbox of the editor dialog by its own help line', async () => {
    await renderPage('quote_request', bundle);
    const dialog = await openEditor('region', bundle);
    const fieldset = within(dialog).getByRole('group', { name: sentence(bundle, 'customFields.carry.legend') });
    for (const target of ['order', 'opportunity'] as const) {
      expect(within(fieldset).getByRole('checkbox', { name: toggle(typeName(target), bundle) })).toHaveAccessibleDescription(
        sentence(bundle, 'customFields.carry.help', { entityType: typeName(target) }),
      );
    }
  });
});

describe('CustomFieldsPage — the Carries to column (US4-5, US4-7)', () => {
  it.each([
    ['en', EN],
    ['pl', PL],
  ] as const)('shows the targets as translated chips (%s)', async (_language, bundle) => {
    await renderPage('quote_request', bundle);
    expect(screen.getByRole('columnheader', { name: sentence(bundle, 'customFields.table.carriesTo') })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /region/ });
    expect(within(row).getByText(sentence(bundle, 'customFields.entity.order'))).toBeInTheDocument();
  });

  it('shows a dash for a field that carries nothing', async () => {
    await renderPage('opportunity');
    const row = screen.getByRole('row', { name: /region/ });
    expect(within(row).getAllByRole('cell').some((cell) => cell.textContent === '—')).toBe(true);
  });

  it('marks a carry whose target lacks a source option, with its reason, until the list re-reads compatible', async () => {
    await renderPage('quote_request');
    const reason = sentence(EN, 'customFields.carry.reason.options_missing', {
      entityType: 'Order',
      missingOptionValues: 'south',
    });
    const row = screen.getByRole('row', { name: /region/ });
    const mark = await within(row).findByText(sentence(EN, 'customFields.carry.incompatible'));
    // The reason is visible text at every width, said once: no hover-only title, no screen-reader-only copy.
    expect(mark).not.toHaveAttribute('title');
    expect(within(row).getAllByText(reason)).toHaveLength(1);
    expect(within(row).getByText(reason).className).not.toMatch(/sr-only/);
    expect(row.querySelector('[title]')).toBeNull();

    // The Order field gains "south"; the next read finds the carry compatible.
    db.definitions = [QR_REGION, carryDefinition(ORDER_REGION.id, { entityType: 'order' }), OPPORTUNITY_REGION];
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(within(screen.getByRole('row', { name: /region/ })).queryByText(sentence(EN, 'customFields.carry.incompatible'))).toBeNull(),
    );
  });

  it('marks a carry whose target field does not exist', async () => {
    db.definitions = [QR_REGION, OPPORTUNITY_REGION];
    await renderPage('quote_request');
    const row = screen.getByRole('row', { name: /region/ });
    expect(
      await within(row).findByText(
        sentence(EN, 'customFields.carry.reason.target_missing', { entityType: 'Order', key: 'region' }),
      ),
    ).toBeInTheDocument();
  });

  it('shows the chips but no mark when the every-type read failed', async () => {
    db.failAll = true;
    await renderPage('quote_request');
    const row = screen.getByRole('row', { name: /region/ });
    expect(within(row).getByText('Order')).toBeInTheDocument();
    // Without the Order definitions there is nothing to judge by: no guess is shown.
    expect(within(row).queryByText(sentence(EN, 'customFields.carry.incompatible'))).toBeNull();
  });

  it.each([
    ['en', EN],
    ['pl', PL],
  ] as const)('says the carry checks are unavailable when the every-type read failed, and retries (%s)', async (_language, bundle) => {
    db.failAll = true;
    await renderPage('quote_request', bundle);
    const unavailable = sentence(bundle, 'customFields.carry.checksUnavailable');
    const alert = (await screen.findByText(unavailable)).closest('[role="status"]') as HTMLElement;
    expect(alert).not.toBeNull();
    const retry = within(alert).getByRole('button', { name: sentence(bundle, 'customFields.carry.retry') });

    // The read comes back: the alert goes and the marks it held back appear.
    db.failAll = false;
    const reads = client.list.mock.calls.filter(([type]) => type === undefined).length;
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByText(unavailable)).toBeNull());
    expect(client.list.mock.calls.filter(([type]) => type === undefined).length).toBe(reads + 1);
    const row = screen.getByRole('row', { name: /region/ });
    expect(await within(row).findByText(sentence(bundle, 'customFields.carry.incompatible'))).toBeInTheDocument();
  });

  it('keeps the alert when the retry fails too', async () => {
    db.failAll = true;
    await renderPage('quote_request');
    const unavailable = sentence(EN, 'customFields.carry.checksUnavailable');
    await screen.findByText(unavailable);
    fireEvent.click(screen.getByRole('button', { name: sentence(EN, 'customFields.carry.retry') }));
    await waitFor(() => expect(screen.getByRole('button', { name: sentence(EN, 'customFields.carry.retry') })).toBeEnabled());
    expect(screen.getByText(unavailable)).toBeInTheDocument();
  });

  it('shows no unavailable alert when the every-type read works', async () => {
    await renderPage('quote_request');
    await within(screen.getByRole('row', { name: /region/ })).findByText(sentence(EN, 'customFields.carry.incompatible'));
    expect(screen.queryByText(sentence(EN, 'customFields.carry.checksUnavailable'))).toBeNull();
  });
});
