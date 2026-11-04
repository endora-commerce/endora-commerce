import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { adminSession, renderWithSession } from '../../helpers/render-with-session';

/**
 * Feature 172, T082 (`contracts/import-profiles-and-csv.md` §4): the import/export centre's
 * **Import profiles** section and the profile the products import requires.
 *
 *  - the section lists, creates, edits and deletes profiles, and is shown only with
 *    `catalog:write` (the code every profile route is gated by);
 *  - the products import cannot start without a profile, runs a dry run first and shows the
 *    per-column `NULL` / `INHERIT` counts, the warnings and the field errors before "Apply";
 *  - "Apply" posts the same file again, without `dryRun`.
 *
 * The module-off axis (Principle XVII) is a property of the registry and is proven by
 * `admin/test/modules/import-export.module-owned-surface.test.tsx`; this file holds the
 * permission axis of the new section.
 */

const CHANNEL_RETAIL = '00000000-0000-4000-8000-0000000000c1';
const CHANNEL_VIP = '00000000-0000-4000-8000-0000000000c2';
const CHANNEL_GONE = '00000000-0000-4000-8000-0000000000c9';

const entities = [
  { name: 'products', exportHeader: ['id'], importHeader: ['sku'], canExport: true, canImport: true },
  { name: 'stock', exportHeader: ['product_sku'], importHeader: ['product_sku'], canExport: true, canImport: true },
];

const profile = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Akeneo default',
  entity: 'products',
  sourceLanguageForGlobal: 'en_US',
  localeMapping: [
    { sourceLocale: 'pl_PL', sourceChannel: null, targets: [{ channelId: CHANNEL_RETAIL, languageCode: 'pl-PL' }] },
    { sourceLocale: 'de_DE', sourceChannel: 'print', targets: [{ channelId: CHANNEL_GONE, languageCode: 'de-DE' }] },
  ],
  createdAt: '2026-11-03T10:00:00.000Z',
  updatedAt: '2026-11-03T10:00:00.000Z',
};

let profiles: Array<typeof profile> = [];
let channelsForbidden = false;

const dryRunReport = {
  imported: 2,
  errors: [{ rowNumber: 4, reason: 'subject_not_found' }],
  dryRun: true,
  cellCounts: [{ column: 'description@pl_retail/pl-PL', null: 3, inherit: 1 }],
  warnings: [{ kind: 'unmapped_locale', locale: 'fr_FR', sourceChannel: null, products: 7 }],
  fieldErrors: [{ rowNumber: 3, column: 'name', code: 'required_empty' }],
};

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return { ...actual, apiClient: { ...actual.apiClient, ...api } };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { default: ImportExportPage } = await import(
  '../../../../packages/modules/import_export/src/admin/pages/ImportExportPage'
);

function getHandler(url: string): unknown {
  if (url === '/api/v1/admin/import-export/entities') return { data: { entities } };
  if (url.startsWith('/api/v1/admin/import-export/profiles')) return { data: profiles };
  // Owner decision 2026-11-03: the editor reads its targets from import_export's own
  // `catalog:write` route, never from the sales-channel administration (`sales_channels:read`).
  if (url === '/api/v1/admin/import-export/channel-targets') {
    if (channelsForbidden) {
      throw new ApiError(403, { error: { code: 'FORBIDDEN', message: 'forbidden' } });
    }
    return {
      data: [
        { id: CHANNEL_VIP, code: 'pl_b2b_vip', languages: ['pl-PL'] },
        { id: CHANNEL_RETAIL, code: 'pl_retail', languages: ['pl-PL', 'en-US'] },
      ],
    };
  }
  throw new Error(`unexpected GET ${url}`);
}

