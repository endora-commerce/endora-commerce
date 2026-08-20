import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  checkHarnessTeardown,
  findHandReleases,
  handleNames,
  keyOf,
  HAND_RELEASED_RESOURCES_TO_DRAIN,
} from '../../../scripts/check-harness-teardown.js';
import ts from 'typescript';

/**
 * Companion test for `check-harness-teardown.ts` (issue #111).
 *
 * The check's claim is narrow and testable: it sees a release of one of the five
 * resources `setupBackendServer` owns, on a receiver the file itself binds to a
 * `BackendServerHandle`, and it sees nothing else. Each half is asserted here —
 * the resources, the three bindings, and the four things it deliberately lets
 * through — because a checker that quietly stops matching a receiver spelling
 * reports zero and reads exactly like a clean tree.
 */

const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const sourcesOf = (file: string, text: string): { sources: Map<string, string> } => ({
  sources: new Map([[file, text]]),
});

/** The teardown block seventy-seven files had grown, verbatim. */
const HAND_ROLLED = [
  "import { setupBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';",
  "describe('x', () => {",
  '  let h: BackendServerHandle;',
  '  beforeAll(async () => {',
  "    h = await setupBackendServer({ seed: 'none' });",
  '  });',
  '  afterAll(async () => {',
  '    await h.app.close();',
  '    h.redis.disconnect();',
  '    await h.orm.close(true);',
  '  });',
  '});',
].join('\n');

describe('check-harness-teardown sees every harness-owned resource', () => {
  it('reports the three-line block the sweep converted, once per resource', () => {
    const found = findHandReleases(sourcesOf('contract/blog/admin-posts.contract.test.ts', HAND_ROLLED));
    expect(found.map((f) => f.resource)).toEqual(['app', 'redis', 'orm']);
    expect(found.map((f) => f.method)).toEqual(['close', 'disconnect', 'close']);
    expect(found.map((f) => f.line)).toEqual([8, 9, 10]);
  });

  it('reports the two resources the hand-rolled block never knew about', () => {
    const source = [
      'let h: BackendServerHandle;',
      'afterAll(async () => {',
      '  await h.container.dispose();',
      '  h.redisSubscriber.disconnect();',
      '});',
    ].join('\n');
    const found = findHandReleases(sourcesOf('integration/x.test.ts', source));
    expect(found.map((f) => f.resource)).toEqual(['container', 'redisSubscriber']);
  });

  it('reads `quit` as a release of an ioredis client, not only `disconnect`', () => {
    const source = ['let h: BackendServerHandle;', 'afterAll(async () => { await h.redis.quit(); });'].join('\n');
    const found = findHandReleases(sourcesOf('integration/x.test.ts', source));
    expect(found.map((f) => `${f.resource}.${f.method}`)).toEqual(['redis.quit']);
  });

  it('ignores a method that releases nothing', () => {
    const source = [
      'let h: BackendServerHandle;',
      'it("a", async () => { await h.app.inject({ url: "/" }); h.redis.flushall(); });',
    ].join('\n');
    expect(findHandReleases(sourcesOf('integration/x.test.ts', source))).toEqual([]);
  });
});

describe('check-harness-teardown binds a handle the three ways one enters a scope', () => {
  const release = 'afterAll(async () => { await h.app.close(); });';

  it('binds a name assigned from setupBackendServer', () => {
    const source = ["h = await setupBackendServer({ seed: 'none' });", release].join('\n');
    expect(handleNames(ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true))).toContain('h');
    expect(findHandReleases(sourcesOf('integration/x.test.ts', source))).toHaveLength(1);
  });

  it('binds a name initialised from setupBackendServer without an annotation', () => {
    const source = ['const h = await setupBackendServer();', release].join('\n');
    expect(findHandReleases(sourcesOf('integration/x.test.ts', source))).toHaveLength(1);
  });

  it('binds a variable annotated with the handle type', () => {
    const source = ['let h: BackendServerHandle;', release].join('\n');
    expect(findHandReleases(sourcesOf('integration/x.test.ts', source))).toHaveLength(1);
  });

  it('binds a parameter annotated with the handle type — the shape helpers take', () => {
    const source = 'export async function stop(h: BackendServerHandle) { await h.app.close(); }';
    expect(findHandReleases(sourcesOf('helpers/off-state.ts', source))).toHaveLength(1);
  });

  it('leaves a name it cannot bind to a handle alone', () => {
    // `app` here is a bare Fastify instance the test built itself; nothing in
    // the file says it came out of the harness.
    const source = ['const other = { app: buildApp() };', 'afterAll(async () => { await other.app.close(); });'].join(
      '\n',
    );
    expect(findHandReleases(sourcesOf('integration/x.test.ts', source))).toEqual([]);
  });
});

