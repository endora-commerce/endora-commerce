/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/page-builder-admin` (feature 091, P5b; D-192).
 *
 * The shared page-builder chrome moved into a package of the `page-builder`
 * family because it names `cms` nowhere and `cms`, `blog` and `invoices` all
 * render it — `cms` held it only because `cms` was the first builder written
 * (`admin-component-contribution.md` Z1.2). Every existing `./…` and `@/…`
 * specifier in this application arrives here and is forwarded, so `cms`' own
 * screens did not have to be rewritten — the shape P2 and P4c used for the kit.
 *
 * **The forwarding is the identity, not a copy**, which matters more here than
 * for a stateless helper: `ColorPaletteProvider` is a React context and
 * `action-bar-target` is a module-scoped store, so a second copy of either is a
 * `null` context and an action bar that never updates.
 */
export { PageBuilderOverlayBridge } from '@endora-commerce/page-builder-admin';