/** Every key of the module's real English bundle, resolving to itself. */
function keyBundle(): Bundle {
  const en = JSON.parse(
    readFileSync(resolve(process.cwd(), '../packages/modules/import_export/i18n/en.json'), 'utf8'),
  ) as Record<string, string>;
  const entries: Record<string, string> = {};
  for (const key of Object.keys(en)) entries[key] = key;
  // Composed labels keep their parameters, so a row's controls stay distinguishable.
  entries['importProfiles.mapping.rowLabel'] = '{label}, row {row}';
  entries['importProfiles.mapping.removeRow'] = 'importProfiles.mapping.removeRow {row}';
  entries['importProfiles.editNamed'] = 'importProfiles.editNamed {name}';
  entries['importProfiles.deleteNamed'] = 'importProfiles.deleteNamed {name}';
  return { import_export: entries };
}

function renderPage(permissions: string[]): void {
  renderWithSession(<ImportExportPage />, {
    session: adminSession({ permissions }),
    bundle: keyBundle(),
  });
}

async function productsCard(): Promise<HTMLElement> {
  const title = await screen.findByText('entity.products');
  const root = title.closest('[data-entity]');
  if (!(root instanceof HTMLElement)) throw new Error('no products card');
  return root;
}

function csvFile(): File {
  const file = new File(['sku,name\nA,Alpha\n'], 'products.csv', { type: 'text/csv' });
  // jsdom's File has no text() in every version the admin runs on.
  Object.defineProperty(file, 'text', { value: async () => 'sku,name\nA,Alpha\n' });
  return file;
}

