import { z } from 'zod';
import { blockCategoryKeyRe, blockNameRe } from './cms.js';
import { uuidSchema } from './common.js';
import {
  documentFieldPathRe,
  documentItemSchema,
  documentValueFormatSchema,
  documentValueKindSchema,
  documentValueSchema,
  type DocumentAlign,
  type DocumentItem,
  type DocumentValue,
  type DocumentValueFormat,
  type DocumentValueKind,
} from './document-values.js';

export * from './document-values.js';

/**
 * Document templates — operator-designed Page Builder layouts for the PDF
 * documents the platform produces (`specs/152-compare-pdf-template/`).
 *
 * The facility is owned by the `document_templates` module. A **document type**
 * is contributed by the module that owns the document's data — `comparisons`
 * (the storefront comparison PDF) and `invoices` (the invoice PDF) in feature
 * 152 — through the `documentTypeRegistry` contribution registry, and a host
 * produces a document through the gated `documentRenderPort`, handing over its
 * own data. The facility stores templates opaquely and never interprets a
 * host's data (Constitution XIV).
 *
 * Normative: `specs/152-compare-pdf-template/contracts/document-type-registry.md`
 * (registry, port, hooks) and `contracts/document-templates-api.md` (admin HTTP).
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** `<moduleId>.<snake_name>` — permanent, persisted in `document_templates.document_type`. */
export const documentTypeCodeRe = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export const documentTypeCodeSchema = z.string().max(120).regex(documentTypeCodeRe);

/** A language key of a template's content: `pl`, `pl-PL`, `en-US`. */
export const documentLanguageRe = /^[a-z]{2,3}(-[A-Z]{2})?$/;

/** A merge-field key, written `{{key}}` in a text. */
export const mergeFieldKeyRe = /^[a-z][A-Za-z0-9]*$/;

/** The general-purpose blocks the facility owns; a document type opts into them. */
export const CORE_BLOCK_NAMES = [
  'document_templates.Heading',
  'document_templates.Text',
  'document_templates.Image',
  'document_templates.Spacer',
  'document_templates.Divider',
  'document_templates.PageBreak',
] as const;
export type CoreBlockName = (typeof CORE_BLOCK_NAMES)[number];

/**
 * The blocks the facility owns that bind to a **line collection** a document
 * type declares (`specs/153-quote-request-pdf-template/contracts/document-collections.md`
 * §2). Offered to a type if and only if it declares a collection.
 */
export const COLLECTION_BLOCK_NAMES = ['document_templates.ItemsTable'] as const;
export type CollectionBlockName = (typeof COLLECTION_BLOCK_NAMES)[number];
export const ITEMS_TABLE_BLOCK_NAME: CollectionBlockName = 'document_templates.ItemsTable';

/** Limits a saved template is held to (research R-20). */
export const DOCUMENT_TEMPLATE_LIMITS = {
  maxNodesPerLanguage: 200,
  maxLanguages: 10,
  maxStringLength: 5_000,
  maxCoreImagesPerLanguage: 20,
  maxContentBytes: 512 * 1024,
} as const;

/** Whether a person may pick a template for an individual document (owner Q2). */
export const documentSelectionSchema = z.enum(['default_only', 'per_document']);
export type DocumentSelection = z.infer<typeof documentSelectionSchema>;

/** Which core blocks a document type offers. */
export const documentCoreBlocksSchema = z.union([
  z.literal('all'),
  z.literal('none'),
  z.array(z.enum(CORE_BLOCK_NAMES)),
]);
export type DocumentCoreBlocks = 'all' | 'none' | readonly CoreBlockName[];

// ---------------------------------------------------------------------------
// Content — the per-language Page Builder envelope (data-model.md §3)
// ---------------------------------------------------------------------------

const pageMarginSchema = z.number().min(0).max(144);

/**
 * Root props of one language's tree. Every key optional: the type's
 * `pageDefaults` fill what is absent. Unknown keys are kept (Puck may store
 * its own root props), the documented ones are range-checked.
 */
export const documentRootPropsSchema = z
  .object({
    pageSize: z.enum(['A4', 'LETTER']).optional(),
    orientation: z.enum(['auto', 'portrait', 'landscape']).optional(),
    marginTop: pageMarginSchema.optional(),
    marginRight: pageMarginSchema.optional(),
    marginBottom: pageMarginSchema.optional(),
    marginLeft: pageMarginSchema.optional(),
    baseFontSize: z.number().min(6).max(18).optional(),
    headerText: z.string().max(500).optional(),
    footerText: z.string().max(500).optional(),
    showPageNumbers: z.boolean().optional(),
    pageNumberFormat: z.string().max(50).optional(),
  })
  .passthrough();
