import { describe, expect, it } from 'vitest';
import type { CatalogAttributeView } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';

import { CatalogBulkImportService } from './catalog-bulk-import.service.js';

/**
 * Feature 172 (FR-041) — the products importer asks the catalogue which keys
 * are Page Builder content attributes, so it can refuse a cell under one.
 */

const view = (key: string, valueType: CatalogAttributeView['valueType']) =>
  ({ key, valueType }) as CatalogAttributeView;

describe('CatalogBulkImportService.contentAttributeKeys', () => {
  it('answers the keys of the page_builder attributes, sorted', async () => {
    const service = new CatalogBulkImportService({} as CommandBus, undefined, undefined, {
      listAll: async () => [
        view('material', 'select'),
        view('warranty', 'page_builder'),
        view('buying_guide', 'page_builder'),
        view('weight', 'number'),
      ],
    });
    expect(await service.contentAttributeKeys()).toEqual(['buying_guide', 'warranty']);
  });

  it('answers [] when there is none', async () => {
    const service = new CatalogBulkImportService({} as CommandBus, undefined, undefined, {
      listAll: async () => [view('material', 'select')],
    });
    expect(await service.contentAttributeKeys()).toEqual([]);
  });

  it('refuses to answer when the attribute read is not wired, rather than answering none', async () => {
    const service = new CatalogBulkImportService({} as CommandBus);
    await expect(service.contentAttributeKeys()).rejects.toThrow(/not wired/);
  });
});
