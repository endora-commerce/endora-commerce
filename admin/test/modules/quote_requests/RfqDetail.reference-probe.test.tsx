import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  RESOLVE_URL,
  renderRfqDetail,
  rfqPayloadWithLines,
  type ExtraLine,
  type ProbeRequest,
} from './rfq-reference-fixtures';

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

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, CustomFieldValuesPanel: () => null, ProductPicker: () => null };
});

const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function lines(count: number): ExtraLine[] {
  return Array.from({ length: count }, (_, i) => ({
    id: uuid(1000 + i),
    productId: uuid(2000 + i),
    productName: `Line ${i}`,
    quantity: i + 1,
  }));
}

/** The probe calls asked so far, as `{ productId, quantity }`. */
function probes(): Array<{ productId: string; quantity: string | null }> {
  return postSpy.mock.calls
    .filter((c) => c[0] === RESOLVE_URL)
    .map((c) => {
      const line = (c[1] as ProbeRequest).lines[0]!;
      return { productId: line.productId, quantity: String(line.quantity) };
    });
}

function detailCalls(): number {
  return getSpy.mock.calls.filter((c) => String(c[0]).startsWith('/api/v1/admin/quote-requests/')).length;
}

/** The probe answer: a price derived from the product, so each line's cell is recognisable. */
function priceFor(productId: string): { amount: string; currency: string } {
  return { amount: `${Number(productId.slice(-4)) - 2000}.00`, currency: 'PLN' };
}

function probeResponse(body: ProbeRequest): { data: unknown[] } {
  const line = body.lines[0]!;
  return { data: [{ key: line.key, price: { ...priceFor(line.productId), source: 'buyer' }, explanation: { tier: 'buyer', precedenceVersion: 1 } }] };
}

/** Approve and the other writes answer empty; the price explanation answers a price per product. */
function installPost(): void {
  postSpy.mockImplementation((url: string, body: ProbeRequest) =>
    Promise.resolve(url === RESOLVE_URL ? probeResponse(body) : { data: {} }),
  );
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  postSpy.mockResolvedValue({ data: {} });
});

/**
 * Feature 146, review fix round 1 (part B, S4) — the current-price probe of the
 * lines with no stored reference is bounded, survives a refresh that changed
 * nothing, and re-asks only for the line that did change.
 */
describe('RfqDetail current-price probe', () => {
  it('keeps at most four probes in flight, and still answers every line', async () => {
    const payload = rfqPayloadWithLines(lines(10));
    let inFlight = 0;
    let maxInFlight = 0;
    const pending: Array<() => void> = [];
    getSpy.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith('/api/v1/admin/quote-requests/') ? { data: structuredClone(payload) } : { data: {} }),
    );
    postSpy.mockImplementation((url: string, body: ProbeRequest, init?: RequestInit) => {
      if (url !== RESOLVE_URL) return Promise.resolve({ data: {} });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (run: () => void): void => {
          if (settled) return;
          settled = true;
          inFlight -= 1;
          run();
        };
        // As `fetch` does: an aborted request rejects.
        init?.signal?.addEventListener('abort', () =>
          settle(() => reject(new DOMException('Aborted', 'AbortError'))),
        );
        pending.push(() => settle(() => resolve(probeResponse(body))));
      });
    });

    renderRfqDetail(RfqDetail);
    await screen.findByText('Line 0');
    // Drain until every line is priced: each attempt answers the probes that
    // are in flight now, and the limiter starts the next batch on its own
    // schedule. Polling on the rendered outcome rather than counting rounds is
    // what keeps this deterministic under load.
    await waitFor(
      () => {
        for (const resolve of pending.splice(0)) resolve();
        expect(maxInFlight).toBeLessThanOrEqual(4);
        for (let i = 0; i < 10; i += 1) {
          expect(screen.getByText(`${i}.00 PLN`)).toBeInTheDocument();
        }
      },
      { timeout: 5000 },
    );
    expect(pending).toHaveLength(0);
    expect(maxInFlight).toBeGreaterThan(0);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('a refresh with unchanged lines asks nothing again and keeps the prices shown', async () => {
    const payload = rfqPayloadWithLines(lines(2));
    getSpy.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith('/api/v1/admin/quote-requests/') ? { data: structuredClone(payload) } : { data: {} }),
    );
    installPost();

    renderRfqDetail(RfqDetail);
    await waitFor(() => expect(screen.getByText('1.00 PLN')).toBeInTheDocument());
    const before = probes().length;
    const detailsBefore = detailCalls();

    fireEvent.click(screen.getByRole('button', { name: /rfq\.detail\.approve/ }));
    await waitFor(() => expect(detailCalls()).toBe(detailsBefore + 1));
    await screen.findByText('Line 0');
    expect(screen.getByText('0.00 PLN')).toBeInTheDocument();
    expect(screen.getByText('1.00 PLN')).toBeInTheDocument();
    // Let any effect the refresh scheduled run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(probes().length).toBe(before);
  });

  it('a refresh that changed one line re-asks for that line only', async () => {
    const original = lines(2);
    const changed = original.map((line, i) => (i === 1 ? { ...line, quantity: 7 } : line));
    let payload = rfqPayloadWithLines(original);
    getSpy.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith('/api/v1/admin/quote-requests/') ? { data: structuredClone(payload) } : { data: {} }),
    );
    installPost();

    renderRfqDetail(RfqDetail);
    await waitFor(() => expect(screen.getByText('1.00 PLN')).toBeInTheDocument());
    const before = probes().length;

    payload = rfqPayloadWithLines(changed);
    fireEvent.click(screen.getByRole('button', { name: /rfq\.detail\.approve/ }));
    await waitFor(() => expect(probes().length).toBe(before + 1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(probes().slice(before)).toEqual([{ productId: original[1]!.productId, quantity: '7' }]);
    expect(screen.getByText('0.00 PLN')).toBeInTheDocument();
    expect(screen.getByText('1.00 PLN')).toBeInTheDocument();
  });
});
