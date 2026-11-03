import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  type LegacyUrlKeysRequest,
  admitImportKeys,
  otherProductSlugs,
  planUrlKeyWrite,
  urlKeysToLock,
  type UrlKeyRow,
  type UrlKeyWritePlan,
  type UrlKeyWriteState,
  type UrlRedirectRow,
  UrlKeyService,
} from './url-key.service.js';

/**
 * Feature 163, Phase 16 (T100, T103) — the decision core of `UrlKeyService.update`:
 * what a `PUT /admin/catalog/products/:id/url-keys` writes, refuses and records
 * (`specs/163-product-data-scopes/data-model.md` §5, `contracts/url-keys-and-redirects.md` §2,
 * research R11; FR-014, FR-015, FR-070, FR-072, SC-008).
 *
 * `planUrlKeyWrite` is pure: it takes the product's own keys and redirects, the rows
 * of other products that share a touched key, and the channels, and answers the rows
 * to write. The service runs it inside the Command's transaction after taking the
 * per-key advisory locks, so a refusal here is a refusal of the whole request with
 * nothing written. The `[PG]` tests (`backend/test/integration/catalog/url-key-uniqueness.test.ts`,
 * `backend/test/integration/catalog/url-keys-three-levels.test.ts`, T030) cover the same rows through
 * the database and the route.
 */

const P = '00000000-0000-4000-8000-0000000000a1';
const Q = '00000000-0000-4000-8000-0000000000a2';
const R = '00000000-0000-4000-8000-0000000000a3';
const B2B = '00000000-0000-4000-8000-0000000000c1';
const B2C = '00000000-0000-4000-8000-0000000000c2';
const GONE = '00000000-0000-4000-8000-0000000000c9';

let redirectSeq = 0;
function redirect(productId: string, languageCode: string | null, key: string): UrlRedirectRow {
  redirectSeq += 1;
  return { id: `00000000-0000-4000-8000-${String(redirectSeq).padStart(12, '0')}`, productId, languageCode, key };
}

function key(productId: string, languageCode: string, value: string, channelId: string | null = null): UrlKeyRow {
  return { productId, languageCode, channelId, key: value };
}

function state(over: Partial<UrlKeyWriteState> = {}): UrlKeyWriteState {
  return {
    productId: P,
    slug: 'drill',
    ownKeys: [],
    ownRedirects: [],
    otherKeys: [],
    otherSlugs: [],
    otherRedirects: [],
    productNames: new Map([
      [P, 'Drill'],
      [Q, 'Hammer'],
      [R, 'Saw'],
    ]),
    channelLanguages: ['pl-PL', 'de-DE', 'en-GB'],
    memberChannels: new Map([
      [B2B, ['pl-PL', 'de-DE']],
      [B2C, ['pl-PL', 'en-GB']],
    ]),
    ...over,
  };
}

function refusal(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected the write to be refused');
}

function inserted(plan: UrlKeyWritePlan): string[] {
  return plan.insertRedirects.map((r) => `${r.languageCode ?? '*'}:${r.key}`).sort();
}

function deletedIds(plan: UrlKeyWritePlan): string[] {
  return plan.deleteRedirects.map((r) => r.id).sort();
}

// 170-shim: the 163 planner runs on its own request shape until T039 rewrites it on (C, C×L) keys.
const put = (body: LegacyUrlKeysRequest): LegacyUrlKeysRequest => body;

