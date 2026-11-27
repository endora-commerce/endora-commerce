// Shared vectors for admin form extensions (`specs/193-admin-form-extensions/`
// `contracts/field-rules.md` §6, SC-002).
//
// One table, three readers: this package's tests run the conditions through
// `evaluateFieldCondition`; the platform's field-rule check tests and the
// admin-kit's form tests run the same conditions and the format vectors through
// their own code. A rule the form shows and a rule the server enforces cannot
// drift while all three read this file.
//
// Data only. It is compiled into `dist` on purpose, so a consumer's test
// imports it as `@endora-commerce/contracts/admin-forms.vectors`, and it must
// therefore import nothing a consumer's install lacks (no `vitest`).

import type { FieldCondition, FieldFormat } from './admin-forms.js';

/** One evaluation: `evaluateFieldCondition(condition, values)` must answer `expected`. */
export interface FieldConditionVector {
  readonly name: string;
  readonly condition: FieldCondition;
  readonly values: Readonly<Record<string, unknown>>;
  readonly expected: boolean;
}

export const FIELD_CONDITION_VECTORS: readonly FieldConditionVector[] = [
  // equals / notEquals: strict, no coercion between types.
  { name: 'equals a string', condition: { field: 'kind', op: 'equals', value: 'company' }, values: { kind: 'company' }, expected: true },
  { name: 'equals a different string', condition: { field: 'kind', op: 'equals', value: 'company' }, values: { kind: 'person' }, expected: false },
  { name: 'equals does not coerce a number to a string', condition: { field: 'size', op: 'equals', value: 1 }, values: { size: '1' }, expected: false },
  { name: 'equals a number', condition: { field: 'size', op: 'equals', value: 1 }, values: { size: 1 }, expected: true },
  { name: 'equals a boolean', condition: { field: 'vip', op: 'equals', value: true }, values: { vip: true }, expected: true },
  { name: 'equals true is false for a truthy string', condition: { field: 'vip', op: 'equals', value: true }, values: { vip: 'true' }, expected: false },
  { name: 'equals null matches null', condition: { field: 'parentId', op: 'equals', value: null }, values: { parentId: null }, expected: true },
  { name: 'equals null matches an absent field', condition: { field: 'parentId', op: 'equals', value: null }, values: {}, expected: true },
  { name: 'equals a string is false for an absent field', condition: { field: 'kind', op: 'equals', value: 'company' }, values: {}, expected: false },
  { name: 'equals on an array field is membership', condition: { field: 'tags', op: 'equals', value: 'b2b' }, values: { tags: ['b2c', 'b2b'] }, expected: true },
  { name: 'equals on an array field without the member', condition: { field: 'tags', op: 'equals', value: 'b2b' }, values: { tags: ['b2c'] }, expected: false },
  { name: 'notEquals a different string', condition: { field: 'kind', op: 'notEquals', value: 'company' }, values: { kind: 'person' }, expected: true },
  { name: 'notEquals the same string', condition: { field: 'kind', op: 'notEquals', value: 'company' }, values: { kind: 'company' }, expected: false },
  { name: 'notEquals a string is true for an absent field', condition: { field: 'kind', op: 'notEquals', value: 'company' }, values: {}, expected: true },
  { name: 'notEquals null is false for an absent field', condition: { field: 'parentId', op: 'notEquals', value: null }, values: {}, expected: false },
  // in: one of the listed values; on an array field, any member.
  { name: 'in a listed value', condition: { field: 'country', op: 'in', value: ['PL', 'DE'] }, values: { country: 'DE' }, expected: true },
  { name: 'in an unlisted value', condition: { field: 'country', op: 'in', value: ['PL', 'DE'] }, values: { country: 'FR' }, expected: false },
  { name: 'in does not coerce', condition: { field: 'size', op: 'in', value: [1, 2] }, values: { size: '1' }, expected: false },
  { name: 'in a listed number', condition: { field: 'size', op: 'in', value: [1, 2] }, values: { size: 2 }, expected: true },
  { name: 'in is false for an absent field', condition: { field: 'country', op: 'in', value: ['PL'] }, values: {}, expected: false },
  { name: 'in on an array field with a common member', condition: { field: 'tags', op: 'in', value: ['b2b', 'vip'] }, values: { tags: ['vip'] }, expected: true },
  { name: 'in on an array field with no common member', condition: { field: 'tags', op: 'in', value: ['b2b'] }, values: { tags: ['vip'] }, expected: false },
  // isEmpty: undefined, null, '' after trim, [] — and nothing else.
  { name: 'isEmpty for an absent field', condition: { field: 'emails', op: 'isEmpty' }, values: {}, expected: true },
  { name: 'isEmpty for undefined', condition: { field: 'emails', op: 'isEmpty' }, values: { emails: undefined }, expected: true },
  { name: 'isEmpty for null', condition: { field: 'emails', op: 'isEmpty' }, values: { emails: null }, expected: true },
  { name: 'isEmpty for an empty string', condition: { field: 'name', op: 'isEmpty' }, values: { name: '' }, expected: true },
  { name: 'isEmpty for whitespace only', condition: { field: 'name', op: 'isEmpty' }, values: { name: ' \t\n ' }, expected: true },
  { name: 'isEmpty for an empty array', condition: { field: 'emails', op: 'isEmpty' }, values: { emails: [] }, expected: true },
  { name: 'isEmpty is false for zero', condition: { field: 'size', op: 'isEmpty' }, values: { size: 0 }, expected: false },
  { name: 'isEmpty is false for false', condition: { field: 'vip', op: 'isEmpty' }, values: { vip: false }, expected: false },
  { name: 'isEmpty is false for an empty object', condition: { field: 'address', op: 'isEmpty' }, values: { address: {} }, expected: false },
  { name: 'isEmpty is false for an array of one empty string', condition: { field: 'emails', op: 'isEmpty' }, values: { emails: [''] }, expected: false },
  { name: 'isEmpty is false for text', condition: { field: 'name', op: 'isEmpty' }, values: { name: ' a ' }, expected: false },
  { name: 'isNotEmpty for text', condition: { field: 'name', op: 'isNotEmpty' }, values: { name: 'Acme' }, expected: true },
  { name: 'isNotEmpty for whitespace only', condition: { field: 'name', op: 'isNotEmpty' }, values: { name: '  ' }, expected: false },
  { name: 'isNotEmpty for an absent field', condition: { field: 'name', op: 'isNotEmpty' }, values: {}, expected: false },
  // Field lookup is an own key of the values, never a path and never the prototype.
  { name: 'a slot key is a flat key', condition: { field: 'acme_erp.code', op: 'equals', value: 'A1' }, values: { 'acme_erp.code': 'A1' }, expected: true },
  { name: 'a dotted key is not a path', condition: { field: 'acme_erp.code', op: 'isEmpty' }, values: { acme_erp: { code: 'A1' } }, expected: true },
  { name: 'a prototype member is not a value', condition: { field: 'constructor', op: 'isEmpty' }, values: {}, expected: true },
  // Combinators.
  {
    name: 'all of two true leaves',
    condition: { all: [{ field: 'kind', op: 'equals', value: 'company' }, { field: 'name', op: 'isNotEmpty' }] },
    values: { kind: 'company', name: 'Acme' },
    expected: true,
  },
  {
    name: 'all with one false leaf',
    condition: { all: [{ field: 'kind', op: 'equals', value: 'company' }, { field: 'name', op: 'isNotEmpty' }] },
    values: { kind: 'company', name: '' },
    expected: false,
  },
  {
    name: 'any with one true leaf',
    condition: { any: [{ field: 'kind', op: 'equals', value: 'company' }, { field: 'vip', op: 'equals', value: true }] },
    values: { kind: 'person', vip: true },
    expected: true,
  },
  {
    name: 'any with no true leaf',
    condition: { any: [{ field: 'kind', op: 'equals', value: 'company' }, { field: 'vip', op: 'equals', value: true }] },
    values: { kind: 'person', vip: false },
    expected: false,
  },
  { name: 'not of a true leaf', condition: { not: { field: 'vip', op: 'equals', value: true } }, values: { vip: true }, expected: false },
  { name: 'not of a false leaf', condition: { not: { field: 'vip', op: 'equals', value: true } }, values: {}, expected: true },
  {
    name: 'nesting at the depth cap',
    condition: { all: [{ any: [{ not: { field: 'country', op: 'in', value: ['PL'] } }] }] },
    values: { country: 'DE' },
    expected: true,
  },
];

