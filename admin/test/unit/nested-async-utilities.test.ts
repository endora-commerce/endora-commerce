/**
 * No async utility of this suite waits inside another one.
 *
 * Testing Library's `waitFor` retries its callback on an interval until a
 * budget expires — but only while nothing is in flight: `checkCallback` opens
 * with `if (promiseStatus === 'pending') return;`, so every tick is skipped for
 * as long as the callback's own promise is unsettled
 * (`@testing-library/dom/dist/wait-for.js`). Put an `await` inside that
 * callback and the retry loop is dead code: the wrapper gets **one** attempt,
 * inside a deadline it shares with whatever it is awaiting, and on expiry it
 * reports a bare `Timed out in waitFor` in place of the inner utility's
 * diagnostic — the half that names the element that never arrived.
 *
 * Both spellings this tree grew were intermittent reds under load rather than
 * defects anybody could see in isolation, and both retire by deleting the
 * wrapper rather than by raising anything:
 *
 *  - `waitFor(async () => { await route.component(); … })` — six copies of one
 *    module-owned-surface test, putting a wall-clock deadline on vite-node
 *    transforming a screen's module graph on demand. A dynamic import is not a
 *    DOM observation and wants no retry; `await` it.
 *  - `waitFor(async () => expect((await options()).…))`, where `options()`
 *    reaches a `findByText` — a `findBy*` **is** a `waitFor`. Await it alone.
 *
 * The population is every test file the suite runs, and it is reconciled
 * against the vitest configuration's own `include` globs rather than trusted:
 * a walk this file narrows, or a configuration that widens past it, fails here
 * instead of leaving part of the tree unjudged (issues #113 / #215).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** What the walk below implements, stated so the configuration can contradict it. */
const WALKED_PATTERNS = ['test/**/*.test.ts', 'test/**/*.test.tsx'];

/** The `include` globs the suite actually runs, read from the configuration's source. */
function configuredIncludePatterns(): string[] {
  const source = readFileSync(path.join(adminRoot, 'vitest.config.ts'), 'utf8');
  const block = /\binclude:\s*\[([^\]]*)\]/.exec(source);
  if (!block) throw new Error('admin/vitest.config.ts declares no `include` — nothing to reconcile.');
  return [...block[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

/**
 * This file, which is out of its own population by construction: its job is to
 * spell the shapes the rule refuses, in a doc comment and in a regex. One exact
 * path and never a filename rule (issue #197).
 */
const THE_RULE_ITSELF = 'test/unit/nested-async-utilities.test.ts';

/** Every `*.test.ts(x)` under `admin/test`, repo-relative to the admin root. */
function walkTestFiles(directory = 'test'): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(adminRoot, directory), { withFileTypes: true })) {
    const relativePath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walkTestFiles(relativePath));
    else if (/\.test\.tsx?$/.test(entry.name) && relativePath !== THE_RULE_ITSELF) {
      found.push(relativePath);
    }
  }
  return found;
}

/** The argument text of every `waitFor(` call in `source`, brackets balanced. */
function waitForArguments(source: string): { text: string; index: number }[] {
  const found: { text: string; index: number }[] = [];
  const call = /\bwaitFor\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(source)) !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let index = start;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      index += 1;
    }
    found.push({ text: source.slice(start, index - 1), index: start });
  }
  return found;
}

/** Everything a `waitFor` callback must not itself wait on. */
const INNER_UTILITY = /\b(?:findBy|findAllBy|waitFor|waitForElementToBeRemoved)/;

/** `file:line` for every `waitFor` whose callback waits on a promise of its own. */
function nestedAsyncUtilities(file: string, source: string): string[] {
  return waitForArguments(source)
    .filter(({ text }) => /^\s*async\b/.test(text) || INNER_UTILITY.test(text))
    .map(({ index }) => `${file}:${source.slice(0, index).split('\n').length}`);
}

describe('the admin suite nests no async utility inside a waitFor', () => {
  it('judges every file the vitest configuration runs', () => {
    expect(configuredIncludePatterns()).toEqual(WALKED_PATTERNS);
    expect(walkTestFiles().length).toBeGreaterThan(0);
  });

  it('has no waitFor that waits on a promise of its own', () => {
    const findings = walkTestFiles()
      .flatMap((file) =>
        nestedAsyncUtilities(file, readFileSync(path.join(adminRoot, file), 'utf8')),
      )
      .sort();
    expect(findings).toEqual([]);
  });
});

describe('the rule can go red', () => {
  // One proof per shape the rule claims to refuse, entering at the top of the
  // analysis as source text — a green over a detector that never ran is the
  // failure this pair exists to make impossible.
  it('reports an async callback', () => {
    const source = ['await waitFor(async () => {', '  await route.component();', '});'].join('\n');
    expect(nestedAsyncUtilities('f.test.tsx', source)).toEqual(['f.test.tsx:1']);
  });

  it('reports a synchronous callback that returns another async utility', () => {
    const source = 'await waitFor(() => screen.findByText("x"));';
    expect(nestedAsyncUtilities('f.test.tsx', source)).toEqual(['f.test.tsx:1']);
  });

  it('leaves an ordinary synchronous callback alone', () => {
    const source = 'await waitFor(() => expect(screen.queryByText("x")).toBeTruthy());';
    expect(nestedAsyncUtilities('f.test.tsx', source)).toEqual([]);
  });
});
