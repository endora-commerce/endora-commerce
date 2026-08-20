/**
 * `currencies` module contracts — the in-process port surface (feature 075,
 * Phase P).
 *
 * The delivery-side twin of `languages.ts`, and for the same reason:
 * `dictionaries` hosts the admin screen over this table, so the write path
 * crosses a boundary by design. Fifteen import sites, six of them
 * `dictionaries` reading the `Currency` entity to resolve a label or validate
 * a code, four of them `pim_ergonode` mapping an import's price currencies.
 *
 * Plain TypeScript rather than Zod: these describe in-process calls.
 */

/**
 * The EventBus name `currencies` announces on after any write.
 *
 * A **constant, not a port** (FR-013). Whoever caches currency data
 * subscribes; `currencies` must not know who does.
 */
export const CURRENCY_CHANGED_EVENT = 'currencies.changed';

/**
 * A currency as it crosses a module boundary — a plain shape, never the ORM
 * entity (FR-011). The primary key is the ISO code.
 */
export interface CurrencyRecord {
  /** ISO 4217 code. The primary key. */
  code: string;
  label: string;
  symbol: string;
  symbolPosition: 'prefix' | 'suffix';
  decimalPlaces: number;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Container name: `currencyReadPort`. Owner: `currencies`.
 *
 * When `currencies` is off every method fails closed. A price with no currency
 * is not a price, so there is nothing for a caller to degrade to — and
 * defaulting to one would silently reprice a catalogue.
 *
 * Whether `currencies` has an off state at all is its manifest's `activation` to
 * say, not this line's: a module declaring `nonDeactivatable` never enters one.
 */
export interface CurrencyReadPort {
  list(): Promise<CurrencyRecord[]>;
  /** Only `isActive`, ordered by sort order then code. */
  listActive(): Promise<CurrencyRecord[]>;
  /** Exactly one currency is the default; `null` only before the first seed. */
  getDefault(): Promise<CurrencyRecord | null>;
  findByCode(code: string): Promise<CurrencyRecord | null>;
}

export interface CreateCurrencyInput {
  code: string;
  label: string;
  symbol: string;
  symbolPosition?: 'prefix' | 'suffix';
  decimalPlaces?: number;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpsertCurrencyInput {
  code: string;
  label: string;
  symbol: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateCurrencyInput {
  label?: string;
  symbol?: string;
  symbolPosition?: 'prefix' | 'suffix';
  decimalPlaces?: number;
  isActive?: boolean;
  sortOrder?: number;
}

/**
 * Container name: `currencyAdminPort`. Owner: `currencies`.
 *
 * `upsert` is separate from `create` because `pim_ergonode` reaches it during
 * an import: a feed naming a currency the platform does not have should add
 * it, not fail the run. `create` refuses a duplicate, and both refuse to
 * deactivate the default.
 */
export interface CurrencyAdminPort {
  create(input: CreateCurrencyInput): Promise<CurrencyRecord>;
  upsert(input: UpsertCurrencyInput): Promise<CurrencyRecord>;
  update(code: string, input: UpdateCurrencyInput): Promise<CurrencyRecord>;
  setDefault(code: string): Promise<CurrencyRecord>;
  remove(code: string): Promise<void>;
}

/**
 * One currency the platform ships a definition for, as it crosses the boundary
 * into {@link CurrencySeedPort}.
 *
 * The catalogue itself is `dictionaries`' — it exists so that
 * `countries.default_currency_code` is satisfiable on a fresh install — while
 * the table it lands in is this module's. That split is why the seam is a port
 * and not a shared file.
 */
export interface CurrencySeedRow {
  code: string;
  label: string;
  symbol: string;
  symbolPosition?: 'prefix' | 'suffix';
  decimalPlaces?: number;
}

/**
 * Container name: `currencySeedPort`. Owner: `currencies`.
 *
 * The seam `dictionaries`' boot reconciler used to be a raw
 * `insert into "currencies"` — this module's table, written by another module,
 * invisible to every import-level boundary check (D-87).
 *
 * Deliberately **not** `CurrencyAdminPort.create`: 53 rows land on a fresh
 * install, and routing them through the admin write path would record 53 audit
 * entries for something no operator did and flush once per row. Seeding is
 * idempotent by contract — a code that already exists is left exactly as it is,
 * operator edits included.
 */
export interface CurrencySeedPort {
  /** Inserts every row whose `code` is missing. Returns how many it inserted. */
  ensureSeeded(rows: readonly CurrencySeedRow[]): Promise<number>;
}