/**
 * Conditions `FieldConditionSchema` must refuse. Depth counts every level, a
 * leaf included, so `{ field, op }` is depth 1 and the cap of 4 admits three
 * combinators above a leaf.
 */
const leaf = { field: 'kind', op: 'isEmpty' } as const;

export const FIELD_CONDITION_SCHEMA_REFUSALS: readonly { readonly name: string; readonly condition: unknown }[] = [
  { name: 'depth 5', condition: { not: { all: [{ any: [{ not: leaf }] }] } } },
  { name: '17 leaves', condition: { all: Array.from({ length: 17 }, () => leaf) } },
  { name: '17 leaves across branches', condition: { any: [{ all: Array.from({ length: 9 }, () => leaf) }, { all: Array.from({ length: 8 }, () => leaf) }] } },
  { name: 'an unknown operator', condition: { field: 'kind', op: 'contains', value: 'a' } },
  { name: 'equals without a value', condition: { field: 'kind', op: 'equals' } },
  { name: 'equals with an object value', condition: { field: 'kind', op: 'equals', value: { a: 1 } } },
  { name: 'in with a scalar value', condition: { field: 'kind', op: 'in', value: 'a' } },
  { name: 'in with an empty list', condition: { field: 'kind', op: 'in', value: [] } },
  { name: 'in with a boolean member', condition: { field: 'kind', op: 'in', value: [true] } },
  { name: 'isEmpty with a value', condition: { field: 'kind', op: 'isEmpty', value: 'a' } },
  { name: 'an empty all', condition: { all: [] } },
  { name: 'an empty any', condition: { any: [] } },
  { name: 'two combinators in one node', condition: { all: [leaf], any: [leaf] } },
  { name: 'a leaf with an extra key', condition: { ...leaf, when: 'now' } },
  { name: 'an empty field name', condition: { field: '', op: 'isEmpty' } },
];

