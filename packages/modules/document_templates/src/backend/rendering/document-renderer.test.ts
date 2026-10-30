import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentBlockRenderer,
  DocumentFieldDefinition,
  DocumentItem,
  DocumentItemSection,
  DocumentTypeRegistration,
  ModuleManifest,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { DocumentTypeRegistry } from '../registry/document-type-registry.js';
import { BlockDeclarations } from '../services/block-declarations.js';
import { TemplateResolver, type TemplateRow } from '../services/template-resolver.js';
import { DocumentRenderer } from './document-renderer.js';

/**
 * T022 — the engine, asserted on document **definitions**, not bytes, plus
 * one byte-level smoke render.
 */

const A = '00000000-0000-4000-8000-00000000000a';
const tree = (content: { type: string; props: Record<string, unknown> }[], rootProps: Record<string, unknown> = {}) => ({
  root: { props: rootProps },
  content,
});
const node = (type: string, props: Record<string, unknown> = {}) => ({ type, props });

interface Data {
  readonly title: string;
}

function setup(opts: {
  rows?: TemplateRow[];
  registration?: Partial<DocumentTypeRegistration<Data, { stamp: string }>>;
  present?: Set<string>;
  blocks?: DocumentBlockRenderer<Data, { stamp: string }>[];
  manifests?: { manifest: ModuleManifest }[];
}) {
  const present = opts.present ?? new Set(['acme', 'ksef', 'document_templates']);
  const isPresent = (id: string): boolean => present.has(id);
  const registry = new DocumentTypeRegistry(isPresent, () => undefined);
  const body: DocumentBlockRenderer<Data, { stamp: string }> = {
    name: 'acme.Body',
    moduleId: 'acme',
    render: ({ props, data, prepared, interpolate }) => ({
      text: `${interpolate(String(props['text'] ?? ''))}|${data.title}|${prepared?.stamp ?? '-'}|${String(props['tone'])}`,
    }),
  };
  const stamp: DocumentBlockRenderer<Data, { stamp: string }> = {
    name: 'ksef.Stamp',
    moduleId: 'ksef',
    render: () => ({ text: 'stamp' }),
  };
  const registration: DocumentTypeRegistration<Data, { stamp: string }> = {
    code: 'acme.note',
    moduleId: 'acme',
    labelKey: 'x',
    blocks: () => opts.blocks ?? [body, stamp],
    coreBlocks: ['document_templates.Text', 'document_templates.Image'],
    selection: 'per_document',
    defaultContent: () => ({ schemaVersion: 1, languages: { 'en-US': tree([node('acme.Body', { text: 'built-in tree' })]) } }),
    sampleData: () => ({ title: 'sample' }),
    ...opts.registration,
  };
  registry.register(registration);
  const rows = opts.rows ?? [];
  const resolver = new TemplateResolver({
    findDefaults: async (type, channel) =>
      rows.filter((r) => r.documentType === type && r.isDefault && (r.salesChannelId === null || r.salesChannelId === channel)),
    findById: async (id) => rows.find((r) => r.id === id) ?? null,
    findApplicable: async (type, channel) =>
      rows.filter((r) => r.documentType === type && (r.salesChannelId === null || r.salesChannelId === channel)),
  });
  const manifests = opts.manifests ?? [
    {
      manifest: {
        id: 'acme',
        name: 'acme',
        version: '1',
        description: 'acme',
        blocks: [
          { name: 'acme.Body', labelKey: 'b', category: 'acme', contexts: ['document'], fields: {}, defaultProps: { tone: 'calm', text: 'default text' } },
        ],
      } as unknown as ModuleManifest,
    },
  ];
  const assets = { openAssetBytes: vi.fn(async () => ({ bytes: new Uint8Array([0x89, 0x50]), mimeType: 'image/png' })) };
  const log = vi.fn();
  const renderer = new DocumentRenderer({
    registry,
    resolver,
    declarations: new BlockDeclarations(() => manifests, isPresent),
    assets,
    now: () => new Date('2026-10-17T10:00:00.000Z'),
    log,
  });
  return { renderer, present, assets, log };
}

