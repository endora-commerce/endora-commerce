import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildErrorTranslationTargets,
  describeErrorCodeCollisions,
  type ErrorCodeDeclarationSource,
} from '@endora-commerce/mod-i18n/backend';
import { packageModuleManifestsUnder } from '../../../src/packages/package-runtime.js';

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

/**
 * The instance path — `plan.md` Phase 2: *"the instance path with a fixture
 * installed package"*.
 *
 * The population the derivation exists for is the one no file in this repository
 * can hold: a module package an operator installed. This drives the same
 * discovery the composition roots drive — a `node_modules` tree on disk,
 * enumerated, `exports`-resolved and imported by `package-runtime.ts` — and
 * feeds what comes out of it straight into the derived map, because the entry
 * shape `resolvedManifestEntries()` produces **is**
 * `ErrorCodeDeclarationSource`'s. A fixture handed to the derivation as a
 * literal would prove the function and not the seam.
 *
 * It lived in `error-code-composition.test.ts` until feature 090's Phase 4,
 * beside the proofs for `composeErrorTranslationTargets` — the transitional
 * function that laid these declarations over the prefix chain. That function and
 * the chain are gone; this seam is not, so it moved here rather than going with
 * them.
 */
describe("an installed package's declaration reaches the derived map", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'endora-error-code-package-'));
    const dir = join(root, 'node_modules', '@vendor', 'mod-acme-sync');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify(
        {
          name: '@vendor/mod-acme-sync',
          version: '1.0.0',
          type: 'module',
          endora: { type: 'module', id: 'acme_sync', platform: '0.x' },
          exports: { '.': './lib/manifest.js', './package.json': './package.json' },
        },
        null,
        2,
      )}\n`,
    );
    mkdirSync(join(dir, 'lib'), { recursive: true });
    // A published manifest is a plain object: a third-party author has no
    // `@endora-commerce/contracts` to import at runtime.
    writeFileSync(
      join(dir, 'lib', 'manifest.js'),
      [
        'export const manifest = {',
        "  id: 'acme_sync',",
        "  name: 'Acme Sync',",
        "  version: '1.0.0',",
        '  errorCodes: [',
        "    { code: 'ACME_SYNC_NOT_CONFIGURED' },",
        "    { code: 'ACME_SYNC_REJECTED', tokens: ['expired', 'quota'] },",
        '  ],',
        '};',
        'export default manifest;',
        '',
      ].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("routes both of the package's codes to it, and invents nothing else", async () => {
    const discovered = await packageModuleManifestsUnder([join(root, 'node_modules')]);
    expect(discovered.map((entry) => entry.id)).toEqual(['acme_sync']);

    const { targets, collisions } = buildErrorTranslationTargets(discovered);

    expect(targets['ACME_SYNC_NOT_CONFIGURED']).toEqual({
      moduleId: 'acme_sync',
      key: 'errors.ACME_SYNC_NOT_CONFIGURED',
    });
    expect(targets['ACME_SYNC_REJECTED']).toEqual({
      moduleId: 'acme_sync',
      key: 'errors.ACME_SYNC_REJECTED',
    });
    expect(collisions).toEqual([]);
    // The declaring file is the package's own `package.json`, which is what a
    // collision report has to name for an operator to find it on disk.
    expect(discovered[0]?.filePath).toContain(join('mod-acme-sync', 'package.json'));
    // Only the package's own two codes: the derivation has no fall-through and
    // nothing else was handed in, so a third entry would mean the map had
    // acquired an answer from somewhere this call cannot see (§4.1).
    expect(Object.keys(targets).sort()).toEqual([
      'ACME_SYNC_NOT_CONFIGURED',
      'ACME_SYNC_REJECTED',
    ]);
  });
});
