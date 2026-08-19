/**
 * CI check — a test releases a harness-owned resource through
 * `teardownBackendServer`, never by closing it itself (issue #111).
 *
 * `setupBackendServer` composes a whole backend: a Fastify app, the shared
 * MikroORM singleton, an ioredis client, a **second** ioredis client for the
 * module-state pub/sub channel, and an awilix container holding every module's
 * singletons. `teardownBackendServer` is the one place that releases all five,
 * in the order they have to be released in — unsubscribe before disconnect,
 * dispose the container before dropping the ORM.
 *
 * A test that writes the teardown out by hand releases the resources it happened
 * to think of. Seventy-seven files had grown the same three lines — `app.close`,
 * `redis.disconnect`, `orm.close` — and none of them disposed the container or
 * disconnected the subscriber, because neither existed when the shape was first
 * copied. The subscriber is the measurable half: `vitest` pins the backend suite
 * to a single fork, so one abandoned client per composed server accumulates for
 * the length of the run. A thirty-file batch peaked at 32 connected Redis clients
 * against a private Redis and fell to 3 once the same files went through the
 * seam; the container is the heap half, and it is what the CI shards'
 * `--max-old-space-size` has been absorbing.
 *
 * The failure mode is not that a hand-rolled teardown is wrong today — it is
 * that it is a **copy of the seam, frozen at the moment it was copied**. Adding
 * a resource to the harness cannot reach it.
 *
 * ## What counts as a violation
 *
 * A call that releases one of the five harness-owned resources, on a receiver
 * this file can bind to a `BackendServerHandle`:
 *
 *   | receiver property | released by            |
 *   | ----------------- | ---------------------- |
 *   | `app`             | `close`                |
 *   | `orm`             | `close`                |
 *   | `redis`           | `disconnect`, `quit`   |
 *   | `redisSubscriber` | `disconnect`, `quit`   |
 *   | `container`       | `dispose`              |
 *
 * A receiver is a harness handle when the file itself says so, in any of the
 * three ways a handle enters a scope:
 *
 *   1. it is assigned from `setupBackendServer(...)` — `h = await setupBackendServer()`,
 *      `const h = await setupBackendServer({ seed: 'none' })`;
 *   2. it is a variable annotated `BackendServerHandle` — `let h: BackendServerHandle;`,
 *      which is how every converted file declares it before `beforeAll` fills it in;
 *   3. it is a **parameter** annotated `BackendServerHandle` — the shape the
 *      shared helpers under `test/helpers/` take, where signal 1 never appears.
 *
 * All three are needed. Binding by assignment alone misses a helper that is
 * handed a handle; binding by annotation alone misses `const h = await
 * setupBackendServer()`, which needs no annotation to typecheck.
 *
 * ## What it does not see, deliberately
 *
 *   - **A resource the test opened itself.** Ten files call
 *     `MikroORM.init(mikroOrmConfig)` and close that instance; it is theirs, the
 *     harness never saw it, and `teardownBackendServer` has nothing to say about
 *     it. Only a receiver bound to a `BackendServerHandle` is read, so those are
 *     outside the population rather than allow-listed inside it.
 *   - **`test/helpers/test-server.ts`.** It *is* the seam: the five releases in
 *     `teardownBackendServer` are the definition this check enforces, not an
 *     instance of the thing it refuses.
 *   - **Source text quoted in an assertion.** `harness-parity.test.ts` asserts on
 *     the harness's own text (`expect(harness).toContain('h.redis.disconnect()')`).
 *     The analysis is syntactic, so a string literal is not a call.
 *
 * Usage: `tsx scripts/check-harness-teardown.ts [--list]`
 * Exit 0 = every harness resource is released through the seam (or is ledgered);
 * exit 1 = at least one is not, or a ledger entry is stale;
 * exit 2 = no test sources were read, so a pass would be vacuous.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { reportReadSize } from './lib/read-size.js';

const TEST_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'test');

/** The handle type, as the tree spells it in an annotation. */
const HANDLE_TYPE = 'BackendServerHandle';

