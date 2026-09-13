/**
 * The deployment examples an instance is scaffolded with
 * (`specs/122-layer-deployment-independence/contracts/layer-independence.md` §3,
 * under **D-230**; `tasks.md` T010–T017).
 *
 * ## What was measured before this existed
 *
 * A scaffolded instance received **no deployment file at all** — no compose
 * file, no nginx configuration, no `.env` for a running stack and no Dockerfile
 * — while `instance-repository.md` R2.1 listed three of them as *"always in the
 * instance"*. Re-derived on this branch: `grep -n "Dockerfile\|compose\.\|deploy/"
 * packages/cli/src/new-instance/template.ts` matched nothing. A client asked for
 * the owner's three-host topology wrote three deployment files from scratch,
 * against a compose example that lives in **our** repository and assumes one
 * host.
 *
 * ## Every assertion here is over a rendered file, parsed
 *
 * T010: *"a test that greps the example for a string proves the string, not the
 * file"*. The compose examples go through {@link parseComposeYaml}, so what is
 * asserted is the service mapping and the `depends_on` edges the document
 * really declares — a `depends_on` one indentation level out of place is red
 * here and invisible to a substring match.
 *
 * ## The finding the three-host split rests on, asserted rather than assumed
 *
 * `deploy/compose.prod.yml`'s dependency graph partitions cleanly at the three
 * layer boundaries: exactly one edge crosses (`storefront -> backend`,
 * `service_healthy`, a readiness convenience) and the only
 * `service_completed_successfully` edge (`backend -> backend-migrate`) lives
 * entirely inside the backend host. The renderer **derives** the three-host
 * files by dropping the edges that cross a partition, so the count below is a
 * measurement of the emitted files rather than a restatement of the design: an
 * edge added across a boundary moves it, and a correctness edge crossing one
 * would move it too.
 */
import { describe, expect, it } from 'vitest';

import { buildArgFlags, type BuildTarget } from '../../src/lib/instance-build-inputs.js';
import { assertTopology, TOPOLOGIES, type Topology } from '../../src/new-instance/deploy.js';
import { InstanceInputError } from '../../src/new-instance/host.js';
import {
  planInstance,
  type PlannedFile,
  type PlanInput,
} from '../../src/new-instance/template.js';
import { dependsOnEdges, parseComposeYaml, serviceNames } from './compose-yaml.js';

const SCOPE = '@endora-commerce/';

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    name: 'acme-shop',
    deployment: 'acme-shop',
    scope: SCOPE,
    platformVersion: '1.2.3',
    enginesNode: '>=22.17.0',
    packageManager: 'pnpm@9.15.0',
    modules: [{ id: 'settings', packageName: `${SCOPE}mod-settings`, version: '0.4.5' }],
    adminShellVersion: null,
    adminKitVersion: null,
    adminRanges: new Map(),
    adminPeers: new Map(),
    cliVersion: '1.2.3',
    docsRanges: new Map([
      ['@docusaurus/core', '^3.10.0'],
      ['@docusaurus/preset-classic', '^3.10.0'],
    ]),
    declaredRanges: new Map([
      ['@mikro-orm/core', '^6'],
      ['@mikro-orm/postgresql', '^6'],
      ['fastify', '^5'],
      ['zod', '^4'],
      ['ioredis', '^5.10.1'],
      ['typescript', '^5.9.3'],
    ]),
    registry: null,
    npmrc: null,
    topology: 'single-host',
    ...overrides,
  };
}

/** A complete instance: every member written. */
function withAdmin(overrides: Partial<PlanInput> = {}): PlanInput {
  return planInput({
    adminShellVersion: '4.5.6',
    adminKitVersion: '4.5.6',
    adminRanges: new Map([
      ['react', '^19.0.0'],
      ['react-dom', '^19.0.0'],
      ['vite', '^7.3.2'],
      ['@vitejs/plugin-react', '^5.2.0'],
      ['tailwindcss', '^4.2.4'],
      ['@tailwindcss/vite', '^4.2.4'],
    ]),
    adminPeers: new Map(),
    ...overrides,
  });
}

function deployFilesOf(input: PlanInput): readonly PlannedFile[] {
  return planInstance(input).files.filter((file) => file.path.startsWith('deploy/'));
}

function fileAt(input: PlanInput, path: string): string {
  const file = planInstance(input).files.find((entry) => entry.path === path);
  expect(file, `${path} is not in the plan`).toBeDefined();
  return file!.content;
}

