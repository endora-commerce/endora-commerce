/**
 * `credentials`' published component surface — D-191's `./admin-ui` exit,
 * arriving with its first and only user (feature 091, Phase 4, batch 10;
 * `contracts/admin-component-contribution.md` Z9…Z12, and R9 of
 * `specs/084-small-f4-package-layout/contracts/module-package-layout.md`).
 *
 * ## Why this subpath exists at all, and why the kit was refused
 *
 * `settings`' `ConfigurationReferenceInput` — the editor for the
 * `credential_ref` setting value type — renders this modal when the operator
 * asks to see what a referenced configuration holds. The reach was
 * `backend/scripts/ledgers/cross-module-imports/settings.ts`' only key, and
 * `admin-component-contribution.md` Z1 decides its exit from the **signature**
 * rather than from taste: `(open, configuration, onClose)` is a value in and a
 * value back, which is Z1 question 1, so it is a **published component** and
 * not a zone contribution. A zone has zero-or-many contributors and there is no
 * honest answer for a modal that resolved to two `onClose`s.
 *
 * Z1.1 then asks the kit first, and the kit refuses this one: the modal calls
 * `useTranslation('credentials')`, and R-1's §9.2 ruled that a module's
 * translation namespace **is** module knowledge — the bundle behind it ships in
 * a package `@endora-commerce/admin-kit` does not and may not depend on, is
 * resolved at runtime by string, and a renamed key renders itself into the
 * operator's screen as a label. Every string it shows is this module's
 * vocabulary (*"Configuration preview"*, *"Set (hidden)"*, *"Unavailable —
 * configuration type is no longer registered"*), so the R-1 remedy that
 * retired `AssetPicker`, `AssetUploader` and `CategoryTreePicker` — move the
 * copy to `core` and publish into the kit — would put credential vocabulary in
 * the shared bundle. This is the one reach in the repository that takes the
 * other exit, which is what `admin-component-contribution.md` §1.1 measured
 * over all 69 ledgered admin reaches.
 *
 * ## The reach stays counted (Z11)
 *
 * `check:module-boundary`'s D-171 designation is derived from the artefact — a
 * subpath is contract surface **iff** its emitted module exports no runtime
 * binding — and this one exports a React component. So `settings`' ledger entry
 * is **re-keyed, not retired**: the coupling is real, it now has a supported
 * spelling, and a supported spelling is not an uncounted one. Do not widen that
 * derivation for this subpath and do not add a field to the `endora` block;
 * D-191 refuses both by name.
 *
 * ## Presence (Z12)
 *
 * A statically imported component is filtered by nothing, and `credentials`
 * declares an activation control, so the **consumer** gates the render — see
 * `useSurfaceVisibility()({ module: 'credentials' })` in
 * `packages/modules/settings/src/admin/components/ConfigurationReferenceInput.tsx`.
 * Gating here would be the wrong place: the component cannot know whether its
 * absence should collapse the field or the whole row.
 *
 * **This entry re-exports and declares nothing of its own**, which is `./admin`
 * R2's rule one directory over: the surface is the set of files listed here.
 */
export { ConfigurationPreviewModal } from './ConfigurationPreviewModal.js';
export type { ConfigurationPreviewModalProps } from './ConfigurationPreviewModal.js';
