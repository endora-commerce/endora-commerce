import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALIAS_HIDDEN_RESOLUTIONS,
  CONTRIBUTION_POLICY_STATED,
  REGISTRY_POLICIES_UNSTATED,
  closureOf,
  describe as describeViolation,
  describeNonBindingIssue,
  describeUnassignedEdge,
  findInstanceGaps,
  findNonBindingIssues,
  findViolations,
  findRootIssues,
  describeInstanceGap,
  importedContributionSeams,
  ledgerReads,
  nonBindingPortEdges,
  overlayManifestEntries,
  NON_LITERAL_PORT_NAME,
  providedPortNames,
  registeredNames,
  resolvedNames,
  rootRegisteredNames,
  HOST_REGISTERED_PORTS,
  PLATFORM_OWNED_NAMES,
  ROOT_DELEGATES_TO,
  ROOT_FILES,
  type PortResolution,
} from '../../../scripts/check-port-dependencies.js';
import {
  delegatedComposerOf,
  delegatedSuppliedNames,
  delegatedSupplyFields,
  delegationRefusalMessage,
} from '../../../scripts/lib/delegated-composer.js';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';

/**
 * The port-dependency rule (feature 072, T061 / FR-040).
 *
 * The tree satisfies it after this batch declared `blog` → `auth`, so the
 * check's own test has to prove it can go **red** — an extractor that silently
 * finds nothing reports the same green as a clean tree.
 */

const BLOG = '/repo/backend/src/modules/blog/backend.ts';

describe('registeredNames — what a module claims to own', () => {
  it('reads the keys of ctx.di.register', () => {
    const source = [
      'export function registerModule(ctx) {',
      '  ctx.di.register({',
      '    blogPostService: ctx.asFunction(() => 1).singleton(),',
      '    blogTagService: ctx.asFunction(() => 2).singleton(),',
      '  });',
      '}',
    ].join('\n');
    expect(registeredNames(source, BLOG)).toEqual(['blogPostService', 'blogTagService']);
  });

  it('reads the name of ctx.di.providePort', () => {
    const source = "ctx.di.providePort('organizationReadPort', ctx.asClass(X).singleton());";
    expect(registeredNames(source, BLOG)).toEqual(['organizationReadPort']);
  });

  it('ignores a mention in a comment — this is a parse, not a grep', () => {
    expect(registeredNames("// ctx.di.register({ ghostService: 1 })\n", BLOG)).toEqual([]);
  });
});

describe('resolvedNames — what a module reads back', () => {
  it('reads a factory cradle parameter', () => {
    const source = 'ctx.asFunction(({ emFactory, requireAdmin }: BlogCradle) => 1).singleton();';
    expect(resolvedNames(source, BLOG).map((r) => r.name)).toEqual(['emFactory', 'requireAdmin']);
  });

  it('reads a destructured ctx.cradle<C>()', () => {
    const source = 'const { blogPostService, requireAdmin } = ctx.cradle<BlogCradle>();';
    expect(resolvedNames(source, BLOG).map((r) => r.name)).toEqual([
      'blogPostService',
      'requireAdmin',
    ]);
  });

  it('reads a property access on ctx.cradle<C>()', () => {
    const source = 'await register(app, ctx.cradle<HealthChecksCradle>().healthCheckProbes);';
    expect(resolvedNames(source, BLOG).map((r) => r.name)).toEqual(['healthCheckProbes']);
  });

  it('does not mistake an unrelated destructuring callback for a resolution', () => {
    const source = 'const ids = rows.map(({ id, name }) => `${id}:${name}`);';
    expect(resolvedNames(source, BLOG)).toEqual([]);
  });

  it('reads a property access through a module-local cradle alias', () => {
    // The shape that hid nine modules' resolutions (issue #90): binding the
    // whole cradle to a local and reading names off it. The check saw
    // `ctx.cradle<C>().x` and `const { x } = ctx.cradle<C>()` and nothing else,
    // so every read through the alias was invisible — including the gated ports
    // the wiring rule exists to catch.
    const source = [
      'const cradle = ctx.cradle<BlogCradle>();',
      'await register(app, { post: cradle.blogPostService, admin: cradle.requireAdmin });',
    ].join('\n');
    expect(resolvedNames(source, BLOG).map((r) => r.name)).toEqual([
      'blogPostService',
      'requireAdmin',
    ]);
  });

  it('reads a property access through a cradle accessor alias', () => {
    // The second half of the same shape: a zero-argument accessor returning the
    // cradle, so the read is written `cradle().x`.
    const source = [
      'const cradle = (): BlogCradle => ctx.cradle<BlogCradle>();',
      'await register(app, { post: cradle().blogPostService });',
    ].join('\n');
    expect(resolvedNames(source, BLOG).map((r) => r.name)).toEqual(['blogPostService']);
  });

  it('reads a destructuring off a cradle accessor alias', () => {
    // The two halves above, written together: an accessor alias *called* and
    // then destructured. The check saw `cradle().x` and
    // `const { x } = ctx.cradle<C>()` and not `const { x } = cradle()`, so
    // `catalog`'s asset-reference boot hook resolved two names unseen
    // (issue #127).
    const source = [
      'const cradle = (): BlogCradle => ctx.cradle<BlogCradle>();',
      'ctx.onBoot(() => {',
      '  const { blogPostService, emFactory } = cradle();',
      '  registerBlogReferences(blogPostService, emFactory);',
      '});',
    ].join('\n');
    expect(resolvedNames(source, BLOG).map((r) => r.name)).toEqual([
      'blogPostService',
      'emFactory',
    ]);
  });

  it('sites a destructuring off an accessor alias where it is written', () => {
    // The destructuring *is* the resolution — the cradle is a proxy, so the
    // names come out of the container at that line and nowhere else. A boot
    // hook is therefore a `boot` read, which is what makes it reachable by the
    // gated-port rule.
    const source = [
      'const cradle = (): BlogCradle => ctx.cradle<BlogCradle>();',
      'ctx.onBoot(() => {',
      '  const { blogPostService } = cradle();',
      '  blogPostService.warm();',
      '});',
    ].join('\n');
    expect(resolvedNames(source, BLOG)).toContainEqual(
      expect.objectContaining({ name: 'blogPostService', kind: 'deferred', site: 'boot' }),
    );
  });

  it('reads a destructuring off a cradle object alias', () => {
    // The object half of the same widening: the alias holds the cradle itself,
    // so destructuring it resolves each name exactly as `cradle.x` does.
    const source = [
      'const cradle = ctx.cradle<BlogCradle>();',
      'const { blogPostService } = cradle;',
    ].join('\n');
    expect(resolvedNames(source, BLOG).map((r) => r.name)).toEqual(['blogPostService']);
  });

  it('captures a destructuring off a factory cradle parameter', () => {
    // A named factory parameter *is* the cradle, so destructuring it inside the
    // factory body resolves at construction — the capture the rule refuses.
    const source = [
      'ctx.di.register({',
      '  eligibility: ctx',
      '    .asFunction((cradle: BlogCradle) => {',
      '      const { blogPostService } = cradle;',
      '      return new S(blogPostService);',
      '    })',
      '    .singleton(),',
      '});',
    ].join('\n');
    expect(resolvedNames(source, BLOG)).toContainEqual(
      expect.objectContaining({ name: 'blogPostService', kind: 'captured' }),
    );
  });

  it('does not carry cradle-ness through a field read off a resolved name', () => {
    // The precision rule MR !556 arrived at: what comes back from a resolution
    // is an ordinary value. `cradle().blogPostService` is the resolution;
    // destructuring *its* fields resolves nothing further, and reading them as
    // container names would invent edges that do not exist.
    const source = [
      'const cradle = (): BlogCradle => ctx.cradle<BlogCradle>();',
      'const { listPosts, ghostService } = cradle().blogPostService;',
    ].join('\n');
    expect(resolvedNames(source, BLOG).map((r) => r.name)).toEqual(['blogPostService']);
  });

  it('does not read a destructuring off an unrelated zero-argument call', () => {
    // The widening keys on the alias table, not on the shape: `const { x } = f()`
    // is the commonest line in the tree and almost none of it is a container read.
    const source = [
      'const { rows, total } = await listSomething();',
      'const { a, b } = buildOptions();',
    ].join('\n');
    expect(resolvedNames(source, BLOG)).toEqual([]);
  });

  it('does not read a destructuring off an alias outside the scope that declared it', () => {
    const source = [
      'function one(): void {',
      '  const cradle = (): BlogCradle => ctx.cradle<BlogCradle>();',
      '  const { blogPostService } = cradle();',
      '}',
      'function two(): void {',
      '  const cradle = somethingElse;',
      '  const { ghostService } = cradle();',
      '}',
    ].join('\n');
    expect(resolvedNames(source, BLOG).map((r) => r.name)).toEqual(['blogPostService']);
  });

  it('reads a factory cradle parameter that is not destructured', () => {
    // Awilix hands the cradle to a factory as its first argument, so a named
    // parameter is the same read as a destructured one — and a capture.
    const source = [
      'ctx.di.register({',
      '  eligibility: ctx',
      '    .asFunction((cradle: BlogCradle) => new S(cradle.blogPostService))',
      '    .singleton(),',
      '});',
    ].join('\n');
    expect(resolvedNames(source, BLOG)).toContainEqual(
      expect.objectContaining({ name: 'blogPostService', kind: 'captured' }),
    );
  });

  it('records a computed read off a cradle alias under the sentinel', () => {
    // Same rule as `lazyPort`: a name assembled at runtime is a name this check
    // cannot verify, so it must not pass silently.
    const source = ['const cradle = ctx.cradle<BlogCradle>();', 'use(cradle[key]);'].join('\n');
    expect(resolvedNames(source, BLOG)).toContainEqual(
      expect.objectContaining({ name: NON_LITERAL_PORT_NAME }),
    );
  });

  it('does not treat an unrelated local object as a cradle', () => {
    // The widening must not turn every property access into a resolution: only
    // a local actually bound to `ctx.cradle<C>()` is one.
    const source = ['const options = buildOptions();', 'use(options.blogPostService);'].join('\n');
    expect(resolvedNames(source, BLOG)).toEqual([]);
  });

  it('does not read an alias outside the scope that declared it', () => {
    // Same name, different scope, no cradle in sight — a file-wide alias table
    // would report a resolution here that does not exist.
    const source = [
      'function one(): void {',
      '  const cradle = ctx.cradle<BlogCradle>();',
      '  use(cradle.blogPostService);',
      '}',
      'function two(): void {',
      '  const cradle = somethingElse();',
      '  use(cradle.ghostService);',
      '}',
    ].join('\n');
    expect(resolvedNames(source, BLOG).map((r) => r.name)).toEqual(['blogPostService']);
  });

  it('carries the module id and the line, so the report points at the code', () => {
    const source = ['', 'ctx.asFunction(({ requireAdmin }: C) => 1);'].join('\n');
    expect(resolvedNames(source, BLOG)[0]).toMatchObject({ moduleId: 'blog', line: 2 });
  });
});