describe('§3 R3.1 — an instance carries example deployment files, derived from two axes', () => {
  it('`single-host` writes one compose example, one `.env.example` and one nginx example', () => {
    expect(deployFilesOf(withAdmin()).map((file) => file.path).sort()).toEqual([
      'deploy/.env.example',
      'deploy/Dockerfile.admin',
      'deploy/Dockerfile.backend',
      'deploy/README.md',
      'deploy/compose.prod.yml',
      'deploy/nginx.example.conf',
    ]);
  });

  it('`three-host` writes one compose example and one `.env.example` per host', () => {
    expect(
      deployFilesOf(withAdmin({ topology: 'three-host' })).map((file) => file.path).sort(),
    ).toEqual([
      'deploy/Dockerfile.admin',
      'deploy/Dockerfile.backend',
      'deploy/README.md',
      'deploy/three-host/.env.admin.example',
      'deploy/three-host/.env.backend.example',
      'deploy/three-host/.env.storefront.example',
      'deploy/three-host/compose.admin.yml',
      'deploy/three-host/compose.backend.yml',
      'deploy/three-host/compose.storefront.yml',
    ]);
  });

  it('the derivation keys on the member, so an admin-less instance loses the admin files', () => {
    expect(deployFilesOf(planInput()).map((file) => file.path).sort()).toEqual([
      'deploy/.env.example',
      'deploy/Dockerfile.backend',
      'deploy/README.md',
      'deploy/compose.prod.yml',
      'deploy/nginx.example.conf',
    ]);
    expect(
      deployFilesOf(planInput({ topology: 'three-host' })).map((file) => file.path).sort(),
    ).toEqual([
      'deploy/Dockerfile.backend',
      'deploy/README.md',
      'deploy/three-host/.env.backend.example',
      'deploy/three-host/.env.storefront.example',
      'deploy/three-host/compose.backend.yml',
      'deploy/three-host/compose.storefront.yml',
    ]);
  });

  it('every deploy file is the client\'s own kind, at the workspace root', () => {
    for (const file of deployFilesOf(withAdmin({ topology: 'three-host' }))) {
      expect(file.kind, file.path).toBe('client');
      expect(file.member, file.path).toBe('root');
    }
  });
});

