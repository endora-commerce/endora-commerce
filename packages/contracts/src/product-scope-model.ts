/**
 * Feature 168 (`specs/168-product-editor-scope-switcher/`; research R1, data-model §0 and §9) —
 * the one scope vocabulary of product data and the one resolver every store feeds.
 *
 * Three levels, widest first: **Global** (the product row), **Channel** (a sales channel, no
 * language) and **Channel × language**. There is no Language-only scope anywhere (FR-010).
 *
 * A store hands the resolver rows of one shape, {@link ScopedRow}: a row's **presence** is the
 * override, whatever its value (FR-013). A row whose value is `{ kind: 'empty' }` is an empty
 * override and stops the fallback; no row inherits from the scope above.
 *
 * Its only import is type-only, so every other contract file may import it without a
 * runtime cycle. It is shared by the backend and the admin SPA (feature 022 precedent).
 */

import type { AttributeValueType } from './catalog.js';

// --- 1. Vocabulary ----------------------------------------------------------------------------

/** A scope as the server and the editor address it. */
export type ScopeRef =
  | { level: 'global' }
  | { level: 'channel'; channelId: string }
  | { level: 'channel_language'; channelId: string; languageCode: string };

/** The level of a scope in the short form the scope sets use. */
export type ScopeLevel = 'G' | 'C' | 'CL';

/** Every level, widest first. */
export const SCOPE_LEVELS: readonly ScopeLevel[] = ['G', 'C', 'CL'];

/** A stored value at one scope: a value, or an empty override (FR-013). */
export type ScopedValue<T> = { kind: 'value'; value: T } | { kind: 'empty' };

/** One stored override, in the shape every store's adapter produces. `languageCode null` = C. */
export interface ScopedRow<T> {
  channelId: string;
  languageCode: string | null;
  value: ScopedValue<T>;
}

/**
 * Where an effective value comes from (FR-109): `set` — own value at this scope; `set_empty` —
 * own empty override; `inherited_channel` / `inherited_global` — from the scope above (the
 * value may be `null` when that scope holds an empty override); `absent` — no value at any scope.
 */
export type ScopedSource = 'set' | 'set_empty' | 'inherited_channel' | 'inherited_global' | 'absent';

export const SCOPED_SOURCES: readonly ScopedSource[] = [
  'set',
  'set_empty',
  'inherited_channel',
  'inherited_global',
  'absent',
];

export interface ScopedResolution<T> {
  /** The effective value; `null` when the answer is an empty override or there is none. */
  value: T | null;
  source: ScopedSource;
}

/** `G`, `C` or `CL` for a scope. */
export function levelOf(scope: ScopeRef): ScopeLevel {
  if (scope.level === 'global') return 'G';
  if (scope.level === 'channel') return 'C';
  return 'CL';
}

/**
 * Whether two language tags name the same language as a channel spells it — compared
 * case-insensitively (`de-DE` = `de-de`), never by base language. `null` / `undefined` (no
 * language: a channel or global row) equals only itself. The one comparison every scope, key
 * and value read uses.
 */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The scope a request names (`contracts/scoped-values-api.md` §1): neither → Global, a channel
 * only → Channel, both → Channel × language. A language without a channel is refused — there
 * is no Language scope (FR-010); the caller answers `422 VALIDATION_FAILED`,
 * `details.field = 'scope'`. Membership and offered languages are the caller's check.
 */
export function scopeFromRequest(input: {
  channelId?: string | null | undefined;
  languageCode?: string | null | undefined;
}):
  | { ok: true; scope: ScopeRef }
  | { ok: false; reason: 'language_without_channel' } {
  const channelId = input.channelId ?? null;
  const languageCode = input.languageCode ?? null;
  if (channelId === null) {
    return languageCode === null ? { ok: true, scope: { level: 'global' } } : { ok: false, reason: 'language_without_channel' };
  }
  if (languageCode === null) return { ok: true, scope: { level: 'channel', channelId } };
  return { ok: true, scope: { level: 'channel_language', channelId, languageCode } };
}

// --- 2. The resolver --------------------------------------------------------------------------

function toResolution<T>(value: ScopedValue<T>, own: boolean, inheritedFrom: 'inherited_channel'): ScopedResolution<T> {
  if (value.kind === 'empty') return { value: null, source: own ? 'set_empty' : inheritedFrom };
  return { value: value.value, source: own ? 'set' : inheritedFrom };
}

/**
 * The effective value of one field at `scope`: `row(C, L) ?? row(C, null) ?? global`,
 * restricted to `levels` (the field's scope set). A row present at a level wins whatever it
 * holds; an empty row is the answer (FR-013). `global` `null` / `undefined` = no Global value.
 * Rows of another channel or language never match, so orphaned rows are ignored by
 * construction (163 FR-015).
 */
export function resolveScoped<T>(input: {
  global: T | null | undefined;
  rows: readonly ScopedRow<T>[];
  scope: ScopeRef;
  levels: readonly ScopeLevel[];
}): ScopedResolution<T> {
  const { scope, levels, rows } = input;
  const global = input.global ?? null;
  const fromGlobal = (own: boolean): ScopedResolution<T> =>
    global === null ? { value: null, source: 'absent' } : { value: global, source: own ? 'set' : 'inherited_global' };

  if (scope.level === 'global') return fromGlobal(true);

  if (scope.level === 'channel_language' && levels.includes('CL')) {
    const own = rows.find((row) => row.channelId === scope.channelId && row.languageCode !== null && sameLanguage(row.languageCode, scope.languageCode));
    if (own !== undefined) return toResolution(own.value, true, 'inherited_channel');
  }

  if (levels.includes('C')) {
    const channelRow = rows.find((row) => row.channelId === scope.channelId && row.languageCode === null);
    if (channelRow !== undefined) return toResolution(channelRow.value, scope.level === 'channel', 'inherited_channel');
  }

  return fromGlobal(false);
}

