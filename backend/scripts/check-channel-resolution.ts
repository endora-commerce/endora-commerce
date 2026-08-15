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
 *  3. SETTINGS-CHANNEL LITERAL (feature 072, D-42) — a `.get` / `.getMany`
 *     call on a `settings`-ish receiver whose channel argument is a string
 *     literal that is not a channel uuid, or is the nil uuid. Both are
 *     spellings of "I have no channel", and since D-41 that has a real one:
 *     `null`. The literal `'default'` — a channel **code**, against a
 *     `sales_channel_id uuid` column — made PostgreSQL reject the comparison
 *     outright, and the caller's `catch` reported it as "not configured yet";
 *     three settings were therefore ignored on every deployment. The nil uuid
 *     resolved to the right tier, but by accident.
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

export interface Violation {
  file: string; // relative to src/
  line: number;
  kind: 'raw-channel-header' | 'request-channel-reresolution' | 'settings-channel-literal';
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
   * Same-file `const X = '…'` initializers, so signal 3 sees the three
   * `GLOBAL_SETTINGS_*` constants that stood between the literal and the call.
   * One hop only, and deliberately: this is the syntactic half of D-42's
   * defence, and a channel id that arrives as a parameter or through DI is what
   * the runtime seam guard in `SettingsService` is for.
   */
  const stringConsts = new Map<string, string>();
  const collectConsts = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      stringConsts.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, collectConsts);
  };
  collectConsts(sf);

  const visit = (node: ts.Node): void => {
    // Signal 3 — a settings read whose channel argument is a string literal
    // that is not a channel id (feature 072, D-42).
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const channelArg = node.arguments[1];
      if (
        (method === 'get' || method === 'getMany') &&
        channelArg !== undefined &&
        isSettingsReceiver(node.expression.expression.getText(sf))
      ) {
        let literal: string | undefined;
        if (ts.isStringLiteralLike(channelArg)) {
          literal = channelArg.text;
        } else if (ts.isIdentifier(channelArg)) {
          literal = stringConsts.get(channelArg.text);
        }
        if (literal !== undefined && isNotAChannelId(literal)) {
          violations.push({
            file: relPath,
            line: at(node),
            kind: 'settings-channel-literal',
            detail:
              `settings.${method}(…) reads channel '${literal}', which is not a ` +
              `sales-channel id — pass a channel uuid, or null for a platform-wide read`,
          });
        }
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

function main(): void {
  const enforce = process.argv.includes('--enforce');
  const listMode = process.argv.includes('--list');
  const files = walk(SRC_ROOT);

  const all: Violation[] = [];
  for (const file of files) {
    const relPath = relative(SRC_ROOT, file).split('\\').join('/');
    all.push(...analyzeSource(readFileSync(file, 'utf8'), relPath));
  }

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
  main();
}
