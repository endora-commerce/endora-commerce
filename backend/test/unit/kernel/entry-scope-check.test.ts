import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  classify,
  declaredProgramEntryPoints,
  establishesScope,
  relative,
  stripCommentsAndStrings,
  violationsOf,
  staleAllowances,
  NO_SCOPE_NEEDED,
  type EntryPoint,
} from '../../../scripts/check-entry-scope.js';
import { findUngatedEntries } from '../../../scripts/check-entry-presence.js';

/**
 * The entry-scope check (feature 072, T037). Its own test has to prove it can go
 * **red**, because the tree is green by construction once T033–T036 land — a
 * check that only ever agrees with the current tree is indistinguishable from
 * one that returns `true`.
 */

const CLI = '/repo/backend/src/modules/search/scripts/reindex.ts';
const SERVICE = '/repo/backend/src/modules/search/services/indexer.ts';

/**
 * A repeating timer built out of `setTimeout`: the callback re-arms it. This is
 * the shape that made `interval=4` read as a full population while `search`'s
 * reindex loop — the same entry point, another constructor — was never counted.
 */
const SELF_RESCHEDULING = `
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleNext = (delayMs: number): void => {
    timer = setTimeout(tick, delayMs);
  };
  const tick = (): void => {
    void (async () => {
      await reindexWorker.reindex();
      scheduleNext(60_000);
    })();
  };
  scheduleNext(60_000);
`;

describe('classify', () => {
  it('treats anything under scripts/ as a CLI entry point', () => {
    expect(classify(CLI, 'export const x = 1;')).toBe('cli');
  });

  it('treats a BullMQ Worker construction as a worker entry point', () => {
    expect(classify(SERVICE, 'return new Worker<Job>(QUEUE, processor, options);')).toBe('worker');
  });

  it('treats a setInterval call as an interval entry point', () => {
    expect(classify(SERVICE, 'setInterval(() => sweep(), 1000);')).toBe('interval');
  });

  it('treats a self-rescheduling setTimeout as an interval entry point', () => {
    expect(classify(SERVICE, SELF_RESCHEDULING)).toBe('interval');
  });

  it('leaves a one-shot setTimeout alone — its execution already has a caller', () => {
    const deadline = `async function fetchWithTimeout(url: string) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try { return await fetch(url, { signal: controller.signal }); }
      finally { clearTimeout(timer); }
    }`;
    expect(classify(SERVICE, deadline)).toBeNull();
  });

  it('is not fooled by a comment quoting the pattern it looks for', () => {
    // Two files in the tree document this rule by quoting `new Worker(...)`.
    // Matching those made the check report the files that explain the invariant
    // as the files that break it.
    expect(classify(SERVICE, '// the scope goes at the `new Worker(...)` call site\n')).toBeNull();
  });

  it('says nothing about an ordinary service', () => {
    expect(classify(SERVICE, 'export class Indexer {}')).toBeNull();
  });
});

describe('declaredProgramEntryPoints', () => {
  const packageJson = (scripts: Record<string, string>): string =>
    JSON.stringify({ name: 'backend', scripts });

  it('reads the src files package.json runs as a process of their own', () => {
    expect(
      declaredProgramEntryPoints(packageJson({ dev: 'tsx watch --env-file-if-exists=.env src/index.ts' })),
    ).toEqual(['src/index.ts']);
  });

  it('finds the entry point behind a compound command', () => {
    // `seed:dev` is two commands joined by `&&`, and the entry point is the
    // second one. A rule that read the first word of the script would miss it —
    // which is the file this whole check went blind on.
    expect(
      declaredProgramEntryPoints(
        packageJson({
          'seed:dev':
            'pnpm run migration:up && tsx --env-file-if-exists=.env src/seeds/dev-catalog-seed.ts',
        }),
      ),
    ).toEqual(['src/seeds/dev-catalog-seed.ts']);
  });

  it('ignores a compiled entry point — this check reads sources, not dist', () => {
    expect(declaredProgramEntryPoints(packageJson({ start: 'node dist/index.js' }))).toEqual([]);
  });

  it('ignores a script that runs build tooling rather than the platform', () => {
    // `backend/scripts/` is not under `src/`, so the walk never sees it and a
    // declaration naming it would be a population entry with no file.
    expect(
      declaredProgramEntryPoints(packageJson({ 'check:entry-scope': 'tsx scripts/check-entry-scope.ts' })),
    ).toEqual([]);
  });

  it('says nothing about a package.json with no scripts at all', () => {
    expect(declaredProgramEntryPoints(JSON.stringify({ name: 'backend' }))).toEqual([]);
  });
});

describe('classify, given what package.json declares', () => {
  const DECLARED = new Set(['src/seeds/dev-catalog-seed.ts', 'src/modules/search/scripts/reindex.ts']);

  it('treats a declared src file under no scripts/ directory as a program entry point', () => {
    // The gap issue #228 is about: `src/seeds/dev-catalog-seed.ts` is a
    // top-level `main()` that truncates and repopulates a dozen modules'
    // tables, and the population defined by shape alone could not see it.
    expect(classify('/repo/backend/src/seeds/dev-catalog-seed.ts', 'main();', DECLARED)).toBe(
      'program',
    );
  });

  it('leaves a declared scripts/ file in the cli class', () => {
    expect(classify('/repo/backend/src/modules/search/scripts/reindex.ts', 'main();', DECLARED)).toBe(
      'cli',
    );
  });

  it('says nothing about a src file no package script runs', () => {
    expect(classify('/repo/backend/src/seeds/attribute-fixtures.ts', 'export const x = 1;', DECLARED)).toBeNull();
  });
});