const row = (id: string, content: unknown, over: Partial<TemplateRow> = {}): TemplateRow => ({
  id,
  documentType: 'acme.note',
  salesChannelId: null,
  isDefault: true,
  version: 4,
  content: { schemaVersion: 1, languages: { 'en-US': content } },
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  documentType: 'acme.note',
  salesChannelId: A,
  language: 'en-US',
  data: { title: 'Real' },
  ...over,
});

const texts = (definition: { content: unknown }) =>
  (definition.content as { text?: unknown }[]).map((c) => c.text);

describe('DocumentRenderer — palette and presence', () => {
  it('skips a block outside the type palette (another type’s block)', async () => {
    const { renderer } = setup({
      rows: [row('t1', tree([node('acme.Body', { text: 'a' }), node('comparisons.ComparisonTable', {}), node('document_templates.Heading', { text: 'not offered' })]))],
    });
    const built = await renderer.buildDefinition(input());
    expect(texts(built.definition)).toEqual(['a|Real|-|calm']);
  });

  it('skips a block whose owner is absent and leaves its stored props untouched', async () => {
    const stored = { id: 's', keep: { deep: 1 } };
    const content = tree([node('acme.Body', { text: 'a' }), node('ksef.Stamp', stored)]);
    const { renderer, present } = setup({ rows: [row('t1', content)] });
    present.delete('ksef');
    const built = await renderer.buildDefinition(input());
    expect(texts(built.definition)).toEqual(['a|Real|-|calm']);
    expect(stored).toEqual({ id: 's', keep: { deep: 1 } });
  });

  it('merges declared defaultProps under stored props', async () => {
    const { renderer } = setup({ rows: [row('t1', tree([node('acme.Body', { tone: undefined })]))] });
    const built = await renderer.buildDefinition(input());
    expect(texts(built.definition)).toEqual(['default text|Real|-|calm']);
  });

  it('hands every block the result of prepareRender, once, with the placed names', async () => {
    const prepareRender = vi.fn(async () => ({ stamp: 'P' }));
    const { renderer } = setup({
      rows: [row('t1', tree([node('acme.Body', { text: '1' }), node('acme.Body', { text: '2' }), node('ksef.Stamp')]))],
      registration: { prepareRender },
    });
    const built = await renderer.buildDefinition(input());
    expect(texts(built.definition)).toEqual(['1|Real|P|calm', '2|Real|P|calm', 'stamp']);
    expect(prepareRender).toHaveBeenCalledTimes(1);
    expect(prepareRender).toHaveBeenCalledWith({ title: 'Real' }, { placedBlocks: new Set(['acme.Body', 'ksef.Stamp']), preview: false });
  });
});

describe('DocumentRenderer — fall-through', () => {
  it('a default whose tree prints nothing falls through to the built-in tree', async () => {
    const { renderer } = setup({ rows: [row('t1', tree([node('gone.Block')]))] });
    const built = await renderer.buildDefinition(input());
    expect(built.source).toBe('built_in');
    expect(texts(built.definition)).toEqual(['built-in tree|Real|-|calm']);
  });

  it('uses renderBuiltIn last, with prepareRender told nothing was placed', async () => {
    const prepareRender = vi.fn(async () => ({ stamp: 'B' }));
    const { renderer } = setup({
      rows: [row('t1', tree([]))],
      registration: {
        defaultContent: () => ({ schemaVersion: 1, languages: { 'en-US': tree([node('gone.Block')]) } }),
        renderBuiltIn: (data, prepared) => [{ text: `code ${data.title} ${prepared.stamp}` }],
        prepareRender,
      },
    });
    const built = await renderer.buildDefinition(input());
    expect(texts(built.definition)).toEqual(['code Real B']);
    expect(prepareRender).toHaveBeenCalledWith({ title: 'Real' }, { placedBlocks: null, preview: false });
  });

  it('refuses an empty document for a type with no code layout', async () => {
    const { renderer } = setup({
      registration: { defaultContent: () => ({ schemaVersion: 1, languages: { 'en-US': tree([node('gone.Block')]) } }) },
    });
    await expect(renderer.buildDefinition(input())).rejects.toMatchObject({ code: 'DOCUMENT_RENDER_FAILED' });
  });

  it('answers DOCUMENT_TYPE_NOT_AVAILABLE for an absent host, before reading anything', async () => {
    const { renderer, present } = setup({});
    present.delete('acme');
    await expect(renderer.buildDefinition(input())).rejects.toMatchObject({ code: 'DOCUMENT_TYPE_NOT_AVAILABLE', statusCode: 404 });
  });

  it('renders an explicitly chosen template and reports a missing one', async () => {
    const { renderer } = setup({
      rows: [row('pick', tree([node('acme.Body', { text: 'picked' })]), { isDefault: false }), row('def', tree([node('acme.Body', { text: 'default' })]))],
    });
    const picked = await renderer.buildDefinition(input({ templateId: 'pick' }));
    expect(picked.source).toBe('explicit');
    expect(texts(picked.definition)).toEqual(['picked|Real|-|calm']);
    const missing = await renderer.buildDefinition(input({ templateId: '00000000-0000-4000-8000-000000000000' }));
    expect(missing.requestedTemplateMissing).toBe(true);
    expect(texts(missing.definition)).toEqual(['default|Real|-|calm']);
  });
});