// --- 3. Field scope sets (data-model §9) ------------------------------------------------------

/** What a field accepts: its scope set, whether it is required, whether it takes an empty override. */
export interface FieldScopeSpec {
  levels: readonly ScopeLevel[];
  /** Refuses an empty override (`required_empty`, FR-062). */
  required: boolean;
  /** Takes an empty override at all; single selects and booleans do not (`not_emptyable`). */
  emptyable: boolean;
}

const ALL: readonly ScopeLevel[] = ['G', 'C', 'CL'];
const GC: readonly ScopeLevel[] = ['G', 'C'];
const ONLY_G: readonly ScopeLevel[] = ['G'];

const spec = (levels: readonly ScopeLevel[], required: boolean, emptyable: boolean): FieldScopeSpec =>
  Object.freeze({ levels, required, emptyable });

/** The SEO fields catalog's save writes through `seo`'s port (`contracts/seo-ports.md`). */
export const SEO_PRODUCT_META_FIELDS = ['title', 'description', 'ogTitle', 'ogDescription', 'ogImageUrl'] as const;
export type SeoProductMetaField = (typeof SEO_PRODUCT_META_FIELDS)[number];

/** The gallery roles a scope can reassign. */
export const GALLERY_ROLE_LABELS = ['base_image', 'small_image', 'thumbnail'] as const;
export type GalleryRoleLabel = (typeof GALLERY_ROLE_LABELS)[number];

/**
 * The scope set of every product field family except user attributes (those derive theirs
 * from the definition, {@link attributeFieldSpec}). A field not listed is global-only (spec
 * *Terms*). Subject families are keyed without the subject id: `gallery:altText` covers
 * `gallery:<itemId>:altText`.
 */
export const PRODUCT_FIELD_SCOPE_SETS = Object.freeze({
  name: spec(ALL, true, false),
  description: spec(ALL, false, true),
  status: spec(ALL, false, false),
  window: spec(GC, false, true),
  audience: spec(GC, false, false),
  minOrderQuantity: spec(GC, false, true),
  returnable: spec(GC, false, false),
  urlKey: spec(ALL, true, false),
  'seo:title': spec(ALL, false, true),
  'seo:description': spec(ALL, false, true),
  'seo:ogTitle': spec(ALL, false, true),
  'seo:ogDescription': spec(ALL, false, true),
  'seo:ogImageUrl': spec(ALL, false, true),
  'gallery:altText': spec(ALL, false, true),
  'gallery:hidden': spec(ALL, false, false),
  galleryRole: spec(ALL, false, true),
  'attachment:name': spec(ALL, false, true),
  'attachment:description': spec(ALL, false, true),
  'attachment:hidden': spec(ALL, false, false),
  'packagingUnit:name': spec(ALL, false, true),
} satisfies Record<string, FieldScopeSpec>);

export type ProductFieldFamily = keyof typeof PRODUCT_FIELD_SCOPE_SETS;

/**
 * A scoped field path: a family of {@link PRODUCT_FIELD_SCOPE_SETS} with its subject id, or
 * `attribute:<key>`.
 */
export type FieldPath =
  | 'name'
  | 'description'
  | 'status'
  | 'window'
  | 'audience'
  | 'minOrderQuantity'
  | 'returnable'
  | 'urlKey'
  | `seo:${SeoProductMetaField}`
  | `attribute:${string}`
  | `gallery:${string}:altText`
  | `gallery:${string}:hidden`
  | `galleryRole:${GalleryRoleLabel}`
  | `attachment:${string}:${'name' | 'description' | 'hidden'}`
  | `packagingUnit:${string}:name`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The family row of a concrete field path, or `null` for an attribute path (use
 * {@link attributeFieldSpec}), a global-only or unknown field, or a malformed sub-field.
 */
export function fieldScopeSpec(path: string): FieldScopeSpec | null {
  const sets: Record<string, FieldScopeSpec> = PRODUCT_FIELD_SCOPE_SETS;
  if (!path.includes(':') || path.startsWith('seo:')) return Object.hasOwn(sets, path) ? sets[path]! : null;
  const parts = path.split(':');
  const [family, a, b] = parts;
  if (family === 'galleryRole' && parts.length === 2) {
    return (GALLERY_ROLE_LABELS as readonly string[]).includes(a!) ? sets['galleryRole']! : null;
  }
  if (parts.length !== 3 || !UUID.test(a!)) return null;
  const key = `${family}:${b}`;
  if (family !== 'gallery' && family !== 'attachment' && family !== 'packagingUnit') return null;
  return Object.hasOwn(sets, key) ? sets[key]! : null;
}

/** The scope set an attribute definition derives (R15): not scopable → G; text → G, C, CL; else G, C. */
export function attributeScopeSet(def: { scopable: boolean; valueType: AttributeValueType }): readonly ScopeLevel[] {
  if (!def.scopable) return ONLY_G;
  return def.valueType === 'string' ? ALL : GC;
}

/**
 * An attribute's {@link FieldScopeSpec}: its scope set, `required` from the definition, and
 * `emptyable` false for single selects (`enum`, `select`) and booleans (data-model §9).
 */
export function attributeFieldSpec(def: {
  scopable: boolean;
  valueType: AttributeValueType;
  isRequired: boolean;
}): FieldScopeSpec {
  const notEmptyable = def.valueType === 'enum' || def.valueType === 'select' || def.valueType === 'boolean';
  return { levels: attributeScopeSet(def), required: def.isRequired, emptyable: !notEmptyable && !def.isRequired };
}
