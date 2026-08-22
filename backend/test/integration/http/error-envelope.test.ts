import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupTestServer } from '../../helpers/test-server.js';
import { HttpError } from '../../../src/http/error-envelope.js';

/**
 * Verifies the cross-cutting error envelope hook produces the contractually correct
 * shape for every error class it handles (Principle III — contract gate #3).
 */

describe('error envelope', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await setupTestServer();
    app.get('/_test/zod', {
      schema: {
        querystring: z.object({ age: z.coerce.number().int().positive() }),
      },
      handler: async () => ({ data: { ok: true } }),
    });
    app.get('/_test/httperror', async () => {
      throw new HttpError(409, ERROR_CODES.SKU_ALREADY_EXISTS, 'SKU already exists.');
    });
    app.get('/_test/bare', async () => {
      throw new Error('unexpected');
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns VALIDATION_FAILED with details on Zod failure', async () => {
    const res = await app.inject({ method: 'GET', url: '/_test/zod?age=-1' });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string; details?: unknown; requestId?: string } };
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.details).toBeDefined();
    expect(body.error.requestId).toBeDefined();
    expect(res.headers['x-request-id']).toBe(body.error.requestId);
  });

  it('returns the envelope for an HttpError throw', async () => {
    const res = await app.inject({ method: 'GET', url: '/_test/httperror' });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ERROR_CODES.SKU_ALREADY_EXISTS);
    expect(body.error.message).toBe('SKU already exists.');
  });

  it('returns INTERNAL (500) + envelope on an unhandled throw', async () => {
    const res = await app.inject({ method: 'GET', url: '/_test/bare' });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.INTERNAL);
  });

  it('returns NOT_FOUND + envelope on an unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});