export type DocumentRootProps = z.infer<typeof documentRootPropsSchema>;

/** The complete root props a render uses after `pageDefaults` were applied. */
export interface ResolvedDocumentRootProps {
  readonly pageSize: 'A4' | 'LETTER';
  readonly orientation: 'auto' | 'portrait' | 'landscape';
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly baseFontSize: number;
  readonly headerText: string;
  readonly footerText: string;
  readonly showPageNumbers: boolean;
  readonly pageNumberFormat: string;
}

/** The generic page defaults (data-model.md §3.1). */
export const GENERIC_DOCUMENT_PAGE_DEFAULTS: ResolvedDocumentRootProps = {
  pageSize: 'A4',
  orientation: 'auto',
  marginTop: 40,
  marginRight: 32,
  marginBottom: 40,
  marginLeft: 32,
  baseFontSize: 10,
  headerText: '',
  footerText: '',
  showPageNumbers: false,
  pageNumberFormat: '{{page}} / {{pages}}',
};

function longestStringViolation(value: unknown, limit: number, depth = 0): boolean {
  if (depth > 32) return true;
  if (typeof value === 'string') return value.length > limit;
  if (Array.isArray(value)) return value.some((item) => longestStringViolation(item, limit, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((item) => longestStringViolation(item, limit, depth + 1));
  }
  return false;
}

/** One placed block. Props are kept as entered; the facility never interprets them. */
export const documentTemplateNodeSchema = z
  .object({
    type: z.string().regex(blockNameRe),
    props: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough()
  .superRefine((node, ctx) => {
    if (longestStringViolation(node.props, DOCUMENT_TEMPLATE_LIMITS.maxStringLength)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['props'],
        message: `A text in this block is longer than ${DOCUMENT_TEMPLATE_LIMITS.maxStringLength} characters.`,
        params: { limit: 'maxStringLength' },
      });
    }
  });
export type DocumentTemplateNode = z.infer<typeof documentTemplateNodeSchema>;

/** One language's Puck tree. */
export const documentTemplateTreeSchema = z
  .object({
    root: z
      .object({ props: documentRootPropsSchema.default({}) })
      .passthrough()
      .default({ props: {} }),
    content: z.array(documentTemplateNodeSchema).max(DOCUMENT_TEMPLATE_LIMITS.maxNodesPerLanguage),
    zones: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .superRefine((tree, ctx) => {
    if (tree.zones && Object.keys(tree.zones).length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['zones'],
        message: 'Nested layouts are not supported in document templates.',
      });
    }
    const images = tree.content.filter((node) => node.type === 'document_templates.Image').length;
    if (images > DOCUMENT_TEMPLATE_LIMITS.maxCoreImagesPerLanguage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: `A template may place at most ${DOCUMENT_TEMPLATE_LIMITS.maxCoreImagesPerLanguage} images per language.`,
        params: { limit: 'maxCoreImagesPerLanguage' },
      });
    }
  });
export type DocumentTemplateTree = z.infer<typeof documentTemplateTreeSchema>;

/** `{ schemaVersion: 1, languages: { <lang>: <tree> } }`. */
export const documentTemplateContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    languages: z.record(z.string().regex(documentLanguageRe), documentTemplateTreeSchema),
  })
  .superRefine((content, ctx) => {
    const count = Object.keys(content.languages).length;
    if (count < 1 || count > DOCUMENT_TEMPLATE_LIMITS.maxLanguages) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['languages'],
        message: `A template holds 1 to ${DOCUMENT_TEMPLATE_LIMITS.maxLanguages} languages.`,
        params: { limit: 'maxLanguages' },
      });
    }
    if (documentContentByteSize(content) > DOCUMENT_TEMPLATE_LIMITS.maxContentBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: `A template's content may not exceed ${DOCUMENT_TEMPLATE_LIMITS.maxContentBytes / 1024} KiB.`,
        params: { limit: 'maxContentBytes' },
      });
    }
  });
export type DocumentTemplateContent = z.infer<typeof documentTemplateContentSchema>;

/** Serialized UTF-8 size of a content envelope, the measure of the 512 KiB limit. */
export function documentContentByteSize(content: unknown): number {
  // Counted by hand: this package compiles with neither the DOM nor the Node
  // library, so `TextEncoder` and `Buffer` are both out of reach.
  const text = JSON.stringify(content) ?? '';
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}


