import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_FEEDBACK_ERROR_CODES,
  ADMIN_FEEDBACK_SETTING_CODES,
  AdminFeedbackRelayPayloadSchema,
  ERROR_CODES,
  type AdminFeedbackRequest,
  type AdminUserRecord,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { AdminFeedbackSender, type AdminFeedbackSenderDeps, type FetchLike } from './feedback-sender.js';

const RELAY = 'https://relay.example.test/api/platform-feedback';
const ADMIN_ID = '0b9d3c55-1f7e-4c55-9a2a-6f0e8c1d2e3f';
const MESSAGE = 'The order list forgets my filters after I open an order.';

function adminRecord(overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return {
    id: ADMIN_ID,
    email: 'ops@shop.example',
    firstName: 'Anna',
    lastName: 'Nowak',
    adminRoleId: null,
    status: 'active',
    twoFactorEnabled: false,
    lastLoginAt: null,
    preferredLanguage: null,
    avatarAssetId: null,
    bio: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    ...overrides,
  };
}

interface Harness {
  readonly sender: AdminFeedbackSender;
  readonly fetch: ReturnType<typeof vi.fn<FetchLike>>;
  readonly warn: ReturnType<typeof vi.fn>;
  readonly settingsGet: ReturnType<typeof vi.fn>;
}

function harness(
  options: {
    relayUrl?: unknown;
    response?: Response | (() => Promise<Response>);
    fetchImpl?: FetchLike;
    admin?: AdminUserRecord | null;
    platformVersion?: string | null;
    apiUrl?: string | null;
    timeoutMs?: number;
  } = {},
): Harness {
  const settingsGet = vi.fn(async (code: string) => {
    if (code !== ADMIN_FEEDBACK_SETTING_CODES.RELAY_URL) throw new Error(`unexpected setting ${code}`);
    return 'relayUrl' in options ? options.relayUrl : RELAY;
  });
  const response = options.response;
  const fetch = vi.fn<FetchLike>(
    options.fetchImpl ??
      (async () => {
        if (typeof response === 'function') return response();
        return response ?? new Response(null, { status: 202 });
      }),
  );
  const warn = vi.fn();
  const deps: AdminFeedbackSenderDeps = {
    settings: { get: settingsGet as unknown as AdminFeedbackSenderDeps['settings']['get'] },
    adminUsers: {
      findById: async () => ('admin' in options ? (options.admin ?? null) : adminRecord()),
    },
    fetch,
    platformVersion: 'platformVersion' in options ? (options.platformVersion ?? null) : '0.107.0',
    apiUrl: () => ('apiUrl' in options ? (options.apiUrl ?? null) : 'https://api.shop.example'),
    logger: { info: vi.fn(), warn, error: vi.fn() },
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
  return { sender: new AdminFeedbackSender(deps), fetch, warn, settingsGet };
}

const REQUEST: AdminFeedbackRequest = {
  message: MESSAGE,
  email: 'anna@shop.example',
  phone: '+48 600 100 200',
  adminUrl: 'https://admin.shop.example',
  language: 'pl',
};

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  }
  throw new Error('expected the send to be refused');
}

