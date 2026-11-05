import type {
  BulkImportReport,
  CatalogAttributeReadPort,
  CatalogBulkImportPort,
  CatalogCategoryReadPort,
  CatalogProductAvailabilityPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  ErrorCode,
  ImportProfile,
  InventoryStockImportPort,
  InventoryStockReadPort,
  OrderReadPort,
  OrganizationDetailsPort,
  OrganizationRoleReadPort,
} from '@endora-commerce/contracts';
import type { SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';

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
  /** Feature 174 — the attribute definitions a products header names (their value type and scope set). */
  readonly catalogAttributes: CatalogAttributeReadPort;
  /** Feature 174 (FR-042) — which channels each imported product belongs to, for the profile's targets. */
  readonly catalogAvailability: CatalogProductAvailabilityPort;
  /** Feature 174 — the channel codes and languages a products header names (a kernel registration). */
  readonly salesChannels: SalesChannelResolutionPort;
  /** The role each account holds, named on the customers sheet (`specs/170-organization-roles/`). */
  readonly organizationRoles: Pick<OrganizationRoleReadPort, 'roleRef'>;
}

/** Feature 174 — what a run hands an adapter besides its records. */
/**
 * What an adapter's import answers: the owner's report, plus — when the report would list more
 * refusals than it may — how many there were (`truncated`; products only, C2/C3 security review).
 */
export interface AdapterImportReport extends BulkImportReport {
  truncated?: { errors: number; fieldErrors: number };
}

export interface ImportRowsOptions {
  /** The run's import profile, snapshotted at run start (products only). */
  readonly profile?: ImportProfile;
  /** Parse, plan and validate; write nothing (`import-profiles-and-csv.md` §2). */
  readonly dryRun?: boolean;
  /** The header row as the file spells it, duplicates included. */
  readonly header?: readonly string[];
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
  /**
   * The code a caller must hold to export this entity: the one the owning
   * module's own list route enforces over the same rows. The centre is not a
   * second door to them, so a role that cannot open the customers list cannot
   * download the customers sheet either.
   */
  exportPermission: string;
  /**
   * The code a caller must hold to import this entity — the owner's write
   * code. Present exactly when {@link importRows} is.
   */
  importPermission?: string;
  /** Header columns emitted on export. */
  exportHeader: readonly string[];
  /** The entity table as CSV-ready rows, read through the owners' ports. */
  exportRows(): Promise<string[][]>;
  /**
   * The whole table, header included, for an entity whose columns depend on the
   * data — the products file's `status@<channel>` columns (feature 163, FR-092).
   * When present the export uses it instead of {@link exportHeader} and
   * {@link exportRows}; `exportHeader` stays the fixed part the screen lists.
   */
  exportTable?(): Promise<{ header: string[]; rows: string[][] }>;
  /**
   * Feature 174 (FR-048) — an import of this entity needs an import profile
   * (`422 IMPORT_PROFILE_REQUIRED` without one).
   */
  requiresProfile?: boolean;
  /** Header columns the import expects. Undefined when import is unsupported. */
  importHeader?: readonly string[];
  /**
   * Header columns the import **refuses**, with the refusal: a column that
   * once carried data the owner no longer accepts from a file (feature 160 —
   * a product's price, which is set in price books). Ignoring it would apply
   * the rest of the row and drop the value without a word.
   */
  refusedHeader?: ReadonlyArray<{ readonly column: string; readonly code: ErrorCode; readonly message: string }>;
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
  importRows?(records: ReadonlyArray<Record<string, string>>, options?: ImportRowsOptions): Promise<AdapterImportReport>;
}
