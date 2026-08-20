/**
 * CI check — Sales-Channel Resolution Unification (feature 053, FR-011).
 *
 * Locks the invariant established by feature 053: the current sales channel
 * for a request is resolved EXACTLY ONCE, by the canonical resolver
 * (`kernel/sales-channels/sales-channel-resolver.middleware.ts`, relocated from
 * the `sales_channels` module by feature 072 T019), and exposed on the request
 * scope, read through `getResolvedChannel()` / `currentSalesChannel()` (feature
 * 072 T028 moved it off the `request.salesChannel` property). No
 * storefront-facing module may re-derive it.
 *
 * Three static signals are flagged (TypeScript compiler API, no DB, no new
 * dependency — mirrors `check-entity-tenant-classification.ts`):
 *
 *  1. RAW CHANNEL HEADER READ — any string literal `x-sales-channel` or
 *     `x-sales-channel-id` anywhere under `src/**` outside the resolver's own
 *     directory. Legitimate code never reads these headers; only the resolver
 *     does. Global scope = strongest guard.
 *
 *  2. REQUEST-CHANNEL RE-RESOLUTION — inside the storefront "surface" files
 *     (routes.public / routes.storefront / *storefront-resolver / the catalog
 *     & search query services / product-link service): a `SalesChannel`
 *     entity query (`em.findOne/find(SalesChannel, …)`) or a raw
 *     `from sales_channels` SQL string used to derive the request channel.
 *     Scoped to surfaces so admin CRUD / membership / seeds that legitimately
 *     query channels are not false-positived.
 *
 *     **Issue #256 — measured, and the SQL shape was drained rather than made
 *     visible.** MR !775 found four public storefront endpoints re-resolving
 *     the request channel with `select id from sales_channels where code = ?`
 *     while this check reported clean, and the filed diagnosis was that the
 *     signal cannot see SQL. It can: 2b above is exactly that shape. What it
 *     could not see was the *population* — all four sat in
 *     `settings/services/*-resolver.ts`, which is no storefront surface by the
 *     predicate above. Widening the population was rejected on measurement,
 *     not on taste: at the time the question was asked, module code held eight
 *     raw reads of `sales_channels`, and every one of them was the
 *     administration this signal deliberately spares — enumerating every
 *     channel in a boot seed, or fetching one by an admin-supplied id. None
 *     was keyed by a request-supplied code, so a widened signal would have
 *     reported eight false positives and nothing else. Feature 075's D-87
 *     drain then took all eight through the kernel's `SalesChannel` entity, so
 *     `src/modules` now holds **no** raw `sales_channels` statement at all; the
 *     only live one left in `src/` is the kernel's own, in
 *     `sales-channel-membership.service.ts`. A second predicate over that
 *     shape would report a vacuous green from its first run, which is why this
 *     paragraph exists and the predicate does not.
 *
 *  3. SETTINGS-CHANNEL LITERAL (feature 072, D-42) — a `.get` / `.getMany`
 *     call on a `settings`-ish receiver whose channel argument can be a string
 *     that is not a channel uuid, or is the nil uuid. Both are spellings of "I
 *     have no channel", and since D-41 that has a real one: `null`. The literal
 *     `'default'` — a channel **code**, against a `sales_channel_id uuid`
 *     column — made PostgreSQL reject the comparison outright, and the caller's
 *     `catch` reported it as "not configured yet"; three settings were
 *     therefore ignored on every deployment. The nil uuid resolved to the right
 *     tier, but by accident.
 *
 *  4. INVENTED CHANNEL IDENTIFIER (feature 072, D-48) — the two *positions*
 *     signal 3 could not see, because it only ever inspected the channel
 *     argument of a settings read:
 *
 *       a. a **default parameter value**: `salesChannelId: string = 'default'`.
 *          `quick_order`'s `OneClickService` carried exactly that — a fifth
 *          constructor argument production never passed — so one-click buy was
 *          off on every deployment while its unit test, which *did* pass the
 *          argument, stayed green (issue #99).
 *       b. a **channel id falling back to `randomUUID()`**. `orders` stamped
 *          `salesChannelId: channel?.id ?? randomUUID()` onto every order
 *          placed without an explicit channel (issue #85) — an identifier
 *          invented at write time, in a column other reads join on. Restricted
 *          to `randomUUID()` deliberately: a *string* fallback off a channel id
 *          is caught by signal 3 wherever it reaches a settings read, and
 *          flagging every one of them here turns twenty ordinary
 *          `channel?.defaultCurrency ?? 'PLN'` defaults into noise.
 *
 *     `?? null` is never flagged, in either signal: that is the sanctioned
 *     platform-wide read, and it is the answer all four of these were reaching
 *     for. **Signal 4 is deliberately not the settings seam** — L2 and L4 were
 *     not settings calls at all, which is part of why D-42's check read clean
 *     across all four.
 *
 * Reading `channel.isPublic` (price-visibility) off an already-resolved
 * channel is NOT a violation — it is a property read, neither signal.
 *
 * A shrinking ALLOW-LIST carries the not-yet-migrated offenders so the check
 * lands green (report-only) during the rollout; pass `--enforce` once the
 * allow-list is empty to make any violation fail the build.
 *
 * Usage: `tsx scripts/check-channel-resolution.ts [--enforce] [--list]`
 * Exit 0 = clean (or report-only); exit 1 = violations under --enforce, or a
 * stale allow-list entry that no longer has any violation.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { reportReadSize } from './lib/read-size.js';

/**
 * The whole of `src/` is scanned, not `modules/` plus `kernel/`.
 *
 * Feature 072 T019 moved the resolver, its service and its cache into the
 * kernel, so scanning the kernel is what keeps the one place the header may
 * legally be read from being the one place nothing checks. D-42 widened it
 * again: of the settings-channel family's ten sites, two lived in
 * `composition.ts` and two in a module's `scripts/` directory, so a
 * `modules/**`-only scan would have missed nearly half of it.
 */