/** The factory whose return value is a handle. */
const HANDLE_FACTORY = 'setupBackendServer';

/**
 * The harness-owned resources, and the calls that release each.
 *
 * Keyed by the property on `BackendServerHandle`, so growing the handle with a
 * sixth resource is a one-line change here rather than a new rule.
 */
const RELEASED_BY: Readonly<Record<string, readonly string[]>> = {
  app: ['close'],
  orm: ['close'],
  redis: ['disconnect', 'quit'],
  redisSubscriber: ['disconnect', 'quit'],
  container: ['dispose'],
};

/**
 * The seam itself. It releases all five by definition; measuring it against the
 * rule it defines would report the definition as the violation.
 */
const SEAM_FILE = 'helpers/test-server.ts';

/**
 * Hand-released harness resources that may stay hand-released, with the reason
 * and the question that would retire the entry.
 *
 * Keyed `<path under test/>:<resource>` rather than by line, so moving code
 * inside a file does not invalidate an entry and re-opening the hole does not
 * silently inherit one. **Two-way**, in the idiom of `BARE_SUBSCRIPTIONS_TO_DRAIN`:
 * an unledgered hand-release fails the build, and a ledger entry that no longer
 * describes one fails it too.
 *
 * It is empty, and that is the point: every test in the tree releases the
 * harness through `teardownBackendServer`. An entry here is a file that has
 * decided it knows better than the seam which resources matter, so a reason has
 * to say what it is doing that the seam cannot.
 */
export const HAND_RELEASED_RESOURCES_TO_DRAIN: Readonly<Record<string, string>> = {};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

export interface HandRelease {
  /** Path under `test/`, POSIX separators. */
  readonly file: string;
  readonly line: number;
  /** The `BackendServerHandle` property released — `app`, `redis`, … */
  readonly resource: string;
  /** The releasing method as written — `close`, `disconnect`, … */
  readonly method: string;
  /** The receiver as written, for the failure message. */
  readonly receiver: string;
}

/** `<file>:<resource>` — the ledger key, and the identity of a site. */
export function keyOf(found: HandRelease): string {
  return `${found.file}:${found.resource}`;
}

export interface HarnessTeardownInput {
  /** Every source under `test/`, keyed by path relative to `test/`. */
  readonly sources: ReadonlyMap<string, string>;
}

/** The trailing identifier of an expression: `fixture.h` → `h`, `h` → `h`. */
function tailName(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return tailName(node.expression);
  }
  return null;
}

/** Whether a type node is (or wraps) the handle type. */
function isHandleType(type: ts.TypeNode | undefined): boolean {
  if (type === undefined) return false;
  if (ts.isTypeReferenceNode(type)) return tailName(type.typeName) === HANDLE_TYPE;
  // `BackendServerHandle | undefined`, `Readonly<BackendServerHandle>`, …
  return type.getText().includes(HANDLE_TYPE);
}

/** Whether an expression is (or awaits, or casts) a `setupBackendServer(...)` call. */
function isHandleFactoryCall(node: ts.Expression | undefined): boolean {
  if (node === undefined) return false;
  if (ts.isAwaitExpression(node)) return isHandleFactoryCall(node.expression);
  if (
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return isHandleFactoryCall(node.expression);
  }
  if (ts.isCallExpression(node)) return tailName(node.expression) === HANDLE_FACTORY;
  return false;
}

/**
 * The names that hold a harness handle in one file.
 *
 * File-scoped rather than block-scoped on purpose: the tree's shape is a
 * `let h` at describe level filled in by `beforeAll` and released in `afterAll`,
 * three different scopes for one binding. A name that means something else in a
 * fourth scope would be a false positive, and it is the right trade — the
 * alternative is a checker that cannot see the only shape it exists for.
 */
