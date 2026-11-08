import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearQuickOrderPreview,
  readQuickOrderPreview,
  writeQuickOrderPreview,
  type QuickOrderPreview,
} from '../../lib/api/quick-order-preview';

/**
 * Issue #809 — the quick-order preview is kept by the backend (`quick_order`), one per buyer
 * session, behind `GET` / `PUT` / `DELETE /api/v1/quick-order/preview`. The storefront writes no
 * cookie for it; these bindings are the only way it reaches the preview.
 */

const originalFetch = globalThis.fetch;
const calls: Array<{ url: string; method: string; cookie: string | null; body: unknown }> = [];

function answer(status: number, body?: unknown): void {
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      cookie: headers.get('cookie'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const preview: QuickOrderPreview = {
  recognized: [{ line: 1, sku: 'BOLT-1', productId: '00000000-0000-4000-8000-00000000f001', variantId: null, quantity: 4 }],
  rejected: [{ line: 2, raw: 'NOPE,1', reason: 'product_not_found' }],
  summary: { recognizedCount: 1, rejectedCount: 1, mergedCount: 0, truncated: false },
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls.length = 0;
});

describe('quick-order preview bindings (issue #809)', () => {
  it('reads the preview of the buyer session, with no id in the URL', async () => {
    answer(200, { data: preview });
    await expect(readQuickOrderPreview('session-cookie')).resolves.toEqual(preview);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(new URL(calls[0]!.url).pathname).toBe('/api/v1/quick-order/preview');
    expect(new URL(calls[0]!.url).search).toBe('');
    expect(calls[0]!.cookie).toBe('b2b_session=session-cookie');
  });

  it('reads none as null — never written, or expired', async () => {
    answer(200, { data: null });
    await expect(readQuickOrderPreview('session-cookie')).resolves.toBeNull();
  });

  it('writes the preview with PUT and reports it kept', async () => {
    answer(200, { data: preview });
    await expect(writeQuickOrderPreview('session-cookie', preview)).resolves.toBe(true);
    expect(calls[0]!.method).toBe('PUT');
    expect(new URL(calls[0]!.url).pathname).toBe('/api/v1/quick-order/preview');
    expect(calls[0]!.body).toEqual(preview);
  });

  it('reports a preview over the line cap as not kept', async () => {
    answer(422, {
      error: { code: 'VALIDATION_FAILED', message: 'At most 2000 lines.', details: { code: 'too_many_lines', maximum: 2000 } },
    });
    await expect(writeQuickOrderPreview('session-cookie', preview)).resolves.toBe(false);
  });

  it('reports a preview over the size cap as not kept', async () => {
    answer(413, { error: { code: 'VALIDATION_FAILED', message: 'Request body is too large' } });
    await expect(writeQuickOrderPreview('session-cookie', preview)).resolves.toBe(false);
  });

  it('still throws when the backend fails for another reason', async () => {
    answer(500, { error: { code: 'INTERNAL', message: 'boom' } });
    await expect(writeQuickOrderPreview('session-cookie', preview)).rejects.toThrow();
    answer(500, { error: { code: 'INTERNAL', message: 'boom' } });
    await expect(readQuickOrderPreview('session-cookie')).rejects.toThrow();
  });

  it('drops the preview with DELETE', async () => {
    answer(204);
    await clearQuickOrderPreview('session-cookie');
    expect(calls[0]!.method).toBe('DELETE');
    expect(new URL(calls[0]!.url).pathname).toBe('/api/v1/quick-order/preview');
    expect(calls[0]!.cookie).toBe('b2b_session=session-cookie');
  });
});