describe('check-harness-teardown leaves the resources a test owns alone', () => {
  it('ignores a MikroORM instance the test created itself', () => {
    // Ten files do exactly this. The harness never saw that ORM, so
    // `teardownBackendServer` has nothing to say about closing it.
    const source = [
      'let orm: MikroORM;',
      'beforeAll(async () => { orm = await MikroORM.init(mikroOrmConfig); });',
      'afterAll(async () => { await orm.close(true); });',
    ].join('\n');
    expect(findHandReleases(sourcesOf('integration/commands/command-bus.transaction.test.ts', source))).toEqual([]);
  });

  it('ignores the seam itself, which releases all five by definition', () => {
    const source = [
      'export async function teardownBackendServer(h: BackendServerHandle): Promise<void> {',
      '  await h.app.close();',
      '  await h.container.dispose();',
      '  h.redis.disconnect();',
      '  h.redisSubscriber.disconnect();',
      '}',
    ].join('\n');
    expect(findHandReleases(sourcesOf('helpers/test-server.ts', source))).toEqual([]);
    // …and the same text anywhere else is a violation, so the exemption is the
    // file, not the shape.
    expect(findHandReleases(sourcesOf('helpers/other.ts', source))).toHaveLength(4);
  });

  it('ignores the harness text quoted inside an assertion', () => {
    const source = [
      'let h: BackendServerHandle;',
      "it('disconnects every client it opens', () => {",
      "  expect(harness).toContain('h.redis.disconnect()');",
      "  expect(harness).toContain('h.redisSubscriber.disconnect()');",
      '});',
    ].join('\n');
    expect(findHandReleases(sourcesOf('contract/kernel/harness-parity.test.ts', source))).toEqual([]);
  });

  it('ignores a file that never mentions a handle', () => {
    expect(findHandReleases(sourcesOf('unit/x.test.ts', 'await app.close();'))).toEqual([]);
  });
});

describe('the ledger is two-way', () => {
  const source = ['let h: BackendServerHandle;', 'afterAll(async () => { await h.app.close(); });'].join('\n');
  const file = 'integration/x.test.ts';

  it('fails on an unledgered hand-release', () => {
    const result = checkHarnessTeardown(sourcesOf(file, source), {});
    expect(result.violations).toHaveLength(1);
    expect(keyOf(result.violations[0]!)).toBe(`${file}:app`);
  });

  it('accepts one the ledger accounts for', () => {
    const result = checkHarnessTeardown(sourcesOf(file, source), {
      [`${file}:app`]: 'reason',
    });
    expect(result.violations).toEqual([]);
    expect(result.ledgered).toHaveLength(1);
  });

  it('fails on an entry that no longer describes a hand-release', () => {
    const result = checkHarnessTeardown(sourcesOf(file, 'const a = 1;'), {
      [`${file}:app`]: 'reason',
    });
    expect(result.stale).toEqual([`${file}:app`]);
  });

  it('ships empty — every test in the tree releases through the seam', () => {
    expect(HAND_RELEASED_RESOURCES_TO_DRAIN).toEqual({});
  });
});

describe('check-harness-teardown over the real tree', () => {
  const sources = readTree(join(BACKEND_ROOT, 'test'));

  it('reads a population large enough that a clean result means something', () => {
    // The guard against the failure this whole check family exists for: zero
    // violations over zero sources is indistinguishable from a clean tree.
    expect(sources.size, 'no sources found under test/ — a vacuous pass').toBeGreaterThan(500);
    const bindsAHandle = [...sources].filter(
      ([, text]) => handleNames(ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true)).size > 0,
    );
    expect(bindsAHandle.length, 'no file binds a BackendServerHandle').toBeGreaterThan(500);
  });

  it('finds no hand-released harness resource', () => {
    const result = checkHarnessTeardown({ sources }, HAND_RELEASED_RESOURCES_TO_DRAIN);
    expect(result.violations.map((v) => `${v.file}:${v.line} ${v.receiver}.${v.method}`)).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it('names its vacuous-pass guard and exits 2 rather than 0 on an unread tree', () => {
    const script = readFileSync(join(BACKEND_ROOT, 'scripts/check-harness-teardown.ts'), 'utf8');
    expect(script).toMatch(/vacuous/);
    expect(script).toMatch(/process\.exit\(2\)/);
  });
});

function readTree(root: string): Map<string, string> {
  const sources = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        walk(full, `${prefix}${name}/`);
      } else if (name.endsWith('.ts')) {
        sources.set(`${prefix}${name}`, readFileSync(full, 'utf8'));
      }
    }
  };
  walk(root, '');
  return sources;
}
