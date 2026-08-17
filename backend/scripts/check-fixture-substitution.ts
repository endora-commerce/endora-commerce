/**
 * CI check — a test does not substitute a placeholder for platform state it
 * failed to read (issue #159).
 *
 * The shape, in full:
 *
 *     const ch = await em.findOne(SalesChannel, { systemDefault: true });
 *     systemDefaultChannelId = ch?.id ?? '';
 *
 * Six files carried exactly that, letter for letter, and every one of them was
 * green. They were green because some *other* file's `setupBackendServer` had
 * created the channel earlier in the same invocation: no migration seeds one, so
 * against a fresh database `ch` is `null`, the id becomes `''`, and
 * `cart-abandonment-worker.integration.test.ts` fails all six of its tests with
 * `invalid input syntax for type uuid: ""`. Its green was a property of run
 * order.
 *
 * The fallback is what makes that possible. Without it TypeScript forces the
 * file to say what happens when the row is absent, and every honest answer —
 * `findOneOrFail`, an explicit `throw`, creating the fixture, reading
 * `db.systemDefaultChannelId` — either fails loudly or removes the dependency.
 * With it, the absence is converted into a value that looks like data, and the
 * failure surfaces somewhere else entirely, as a Postgres type error in an
 * `insert` twenty lines away.
 *
 * So this check refuses the conversion, not the lookup.
 *
 * ## What counts as a violation
 *
 * A **defaulted read**: a `??` or `||` whose left side is rooted in a database
 * read and whose right side is a placeholder literal, in a file under
 * `backend/test/`. Both halves are required.
 *
 * *Rooted in a database read* covers the two ways it is written:
 *
 *   1. **two-step** — the read is bound to a name, and the name is defaulted
 *      later: `const ch = await em.findOne(…)` … `ch?.id ?? ''`. The binding may
 *      be a `const`/`let` declaration or a plain assignment, and the read may be
 *      reached through an index (`rows[0]?.id ?? ''`);
 *   2. **inline** — the read is defaulted where it stands:
 *      `(await em.findOne(…))?.id ?? ''`.
 *
 * `findOneOrFail` is deliberately **not** a database read for this purpose. It
 * throws on absence, which is the behaviour the check is asking for; a `??` after
 * one is dead code, not a substitution.
 *
 * *A placeholder literal* is a string, a number, `null`, `undefined`, a boolean,
 * a substitution-free template, or a fresh identifier (`randomUUID()`). A
 * fallback that is **not** a literal is left alone on purpose: `?? (await
 * createChannel())` and `?? seedDefaultChannel()` are the sanctioned repair —
 * a test is entitled to create the fixture it needs, as long as it says so.
 *
 * ## What it does not see, deliberately
 *
 *   - **`test/helpers/test-db.ts` and `test/global-setup.ts`.** They are the
 *     seam: `global-setup` establishes the invariant right after the migrations
 *     and `setupTestDb` reads it once and throws when it is absent. Measuring
 *     them against the rule they implement would report the definition as the
 *     violation.
 *   - **A read of something that is genuinely optional.** A test that asserts
 *     "no row exists yet" reads `null` on purpose — but it asserts on the read
 *     rather than defaulting it, so it never reaches a `??` with a literal on the
 *     right.
 *   - **`src/`.** A service defaulting a lookup is a domain decision with its own
 *     reviewers; this check is about a test's setup silently depending on another
 *     file's.
 *
 * Usage: `tsx scripts/check-fixture-substitution.ts [--list]`
 * Exit 0 = no test defaults a database read (or the ones that do are ledgered);
 * exit 1 = at least one does, or a ledger entry is stale;
 * exit 2 = the walk read no test source, **or** it read them all and matched no
 * database read anywhere — either way the analysis saw nothing and a pass would
 * be vacuous (issue #113).
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const TEST_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'test');

/**
 * Calls whose result is platform state read out of the database.
 *
 * `findOneOrFail` is absent on purpose — see the header. `execute` and `query`
 * cover the raw-SQL path, which is how the harness itself reads and how several
 * integration tests check a row landed.
 */
const DB_READS: ReadonlySet<string> = new Set([
  'findOne',
  'find',
  'findAll',
  'findByCursor',
  'execute',
  'query',
  'getSingleResult',
  'getResult',
]);