/**
 * Hostile sizes (issue #2018): the schema must answer each with an ordinary
 * failure, quickly — never a thrown `RangeError` from recursing into it, and
 * never a full parse of a payload already over a cap.
 */
export function deepNotCondition(depth: number): unknown {
  let condition: unknown = leaf;
  for (let i = 0; i < depth; i += 1) condition = { not: condition };
  return condition;
}

export const FIELD_CONDITION_HOSTILE_REFUSALS: readonly { readonly name: string; readonly condition: () => unknown }[] = [
  { name: '20 000 nested not', condition: () => deepNotCondition(20_000) },
  { name: 'an all of 200 000 leaves', condition: () => ({ all: Array.from({ length: 200_000 }, () => leaf) }) },
  { name: 'an any of 200 000 leaves', condition: () => ({ any: Array.from({ length: 200_000 }, () => leaf) }) },
  { name: 'an in of 200 000 values', condition: () => ({ field: 'kind', op: 'in', value: Array.from({ length: 200_000 }, (_, i) => i) }) },
  { name: '20 000 nested all', condition: () => {
    let condition: unknown = leaf;
    for (let i = 0; i < 20_000; i += 1) condition = { all: [condition] };
    return condition;
  } },
];

/** Conditions at the caps, which the schema must accept. */
export const FIELD_CONDITION_SCHEMA_ACCEPTS: readonly { readonly name: string; readonly condition: FieldCondition }[] = [
  { name: 'a bare leaf', condition: leaf },
  { name: 'depth 4', condition: { not: { all: [{ any: [leaf] }] } } },
  { name: '16 leaves', condition: { all: Array.from({ length: 16 }, () => leaf) } },
  { name: 'equals null', condition: { field: 'parentId', op: 'equals', value: null } },
  { name: 'in with mixed strings and numbers', condition: { field: 'size', op: 'in', value: ['1', 2] } },
];

/**
 * Accept and refuse values per platform format (`input-controls.md` §1). The
 * platform's server validators and the admin-kit's client twins both run this
 * table; it is deliberately the clear cases only, so neither end is pinned to
 * a corner the other cannot reach.
 */
export const FIELD_FORMAT_VECTORS: Readonly<
  Record<FieldFormat, { readonly accept: readonly string[]; readonly refuse: readonly string[] }>