describe('the real tree', () => {
  const backendRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const declared = new Set(
    declaredProgramEntryPoints(readFileSync(join(backendRoot, 'package.json'), 'utf8')),
  );

  it('declares the dev seed as a program this check has to see', () => {
    expect(declared).toContain('src/seeds/dev-catalog-seed.ts');
  });

  it('classifies the dev seed as an entry point rather than as an ordinary file', () => {
    const seed = join(backendRoot, 'src/seeds/dev-catalog-seed.ts');
    expect(classify(seed, readFileSync(seed, 'utf8'), declared)).toBe('program');
  });

  it('resolves every declared program to a file the walk can read', () => {
    // The population now has a second source, so it has a second way of going
    // quietly short: a package script renamed away from its file removes an
    // entry point from the population and nothing else notices.
    for (const path of declared) {
      expect(existsSync(join(backendRoot, path)), `${path} is declared but absent`).toBe(true);
    }
  });

  it('spells the exemptions the way `relative` reports a walked file', () => {
    for (const path of NO_SCOPE_NEEDED.keys()) {
      expect(relative(join(backendRoot, path))).toBe(path);
    }
  });
});

describe('establishesScope', () => {
  it('accepts either sanctioned entry function', () => {
    expect(establishesScope("enterSystemScope('cli: x', main);")).toBe(true);
    expect(establishesScope('enterPlatformScope(tenant, run);')).toBe(true);
  });

  it('rejects the widening helper — it widens an execution, it does not start one', () => {
    expect(establishesScope("withSystemScope('x', fn);")).toBe(false);
  });

  it('does not count a mention inside a comment or a string', () => {
    expect(establishesScope('// call enterSystemScope( here one day\n')).toBe(false);
    expect(establishesScope("const hint = 'enterSystemScope(';")).toBe(false);
  });
});

describe('stripCommentsAndStrings', () => {
  it('removes block comments, line comments and literals', () => {
    const stripped = stripCommentsAndStrings(
      ['/* new Worker( */', '// setInterval(', "const s = 'new Worker(';", 'real();'].join('\n'),
    );
    expect(stripped).not.toContain('new Worker(');
    expect(stripped).not.toContain('setInterval(');
    expect(stripped).toContain('real()');
  });

  it('leaves a protocol-relative URL alone rather than eating the rest of the line', () => {
    expect(stripCommentsAndStrings('const url = x + https + colon;')).toContain('colon');
  });
});

describe('the allow-list ratchet', () => {
  const entry = (file: string, scoped: boolean): EntryPoint => ({
    file: `/repo/backend/${file}`,
    kind: 'cli',
    scoped,
  });

  it('reports an unscoped entry point that is not allow-listed', () => {
    expect(violationsOf([entry('src/modules/search/scripts/reindex.ts', false)])).toHaveLength(1);
  });

  it('does not report an allow-listed one', () => {
    expect(violationsOf([entry('src/modules/_lifecycle/services/lock.ts', false)])).toEqual([]);
  });

  it('reports an allow-list entry that has since been scoped', () => {
    expect(staleAllowances([entry('src/modules/_lifecycle/services/lock.ts', true)])).toContain(
      'src/modules/_lifecycle/services/lock.ts',
    );
  });

  it('gives every exemption a written reason', () => {
    for (const [path, reason] of NO_SCOPE_NEEDED) {
      expect(reason.length, `${path} has no reason`).toBeGreaterThan(40);
    }
  });
});

describe('one recognizer, two checks', () => {
  // Both checks ask the same question — "does this file start a repeating
  // execution of its own?" — and answered it differently for a year: one by
  // grepping for `setInterval(`, the other by reading the callback. They now
  // share `findRepeatingTimerSites`, and this is what fails if a second
  // implementation grows back.
  const SEARCH_PLUGIN = 'src/modules/search/plugin.ts';
  const source = readFileSync(
    join(fileURLToPath(new URL('../../../', import.meta.url)), SEARCH_PLUGIN),
    'utf8',
  );

  it('sees the reindex loop from both sides', () => {
    expect(classify(`/repo/backend/${SEARCH_PLUGIN}`, source)).toBe('interval');
    // Blank the presence decision out, so what the timer check reports is the
    // site rather than its compliance.
    const blanked = source.replaceAll("effectiveState.isPresent('search')", 'true');
    const seen = findUngatedEntries({ sources: new Map([['modules/search/plugin.ts', blanked]]) });
    expect(seen.map((f) => f.construct)).toContain('setTimeout');
  });
});

describe('analyzeSource', () => {
  it('reports a CLI script with no scope as unscoped', () => {
    expect(analyzeSource(CLI, 'void main();')).toEqual({ file: CLI, kind: 'cli', scoped: false });
  });

  it('reports a CLI script that opens one as scoped', () => {
    expect(analyzeSource(CLI, "void enterSystemScope('cli: reindex', main);")?.scoped).toBe(true);
  });
});