describe('planUrlKeyWrite — uniqueness per language (FR-070, US7 #2, #7)', () => {
  it("refuses another product's language key in the same language, naming the holder", () => {
    const err = refusal(() =>
      planUrlKeyWrite(
        state({ otherKeys: [key(Q, 'pl-PL', 'wiertarka')] }),
        put({ languageKeys: [{ languageCode: 'pl-PL', key: 'wiertarka' }] }),
      ),
    );
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
    expect(err.details).toEqual({
      conflicts: [{ channelId: null, languageCode: 'pl-PL', key: 'wiertarka', heldByProductId: Q, heldByProductName: 'Hammer' }],
    });
  });

  it("refuses another product's channel × language key of any channel, orphans included (US7 #7, FR-015)", () => {
    for (const channelId of [B2B, GONE]) {
      const err = refusal(() =>
        planUrlKeyWrite(
          state({ otherKeys: [key(Q, 'pl-PL', 'wiertarka', channelId)] }),
          put({ channelKeys: [{ channelId: B2C, languageCode: 'pl-PL', key: 'wiertarka' }] }),
        ),
      );
      expect(err.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
    }
  });

  it("refuses another product's global key where it has no key of that language, allows it where it has one", () => {
    const err = refusal(() =>
      planUrlKeyWrite(
        state({ otherSlugs: [{ productId: Q, slug: 'hammer', languageKeyLanguages: ['de-DE'] }] }),
        put({ languageKeys: [{ languageCode: 'pl-PL', key: 'hammer' }] }),
      ),
    );
    expect(err.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
    expect((err.details as { conflicts: Array<{ heldByProductId: string }> }).conflicts[0]?.heldByProductId).toBe(Q);

    const plan = planUrlKeyWrite(
      state({ otherSlugs: [{ productId: Q, slug: 'hammer', languageKeyLanguages: ['pl-PL'] }] }),
      put({ languageKeys: [{ languageCode: 'pl-PL', key: 'hammer' }] }),
    );
    expect(plan.keyRows).toEqual([{ languageCode: 'pl-PL', channelId: null, next: 'hammer' }]);
  });

  // Phase 16 review — `products.slug` is unique across deleted rows too, so a soft-deleted
  // product's global key stays taken in every language (its language keys no longer count).
  it("a soft-deleted product's global key is taken in every language and as a global key", () => {
    const otherSlugs = otherProductSlugs(
      [
        { id: Q, slug: 'hammer', deletedAt: new Date('2026-10-01T00:00:00Z') },
        { id: R, slug: 'saw', deletedAt: null },
      ],
      [key(Q, 'de-DE', 'hammer-de'), key(R, 'de-DE', 'saw-de')],
    );
    expect(otherSlugs).toEqual([
      { productId: Q, slug: 'hammer', languageKeyLanguages: [] },
      { productId: R, slug: 'saw', languageKeyLanguages: ['de-DE'] },
    ]);

    const inLanguage = refusal(() =>
      planUrlKeyWrite(state({ otherSlugs }), put({ languageKeys: [{ languageCode: 'de-DE', key: 'hammer' }] })),
    );
    expect(inLanguage.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
    const asGlobal = refusal(() => planUrlKeyWrite(state({ otherSlugs }), put({ globalKey: 'hammer' })));
    expect(asGlobal.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
    expect((asGlobal.details as { conflicts: Array<{ heldByProductId: string }> }).conflicts[0]?.heldByProductId).toBe(Q);
  });

  it('accepts a key another product holds in another language only', () => {
    const plan = planUrlKeyWrite(
      state({ otherKeys: [key(Q, 'de-DE', 'drill-pro')] }),
      put({ languageKeys: [{ languageCode: 'pl-PL', key: 'drill-pro' }] }),
    );
    expect(plan.changed).toBe(true);
  });

  it('accepts one key for the product in several channels of one language', () => {
    const plan = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'pl-PL', 'drill-pro', B2B)] }),
      put({ channelKeys: [{ channelId: B2C, languageCode: 'pl-PL', key: 'drill-pro' }] }),
    );
    expect(plan.keyRows).toEqual([{ languageCode: 'pl-PL', channelId: B2C, next: 'drill-pro' }]);
    expect(plan.insertRedirects).toEqual([]);
  });

  it('checks a global key in every language: any other key refuses, naming every holder', () => {
    const err = refusal(() =>
      planUrlKeyWrite(
        state({ otherKeys: [key(Q, 'de-DE', 'tool'), key(R, 'en-GB', 'tool', B2C)] }),
        put({ globalKey: 'tool' }),
      ),
    );
    expect(err.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
    const holders = (err.details as { conflicts: Array<{ heldByProductId: string }> }).conflicts.map(
      (c) => c.heldByProductId,
    );
    expect(holders.sort()).toEqual([Q, R].sort());
  });
});

