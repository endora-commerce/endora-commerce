import type { EntityManager } from '@mikro-orm/postgresql';
import type { QuickOrderImportResponse } from '@b2b/contracts';
import { parseCsvRows } from './import-rows.js';
import { QuickOrderImportPipeline } from './import-pipeline.js';
import { MikroOrmCatalogLookup } from './catalog-lookup.js';

/**
 * QuickOrderCsvImporter — thin CSV adapter over {@link QuickOrderImportPipeline}
 * (feature 039). Parsing lives in `import-rows.ts`; variant resolution,
 * duplicate-merge, and the row cap live in the pipeline. This class preserves
 * the original `import(csv)` entry point used by the shopping_lists wiring.
 */
export class QuickOrderCsvImporter {
  private readonly pipeline: QuickOrderImportPipeline;

  constructor(
    emFactory: () => EntityManager,
    private readonly options: { maxRows?: number } = {},
  ) {
    this.pipeline = new QuickOrderImportPipeline(new MikroOrmCatalogLookup(emFactory));
  }

  async import(csv: string): Promise<QuickOrderImportResponse> {
    return this.pipeline.run(parseCsvRows(csv), this.options);
  }
}
