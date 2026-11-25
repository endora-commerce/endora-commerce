import { describe, expect, it } from 'vitest';
import {
  CORE_BLOCK_NAMES,
  DOCUMENT_TEMPLATE_LIMITS,
  createDocumentTemplateBodySchema,
  deleteDocumentTemplateBodySchema,
  documentBuilderConfigSchema,
  documentRootPropsSchema,
  documentTemplateContentSchema,
  documentTemplateDetailSchema,
  documentTemplateSummarySchema,
  documentTemplateTreeSchema,
  documentTypeCodeSchema,
  documentTypeDetailSchema,
  documentTypeSummarySchema,
  mergeFieldKeyRe,
  previewDocumentBodySchema,
  renameDocumentTemplateBodySchema,
  saveDocumentTemplateContentBodySchema,
  documentSelectionSchema,
  documentCoreBlocksSchema,
  versionedBodySchema,
  COLLECTION_BLOCK_NAMES,
  documentFieldPathRe,
  documentTemplateChoicesSchema,
  isReservedFieldPath,
  documentFieldDefinitionSchema,
  itemsTablePropsSchema,
  itemsTableGroupingSchema,
  itemsTableGroupingMode,
  documentItemSectionSchema,
  isValidSectionPartition,
  documentSectionTexts,
  type DocumentItemSection,
} from './document-templates.js';
import { ERROR_CODES } from './errors.js';

const tree = (content: unknown[] = [], rootProps: Record<string, unknown> = {}) => ({
  root: { props: rootProps },
  content,
});
const node = (type: string, props: Record<string, unknown> = {}) => ({ type, props: { id: 'x', ...props } });
const envelope = (languages: Record<string, unknown>) => ({ schemaVersion: 1, languages });

describe('document type code', () => {
  it('accepts <module>.<snake_name>', () => {
    expect(documentTypeCodeSchema.safeParse('comparisons.comparison').success).toBe(true);
    expect(documentTypeCodeSchema.safeParse('invoices.invoice').success).toBe(true);
    expect(documentTypeCodeSchema.safeParse('quote_requests.quote_pdf').success).toBe(true);
  });
  it.each(['comparisons', 'Comparisons.comparison', 'comparisons.Comparison', 'a.b.c', '.x', 'x.', `a.${'b'.repeat(120)}`])(
    'refuses %s',
    (code) => {
      expect(documentTypeCodeSchema.safeParse(code).success).toBe(false);
    },
  );
});