describe('planUrlKeyWrite — redirects and takeovers (FR-072, US7 #4, #5)', () => {
  it("asks for confirmation before taking over another product's redirect in the language", () => {
    const theirs = redirect(Q, 'pl-PL', 'mlot');
    const err = refusal(() =>
      planUrlKeyWrite(state({ otherRedirects: [theirs] }), put({ languageKeys: [{ languageCode: 'pl-PL', key: 'mlot' }] })),
    );
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe(ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED);
    expect(err.details).toEqual({
      takeovers: [{ channelId: null, languageCode: 'pl-PL', key: 'mlot', losingProductId: Q, losingProductName: 'Hammer' }],
    });

    const plan = planUrlKeyWrite(
      state({ otherRedirects: [theirs] }),
      put({
        languageKeys: [{ languageCode: 'pl-PL', key: 'mlot' }],
        confirmTakeover: [{ languageCode: 'pl-PL', key: 'mlot' }],
      }),
    );
    expect(deletedIds(plan)).toEqual([theirs.id]);
    expect(plan.before.redirects).toEqual([
      { id: theirs.id, productId: Q, languageCode: 'pl-PL', key: 'mlot' },
    ]);
  });

  it("H1: another product's language-less redirect needs a takeover in every language and is removed everywhere", () => {
    const theirs = redirect(Q, null, 'old-hammer');
    // Even where P already holds a key of that language.
    const err = refusal(() =>
      planUrlKeyWrite(
        state({ ownKeys: [key(P, 'pl-PL', 'wiertarka')], otherRedirects: [theirs] }),
        put({ languageKeys: [{ languageCode: 'pl-PL', key: 'old-hammer' }] }),
      ),
    );
    expect(err.code).toBe(ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED);
    expect((err.details as { takeovers: Array<{ languageCode: string | null }> }).takeovers[0]?.languageCode).toBe(
      null,
    );

    // Feature 170 (R21): `confirmTakeover` names keys, so a confirmation of the key covers it
    // in every language (170-shim until T039 confirms per (channel, language)).

    const plan = planUrlKeyWrite(
      state({ otherRedirects: [theirs] }),
      put({
        languageKeys: [{ languageCode: 'pl-PL', key: 'old-hammer' }],
        confirmTakeover: [{ languageCode: null, key: 'old-hammer' }],
      }),
    );
    expect(deletedIds(plan)).toEqual([theirs.id]);
  });

  it('a global key meeting redirects of several products names every losing product', () => {
    const err = refusal(() =>
      planUrlKeyWrite(
        state({ otherRedirects: [redirect(Q, 'pl-PL', 'tool'), redirect(R, 'de-DE', 'tool')] }),
        put({ globalKey: 'tool' }),
      ),
    );
    expect(err.code).toBe(ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED);
    const losers = (err.details as { takeovers: Array<{ losingProductId: string }> }).takeovers.map(
      (t) => t.losingProductId,
    );
    expect(losers.sort()).toEqual([Q, R].sort());
  });

  it('a refused key wins over a takeover: URL_KEY_TAKEN is answered first', () => {
    const err = refusal(() =>
      planUrlKeyWrite(
        state({ otherKeys: [key(Q, 'pl-PL', 'mlot')], otherRedirects: [redirect(R, 'pl-PL', 'mlot')] }),
        put({ languageKeys: [{ languageCode: 'pl-PL', key: 'mlot' }] }),
      ),
    );
    expect(err.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
  });

  it("writing the product's own redirect in that language removes it (no self-redirect)", () => {
    const own = redirect(P, 'pl-PL', 'wiertarka-stara');
    const plan = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'pl-PL', 'wiertarka')], ownRedirects: [own] }),
      put({ languageKeys: [{ languageCode: 'pl-PL', key: 'wiertarka-stara' }] }),
    );
    expect(deletedIds(plan)).toEqual([own.id]);
    expect(inserted(plan)).toEqual(['pl-PL:wiertarka']);
  });

  it("H1: the product's own language-less redirect written as a language key is kept", () => {
    const own = redirect(P, null, 'old-drill');
    const plan = planUrlKeyWrite(
      state({ ownRedirects: [own] }),
      put({ languageKeys: [{ languageCode: 'pl-PL', key: 'old-drill' }] }),
    );
    expect(deletedIds(plan)).toEqual([]);
  });

  it('changing a key keeps the old one as a redirect in its language; twice → both point at the product (no chain)', () => {
    const first = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'pl-PL', 'k0')] }),
      put({ languageKeys: [{ languageCode: 'pl-PL', key: 'k1' }] }),
    );
    expect(inserted(first)).toEqual(['pl-PL:k0']);

    const second = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'pl-PL', 'k1')], ownRedirects: [redirect(P, 'pl-PL', 'k0')] }),
      put({ languageKeys: [{ languageCode: 'pl-PL', key: 'k2' }] }),
    );
    expect(inserted(second)).toEqual(['pl-PL:k1']);
    expect(deletedIds(second)).toEqual([]);
  });

  it('a channel × language key change keeps the old one as a redirect of its language', () => {
    const plan = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'pl-PL', 'pro', B2B)] }),
      put({ channelKeys: [{ channelId: B2B, languageCode: 'pl-PL', key: 'pro-2' }] }),
    );
    expect(inserted(plan)).toEqual(['pl-PL:pro']);
  });

  it("a released key still current elsewhere in the language is not a redirect", () => {
    const plan = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'pl-PL', 'pro', B2B), key(P, 'pl-PL', 'pro', B2C)] }),
      put({ channelKeys: [{ channelId: B2B, languageCode: 'pl-PL', key: null }] }),
    );
    expect(plan.keyRows).toEqual([{ languageCode: 'pl-PL', channelId: B2B, next: null }]);
    expect(inserted(plan)).toEqual([]);
  });

  it('the first language key makes the global key a redirect in that language only (FR-072 consequence 1, US7 #8)', () => {
    const plan = planUrlKeyWrite(state(), put({ languageKeys: [{ languageCode: 'pl-PL', key: 'wiertarka' }] }));
    expect(inserted(plan)).toEqual(['pl-PL:drill']);
  });

  it('a first channel × language key inserts no redirect: the language or global key stays current there', () => {
    const plan = planUrlKeyWrite(
      state(),
      put({ channelKeys: [{ channelId: B2B, languageCode: 'pl-PL', key: 'drill-b2b' }] }),
    );
    expect(inserted(plan)).toEqual([]);
  });
});

