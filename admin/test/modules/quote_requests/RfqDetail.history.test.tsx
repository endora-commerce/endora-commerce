import { StrictMode, type ReactElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  QUOTE_REQUEST_HISTORY_EVENT_WINDOW,
  customFieldCarrySkipReasonSchema,
  quoteRequestHistoryChangeSchema,
  quoteRequestHistoryEntryKindSchema,
  type QuoteRequestHistory,
  type QuoteRequestHistoryActor,
  type QuoteRequestHistoryChange,
  type QuoteRequestHistoryEntry,
  type QuoteRequestHistoryEntryKind,
} from '@endora-commerce/contracts';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { RFQ_ID, rfqPayload, renderRfqDetail } from './rfq-reference-fixtures';

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
const { RfqHistory } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqHistory');

/**
 * Feature 146, T057 — the admin History tab reads as a translated, attributed
 * timeline (US2, US3; FR-010, FR-011, FR-013, FR-014, FR-017, FR-018, FR-030),
 * and every customer- or operator-typed text renders as text (threat model T17).
 *
 * The bundle is `_i18n`'s **shipped** one, read off disk, in both languages: a
 * passthrough bundle would let a missing key render as itself and pass.
 */

const REPO_ROOT = resolve(process.cwd(), '..');
const HISTORY_SOURCE = join(
  REPO_ROOT,
  'packages/modules/quote_requests/src/admin/pages/RfqHistory.tsx',
);

type Language = 'en' | 'pl';

function coreEntries(language: Language): Record<string, string> {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages/modules/_i18n/i18n', `${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const ENTRIES: Record<Language, Record<string, string>> = { en: coreEntries('en'), pl: coreEntries('pl') };

/** `quote_requests`' own bundle, shipped — the feature 162 entry's detail lines are its. */
function moduleEntries(language: Language): Record<string, string> {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages/modules/quote_requests/i18n', `${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const MODULE_ENTRIES: Record<Language, Record<string, string>> = { en: moduleEntries('en'), pl: moduleEntries('pl') };

function trModule(language: Language, key: string, params: Record<string, string | number> = {}): string {
  const template = MODULE_ENTRIES[language][key];
  if (template === undefined) throw new Error(`missing ${language} key quote_requests ${key}`);
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name]));
}
const LOCALE: Record<Language, string> = { en: 'en-GB', pl: 'pl-PL' };

function tr(language: Language, key: string, params: Record<string, string | number> = {}): string {
  const template = ENTRIES[language][`rfq.detail.history.${key}`];
  if (template === undefined) throw new Error(`missing ${language} key rfq.detail.history.${key}`);
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name]));
}

