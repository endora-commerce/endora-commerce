/**
 * CI check — a test does not empty a shared table it does not own (issue #166).
 *
 * The shape, in full:
 *
 *     beforeEach(async () => {
 *       const em = h.em();
 *       await em.nativeDelete(ComparisonProduct, {});
 *       await em.nativeDelete(Comparison, {});
 *     });
 *
 * Eight comparison test files carried exactly that, and it is what let the four
 * of them that assert over the *whole* table be written: `expect(body.data)
 * .toHaveLength(1)` against `GET /admin/comparisons`, `expect(rows)
 * .toHaveLength(1)` against `em.find(Comparison, {})`. Those assertions are not
 * about the comparison the test created — they are about every comparison that
 * exists, and they hold only because the hook above deleted everyone else's
 * first.
 *
 * That is the same defect `check-fixture-substitution` refuses, pointing the
 * other way: there a test *read* a row another file had seeded, here a test
 * *destroys* the rows another file seeded. Both make the result a property of
 * what else happened to be in the database.
 *
 * ## What counts as a violation
 *
 * An **unscoped wipe**: a statement in a file under `backend/test/` that
 * removes or rewrites every row of a table, in any of these spellings —
 *
 *   1. **orm** — `em.nativeDelete(Entity, {})`, an empty filter meaning "all";
 *   2. **sql-truncate** — `conn.execute('truncate table "x", "y" cascade')`;
 *   3. **sql-delete** — `conn.execute('delete from "x"')` with no `where`;
 *   4. **orm-remove-each** — `em.find(Entity, {})` (or `em.findAll(Entity)`)
 *      whose result reaches `remove` / `removeAndFlush`: the array itself, a
 *      `for … of` over it, or a `forEach` / `map` callback over it. No
 *      `nativeDelete` and no SQL, and the table is just as empty after the
 *      `flush` (issue #115: `sales_channels/boot-time-default-reconciliation`
 *      removed the platform's default channel this way). Whether a `flush`
 *      follows is not asked — a test that removes and never flushes has a
 *      different bug, and some helper downstream flushes it anyway;
 *   5. **sql-update** — `update "x" set …` with no `where`, and
 *   6. **orm-update** — `em.nativeUpdate(Entity, {}, …)`. Neither removes a
 *      row, and both leave every row of a table rewritten for the next file
 *      to read — the same issue's `update "quote_requests" set
 *      "sales_channel_id" = null`. An update's `set` clause routinely carries a
 *      `${…}` hole before its `where`, so this one is read over the template's
 *      whole text, holes included, rather than over its head alone.
 *
 * A wipe with a filter is not reported and is the repair: `nativeDelete(Entity,
 * { id: { $in: mine } })`, `delete from x where code = ?`. So is not wiping at
 * all — a test whose fixtures carry an identity of their own (a per-test cookie
 * token, a per-file prefix) has nothing to clean up, because nothing it created
 * is reachable from another test's assertions.
 *
 * ## What it does not see, deliberately
 *
 *   - **`test/helpers/` and `test/global-setup.ts`.** The harness's
 *     `truncate ... cascade` over `SEEDED_TABLES` is the database lifecycle for
 *     a test file: one authority, one moment, everything downstream reseeded
 *     from it. Measuring it against the rule it implements would report the
 *     definition as the violation — the same carve-out `SEAM_FILES` makes in
 *     `check-fixture-substitution`.
 *   - **`src/`.** A service truncating a table is a domain decision with its
 *     own reviewers.
 *   - **A scoped delete of any size.** Deleting a hundred rows the test created
 *     is bookkeeping; deleting one row it did not is the defect. The predicate
 *     is the filter, not the volume.
 *   - **A find-all whose result travels further than its own function.** The
 *     result is followed through its binding, a `for … of` over it and a
 *     callback over it, inside the function the find sits in. Returned to a
 *     caller that removes it, it is not seen — no such shape exists in the tree,
 *     and following values across functions is a type checker's job.
 *   - **A table named by a `${…}` hole.** `delete from ${table}` computes the
 *     table at runtime, so the statement's own text does not say what it
 *     empties. Every such statement in the tree today carries a `where`, so
 *     nothing is being lost quietly — but it is a hole, and it is written down
 *     here rather than discovered later. A wipe of a computed table has to be
 *     caught in review.
 *
 * ## Why this is a ratchet and not a build break
 *
 * The shape is not an anomaly — it is what most of `test/` does: **197 wipes
 * across 70 files** stood when this check landed, after the eight comparison
 * files that prompted it were fixed. So it runs against
 * {@link UNSCOPED_WIPES_BASELINE}, a **per-file count**, in the idiom
 * `HARDCODED_STRINGS_BASELINE` established for the same situation: a new wipe
 * in any file fails the build, and a file left standing over a number after its
 * wipes were scoped fails it too.
 *
 * A per-site ledger with a reason each — the `DEFAULTED_FIXTURE_READS` idiom —
 * is the wrong instrument here for the reason that file gives itself: an entry
 * carries a reason because it is a decision somebody has to defend, and there
 * are not 197 decisions. There are a handful of shapes (a module resetting its
 * own configuration table, a suite rebuilding the platform's single default
 * price list) repeated across 70 files, and writing that sentence 197 times
 * would produce a ledger nobody reads.
 *
 * Usage: `tsx scripts/check-shared-table-wipes.ts [--list]`
 * Exit 0 = every file is at or under its baseline; exit 1 = a file is over it,
 * a file that carries wipes is unlisted, or a listed file has drained below its
 * number; exit 2 = the walk read no test source, **or** it read them all and
 * found no delete statement of any kind — either way the analysis saw nothing
 * and a pass would be vacuous (issue #113).
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { reportReadSize } from './lib/read-size.js';

const TEST_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'test');

/**
 * The harness, which owns the database lifecycle a test file runs inside.
 *
 * `setupBackendServer` truncates `SEEDED_TABLES` once per composition and
 * reseeds; `global-setup` applies the migrations. Both are the rule rather than
 * an instance of it.
 */