describe('planUrlKeyWrite — removing a language key ("use inherited")', () => {
  it('turns the removed key into a redirect and deletes the redirect of the global key in that language', () => {
    const slugRedirect = redirect(P, 'pl-PL', 'drill');
    const plan = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'pl-PL', 'wiertarka')], ownRedirects: [slugRedirect] }),
      put({ languageKeys: [{ languageCode: 'pl-PL', key: null }] }),
    );
    expect(plan.keyRows).toEqual([{ languageCode: 'pl-PL', channelId: null, next: null }]);
    expect(inserted(plan)).toEqual(['pl-PL:wiertarka']);
    expect(deletedIds(plan)).toEqual([slugRedirect.id]);
  });

  it("is refused while another product holds the product's global key in that language and a channel offers it", () => {
    const err = refusal(() =>
      planUrlKeyWrite(
        state({ ownKeys: [key(P, 'pl-PL', 'wiertarka')], otherKeys: [key(Q, 'pl-PL', 'drill')] }),
        put({ languageKeys: [{ languageCode: 'pl-PL', key: null }] }),
      ),
    );
    expect(err.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
    expect((err.details as { conflicts: Array<{ heldByProductId: string }> }).conflicts[0]?.heldByProductId).toBe(Q);
  });

  it('is always allowed for an orphaned language key — no channel offers the language (FR-015)', () => {
    const plan = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'fr-FR', 'perceuse')], otherKeys: [key(Q, 'fr-FR', 'drill')] }),
      put({ languageKeys: [{ languageCode: 'fr-FR', key: null }] }),
    );
    expect(plan.keyRows).toEqual([{ languageCode: 'fr-FR', channelId: null, next: null }]);
  });

  it('removing a key the product does not hold changes nothing', () => {
    const plan = planUrlKeyWrite(state(), put({ languageKeys: [{ languageCode: 'pl-PL', key: null }] }));
    expect(plan.changed).toBe(false);
  });
});

