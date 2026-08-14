import { describe, expect, it } from 'vitest';
import {
  closureOf,
  describe as describeViolation,
  findViolations,
  findRootIssues,
  NON_LITERAL_PORT_NAME,
  providedPortNames,
  registeredNames,
  resolvedNames,
  rootRegisteredNames,
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
  const resolution = (
    moduleId: string,
    name: string,
    kind: PortResolution['kind'] = 'deferred',
  ): PortResolution => ({
    moduleId,
    name,
    file: `/repo/backend/src/modules/${moduleId}/backend.ts`,
    line: 1,
    kind,
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
        resolvedNames: new Set<string>(),
      }),
    ).toEqual([]);
  });

  it('flags a host-registered port only one composition supplies', () => {
    const issues = findRootIssues({
      moduleRegistered: new Map(),
      rootNames: roots([], ['settingsAdminService']),
      hostRegistered: { settingsAdminService: 'settings' },
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
        resolvedNames: new Set<string>(),
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
