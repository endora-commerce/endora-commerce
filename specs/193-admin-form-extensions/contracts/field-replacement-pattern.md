# Contract: the field replacement pattern (FR-073, US5, R-15)

A documented recipe, not a mechanism. It becomes a section of
`docs/docs/architecture/admin-form-extensions.md` (and its Polish twin); the example overlay
(`backend/src/apps/example/modules/form_extension_fixture/`, plan WP-G) is its worked example and its
test.

## §1 When to use it

A deployment needs one core field to hold a value of a **different type** than core declares (a
structured value where core has free text; a choice from the deployment's own list where core has a
string). Core's type is a contract that migrations, ports, search, exports and other modules rely on;
changing it per deployment forks that contract (XV). The pattern keeps core's field and adds the
deployment's beside it.

## §2 Steps

1. **New field, own storage.** The overlay module declares a slot field of the wanted type on the
   field set, stored in its own side table (`extends` on the host, 187) or its own D2 column (178). If
   the wanted field is something an operator should define (a select with operator-maintained
   options), use a runtime custom field (D0) instead and skip to step 3.
2. **Write path.** Register `fieldSlotHook({ on: <the field set's writers>, schema, write })`.
3. **Take the core field's place.**
   - *Optional core field*: override `hidden: true` on it; anchor the slot `after: <coreKey>` — it
     renders where the core field was (field-slots §5).
   - *Required core field*: `hidden` is refused. Override `readOnly: true` and add a
     `fieldBehaviours` `derive` that fills it from the new field; anchor the slot `before: <coreKey>`.
4. **Optional projection** (recommended whenever core features read the field — search, exports,
   documents, other modules' ports):
   - the form fills the core field with `project(newValue)` (a `derive`), so one request carries both;
   - the overlay's hook refuses a write where `after[coreKey] !== project(slice.newValue)` with a
     declared code (`<MODULE>_PROJECTION_MISMATCH`, translated), so an API caller writing only one of
     the two is told so, atomically;
   - if the projection cannot be computed client-side, an `afterCommit` handler writes it through the
     owner's command port instead — eventual, its own audit entry; document which one you chose.
5. **Reads.** Consumers that need the new value read it through the host's read port with
   `include: ['extensions.<moduleId>']` (187) or the admin `?extensions=` wire (OQ-193-1 A).

## §3 What you give up

- Core features see only the projection (or the stale core value, without one).
- An import or integration writing the core field directly bypasses the new field unless it sends
  `extensions` too; the projection check (step 4) is what tells it.
- The new field is yours to migrate, export and search.

## §4 Off-state

Switching the overlay module off restores the core field (override absent), hides the slot, stops the
hook and the projection check; the side-table rows stay. Switching it back on restores the
replacement with its data.

## §5 When the answer is a core change instead

If **more than one deployment** needs the wider type, or the projection loses information core
features need, the type changes in core: a new field key (or a versioned contract), through
`specs/conventions/contract-surface.md` (deprecation release, or a ruled break — the owner's #1983
ruling favours making a necessary break early while adoption is low) and the upgrade note. The
pattern is a per-deployment bridge, not a substitute for fixing core.