const SEAM_PREFIXES: readonly string[] = ['helpers/', 'global-setup.ts'];

/** The MikroORM call that takes a filter, where `{}` means every row. */
const ORM_WIPE = 'nativeDelete';

/** The MikroORM update that takes a filter first, where `{}` means every row. */
const ORM_UPDATE = 'nativeUpdate';

/** The MikroORM reads whose result, removed row by row, empties the table. */
const ORM_FIND_ALL: ReadonlySet<string> = new Set(['find', 'findAll']);

/** The unit-of-work removals that take an entity or an array of them. */
const ORM_REMOVE: ReadonlySet<string> = new Set(['remove', 'removeAndFlush']);

/** The array methods whose callback receives each row of the result in turn. */
const ITERATING_METHODS: ReadonlySet<string> = new Set(['forEach', 'map', 'flatMap']);

/** The raw-SQL entry points a test reaches the connection through. */
const SQL_ENTRY: ReadonlySet<string> = new Set(['execute', 'query']);

/**
 * The standing debt, as measured when this check landed: **197 unscoped wipes
 * across 70 files** under `backend/test/`.
 *
 * Keys are paths relative to `test/`, values are how many wipes that file is
 * still allowed. A **two-way ratchet**: a file over its number fails, a file
 * with wipes and no number fails, and a file **under** its number fails too —
 * scope a delete and the baseline has to come down with it, which is what stops
 * a number from describing a debt that was already paid.
 *
 * The eight comparison files that prompted the check are deliberately absent:
 * they were fixed in the same change, and an entry for a file at zero would be
 * an invitation to write the shape back.
 *
 * **Issue #115 widened what counts** — the find-all/remove-each shape and the
 * two spellings of an unqualified update — and the sites that measured were
 * either repaired in the same change (the three `sales_channels` files that
 * emptied the platform's default channel now run on a first-boot database of
 * their own, `setupTestDb({ firstBoot })`) or entered here, each with the shape it
 * is written in beside it. Those comments say what the statement does, not
 * that it is harmless: every one of them rewrites rows another file seeded.
 *
 * It is meant to reach `{}`.
 */