describe('documentTemplateContentSchema', () => {
  it('accepts a minimal envelope and unknown (absent-owner) block names', () => {
    const parsed = documentTemplateContentSchema.safeParse(
      envelope({ 'pl-PL': tree([node('gone.SomeBlock', { keep: 1 })]) }),
    );
    expect(parsed.success).toBe(true);
  });

  it('requires schemaVersion 1', () => {
    expect(documentTemplateContentSchema.safeParse({ schemaVersion: 2, languages: { en: tree() } }).success).toBe(false);
  });

  it('refuses language keys outside the BCP 47 subset', () => {
    expect(documentTemplateContentSchema.safeParse(envelope({ english: tree() })).success).toBe(false);
    expect(documentTemplateContentSchema.safeParse(envelope({ 'en-us': tree() })).success).toBe(false);
    expect(documentTemplateContentSchema.safeParse(envelope({ en: tree(), 'pl-PL': tree() })).success).toBe(true);
  });

  it('holds 1 to 10 languages', () => {
    expect(documentTemplateContentSchema.safeParse(envelope({})).success).toBe(false);
    const eleven = Object.fromEntries(
      ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj', 'kk'].map((l) => [l, tree()]),
    );
    expect(documentTemplateContentSchema.safeParse(envelope(eleven)).success).toBe(false);
  });

  it('refuses more than 200 nodes per language', () => {
    const many = Array.from({ length: DOCUMENT_TEMPLATE_LIMITS.maxNodesPerLanguage + 1 }, () =>
      node('document_templates.Spacer'),
    );
    expect(documentTemplateTreeSchema.safeParse(tree(many)).success).toBe(false);
    expect(documentTemplateTreeSchema.safeParse(tree(many.slice(1))).success).toBe(true);
  });

  it('refuses a node type outside the block-name grammar', () => {
    expect(documentTemplateTreeSchema.safeParse(tree([node('Heading')])).success).toBe(false);
    expect(documentTemplateTreeSchema.safeParse(tree([node('document_templates.heading')])).success).toBe(false);
  });

  it('refuses a string prop longer than 5000 characters, nested too', () => {
    const long = 'x'.repeat(DOCUMENT_TEMPLATE_LIMITS.maxStringLength + 1);
    expect(documentTemplateTreeSchema.safeParse(tree([node('document_templates.Text', { text: long })])).success).toBe(false);
    expect(
      documentTemplateTreeSchema.safeParse(tree([node('document_templates.Text', { nested: [{ deep: long }] })])).success,
    ).toBe(false);
  });

  it('refuses more than 20 core images per language', () => {
    const images = Array.from({ length: DOCUMENT_TEMPLATE_LIMITS.maxCoreImagesPerLanguage + 1 }, () =>
      node('document_templates.Image', { assetId: '00000000-0000-4000-8000-000000000001' }),
    );
    expect(documentTemplateTreeSchema.safeParse(tree(images)).success).toBe(false);
  });

  it('refuses Puck zones (nested layouts)', () => {
    expect(documentTemplateTreeSchema.safeParse({ ...tree(), zones: { 'a:b': [node('cms.Row')] } }).success).toBe(false);
    expect(documentTemplateTreeSchema.safeParse({ ...tree(), zones: {} }).success).toBe(true);
  });

  it('refuses content larger than 512 KiB', () => {
    const chunk = 'y'.repeat(4900);
    const nodes = Array.from({ length: 200 }, (_, i) => node('document_templates.Text', { text: chunk, i }));
    const languages = Object.fromEntries(['aa', 'bb'].map((l) => [l, tree(nodes)]));
    const result = documentTemplateContentSchema.safeParse(envelope(languages));
    expect(result.success).toBe(false);
  });
});

describe('documentRootPropsSchema', () => {
  it('accepts the documented ranges and keeps unknown keys', () => {
    const parsed = documentRootPropsSchema.parse({
      pageSize: 'LETTER',
      orientation: 'landscape',
      marginTop: 0,
      marginRight: 144,
      baseFontSize: 6,
      headerText: '{{date}}',
      showPageNumbers: true,
      pageNumberFormat: '{{page}}/{{pages}}',
      title: 'kept',
    });
    expect(parsed['title']).toBe('kept');
  });
  it.each([
    { pageSize: 'A3' },
    { orientation: 'sideways' },
    { marginTop: 145 },
    { marginLeft: -1 },
    { baseFontSize: 5 },
    { baseFontSize: 19 },
    { footerText: 'x'.repeat(501) },
    { pageNumberFormat: 'x'.repeat(51) },
  ])('refuses %o', (props) => {
    expect(documentRootPropsSchema.safeParse(props).success).toBe(false);
  });
});

describe('merge-field keys, selection, core blocks', () => {
  it('merge-field key grammar', () => {
    expect(mergeFieldKeyRe.test('productCount')).toBe(true);
    expect(mergeFieldKeyRe.test('date')).toBe(true);
    expect(mergeFieldKeyRe.test('Product')).toBe(false);
    expect(mergeFieldKeyRe.test('product_count')).toBe(false);
  });
  it('selection is default_only or per_document', () => {
    expect(documentSelectionSchema.options).toEqual(['default_only', 'per_document']);
  });
  it('coreBlocks is all, none or a list of core block names', () => {
    expect(documentCoreBlocksSchema.safeParse('all').success).toBe(true);
    expect(documentCoreBlocksSchema.safeParse('none').success).toBe(true);
    expect(documentCoreBlocksSchema.safeParse(['document_templates.Text']).success).toBe(true);
    expect(documentCoreBlocksSchema.safeParse(['comparisons.ComparisonTable']).success).toBe(false);
    expect(CORE_BLOCK_NAMES).toHaveLength(6);
  });
});