beforeEach(() => {
  profiles = [profile];
  channelsForbidden = false;
  api.get.mockImplementation(async (url: string) => getHandler(url));
  api.post.mockImplementation(async (url: string) => {
    if (url.includes('dryRun=true')) return { data: dryRunReport };
    if (url.startsWith('/api/v1/admin/import/products')) {
      return { data: { ...dryRunReport, dryRun: undefined } };
    }
    if (url === '/api/v1/admin/import-export/profiles') return { data: { ...profile, id: 'new' } };
    throw new Error(`unexpected POST ${url}`);
  });
  api.patch.mockImplementation(async () => ({ data: profile }));
  api.delete.mockImplementation(async () => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Import profiles section', () => {
  it('lists the profiles with their mapping count for a catalog:write operator', async () => {
    renderPage(['catalog:write']);
    const section = await screen.findByRole('region', { name: 'importProfiles.title' });
    expect(await within(section).findByText('Akeneo default')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/api/v1/admin/import-export/profiles?entity=products');
  });

  it('is absent, and fetches no profile, without catalog:write', async () => {
    renderPage(['inventory:write']);
    await screen.findByText('entity.stock');
    expect(screen.queryByRole('region', { name: 'importProfiles.title' })).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/import-export/profiles'));
  });

  it('shows the empty state when no profile exists', async () => {
    profiles = [];
    renderPage(['catalog:write']);
    const section = await screen.findByRole('region', { name: 'importProfiles.title' });
    expect(await within(section).findByText('importProfiles.empty')).toBeTruthy();
  });

  it('shows the error state when the list cannot be read', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/admin/import-export/profiles')) throw new Error('boom');
      return getHandler(url);
    });
    renderPage(['catalog:write']);
    const section = await screen.findByRole('region', { name: 'importProfiles.title' });
    expect(await within(section).findByText('importProfiles.error.load')).toBeTruthy();
    // A retry reads the list again (final design review: no dead end).
    api.get.mockImplementation(async (url: string) => getHandler(url));
    fireEvent.click(within(section).getByRole('button', { name: 'importProfiles.retry' }));
    expect(await within(section).findByText(profile.name)).toBeTruthy();
    expect(within(section).queryByText('importProfiles.error.load')).toBeNull();
  });

  it('creates a profile with a mapping row whose target is a channel and language', async () => {
    profiles = [];
    renderPage(['catalog:write']);
    const section = await screen.findByRole('region', { name: 'importProfiles.title' });
    fireEvent.click(await within(section).findByRole('button', { name: 'importProfiles.create' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('importProfiles.field.name'), {
      target: { value: 'Pimcore' },
    });
    fireEvent.change(within(dialog).getByLabelText('importProfiles.field.sourceLanguageForGlobal'), {
      target: { value: 'en_US' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.mapping.add' }));
    fireEvent.change(within(dialog).getByLabelText('importProfiles.mapping.sourceLocale, row 1'), {
      target: { value: 'pl_PL' },
    });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'importProfiles.mapping.targets, row 1' }));
    fireEvent.click(await within(dialog).findByLabelText(/^pl_retail \/ Polish/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.save' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/import-export/profiles', {
      name: 'Pimcore',
      entity: 'products',
      sourceLanguageForGlobal: 'en_US',
      localeMapping: [
        { sourceLocale: 'pl_PL', sourceChannel: null, targets: [{ channelId: CHANNEL_RETAIL, languageCode: 'pl-PL' }] },
      ],
    });
  });

  it('refuses to save a profile without a name, without calling the server', async () => {
    profiles = [];
    renderPage(['catalog:write']);
    const section = await screen.findByRole('region', { name: 'importProfiles.title' });
    fireEvent.click(await within(section).findByRole('button', { name: 'importProfiles.create' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.save' }));
    expect(await within(dialog).findByText('importProfiles.error.nameRequired')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the server refusal of a taken name in the dialog', async () => {
    profiles = [];
    api.post.mockImplementation(async () => {
      throw new ApiError(409, { error: { code: 'IMPORT_PROFILE_NAME_TAKEN', message: 'taken' } });
    });
    renderPage(['catalog:write']);
    const section = await screen.findByRole('region', { name: 'importProfiles.title' });
    fireEvent.click(await within(section).findByRole('button', { name: 'importProfiles.create' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('importProfiles.field.name'), {
      target: { value: 'Akeneo default' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.save' }));
    expect(await within(dialog).findByText('errors.IMPORT_PROFILE_NAME_TAKEN')).toBeTruthy();
  });

  it('edits a profile through PATCH and warns about a target whose channel no longer exists', async () => {
    renderPage(['catalog:write']);
    const section = await screen.findByRole('region', { name: 'importProfiles.title' });
    fireEvent.click(await within(section).findByRole('button', { name: `importProfiles.editNamed ${profile.name}` }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('importProfiles.mapping.missingChannel')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls[0]?.[0]).toBe(`/api/v1/admin/import-export/profiles/${profile.id}`);
  });

  it('offers targets to a catalog:write operator from the import_export read alone', async () => {
    renderPage(['catalog:write']);
    const section = await screen.findByRole('region', { name: 'importProfiles.title' });
    fireEvent.click(await within(section).findByRole('button', { name: 'importProfiles.create' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.mapping.add' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/v1/admin/import-export/channel-targets'));
    expect(within(dialog).queryByText('importProfiles.error.channels')).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/v1/admin/sales-channels'));
  });

  it('shows the channel read refusal in the mapping editor instead of an empty target list', async () => {
    channelsForbidden = true;
    renderPage(['catalog:write']);
    const section = await screen.findByRole('region', { name: 'importProfiles.title' });
    fireEvent.click(await within(section).findByRole('button', { name: 'importProfiles.create' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('importProfiles.error.channels')).toBeTruthy();
    // Retrying in place reads the targets again; nothing has to be closed and reopened.
    channelsForbidden = false;
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.retry' }));
    await waitFor(() => expect(within(dialog).queryByText('importProfiles.error.channels')).toBeNull());
  });

  it('marks and focuses the field a validation problem names, row by row', async () => {
    profiles = [];
    renderPage(['catalog:write']);
    const section = await screen.findByRole('region', { name: 'importProfiles.title' });
    fireEvent.click(await within(section).findByRole('button', { name: 'importProfiles.create' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('importProfiles.field.name'), { target: { value: 'Rows' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.mapping.add' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.mapping.add' }));
    fireEvent.change(within(dialog).getByLabelText('importProfiles.mapping.sourceLocale, row 1'), { target: { value: 'pl_PL' } });
    fireEvent.change(within(dialog).getByLabelText('importProfiles.mapping.sourceLocale, row 2'), { target: { value: 'not a locale!' } });
    // Row 1 has no target yet: the first problem in reading order is row 1's targets.
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.save' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'importProfiles.mapping.targets, row 1' })).toHaveFocus(),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.mapping.targets, row 1' }));
    fireEvent.click(await within(dialog).findByLabelText(/^pl_retail \/ Polish/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.save' }));
    const second = within(dialog).getByLabelText('importProfiles.mapping.sourceLocale, row 2');
    await waitFor(() => expect(second).toHaveAttribute('aria-invalid', 'true'));
    expect(second).toHaveFocus();
    expect(second).toHaveAccessibleDescription('importProfiles.error.locale');
    expect(within(dialog).getByLabelText('importProfiles.mapping.sourceLocale, row 1')).not.toHaveAttribute('aria-invalid');
    expect(api.post).not.toHaveBeenCalled();

    // Removing a row keeps the focus in the dialog.
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.mapping.removeRow 2' }));
    expect(within(dialog).getByRole('button', { name: 'importProfiles.mapping.add' })).toHaveFocus();
  });

  it('deletes a profile only after confirmation', async () => {
    renderPage(['catalog:write']);
    const section = await screen.findByRole('region', { name: 'importProfiles.title' });
    fireEvent.click(await within(section).findByRole('button', { name: `importProfiles.deleteNamed ${profile.name}` }));
    const dialog = await screen.findByRole('dialog');
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'importProfiles.delete.confirm' }));
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith(`/api/v1/admin/import-export/profiles/${profile.id}`),
    );
  });
});

describe('Products import: required profile, dry run, then Apply', () => {
  it('cannot start an import until a profile is chosen, and says why', async () => {
    profiles = [profile, { ...profile, id: '00000000-0000-4000-8000-0000000000a2', name: 'Second' }];
    renderPage(['catalog:write']);
    const card = within(await productsCard());
    await card.findByRole('option', { name: 'Second' });
    const fileInput = card.getByLabelText('products.checkFile') as HTMLInputElement;
    expect(fileInput.disabled).toBe(true);
    expect(fileInput).toHaveAccessibleDescription('products.chooseProfileFirst');
    fireEvent.change(card.getByLabelText('products.profile'), { target: { value: profile.id } });
    expect(fileInput.disabled).toBe(false);
  });

  it('preselects the only profile there is', async () => {
    renderPage(['catalog:write']);
    const card = within(await productsCard());
    await waitFor(() => expect(card.getByLabelText('products.profile')).toHaveValue(profile.id));
    expect((card.getByLabelText('products.checkFile') as HTMLInputElement).disabled).toBe(false);
  });

  it('points to the profiles section when no profile exists', async () => {
    profiles = [];
    renderPage(['catalog:write']);
    const card = within(await productsCard());
    expect(await card.findByText('products.noProfile')).toBeTruthy();
  });

  it('runs a dry run first and shows the counts, warnings and refusals before Apply', async () => {
    renderPage(['catalog:write']);
    const card = within(await productsCard());
    fireEvent.change(card.getByLabelText('products.profile'), { target: { value: profile.id } });
    fireEvent.change(card.getByLabelText('products.checkFile'), { target: { files: [csvFile()] } });

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0]?.[0]).toBe(
      `/api/v1/admin/import/products?profileId=${profile.id}&dryRun=true`,
    );
    expect(await card.findByText('description@pl_retail/pl-PL')).toBeTruthy();
    expect(card.getByText('products.warning.unmappedLocale')).toBeTruthy();
    expect(card.getByText('fieldError.required_empty')).toBeTruthy();
    expect(card.getByText('subject_not_found')).toBeTruthy();

    fireEvent.click(card.getByRole('button', { name: 'products.apply' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1]?.[0]).toBe(`/api/v1/admin/import/products?profileId=${profile.id}`);
    expect(api.post.mock.calls[1]?.[1]).toBe('sku,name\nA,Alpha\n');
    expect(await card.findByText('products.applied')).toBeTruthy();
  });

  it('labels every refusal the import can return, keeps duplicate rows and says when the list was cut', async () => {
    api.post.mockImplementation(async () => ({
      data: {
        imported: 0,
        dryRun: true,
        errors: [
          { rowNumber: 2, reason: 'sku is required' },
          { rowNumber: 2, reason: 'sku is required' },
          { rowNumber: 3, reason: 'unknown sku: X-1' },
          { rowNumber: 4, reason: 'IMPORT_CELL_CONFLICT: "name" is written by a scope column and by a mapped locale column' },
          { rowNumber: 5, reason: 'name@pl_retail: the same field and scope twice in one row' },
          // A refusal of the whole product by catalog: `<CODE>: <message>`, never shown raw.
          { rowNumber: 9, reason: 'PRODUCT_NOT_FOUND: Product not found.' },
          { rowNumber: 10, reason: 'SOME_FUTURE_CODE: Something else went wrong.' },
        ],
        fieldErrors: [
          { rowNumber: 6, column: 'name@pl_retail', code: 'FIELD_NOT_AT_SCOPE' },
          { rowNumber: 6, column: 'urlKey@pl_retail', code: 'URL_KEY_TAKEN' },
          { rowNumber: 7, column: 'name[fr_FR]', code: 'language_not_offered' },
          { rowNumber: 7, column: 'name', code: 'SCOPE_INVALID' },
          { rowNumber: 7, column: 'status', code: 'not_supported' },
          { rowNumber: 8, column: 'sku', code: 'subject_not_found' },
        ],
        truncated: { errors: 1500, fieldErrors: 6 },
      },
    }));
    renderPage(['catalog:write']);
    const card = within(await productsCard());
    fireEvent.change(card.getByLabelText('products.profile'), { target: { value: profile.id } });
    fireEvent.change(card.getByLabelText('products.checkFile'), { target: { files: [csvFile()] } });

    expect(await card.findAllByText('rowError.skuRequired')).toHaveLength(2);
    for (const key of ['rowError.unknownSku', 'rowError.cellConflict', 'rowError.duplicateCell', 'rowError.PRODUCT_NOT_FOUND', 'rowError.refused']) {
      expect(card.getByText(key)).toBeTruthy();
    }
    expect(card.queryByText(/^(PRODUCT_NOT_FOUND|SOME_FUTURE_CODE)/)).toBeNull();
    for (const code of ['FIELD_NOT_AT_SCOPE', 'URL_KEY_TAKEN', 'language_not_offered', 'SCOPE_INVALID', 'not_supported', 'subject_not_found']) {
      expect(card.getByText(`fieldError.${code}`)).toBeTruthy();
    }
    expect(card.getByText('products.truncated')).toBeTruthy();
  });

  it('discards the dry run on Cancel without writing', async () => {
    renderPage(['catalog:write']);
    const card = within(await productsCard());
    fireEvent.change(card.getByLabelText('products.profile'), { target: { value: profile.id } });
    fireEvent.change(card.getByLabelText('products.checkFile'), { target: { files: [csvFile()] } });
    fireEvent.click(await card.findByRole('button', { name: 'products.cancel' }));
    expect(card.queryByRole('button', { name: 'products.apply' })).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('keeps the other entities importing without a profile', async () => {
    renderPage(['catalog:write', 'inventory:write']);
    await screen.findByText('entity.stock');
    expect(screen.getAllByLabelText('products.profile')).toHaveLength(1);
  });
});
