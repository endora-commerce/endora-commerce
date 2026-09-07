/**
 * The shapes the field-protection surface renders, and the descriptor the
 * integration that owns them supplies (feature 091, P4b).
 *
 * **Nothing here names an integration.** The view below is the intersection of
 * `ErgonodeProductProtectionsDto` and `PimcoreProductProtectionsDto` — the
 * fields both contracts already carry, with the two Pimcore-only ones
 * (`pimcoreId`, `connector`) deliberately absent, because a field only one
 * provider has is a field this surface would have to branch on. Neither DTO is
 * imported: a structural view is what lets a third provider arrive without this
 * package learning its name, and both DTOs are assignable to it as they stand.
 *
 * `sourceKind` is a `string | null` rather than either provider's enum for the
 * same reason. It is rendered through the caller's own translator, under the
 * caller's own key, so the vocabulary stays where the vocabulary is defined:
 * Ergonode ships three structural kinds and Pimcore six, and neither set is
 * this package's to enumerate.
 */
import type { Translate } from '../lib/invoice-email-outcome.js';

/**
 * The kit's one name for a scope-bound translator, re-exported rather than
 * re-declared (R5): `./lib` already publishes it, and a second name for one
 * type is the second answer to one question a design system exists to prevent.
 */
export type { Translate };

/**
 * One protected field of one record.
 *
 * `languageCode: null` protects the whole field; a value protects one language
 * and leaves the others synchronising.
 */
export interface FieldProtectionEntry {
  readonly fieldPath: string;
  readonly languageCode: string | null;
}

/** One price the integration could write here, named so an operator recognises it. */
export interface FieldProtectionPricePath {
  /** The ready-made `price.<priceListId>.<currencyCode>` the write expects. */
  readonly fieldPath: string;
  readonly priceListId: string;
  readonly priceListName: string;
  readonly currencyCode: string;
}

/** What one integration says about one record's protections. */
export interface FieldProtectionView {
  /** False hides every control: this installation has no such concept. */
  readonly connectionEnabled: boolean;
  readonly integrationManaged: boolean;
  readonly lastSyncedAt: string | null;
  /** The integration's own word for how it models this record, or `null`. */
  readonly sourceKind: string | null;
  readonly variantCount: number;
  readonly livePricePaths: readonly FieldProtectionPricePath[];
  readonly protections: readonly FieldProtectionEntry[];
}

/**
 * Everything one integration hands this surface — the whole of R6's amendment
 * in one object.
 *
 * `admin-kit-surface.md` R6, as extended on 2026-08-31: *a kit component may
 * receive behaviour — a loader, a saver, a namespace — as a prop from the
 * caller that owns it*, because where the caller **is** the owner, passing
 * behaviour in moves nothing. Every field below is one of those, and there is
 * no path, no id and no branch anywhere in this directory.
 */
export interface FieldProtectionSource {
  /**
   * The identity of *this integration's* protections for *this record*.
   *
   * It keys the store, so two integrations mounted on one product each get
   * their own state and their own single request; and it prefixes the controls'
   * DOM ids, so two checkboxes for one field carry distinct `id`/`htmlFor`
   * pairs. One value for both because they answer one question — "whose control
   * is this, on what" — and two would be two chances to make them disagree.
   */
  readonly scopeKey: string;
  /**
   * What the operator calls the integration: `Ergonode`, `Pimcore`.
   *
   * It is rendered beside every control, and it is why the duplication P4b
   * removes was a *product* defect and not only a code one: with two
   * integrations connected this surface renders two controls per field, and an
   * operator has to be able to tell which import each one holds off.
   */
  readonly sourceLabel: string;
  /** The owner's scope-bound translator — its namespace, by prop (R6). */
  readonly t: Translate;
  /** Read this record's protections. Rejecting means "nothing to offer here". */
  readonly load: () => Promise<FieldProtectionView>;
  /** Replace the whole set, declaratively, and answer with the new state. */
  readonly save: (protections: readonly FieldProtectionEntry[]) => Promise<FieldProtectionView>;
}
