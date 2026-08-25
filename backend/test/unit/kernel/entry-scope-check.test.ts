import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  declaredProgramEntryPoints,
  fileLevelKind,
  findEntrySites,
  keyOf,
  staleAllowances,
  violationsOf,
  NO_SCOPE_NEEDED,
  type EntryConstruct,
  type EntryKind,
  type EntrySite,
} from '../../../scripts/check-entry-scope.js';
import { findUngatedEntries } from '../../../scripts/check-entry-presence.js';

/**
 * The entry-scope check (feature 072, T037; rewritten per-site for issue #237).
 * Its own test has to prove it can go **red**, because the tree is green by
 * construction — a check that only ever agrees with the current tree is
 * indistinguishable from one that returns `true`.
 *
 * The rewrite's whole claim is granularity: the population is entry **sites**,
 * so one right entry point in a file no longer vouches for another. Everything
 * under "a file answers per site" is that claim, and the tree's own
 * `registry-cache.ts` — the file issue #235 was found in — is the proof it holds
 * on real source rather than only on fixtures.
 */

const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * How a real run spells a walked file — `layout.displayOf`'s two bases, written
 * out here because these fixtures call the analysis directly.
 *
 * The module-scoped {@link relative} default finds the last `/src/` and slices,
 * which answers `src/kernel/container.ts` for a file that now lives in
 * `packages/platform/src/kernel/`. That is the application's spelling for a
 * package's file, and it is the spelling of the *shim* — two files under one
 * key, in a ledger keyed on paths.
 */
const displayOf = (file: string): string =>
  file.startsWith(BACKEND_ROOT) ? file.slice(BACKEND_ROOT.length) : file.slice(REPO_ROOT.length);
const CLI = '/repo/backend/src/modules/search/scripts/reindex.ts';
const SERVICE = '/repo/backend/src/modules/search/services/indexer.ts';

const kinds = (file: string, source: string, declared?: ReadonlySet<string>): string[] =>
  findEntrySites(file, source, declared).map((site) => site.kind);

const only = (file: string, source: string, declared?: ReadonlySet<string>): EntrySite => {
  const sites = findEntrySites(file, source, declared);
  expect(sites, `expected exactly one site in:\n${source}`).toHaveLength(1);
  return sites[0] as EntrySite;
};

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

describe('the site classes', () => {
  it('makes the file itself the site of a CLI script', () => {
    const site = only(CLI, 'void main();');
    expect(site.kind).toBe('cli');
    expect(site.scheduler).toBe('<file>');
  });

  it('makes each `new Worker(...)` its own site', () => {
    const two = `
      export const a = () => new Worker<Job>(A, handleA, options);
      export const b = () => new Worker<Job>(B, handleB, options);
    `;
    const sites = findEntrySites(SERVICE, two);
    expect(sites.map((s) => s.kind)).toEqual(['worker', 'worker']);
    // Two sites, two keys — the whole point of the rewrite is that the second
    // one cannot inherit the first one's answer.
    expect(new Set(sites.map(keyOf)).size).toBe(2);
  });

  it('makes each repeating timer its own site, whichever constructor it wears', () => {
    expect(only(SERVICE, 'setInterval(() => sweep(), 1000);').construct).toBe('setInterval');
    expect(only(SERVICE, SELF_RESCHEDULING).construct).toBe('setTimeout');
  });

  it('leaves a one-shot setTimeout alone — its execution already has a caller', () => {
    const deadline = `async function fetchWithTimeout(url: string) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try { return await fetch(url, { signal: controller.signal }); }
      finally { clearTimeout(timer); }
    }`;
    expect(findEntrySites(SERVICE, deadline)).toEqual([]);
  });

  it('makes a pub/sub message handler a site — the class issue #235 was in', () => {
    const site = only(SERVICE, "subscriber.on('message', (channel) => { void refresh(channel); });");
    expect(site.kind).toBe('message');
    expect(site.construct).toBe("on('message')");
  });

  it('makes a process-lifecycle handler a site, and keeps one whose event it cannot read', () => {
    expect(only(SERVICE, "process.once('SIGTERM', () => void stop());").kind).toBe('process');
    // `kernel/container.ts` loops over its signals. A population that demanded a
    // string literal would have no site for the one file that motivated the
    // class — so an unreadable event is *in*, not skipped.
    expect(only(SERVICE, 'for (const s of signals) process.once(s, handler);').kind).toBe('process');
  });

  it('says nothing about a process event that is not a lifecycle one', () => {
    expect(findEntrySites(SERVICE, "process.on('warning', (w) => log(w));")).toEqual([]);
  });

  it('is not fooled by a comment or a string quoting the patterns it looks for', () => {
    // Two files in the tree document this rule by quoting `new Worker(...)`.
    // Matching those made the check report the files that explain the invariant
    // as the files that break it.
    const prose = [
      '// the scope goes at the `new Worker(...)` call site',
      "const hint = \"setInterval(() => {}, 1)\";",
      "const other = 'process.once(\\'SIGTERM\\', stop)';",
    ].join('\n');
    expect(findEntrySites(SERVICE, prose)).toEqual([]);
  });

  it('says nothing about an ordinary service', () => {
    expect(findEntrySites(SERVICE, 'export class Indexer {}')).toEqual([]);
  });
});