// ---------------------------------------------------------------------------
// Line collections and the Line items table (feature 153)
// ---------------------------------------------------------------------------

/** A collection key a document type declares: `lines`. */
export const documentCollectionKeyRe = /^[a-z][A-Za-z0-9]*$/;

/** Limits of one Line items table (153 research R-21). */
export const ITEMS_TABLE_LIMITS = {
  maxColumns: 16,
  maxDetailEntries: 8,
  maxTotals: 10,
  maxLabelLength: 200,
  maxEmptyTextLength: 50,
  maxTableEmptyTextLength: 200,
  maxGroupEmptyLabelLength: 100,
  maxSeparatorLength: 10,
} as const;

/** One field a collection offers (research R-4). */
export interface DocumentFieldDefinition {
  readonly path: string;
  /** In the requested language. */
  readonly label: string;
  readonly valueKind: DocumentValueKind;
  /** `line` | `pricing` | `product` | a host's own group key. */
  readonly group: string;
  /** `internal`: a value the customer does not otherwise see (153 Q7) — the editor warns. */
  readonly audience: 'customer' | 'internal';
  readonly defaultFormat?: DocumentValueFormat;
  readonly defaultAlign?: DocumentAlign;
  readonly description?: string;
  /** What the editor's canvas and the preview show when the sample has no value. */
  readonly sampleValue?: DocumentValue;
  /**
   * Issue #1904 — the field of the same collection holding the page this
   * field's value can link to (`productName` → `productUrl`). Declaring it
   * offers the column option *Print as a link*; see `documentCellLink`.
   */
  readonly linkPath?: string;
}

export const documentFieldDefinitionSchema = z.object({
  path: z.string().regex(documentFieldPathRe),
  label: z.string(),
  valueKind: documentValueKindSchema,
  group: z.string(),
  audience: z.enum(['customer', 'internal']),
  defaultFormat: documentValueFormatSchema.optional(),
  defaultAlign: z.enum(['left', 'center', 'right']).optional(),
  description: z.string().optional(),
  sampleValue: documentValueSchema.optional(),
  linkPath: z.string().regex(documentFieldPathRe).optional(),
});

/**
 * The lines of a document a Line items table can print, declared by the
 * document type (contract §1). `fields` is async and per language because part
 * of a catalogue is data (a shop's product attributes); `items` is synchronous
 * and pure over the host's own data, so the facility never queries anything.
 */
export interface DocumentCollectionDeclaration<TData = unknown> {
  readonly key: string;
  /** Module-relative i18n key. */
  readonly labelKey: string;
  fields(language: string): Promise<readonly DocumentFieldDefinition[]>;
  items(data: TData): readonly DocumentItem[];
  summaryFields?(language: string): Promise<readonly DocumentFieldDefinition[]>;
  summary?(data: TData): Readonly<Record<string, DocumentValue>>;
  /**
   * Feature 159 — the document's groups as sections of `items(data)`
   * (`specs/159-quote-request-item-groups/contracts/document-sections.md` §1).
   * Absent = the collection has no sections. Only non-empty sections, groups
   * first in order, the ungrouped lines last; each section a contiguous
   * ascending run of indexes. A partition the facility cannot use prints the
   * table flat — the document never fails for it.
   */
  sections?(data: TData): readonly DocumentItemSection[];
}

/** Feature 159 — one section of a collection: a group's lines, or the lines in no group. */
export interface DocumentItemSection {
  /** The group's id, or the literal `'ungrouped'`. Unique within one render. */
  readonly key: string;
  readonly kind: 'group' | 'ungrouped';
  /** The group's name as an administrator wrote it; `null` for `ungrouped`. Never translated. */
  readonly label: string | null;
  /** Indexes into `items(data)`; ascending; the sections together cover every index exactly once. */
  readonly itemIndexes: readonly number[];
  /** The section's totals, keyed like `summary(data)`, computed by the host over the section's lines. */
  readonly summary: Readonly<Record<string, DocumentValue>>;
}

export const DOCUMENT_UNGROUPED_SECTION_KEY = 'ungrouped';

export const documentItemSectionSchema = z.object({
  key: z.string().min(1).max(64),
  kind: z.enum(['group', 'ungrouped']),
  label: z.string().nullable(),
  itemIndexes: z.array(z.number().int().nonnegative()),
  summary: z.record(z.string(), documentValueSchema),
});