describe('DocumentRenderer — page', () => {
  it('applies the type pageDefaults under stored root props, and its styles', async () => {
    const { renderer } = setup({
      rows: [row('t1', tree([node('acme.Body')], { marginTop: 10, baseFontSize: 99 }))],
      registration: {
        pageDefaults: { orientation: 'portrait', marginTop: 40, marginRight: 40, marginBottom: 48, marginLeft: 40, styles: { docTitle: { bold: true } } },
      },
    });
    const { definition } = await renderer.buildDefinition(input());
    expect(definition.pageMargins).toEqual([40, 10, 40, 48]);
    expect(definition.defaultStyle).toEqual({ fontSize: 10, font: 'Roboto' });
    expect(definition.styles).toEqual({ docTitle: { bold: true } });
    expect(definition.pageOrientation).toBeUndefined();
    expect(definition.header).toBeUndefined();
    expect(definition.footer).toBeUndefined();
    expect(definition.info).toBeUndefined();
  });

  it("'auto' orientation asks the type, and defaults to portrait", async () => {
    const landscape = setup({ rows: [row('t1', tree([node('acme.Body')]))], registration: { suggestOrientation: () => 'landscape' } });
    expect((await landscape.renderer.buildDefinition(input())).definition.pageOrientation).toBe('landscape');
    const plain = setup({ rows: [row('t1', tree([node('acme.Body')]))] });
    expect((await plain.renderer.buildDefinition(input())).definition.pageOrientation).toBeUndefined();
  });

  it('prints header and footer with merge fields and page numbers', async () => {
    const { renderer } = setup({
      rows: [row('t1', tree([node('acme.Body')], { headerText: 'Offer {{date}}', footerText: 'Acme · {{who}}', showPageNumbers: true }))],
      registration: { resolveVariables: () => ({ who: 'Anna' }) },
    });
    const { definition } = await renderer.buildDefinition(input());
    const header = (definition.header as (p: number, n: number) => { text: string })(1, 3);
    expect(header.text).toBe('Offer October 17, 2026');
    const footer = (definition.footer as (p: number, n: number) => { columns: { text: string }[] })(2, 3);
    expect(footer.columns.map((c) => c.text)).toEqual(['Acme · Anna', '2 / 3']);
  });
});

