---
title: Organization hierarchy
---

# Organization hierarchy

Organizations can be nested into a **tree**: a head-office organization owns
branch organizations, which may own sub-branches. Two things flow along the
tree — **scope** (a roll-up-enabled parent-org user or scoped sales-rep sees the
whole subtree) and **commercial terms** (a descendant with no price of its own
for a product, or no credit limit, resolves the nearest ancestor's).

This is an additive layer over the flat organization model. Every organization
starts as a **root** (no parent), and a flat installation behaves byte-for-byte
as it did before the hierarchy existed.

## The tree

Each organization records a nullable self-referential `parent_id` (NULL ⇒ root)
plus a server-maintained materialized `path` (`/<rootId>/…/<thisId>/`). A single
indexed prefix scan answers "descendants of X" and "ancestors of X" — there is
no per-node walk.

- **Assign / move a parent** — `POST /api/v1/admin/organizations/:id/parent`
  with `{ "parentId": "<uuid>" | null }`. `null` detaches the organization back
  to a root. The move is validated against **cycles** (a node may not become a
  child of its own descendant) and a **maximum depth of 10 levels**, and is
  audited through the Command Bus (`organization.set_parent` / `organization.move`,
  both reversible).
- **Read the subtree** — `GET /api/v1/admin/organizations/:id/subtree` returns
  the descendants (including the node itself) pre-order, each as
  `{ id, name, parentId, depth, status }`.
- **Read the ancestor chain** — `GET /api/v1/admin/organizations/:id/ancestors`
  returns the parent → … → root chain, nearest-first.
- **Deletion is blocked** — an organization with any child cannot be deleted
  (`409 has_children`), backed by the `parent_id … ON DELETE RESTRICT` foreign
  key. Reassign or remove the children first.

Re-parenting is **retroactive**: subtree membership, roll-up visibility, and
term inheritance are always computed against the *current* tree, so after a move
a branch's history becomes visible to the new parent's roll-up users and it
inherits the new parent's terms.

The admin UI exposes a parent picker plus a subtree/ancestor view on the
organization detail page.

## Roll-up scope

Visibility across descendants is **permission-gated** by the
`organizations:rollup` capability ("Act across organization descendants").

- A **scoped sales-rep** holding the capability has each assignment expanded to
  the assigned node's subtree. A descendant that carries its **own** assignment
  overrides the inherited one for its subtree — the **nearest assignment on the
  ancestor chain wins**. Without the capability the rep stays confined to the
  organizations directly assigned to them.
- A branch-only user (no roll-up) sees only their own organization.

Expansion is derived **server-side** and widens the existing tenant-scope guard
(`allowedOrganizationIds`) to exactly the subtree — never a sibling, cousin, or
an ancestor outside the granted node. An out-of-subtree record is
indistinguishable from "does not exist". The three admin read surfaces — orders,
quotes, and customers — read the already-widened scope and need no change of
their own.

## Term inheritance

A descendant with no own commercial term resolves the nearest ancestor's.

### Price books

A price book for organizations names its members on its header. A branch is
priced by the books naming the branch itself **and** by the books naming any of
its ancestors: the pricing engine builds the buyer's organization chain as
`[thisOrg, parent, grandparent, …]` (nearest first) and every book naming a
member of that chain takes part.

Within the price precedence the chain decides **inside a cell**: when the
branch's own book and its head office's book both price a product in the same
cell — both an *organization × product* line, say — the nearer organization
wins, so a **branch override always wins** over the head office's price for the
same kind of line. The cell still comes first: under the default *Contract
first, blanket last* precedence a head office's price for the product beats the
branch's own discount on the product's category, because *organization ×
product* ranks above *organization × category*. A branch with no line in a cell
inherits its head office's line there. Siblings are unaffected by each other's
books. Customer-group books apply through the buyer's one customer group, never
through an ancestor's.

The `price_lists` module's page has the full precedence; the organization's
detail page lists the price books that reach it, including the inherited ones.

### Credit limits

A descendant with no own credit limit transacts against the **nearest
ancestor** that has one. How the ancestor's limit is consumed is a
**per-organization mode**, set only by a platform administrator:

- **`shared_pool`** — every organization in the subtree draws against one shared
  pool on the owning ancestor's row. Concurrent draws serialize on that row, so
  the pool can never be over-spent (no double-spend).
- **`independent_default`** — the inherited amount is each branch's own limit;
  every branch may draw the full inherited amount independently of its siblings.

A branch with its **own** credit limit overrides the inherited one.

#### The credit-inheritance-mode setting

The factory default is the platform-wide Settings value
`organizations.hierarchy.credit_inheritance_mode` (default **`shared_pool`**). A
per-organization override is stored on the organization and set via
`PUT /api/v1/admin/organizations/:id/credit-inheritance-mode` with
`{ "mode": "shared_pool" | "independent_default" | null }` (`null` falls back to
the Settings default). This endpoint is **platform-admin only** — a scoped or
roll-up actor is rejected with `403` — and the change is audited
(`organization.set_credit_mode`).

## Flat-behavior guarantee

For a root organization the subtree is `{itself}`, the pricing organization
chain is `[itself]`, and the credit owner is the organization itself (or none). All
scope, pricing, and credit resolution therefore collapse to the pre-feature
single-organization behavior, byte-for-byte.
