import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `storefront/lib/api/customer-notifications.ts` — `getCustomerNotification`,
 * the read of one entry by id (`GET /api/v1/storefront/notifications/:id`,
 * `specs/179-rfq-and-customer-notifications/` T086,
 * `contracts/customer-notifications-storefront-api.md` §1).
 *
 * It forwards the session cookie, the channel and the language like the list,
 * answers the entry, and throws the API's refusal (`404 NOT_FOUND` for an id
 * the list would not show) so the open route can land on the page.
 */

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

const fetchMock = vi.fn();
const ID = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('BACKEND_BASE_URL', 'http://backend.test');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ENTRY = {
  id: ID,
  kind: 'quote_requests.approved',
  title: 'Approved',
  body: null,
  subject: null,
  linkPath: '/quote-requests/abc',
  createdAt: '2026-11-13T10:00:00.000Z',
  readAt: null,
};

describe('getCustomerNotification', () => {
  it('reads one entry by id with the session, the channel and the language', async () => {
    fetchMock.mockResolvedValue(answer(200, { data: ENTRY }));
    const { getCustomerNotification } = await import('../../lib/api/customer-notifications');

    await expect(getCustomerNotification('sess', { salesChannelCode: 'retail', locale: 'pl-PL' }, ID)).resolves.toEqual(ENTRY);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://backend.test/api/v1/storefront/notifications/${ID}`);
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Cookie']).toBe('b2b_session=sess');
    expect(headers['X-Sales-Channel'] ?? headers['x-sales-channel']).toBe('retail');
    expect(headers['Accept-Language']).toBe('pl-PL');
  });

  it('encodes the id into the path', async () => {
    fetchMock.mockResolvedValue(answer(200, { data: ENTRY }));
    const { getCustomerNotification } = await import('../../lib/api/customer-notifications');
    await getCustomerNotification('sess', undefined, 'a/b?c');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://backend.test/api/v1/storefront/notifications/a%2Fb%3Fc');
  });

  it('throws the 404 for an id the list would not show', async () => {
    fetchMock.mockResolvedValue(answer(404, { error: { code: 'NOT_FOUND', message: 'Notification not found' } }));
    const { getCustomerNotification } = await import('../../lib/api/customer-notifications');
    const { StorefrontApiError } = await import('../../lib/api/client');

    const failure = await getCustomerNotification('sess', undefined, ID).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(StorefrontApiError);
    expect((failure as InstanceType<typeof StorefrontApiError>).status).toBe(404);
  });
});
