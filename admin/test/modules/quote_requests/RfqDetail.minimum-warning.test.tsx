import { StrictMode, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TranslationProvider } from '../../../../packages/admin-shell/src/i18n/TranslationProvider';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { RFQ_ID, rfqPayload } from './rfq-reference-fixtures';

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, CustomFieldValuesPanel: () => null, ProductPicker: () => null };
});

const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

/**
 * Feature 155, T106 — the admin quote-request screen flags a line below its
 * product's current minimum (FR-030, US4 #15): "Below minimum (10 pcs)", or the
 * packaging-unit variant, on the Overview and the Modify tab; nothing on a line
 * the read model does not flag. The warning informs and blocks nothing.
 *
 * The bundle is `_i18n`'s **shipped** one, read off disk, in both languages: a
 * passthrough bundle would let a missing key render as itself and pass.
 */

type Language = 'en' | 'pl';

const REPO_ROOT = resolve(process.cwd(), '..');

function coreEntries(language: Language): Record<string, string> {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages/modules/_i18n/i18n', `${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const ENTRIES: Record<Language, Record<string, string>> = { en: coreEntries('en'), pl: coreEntries('pl') };

function tr(language: Language, key: string, params: Record<string, string | number> = {}): string {
  const template = ENTRIES[language][key];
  if (template === undefined) throw new Error(`missing ${language} key ${key}`);
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name]));
}

type Warning = { kind: 'pieces' | 'packaging_unit'; minimum: number; packagingUnitName?: string } | null;

function payloadWith(warning: Warning | undefined, packagingUnitName: string | null = null): Record<string, unknown> {
  const base = rfqPayload({ packagingUnitName });
  const [item] = base['items'] as Array<Record<string, unknown>>;
  return { ...base, items: [warning === undefined ? item : { ...item, minimumWarning: warning }] };
}

function installDetail(payload: Record<string, unknown>): void {
  getSpy.mockImplementation((url: string) => {
    if (url.startsWith('/api/v1/admin/quote-requests/')) return Promise.resolve({ data: payload });
    return Promise.resolve({ data: {} });
  });
}

function renderDetail(language: Language): void {
  const ui: ReactElement = (
    <StrictMode>
      {withSession(
        <MemoryRouter initialEntries={[`/quote-requests/${RFQ_ID}`]}>
          <Routes>
            <Route path="/quote-requests/:id" element={<RfqDetail />} />
          </Routes>
        </MemoryRouter>,
        {
          session: adminSession({ permissions: ['rfqs:handle'] }),
          presence: modulePresence({ present: ['quote_requests'] }),
          contributions: [],
        },
      )}
    </StrictMode>
  );
  render(
    <TranslationProvider language={language} initialBundle={{ core: ENTRIES[language] }}>
      {ui}
    </TranslationProvider>,
  );
}

async function overviewRow(): Promise<HTMLElement> {
  const name = await screen.findByText('Widget');
  const row = name.closest('tr');
  if (!row) throw new Error('line row not found');
  return row as HTMLElement;
}

async function modifyLine(language: Language): Promise<HTMLElement> {
  await screen.findByText('Widget');
  fireEvent.click(screen.getByRole('tab', { name: tr(language, 'rfq.detail.tabs.modify') }));
  return screen.findByRole('group', { name: 'Widget' });
}

beforeEach(() => {
  getSpy.mockReset();
});

describe.each<Language>(['en', 'pl'])('RfqDetail — below-minimum warning (%s)', (language) => {
  const pieces = (): string => tr(language, 'rfq.detail.minimum.pieces', { minimum: 10 });
  const pallet = (): string =>
    tr(language, 'rfq.detail.minimum.packagingUnit', { minimum: 2, packagingUnitName: 'Pallet' });

  it('shows "below minimum (10 pcs)" on the Overview line (FR-030)', async () => {
    installDetail(payloadWith({ kind: 'pieces', minimum: 10 }));
    renderDetail(language);
    const row = await overviewRow();
    expect(within(row).getByText(pieces())).toBeInTheDocument();
  });

  it('shows the packaging-unit variant with the unit name on the Overview line', async () => {
    installDetail(payloadWith({ kind: 'packaging_unit', minimum: 2, packagingUnitName: 'Pallet' }, 'Pallet'));
    renderDetail(language);
    const row = await overviewRow();
    expect(within(row).getByText(pallet())).toBeInTheDocument();
    expect(within(row).queryByText(pieces())).toBeNull();
  });

  it.each([
    ['null', null],
    ['absent', undefined],
  ] as const)('shows no warning when minimumWarning is %s', async (_label, warning) => {
    installDetail(payloadWith(warning));
    renderDetail(language);
    const row = await overviewRow();
    const minimumText = tr(language, 'rfq.detail.minimum.pieces', { minimum: 'X' }).split('X')[0]!.trim();
    expect(row.textContent ?? '').not.toContain(minimumText);
  });

  it('shows the warning on the kept line in the Modify tab', async () => {
    installDetail(payloadWith({ kind: 'pieces', minimum: 10 }));
    renderDetail(language);
    const line = await modifyLine(language);
    expect(within(line).getByText(pieces())).toBeInTheDocument();
  });

  it('shows the packaging-unit variant in the Modify tab', async () => {
    installDetail(payloadWith({ kind: 'packaging_unit', minimum: 2, packagingUnitName: 'Pallet' }, 'Pallet'));
    renderDetail(language);
    const line = await modifyLine(language);
    expect(within(line).getByText(pallet())).toBeInTheDocument();
  });

  it('shows nothing in the Modify tab on an unflagged line', async () => {
    installDetail(payloadWith(null));
    renderDetail(language);
    const line = await modifyLine(language);
    const minimumText = tr(language, 'rfq.detail.minimum.pieces', { minimum: 'X' }).split('X')[0]!.trim();
    expect(line.textContent ?? '').not.toContain(minimumText);
  });
});

/**
 * U4 (owner's manual test, step 9) — the badge under the Modify tab's quantity input made that
 * cell the tallest in a centre-aligned row, which pushed the input up out of line with the other
 * cells. The row aligns its cells to the top; every cell is at least one control (h-9) tall and
 * centres its own content in that first line, so the badge hangs below without moving anything.
 */
describe('RfqDetail — the Modify row stays aligned under a minimum warning', () => {
  it('top-aligns the row and keeps every cell on the controls’ first line', async () => {
    installDetail(payloadWith({ kind: 'pieces', minimum: 10 }));
    renderDetail('en');
    const line = await modifyLine('en');
    expect(line.className).toMatch(/(^|\s)items-start(\s|$)/);
    expect(line.className).not.toMatch(/(^|\s)items-center(\s|$)/);
    for (const cell of Array.from(line.children) as HTMLElement[]) {
      expect(cell.className, cell.outerHTML.slice(0, 120)).not.toContain('self-center');
    }
    const quantity = within(line).getByRole('spinbutton', { name: tr('en', 'rfq.detail.modify.quantity') });
    expect(quantity.getAttribute('aria-describedby')).toBe('rfq-line-0-minimum');
    expect(document.getElementById('rfq-line-0-minimum')?.textContent).toBe(
      tr('en', 'rfq.detail.minimum.pieces', { minimum: 10 }),
    );
  });
});

describe('RfqDetail — the Overview row stays aligned under a minimum warning', () => {
  it('top-aligns every cell, so the quantity is level with the other cells’ first line', async () => {
    installDetail(payloadWith({ kind: 'pieces', minimum: 10 }));
    renderDetail('en');
    const row = await overviewRow();
    expect(row.className).toContain('[&>td]:align-top');
  });
});