/**
 * Whether `sections` is a partition of `itemCount` items the Line items table
 * can print (contract §1): read in order, the sections' indexes are exactly
 * `0…itemCount-1`; no section is empty; keys are unique; the ungrouped section,
 * if any, is last. Pure — the renderer and the canvas both call it.
 */
export function isValidSectionPartition(sections: readonly DocumentItemSection[], itemCount: number): boolean {
  const keys = new Set<string>();
  let next = 0;
  for (const [index, section] of sections.entries()) {
    if (keys.has(section.key)) return false;
    keys.add(section.key);
    if (section.itemIndexes.length === 0) return false;
    if (section.kind === 'ungrouped' && index !== sections.length - 1) return false;
    for (const itemIndex of section.itemIndexes) {
      if (itemIndex !== next) return false;
      next += 1;
    }
  }
  return next === itemCount;
}

/**
 * The facility's own texts around sections — the default *Other items* heading
 * and the item count — in the document's language (contract §3). Here rather
 * than in the facility's backend so the editor canvas prints what the PDF
 * prints (153 FR-036). Polish and English ship; any other language reads
 * English. The count's form is chosen by `Intl.PluralRules`.
 */
export interface DocumentSectionTexts {
  readonly otherItems: string;
  itemCount(count: number): string;
}

const SECTION_TEXTS: Readonly<
  Record<'en' | 'pl', { readonly otherItems: string; readonly items: Readonly<Partial<Record<Intl.LDMLPluralRule, string>>> & { readonly other: string } }>
> = {
  en: { otherItems: 'Other items', items: { one: '{count} item', other: '{count} items' } },
  pl: {
    otherItems: 'Pozostałe pozycje',
    items: { one: '{count} pozycja', few: '{count} pozycje', many: '{count} pozycji', other: '{count} pozycji' },
  },
};

export function documentSectionTexts(language: string): DocumentSectionTexts {
  const texts = language.toLowerCase().split('-')[0] === 'pl' ? SECTION_TEXTS.pl : SECTION_TEXTS.en;
  const locale = language || 'en-US';
  return {
    otherItems: texts.otherItems,
    itemCount(count) {
      let form: Intl.LDMLPluralRule = 'other';
      let formatted = String(count);
      try {
        form = new Intl.PluralRules(locale).select(count);
        formatted = new Intl.NumberFormat(locale).format(count);
      } catch {
        // A language code Intl does not accept: the plain number and the general form.
      }
      return (texts.items[form] ?? texts.items.other).replace('{count}', formatted);
    },
  };
}

/** Puck stores what its fields edit; a number may arrive as a numeric string. */
const numberLike = (min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
    z.number().min(min).max(max),
  );
const booleanLike = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean(),
);
const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
const fieldPath = z.string().regex(documentFieldPathRe);

/** Columns may print *always*, *only if any line has a value*, or *never* (D2). */
export const itemsTableColumnConditionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('always') }),
  z.object({ op: z.literal('never') }),
  z.object({ op: z.literal('any_has_value'), field: fieldPath.optional() }),
]);
/** Detail entries and totals rows: *always*, *only if it has a value*, *never*. */
export const itemsTableEntryConditionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('always') }),
  z.object({ op: z.literal('never') }),
  z.object({ op: z.literal('has_value'), field: fieldPath.optional() }),
]);

export const itemsTableColumnSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  field: fieldPath,
  label: z.string().max(ITEMS_TABLE_LIMITS.maxLabelLength).default(''),
  width: z.union([z.literal('auto'), z.literal('fill'), numberLike(10, 400)]).default('auto'),
  align: z.enum(['auto', 'left', 'center', 'right']).default('auto'),
  format: documentValueFormatSchema.default({}),
  emptyText: z.string().max(ITEMS_TABLE_LIMITS.maxEmptyTextLength).default(''),
  visibleWhen: itemsTableColumnConditionSchema.default({ op: 'always' }),
  /**
   * Issue #1904 — print the value as a link to the page its field declares
   * (`DocumentFieldDefinition.linkPath`). Off by default, so every layout
   * saved before it prints exactly as it did.
   */
  link: booleanLike.default(false),
});
export type ItemsTableColumn = z.infer<typeof itemsTableColumnSchema>;