> = {
  email: {
    accept: ['anna@example.com', 'a.b+c@sub.example.pl'],
    refuse: ['', 'anna', 'anna@', '@example.com', 'anna @example.com', 'anna@example'],
  },
  tel: {
    accept: ['+48 600 100 200', '+48600100200', '600-100-200', '(22) 123 45 67'],
    refuse: ['', 'abc', '+48 600 100 200 ext', '12', '++48600100200'],
  },
  url: {
    accept: ['https://example.com', 'http://example.com/path?q=1'],
    refuse: ['', 'example.com', 'ftp://example.com', 'https://', 'javascript:alert(1)'],
  },
  country: {
    accept: ['PL', 'DE', 'US'],
    refuse: ['', 'pl', 'POL', 'P', 'XX1'],
  },
  color: {
    accept: ['#000000', '#a1B2c3'],
    refuse: ['', '000000', '#abc', '#gggggg', 'red'],
  },
};

// ---------------------------------------------------------------------------
// Layout (`field-slots.md` §5, SC-005)
// ---------------------------------------------------------------------------

/** A slot field as the layout reads it: its wire key is `<moduleId>.<key>`. */
export interface FormLayoutVectorSlot {
  readonly moduleId: string;
  readonly key: string;
  readonly anchor:
    | { readonly field: string; readonly position: 'before' | 'after' }
    | { readonly section: string; readonly position: 'start' | 'end' };
  readonly weight: number;
  readonly visibleWhen?: FieldCondition;
}

/** A `position` override of a core key: to another section, and/or before or after a key. */
export interface FormLayoutVectorMove {
  readonly moduleId: string;
  readonly key: string;
  readonly section?: string;
  readonly before?: string;
  readonly after?: string;
}

/**
 * One form's layout: the declared sections, the effective overrides that move,
 * hide or condition a core key, the slots, and the values conditions read.
 * `expected` lists each rendered section's items in order — a core key, or a
 * slot's wire key `<moduleId>.<key>`. A section with no item is not listed.
 */
export interface FormLayoutVector {
  readonly name: string;
  readonly sections: readonly { readonly key: string; readonly keys: readonly string[] }[];
  readonly moves?: readonly FormLayoutVectorMove[];
  readonly hidden?: readonly string[];
  readonly visibleWhen?: Readonly<Record<string, FieldCondition>>;
  readonly slots?: readonly FormLayoutVectorSlot[];
  readonly values?: Readonly<Record<string, unknown>>;
  readonly expected: readonly { readonly section: string; readonly items: readonly string[] }[];
}

const IDENTITY = { key: 'identity', keys: ['name', 'taxId', 'parentId'] } as const;
const ADDRESS = { key: 'address', keys: ['registeredAddress'] } as const;

/**
 * The normative layout cases. The CLI's `admin-forms` analysis and the
 * admin-kit's `DeclaredFormSection` both run this table, and each also runs it
 * with its slots and moves shuffled: registration order, bundle order and
 * process never change the result (SC-005).
 */
