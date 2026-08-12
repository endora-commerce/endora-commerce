import { describe, expect, it } from 'vitest';
import {
  closureOf,
  describe as describeViolation,
  findViolations,
  registeredNames,
  resolvedNames,
  HOST_REGISTERED_PORTS,
  PLATFORM_OWNED_NAMES,
  type PortResolution,
} from '../../../scripts/check-port-dependencies.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';

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

  it('carries the module id and the line, so the report points at the code', () => {
    const source = ['', 'ctx.asFunction(({ requireAdmin }: C) => 1);'].join('\n');
    expect(resolvedNames(source, BLOG)[0]).toMatchObject({ moduleId: 'blog', line: 2 });
  });
});

describe('findViolations', () => {
  const resolution = (moduleId: string, name: string): PortResolution => ({
    moduleId,
    name,
    file: `/repo/backend/src/modules/${moduleId}/backend.ts`,
    line: 1,
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