const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/** Header names that only the canonical resolver may read. */
const CHANNEL_HEADERS = new Set(['x-sales-channel', 'x-sales-channel-id']);

/**
 * Files still permitted to trip a signal during the rollout. Remove an entry
 * in the same change that redirects the file to `getResolvedChannel()`. Paths
 * are relative to `src/` with POSIX separators.
 */
// Feature 053 complete: every storefront surface now reads the resolved channel,
// so the allow-list is empty and the check runs in --enforce mode in CI. Any new
// entry here would be a regression to per-module resolution — don't add one;
// redirect the offending module to `getResolvedChannel()` instead.
//
// Feature 072 (D-42) added signal 3 and kept the list empty: the fix is
// mechanical at every site, and across ~100 settings reads there were only six
// non-uuid literals and four nil-uuid spellings, so there was nothing to drain.
//
// Feature 072 (D-48) added signal 4 and kept it empty for a stronger reason:
// the four sites it exists for were deleted *before* it was written. Widening
// the check first would have flagged code the same change removes, and an
// allow-list entry is how that becomes permanent. If this signal fires on a new
// site, the site is wrong — the system-default channel always exists.
const ALLOW_LIST = new Set<string>([]);

/**
 * Resolution is owned by the kernel's `sales-channels/` directory and by what
 * is left of the `sales_channels` module (its admin CRUD service and routes,
 * which legitimately query channels) — never scanned.
 */
function isResolverOwned(relPath: string): boolean {
  return relPath.startsWith('modules/sales_channels/') || relPath.startsWith('kernel/sales-channels/');
}

/** Storefront surfaces where re-resolving the request channel is forbidden. */
function isStorefrontSurface(relPath: string): boolean {
  return (
    relPath.endsWith('/routes.public.ts') ||
    relPath.endsWith('/routes.storefront.ts') ||
    relPath.endsWith('storefront-resolver.ts') ||
    relPath.endsWith('/catalog-query.service.ts') ||
    relPath.endsWith('/search-query.service.ts') ||
    relPath.endsWith('/product-link.service.ts')
  );
}