export const FORM_LAYOUT_VECTORS: readonly FormLayoutVector[] = [
  {
    name: 'core keys in declared order, sections in declared order',
    sections: [IDENTITY, ADDRESS],
    expected: [
      { section: 'identity', items: ['name', 'taxId', 'parentId'] },
      { section: 'address', items: ['registeredAddress'] },
    ],
  },
  {
    name: 'a slot before and a slot after a core key',
    sections: [IDENTITY],
    slots: [
      { moduleId: 'acme_erp', key: 'code', anchor: { field: 'taxId', position: 'after' }, weight: 0 },
      { moduleId: 'acme_erp', key: 'prefix', anchor: { field: 'taxId', position: 'before' }, weight: 0 },
    ],
    expected: [{ section: 'identity', items: ['name', 'acme_erp.prefix', 'taxId', 'acme_erp.code', 'parentId'] }],
  },
  {
    name: 'slots on one anchor and position sort by weight, then module id, then key',
    sections: [IDENTITY],
    slots: [
      { moduleId: 'zeta', key: 'a', anchor: { field: 'name', position: 'after' }, weight: 10 },
      { moduleId: 'beta', key: 'b', anchor: { field: 'name', position: 'after' }, weight: 0 },
      { moduleId: 'alpha', key: 'z', anchor: { field: 'name', position: 'after' }, weight: 10 },
      { moduleId: 'alpha', key: 'y', anchor: { field: 'name', position: 'after' }, weight: 10 },
      { moduleId: 'alpha', key: 'x', anchor: { field: 'name', position: 'after' }, weight: -5 },
    ],
    expected: [
      { section: 'identity', items: ['name', 'alpha.x', 'beta.b', 'alpha.y', 'alpha.z', 'zeta.a', 'taxId', 'parentId'] },
    ],
  },
  {
    name: 'a hidden core key renders nothing and keeps its anchor (the replacement pattern)',
    sections: [IDENTITY],
    hidden: ['taxId'],
    slots: [{ moduleId: 'acme_nip', key: 'nip', anchor: { field: 'taxId', position: 'after' }, weight: 0 }],
    expected: [{ section: 'identity', items: ['name', 'acme_nip.nip', 'parentId'] }],
  },
  {
    name: 'section start and end slots sit before the first item and after the last',
    sections: [IDENTITY],
    slots: [
      { moduleId: 'acme', key: 'last', anchor: { section: 'identity', position: 'end' }, weight: 0 },
      { moduleId: 'acme', key: 'first', anchor: { section: 'identity', position: 'start' }, weight: 0 },
      { moduleId: 'acme', key: 'before', anchor: { field: 'name', position: 'before' }, weight: 0 },
    ],
    expected: [{ section: 'identity', items: ['acme.first', 'acme.before', 'name', 'taxId', 'parentId', 'acme.last'] }],
  },
  {
    name: 'a slot anchored on its own module’s slot is emitted beside it, recursively',
    sections: [IDENTITY],
    slots: [
      { moduleId: 'acme', key: 'street', anchor: { field: 'name', position: 'after' }, weight: 0 },
      { moduleId: 'acme', key: 'zip', anchor: { field: 'acme.street', position: 'after' }, weight: 0 },
      { moduleId: 'acme', key: 'city', anchor: { field: 'acme.zip', position: 'after' }, weight: 0 },
      { moduleId: 'acme', key: 'label', anchor: { field: 'acme.street', position: 'before' }, weight: 0 },
      { moduleId: 'other', key: 'flag', anchor: { field: 'name', position: 'after' }, weight: 5 },
    ],
    expected: [
      { section: 'identity', items: ['name', 'acme.label', 'acme.street', 'acme.zip', 'acme.city', 'other.flag', 'taxId', 'parentId'] },
    ],
  },
  {
    name: 'a moved core key goes to its target; moved keys on one target order by (module id, key)',
    sections: [IDENTITY, ADDRESS],
    moves: [
      { moduleId: 'zeta', key: 'name', after: 'registeredAddress' },
      { moduleId: 'alpha', key: 'parentId', after: 'registeredAddress' },
      { moduleId: 'alpha', key: 'taxId', section: 'address' },
    ],
    expected: [{ section: 'address', items: ['registeredAddress', 'parentId', 'name', 'taxId'] }],
  },
  {
    name: 'a key moved before another stays before it, and slots follow the key they anchor on',
    sections: [IDENTITY],
    moves: [{ moduleId: 'acme', key: 'parentId', before: 'name' }],
    slots: [{ moduleId: 'acme', key: 'note', anchor: { field: 'parentId', position: 'after' }, weight: 0 }],
    expected: [{ section: 'identity', items: ['parentId', 'acme.note', 'name', 'taxId'] }],
  },
  {
    name: 'an item whose visibleWhen is false is dropped, and so is a section left with none',
    sections: [IDENTITY, ADDRESS],
    visibleWhen: { registeredAddress: { field: 'name', op: 'isNotEmpty' } },
    slots: [
      {
        moduleId: 'acme',
        key: 'vat',
        anchor: { field: 'taxId', position: 'after' },
        weight: 0,
        visibleWhen: { field: 'taxId', op: 'isNotEmpty' },
      },
    ],
    values: { name: '', taxId: '' },
    expected: [{ section: 'identity', items: ['name', 'taxId', 'parentId'] }],
  },
  {
    name: 'a slot whose anchor names nothing in the form is not rendered (the check refuses it)',
    sections: [IDENTITY],
    slots: [
      { moduleId: 'acme', key: 'lost', anchor: { field: 'nickname', position: 'after' }, weight: 0 },
      { moduleId: 'acme', key: 'stray', anchor: { section: 'billing', position: 'start' }, weight: 0 },
    ],
    expected: [{ section: 'identity', items: ['name', 'taxId', 'parentId'] }],
  },
];