describe('DocumentRenderer — failures', () => {
  it('turns a block that throws into DOCUMENT_RENDER_FAILED and logs template, version and block', async () => {
    const { renderer, log } = setup({
      rows: [row('t1', tree([node('acme.Body')]))],
      blocks: [{ name: 'acme.Body', moduleId: 'acme', render: () => { throw new Error('boom'); } }],
    });
    await expect(renderer.buildDefinition(input())).rejects.toMatchObject({ code: 'DOCUMENT_RENDER_FAILED', statusCode: 503 });
    expect(log).toHaveBeenCalledWith(
      '[document_templates] a block failed to render',
      expect.objectContaining({ templateId: 't1', templateVersion: 4, blockName: 'acme.Body' }),
    );
  });

  it('re-throws a ModuleDisabledError untouched', async () => {
    const { renderer } = setup({
      rows: [row('t1', tree([node('acme.Body')]))],
      blocks: [{ name: 'acme.Body', moduleId: 'acme', render: () => { throw new ModuleDisabledError('catalog'); } }],
    });
    await expect(renderer.buildDefinition(input())).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});

describe('DocumentRenderer — images and preview', () => {
  it('inlines a core Image from the assets library and never fetches a URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { renderer, assets } = setup({
      rows: [row('t1', tree([node('document_templates.Image', { assetId: 'logo', src: 'https://x.test/a.png' })]))],
    });
    const { definition } = await renderer.buildDefinition(input());
    expect((definition.content as { image?: string }[])[0]!.image).toMatch(/^data:image\/png;base64,/);
    expect(assets.openAssetBytes).toHaveBeenCalledWith('logo');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('previews an unsaved canvas, marked as a preview, falling back when it prints nothing', async () => {
    const prepareRender = vi.fn(async () => ({ stamp: 'pv' }));
    const { renderer } = setup({ registration: { prepareRender } });
    const canvas = await renderer.buildDefinition(
      input({ salesChannelId: null, tree: tree([node('acme.Body', { text: 'canvas' })]) }),
    );
    expect(canvas.source).toBe('canvas');
    expect(texts(canvas.definition)).toEqual(['canvas|Real|pv|calm']);
    expect(prepareRender).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ preview: true }));
    const empty = await renderer.buildDefinition(input({ salesChannelId: null, tree: tree([]) }));
    expect(empty.source).toBe('built_in');
  });

  it('produces PDF bytes (smoke)', async () => {
    const { renderer } = setup({ rows: [row('t1', tree([node('acme.Body'), node('document_templates.Text', { text: 'Zażółć gęślą jaźń' })]))] });
    const result = await renderer.render(input());
    expect(Buffer.from(result.bytes.subarray(0, 5)).toString('utf8')).toBe('%PDF-');
    expect(result).toMatchObject({ source: 'default', templateId: 't1', templateVersion: 4, language: 'en-US', requestedTemplateMissing: false });
  });
});

// ---------------------------------------------------------------------------
// Feature 153 — the Line items table through the engine (T012, SC-007)
// ---------------------------------------------------------------------------