describe('admin DTOs', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  it('summary and detail', () => {
    const summary = {
      id,
      documentType: 'comparisons.comparison',
      name: 'Brand A',
      salesChannelId: null,
      salesChannelName: null,
      languages: ['pl-PL'],
      isDefault: false,
      version: 1,
      updatedAt: '2026-10-17T10:00:00.000Z',
    };
    expect(documentTemplateSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      documentTemplateDetailSchema.safeParse({ ...summary, content: envelope({ 'pl-PL': tree() }) }).success,
    ).toBe(true);
  });
  it('type summary and detail', () => {
    const summary = {
      code: 'comparisons.comparison',
      moduleId: 'comparisons',
      labelKey: 'documentTypes.comparison.label',
      selection: 'default_only',
      templateCount: 0,
    };
    expect(documentTypeSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      documentTypeDetailSchema.safeParse({
        ...summary,
        languages: null,
        variables: [{ key: 'productCount', labelKey: 'x', ownerModule: 'comparisons', scope: 'body' }],
        sample: {},
        builtInContent: envelope({ 'en-US': tree() }),
        pageDefaults: { pageSize: 'A4' },
      }).success,
    ).toBe(true);
  });
  it('create body defaults setDefault to false and validates the source', () => {
    const parsed = createDocumentTemplateBodySchema.parse({
      documentType: 'comparisons.comparison',
      name: '  Brand A ',
      salesChannelId: null,
      source: { kind: 'built_in' },
    });
    expect(parsed.setDefault).toBe(false);
    expect(parsed.name).toBe('Brand A');
    expect(
      createDocumentTemplateBodySchema.safeParse({
        documentType: 'comparisons.comparison',
        name: 'x',
        salesChannelId: null,
        source: { kind: 'template' },
      }).success,
    ).toBe(false);
  });
  it('rename, save, versioned, delete, preview', () => {
    expect(renameDocumentTemplateBodySchema.safeParse({ name: '', expectedVersion: 1 }).success).toBe(false);
    expect(saveDocumentTemplateContentBodySchema.safeParse({ tree: tree(), expectedVersion: 1 }).success).toBe(true);
    expect(versionedBodySchema.safeParse({}).success).toBe(false);
    expect(deleteDocumentTemplateBodySchema.parse({ expectedVersion: 2 }).confirmDefault).toBe(false);
    expect(
      previewDocumentBodySchema.safeParse({ documentType: 'invoices.invoice', language: 'pl-PL', tree: tree() }).success,
    ).toBe(true);
  });
  it('builder config admits colour fields and boolean options (invoice blocks)', () => {
    expect(
      documentBuilderConfigSchema.safeParse({
        schemaVersion: 1,
        components: [
          {
            name: 'invoices.InvoiceHeader',
            ownerModule: 'invoices',
            label: 'Header',
            fields: {
              titleColor: { type: 'color', label: 'Title color' },
              titleBold: { type: 'radio', label: 'Bold', options: [{ label: 'Yes', value: true }] },
            },
          },
        ],
        categories: [],
        rootFields: {},
      }).success,
    ).toBe(true);
  });
});

describe('error codes', () => {
  it('declares the six DOCUMENT_* codes', () => {
    for (const code of [
      'DOCUMENT_TEMPLATE_NOT_FOUND',
      'DOCUMENT_TYPE_NOT_AVAILABLE',
      'DOCUMENT_TEMPLATE_INVALID',
      'DOCUMENT_TEMPLATE_IS_DEFAULT',
      'DOCUMENT_TEMPLATE_NOT_SELECTABLE',
      'DOCUMENT_RENDER_FAILED',
    ]) {
      expect((ERROR_CODES as Record<string, string>)[code]).toBe(code);
    }
  });
});

// ---------------------------------------------------------------------------
// Feature 153 — line collections and the Line items table
// (`specs/153-quote-request-pdf-template/contracts/document-collections.md`)
// ---------------------------------------------------------------------------

