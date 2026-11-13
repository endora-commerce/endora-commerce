import { StrictMode, type ReactElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  quoteRequestDeliveryChannelSchema,
  quoteRequestDeliveryStatusSchema,
  type QuoteRequestDelivery,
  type QuoteRequestHistory,
  type QuoteRequestHistoryEntry,
} from '@endora-commerce/contracts';
import { TranslationProvider, type Bundle } from '@endora-commerce/admin-kit/i18n';

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

const { RfqHistory } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqHistory');

/**
 * `specs/179-rfq-and-customer-notifications/` WP-06, T051 (US5; FR-070;
 * contract `delivery-and-ports.md` §4) — under a History entry that notified
 * anybody, the admin lists each delivery: who, a channel label, a status label,
 * and for a failed one the last error behind a disclosure.
 *
 * The bundle is `_i18n`'s shipped one, both languages, so a missing key fails
 * rather than rendering as itself.
 */

const REPO_ROOT = resolve(process.cwd(), '..');
type Language = 'en' | 'pl';

function coreEntries(language: Language): Record<string, string> {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages/modules/_i18n/i18n', `${language}.json`), 'utf8'),
  ) as Record<string, string>;
}
const ENTRIES: Record<Language, Record<string, string>> = { en: coreEntries('en'), pl: coreEntries('pl') };

function tr(language: Language, key: string, params: Record<string, string | number> = {}): string {
  const template = ENTRIES[language][`rfq.detail.history.${key}`];
  if (template === undefined) throw new Error(`missing ${language} key rfq.detail.history.${key}`);
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name]));
}

const RFQ_ID = '00000000-0000-4000-8000-0000000000f1';
const SUBMITTED = '00000000-0000-4000-8000-000000000001';
const NOTE = '00000000-0000-4000-8000-000000000002';
const XSS = '<img src=x onerror=alert(1)>';

let seq = 0;
function delivery(extra: Partial<QuoteRequestDelivery> = {}): QuoteRequestDelivery {
  seq += 1;
  return {
    id: `d0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    channel: 'customer_email',
    recipient: { kind: 'customer', id: `c0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, displayName: 'Anna Nowak' },
    status: 'sent',
    attempts: 1,
    lastError: null,
    closedAt: '2026-11-12T10:00:00.000Z',
    ...extra,
  };
}

function entry(id: string, kind: QuoteRequestHistoryEntry['kind'], extra: Partial<QuoteRequestHistoryEntry> = {}): QuoteRequestHistoryEntry {
  return {
    id,
    eventIds: [id],
    kind,
    occurredAt: '2026-11-12T09:00:00.000Z',
    actor: { kind: 'system' },
    revisionNumber: null,
    note: null,
    reason: null,
    changes: null,
    relatedQuoteRequestId: null,
    orderId: null,
    ...extra,
  };
}

function answer(history: QuoteRequestHistory): void {
  getSpy.mockImplementation((url: string) =>
    url === `/api/v1/admin/quote-requests/${RFQ_ID}/history`
      ? Promise.resolve({ data: history })
      : Promise.reject(new Error(`unexpected GET ${url}`)),
  );
}

function renderHistory(language: Language): ReturnType<typeof render> {
  const bundle: Bundle = { core: ENTRIES[language], quote_requests: {} };
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
  seq = 0;
});