export const itemsTableDetailEntrySchema = z.object({
  field: fieldPath,
  label: z.string().max(ITEMS_TABLE_LIMITS.maxLabelLength).default(''),
  visibleWhen: itemsTableEntryConditionSchema.default({ op: 'has_value' }),
});
export type ItemsTableDetailEntry = z.infer<typeof itemsTableDetailEntrySchema>;

export const itemsTableDetailRowSchema = z.object({
  enabled: booleanLike.default(false),
  entries: z.array(itemsTableDetailEntrySchema).max(ITEMS_TABLE_LIMITS.maxDetailEntries).default([]),
  separator: z.string().max(ITEMS_TABLE_LIMITS.maxSeparatorLength).default(' · '),
  italics: booleanLike.default(true),
  fontSize: numberLike(6, 14).default(8),
});
export type ItemsTableDetailRow = z.infer<typeof itemsTableDetailRowSchema>;

export const itemsTableTotalSchema = z.object({
  field: fieldPath,
  label: z.string().max(ITEMS_TABLE_LIMITS.maxLabelLength).default(''),
  visibleWhen: itemsTableEntryConditionSchema.default({ op: 'has_value' }),
  emphasis: booleanLike.default(false),
});
export type ItemsTableTotal = z.infer<typeof itemsTableTotalSchema>;

/** 153's grouping by a field's value; templates saved before feature 159 carry no `by`. */
export const itemsTableFieldGroupingSchema = z.object({
  by: z.literal('field').optional(),
  field: fieldPath,
  emptyLabel: z.string().max(ITEMS_TABLE_LIMITS.maxGroupEmptyLabelLength).default(''),
  subtotalField: fieldPath.nullable().default(null),
  subtotalLabel: z.string().max(ITEMS_TABLE_LIMITS.maxLabelLength).default(''),
});
/** Feature 159 — the document's own groups (`DocumentCollectionDeclaration.sections`). */
export const itemsTableSectionsGroupingSchema = z.object({
  by: z.literal('sections'),
  otherItemsLabel: z.string().max(ITEMS_TABLE_LIMITS.maxGroupEmptyLabelLength).default(''),
  showItemCount: booleanLike.default(true),
});
export const itemsTableNoGroupingSchema = z.object({ by: z.literal('none') });

/**
 * The table's *Grouping* setting (159 contract §2). The props' `grouping` is
 * `null` or absent on a table whose grouping was never configured, which means
 * **the document's groups** with the defaults — so every template saved before
 * feature 159 prints a grouped document's groups without being edited, and an
 * ungrouped document exactly as before.
 */
export const itemsTableGroupingSchema = z.union([
  itemsTableSectionsGroupingSchema,
  itemsTableNoGroupingSchema,
  itemsTableFieldGroupingSchema,
]);
export type ItemsTableGrouping = z.infer<typeof itemsTableGroupingSchema>;
export type ItemsTableGroupingMode = 'sections' | 'none' | 'field';

/**
 * The mode a stored `grouping` means, read tolerantly as the renderer reads
 * every prop: `null`, absent, an unreadable value or an unknown `by` is
 * *sections*; a record without `by` is 153's field grouping.
 */
export function itemsTableGroupingMode(raw: unknown): ItemsTableGroupingMode {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return 'sections';
  const by = (raw as { by?: unknown }).by;
  if (by === undefined || by === 'field') return 'field';
  if (by === 'none') return 'none';
  return 'sections';
}

/**
 * The stored props of one `document_templates.ItemsTable` node
 * (`specs/153-quote-request-pdf-template/data-model.md` §2), validated when a
 * template is saved (FR-043). Unknown keys are kept — Puck stores its own `id`.
 * A field path the catalogue does not offer is accepted: the catalogue is data
 * and changes, and such a column prints its empty text (FR-037).
 */
export const itemsTablePropsSchema = z
  .object({
    collection: z.string().regex(documentCollectionKeyRe).max(60).optional(),
    columns: z.array(itemsTableColumnSchema).min(1).max(ITEMS_TABLE_LIMITS.maxColumns),
    detailRow: itemsTableDetailRowSchema.optional(),
    totals: z.array(itemsTableTotalSchema).max(ITEMS_TABLE_LIMITS.maxTotals).optional(),
    grouping: itemsTableGroupingSchema.nullable().optional(),
    emptyText: z.string().max(ITEMS_TABLE_LIMITS.maxTableEmptyTextLength).optional(),
    headerBackground: hexColor.optional(),
    borderColor: hexColor.optional(),
    fontSize: numberLike(6, 14).optional(),
    stripedRows: booleanLike.optional(),
    stripeColor: hexColor.optional(),
    marginBottom: numberLike(0, 144).optional(),
  })
  .passthrough()
  .superRefine((props, ctx) => {
    const seen = new Set<string>();
    props.columns.forEach((column, index) => {
      if (seen.has(column.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['columns', index, 'id'],
          message: 'Two columns of one table have the same id.',
        });
      }
      seen.add(column.id);
    });
  });
