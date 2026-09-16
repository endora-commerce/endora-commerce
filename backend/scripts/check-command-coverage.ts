/**
 * CI check — a sensitive write runs a Command or records an audit row
 * (Principle XIII, feature 054). **Repository-scope host** over the relocated
 * analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/command-coverage.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts), and its header is the one to read for what the rule can and
 * cannot see. What stays here is what is *this repository's*: the rollout
 * ledger below, the walk roots the layout derives, and the population floor.
 *
 * `pnpm --filter backend run check:command-coverage -- [--strict] [--module <name> ...]`
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';

import {
  analyzeSource,
  collectScannedFiles,
  EXCLUDED_MODULES,
  isMigratedModulePath,
} from '@endora-commerce/cli/rules/command-coverage.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/command-coverage.js';

/**
 * Modules whose service writes are converted to Commands / audited / escape-hatched
 * (build-breaking). The rollout is complete: this is the full module set. New
 * modules should be added here as they land, but CI's `--strict` flag already
 * fails on findings in unlisted modules too, so coverage cannot silently regress.
 */
export const MIGRATED_MODULES: readonly string[] = [
  'credit_limits',
  'price_lists',
  'catalog',
  'orders',
  'inventory',
  'returns',
  'quote_requests',
  'organizations',
  'promotions',
  'carts',
  'customer_accounts',
  'assets_library',
  'shopping_lists',
  'dictionaries',
  'currencies',
  'languages',
  'mfa',
  'stripe',
  'tpay',
  'payu',
  'transactional_emails',
  'invoices',
  'newsletter',
  'admin_users',
  'payments',
  'shipments',
  'payment_methods',
  'delivery_methods',
  'addresses',
  'auth',
  'customers',
  'taxes',
  'api_keys',
  'admin_roles',
  'seo',
  'webhooks',
  'settings',
  'comparisons',
  'pwa',
  'prompt_actions',
  'analytics',
  'search',
  'cms',
  'admin_notifications',
  'admin_actions',
  '_i18n',
  'credentials',
  'ksef',
  'product_feeds',
  'pim_ergonode',
  'pim_pimcore',
  'invoice_ledger',
  'infakt',
  'erp_connector',
  'comarch_xl',
];

/**
 * The roots the CLI walks.
 *
 * Derived rather than listed since feature 080's T040a: it was
 * `['src/modules', 'src/apps']`, joined onto the working directory, which is
 * the module tree's location written down inside the check that has to survive
 * it moving. `resolveModuleLayout().moduleWalkRoots` answers with every root a
 * module's source can live in — each application tree, the overlay tree, and
 * every module that has become a workspace package.
 */
export async function scanRoots(): Promise<readonly string[]> {
  const { resolveModuleLayout } = await import('./lib/module-roots.js');
  return (await resolveModuleLayout()).moduleWalkRoots;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const moduleArgs = argv.reduce<string[]>((acc, arg, i) => {
    if (arg === '--module' && argv[i + 1]) acc.push(argv[i + 1]!);
    return acc;
  }, []);
  const migrated = moduleArgs.length > 0 ? moduleArgs : MIGRATED_MODULES;

  const layout = await requireModuleLayout('[command-coverage]');
  const roots = layout.moduleWalkRoots.filter((root) => existsSync(root));
  const files = roots.flatMap((root) => collectScannedFiles(root));
  // Run from the wrong directory, or after a layout change, the walk finds
  // nothing and every write in the platform passes unexamined. Exit 2: a green
  // line here would say "no unaudited write", which is not what it would mean.
  //
  // Emptiness is the weaker half of that (issue #215): `src/apps` is a scan
  // root of its own, so a moved module tree leaves five overlay files behind
  // and the check reports on those instead. The floor is therefore one file per
  // registered module — minus the ones this check excludes by argument — and it
  // is derived from the manifest index rather than counted here.
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[command-coverage]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    excluded: EXCLUDED_MODULES,
    moduleIdOf: layout.moduleIdOfPath,
  });

  let blocking = 0;
  let reportOnly = 0;
  for (const file of files) {
    const rel = relative(process.cwd(), file);
    const findings = analyzeSource(rel, readFileSync(file, 'utf8'));
    if (findings.length === 0) continue;
    const isBlocking = strict || isMigratedModulePath(rel, migrated);
    for (const f of findings) {
      const tag = isBlocking ? 'ERROR' : 'report';
      process.stdout.write(`[${tag}] ${f.filePath}:${f.line ?? '?'} → ${f.kind}: ${f.message}\n`);
      if (isBlocking) blocking += 1;
      else reportOnly += 1;
    }
  }

  // What was read, beside what was found (issue #244). The line below counts
  // findings only, so `0 blocking, 0 report-only` reads the same whether the
  // walk covered 1364 files or five overlay ones.
  reportReadSize({
    prefix: '[command-coverage]',
    files: files.length,
    coverage: [coverage],
  });
  process.stdout.write(
    `\ncommand-coverage: ${blocking} blocking, ${reportOnly} report-only ` +
      `(migrated modules: ${migrated.length > 0 ? migrated.join(', ') : 'none'})\n`,
  );
  if (blocking > 0) process.exit(1);
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();
