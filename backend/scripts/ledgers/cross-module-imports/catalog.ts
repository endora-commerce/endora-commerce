/**
 * Cross-module reaches still standing in `catalog` (feature 075,
 * FR-022…FR-026; feature 077, D-87; issue #187).
 *
 * Keyed `<file>:<target module>/<target path>` for an import and
 * `<file>:sql:<owner>/<table>` for a raw statement or a query builder, so
 * moving code inside a file does not invalidate an entry and re-opening a hole does not
 * silently inherit one. The file is spelled as `layout.keyOf` spells it — a path under
 * `src/` for a module still in `backend/src`, and the repo-relative package path for one
 * that has become a package, which is what these keys carry since `catalog` moved
 * (feature 080, T040b).
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer describes one
 * fails it too. Delete this file when the last entry goes; an empty shard is refused,
 * because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 *
 * **Every entry here is a SQL reach, none of them is an open design question any more,
 * and none was a blocker on packaging this module.** Batch six measured that combination
 * for the first time (`seo`, !1048): a shard is read as a packaging blocker because it
 * usually holds *import* reaches, which stop resolving once the owner is a package, and a
 * SQL reach does not. This shard was the first to carry the finding for real rather than
 * by injection — the check found, attributed and accepted each one under a key re-spelled
 * to the package form, and nothing else about them moved.
 *
 * Re-read for feature 080's SQL-reach sweep, which retired one of the family
 * (`admin_actions`' `module_registrations` join). What each of these waits for is named
 * below and is a *fact about another module* rather than a shape nobody has chosen: both
 * wait on `orders` becoming a package. Each entry states what it couples in **columns**,
 * because that is the cost a reader can act on — a SQL reach compiles and runs from a
 * package exactly as it does from the tree, so what it costs the boundary is never a
 * build failure, only a column rename that breaks a stranger in silence.
 *
 * **The `sales_channel_products` entry is gone**
 * (`specs/120-migration-closure-bridge-ownership/` Phase 2). It recorded a reach into a
 * *kernel* table, and it was the shard's only one; moving that bridge's `create table` to
 * `catalog` under D-226 — a bridge belongs to the module that owns its far side — makes
 * the join intra-module, so there is no boundary left for an entry to describe. The
 * Constitution XII question it also raised is untouched by that and is not this ledger's:
 * the type-ahead still joins the bridge by hand rather than through a sanctioned
 * accessor, and what changed is only that the table it joins is now its own module's.
 * **How many keys are left is not written here** — the array below answers it, and the
 * count that stood in this paragraph was wrong the moment one key left (D-100).
 *
 * **The three admin surface reaches this shard held are gone** (feature 091, P7a).
 * `CategoriesTree.tsx` imported `price_lists`' `DisplayModeOverrideRow`, and `ProductEditor.tsx`
 * imported that module's `LinkedPriceListsPanel` and `sales_channels`' `EntityChannelMembership`.
 * Each entry's recorded retiring condition was the owner declaring an **admin contribution
 * zone**, and that is what retired them: `catalog` renders `category.editor.after`,
 * `product.editor.pricing.after` and `product.editor.channels`, the two owners contribute into
 * them, and neither module names the other. Nothing was moved and no specifier was rewritten,
 * which is what the condition refused.
 *
 * What is left is the SQL reaches above. Do not read this shard as the admin's — a future
 * admin reach out of `catalog` belongs here on the same terms, keyed on a repository-relative
 * path under the admin's module root, and recorded before the directory moves.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

/**
 * The half of the conversion obligation these entries do **not** carry, measured once
 * rather than argued three times.
 *
 * A cross-module edge normally owes the operator a deactivation-consequence sentence —
 * `degrades-without`, `refuses-without` or `contributes-to` — for the confirmation dialog
 * on `/platform/modules`. `catalog`, `carts` and `orders` all declare
 * `activation.nonDeactivatable`, so between those three there is no control to render one
 * beside and no switch a binding declaration could turn dead. That removes one of the
 * four things a conversion has to satisfy and leaves the two that actually bind: the port
 * *shape*, and *where the interface lives*.
 */