export type ItemsTableProps = z.infer<typeof itemsTablePropsSchema>;

// ---------------------------------------------------------------------------
// Document types — what a host registers (document-type-registry.md §2)
// ---------------------------------------------------------------------------

/** Where a template is applied when a document is produced. */
export interface DocumentRenderContext {
  readonly documentType: string;
  /** The tree language actually used. */
  readonly language: string;
  readonly salesChannelId: string | null;
  readonly preview: boolean;
  /** Usable width in points after margins and orientation. */
  readonly pageWidth: number;
}

/** One configurable field of a block, as the builder descriptor serves it. */
export const documentFieldDescriptorSchema = z.object({
  type: z.enum([
    'text',
    'textarea',
    'number',
    'select',
    'radio',
    'color',
    'array',
    'object',
    'external',
    'uuid',
    'richtext',
  ]),
  label: z.string().optional(),
  required: z.boolean().optional(),
  options: z
    .array(z.object({ label: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }))
    .optional(),
  refKind: z.string().optional(),
});
export type DocumentFieldDescriptor = z.infer<typeof documentFieldDescriptorSchema>;

/** A host block's renderer. */
export interface DocumentBlockRenderer<TData = unknown, TPrepared = unknown> {
  /** `blockNameRe`; the owner segment is `moduleId`. */
  readonly name: string;
  /** Presence-filtered by this id on every call. */
  readonly moduleId: string;
  /** Label and fields when no present manifest declares the block's fields (contributed blocks). */
  describe?(): {
    readonly label: string;
    readonly fields: Readonly<Record<string, DocumentFieldDescriptor>>;
  };
  /** One pdfmake content node. `props` are untrusted stored props over declared `defaultProps`. */
  render(input: {
    readonly props: Readonly<Record<string, unknown>>;
    readonly data: TData;
    readonly prepared: TPrepared;
    readonly language: string;
    readonly context: DocumentRenderContext;
    readonly interpolate: (text: string) => string;
  }): unknown;
}

/** Root-prop defaults merged under stored root props, plus non-editable pdfmake styles. */
export type DocumentPageDefaults = Partial<ResolvedDocumentRootProps> & {
  readonly styles?: Readonly<Record<string, unknown>>;
};

export interface DocumentTypeRegistration<TData = unknown, TPrepared = unknown> {
  readonly code: string;
  readonly moduleId: string;
  /** Module-relative i18n key. */
  readonly labelKey: string;
  readonly descriptionKey?: string;

  /** The type's blocks at this moment — called per read and per render. */
  blocks(): readonly DocumentBlockRenderer<TData, TPrepared>[];
  readonly coreBlocks: DocumentCoreBlocks;

  readonly selection: DocumentSelection;
  /** Languages a template may hold; absent = every active content language. */
  readonly languages?: readonly string[];

  readonly variables?: readonly { readonly key: string; readonly labelKey: string }[];
  resolveVariables?(
    data: TData,
    context: DocumentRenderContext,
  ): Readonly<Record<string, string | null>>;

  /** The built-in layout, per language. A fresh object per call. */
  defaultContent(): DocumentTemplateContent;
  /** Code layout used when no candidate tree renders anything. */
  renderBuiltIn?(data: TData, prepared: TPrepared, context: DocumentRenderContext): unknown[];

  readonly pageDefaults?: DocumentPageDefaults;
  suggestOrientation?(data: TData): 'portrait' | 'landscape';

  /** Per-render precomputation handed to every block. */
  prepareRender?(
    data: TData,
    input: { readonly placedBlocks: ReadonlySet<string> | null; readonly preview: boolean },
  ): Promise<TPrepared>;

  /** Fictitious, JSON-serialisable sample for the editor and the preview. */
  sampleData(language: string): TData;

  /**
   * The line collections a Line items table can print (feature 153). A type
   * declaring at least one is offered `document_templates.ItemsTable`.
   */
  readonly collections?: readonly DocumentCollectionDeclaration<TData>[];
}

