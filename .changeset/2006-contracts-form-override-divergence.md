---
'@endora-commerce/contracts': minor
---

**Admin form extensions: two divergence kinds, the form layout and its vectors** (issue #2006, `specs/193-admin-form-extensions/` WP-D). Additive.

- `DivergenceKind` gains `form-override` (a manifest `formOverrides` entry on another module's field set, keyed `form-override:<module>:<fieldSet>.<field>`) and `form-override-grant` (a deployment's `formOverrideGrants` entry, keyed `form-override-grant:<module>:<fieldSet>`). `DivergenceDetail` gains `{ kind: 'form-override', kinds, presentationOnly }` and `{ kind: 'form-override-grant', packageName }`. A consumer that switches exhaustively over `DivergenceKind` or `DivergenceDetail` needs the two cases.
- `@endora-commerce/contracts/admin-forms.vectors` publishes `FORM_LAYOUT_VECTORS` with the `FormLayoutVector`, `FormLayoutVectorSlot` and `FormLayoutVectorMove` types: the normative cases of the form layout (`field-slots.md` §5), which every implementation of the layout runs, shuffled as well as in order.
- `formLayout`, the one implementation of the form layout (`field-slots.md` §5, ruling D-300.14), with `FormLayoutInput`, `FormLayoutItem`, `FormLayoutSection`, `FormLayoutSectionKeys`, `FormLayoutSlot` and `FormLayoutMove`. Its first step is exported on its own as `applyFieldMoves(sections, moves)`. Every comparison is by code point, never by locale, so every process orders a form the same way. The CLI check, the platform's effective forms and the admin kit all call it. `FormLayoutVectorSlot` and `FormLayoutVectorMove` are now aliases of the two layout types.
- `inputControlIdRe` accepts a `_`-prefixed module id (`_lifecycle.x`), as `moduleIdRe` does (D-300.16, issue #2020).
- `formOverrideGrants[].reason` is capped at 280 characters, the same as `FieldOverride.reason` (D-300.16). No release has shipped the field uncapped.
