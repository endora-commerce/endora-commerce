/**
 * `languages` module contracts — the in-process port surface (feature 075,
 * Phase P).
 *
 * The module's own HTTP shapes are `dictionary.ts`' business: `dictionaries`
 * serves the admin screen over both this table and `currencies`'. What belongs
 * here is what the other four modules ask of it — sixteen import sites, ten of
 * them `dictionaries` reading the `Language` entity directly to resolve a
 * label, validate a code or walk a fallback chain.
 *
 * Plain TypeScript rather than Zod: these describe in-process calls.
 *
 * Nothing here imports from `backend/src/` (FR-034).
 */

/**
 * The EventBus name `languages` announces on after any write.
 *
 * Published as a **constant, not a port** (FR-013): it is a string, and
 * whoever caches language data subscribes to it. The direction is deliberate
 * and stays — `languages` announces, and it must not know who listens, so
 * there is no manifest dependency in either direction over this name.
 */
export const LANGUAGE_CHANGED_EVENT = 'languages.changed';

/**
 * A language as it crosses a module boundary — a plain shape, never the ORM
 * entity (FR-011). The primary key is `code`, not a uuid; that is the table's
 * own design and consumers key on it.
 */
export interface LanguageRecord {
  /** BCP-47-ish code. The primary key. */
  code: string;
  label: string;
  nativeLabel: string;
  isRtl: boolean;
  /** The language a missing translation falls back to, or `null` for none. */
  fallbackCode: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Container name: `languageReadPort`. Owner: `languages`.
 *
 * `listActive` is six of the sixteen inbound sites on its own — `catalog`
 * resolving a product's locale chain, `product_feeds` deciding which
 * translations to emit, `pim_ergonode` mapping an import's locales,
 * `dictionaries` rendering its admin screen.
 *
 * When `languages` is off every method fails closed. There is no sensible
 * degrade: a storefront that cannot list its languages would have to invent
 * one, and inventing `'en'` is how a Polish shop renders in English.
 *
 * Whether `languages` has an off state at all is its manifest's `activation` to
 * say, not this line's: a module declaring `nonDeactivatable` never enters one.
 */
export interface LanguageReadPort {
  list(): Promise<LanguageRecord[]>;
  /** Only `isActive`, ordered by sort order then code. */
  listActive(): Promise<LanguageRecord[]>;
  /** Exactly one language is the default; `null` only before the first seed. */
  getDefault(): Promise<LanguageRecord | null>;
  findByCode(code: string): Promise<LanguageRecord | null>;
}

export interface CreateLanguageInput {
  code: string;
  label: string;
  nativeLabel: string;
  isRtl?: boolean;
  fallbackCode?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateLanguageInput {
  label?: string;
  nativeLabel?: string;
  isRtl?: boolean;
  fallbackCode?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

/**
 * Container name: `languageAdminPort`. Owner: `languages`.
 *
 * `dictionaries` hosts the admin screen for this table — the module that owns
 * the rows does not own the surface — so the write side crosses a boundary as
 * a matter of design rather than of accident.
 *
 * The invariants stay on this side: exactly one default, a default may not be
 * deactivated, and a fallback chain may not cycle. A caller cannot be trusted
 * with them, and two of the three were already enforced here.
 */
export interface LanguageAdminPort {
  create(input: CreateLanguageInput): Promise<LanguageRecord>;
  update(code: string, input: UpdateLanguageInput): Promise<LanguageRecord>;
  setDefault(code: string): Promise<LanguageRecord>;
  remove(code: string): Promise<void>;
}

/**
 * One row of the language catalogue as it crosses into `languages`.
 *
 * `dictionaries` ships the catalogue — every ISO 639-1 language, with the
 * countries that use it — and this module owns the table the rows land in, so
 * the shape is declared here, beside the port that takes it, exactly as
 * `CurrencySeedRow` is declared beside `CurrencySeedPort`.
 *
 * There is deliberately **no `isActive`**. A seeded language is one an operator
 * *may* switch on, never one the platform serves: `listActive` feeds the
 * storefront's language list, the catalogue's translation chains and the product
 * feeds, and a caller able to seed an active row could add a storefront language
 * by shipping a data file.
 */
export interface LanguageSeedRow {
  /** ISO 639-1 code, or any tag the table's `code` column accepts. */
  code: string;
  /** English name. */
  label: string;
  /** The language's name in itself. */
  nativeLabel: string;
  isRtl?: boolean;
  sortOrder?: number;
}

/**
 * Container name: `languageSeedPort`. Owner: `languages`.
 *
 * The seam `dictionaries`' boot reconciler used to be a raw
 * `update "languages" set "native_label" = …` — this module's table, written by
 * another module (D-87).
 *
 * Two writes, both insert-or-fill and neither an update of anything an operator
 * can have set: `ensureSeeded` inserts the catalogue rows whose code is missing,
 * and `backfillNativeLabels` fills the empty `native_label` that migration 038
 * left behind, **once**. A row that already exists is never touched by either,
 * so a re-run is a no-op rather than a revert.
 *
 * Deliberately **not** `LanguageAdminPort.create`, for `CurrencySeedPort`'s
 * reason: 183 rows land on the first boot after an upgrade, and routing them
 * through the admin write path would record 183 audit entries for something no
 * operator did.
 */
export interface LanguageSeedPort {
  /**
   * Inserts every row whose `code` is missing, **inactive and not default**.
   * Returns how many it inserted.
   */
  ensureSeeded(rows: readonly LanguageSeedRow[]): Promise<number>;
  /**
   * Sets `nativeLabel` on every listed code that still holds the empty string.
   * Returns how many rows it filled.
   */
  backfillNativeLabels(
    rows: readonly { code: string; nativeLabel: string }[],
  ): Promise<number>;
}