const NO_OPERATOR_HALF =
  'The operator-facing half of a conversion here is empty, and it is derived rather than ' +
  'assumed: `catalog`, `carts` and `orders` each declare `activation.nonDeactivatable`, ' +
  'so there is no deactivation-consequence sentence to write for this edge and no owner ' +
  'control a binding declaration could turn into a dead switch. Un-lock either owner and ' +
  'this sentence has to be rewritten with the edge.';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/catalog/src/backend/services/catalog-admin.service.ts:sql:carts/cart_items':
    'Issue #187 seed — `assertProductDeletable` refuses a product delete that would ' +
    'orphan a cart line, and it asks with `select count(*) … from "cart_items" where ' +
    '"product_id" = ?`. SQL names no import specifier, so this crossed the boundary ' +
    'invisibly to predicate 1. **What it couples is one column**, ' +
    '`cart_items.product_id`.\n\n' +
    '**The seed offered two exits; D-169 has since closed the question, and one of the ' +
    'two was never available.** The seed proposed either a veto on a ' +
    '`product.delete.requested` event or "the acknowledged reverse port edge D-94.3 ' +
    'establishes". The veto is refused here rather than left to be tried: this read runs ' +
    '**inside the delete Command\'s transaction**, deliberately, with the reason in the ' +
    'call site\'s own comment — it is `em.execute` and not `em.getKnex()` precisely ' +
    'because a connection-level read would guard a write from outside the transaction it ' +
    'is guarding (issue #200). An event carries no `EntityManager`, so a veto moves the ' +
    'guard back out of that transaction, and the only way to keep it in would be to put ' +
    'the caller\'s transaction into ambient state — which D-77 rationale 3 costed and ' +
    'refused in writing.\n\n' +
    'So the shape is the other one, and it is ruled rather than proposed. **D-169** ' +
    '(2026-08-24) settles a cross-module seam that runs inside the caller\'s transaction: ' +
    'an `EntityManager`-taking published port, the `EntityManager` a **required method ' +
    'parameter**. **D-171** settles where the interface lives — the owner\'s package ' +
    '`./ports` subpath, a type-only reach into which is not a cross-module reach at all. ' +
    'It cannot live in `packages/contracts`, which holds zero `@mikro-orm` imports ' +
    'because `admin` and `storefront` compile it.\n\n' +
    '`carts` **is** a package (`packages/modules/carts`), so that home exists for this ' +
    'half. The twin below reaches `orders`, which is not, and the two are **one method** ' +
    '— the same few lines of `assertProductDeletable`. Converting one half would leave ' +
    'the guard asking one owner through a published port and the other through a ' +
    '`count(*)`, which is a worse artefact than either state and reads to the next author ' +
    'as an oversight. D-171 §1 says the conversion and the retirement are separate merge ' +
    'requests and that a row must not promise the second; this entry promises neither and ' +
    'names the blocker instead.\n\n' +
    'Two facts the seed had right and worth keeping. The dependency direction is closed: ' +
    '`carts` declares `catalog` in `dependencies`, so a `catalog → carts` entry there ' +
    'would close a cycle `module-graph.test.ts` fails on, and ' +
    '`acknowledgedDependencies` is the instrument for exactly that (D-94.2\'s precedent) ' +
    '— it carries the bind and drops the ordering. And ' + NO_OPERATOR_HALF + '\n\n' +
    'Retired by: `orders` becoming a package, then both halves of ' +
    '`assertProductDeletable` converting together to `EntityManager`-taking read ports on ' +
    'the two owners\' `./ports` subpaths, with an `acknowledgedDependencies` entry for ' +
    'each edge.',
  'packages/modules/catalog/src/backend/services/catalog-admin.service.ts:sql:orders/order_items':
    'Issue #187 seed — the twin of the `cart_items` entry above, in the same method and ' +
    'the same transaction: `assertProductDeletable` counts `orders`\' `order_items` ' +
    'before letting a product go. **What it couples is one column**, ' +
    '`order_items.product_id`.\n\n' +
    '**This is the half that blocks the pair, and the blocker is a packaging fact rather ' +
    'than a design one.** Everything argued above applies unchanged — D-169 rules the ' +
    'shape (an `EntityManager`-taking published port, because the read is inside the ' +
    'caller\'s transaction and decides its outcome), D-171 rules where the interface ' +
    'lives (the owner\'s package `./ports`), the cycle rules out `dependencies` (`orders` ' +
    'declares `catalog`), and `acknowledgedDependencies` is the instrument. The one thing ' +
    'that does not apply is the home: `orders` is still in `backend/src/modules`, so it ' +
    'has no `./ports` subpath and no bare specifier, and an interface written into its ' +
    'private tree today would be a relative reach — this same entry with `sql:` swapped ' +
    'for a path, costing the ledger nothing and this shard no line.\n\n' +
    NO_OPERATOR_HALF + '\n\n' +
    'Retired by: `orders` becoming a package, with the `carts` half above — the two are ' +
    'one decision and one method, and cutting either alone is refused for that reason.',
};