describe('DocumentRenderer — a type declaring a line collection (153)', () => {
  interface LinesData {
    readonly lines: readonly { readonly name: string; readonly qty: number }[];
  }

  /** A test-only type, under a test-only module id — it adopts the table by declaring data alone (SC-007). */
  function linesSetup(
    over: {
      fields?: () => Promise<DocumentFieldDefinition[]>;
      items?: (data: LinesData) => DocumentItem[];
      tables?: unknown[];
      sections?: (data: LinesData) => readonly DocumentItemSection[];
    } = {},
  ) {
    const isPresent = (id: string) => id === 'fixturemod' || id === 'document_templates';
    const registry = new DocumentTypeRegistry(isPresent, () => undefined);
    const fields = vi.fn(over.fields ?? (async () => [
      { path: 'name', label: 'Name', valueKind: 'text' as const, group: 'line', audience: 'customer' as const },
      { path: 'qty', label: 'Qty', valueKind: 'number' as const, group: 'line', audience: 'customer' as const },
    ]));
    const items = vi.fn(over.items ?? ((data: LinesData) => data.lines.map((l) => ({ values: { name: { kind: 'text' as const, value: l.name }, qty: { kind: 'number' as const, value: l.qty } } }))));
    const sections = over.sections ? vi.fn(over.sections) : undefined;
    const tableNode = (cols: string[], extra: Record<string, unknown> = {}) =>
      node('document_templates.ItemsTable', { columns: cols.map((f, i) => ({ id: `c${i}`, field: f })), ...extra });
    registry.register({
      code: 'fixturemod.lines_doc',
      moduleId: 'fixturemod',
      labelKey: 'x',
      blocks: () => [],
      coreBlocks: 'none',
      selection: 'default_only',
      defaultContent: () => ({
        schemaVersion: 1,
        languages: { 'en-US': tree((over.tables as never[]) ?? [tableNode(['row.number', 'name', 'qty'])]) },
      }),
      sampleData: () => ({ lines: [{ name: 'Sample', qty: 1 }] }),
      collections: [
        {
          key: 'lines',
          labelKey: 'l',
          fields,
          items,
          summaryFields: async () => [{ path: 'count', label: 'Count', valueKind: 'number', group: 'total', audience: 'customer' }],
          summary: (data: LinesData) => ({ count: { kind: 'number', value: data.lines.length } }),
          ...(sections ? { sections } : {}),
        },
      ],
    } as DocumentTypeRegistration<LinesData>);
    const log = vi.fn();
    const renderer = new DocumentRenderer({
      registry,
      resolver: new TemplateResolver({ findDefaults: async () => [], findById: async () => null, findApplicable: async () => [] }),
      declarations: new BlockDeclarations(() => [], isPresent),
      assets: { openAssetBytes: vi.fn() },
      now: () => new Date('2026-10-17T10:00:00.000Z'),
      log,
    });
    return { renderer, fields, items, sections, log, tableNode };
  }

  const linesInput = { documentType: 'fixturemod.lines_doc', salesChannelId: null, language: 'en-US', data: { lines: [{ name: 'Bolt', qty: 3 }, { name: 'Nut', qty: 5 }] } };
  const bodyOf = (definition: { content: unknown }) =>
    ((definition.content as { stack: { table: { body: { text: string }[][] } }[] }[])[0]!.stack[0]!.table.body).map((row) => row.map((c) => c.text));

  it('prints the type’s own lines through the facility block, numbered', async () => {
    const { renderer } = linesSetup();
    const built = await renderer.buildDefinition(linesInput);
    expect(bodyOf(built.definition)).toEqual([
      ['No.', 'Name', 'Qty'],
      ['1', 'Bolt', '3'],
      ['2', 'Nut', '5'],
    ]);
  });

  it('loads the catalogue and the items once per collection per render, however many tables use it', async () => {
    const s = linesSetup();
    const twice = linesSetup({ tables: [s.tableNode(['name']), s.tableNode(['qty'], { totals: [{ field: 'count', label: 'n' }] })] });
    await twice.renderer.buildDefinition(linesInput);
    expect(twice.fields).toHaveBeenCalledTimes(1);
    expect(twice.items).toHaveBeenCalledTimes(1);
  });

  it('a catalogue that rejects prints the columns empty, logged, and the document still renders', async () => {
    const { renderer } = linesSetup({ fields: async () => { throw new Error('attributes down'); } });
    const built = await renderer.buildDefinition(linesInput);
    expect(bodyOf(built.definition)).toEqual([
      ['No.', '', ''],
      ['1', '', ''],
      ['2', '', ''],
    ]);
  });

  it('items() throwing fails the document naming the block', async () => {
    const { renderer, log } = linesSetup({ items: () => { throw new Error('bad data'); } });
    await expect(renderer.buildDefinition(linesInput)).rejects.toMatchObject({ code: 'DOCUMENT_RENDER_FAILED' });
    expect(log).toHaveBeenCalledWith(
      '[document_templates] a block failed to render',
      expect.objectContaining({ blockName: 'document_templates.ItemsTable' }),
    );
  });

  it('skips the table in a type that declares no collection', async () => {
    const { renderer } = setup({
      rows: [row('t1', tree([node('document_templates.ItemsTable', { columns: [{ id: 'a', field: 'name' }] }), node('acme.Body', { text: 'kept' })]))],
    });
    const built = await renderer.buildDefinition(input());
    expect(texts(built.definition)).toEqual(['kept|Real|-|calm']);
  });

  // Feature 159 (`specs/159-quote-request-item-groups/contracts/document-sections.md` §1, §3).
  const twoSections = (data: LinesData): DocumentItemSection[] => [
    { key: 'g1', kind: 'group', label: 'Hall A', itemIndexes: [0], summary: { count: { kind: 'number', value: 1 } } },
    {
      key: 'ungrouped',
      kind: 'ungrouped',
      label: null,
      itemIndexes: data.lines.slice(1).map((_, i) => i + 1),
      summary: { count: { kind: 'number', value: data.lines.length - 1 } },
    },
  ];

  it('159 — a type declaring sections prints them with no facility change (FR-040)', async () => {
    const s = linesSetup({ sections: twoSections });
    const built = await s.renderer.buildDefinition(linesInput);
    expect(bodyOf(built.definition)).toEqual([
      ['No.', 'Name', 'Qty'],
      ['Hall A · 1 item', '', ''],
      ['1', 'Bolt', '3'],
      ['Other items · 1 item', '', ''],
      ['2', 'Nut', '5'],
    ]);
  });

  it('159 — sections() once per collection per render, however many tables use it', async () => {
    const s = linesSetup({ sections: twoSections });
    const twice = linesSetup({ sections: twoSections, tables: [s.tableNode(['name']), s.tableNode(['qty'], { grouping: { by: 'none' } })] });
    await twice.renderer.buildDefinition(linesInput);
    expect(twice.sections).toHaveBeenCalledTimes(1);
  });

  it('159 — sections() throwing prints the table flat, logs once, and the document renders', async () => {
    const { renderer, log } = linesSetup({ sections: () => { throw new Error('bad groups'); } });
    const built = await renderer.buildDefinition(linesInput);
    expect(bodyOf(built.definition)).toEqual([
      ['No.', 'Name', 'Qty'],
      ['1', 'Bolt', '3'],
      ['2', 'Nut', '5'],
    ]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      '[document_templates] a collection’s sections could not be read; the table prints flat',
      expect.objectContaining({ documentType: 'fixturemod.lines_doc', collection: 'lines', error: 'bad groups' }),
    );
  });

  it('159 — a partition that does not cover the lines prints flat, logged once with the document type', async () => {
    const { renderer, log } = linesSetup({
      sections: () => [{ key: 'g1', kind: 'group', label: 'Hall A', itemIndexes: [1], summary: {} }],
    });
    const built = await renderer.buildDefinition(linesInput);
    expect(bodyOf(built.definition)).toHaveLength(3);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      '[document_templates] a collection’s sections do not partition its lines; the table prints flat',
      expect.objectContaining({ documentType: 'fixturemod.lines_doc', collection: 'lines' }),
    );
  });

  it('159 — a type that declares no sections is not asked and prints as 153', async () => {
    const { renderer, log } = linesSetup();
    const built = await renderer.buildDefinition(linesInput);
    expect(bodyOf(built.definition)).toHaveLength(3);
    expect(log).not.toHaveBeenCalled();
  });

  it('produces PDF bytes with a long table (smoke)', async () => {
    const { renderer } = linesSetup();
    const lines = Array.from({ length: 120 }, (_, i) => ({ name: `Line ${i + 1}`, qty: i }));
    const result = await renderer.render({ ...linesInput, data: { lines } });
    expect(Buffer.from(result.bytes.subarray(0, 5)).toString('utf8')).toBe('%PDF-');
  });
});

