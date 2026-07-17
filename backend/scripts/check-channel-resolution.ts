/**
 * CI check — Sales-Channel Resolution Unification (feature 053, FR-011).
 *
 * Locks the invariant established by feature 053: the current sales channel
 * for a request is resolved EXACTLY ONCE, by the canonical resolver
 * (`sales_channels/middleware/sales-channel-resolver.ts`), and exposed as
 * `request.salesChannel`. No storefront-facing module may re-derive it.
 *
 * Two static signals are flagged (TypeScript compiler API, no DB, no new
 * dependency — mirrors `check-entity-tenant-classification.ts`):
 *
 *  1. RAW CHANNEL HEADER READ — any string literal `x-sales-channel` or
 *     `x-sales-channel-id` anywhere under `src/modules/**` outside the
 *     `sales_channels` module. Legitimate code never reads these headers;
 *     only the resolver does. Global scope = strongest guard.
 *
 *  2. REQUEST-CHANNEL RE-RESOLUTION — inside the storefront "surface" files
 *     (routes.public / routes.storefront / *storefront-resolver / the catalog
 *     & search query services / product-link service): a `SalesChannel`
 *     entity query (`em.findOne/find(SalesChannel, …)`) or a raw
 *     `from sales_channels` SQL string used to derive the request channel.
 *     Scoped to surfaces so admin CRUD / membership / seeds that legitimately
 *     query channels are not false-positived.
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

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const MODULES_ROOT = join(SRC_ROOT, 'modules');

/** Header names that only the canonical resolver may read. */
const CHANNEL_HEADERS = new Set(['x-sales-channel', 'x-sales-channel-id']);

/**
 * Files still permitted to trip a signal during the rollout. Remove an entry
 * in the same change that redirects the file to `request.salesChannel`. Paths
 * are relative to `src/` with POSIX separators.
 */
const ALLOW_LIST = new Set<string>([
  // Content read-surfaces (route + service pairs).
  'modules/catalog/routes.public.ts',
  'modules/catalog/services/catalog-query.service.ts',
  'modules/catalog/services/product-link.service.ts',
  'modules/search/routes.public.ts',
  'modules/search/services/search-query.service.ts',
  'modules/price_lists/routes.storefront.ts',
  'modules/cms/routes.storefront.ts',
  'modules/cms/services/storefront-resolver.ts',
  'modules/megamenu/routes.storefront.ts',
  'modules/megamenu/services/storefront-resolver.ts',
  'modules/blog/routes.storefront.ts',
  'modules/blog/services/blog-storefront-resolver.ts',
  // Other storefront surfaces reading the raw header (discovered by this check —
  // the 053 plan undercounted; these migrate to request.salesChannel too).
  'modules/inventory/routes.ts',
  'modules/pwa/routes.storefront.ts',
  'modules/settings/routes.homepage.ts',
  'modules/settings/routes.product-card-buttons.ts',
  'modules/settings/routes.speculation-rules.ts',
  'modules/settings/routes.storefront.ts',
]);

/** The `sales_channels` module owns resolution — never scanned. */
function isResolverOwned(relPath: string): boolean {
  return relPath.startsWith('modules/sales_channels/');
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
  kind: 'raw-channel-header' | 'request-channel-reresolution';
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

  const visit = (node: ts.Node): void => {
    // Signal 1 — raw channel-header read (global scope).
    if (ts.isStringLiteralLike(node) && CHANNEL_HEADERS.has(node.text.toLowerCase())) {
      violations.push({
        file: relPath,
        line: at(node),
        kind: 'raw-channel-header',
        detail: `reads the '${node.text}' header — use request.salesChannel`,
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
            detail: `${method}(SalesChannel, …) re-resolves the request channel — read request.salesChannel`,
          });
        }
      }
      // Signal 2b — raw `from sales_channels` SQL.
      if (ts.isStringLiteralLike(node) && RAW_CHANNEL_SQL.test(node.text)) {
        violations.push({
          file: relPath,
          line: at(node),
          kind: 'request-channel-reresolution',
          detail: `raw 'from sales_channels' query re-resolves the request channel — read request.salesChannel`,
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
  const files = walk(MODULES_ROOT);

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
    console.error('\nStorefront modules re-resolving the sales channel (read request.salesChannel instead):');
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
