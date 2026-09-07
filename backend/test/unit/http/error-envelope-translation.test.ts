import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
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
  app.get('/module-off', async () => {
    throw new HttpError(
      503,
      ERROR_CODES.MODULE_DISABLED,
      "Module 'stripe' is currently disabled.",
      { module: 'stripe' },
    );
  });
  app.get('/module-off-unnamed', async () => {
    throw new HttpError(503, ERROR_CODES.MODULE_DISABLED, 'Something is switched off.');
  });
  app.get('/mixed-details', async () => {
    throw new HttpError(400, ERROR_CODES.BULK_TOO_LARGE, 'Too many rows.', {
      maxBatchSize: 200,
      attribute: 'brand',
      rejected: ['a', 'b'],
      context: { nested: true },
    });
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
  async ({
    key,
    originalMessage,
    params,
  }: {
    key: string;
    originalMessage: string;
    params?: Record<string, string | number>;
  }): Promise<string> => {
    const sentence = bundle[key];
    if (sentence === undefined) return originalMessage;
    // `_i18n`'s own `interpolate`, reproduced: substitute what the params name
    // and leave every other `{placeholder}` standing, which is the case the
    // envelope has to notice.
    return sentence.replace(/\{(\w+)\}/g, (_match, name: string) =>
      params?.[name] != null ? String(params[name]) : `{${name}}`,
    );
  };

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

/**
 * Issue #161 — the sentence is filled from `details`.
 *
 * `MODULE_DISABLED` is one code for every gated port in the platform, so its
 * sentence has to be generic in exactly the way `FORBIDDEN`'s is — except that
 * here the specific part is not a token choosing another sentence, it is a
 * *value* the one sentence is missing. An operator refused a refund because a
 * gateway is switched off read "Module Disabled." and was not told which module
 * to switch back on, while the id sat on the error object the whole time.
 *
 * So `details`' scalar members are the interpolation parameters: the envelope
 * chooses them, `_i18n` substitutes them (it already interpolates `{name}` for
 * every other backend-side lookup), and a sentence with a placeholder no
 * parameter fills falls back to the written message rather than showing a
 * literal `{module}` — the same ruling as issue #65's, that untranslated prose
 * which is true beats a rendered sentence that is not.
 */
describe('the error envelope filling a sentence from details', () => {
  const moduleDisabled = {
    [ERROR_CODES.MODULE_DISABLED]: { moduleId: 'core', key: 'errors.MODULE_DISABLED' },
  };
  const OFF_SENTENCE = 'The "{module}" module is off, so this action was refused.';

  it('names the module in the sentence an operator reads', async () => {
    const app = await buildProbe({
      errorTranslationTargets: moduleDisabled,
      translateErrorMessage: bundleTranslator({ 'errors.MODULE_DISABLED': OFF_SENTENCE }),
    });
    const response = await app.inject({ method: 'GET', url: '/module-off' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.message).toBe(
      'The "stripe" module is off, so this action was refused.',
    );
    await app.close();
  });

  it('leaves the module id on the wire as well as in the sentence', async () => {
    // The sentence is for a human; `details` is what a client can branch on
    // without parsing prose, and it is the same fact in both places.
    const app = await buildProbe({
      errorTranslationTargets: moduleDisabled,
      translateErrorMessage: bundleTranslator({ 'errors.MODULE_DISABLED': OFF_SENTENCE }),
    });
    const response = await app.inject({ method: 'GET', url: '/module-off' });
    expect(response.json().error.details).toEqual({ module: 'stripe' });
    await app.close();
  });

  it('passes only the scalar members of details, so a nested value cannot land in prose', async () => {
    const seen: Array<Record<string, string | number> | undefined> = [];
    const app = await buildProbe({
      errorTranslationTargets: {
        [ERROR_CODES.BULK_TOO_LARGE]: { moduleId: 'core', key: 'errors.BULK_TOO_LARGE' },
      },
      translateErrorMessage: async ({ params, originalMessage }) => {
        seen.push(params);
        return originalMessage;
      },
    });
    await app.inject({ method: 'GET', url: '/mixed-details' });
    expect(seen).toEqual([{ maxBatchSize: 200, attribute: 'brand' }]);
    await app.close();
  });

  it('passes no parameters for the Zod-shaped details array', async () => {
    const seen: Array<Record<string, string | number> | undefined> = [];
    const app = await buildProbe({
      errorTranslationTargets: {
        [ERROR_CODES.PRODUCT_NOT_FOUND]: { moduleId: 'catalog', key: 'errors.PRODUCT_NOT_FOUND' },
      },
      translateErrorMessage: async ({ params, originalMessage }) => {
        seen.push(params);
        return originalMessage;
      },
    });
    await app.inject({ method: 'GET', url: '/zod-shaped' });
    expect(seen).toEqual([undefined]);
    await app.close();
  });

  it('keeps the written message when a placeholder has no value to fill it', async () => {
    // A refusal that names no module still exists — the four modules that wrap
    // their own plugin, a hand-written 503 — and "The "{module}" module is off"
    // is worse than the prose the thrower wrote.
    const app = await buildProbe({
      errorTranslationTargets: moduleDisabled,
      translateErrorMessage: bundleTranslator({ 'errors.MODULE_DISABLED': OFF_SENTENCE }),
    });
    const response = await app.inject({ method: 'GET', url: '/module-off-unnamed' });
    expect(response.json().error.message).toBe('Something is switched off.');
    await app.close();
  });

  it('still translates a sentence that has no placeholder at all', async () => {
    const app = await buildProbe({
      errorTranslationTargets: moduleDisabled,
      translateErrorMessage: bundleTranslator({ 'errors.MODULE_DISABLED': 'Module Disabled.' }),
    });
    const response = await app.inject({ method: 'GET', url: '/module-off-unnamed' });
    expect(response.json().error.message).toBe('Module Disabled.');
    await app.close();
  });
});

/**
 * Localising an error may never replace the error.
 *
 * Everything else in this hook already obeys that: a code with no target, a
 * `VALIDATION_FAILED` carrying a machine token, a sentence with an unfilled
 * placeholder — each returns `payload` unchanged, on the ruling that
 * untranslated prose which is true beats a rendered sentence that is not. A
 * **throw** was the one path that did neither. It runs inside
 * `preSerialization` of a reply Fastify is already treating as an error, so
 * Fastify cannot route it back through `setErrorHandler`: it falls back to its
 * own serialiser and the response stops being an `ErrorEnvelope` at all —
 * `{ statusCode, code, error, message }`, in which `error` is the status
 * phrase and `error.code` is `undefined`. The admin's API client
 * (`@endora-commerce/admin-kit/lib`) finds `'error' in body`, builds an
 * `ApiError` from it, and reports `undefined: undefined`.
 *
 * That is not hypothetical. Feature 080's T052 converted the root's
 * `adminPreferredLanguage` closure from `em().findOne(AdminUser, …)` to the
 * gated `adminUserReadPort`, so with `admin_users` platform-absent every error
 * answered to a signed-in admin lost its envelope — including the
 * `MODULE_DISABLED` refusal whose whole job is to name the module to restore
 * (issue #161). `RequestLanguageDeps.adminPreferredLanguage` had said in
 * writing that a gated port here would do exactly this.
 *
 * So the guarantee is stated at the renderer instead of at each injected
 * callback: whatever `resolvePreferredLanguage` or `translateErrorMessage`
 * does, the envelope survives it. That covers a switched-off owner, a bundle
 * lookup that cannot reach Redis, and whatever the next injected callback
 * turns out to be.
 */
describe('the error envelope surviving a decoration that throws', () => {
  const moduleDisabled = {
    [ERROR_CODES.MODULE_DISABLED]: { moduleId: 'core', key: 'errors.MODULE_DISABLED' },
  };

  it('keeps the envelope when the language resolver throws', async () => {
    const app = await buildProbe({
      errorTranslationTargets: moduleDisabled,
      translateErrorMessage: async () => 'never reached',
      resolvePreferredLanguage: async () => {
        // What `adminUserReadPort` does while `admin_users` is absent.
        throw new HttpError(
          503,
          ERROR_CODES.MODULE_DISABLED,
          "Module 'admin_users' is currently disabled.",
          { module: 'admin_users' },
        );
      },
    });
    const response = await app.inject({ method: 'GET', url: '/module-off' });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.error.code).toBe(ERROR_CODES.MODULE_DISABLED);
    expect(body.error.message).toBe("Module 'stripe' is currently disabled.");
    expect(body.error.details).toEqual({ module: 'stripe' });
    await app.close();
  });

  it('keeps the envelope when the translator throws', async () => {
    const app = await buildProbe({
      errorTranslationTargets: moduleDisabled,
      translateErrorMessage: async () => {
        throw new Error('the bundle store is unreachable');
      },
    });
    const response = await app.inject({ method: 'GET', url: '/module-off' });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.error.code).toBe(ERROR_CODES.MODULE_DISABLED);
    expect(body.error.message).toBe("Module 'stripe' is currently disabled.");
    await app.close();
  });

  it('leaves a successful response alone — the guard is not a blanket catch', async () => {
    // The hook returns `payload` for anything that is not an error envelope, so
    // a 200 body never enters the decoration and never enters the guard either.
    const app = Fastify();
    registerErrorEnvelope(app, {
      errorTranslationTargets: moduleDisabled,
      translateErrorMessage: async () => {
        throw new Error('must not be reached for a success payload');
      },
    });
    app.get('/fine', async () => ({ ok: true }));
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/fine' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});