export function handleNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();

  const visit = (node: ts.Node): void => {
    // 2 + 3 — a variable or parameter annotated with the handle type.
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      isHandleType(node.type)
    ) {
      names.add(node.name.text);
    }
    // 1 — a name initialised from the factory.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isHandleFactoryCall(node.initializer)
    ) {
      names.add(node.name.text);
    }
    // 1 — a name later assigned from the factory.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      isHandleFactoryCall(node.right)
    ) {
      names.add(node.left.text);
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return names;
}

/** Every hand-release of a harness-owned resource in the given sources. */
export function findHandReleases(input: HarnessTeardownInput): HandRelease[] {
  const found: HandRelease[] = [];

  for (const [file, text] of input.sources) {
    if (file === SEAM_FILE) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const handles = handleNames(sf);
    if (handles.size === 0) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const resourceAccess = node.expression.expression;
        if (ts.isPropertyAccessExpression(resourceAccess)) {
          const resource = resourceAccess.name.text;
          const owner = tailName(resourceAccess.expression);
          const methods = RELEASED_BY[resource];
          if (
            methods !== undefined &&
            methods.includes(method) &&
            owner !== null &&
            handles.has(owner)
          ) {
            found.push({
              file,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              resource,
              method,
              receiver: `${owner}.${resource}`,
            });
          }
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }

  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return found;
}

export interface CheckResult {
  readonly total: number;
  readonly violations: readonly HandRelease[];
  readonly ledgered: readonly HandRelease[];
  /** Ledger keys that no longer describe a hand-release — the staleness half. */
  readonly stale: readonly string[];
}

export function checkHarnessTeardown(
  input: HarnessTeardownInput,
  ledger: Readonly<Record<string, string>> = HAND_RELEASED_RESOURCES_TO_DRAIN,
): CheckResult {
  const all = findHandReleases(input);
  const keys = new Set(all.map(keyOf));
  return {
    total: all.length,
    violations: all.filter((entry) => ledger[keyOf(entry)] === undefined),
    ledgered: all.filter((entry) => ledger[keyOf(entry)] !== undefined),
    stale: Object.keys(ledger).filter((key) => !keys.has(key)),
  };
}

function main(): void {
  const listMode = process.argv.includes('--list');
  const files = walk(TEST_ROOT);
  if (files.length === 0) {
    console.error('[harness-teardown] no sources under test/ — refusing to report a vacuous pass');
    process.exit(2);
  }

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(relative(TEST_ROOT, file).split('\\').join('/'), readFileSync(file, 'utf8'));
  }

  const result = checkHarnessTeardown({ sources });

  if (listMode) {
    for (const entry of findHandReleases({ sources })) {
      const tag =
        HAND_RELEASED_RESOURCES_TO_DRAIN[keyOf(entry)] !== undefined ? 'LEDGERED' : 'BY HAND ';
      console.log(`${tag} ${entry.file}:${entry.line}  ${entry.receiver}.${entry.method}()`);
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244): the ledger is empty, so
  // every count on the line below is zero on a clean tree and zero on a walk
  // that opened nothing. `self-reported`: the population is `backend/test`,
  // which nothing else in the tree derives.
  reportReadSize({ prefix: '[harness-teardown]', files: sources.size });
  console.log(
    `[harness-teardown] hand-released harness resources=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(HAND_RELEASED_RESOURCES_TO_DRAIN).length} stale=${result.stale.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nA test released a resource `setupBackendServer` owns, instead of calling\n' +
        '`teardownBackendServer(h)`. A hand-written teardown is a copy of the seam frozen\n' +
        'at the moment it was copied: it cannot learn about the awilix container or the\n' +
        'pub/sub Redis client, and both leak for the length of the run (issue #111).\n' +
        'Replace the release calls with `await teardownBackendServer(h)`; where cleanup SQL\n' +
        'sits between them, move it above the call — teardown closes the ORM.\n',
    );
    for (const entry of result.violations) {
      console.error(`  - ${entry.file}:${entry.line}  ${entry.receiver}.${entry.method}()`);
    }
  }
  if (result.stale.length > 0) {
    console.error('\nStale ledger entries (no longer describe a hand-release — delete them):');
    for (const key of result.stale) console.error(`  - ${key}`);
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
