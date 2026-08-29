import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  ERROR_TRANSLATION_KEYS,
  composeErrorTranslationTargets,
  type ErrorCodeDeclarationSource,
} from '@endora-commerce/mod-i18n/backend';
import { packageModuleManifestsUnder } from '../../../src/packages/package-runtime.js';

/**
 * Feature 090 Phase 2 — **the derivation runs beside the chain**
 * (`specs/090-module-owned-error-codes/plan.md`).
 *
 * `buildErrorTranslationTargets` is the end state: a map that is nothing but the
 * modules' own declarations. It cannot be injected on its own today, because no
 * module has migrated yet and the map would be empty — every operator-visible
 * sentence in both shipped languages would stop being found, at once, for the
 * length of the migration.
 *
 * `composeErrorTranslationTargets` is the shape that permits the migration to be
 * per module (FR-044): the incumbent chain answers for a code nobody has
 * declared yet, a declaration answers for a code its owner has, and the two are
 * asserted equal over the whole enumeration on every one of the eighteen merge
 * requests (`error-code-routing-equality.test.ts`).
 *
 * Three rules, and each has a red proof below because each can be got wrong in a
 * way nothing else would see:
 *
 *  1. **A declaration wins over the chain.** The alternative — chain first — is
 *     the one arrangement in which a wrong declaration is invisible: the answer
 *     would not move until the chain is deleted, which is the last merge request
 *     of the migration and the worst place to discover it.
 *  2. **The chain answers for an undeclared code.** That is the whole reason
 *     this function exists rather than the roots injecting the derivation.
 *  3. **A contested code is absent, chain or no chain.** `contracts/error-code-declaration.md`
 *     §3.1 rule 1 says a code more than one module declares routes to none of
 *     them, and §3.4 refuses origin precedence by name. Letting the incumbent
 *     answer for a contested code *is* origin precedence — the platform's own
 *     table outranking a stranger's claim — and it renders one raiser's
 *     condition under the other's sentence, which is the one failure nobody can
 *     detect.
 *
 * Every proof enters at the top of the analysis (issue #130): the input is a
 * list of manifests, which is the only input the function has. Nothing here
 * builds a `targets` map and asks the function to agree with it.
 */
function source(
  id: string,
  codes: readonly string[],
  filePath = `/packages/modules/${id}/src/manifest.ts`,
): ErrorCodeDeclarationSource {
  return { manifest: { id, errorCodes: codes.map((code) => ({ code })) }, filePath };
}

describe('composeErrorTranslationTargets — the derivation beside the chain (feature 090)', () => {
  it('answers the chain for every code while no module declares anything', () => {
    const { targets, collisions } = composeErrorTranslationTargets([]);

    expect(Object.keys(targets).sort()).toEqual(Object.keys(ERROR_TRANSLATION_KEYS).sort());
    for (const [code, target] of Object.entries(ERROR_TRANSLATION_KEYS)) {
      expect(targets[code]).toEqual(target);
    }
    expect(collisions).toEqual([]);
  });

  it('lets a declaration win over the chain, so a wrong one is visible the day it lands', () => {
    // `CART_EMPTY` is `carts`' by the chain (issue #231). A module declaring it
    // moves the answer immediately — which is what makes the equality harness
    // able to report `rerouted` during the migration rather than at the end of
    // it.
    const chained = ERROR_TRANSLATION_KEYS[ERROR_CODES.CART_EMPTY];
    expect(chained.moduleId).toBe('carts');

    const { targets } = composeErrorTranslationTargets([
      source('not_carts', [ERROR_CODES.CART_EMPTY]),
    ]);

    expect(targets[ERROR_CODES.CART_EMPTY]).toEqual({
      moduleId: 'not_carts',
      key: `errors.${ERROR_CODES.CART_EMPTY}`,
    });
  });

  it('keeps the chain answer for every code the declaring module did not claim', () => {
    const { targets } = composeErrorTranslationTargets([
      source('carts', [ERROR_CODES.CART_EMPTY]),
    ]);

    expect(targets[ERROR_CODES.ORDER_NOT_FOUND]).toEqual(
      ERROR_TRANSLATION_KEYS[ERROR_CODES.ORDER_NOT_FOUND],
    );
    expect(Object.keys(targets)).toHaveLength(Object.keys(ERROR_TRANSLATION_KEYS).length);
  });

  it('routes a code the chain never heard of, which is the whole point of the derivation', () => {
    const { targets } = composeErrorTranslationTargets([
      source('acme_sync', ['ACME_SYNC_NOT_CONFIGURED']),
    ]);

    expect(targets['ACME_SYNC_NOT_CONFIGURED']).toEqual({
      moduleId: 'acme_sync',
      key: 'errors.ACME_SYNC_NOT_CONFIGURED',
    });
    expect(Object.keys(targets)).toHaveLength(Object.keys(ERROR_TRANSLATION_KEYS).length + 1);
  });

  it('drops a contested code the chain routes — the incumbent is not a tie-break', () => {
    const contested = ERROR_CODES.CART_EMPTY;
    const { targets, collisions } = composeErrorTranslationTargets([
      source('carts', [contested]),
      source('acme_sync', [contested]),
    ]);

    // Absent, not `carts` and not `acme_sync`. Falling back on the chain here
    // would be the origin precedence §3.4 refuses: the platform's own table
    // silently beating a claim it cannot see.
    expect(targets[contested]).toBeUndefined();
    expect(collisions.map((collision) => collision.code)).toEqual([contested]);
    expect(collisions[0]?.claims.map((claim) => claim.moduleId)).toEqual(['acme_sync', 'carts']);
  });

  it('reports the collisions from the same call that produced the routing (D-100)', () => {
    const composed = composeErrorTranslationTargets([
      source('a_module', ['SHARED_CODE']),
      source('b_module', ['SHARED_CODE']),
    ]);

    // One call, two halves. A second entry point for the report is a second
    // derivation, and two derivations of one fact come to disagree.
    expect(composed.targets['SHARED_CODE']).toBeUndefined();
    expect(composed.collisions).toHaveLength(1);
  });

  it('does not depend on the order the manifests arrive in', () => {
    const forward = composeErrorTranslationTargets([
      source('a_module', ['A_CODE']),
      source('b_module', ['B_CODE']),
    ]);
    const backward = composeErrorTranslationTargets([
      source('b_module', ['B_CODE']),
      source('a_module', ['A_CODE']),
    ]);

    expect(forward).toEqual(backward);
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
 * feeds what comes out of it straight into the composed map, because the entry
 * shape `resolvedManifestEntries()` produces **is**
 * `ErrorCodeDeclarationSource`'s. A fixture handed to the derivation as a
 * literal would prove the function and not the seam.
 */
describe('an installed package\'s declaration reaches the composed map', () => {
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

  it('routes both of the package\'s codes to it, and moves no code the chain owns', async () => {
    const discovered = await packageModuleManifestsUnder([join(root, 'node_modules')]);
    expect(discovered.map((entry) => entry.id)).toEqual(['acme_sync']);

    const { targets, collisions } = composeErrorTranslationTargets(discovered);

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

    for (const [code, target] of Object.entries(ERROR_TRANSLATION_KEYS)) {
      expect(targets[code]).toEqual(target);
    }
  });
});
