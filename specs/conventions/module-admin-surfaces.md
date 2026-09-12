# Admin surfaces a module owns — permissions and the command palette

**Open this before adding or changing an admin permission code, a route gated by
`requireAdmin(...)`, a command-palette action or an AppShell nav entry.** One of the bodies
`AGENTS.md` routes to; it is the single home for these rules, so never restate them in
`AGENTS.md` or in a tool-specific pointer file.

## Admin permissions

Every module with routes gated by `requireAdmin(...)` **must** register its permission codes
so they appear on `/admin-roles` and pass the CI inventory.

1. **`manifest.ts`** — `permissions: [{ code, label, module?, requires? }]` for every code this
   module owns. `requires` is **advisory** (D-175, feature 080 T057): the codes a role holding
   this one also needs before the surface it opens is whole. Nothing reads it at runtime, no
   upsert is refused, and it is **not** a lifecycle edge — it puts no module in your
   `dependencies` and does not stand in the way of an operator switching that owner off. The
   role editor renders the shortfall for the codes currently ticked, with a one-click add.
   **Do not write a fact the platform already derives.** *A module enforcing a code another
   module owns* is a different question, it is derived from the gates and the manifests
   (`backend/test/helpers/foreign-gates.ts`, D-173), and declaring it here as well would be two
   answers to one question waiting to disagree — the shape D-100 is about. `requires` carries
   what nothing here can work out: a coupling running from an admin screen's own fetches to
   another module's route, plus the judgement of whether a role without the second code is
   broken or merely degraded in a way somebody accepted. Measured before the field was added:
   of 705 `apiClient` call sites in module-owned admin layers, 82 name their path as a plain
   literal, and 299 of the 689 admin route registrations bind their `preHandler` to a variable —
   so even the derivable half would be a heuristic over a minority of the sites, and the
   judgement is not derivable at all.
2. **`manifest-index.generated.ts`** — **generated** (feature 072): a module that ships a
   lifecycle-shape `manifest.ts` is picked up by the tree walk. Run
   `pnpm --filter backend run composer:generate` and commit the result; never edit the file.
   It is the only generated manifest registry (feature 071, F2) — `registered-manifests.ts`
   derives `REGISTERED_MANIFESTS` from it, and the deployment-resolved set on top of that.
3. **Routes** — `requireAdmin('…')` literals must match manifest `code` values exactly.
   The inventory scanner reads the call in every shape the tree writes it (bare,
   through `deps.`/a cradle, optional-call, `requireAdminAny([…])`, a constant or a
   permission-map member, and a `hasPermission` capability check), and **fails on an
   argument it cannot resolve** rather than skipping it. Write the code as a literal or
   a resolvable constant; do not compute it.
4. **i18n** — `adminRoles.permission.<code>` in **your own module's** `i18n/en.json` and
   `i18n/pl.json`, flat, in both shipped languages
   (`specs/091-module-owned-admin-surfaces/`, Phase 3). This item said `_i18n/i18n/{en,pl}.json`
   until 2026-08-30, and that instruction cannot be followed by a module installed from a
   registry: `_i18n`'s bundle is a file in this repository. The **89** labels still in it are
   the legacy block, a per-owner two-way ratchet in
   `backend/test/helpers/permission-labels.ts` — a label added there fails, and a number left
   standing after that owner's labels moved fails too. Never raise one to make the build pass;
   an owner retires by having its entry deleted, and when the last one goes the block goes with
   it. Whether the resolution reaches your bundle is not a matter of taste either: it did not
   until Phase 3, so `mfa`, `pwa`, `stripe` and `prompt_actions` each shipped their labels in
   their own bundle *and* in `_i18n`'s and only the second copy ever rendered — the screen
   looked the key up in the synthetic `core` namespace alone. It now resolves over the merged
   bundle (`admin/src/modules/admin_users/permission-label.ts`), so one home is enough and two
   is a duplicate.