/** Container name: `documentTypeRegistry`. Owner: `document_templates`. Ungated. */
export interface DocumentTypeRegistryPort {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a registry holds types of different data shapes.
  register(registration: DocumentTypeRegistration<any, any>): void;
}

// ---------------------------------------------------------------------------
// Rendering (document-type-registry.md §4)
// ---------------------------------------------------------------------------

export interface DocumentRenderInput<TData = unknown> {
  readonly documentType: string;
  /** The document's channel; `null` only for previews and channel-less documents. */
  readonly salesChannelId: string | null;
  readonly language: string;
  readonly data: TData;
  /** Only for `selection: 'per_document'` types. */
  readonly templateId?: string;
  /** An unsaved canvas (the admin preview). Facility-internal. */
  readonly tree?: unknown;
  /** Render as a preview (enrichments may be skipped by the type). */
  readonly preview?: boolean;
}

export interface DocumentRenderResult {
  readonly bytes: Uint8Array;
  readonly source: 'explicit' | 'default' | 'built_in' | 'canvas';
  readonly templateId: string | null;
  readonly templateVersion: number | null;
  readonly language: string;
  readonly requestedTemplateMissing: boolean;
}

/**
 * The templates a person may pick for one document (153 contract §5): global
 * ones and those of the document's channel — channel first, then global, each
 * by name — the one a document without a choice would use (`null` = the
 * built-in layout), and the built-in layout's languages.
 */
export const documentTemplateChoiceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  salesChannelId: uuidSchema.nullable(),
  languages: z.array(z.string()),
  isDefault: z.boolean(),
});
export type DocumentTemplateChoice = z.infer<typeof documentTemplateChoiceSchema>;

export const documentTemplateChoicesSchema = z.object({
  templates: z.array(documentTemplateChoiceSchema),
  effectiveDefaultId: uuidSchema.nullable(),
  builtInLanguages: z.array(z.string()),
});
export type DocumentTemplateChoices = z.infer<typeof documentTemplateChoicesSchema>;

/** Container name: `documentRenderPort`. Owner: `document_templates`. Gated. */
export interface DocumentRenderPort {
  render<TData>(input: DocumentRenderInput<TData>): Promise<DocumentRenderResult>;
  /**
   * The selection list of a `per_document` type for a document's channel
   * (feature 153) — so a host can offer a picker to people who may not manage
   * templates. A `default_only` type answers `DOCUMENT_TEMPLATE_NOT_SELECTABLE`.
   */
  listChoices(input: {
    readonly documentType: string;
    readonly salesChannelId: string | null;
  }): Promise<DocumentTemplateChoices>;
}

// ---------------------------------------------------------------------------
// Admin API DTOs (document-templates-api.md)
// ---------------------------------------------------------------------------

export const documentTypeSummarySchema = z.object({
  code: documentTypeCodeSchema,
  moduleId: z.string(),
  labelKey: z.string(),
  descriptionKey: z.string().optional(),
  selection: documentSelectionSchema,
  templateCount: z.number().int().nonnegative(),
});
export type DocumentTypeSummary = z.infer<typeof documentTypeSummarySchema>;

export const documentVariableSchema = z.object({
  key: z.string().regex(mergeFieldKeyRe),
  labelKey: z.string(),
  ownerModule: z.string(),
  scope: z.enum(['body', 'headerFooter']),
});
export type DocumentVariable = z.infer<typeof documentVariableSchema>;

/** One declared collection as the editor needs it (153 contract §4), labels in the requested language. */
export const documentCollectionDetailSchema = z.object({
  key: z.string().regex(documentCollectionKeyRe),
  labelKey: z.string(),
  ownerModule: z.string(),
  /** `row.number` first. */
  fields: z.array(documentFieldDefinitionSchema),
  summaryFields: z.array(documentFieldDefinitionSchema),
  /** The sample's items, a field's `sampleValue` filled where the sample has none. */
  sampleItems: z.array(documentItemSchema),
  sampleSummary: z.record(z.string(), documentValueSchema),
  /** Feature 159 — the sample's sections; `[]` when the collection declares none. */
  sampleSections: z.array(documentItemSectionSchema).default([]),
});
export type DocumentCollectionDetail = z.infer<typeof documentCollectionDetailSchema>;

