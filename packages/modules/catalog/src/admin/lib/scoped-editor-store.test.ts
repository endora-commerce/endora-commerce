import { describe, expect, it } from 'vitest';
import type { ScopedFieldView, ScopedValuesData } from '@endora-commerce/contracts';
import {
  initialEditorState,
  scopedEditorReducer,
  stagedToChanges,
  fieldViewAt,
  type ScopedEditorState,
} from './scoped-editor-store.js';

/**
 * Feature 170 (T093, `contracts/editor-ui.md` §3) — the editor's staged changes of one scope.
 * The store is pure: the editor's tests mount it through the page; this file holds its rules.
 */

const ITEM = '00000000-0000-4000-8000-0000000000a1';
const ITEM_2 = '00000000-0000-4000-8000-0000000000a2';
const ATT = '00000000-0000-4000-8000-0000000000b1';
const UNIT = '00000000-0000-4000-8000-0000000000c1';
const CHANNEL = '00000000-0000-4000-8000-0000000000d1';

function view<T>(value: T | null, over: Partial<ScopedFieldView<T>> = {}): ScopedFieldView<T> {
  return { value, source: value === null ? 'absent' : 'set', levels: ['G', 'C', 'CL'], supportedHere: true, required: false, ...over };
}

function data(over: Partial<ScopedValuesData> = {}): ScopedValuesData {
  return {
    scope: { level: 'channel', channelId: CHANNEL },
    version: '7',
    validScopes: { channels: [{ channelId: CHANNEL, name: 'B2B', languages: [{ code: 'pl-PL', name: 'Polish' }] }] },
    product: {
      sku: 'S', type: 'simple', attributeSetId: '00000000-0000-4000-8000-0000000000e1', categoryIds: [], archivedAt: null,
      slugGlobal: 's', manageStock: true, backorderEnabled: false, lowStockThreshold: null, lowStockThresholdMode: 'cumulative',
      fulfilmentStrategy: null, fulfilmentStrategyWarehouseOrder: null, downloadAssetId: null, downloadUrl: null, allowedOrganizationIds: [],
    },
    fields: {
      name: view('Drill', { source: 'inherited_global' }),
      description: view('Own', { source: 'set', ownValue: 'Own' }),
      status: view<'active' | 'inactive'>('active'),
      window: view({ from: null, until: null }),
      audience: view({ visibility: 'public' as const, allowedOrganizationIds: [] }),
      minOrderQuantity: view<number>(null),
      returnable: view(false),
      urlKey: view('drill'),
    },
    attributes: [],
    gallery: {
      items: [
        { id: ITEM, assetId: ITEM, url: 'u', position: 0, altText: view('alt'), hidden: view(false), assetAltText: null },
        { id: ITEM_2, assetId: ITEM_2, url: 'u2', position: 1, altText: view('alt2'), hidden: view(false), assetAltText: null },
      ],
      roles: { baseImage: view<string>(ITEM), smallImage: view<string>(null), thumbnail: view<string>(null) },
    },
    attachments: [{ id: ATT, assetId: ATT, typeId: ATT, position: 0, fileName: 'f.pdf', name: view('Manual'), description: view<string>(null), hidden: view(false) }],
    packagingUnits: [{ id: UNIT, baseQuantity: 6, position: 0, isDefault: true, minOrderUnits: null, name: view('Box') }],
    seo: null,
    completeness: { level: 'channel', missing: [] },
    organizations: [],
    ...over,
  };
}

function loaded(): ScopedEditorState {
  return scopedEditorReducer(initialEditorState({ level: 'global' }), { type: 'loaded', data: data() });
}