5. **AppShell** — `requiredPermission` on nav entries where applicable.
6. **CI** — `pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts`
   before opening the MR. It sweeps **both** directions — enforced ⇒ grantable and
   grantable ⇒ enforced — plus the label coverage, so a permission declared before its
   gate lands fails just as loudly as one gated before it is declared. The label half is the
   file's second `describe` and answers item 4's rule rather than a second question of its own:
   `missing-label` and `split-label` (a label in one shipped language and not the other),
   `foreign-label` (a module labelling a code its manifest does not declare),
   `orphan-legacy-label`, and the ratchet. It discloses what it read in the estate's grammar —
   `[permission-labels] read: files=… sites=… sources=manifest-index:…` — with the generated
   manifest index as the independent author, so a module tree that moved refuses instead of
   reporting clean over the modules it can still find (issues #244 and #215). It carries the
   ratchet rather than a new `check-*` script because it is already the instrument that answers
   "does this code have a label", and two derivations of one population are two answers waiting
   to disagree. The file's **third** `describe` is item 1's `requires`, on the same reasoning
   and with the same disclosure (`[permission-dependencies] read: …`): the machine owns exactly
   one half of that field — that a requirement names a code the platform's **vocabulary** holds,
   `listKnownCodes()` and deliberately not the grantable set, so a requirement on a
   switched-off module's code is not a finding — because a typo, or a code its owner renamed,
   would otherwise advise an operator forever to grant something that does not exist. The rule
   and its red proofs are `backend/test/helpers/permission-dependencies.ts` and
   `backend/test/unit/admin_roles/permission-dependencies.test.ts`.

Do not duplicate shared codes from core `PERMISSION_CATALOGUE`
(`packages/contracts/src/admin.ts`). Contract:
`specs/026-admin-roles-permissions/contracts/module-manifest-permissions.md`.

**A code has three notions attached to it and they are not one thing** — `module`, a display
grouping that need not be a module id at all; `owners`, the set whose presence keeps the code
grantable; and the **vocabulary versus grantable** split. Until D-175's T058 only the first was
visible anywhere, which is why a reader seeing `module: 'quote_requests'` on `rfqs:handle`
reasonably concluded there was one owner and D-173 is the proof that a careful reader got it
wrong. All three are written down **once**, in `docs/docs/architecture/permissions.md`; `owners`
is now on the wire on `GET /api/v1/admin/permissions` and rendered on `/admin-roles` wherever it
says something the grouping does not.

## Command palette (Principle XVI)

Every module with an admin surface **must** be discoverable under ⌘K / CTRL+K. Sidebar-only
is not enough.

1. **`manifest.ts`** — `actions: [{ id, labelKey, descriptionKey, icon, targetRoute,
   requiredPermission, keywords, weight }]` for the module's landing surface plus its few
   highest-value operator actions. Curate — this is a discovery surface, not a route dump.
2. **`requiredPermission`** — the code gating the target surface, so the palette never
   advertises a 403.
3. **i18n** — `labelKey` / `descriptionKey` are **relative to the module namespace**
   (`actions.openX.label`, not `<module>.actions.openX.label`) and live in the module's own
   `i18n/en.json` + `pl.json`. Those files must be a **flat** `{"a.b.c": "text"}` map — a
   nested object fails `TranslationBundleEntriesSchema`, the boot reconciler only logs and
   skips it, and the palette silently renders raw keys.
4. **`icon`** — must be in `KnownIconNameSchema` (`packages/contracts/src/admin-actions.ts`);
   adding a name there requires the matching entry in
   `admin/src/lib/admin-actions/icon-map.ts` in the same MR.
5. **`targetRoute`** — a real admin route (no query string; the route regex rejects one).
   Deep-link actions need an actual route, e.g. `/credentials/new`.
6. **CI** — `pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts`
   verifies that every registered module's on-disk bundles load and that every manifest action
   key resolves in every shipped language. `pnpm --filter backend run check:action-route-permissions`
   verifies item 2 itself: that the declared code is the one enforced on **this action's**
   `targetRoute` and not merely a code enforced somewhere. The permission inventory's two
   directions cannot see that — both codes in issue #232 were real, declared and enforced —
   so a valid code on the wrong route was invisible until this check existed.