describe('findViolations', () => {
  const resolution = (
    moduleId: string,
    name: string,
    kind: PortResolution['kind'] = 'deferred',
    site: PortResolution['site'] = 'call',
  ): PortResolution => ({
    moduleId,
    name,
    file: `/repo/backend/src/modules/${moduleId}/backend.ts`,
    line: 1,
    kind,
    site,
    // These fixtures exercise the ownership and capture rules, which read the
    // name and not the seam it was written into. `cradle` is the shape those
    // rules were written against.
    via: 'cradle',
  });

  it('accepts a platform name with nothing declared', () => {
    // The kernel has no manifest, so it can never appear in a `dependencies`
    // array; requiring the declaration would make the edge undeclarable.
    expect(
      findViolations({
        resolutions: [resolution('blog', 'emFactory')],
        owners: new Map(),
        dependencies: new Map([['blog', []]]),
      }),
    ).toEqual([]);
  });

  it('accepts a module resolving a name it owns itself', () => {
    expect(
      findViolations({
        resolutions: [resolution('blog', 'blogPostService')],
        owners: new Map([['blogPostService', 'blog']]),
        dependencies: new Map([['blog', []]]),
      }),
    ).toEqual([]);
  });

  it('rejects a cross-module resolution the manifest does not declare', () => {
    const violations = findViolations({
      resolutions: [resolution('blog', 'requireAdmin')],
      owners: new Map([['requireAdmin', 'auth']]),
      dependencies: new Map([['blog', ['cms']]]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('undeclared-dependency');
    const message = describeViolation(violations[0]!);
    expect(message).toContain('blog');
    expect(message).toContain('auth');
    expect(message).toContain("Add 'auth' to `dependencies`");
  });

  it('accepts the same resolution once the dependency is declared transitively', () => {
    expect(
      findViolations({
        resolutions: [resolution('blog', 'requireAdmin')],
        owners: new Map([['requireAdmin', 'auth']]),
        dependencies: new Map([
          ['blog', ['admin_users']],
          ['admin_users', ['auth']],
        ]),
      }),
    ).toEqual([]);
  });

  it('rejects a name no module and no platform registration owns', () => {
    const violations = findViolations({
      resolutions: [resolution('blog', 'ghostService')],
      owners: new Map(),
      dependencies: new Map([['blog', []]]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('unowned-name');
    expect(describeViolation(violations[0]!)).toContain('which no module registers');
  });

  it('refuses a captured name the module does not own', () => {
    // The failure this prevents is not a type error and not visible at the call
    // site: a captured port keeps answering after its module is switched off,
    // and a captured root-registered name may not exist yet when the module
    // composes. Both cost this feature several red runs.
    const violations = findViolations({
      resolutions: [resolution('blog', 'settingsReadPort', 'captured')],
      owners: new Map(),
      dependencies: new Map([['blog', []]]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('captured-name');
  });


  it('allows the same name when it is read through the cradle', () => {
    expect(
      findViolations({
        resolutions: [resolution('blog', 'settingsReadPort', 'deferred')],
        owners: new Map(),
        dependencies: new Map([['blog', []]]),
      }),
    ).toEqual([]);
  });

  it('allows a module to capture a name it owns itself', () => {
    expect(
      findViolations({
        resolutions: [resolution('blog', 'blogCacheService', 'captured')],
        owners: new Map([['blogCacheService', 'blog']]),
        dependencies: new Map([['blog', []]]),
      }),
    ).toEqual([]);
  });

  it('refuses a capture of a port the module provides itself (D-38b)', () => {
    // The exemption above is right for a `di.register` name and wrong for a
    // port: `providePort` wraps the resolver in a transient gate whoever owns
    // it, and awilix strict mode refuses a singleton capturing one warm or
    // cold. `_i18n` shipped exactly this — `adminI18nReconciler` capturing its
    // own `adminI18nService` — and the backend stopped booting while every
    // static check reported green.
    const violations = findViolations({
      resolutions: [resolution('_i18n', 'adminI18nService', 'captured')],
      owners: new Map([['adminI18nService', '_i18n']]),
      dependencies: new Map([['_i18n', []]]),
      providedPorts: new Map([['adminI18nService', '_i18n']]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('captured-name');
    expect(describeViolation(violations[0]!)).toContain('lazyPort');
  });

  it('still allows capturing a name the module registered with di.register', () => {
    // Same owner, same module — the difference is `providePort`, and it is the
    // only difference that matters to a lifetime.
    expect(
      findViolations({
        resolutions: [resolution('blog', 'blogCacheService', 'captured')],
        owners: new Map([['blogCacheService', 'blog']]),
        dependencies: new Map([['blog', []]]),
        providedPorts: new Map([['blogPostPort', 'blog']]),
      }),
    ).toEqual([]);
  });

  it('allows capturing the eagerly-registered kernel names', () => {
    // These exist before any module composes and none is a transient gate, so
    // capturing them cannot resolve too early or outlive a module.
    expect(
      findViolations({
        resolutions: [
          resolution('blog', 'emFactory', 'captured'),
          resolution('blog', 'auditLogService', 'captured'),
          resolution('blog', 'eventBus', 'captured'),
        ],
        owners: new Map(),
        dependencies: new Map([['blog', []]]),
      }),
    ).toEqual([]);
  });

  it('reports a capture even when the dependency is properly declared', () => {
    // Declaring the dependency fixes *ownership*; it does nothing about
    // lifetime or ordering, so the two rules are independent.
    const violations = findViolations({
      resolutions: [resolution('blog', 'dictionaryValidator', 'captured')],
      owners: new Map([['dictionaryValidator', 'dictionaries']]),
      dependencies: new Map([['blog', ['dictionaries']]]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('captured-name');
  });

  /**
   * D-39's ratchet: a **gated port** resolved before the first request.
   *
   * Both sites run whatever the module's effective state is — `runBootHooks()`
   * does not consult presence, and `defineModuleRoutes` gates requests rather
   * than the registration — so resolving a gate at either one turns an
   * operator's off-switch into a dead deployment. Nothing else sees it: the
   * types match, the dependency is declared, and the capture rule does not
   * apply because both reads are genuinely deferred.
   */
  it('refuses a gated port resolved inside a boot hook', () => {
    const violations = findViolations({
      resolutions: [resolution('megamenu', 'cmsReferenceRegistry', 'deferred', 'boot')],
      owners: new Map([['cmsReferenceRegistry', 'cms']]),
      dependencies: new Map([['megamenu', ['cms']]]),
      providedPorts: new Map([['cmsReferenceRegistry', 'cms']]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('gated-port-at-boot');
    const message = describeViolation(violations[0]!);
    expect(message).toContain('boot hook');
    expect(message).toContain('ctx.di.register');
  });

  it('refuses a gated port a module resolves in its own boot hook', () => {
    // `megamenu`'s hook resolved `megamenuReferenceRegistry`, which `megamenu`
    // itself provided as a port: switching the module off stopped the backend
    // from starting, at the module's own registration.
    const violations = findViolations({
      resolutions: [resolution('megamenu', 'megamenuReferenceRegistry', 'deferred', 'boot')],
      owners: new Map([['megamenuReferenceRegistry', 'megamenu']]),
      dependencies: new Map([['megamenu', []]]),
      providedPorts: new Map([['megamenuReferenceRegistry', 'megamenu']]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('gated-port-at-boot');
  });

  it('refuses a gated port resolved in a route-registration body', () => {
    // `ctx.routes`' callback runs inside `buildServer`, unconditionally.
    // `comparisons` and `credit_limits` both destructured their own gated ports
    // there and stopped the backend from starting when switched off.
    const violations = findViolations({
      resolutions: [resolution('comparisons', 'comparisonService', 'deferred', 'wiring')],
      owners: new Map([['comparisonService', 'comparisons']]),
      dependencies: new Map([['comparisons', []]]),
      providedPorts: new Map([['comparisonService', 'comparisons']]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('gated-port-at-wiring');
    expect(describeViolation(violations[0]!)).toContain('lazyPort');
  });

  it('accepts an ungated contribution registry resolved from a boot hook', () => {
    // The whole point of D-39: a `ctx.di.register` name is an inert table, and
    // pushing a descriptor into it at boot is the sanctioned shape.
    expect(
      findViolations({
        resolutions: [resolution('megamenu', 'cmsReferenceRegistry', 'deferred', 'boot')],
        owners: new Map([['cmsReferenceRegistry', 'cms']]),
        dependencies: new Map([['megamenu', ['cms']]]),
        providedPorts: new Map(),
      }),
    ).toEqual([]);
  });

  it('accepts a gated port resolved inside a request handler', () => {
    expect(
      findViolations({
        resolutions: [resolution('blog', 'dictionaryValidator', 'deferred', 'call')],
        owners: new Map([['dictionaryValidator', 'dictionaries']]),
        dependencies: new Map([['blog', ['dictionaries']]]),
        providedPorts: new Map([['dictionaryValidator', 'dictionaries']]),
      }),
    ).toEqual([]);
  });
});

/**
 * Where a resolution *happens*, which is what the two rules above key on.
 *
 * `kind` answers "does this resolve once or per call"; `site` answers "does it
 * resolve before the platform serves its first request". They are independent:
 * a boot-hook read is deferred and still fatal.
 */
describe('resolvedNames — the resolution site', () => {
  const file = '/repo/backend/src/modules/megamenu/backend.ts';

  it('marks a cradle read inside ctx.onBoot as a boot resolution', () => {
    const source = `
      export function registerModule(ctx: ModuleContext): void {
        ctx.onBoot(() => {
          const { cmsReferenceRegistry } = ctx.cradle<MegamenuCradle>();
          registerMegamenuCmsReferences(cmsReferenceRegistry);
        });
      }
    `;
    expect(resolvedNames(source, file)).toContainEqual(
      expect.objectContaining({ name: 'cmsReferenceRegistry', site: 'boot' }),
    );
  });

  it('marks a lazyPort built inside ctx.onBoot as a boot resolution', () => {
    // `lazyPort` defers to the call — and inside a boot hook the call is two
    // lines down. All seven `emailDefaultsPort` contributors had this shape.
    const source = `
      export function registerModule(ctx: ModuleContext): void {
        ctx.onBoot(async () => {
          const defaults = lazyPort<EmailDefaultsRegistry>(ctx, 'emailDefaultsPort');
          defaults.register('code', DEFAULTS, 'megamenu');
        });
      }
    `;
    expect(resolvedNames(source, file)).toContainEqual(
      expect.objectContaining({ name: 'emailDefaultsPort', site: 'boot' }),
    );
  });

  it('marks a cradle read in the ctx.routes body as a wiring resolution', () => {
    const source = `
      export function registerModule(ctx: ModuleContext): void {
        ctx.routes(async (app) => {
          const { comparisonService } = ctx.cradle<ComparisonsCradle>();
          await register(app, { comparisonService });
        });
      }
    `;
    expect(resolvedNames(source, file)).toContainEqual(
      expect.objectContaining({ name: 'comparisonService', site: 'wiring' }),
    );
  });

  it('does not call a read inside a route handler a wiring resolution', () => {
    const source = `
      export function registerModule(ctx: ModuleContext): void {
        ctx.routes(async (app) => {
          app.get('/x', async () => ctx.cradle<C>().comparisonService.list());
        });
      }
    `;
    expect(resolvedNames(source, file)).toContainEqual(
      expect.objectContaining({ name: 'comparisonService', site: 'call' }),
    );
  });

  it('marks an alias read in the ctx.routes body as a wiring resolution', () => {
    // The blind spot issue #90 closed: the alias moved the read one line down
    // and out of the check's sight, while `buildServer` still ran it.
    const source = `
      export function registerModule(ctx: ModuleContext): void {
        ctx.routes(async (app) => {
          const cradle = ctx.cradle<ComparisonsCradle>();
          await register(app, { comparisonService: cradle.comparisonService });
        });
      }
    `;
    expect(resolvedNames(source, file)).toContainEqual(
      expect.objectContaining({ name: 'comparisonService', site: 'wiring' }),
    );
  });

  it('leaves an alias read inside a route handler at the call site', () => {
    const source = `
      export function registerModule(ctx: ModuleContext): void {
        ctx.routes(async (app) => {
          const cradle = ctx.cradle<ComparisonsCradle>();
          app.get('/x', async () => cradle.comparisonService.list());
        });
      }
    `;
    expect(resolvedNames(source, file)).toContainEqual(
      expect.objectContaining({ name: 'comparisonService', site: 'call' }),
    );
  });

  it('marks an alias read inside ctx.onBoot as a boot resolution', () => {
    const source = `
      export function registerModule(ctx: ModuleContext): void {
        ctx.onBoot(() => {
          const cradle = ctx.cradle<MegamenuCradle>();
          registerMegamenuCmsReferences(cradle.cmsReferenceRegistry);
        });
      }
    `;
    expect(resolvedNames(source, file)).toContainEqual(
      expect.objectContaining({ name: 'cmsReferenceRegistry', site: 'boot' }),
    );
  });

  it('does not call a subscriber body a wiring resolution', () => {
    // `ctx.subscribe`'s handler runs per event, not at registration — so the
    // gate is asked when there is something to gate.
    const source = `
      export function registerModule(ctx: ModuleContext): void {
        ctx.subscribe('order.placed', async () => {
          const { pricingService } = ctx.cradle<C>();
          await pricingService.recalculate();
        });
      }
    `;
    expect(resolvedNames(source, file)).toContainEqual(
      expect.objectContaining({ name: 'pricingService', site: 'call' }),
    );
  });

  it('leaves a plain factory read at the call site', () => {
    const source = 'ctx.asFunction(({ emFactory }: C) => 1).singleton();';
    expect(resolvedNames(source, file)).toContainEqual(
      expect.objectContaining({ name: 'emFactory', site: 'call' }),
    );
  });
});

describe('closureOf', () => {
  it('follows the graph transitively and terminates on a cycle', () => {
    const dependencies = new Map<string, readonly string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]);
    expect([...closureOf('a', dependencies)].sort()).toEqual(['b', 'c']);
  });
});

describe('ALIAS_HIDDEN_RESOLUTIONS — the issue #90 debt', () => {
  const resolution = (moduleId: string, name: string): PortResolution => ({
    moduleId,
    name,
    file: `/repo/backend/src/modules/${moduleId}/backend.ts`,
    line: 1,
    kind: 'captured',
    site: 'call',
    via: 'cradle',
  });

  it('is empty — the four `orders` captures drained with the accessor change', () => {
    // The last four entries were `orders` freezing two method modules'
    // registrations into `commerceModule`'s options. That constructor takes
    // accessors now (feature 074, FR-024), so the reads are deferred and
    // declared, and the table has nothing left to suppress. It stays as the
    // ratchet: a new entry has to be written here with its reason.
    expect(Object.keys(ALIAS_HIDDEN_RESOLUTIONS)).toEqual([]);
  });

  it('still reports the same shape for a pair nobody listed', () => {
    const violations = findViolations({
      resolutions: [resolution('orders', 'someOtherRegistry')],
      owners: new Map([['someOtherRegistry', 'payment_methods']]),
      dependencies: new Map([['orders', []]]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('captured-name');
  });

  it('names a module for every entry, so the table can be swept', () => {
    const ids = new Set(DISCOVERED_MANIFESTS.map((entry) => entry.id));
    for (const key of Object.keys(ALIAS_HIDDEN_RESOLUTIONS)) {
      const [moduleId, name] = key.split(':');
      expect(ids.has(moduleId ?? ''), `${key} names '${moduleId}', which is not a module`).toBe(
        true,
      );
      expect(name ?? '').not.toBe('');
    }
  });
});

describe('the bridging tables stay honest', () => {
  it('every host-registered port names a module that exists', () => {
    const ids = new Set(DISCOVERED_MANIFESTS.map((entry) => entry.id));
    for (const [name, owner] of Object.entries(HOST_REGISTERED_PORTS)) {
      expect(ids.has(owner), `${name} is attributed to '${owner}', which is not a module`).toBe(
        true,
      );
    }
  });

  it('no host-registered port is also claimed as platform-owned', () => {
    for (const name of Object.keys(HOST_REGISTERED_PORTS)) {
      expect(PLATFORM_OWNED_NAMES.has(name), `${name} is in both tables`).toBe(false);
    }
  });
});

describe('rootRegisteredNames — what a composition root writes into the container', () => {
  it('collects registerValues keys, including shorthand', () => {
    const source = `
      registerValues(container, {
        apiKeyResolver: async (t) => svc.authenticate(t),
        requireCustomer,
      });
    `;
    expect(rootRegisteredNames(source, 'composition.ts').sort()).toEqual([
      'apiKeyResolver',
      'requireCustomer',
    ]);
  });

  it('collects a direct container.register too', () => {
    const source = `container.register({ redis: asValue(client) });`;
    expect(rootRegisteredNames(source, 'composition.ts')).toEqual(['redis']);
  });

  it('ignores a spread, which names nothing it can reason about', () => {
    const source = `registerValues(container, { ...extras, redis });`;
    expect(rootRegisteredNames(source, 'composition.ts')).toEqual(['redis']);
  });

  it('collects the contribution window, which is where a root writes most names', () => {
    // Issue #52 moved D-45's contribution slot onto a method. Nearly every name
    // a root supplies is written there, and the shadowing, divergence and
    // unsupplied findings are all computed from this list — so a reader that
    // did not know the spelling would report green having stopped looking.
    const source = `
      composedModules.contribute({
        organizationsLoginHook: hook,
        requireCustomer,
      });
    `;
    expect(rootRegisteredNames(source, 'composition.ts').sort()).toEqual([
      'organizationsLoginHook',
      'requireCustomer',
    ]);
  });
});

describe('providedPortNames — the gated subset', () => {
  it('takes providePort and leaves di.register alone', () => {
    const source = `
      ctx.di.register({ ksefVerificationResolver: ctx.asFunction(() => undefined).singleton() });
      ctx.di.providePort('invoiceService', ctx.asFunction(() => svc).singleton());
    `;
    expect(providedPortNames(source, 'backend.ts')).toEqual(['invoiceService']);
    expect(registeredNames(source, 'backend.ts').sort()).toEqual([
      'invoiceService',
      'ksefVerificationResolver',
    ]);
  });
});

/**
 * The three D-73 inputs, empty — for the cases that are about the sibling half
 * (`HOST_REGISTERED_PORTS`) and say nothing about the platform list.
 *
 * They are **required** fields rather than optional ones, so a caller cannot
 * add a `findRootIssues` site that silently skips the platform sweep; opting
 * out is written down, which is what this constant is.
 */
const noPlatformSweep = {
  platformNames: new Set<string>(),
  kernelNames: new Set<string>(),
  moduleOwnedNames: new Map<string, string>(),
};

describe('findRootIssues', () => {
  const roots = (production: string[], harness: string[]): Map<string, ReadonlySet<string>> =>
    new Map([
      ['production', new Set(production)],
      ['harness', new Set(harness)],
    ]);

  it('flags a root registering a name a module provides as a gated port', () => {
    const issues = findRootIssues({
      moduleRegistered: new Map([['apiKeyResolver', 'api_keys']]),
      rootNames: roots(['apiKeyResolver'], ['apiKeyResolver']),
      hostRegistered: {},
        ...noPlatformSweep,
        resolvedNames: new Set<string>(),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'root-shadows-module-port',
      name: 'apiKeyResolver',
      owner: 'api_keys',
    });
    expect([...issues[0]!.roots].sort()).toEqual(['harness', 'production']);
  });

  it('does not flag a root overriding a contribution point', () => {
    // The module registered it with `di.register`, so it never reaches
    // `moduleRegistered` — overriding it is the design, not a bug.
    expect(
      findRootIssues({
        moduleRegistered: new Map(),
        rootNames: roots(['ksefVerificationResolver'], []),
        hostRegistered: {},
        ...noPlatformSweep,
        resolvedNames: new Set<string>(),
      }),
    ).toEqual([]);
  });

  it('flags a host-registered port only one composition supplies', () => {
    const issues = findRootIssues({
      moduleRegistered: new Map(),
      rootNames: roots([], ['settingsAdminService']),
      hostRegistered: { settingsAdminService: 'settings' },
      ...noPlatformSweep,
      resolvedNames: new Set(['settingsAdminService']),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'root-divergence',
      name: 'settingsAdminService',
      owner: 'settings',
      roots: ['harness'],
    });
  });

  it('accepts a host-registered port both compositions supply', () => {
    expect(
      findRootIssues({
        moduleRegistered: new Map(),
        rootNames: roots(['requireCustomer'], ['requireCustomer']),
        hostRegistered: { requireCustomer: 'auth' },
        ...noPlatformSweep,
        resolvedNames: new Set<string>(),
      }),
    ).toEqual([]);
  });

  it('says nothing about a host-registered port neither composition supplies', () => {
    // Absent everywhere is the `unowned-name` violation's job, and reporting it
    // twice would make the table look like the problem.
    expect(
      findRootIssues({
        moduleRegistered: new Map(),
        rootNames: roots([], []),
        hostRegistered: { somePort: 'somewhere' },
        // Nothing resolves it, so the entry is stale rather than broken.
        ...noPlatformSweep,
        resolvedNames: new Set<string>(),
      }),
    ).toEqual([]);
  });
});

describe('findRootIssues — a table entry no root supplies', () => {
  it('flags a host-registered port that neither root registers and a module resolves', () => {
    // Issue #49, found the hard way: `organizationTreeService` was declared in
    // HOST_REGISTERED_PORTS during T132 and registered by nobody, so the
    // sales-rep reverse-list route answered 500 with every static check green.
    const issues = findRootIssues({
      moduleRegistered: new Map(),
      rootNames: new Map([
        ['production', new Set<string>()],
        ['harness', new Set<string>()],
      ]),
      hostRegistered: { organizationTreeService: 'organizations' },
      ...noPlatformSweep,
      resolvedNames: new Set(['organizationTreeService']),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'root-supplies-nothing',
      name: 'organizationTreeService',
      owner: 'organizations',
    });
  });

  it('stays quiet when nothing resolves the name', () => {
    expect(
      findRootIssues({
        moduleRegistered: new Map(),
        rootNames: new Map([
          ['production', new Set<string>()],
          ['harness', new Set<string>()],
        ]),
        hostRegistered: { organizationTreeService: 'organizations' },
        ...noPlatformSweep,
        resolvedNames: new Set<string>(),
      }),
    ).toEqual([]);
  });
});

/**
 * `findRootIssues` over `PLATFORM_OWNED_NAMES` — issue #49, D-73.
 *
 * Being on that list grants two exemptions: the dependency-declaration skip in
 * `findViolations`, and exclusion from feature 074's deactivation-consequence
 * ledger — the artefact the operator's confirmation dialog renders. Nothing
 * verified either, and the assertion has already been wrong in production:
 * `salesChannelResolutionPort` was resolved by `inventory` and registered by
 * neither root, so the channel-scoped storefront stock read threw
 * `AwilixResolutionError` on its first call, in production only, with typecheck,
 * lint and this check green.
 *
 * The detail every case below turns on is that a composition has **three**
 * supply sources, not two. The last two cases are the ones that keep this sweep
 * alive: a derivation that does not read `src/kernel/**` reds `orm`, `em` and
 * `emFactory` on its first run and is deleted the same day.
 */
describe('findRootIssues — PLATFORM_OWNED_NAMES', () => {
  const bothRoots = (production: string[], harness: string[]): Map<string, ReadonlySet<string>> =>
    new Map([
      ['production', new Set(production)],
      ['harness', new Set(harness)],
    ]);

  const sweep = (input: {
    roots: Map<string, ReadonlySet<string>>;
    kernel?: string[];
    moduleOwned?: [string, string][];
    resolved?: string[];
  }) =>
    findRootIssues({
      moduleRegistered: new Map(),
      rootNames: input.roots,
      hostRegistered: {},
      resolvedNames: new Set(input.resolved ?? []),
      platformNames: new Set(['salesChannelResolutionPort']),
      kernelNames: new Set(input.kernel ?? []),
      moduleOwnedNames: new Map(input.moduleOwned ?? []),
    });

  it('flags a platform name nothing registers that a module resolves', () => {
    const issues = sweep({
      roots: bothRoots([], []),
      resolved: ['salesChannelResolutionPort'],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'platform-name-unsupplied',
      name: 'salesChannelResolutionPort',
      owner: null,
    });
  });

  it('flags a platform name only one root registers', () => {
    const issues = sweep({
      roots: bothRoots([], ['salesChannelResolutionPort']),
      resolved: ['salesChannelResolutionPort'],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'platform-name-divergence',
      name: 'salesChannelResolutionPort',
      roots: ['harness'],
    });
  });

  it('flags a platform name a module registers as its own', () => {
    // Both roots register it and something resolves it, so neither of the two
    // findings above applies — only the ownership scan can see this one. It is
    // the shape `priceListsPricingCacheTtlMs` was in.
    const issues = sweep({
      roots: bothRoots(['salesChannelResolutionPort'], ['salesChannelResolutionPort']),
      moduleOwned: [['salesChannelResolutionPort', 'sales_channels']],
      resolved: ['salesChannelResolutionPort'],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'platform-name-owned-by-module',
      name: 'salesChannelResolutionPort',
      owner: 'sales_channels',
    });
  });

  it('flags a platform name nothing registers and nothing resolves as stale', () => {
    const issues = sweep({ roots: bothRoots([], []) });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'platform-name-stale',
      name: 'salesChannelResolutionPort',
    });
  });

  it('reports exactly one finding per name, ownership first', () => {
    // A module-owned name registered by one root only would satisfy the
    // divergence test too. Reporting both would send the reader after the
    // registrations when the fix is to take the name off the list.
    const issues = sweep({
      roots: bothRoots([], ['salesChannelResolutionPort']),
      moduleOwned: [['salesChannelResolutionPort', 'sales_channels']],
      resolved: ['salesChannelResolutionPort'],
    });
    expect(issues.map((issue) => issue.kind)).toEqual(['platform-name-owned-by-module']);
  });

  it('counts a kernel registration as supply for every composition', () => {
    // F47, and the reason this whole sweep is not a false-red generator:
    // `orm`, `em` and `emFactory` come from `registerOrm` in
    // `kernel/container.ts`, so no root registers them and both compositions
    // have them.
    expect(
      sweep({
        roots: bothRoots([], []),
        kernel: ['salesChannelResolutionPort'],
        resolved: ['salesChannelResolutionPort'],
      }),
    ).toEqual([]);
  });

  it('counts a kernel registration as supply for the composition the other root lacks', () => {
    // The same fact on the divergence arm, which is where a two-source
    // derivation goes wrong more quietly: one root registers it, the kernel
    // covers the other, and that is not a divergence.
    expect(
      sweep({
        roots: bothRoots(['salesChannelResolutionPort'], []),
        kernel: ['salesChannelResolutionPort'],
        resolved: ['salesChannelResolutionPort'],
      }),
    ).toEqual([]);
  });

  it('says nothing about a name both roots register and nobody resolves yet', () => {
    // A root preparing a seam, which is not a defect — the reason `stale`
    // requires *both* halves.
    expect(
      sweep({
        roots: bothRoots(['salesChannelResolutionPort'], ['salesChannelResolutionPort']),
      }),
    ).toEqual([]);
  });
});

describe('resolvedNames — lazyPort', () => {
  const file = '/repo/backend/src/modules/blog/backend.ts';

  it('sees a lazyPort read and calls it deferred', () => {
    // Deferred by construction: the proxy resolves on each method call, which
    // is why capturing one is safe where capturing a port is not.
    const source = `
      export function registerModule(ctx: ModuleContext): void {
        ctx.di.register({
          thing: ctx.asFunction(() => build({
            settings: lazyPort<SettingsService>(ctx, 'settingsReadPort'),
          })).singleton(),
        });
      }
    `;
    const found = resolvedNames(source, file);
    expect(found).toContainEqual(
      expect.objectContaining({ name: 'settingsReadPort', kind: 'deferred' }),
    );
  });

  it('records a computed name under the sentinel so it cannot pass', () => {
    // A generic `port(ctx, name)` helper hid twelve resolutions during T131.
    // The check refuses the shape rather than guessing at it.
    const source = `
      export function registerModule(ctx: ModuleContext): void {
        const port = (name: string) => lazyPort<never>(ctx, name);
      }
    `;
    expect(resolvedNames(source, file)).toContainEqual(
      expect.objectContaining({ name: NON_LITERAL_PORT_NAME }),
    );
  });

  it('leaves a computed name owned by nobody, so findViolations reports it', () => {
    const violations = findViolations({
      resolutions: [
        {
          moduleId: 'blog',
          name: NON_LITERAL_PORT_NAME,
          file,
          line: 3,
          kind: 'deferred',
          site: 'call',
          via: 'lazyPort',
        },
      ],
      owners: new Map(),
      dependencies: new Map(),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: 'unowned-name' });
    expect(describeViolation(violations[0]!)).toContain('computed name');
  });
});

/**
 * D-44 — `manifest.nonBindingDependencies` satisfies the ownership rule.
 *
 * The check asks one thing of a cross-module resolution: *the name you read
 * belongs to someone, and you said whose*. That is container hygiene, not a
 * lifecycle claim, so it is satisfied by a declaration in any of the three
 * arrays. What the new one withholds — the flip-time refusal — this file has no
 * opinion about; `gating-graph.test.ts` holds that half.
 */
describe('nonBindingPortEdges — the third declaration array', () => {
  const contributor = defineModuleManifest({
    id: 'shop',
    name: 'Shop',
    version: '1.0.0',
    dependencies: [],
    nonBindingDependencies: [
      {
        moduleId: 'assistant',
        name: 'toolRegistry',
        kind: 'contributes-to',
        reason: 'Pushes an inert tool descriptor into the assistant catalogue at boot.',
      },
    ],
  });

  const resolution = (
    moduleId: string,
    name: string,
    site: PortResolution['site'] = 'call',
  ): PortResolution => ({
    moduleId,
    name,
    file: `/repo/backend/src/modules/${moduleId}/backend.ts`,
    line: 1,
    kind: 'deferred',
    site,
    via: 'cradle',
  });

  it('keys an edge the way the acknowledged lookup is keyed', () => {
    expect(nonBindingPortEdges([contributor])).toEqual({
      'shop:toolRegistry':
        'Pushes an inert tool descriptor into the assistant catalogue at boot.',
    });
  });

  it('clears the undeclared-dependency for exactly that pair', () => {
    expect(
      findViolations({
        resolutions: [resolution('shop', 'toolRegistry')],
        owners: new Map([['toolRegistry', 'assistant']]),
        dependencies: new Map([['shop', []]]),
        acknowledged: nonBindingPortEdges([contributor]),
      }),
    ).toEqual([]);
  });

  it('clears the name, not the module — a second name owned by the same module still fails', () => {
    // Keyed by name on purpose. "I contribute to the assistant's tool table" is
    // not "I may read anything the assistant registers".
    const violations = findViolations({
      resolutions: [resolution('shop', 'assistantPlanExecutor')],
      owners: new Map([['assistantPlanExecutor', 'assistant']]),
      dependencies: new Map([['shop', []]]),
      acknowledged: nonBindingPortEdges([contributor]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe('undeclared-dependency');
  });

  it('inherits nothing transitively from the module it names', () => {
    // `dependencies` clears a resolution through its transitive closure; this
    // array has none. Contributing to the assistant does not declare whatever
    // the assistant itself declares.
    const violations = findViolations({
      resolutions: [resolution('shop', 'ledgerService')],
      owners: new Map([['ledgerService', 'accounting']]),
      dependencies: new Map([
        ['shop', []],
        ['assistant', ['accounting']],
      ]),
      acknowledged: nonBindingPortEdges([contributor]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.owner).toBe('accounting');
  });
});

/**
 * The two guard-rails D-44 §7 ships with the `contributes-to` kind, without
 * which it is a blanket exemption from the ownership rule.
 */
describe('findNonBindingIssues — the guard-rails on `contributes-to`', () => {
  const edge = (
    over: Partial<{
      dependsOn: string;
      kind: 'contributes-to' | 'degrades-without';
      whenAbsent: string | null;
    }> = {},
  ) => ({
    moduleId: 'shop',
    dependsOn: 'assistant',
    name: 'toolRegistry',
    kind: 'contributes-to' as 'contributes-to' | 'degrades-without',
    whenAbsent: null as string | null,
    reason: 'Pushes an inert tool descriptor into the assistant catalogue at boot.',
    ...over,
  });

  const push: PortResolution = {
    moduleId: 'shop',
    name: 'toolRegistry',
    file: '/repo/backend/src/modules/shop/backend.ts',
    line: 1,
    kind: 'deferred',
    via: 'cradle',
    site: 'boot',
  };

  const input = (
    over: Partial<Parameters<typeof findNonBindingIssues>[0]> = {},
  ): Parameters<typeof findNonBindingIssues>[0] => ({
    edges: [edge()],
    owners: new Map([['toolRegistry', 'assistant']]),
    providedPorts: new Map<string, string>(),
    resolutions: [push],
    contributionPolicies: { 'assistant:toolRegistry': 'skip' },
    ...over,
  });

  it('accepts a boot push into a registry whose host states a policy', () => {
    expect(findNonBindingIssues(input())).toEqual([]);
  });

  it('refuses a contribution to a registry whose host states no policy', () => {
    // Guard-rail 1. Without a stated absent-contributor policy the host may
    // enumerate an absent module's descriptor and act on it, which is the one
    // shape §7's argument does not cover.
    const issues = findNonBindingIssues(input({ contributionPolicies: {} }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('contribution-registry-without-policy');
    expect(describeNonBindingIssue(issues[0]!)).toContain('enumeration policy');
  });

  it('refuses a contribution over a gated port', () => {
    // A `providePort` name is a gate, and a gate that says no throws. Whatever
    // that is, it is not an inert push.
    const issues = findNonBindingIssues(
      input({ providedPorts: new Map([['toolRegistry', 'assistant']]) }),
    );
    expect(issues.map((issue) => issue.kind)).toContain('contribution-over-a-gated-port');
  });

  it('refuses a contribution the declaring module reads at call time', () => {
    // Guard-rail 2. Reading an answer out of an ungated registry is a pull, and
    // a pull needs `degrades-without` plus a stated degradation — which is what
    // an off-state test can be held to.
    const issues = findNonBindingIssues(input({ resolutions: [{ ...push, site: 'call' }] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('contribution-not-pushed-at-boot');
  });

  it('accepts a call-time read declared as `degrades-without`', () => {
    expect(
      findNonBindingIssues(
        input({
          edges: [
            edge({ kind: 'degrades-without', whenAbsent: 'the assistant offers no tools' }),
          ],
          resolutions: [{ ...push, site: 'call' }],
          contributionPolicies: {},
        }),
      ),
    ).toEqual([]);
  });

  it('refuses an edge that names the wrong owner', () => {
    // The lookup clears `<module>:<name>` outright, so a mis-attributed edge
    // would clear a resolution of a module the manifest never mentions.
    const issues = findNonBindingIssues(input({ edges: [edge({ dependsOn: 'accounting' })] }));
    expect(issues.map((issue) => issue.kind)).toContain('wrong-owner');
  });

  it('refuses an edge nothing in the declaring module resolves', () => {
    // The staleness sweep the alias table already has: a suppression with no
    // site under it is a claim about the tree that is no longer true.
    const issues = findNonBindingIssues(input({ resolutions: [] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('nothing-resolves');
  });
});

/**
 * `refuses-without` — the mirror rail (owner ruling, 2026-08-25).
 *
 * The kind makes a two-part claim: *the operation refuses* and *the owner's
 * activation control keeps working*. Each part is decidable, and each is
 * checked on its own fixture so neither can go blind behind the other's red.
 *
 * The fixture is deliberately the *good* case with one thing changed, because
 * both signals are absences — an absent gate, an absent sentence — and a
 * fixture that never satisfied the rule cannot tell you which absence it
 * caught.
 */
describe('findNonBindingIssues — the rail on `refuses-without`', () => {
  const call: PortResolution = {
    moduleId: 'shop',
    name: 'settlementPort',
    file: '/repo/backend/src/modules/shop/backend.ts',
    line: 1,
    kind: 'deferred',
    via: 'lazyPort',
    site: 'call',
  };

  const input = (
    over: Partial<Parameters<typeof findNonBindingIssues>[0]> = {},
  ): Parameters<typeof findNonBindingIssues>[0] => ({
    edges: [
      {
        moduleId: 'shop',
        dependsOn: 'settlement',
        name: 'settlementPort',
        kind: 'refuses-without',
        whenAbsent: 'checkout stops accepting orders',
        reason: 'The placement seam has no fallback and lets the 503 reach the buyer.',
      },
    ],
    owners: new Map([['settlementPort', 'settlement']]),
    providedPorts: new Map([['settlementPort', 'settlement']]),
    resolutions: [call],
    contributionPolicies: {},
    boundOwners: new Map([['shop', new Set<string>()]]),
    ...over,
  });

  it('accepts a call-time read of a gated port with a sentence and no bind', () => {
    expect(findNonBindingIssues(input())).toEqual([]);
  });

  it('refuses a refusal over a name nothing gates', () => {
    // An ungated registration keeps resolving, or resolves to nothing; either
    // way there is no `MODULE_DISABLED` for the entry to be describing.
    const issues = findNonBindingIssues(input({ providedPorts: new Map<string, string>() }));
    expect(issues.map((issue) => issue.kind)).toEqual(['refusal-over-an-ungated-name']);
    expect(describeNonBindingIssue(issues[0]!)).toContain('di.providePort');
  });

  it('refuses a refusal whose owner the declaring module also binds', () => {
    // `dependencies` and `acknowledgedDependencies` are what the flip-time
    // refusal reads, so the entry's second claim is false and the owner's
    // control is a dead switch. `defineModuleManifest` refuses this first; the
    // check re-derives it for a manifest built without the helper.
    const issues = findNonBindingIssues(
      input({ boundOwners: new Map([['shop', new Set(['settlement'])]]) }),
    );
    expect(issues.map((issue) => issue.kind)).toEqual(['refusal-over-a-bound-owner']);
    expect(describeNonBindingIssue(issues[0]!)).toContain('dead switch');
  });

  it('refuses a refusal that names nothing to show the operator', () => {
    const issues = findNonBindingIssues(
      input({ edges: [{ ...input().edges[0]!, whenAbsent: null }] }),
    );
    expect(issues.map((issue) => issue.kind)).toEqual(['refusal-without-a-sentence']);
  });

  it('holds the two shared rules over the new kind as well', () => {
    // `wrong-owner` and `nothing-resolves` are about the declaration rather
    // than the kind, and both run before the rail. A kind-specific `continue`
    // that skipped them would be the regression.
    expect(
      findNonBindingIssues(input({ owners: new Map([['settlementPort', 'treasury']]) })).map(
        (issue) => issue.kind,
      ),
    ).toContain('wrong-owner');
    expect(findNonBindingIssues(input({ resolutions: [] })).map((issue) => issue.kind)).toEqual([
      'nothing-resolves',
    ]);
  });
});

const layout = await requireModuleLayout('[port-dependency-check]');
/** The same layout, under a name the delegation cases below can reach. */
const REAL_LAYOUT = layout;

describe('CONTRIBUTION_POLICY_STATED — the registries a contribution may name', () => {
  /**
   * A contribution seam is wired one of two ways in this tree, and the table
   * covers both: a container registration a contributor resolves, and a process
   * singleton a contributor imports and pushes into. So the honesty check is
   * "the owning module really holds this name", not "the owning module's
   * `backend.ts` registers it" — which was the older, narrower question, and
   * the reason the payment family's three registries could not be listed at
   * all.
   */
  /**
   * The owner's directory is **resolved, never spelled** (feature 080, T040a):
   * a module lives under the application's source root or in a workspace member
   * declaring `endora: { type: 'module', id }`, and the two layouts keep the
   * entry point at different names. An owner this cannot place throws, because
   * a read that came back empty would report the ledger entry as unheld.
   */
  const ownerFile = (owner: string, ...segments: readonly string[]): string | null => {
    const dir = layout.moduleDirectoryOf(owner);
    if (dir === null) throw new Error(`[port-dependency-check] no such module: ${owner}`);
    for (const candidate of [join(dir, ...segments), join(dir, 'src', 'backend', ...segments)]) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };

  const holdsName = (owner: string, name: string): boolean => {
    const entry = ownerFile(owner, 'backend.ts') ?? ownerFile(owner, 'index.ts');
    if (entry === null) {
      throw new Error(`[port-dependency-check] ${owner} has no backend entry point`);
    }
    const source = readFileSync(entry, 'utf8');
    if (registeredNames(source, entry).includes(name)) {
      expect(
        providedPortNames(source, entry),
        `${owner}:${name} is a gated port, so a contribution to it is a pull`,
      ).not.toContain(name);
      return true;
    }
    const singleton = ownerFile(owner, 'services', 'registry-singleton.ts');
    return singleton !== null && readFileSync(singleton, 'utf8').includes(`export const ${name}`);
  };

  it('attributes every listed registry to the module that holds it, ungated', () => {
    // The ledger stays honest the same way `HOST_REGISTERED_PORTS` does: it is
    // a claim about the tree, so the tree is asked.
    for (const key of Object.keys(CONTRIBUTION_POLICY_STATED)) {
      const [owner, name] = key.split(':');
      expect(holdsName(owner ?? '', name ?? ''), `${key} is not held by ${owner}`).toBe(true);
    }
  });

  it('lists `gatewayRefundRegistry`, which now states one', () => {
    // D-44 §7 named it the live counter-example: it recorded no contributing
    // module id and its class stated nothing about an absent one, so four
    // gateway modules pushed a refund handler that kept charging their PSP
    // after an operator switched them off. The class records the contributor
    // and skips an absent one now, and the ledger reads this table — so
    // removing the entry turns those four pushes back into build failures.
    expect(CONTRIBUTION_POLICY_STATED['payments:gatewayRefundRegistry']).toBe('skip');
  });
});

describe('REGISTRY_POLICIES_UNSTATED — the ledger’s standing policy debt', () => {
  it('keys every entry `<owner>:<name>` on a module that exists', () => {
    const ids = new Set(DISCOVERED_MANIFESTS.map((entry) => entry.id));
    for (const key of Object.keys(REGISTRY_POLICIES_UNSTATED)) {
      const [owner, name] = key.split(':');
      expect(ids.has(owner ?? ''), `${key} names '${owner}', which is not a module`).toBe(true);
      expect(name ?? '').not.toBe('');
    }
  });

  it('says what would drain each entry, at some length', () => {
    // The table's whole value is that an entry is a decision somebody has to
    // take, not a shrug. A one-word reason is a shrug.
    for (const [key, reason] of Object.entries(REGISTRY_POLICIES_UNSTATED)) {
      expect(reason.length, `${key} has no real reason`).toBeGreaterThan(80);
    }
  });

  it('does not overlap a registry that already states a policy', () => {
    for (const key of Object.keys(REGISTRY_POLICIES_UNSTATED)) {
      expect(CONTRIBUTION_POLICY_STATED[key], `${key} is in both tables`).toBeUndefined();
    }
  });
});

describe('importedContributionSeams — the wiring the container does not see', () => {
  const STRIPE = '/repo/backend/src/modules/stripe/backend.ts';

  it('reads a push into a singleton imported from another module', () => {
    const source = [
      "import { gatewayRefundRegistry } from '../payments/services/registry-singleton.js';",
      'export function registerModule(ctx) {',
      '  ctx.onBoot(() => {',
      "    gatewayRefundRegistry.register(handler, 'stripe');",
      '  });',
      '}',
    ].join('\n');

    expect(importedContributionSeams(source, STRIPE)).toEqual([
      {
        moduleId: 'stripe',
        dependsOn: 'payments',
        name: 'gatewayRefundRegistry',
        file: STRIPE,
        line: 4,
        site: 'boot',
      },
    ]);
  });

  it('reads an unregister as the same seam', () => {
    const source = [
      "import { paymentAdapterRegistry } from '../payment_methods/services/registry-singleton.js';",
      "paymentAdapterRegistry.unregister('stripe');",
    ].join('\n');

    expect(importedContributionSeams(source, STRIPE).map((seam) => seam.dependsOn)).toEqual([
      'payment_methods',
    ]);
  });

  it('ignores an import the file never pushes into', () => {
    // Deliberately narrow: a cross-module import of a class, an error or a pure
    // function is Principle I's business, and 63 of them exist. Folding them in
    // would drown the one shape the ledger can answer for.
    const source = [
      "import { ReceivePaymentHandler } from '../payments/services/receive-payment-handler.js';",
      'const handler = new ReceivePaymentHandler();',
    ].join('\n');

    expect(importedContributionSeams(source, STRIPE)).toEqual([]);
  });

  it('ignores a type-only import and a module’s own singleton', () => {
    const source = [
      "import type { GatewayRefundRegistry } from '../payments/services/gateway-refund-registry.js';",
      "import { stripeRegistry } from './services/registry-singleton.js';",
      'stripeRegistry.register(x);',
    ].join('\n');

    expect(importedContributionSeams(source, STRIPE)).toEqual([]);
  });

  it('finds both pushes of the shape the four gateways shipped', () => {
    // The reach half: this shape is invisible to every other rule in the file,
    // because it is not a container resolution at all.
    //
    // This used to read `stripe/backend.ts` off disk, because the four payment
    // gateways were the tree's live instances of the shape — two imported
    // singletons each, pushed from one boot hook. Feature 075's Phase C cut all
    // eight: both registries are container names now, so the seams resolve like
    // any other. The fixture is the shape they shipped, verbatim, and it stays
    // because the rule stays: nothing stops the next module from importing a
    // registry singleton, and this is the only thing that would see it.
    const source = [
      "import { gatewayRefundRegistry } from '../payments/services/registry-singleton.js';",
      "import { paymentAdapterRegistry } from '../payment_methods/services/registry-singleton.js';",
      'export function registerModule(ctx) {',
      '  ctx.onBoot(() => {',
      '    const { adapter, refundHandler } = ctx.cradle().stripeServices;',
      "    paymentAdapterRegistry.register(adapter, 'stripe');",
      "    gatewayRefundRegistry.register(refundHandler, 'stripe');",
      '  });',
      '}',
    ].join('\n');
    const seams = importedContributionSeams(source, STRIPE);
    expect(seams.map((seam) => `${seam.dependsOn}:${seam.name}`).sort()).toEqual([
      'payment_methods:paymentAdapterRegistry',
      'payments:gatewayRefundRegistry',
    ]);
  });
});

describe('ledgerReads — the same capture test the violation rule applies', () => {
  const captured = (over: Partial<PortResolution>): PortResolution => ({
    moduleId: 'orders',
    name: 'paymentAdapterRegistry',
    file: '/repo/backend/src/modules/orders/backend.ts',
    line: 1,
    kind: 'captured',
    site: 'call',
    via: 'cradle',
    ...over,
  });
  const owners = new Map([
    ['paymentAdapterRegistry', 'payment_methods'],
    ['em', 'orders'],
  ]);

  it('carries a cross-module capture into the ledger', () => {
    const reads = ledgerReads({
      resolutions: [captured({})],
      seams: [],
      owners,
      providedPorts: new Map(),
    });
    expect(reads).toEqual([
      {
        moduleId: 'orders',
        dependsOn: 'payment_methods',
        name: 'paymentAdapterRegistry',
        gated: false,
        captured: true,
        site: 'call',
      },
    ]);
  });

  it('does not call a platform name a capture, and does not call an own name an edge', () => {
    // `em` is created by a composition root before any module composes, and a
    // module reading its own registration is not a cross-module edge at all.
    expect(
      ledgerReads({
        resolutions: [captured({ name: 'em' })],
        seams: [],
        owners,
        providedPorts: new Map(),
      }),
    ).toEqual([]);
  });

  it('marks a port registered with providePort as gated', () => {
    const reads = ledgerReads({
      resolutions: [captured({ kind: 'deferred' })],
      seams: [],
      owners,
      providedPorts: new Map([['paymentAdapterRegistry', 'payment_methods']]),
    });
    expect(reads[0]?.gated).toBe(true);
  });

  it('carries an import seam in as an ungated read', () => {
    const reads = ledgerReads({
      resolutions: [],
      seams: [
        {
          moduleId: 'stripe',
          dependsOn: 'payments',
          name: 'gatewayRefundRegistry',
          file: '/repo/backend/src/modules/stripe/backend.ts',
          line: 1,
          site: 'boot',
        },
      ],
      owners,
      providedPorts: new Map(),
    });
    expect(reads).toEqual([
      {
        moduleId: 'stripe',
        dependsOn: 'payments',
        name: 'gatewayRefundRegistry',
        gated: false,
        captured: false,
        site: 'boot',
      },
    ]);
  });
});

describe('describeUnassignedEdge — the message names the repair', () => {
  it('tells a capture what to do instead', () => {
    const message = describeUnassignedEdge({
      moduleId: 'orders',
      dependsOn: 'payment_methods',
      name: 'paymentAdapterRegistry',
      shape: 'captured-registration',
      detail: 'read once at construction',
    });
    expect(message).toContain('orders → payment_methods:paymentAdapterRegistry');
    expect(message).toContain('accessor');
  });

  it('tells a policy-less registry where the decision goes', () => {
    const message = describeUnassignedEdge({
      moduleId: 'stripe',
      dependsOn: 'payments',
      name: 'gatewayRefundRegistry',
      shape: 'registry-without-policy',
      detail: 'states nothing',
    });
    expect(message).toContain('CONTRIBUTION_POLICY_STATED');
    expect(message).toContain('REGISTRY_POLICIES_UNSTATED');
  });
});


describe('a deployment’s overlay module is visible to this check (issue #210)', () => {
  /**
   * The check walks `src/apps/` for **resolutions** and used to read
   * **declarations** from the generated manifest index alone — which D-104
   * makes bare core by construction. So an overlay module resolving a port
   * could not clear the finding however its manifest was written, and the
   * remedy line named `src/modules/<id>/manifest.ts`, a path that does not
   * exist for it.
   *
   * Before D-103 the gap was unreachable rather than absent: an overlay module
   * was handed `requireAdmin` through `OverlayModuleContext` and resolved no
   * port at all.
   */
  it('reads every deployment’s overlay manifests, not the DEPLOYMENT-named one', async () => {
    const entries = await overlayManifestEntries();
    const example = entries.find((e) => e.id === 'example_overlay');

    // Non-vacuity: a reader that found nothing would silently restore the old
    // blindness, and every assertion below would pass on an empty array.
    expect(entries.length).toBeGreaterThan(0);
    expect(example).toBeDefined();
    expect(example?.manifest.dependencies).toContain('auth');
    expect(example?.manifestPath).toBe(
      'src/apps/example/modules/example_overlay/manifest.ts',
    );
  });

  it('names the overlay module’s real manifest path in the remedy line', () => {
    const message = describeViolation(
      {
        kind: 'undeclared-dependency',
        owner: 'auth',
        resolution: {
          moduleId: 'example_overlay',
          name: 'requireAdmin',
          file: '/repo/backend/src/apps/example/modules/example_overlay/backend.ts',
          line: 104,
        } as PortResolution,
      } as Parameters<typeof describeViolation>[0],
      '/repo/backend/src',
    );

    expect(message).toContain('src/apps/example/modules/example_overlay/manifest.ts');
    expect(message).not.toContain('src/modules/example_overlay/manifest.ts');
  });
});

/**
 * A composition root that delegates (feature 109, Phase 1c).
 *
 * `backend/test/helpers/test-server.ts` supplies a composition and
 * `@endora-commerce/test-kit/server` performs it, so *what the harness
 * registers* is spread over two files: the names the composer writes into
 * `registerValues` itself, and the names the root hands it as data. Reading only
 * the root reported **16** production-only registrations on the merge request
 * that made the harness the kit's first caller — every one of them a name the
 * harness composition does register — and printed, for each, a remedy that had
 * already been followed.
 *
 * Both halves enter here as **source text** (issue #130): a fixture that entered
 * as a pre-computed name set would exercise neither derivation.
 */
describe('a delegating root supplies through its composer', () => {
  it('reads which option field the composer spreads into its registration', () => {
    const composer = [
      "import { registerValues } from '@endora-commerce/platform/composition';",
      'export function composeTestServer(options: Options): void {',
      '  registerValues(container, {',
      '    redis,',
      '    eventBus,',
      '    ...options.values,',
      '  });',
      '}',
      '',
    ].join('\n');

    // The field is the composer's declaration, not a convention: spelling
    // `values` into the check would be one copy of a fact the composer states.
    expect(delegatedSupplyFields(composer, 'compose.ts')).toEqual(['values']);
    // And the names the composer registers outright are still the call shapes
    // this check has always read.
    expect(rootRegisteredNames(composer, 'compose.ts')).toEqual(['redis', 'eventBus']);
  });

  it('reads nothing where the composer spreads no option field', () => {
    // The exit-2 condition, at the point that decides it: a composer with no
    // data seam means every host value a root hands it is invisible, and the
    // check must refuse rather than report them as registered by nobody.
    const composer = [
      "import { registerValues } from '@endora-commerce/platform/composition';",
      'export function composeTestServer(): void {',
      '  registerValues(container, { redis });',
      '}',
      '',
    ].join('\n');

    expect(delegatedSupplyFields(composer, 'compose.ts')).toEqual([]);
  });

  it('collects the names a root hands the composer as data', () => {
    const root = [
      "import { composeTestServer } from '@endora-commerce/test-kit/server';",
      'export async function setupBackendServer(): Promise<void> {',
      '  await composeTestServer({',
      '    composition,',
      '    values: {',
      '      productFeedsRunWorkers: false,',
      "      storefrontBaseUrl: 'http://localhost:3000',",
      '    },',
      '    contribute: async () => undefined,',
      '  });',
      '}',
      '',
    ].join('\n');

    expect(delegatedSuppliedNames(root, 'root.ts', 'composeTestServer', ['values'])).toEqual([
      'productFeedsRunWorkers',
      'storefrontBaseUrl',
    ]);
    // The names are invisible to the call-shape reader, which is the whole
    // reason this derivation exists: the root calls no registration function.
    expect(rootRegisteredNames(root, 'root.ts')).not.toContain('storefrontBaseUrl');
  });

  it('reads a field only where the composer declared one', () => {
    // The discrimination. `contribute` is an option of the same call and carries
    // a callback, not registrations; a derivation that took every object-valued
    // option would collect whatever a caller happened to write there.
    const root = [
      "import { composeTestServer } from '@endora-commerce/test-kit/server';",
      'await composeTestServer({',
      '  values: { storefrontBaseUrl: 1 },',
      '  server: { openApi: { title: 1 } },',
      '});',
      '',
    ].join('\n');

    expect(delegatedSuppliedNames(root, 'root.ts', 'composeTestServer', ['values'])).toEqual([
      'storefrontBaseUrl',
    ]);
  });

  it('follows this repository’s own harness to the composer it delegates to', () => {
    // The derivation over the real tree, which is what makes the three fixtures
    // above evidence about something rather than about themselves. A rebuild is
    // not required and must not be: the composer is read at its **source**,
    // because a package resolves at its build output (D-164) and a ledger taken
    // from the artefact would describe the previous build.
    const layout = REAL_LAYOUT;
    const rootPath = join(layout.applicationRoot, ROOT_FILES['harness'] as string);
    const rootSource = readFileSync(rootPath, 'utf8');
    const binding = ROOT_DELEGATES_TO['harness'] as string;

    const delegation = delegatedComposerOf(rootSource, rootPath, layout.repoRoot, binding);
    expect(delegation.ok, delegation.ok ? '' : JSON.stringify(delegation)).toBe(true);
    if (!delegation.ok) return;

    expect(delegation.composer.files.length).toBeGreaterThan(0);
    expect(delegation.composer.source).toContain(`function ${binding}(`);
    // The names that were reported as production-only before the delegation was
    // followed. All seven are the platform's own, registered by the composer.
    const supplied = new Set(
      delegation.composer.files.flatMap((file) =>
        rootRegisteredNames(readFileSync(file, 'utf8'), file),
      ),
    );
    for (const name of [
      'redis',
      'redisSubscriber',
      'eventBus',
      'commandBus',
      'auditLogService',
      'apiInterceptors',
      'resolvedModuleRegistry',
    ]) {
      expect(supplied, `${name} is not registered by the composer`).toContain(name);
    }
  });

  it('refuses a root whose composer it cannot find, rather than reading none', () => {
    const layout = REAL_LAYOUT;
    const rootPath = join(layout.applicationRoot, ROOT_FILES['harness'] as string);
    const rootSource = readFileSync(rootPath, 'utf8');

    const delegation = delegatedComposerOf(
      rootSource,
      rootPath,
      layout.repoRoot,
      'composeSomethingNobodyImports',
    );
    expect(delegation.ok).toBe(false);
    if (delegation.ok) return;
    expect(delegation.refusal.kind).toBe('no-import');
    expect(delegationRefusalMessage('[port-deps]', delegation.refusal)).toContain(
      'supplies nothing',
    );
  });
});

/**
 * The third composition (`specs/117-instance-bring-up/` FR-034).
 *
 * `findRootIssues` above compares the two roots **to each other**, and the
 * eleven names feature 117's Phase 6 drained were in **both** — so the sweep
 * that exists to find a supply gap was structurally incapable of seeing the
 * largest one there was. A client's tree composes with `composeApp` and nothing
 * else, which is a third supply set this file had no notion of.
 *
 * The second case is what makes the first worth anything. A rule that reported
 * every name a module reads would be red on a correct tree, so the
 * discrimination is asserted beside the finding rather than inferred from the
 * finding's absence elsewhere.
 */
describe('findInstanceGaps — what a client instance cannot resolve', () => {
  const READER = [
    'export function registerModule(ctx: ModuleContext): void {',
    '  ctx.di.register({',
    '    orderService: ctx.asFunction(() => ({',
    '      scope: () => ctx.cradle<Deps>().ordersAdminScopeResolver(),',
    '    })).singleton(),',
    '  });',
    '}',
  ].join('\n');
  const READER_FILE = '/repo/packages/modules/orders/src/backend/index.ts';
  const COMPOSE_APP_FILE = '/repo/packages/platform/src/composition/compose-app.ts';

  const gapsOver = (composeApp: string, ownerSource = ''): ReturnType<typeof findInstanceGaps> =>
    findInstanceGaps({
      resolutions: resolvedNames(READER, READER_FILE).map((resolution) => ({
        moduleId: 'orders',
        name: resolution.name,
      })),
      moduleRegistered: new Set(registeredNames(ownerSource, '/repo/owner.ts')),
      kernelNames: new Set<string>(),
      instanceSupplied: new Set(rootRegisteredNames(composeApp, COMPOSE_APP_FILE)),
      hostRegistered: { ordersAdminScopeResolver: 'auth' },
    });

  it('reports a name only a deployment root supplies', () => {
    const gaps = gapsOver('registerValues(container, { redis, eventBus });');

    expect(gaps.map((gap) => gap.name)).toEqual(['ordersAdminScopeResolver']);
    expect(gaps[0]!.readers).toEqual(['orders']);
    // The owner in principle reaches the message, so its reader is sent to the
    // module that should default it rather than to the table.
    expect(gaps[0]!.owner).toBe('auth');
    expect(describeInstanceGap(gaps[0]!)).toContain("default it");
  });

  it('says nothing about a name `composeApp` supplies — the discrimination', () => {
    expect(
      gapsOver('composedModules.contribute({ ordersAdminScopeResolver: fromActor });'),
    ).toEqual([]);
  });

  it('says nothing about a name the owning module registers', () => {
    expect(
      gapsOver(
        'registerValues(container, { redis });',
        [
          'export function registerModule(ctx: ModuleContext): void {',
          '  ctx.di.register({ ordersAdminScopeResolver: ctx.asFunction(() => fromActor) });',
          '}',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('names every reader of one gap once, rather than one finding per read', () => {
    const gaps = findInstanceGaps({
      resolutions: [
        { moduleId: 'orders', name: 'ordersAdminScopeResolver' },
        { moduleId: 'customers', name: 'ordersAdminScopeResolver' },
        { moduleId: 'orders', name: 'ordersAdminScopeResolver' },
      ],
      moduleRegistered: new Set(),
      kernelNames: new Set(),
      instanceSupplied: new Set(['redis']),
      hostRegistered: {},
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.readers).toEqual(['customers', 'orders']);
    // No owner in principle, so the message offers both honest repairs.
    expect(describeInstanceGap(gaps[0]!)).toContain("register it in 'composeApp'");
  });
});