describe('a file answers per site (issue #237)', () => {
  /**
   * The shape the file-level check reported `scoped`: a correctly wrapped timer
   * and, 130 lines away, a pub/sub handler that reads the database with no scope
   * at all. One file, two sites, two different answers — and the file-level
   * disjunction printed one.
   */
  const MIXED = `
    export class Cache {
      watch(subscriber: Redis): void {
        subscriber.on('message', () => { void this.refreshFromDb(); });
      }
      degrade(): void {
        setInterval(() => {
          void enterSystemScope('cache: degraded refresh', () => this.refreshFromDb());
        }, 30_000);
      }
    }
  `;

  it('reports the unscoped site and leaves the scoped one alone', () => {
    const sites = findEntrySites('/repo/backend/src/kernel/lifecycle/registry-cache.ts', MIXED);
    expect(sites.map((s) => `${s.kind}:${s.scoped}`)).toEqual(['message:false', 'interval:true']);
    const violations = violationsOf(sites);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('message');
  });

  it('asks a file-level site over the file minus the sites inside it', () => {
    // A declared program whose only `enterSystemScope` is inside the Worker it
    // constructs. The worker is right; the program's own `main()` runs unscoped,
    // and a whole-file answer would have called the file scoped.
    const file = '/repo/backend/src/seeds/dev-catalog-seed.ts';
    const declared = new Set(['src/seeds/dev-catalog-seed.ts']);
    const source = `
      const worker = new Worker(Q, (job) => enterSystemScope('seed: job', () => run(job)));
      await truncateEverything(em);
      void main();
    `;
    const sites = findEntrySites(file, source, declared);
    expect(sites.map((s) => `${s.kind}:${s.scoped}`)).toEqual(['program:false', 'worker:true']);
  });
});