describe('DocumentRenderer.listChoices (153 contract §5)', () => {
  it('answers the selection list of a per_document type', async () => {
    const { renderer } = setup({ rows: [row('t1', tree([node('acme.Body')]), { name: 'Main' } as never)] });
    const choices = await renderer.listChoices({ documentType: 'acme.note', salesChannelId: A });
    expect(choices).toEqual({
      templates: [{ id: 't1', name: 'Main', salesChannelId: null, languages: ['en-US'], isDefault: true }],
      effectiveDefaultId: 't1',
      builtInLanguages: ['en-US'],
    });
  });

  it('refuses a default_only type and an unavailable one', async () => {
    const defaultOnly = setup({ registration: { selection: 'default_only' } });
    await expect(defaultOnly.renderer.listChoices({ documentType: 'acme.note', salesChannelId: null })).rejects.toMatchObject({
      code: 'DOCUMENT_TEMPLATE_NOT_SELECTABLE',
      statusCode: 422,
    });
    const absent = setup({});
    absent.present.delete('acme');
    await expect(absent.renderer.listChoices({ documentType: 'acme.note', salesChannelId: null })).rejects.toMatchObject({
      code: 'DOCUMENT_TYPE_NOT_AVAILABLE',
      statusCode: 404,
    });
  });
});
