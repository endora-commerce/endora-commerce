/**
 * Red proofs for Phase 3's package-scope hosts
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §7).
 *
 * Tier B's characteristic verdict is `unreadable`-with-a-remedy rather than
 * `repository-only`, so the proofs come in pairs: one that the rule finds what
 * it is for, and one that it **refuses** rather than reports clean when the
 * input it needs is not there. A host that printed `violations=0` because it
 * read nothing is the defect the whole estate exists against, and for an
 * artefact-reading rule the commonest way to reach it is a package that was
 * never built.
 *
 * **Every proof enters at a fixture package tree on disk**, never at a
 * pre-classified record (issue #130). For the artefact-reading rules that means
 * a fixture that writes emitted JavaScript in the shape `tsc` actually writes —
 * a class-level `__decorate([...], Class)` call — because the whole claim of the
 * emitted reader is that it reads what the platform loads.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCheck, type RuleResult } from '../src/check/index.js';
import {
  createPackageFixture,
  touchIntoTheFuture,
  type FixtureFile,
  type PackageFixtureOptions,
} from './check-fixture.js';

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

const TENANT_RULE = 'check-entity-tenant-classification';

const MANIFEST: FixtureFile = { path: 'src/manifest.ts', content: 'export const manifest = {};\n' };

/**
 * One emitted entity class, in the shape `tsc` writes with `experimentalDecorators`.
 *
 * The class-level `__decorate` call is the whole reason this rule has an
 * artefact reader at all: `@Entity(` does not survive compilation, and a text
 * probe for it over a `dist` finds nothing and reports clean — the silence
 * Principle XI's out-of-tree hole is made of. `Entity({ … })` and
 * `OrgScoped()` do survive, as calls inside `__decorate`.
 */
function emittedEntity(className: string, decorators: readonly string[]): string {
  return [
    "import { Entity, PrimaryKey } from '@mikro-orm/core';",
    `let ${className} = class ${className} {`,
    '    id;',
    '};',
    '__decorate([',
    "    PrimaryKey({ type: 'uuid' }),",
    `], ${className}.prototype, "id", void 0);`,
    `${className} = __decorate([`,
    ...decorators.map((decorator) => `    ${decorator},`),
    `], ${className});`,
    `export { ${className} };`,
  ].join('\n');
}

/** A package that publishes `./backend` with one emitted entity class. */
function packageWithEntity(className: string, decorators: readonly string[]): string {
  return fixture({
    files: [
      MANIFEST,
      { path: 'src/backend/index.ts', content: 'export const entities = [];\n' },
      { path: `src/backend/entities/${className}.entity.ts`, content: '// source half\n' },
    ],
    emitted: [
      { path: 'dist/manifest.js', content: 'export const manifest = {};\n' },
      {
        path: 'dist/backend/index.js',
        content: [
          `import { ${className} } from './entities/${className}.entity.js';`,
          'export const entities = [',
          `    ${className},`,
          '];',
        ].join('\n'),
      },
      {
        path: `dist/backend/entities/${className}.entity.js`,
        content: emittedEntity(className, decorators),
      },
    ],
  });
}

/* --------------------------------------- check-entity-tenant-classification */