const RAW_CHANNEL_SQL = /\bfrom\s+sales_channels\b/i;

/** The shape `sales_channels.id` has. */
const CHANNEL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Which `.get(…)` calls are settings reads. Syntactic and receiver-based,
 * because the check has no type information: `settingsReadPort`,
 * `settingsService`, `this.settings`, `options.settings`, `deps.settingsRead`.
 * A `cache.get(code, 'default')` or a `dictionaries.get(…)` is not one.
 */
function isSettingsReceiver(receiver: string): boolean {
  const last = receiver.split('.').pop() ?? receiver;
  return /settings/i.test(last);
}

/**
 * True when this literal cannot be a sales-channel id, or is the nil uuid.
 *
 * The nil uuid is included deliberately: it *is* well-formed, which is exactly
 * why it survived in three modules. It addresses no row, so resolution fell
 * through to `global_value ?? default_value` — the right answer, reached by
 * accident and unreadably. A reader cannot tell `'00000000-…'` meaning
 * "platform-wide" from `'00000000-…'` meaning "somebody had to put something
 * here", and that ambiguity is what let `'default'` survive beside it.
 */
function isNotAChannelId(literal: string): boolean {
  return !CHANNEL_UUID.test(literal) || literal.toLowerCase() === NIL_UUID;
}

/**
 * Naming the header in a CORS policy is not reading it.
 *
 * `http/server.ts` must list `X-Sales-Channel` under `allowedHeaders`, or the
 * browser strips the very header the canonical resolver exists to read. Signal
 * 1 is a global-scope rule and stays one; this exempts the shape that declares
 * a header rather than consuming it — a string inside an array literal on a
 * `…Headers` property — so the exemption cannot quietly cover a real read.
 * Feature 072 (D-42) widened the scan from `modules/**` + `kernel/**` to all of
 * `src/**`, which is what first brought this file into range.
 */
