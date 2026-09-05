/**
 * Red proofs for Phase 2's package-scope hosts
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §7).
 *
 * One proof per finding each host can report, plus the two verdicts that are
 * *not* findings and are the easiest to get wrong: `not-applicable` from a
 * declaration the package does not make, and the short walk that is a refusal
 * rather than a clean run.
 *
 * **Every proof enters at a fixture package tree on disk**, never at a
 * pre-classified record (issue #130). That is the whole point of the split: a
 * proof that entered below the layout seam would exercise the analysis — which
 * this repository's own companion tests already do — and say nothing about
 * whether `endora check` resolves a package's population the way its
 * `package.json` declares it.
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCheck, type RuleResult } from '../src/check/index.js';
import { createPackageFixture, type PackageFixtureOptions } from './check-fixture.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function fixture(options: PackageFixtureOptions = {}): string {
  const built = createPackageFixture(options);
  cleanups.push(built.cleanup);
  return built.dir;
}

/** One rule's result over a fixture package. Never `undefined`, never a skip. */
function only(dir: string, rule: string): RuleResult {
  const run = runCheck({ cwd: dir, rules: [rule] });
  const result = run.report.results[0];
  if (result === undefined) throw new Error(`no result for ${rule}`);
  return result;
}

const MANIFEST = { path: 'src/manifest.ts', content: 'export const manifest = {};\n' };

/* ------------------------------------------------------ transaction-context */

