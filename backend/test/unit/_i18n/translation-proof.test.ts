import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_TRANSLATION_KEYS } from '../../../src/modules/_i18n/services/error-translation.js';
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
 * So the properties are asserted against the real routing table and the real
 * bundles, not restated:
 *
 *   1. it routes to the module the constant names, so the proof still walks the
 *      `_i18n` → `core` namespace rename that sits between the two;
 *   2. it is routed by **explicit** membership rather than by fall-through, so
 *      no future `startsWith` family rule can capture it;
 *   3. its sentence exists in the routed bundle in **both** shipped languages;
 *   4. its sentence exists in **no other** bundle — an uncontested code is one
 *      no ownership ruling under D-121 can ever re-point.
 */

const MODULES_ROOT = fileURLToPath(new URL('../../../src/modules/', import.meta.url));
const LANGUAGES = ['en', 'pl'] as const;

/** `ERROR_TRANSLATION_KEYS` names the owning module; `core` is not a directory. */
const CORE_BUNDLE_DIRECTORY = '_i18n';

function bundle(directory: string, language: string): Record<string, unknown> {
  const path = join(MODULES_ROOT, directory, 'i18n', `${language}.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function moduleDirectories(): string[] {
  return readdirSync(MODULES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

describe('TRANSLATION_PROOF — the harness proves translation with a code nobody can claim', () => {
  const code = TRANSLATION_PROOF.key.replace(/^errors\./, '');
  const routed = ERROR_TRANSLATION_KEYS[code as keyof typeof ERROR_TRANSLATION_KEYS] as
    | { moduleId: string; key: string }
    | undefined;

  it('names a code the routing table knows', () => {
    expect(routed, `${code} is not in ERROR_CODES`).toBeDefined();
    expect(routed?.key).toBe(TRANSLATION_PROOF.key);
  });

  it('property 1 — routes to the module the constant names', () => {
    expect(routed?.moduleId).toBe(TRANSLATION_PROOF.moduleId);
  });

  /**
   * Property 2, checked the only way a caller can: a code routed by
   * fall-through and a code routed by an explicit set are indistinguishable in
   * the table's output, so what is asserted is the consequence — no prefix rule
   * in the function can match this code, because none of the codes sharing its
   * first token route anywhere else. A future `startsWith` rule that captured
   * it would have to move it off `core`, which property 1 already refuses.
   */
  it('property 2 — no family prefix in the table claims it', () => {
    const prefix = `${code.split('_')[0]}_`;
    const family = Object.entries(ERROR_TRANSLATION_KEYS).filter(([other]) =>
      other.startsWith(prefix),
    );
    expect(family.length).toBeGreaterThan(0);
    for (const [other, target] of family) {
      expect(
        target.moduleId,
        `${other} shares the "${prefix}" prefix and routes to ${target.moduleId}, ` +
          `so a family rule for it would capture the proof code too`,
      ).toBe('core');
    }
  });

  it.each(LANGUAGES)('property 3 — the routed bundle has the sentence in %s', (language) => {
    const directory =
      routed?.moduleId === 'core' ? CORE_BUNDLE_DIRECTORY : (routed?.moduleId ?? '');
    const value = bundle(directory, language)[TRANSLATION_PROOF.key];
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
    const routedDirectory =
      routed?.moduleId === 'core' ? CORE_BUNDLE_DIRECTORY : (routed?.moduleId ?? '');
    const elsewhere: string[] = [];
    for (const directory of moduleDirectories()) {
      if (directory === routedDirectory) continue;
      for (const language of LANGUAGES) {
        if (TRANSLATION_PROOF.key in bundle(directory, language)) {
          elsewhere.push(`${directory}/i18n/${language}.json`);
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
    expect(moduleDirectories().length).toBeGreaterThan(40);
    expect(Object.keys(bundle(CORE_BUNDLE_DIRECTORY, 'en')).length).toBeGreaterThan(0);
  });
});