/**
 * The seam this check enforces. `global-setup.ts` establishes the invariant and
 * `test-db.ts` reads it and throws; both mention a database read next to a
 * fallback-shaped expression, and both are the definition rather than an
 * instance of it.
 */
const SEAM_FILES: ReadonlySet<string> = new Set(['global-setup.ts', 'helpers/test-db.ts']);

/**
 * Defaulted reads that may stay defaulted, with the reason and the question that
 * would retire the entry.
 *
 * Keyed `<path under test/>:<holder>` rather than by line, so moving code inside
 * a file does not invalidate an entry and re-opening the hole does not silently
 * inherit one. **Two-way**, in the idiom of `HAND_RELEASED_RESOURCES_TO_DRAIN`:
 * an unledgered defaulted read fails the build, and a ledger entry that no
 * longer describes one fails it too.
 *
 * An entry here is a test that has decided a placeholder is a better answer than
 * a failure, so the reason has to say what the placeholder means — not that the
 * row is "usually there".
 */
export const DEFAULTED_FIXTURE_READS: Readonly<Record<string, string>> = {
  // `select count(*)` returns exactly one row, always. The fallback is dead
  // code, and its value is the honest answer for an empty table rather than a
  // stand-in for a row that should have been there — nothing downstream can
  // mistake it for an identity. Retire the entry if the query ever stops being
  // an aggregate.
  'contract/catalog/attribute-searchable-reindex.test.ts:rows':
    'count(*) always yields one row; 0 is "no reindex operations", not a missing fixture',
  'integration/payment_methods/gateway-presence.test.ts:rows':
    'count(*) always yields one row; "0" is "no channel bindings", not a missing fixture',
  'integration/pim_ergonode/price-binding.test.ts:rows':
    'count(*) always yields one row; 0 is "no price-list products", not a missing fixture',
  // A sentinel the assertion reads, not a value the test computes with: every
  // caller compares it against an expected status, so a vanished RFQ fails the
  // comparison loudly with `"missing"` in the diff. Retire the entry if the
  // value ever reaches something other than an assertion.
  'integration/quote_requests/settings-channel.test.ts:rfq':
    'the fallback is the assertion\'s failure text — a vanished RFQ fails loudly as "missing"',
  // A composition input, not a fixture read: the harness mirrors production's
  // bridge, which answers a channel-less send with the platform fallback
  // language. Retire the entry when `returns` takes the language from the
  // resolved channel rather than from a bridge.
  'helpers/test-server.ts:(inline)':
    'harness bridge default mirroring production, not a fixture the test depends on',
};

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

/** How the read reached the fallback — see the header's two shapes. */
export type SubstitutionShape = 'two-step' | 'inline';

export interface DefaultedRead {
  /** Path under `test/`, POSIX separators. */
  readonly file: string;
  readonly line: number;
  /** The name the read was bound to, or `(inline)` when it was never bound. */
  readonly holder: string;
  readonly shape: SubstitutionShape;
  /** `??` or `||`, as written. */
  readonly operator: '??' | '||';
  /** The placeholder as written, for the failure message. */
  readonly fallback: string;
}

/** `<file>:<holder>` — the ledger key, and the identity of a site. */
export function keyOf(found: DefaultedRead): string {
  return `${found.file}:${found.holder}`;
}

export interface FixtureSubstitutionInput {
  /** Every source under `test/`, keyed by path relative to `test/`. */
  readonly sources: ReadonlyMap<string, string>;
}

/** Peel casts, parentheses and non-null assertions off an expression. */
function unwrap(node: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return unwrap(node.expression);
  }
  return node;
}

/** The trailing identifier of a callee: `em.findOne` → `findOne`. */
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

/** Whether an expression is (or awaits, or casts) one of the reads above. */
export function isDatabaseRead(node: ts.Expression | undefined): boolean {
  if (node === undefined) return false;
  if (ts.isAwaitExpression(node)) return isDatabaseRead(node.expression);
  const bare = unwrap(node);
  if (bare !== node) return isDatabaseRead(bare);
  if (ts.isCallExpression(node)) {
    const name = tailName(node.expression);
    return name !== null && DB_READS.has(name);
  }
  // `(await em.find(...))[0]` and `rows[0]` both keep the read in the chain.
  if (ts.isElementAccessExpression(node)) return isDatabaseRead(node.expression);
  if (ts.isPropertyAccessExpression(node)) return isDatabaseRead(node.expression);
  return false;
}

