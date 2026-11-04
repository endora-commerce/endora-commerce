import { ERROR_CODES, type BulkImportReport, type ImportExportEntity, type ImportProfile } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { parseCsv, rowsToRecords, serializeCsv } from './csv-codec.js';
import type { AdapterImportReport, ImportExportAdapter, ImportExportPorts } from './adapter.js';
import { productsAdapter } from './adapters/products.adapter.js';
import { ProductsFileError } from './adapters/products-csv-grammar.js';
import { categoriesAdapter } from './adapters/categories.adapter.js';
import { stockAdapter } from './adapters/stock.adapter.js';
import { customersAdapter } from './adapters/customers.adapter.js';
import { ordersAdapter } from './adapters/orders.adapter.js';

/**
 * ImportExportService — adapter dispatcher.
 *
 * Each entity has a single source of truth (the adapter), keeping the
 * route layer free of per-entity branches.
 *
 * **What this module owns after D-74**: the CSV codec, the header validation,
 * the row numbering, the 400/404/405 envelope and the entity registry. What it
 * no longer owns is the write — a catalogue import is `catalog`'s transaction
 * and a stock import is `inventory`'s, because every row of either lands in one
 * owner's tables. All-or-nothing did not move with it: the owner applies a run
 * whole or applies none of it, and a column this module rejects stops the run
 * before the owner is asked at all.
 *
 * **Presence is decided per entity** (Principle XVII rule 5). The entity list
 * used to be a literal in the admin SPA, so an operator who switched `inventory`
 * off was still offered a Stock import. It is derived from the effective state
 * here, which is also what makes the module's five `degrades-without`
 * declarations true instead of decorative.
 */

export interface ImportReport {
  imported: number;
  errors: Array<{ rowNumber: number; reason: string }>;
  /** Feature 172 (`import-profiles-and-csv.md` §2.3) — products imports only. */
  dryRun?: boolean;
  cellCounts?: BulkImportReport['cellCounts'];
  warnings?: BulkImportReport['warnings'];
  fieldErrors?: Array<{ rowNumber: number; column: string; code: string }>;
  /** Present when the lists were cut at their cap: how many row and field errors there were in all. */
  truncated?: { errors: number; fieldErrors: number };
}

/** Feature 172 — how a products run is asked for (`POST …/import/products?profileId=&dryRun=`). */
export interface ImportRunOptions {
  readonly profileId?: string | undefined;
  readonly dryRun?: boolean | undefined;
  /** The run's profile, read once (snapshot); answers `404 IMPORT_PROFILE_NOT_FOUND` for an unknown id. */
  readonly loadProfile?: (id: string) => Promise<ImportProfile>;
}

export class ImportExportService {
  private readonly adapters: readonly ImportExportAdapter[];

  constructor(ports: ImportExportPorts) {
    this.adapters = [
      productsAdapter(ports),
      categoriesAdapter(ports),
      stockAdapter(ports),
      customersAdapter(ports),
      ordersAdapter(ports),
    ];
  }

  /**
   * The entities this deployment can offer right now **to this caller**: the
   * ones whose every owner is effectively present, and of those the ones the
   * caller may export or import. Read per call rather than cached, because an
   * operator flips a module — or a role — while the process is running.
   *
   * `holds` answers whether the caller holds one permission code. The route
   * passes the same guard it gates the export and import routes with, so the
   * list and the routes cannot disagree about what the caller may use.
   */
  async listEntities(holds: (code: string) => Promise<boolean>): Promise<ImportExportEntity[]> {
    const entities: ImportExportEntity[] = [];
    for (const adapter of this.available()) {
      const canExport = await holds(adapter.exportPermission);
      const canImport =
        adapter.importPermission !== undefined && adapter.importRows !== undefined
          ? await holds(adapter.importPermission)
          : false;
      if (!canExport && !canImport) continue;
      entities.push({
        name: adapter.name,
        exportHeader: [...adapter.exportHeader],
        importHeader: adapter.importHeader ? [...adapter.importHeader] : null,
        canExport,
        canImport,
      });
    }
    return entities;
  }

  /**
   * The code a caller must hold to export `entity`, or `undefined` when this
   * deployment does not offer it (unknown slug, or an owner switched off) — the
   * route then gates on any import/export code and the handler answers 404.
   */
  exportPermissionFor(entity: string): string | undefined {
    return this.available().find((adapter) => adapter.name === entity)?.exportPermission;
  }

  /**
   * The code a caller must hold to import `entity`. An export-only entity
   * answers its export code, so a caller who may not read the rows is refused
   * with 403 rather than told by a 405 how the entity behaves.
   */
  importPermissionFor(entity: string): string | undefined {
    const adapter = this.available().find((candidate) => candidate.name === entity);
    return adapter ? (adapter.importPermission ?? adapter.exportPermission) : undefined;
  }

