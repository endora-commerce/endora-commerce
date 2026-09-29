import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `deploy/compose.prod.yml` starts on a fresh host, beside another stack, and
 * installs the modules before the API boots (D-274 clause 5;
 * `specs/136-open-source-publication/` FR-104, FR-106, plan W7.2).
 *
 * ## What it could not do
 *
 * It named seven containers `endora-commerce-*` and joined three services to an
 * **external** `public_proxy` network. The first makes a second stack from this
 * file refuse to start on a host that already runs one — the name is taken — so
 * no demo could come up beside the live one it is meant to replace. The second
 * makes it refuse on any host where that network was never created, and it is
 * the retired `central-nginx-proxy` narrative: the ruled topology is a host nginx
 * in front of loopback ports (133, 2026-09-22). And nothing ran
 * `module:install --all`: a database whose first act after the migrations is a
 * boot never runs its install hooks (AGENTS.md § Commands), which is the state
 * every fresh stack from this file started in.
 *
 * ## Why a reader and not a YAML library
 *
 * Constitution IV: this repository parses no YAML, and `test/helpers/ci-jobs.ts`
 * reads `.gitlab-ci.yml` the same way for the same reason. What is needed is the
 * service blocks (two-space keys under `services:`), their own four-space keys and
 * the `depends_on` conditions — and the floors below fail rather than pass over a
 * file this reader understood as empty.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const COMPOSE = readFileSync(join(REPO_ROOT, 'deploy/compose.prod.yml'), 'utf8');

/** The lines of one top-level block (`services:`, `networks:`, …), comments dropped. */
function topLevelBlock(source: string, key: string): readonly string[] {
  const lines = source.split('\n');
  const start = lines.indexOf(`${key}:`);
  if (start === -1) return [];
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !/^\s/.test(line) && !line.startsWith('#')) break;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    block.push(line);
  }
  return block;
}

/** Each service's own lines, by name. */
function serviceBlocks(source: string): ReadonlyMap<string, readonly string[]> {
  const services = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of topLevelBlock(source, 'services')) {
    const name = /^ {2}([\w-]+):\s*$/.exec(line);
    if (name !== null) {
      current = [];
      services.set(name[1]!, current);
      continue;
    }
    current?.push(line);
  }
  return services;
}

/** A service's own keys — the four-space ones. */
function keysOf(block: readonly string[]): readonly string[] {
  return block.flatMap((line) => /^ {4}([\w-]+):/.exec(line)?.[1] ?? []);
}

/** A service's `depends_on`, as target -> condition. */
function dependsOn(block: readonly string[]): ReadonlyMap<string, string> {
  const edges = new Map<string, string>();
  let inside = false;
  let target: string | null = null;
  for (const line of block) {
    if (/^ {4}depends_on:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (/^ {4}\S/.test(line)) break;
    const service = /^ {6}([\w-]+):\s*$/.exec(line);
    if (service !== null) {
      target = service[1]!;
      continue;
    }
    const condition = /^ {8}condition:\s*(\S+)/.exec(line);
    if (condition !== null && target !== null) edges.set(target, condition[1]!);
  }
  return edges;
}

/** The networks a service joins, from its `networks:` list. */
function networksOf(block: readonly string[]): readonly string[] {
  const start = block.findIndex((line) => /^ {4}networks:\s*$/.test(line));
  if (start === -1) return [];
  const joined: string[] = [];
  for (const line of block.slice(start + 1)) {
    const entry = /^ {6}- ([\w-]+)\s*$/.exec(line);
    if (entry === null) break;
    joined.push(entry[1]!);
  }
  return joined;
}

/** A service's `command`, as the argv list it declares on one line. */
function commandOf(block: readonly string[]): readonly string[] | null {
  const line = block.find((entry) => /^ {4}command:/.test(entry));
  const list = line === undefined ? null : /\[(.*)\]/.exec(line);
  if (list === null) return null;
  return list[1]!.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, ''));
}

const SERVICES = serviceBlocks(COMPOSE);

describe('deploy/compose.prod.yml — the reader read the file', () => {
  it('found the services this file has always declared', () => {
    expect([...SERVICES.keys()]).toEqual(
      expect.arrayContaining([
        'postgres',
        'redis',
        'meilisearch',
        'backend-migrate',
        'backend',
        'storefront',
        'admin',
      ]),
    );
    expect(dependsOn(SERVICES.get('backend')!).get('postgres')).toBe('service_healthy');
  });
});

describe('it starts on a fresh host and beside another stack (FR-106)', () => {
  it('names no container, so the compose project names them', () => {
    const named = [...SERVICES].filter(([, block]) => keysOf(block).includes('container_name'));
    expect(
      named.map(([name]) => name),
      'a fixed `container_name` is taken by the first stack on a host, so a second stack from ' +
        'this file — a demo beside the one it replaces — refuses to start. `docker compose -p ' +
        '<project>` names the containers per project.',
    ).toEqual([]);
  });

  it('joins no external network', () => {
    const networks = topLevelBlock(COMPOSE, 'networks');
    expect(
      networks.filter((line) => /^\s+external:/.test(line)),
      'an external network has to exist on the host before `up`, and this one was the retired ' +
        '`central-nginx-proxy` topology. The host nginx reaches the apps on loopback ports.',
    ).toEqual([]);
    const declared = new Set(networks.flatMap((line) => /^ {2}([\w-]+):/.exec(line)?.[1] ?? []));
    const undeclared = [...SERVICES].flatMap(([name, block]) =>
      networksOf(block)
        .filter((network) => !declared.has(network))
        .map((network) => `${name} -> ${network}`),
    );
    expect(undeclared, 'a service joins a network this file does not declare').toEqual([]);
  });
});

describe('it installs every module between the migrations and the API (FR-104)', () => {
  it('runs a `backend-install` one-shot after `backend-migrate` completes', () => {
    const install = SERVICES.get('backend-install');
    expect(install, 'no `backend-install` service').toBeDefined();
    expect(commandOf(install!)).toEqual(['node', 'dist/lifecycle/scripts/install.js', '--all']);
    expect(dependsOn(install!).get('backend-migrate')).toBe('service_completed_successfully');
    expect(install!.some((line) => /^ {4}restart:\s*'no'/.test(line))).toBe(true);
  });

  it('starts the API only once the install has completed', () => {
    expect(dependsOn(SERVICES.get('backend')!).get('backend-install')).toBe(
      'service_completed_successfully',
    );
  });

  /**
   * The path a one-shot runs is the compiled image's, and `backend/tsconfig.build.json`
   * maps `src/` onto `dist/` one for one (`rootDir: ./src`). So each `dist/*.js` a
   * backend service runs must have its `src/*.ts` — which is the check that would
   * have caught the CLI's example running a `dist/db/migrate.js` its own backend
   * never emits (W7.3), made here for this file.
   */
  it('every compiled entry point a backend service runs has a source file', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const [name, block] of SERVICES) {
      const argv = commandOf(block);
      if (argv === null || argv[0] !== 'node') continue;
      const source = argv[1]!.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      checked += 1;
      if (!existsSync(join(REPO_ROOT, 'backend', source))) missing.push(`${name}: ${argv[1]!}`);
    }
    expect(checked).toBeGreaterThanOrEqual(2);
    expect(missing).toEqual([]);
  });
});
