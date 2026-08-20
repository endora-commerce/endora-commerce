import type {
  BulkImportReport,
  CatalogBulkImportPort,
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  InventoryStockImportPort,
  InventoryStockReadPort,
  OrderReadPort,
  OrganizationDetailsPort,
} from '@b2b/contracts';

/**
 * What an adapter is allowed to reach (feature 075, D-74).
 *
 * Before the cut every adapter took an `EntityManager` and queried four other
 * modules' entity classes with it — and, in the three importing cases, wrote
 * them inside a transaction this module opened. It reaches the same rows
 * through the owners' published ports now, and the three imports hand their rows
 * to the owner and render what comes back.
 *
 * Each entry is a lazily resolved port, so a call arrives at the owner's
 * presence gate rather than at a handle captured while it was still switched on.
 */
export interface ImportExportPorts {
  readonly catalogProducts: CatalogProductReadPort;
  readonly catalogCategories: CatalogCategoryReadPort;
  readonly catalogBulkImport: CatalogBulkImportPort;
  readonly inventoryStock: InventoryStockReadPort;
  readonly inventoryStockImport: InventoryStockImportPort;
  readonly orders: OrderReadPort;
  readonly customerAccounts: CustomerAccountReadPort;
  readonly organizations: OrganizationDetailsPort;
}

export interface ImportExportAdapter {
  /** Stable URL slug, e.g. `products`, `categories`. */
  name: string;
  /**
   * The modules whose rows this entity is. An entity is offered only while
   * **every** one of them is effectively present (Principle XVII rule 5): an
   * operator who switches `inventory` off must not be shown a Stock import, and
   * a POST naming it gets the same 404 an unknown slug gets.
   *
   * Two owners is not a special case — the customers export names an account's
   * organisation, so it needs both modules to answer.
   */
  owners: readonly string[];
  /** Header columns emitted on export. */
  exportHeader: readonly string[];
  /** The entity table as CSV-ready rows, read through the owners' ports. */
  exportRows(): Promise<string[][]>;
  /** Header columns the import expects. Undefined when import is unsupported. */
  importHeader?: readonly string[];
  /**
   * Map the parsed CSV records onto the owner's import port and return its
   * report.
   *
   * The index in the report is 0-based over `records`; turning it into the row
   * number a spreadsheet displays is the service's job, in one place, because
   * the owner has no idea a row came from a file at all.
   *
   * Column-level validation ("invalid is_active: xyz") is raised here, where the
   * CSV vocabulary lives; row-level validation against the stored data
   * ("unknown parent_slug: x") is raised by the owner, where the answer lives.
   * A local failure short-circuits the run before any port is called, which is what
   * keeps all-or-nothing true across the two halves.
   */
  importRows?(records: ReadonlyArray<Record<string, string>>): Promise<BulkImportReport>;
}
