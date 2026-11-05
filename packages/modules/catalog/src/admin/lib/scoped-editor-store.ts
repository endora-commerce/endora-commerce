import {
  fromScopedWriteOp,
  type GlobalOnlyProductFields,
  type ScopeRef,
  type ScopedFieldView,
  type ScopedValueChanges,
  type ScopedValuesData,
  type ScopedWriteOp,
} from '@endora-commerce/contracts';

/**
 * Feature 174 (T093, `contracts/editor-ui.md` §3) — the product editor's state at one scope:
 * the read answer, the version it carried and the changes staged on top of it.
 *
 * Staged changes belong to the current scope and survive tab switches; a scope switch, a
 * Discard and a successful Save clear them. An immediate action (a gallery item removed, a
 * packaging unit added …) refreshes **one family** of the view and keeps `staged` and
 * `version` as they were (R7: structural Commands do not bump the version); staged cells of a
 * subject that action removed are dropped and listed in `dropped`, for the page to announce.
 *
 * Keys of `staged` are the contracts' field paths (`data-model.md` §9) plus `product:<field>`
 * for the global-only product row fields a Save at Global writes.
 */

export type ProductRowField = keyof GlobalOnlyProductFields;
export type EditorFieldPath = string;
export type StagedChanges = ReadonlyMap<EditorFieldPath, ScopedWriteOp<unknown>>;
export type ImmediateFamily = 'gallery' | 'attachments' | 'packagingUnits';

export interface ScopedEditorState {
  scope: ScopeRef;
  /** `null` while a scope is loading: no value of the previous scope is shown as current (FR-057). */
  data: ScopedValuesData | null;
  /** The version the next Save sends — the one of the last read or save, never of an immediate action. */
  version: string | null;
  staged: StagedChanges;
  /** Fields whose "Use value from …" box the operator unticked without typing yet (FR-061). */
  unticked: ReadonlySet<EditorFieldPath>;
  /** Per-field error text of the last refused Save. */
  errors: Readonly<Record<EditorFieldPath, string>>;
  busy: boolean;
  /** Staged cells the last family refresh dropped because their subject is gone. */
  dropped: readonly EditorFieldPath[];
}

export type ScopedEditorAction =
  | { type: 'switching'; scope: ScopeRef }
  | { type: 'loaded'; data: ScopedValuesData }
  | { type: 'stage'; path: EditorFieldPath; op: ScopedWriteOp<unknown> | undefined }
  | { type: 'untick'; path: EditorFieldPath }
  | { type: 'tick'; path: EditorFieldPath }
  | { type: 'discard' }
  | { type: 'errors'; errors: Record<EditorFieldPath, string> }
  | { type: 'refreshFamily'; family: ImmediateFamily; data: ScopedValuesData }
  | { type: 'dropPaths'; paths: readonly EditorFieldPath[] }
  /** A write outside the Save bumped the version (the copy, §4): the next Save sends it; staged cells stay. */
  | { type: 'version'; version: string };

export function initialEditorState(scope: ScopeRef): ScopedEditorState {
  return { scope, data: null, version: null, staged: new Map(), unticked: new Set(), errors: {}, busy: true, dropped: [] };
}

/** The field's own value exists at the read's scope (its source is `set` or `set_empty`). */
export function hasOwnValue(fieldView: ScopedFieldView<unknown> | null): boolean {
  return fieldView !== null && (fieldView.source === 'set' || fieldView.source === 'set_empty');
}

const ROLE_KEYS = { base_image: 'baseImage', small_image: 'smallImage', thumbnail: 'thumbnail' } as const;
type RoleLabel = keyof typeof ROLE_KEYS;

/** The view of one field path in a read answer; `null` for an unknown path or subject. */
export function fieldViewAt(data: ScopedValuesData, path: EditorFieldPath): ScopedFieldView<unknown> | null {
  const fields = data.fields as Record<string, ScopedFieldView<unknown>>;
  if (Object.hasOwn(fields, path)) return fields[path] ?? null;
  const [family, a, b] = path.split(':');
  if (family === 'attribute') return data.attributes.find((attr) => attr.key === a)?.view ?? null;
  if (family === 'seo') return data.seo ? ((data.seo as Record<string, ScopedFieldView<unknown>>)[a ?? ''] ?? null) : null;
  if (family === 'galleryRole') {
    const key = ROLE_KEYS[a as RoleLabel];
    return key ? data.gallery.roles[key] : null;
  }
  if (family === 'gallery') {
    const item = data.gallery.items.find((i) => i.id === a);
    if (!item) return null;
    return b === 'altText' ? item.altText : b === 'hidden' ? item.hidden : null;
  }
  if (family === 'attachment') {
    const att = data.attachments.find((i) => i.id === a);
    if (!att) return null;
    return b === 'name' ? att.name : b === 'description' ? att.description : b === 'hidden' ? att.hidden : null;
  }
  if (family === 'packagingUnit') {
    const unit = data.packagingUnits.find((i) => i.id === a);
    return unit && b === 'name' ? unit.name : null;
  }
  return null;
}

function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V | undefined): Map<K, V> {
  const next = new Map(map);
  if (value === undefined) next.delete(key);
  else next.set(key, value);
  return next;
}

function withMember<K>(set: ReadonlySet<K>, key: K, present: boolean): Set<K> {
  const next = new Set(set);
  if (present) next.add(key);
  else next.delete(key);
  return next;
}