describe('§3 R3.2 — `--topology` selects; it does not record', () => {
  it('names two topologies and defaults to the one D-230 kept', () => {
    expect([...TOPOLOGIES]).toEqual(['single-host', 'three-host']);
    expect(assertTopology('single-host')).toBe('single-host');
    expect(assertTopology('three-host')).toBe('three-host');
  });

  it('refuses an unrecognised value with the vocabulary, as an operator-fixable refusal', () => {
    const error = ((): unknown => {
      try {
        return assertTopology('two-host');
      } catch (caught: unknown) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(InstanceInputError);
    expect((error as Error).message).toContain('two-host');
    expect((error as Error).message).toContain('single-host');
    expect((error as Error).message).toContain('three-host');
  });

  it('no file the tooling reads back mentions the topology, and only prose does at all', () => {
    for (const topology of TOPOLOGIES) {
      const plan = planInstance(withAdmin({ topology }));
      const mentions = plan.files
        .filter((file) => /topolog/i.test(file.content))
        .map((file) => file.path);
      // A topology is a fact about the client's machines. Recording it would be
      // a third home for what an instance is, beside the `dependencies` that
      // are the module set and the members derived from them.
      expect(mentions).toEqual(['deploy/README.md']);
    }
  });
});

describe('§3 R3.3 — what each topology writes, read off the parsed documents', () => {
  const singleHost = (): ReturnType<typeof parseComposeYaml> =>
    parseComposeYaml(fileAt(withAdmin(), 'deploy/compose.prod.yml'));

  const threeHost = (): readonly ReturnType<typeof parseComposeYaml>[] => {
    const input = withAdmin({ topology: 'three-host' });
    return [
      parseComposeYaml(fileAt(input, 'deploy/three-host/compose.backend.yml')),
      parseComposeYaml(fileAt(input, 'deploy/three-host/compose.storefront.yml')),
      parseComposeYaml(fileAt(input, 'deploy/three-host/compose.admin.yml')),
    ];
  };

  it('the single-host example holds the stateful services, the migration job and the apps', () => {
    expect(serviceNames(singleHost())).toEqual([
      'admin',
      'backend',
      'backend-migrate',
      'meilisearch',
      'postgres',
      'redis',
      'storefront',
    ]);
  });

  it('R1.4 — every stateful service is on the backend host, and the apps are alone', () => {
    const [backend, storefront, admin] = threeHost();
    expect(serviceNames(backend!)).toEqual([
      'backend',
      'backend-migrate',
      'meilisearch',
      'postgres',
      'redis',
    ]);
    expect(serviceNames(storefront!)).toEqual(['storefront']);
    expect(serviceNames(admin!)).toEqual(['admin']);
  });

  it('the union of the three files is the single-host set, service for service', () => {
    const union = threeHost().flatMap((document) => serviceNames(document)).sort();
    expect(union).toEqual([...serviceNames(singleHost())]);
  });

  it('R3.6 — the split loses exactly one `depends_on` edge, and it is the readiness one', () => {
    const before = dependsOnEdges(singleHost());
    const after = threeHost().flatMap((document) => dependsOnEdges(document));
    const lost = before.filter(
      (edge) => !after.some((kept) => kept.from === edge.from && kept.to === edge.to),
    );
    expect(lost).toEqual([{ from: 'storefront', to: 'backend', condition: 'service_healthy' }]);
    expect(after.length).toBe(before.length - 1);
  });

  it('R3.6 — the only completion edge is inside the backend host, and it survives', () => {
    const [backend] = threeHost();
    const completion = dependsOnEdges(backend!).filter(
      (edge) => edge.condition === 'service_completed_successfully',
    );
    expect(completion).toEqual([
      { from: 'backend', to: 'backend-migrate', condition: 'service_completed_successfully' },
    ]);
    // …and it is the only one in the whole single-host example too, which is
    // what makes the partition free of a correctness cost.
    expect(
      dependsOnEdges(singleHost()).filter(
        (edge) => edge.condition === 'service_completed_successfully',
      ),
    ).toEqual(completion);
  });

  it('R3.6 — nothing replaces the lost edge: no wait-for-it, no init container', () => {
    const [, storefront, admin] = threeHost();
    expect(dependsOnEdges(storefront!)).toEqual([]);
    expect(dependsOnEdges(admin!)).toEqual([]);
    for (const document of threeHost()) {
      const services = document['services'] as Record<string, unknown>;
      for (const definition of Object.values(services)) {
        expect(JSON.stringify(definition)).not.toMatch(/wait-for|wait_for|dockerize/);
      }
    }
  });
});

describe('§3 R3.4 and R3.5 — a cross-host URL is a real origin, and the split has a stated cost', () => {
  const storefrontExample = (): string =>
    fileAt(withAdmin({ topology: 'three-host' }), 'deploy/three-host/compose.storefront.yml');

  it('the storefront reaches the backend by its public origin, never by a container name', () => {
    const document = parseComposeYaml(storefrontExample());
    const service = (document['services'] as Record<string, Record<string, Record<string, string>>>)[
      'storefront'
    ]!;
    expect(service['environment']!['BACKEND_BASE_URL']).toBe('https://${API_DOMAIN}');
  });

  it('no three-host example resolves anything on a shared Docker network', () => {
    const input = withAdmin({ topology: 'three-host' });
    for (const file of deployFilesOf(input)) {
      if (!file.path.startsWith('deploy/three-host/')) continue;
      expect(file.content, file.path).not.toContain('http://backend:');
    }
  });

  it('R3.5 — both costs are stated in the file, not in a guide', () => {
    const text = storefrontExample();
    // 1. every server-rendered page gains a network round trip.
    expect(text).toMatch(/round trip/i);
    // 2. `REVALIDATE_SECRET` becomes a bearer secret on a public endpoint.
    expect(text).toContain('REVALIDATE_SECRET');
    expect(text).toMatch(/public endpoint|over the internet|crosses the internet/i);
  });
});

describe('§3 R3.7 — the origin triple is scoped by declared consumer, never by name', () => {
  it('the backend keeps `ADMIN_BASE_URL` and `CORS_ALLOWED_ORIGINS` with no admin member', () => {
    // Both are read by the **backend** — `mfa` composes mailed links from the
    // first and `packages/platform/src/http/server.ts` reads the second — so
    // dropping them with the admin member would be a rule keyed on the
    // variable's name, which is wrong on two of the three inputs that mention
    // the admin.
    const singleHost = fileAt(planInput(), 'deploy/.env.example');
    expect(singleHost).toContain('ADMIN_BASE_URL=');
    expect(singleHost).toContain('CORS_ALLOWED_ORIGINS=');
    const threeHost = fileAt(
      planInput({ topology: 'three-host' }),
      'deploy/three-host/.env.backend.example',
    );
    expect(threeHost).toContain('ADMIN_BASE_URL=');
    expect(threeHost).toContain('CORS_ALLOWED_ORIGINS=');
  });

  it('`VITE_API_BASE_URL` is the admin build\'s and goes with the member', () => {
    // It is an argument to `docker build`, not a value a running container
    // reads, so it appears in the admin image example and in no compose file.
    expect(fileAt(withAdmin(), 'deploy/Dockerfile.admin')).toContain('VITE_API_BASE_URL');
    expect(fileAt(withAdmin(), 'deploy/compose.prod.yml')).not.toContain('VITE_API_BASE_URL');
    expect(
      deployFilesOf(planInput()).some((file) => file.content.includes('VITE_API_BASE_URL')),
    ).toBe(false);
  });

  it('an admin-less instance names no admin service and no `ADMIN_DOMAIN` in the nginx example', () => {
    expect(serviceNames(parseComposeYaml(fileAt(planInput(), 'deploy/compose.prod.yml')))).toEqual([
      'backend',
      'backend-migrate',
      'meilisearch',
      'postgres',
      'redis',
      'storefront',
    ]);
    expect(fileAt(planInput(), 'deploy/nginx.example.conf')).not.toContain('ADMIN_DOMAIN');
    expect(fileAt(withAdmin(), 'deploy/nginx.example.conf')).toContain('ADMIN_DOMAIN');
  });

  it('every variable a compose example expands is declared in that host\'s `.env.example`', () => {
    const pairs: readonly (readonly [string, string])[] = [
      ['deploy/compose.prod.yml', 'deploy/.env.example'],
      ['deploy/three-host/compose.backend.yml', 'deploy/three-host/.env.backend.example'],
      ['deploy/three-host/compose.storefront.yml', 'deploy/three-host/.env.storefront.example'],
      ['deploy/three-host/compose.admin.yml', 'deploy/three-host/.env.admin.example'],
    ];
    for (const [compose, env] of pairs) {
      const input = withAdmin({ topology: compose.includes('three-host') ? 'three-host' : 'single-host' });
      const referenced = [
        ...new Set(
          [...fileAt(input, compose).matchAll(/\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/g)].map(
            (match) => match[1]!,
          ),
        ),
      ].sort();
      const declared = [
        ...new Set(
          [...fileAt(input, env).matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]!),
        ),
      ].sort();
      expect(referenced.length, `${compose} expands no variable at all`).toBeGreaterThan(0);
      // Two-way: a variable the compose file expands and the example does not
      // declare is an operator finding a blank; a variable the example declares
      // and nothing reads is a value nobody can act on.
      expect(declared, `${env} against ${compose}`).toEqual(referenced);
    }
  });

  it('the three `.env` files are not interchangeable, and their contents say so', () => {
    const input = withAdmin({ topology: 'three-host' });
    const backend = fileAt(input, 'deploy/three-host/.env.backend.example');
    const storefront = fileAt(input, 'deploy/three-host/.env.storefront.example');
    const admin = fileAt(input, 'deploy/three-host/.env.admin.example');
    expect(new Set([backend, storefront, admin]).size).toBe(3);
    expect(storefront).not.toContain('POSTGRES_PASSWORD=');
    expect(admin).not.toContain('SESSION_COOKIE_SECRET=');
  });
});

describe('§2 R2.3 and §3 R3.8 — an example Dockerfile per image, with no fourth spelling', () => {
  const dockerfiles: readonly (readonly [BuildTarget, string])[] = [
    ['backend', 'deploy/Dockerfile.backend'],
    ['admin', 'deploy/Dockerfile.admin'],
  ];

  it('every `--build-arg` line in an example is the declaration\'s own', () => {
    for (const [target, path] of dockerfiles) {
      const text = fileAt(withAdmin(), path);
      const emitted = [...text.matchAll(/--build-arg [^\s\\]+(?:="[^"]*")?/g)].map(
        (match) => match[0]!,
      );
      expect(emitted, `${path} passes no build argument`).toEqual([...buildArgFlags(target)]);
    }
  });

  it('every `ARG` the example declares is a consumer the declaration names', () => {
    for (const [target, path] of dockerfiles) {
      const text = fileAt(withAdmin(), path);
      const args = [...text.matchAll(/^ARG ([A-Z0-9_]+)/gm)].map((match) => match[1]!).sort();
      const declared = buildArgFlags(target)
        .map((flag) => /--build-arg ([A-Z0-9_]+)/.exec(flag)![1]!)
        .sort();
      expect(args, path).toEqual(declared);
    }
  });

  it('the storefront gets none — its image is its own repository\'s (D-195)', () => {
    expect(
      deployFilesOf(withAdmin()).some((file) => file.path.includes('Dockerfile.storefront')),
    ).toBe(false);
  });

  it('R2.5 — the admin example states that one bundle serves one backend origin', () => {
    const text = fileAt(withAdmin(), 'deploy/Dockerfile.admin');
    expect(text).toMatch(/build time|at build/i);
    expect(text).toMatch(/rebuild/i);
  });

  it('the examples build through the named per-layer scripts, not a second spelling', () => {
    expect(fileAt(withAdmin(), 'deploy/Dockerfile.backend')).toContain('pnpm run build:backend');
    expect(fileAt(withAdmin(), 'deploy/Dockerfile.admin')).toContain('pnpm run build:admin');
  });
});

describe('T016 — `deploy/README.md` tells one reader how to bring three hosts up', () => {
  it('names every file this render wrote, and no file it did not', () => {
    for (const topology of TOPOLOGIES) {
      const input = withAdmin({ topology });
      const readme = fileAt(input, 'deploy/README.md');
      const written = deployFilesOf(input)
        .map((file) => file.path.slice('deploy/'.length))
        .filter((path) => path !== 'README.md');
      for (const path of written) expect(readme, `${topology}: ${path}`).toContain(path);
      const absent =
        topology === 'single-host'
          ? ['three-host/compose.backend.yml']
          : ['compose.prod.yml', 'nginx.example.conf'];
      for (const path of absent) expect(readme, `${topology}: ${path}`).not.toContain(path);
    }
  });

  it('D-215 — its first paragraph says these are examples', () => {
    for (const topology of TOPOLOGIES) {
      const readme = fileAt(withAdmin({ topology }), 'deploy/README.md');
      const first = readme.split('\n\n').slice(0, 2).join('\n\n');
      expect(first, topology).toMatch(/example/i);
    }
  });

  it('the three-host README states the order and that the `.env` files differ', () => {
    const readme = fileAt(withAdmin({ topology: 'three-host' }), 'deploy/README.md');
    expect(readme).toMatch(/not interchangeable/i);
    expect(readme.indexOf('compose.backend.yml')).toBeLessThan(
      readme.indexOf('compose.storefront.yml'),
    );
  });
});

describe('what a reviewer checks: no second module list, and no concrete deployment', () => {
  it('no deploy example names a module package', () => {
    for (const topology of TOPOLOGIES) {
      for (const file of deployFilesOf(withAdmin({ topology }))) {
        expect(file.content, file.path).not.toContain(`${SCOPE}mod-`);
      }
    }
  });

  it('D-215 — no example carries a real registry, a real domain or a real secret', () => {
    for (const topology of TOPOLOGIES) {
      for (const file of deployFilesOf(withAdmin({ topology }))) {
        expect(file.content, file.path).not.toContain('gitlab.endora.pl');
        expect(file.content, file.path).not.toContain('registry.gitlab.com');
        expect(file.content, file.path).not.toContain('endora-commerce-backend');
      }
    }
  });
});

describe('the topology reaches the plan, and nothing else changes with it', () => {
  it('a topology changes the `deploy/` tree and no other file', () => {
    const single = planInstance(withAdmin());
    const three = planInstance(withAdmin({ topology: 'three-host' }));
    const outside = (plan: typeof single): readonly string[] =>
      plan.files
        .filter((file) => !file.path.startsWith('deploy/'))
        .map((file) => `${file.path}\0${file.content}`)
        .sort();
    expect(outside(three)).toEqual(outside(single));
    expect(three.members).toEqual(single.members);
  });

  it('every topology renders, so no branch is unreachable', () => {
    for (const topology of TOPOLOGIES satisfies readonly Topology[]) {
      expect(deployFilesOf(withAdmin({ topology })).length).toBeGreaterThan(3);
    }
  });
});