describe('check-entity-tenant-classification over a package', () => {
  it('reports a persisted entity carrying no tenant-scope classification', () => {
    const dir = packageWithEntity('Loyalty', ["Entity({ tableName: 'loyalties' })"]);

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('ran');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('Loyalty');
    expect(result.findings[0]?.message).toContain('OrgScoped');
  });

  it('says nothing about the same entity once it is classified', () => {
    const dir = packageWithEntity('Loyalty', [
      'OrgScoped()',
      "Entity({ tableName: 'loyalties' })",
    ]);

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('ran');
    expect(result.findings).toEqual([]);
  });

  it('reports an entity carrying more than one classification', () => {
    const dir = packageWithEntity('Loyalty', [
      'OrgScoped()',
      'GlobalEntity()',
      "Entity({ tableName: 'loyalties' })",
    ]);

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('ran');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('OrgScoped');
    expect(result.findings[0]?.message).toContain('GlobalEntity');
  });

  it('is not-applicable for a package that publishes no backend subpath', () => {
    const dir = fixture({
      exports: { '.': './dist/manifest.js', './admin': './dist/admin/index.js' },
      files: [MANIFEST, { path: 'src/admin/index.tsx', content: 'export const screens = [];\n' }],
      emitted: [
        { path: 'dist/manifest.js', content: 'export const manifest = {};\n' },
        { path: 'dist/admin/index.js', content: 'export const screens = [];\n' },
      ],
    });

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('not-applicable');
    expect(result.explanation).toContain('entity classes');
    expect(result.readSize).toBeNull();
  });

  it('refuses, rather than passes, a package that was never built', () => {
    const dir = fixture({
      files: [MANIFEST, { path: 'src/backend/index.ts', content: 'export const entities = [];\n' }],
      emitted: [{ path: 'dist/manifest.js', content: 'export const manifest = {};\n' }],
    });

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('unreadable');
    expect(result.findings).toEqual([]);
    expect(result.explanation).toContain('build');
  });

  it('refuses an artefact its own source is newer than', () => {
    const dir = packageWithEntity('Loyalty', ["Entity({ tableName: 'loyalties' })"]);
    touchIntoTheFuture(join(dir, 'src', 'backend', 'index.ts'));

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('unreadable');
    expect(result.findings).toEqual([]);
    expect(result.explanation).toContain('newer');
  });

  it('refuses a short walk: a declared entity class the walk never reached', () => {
    const dir = packageWithEntity('Loyalty', ["Entity({ tableName: 'loyalties' })"]);
    // The composition hands the ORM a second class whose emitted file is not
    // there. The walk therefore reads one of two declared classes, and the
    // package's own `entities` export is the independent second author that
    // says so — the whole of `package-scope-layout.md` §3.
    writeFileSync(
      join(dir, 'dist', 'backend', 'index.js'),
      [
        "import { Loyalty } from './entities/Loyalty.entity.js';",
        "import { Tier } from './entities/Tier.entity.js';",
        'export const entities = [',
        '    Loyalty,',
        '    Tier,',
        '];',
      ].join('\n'),
    );
    touchIntoTheFuture(join(dir, 'dist', 'backend', 'index.js'));

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('unreadable');
    expect(result.findings).toEqual([]);
  });

  it('is not-applicable for a backend that hands the ORM nothing', () => {
    const dir = fixture({
      files: [MANIFEST, { path: 'src/backend/index.ts', content: 'export function r() {}\n' }],
      emitted: [
        { path: 'dist/manifest.js', content: 'export const manifest = {};\n' },
        { path: 'dist/backend/index.js', content: 'export function r() {}\n' },
      ],
    });

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('not-applicable');
    expect(result.explanation).toContain('entity classes');
  });

  it('never reports pending: the host is built in this build', () => {
    const dir = packageWithEntity('Loyalty', ['OrgScoped()', "Entity({ tableName: 'l' })"]);
    expect(only(dir, TENANT_RULE).verdict).not.toBe('pending');
  });
});

/* ------------------------------------------------- check:entry-presence */

const PRESENCE_RULE = 'check:entry-presence';

/** A package whose backend plugin holds `body`. */
function packageWithPlugin(body: readonly string[], activation?: string): string {
  return fixture({
    files: [
      {
        path: 'src/manifest.ts',
        content: `export const manifest = { id: 'acme_loyalty'${activation ?? ''} };\n`,
      },
      { path: 'src/backend/index.ts', content: body.join('\n') },
    ],
    emitted: [
      {
        path: 'dist/manifest.js',
        content: `export const manifest = { id: 'acme_loyalty'${activation ?? ''} };\n`,
      },
      { path: 'dist/backend/index.js', content: body.join('\n') },
    ],
  });
}