describe('field paths (153 R-4)', () => {
  it.each(['sku', 'lineNet', 'attributes.colour', 'attributes.lead_time', 'attributes.PKWiU-2', 'row.number'])(
    'accepts %s',
    (path) => {
      expect(documentFieldPathRe.test(path)).toBe(true);
    },
  );
  it.each(['Sku', 'a.b.c', '1abc', 'attributes.', '.x', 'a b', `attributes.${'x'.repeat(101)}`])(
    'refuses %s',
    (path) => {
      expect(documentFieldPathRe.test(path)).toBe(false);
    },
  );
  it('detects the reserved families', () => {
    expect(isReservedFieldPath('row.number')).toBe(true);
    expect(isReservedFieldPath('item.sku')).toBe(true);
    expect(isReservedFieldPath('item')).toBe(true);
    expect(isReservedFieldPath('items')).toBe(false);
    expect(isReservedFieldPath('rowNote')).toBe(false);
  });
});

describe('itemsTablePropsSchema (153 FR-032, FR-040–FR-043)', () => {
  const column = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    field: 'productName',
    label: '',
    width: 'auto',
    align: 'auto',
    format: {},
    emptyText: '',
    visibleWhen: { op: 'always' },
    ...over,
  });
  const valid = {
    id: 'ItemsTable-1',
    collection: 'lines',
    columns: [column(), column({ id: 'c2', field: 'discountPercent', visibleWhen: { op: 'any_has_value' } })],
    detailRow: {
      enabled: true,
      entries: [{ field: 'lineNote', label: 'Note', visibleWhen: { op: 'has_value' } }],
      separator: ' · ',
      italics: true,
      fontSize: 8,
    },
    totals: [{ field: 'netTotal', label: 'Net', visibleWhen: { op: 'has_value' }, emphasis: false }],
    grouping: { field: 'attributes.brand', emptyLabel: 'Other', subtotalField: 'lineNet', subtotalLabel: 'Group total' },
    emptyText: 'No lines',
    headerBackground: '#f1f5f9',
    borderColor: '#cbd5e1',
    fontSize: 9,
    stripedRows: false,
    stripeColor: '#f8fafc',
    marginBottom: 12,
  };

  it('accepts the documented shape, and a bare one with one column', () => {
    expect(itemsTablePropsSchema.safeParse(valid).success).toBe(true);
    expect(itemsTablePropsSchema.safeParse({ columns: [{ id: 'a', field: 'row.number' }] }).success).toBe(true);
    expect(itemsTablePropsSchema.safeParse({ ...valid, grouping: null }).success).toBe(true);
  });

  it('issue #1904 — a column prints as a link only when asked: off by default, a boolean as Puck stores it', () => {
    const parsed = itemsTablePropsSchema.parse({ columns: [{ id: 'a', field: 'productName' }] });
    expect(parsed.columns[0]!.link).toBe(false);
    expect(itemsTablePropsSchema.parse({ columns: [column({ link: 'true' })] }).columns[0]!.link).toBe(true);
    expect(itemsTablePropsSchema.safeParse({ columns: [column({ link: 'yes' })] }).success).toBe(false);
  });

  it('accepts numbers and booleans as Puck stores them (strings)', () => {
    expect(itemsTablePropsSchema.safeParse({ ...valid, fontSize: '10', stripedRows: 'true' }).success).toBe(true);
  });

  const refusals: [string, unknown, string][] = [
    ['no column', { ...valid, columns: [] }, 'columns'],
    ['17 columns', { ...valid, columns: Array.from({ length: 17 }, (_, i) => column({ id: `c${i}` })) }, 'columns'],
    ['duplicate column ids', { ...valid, columns: [column(), column()] }, 'columns.1.id'],
    ['a bad column id', { ...valid, columns: [column({ id: 'a b' })] }, 'columns.0.id'],
    ['a bad field path', { ...valid, columns: [column({ field: 'a.b.c' })] }, 'columns.0.field'],
    ['has_value on a column', { ...valid, columns: [column({ visibleWhen: { op: 'has_value' } })] }, 'columns.0.visibleWhen.op'],
    ['an unknown op', { ...valid, columns: [column({ visibleWhen: { op: 'sometimes' } })] }, 'columns.0.visibleWhen.op'],
    ['a width out of range', { ...valid, columns: [column({ width: 5 })] }, 'columns.0.width'],
    ['an alignment outside the set', { ...valid, columns: [column({ align: 'justify' })] }, 'columns.0.align'],
    ['too many decimals', { ...valid, columns: [column({ format: { decimals: 5 } })] }, 'columns.0.format.decimals'],
    ['a long label', { ...valid, columns: [column({ label: 'x'.repeat(201) })] }, 'columns.0.label'],
    ['a long empty text', { ...valid, columns: [column({ emptyText: 'x'.repeat(51) })] }, 'columns.0.emptyText'],
    ['any_has_value on a detail entry', { ...valid, detailRow: { ...valid.detailRow, entries: [{ field: 'lineNote', label: '', visibleWhen: { op: 'any_has_value' } }] } }, 'detailRow.entries.0.visibleWhen.op'],
    ['9 detail entries', { ...valid, detailRow: { ...valid.detailRow, entries: Array.from({ length: 9 }, () => ({ field: 'lineNote', label: '' })) } }, 'detailRow.entries'],
    ['11 totals', { ...valid, totals: Array.from({ length: 11 }, () => ({ field: 'netTotal', label: '' })) }, 'totals'],
    ['a bad grouping field', { ...valid, grouping: { ...valid.grouping, field: 'x.y.z' } }, 'grouping.field'],
    ['a font size out of range', { ...valid, fontSize: 30 }, 'fontSize'],
    ['a colour that is not hex', { ...valid, headerBackground: 'red' }, 'headerBackground'],
    ['a collection key outside the grammar', { ...valid, collection: 'Lines' }, 'collection'],
  ];
  it.each(refusals)('refuses %s, naming the setting', (_label, props, path) => {
    const parsed = itemsTablePropsSchema.safeParse(props);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path.join('.')).toBe(path);
  });
});

