/**
 * CI check — SQL written inside a transaction runs inside that transaction
 * (issue #200). **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/transaction-context.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts). This file resolves this repository's module walk roots and its
 * population floor, and it holds the ledger below — a ledger is a statement
 * about *this* tree's debt and does not travel. `endora check` hosts the same
 * analysis over one module package. The forwarding specifier is **bare**, never
 * a path into `dist`.
 *
 * Usage: `tsx scripts/check-transaction-context.ts [--list]`
 * Exit 0 = every statement written inside a transaction runs inside it (or is
 * ledgered); exit 1 = at least one does not, or a ledger entry is stale;
 * exit 2 = nothing was read.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  checkTransactionContext,
  collectTransactionSources,
  findTransactionEscapes,
  keyOf,
} from '@endora-commerce/cli/rules/transaction-context.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/transaction-context.js';

/**
 * Connection-level statements inside a transaction that may stay that way, with
 * the reason and the question that would retire the entry.
 *
 * Keyed `<path under src/>#<shape>#<statement head>` rather than by line, so
 * moving code inside a file does not invalidate an entry and re-opening the hole
 * does not silently inherit one. **Two-way**, in the idiom of
 * `BARE_SUBSCRIPTIONS_TO_DRAIN`: an unledgered site fails the build, and a
 * ledger entry that no longer describes one fails it too.
 *
 * It is empty, and that is the point: every statement written inside a
 * transaction in this tree now runs inside it. An entry here is a write that
 * survives a rollback of the operation that produced it, so its reason has to
 * say why that is right — an advisory lock that must outlive its transaction, a
 * record that has to survive the failure it describes — and "it works today" is
 * not that.
 */
export const CONNECTION_LEVEL_SQL_IN_TRANSACTIONS: Readonly<Record<string, string>> = {};

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  // Both roots, derived (feature 080, T040a): the application's source tree and
  // every module that has become a workspace package.
  const layout = await requireModuleLayout('[transaction-context]');
  const files = layout.sourceRoots.flatMap((root) => collectTransactionSources(root));

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(layout.keyOf(file), readFileSync(file, 'utf8'));
  }

  // Every transaction this check judges is in a module service, and `src/`
  // without `src/modules` is 7% of the tree: reading the remainder finds no
  // escape and reports "clean" (issue #215). The floor is the manifest index,
  // so it tracks the module list rather than restating it.
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[transaction-context]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });

  const result = checkTransactionContext({ sources }, CONNECTION_LEVEL_SQL_IN_TRANSACTIONS);

  if (listMode) {
    for (const entry of findTransactionEscapes({ sources })) {
      const tag =
        CONNECTION_LEVEL_SQL_IN_TRANSACTIONS[keyOf(entry)] !== undefined ? 'LEDGERED' : 'ESCAPES ';
      console.log(
        `${tag} ${entry.file}:${entry.line}  [${entry.scope}/${entry.shape}/${entry.direction}] ${entry.statement}`,
      );
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244).
  reportReadSize({
    prefix: '[transaction-context]',
    files: sources.size,
    coverage: [coverage],
  });
  console.log(
    `[transaction-context] statements written inside a transaction that escape it=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(CONNECTION_LEVEL_SQL_IN_TRANSACTIONS).length} ` +
      `stale=${result.stale.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nSQL written inside a transaction that does not run inside it (issue #200).\n' +
        'A connection-level handle takes its own pooled connection: the write commits\n' +
        'immediately and outlives the rollback, and a read cannot see what the\n' +
        "transaction has written. Use the EntityManager's own `em.execute(sql, params)`,\n" +
        'which passes the transaction context and is identical outside a transaction.\n',
    );
    for (const entry of result.violations) {
      console.error(
        `  - ${entry.file}:${entry.line}  [${entry.scope}/${entry.shape}/${entry.direction}] ${entry.statement}`,
      );
    }
  }
  if (result.stale.length > 0) {
    console.error('\nStale ledger entries (no longer describe an escape — delete them):');
    for (const key of result.stale) console.error(`  - ${key}`);
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
