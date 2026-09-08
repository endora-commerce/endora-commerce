/**
 * Dev seed (T093 / quickstart §3).
 *
 * **No package script runs this file any more** (feature 113, T214): `db:reset`
 * calls `endora demo seed`, which is the composed path and the one an operator
 * has. What still runs it is `test/integration/demo/demo-parity.test.ts`, which
 * seeds through both and compares the two databases — this file is the
 * reference side of that comparison and is deleted with the residue (T226).
 *
 * The developer bootstrap: a shop to sign in to and click around. It creates
 * two sales channels, a three-level category tree, ~10 product attributes, 200
 * synthetic products with images and attachments, three composites, a platform
 * administrator, two sales representatives, a demo organisation with a buyer, a
 * granted credit limit, a delivery method, two payment methods, a second
 * warehouse and the Polish VAT rate — and then the wiring between them.
 * Credentials are printed so the developer can sign in immediately.
 *
 * NOT for production. `mustBeNonProduction()` refuses to run unless BOTH hold:
 * `NODE_ENV` is not `production`, and `DATABASE_URL` names a loopback host or a
 * database whose name follows the `_test` convention the vitest harness uses.
 * Each has its own explicit opt-out — `ALLOW_DEV_SEED_IN_PRODUCTION=true` and
 * `ALLOW_DEV_SEED_ON_NON_LOCAL_DATABASE=true` — and a deliberate demo seed on a
 * remote database needs both. Issue #224: until then the second guard was a
 * regex over the whole DSN whose `postgres` alternative matched the
 * `postgresql://` scheme, so it had never refused a database on any host.
 *
 * ## What this file is now, and what it used to be (feature 113, T211)
 *
 * It used to be 887 lines in one function, holding a dozen modules' demo rows
 * and the wiring between them with nothing separating the two. It is now the
 * **entry point** and nothing else: the guard, the database, one system scope,
 * and three calls. The rows live in `demo-host-residue.ts` — a queue Phase 2
 * empties module by module — and the wiring in `demo-composition.ts`.
 *
 * The third call is `demo-relocated-reference.ts`, and it is what keeps the
 * comparison below meaningful while Phase 2 runs: a module that has taken its
 * block back writes those rows on the composed path, and this script writes the
 * frozen copy of the block it replaced. Two different pieces of code producing
 * one shop is the thing being asserted; one piece of code called twice would
 * assert nothing.
 *
 * `endora demo seed` makes the same two calls over a composed platform, which
 * is the point of the split: this script is the one being replaced, and until
 * it goes the two must produce the same shop.
 * `test/integration/demo/demo-parity.test.ts` is what says they do.
 *
 * **It no longer truncates.** The 29-table `truncate ... cascade` that used to
 * open it is `resetHostModuleResidue`, reached by `endora demo reset` (T213):
 * a withdrawal an operator asks for by name may destroy rows, and a seed may
 * not. On a freshly migrated database it was destroying 15 payment methods, 4
 * delivery methods and 15 adapter rule rows that four migrations had seeded.
 * Re-seeding an already-seeded database is therefore `endora demo reset` first,
 * or `pnpm --filter backend run db:reset`, which rebuilds the schema anyway.
 *
 * ## Why it is not deleted under FR-016
 *
 * FR-016's "a dev script naming modules by hand" is about a script duplicating
 * something the platform already answers. This one duplicates nothing: it is
 * the developer bootstrap quickstart §3 documents and `docs/docs/modules/
 * search.md` tells you to run before a reindex. It retires when `db:reset`
 * calls the demo command instead (T214), not before.
 */

import { initOrm, closeOrm } from '../db/index.js';
import { mustBeNonProduction, SEED_SCOPE_REASON } from '../demo/index.js';
import { enterSystemScope } from '../kernel/scope.js';
import {
  createDemoComposition,
  DEMO_BUYER_EMAIL,
  DEMO_BUYER_PASSWORD,
} from './demo-composition.js';
import {
  DEMO_ADMIN_EMAIL,
  DEMO_ADMIN_PASSWORD,
  seedHostModuleResidue,
} from './demo-host-residue.js';
import { seedRelocatedDemoReference } from './demo-relocated-reference.js';