/**
 * A fallback that **fabricates** a value where the row was missing.
 *
 * `null` and `undefined` are deliberately not placeholders. They keep the
 * absence in the type, so TypeScript goes on forcing the next reader to handle
 * it and the failure, when it comes, still says "there was no row". `''`, `0`
 * and `randomUUID()` erase it: each is assignable where the real value goes, so
 * the absence travels as data and surfaces somewhere unrelated — for issue #159
 * as `invalid input syntax for type uuid: ""` inside an `insert`, twenty lines
 * and one `beforeAll` away from the lookup that failed.
 *
 * `randomUUID()` is the worst of them and is included by name: it satisfies the
 * column type and matches no row, so the test does not even fail — it silently
 * measures nothing.
 */
export function isPlaceholder(node: ts.Expression): boolean {
  const bare = unwrap(node);
  if (ts.isStringLiteralLike(bare)) {
    // A template with substitutions is derived from something; a bare one is a
    // literal by another spelling.
    return !ts.isTemplateExpression(bare);
  }
  if (ts.isNumericLiteral(bare)) return true;
  if (bare.kind === ts.SyntaxKind.TrueKeyword || bare.kind === ts.SyntaxKind.FalseKeyword) {
    return true;
  }
  if (ts.isCallExpression(bare) && tailName(bare.expression) === 'randomUUID') return true;
  return false;
}

/**
 * Whether an expression sits inside an assertion — `expect(x ?? null)`,
 * `expect(a).toBe(b ?? 0)`.
 *
 * Excluded on purpose, and it is the difference between a rule and a rename.
 * `?? null` inside an `expect` is **normalisation**: MikroORM's `forceUndefined`
 * reads a SQL `NULL` back as `undefined`, so `expect(row.variantId ?? null)
 * .toBeNull()` is saying "either spelling of absent". Nothing downstream
 * consumes the value, so it cannot make a later statement depend on a fixture
 * another file created — which is the whole defect. Sixty of the sixty-seven
 * expressions this check first matched were that shape, and reporting them would
 * have buried the seven that matter under a ledger nobody would read.
 */
function insideAssertion(node: ts.Node): boolean {
  for (let cursor = node.parent; cursor !== undefined; cursor = cursor.parent) {
    if (ts.isCallExpression(cursor) && callChainRootsAtExpect(cursor)) return true;
  }
  return false;
}

/** `expect(x)`, `expect(x).toBe(...)`, `expect(x).resolves.toBe(...)`. */
function callChainRootsAtExpect(call: ts.CallExpression): boolean {
  let cursor: ts.Expression = unwrap(call.expression);
  for (;;) {
    if (ts.isIdentifier(cursor)) return cursor.text === 'expect';
    if (ts.isPropertyAccessExpression(cursor) || ts.isElementAccessExpression(cursor)) {
      cursor = unwrap(cursor.expression);
      continue;
    }
    if (ts.isCallExpression(cursor)) {
      cursor = unwrap(cursor.expression);
      continue;
    }
    return false;
  }
}

/** The identifier a member/index chain is rooted at: `rows[0]?.id` → `rows`. */
function rootIdentifier(node: ts.Expression): string | null {
  const bare = unwrap(node);
  if (ts.isIdentifier(bare)) return bare.text;
  if (ts.isPropertyAccessExpression(bare)) return rootIdentifier(bare.expression);
  if (ts.isElementAccessExpression(bare)) return rootIdentifier(bare.expression);
  return null;
}

/** Whether a chain contains a database read anywhere along it (the inline shape). */
function chainContainsRead(node: ts.Expression): boolean {
  const bare = unwrap(node);
  if (isDatabaseRead(bare)) return true;
  if (ts.isPropertyAccessExpression(bare)) return chainContainsRead(bare.expression);
  if (ts.isElementAccessExpression(bare)) return chainContainsRead(bare.expression);
  if (ts.isAwaitExpression(bare)) return chainContainsRead(bare.expression);
  return false;
}

