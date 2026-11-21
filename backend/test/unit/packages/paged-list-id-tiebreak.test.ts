import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { discoverModulePackages } from '../../../scripts/lib/module-packages.js';
import { findRepoRoot } from '../../../scripts/lib/module-roots.js';

/**
 * Issue #1760 — an offset-paged list needs a total order, or rows sharing the
 * sort key repeat on one page and go missing from the next (#1621). So every
 * `em.find(...)` / `em.findAndCount(...)` whose options carry an `offset` must
 * end its `orderBy` on `id`.
 *
 * The rule is judged on the call's own `orderBy` when it is written inline: an
 * object literal whose last key is `id`, or an array literal whose last element
 * is one. An `orderBy` built elsewhere (a `sortClause(...)`, a variable) cannot
 * be judged from the call site, so it is named in {@link COMPUTED_ORDER_BY}
 * with where its tie-breaker lives — a new computed site fails until it is
 * named, and an entry whose site is gone fails as stale.
 *
 * Knex builders (`.orderBy(...).offset(...)`) are not walked; the few paged
 * ones are covered by the contract tests that ship with #1760.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);
if (repoRoot === null) throw new Error('[paged-list-id-tiebreak] no repository root above the test tree');
const root: string = repoRoot;

/** `<package-relative file>` → where that site's `id` tie-breaker is applied. */
const COMPUTED_ORDER_BY: Readonly<Record<string, string>> = {
  'packages/modules/carts/src/backend/services/cart-admin-service.ts':
    '`sortClause`; its `id` tie-breaker is #1621 (PR #1752)',
  'packages/modules/carts/src/backend/services/cart-organization-visibility-service.ts':
    '`sortClause` ends every sort on `id` (#1760)',
  'packages/modules/customer_accounts/src/backend/services/customer-account-lifecycle-ports.ts':
    'both `orderBy` assignments end on `id` (#1760)',
  'packages/modules/returns/src/backend/services/return-list-service.ts':
    'both branches of `orderBy` end on `id` (#1760)',
};

/**
 * `<package-relative file>` → a key other than `id` that is unique on its own
 * and so totals the order just as well. Each names the constraint that makes it so.
 */
const UNIQUE_TIE_BREAKER: Readonly<Record<string, { key: string; constraint: string }>> = {
  'packages/modules/crm/src/backend/services/opportunity-service.ts': {
    key: 'number',
    constraint: 'crm_opportunities_number_unique',
  },
};

interface Site {
  readonly file: string;
  readonly line: number;
  readonly verdict: 'ok' | 'missing-id' | 'computed';
}

function propertyName(node: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(node) && !ts.isShorthandPropertyAssignment(node)) return null;
  const name = node.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  return e;
}

function endsOn(expr: ts.Expression, key: string): boolean | null {
  const e = unwrap(expr);
  if (ts.isObjectLiteralExpression(e)) {
    const last = e.properties[e.properties.length - 1];
    return last !== undefined && propertyName(last) === key;
  }
  if (ts.isArrayLiteralExpression(e)) {
    const last = e.elements[e.elements.length - 1];
    return last !== undefined && !ts.isSpreadElement(last) ? endsOn(last, key) : null;
  }
  return null;
}

function sitesIn(file: string): Site[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const rel = relative(root, file);
  const sites: Site[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'find' || node.expression.name.text === 'findAndCount')
    ) {
      const options = node.arguments[2];
      if (options !== undefined && ts.isObjectLiteralExpression(unwrap(options))) {
        const props = (unwrap(options) as ts.ObjectLiteralExpression).properties;
        const paged = props.some((p) => propertyName(p) === 'offset');
        const orderBy = props.find((p) => propertyName(p) === 'orderBy');
        if (paged) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          let verdict: Site['verdict'] = 'missing-id';
          if (orderBy !== undefined) {
            const value = ts.isPropertyAssignment(orderBy) ? orderBy.initializer : null;
            const key = UNIQUE_TIE_BREAKER[rel]?.key ?? 'id';
            const judged = value === null ? null : endsOn(value, key);
            verdict = judged === null ? 'computed' : judged ? 'ok' : 'missing-id';
          }
          sites.push({ file: rel, line, verdict });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'dist' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts') && !full.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('paged list queries end their orderBy on id (issue #1760)', () => {
  const packages = discoverModulePackages(root);
  const files = packages.flatMap((pkg) => {
    const src = join(pkg.dir, 'src');
    try {
      return statSync(src).isDirectory() ? sourceFiles(src) : [];
    } catch {
      return [];
    }
  });
  const sites = files.flatMap(sitesIn);

  it('reads the module tree and finds paged sites in it', () => {
    expect(packages.length).toBeGreaterThan(20);
    expect(files.length).toBeGreaterThan(1000);
    // 21 paged sites when written; a walk that finds a fraction of them has gone blind.
    expect(sites.length).toBeGreaterThanOrEqual(19);
  });

  it('every inline orderBy on a paged find ends on id', () => {
    const missing = sites.filter((s) => s.verdict === 'missing-id').map((s) => `${s.file}:${s.line}`);
    expect(missing).toEqual([]);
  });

  it('every declared unique tie-breaker is still used by a paged site', () => {
    const judged = new Set(sites.filter((s) => s.verdict === 'ok').map((s) => s.file));
    for (const file of Object.keys(UNIQUE_TIE_BREAKER)) expect(judged, file).toContain(file);
  });

  it('every computed orderBy on a paged find is named, and every named one still exists', () => {
    const computed = new Set(sites.filter((s) => s.verdict === 'computed').map((s) => s.file));
    expect([...computed].sort()).toEqual(Object.keys(COMPUTED_ORDER_BY).sort());
  });
});
