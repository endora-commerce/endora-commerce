import type { ScopeLevel } from '@endora-commerce/contracts';

/**
 * Feature 163 (FR-017 b), rewritten by feature 168 (`specs/168-product-editor-scope-switcher/`,
 * research R1, data-model §0) — the storefront's effective value restated as SQL, so a listing
 * can search, filter, count and sort by the value a card shows.
 *
 * The chain is `resolveScoped`'s: the (channel, language) override row, else the channel row
 * (`language_code is null`), else the Global value on the product row. A **present** row answers
 * whatever it holds; `{"v": null}` is an empty override and answers "nothing" — detected with
 * `jsonb_typeof(value -> 'v') = 'null'`, never with `->>`, which folds `null` and `""` (R22).
 *
 * `effective-value.sql.test.ts` and `backend/test/integration/catalog/effective-text-parity.test.ts`
 * hold the SQL equal to the TypeScript chain (T033, T035).
 *
 * Descriptions, never `raw()` fragments — the caller creates the key in the expression that
 * executes it (`catalog-query.service.ts`' rule). Every bound value is collected **as the SQL is
 * written**, so the placeholders and the values cannot come apart.
 */

/** Where the chain runs: the request's channel and its resolved content language. */
export interface EffectiveValueScope {
  channelId: string;
  /** Already resolved against the channel (`scopeLanguageOf`); `null` = the channel row only. */
  languageCode: string | null;
}

/** An SQL expression over a row alias, with the values its `?` placeholders bind, in order. */
export interface SqlExpression {
  sql: (alias: string) => string;
  params: unknown[];
}

/** Writes SQL left to right and binds each value where its `?` is written. */
class Writer {
  readonly params: unknown[] = [];
  bind(value: unknown): string {
    this.params.push(value);
    return '?';
  }
}

function render(build: (w: Writer, alias: string) => string): SqlExpression {
  const probe = new Writer();
  build(probe, 'a');
  return { sql: (alias) => build(new Writer(), alias), params: probe.params };
}

/** The `value` of one override row at a scope, or SQL `NULL` when there is no row. */
function overrideValue(w: Writer, alias: string, attributeKey: string, channelId: string, languageCode: string | null): string {
  const language =
    languageCode === null ? `o.language_code is null` : `lower(o.language_code) = lower(${w.bind(languageCode)}::text)`;
  return (
    `(select o.value from product_value_overrides o ` +
    `where o.product_id = ${alias}.id and o.attribute_key = ${w.bind(attributeKey)} ` +
    `and o.channel_id = ${w.bind(channelId)} and ${language} limit 1)`
  );
}

/**
 * The effective Name (or Description) at (channel, language) as one `text` expression. An empty
 * override answers `''` (a deliberately empty description sorts and searches as no text); no row
 * at C×L or C answers the Global text (`''` when the Global description is `null`).
 */
export function effectiveTextSql(attributeKey: 'name' | 'description', scope: EffectiveValueScope): SqlExpression {
  return render((w, alias) => {
    const text = (value: string) =>
      `(case when jsonb_typeof(${value} -> 'v') = 'string' then ${value} ->> 'v' else '' end)`;
    const legs: string[] = [];
    if (scope.languageCode !== null) {
      legs.push(`when x.cl is not null then ${text('x.cl')}`);
    }
    legs.push(`when x.c is not null then ${text('x.c')}`);
    const cl = scope.languageCode === null ? 'null::jsonb' : overrideValue(w, alias, attributeKey, scope.channelId, scope.languageCode);
    const c = overrideValue(w, alias, attributeKey, scope.channelId, null);
    return `(select case ${legs.join(' ')} else coalesce(${alias}.${attributeKey}, '') end from (select ${cl} as cl, ${c} as c) x)`;
  });
}

/**
 * The effective value of a user attribute as a `jsonb` expression, restricted to the attribute's
 * scope set: the C×L row's `v` (for a set holding `CL`), else the C row's (for `C`), else the
 * Global `attribute_values -> key`. An empty override answers JSON `null`.
 */
export function effectiveAttributeSql(
  attributeKey: string,
  levels: readonly ScopeLevel[],
  scope: EffectiveValueScope,
): SqlExpression {
  return render((w, alias) => {
    const base = `(${alias}.attribute_values -> ${w.bind(attributeKey)}::text)`;
    if (!levels.includes('C')) return base;
    const useCl = levels.includes('CL') && scope.languageCode !== null;
    const legs: string[] = [];
    if (useCl) legs.push(`when x.cl is not null then x.cl -> 'v'`);
    legs.push(`when x.c is not null then x.c -> 'v'`);
    const cl = useCl ? overrideValue(w, alias, attributeKey, scope.channelId, scope.languageCode) : 'null::jsonb';
    const c = overrideValue(w, alias, attributeKey, scope.channelId, null);
    return `(select case ${legs.join(' ')} else ${base} end from (select ${cl} as cl, ${c} as c) x)`;
  });
}