describe('collections on the type detail and the selection list (153 §4, §5)', () => {
  it('route 2 carries the collections, [] when absent', () => {
    const base = {
      code: 'quote_requests.quote_request',
      moduleId: 'quote_requests',
      labelKey: 'x',
      selection: 'per_document',
      templateCount: 0,
      languages: null,
      variables: [],
      sample: {},
      builtInContent: envelope({ 'en-US': tree() }),
      pageDefaults: {},
    };
    expect(documentTypeDetailSchema.parse(base).collections).toEqual([]);
    const withCollection = documentTypeDetailSchema.parse({
      ...base,
      collections: [
        {
          key: 'lines',
          labelKey: 'documentTypes.quoteRequest.collections.lines',
          ownerModule: 'quote_requests',
          fields: [
            { path: 'row.number', label: 'No.', valueKind: 'number', group: 'line', audience: 'customer' },
            { path: 'listUnitPrice', label: 'List price', valueKind: 'money', group: 'pricing', audience: 'internal', defaultFormat: { decimals: 2 }, defaultAlign: 'right', sampleValue: { kind: 'money', amount: 1, currency: 'PLN' } },
          ],
          summaryFields: [],
          sampleItems: [{ values: { 'row.number': { kind: 'number', value: 1 }, sku: null } }],
          sampleSummary: { netTotal: null },
        },
      ],
    });
    expect(withCollection.collections[0]!.fields).toHaveLength(2);
  });

  it('issue #1904 — a field names the URL field it may link to; the path keeps the field grammar', () => {
    const field = { path: 'productName', label: 'Product', valueKind: 'text', group: 'line', audience: 'customer' } as const;
    expect(documentFieldDefinitionSchema.parse({ ...field, linkPath: 'productUrl' }).linkPath).toBe('productUrl');
    expect(documentFieldDefinitionSchema.parse(field).linkPath).toBeUndefined();
    expect(documentFieldDefinitionSchema.safeParse({ ...field, linkPath: 'a.b.c' }).success).toBe(false);
  });

  it('the selection list', () => {
    expect(
      documentTemplateChoicesSchema.safeParse({
        templates: [{ id: '00000000-0000-4000-8000-000000000001', name: 'A', salesChannelId: null, languages: ['en-US'], isDefault: true }],
        effectiveDefaultId: '00000000-0000-4000-8000-000000000001',
        builtInLanguages: ['en-US', 'pl-PL'],
      }).success,
    ).toBe(true);
  });

  it('the Line items table is the facility’s one collection block', () => {
    expect(COLLECTION_BLOCK_NAMES).toEqual(['document_templates.ItemsTable']);
    expect(CORE_BLOCK_NAMES as readonly string[]).not.toContain('document_templates.ItemsTable');
  });
});

