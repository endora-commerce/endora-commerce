import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from '@fastify/type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ERROR_CODES, twoDecimalAmount } from '@endora-commerce/contracts';
import { registerErrorEnvelope } from './error-envelope.js';

/**
 * Owner ruling of 2026-10-24 (issue #417) — a typed amount with more than two
 * decimal places is refused with `400 AMOUNT_PRECISION_EXCEEDED`, one code for
 * every money field, whether the route validates through the type provider or
 * parses its body itself. A request that also fails anything else stays
 * `VALIDATION_FAILED`, with the precision issue listed beside the others.
 */
function buildProbe() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorEnvelope(app);
  const body = z.object({ cost: twoDecimalAmount(z.number().nonnegative()), name: z.string().optional() });
  app.post('/schema', { schema: { body } }, async () => ({ ok: true }));
  app.post('/parse', async (request) => {
    body.parse(request.body);
    return { ok: true };
  });
  return app;
}

describe('the error envelope refuses an amount with more than two places', () => {
  for (const url of ['/schema', '/parse']) {
    it(`answers 400 AMOUNT_PRECISION_EXCEEDED on ${url}`, async () => {
      const res = await buildProbe().inject({ method: 'POST', url, payload: { cost: 1.005 } });
      expect(res.statusCode).toBe(400);
      const { error } = res.json() as { error: { code: string; details: Array<{ path: string; issue: string }> } };
      expect(error.code).toBe(ERROR_CODES.AMOUNT_PRECISION_EXCEEDED);
      expect(error.details).toEqual([{ path: 'cost', issue: ERROR_CODES.AMOUNT_PRECISION_EXCEEDED }]);
    });

    it(`stays VALIDATION_FAILED on ${url} when something else fails too`, async () => {
      const res = await buildProbe().inject({ method: 'POST', url, payload: { cost: 1.005, name: 7 } });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  }
});
