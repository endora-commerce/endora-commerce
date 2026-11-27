---
'@endora-commerce/contracts': minor
---

**Admin form extensions: two divergence kinds and the layout vectors** (issue #2006, `specs/193-admin-form-extensions/` WP-D). Additive.

- `DivergenceKind` gains `form-override` (a manifest `formOverrides` entry on another module's field set, keyed `form-override:<module>:<fieldSet>.<field>`) and `form-override-grant` (a deployment's `formOverrideGrants` entry, keyed `form-override-grant:<module>:<fieldSet>`). `DivergenceDetail` gains `{ kind: 'form-override', kinds, presentationOnly }` and `{ kind: 'form-override-grant', packageName }`. A consumer that switches exhaustively over `DivergenceKind` or `DivergenceDetail` needs the two cases.
- `@endora-commerce/contracts/admin-forms.vectors` publishes `FORM_LAYOUT_VECTORS` with the `FormLayoutVector`, `FormLayoutVectorSlot` and `FormLayoutVectorMove` types: the normative cases of the form layout (`field-slots.md` §5), which every implementation of the layout runs, shuffled as well as in order.
