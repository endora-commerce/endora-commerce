/**
 * Every demo reset body in this repository writes through the `EntityManager`
 * it is handed (issue #143).
 *
 * A `demo reset` is one transaction, opened by the dispatcher and handed to the
 * composition and to each module's `demo.reset` as its `emFactory()`
 * (`packages/platform/src/demo/reset-transaction.ts`). A body that takes a
 * connection of its own instead writes outside that transaction and waits on
 * the rows it has locked. The platform refuses that at run time; this file
 * refuses it before a run, by reading the sources — which is the only place a
 * body nobody has executed yet can be caught.
 *
 * The population is derived: every `demo/reset.ts` under a module package, and
 * every source file of the demo composition. A module that grows a reset body
 * joins by existing.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const MODULES_ROOT = join(REPO_ROOT, 'packages', 'modules');
const COMPOSITION_SRC = join(REPO_ROOT, 'packages', 'demo-composition', 'src');

/** Comments describe the forbidden calls; only code is held to the rule. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** The ways a body gets a connection that is not the reset's. */
const OWN_CONNECTION: readonly [RegExp, string][] = [
  [/\.getConnection\s*\(/, 'em.getConnection()'],
  [/\.getKnex\s*\(/, 'em.getKnex()'],
  [/\.fork\s*\(/, 'em.fork()'],
  [/\.getDriver\s*\(/, 'em.getDriver()'],
];

const resetBodies = readdirSync(MODULES_ROOT)
  .map((moduleId) => join(MODULES_ROOT, moduleId, 'src', 'backend', 'demo', 'reset.ts'))
  .filter((path) => existsSync(path));

const compositionSources = readdirSync(COMPOSITION_SRC)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => join(COMPOSITION_SRC, name));

describe('demo reset bodies stay inside the transaction they are handed (issue #143)', () => {
  it('finds the bodies it is about', () => {
    // A derivation that found nothing would pass everything below.
    expect(resetBodies.length).toBeGreaterThanOrEqual(9);
    expect(compositionSources.map((path) => path.split('/').pop())).toEqual(
      expect.arrayContaining(['composition.ts', 'demo-usage.ts', 'sales-pipeline.ts']),
    );
  });

  it.each(resetBodies.map((path) => [path.slice(REPO_ROOT.length + 1), path]))(
    '%s takes its EntityManager from the cradle once and no connection of its own',
    (_label, path) => {
      const source = code(path);
      for (const [pattern, name] of OWN_CONNECTION) expect(source, name).not.toMatch(pattern);
      // One `emFactory()`, the one the dispatcher answers with the reset's
      // transaction. A second would be a second EntityManager only by luck.
      expect(source.match(/\bemFactory\s*\(\s*\)/g) ?? []).toHaveLength(1);
    },
  );

  it.each(compositionSources.map((path) => [path.slice(REPO_ROOT.length + 1), path]))(
    '%s sends every statement through the EntityManager it was built over',
    (_label, path) => {
      const source = code(path);
      for (const [pattern, name] of OWN_CONNECTION) expect(source, name).not.toMatch(pattern);
      expect(source).not.toMatch(/\bemFactory\b/);
    },
  );
});