describe('what counts as opening a scope at a site', () => {
  it('accepts either sanctioned entry function, called at the site', () => {
    expect(only(SERVICE, "setInterval(() => { void enterSystemScope('s', run); }, 1000);").scoped).toBe(true);
    expect(only(SERVICE, 'setInterval(() => { void enterPlatformScope(t, run); }, 1000);').scoped).toBe(true);
  });

  it('rejects the widening helper — it widens an execution, it does not start one', () => {
    expect(only(SERVICE, "setInterval(() => { void withSystemScope('s', run); }, 1000);").scoped).toBe(false);
  });

  it('does not count a mention inside a comment or a string', () => {
    expect(only(SERVICE, 'setInterval(() => { /* enterSystemScope( one day */ run(); }, 1000);').scoped).toBe(false);
    expect(only(SERVICE, "setInterval(() => { const hint = 'enterSystemScope('; }, 1000);").scoped).toBe(false);
  });

  it('binds an identifier callback without spending the hop on it', () => {
    // `new Worker(QUEUE, processor, …)` is how half the queues in the tree are
    // written; `processor` *is* the callback, so resolving it is not a
    // delegation. A check that spent the hop there would have none left for the
    // function the callback actually calls.
    const source = `
      const openScope = (job: Job) => enterSystemScope('queue: job', () => handle(job));
      const processor = (job: Job) => openScope(job);
      export const start = () => new Worker(QUEUE, processor, options);
    `;
    expect(only(SERVICE, source).scoped).toBe(true);
  });

  it('stops one hop below the callback, and reports the site rather than vouching for it', () => {
    // The documented limits, each asserted so a later widening is a decision
    // rather than a surprise: two hops, an imported delegate, and a method on
    // `this`.
    const twoHops = `
      const openScope = (job: Job) => enterSystemScope('queue: job', () => handle(job));
      const delegate = (job: Job) => openScope(job);
      export const start = () => new Worker(QUEUE, (job: Job) => delegate(job), options);
    `;
    expect(only(SERVICE, twoHops).scoped).toBe(false);

    const imported = `
      import { processor } from './processor.js';
      export const start = () => new Worker(QUEUE, processor, options);
    `;
    expect(only(SERVICE, imported).scoped).toBe(false);

    const method = `
      export class Cache {
        start(sub: Redis) { sub.on('message', (m) => this.handleMessage(m)); }
        handleMessage(m: string) { void enterSystemScope('cache', () => this.reload(m)); }
      }
    `;
    expect(only(SERVICE, method).scoped).toBe(false);
  });

  it('does not vouch for a callback it could not bind to a function at all', () => {
    expect(only(SERVICE, 'setInterval(scheduledElsewhere, 1000);').scoped).toBe(false);
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

describe('the file-level classes, given what package.json declares', () => {
  const DECLARED = new Set(['src/seeds/dev-catalog-seed.ts', 'src/modules/search/scripts/reindex.ts']);

  it('treats a declared src file under no scripts/ directory as a program', () => {
    // The gap issue #228 is about: `src/seeds/dev-catalog-seed.ts` is a
    // top-level `main()` that truncates and repopulates a dozen modules'
    // tables, and the population defined by shape alone could not see it.
    expect(fileLevelKind('/repo/backend/src/seeds/dev-catalog-seed.ts', DECLARED)).toBe('program');
    expect(kinds('/repo/backend/src/seeds/dev-catalog-seed.ts', 'main();', DECLARED)).toEqual(['program']);
  });

  it('leaves a declared scripts/ file in the cli class', () => {
    expect(fileLevelKind('/repo/backend/src/modules/search/scripts/reindex.ts', DECLARED)).toBe('cli');
  });

  it('says nothing about a src file no package script runs', () => {
    expect(fileLevelKind('/repo/backend/src/seeds/attribute-fixtures.ts', DECLARED)).toBeNull();
  });
});

describe('the real tree', () => {
  const declared = new Set(
    declaredProgramEntryPoints(readFileSync(join(BACKEND_ROOT, 'package.json'), 'utf8')),
  );
  /**
   * A path is resolved against `backend/` when it names one of the
   * application's files and against the repository when it names the platform's
   * — the two bases `layout.displayOf` gives a real run, and the reason a key
   * for a platform file is spelled `packages/platform/src/…` since the
   * relocation.
   */
  const absoluteOf = (path: string): string =>
    path.startsWith('packages/') ? join(BACKEND_ROOT, '..', path) : join(BACKEND_ROOT, path);
  const sitesIn = (path: string): EntrySite[] => {
    const absolute = absoluteOf(path);
    return findEntrySites(absolute, readFileSync(absolute, 'utf8'), declared, displayOf);
  };

  it('declares the dev seed as a program this check has to see', () => {
    expect(declared).toContain('src/seeds/dev-catalog-seed.ts');
  });

  it('resolves every declared program to a file that exists', () => {
    // The population's second source can go quietly short: a package script
    // renamed away from its file removes an entry point and nothing else
    // notices.
    for (const path of declared) {
      expect(existsSync(join(BACKEND_ROOT, path)), `${path} is declared but absent`).toBe(true);
    }
  });

  it('reports both of registry-cache.ts\'s sites, and would have caught issue #235', () => {
    const path = 'packages/platform/src/kernel/lifecycle/registry-cache.ts';
    const sites = sitesIn(path);
    expect(sites.map((s) => s.kind)).toEqual(['message', 'interval']);
    expect(sites.every((s) => s.scoped)).toBe(true);

    // Put the file back the way it was: the pub/sub handler refreshing from the
    // database with no scope, the degraded-mode timer wrapped correctly 130
    // lines below. The file-level check reported that `scoped`.
    const source = readFileSync(absoluteOf(path), 'utf8');
    const before235 = source.replace(
      /enterSystemScope\(\s*'_lifecycle: registry refresh on state-change notification'/,
      "notAScopeAtAll('_lifecycle: registry refresh on state-change notification'",
    );
    expect(before235, 'the site this replacement targets has moved').not.toBe(source);

    const regressed = findEntrySites(absoluteOf(path), before235, declared, displayOf);
    expect(regressed.map((s) => `${s.kind}:${s.scoped}`)).toEqual(['message:false', 'interval:true']);
    expect(violationsOf(regressed).map((s) => s.kind)).toEqual(['message']);
  });

  it('sees the shutdown handler in container.ts, which no file-level class contained', () => {
    // `container.ts` is under no `scripts/` directory, is no declared program,
    // constructs no `Worker` and starts no timer. The file-classifying check had
    // nowhere to put it, so `process.once(SIGINT/SIGTERM, …)` was outside its
    // population entirely — not exempt, not reported, absent.
    const path = 'packages/platform/src/kernel/container.ts';
    expect(fileLevelKind(absoluteOf(path), declared, displayOf)).toBeNull();
    const sites = sitesIn(path);
    expect(sites.map((s) => s.kind)).toEqual(['process']);
    expect(sites[0]?.scheduler).toBe('installShutdownDisposal');
    expect(NO_SCOPE_NEEDED[keyOf(sites[0] as EntrySite)]).toBeDefined();
  });

  it('gives every worker in the queue-consumer roots its own site', () => {
    // Three `new Worker(...)` in one file: under the file-level population these
    // were one answer, and the second and third were vouched for by the first.
    // The path follows the module (feature 080, T040b): `newsletter` is a
    // package, and `absoluteOf` already resolves a `packages/` path against the
    // repository rather than against `backend/` — the same two bases a real run
    // gets from `layout.displayOf`.
    const sites = sitesIn(
      'packages/modules/newsletter/src/backend/services/queues/newsletter-queues.ts',
    );
    expect(sites).toHaveLength(3);
    expect(sites.every((s) => s.kind === 'worker' && s.scoped)).toBe(true);
    expect(new Set(sites.map(keyOf)).size).toBe(3);
  });
});

describe('the ledger ratchet', () => {
  const site = (
    file: string,
    scoped: boolean,
    scheduler = '<file>',
    kind: EntryKind = 'cli',
    construct: EntryConstruct = 'cli',
  ): EntrySite => ({ file, kind, construct, scheduler, line: 1, scoped });

  // **Derived from the ledger, never written down.** These two cases used to
  // name `settings`' `modules-install.ts` shim, and they went red the day that
  // shim was legitimately deleted (feature 080, T053(d)) — the entry retired,
  // and two tests that were about the *ratchet* failed because they were about
  // one entry. A test keyed on a real ledger row is a hostage to that row.
  //
  // Taking the first entry and re-deriving its three parts keeps them exercising
  // the key derivation, which is what they are for. An empty ledger fails them
  // loudly rather than passing vacuously, which is the right direction: this
  // ratchet has never been empty and its emptying would be a finding.
  const LEDGER_KEY = Object.keys(NO_SCOPE_NEEDED)[0];
  if (LEDGER_KEY === undefined) throw new Error('NO_SCOPE_NEEDED is empty — the ratchet has nothing to ratchet');
  const [LEDGERED, LEDGERED_SCHEDULER, LEDGERED_CONSTRUCT] = LEDGER_KEY.split(':') as [
    string,
    string,
    string,
  ];
  // The cast is safe by construction rather than by assertion: every key in the
  // ledger is produced by `keyOf`, so its third segment is a construct spelling.
  const ledgeredSite = (scoped: boolean): EntrySite =>
    site(LEDGERED, scoped, LEDGERED_SCHEDULER, 'interval', LEDGERED_CONSTRUCT as EntryConstruct);

  it('reports an unscoped site that is not ledgered', () => {
    expect(violationsOf([site('src/modules/search/scripts/reindex.ts', false)])).toHaveLength(1);
  });

  it('does not report a ledgered one', () => {
    expect(violationsOf([ledgeredSite(false)])).toEqual([]);
  });

  it('reports a ledger entry whose site has since been scoped', () => {
    expect(staleAllowances([ledgeredSite(true)])).toContain(LEDGER_KEY);
  });

  it('keys a ledger entry by file, scheduler and construct — never by line', () => {
    expect(keyOf(site('src/worker.ts', false, 'main'))).toBe('src/worker.ts:main:cli');
  });

  it('spells every key the way the walk reports a walked file', () => {
    // Two bases, as `layout.displayOf` has: `src/…` for the application's own
    // files, `packages/…` for the platform's, which are a workspace package's
    // since the relocation and outside `backend/` entirely.
    const base = (path: string): string =>
      path.startsWith('packages/') ? join(BACKEND_ROOT, '..') : BACKEND_ROOT;
    for (const key of Object.keys(NO_SCOPE_NEEDED)) {
      const path = key.slice(0, key.indexOf(':'));
      expect(displayOf(join(base(path), path))).toBe(path);
      expect(existsSync(join(base(path), path)), `${path} is ledgered but absent`).toBe(true);
    }
  });

  it('gives every exemption a written reason', () => {
    for (const [key, reason] of Object.entries(NO_SCOPE_NEEDED)) {
      expect(reason.length, `${key} has no reason`).toBeGreaterThan(40);
    }
  });

  it('says what would falsify each of the sites that only drop a cache or a connection', () => {
    // The reason these are safe is structural — a synchronous, EntityManager-free
    // handler — and it stops being true the day one of them reloads instead of
    // dropping. That has to be written down as a falsifier, not as "harmless".
    //
    // There were three. `admin_actions` had the identical entry until D-174:
    // its cache now follows module state through `InProcessCacheRegistry`, and
    // the handler that dropped it is the platform's own — already a site, and
    // ledgered where it lives.
    const falsifiable = [
      "src/modules/custom_fields/services/custom-field-definitions-cache.ts:start:on('message')",
      'packages/platform/src/kernel/container.ts:installShutdownDisposal:process.once',
    ];
    for (const key of falsifiable) {
      expect(NO_SCOPE_NEEDED[key], `${key} is not ledgered`).toMatch(/Falsified|Retire this entry/);
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
  const source = readFileSync(join(BACKEND_ROOT, SEARCH_PLUGIN), 'utf8');

  it('sees the reindex loop from both sides', () => {
    expect(kinds(`/repo/backend/${SEARCH_PLUGIN}`, source)).toContain('interval');
    // Blank the presence decision out, so what the timer check reports is the
    // site rather than its compliance.
    const blanked = source.replaceAll("effectiveState.isPresent('search')", 'true');
    const seen = findUngatedEntries({ sources: new Map([['modules/search/plugin.ts', blanked]]) });
    expect(seen.map((f) => f.construct)).toContain('setTimeout');
  });
});
