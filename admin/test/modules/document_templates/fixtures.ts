import type {
  DocumentBuilderConfig,
  DocumentTemplateDetail,
  DocumentTemplateSummary,
  DocumentTypeDetail,
  DocumentTypeSummary,
} from '@endora-commerce/contracts';
import { passthroughBundle } from '../../helpers/render-with-i18n';

/** Shared fixtures of the document-template screens' tests (spec 152). */

export const COMPARISON: DocumentTypeSummary = {
  code: 'comparisons.comparison',
  moduleId: 'comparisons',
  labelKey: 'documentTypes.comparison.label',
  descriptionKey: 'documentTypes.comparison.description',
  selection: 'default_only',
  templateCount: 2,
};

export const INVOICE: DocumentTypeSummary = {
  code: 'invoices.invoice',
  moduleId: 'invoices',
  labelKey: 'documentTypes.invoice.label',
  selection: 'default_only',
  templateCount: 0,
};

export function summary(over: Partial<DocumentTemplateSummary> = {}): DocumentTemplateSummary {
  return {
    id: '00000000-0000-4000-8000-0000000000d1',
    documentType: 'comparisons.comparison',
    name: 'Brand A',
    salesChannelId: null,
    salesChannelName: null,
    languages: ['en-US', 'pl-PL'],
    isDefault: true,
    version: 3,
    updatedAt: '2026-10-17T10:00:00.000Z',
    ...over,
  };
}

const tree = (content: { type: string; props: Record<string, unknown> }[]) => ({ root: { props: {} }, content });

export function detail(over: Partial<DocumentTemplateDetail> = {}): DocumentTemplateDetail {
  return {
    ...summary(),
    content: {
      schemaVersion: 1,
      languages: {
        'en-US': tree([
          { type: 'comparisons.ComparisonHeader', props: { id: 'h', title: 'Brand A' } },
          { type: 'gone.Block', props: { id: 'g', keep: 1 } },
        ]),
        'pl-PL': tree([]),
      },
    },
    ...over,
  };
}

export function typeDetail(over: Partial<DocumentTypeDetail> = {}): DocumentTypeDetail {
  return {
    ...COMPARISON,
    languages: null,
    variables: [
      { key: 'date', labelKey: 'variables.date', ownerModule: 'document_templates', scope: 'body' },
      { key: 'productCount', labelKey: 'documentTypes.comparison.variables.productCount', ownerModule: 'comparisons', scope: 'body' },
      { key: 'page', labelKey: 'variables.page', ownerModule: 'document_templates', scope: 'headerFooter' },
    ],
    sample: { view: { displayMode: 'all', products: [], comparableAttributes: [], pricedFor: 'channel' }, shareUrl: null, generatedAt: '2026-10-17T10:00:00.000Z' },
    builtInContent: { schemaVersion: 1, languages: { 'en-US': tree([]) } },
    pageDefaults: { pageSize: 'A4', orientation: 'auto' },
    collections: [],
    ...over,
  };
}

const CORE = ['Heading', 'Text', 'Image', 'Spacer', 'Divider', 'PageBreak'].map((n) => `document_templates.${n}`);

export function comparisonConfig(): DocumentBuilderConfig {
  return {
    schemaVersion: 1,
    components: [
      ...['ComparisonHeader', 'ComparisonTable', 'ComparisonShareLink'].map((n, i) => ({
        name: `comparisons.${n}`,
        ownerModule: 'comparisons',
        labelKey: `blocks.${n.charAt(0).toLowerCase()}${n.slice(1)}.label`,
        category: 'comparison',
        fields: { title: { type: 'text' as const, label: 'Title' } },
        weight: (i + 1) * 10,
      })),
      ...CORE.map((name) => ({ name, ownerModule: 'document_templates', labelKey: 'blocks.x.label', category: 'layout', fields: {} })),
    ],
    categories: [
      { key: 'comparison', titleKey: 'blocks.category.comparison', ownerModule: 'comparisons', weight: 20 },
      { key: 'layout', titleKey: 'blocks.category.layout', ownerModule: 'document_templates', weight: 90 },
    ],
    rootFields: { pageSize: { type: 'select', label: 'Page size', options: [{ label: 'A4', value: 'A4' }] } },
  };
}

export function invoiceConfig(): DocumentBuilderConfig {
  const own = ['InvoiceHeader', 'InvoiceParties', 'InvoiceLineItems', 'InvoiceVatSummary', 'InvoiceTotals', 'InvoiceNotes', 'InvoiceSpacer', 'InvoiceDivider', 'InvoiceLogo', 'InvoiceFooter'];
  return {
    schemaVersion: 1,
    components: [
      ...own.map((n) => ({ name: `invoices.${n}`, ownerModule: 'invoices', label: n, category: 'invoice', fields: { titleColor: { type: 'color' as const, label: 'Title color' } } })),
      { name: 'ksef.InvoiceSection', ownerModule: 'ksef', label: 'KSeF section', fields: { caption: { type: 'text', label: 'Caption' } } },
    ],
    categories: [{ key: 'invoice', titleKey: 'blocks.category.invoice', ownerModule: 'invoices', weight: 10 }],
    rootFields: {},
  };
}

export const KEYS = [
  'page.title', 'page.description', 'page.loading', 'page.loadError', 'page.retry', 'page.empty', 'page.actionError',
  'page.newTemplate', 'page.builtIn', 'page.builtInBadge', 'page.createFromThis', 'page.allChannels', 'page.default',
  'page.setDefault', 'page.clearDefault', 'page.edit', 'page.open', 'page.duplicate', 'page.delete', 'page.noTemplates',
  'page.column.name', 'page.column.languages', 'page.column.updated', 'page.column.actions',
  'dialog.newTitle', 'dialog.duplicateTitle', 'dialog.copyOf', 'dialog.name', 'dialog.scope', 'dialog.scopeHint', 'dialog.source',
  'dialog.setDefault', 'dialog.create', 'dialog.cancel', 'dialog.deleteTitle', 'dialog.deleteBody', 'dialog.deleteDefaultGlobal',
  'dialog.deleteDefaultChannel',
  'editor.title', 'editor.loading', 'editor.loadError', 'editor.preview', 'editor.previewing', 'editor.previewError', 'editor.save',
  'editor.saving', 'editor.saved', 'editor.saveError', 'editor.readOnly', 'editor.standIn', 'editor.placeholder', 'editor.otherBlocks',
  'editor.language', 'editor.languageMissing', 'editor.startFrom', 'editor.mergeFields.title', 'editor.mergeFields.copy',
  'editor.mergeFields.headerFooterOnly', 'editor.conflict.title', 'editor.conflict.body', 'editor.conflict.reload',
  'editor.conflict.keepEditing',
];

export const BUNDLE = {
  ...passthroughBundle('document_templates', KEYS),
  ...passthroughBundle('comparisons', ['documentTypes.comparison.label', 'documentTypes.comparison.description', 'documentTypes.comparison.variables.productCount']),
  ...passthroughBundle('invoices', ['documentTypes.invoice.label']),
  ...passthroughBundle('core', [
    'common.action.back',
    ...['title', 'body', 'save', 'saving', 'discard', 'stay', 'hint'].map((key) => `form.unsavedChanges.${key}`),
  ]),
};