  /**
   * Every code some entity is gated by, whatever is present — the any-of set a
   * caller must hold one of to use the centre at all.
   */
  permissionCodes(): string[] {
    const codes = new Set<string>();
    for (const adapter of this.adapters) {
      codes.add(adapter.exportPermission);
      if (adapter.importPermission !== undefined) codes.add(adapter.importPermission);
    }
    return [...codes].sort();
  }

  async exportToCsv(entity: string): Promise<string> {
    const adapter = this.adapterFor(entity);
    // An adapter whose columns depend on the data (feature 163 — one scoped-status
    // column per sales channel and language) answers the whole table.
    if (adapter.exportTable) {
      const table = await adapter.exportTable();
      return serializeCsv([table.header, ...table.rows]);
    }
    const rows = await adapter.exportRows();
    return serializeCsv([Array.from(adapter.exportHeader), ...rows]);
  }

  /**
   * Apply a CSV file. Either every row lands or none — the owner runs the whole
   * batch in one transaction. Per-row validation errors are collected and
   * returned; the presence of any error means nothing was applied, so the
   * operator can fix the spreadsheet and re-upload deterministically.
   */
  async importFromCsv(entity: string, csv: string, options: ImportRunOptions = {}): Promise<ImportReport> {
    const adapter = this.adapterFor(entity);
    if (!adapter.importHeader || !adapter.importRows) {
      throw new HttpError(
        405,
        ERROR_CODES.VALIDATION_FAILED,
        `Import is not supported for "${entity}".`,
      );
    }

    let parsed: string[][];
    try {
      parsed = parseCsv(csv);
    } catch (err) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        err instanceof Error ? err.message : 'Failed to parse CSV.',
      );
    }
    if (parsed.length === 0) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'CSV is empty.');
    }
    const rawHeader = parsed[0]!.map((h) => h.trim());
    for (const required of adapter.importHeader) {
      if (!rawHeader.includes(required)) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Missing required header column: ${required}`,
        );
      }
    }

    for (const refused of adapter.refusedHeader ?? []) {
      if (rawHeader.includes(refused.column)) {
        throw new HttpError(400, refused.code, refused.message, [
          { path: refused.column, issue: 'this column is not accepted' },
        ]);
      }
    }

    // Feature 172 (FR-048) — the profile is required for products and snapshotted at run start:
    // an edit while the run goes has no effect on it.
    let profile: ImportProfile | undefined;
    if (adapter.requiresProfile === true) {
      if (options.profileId === undefined) {
        throw new HttpError(422, ERROR_CODES.IMPORT_PROFILE_REQUIRED, 'Choose an import profile for a products import.');
      }
      if (options.loadProfile === undefined) throw new Error('A products import needs the profile reader.');
      profile = structuredClone(await options.loadProfile(options.profileId));
      if (profile.entity !== entity) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, `The profile is not a ${entity} profile.`, [
          { path: 'profileId', issue: `the profile's entity is ${profile.entity}` },
        ]);
      }
    }

    let report: AdapterImportReport;
    try {
      report = await adapter.importRows(rowsToRecords(parsed), {
        ...(profile ? { profile } : {}),
        dryRun: options.dryRun === true,
        header: rawHeader,
      });
    } catch (err) {
      if (err instanceof ProductsFileError) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          err.message,
          err.fileErrors.map((issue) => ({ path: 'header', issue })),
        );
      }
      throw err;
    }
    return {
      imported: report.imported,
      ...(options.dryRun === true ? { dryRun: true } : {}),
      ...(report.cellCounts ? { cellCounts: report.cellCounts } : {}),
      ...(report.warnings ? { warnings: report.warnings } : {}),
      ...(report.truncated ? { truncated: report.truncated } : {}),
      ...(report.fieldErrors
        ? {
            fieldErrors: report.fieldErrors.map((error) => ({
              rowNumber: error.index + 2,
              column: error.column,
              code: error.code,
            })),
          }
        : {}),
      // Row numbers are 1-based and exclude the header line, matching what
      // spreadsheet apps display. The owner counts rows from 0 and knows
      // nothing about a header line, so the translation happens here.
      errors: report.errors.map((error) => ({
        rowNumber: error.index + 2,
        reason: error.reason,
      })),
    };
  }

  exportHeaderFor(entity: string): readonly string[] {
    return this.adapterFor(entity).exportHeader;
  }

  importHeaderFor(entity: string): readonly string[] | undefined {
    return this.adapterFor(entity).importHeader;
  }

  private available(): readonly ImportExportAdapter[] {
    return this.adapters.filter((adapter) =>
      adapter.owners.every((owner) => effectiveState.isPresent(owner)),
    );
  }

  private adapterFor(entity: string): ImportExportAdapter {
    const available = this.available();
    const adapter = available.find((candidate) => candidate.name === entity);
    if (!adapter) {
      // Same 404 an unknown slug has always produced, and deliberately so: an
      // entity whose owner an operator switched off is an entity this
      // deployment does not have, not one that is broken.
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Unknown import/export entity "${entity}". Supported: ${available
          .map((candidate) => candidate.name)
          .join(', ')}.`,
      );
    }
    return adapter;
  }
}
