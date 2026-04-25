import type { EntityManager } from '@mikro-orm/postgresql';

export interface ImportRowResult {
  /** True if the row was applied. False reports a per-row reason in `reason`. */
  ok: boolean;
  reason?: string;
}

export interface ImportExportAdapter {
  /** Stable URL slug, e.g. `products`, `categories`. */
  name: string;
  /** Header columns emitted on export. */
  exportHeader: readonly string[];
  /** Streams the entity table into CSV-ready rows. */
  exportRows(em: EntityManager): Promise<string[][]>;
  /** Header columns the import expects. Undefined when import is unsupported. */
  importHeader?: readonly string[];
  /** Apply a single CSV row inside the caller's transaction. */
  importRow?(
    em: EntityManager,
    row: Record<string, string>,
  ): Promise<ImportRowResult>;
}
