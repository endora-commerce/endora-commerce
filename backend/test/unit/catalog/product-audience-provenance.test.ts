import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { resolveModuleLayout } from '../../../scripts/lib/module-roots.js';
import {
  loadRegisteredModuleIds,
  modulesWithoutSources,
} from '../../../scripts/lib/module-population.js';

/**
 * Where a {@link ProductAudience} may come from (issue #227).
 *
 * ## What this guards, and what no check can
 *
 * The enumeration behind issue #227 — every read path that can return a product
 * — was built by hand, and a hand-built enumeration is the thing that goes
 * stale. The obvious guard is a predicate over product reads with no visibility
 * filter, in the shape of `check:module-boundary`'s SQL arm. It is not
 * buildable, for three reasons that are worth writing down so the next author
 * does not spend the afternoon discovering them:
 *
 *  1. **The reads are not SQL.** Exactly one product read in the tree is a raw
 *     statement against `products` that a buyer can reach, and it is the one
 *     that already enforces. The rest are `CatalogProductReadPort.find*` calls
 *     returning records, so a SQL-shaped predicate sees almost none of the
 *     population it claims to cover — a green that means "not looking".
 *  2. **"Was the record filtered?" is a dataflow question.** The record goes
 *     into a `Map`, through a `Promise.all`, down two service calls and into a
 *     serializer. `check:port-catches` follows a value one hop and needed a
 *     written rule to stop there; this needs many.
 *  3. **Most call sites are right not to enforce, and the ratio is what kills
 *     it.** An order line, an invoice, a stock worker, the search indexer and
 *     the feed generator all read every product on purpose. A check over that
 *     population is a 60-entry ledger of "not applicable", and a ledger nobody
 *     reads protects nothing.
 *
 * And a fourth, which is the decisive one: a call-presence check cannot see the
 * defect that produced this whole audit. Issue #174's type-ahead **had** a
 * filter — `status = 'active'`. What was wrong was the *scope*, and
 * `isProductVisibleTo(product, ANONYMOUS_PRODUCT_AUDIENCE)` written in a buyer
 * path is green to any check that looks for the call.
 *
 * ## So this guards the scope instead
 *
 * A `ProductAudience` says who is asking. There is exactly one honest source
 * for it — the actor the auth plugin resolved — and `productAudienceOf` is the
 * function that reads it. Every other construction of the shape is a hand-rolled
 * answer to "who is asking", written by someone who had the record and not the
 * request, and it is the shape that goes wrong.
 *
 * The ledger below is two-way: an unledgered construction fails, and so does a
 * ledger entry over a file that no longer constructs one. It is deliberately
 * short, and it is meant to stay short — a new entry is a claim that a module
 * knows better than the request who its caller is.
 */

const AUDIENCE_KEYS = ['organizationId', 'authenticated'] as const;

/**
 * The files allowed to build a `ProductAudience` from parts, and why.
 *
 * Every entry names a function that has an **identity** in hand and no request
 * — which is the only reason the shape may be assembled outside
 * `productAudienceOf`.
 */
const SANCTIONED_AUDIENCE_SOURCES: ReadonlyMap<string, string> = new Map([
  [
    // The platform's, since the relocation — `backend/src/http/product-audience.ts`
    // is a re-export shim and builds nothing.
    'packages/platform/src/http/product-audience.ts',
    'the resolver itself — reads `request.actor` and is the source every route uses',
  ],
  [
    'src/modules/carts/services/cart-service.ts',
    '`cartAudience` — a cart operation carries its own actor (`{ customer?, anonymousToken? }`) ' +
      'rather than a request, because the same service answers the merge and conversion paths',
  ],
  [
    // Repository-relative since feature 080's T040b moved `quote_requests` into
    // `packages/modules/`; the walk follows the module root, so the key does too.
    'packages/modules/quote_requests/src/backend/services/rfq-service.ts',
    '`rfqAudience` — an RFQ line is scoped by the `CustomerContext` the quote request is filed ' +
      'under, which is the organisation the allow-list has to name',
  ],
  [
    'src/modules/shopping_lists/services/shopping-list-service.ts',
    'the saved-list add, scoped by the `CustomerContext` that owns the list',
  ],
]);

interface AudienceConstruction {
  readonly path: string;
  readonly line: number;
}

/**
 * Object literals carrying both audience keys, as **AST nodes**.
 *
 * Reading nodes rather than text is what puts a comment quoting the shape — the
 * doc block above does exactly that — outside the population by construction,
 * rather than inside it behind an exclusion somebody has to remember.
 */