export const UNSCOPED_WIPES_BASELINE: Readonly<Record<string, number>> = {
  // #115: `afterAll` removes every asset folder, one by one.
  'contract/assets_library/admin-folders.contract.test.ts': 1,
  'contract/carts/cart-coupon-autodrop.contract.test.ts': 1,
  'contract/carts/cart-coupon.contract.test.ts': 1,
  // #115: demotes every currency before restoring the original default.
  'contract/i18n/admin-currencies.test.ts': 1,
  // #115: demotes every language before restoring the original default.
  'contract/i18n/admin-languages.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'contract/orders/admin-create-groups.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'contract/orders/carry-system-note-visibility.test.ts': 1,
  'contract/price_lists/display-modes.test.ts': 1,
  'contract/price_lists/pricing-resolution.test.ts': 1,
  // #115: +1, the same helper detaches every feed template from its taxonomy (`update … set "taxonomy_id" = null`).
  'contract/product_feeds/taxonomy-revisions.test.ts': 4,
  'contract/promotions/attribute-criterion.test.ts': 1,
  'contract/promotions/coupon-generator.test.ts': 1,
  'contract/promotions/coupons.test.ts': 1,
  'contract/promotions/promotion-rules.test.ts': 2,
  'contract/promotions/promotions-crud.test.ts': 1,
  'contract/prompt_actions/boundaries.test.ts': 1,
  'contract/prompt_actions/requests.test.ts': 1,
  'contract/search/admin-llm-toggle.contract.test.ts': 1,
  // #115: removes every phrase record before each case.
  'contract/search/public-record.contract.test.ts': 1,
  'integration/_lifecycle/install-all.integration.test.ts': 1,
  'integration/addresses/dictionary-boundary.test.ts': 3,
  'integration/blog/asset-references.test.ts': 22,
  'integration/blog/dictionary-boundary.test.ts': 3,
  'integration/blog/seed-default-category.test.ts': 13,
  'integration/blog/slug-collision.test.ts': 11,
  // #115: +1, clears every cart's applied promotion code.
  'integration/carts/cart-customer-group-promotion.test.ts': 2,
  'integration/carts/cart-promotion-display.test.ts': 1,
  'integration/catalog/attributes-migration-parity.test.ts': 3,
  'integration/catalog/link-tile-price-source.test.ts': 1,
  'integration/catalog/listing-price-source.test.ts': 1,
  'integration/cms/legacy-migration.test.ts': 1,
  'integration/comparisons/comparison-price-source.integration.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/crm/auto-create.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/crm/create-from-opportunity.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/crm/custom-field-carry-from-opportunity.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/crm/custom-field-carry-quote-version.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/crm/merged-stories.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability, in three `beforeAll`s.
  'integration/crm/off-state.test.ts': 3,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/crm/quote-conversion.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/crm/review-extensions.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/crm/webhooks.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/custom_fields/carry-audience.test.ts': 1,
  'integration/dictionaries/country-service.test.ts': 3,
  'integration/dictionaries/currency-service.test.ts': 3,
  'integration/dictionaries/language-country-service.test.ts': 3,
  'integration/dictionaries/language-service.test.ts': 3,
  'integration/dictionaries/seed.idempotent.test.ts': 3,
  'integration/dictionaries/translations.cascade-on-language-delete.test.ts': 3,
  'integration/dictionaries/translations.polymorphic-fk.test.ts': 3,
  'integration/email/delivery-record.test.ts': 1,
  'integration/inventory/availability-worker.test.ts': 1,
  'integration/inventory/dictionary-boundary.test.ts': 3,
  // #115: demotes every language, inside its rolled-back transaction.
  'integration/languages/default-channel-language-repair.test.ts': 1,
  'integration/megamenu/dictionary-boundary.test.ts': 3,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/orders/admin-create-origin.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/orders/order-created-after-commit.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/orders/place-order-custom-field-carry.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/orders/place-order-from-quote-request.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/orders/place-order-quote-groups.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/orders/quote-request-source-review.test.ts': 1,
  'integration/organizations/dictionary-boundary.test.ts': 3,
  'integration/organizations/flat-behavior-preserved.test.ts': 1,
  'integration/price_lists/display-mode-chain.test.ts': 2,
  'integration/product_feeds/schedule-lifecycle.test.ts': 1,
  'integration/product_feeds/taxonomy-bundled-data.test.ts': 4,
  // #115: +1, the same helper detaches every feed template from its taxonomy (`update … set "taxonomy_id" = null`).
  'integration/product_feeds/taxonomy-fetch-check.test.ts': 4,
  'integration/product_feeds/taxonomy-fetch-disabled.test.ts': 1,
  // #115: +1, the same helper detaches every feed template from its taxonomy (`update … set "taxonomy_id" = null`).
  'integration/product_feeds/taxonomy-promote.test.ts': 4,
  'integration/product_feeds/taxonomy-reconcile.test.ts': 4,
  'integration/promotions/attribute-criterion-resolution.test.ts': 1,
  'integration/promotions/channel-binding.test.ts': 1,
  'integration/promotions/dictionary-boundary.test.ts': 3,
  'integration/promotions/org-status-gate.test.ts': 1,
  'integration/promotions/promotion-service.test.ts': 1,
  'integration/promotions/rule-action-apply.test.ts': 1,
  'integration/promotions/stats.test.ts': 3,
  'integration/promotions/usage-limits.test.ts': 3,
  'integration/prompt_actions/bulk-category-flow.test.ts': 1,
  'integration/prompt_actions/set-stock-flow.test.ts': 1,
  // #115: `update "stock_levels" set "on_hand" = …` tops every stock level up so no placement fails on availability.
  'integration/quote_requests/conversion.test.ts': 1,
  'integration/sales_channels/dictionary-boundary.test.ts': 3,
  'integration/search/embedder-reactor.test.ts': 1,
  // #115: resets every digest subscription's last-sent day.
  'integration/tasks/digest.test.ts': 1,
  'integration/taxes/absent-owner-versus-configured-zero.test.ts': 5,
  'integration/taxes/dictionary-boundary.test.ts': 3,
  'integration/taxes/tax-service.test.ts': 1,
  // #115: `nativeUpdate(TransactionalEmail, {}, …)` re-activates every e-mail after each case.
  'integration/transactional_emails/delivery-record.test.ts': 1,
  // #115: `nativeUpdate(TransactionalEmail, {}, …)` re-activates every e-mail after each case.
  'integration/transactional_emails/per-email-activation.test.ts': 1,
  'unit/dictionaries/label-resolver.test.ts': 3,
  'unit/dictionaries/validator-lru-invalidation.test.ts': 3,
  'unit/dictionaries/validator-port.test.ts': 3,
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

/** Which spelling the wipe was written in. */
export type WipeKind =
  | 'orm'
  | 'sql-truncate'
  | 'sql-delete'
  | 'orm-remove-each'
  | 'sql-update'
  | 'orm-update';

/**
 * Where the wipe sits. A `hook` runs for every test in the file, a `helper` runs
 * whenever a test calls it, a `body` runs once — the defect is the same, but the
 * failure message reads better when it says which.
 */
export type WipeSite = 'hook' | 'body' | 'helper';

export interface UnscopedWipe {
  /** Path under `test/`, POSIX separators. */
  readonly file: string;
  readonly line: number;
  /** Entity name or SQL table name, as written. */
  readonly table: string;
  readonly kind: WipeKind;
  readonly site: WipeSite;
  /** The hook or block it sits in, for the failure message. */
  readonly enclosing: string;
}

/** `<file>:<table>` — the identity of a site, for `--list` and for messages. */
export function keyOf(found: UnscopedWipe): string {
  return `${found.file}:${found.table}`;
}

export interface TableWipeInput {
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

/** The trailing identifier of a callee: `em.nativeDelete` → `nativeDelete`. */
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

/** The static text of a string argument, `${…}` holes included as written. */
function literalText(node: ts.Expression): string | null {
  const bare = unwrap(node);
  if (ts.isStringLiteralLike(bare)) return bare.text;
  if (ts.isTemplateExpression(bare)) {
    // A template with substitutions still tells us the verb and, for the shapes
    // this check reads, the table list: both sit before the first hole in every
    // wipe in the tree. Anything after a hole is left out rather than guessed.
    return bare.head.text;
  }
  return null;
}

/**
 * The whole static text of a string argument, each `${…}` hole kept as the
 * literal `${}` — for a statement whose filter routinely sits after a hole.
 */
function fullLiteralText(node: ts.Expression): string | null {
  const bare = unwrap(node);
  if (ts.isStringLiteralLike(bare)) return bare.text;
  if (ts.isTemplateExpression(bare)) {
    return bare.head.text + bare.templateSpans.map((span) => '${}' + span.literal.text).join('');
  }
  return null;
}

/** Strip SQL quoting and schema qualification off a table name. */
function normalizeTable(raw: string): string {
  return raw
    .trim()
    .replace(/[;,]+$/, '')
    .replace(/^["'`]|["'`]$/g, '')
    .split('.')
    .pop() as string;
}

/**
 * The tables a `truncate` empties, or `null` when the statement is not one.
 *
 * `truncate [table] a, "b" [restart identity] [cascade]` — every spelling the
 * tree writes.
 */
export function truncatedTables(sql: string): string[] | null {
  const match = /^\s*truncate\s+(?:table\s+)?([\s\S]*)$/i.exec(sql);
  if (!match) return null;
  const list = (match[1] as string)
    .replace(/\brestart\s+identity\b/gi, ' ')
    .replace(/\bcontinue\s+identity\b/gi, ' ')
    .replace(/\bcascade\b/gi, ' ')
    .replace(/\brestrict\b/gi, ' ')
    .split(',')
    .map(normalizeTable)
    .filter((name) => name.length > 0 && !name.includes('${'));
  return list.length > 0 ? list : null;
}

/**
 * The table an unqualified `delete from` empties, or `null` when the statement
 * is filtered or is not a delete.
 *
 * A `where` makes it scoped, which is the repair rather than the violation — so
 * it is the absence of one that this returns a table for.
 */
export function unfilteredDeleteTable(sql: string): string | null {
  const match = /^\s*delete\s+from\s+([^\s;]+)([\s\S]*)$/i.exec(sql);
  if (!match) return null;
  const rest = match[2] as string;
  if (/\bwhere\b/i.test(rest)) return null;
  // `delete from x using y` and `delete from x returning …` without a `where`
  // still remove every row, so only a `where` takes a statement out.
  const table = normalizeTable(match[1] as string);
  return table.length > 0 && !table.includes('${') ? table : null;
}

/**
 * The table an unqualified `update` rewrites, or `null` when the statement is
 * filtered or is not an update. `select … for update` is not one: the verb
 * has to open the statement.
 */
export function unfilteredUpdateTable(sql: string): string | null {
  const match = /^\s*update\s+(?:only\s+)?([^\s;]+)\s+set\b([\s\S]*)$/i.exec(sql);
  if (!match) return null;
  if (/\bwhere\b/i.test(match[2] as string)) return null;
  const table = normalizeTable(match[1] as string);
  return table.length > 0 && !table.includes('${') ? table : null;
}

/** Whether an expression is the empty object literal, `{}`. */
function isEmptyObject(node: ts.Expression | undefined): boolean {
  if (node === undefined) return false;
  const bare = unwrap(node);
  return ts.isObjectLiteralExpression(bare) && bare.properties.length === 0;
}

/** Whether a call is `em.nativeUpdate(Entity, {}, data)` — an empty filter. */
function ormUpdateTable(call: ts.CallExpression, sf: ts.SourceFile): string | null {
  if (tailName(call.expression) !== ORM_UPDATE) return null;
  const [entity, filter] = call.arguments;
  if (entity === undefined || !isEmptyObject(filter)) return null;
  return unwrap(entity).getText(sf).trim();
}

/**
 * Whether a call reads every row of an entity: `em.find(Entity, {})`,
 * `em.find(Entity, {}, options)`, `em.findAll(Entity)` or `em.findAll(Entity,
 * options)` with no `where` in the options. The entity has to be a name —
 * `rows.find((r) => …)` is `Array#find`, whose argument is a function.
 */
function findAllEntity(call: ts.CallExpression, sf: ts.SourceFile): string | null {
  const name = tailName(call.expression);
  if (name === null || !ORM_FIND_ALL.has(name)) return null;
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const [entity, second] = call.arguments;
  if (entity === undefined) return null;
  const bare = unwrap(entity);
  if (!ts.isIdentifier(bare) && !ts.isStringLiteralLike(bare)) return null;
  if (name === 'find') {
    if (!isEmptyObject(second)) return null;
  } else if (second !== undefined) {
    const options = unwrap(second);
    if (!ts.isObjectLiteralExpression(options)) return null;
    const where = options.properties.find(
      (p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'where',
    );
    if (where !== undefined && !(ts.isPropertyAssignment(where) && isEmptyObject(where.initializer))) {
      return null;
    }
  }
  return bare.getText(sf).trim();
}

/** The call a find sits in once `await` and parentheses are peeled off it. */
function outerExpression(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;
  for (;;) {
    const parent: ts.Node = current.parent;
    if (
      ts.isAwaitExpression(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isNonNullExpression(parent)
    ) {
      current = parent;
      continue;
    }
    return current;
  }
}

/** The nearest function body or source file a node sits in — where its binding lives. */
function scopeOf(node: ts.Node): ts.Node {
  for (let cursor = node.parent; cursor !== undefined; cursor = cursor.parent) {
    if (ts.isFunctionLike(cursor) || ts.isSourceFile(cursor)) return cursor;
  }
  return node.getSourceFile();
}

/** The first parameter's name of a callback, when it is a plain identifier. */
function firstParameter(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null;
  const bare = unwrap(node);
  if (!ts.isArrowFunction(bare) && !ts.isFunctionExpression(bare)) return null;
  const param = bare.parameters[0];
  return param !== undefined && ts.isIdentifier(param.name) ? param.name.text : null;
}

/** Whether `call` is `em.remove(x)` / `em.removeAndFlush(x)` over one of `names`. */
function removesOneOf(call: ts.CallExpression, names: ReadonlySet<string>): boolean {
  const name = tailName(call.expression);
  if (name === null || !ORM_REMOVE.has(name)) return false;
  const arg = call.arguments[0];
  if (arg === undefined) return false;
  const bare = unwrap(arg);
  return ts.isIdentifier(bare) && names.has(bare.text);
}

/** Whether any call under `root` removes one of `names`. */
function anyRemoval(root: ts.Node, names: ReadonlySet<string>): boolean {
  let hit = false;
  const visit = (node: ts.Node): void => {
    if (hit) return;
    if (ts.isCallExpression(node) && removesOneOf(node, names)) {
      hit = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(root);
  return hit;
}

/**
 * Whether the rows a find-all returned reach a removal — the binding, a
 * `for … of` over it, a `forEach` / `map` callback over it, or the find
 * inlined as the removal's own argument or as the receiver of the iteration.
 */
function rowsReachRemoval(find: ts.CallExpression): boolean {
  const outer = outerExpression(find);
  const parent = outer.parent;

  // `em.remove(await em.find(E, {}))`.
  if (ts.isCallExpression(parent) && parent.arguments[0] === outer) {
    const name = tailName(parent.expression);
    if (name !== null && ORM_REMOVE.has(name)) return true;
  }
  // `(await em.find(E, {})).forEach((row) => em.remove(row))`.
  if (ts.isPropertyAccessExpression(parent) && parent.expression === outer) {
    const call = parent.parent;
    if (
      ts.isCallExpression(call) &&
      call.expression === parent &&
      ITERATING_METHODS.has(parent.name.text)
    ) {
      const row = firstParameter(call.arguments[0]);
      return row !== null && anyRemoval(call.arguments[0] as ts.Node, new Set([row]));
    }
  }
  // `for (const row of await em.find(E, {})) em.remove(row)`.
  if (ts.isForOfStatement(parent) && parent.expression === outer) {
    const row = loopVariable(parent);
    return row !== null && anyRemoval(parent.statement, new Set([row]));
  }
  // `const rows = await em.find(E, {})`, then any of the above over `rows`.
  if (!ts.isVariableDeclaration(parent) || parent.initializer !== outer) return false;
  if (!ts.isIdentifier(parent.name)) return false;
  const rows = parent.name.text;
  let hit = false;
  const visit = (node: ts.Node): void => {
    if (hit) return;
    if (ts.isCallExpression(node)) {
      if (removesOneOf(node, new Set([rows]))) {
        hit = true;
        return;
      }
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ITERATING_METHODS.has(callee.name.text) &&
        ts.isIdentifier(unwrap(callee.expression)) &&
        (unwrap(callee.expression) as ts.Identifier).text === rows
      ) {
        const row = firstParameter(node.arguments[0]);
        if (row !== null && anyRemoval(node.arguments[0] as ts.Node, new Set([row]))) {
          hit = true;
          return;
        }
      }
    }
    if (ts.isForOfStatement(node)) {
      const over = unwrap(node.expression);
      const row = loopVariable(node);
      if (
        ts.isIdentifier(over) &&
        over.text === rows &&
        row !== null &&
        anyRemoval(node.statement, new Set([row]))
      ) {
        hit = true;
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(scopeOf(find));
  return hit;
}

/** The loop variable of `for (const row of …)`, when it is a plain identifier. */
function loopVariable(loop: ts.ForOfStatement): string | null {
  const init = loop.initializer;
  if (!ts.isVariableDeclarationList(init)) return ts.isIdentifier(init) ? init.text : null;
  const decl = init.declarations[0];
  return decl !== undefined && ts.isIdentifier(decl.name) ? decl.name.text : null;
}

/** Whether a call is `em.nativeDelete(Entity, {})` — an empty filter. */
function ormWipeTable(call: ts.CallExpression, sf: ts.SourceFile): string | null {
  if (tailName(call.expression) !== ORM_WIPE) return null;
  const [entity, filter] = call.arguments;
  if (entity === undefined || filter === undefined) return null;
  const bare = unwrap(filter);
  if (!ts.isObjectLiteralExpression(bare) || bare.properties.length > 0) return null;
  return unwrap(entity).getText(sf).trim();
}

/** The vitest lifecycle hooks — a wipe inside one runs for every test in the file. */
const HOOKS: ReadonlySet<string> = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);

/** The vitest block functions a wipe can sit directly inside. */
const BLOCKS: ReadonlySet<string> = new Set(['it', 'test', 'describe']);

/** Where a node sits: the nearest enclosing hook, test block or plain function. */
function siteOf(node: ts.Node): { site: WipeSite; enclosing: string } {
  let enclosingFunction: string | null = null;
  for (let cursor = node.parent; cursor !== undefined; cursor = cursor.parent) {
    if (ts.isCallExpression(cursor)) {
      const name = tailName(cursor.expression);
      if (name !== null && HOOKS.has(name)) return { site: 'hook', enclosing: name };
      if (name !== null && BLOCKS.has(name)) return { site: 'body', enclosing: name };
    }
    if (
      enclosingFunction === null &&
      (ts.isFunctionDeclaration(cursor) || ts.isMethodDeclaration(cursor)) &&
      cursor.name !== undefined
    ) {
      enclosingFunction = cursor.name.getText();
    }
  }
  return { site: 'helper', enclosing: enclosingFunction ?? '(module scope)' };
}

/** Every unscoped whole-table wipe in the given test sources. */
export function findUnscopedWipes(input: TableWipeInput): UnscopedWipe[] {
  const found: UnscopedWipe[] = [];

  for (const [file, text] of input.sources) {
    if (SEAM_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const { site, enclosing } = siteOf(node);
        const entity = ormWipeTable(node, sf);
        const updated = entity === null ? ormUpdateTable(node, sf) : null;
        const findAll = entity === null && updated === null ? findAllEntity(node, sf) : null;
        if (entity !== null) {
          found.push({ file, line, table: entity, kind: 'orm', site, enclosing });
        } else if (updated !== null) {
          found.push({ file, line, table: updated, kind: 'orm-update', site, enclosing });
        } else if (findAll !== null) {
          if (rowsReachRemoval(node)) {
            found.push({ file, line, table: findAll, kind: 'orm-remove-each', site, enclosing });
          }
        } else if (SQL_ENTRY.has(tailName(node.expression) ?? '')) {
          const sql = node.arguments[0] === undefined ? null : literalText(node.arguments[0]);
          if (sql !== null) {
            const truncated = truncatedTables(sql);
            if (truncated !== null) {
              for (const table of truncated) {
                found.push({ file, line, table, kind: 'sql-truncate', site, enclosing });
              }
            } else {
              const deleted = unfilteredDeleteTable(sql);
              const full = fullLiteralText(node.arguments[0] as ts.Expression);
              const rewritten = full === null ? null : unfilteredUpdateTable(full);
              if (deleted !== null) {
                found.push({ file, line, table: deleted, kind: 'sql-delete', site, enclosing });
              } else if (rewritten !== null) {
                found.push({ file, line, table: rewritten, kind: 'sql-update', site, enclosing });
              }
            }
          }
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }

  found.sort((a, b) =>
    a.file === b.file
      ? a.line === b.line
        ? a.table.localeCompare(b.table)
        : a.line - b.line
      : a.file.localeCompare(b.file),
  );
  return found;
}

/**
 * How many test files delete or rewrite rows at all — the second vacuous-pass
 * guard, and the `sites` population the baseline ratchets: a `nativeDelete`,
 * a `nativeUpdate`, a `remove` / `removeAndFlush`, or a SQL `delete`,
 * `truncate` or `update`, whatever its filter.
 *
 * An empty file list is the obvious way to report a green over nothing; the
 * quieter one is a file list whose delete statements the detector no longer
 * recognises, which yields zero violations and reads exactly like a drained tree
 * (issue #113). A MikroORM rename, a walk scoped to the wrong root, a parser
 * that stopped seeing template SQL: each takes this to zero, and zero is not a
 * state this repository's `test/` can be in.
 */
export function filesDeletingRows(input: TableWipeInput): number {
  let count = 0;
  for (const [file, text] of input.sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    let deletes = false;
    const visit = (node: ts.Node): void => {
      if (deletes) return;
      if (ts.isCallExpression(node)) {
        const name = tailName(node.expression);
        if (name === ORM_WIPE || name === ORM_UPDATE) deletes = true;
        else if (name !== null && ORM_REMOVE.has(name) && ts.isPropertyAccessExpression(node.expression)) {
          deletes = true;
        } else if (name !== null && SQL_ENTRY.has(name)) {
          const sql = node.arguments[0] === undefined ? null : literalText(node.arguments[0]);
          if (sql !== null && /^\s*(delete|truncate|update)\b/i.test(sql)) deletes = true;
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
    if (deletes) count += 1;
  }
  return count;
}

/** One file's measured count against its baseline. */
export interface BaselineDrift {
  /** Path relative to `test/`. */
  readonly file: string;
  readonly baseline: number;
  readonly actual: number;
}

export interface CheckResult {
  readonly total: number;
  /** Files carrying more unscoped wipes than the baseline allows. */
  readonly regressions: readonly BaselineDrift[];
  /** Files carrying fewer — the baseline describes a debt that was paid. */
  readonly drained: readonly BaselineDrift[];
}

/**
 * Wipes grouped by the file they were found in.
 *
 * Taken as a parameter rather than read from disk so the ratchet can be driven
 * over counts the repository does not contain — a comparison that only ever
 * sees the real tree agrees with a function that returns nothing.
 */
export function countByFile(wipes: readonly UnscopedWipe[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const wipe of wipes) counts.set(wipe.file, (counts.get(wipe.file) ?? 0) + 1);
  return counts;
}

/** The two-way comparison: what grew, and what shrank without the baseline moving. */
export function compareToBaseline(
  counts: ReadonlyMap<string, number>,
  baseline: Readonly<Record<string, number>> = UNSCOPED_WIPES_BASELINE,
): { regressions: BaselineDrift[]; drained: BaselineDrift[] } {
  const regressions: BaselineDrift[] = [];
  const drained: BaselineDrift[] = [];

  for (const [file, actual] of counts) {
    const allowed = baseline[file] ?? 0;
    if (actual > allowed) regressions.push({ file, baseline: allowed, actual });
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const actual = counts.get(file) ?? 0;
    if (actual < allowed) drained.push({ file, baseline: allowed, actual });
  }

  const byFile = (a: BaselineDrift, b: BaselineDrift): number => a.file.localeCompare(b.file);
  return { regressions: regressions.sort(byFile), drained: drained.sort(byFile) };
}

export function checkSharedTableWipes(
  input: TableWipeInput,
  baseline: Readonly<Record<string, number>> = UNSCOPED_WIPES_BASELINE,
): CheckResult {
  const all = findUnscopedWipes(input);
  const { regressions, drained } = compareToBaseline(countByFile(all), baseline);
  return { total: all.length, regressions, drained };
}

function main(): void {
  const listMode = process.argv.includes('--list');
  const files = walk(TEST_ROOT);
  if (files.length === 0) {
    console.error(
      '[shared-table-wipes] no sources under test/ — refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(relative(TEST_ROOT, file).split('\\').join('/'), readFileSync(file, 'utf8'));
  }

  const deleting = filesDeletingRows({ sources });
  if (deleting === 0) {
    console.error(
      `[shared-table-wipes] read ${sources.size} test sources and found no delete or update statement ` +
        `in any of them — the detection has gone blind; refusing to report a vacuous pass`,
    );
    process.exit(2);
  }

  const wipes = findUnscopedWipes({ sources });
  const result = checkSharedTableWipes({ sources });
  const over = new Set(result.regressions.map((drift) => drift.file));

  if (listMode) {
    for (const entry of wipes) {
      const tag = over.has(entry.file) ? 'OVER    ' : 'BASELINE';
      console.log(
        `${tag} ${entry.file}:${entry.line}  [${entry.kind}/${entry.site}:${entry.enclosing}] ${entry.table}`,
      );
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244). `files` is the walk;
  // `sites` is the subset that deletes or rewrites rows at all (since issue
  // #115, `remove` and `update` too), the population the baseline ratchets.
  // `self-reported`: nothing derives "every test that deletes".
  reportReadSize({ prefix: '[shared-table-wipes]', files: sources.size, sites: deleting });
  console.log(
    `[shared-table-wipes] files deleting rows=${deleting} ` +
      `unscoped whole-table wipes=${result.total} ` +
      `files over baseline=${result.regressions.length} drained=${result.drained.length} ` +
      `baseline-size=${Object.keys(UNSCOPED_WIPES_BASELINE).length}`,
  );

  if (result.regressions.length > 0) {
    console.error(
      '\nA test emptied a table it does not own, so every assertion after it\n' +
        'depends on no other file having put a row there (issue #166). Scope the\n' +
        'delete to the rows this file created — a filter, a per-test owner token, a\n' +
        'per-file prefix — or stop deleting and assert over your own rows instead\n' +
        'of over the whole table. Do not raise the baseline to make this pass.\n',
    );
    for (const drift of result.regressions) {
      console.error(`  - ${drift.file}: ${drift.actual} wipes, baseline allows ${drift.baseline}`);
      for (const entry of wipes.filter((w) => w.file === drift.file)) {
        console.error(`      ${entry.line}  [${entry.kind}] ${entry.table} in ${entry.enclosing}`);
      }
    }
  }
  if (result.drained.length > 0) {
    console.error(
      '\nFiles below their baseline — lower the number so it keeps describing the debt:',
    );
    for (const drift of result.drained) {
      console.error(`  - ${drift.file}: ${drift.actual} wipes, baseline still says ${drift.baseline}`);
    }
  }

  process.exit(result.regressions.length > 0 || result.drained.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
