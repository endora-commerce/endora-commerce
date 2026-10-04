import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * An operator command is written in the form an **instance** can run.
 *
 * `pnpm --filter backend run cli …` is the form for a checkout of this
 * repository. A scaffolded instance names its backend member
 * `<instance>-backend`, so there the filter matches no project: pnpm prints
 * `No projects matched the filters` and **exits 0** having run nothing. The
 * order repair command of `specs/142-order-transition-atomicity/` was
 * documented in that form only, and an operator following it after an upgrade
 * read a clean exit as "nothing is stranded".
 *
 * So wherever a published text names the repository form of a module's
 * operator command, the instance form — `pnpm run cli …`, run in the instance
 * root — has to be on the same page. A pending changeset is held to the
 * wider rule, any `pnpm --filter backend`, because its body becomes a
 * package's `CHANGELOG.md` and every reader of that file has an instance.
 */
const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

const REPOSITORY_CLI_FORM = 'pnpm --filter backend run cli';
const REPOSITORY_FORM = 'pnpm --filter backend';
const INSTANCE_CLI_FORM = 'pnpm run cli';
const INSTANCE_FORM = /pnpm run [a-z]/;

/**
 * Pages whose only reader works in a checkout of this repository. Each entry
 * says why; a page an operator of an instance follows does not belong here.
 */
const CHECKOUT_ONLY_PAGES: ReadonlyMap<string, string> = new Map([
  [
    'docs/docs/operations/warden.md',
    'the Warden development environment for a checkout of this repository',
  ],
]);

function markdownUnder(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules') continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...markdownUnder(path));
    else if (name.endsWith('.md') || name.endsWith('.mdx')) found.push(path);
  }
  return found;
}

function docsPages(): string[] {
  const modulesRoot = join(REPO_ROOT, 'packages/modules');
  const moduleDocs = readdirSync(modulesRoot)
    .map((id) => join(modulesRoot, id, 'docs'))
    .filter((directory) => statSync(directory, { throwIfNoEntry: false })?.isDirectory() === true);
  return [join(REPO_ROOT, 'docs/docs'), ...moduleDocs]
    .flatMap(markdownUnder)
    .map((path) => relative(REPO_ROOT, path))
    .sort();
}

function pendingChangesets(): string[] {
  const directory = join(REPO_ROOT, '.changeset');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => join('.changeset', name))
    .sort();
}

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

describe('operator commands are written in the form an instance can run', () => {
  it('finds the pages it is meant to hold', () => {
    expect(docsPages().length).toBeGreaterThan(50);
    expect(docsPages()).toContain('packages/modules/orders/docs/orders.md');
    expect(docsPages()).toContain('docs/docs/module-reference/orders.md');
  });

  it('no docs page names the repository form of a module command without the instance form', () => {
    const offenders = docsPages().filter((path) => {
      if (CHECKOUT_ONLY_PAGES.has(path)) return false;
      const text = read(path);
      return text.includes(REPOSITORY_CLI_FORM) && !text.includes(INSTANCE_CLI_FORM);
    });
    expect(offenders).toEqual([]);
  });

  it('no pending changeset names a repository-only command without the instance form', () => {
    const offenders = pendingChangesets().filter((path) => {
      const text = read(path);
      return text.includes(REPOSITORY_FORM) && !INSTANCE_FORM.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('every exempted page still exists and still names the repository form', () => {
    for (const path of CHECKOUT_ONLY_PAGES.keys()) {
      expect(read(path), path).toContain(REPOSITORY_CLI_FORM);
    }
  });
});
