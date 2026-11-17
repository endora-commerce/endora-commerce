/**
 * The translated label of an enum value — a status, a kind, an actor type — for
 * every admin screen (issue #1434, DS-17).
 *
 * A module declares its enum once, as a map from each value the API sends to the
 * catalogue key that names it, and renders the value only through the result:
 *
 *   export const rfqStatusLabels = defineEnumLabels({
 *     Pending: 'rfq.status.pending',
 *     …
 *   });
 *   <Badge>{rfqStatusLabels.label(t, rfq.status)}</Badge>
 *
 * The map lives in the module that owns the enum (Principle I); this file holds
 * only the two rules every map shares, so no screen re-decides them:
 *
 * - **A value the map does not declare is shown as itself.** That is a value the
 *   API learned before the admin did. The code is ugly but true, where
 *   `t('carts.status.' + value)` would print a missing-key placeholder that is
 *   neither.
 * - **No value is the dash**, as every other empty cell in the admin is.
 *
 * Every key is written out rather than built from a prefix, so a key search
 * finds the screen that reads it.
 */
export type EnumTranslate = (key: string, params?: Record<string, string | number>) => string;

/** What an empty cell shows. */
const NO_VALUE = '—';

export interface EnumLabels<V extends string> {
  /** The declared values, in declaration order — the order a filter lists them in. */
  readonly values: readonly V[];
  /** Whether `value` is one the map declares. */
  has(value: string | null | undefined): value is V;
  /** `value`'s label in the reader's language; itself when undeclared, the dash when empty. */
  label(t: EnumTranslate, value: string | null | undefined): string;
  /** One `{ value, label }` per declared value, for a select or a multi-select. */
  options(t: EnumTranslate): Array<{ value: V; label: string }>;
}

export function defineEnumLabels<V extends string>(keys: Readonly<Record<V, string>>): EnumLabels<V> {
  const values = Object.keys(keys) as V[];
  const has = (value: string | null | undefined): value is V =>
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(keys, value);
  const label = (t: EnumTranslate, value: string | null | undefined): string => {
    if (value === null || value === undefined || value === '') return NO_VALUE;
    return has(value) ? t(keys[value]) : value;
  };
  return {
    values,
    has,
    label,
    options: (t) => values.map((value) => ({ value, label: t(keys[value]) })),
  };
}