describe.each<Language>(['en', 'pl'])('RfqHistory — deliveries (%s)', (language) => {
  it('lists each delivery under its entry with recipient, channel and status labels', async () => {
    const sent = delivery();
    const bell = delivery({
      channel: 'admin_in_app',
      recipient: { kind: 'admin', id: 'b0000000-0000-4000-8000-000000000001', displayName: 'Carl Rep' },
      status: 'skipped_module_off',
    });
    const pending = delivery({ channel: 'admin_email', recipient: { ...bell.recipient }, status: 'pending', attempts: 0, closedAt: null });
    answer({
      truncated: false,
      entries: [entry(SUBMITTED, 'submitted', { deliveries: [sent, bell, pending] }), entry(NOTE, 'note_added', { note: 'x' })],
    });
    const { container } = renderHistory(language);
    const list = await screen.findByRole('list', { name: tr(language, 'delivery.title') });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    const customer = tr(language, 'actor.withDetail', { name: 'Anna Nowak', detail: tr(language, 'delivery.recipient.customer') });
    const operator = tr(language, 'actor.withDetail', { name: 'Carl Rep', detail: tr(language, 'delivery.recipient.admin') });
    expect(within(rows[0]!).getByText(customer)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(tr(language, 'delivery.channel.customer_email'))).toBeInTheDocument();
    expect(within(rows[0]!).getByText(tr(language, 'delivery.status.sent'))).toBeInTheDocument();
    expect(within(rows[1]!).getByText(operator)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(tr(language, 'delivery.channel.admin_in_app'))).toBeInTheDocument();
    expect(within(rows[1]!).getByText(tr(language, 'delivery.status.skipped_module_off'))).toBeInTheDocument();
    expect(within(rows[2]!).getByText(tr(language, 'delivery.status.pending'))).toBeInTheDocument();

    // One list only: the entry that notified nobody shows none.
    expect(screen.getAllByRole('list', { name: tr(language, 'delivery.title') })).toHaveLength(1);
    // No code reaches the operator; no disclosure without a failure.
    expect(container.textContent).not.toMatch(/customer_email|admin_in_app|skipped_module_off|pending\b/);
    expect(container.querySelector('details')).toBeNull();
  });

  it('shows a failed delivery as Failed, with its attempts and the last error behind a disclosure', async () => {
    const failed = delivery({ status: 'failed', attempts: 5, lastError: `SMTP 554 ${XSS}` });
    answer({ truncated: false, entries: [entry(SUBMITTED, 'submitted', { deliveries: [failed] })] });
    const { container } = renderHistory(language);
    const list = await screen.findByRole('list', { name: tr(language, 'delivery.title') });
    const [row] = within(list).getAllByRole('listitem');
    expect(within(row!).getByText(tr(language, 'delivery.status.failed'))).toBeInTheDocument();
    expect(within(row!).getByText(tr(language, 'delivery.attempts', { count: 5 }))).toBeInTheDocument();

    const details = row!.querySelector('details');
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    const summary = within(row!).getByText(tr(language, 'delivery.showError'));
    expect(summary.tagName).toBe('SUMMARY');
    fireEvent.click(summary);
    // The error is text, never markup.
    expect(within(details!).getByText(`SMTP 554 ${XSS}`)).toBeInTheDocument();
    expect(container.querySelector('img, script')).toBeNull();
  });

  it('says so when a failure recorded no error message', async () => {
    answer({ truncated: false, entries: [entry(SUBMITTED, 'submitted', { deliveries: [delivery({ status: 'failed', attempts: 5 })] })] });
    renderHistory(language);
    await screen.findByRole('list', { name: tr(language, 'delivery.title') });
    expect(screen.getByText(tr(language, 'delivery.noError'))).toBeInTheDocument();
  });

  it("names a recipient who is gone 'unknown user'", async () => {
    answer({
      truncated: false,
      entries: [entry(SUBMITTED, 'submitted', { deliveries: [delivery({ recipient: { kind: 'customer', id: 'c0000000-0000-4000-8000-0000000000ff', displayName: '' } })] })],
    });
    renderHistory(language);
    await screen.findByRole('list', { name: tr(language, 'delivery.title') });
    expect(
      screen.getByText(
        tr(language, 'actor.withDetail', { name: tr(language, 'actor.unknownUser'), detail: tr(language, 'delivery.recipient.customer') }),
      ),
    ).toBeInTheDocument();
  });

  it('has a label for every channel and every status', () => {
    for (const channel of quoteRequestDeliveryChannelSchema.options) expect(tr(language, `delivery.channel.${channel}`)).toBeTruthy();
    for (const status of quoteRequestDeliveryStatusSchema.options) expect(tr(language, `delivery.status.${status}`)).toBeTruthy();
  });
});
