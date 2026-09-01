---
'@endora-commerce/admin-kit': patch
---

`CustomFieldValuesPanel` now tells a failed definitions load apart from an entity type
with no custom fields.

The `defs.length === 0` early return sat **above** the error `Alert`, so both cases
rendered nothing: a broken `GET /api/v1/admin/custom-fields/definitions` was
indistinguishable from "no custom fields are defined for this entity type", and an
operator had no way to know a retry was worth anything. This is the defect the panel's
publication (`admin-kit@minor`, "One defect travels with it, deliberately unfixed")
recorded rather than repaired, so that the move stayed reviewable.

The empty return is now conditional on the load having answered:

```diff
-if (defs.length === 0) return null;
+if (defs.length === 0 && error === null) return null;
```

An empty entity type still renders nothing — that behaviour is unchanged, and is asserted
beside the repair. A failed load renders the card with the error `Alert` and **no save
button**: there is nothing to edit and nothing to write. A read that succeeds also clears
a previous entity type's failure, which it did not need to before, `error` now being what
decides the empty branch.

**The 503 case the old ordering was argued to be accidentally right for does not exist.**
`custom_fields` declares `activation.nonDeactivatable`, which since issue #258 makes it a
module the composition is required to have: `composeModules` refuses a composition that
would reach its boot phase without it, and D-69 refuses every disable and every uninstall.
A platform that cannot serve this endpoint does not boot, so `MODULE_DISABLED` is
unreachable here and the repair needed two branches rather than three.

No prop, no export and no translation key changes.
