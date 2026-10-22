import { createElement, StrictMode, type ReactNode } from 'react';
import type { Mock } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '@testing-library/react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { TranslationProvider } from '../../../../packages/admin-shell/src/i18n/TranslationProvider';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import type { Bundle } from '../../../../packages/admin-shell/src/i18n/types';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 146, Phase 7 — the shared rig of the two reference-price screen tests
 * (`RfqDetail.reference.test.tsx`, `RfqDetail.modify-payload.test.tsx`). Each
 * test file mocks `apiClient` itself (a `vi.mock` is hoisted per file) and
 * hands its spies to `renderRfqDetail`.
 */

export const RFQ_ID = '00000000-0000-4000-8000-0000000000f1';
export const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
export const CHANNEL_ID = '00000000-0000-4000-8000-0000000000d1';
export const PRODUCT_ID = '00000000-0000-4000-8000-0000000000e1';
export const VARIANT_ID = '00000000-0000-4000-8000-0000000000e2';
export const ITEM_ID = '00000000-0000-4000-8000-0000000000e3';

export const BUNDLE = passthroughBundle('core', [
  'rfq.list.title',
  'rfq.detail.title',
  'rfq.detail.tabs.overview',
  'rfq.detail.tabs.modify',
  'rfq.detail.tabs.history',
  'rfq.detail.column.product',
  'rfq.detail.column.qty',
  'rfq.detail.column.agreed',
  'rfq.detail.column.lineTotal',
  'rfq.detail.reference.column.reference',
  'rfq.detail.reference.column.proposed',
  'rfq.detail.reference.column.difference',
  'rfq.detail.reference.atRequest',
  'rfq.detail.reference.current',
  'rfq.detail.reference.none',
  'rfq.detail.reference.perBaseUnit',
  'rfq.detail.modify.saveRevision',
  'rfq.detail.modify.agreedUnitPrice',
  'rfq.detail.approve',
  'rfq.detail.modify.addLine',
  'rfq.detail.modify.lineGroup',
]);

export interface ItemOverrides {
  referencePrice?: { amount: number; currency: string; capturedAt: string } | null;
  customerProposedUnitPrice?: number | null;
  desiredUnitPrice?: number | null;
  agreedUnitPrice?: number | null;
  variantId?: string | null;
  lineNote?: string | null;
  packagingUnitName?: string | null;
}

export function rfqPayload(item: ItemOverrides = {}): Record<string, unknown> {
  const proposal = item.customerProposedUnitPrice === undefined ? 100 : item.customerProposedUnitPrice;
  return {
    id: RFQ_ID,
    businessId: 'RFQ-0146',
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    customerAccountId: CUSTOMER_ID,
    salesChannelId: CHANNEL_ID,
    organization: null,
    customer: null,
    createdByAdminUserId: null,
    assignedAdminUserId: null,
    status: 'Pending',
    awaitingCustomerRevisionAcceptance: false,
    currentRevisionNumber: 1,
    headerNote: null,
    cancellationReason: null,
    customFieldValues: {},
    items: [
      {
        id: ITEM_ID,
        productId: PRODUCT_ID,
        productName: 'Widget',
        productSlug: 'widget',
        variantId: item.variantId === undefined ? VARIANT_ID : item.variantId,
        variantLabel: 'Blue',
        quantity: 2,
        desiredUnitPrice: item.desiredUnitPrice === undefined ? proposal : item.desiredUnitPrice,
        agreedUnitPrice: item.agreedUnitPrice === undefined ? null : item.agreedUnitPrice,
        lineNote: item.lineNote === undefined ? 'Deliver in May' : item.lineNote,
        lineCurrency: 'PLN',
        discountPercent: null,
        referencePrice:
          item.referencePrice === undefined
            ? { amount: 120, currency: 'PLN', capturedAt: '2026-10-01T10:00:00.000Z' }
            : item.referencePrice,
        customerProposedUnitPrice: proposal,
        packagingUnitName: item.packagingUnitName ?? null,
        packagingUnitBaseQuantity: item.packagingUnitName ? 10 : null,
      },
    ],
    events: [],
    submittedAt: '2026-10-01T10:00:00.000Z',
    approvedAt: null,
    canceledAt: null,
    completedAt: null,
    expiredAt: null,
    expiresAt: null,
    convertedOrderId: null,
    taxRate: 0,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    version: 3,
  };
}