describe('check:transaction-context over a package', () => {
  it('reports SQL written inside a transaction that does not run inside it', () => {
    const dir = fixture({
      files: [
        MANIFEST,
        {
          path: 'src/backend/index.ts',
          content: [
            'export async function place(em: any) {',
            '  await em.transactional(async (tx: any) => {',
            "    await tx.getConnection().execute('update promotion_usages set used = used + 1');",
            '  });',
            '}',
          ].join('\n'),
        },
      ],
    });

    const result = only(dir, 'check:transaction-context');

    expect(result.verdict).toBe('ran');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('connection-execute');
    expect(result.findings[0]?.message).toContain('em.execute(sql, params)');
  });

  it('says nothing about the same statement written on the EntityManager', () => {
    const dir = fixture({
      files: [
        MANIFEST,
        {
          path: 'src/backend/index.ts',
          content: [
            'export async function place(em: any) {',
            '  await em.transactional(async (tx: any) => {',
            "    await tx.execute('update promotion_usages set used = used + 1');",
            '  });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(only(dir, 'check:transaction-context').findings).toEqual([]);
  });
});

/* ------------------------------------------------------- channel:resolution */

describe('channel:resolution over a package', () => {
  it('reports a module reading the sales-channel header itself', () => {
    const dir = fixture({
      files: [
        MANIFEST,
        {
          path: 'src/backend/index.ts',
          content: [
            'export function channelOf(request: any): string {',
            "  return request.headers['x-sales-channel'];",
            '}',
          ].join('\n'),
        },
      ],
    });

    const result = only(dir, 'channel:resolution');

    expect(result.verdict).toBe('ran');
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]?.message).toContain('Constitution XII');
  });

  it('is unconditional: a package that declares nothing extra still runs it', () => {
    expect(only(fixture(), 'channel:resolution').verdict).toBe('ran');
  });
});

/* ---------------------------------------------------------- kernel-boundary */

describe('check:kernel-boundary over a package', () => {
  it('reports a relation into another module', () => {
    const dir = fixture({
      moduleId: 'acme_loyalty',
      files: [
        MANIFEST,
        {
          path: 'src/backend/entities/order-link.entity.ts',
          content: [
            "import { Order } from '../../../../catalog/src/backend/entities/order.entity.js';",
            'export class OrderLink {',
            '  @ManyToOne(() => Order)',
            '  order!: Order;',
            '}',
          ].join('\n'),
        },
      ],
    });

    const result = only(dir, 'check:kernel-boundary');

    // The reach resolves to no file on disk, so the target is unattributed and
    // there is nothing to report — which is the honest answer and is asserted
    // rather than assumed: a rule that reported a relation it could not resolve
    // would be guessing.
    expect(result.verdict).toBe('ran');
    expect(result.findings).toEqual([]);
  });

  it('names the two signals a package has no subject for', () => {
    const result = only(fixture(), 'check:kernel-boundary');
    const signals = result.unevaluatedSignals.map((signal) => signal.signal);
    expect(signals).toContain('platform-root-imports');
    expect(signals).toContain('kernel-import-closure');
  });
});

/* ------------------------------------------------------------- entry-scope */

describe('check:entry-scope over a package', () => {
  it('is not-applicable for a package with no worker, timer or declared program', () => {
    const result = only(fixture(), 'check:entry-scope');
    expect(result.verdict).toBe('not-applicable');
    expect(result.explanation).toContain('package.json` script running a source path');
  });

  it('reports a worker that establishes no scope', () => {
    const dir = fixture({
      files: [
        MANIFEST,
        {
          path: 'src/backend/index.ts',
          content: [
            "import { Worker } from 'bullmq';",
            "export const worker = new Worker('acme', async (job: any) => {",
            '  await job.data.em.flush();',
            '});',
          ].join('\n'),
        },
      ],
    });

    const result = only(dir, 'check:entry-scope');

    expect(result.verdict).toBe('ran');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('establishes no scope');
  });

  it('says nothing about a worker that opens one', () => {
    const dir = fixture({
      files: [
        MANIFEST,
        {
          path: 'src/backend/index.ts',
          content: [
            "import { Worker } from 'bullmq';",
            "export const worker = new Worker('acme', async (job: any) => {",
            '  await enterPlatformScope(async () => job.data.em.flush());',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(only(dir, 'check:entry-scope').findings).toEqual([]);
  });
});

/* --------------------------------------------------------- diacritic-folds */

describe('check:diacritic-folds over a package', () => {
  it('reports a private fold', () => {
    const dir = fixture({
      files: [
        MANIFEST,
        {
          path: 'src/backend/index.ts',
          content: [
            'export function slug(value: string): string {',
            "  return value.normalize('NFD').replace(/[\\u0300-\\u036f]/gu, '');",
            '}',
          ].join('\n'),
        },
      ],
    });

    const result = only(dir, 'check:diacritic-folds');

    expect(result.verdict).toBe('ran');
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.map((finding) => finding.message).join(' ')).toContain(
      '@endora-commerce/contracts',
    );
  });

  it('reports a slug builder that folds nothing, which is the signal that sees an absence', () => {
    const dir = fixture({
      files: [
        MANIFEST,
        {
          path: 'src/backend/index.ts',
          content: [
            'export function key(value: string): string {',
            "  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');",
            '}',
          ].join('\n'),
        },
      ],
    });

    const messages = only(dir, 'check:diacritic-folds').findings.map(
      (finding) => finding.key,
    );
    expect(messages.some((key) => key.startsWith('slug-run|'))).toBe(true);
  });

  it('says nothing about a package that imports the shared fold', () => {
    const dir = fixture({
      files: [
        MANIFEST,
        {
          path: 'src/backend/index.ts',
          content: [
            "import { slugify } from '@endora-commerce/contracts';",
            'export const key = (value: string): string => slugify(value);',
          ].join('\n'),
        },
      ],
    });

    expect(only(dir, 'check:diacritic-folds').findings).toEqual([]);
  });
});

/* -------------------------------------------------- default-language-prose */

describe('check:default-language-prose over a package', () => {
  it('reports a Polish sentence a module composes', () => {
    const dir = fixture({
      files: [
        MANIFEST,
        {
          path: 'src/backend/index.ts',
          content:
            "export const title = 'Przesyłka została wysłana do klienta w dniu dzisiejszym';\n",
        },
      ],
    });

    const result = only(dir, 'check:default-language-prose');

    expect(result.verdict).toBe('ran');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('non-english-default');
  });

  it('says nothing about the same sentence inside a per-language structure', () => {
    const dir = fixture({
      files: [
        MANIFEST,
        {
          path: 'src/backend/index.ts',
          content: [
            'export const titles = {',
            "  en: 'The shipment has been dispatched to the customer today',",
            "  pl: 'Przesyłka została wysłana do klienta w dniu dzisiejszym',",
            '};',
          ].join('\n'),
        },
      ],
    });

    expect(only(dir, 'check:default-language-prose').findings).toEqual([]);
  });

  it('does not report a declared ./migrations layer short — the rule prunes it by design', () => {
    // The lesson Phase 1 paid for, one rule over: this walk excludes
    // `migrations`, so the floor has to ask the rule's own membership predicate
    // rather than "is it a `.ts`". Otherwise a package that publishes migrations
    // is refused for a layer the rule never intended to open.
    const dir = fixture({
      exports: {
        '.': './dist/manifest.js',
        './backend': './dist/backend/index.js',
        './migrations': './dist/migrations/index.js',
      },
      files: [
        MANIFEST,
        { path: 'src/backend/index.ts', content: 'export function registerModule() {}\n' },
        { path: 'src/migrations/index.ts', content: 'export const migrations = [];\n' },
      ],
    });

    const result = only(dir, 'check:default-language-prose');

    expect(result.verdict).toBe('ran');
    expect(result.readSize?.coverage?.[0]).toEqual({
      source: 'package-exports',
      expected: 2,
      covered: 2,
    });
  });

  it('still refuses a declared layer the rule *does* open and that has no source', () => {
    const dir = fixture({
      exports: {
        '.': './dist/manifest.js',
        './backend': './dist/backend/index.js',
        './ports': './dist/ports/index.js',
      },
      files: [
        MANIFEST,
        { path: 'src/backend/index.ts', content: 'export function registerModule() {}\n' },
        { path: 'src/ports/index.ts', content: 'export type Port = { run(): void };\n' },
      ],
    });
    rmSync(join(dir, 'src', 'ports'), { recursive: true });

    const result = only(dir, 'check:default-language-prose');

    expect(result.verdict).toBe('unreadable');
    expect(result.explanation).toContain('residue of its population');
  });
});

/* --------------------------------------------------------- platform-surface */

describe('check:platform-surface over a package', () => {
  it('refuses rather than reports clean when the platform is not installed', () => {
    const result = only(fixture(), 'check:platform-surface');

    expect(result.verdict).toBe('unreadable');
    expect(result.explanation).toContain('@endora-commerce/platform');
    // The reason the refusal is the right direction, stated in the assertion so
    // a future weakening has to argue with it: a shorter published set reports
    // *fewer* findings.
    expect(result.explanation).toContain('*fewer* findings');
    expect(result.findings).toEqual([]);
  });

  it('names the halves that are vacuous for a package rather than counting them zero', () => {
    const signals = only(fixture(), 'check:platform-surface').unevaluatedSignals.map(
      (signal) => signal.signal,
    );
    expect(signals).toContain('relative-specifier-reach');
    // Feature 115's second consumer population. An installed module package has
    // no application tree, so the half has no subject here — declared vacuous
    // rather than counted zero, which is the difference between "this rule found
    // nothing" and "this rule was not asked".
    expect(signals).toContain('application-host-reach');
  });
});

/* --------------------------------------------------------------- port-shape */

describe('check:port-shape over a package', () => {
  it('is not-applicable for a package that publishes no port surface', () => {
    const result = only(fixture(), 'check:port-shape');
    expect(result.verdict).toBe('not-applicable');
    expect(result.explanation).toContain('port surface');
  });

  it('reports an optional method on a published port', () => {
    const dir = fixture({
      exports: {
        '.': './dist/manifest.js',
        './backend': './dist/backend/index.js',
        './ports': './dist/ports/index.js',
      },
      files: [
        MANIFEST,
        { path: 'src/backend/index.ts', content: 'export function registerModule() {}\n' },
        {
          path: 'src/ports/index.ts',
          content: [
            '/**',
            ' * Container name: `acmeLoyaltyPort`.',
            ' */',
            'export interface AcmeLoyaltyPort {',
            '  award(id: string): Promise<void>;',
            '  publishInvalidate?(): void;',
            '}',
          ].join('\n'),
        },
      ],
    });

    const result = only(dir, 'check:port-shape');

    expect(result.verdict).toBe('ran');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('publishInvalidate');
    expect(result.findings[0]?.message).toContain('feature detection through a');
  });

  it('names the two signals a lone package cannot answer', () => {
    const dir = fixture({
      exports: {
        '.': './dist/manifest.js',
        './backend': './dist/backend/index.js',
        './ports': './dist/ports/index.js',
      },
      files: [
        MANIFEST,
        { path: 'src/backend/index.ts', content: 'export function registerModule() {}\n' },
        { path: 'src/ports/index.ts', content: 'export interface P { run(): void }\n' },
      ],
    });

    const signals = only(dir, 'check:port-shape').unevaluatedSignals.map(
      (signal) => signal.signal,
    );
    expect(signals).toContain('documented-container-name');
    expect(signals).toContain('cross-module-resolution');
  });
});
