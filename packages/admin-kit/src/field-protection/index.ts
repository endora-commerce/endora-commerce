/**
 * `@endora-commerce/admin-kit/field-protection` — the shared machinery behind
 * "the import may not have this field" (feature 091, P4b;
 * `contracts/admin-component-contribution.md` § P4b).
 *
 * ## Why it is published at all
 *
 * `pim_ergonode` shipped a 540-line control; `pim_pimcore`'s would have been a
 * 559-line near-copy — **61 diff lines** once the vendor name is normalised.
 * Converting them as two packages would have made that duplication *published*,
 * and on a platform carrying both PIMs it would have put two whole
 * implementations of one concept beside every product field. One kit surface,
 * two thin contributors, one control per connected integration.
 *
 * ## Where the R6 line falls
 *
 * Everything here is generic: the per-scope store, the mount de-duplication,
 * the optimistic write and its rollback, the rendering, and the five field
 * paths both integration contracts spell identically. Nothing here names an
 * integration, imports one's client, or branches on an id.
 *
 * What arrives **by prop, from the caller that owns it** is
 * {@link FieldProtectionSource}: the loader, the saver, the translator (its
 * i18n namespace) and its source label, plus the scope key that keeps two
 * integrations' state apart. That is `admin-kit-surface.md` R6 as extended on
 * 2026-08-31 — *the kit may receive behaviour from the caller that owns it* —
 * and it is not P2's rejected "data by prop", because here the prop-supplier
 * **is** the owner and passing behaviour in moves nothing.
 *
 * A separate subpath rather than `./components`, for `./zones`' reason: this
 * one publishes a hook whose lifetime is a module-scoped store, and a consumer
 * naming it in an import line is legible about what it is taking.
 *
 * The barrel is **explicit and holds no `export *`** (R2).
 */
export { FieldProtectionPricePanel } from './FieldProtectionPricePanel.js';
export type { FieldProtectionPricePanelProps } from './FieldProtectionPricePanel.js';
export { FieldProtectionSummary } from './FieldProtectionSummary.js';
export type { FieldProtectionSummaryProps } from './FieldProtectionSummary.js';
export { FieldProtectionToggle } from './FieldProtectionToggle.js';
export type { FieldProtectionToggleProps } from './FieldProtectionToggle.js';
export { controlIdPrefix, describeFieldPath } from './describe-path.js';
export type {
  FieldProtectionEntry,
  FieldProtectionPricePath,
  FieldProtectionSource,
  FieldProtectionView,
  Translate,
} from './types.js';
export { useFieldProtection } from './use-field-protection.js';
export type { FieldProtectionApi } from './use-field-protection.js';
