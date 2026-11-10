import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from '@fastify/type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ERROR_CODES, LINE_QUANTITY_MAX, lineQuantitySchema, twoDecimalAmount } from '@endora-commerce/contracts';
import { registerErrorEnvelope } from './error-envelope.js';

/**
 * Issue #351, architect ruling R1 — a line quantity past `LINE_QUANTITY_MAX`
 * is refused with `400 LINE_QUANTITY_EXCEEDED`, a code the envelope
 * translates, whether the route validates through the type provider or parses
 * its body itself. A request that also fails anything else stays
 * `VALIDATION_FAILED`, with the issue listed beside the others — the rule the
 * precision codes follow.
 */
function buildProbe() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorEnvelope(app);
  const body = z.object({
    quantity: lineQuantitySchema.optional(),
    cost: twoDecimalAmount(z.number().nonnegative()).optional(),
    name: z.string().optional(),
  });
  app.post('/schema', { schema: { body } }, async () => ({ ok: true }));
  app.post('/parse', async (request) => {
    body.parse(request.body);
    return { ok: true };
  });
  return app;
}

describe('the error envelope refuses a line quantity past the bound', () => {
  for (const url of ['/schema', '/parse']) {
    it(`accepts the bound on ${url}`, async () => {
      const res = await buildProbe().inject({ method: 'POST', url, payload: { quantity: LINE_QUANTITY_MAX } });
      expect(res.statusCode).toBe(200);
    });

    it(`answers 400 LINE_QUANTITY_EXCEEDED on ${url}`, async () => {
      const res = await buildProbe().inject({ method: 'POST', url, payload: { quantity: LINE_QUANTITY_MAX + 1 } });
      expect(res.statusCode).toBe(400);
      const { error } = res.json() as { error: { code: string; message: string; details: unknown } };
      expect(error.code).toBe(ERROR_CODES.LINE_QUANTITY_EXCEEDED);
      expect(error.message).toBe('A line quantity may be at most 1,000,000.');
      expect(error.details).toEqual([{ path: 'quantity', issue: ERROR_CODES.LINE_QUANTITY_EXCEEDED }]);
    });

    it(`stays VALIDATION_FAILED on ${url} when something else fails too`, async () => {
      for (const payload of [
        { quantity: LINE_QUANTITY_MAX + 1, name: 7 },
        { quantity: LINE_QUANTITY_MAX + 1, cost: 1.005 },
      ]) {
        const res = await buildProbe().inject({ method: 'POST', url, payload });
        expect(res.statusCode).toBe(400);
        expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });

    it(`keeps a quantity below 1 VALIDATION_FAILED on ${url}`, async () => {
      const res = await buildProbe().inject({ method: 'POST', url, payload: { quantity: 0 } });
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  }
});