function withoutError(errors: Readonly<Record<string, string>>, path: string): Record<string, string> {
  if (!Object.hasOwn(errors, path)) return errors as Record<string, string>;
  const next = { ...errors };
  delete next[path];
  return next;
}

/** Whether a staged path still has its subject in `data` (and, for a role, its target item). */
function subjectExists(data: ScopedValuesData, path: EditorFieldPath, op: ScopedWriteOp<unknown>): boolean {
  if (path.startsWith('galleryRole:')) {
    return op.op !== 'set' || data.gallery.items.some((item) => item.id === op.value);
  }
  if (/^(gallery|attachment|packagingUnit):/.test(path)) return fieldViewAt(data, path) !== null;
  return true;
}

function familyOf(path: EditorFieldPath): ImmediateFamily | null {
  if (path.startsWith('gallery:') || path.startsWith('galleryRole:')) return 'gallery';
  if (path.startsWith('attachment:')) return 'attachments';
  if (path.startsWith('packagingUnit:')) return 'packagingUnits';
  return null;
}

export function scopedEditorReducer(state: ScopedEditorState, action: ScopedEditorAction): ScopedEditorState {
  switch (action.type) {
    case 'switching':
      return { ...initialEditorState(action.scope) };
    case 'loaded':
      return {
        scope: action.data.scope,
        data: action.data,
        version: action.data.version,
        staged: new Map(),
        unticked: new Set(),
        errors: {},
        busy: false,
        dropped: [],
      };
    case 'stage':
      return {
        ...state,
        staged: withEntry(state.staged, action.path, action.op),
        unticked: action.op === undefined ? state.unticked : withMember(state.unticked, action.path, false),
        errors: withoutError(state.errors, action.path),
      };
    case 'untick': {
      // Unticking a staged `inherit` restores the own value: unstage (FR-062).
      if (state.staged.get(action.path)?.op === 'inherit') {
        return { ...state, staged: withEntry(state.staged, action.path, undefined), errors: withoutError(state.errors, action.path) };
      }
      return { ...state, unticked: withMember(state.unticked, action.path, true), errors: withoutError(state.errors, action.path) };
    }
    case 'tick': {
      const own = state.data ? hasOwnValue(fieldViewAt(state.data, action.path)) : false;
      return {
        ...state,
        staged: withEntry(state.staged, action.path, own ? { op: 'inherit' } : undefined),
        unticked: withMember(state.unticked, action.path, false),
        errors: withoutError(state.errors, action.path),
      };
    }
    case 'discard':
      return { ...state, staged: new Map(), unticked: new Set(), errors: {}, dropped: [] };
    case 'errors':
      return { ...state, errors: action.errors };
    case 'refreshFamily': {
      if (!state.data) return state;
      const merged: ScopedValuesData = { ...state.data, [action.family]: action.data[action.family] };
      const dropped: string[] = [];
      for (const [path, op] of state.staged) {
        if (familyOf(path) === action.family && !subjectExists(merged, path, op)) dropped.push(path);
      }
      const staged = new Map(state.staged);
      for (const path of dropped) staged.delete(path);
      return { ...state, data: merged, staged, dropped };
    }
    case 'dropPaths': {
      const staged = new Map(state.staged);
      for (const path of action.paths) staged.delete(path);
      return { ...state, staged, dropped: action.paths.filter((p) => state.staged.has(p)) };
    }
    case 'version':
      return { ...state, version: action.version, data: state.data ? { ...state.data, version: action.version } : null };
  }
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The `changes` body of a `PUT …/scoped-values` for the staged cells (`scoped-values-api.md` §3). */
export function stagedToChanges(staged: StagedChanges): ScopedValueChanges {
  const changes: Writable<Record<string, unknown>> = {};
  const nested = (key: string): Record<string, unknown> => {
    const existing = changes[key] as Record<string, unknown> | undefined;
    if (existing) return existing;
    const created: Record<string, unknown> = {};
    changes[key] = created;
    return created;
  };
  const sub = (parent: Record<string, unknown>, key: string): Record<string, unknown> => {
    const existing = parent[key] as Record<string, unknown> | undefined;
    if (existing) return existing;
    const created: Record<string, unknown> = {};
    parent[key] = created;
    return created;
  };
  for (const [path, op] of staged) {
    const wire = fromScopedWriteOp(op);
    const [family, a, b] = path.split(':');
    if (!path.includes(':')) changes[path] = wire;
    else if (family === 'product' && a && op.op === 'set') nested('product')[a] = op.value;
    else if (family === 'attribute' && a) nested('attributes')[a] = wire;
    else if (family === 'seo' && a) nested('seo')[a] = wire;
    else if (family === 'galleryRole' && a) sub(nested('gallery'), 'roles')[ROLE_KEYS[a as RoleLabel]] = wire;
    else if (family === 'gallery' && a && b) sub(sub(nested('gallery'), 'items'), a)[b] = wire;
    else if (family === 'attachment' && a && b) sub(nested('attachments'), a)[b] = wire;
    else if (family === 'packagingUnit' && a && b) sub(nested('packagingUnits'), a)[b] = wire;
  }
  return changes as ScopedValueChanges;
}

/** The request form of a scope (`scoped-values-api.md` §1): neither → G, channel → C, both → C×L. */
export function scopeToRequest(scope: ScopeRef): { channelId?: string; languageCode?: string } {
  if (scope.level === 'global') return {};
  if (scope.level === 'channel') return { channelId: scope.channelId };
  return { channelId: scope.channelId, languageCode: scope.languageCode };
}