describe('planUrlKeyWrite — the global key (data-model §5, HIGH-2)', () => {
  it('with no collision a slug change writes exactly one language-less redirect', () => {
    const plan = planUrlKeyWrite(state(), put({ globalKey: 'drill-2' }));
    expect(plan.slug).toBe('drill-2');
    expect(inserted(plan)).toEqual(['*:drill']);
  });

  it('HIGH-2: where another product holds the old slug in L, no language-less row and none in L; one per free language', () => {
    // P holds a German key, so its slug "drill" is not its key in German, and Q took it.
    const plan = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'de-DE', 'bohrer')], otherKeys: [key(Q, 'de-DE', 'drill')] }),
      put({ globalKey: 'drill-2' }),
    );
    expect(inserted(plan)).toEqual(['en-GB:drill', 'pl-PL:drill']);
  });

  it('HIGH-2: writing the old slug back while another product holds it in L is refused naming it', () => {
    const err = refusal(() =>
      planUrlKeyWrite(
        state({
          slug: 'drill-2',
          ownKeys: [key(P, 'de-DE', 'bohrer')],
          ownRedirects: [redirect(P, 'pl-PL', 'drill'), redirect(P, 'en-GB', 'drill')],
          otherKeys: [key(Q, 'de-DE', 'drill')],
        }),
        put({ globalKey: 'drill' }),
      ),
    );
    expect(err.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
    expect(err.details).toEqual({
      conflicts: [{ channelId: null, languageCode: 'de-DE', key: 'drill', heldByProductId: Q, heldByProductName: 'Hammer' }],
    });
  });

  it("H1: writing the product's own language-less redirect back as its global key replaces it per held language", () => {
    const own = redirect(P, null, 'drill');
    const plan = planUrlKeyWrite(
      state({
        slug: 'drill-2',
        ownKeys: [key(P, 'pl-PL', 'wiertarka'), key(P, 'en-GB', 'drill-uk', B2C)],
        ownRedirects: [own],
      }),
      put({ globalKey: 'drill' }),
    );
    expect(plan.slug).toBe('drill');
    expect(deletedIds(plan)).toEqual([own.id]);
    // (L, drill) for every language with a language or C×L key, plus the old slug's own redirect.
    expect(inserted(plan)).toEqual(['*:drill-2', 'en-GB:drill', 'pl-PL:drill']);
  });

  it("writing the product's own per-language redirects back drops those where it has no language key", () => {
    const pl = redirect(P, 'pl-PL', 'drill');
    const en = redirect(P, 'en-GB', 'drill');
    const plan = planUrlKeyWrite(
      state({ slug: 'drill-2', ownKeys: [key(P, 'pl-PL', 'wiertarka')], ownRedirects: [pl, en] }),
      put({ globalKey: 'drill' }),
    );
    expect(deletedIds(plan)).toEqual([en.id]);
  });
});