/** Names bound to a database read anywhere in one file. */
export function readBoundNames(sf: ts.SourceFile): Set<string> {
  const bound = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.initializer !== undefined && chainContainsRead(node.initializer)) {
        bound.add(node.name.text);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      chainContainsRead(node.right)
    ) {
      bound.add(node.left.text);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return bound;
}

/** Every defaulted database read in the given test sources. */
export function findDefaultedReads(input: FixtureSubstitutionInput): DefaultedRead[] {
  const found: DefaultedRead[] = [];

  for (const [file, text] of input.sources) {
    if (SEAM_FILES.has(file)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const bound = readBoundNames(sf);

    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node)) {
        const operator =
          node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
            ? '??'
            : node.operatorToken.kind === ts.SyntaxKind.BarBarToken
              ? '||'
              : null;
        if (operator !== null && isPlaceholder(node.right) && !insideAssertion(node)) {
          const inline = chainContainsRead(node.left);
          const root = rootIdentifier(node.left);
          const twoStep = !inline && root !== null && bound.has(root);
          if (inline || twoStep) {
            found.push({
              file,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              holder: inline ? '(inline)' : (root as string),
              shape: inline ? 'inline' : 'two-step',
              operator,
              fallback: node.right.getText(sf).trim(),
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

/**
 * How many test files read the database at all — the second vacuous-pass guard.
 *
 * An empty file list is the obvious way to report a green over nothing; the
 * quieter one is a file list the *read detection* no longer matches, which
 * yields zero violations and reads exactly like a clean tree (issue #113). A
 * rename in MikroORM's API, a new query helper, a walk that picked up the wrong
 * root: each takes this to zero, and zero is not a state this repository's
 * `test/` can be in.
 */
export function filesReadingTheDatabase(input: FixtureSubstitutionInput): number {
  let count = 0;
  for (const [file, text] of input.sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (readBoundNames(sf).size > 0) count += 1;
  }
  return count;
}

export interface CheckResult {
  readonly total: number;
  readonly violations: readonly DefaultedRead[];
  readonly ledgered: readonly DefaultedRead[];
  /** Ledger keys that no longer describe a defaulted read — the staleness half. */
  readonly stale: readonly string[];
}

export function checkFixtureSubstitution(
  input: FixtureSubstitutionInput,
  ledger: Readonly<Record<string, string>> = DEFAULTED_FIXTURE_READS,
): CheckResult {
  const all = findDefaultedReads(input);
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
    console.error(
      '[fixture-substitution] no sources under test/ — refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(relative(TEST_ROOT, file).split('\\').join('/'), readFileSync(file, 'utf8'));
  }

  const reading = filesReadingTheDatabase({ sources });
  if (reading === 0) {
    console.error(
      `[fixture-substitution] read ${sources.size} test sources and found no database read ` +
        `in any of them — the read detection has gone blind; refusing to report a vacuous pass`,
    );
    process.exit(2);
  }

  const result = checkFixtureSubstitution({ sources });

  if (listMode) {
    for (const entry of findDefaultedReads({ sources })) {
      const tag = DEFAULTED_FIXTURE_READS[keyOf(entry)] !== undefined ? 'LEDGERED' : 'DEFAULT ';
      console.log(
        `${tag} ${entry.file}:${entry.line}  [${entry.shape}] ${entry.holder} ${entry.operator} ${entry.fallback}`,
      );
    }
    console.log('');
  }

  console.log(
    `[fixture-substitution] files reading the database=${reading} ` +
      `defaulted database reads in tests=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(DEFAULTED_FIXTURE_READS).length} stale=${result.stale.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nA test converted "the row is not there" into a value that looks like data,\n' +
        'so its result depends on whether some other file created the row first\n' +
        '(issue #159). Read it and fail: `findOneOrFail`, an explicit throw, a\n' +
        'guaranteed accessor such as `TestDb.systemDefaultChannelId`, or create the\n' +
        'fixture in this file. A non-literal fallback (`?? await createIt()`) is\n' +
        'allowed and is not reported.\n',
    );
    for (const entry of result.violations) {
      console.error(
        `  - ${entry.file}:${entry.line}  [${entry.shape}] ${entry.holder} ${entry.operator} ${entry.fallback}`,
      );
    }
  }
  if (result.stale.length > 0) {
    console.error('\nStale ledger entries (no longer describe a defaulted read — delete them):');
    for (const key of result.stale) console.error(`  - ${key}`);
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
