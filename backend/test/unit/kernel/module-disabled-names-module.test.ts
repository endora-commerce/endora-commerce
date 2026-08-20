import { describe, expect, it } from 'vitest';
import { ERROR_CODES, moduleDisabledDetailsSchema } from '@b2b/contracts';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';

/**
 * Issue #161 — the refusal names the module on the **wire**, not only on the
 * object.
 *
 * `ModuleDisabledError` has always carried `moduleId`, and every consumer of the
 * thrown value could read it. What reaches a human could not: the envelope
 * replaces an operator-visible message with the registered sentence for its
 * *code*, and `MODULE_DISABLED` is one code for every gated port in the
 * platform. So an operator refused a refund because a gateway is switched off
 * read "Module Disabled." and was not told which module to switch back on.
 *
 * `details` is the part of the envelope that survives that replacement — it is
 * what issue #65 keyed its sentence on — so the module id goes there, and the
 * sentence interpolates it. `carts` had already reached the same conclusion for
 * its one hand-written refusal (`{ module: 'shopping_lists' }`,
 * `src/modules/carts/backend.ts`); this makes the platform-wide throw agree with
 * it rather than leaving one site right and every other silent.
 */
describe('ModuleDisabledError', () => {
  it('carries the module id in details, in the shape the contract publishes', () => {
    const error = new ModuleDisabledError('stripe');

    expect(error.details).toEqual({ module: 'stripe' });
    expect(moduleDisabledDetailsSchema.safeParse(error.details).success).toBe(true);
  });

  it('keeps the rest of the refusal exactly as it was', () => {
    // The details are an addition, not a redesign: status, code, `Retry-After`
    // and the written message are what the 503 contract already promised, and
    // the written message is still the fallback when no sentence resolves.
    const error = new ModuleDisabledError('price_lists');

    expect(error.statusCode).toBe(503);
    expect(error.code).toBe(ERROR_CODES.MODULE_DISABLED);
    expect(error.headers).toEqual({ 'Retry-After': '60' });
    expect(error.message).toBe("Module 'price_lists' is currently disabled.");
    expect(error.moduleId).toBe('price_lists');
  });

  it('does not carry a refusal token, so the family sentence is still the one asked for', () => {
    // `details.code` keys `errors.<CODE>.<token>` (issue #65). `MODULE_DISABLED`
    // has one sentence and one variable in it, so a token here would send the
    // lookup at a key nobody writes and land the operator back on the written
    // message.
    const details = new ModuleDisabledError('taxes').details as Record<string, unknown>;

    expect(details['code']).toBeUndefined();
  });
});
