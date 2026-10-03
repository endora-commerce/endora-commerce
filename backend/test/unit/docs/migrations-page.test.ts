import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The migrations architecture page names places in the tree, and a page cannot
 * notice that a place has moved.
 *
 * Each case here takes one thing the page tells an engineer to open and asks
 * the file system whether it is there. The page has an English source and a
 * Polish materialisation, and both are read: a path is the same in either
 * language, and the two are edited by hand, so one can be corrected while the
 * other keeps sending its readers somewhere else.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../../..');

const PAGES = [
  'docs/docs/architecture/migrations.md',
  'docs/i18n/pl/docusaurus-plugin-content-docs/current/architecture/migrations.md',
] as const;

function read(page: string): string {
  return readFileSync(resolve(repositoryRoot, page), 'utf8');
}

describe.each(PAGES)('migrations page — %s', (page) => {
  const text = read(page);

  it('quotes a foreign-key violation whose manifest path is on disk', () => {
    // The page reproduces the message `fk-dependency-drift.test.ts` prints, so
    // the manifest it shows is the one a refused author goes looking for.
    const quoted = /\[fk-drift\][\s\S]*?\(transitively\) in (\S+)\.\n/.exec(text)?.[1];
    expect(quoted, 'the page no longer quotes the [fk-drift] message').toBeDefined();
    expect(existsSync(resolve(repositoryRoot, quoted!)), `${quoted} is not on disk`).toBe(true);
  });
});
