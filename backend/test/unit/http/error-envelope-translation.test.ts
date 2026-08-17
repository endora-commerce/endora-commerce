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
  app.get('/suspended', async () => {
    throw new HttpError(
      423,
      ERROR_CODES.FORBIDDEN,
      'Your Organization cannot transact in its current status.',
      { code: 'organization_cannot_transact', status: 'blocked' },
    );
  });
  app.get('/zod-shaped', async () => {
    throw new HttpError(400, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.', [
      { path: 'productId', issue: 'unknown' },
    ]);
  });
  await app.ready();
  return app;
};

const translator = async ({ moduleId, key }: { moduleId: string; key: string }): Promise<string> =>
  `translated:${moduleId}.${key}`;

/**
 * What both composition roots inject: a bundle lookup that answers the written
 * message when the key it was asked for has no sentence. Reproduced here
 * because the fallback is half of the refusal-token contract below — the other
 * half is the envelope asking for the token's key in the first place.
 */
const bundleTranslator =
  (bundle: Record<string, string>) =>
  async ({ key, originalMessage }: { key: string; originalMessage: string }): Promise<string> =>
    bundle[key] ?? originalMessage;

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

/**
 * Issue #65 — a refusal token in `details.code` keys the sentence.
 *
 * `FORBIDDEN` is shared by every permission failure in the tree, so its bundle
 * sentence is "You do not have permission to perform this action." A buyer
 * whose Organization was blocked for a business reason was shown exactly that,
 * because the hook replaced the route's written, specific message with the
 * family sentence — the refusal is about the Organization's status, and the
 * buyer contacts support about access instead.
 *
 * The token is the same discriminator the contract already publishes
 * (`details.code = 'organization_cannot_transact'`, feature 062 / issue #63),
 * so the envelope keys the lookup on it: `errors.<CODE>.<token>` when there is
 * one, `errors.<CODE>` when there is not. It is the same phenomenon
 * `VALIDATION_FAILED` is excepted for above — a specific token means the
 * family sentence is the wrong sentence — differing only in where the token is
 * written down.
 */
describe('the error envelope with a refusal token in details.code', () => {
  const forbidden = { [ERROR_CODES.FORBIDDEN]: { moduleId: 'core', key: 'errors.FORBIDDEN' } };

  it('asks for the token key rather than the family key', async () => {
    const app = await buildProbe({
      errorTranslationTargets: forbidden,
      translateErrorMessage: translator,
    });
    const response = await app.inject({ method: 'GET', url: '/suspended' });
    expect(response.statusCode).toBe(423);
    expect(response.json().error.message).toBe(
      'translated:core.errors.FORBIDDEN.organization_cannot_transact',
    );
    await app.close();
  });

  it('renders the token sentence when the bundle has one', async () => {
    const app = await buildProbe({
      errorTranslationTargets: forbidden,
      translateErrorMessage: bundleTranslator({
        'errors.FORBIDDEN': 'You do not have permission to perform this action.',
        'errors.FORBIDDEN.organization_cannot_transact':
          'Your organization cannot place orders in its current status.',
      }),
    });
    const response = await app.inject({ method: 'GET', url: '/suspended' });
    expect(response.json().error.message).toBe(
      'Your organization cannot place orders in its current status.',
    );
    await app.close();
  });

  it('keeps the written message when the bundle has no sentence for the token', async () => {
    // The failure mode this whole rule exists to end: never the family
    // sentence. Untranslated prose that is true beats a translated sentence
    // that is false.
    const app = await buildProbe({
      errorTranslationTargets: forbidden,
      translateErrorMessage: bundleTranslator({
        'errors.FORBIDDEN': 'You do not have permission to perform this action.',
      }),
    });
    const response = await app.inject({ method: 'GET', url: '/suspended' });
    expect(response.json().error.message).toBe(
      'Your Organization cannot transact in its current status.',
    );
    await app.close();
  });

  it('still translates the family sentence for an error carrying no token', async () => {
    const app = await buildProbe({
      errorTranslationTargets: {
        [ERROR_CODES.PRODUCT_NOT_FOUND]: { moduleId: 'catalog', key: 'errors.PRODUCT_NOT_FOUND' },
      },
      translateErrorMessage: translator,
    });
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.json().error.message).toBe('translated:catalog.errors.PRODUCT_NOT_FOUND');
    await app.close();
  });

  it('reads no token out of the Zod-shaped details array', async () => {
    // `details` has two shapes. The array carries `{path, issue}` pairs and no
    // refusal token, so an entry whose `path` happens to be called something
    // must not turn into a key segment.
    const app = await buildProbe({
      errorTranslationTargets: {
        [ERROR_CODES.PRODUCT_NOT_FOUND]: { moduleId: 'catalog', key: 'errors.PRODUCT_NOT_FOUND' },
      },
      translateErrorMessage: translator,
    });
    const response = await app.inject({ method: 'GET', url: '/zod-shaped' });
    expect(response.json().error.message).toBe('translated:catalog.errors.PRODUCT_NOT_FOUND');
    await app.close();
  });
});