async function main(): Promise<void> {
  // command-coverage-ignore: the development seed. `mustBeNonProduction()` on
  // the next line is the enforcement, not the convention — this entry point
  // refuses to run against a production database at all, so the writes below
  // have no operator, no tenant and no audit reader.
  mustBeNonProduction();
  const orm = await initOrm();
  const em = orm.em.fork();

  const residue = await seedHostModuleResidue(em);

  // The blocks that have already reached their own modules, in the frozen copy
  // this script — and nothing else — runs. `endora demo seed` invokes the
  // modules' own bodies here instead, which is what
  // `test/integration/demo/demo-parity.test.ts` compares the two databases
  // over. See `demo-relocated-reference.ts` for why the copy exists: without
  // it a moved block leaves the reference side of that comparison, and a batch
  // that dropped a column would be as green as one that did not.
  await seedRelocatedDemoReference(em);

  // The wiring that spans modules — the megamenu over the category tree, the
  // two bridge tables, the price-list backfill, the stock spread and the
  // buyer's membership.
  //
  // **The presence oracle is `() => true`, and that is not a shortcut.** This
  // script composes no platform, so there is no registry cache to ask, and a
  // cold cache answers `false` for everything — a script that consulted one
  // would skip all five steps and report a shop it did not build. The presence
  // question belongs to the composed entry point, which is the one this script
  // is being replaced by.
  const composed = await createDemoComposition({ em, isPresent: () => true }).apply();

  console.log('');
  console.log('=== Dev seed complete ===');
  console.log('');
  console.log(`Products       : ${residue.products}`);
  console.log(`Categories     : ${residue.categoryNodes} nodes`);
  console.log(`Sales Channels : pl_retail (public), pl_b2b_vip (logged-in only)`);
  console.log(`Warehouses     : default (system), pl-krk (Magazyn Kraków)`);
  console.log(`Taxes          : pl_vat_23 (23% on PL, default)`);
  console.log(`Delivery       : in_person_pickup (free)`);
  console.log(`Payment        : bank_transfer (proforma flow), credit_limit (50 000.00 PLN granted)`);
  console.log('');
  // One statement rather than a loop apiece: this file is a console-printing
  // script and every `console.log` in it is a lint warning the repository
  // tolerates, so a summary that grows should not grow the warning count.
  console.log(
    [
      `Composition    : ${composed.applied.length} applied, ${composed.skipped.length} skipped`,
      ...composed.applied.map((step) => `  applied: ${step}`),
      ...composed.skipped.map((skip) => `  skipped: ${skip.step} — ${skip.reason}`),
    ].join('\n'),
  );
  console.log('');
  console.log('Sign in credentials (CHANGE before any non-local use):');
  console.log(`  Platform Administrator : ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
  console.log(`  Sales Representative   : sales-rep@demo.local / ${DEMO_ADMIN_PASSWORD}`);
  console.log(`  Sales Rep (other)      : sales-rep-other@demo.local / ${DEMO_ADMIN_PASSWORD}`);
  console.log(`  Organization Admin     : ${DEMO_BUYER_EMAIL} / ${DEMO_BUYER_PASSWORD}`);
  console.log('');
  console.log('Open the storefront at  http://localhost:3000');
  console.log('Open the admin panel at http://localhost:3002');
  console.log('');

  await closeOrm();
}

// The seed's whole execution runs inside one system scope (issue #228, FR-020),
// in the idiom every other CLI entry point in the tree uses: the scope wraps the
// top-level invocation, so there is no path into `main` that is outside it.
// `SEED_SCOPE_REASON` (seed-scope.ts) says why the scope is `system` and why one
// scope covers the run. `mustBeNonProduction()` stays `main`'s first statement —
// the scope opens no connection and reads no row, so a refused run still touches
// nothing.
enterSystemScope(SEED_SCOPE_REASON, main, { entryPoint: 'cli' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
