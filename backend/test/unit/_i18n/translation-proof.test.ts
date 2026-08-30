import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { TRANSLATION_PROOF } from '../../helpers/translation-proof.js';

/**
 * Feature 082, D-126 — the harness's translation proof is not free to pick, and
 * this file is what makes that true.
 *
 * `assertErrorTranslationsInstalled` refuses to hand back a server whose error
 * messages cannot be translated, by resolving one constant key. That makes the
 * constant load-bearing for the whole suite, and it has exactly four properties
 * it must keep. Before this file they were a comment — a careful, reasoned and
 * wrong one: it named `CART_EMPTY`, arguing the code was uncontested, while a
 * finished sentence for it sat in `carts` and issue #231 was about to route the
 * family there. A correct tree would then have failed this assertion and
 * reported a broken harness where there was none.
 *
 * So the properties are asserted against the real routing map and the real
 * bundles, not restated:
 *
 *   1. it routes to the module the constant names, so the proof still walks the
 *      `_i18n` → `core` namespace rename that sits between the two;
 *   2. its whole code family is declared by that same module, so D-129's
 *      re-routing sweep cannot take the proof code without taking the family
 *      with it — a change nobody could make by accident;
 *   3. its sentence exists in the routed bundle in **both** shipped languages;
 *   4. its sentence exists in **no other** bundle — an uncontested code is one
 *      no ownership ruling under D-121 can ever re-point.
 */

const LANGUAGES = ['en', 'pl'] as const;

/**
 * Every registered module's own directory, by id (feature 080, T040b).
 *
 * This was `readdirSync('src/modules')`, and property 4 is the assertion that
 * makes the difference matter: it asks whether **any other bundle in the tree**
 * writes the proof key, and a listing of one root stopped seeing a module the
 * moment it became a package. The sweep would have narrowed the population one
 * module at a time while the assertion went on passing — issue #215 inside a
 * test, with the floor below it counting the same shrinking set.
 *
 * `dirname(entry.filePath)` is what the `_i18n` boot reconciler joins
 * `bundlesDir` to, so this reads bundles from the place production reads them,
 * for a module in the application tree and a module in a package alike.
 */
function moduleDirectories(): Map<string, string> {
  return new Map(
    REGISTERED_MANIFESTS.map((entry) => [entry.manifest.id, dirname(entry.filePath)] as const),
  );
}

function bundle(directory: string, language: string): Record<string, unknown> {
  const path = join(directory, 'i18n', `${language}.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function bundleOf(moduleId: string, language: string): Record<string, unknown> {
  const directory = moduleDirectories().get(moduleId);
  if (directory === undefined) return {};
  return bundle(directory, language);
}

describe('TRANSLATION_PROOF — the harness proves translation with a code nobody can claim', () => {
  const code = TRANSLATION_PROOF.key.replace(/^errors\./, '');
  const routed = DECLARED_ERROR_TRANSLATION_TARGETS[code];

  it('names a code some module declares', () => {
    expect(routed, `no module declares ${code}`).toBeDefined();
    expect(routed?.key).toBe(TRANSLATION_PROOF.key);
  });

  it('property 1 — routes to the module the constant names', () => {
    expect(routed?.moduleId).toBe(TRANSLATION_PROOF.moduleId);
  });

  /**
   * Property 2. Until feature 090's Phase 4 this asked whether a `startsWith`
   * rule in the prefix chain could capture the code; there is no chain and no
   * fall-through any more, so every code reaches its bundle by being named in
   * exactly one manifest. What is worth asserting instead is the **family**: if
   * D-129's re-routing sweep ever moves `VERSION_CONFLICT` off the platform
   * block, it moves every `VERSION_*` code with it, and this goes red beside
   * property 1 rather than the proof quietly resolving somewhere else.
   */
  it('property 2 — its whole family is declared by the one module', () => {
    const prefix = `${code.split('_')[0]}_`;
    const family = Object.entries(DECLARED_ERROR_TRANSLATION_TARGETS).filter(([other]) =>
      other.startsWith(prefix),
    );
    expect(family.length).toBeGreaterThan(0);
    for (const [other, target] of family) {
      expect(
        target.moduleId,
        `${other} shares the "${prefix}" prefix and routes to ${target.moduleId}, ` +
          'so the family is split and the proof code is one ownership ruling from moving',
      ).toBe(TRANSLATION_PROOF.moduleId);
    }
  });

  it.each(LANGUAGES)('property 3 — the routed bundle has the sentence in %s', (language) => {
    const directory = routed?.moduleId ?? '';
    const value = bundleOf(directory, language)[TRANSLATION_PROOF.key];
    expect(typeof value, `${directory}/i18n/${language}.json has no ${TRANSLATION_PROOF.key}`).toBe(
      'string',
    );
    expect((value as string).length).toBeGreaterThan(0);
  });

  /**
   * Property 4 is the one the replaced constant failed, so it is asserted over
   * every bundle in the tree rather than over a list of likely claimants.
   */
  it('property 4 — the key is spelled in no other bundle', () => {
    const routedDirectory = routed?.moduleId ?? '';
    const elsewhere: string[] = [];
    for (const [moduleId, directory] of moduleDirectories()) {
      if (moduleId === routedDirectory) continue;
      for (const language of LANGUAGES) {
        if (TRANSLATION_PROOF.key in bundle(directory, language)) {
          elsewhere.push(`${moduleId}/i18n/${language}.json`);
        }
      }
    }
    expect(
      elsewhere,
      `${TRANSLATION_PROOF.key} is contested — a second bundle writes it, so an ` +
        `ownership ruling could re-point the code and break the harness`,
    ).toEqual([]);
  });

  it('the walk read something — a bundle-free tree would pass every assertion above', () => {
    expect(moduleDirectories().size).toBe(REGISTERED_MANIFESTS.length);
    expect(moduleDirectories().size).toBeGreaterThan(40);
    expect(Object.keys(bundleOf(TRANSLATION_PROOF.moduleId, 'en')).length).toBeGreaterThan(0);
  });
});