function amount(language: Language, n: number): string {
  return new Intl.NumberFormat(LOCALE[language], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function dateTime(language: Language, iso: string): string {
  return new Intl.DateTimeFormat(LOCALE[language], { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

// ---------------------------------------------------------------------------
// Fixture: one entry per kind, every change kind, every actor shape.
// ---------------------------------------------------------------------------

const XSS = '<img src=x onerror=alert(1)>';
const PRODUCT = '00000000-0000-4000-8000-0000000000e1';
const BLUE = '00000000-0000-4000-8000-0000000000e2';
const RED = '00000000-0000-4000-8000-0000000000e4';
const ORDER_ID = '00000000-0000-4000-8000-0000000000a9';
const SOURCE_RFQ = '00000000-0000-4000-8000-0000000000f0';

const blue = { productId: PRODUCT, variantId: BLUE, productName: 'Widget', variantLabel: 'colour=Blue' };
const red = { productId: PRODUCT, variantId: RED, productName: 'Widget', variantLabel: 'colour=Red' };
const plain = { productId: PRODUCT, variantId: null, productName: 'Gadget', variantLabel: null };

const CUSTOMER: QuoteRequestHistoryActor = {
  kind: 'customer',
  customerAccountId: '00000000-0000-4000-8000-0000000000c1',
  name: 'Anna Nowak',
  email: 'anna@example.test',
  recordedRole: 'Customer',
};
const REP: QuoteRequestHistoryActor = {
  kind: 'admin',
  adminUserId: '00000000-0000-4000-8000-0000000000b1',
  name: 'Carl Rep',
  recordedRole: 'Sales representative',
};
const DELETED_ADMIN: QuoteRequestHistoryActor = {
  kind: 'admin',
  adminUserId: '00000000-0000-4000-8000-0000000000b2',
  name: null,
  recordedRole: 'Administrator',
};
const CUSTOM_ROLE_ADMIN: QuoteRequestHistoryActor = {
  kind: 'admin',
  adminUserId: '00000000-0000-4000-8000-0000000000b3',
  name: 'Dana Lead',
  recordedRole: 'Key account lead',
};
const SYSTEM: QuoteRequestHistoryActor = { kind: 'system' };
const UNKNOWN: QuoteRequestHistoryActor = { kind: 'unknown', recordedRole: 'Platform administrator' };

const CHANGES: QuoteRequestHistoryChange[] = [
  { kind: 'header_note', before: null, after: XSS },
  { kind: 'line_added', line: plain, quantity: 3, agreedUnitPrice: 50, currency: 'PLN' },
  { kind: 'line_quantity', line: blue, before: 10, after: 12 },
  { kind: 'line_quantity', line: red, before: 4, after: 5 },
  { kind: 'line_agreed_unit_price', line: blue, before: 110, after: 105, currency: 'PLN' },
  { kind: 'line_proposed_unit_price', line: blue, before: 100, after: 95, currency: 'PLN' },
  { kind: 'line_note', line: blue, before: 'old', after: XSS },
  { kind: 'line_removed', line: red },
  { kind: 'validity', before: '2026-10-20T10:00:00.000Z', after: '2026-10-30T10:00:00.000Z' },
];

let seq = 0;
function entry(
  kind: QuoteRequestHistoryEntryKind,
  actor: QuoteRequestHistoryActor,
  extra: Partial<QuoteRequestHistoryEntry> = {},
): QuoteRequestHistoryEntry {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    eventIds: [id],
    kind,
    occurredAt: `2026-10-0${(seq % 9) + 1}T10:00:00.000Z`,
    actor,
    revisionNumber: null,
    note: null,
    reason: null,
    changes: null,
    relatedQuoteRequestId: null,
    orderId: null,
    ...extra,
  };
}

const FULL: QuoteRequestHistory = {
  truncated: true,
  entries: [
    entry('created', CUSTOMER),
    entry('submitted', CUSTOMER, { revisionNumber: 1 }),
    entry('resubmitted', CUSTOMER, { relatedQuoteRequestId: SOURCE_RFQ }),
    entry('created_by_admin', CUSTOM_ROLE_ADMIN),
    entry('modified', REP, { revisionNumber: 2, changes: CHANGES }),
    entry('modified', REP, { revisionNumber: 3, changes: [] }),
    entry('approved', REP, { note: XSS }),
    entry('accepted_by_customer', CUSTOMER),
    entry('rejected_by_customer', CUSTOMER, { reason: `${XSS} too expensive` }),
    entry('canceled', DELETED_ADMIN, { reason: 'Customer withdrew' }),
    entry('expired', SYSTEM),
    entry('completed', SYSTEM, { orderId: ORDER_ID }),
    entry('note_added', UNKNOWN, { note: 'Call back on Monday' }),
    // Feature 153 (owner answer Q4) — the quote PDF e-mailed.
    entry('pdf_sent', REP, {
      delivery: { recipients: ['buyer@example.com', 'two@example.com'], templateName: 'With discounts', language: 'pl-PL', message: XSS },
    }),
    // Feature 162 — values a Sales Opportunity could not carry into the request
    // (its skip lines are rendered and tested with the History renderer, T048).
    entry('custom_field_carry_skipped', SYSTEM, {
      customFieldCarry: {
        source: { entityType: 'opportunity', recordId: ORDER_ID, reference: 'OPP-000001' },
        skipped: [{ key: 'order_source', reason: 'value_invalid' }],
      },
    }),
  ],
};

const ENTRY_KINDS = [...quoteRequestHistoryEntryKindSchema.options];
const CHANGE_KINDS = quoteRequestHistoryChangeSchema.options.map((o) => o.shape.kind.value);

function answerHistory(history: QuoteRequestHistory): void {
  getSpy.mockImplementation((url: string) => {
    if (url === `/api/v1/admin/quote-requests/${RFQ_ID}/history`) {
      return Promise.resolve({ data: history });
    }
    if (url === `/api/v1/admin/quote-requests/${RFQ_ID}`) {
      return Promise.resolve({ data: rfqPayload() });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderHistory(language: Language): ReturnType<typeof render> {
  const bundle: Bundle = { core: ENTRIES[language], quote_requests: MODULE_ENTRIES[language] };
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language={language} initialBundle={bundle}>
      <>{children}</>
    </TranslationProvider>
  );
  return render(
    <StrictMode>
      <RfqHistory quoteRequestId={RFQ_ID} />
    </StrictMode>,
    { wrapper },
  );
}

beforeEach(() => {
  getSpy.mockReset();
});

describe('RfqDetail — History tab fetch', () => {
  it('asks for /history only when the tab is opened', async () => {
    answerHistory({ entries: [], truncated: false });
    renderRfqDetail(RfqDetail);
    const tab = await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.history/ });
    const historyUrl = `/api/v1/admin/quote-requests/${RFQ_ID}/history`;
    expect(getSpy.mock.calls.map((c) => c[0])).not.toContain(historyUrl);
    fireEvent.click(tab);
    await waitFor(() => expect(getSpy.mock.calls.map((c) => c[0])).toContain(historyUrl));
  });

  it('treats a 404 on the detail as "not found", not as the server sentence (C1)', async () => {
    // An out-of-scope sales representative now gets the unknown-id 404 (Phase 8).
    const { ApiError } = await import('@endora-commerce/admin-kit/lib');
    getSpy.mockRejectedValue(
      new ApiError(404, { error: { code: 'NOT_FOUND', message: 'Quote Request not found.' } }),
    );
    renderRfqDetail(RfqDetail);
    expect(await screen.findByText(/rfq\.detail\.notFound/)).toBeInTheDocument();
    expect(screen.queryByText('Quote Request not found.')).toBeNull();
  });
});

describe.each<Language>(['en', 'pl'])('RfqHistory — %s', (language) => {
  const line = (ref: { productName: string; variantLabel: string | null }): string =>
    ref.variantLabel === null
      ? ref.productName
      : tr(language, 'lineWithVariant', { product: ref.productName, variant: ref.variantLabel });
  const role = (key: string): string => tr(language, `role.${key}`);
  const withDetail = (name: string, detail: string): string =>
    tr(language, 'actor.withDetail', { name, detail });
  const unknownUser = (): string => tr(language, 'actor.unknownUser');

  it('renders a translated title for every entry kind and no raw identifier (FR-010)', async () => {
    answerHistory(FULL);
    const { container } = renderHistory(language);
    await screen.findAllByText(tr(language, 'entry.modified'));
    for (const kind of ENTRY_KINDS) {
      expect(screen.getAllByText(tr(language, `entry.${kind}`)).length, kind).toBeGreaterThan(0);
    }
    const text = container.textContent ?? '';
    for (const kind of [...ENTRY_KINDS, ...CHANGE_KINDS].filter((k) => k.includes('_'))) {
      expect(text, kind).not.toContain(kind);
    }
    expect(container.innerHTML).not.toMatch(/rfq\.detail\.history|core\.rfq/);
  });

  it('says which sales opportunity a carry came from and lists each key not carried with its reason (162, T048)', async () => {
    const longKey = `k${'x'.repeat(70)}`;
    answerHistory({
      truncated: false,
      entries: [
        entry('custom_field_carry_skipped', SYSTEM, {
          customFieldCarry: {
            source: { entityType: 'opportunity', recordId: ORDER_ID, reference: 'OPP-000042' },
            skipped: [
              { key: 'order_source', reason: 'target_missing' },
              { key: 'fair', reason: 'value_type_mismatch' },
              { key: longKey, reason: 'audience_mismatch' },
              { key: XSS, reason: 'value_invalid' },
            ],
          },
        }),
      ],
    });
    const { container } = renderHistory(language);
    await screen.findByText(tr(language, 'entry.custom_field_carry_skipped'));
    expect(screen.getByText(trModule(language, 'history.carrySource', { reference: 'OPP-000042' }))).toBeInTheDocument();
    const reason = (code: string): string => trModule(language, `history.carryReason.${code}`);
    const lines = screen.getAllByRole('listitem').filter((item) => item.tagName === 'LI' && item.closest('ul ul, li ul'));
    expect(lines.map((item) => item.textContent)).toEqual([
      trModule(language, 'history.carryLine', { field: 'order_source', reason: reason('target_missing') }),
      trModule(language, 'history.carryLine', { field: 'fair', reason: reason('value_type_mismatch') }),
      trModule(language, 'history.carryLine', { field: `${longKey.slice(0, 64)}…`, reason: reason('audience_mismatch') }),
      trModule(language, 'history.carryLine', { field: XSS, reason: reason('value_invalid') }),
    ]);
    // A key is text, never markup; no reason reaches the operator as its code.
    expect(container.querySelector('img, script')).toBeNull();
    expect(container.textContent).not.toMatch(/target_missing|value_type_mismatch|audience_mismatch|value_invalid/);
  });

  it('names a skipped field by the label stored with the skip, in the reader\'s language (162, V3, T067)', async () => {
    const longLabel = `L${'y'.repeat(70)}`;
    answerHistory({
      truncated: false,
      entries: [
        entry('custom_field_carry_skipped', SYSTEM, {
          customFieldCarry: {
            source: { entityType: 'opportunity', recordId: ORDER_ID, reference: 'OPP-000043' },
            skipped: [
              { key: 'fair', reason: 'target_missing', label: { labelDefault: 'Trade fair', labels: { en: 'Trade fair', pl: 'Targi' } } },
              // No label in Polish: a Polish reader gets the default label.
              { key: 'region', reason: 'value_type_mismatch', label: { labelDefault: 'Region', labels: { en: 'Sales region' } } },
              // Recorded before labels were stored: the key.
              { key: 'order_source', reason: 'audience_mismatch' },
              { key: 'long_label', reason: 'value_invalid', label: { labelDefault: longLabel, labels: {} } },
              { key: 'markup', reason: 'value_invalid', label: { labelDefault: XSS, labels: {} } },
            ],
          },
        }),
      ],
    });
    const { container } = renderHistory(language);
    await screen.findByText(tr(language, 'entry.custom_field_carry_skipped'));
    const reason = (code: string): string => trModule(language, `history.carryReason.${code}`);
    const line = (field: string, code: string): string => trModule(language, 'history.carryLine', { field, reason: reason(code) });
    const lines = screen.getAllByRole('listitem').filter((item) => item.tagName === 'LI' && item.closest('ul ul, li ul'));
    expect(lines.map((item) => item.textContent)).toEqual([
      line(language === 'pl' ? 'Targi' : 'Trade fair', 'target_missing'),
      line(language === 'pl' ? 'Region' : 'Sales region', 'value_type_mismatch'),
      line('order_source', 'audience_mismatch'),
      line(`${longLabel.slice(0, 64)}…`, 'value_invalid'),
      line(XSS, 'value_invalid'),
    ]);
    // A stored label is text, never markup; no key is shown where a label was stored.
    expect(container.querySelector('img, script')).toBeNull();
    expect(container.textContent).not.toMatch(/long_label|markup/);
  });

  it('words a skip reason it does not know by the generic sentence, never by its code (162)', async () => {
    answerHistory({
      truncated: false,
      entries: [
        entry('custom_field_carry_skipped', SYSTEM, {
          customFieldCarry: {
            source: { entityType: 'opportunity', recordId: ORDER_ID, reference: 'OPP-000044' },
            // A reason a newer server may answer and this screen has no sentence for.
            skipped: [{ key: 'region', reason: 'owner_unreachable' as never, label: { labelDefault: 'Region', labels: {} } }],
          },
        }),
      ],
    });
    const { container } = renderHistory(language);
    await screen.findByText(tr(language, 'entry.custom_field_carry_skipped'));
    expect(
      screen.getByText(trModule(language, 'history.carryLine', { field: 'Region', reason: trModule(language, 'history.carryReasonUnknown') })),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/owner.unreachable/i);
  });

  it('ships a reason sentence for every reason a carry can be skipped by (162)', () => {
    for (const code of customFieldCarrySkipReasonSchema.options) {
      expect(MODULE_ENTRIES[language][`history.carryReason.${code}`], code).toBeTruthy();
    }
  });

  it('prints who a quote PDF was sent to, with which template, language and message, as text (153)', async () => {
    answerHistory(FULL);
    const { container } = renderHistory(language);
    await screen.findAllByText(tr(language, 'entry.pdf_sent'));
    expect(screen.getByText(tr(language, 'pdfSent.recipients', { recipients: 'buyer@example.com, two@example.com' }))).toBeTruthy();
    expect(screen.getByText(tr(language, 'pdfSent.template', { name: 'With discounts' }))).toBeTruthy();
    expect(screen.getByText(tr(language, 'pdfSent.language', { language: 'pl-PL' }))).toBeTruthy();
    expect(screen.getByText(tr(language, 'pdfSent.message', { message: XSS }))).toBeTruthy();
    expect(container.querySelector('script, img')).toBeNull();
  });

  it('lists every change kind as a sentence, variants kept apart (FR-012, FR-015)', async () => {
    answerHistory(FULL);
    renderHistory(language);
    await screen.findAllByText(tr(language, 'entry.modified'));
    const none = tr(language, 'none');
    const expected = [
      tr(language, 'change.header_note', { before: none, after: XSS }),
      tr(language, 'change.line_added', {
        line: line(plain),
        quantity: 3,
        price: `${amount(language, 50)} PLN`,
      }),
      tr(language, 'change.line_quantity', { line: line(blue), before: 10, after: 12 }),
      tr(language, 'change.line_quantity', { line: line(red), before: 4, after: 5 }),
      tr(language, 'change.line_agreed_unit_price', {
        line: line(blue),
        before: amount(language, 110),
        after: amount(language, 105),
        currency: 'PLN',
      }),
      tr(language, 'change.line_proposed_unit_price', {
        line: line(blue),
        before: amount(language, 100),
        after: amount(language, 95),
        currency: 'PLN',
      }),
      tr(language, 'change.line_note', { line: line(blue), before: 'old', after: XSS }),
      tr(language, 'change.line_removed', { line: line(red) }),
      tr(language, 'change.validity', {
        before: dateTime(language, '2026-10-20T10:00:00.000Z'),
        after: dateTime(language, '2026-10-30T10:00:00.000Z'),
      }),
    ];
    for (const sentence of expected) expect(screen.getByText(sentence)).toBeInTheDocument();
    // The two variants of one product are two lines, not one.
    expect(line(blue)).not.toBe(line(red));
  });

  it('reads like the spec in English (US2 #2)', async () => {
    if (language !== 'en') return;
    answerHistory(FULL);
    renderHistory(language);
    expect(await screen.findByText('Widget (colour=Blue): quantity 10 → 12')).toBeInTheDocument();
    expect(screen.getByText('Widget (colour=Blue): agreed price 110.00 → 105.00 PLN')).toBeInTheDocument();
  });

  it('says "set" and "removed" for a validity date with no other side (US2 #4)', async () => {
    answerHistory({
      truncated: false,
      entries: [
        entry('modified', REP, {
          changes: [{ kind: 'validity', before: null, after: '2026-10-30T10:00:00.000Z' }],
        }),
        entry('modified', REP, {
          changes: [{ kind: 'validity', before: '2026-10-30T10:00:00.000Z', after: null }],
        }),
      ],
    });
    renderHistory(language);
    const date = dateTime(language, '2026-10-30T10:00:00.000Z');
    expect(await screen.findByText(tr(language, 'change.validity_set', { after: date }))).toBeInTheDocument();
    expect(screen.getByText(tr(language, 'change.validity_removed', { before: date }))).toBeInTheDocument();
  });

  it('names every actor (FR-017, FR-018; US3 #1–#5)', async () => {
    answerHistory(FULL);
    renderHistory(language);
    await screen.findAllByText(tr(language, 'entry.modified'));
    // Customer: full name + e-mail.
    expect(screen.getAllByText(withDetail('Anna Nowak', 'anna@example.test')).length).toBeGreaterThan(0);
    // Admin: full name + translated role.
    expect(screen.getAllByText(withDetail('Carl Rep', role('salesRepresentative'))).length).toBeGreaterThan(0);
    // A custom role is shown as stored.
    expect(screen.getByText(withDetail('Dana Lead', 'Key account lead'))).toBeInTheDocument();
    // System.
    expect(screen.getAllByText(tr(language, 'actor.system')).length).toBe(3);
    // Unresolvable: recorded role (translated) + "unknown user".
    expect(screen.getByText(withDetail(unknownUser(), role('administrator')))).toBeInTheDocument();
    expect(screen.getByText(withDetail(unknownUser(), role('platformAdministrator')))).toBeInTheDocument();
  });

  it('shows reasons and notes, and "re-sent without changes" for an empty list (FR-013, FR-014)', async () => {
    answerHistory(FULL);
    renderHistory(language);
    await screen.findAllByText(tr(language, 'entry.modified'));
    expect(screen.getByText(tr(language, 'noChanges'))).toBeInTheDocument();
    expect(screen.getByText(tr(language, 'reason', { text: 'Customer withdrew' }))).toBeInTheDocument();
    expect(screen.getByText(tr(language, 'note', { text: 'Call back on Monday' }))).toBeInTheDocument();
    expect(screen.getByText(tr(language, 'revision', { number: 2 }))).toBeInTheDocument();
    expect(screen.getByText(tr(language, 'order', { id: ORDER_ID.slice(0, 8) }))).toBeInTheDocument();
    expect(
      screen.getByText(tr(language, 'relatedRequest', { id: SOURCE_RFQ.slice(0, 8) })),
    ).toBeInTheDocument();
  });

  it('renders the truncation notice only when truncated (T9)', async () => {
    answerHistory(FULL);
    const { unmount } = renderHistory(language);
    const notice = tr(language, 'truncated', { count: QUOTE_REQUEST_HISTORY_EVENT_WINDOW });
    // Review fix N5 — the number is the server's window, interpolated, not a copy.
    expect(ENTRIES[language]['rfq.detail.history.truncated']).toContain('{count}');
    expect(notice).toContain(String(QUOTE_REQUEST_HISTORY_EVENT_WINDOW));
    expect(await screen.findByText(notice)).toBeInTheDocument();
    unmount();
    answerHistory({ ...FULL, truncated: false });
    renderHistory(language);
    await screen.findAllByText(tr(language, 'entry.modified'));
    expect(screen.queryByText(notice)).toBeNull();
  });

  it('feature 159 — lists the grouping changes as sentences; no group reads as Ungrouped (T038)', async () => {
    const group = { id: '00000000-0000-4000-8000-0000000001a1', name: 'Ground floor' };
    answerHistory({
      truncated: false,
      entries: [
        entry('modified', REP, {
          revisionNumber: 5,
          changes: [
            { kind: 'group_added', group },
            { kind: 'group_removed', group: { ...group, name: 'Options' } },
            { kind: 'group_renamed', groupId: group.id, before: 'First floor', after: 'Floor 1' },
            { kind: 'line_group', line: blue, before: null, after: 'Ground floor' },
            { kind: 'line_group', line: plain, before: 'Ground floor', after: null },
            { kind: 'line_order' },
          ],
        }),
      ],
    });
    const { container } = renderHistory(language);
    await screen.findAllByText(tr(language, 'entry.modified'));
    const ungrouped = tr(language, 'ungrouped');
    const expected = [
      tr(language, 'change.group_added', { name: 'Ground floor' }),
      tr(language, 'change.group_removed', { name: 'Options' }),
      tr(language, 'change.group_renamed', { before: 'First floor', after: 'Floor 1' }),
      tr(language, 'change.line_group', { line: line(blue), before: ungrouped, after: 'Ground floor' }),
      tr(language, 'change.line_group', { line: line(plain), before: 'Ground floor', after: ungrouped }),
      tr(language, 'change.line_order'),
    ];
    for (const sentence of expected) expect(screen.getByText(sentence)).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/rfq\.detail\.history|group_added|line_group|line_order/);
  });

  it('feature 159 — a line of a product on several lines is named with its group (N-32)', async () => {
    answerHistory({
      truncated: false,
      entries: [
        entry('modified', REP, {
          revisionNumber: 6,
          changes: [
            { kind: 'line_quantity', line: { ...plain, groupName: 'Hall A' }, before: 5, after: 3 },
            { kind: 'line_removed', line: { ...plain, groupName: null } },
          ],
        }),
      ],
    });
    renderHistory(language);
    await screen.findAllByText(tr(language, 'entry.modified'));
    const inGroup = (group: string): string => tr(language, 'lineInGroup', { line: line(plain), group });
    expect(
      screen.getByText(tr(language, 'change.line_quantity', { line: inGroup('Hall A'), before: 5, after: 3 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(tr(language, 'change.line_removed', { line: inGroup(tr(language, 'ungrouped')) })),
    ).toBeInTheDocument();
  });

  it('lists two changes of one kind on one line, each under its own key (review fix N6)', async () => {
    const line = { productId: SOURCE_RFQ, variantId: null, productName: 'Twin', variantLabel: null };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      answerHistory({
        truncated: false,
        entries: [
          entry('modified', REP, {
            revisionNumber: 4,
            changes: [
              { kind: 'line_removed', line },
              { kind: 'line_removed', line },
            ],
          }),
        ],
      });
      renderHistory(language);
      const sentence = tr(language, 'change.line_removed', { line: 'Twin' });
      expect(await screen.findAllByText(sentence)).toHaveLength(2);
      expect(errors.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
    } finally {
      errors.mockRestore();
    }
  });

  it('renders an empty history as the empty state', async () => {
    answerHistory({ entries: [], truncated: false });
    renderHistory(language);
    expect(await screen.findByText(ENTRIES[language]['rfq.detail.history.empty']!)).toBeInTheDocument();
  });

  it('renders typed markup as literal text, never as HTML (T17)', async () => {
    answerHistory(FULL);
    const { container } = renderHistory(language);
    await screen.findAllByText(tr(language, 'entry.modified'));
    expect(screen.getByText(tr(language, 'note', { text: XSS }))).toBeInTheDocument();
    expect(screen.getByText(tr(language, 'reason', { text: `${XSS} too expensive` }))).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('RfqHistory — failure and source hygiene', () => {
  it('shows the translated error when /history fails, and the screen survives', async () => {
    getSpy.mockRejectedValue(new Error('network down'));
    renderHistory('en');
    expect(await screen.findByText(tr('en', 'error'))).toBeInTheDocument();
  });

  it('offers a retry that asks again (ux-laws: error state has a retry path)', async () => {
    getSpy.mockRejectedValue(new Error('network down'));
    renderHistory('en');
    const retry = await screen.findByRole('button', { name: tr('en', 'retry') });
    answerHistory({ entries: [], truncated: false });
    fireEvent.click(retry);
    expect(await screen.findByText(ENTRIES.en['rfq.detail.history.empty']!)).toBeInTheDocument();
  });

  it('announces loading through a live region mounted before it has text', async () => {
    getSpy.mockReturnValue(new Promise(() => undefined));
    renderHistory('en');
    expect(screen.getByRole('status')).toHaveTextContent(tr('en', 'loading'));
  });

  it('never uses dangerouslySetInnerHTML (T17)', () => {
    expect(readFileSync(HISTORY_SOURCE, 'utf8')).not.toContain('dangerouslySetInnerHTML');
  });
});
