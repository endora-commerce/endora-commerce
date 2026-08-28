import { describe, expect, it } from 'vitest';
import {
  buildErrorTranslationTargets,
  describeErrorCodeCollisions,
  type ErrorCodeDeclarationSource,
} from '@endora-commerce/mod-i18n/backend';

/**
 * Feature 090 — `contracts/error-code-declaration.md` §3, the collision rule:
 *
 * > **When more than one registered module declares the same code, the code
 * > routes to none of them. The platform names every claimant and keeps
 * > serving.**
 *
 * The proofs enter at the top: each one hands `buildErrorTranslationTargets` a
 * list of manifests, which is the only input it has. Nothing here constructs a
 * `targets` map or a `collisions` array and asks the function to agree with it —
 * a fixture that enters below the derivation cannot catch a derivation that
 * stopped running.
 *
 * "Nobody wins" is asserted in **both** halves each time, and that is the point
 * of the rule rather than thoroughness: a tie-break shows up as a code that is
 * still in `targets`, and a report nobody can act on shows up as a claimant that
 * is not named. Either alone reads as correct.
 */
function source(
  id: string,
  codes: readonly string[],
  filePath = `/packages/modules/${id}/src/manifest.ts`,
): ErrorCodeDeclarationSource {
  return { manifest: { id, errorCodes: codes.map((code) => ({ code })) }, filePath };
}

describe('buildErrorTranslationTargets — the declared routing map (feature 090)', () => {
  describe('routing', () => {
    it('routes a code to the module that declares it, at the key the envelope reads', () => {
      const { targets, collisions } = buildErrorTranslationTargets([
        source('carts', ['CART_EMPTY']),
      ]);
      expect(targets).toEqual({ CART_EMPTY: { moduleId: 'carts', key: 'errors.CART_EMPTY' } });
      expect(collisions).toEqual([]);
    });

    it('leaves a code no module declares out of the map — there is no fall-through', () => {
      // §4.1: a code no registered module declares is absent, not routed to
      // `core`. D-129's *"`core` is only ever reached by being named."*
      const { targets } = buildErrorTranslationTargets([source('carts', ['CART_EMPTY'])]);
      expect(targets['ORDER_NOT_FOUND']).toBeUndefined();
      expect(Object.keys(targets)).toEqual(['CART_EMPTY']);
    });

    it('routes a module-declared code the platform enumeration does not hold', () => {
      // The whole of D-182: a stranger's code is routable without any edit to a
      // file this repository ships.
      const { targets } = buildErrorTranslationTargets([
        source('acme_sync', ['ACME_SYNC_REJECTED']),
      ]);
      expect(targets['ACME_SYNC_REJECTED']).toEqual({
        moduleId: 'acme_sync',
        key: 'errors.ACME_SYNC_REJECTED',
      });
    });

    it('ignores a manifest that declares no codes at all', () => {
      const { targets, collisions } = buildErrorTranslationTargets([
        { manifest: { id: 'addresses' }, filePath: '/packages/modules/addresses/src/manifest.ts' },
        source('carts', ['CART_EMPTY']),
      ]);
      expect(Object.keys(targets)).toEqual(['CART_EMPTY']);
      expect(collisions).toEqual([]);
    });

    it('gives the same answer whatever order the manifests arrive in', () => {
      const a = source('carts', ['CART_EMPTY']);
      const b = source('orders', ['ORDER_NOT_FOUND']);
      expect(buildErrorTranslationTargets([a, b])).toEqual(buildErrorTranslationTargets([b, a]));
    });
  });

  describe('collision — nobody wins', () => {
    const claimants = [
      source('acme_sync', ['SYNC_FAILED'], '/opt/app/node_modules/@acme/sync/dist/manifest.js'),
      source('globex_feed', ['SYNC_FAILED'], '/opt/app/node_modules/@globex/feed/dist/manifest.js'),
    ];

    it('routes a contested code to neither claimant', () => {
      const { targets } = buildErrorTranslationTargets(claimants);
      expect(targets['SYNC_FAILED']).toBeUndefined();
    });

    it('names every claimant, by module id and by the file that declares it', () => {
      const { collisions } = buildErrorTranslationTargets(claimants);
      expect(collisions).toEqual([
        {
          code: 'SYNC_FAILED',
          claims: [
            {
              moduleId: 'acme_sync',
              declaredIn: '/opt/app/node_modules/@acme/sync/dist/manifest.js',
            },
            {
              moduleId: 'globex_feed',
              declaredIn: '/opt/app/node_modules/@globex/feed/dist/manifest.js',
            },
          ],
        },
      ]);
    });

    it('takes no tie-break from the order the manifests arrive in', () => {
      const forwards = buildErrorTranslationTargets(claimants);
      const backwards = buildErrorTranslationTargets([...claimants].reverse());
      expect(forwards).toEqual(backwards);
      expect(backwards.targets['SYNC_FAILED']).toBeUndefined();
    });

    it('takes no tie-break from a third claimant either', () => {
      const { targets, collisions } = buildErrorTranslationTargets([
        ...claimants,
        source('initech_sync', ['SYNC_FAILED']),
      ]);
      expect(targets['SYNC_FAILED']).toBeUndefined();
      expect(collisions[0]?.claims.map((c) => c.moduleId)).toEqual([
        'acme_sync',
        'globex_feed',
        'initech_sync',
      ]);
    });

    it('costs the claimants nothing on their other codes', () => {
      // A collision's blast radius is one sentence, which is §3.3's whole
      // argument for not refusing the boot.
      const { targets } = buildErrorTranslationTargets([
        source('acme_sync', ['SYNC_FAILED', 'ACME_SYNC_NOT_CONFIGURED']),
        source('globex_feed', ['SYNC_FAILED', 'GLOBEX_FEED_STALE']),
      ]);
      expect(Object.keys(targets).sort()).toEqual([
        'ACME_SYNC_NOT_CONFIGURED',
        'GLOBEX_FEED_STALE',
      ]);
    });

    it('reports collisions sorted by code, so two runs read the same', () => {
      const { collisions } = buildErrorTranslationTargets([
        source('acme_sync', ['SYNC_FAILED', 'PUSH_FAILED']),
        source('globex_feed', ['SYNC_FAILED', 'PUSH_FAILED']),
      ]);
      expect(collisions.map((c) => c.code)).toEqual(['PUSH_FAILED', 'SYNC_FAILED']);
    });

    it('describes a collision in words an operator can act on', () => {
      const described = describeErrorCodeCollisions(
        buildErrorTranslationTargets(claimants).collisions,
      );
      expect(described).toContain('"SYNC_FAILED" is declared by 2 modules');
      expect(described).toContain('acme_sync (/opt/app/node_modules/@acme/sync/dist/manifest.js)');
      expect(described).toContain(
        'globex_feed (/opt/app/node_modules/@globex/feed/dist/manifest.js)',
      );
    });
  });

  describe('the empty answer is an answer, not a refusal', () => {
    it('returns an empty map for a platform whose modules declare nothing', () => {
      // Deliberately not a throw. The derivation is a pure function and the
      // vacuity question belongs to its readers — the in-repository refusal
      // asks it of the registered set, and the check asks it of the tree.
      expect(buildErrorTranslationTargets([])).toEqual({ targets: {}, collisions: [] });
    });
  });
});