describe('check:entry-presence over a package', () => {
  it('reports a repeating timer whose callback asks nothing about presence', () => {
    const dir = packageWithPlugin([
      'export function registerModule(ctx: any): void {',
      '  setInterval(async () => {',
      '    await ctx.expireLoyalty();',
      '  }, 300_000);',
      '}',
    ]);

    const result = only(dir, PRESENCE_RULE);

    expect(result.verdict).toBe('ran');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('setInterval');
    expect(result.findings[0]?.message).toContain('isPresent');
  });

  it('says nothing once the callback decides presence outside the try', () => {
    const dir = packageWithPlugin([
      'export function registerModule(ctx: any): void {',
      '  setInterval(async () => {',
      "    if (!ctx.effectiveState.isPresent('acme_loyalty')) return;",
      '    try {',
      '      await ctx.expireLoyalty();',
      '    } catch {}',
      '  }, 300_000);',
      '}',
    ]);

    expect(only(dir, PRESENCE_RULE).findings).toEqual([]);
  });

  it('reports a presence decision taken inside the try', () => {
    const dir = packageWithPlugin([
      'export function registerModule(ctx: any): void {',
      '  setInterval(async () => {',
      '    try {',
      "      if (!ctx.effectiveState.isPresent('acme_loyalty')) return;",
      '      await ctx.expireLoyalty();',
      '    } catch {}',
      '  }, 300_000);',
      '}',
    ]);

    const result = only(dir, PRESENCE_RULE);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('`try`');
  });

  it('is unconditional: a package with no timer and no boot hook still runs it', () => {
    const dir = packageWithPlugin(['export function registerModule(): void {}']);

    const result = only(dir, PRESENCE_RULE);

    expect(result.verdict).toBe('ran');
    expect(result.findings).toEqual([]);
    // The read line is printed even so — that is what makes the zero a
    // statement rather than an absence.
    expect(result.readSize?.files).toBeGreaterThan(0);
  });

  it('exempts a non-deactivatable package boot hook, and not its timer', () => {
    const body = [
      'export function registerModule(ctx: any): void {',
      '  ctx.onBoot(async () => {',
      '    await ctx.seedLoyaltyTiers();',
      '  });',
      '  setInterval(async () => {',
      '    await ctx.expireLoyalty();',
      '  }, 300_000);',
      '}',
    ];
    const locked = packageWithPlugin(body, ", activation: { nonDeactivatable: true, reason: 'core' }");
    const switchable = packageWithPlugin(body, ", activation: { settingCode: 'loyalty.enabled', default: true }");

    const lockedFindings = only(locked, PRESENCE_RULE).findings;
    const switchableFindings = only(switchable, PRESENCE_RULE).findings;

    expect(lockedFindings.map((f) => f.key)).toEqual(
      expect.arrayContaining([expect.stringContaining('setInterval')]),
    );
    expect(lockedFindings.every((f) => !f.key.includes('onBoot'))).toBe(true);
    expect(switchableFindings.length).toBeGreaterThan(lockedFindings.length);
  });

  it('refuses a short walk rather than reporting a clean package', () => {
    const dir = fixture({
      exports: { '.': './dist/manifest.js', './migrations': './dist/migrations/index.js' },
      files: [MANIFEST],
      emitted: [{ path: 'dist/manifest.js', content: 'export const manifest = {};\n' }],
    });

    const result = only(dir, PRESENCE_RULE);

    expect(result.verdict).toBe('unreadable');
    expect(result.findings).toEqual([]);
  });

  it('never reports pending: the host is built in this build', () => {
    const dir = packageWithPlugin(['export function registerModule(): void {}']);
    expect(only(dir, PRESENCE_RULE).verdict).not.toBe('pending');
  });
});

/* ---------------------------------------------------- check:port-catches */

const CATCH_RULE = 'check:port-catches';

/**
 * A package that resolves a peer's gated port, with a peer **installed beside it**.
 *
 * The peer is written into a real `node_modules` rather than faked, because the
 * whole claim of this host is that it resolves peers the way an author's tree
 * holds them — and the analysis admits `lazyPort(ctx, 'x')` as a port only when
 * some owner's artefact provides `x`. A fixture without the peer proves the
 * vacuous case, which is the proof below it.
 */
