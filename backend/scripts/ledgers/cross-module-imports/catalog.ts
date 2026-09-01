/**
 * Cross-module reaches still standing in `catalog` (feature 075,
 * FR-022…FR-026; feature 077, D-87; issue #187).
 *
 * Keyed `<file>:<target module>/<target path>` for an import and
 * `<file>:sql:<owner>/<table>` for a raw statement or a query builder, so
 * moving code inside a file does not invalidate an entry and re-opening a hole does not
 * silently inherit one. The file is spelled as `layout.keyOf` spells it — a path under
 * `src/` for a module still in `backend/src`, and the repo-relative package path for one
 * that has become a package, which is what these three keys carry since `catalog` moved
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
 * **All three are SQL reaches, and none of the three is an open design question any
 * more — nor was any of them a blocker on packaging this module.** Batch six measured
 * that combination for the first time (`seo`, !1048): a shard is read as a packaging
 * blocker because it usually holds *import* reaches, which stop resolving once the owner
 * is a package, and a SQL reach does not. This shard is the first to carry the finding
 * for real rather than by injection — the check found, attributed and accepted all three
 * under keys re-spelled to the package form, and nothing else about them moved.
 *
 * **All three are SQL reaches, and none of the three is an open design question any
 * more.** Re-read for feature 080's SQL-reach sweep, which retired the fourth of the
 * family (`admin_actions`' `module_registrations` join). What each of these waits for is
 * named below and is a *fact about another module* rather than a shape nobody has
 * chosen: two wait on `orders` becoming a package, one waits on a kernel accessor. Each
 * entry states what it couples in **columns**, because that is the cost a reader can act
 * on — a SQL reach compiles and runs from a package exactly as it does from the tree, so
 * what it costs the boundary is never a build failure, only a column rename that breaks a
 * stranger in silence.
 *
 * **Since feature 091's Phase 0 this shard also holds admin surface reaches**, keyed on a
 * repository-relative path under the admin's module root. They were recorded before any admin
 * directory moves into its module's package, because `module-package-layout.md` §0 measured that
 * rewriting a ledgered relative import as a package specifier *deletes* the reach from the walk
 * and makes the entry describing it read stale. What retires one is never the move and never a
 * rewritten specifier: it is the owner publishing what this consumer needs — into
 * `@endora-commerce/admin-kit` where the piece is generic, or as an admin contribution zone where
 * it is the owner's own screen.
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
  'packages/modules/catalog/src/backend/services/catalog-quick-search.service.ts:sql:kernel/sales_channel_products':
    'D-87 seed, added at rebase — this site did not exist when the sweep ran. It arrived ' +
    'with `cb5be278`, the #174 fix that moved the quick-order type-ahead out of ' +
    '`quick_order` and into its owner and gave it the channel scoping it had never had: ' +
    'before that commit the query filtered neither visibility, nor organization, nor ' +
    'channel, so a buyer saw every active product. So this entry records a boundary that ' +
    'is now crossed *correctly* rather than one that is new debt — the scoping is ' +
    'applied, and what remains is that it is applied by hand against the bridge. **What ' +
    'it couples is two columns of a kernel table**, ' +
    '`sales_channel_products.sales_channel_id` and `.product_id`.\n\n' +
    '**The owner is the platform, and since feature 080\'s sweep this is the ledger\'s ' +
    'only platform-table reach** — which makes the comparison with the one that retired ' +
    'the sharpest thing to say about it. `admin_actions` joined the kernel\'s ' +
    '`module_registrations` to answer "is this module installed here", and it retired ' +
    'with **nothing published**: the kernel already held that answer in memory, on the ' +
    'very object that module was reading the *other* presence axis from, so the cut was ' +
    'one field on an interface the consumer declares itself. That exit does not exist ' +
    'here, and being precise about why matters because "ask the kernel in memory" is the ' +
    'first thing a reader will reach for. Presence is one boolean pair per module, ' +
    'changing when an operator flips a switch. Channel membership is one row per ' +
    '(channel, product) across the whole catalogue, changing whenever anybody edits a ' +
    'product. An in-memory projection of the second is a second copy of the bridge, not ' +
    'a cache of it.\n\n' +
    '**And it is the one member of the six-site family issue #185 did not retire**, for a ' +
    'reason of shape rather than of appetite: the other five narrow a **bounded set of ' +
    'ids** the caller already holds, which is exactly ' +
    '`SalesChannelMembershipPort.filterEntityIdsInChannel`, while this one *joins* the ' +
    'bridge inside a text-predicate query whose candidate set is unbounded until the join ' +
    'and the `limit` have been applied together. Neither published method can express ' +
    'that: `listEntityIdsForChannel` would pull every product in the channel per ' +
    'keystroke, and filtering an already-limited page would silently return fewer hits ' +
    'than the caller asked for — which is why the `limit` sits below the join in one ' +
    'statement, in the call site\'s own words.\n\n' +
    '**Nothing else in the estate can report this reach, which is why the entry has to ' +
    'carry the whole argument.** `check:platform-surface` owns "what the host publishes" ' +
    'and its population is import specifiers, so a SQL reach into a platform table is ' +
    'invisible to it. Its header claimed such a reach was "currently nobody\'s", and that ' +
    'was measured false in the same sweep: this check attributes the four kernel tables ' +
    'to `kernel` off the declaring file\'s platform-relative path and reports reaches into ' +
    'them, which is how this entry exists at all. Both that header and AGENTS.md\'s row ' +
    'were corrected with this reading.\n\n' +
    'Retired by: an accessor that can carry the membership predicate into another query — ' +
    'a channel-scoped id stream the caller can page, or the port answering the type-ahead ' +
    'itself — published on the host and classified in ' +
    '`specs/080-f4-real-scope/contracts/host-package.md` §1. That is a kernel decision ' +
    'about the sanctioned bridge accessors (Constitution XII) and it is the host owner\'s ' +
    'to take, not a call-site rewrite.',
  'admin/src/modules/catalog/CategoriesTree.tsx:price_lists/DisplayModeOverrideRow':
    'Admin surface reach: `catalog/CategoriesTree.tsx` imports `DisplayModeOverrideRow` ' +
    'from `../price_lists/DisplayModeOverrideRow`, which `price_lists` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: the reach mounts the owner\'s own screen fragment inside this module\'s ' +
    'screen, which is the case FR-007 exists for. What retires it is the owner ' +
    'declaring an **admin contribution zone**: the host screen publishes the zone name ' +
    'and the owner contributes into it, so the dependency reverses and neither module ' +
    'names the other. Moving the file, or rewriting the specifier as the owner\'s ' +
    'package subpath, retires nothing — it is the same coupling under a supported name, ' +
    'which is what recording this entry before the move exists to prevent.',
  'admin/src/modules/catalog/ProductAttributesTab.tsx:pim_ergonode/components/FieldProtectionToggle':
    'Admin surface reach: `catalog/ProductAttributesTab.tsx` imports ' +
    '`ErgonodeAttributeValueProtection` from ' +
    '`../pim_ergonode/components/FieldProtectionToggle`, which `pim_ergonode` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: the reach mounts the owner\'s own screen fragment inside this module\'s ' +
    'screen, which is the case FR-007 exists for. What retires it is the owner ' +
    'declaring an **admin contribution zone**: the host screen publishes the zone name ' +
    'and the owner contributes into it, so the dependency reverses and neither module ' +
    'names the other. Moving the file, or rewriting the specifier as the owner\'s ' +
    'package subpath, retires nothing — it is the same coupling under a supported name, ' +
    'which is what recording this entry before the move exists to prevent.',
  'admin/src/modules/catalog/ProductEditor.tsx:sales_channels/components/EntityChannelMembership':
    'Admin surface reach: `catalog/ProductEditor.tsx` imports `EntityChannelMembership` ' +
    'from `../sales_channels/components/EntityChannelMembership`, which ' +
    '`sales_channels` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: the reach mounts the owner\'s own screen fragment inside this module\'s ' +
    'screen, which is the case FR-007 exists for. What retires it is the owner ' +
    'declaring an **admin contribution zone**: the host screen publishes the zone name ' +
    'and the owner contributes into it, so the dependency reverses and neither module ' +
    'names the other. Moving the file, or rewriting the specifier as the owner\'s ' +
    'package subpath, retires nothing — it is the same coupling under a supported name, ' +
    'which is what recording this entry before the move exists to prevent.',
  'admin/src/modules/catalog/ProductEditor.tsx:pim_ergonode/components/FieldProtectionToggle':
    'Admin surface reach: `catalog/ProductEditor.tsx` imports ' +
    '`ErgonodePriceProtectionPanel`, `FieldProtectionSummary`, `FieldProtectionToggle` ' +
    'from `../pim_ergonode/components/FieldProtectionToggle`, which `pim_ergonode` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: the reach mounts the owner\'s own screen fragment inside this module\'s ' +
    'screen, which is the case FR-007 exists for. What retires it is the owner ' +
    'declaring an **admin contribution zone**: the host screen publishes the zone name ' +
    'and the owner contributes into it, so the dependency reverses and neither module ' +
    'names the other. Moving the file, or rewriting the specifier as the owner\'s ' +
    'package subpath, retires nothing — it is the same coupling under a supported name, ' +
    'which is what recording this entry before the move exists to prevent.',
  'admin/src/modules/catalog/ProductEditor.tsx:price_lists/LinkedPriceListsPanel':
    'Admin surface reach: `catalog/ProductEditor.tsx` imports `LinkedPriceListsPanel` ' +
    'from `../price_lists/LinkedPriceListsPanel`, which `price_lists` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: the reach mounts the owner\'s own screen fragment inside this module\'s ' +
    'screen, which is the case FR-007 exists for. What retires it is the owner ' +
    'declaring an **admin contribution zone**: the host screen publishes the zone name ' +
    'and the owner contributes into it, so the dependency reverses and neither module ' +
    'names the other. Moving the file, or rewriting the specifier as the owner\'s ' +
    'package subpath, retires nothing — it is the same coupling under a supported name, ' +
    'which is what recording this entry before the move exists to prevent.',
};
