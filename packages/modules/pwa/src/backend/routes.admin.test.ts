import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import {
  PWA_ICON_MAX_BYTES,
  registerPwaAdminRoutes,
  type PwaAdminRoutesDeps,
} from './routes.admin.js';
import { PwaIconInvalid } from './services/pwa-icon-service.js';

/**
 * `POST /api/v1/admin/pwa/icon` — the route's HTTP door.
 *
 * Its handler accepts `multipart/form-data` and nothing else, so it can answer
 * a request only if a multipart parser is registered where the route lives.
 * These cases post a **real** multipart body through Fastify, on an instance
 * that registers nothing but this module's admin routes: whatever parser the
 * route needs, it has to bring itself.
 */
const allowEveryone: RequireAdminFactory = (() => async () => undefined) as RequireAdminFactory;

interface Ingested {
  salesChannelId: string | null;
  declaredMime: string;
  buffer: Buffer;
}

function multipartBody(
  bytes: Buffer,
  part: { field?: string; filename?: string; mime?: string } = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----pwa-icon-test-boundary';
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${part.field ?? 'file'}"; filename="${part.filename ?? 'icon.png'}"\r\n` +
    `Content-Type: ${part.mime ?? 'image/png'}\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function appWith(
  ingest: (input: Ingested) => Promise<{ sourceAssetId: string; renditions: unknown[] }>,
  writes: Array<{ code: string; value: unknown; channels: string[] | null }> = [],
): Promise<FastifyInstance> {
  const app = Fastify();
  await registerPwaAdminRoutes(app, {
    requireAdmin: allowEveryone,
    iconService: { ingest },
    settingsWrite: {
      setValueForAllChannels: async (code: string, value: unknown) => {
        writes.push({ code, value, channels: null });
      },
      setValueForSubset: async (code: string, channels: string[], value: unknown) => {
        writes.push({ code, value, channels });
      },
      resetValues: async () => undefined,
    },
    channelCodeForId: async () => null,
    resolveAuditContext: () => ({ actorAdminUserId: 'admin-1' }),
  } as unknown as PwaAdminRoutesDeps);
  return app;
}

describe('POST /api/v1/admin/pwa/icon — a multipart upload [unit]', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('reads the uploaded file and hands it to the icon pipeline → 201', async () => {
    const seen: Ingested[] = [];
    const writes: Array<{ code: string; value: unknown; channels: string[] | null }> = [];
    app = await appWith(async (input) => {
      seen.push(input);
      return { sourceAssetId: 'asset-1', renditions: [] };
    }, writes);

    const bytes = Buffer.from('not-really-a-png-but-the-parser-does-not-care');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/pwa/icon',
      ...multipartBody(bytes),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ sourceAssetId: 'asset-1', renditions: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.declaredMime).toBe('image/png');
    expect(seen[0]?.salesChannelId).toBeNull();
    expect(seen[0]?.buffer.equals(bytes)).toBe(true);
    expect(writes).toEqual([{ code: 'pwa.icon_asset_id', value: 'asset-1', channels: null }]);
  });

  it('answers the pipeline\'s own refusal as 400 PWA_ICON_INVALID', async () => {
    app = await appWith(async () => {
      throw new PwaIconInvalid('The icon must be square.');
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/pwa/icon',
      ...multipartBody(Buffer.from('x')),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({
      code: 'PWA_ICON_INVALID',
      message: 'The icon must be square.',
    });
  });

  it('refuses a file over the cap as 400 PWA_ICON_INVALID, without running the pipeline', async () => {
    let ran = false;
    app = await appWith(async () => {
      ran = true;
      return { sourceAssetId: 'asset-1', renditions: [] };
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/pwa/icon',
      ...multipartBody(Buffer.alloc(PWA_ICON_MAX_BYTES + 1)),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PWA_ICON_INVALID');
    expect(ran).toBe(false);
  });

  it('refuses a body that is not multipart as 400 PWA_ICON_INVALID', async () => {
    app = await appWith(async () => ({ sourceAssetId: 'asset-1', renditions: [] }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/pwa/icon',
      payload: { file: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PWA_ICON_INVALID');
  });

  it('keeps the multipart parser to the upload route', async () => {
    // The parser is registered in the icon route's own context. A sibling route
    // of this module must go on refusing a multipart body rather than quietly
    // acquiring a parser it never asked for.
    app = await appWith(async () => ({ sourceAssetId: 'asset-1', renditions: [] }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/pwa/vapid/generate',
      ...multipartBody(Buffer.from('x')),
    });
    expect(res.statusCode).toBe(415);
  });
});