// ---------------------------------------------------------------------------
// Feature 159 — a collection's sections and the table's grouping mode
// (`specs/159-quote-request-item-groups/contracts/document-sections.md` §1, §2)
// ---------------------------------------------------------------------------

describe('itemsTableGroupingSchema (159 FR-041, FR-045)', () => {
  const legacyField = { field: 'attributes.brand', emptyLabel: 'Other', subtotalField: 'lineNet', subtotalLabel: 'Group total' };

  it('accepts null and absent on the table (both mean the document’s groups)', () => {
    const base = { columns: [{ id: 'a', field: 'row.number' }] };
    expect(itemsTablePropsSchema.safeParse({ ...base, grouping: null }).success).toBe(true);
    expect(itemsTablePropsSchema.safeParse(base).success).toBe(true);
    expect(itemsTableGroupingMode(null)).toBe('sections');
    expect(itemsTableGroupingMode(undefined)).toBe('sections');
  });

  it('sections: defaults the heading and the item count', () => {
    expect(itemsTableGroupingSchema.parse({ by: 'sections' })).toEqual({ by: 'sections', otherItemsLabel: '', showItemCount: true });
    expect(itemsTableGroupingSchema.parse({ by: 'sections', otherItemsLabel: 'Rest', showItemCount: 'false' })).toEqual({
      by: 'sections',
      otherItemsLabel: 'Rest',
      showItemCount: false,
    });
    expect(itemsTableGroupingMode({ by: 'sections' })).toBe('sections');
  });

  it('none', () => {
    expect(itemsTableGroupingSchema.parse({ by: 'none' })).toEqual({ by: 'none' });
    expect(itemsTableGroupingMode({ by: 'none' })).toBe('none');
  });

  it('the 153 field shape, with and without by: field, unchanged', () => {
    expect(itemsTableGroupingSchema.parse(legacyField)).toEqual(legacyField);
    expect(itemsTableGroupingSchema.parse({ by: 'field', ...legacyField })).toEqual({ by: 'field', ...legacyField });
    expect(itemsTableGroupingSchema.parse({ field: 'attributes.brand' })).toEqual({
      field: 'attributes.brand',
      emptyLabel: '',
      subtotalField: null,
      subtotalLabel: '',
    });
    expect(itemsTableGroupingMode(legacyField)).toBe('field');
    expect(itemsTableGroupingMode({ by: 'field', field: 'sku' })).toBe('field');
  });

  it('refuses an unknown mode, a long heading, and keeps the 153 field path on a bad field', () => {
    const base = { columns: [{ id: 'a', field: 'row.number' }] };
    expect(itemsTablePropsSchema.safeParse({ ...base, grouping: { by: 'brand' } }).success).toBe(false);
    const long = itemsTablePropsSchema.safeParse({ ...base, grouping: { by: 'sections', otherItemsLabel: 'x'.repeat(101) } });
    expect(long.success).toBe(false);
    expect(long.error!.issues[0]!.path.join('.')).toBe('grouping.otherItemsLabel');
    const field = itemsTablePropsSchema.safeParse({ ...base, grouping: { ...legacyField, field: 'x.y.z' } });
    expect(field.error!.issues[0]!.path.join('.')).toBe('grouping.field');
  });

  it('reads hostile stored values tolerantly: anything unreadable is the default mode', () => {
    expect(itemsTableGroupingMode('nope')).toBe('sections');
    expect(itemsTableGroupingMode({ by: 'whatever' })).toBe('sections');
    expect(itemsTableGroupingMode({})).toBe('field');
  });
});

