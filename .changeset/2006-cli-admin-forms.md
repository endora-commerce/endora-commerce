---
'@endora-commerce/cli': minor
---

**Admin form extensions: the `admin-forms` analysis** (issue #2006, `specs/193-admin-form-extensions/` WP-D).

- `endora generate` judges the admin forms of the installed packages and of each deployment under `apps/`: field slots, admin forms and input controls (`field-slots.md` §6). It refuses `unknown-field-set`, `unknown-form`, `unknown-anchor`, `foreign-slot-anchor`, `position-anchor-mismatch`, `duplicate-slot-key`, `slot-owner-not-a-dependency`, `required-not-fillable`, `undeclared-form`, `unrendered-form`, `control-without-declaration`, `declaration-without-control`, and any slot, control or rendered form it cannot read as literals. It warns on `ambiguous-slot-order` and `deprecated-anchor`. As with the divergence report, every artefact is written first and the run exits 1 after a refusal. Warnings refuse nothing. An installed package's own forms are not reported as unrendered: its host screens shipped in its release.
- `required-not-fillable` (ruling D-300.12) refuses a `readOnly` override on a create form. It applies to a field required by core or by a tightened `required: true`, when no `fieldBehaviours` entry of the same module derives the field on that form.
- `duplicate-slot-key` also fires when one key is declared on disjoint forms with a different `type` or `writePermission` (D-300.15). An `unknown-anchor` cycle names every slot in it, and a field-family member counts as shown where the form shows the family.
- The analysis is published as `@endora-commerce/cli/lib/admin-forms.js`. It re-exports `formLayout` and `applyFieldMoves` from `@endora-commerce/contracts`, where the layout lives (D-300.14).
- The divergence report records `form-override` and `form-override-grant` entries, and names slot fields as the module's own surface (`notRecorded`). A `form-override` entry asks the deployment for a reason in `reasons`. A grant carries its own reason. An override is `computed-subject` when its target is not a literal. An instance report shows a field set's owner as a composition root's, and its boundary notes say so.
- The CLI now reads `formOverrideGrants` from `apps/<deployment>/divergence.ts`. Before this release it dropped them silently (issue #2020).
- `endora check`'s estate gains `check:admin-forms` (package scope, pending with the admin phase).
