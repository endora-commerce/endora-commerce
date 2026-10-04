import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverModulePackages } from '../../../scripts/lib/module-packages.js';

/**
 * A manifest's `errorCodes` block is explained in a comment, and the comment is
 * what an author reads while deciding where a code goes.
 *
 * Those comments name symbols — a ledger, a routing function, a set of codes —
 * as the reason a declaration is where it is. A symbol that has been deleted
 * still reads as a live reference: the reader greps it, finds nothing, and
 * cannot tell history from a typo. Six manifests did exactly that with the
 * names of a routing chain that no longer exists.
 *
 * So the names are derived from the comments and each is held to having a
 * declaration somewhere in the tree. Nothing here lists a symbol: a deleted one
 * reddens the manifest that still names it, and a new one is covered the day it
 * is first written between backticks.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../../..');

/** An identifier, between backticks, that is about error-code routing by its name. */
const NAMED_SYMBOL = /`([A-Za-z_][A-Za-z0-9_]*)`/g;
const ABOUT_ERROR_CODES = /ERROR_CODES|ErrorCode|ERROR_TRANSLATION|ErrorTranslation/;

/** A repository path into the test tree, between backticks. */
const NAMED_TEST_PATH = /`(backend\/test\/[A-Za-z0-9_./@-]+)`/g;

const manifests = discoverModulePackages(repositoryRoot).map((pkg) => ({
  moduleId: pkg.moduleId,
  file: join(pkg.dir, 'src', 'manifest.ts'),
}));

function typeScriptUnder(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) typeScriptUnder(path, found);
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(path);
  }
  return found;
}

describe('module manifests — error-code commentary names what exists', () => {
  it('reads a manifest for every module package', () => {
    expect(manifests.length).toBeGreaterThan(0);
    expect(manifests.filter((manifest) => !existsSync(manifest.file))).toEqual([]);
  });

  it('names no error-code symbol that is declared nowhere', () => {
    const namedBy = new Map<string, string[]>();
    for (const manifest of manifests) {
      for (const [, symbol] of readFileSync(manifest.file, 'utf8').matchAll(NAMED_SYMBOL)) {
        if (!ABOUT_ERROR_CODES.test(symbol!)) continue;
        namedBy.set(symbol!, [...(namedBy.get(symbol!) ?? []), manifest.moduleId]);
      }
    }
    // Non-vacuity: the population is the comments', and they do name some.
    expect(namedBy.size).toBeGreaterThan(0);

    const undeclared = new Set(namedBy.keys());
    const declaration = new RegExp(
      `\\b(?:const|function|type|interface|class|enum)\\s+(${[...undeclared].join('|')})\\b`,
      'g',
    );
    const sources = ['packages', 'backend/src', 'backend/scripts', 'backend/test'].flatMap((root) =>
      typeScriptUnder(join(repositoryRoot, root)),
    );
    for (const source of sources) {
      if (undeclared.size === 0) break;
      for (const [, symbol] of readFileSync(source, 'utf8').matchAll(declaration)) {
        undeclared.delete(symbol!);
      }
    }

    expect(
      [...undeclared]
        .sort()
        .map((symbol) => `${symbol} — named by ${namedBy.get(symbol)!.join(', ')}`),
    ).toEqual([]);
  });

  it('cites no file in the test tree that is not there', () => {
    const missing: string[] = [];
    let cited = 0;
    for (const manifest of manifests) {
      for (const [, path] of readFileSync(manifest.file, 'utf8').matchAll(NAMED_TEST_PATH)) {
        cited += 1;
        if (!existsSync(join(repositoryRoot, path!.replace(/\.$/, '')))) {
          missing.push(`${relative(repositoryRoot, manifest.file).split(sep).join('/')}: ${path}`);
        }
      }
    }
    expect(cited).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