describe('documentItemSectionSchema and isValidSectionPartition (159 §1)', () => {
  const section = (key: string, itemIndexes: number[], kind: 'group' | 'ungrouped' = 'group'): DocumentItemSection => ({
    key,
    kind,
    label: kind === 'group' ? `Group ${key}` : null,
    itemIndexes,
    summary: {},
  });

  it('the wire shape', () => {
    expect(documentItemSectionSchema.safeParse(section('g1', [0, 1])).success).toBe(true);
    expect(
      documentItemSectionSchema.safeParse({ ...section('g1', [0]), summary: { netTotal: { kind: 'money', amount: 1, currency: 'PLN' } } }).success,
    ).toBe(true);
    expect(documentItemSectionSchema.safeParse({ ...section('', [0]) }).success).toBe(false);
    expect(documentItemSectionSchema.safeParse({ ...section('g', [-1]) }).success).toBe(false);
    expect(documentItemSectionSchema.safeParse({ ...section('g', [0]), kind: 'other' }).success).toBe(false);
  });

  it('accepts a partition covering every index once, ascending and contiguous, ungrouped last', () => {
    expect(isValidSectionPartition([section('a', [0, 1]), section('b', [2]), section('ungrouped', [3, 4], 'ungrouped')], 5)).toBe(true);
    expect(isValidSectionPartition([section('a', [0])], 1)).toBe(true);
    expect(isValidSectionPartition([], 0)).toBe(true);
  });

  it.each<[string, DocumentItemSection[], number]>([
    ['an index missing', [section('a', [0, 1])], 3],
    ['an index twice', [section('a', [0, 1]), section('b', [1, 2])], 3],
    ['out of range', [section('a', [0, 1, 2])], 2],
    ['not ascending', [section('a', [1, 0])], 2],
    ['not contiguous across sections', [section('a', [0, 2]), section('b', [1])], 3],
    ['an empty section', [section('a', [0]), section('b', [])], 1],
    ['a duplicate key', [section('a', [0]), section('a', [1])], 2],
    ['ungrouped before a group', [section('ungrouped', [0], 'ungrouped'), section('a', [1])], 2],
    ['no sections for lines', [], 2],
  ])('refuses %s', (_label, sections, count) => {
    expect(isValidSectionPartition(sections, count)).toBe(false);
  });
});

describe('documentSectionTexts — the facility’s own PDF and canvas texts (159 §3)', () => {
  it('English: Other items, one and other', () => {
    const t = documentSectionTexts('en-US');
    expect(t.otherItems).toBe('Other items');
    expect(t.itemCount(1)).toBe('1 item');
    expect(t.itemCount(3)).toBe('3 items');
  });

  it('Polish: Pozostałe pozycje and the three plural forms', () => {
    const t = documentSectionTexts('pl-PL');
    expect(t.otherItems).toBe('Pozostałe pozycje');
    expect([1, 3, 5, 22, 25].map((n) => t.itemCount(n))).toEqual(['1 pozycja', '3 pozycje', '5 pozycji', '22 pozycje', '25 pozycji']);
  });

  it('any other language reads English', () => {
    expect(documentSectionTexts('de-DE').otherItems).toBe('Other items');
  });
});

describe('route 2 — sampleSections (159 §4)', () => {
  it('defaults to [] and carries the host’s sample sections', () => {
    const collection = {
      key: 'lines',
      labelKey: 'x',
      ownerModule: 'quote_requests',
      fields: [],
      summaryFields: [],
      sampleItems: [],
      sampleSummary: {},
    };
    const base = {
      code: 'quote_requests.quote_request',
      moduleId: 'quote_requests',
      labelKey: 'x',
      selection: 'per_document',
      templateCount: 0,
      languages: null,
      variables: [],
      sample: {},
      builtInContent: envelope({ 'en-US': tree() }),
      pageDefaults: {},
    };
    expect(documentTypeDetailSchema.parse({ ...base, collections: [collection] }).collections[0]!.sampleSections).toEqual([]);
    const sections = [{ key: 'g1', kind: 'group', label: 'Hall A', itemIndexes: [0], summary: {} }];
    expect(
      documentTypeDetailSchema.parse({ ...base, collections: [{ ...collection, sampleSections: sections }] }).collections[0]!.sampleSections,
    ).toEqual(sections);
  });
});