export function findAudienceConstructions(
  files: ReadonlyArray<{ path: string; source: string }>,
): AudienceConstruction[] {
  const found: AudienceConstruction[] = [];
  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.ES2022,
      true,
      file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const names = new Set(
          node.properties
            .map((property) => property.name)
            .filter((name): name is ts.Identifier | ts.StringLiteral =>
              name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name)),
            )
            .map((name) => name.text),
        );
        if (AUDIENCE_KEYS.every((key) => names.has(key))) {
          found.push({
            path: file.path,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return found;
}

async function walkSources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkSources(full)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('a ProductAudience comes from the request, not from a call site', () => {
  it('reports no construction outside the sanctioned sources, and no stale entry', async () => {
    // Every root a module's source can live in, derived (feature 080, T040a):
    // the application's own tree plus each module that has become a workspace
    // package. The layout also says where the generated index is, which is what
    // this walk's expectation comes from.
    const layout = await resolveModuleLayout();
    const paths = (await Promise.all(layout.sourceRoots.map(walkSources))).flat();

    // "Did the walk read the module tree, or a residue of it?" (issue #215).
    // The expected population is derived from the generated manifest index on
    // every run rather than written down, so a moved or half-moved module tree
    // is an error instead of a shorter, greener list.
    const registered = await loadRegisteredModuleIds(layout.manifestIndexPath);
    expect(registered.length, 'the manifest index registers no module').toBeGreaterThan(0);
    const missing = modulesWithoutSources({
      registered,
      files: paths,
      moduleIdOf: layout.moduleIdOfPath,
    });
    expect(missing, 'registered modules that contributed no source to the walk').toEqual([]);

    const files = await Promise.all(
      paths.map(async (path) => ({
        path: layout.displayOf(path),
        source: await readFile(path, 'utf8'),
      })),
    );

    const constructions = findAudienceConstructions(files);
    const constructedIn = new Set(constructions.map((c) => c.path));

    const unledgered = constructions
      .filter((c) => !SANCTIONED_AUDIENCE_SOURCES.has(c.path))
      .map((c) => `${c.path}:${c.line}`);
    expect(
      unledgered,
      'a ProductAudience built outside the resolver — the site is answering "who is asking" ' +
        'without the request that knows',
    ).toEqual([]);

    const stale = [...SANCTIONED_AUDIENCE_SOURCES.keys()].filter(
      (path) => !constructedIn.has(path),
    );
    expect(
      stale,
      'ledger entries whose file no longer builds a ProductAudience — delete the entry',
    ).toEqual([]);
  });

  it('every ledger entry carries a reason', () => {
    for (const [path, reason] of SANCTIONED_AUDIENCE_SOURCES) {
      expect(reason.length, `${path} has no reason`).toBeGreaterThan(30);
    }
  });
});

describe('findAudienceConstructions — the red proofs', () => {
  // Each fixture enters where a real run enters: source text at the top of the
  // analysis, never a pre-classified finding handed to the last step.

  it('reports a hand-rolled audience in a module that has no business resolving one', () => {
    const found = findAudienceConstructions([
      {
        path: 'src/modules/somewhere/services/leaky.ts',
        source: `
          export function forWhoever(orgId: string) {
            return isProductVisibleTo(product, { organizationId: orgId, authenticated: true });
          }
        `,
      },
    ]);
    expect(found).toEqual([{ path: 'src/modules/somewhere/services/leaky.ts', line: 3 }]);
  });

  it('reports the shape however the keys are spelled and ordered', () => {
    const found = findAudienceConstructions([
      {
        path: 'a.ts',
        source: `const a = { 'authenticated': false, other: 1, "organizationId": null };`,
      },
    ]);
    expect(found.map((f) => f.path)).toEqual(['a.ts']);
  });

  it('does not report a literal carrying only one of the two keys', () => {
    // `organizationId` alone is every tenant-scoped payload in the tree, and
    // `authenticated` alone is a session flag. Neither is an audience.
    const found = findAudienceConstructions([
      { path: 'a.ts', source: `const a = { organizationId: 'x' }; const b = { authenticated: true };` },
    ]);
    expect(found).toEqual([]);
  });

  it('does not report a comment or a string that quotes the shape', () => {
    // The doc block at the top of this very file writes the two keys out. A
    // text-level predicate reports the documentation written to prevent the
    // defect.
    const found = findAudienceConstructions([
      {
        path: 'a.ts',
        source: `
          /** Build it as { organizationId, authenticated } — but not here. */
          const note = "{ organizationId: 'x', authenticated: true }";
        `,
      },
    ]);
    expect(found).toEqual([]);
  });

  it('finds nothing in an empty file list, which is why the walk is guarded separately', () => {
    // Stated as a proof rather than assumed: this function cannot tell an empty
    // tree from a clean one, so the population guard above is not optional.
    expect(findAudienceConstructions([])).toEqual([]);
  });
});
