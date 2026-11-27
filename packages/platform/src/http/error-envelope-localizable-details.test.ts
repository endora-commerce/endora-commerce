import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError, registerErrorEnvelope } from './error-envelope.js';
import { localizableDetail, localizableMessageRef } from './localizable-detail.js';

/**
 * `specs/193-admin-form-extensions/` T027 (FR-042, research R-17): a
 * `details[]` entry marked with `localizableDetail` has its `message`
 * translated into the response language by the envelope — from the bundle the
 * mark names, with the mark's params — and the mark never reaches the wire.
 * Every unmarked entry is left exactly as it was.
 */

const bundles: Record<string, Record<string, string>> = {
  _lifecycle: {
    'errors.FIELD_RULE_VIOLATION': 'Niektóre wartości naruszają reguły.',
    'fieldRules.too_long': 'Wpisz najwyżej {limit} znaków.',
  },
  acme: { 'rules.code': 'Kod ACME ma najwyżej {limit} znaków.' },
};

const translateErrorMessage = async ({
  moduleId,
  key,
  originalMessage,
  params,
}: {
  moduleId: string;
  key: string;
  originalMessage: string;
  params?: Record<string, string | number>;
}): Promise<string> => {
  const sentence = bundles[moduleId]?.[key];
  if (sentence === undefined) return originalMessage;
  return sentence.replace(/\{(\w+)\}/g, (whole, name: string) => (params?.[name] === undefined ? whole : String(params[name])));
};

async function probe() {
  const app = Fastify();
  registerErrorEnvelope(app, {
    errorTranslationTargets: { FIELD_RULE_VIOLATION: { moduleId: '_lifecycle', key: 'errors.FIELD_RULE_VIOLATION' } },
    translateErrorMessage,
    resolvePreferredLanguage: async () => 'pl',
  });
  app.get('/rules', async () => {
    throw new HttpError(422, ERROR_CODES.FIELD_RULE_VIOLATION, 'Some values break the rules.', [
      localizableDetail({ path: 'name', code: 'too_long', params: { limit: 5 }, message: 'Enter at most 5 characters.' }, { moduleId: '_lifecycle', key: 'fieldRules.too_long', params: { limit: 5 } }),
      localizableDetail({ path: 'code', code: 'too_long', params: { limit: 3 }, message: 'Enter at most 3 characters.' }, { moduleId: 'acme', key: 'rules.code', params: { limit: 3 } }),
      localizableDetail({ path: 'note', code: 'pattern', message: 'The value does not have the required form.' }, { moduleId: '_lifecycle', key: 'fieldRules.pattern' }),
      { path: 'plain', issue: 'left alone', message: 'Left alone.' },
    ] as unknown as Record<string, unknown>);
  });
  await app.ready();
  return app;
}

describe('localizable details (193 T027)', () => {
  it('translates each marked entry from the bundle it names, with its params', async () => {
    const app = await probe();
    const res = await app.inject({ method: 'GET', url: '/rules' });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { message: string; details: Record<string, unknown>[] } };
    expect(body.error.message).toBe('Niektóre wartości naruszają reguły.');
    expect(body.error.details).toEqual([
      { path: 'name', code: 'too_long', params: { limit: 5 }, message: 'Wpisz najwyżej 5 znaków.' },
      { path: 'code', code: 'too_long', params: { limit: 3 }, message: 'Kod ACME ma najwyżej 3 znaków.' },
      // A sentence the bundle lacks keeps the thrower's English.
      { path: 'note', code: 'pattern', message: 'The value does not have the required form.' },
      { path: 'plain', issue: 'left alone', message: 'Left alone.' },
    ]);
    await app.close();
  });

  it('says which language the details are in when the top-level sentence keeps the English', async () => {
    const app = Fastify();
    registerErrorEnvelope(app, {
      errorTranslationTargets: { FIELD_RULE_VIOLATION: { moduleId: 'broken', key: 'errors.FIELD_RULE_VIOLATION' } },
      // The top-level sentence names a placeholder nothing fills, so the envelope keeps the English.
      translateErrorMessage: async (args) => (args.moduleId === 'broken' ? 'Błąd {missing}.' : translateErrorMessage(args)),
      resolvePreferredLanguage: async () => 'pl',
    });
    app.get('/rules', async () => {
      throw new HttpError(422, ERROR_CODES.FIELD_RULE_VIOLATION, 'Some values break the rules.', [
        localizableDetail({ path: 'name', code: 'too_long', message: 'Enter at most 5 characters.' }, { moduleId: '_lifecycle', key: 'fieldRules.too_long', params: { limit: 5 } }),
      ] as unknown as Record<string, unknown>);
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/rules' });
    const body = res.json() as { error: { message: string; details: { message: string }[] } };
    expect(body.error.message).toBe('Some values break the rules.');
    expect(body.error.details[0]!.message).toBe('Wpisz najwyżej 5 znaków.');
    expect(res.headers['content-language']).toBe('pl');
    await app.close();
  });

  it('keeps the mark off the wire', () => {
    const entry = localizableDetail({ path: 'name', message: 'x' }, { moduleId: '_lifecycle', key: 'k' });
    expect(JSON.parse(JSON.stringify(entry))).toEqual({ path: 'name', message: 'x' });
    expect(Object.keys(entry)).toEqual(['path', 'message']);
    expect(localizableMessageRef(entry)).toEqual({ moduleId: '_lifecycle', key: 'k' });
    expect(localizableMessageRef({ path: 'name', message: 'x' })).toBeUndefined();
  });
});