/** One extra line of a multi-line payload (`rfqPayloadWithLines`). */
export interface ExtraLine {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  referencePrice?: { amount: number; currency: string; capturedAt: string } | null;
}

/** The fixture request carrying the given lines instead of its one `Widget` line. */
export function rfqPayloadWithLines(lines: ExtraLine[]): Record<string, unknown> {
  const base = rfqPayload({ referencePrice: null });
  const [template] = base['items'] as Array<Record<string, unknown>>;
  return {
    ...base,
    items: lines.map((line) => ({
      ...template,
      id: line.id,
      productId: line.productId,
      productName: line.productName,
      variantId: null,
      variantLabel: null,
      quantity: line.quantity,
      referencePrice: line.referencePrice ?? null,
    })),
  };
}

/** What the current-price probe answers in a case. */
export type ProbeAnswer = { amount: string; currency: string } | null | 'reject';

export const PROBE_FAILURES: Array<[string, () => unknown]> = [
  ['403', () => new ApiError(403, { error: { code: 'FORBIDDEN', message: 'Forbidden.' } })],
  ['404', () => new ApiError(404, { error: { code: 'NOT_FOUND', message: 'Not found.' } })],
  ['400', () => new ApiError(400, { error: { code: 'VALIDATION_FAILED', message: 'Bad.' } })],
  ['500', () => new ApiError(500, { error: { code: 'INTERNAL', message: 'Boom.' } })],
  ['network', () => new Error('network down')],
];

/** The price explanation the reference probe posts to (feature 160; it was a per-product GET). */
export const RESOLVE_URL = '/api/v1/admin/price-books/resolve';

export function installGet(
  getSpy: Mock,
  item: ItemOverrides,
  probe: ProbeAnswer | (() => unknown),
  postSpy?: Mock,
): void {
  getSpy.mockImplementation((url: string) => {
    if (url.startsWith('/api/v1/admin/quote-requests/')) {
      return Promise.resolve({ data: rfqPayload(item) });
    }
    return Promise.resolve({ data: {} });
  });
  postSpy?.mockImplementation((url: string, body?: { lines?: Array<{ key: string }> }) => {
    if (url === RESOLVE_URL) {
      if (typeof probe === 'function') return Promise.reject(probe());
      if (probe === 'reject') return Promise.reject(new Error('unexpected'));
      return Promise.resolve({
        data: (body?.lines ?? [{ key: 'line' }]).map((line) => ({
          key: line.key,
          price: probe ? { ...probe, source: 'buyer' } : null,
          explanation: { tier: probe ? 'buyer' : null, precedenceVersion: 1 },
        })),
      });
    }
    return Promise.resolve({ data: {} });
  });
}

export function renderRfqDetail(
  detailScreen: () => ReactNode,
  language: 'en' | 'pl' = 'en',
  bundle: Bundle = BUNDLE,
): ReturnType<typeof render> {
  const ui = (
    <StrictMode>
      {withSession(
        <MemoryRouter initialEntries={[`/quote-requests/${RFQ_ID}`]}>
          <Routes>
            <Route path="/quote-requests/:id" element={createElement(detailScreen)} />
          </Routes>
        </MemoryRouter>,
        {
          // FR-031: `rfqs:handle` only — the probe's `price_lists:read` is
          // advisory, and a refused probe is one of the cases below.
          session: adminSession({ permissions: ['rfqs:handle'] }),
          presence: modulePresence({ present: ['quote_requests'] }),
          contributions: [],
        },
      )}
    </StrictMode>
  );
  if (language === 'en') return renderWithI18n(ui, bundle);
  return render(
    <TranslationProvider language={language} initialBundle={bundle}>
      {ui}
    </TranslationProvider>,
  );
}

/** The probe requests the screen sent: the bodies posted to the price explanation. */
export interface ProbeRequest {
  salesChannelId?: string;
  buyer: { organizationId?: string; customerAccountId?: string };
  lines: Array<{ key: string; productId: string; variantId?: string; quantity: number }>;
}

export function probeCalls(postSpy: Mock): ProbeRequest[] {
  return postSpy.mock.calls.filter((c) => c[0] === RESOLVE_URL).map((c) => c[1] as ProbeRequest);
}