function isCorsHeaderDeclaration(node: ts.Node): boolean {
  const array = node.parent;
  if (array === undefined || !ts.isArrayLiteralExpression(array)) return false;
  const property = array.parent;
  if (property === undefined || !ts.isPropertyAssignment(property)) return false;
  const name = property.name;
  return (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && /Headers$/.test(name.text);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A parameter that holds a sales-channel **id**. Name-based, because the check
 * has no type information — and a name is what a reader has too. `channelCode`
 * and `salesChannelCode` deliberately do not match: a code default is a
 * legitimate thing to have (the reconciler seeds one), an id default is not.
 */
const CHANNEL_ID_PARAM = /channelid$/i;

/**
 * "This expression is a resolved channel **id**." Text-based, since the check
 * has no type information, and narrow on purpose: signal 4b is about inventing
 * an *identifier*, so it must not fire on a property read off an
 * already-resolved channel. `channel?.defaultCurrency ?? 'PLN'` and
 * `channel?.defaultLanguage ?? 'en-US'` are ordinary defaults for ordinary
 * fields — twenty of them exist in the tree — and neither is a channel id.
 */
function isChannelIdExpression(text: string): boolean {
  const trimmed = text.trim();
  if (/(^|[^a-z0-9_])(sales)?channelid$/i.test(trimmed)) return true;
  return /\??\.id$/.test(trimmed) && /channel|getSystemDefault/i.test(trimmed);
}


export interface Violation {
  file: string; // relative to src/
  line: number;
  kind:
    | 'raw-channel-header'
    | 'request-channel-reresolution'
    | 'settings-channel-literal'
    | 'invented-channel-identifier';
  detail: string;
}

/** Analyze one source string. Exported for the unit self-test. */
export function analyzeSource(source: string, relPath: string): Violation[] {
  if (isResolverOwned(relPath)) return [];
  const surface = isStorefrontSurface(relPath);
  const sf = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];
  const at = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  /**
   * Same-file `const X = '…'` and `const X = a ?? '…'` initializers.
   *
   * D-42 recorded a single value and followed one hop, which is exactly the
   * reach `branding.service.ts` escaped on: `const scopeId = salesChannelId ??
   * GLOBAL_SENTINEL` is two hops and a `??`. What is recorded now is the set of
   * **string values the name can hold**, which is the question signal 3 was
   * always asking. A channel id that arrives as a parameter or through DI still
   * contributes nothing and is what the runtime seam guard in `SettingsService`
   * is for.
   */
  const stringConsts = new Map<string, string[]>();

  /**
   * The string values an expression can evaluate to, as far as syntax can tell.
   * `null`, `undefined` and anything dynamic contribute nothing — so `x ?? null`
   * yields the empty set and is never flagged, which is the whole point.
   */
  const possibleStrings = (node: ts.Node, depth = 0): string[] => {
    if (depth > 8) return [];
    if (ts.isParenthesizedExpression(node)) return possibleStrings(node.expression, depth + 1);
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isIdentifier(node)) return stringConsts.get(node.text) ?? [];
    if (ts.isConditionalExpression(node)) {
      return [
        ...possibleStrings(node.whenTrue, depth + 1),
        ...possibleStrings(node.whenFalse, depth + 1),
      ];
    }
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      return [...possibleStrings(node.left, depth + 1), ...possibleStrings(node.right, depth + 1)];
    }
    return [];
  };

  const collectConsts = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const values = possibleStrings(node.initializer);
      if (values.length > 0) stringConsts.set(node.name.text, values);
    }
    ts.forEachChild(node, collectConsts);
  };
  // Twice: a `const` may be initialized from one declared later in the file
  // (a module-scope constant read inside a function), and one pass records the
  // literals the second pass then resolves through.
  collectConsts(sf);
  collectConsts(sf);

  /** `randomUUID()` — an identifier invented on the spot (issue #85). */
  const isRandomUuidCall = (node: ts.Node): boolean =>
    ts.isCallExpression(node) && /(^|\.)randomUUID$/.test(node.expression.getText(sf));

  const visit = (node: ts.Node): void => {
    // Signal 3 — a settings read whose channel argument can be a string that is
    // not a channel id (feature 072, D-42, widened by D-48).
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const channelArg = node.arguments[1];
      if (
        (method === 'get' || method === 'getMany') &&
        channelArg !== undefined &&
        isSettingsReceiver(node.expression.expression.getText(sf))
      ) {
        const offending = possibleStrings(channelArg).find(isNotAChannelId);
        if (offending !== undefined) {
          violations.push({
            file: relPath,
            line: at(node),
            kind: 'settings-channel-literal',
            detail:
              `settings.${method}(…) can read channel '${offending}', which is not a ` +
              `sales-channel id — pass a channel uuid, or null for a platform-wide read`,
          });
        }
      }
    }

    // Signal 4a — a default parameter value standing in for a channel id.
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      CHANNEL_ID_PARAM.test(node.name.text) &&
      node.initializer !== undefined
    ) {
      const offending = possibleStrings(node.initializer).find(isNotAChannelId);
      if (offending !== undefined) {
        violations.push({
          file: relPath,
          line: at(node),
          kind: 'invented-channel-identifier',
          detail:
            `default parameter '${node.name.text} = ${JSON.stringify(offending)}' invents a ` +
            `sales-channel id — a parameter production never passes is a hole, not a default`,
        });
      }
    }

    // Signal 4b — a channel resolution with an invented fallback.
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      isChannelIdExpression(node.left.getText(sf))
    ) {
      if (isRandomUuidCall(node.right)) {
        violations.push({
          file: relPath,
          line: at(node),
          kind: 'invented-channel-identifier',
          detail:
            `a channel id falls back to randomUUID(), which addresses no sales_channels row — ` +
            `the system default always exists (D-47/D-48), so resolve it; use null only where ` +
            `"no channel" is a real answer`,
        });
      }
    }

    // Signal 1 — raw channel-header read (global scope).
    if (
      ts.isStringLiteralLike(node) &&
      CHANNEL_HEADERS.has(node.text.toLowerCase()) &&
      !isCorsHeaderDeclaration(node)
    ) {
      violations.push({
        file: relPath,
        line: at(node),
        kind: 'raw-channel-header',
        detail: `reads the '${node.text}' header — use getResolvedChannel()`,
      });
    }

    if (surface) {
      // Signal 2a — em.findOne/find/findOneOrFail(SalesChannel, …)
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (
          (method === 'findOne' || method === 'find' || method === 'findOneOrFail') &&
          node.arguments[0] &&
          ts.isIdentifier(node.arguments[0]) &&
          node.arguments[0].text === 'SalesChannel'
        ) {
          violations.push({
            file: relPath,
            line: at(node),
            kind: 'request-channel-reresolution',
            detail: `${method}(SalesChannel, …) re-resolves the request channel — call getResolvedChannel()`,
          });
        }
      }
      // Signal 2b — raw `from sales_channels` SQL.
      if (ts.isStringLiteralLike(node) && RAW_CHANNEL_SQL.test(node.text)) {
        violations.push({
          file: relPath,
          line: at(node),
          kind: 'request-channel-reresolution',
          detail: `raw 'from sales_channels' query re-resolves the request channel — call getResolvedChannel()`,
        });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

async function main(): Promise<void> {
  const enforce = process.argv.includes('--enforce');
  const listMode = process.argv.includes('--list');
  const files = walk(SRC_ROOT);

  const all: Violation[] = [];
  const scanned: string[] = [];
  for (const file of files) {
    const relPath = relative(SRC_ROOT, file).split('\\').join('/');
    scanned.push(relPath);
    all.push(...analyzeSource(readFileSync(file, 'utf8'), relPath));
  }

  // Scanning the whole of `src/` is deliberate (see the header) — but it made
  // the emptiness guard blind, because `src/` minus `src/modules` is still 105
  // files and a scan of those reports `violations=0` (issue #215). The floor is
  // per registered module, derived from the manifest index.
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[channel-resolution]',
    srcRoot: SRC_ROOT,
    files: scanned,
  });

  const offendingFiles = new Set(all.map((v) => v.file));
  const blocking = all.filter((v) => !ALLOW_LIST.has(v.file));
  const allowed = all.filter((v) => ALLOW_LIST.has(v.file));
  // Stale allow-list entries: listed but no longer violating → must be removed.
  const stale = [...ALLOW_LIST].filter((f) => !offendingFiles.has(f));

  if (listMode) {
    for (const v of all) {
      const tag = ALLOW_LIST.has(v.file) ? 'ALLOWED ' : 'BLOCKING';
      console.log(`${tag} ${v.file}:${v.line}  [${v.kind}] ${v.detail}`);
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244): this check printed five
  // finding counts and no input size at all, so `violations=0` said nothing
  // about whether the scan happened.
  reportReadSize({ prefix: '[channel-resolution]', files: scanned.length, coverage: [coverage] });
  console.log(
    `[channel-resolution] violations=${all.length} blocking=${blocking.length} ` +
      `allow-listed=${allowed.length} allow-list-size=${ALLOW_LIST.size} stale-allow=${stale.length} ` +
      `mode=${enforce ? 'enforce' : 'report-only'}`,
  );

  if (blocking.length > 0) {
    console.error('\nSales-channel resolution violations:');
    for (const v of blocking) console.error(`  - ${v.file}:${v.line}  [${v.kind}] ${v.detail}`);
  }
  if (stale.length > 0) {
    console.error('\nStale allow-list entries (no longer violate — delete them from ALLOW_LIST):');
    for (const f of stale) console.error(`  - ${f}`);
  }

  // Stale entries always fail (keeps the list honest). Blocking violations fail
  // only under --enforce so the rollout can proceed report-only.
  const fail = stale.length > 0 || (enforce && blocking.length > 0);
  process.exit(fail ? 1 : 0);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
