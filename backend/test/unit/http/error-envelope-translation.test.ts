import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError, registerErrorEnvelope } from '../../../src/http/error-envelope.js';

/**
 * The error-translation map is injected, not imported (D-54).
 *
 * `src/http` is a kernel-obeying platform peer: the kernel takes `HttpError`
 * from it as a value, so a peer permitted to import a module is a kernel that
 * imports modules with one extra hop — the package cycle
 * `kernel → http → mod-i18n → kernel`. `ErrorEnvelopeOptions` already injected
 * the two `_i18n` *functions* this plugin uses; the map was the one thing left
 * hard-wired, with no reason recorded anywhere for the asymmetry.
 *
 * These cases pin the behaviour the injection has to preserve, and the absence
 * behaviour that replaces the module import.
 */
const buildProbe = async (
  options: Parameters<typeof registerErrorEnvelope>[1],
): Promise<ReturnType<typeof Fastify>> => {
  const app = Fastify();
  registerErrorEnvelope(app, options);
  app.get('/boom', async () => {
    throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
  });
  app.get('/invalid', async () => {
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'sku_in_use');
  });
  await app.ready();
  return app;
};

const translator = async ({ moduleId, key }: { moduleId: string; key: string }): Promise<string> =>
  `translated:${moduleId}.${key}`;

describe('the error envelope with an injected translation map', () => {
  it('routes a code to the module and key the injected map names', async () => {
    const app = await buildProbe({
      errorTranslationTargets: {
        [ERROR_CODES.PRODUCT_NOT_FOUND]: { moduleId: 'catalog', key: 'errors.PRODUCT_NOT_FOUND' },
      },
      translateErrorMessage: translator,
    });
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.message).toBe('translated:catalog.errors.PRODUCT_NOT_FOUND');
    await app.close();
  });

  it('leaves the message alone when no map is injected — nothing falls back to a module', async () => {
    // The plugin used to reach `_i18n` for this answer whatever the caller
    // passed. Without an injected map it now translates nothing, which is the
    // same behaviour a caller already got by passing no translator at all.
    const app = await buildProbe({ translateErrorMessage: translator });
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.json().error.message).toBe('Product not found.');
    await app.close();
  });

  it('still leaves VALIDATION_FAILED verbatim — its message carries a machine-readable token', async () => {
    const app = await buildProbe({
      errorTranslationTargets: {
        [ERROR_CODES.VALIDATION_FAILED]: { moduleId: 'core', key: 'errors.VALIDATION_FAILED' },
      },
      translateErrorMessage: translator,
    });
    const response = await app.inject({ method: 'GET', url: '/invalid' });
    expect(response.json().error.message).toBe('sku_in_use');
    await app.close();
  });

  it('leaves a code the map does not name alone', async () => {
    const app = await buildProbe({
      errorTranslationTargets: {},
      translateErrorMessage: translator,
    });
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.json().error.message).toBe('Product not found.');
    await app.close();
  });
});