describe('AdminFeedbackSender', () => {
  it('posts the relay payload as JSON and resolves on a 2xx answer', async () => {
    const { sender, fetch, settingsGet } = harness();

    await sender.send(REQUEST, { adminUserId: ADMIN_ID });

    // Platform-wide read: the relay address is not per sales channel.
    expect(settingsGet).toHaveBeenCalledWith(ADMIN_FEEDBACK_SETTING_CODES.RELAY_URL, null, expect.anything());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(RELAY);
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('user-agent')).toBe('endora-commerce/0.107.0');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe('manual');

    const payload = AdminFeedbackRelayPayloadSchema.parse(JSON.parse(String(init?.body)));
    expect(payload).toEqual({
      kind: 'admin_feedback',
      message: MESSAGE,
      email: 'anna@shop.example',
      phone: '+48 600 100 200',
      language: 'pl',
      platformVersion: '0.107.0',
      adminUrl: 'https://admin.shop.example',
      apiUrl: 'https://api.shop.example',
      adminName: 'Anna Nowak',
      adminUserId: ADMIN_ID,
    });
  });

  it('sends null for everything the instance or the person did not supply', async () => {
    const { sender, fetch } = harness({ platformVersion: null, apiUrl: null, admin: null });

    await sender.send(
      { message: MESSAGE, email: 'anna@shop.example', phone: '' },
      { adminUserId: ADMIN_ID },
    );

    const [, init] = fetch.mock.calls[0]!;
    const payload = AdminFeedbackRelayPayloadSchema.parse(JSON.parse(String(init?.body)));
    expect(payload).toMatchObject({
      phone: null,
      language: null,
      platformVersion: null,
      adminUrl: null,
      apiUrl: null,
      adminName: null,
      adminUserId: ADMIN_ID,
    });
    // Without a release number the agent still names the product.
    expect(new Headers(init?.headers).get('user-agent')).toBe('endora-commerce');
  });

  it("names the administrator by e-mail when the account has no name", async () => {
    const { sender, fetch } = harness({ admin: adminRecord({ firstName: ' ', lastName: '' }) });

    await sender.send(REQUEST, { adminUserId: ADMIN_ID });

    const payload = JSON.parse(String(fetch.mock.calls[0]![1]?.body)) as { adminName: string };
    expect(payload.adminName).toBe('ops@shop.example');
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
  ])('refuses with 503 NOT_CONFIGURED when the relay address is %s, and calls nobody', async (_, relayUrl) => {
    const { sender, fetch } = harness({ relayUrl });

    const error = await rejection(sender.send(REQUEST, { adminUserId: ADMIN_ID }));

    expect(error.statusCode).toBe(503);
    expect(error.code).toBe(ADMIN_FEEDBACK_ERROR_CODES.NOT_CONFIGURED);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-http scheme', 'ftp://relay.example.test/feedback'],
    ['a file URL', 'file:///etc/passwd'],
    ['not a URL at all', 'relay.example.test/feedback'],
  ])('refuses %s as a misconfiguration, logs it, and calls nobody', async (_, relayUrl) => {
    const { sender, fetch, warn } = harness({ relayUrl });

    const error = await rejection(sender.send(REQUEST, { adminUserId: ADMIN_ID }));

    expect(error.statusCode).toBe(503);
    expect(error.code).toBe(ADMIN_FEEDBACK_ERROR_CODES.NOT_CONFIGURED);
    expect(fetch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('accepts a plain http relay address', async () => {
    const { sender, fetch } = harness({ relayUrl: 'http://relay.internal:8080/feedback' });

    await sender.send(REQUEST, { adminUserId: ADMIN_ID });

    expect(String(fetch.mock.calls[0]![0])).toBe('http://relay.internal:8080/feedback');
  });

  it('answers 429 RATE_LIMITED when the relay does, passing its Retry-After on', async () => {
    const { sender } = harness({
      response: new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }),
    });

    const error = await rejection(sender.send(REQUEST, { adminUserId: ADMIN_ID }));

    expect(error.statusCode).toBe(429);
    expect(error.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(error.headers).toEqual({ 'Retry-After': '120' });
  });

  it('drops a Retry-After that is not a number of seconds', async () => {
    const { sender } = harness({
      response: new Response(null, { status: 429, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } }),
    });

    const error = await rejection(sender.send(REQUEST, { adminUserId: ADMIN_ID }));

    expect(error.statusCode).toBe(429);
    expect(error.headers).toBeUndefined();
  });

  it.each([500, 400, 403, 404, 413, 302])(
    'answers 502 DELIVERY_FAILED on a relay %i, logging the status and never the message',
    async (status) => {
      const { sender, warn } = harness({ response: new Response(null, { status }) });

      const error = await rejection(sender.send(REQUEST, { adminUserId: ADMIN_ID }));

      expect(error.statusCode).toBe(502);
      expect(error.code).toBe(ADMIN_FEEDBACK_ERROR_CODES.DELIVERY_FAILED);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatchObject({ status });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(MESSAGE);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('anna@shop.example');
    },
  );

  it('does not follow a redirect, and logs that the address may need a trailing slash', async () => {
    const { sender, warn } = harness({
      response: new Response(null, { status: 301, headers: { location: `${RELAY}/` } }),
    });

    const error = await rejection(sender.send(REQUEST, { adminUserId: ADMIN_ID }));

    expect(error.statusCode).toBe(502);
    expect(error.code).toBe(ADMIN_FEEDBACK_ERROR_CODES.DELIVERY_FAILED);
    expect(warn.mock.calls[0]![0]).toMatchObject({ status: 301, hint: expect.stringContaining('trailing slash') });
  });

  it('sends every nullable field present, as null, never omitted', async () => {
    const { sender, fetch } = harness({ platformVersion: null, apiUrl: null, admin: null });

    await sender.send({ message: MESSAGE, email: 'anna@shop.example' }, { adminUserId: ADMIN_ID });

    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    for (const key of ['phone', 'language', 'platformVersion', 'adminUrl', 'apiUrl', 'adminName']) {
      expect(body, key).toHaveProperty(key, null);
    }
  });

  it('answers 502 DELIVERY_FAILED when the relay cannot be reached', async () => {
    const { sender, warn } = harness({
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });

    const error = await rejection(sender.send(REQUEST, { adminUserId: ADMIN_ID }));

    expect(error.statusCode).toBe(502);
    expect(error.code).toBe(ADMIN_FEEDBACK_ERROR_CODES.DELIVERY_FAILED);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(MESSAGE);
  });

  it('answers 502 DELIVERY_FAILED when the relay does not answer in time', async () => {
    const { sender, warn } = harness({
      timeoutMs: 5,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });

    const error = await rejection(sender.send(REQUEST, { adminUserId: ADMIN_ID }));

    expect(error.statusCode).toBe(502);
    expect(error.code).toBe(ADMIN_FEEDBACK_ERROR_CODES.DELIVERY_FAILED);
    expect(warn.mock.calls[0]![0]).toMatchObject({ reason: 'timeout' });
  });
});