describe('planUrlKeyWrite — scope validity (FR-014, FR-015)', () => {
  it('refuses a channel × language key for a channel the product is not in', () => {
    const err = refusal(() =>
      planUrlKeyWrite(state(), put({ channelKeys: [{ channelId: GONE, languageCode: 'pl-PL', key: 'x' }] })),
    );
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe(ERROR_CODES.SCOPE_INVALID);
    expect(err.details).toEqual({ channelId: GONE, reason: 'not_a_member' });
  });

  it('refuses a channel × language key for a language the channel does not offer', () => {
    const err = refusal(() =>
      planUrlKeyWrite(state(), put({ channelKeys: [{ channelId: B2B, languageCode: 'en-GB', key: 'x' }] })),
    );
    expect(err.code).toBe(ERROR_CODES.SCOPE_INVALID);
    expect(err.details).toEqual({ channelId: B2B, languageCode: 'en-GB', reason: 'language_not_offered' });
  });

  it('removing an orphaned channel × language key is always allowed', () => {
    const plan = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'en-GB', 'old', GONE)] }),
      put({ channelKeys: [{ channelId: GONE, languageCode: 'en-GB', key: null }] }),
    );
    expect(plan.keyRows).toEqual([{ languageCode: 'en-GB', channelId: GONE, next: null }]);
  });

  // T105a (coordinator, 2026-10-25) — the scope overview lists orphaned channel ×
  // language keys and offers to delete them: a delete skips the membership and the
  // language-offered checks, a write keeps both, and the deleted key stays a
  // redirect in its language (Q3b — redirects are kept until deleted).
  it('T105a: deletes a key whose channel the product left, keeping it as a redirect', () => {
    const plan = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'pl-PL', 'wiertarka-b2x', GONE)] }),
      put({ channelKeys: [{ channelId: GONE, languageCode: 'pl-PL', key: null }] }),
    );
    expect(plan.keyRows).toEqual([{ languageCode: 'pl-PL', channelId: GONE, next: null }]);
    expect(inserted(plan)).toEqual(['pl-PL:wiertarka-b2x']);
  });

  it('T105a: deletes a key whose language its channel dropped, keeping it as a redirect', () => {
    const plan = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'en-GB', 'drill-b2b', B2B)] }),
      put({ channelKeys: [{ channelId: B2B, languageCode: 'en-GB', key: null }] }),
    );
    expect(plan.keyRows).toEqual([{ languageCode: 'en-GB', channelId: B2B, next: null }]);
    expect(inserted(plan)).toEqual(['en-GB:drill-b2b']);
  });

  it('T105a: still refuses writing a value to either orphaned scope', () => {
    const left = refusal(() =>
      planUrlKeyWrite(
        state({ ownKeys: [key(P, 'pl-PL', 'wiertarka-b2x', GONE)] }),
        put({ channelKeys: [{ channelId: GONE, languageCode: 'pl-PL', key: 'wiertarka-2' }] }),
      ),
    );
    expect(left.details).toEqual({ channelId: GONE, reason: 'not_a_member' });
    const dropped = refusal(() =>
      planUrlKeyWrite(
        state({ ownKeys: [key(P, 'en-GB', 'drill-b2b', B2B)] }),
        put({ channelKeys: [{ channelId: B2B, languageCode: 'en-GB', key: 'drill-2' }] }),
      ),
    );
    expect(dropped.details).toEqual({ channelId: B2B, languageCode: 'en-GB', reason: 'language_not_offered' });
  });

  it('refuses a language key for a language no channel offers', () => {
    const err = refusal(() => planUrlKeyWrite(state(), put({ languageKeys: [{ languageCode: 'fr-FR', key: 'x' }] })));
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('refuses a scope named twice', () => {
    const err = refusal(() =>
      planUrlKeyWrite(
        state(),
        put({
          languageKeys: [
            { languageCode: 'pl-PL', key: 'a' },
            { languageCode: 'pl-pl', key: 'b' },
          ],
        }),
      ),
    );
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("stores the channel's spelling of the language", () => {
    const plan = planUrlKeyWrite(state(), put({ languageKeys: [{ languageCode: 'pl-pl', key: 'wiertarka' }] }));
    expect(plan.keyRows).toEqual([{ languageCode: 'pl-PL', channelId: null, next: 'wiertarka' }]);
  });
});

describe('planUrlKeyWrite — the audit projection (FR-080, R29)', () => {
  it('a request that changes nothing is not a change', () => {
    const plan = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'pl-PL', 'wiertarka')] }),
      put({ globalKey: 'drill', languageKeys: [{ languageCode: 'pl-PL', key: 'wiertarka' }] }),
    );
    expect(plan.changed).toBe(false);
  });

  it('before / after hold every touched key, and before is itself a request that restores them', () => {
    const plan = planUrlKeyWrite(
      state({ ownKeys: [key(P, 'pl-PL', 'wiertarka'), key(P, 'pl-PL', 'pro', B2B)] }),
      put({
        globalKey: 'drill-2',
        languageKeys: [{ languageCode: 'pl-PL', key: 'wiertarka-2' }],
        channelKeys: [{ channelId: B2B, languageCode: 'pl-PL', key: null }],
      }),
    );
    expect(plan.before).toMatchObject({
      globalKey: 'drill',
      languageKeys: [{ languageCode: 'pl-PL', key: 'wiertarka' }],
      channelKeys: [{ channelId: B2B, languageCode: 'pl-PL', key: 'pro' }],
    });
    expect(plan.after).toMatchObject({
      globalKey: 'drill-2',
      languageKeys: [{ languageCode: 'pl-PL', key: 'wiertarka-2' }],
      channelKeys: [{ channelId: B2B, languageCode: 'pl-PL', key: null }],
    });
    expect(plan.after.redirects.map((r) => `${r.languageCode ?? '*'}:${r.key}`).sort()).toEqual([
      '*:drill',
      'pl-PL:pro',
      'pl-PL:wiertarka',
    ]);
    // 170-shim: "the audit before-state is a valid PUT body" returns with T039's planner (the 170
    // PUT body has no language keys).
  });
});