export const documentTypeDetailSchema = documentTypeSummarySchema.extend({
  /** `null` = every active content language. */
  languages: z.array(z.string()).nullable(),
  variables: z.array(documentVariableSchema),
  sample: z.unknown(),
  builtInContent: documentTemplateContentSchema,
  pageDefaults: documentRootPropsSchema,
  /** Feature 153 — the type's line collections; `[]` when it declares none. */
  collections: z.array(documentCollectionDetailSchema).default([]),
});
export type DocumentTypeDetail = z.infer<typeof documentTypeDetailSchema>;

export const documentBuilderComponentSchema = z.object({
  name: z.string().regex(blockNameRe),
  ownerModule: z.string(),
  /** Plain label, when the block is described by its renderer rather than declared. */
  label: z.string().optional(),
  labelKey: z.string().optional(),
  descriptionKey: z.string().optional(),
  category: z.string().regex(blockCategoryKeyRe).optional(),
  fields: z.record(z.string(), documentFieldDescriptorSchema),
  defaultProps: z.record(z.string(), z.unknown()).optional(),
  weight: z.number().int().optional(),
});
export type DocumentBuilderComponent = z.infer<typeof documentBuilderComponentSchema>;

export const documentBuilderCategorySchema = z.object({
  key: z.string().regex(blockCategoryKeyRe),
  titleKey: z.string(),
  ownerModule: z.string(),
  weight: z.number().int().optional(),
});
export type DocumentBuilderCategory = z.infer<typeof documentBuilderCategorySchema>;

/** Route 3 — the Page Builder descriptor of one document type: exactly its palette. */
export const documentBuilderConfigSchema = z.object({
  schemaVersion: z.literal(1),
  components: z.array(documentBuilderComponentSchema),
  categories: z.array(documentBuilderCategorySchema),
  rootFields: z.record(z.string(), documentFieldDescriptorSchema),
});
export type DocumentBuilderConfig = z.infer<typeof documentBuilderConfigSchema>;

export const documentTemplateSummarySchema = z.object({
  id: uuidSchema,
  documentType: documentTypeCodeSchema,
  name: z.string(),
  salesChannelId: uuidSchema.nullable(),
  salesChannelName: z.string().nullable(),
  languages: z.array(z.string()),
  isDefault: z.boolean(),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export type DocumentTemplateSummary = z.infer<typeof documentTemplateSummarySchema>;

export const documentTemplateDetailSchema = documentTemplateSummarySchema.extend({
  /** Kept as stored; validated per language when saved. */
  content: z.object({ schemaVersion: z.literal(1), languages: z.record(z.string(), z.unknown()) }),
});
export type DocumentTemplateDetail = z.infer<typeof documentTemplateDetailSchema>;

export const documentTemplateListQuerySchema = z.object({
  type: documentTypeCodeSchema,
  /** `<uuid>` or `global` — one scope. */
  salesChannelId: z.union([uuidSchema, z.literal('global')]).optional(),
  /** Global ∪ this channel — the per-document picker (research R-23). */
  applicableToChannel: uuidSchema.optional(),
});
export type DocumentTemplateListQuery = z.infer<typeof documentTemplateListQuerySchema>;

export const createDocumentTemplateBodySchema = z.object({
  documentType: documentTypeCodeSchema,
  name: z.string().trim().min(1).max(200),
  salesChannelId: uuidSchema.nullable(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('built_in') }),
    z.object({ kind: z.literal('template'), templateId: uuidSchema }),
  ]),
  setDefault: z.boolean().default(false),
});
export type CreateDocumentTemplateBody = z.infer<typeof createDocumentTemplateBodySchema>;

export const renameDocumentTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int(),
});
export type RenameDocumentTemplateBody = z.infer<typeof renameDocumentTemplateBodySchema>;

export const saveDocumentTemplateContentBodySchema = z.object({
  tree: z.unknown(),
  expectedVersion: z.number().int(),
});
export type SaveDocumentTemplateContentBody = z.infer<typeof saveDocumentTemplateContentBodySchema>;

export const versionedBodySchema = z.object({ expectedVersion: z.number().int() });
export type VersionedBody = z.infer<typeof versionedBodySchema>;

export const deleteDocumentTemplateBodySchema = versionedBodySchema.extend({
  confirmDefault: z.boolean().default(false),
});
export type DeleteDocumentTemplateBody = z.infer<typeof deleteDocumentTemplateBodySchema>;

export const previewDocumentBodySchema = z.object({
  documentType: documentTypeCodeSchema,
  language: z.string().regex(documentLanguageRe),
  tree: z.unknown(),
});
export type PreviewDocumentBody = z.infer<typeof previewDocumentBodySchema>;
