import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetDetail } from '@endora-commerce/contracts';

/**
 * Issue #354 — the kit's multipart upload goes through the same 401 trap as
 * every other kit request: a `401` notifies the `onUnauthorized` listeners
 * (what sends an operator whose session expired back to the sign-in screen)
 * and surfaces as an `ApiError`, so a caller can tell it from any other
 * failure. It used to post with a bare `fetch` and throw a plain `Error`.
 *
 * Both halves are imported from the published subpaths, the ones a module's
 * admin code and the shell resolve, so the listener set is the one the
 * components' requests notify.
 */

const { uploadAsset } = await import('@endora-commerce/admin-kit/components');
const { ApiError, apiClient, onUnauthorized } = await import('@endora-commerce/admin-kit/lib');

const DETAIL = { id: 'a-1', filename: 'logo.png' } as unknown as AssetDetail;

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const EXPIRED = { error: { code: 'UNAUTHORIZED', message: 'Session expired.' } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadAsset — the 401 trap (#354)', () => {
  it('notifies the unauthorized listeners on a 401 and rejects with an ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(401, EXPIRED)));
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    try {
      const failure = await uploadAsset(new File(['x'], 'logo.png', { type: 'image/png' })).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as InstanceType<typeof ApiError>).status).toBe(401);
      expect((failure as InstanceType<typeof ApiError>).envelope).toEqual(EXPIRED);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('answers a 401 exactly as a JSON request through the kit client does', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(401, EXPIRED)));
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    try {
      await expect(apiClient.get('/api/v1/admin/assets')).rejects.toBeInstanceOf(ApiError);
      await expect(uploadAsset(new File(['x'], 'logo.png'))).rejects.toBeInstanceOf(ApiError);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it('does not notify the listeners on another failure, which is still an ApiError', async () => {
    const tooLarge = { error: { code: 'ASSET_TOO_LARGE', message: 'The file is too large.' } };
    vi.stubGlobal('fetch', vi.fn(async () => respond(413, tooLarge)));
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    try {
      const failure = await uploadAsset(new File(['x'], 'big.png')).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as InstanceType<typeof ApiError>).status).toBe(413);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it('still posts the fields before the file, as multipart with cookies, and answers the asset', async () => {
    const fetchSpy = vi.fn(async () => respond(201, { data: DETAIL }));
    vi.stubGlobal('fetch', fetchSpy);
    const file = new File(['x'], 'logo.png', { type: 'image/png' });

    await expect(
      uploadAsset(file, { visibility: 'private', folderId: 'f-1', label: 'Logo' }),
    ).resolves.toEqual(DETAIL);

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith('/api/v1/admin/assets')).toBe(true);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    // The browser writes the multipart boundary; a JSON content type would break it.
    expect(new Headers(init.headers).has('content-type')).toBe(false);
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()]).toEqual(['visibility', 'folderId', 'label', 'file']);
  });
});
