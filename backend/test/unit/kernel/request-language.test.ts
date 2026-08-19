import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  createRequestLanguageResolver,
  normalise,
  parseAcceptLanguage,
} from '../../../src/kernel/i18n/request-language.js';

/**
 * The two pure halves of the request-language ladder (feature 083, R8 and R9).
 *
 * They are unit-tested rather than only driven over HTTP because the header is
 * attacker-controlled on every request: the bounds (512 characters, 10 tags)
 * and the refusal to let an unsupported tag *become* a language are the
 * security bound (D-139 § 8.1), and a bound asserted only through a route is
 * asserted only for the shapes that route happens to see.
 */
describe('normalise — a tag becomes a shipped language, or it becomes nothing (R8)', () => {
  it.each([
    ['pl', 'pl'],
    ['pl-PL', 'pl'],
    ['PL', 'pl'],
    ['pl-Latn-PL', 'pl'],
    ['en-US', 'en'],
    ['de-DE', null],
    ['', null],
    ['*', null],
  ])('%s → %s', (input, expected) => {
    expect(normalise(input)).toBe(expected);
  });

  it('a missing tag is not a language', () => {
    expect(normalise(null)).toBeNull();
    expect(normalise(undefined)).toBeNull();
  });

  it('surrounding whitespace is not part of the tag', () => {
    expect(normalise('  pl  ')).toBe('pl');
  });

  it('an unsupported language never becomes a supported one', () => {
    // The whole of the bound, stated as one assertion: the value reaches a
    // lookup only as a member of the enum, so a hostile tag can produce no key
    // at all rather than a key of its own choosing.
    expect(normalise('../../etc/passwd')).toBeNull();
    expect(normalise('pl.json')).toBeNull();
    expect(normalise('polish')).toBeNull();
  });
});

describe('parseAcceptLanguage — a q-weighted list, bounded (R9)', () => {
  it('sorts by descending q rather than taking the first tag', () => {
    // `split(',')[0]` — what `catalog`, `search` and `cms` do today (T024) —
    // answers `en` here, which is the wrong language by the client's own
    // statement.
    expect(parseAcceptLanguage('en;q=0.2,pl;q=0.9')).toEqual(['pl', 'en']);
  });

  it('treats a tag with no q as weight 1 and keeps the written order among equals', () => {
    expect(parseAcceptLanguage('en-US,pl;q=0.9')).toEqual(['en-US', 'pl']);
    expect(parseAcceptLanguage('pl,en')).toEqual(['pl', 'en']);
  });

  it('drops a tag whose q is malformed rather than guessing a weight', () => {
    expect(parseAcceptLanguage('de;q=abc,pl')).toEqual(['pl']);
    expect(parseAcceptLanguage('de;q=,pl')).toEqual(['pl']);
  });

  it('keeps * as a tag, which then never normalises', () => {
    expect(parseAcceptLanguage('*')).toEqual(['*']);
    expect(normalise(parseAcceptLanguage('*')[0] ?? null)).toBeNull();
  });

  it('reads the first element of a duplicated header', () => {
    // Fastify hands duplicate headers over as an array.
    expect(parseAcceptLanguage(['pl', 'en'])).toEqual(['pl']);
  });

  it('answers an absent header with no tags at all', () => {
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage('')).toEqual([]);
    expect(parseAcceptLanguage('   ')).toEqual([]);
  });

  it('truncates the header at 512 characters and ignores the remainder', () => {
    // A tag beyond the bound is not an error — the parse simply does not reach
    // it. `pl` sits past character 512 and must not appear.
    const header = `en,${'q'.repeat(520)},pl`;
    const tags = parseAcceptLanguage(header);
    expect(tags).toHaveLength(2);
    expect(tags[0]).toBe('en');
    expect(tags).not.toContain('pl');
    expect((tags[1] as string).length).toBe(512 - 'en,'.length);
  });

  it('keeps the ten heaviest tags and no more', () => {
    const header = Array.from(
      { length: 20 },
      (_unused, i) => `t${i};q=${(1 - i * 0.05).toFixed(2)}`,
    ).join(',');
    expect(header.length).toBeLessThan(512);
    const tags = parseAcceptLanguage(header);
    expect(tags).toHaveLength(10);
    expect(tags).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9']);
  });

  it('caps after weighting, so a heavy tag written last survives the cap', () => {
    const filler = Array.from({ length: 15 }, (_unused, i) => `t${i};q=0.1`).join(',');
    expect(parseAcceptLanguage(`${filler},pl;q=0.9`)[0]).toBe('pl');
  });
});

describe('createRequestLanguageResolver — the ladder always answers (B1, B3)', () => {
  /** Only the two properties the resolver reads. */
  function requestWith(shape: Record<string, unknown>): FastifyRequest {
    return { headers: {}, ...shape } as unknown as FastifyRequest;
  }

  const neverAsked = async (): Promise<string | null> => {
    throw new Error('the admin lookup must not run for a buyer');
  };

  it('answers the fallback for a buyer with no header and no resolved channel', async () => {
    // B3 — there is no request scope here at all, so `currentSalesChannel()`
    // answers `null`. That is the ordinary shape on a health path or off the
    // API prefix, not a failure, and the rung simply falls through.
    const resolve = createRequestLanguageResolver({ adminPreferredLanguage: neverAsked });
    expect(await resolve(requestWith({ actor: { kind: 'anonymous' } }))).toBe('en');
  });

  it('answers the fallback when the request carries no actor at all', async () => {
    // B1. `request.actor` is typed non-optional by the auth plugin's module
    // augmentation, but a response serialised before that hook ran carries
    // none — and the resolver runs inside error serialisation, where throwing
    // means failing to render an error with another error.
    const resolve = createRequestLanguageResolver({ adminPreferredLanguage: neverAsked });
    expect(await resolve(requestWith({}))).toBe('en');
  });

  it('reads the header for a buyer, q-weighted', async () => {
    const resolve = createRequestLanguageResolver({ adminPreferredLanguage: neverAsked });
    const request = requestWith({
      actor: { kind: 'anonymous' },
      headers: { 'accept-language': 'en;q=0.3,pl;q=0.8' },
    });
    expect(await resolve(request)).toBe('pl');
  });

  it('reads only the stored preference for an admin (B2)', async () => {
    const resolve = createRequestLanguageResolver({
      adminPreferredLanguage: async (id) => (id === 'admin-1' ? 'pl' : null),
    });
    const polishAdmin = requestWith({
      actor: { kind: 'admin', adminUserId: 'admin-1' },
      headers: { 'accept-language': 'en-GB' },
    });
    expect(await resolve(polishAdmin)).toBe('pl');
    const unsetAdmin = requestWith({
      actor: { kind: 'admin', adminUserId: 'admin-2' },
      headers: { 'accept-language': 'pl' },
    });
    expect(await resolve(unsetAdmin)).toBe('en');
  });

  it('takes the buyer arm for an impersonating admin (B6)', async () => {
    // An admin impersonating a customer presents as `ActorCustomer` and is
    // looking at the storefront, so the storefront's ladder is the right one.
    const resolve = createRequestLanguageResolver({ adminPreferredLanguage: neverAsked });
    const request = requestWith({
      actor: { kind: 'customer', customerAccountId: 'c1', impersonatorAdminUserId: 'a1' },
      headers: { 'accept-language': 'pl' },
    });
    expect(await resolve(request)).toBe('pl');
  });
});
