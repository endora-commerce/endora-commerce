/**
 * `cms`' published component surface — D-191's `./admin-ui` exit, taken for a
 * second time and for a component with an *internal* consumer (feature 091,
 * Phase 4, batch 16; `contracts/admin-component-contribution.md` Z9…Z12).
 *
 * ## What is published, and why it is a component rather than a zone
 *
 * `PageBuilderEditor` is the Puck canvas `cms`' three editors render and that
 * `blog`'s post and category editors render too — the two keys
 * `backend/scripts/ledgers/cross-module-imports/blog.ts` has carried since
 * feature 091's Phase 0. `admin-component-contribution.md` Z1 decides the exit
 * from the **signature** rather than from taste, and this batch re-read it
 * rather than inheriting the shard's answer: the props are
 * `data: Data | null` in and `onChange: (data: Data) => void` back, with
 * `contentKey`, `pageContainer`, `context`, `languages`, `activeLanguage` and
 * four resolver callbacks around them. Value in, value back — Z1 question 1 —
 * so the **consumer** decides that it appears, which is a published component
 * and not something the owner contributes to a place it chose.
 *
 * ## Why not the kit, and why not `@endora-commerce/page-builder-admin`
 *
 * The kit refuses it on R7, exactly as it refused the chrome P5b published: the
 * component is a `@measured/puck` `<Puck>` host, and the kit is what all 66
 * module packages' admin layers compile against, so Puck would sit behind the
 * admin design system for every one of them.
 *
 * The chrome package refuses it on ownership. `@endora-commerce/page-builder-admin`
 * holds the files that name `cms` **nowhere** (D-192, Z1.2); this one names
 * `cms` in three places that are not incidental — it calls `cmsClient` for the
 * extension-component descriptor and for the on-canvas embed preview, it reads
 * `useTranslation('cms')`, and `withCmsPageRoot`/`pageContainer` are the CMS
 * page's own layout. Moving it there would put a module's API client and a
 * module's translation namespace inside the package every builder composes,
 * which is the inversion D-192 refused one hop out.
 *
 * ## Why this file re-exports rather than holding the component
 *
 * `credentials`' `./admin-ui` — the first — keeps its one component's source in
 * this directory, and it can, because that component has exactly one caller and
 * that caller is in another package. This one has **two kinds** of caller:
 * `blog`'s two editors through the subpath, and `cms`' own three editors
 * through a relative import. The component's collaborators are fifteen files
 * under `src/admin/components/` and its `cmsClient` is `src/admin/api/`'s, so
 * moving the source here would either split that cluster across two directories
 * or drag `cms`' own screens' API client into the published layer. Both layers
 * compile in one program and emit into one `dist` (Z9), so the barrel costs
 * nothing and the surface is still exactly what this file lists — which is R2's
 * rule one directory over.
 *
 * ## The reach stays counted (Z11)
 *
 * `check:module-boundary`'s D-171 designation is derived from the artefact — a
 * subpath is contract surface **iff** its emitted module exports no runtime
 * binding — and `dist/admin-ui/index.js` re-exports a React component, so it
 * exports one. `blog`'s two ledger entries are therefore **re-keyed, not
 * retired**: the coupling is real, it now has a supported spelling, and a
 * supported spelling is not an uncounted one. The shard's own retiring
 * condition is unchanged and is not this merge request's — it names D-192's
 * page-builder family growing a home for the whole builder — which is why those
 * two entries survive the move with their reasons intact.
 *
 * ## Presence (Z12), and why the consumer needs no gate of its own
 *
 * A statically imported component is filtered by nothing, and `cms` declares an
 * activation control (`cms.enabled`), so Z12 asks the consumer what happens
 * while the owner is off. `credentials`' answer was a
 * `useSurfaceVisibility()({ module: 'credentials' })` around the button that
 * opens its modal. This one's answer is different and is **derived from the
 * manifests rather than written into a screen**: `blog` declares `cms` in its
 * manifest `dependencies`, and `ModuleGatingGraph`
 * (`packages/platform/src/lifecycle/services/gating-graph.ts`) reads
 * `dependencies` ∪ `acknowledgedDependencies` when deactivating and
 * `dependencies` when activating — so *"`cms` off while `blog` is on"* is a
 * state the platform refuses at the flip, in both directions. A gate in
 * `blog`'s editors would be a second answer to a question the lifecycle has
 * already answered, in a screen, where nothing could see it drift; it would
 * also put a `module-namespace` key in `check:admin-zones`' foreign-id ledger
 * for a branch no operator can reach.
 *
 * Gating here would be the wrong place either way, and for `credentials`'
 * reason: the component cannot know whether its absence should collapse the
 * canvas, the tab or the whole screen.
 *
 * **Un-declare that dependency and this paragraph is false.** `blog`'s manifest
 * is where the answer lives, so a merge request that drops `cms` from it owes
 * this seam a gate.
 */
export { PageBuilderEditor } from '../admin/components/PageBuilderEditor.js';
export type { PageBuilderData } from '../admin/components/PageBuilderEditor.js';