describe('urlKeysToLock', () => {
  it('names every key the write can touch — new, previous at each scope, the global key — sorted and once', () => {
    const keys = urlKeysToLock(
      'drill',
      [key(P, 'pl-PL', 'wiertarka'), key(P, 'pl-PL', 'pro', B2B), key(P, 'de-DE', 'bohrer')],
      put({
        globalKey: 'drill-2',
        languageKeys: [{ languageCode: 'pl-pl', key: 'a-new' }],
        channelKeys: [{ channelId: B2B, languageCode: 'pl-PL', key: null }],
      }),
    );
    expect(keys).toEqual(['a-new', 'drill', 'drill-2', 'pro', 'wiertarka']);
  });
});

// Phase 16 review — a `:id` that is not a UUID is a product that does not exist (404),
// answered before the database is asked (Postgres would refuse the cast as a 500).
describe('UrlKeyService — a non-UUID id', () => {
  const untouched = (): never => {
    throw new Error('the database must not be reached');
  };
  const service = new UrlKeyService(untouched, {} as never);

  it.each([
    ['read', () => service.read('not-a-uuid'), ERROR_CODES.PRODUCT_NOT_FOUND],
    ['update', () => service.update('not-a-uuid', { globalKey: 'drill' }), ERROR_CODES.PRODUCT_NOT_FOUND],
    ['deleteRedirect (product)', () => service.deleteRedirect('not-a-uuid', P), ERROR_CODES.URL_REDIRECT_NOT_FOUND],
    ['deleteRedirect (redirect)', () => service.deleteRedirect(P, 'not-a-uuid'), ERROR_CODES.URL_REDIRECT_NOT_FOUND],
  ] as const)('%s answers 404', async (_name, call, code) => {
    const err = await call().then(
      () => null,
      (error: unknown) => error,
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(404);
    expect((err as HttpError).code).toBe(code);
  });
});

describe('admitImportKeys — import mode (163 T120, FR-093, US7 #9)', () => {
  it("leaves out another product's current key and redirect key, naming the holder, and admits the rest", () => {
    const loserRedirect = redirect(R, 'pl-PL', 'mlotek-old');
    const { accepted, outcomes } = admitImportKeys(
      state({
        ownKeys: [key(P, 'pl-PL', 'wlasny')],
        otherKeys: [key(Q, 'pl-PL', 'wiertarka')],
        otherRedirects: [loserRedirect],
      }),
      [
        { languageCode: 'pl-PL', channelId: null, key: 'wiertarka' },
        { languageCode: 'pl-PL', channelId: B2B, key: 'mlotek-old' },
        { languageCode: 'en-GB', channelId: null, key: 'english' },
      ],
    );
    expect(outcomes).toEqual([
      { written: false, issue: { languageCode: 'pl-PL', channelId: null, key: 'wiertarka', heldByProductId: Q, kind: 'current' } },
      { written: false, issue: { languageCode: 'pl-PL', channelId: B2B, key: 'mlotek-old', heldByProductId: R, kind: 'redirect' } },
      { written: true },
    ]);
    expect(accepted).toEqual([{ languageCode: 'en-GB', channelId: null, key: 'english' }]);
  });

  it('refuses the call for a refusal that is not a taken key', () => {
    expect(() =>
      admitImportKeys(state(), [{ languageCode: 'pl-PL', channelId: GONE, key: 'x' }]),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.SCOPE_INVALID }));
  });

  it("admits one key at two of the product's own scopes in one call", () => {
    const { outcomes } = admitImportKeys(state(), [
      { languageCode: 'pl-PL', channelId: null, key: 'same' },
      { languageCode: 'pl-PL', channelId: B2B, key: 'same' },
    ]);
    expect(outcomes).toEqual([{ written: true }, { written: true }]);
  });
});