function packageResolvingPeerPort(body: readonly string[], withPeer: boolean): string {
  const dir = fixture({
    files: [MANIFEST, { path: 'src/backend/index.ts', content: body.join('\n') }],
    emitted: [
      { path: 'dist/manifest.js', content: 'export const manifest = {};\n' },
      { path: 'dist/backend/index.js', content: body.join('\n') },
    ],
  });
  if (withPeer) {
    const peer = join(dir, 'node_modules', '@acme', 'mod-tax');
    mkdirSync(join(peer, 'dist', 'backend'), { recursive: true });
    writeFileSync(
      join(peer, 'package.json'),
      `${JSON.stringify(
        {
          name: '@acme/mod-tax',
          version: '1.0.0',
          endora: { type: 'module', id: 'acme_tax' },
          exports: { './backend': { default: './dist/backend/index.js' } },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(peer, 'dist', 'backend', 'index.js'),
      [
        'export function registerModule(ctx) {',
        "    ctx.di.providePort('taxService', () => ({}));",
        '}',
      ].join('\n'),
    );
  }
  return dir;
}

const SWALLOWING_CATCH = [
  "import { lazyPort } from '@endora-commerce/platform/kernel';",
  'export function registerModule(ctx: any): void {',
  "  const taxService = lazyPort<any>(ctx, 'taxService');",
  '  ctx.rate = async (id: string) => {',
  '    try {',
  '      return await taxService.rateFor(id);',
  '    } catch {',
  '      return null;',
  '    }',
  '  };',
  '}',
];

describe('check:port-catches over a package', () => {
  it('reports a catch around a peer-owned gated port once the peer is installed', () => {
    const dir = packageResolvingPeerPort(SWALLOWING_CATCH, true);

    const result = only(dir, CATCH_RULE);

    expect(result.verdict).toBe('ran');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('taxService');
    expect(result.findings[0]?.message).toContain('rethrowIfModuleDisabled');
  });

  it('refuses, rather than reporting clean, when the owning peer is absent', () => {
    // This is the measured vacuous case and the reason this host needed a peer
    // owner map at all: without the owner, `lazyPort(ctx, 'taxService')` is not
    // admitted as a port, the `catch` is never seen, and the pre-`sources=owners`
    // shape of this host printed `violations=0`. 31 of the 41 packages with sites
    // in this repository lost every one of them that way.
    const dir = packageResolvingPeerPort(SWALLOWING_CATCH, false);

    const result = only(dir, CATCH_RULE);

    expect(result.verdict).toBe('unreadable');
    expect(result.findings).toEqual([]);
    expect(result.explanation).toContain('taxService');
    expect(result.explanation).toContain('no owner map could be read at all');
  });

  it('does not refuse a package whose owner map is read but does not hold its name', () => {
    // The five-false-refusal case, as a proof. `settingsReadPort` is the
    // platform's, not an uninstalled module's, and five real packages resolve
    // nothing else: refusing them printed a remedy — *install the owning module*
    // — naming work their author cannot do and does not need to. The floor is
    // "no owner map was read", so a run that read one and did not find this name
    // states the fraction and runs.
    const dir = packageResolvingPeerPort(
      [
        "import { lazyPort } from '@endora-commerce/platform/kernel';",
        'export function registerModule(ctx: any): void {',
        "  const settings = lazyPort<any>(ctx, 'settingsReadPort');",
        '  ctx.read = async (k: string) => {',
        '    try {',
        '      return await settings.get(k);',
        '    } catch {',
        '      return null;',
        '    }',
        '  };',
        '}',
      ],
      true,
    );

    const result = only(dir, CATCH_RULE);

    expect(result.verdict).toBe('ran');
    const owners = result.readSize?.coverage?.find((c) => c.source === 'owners');
    expect(owners).toEqual({ source: 'owners', expected: 1, covered: 0 });
    // Printed and named, never silent — and the sentence admits both causes
    // rather than naming the one an author cannot act on.
    expect(result.explanation).toContain('settingsReadPort');
    expect(result.explanation).toContain('the platform itself registers');
  });

  it('says nothing once the catch re-throws the presence answer', () => {
    const dir = packageResolvingPeerPort(
      [
        "import { lazyPort } from '@endora-commerce/platform/kernel';",
        "import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';",
        'export function registerModule(ctx: any): void {',
        "  const taxService = lazyPort<any>(ctx, 'taxService');",
        '  ctx.rate = async (id: string) => {',
        '    try {',
        '      return await taxService.rateFor(id);',
        '    } catch (error) {',
        '      rethrowIfModuleDisabled(error);',
        '      return null;',
        '    }',
        '  };',
        '}',
      ],
      true,
    );

    const result = only(dir, CATCH_RULE);

    expect(result.verdict).toBe('ran');
    expect(result.findings).toEqual([]);
  });

  it('omits the owners token, and does not refuse, for a package that resolves no port', () => {
    const dir = packageResolvingPeerPort(
      ['export function registerModule(): void {}'],
      false,
    );

    const result = only(dir, CATCH_RULE);

    expect(result.verdict).toBe('ran');
    expect(result.findings).toEqual([]);
    expect(result.readSize?.coverage?.some((c) => c.source === 'owners')).toBe(false);
  });

  it('prints owners:<n>/<m> when it resolved some and not all', () => {
    const dir = packageResolvingPeerPort(
      [
        "import { lazyPort } from '@endora-commerce/platform/kernel';",
        'export function registerModule(ctx: any): void {',
        "  const taxService = lazyPort<any>(ctx, 'taxService');",
        "  const shipping = lazyPort<any>(ctx, 'shippingService');",
        '  ctx.rate = async (id: string) => {',
        '    try {',
        '      return await taxService.rateFor(id);',
        '    } catch (error) {',
        "      void shipping; throw error;",
        '    }',
        '  };',
        '}',
      ],
      true,
    );

    const result = only(dir, CATCH_RULE);

    const owners = result.readSize?.coverage?.find((c) => c.source === 'owners');
    expect(owners).toEqual({ source: 'owners', expected: 2, covered: 1 });
    // One of the two resolved, so the run judged something: `ran`, with the
    // fraction stating its own incompleteness. The floor is `covered === 0`, not
    // `covered < expected` — refusing the whole rule on one unresolved peer
    // would be fail-closed in the wrong dimension, and for a package reaching
    // another paid module that is the ordinary case rather than the exception.
    expect(result.verdict).toBe('ran');
    // And the unattributed name is named, because a fraction does not tell an
    // author which module to install.
    expect(result.explanation).toContain('shippingService');
  });

  it('never reports pending: the host is built in this build', () => {
    const dir = packageResolvingPeerPort(['export function registerModule(): void {}'], false);
    expect(only(dir, CATCH_RULE).verdict).not.toBe('pending');
  });
});