describe('scoped editor store', () => {
  it('a load takes the scope and the version of the answer and clears every staged change', () => {
    let state = loaded();
    state = scopedEditorReducer(state, { type: 'stage', path: 'name', op: { op: 'set', value: 'X' } });
    state = scopedEditorReducer(state, { type: 'loaded', data: data({ version: '8' }) });
    expect(state.scope).toEqual({ level: 'channel', channelId: CHANNEL });
    expect(state.version).toBe('8');
    expect(state.staged.size).toBe(0);
    expect(state.busy).toBe(false);
  });

  it('a switch marks the editor busy and keeps no value of the previous scope as current', () => {
    const state = scopedEditorReducer(loaded(), { type: 'switching', scope: { level: 'global' } });
    expect(state.busy).toBe(true);
    expect(state.data).toBeNull();
    expect(state.scope).toEqual({ level: 'global' });
  });

  it('unticking stages nothing; typing stages set; ticking an own value stages inherit (FR-061, FR-062)', () => {
    let state = scopedEditorReducer(loaded(), { type: 'untick', path: 'name' });
    expect(state.staged.has('name')).toBe(false);
    expect(state.unticked.has('name')).toBe(true);
    state = scopedEditorReducer(state, { type: 'stage', path: 'name', op: { op: 'set', value: 'Drill' } });
    // Untick then retype the inherited value: a pinned own value, not unstaged (prototype §11).
    expect(state.staged.get('name')).toEqual({ op: 'set', value: 'Drill' });
    state = scopedEditorReducer(state, { type: 'tick', path: 'description' });
    expect(state.staged.get('description')).toEqual({ op: 'inherit' });
    state = scopedEditorReducer(state, { type: 'untick', path: 'description' });
    expect(state.staged.has('description')).toBe(false);
  });

  it('ticking a field that inherits and was only unticked unstages it', () => {
    let state = scopedEditorReducer(loaded(), { type: 'untick', path: 'name' });
    state = scopedEditorReducer(state, { type: 'stage', path: 'name', op: { op: 'set', value: 'New' } });
    state = scopedEditorReducer(state, { type: 'tick', path: 'name' });
    expect(state.staged.has('name')).toBe(false);
    expect(state.unticked.has('name')).toBe(false);
  });

  it('a family refresh keeps the staged changes and the version, and drops the cells of a removed subject', () => {
    let state = loaded();
    state = scopedEditorReducer(state, { type: 'stage', path: `gallery:${ITEM_2}:altText`, op: { op: 'set', value: 'x' } });
    state = scopedEditorReducer(state, { type: 'stage', path: 'galleryRole:small_image', op: { op: 'set', value: ITEM_2 } });
    state = scopedEditorReducer(state, { type: 'stage', path: 'name', op: { op: 'set', value: 'Kept' } });
    const next = data({ version: '9' });
    next.gallery.items = next.gallery.items.filter((i) => i.id !== ITEM_2);
    state = scopedEditorReducer(state, { type: 'refreshFamily', family: 'gallery', data: next });
    expect(state.version).toBe('7');
    expect(state.staged.get('name')).toEqual({ op: 'set', value: 'Kept' });
    expect(state.staged.has(`gallery:${ITEM_2}:altText`)).toBe(false);
    expect(state.staged.has('galleryRole:small_image')).toBe(false);
    expect(state.dropped).toEqual([`gallery:${ITEM_2}:altText`, 'galleryRole:small_image']);
    expect(state.data?.gallery.items).toHaveLength(1);
  });

  it('finds the view of every field path', () => {
    const d = data();
    expect(fieldViewAt(d, 'name')?.value).toBe('Drill');
    expect(fieldViewAt(d, `gallery:${ITEM}:altText`)?.value).toBe('alt');
    expect(fieldViewAt(d, 'galleryRole:base_image')?.value).toBe(ITEM);
    expect(fieldViewAt(d, `attachment:${ATT}:name`)?.value).toBe('Manual');
    expect(fieldViewAt(d, `packagingUnit:${UNIT}:name`)?.value).toBe('Box');
    expect(fieldViewAt(d, 'seo:title')).toBeNull();
  });
});

describe('stagedToChanges — the PUT body of the staged cells (scoped-values-api.md §3)', () => {
  it('maps every family onto the nested body in the write encoding', () => {
    const staged = new Map<string, import('@endora-commerce/contracts').ScopedWriteOp<unknown>>([
      ['name', { op: 'set', value: 'N' }],
      ['description', { op: 'empty' }],
      ['status', { op: 'inherit' }],
      ['product:sku', { op: 'set', value: 'SKU-2' }],
      ['attribute:colour', { op: 'set', value: 'blue' }],
      [`gallery:${ITEM}:altText`, { op: 'empty' }],
      [`gallery:${ITEM}:hidden`, { op: 'set', value: true }],
      ['galleryRole:base_image', { op: 'set', value: ITEM }],
      [`attachment:${ATT}:name`, { op: 'inherit' }],
      [`packagingUnit:${UNIT}:name`, { op: 'set', value: 'Karton' }],
      ['seo:title', { op: 'set', value: 'T' }],
    ]);
    expect(stagedToChanges(staged)).toEqual({
      name: 'N',
      description: null,
      status: { inherit: true },
      product: { sku: 'SKU-2' },
      attributes: { colour: 'blue' },
      gallery: { items: { [ITEM]: { altText: null, hidden: true } }, roles: { baseImage: ITEM } },
      attachments: { [ATT]: { name: { inherit: true } } },
      packagingUnits: { [UNIT]: { name: 'Karton' } },
      seo: { title: 'T' },
    });
  });

  it('sends nothing for an empty stage', () => {
    expect(stagedToChanges(new Map())).toEqual({});
  });
});
