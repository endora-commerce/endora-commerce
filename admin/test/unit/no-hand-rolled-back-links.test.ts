/**
 * One back link, drawn by the page header (issue #1549, UX audit 2026-11-17,
 * SALES-27).
 *
 * The way back from a detail, create or settings screen used to come in three
 * looks: the kit `PageHeader` `back` prop (a small muted chevron link above the
 * title), an outline "Back" button among the header's `actions`, and a ghost
 * button or plain link with an `ArrowLeft` above the header. Three looks for one
 * function break the Law of Similarity, and an outline button beside the page's
 * actions competes with them (Von Restorff). The pattern is
 * `<PageHeader back={{ label, to }} />`.
 *
 * The population is every non-test `.tsx` source of the admin SPA, the shell
 * and every module's `src/admin/` and `src/admin-ui/` that renders a
 * `<PageHeader`. In such a file a finding is:
 *
 * - `arrow` — an `<ArrowLeft>` icon: the back-arrow of a hand-made back link;
 * - `back-in-header` — a `Link`, `NavLink` or `a` labelled by a back key
 *   (`t('….back')`, `t('….backTo…')`) inside one of the header's own props
 *   other than `back` — the outline "Back" button among its `actions`;
 * - `back-above-header` — such a link, or a `<Back…>` component, drawn as a
 *   sibling before the `<PageHeader>`;
 * - `navigate-back` — a `navigate(-1)` call.
 *
 * A back-labelled link elsewhere on the page — an error's or a not-found
 * state's way out, a wizard's previous step — is that state's action, not the
 * page's way back, and is left alone.
 *
 * `LEDGER` is two-way, per file: an unlisted finding fails, and so does an
 * entry whose count no longer matches — migrating a screen deletes its entry.
 *
 * The label of the `back` link is the wording rule of the follow-up to #1549:
 * it names the destination, as that screen names itself — "Organizations",
 * never "Back to organizations", "All warehouses" or a bare "Back" (Law of
 * Similarity: one function, one wording; Jakob's Law: the breadcrumb
 * convention). The generic `common.action.back` ("Back" / "Wstecz") is kept
 * for a destination only the caller knows — `?returnTo=` — and is required
 * there, since the screen cannot name it. `backLabelFindings` checks that.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Hand-made back links still to migrate, keyed by repo-relative file. Empty since #1549 migrated
 * the last screen (New order): a new hand-made back link fails. */
const LEDGER: Record<string, { count: number; reason: string }> = {};

const LINKS = new Set(['a', 'Link', 'NavLink']);
const BACK_KEY = /(?:^|\.)back(?:To[A-Za-z]*)?$/;

function roots(): string[] {
  const fixed = ['admin/src', 'packages/admin-shell/src'];
  const modules = readdirSync(path.join(repoRoot, 'packages/modules')).flatMap((id) =>
    ['src/admin', 'src/admin-ui'].map((sub) => `packages/modules/${id}/${sub}`),
  );
  return [...fixed, ...modules].filter((rel) => existsSync(path.join(repoRoot, rel)));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(path.join(repoRoot, rel)).isDirectory()) {
      if (entry !== 'node_modules') out.push(...walk(rel));
    } else if (entry.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(entry)) out.push(rel);
  }
  return out;
}

function tagOf(node: ts.Node): string | null {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return null;
}

/** A call such as `t('x.back')` whose first argument is a back key. */
function isBackLabel(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const first = node.arguments[0];
  return first !== undefined && ts.isStringLiteralLike(first) && BACK_KEY.test(first.text);
}

function containsBackLabel(node: ts.Node): boolean {
  if (isBackLabel(node)) return true;
  return ts.forEachChild(node, (child) => (containsBackLabel(child) ? true : undefined)) ?? false;
}

/** A `Link` / `NavLink` / `a` labelled by a back key, at or under `node`. */
function backLinkUnder(node: ts.Node): ts.Node | null {
  const tag = tagOf(node);
  if (tag !== null && LINKS.has(tag) && ts.isJsxElement(node) && node.children.some(containsBackLabel)) return node;
  return ts.forEachChild(node, (child) => backLinkUnder(child) ?? undefined) ?? null;
}

/** `const backLink = (<Link …/>)` — what an identifier handed to a PageHeader prop stands for. */
function initializerOf(sf: ts.SourceFile, name: string): ts.Node | null {
  let found: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** `file:line kind` for every hand-made back link in a file that renders a PageHeader. */
export function handRolledBackLinks(file: string, source: string): string[] {
  if (!/<PageHeader\b/.test(source)) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const at = (node: ts.Node, kind: string): void => {
    found.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${kind}`);
  };
  const isPageHeader = (node: ts.Node): boolean => tagOf(node) === 'PageHeader';
  const visit = (node: ts.Node): void => {
    const tag = tagOf(node);
    if (tag === 'ArrowLeft') at(node, 'arrow');
    // In the header's own props: a back link among `actions` / `titleActions`.
    if (tag === 'PageHeader') {
      const opening = ts.isJsxElement(node) ? node.openingElement : (node as ts.JsxSelfClosingElement);
      for (const attribute of opening.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(sf) === 'back' || !attribute.initializer) continue;
        let value: ts.Node = attribute.initializer;
        if (ts.isJsxExpression(value) && value.expression && ts.isIdentifier(value.expression)) {
          value = initializerOf(sf, value.expression.text) ?? value;
        }
        const link = backLinkUnder(value);
        if (link) at(link, 'back-in-header');
      }
    }
    // Before the header, among its siblings: a back link drawn above it.
    const children = ts.isJsxElement(node) || ts.isJsxFragment(node) ? [...node.children] : [];
    const headerAt = children.findIndex(isPageHeader);
    for (const sibling of headerAt > 0 ? children.slice(0, headerAt) : []) {
      const siblingTag = tagOf(sibling);
      const link = backLinkUnder(sibling);
      if (link) at(link, 'back-above-header');
      else if (siblingTag !== null && /^Back[A-Z]/.test(siblingTag)) at(sibling, 'back-above-header');
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sf) === 'navigate' &&
      node.arguments.length === 1 &&
      node.arguments[0]!.getText(sf) === '-1'
    ) {
      at(node, 'navigate-back');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** The generic label — and the only one allowed when the destination is `?returnTo=`. */
const GENERIC_BACK_KEY = 'common.action.back';
/** Wording that says "go back" instead of naming where to: EN and PL openings. */
const BACK_WORDING = /^(?:back|go back|return to|all|wstecz|wróć|powrót|wszystkie)(?=\s|$)/i;

type Bundles = (namespace: string) => { en: Record<string, string>; pl: Record<string, string> } | null;

/** The JSON bundles a `useTranslation(namespace)` reads: `core` is `_i18n`, the rest a module id. */
function moduleBundles(namespace: string): ReturnType<Bundles> {
  const dir = path.join(repoRoot, 'packages/modules', namespace === 'core' ? '_i18n' : namespace, 'i18n');
  if (!existsSync(path.join(dir, 'en.json'))) return null;
  const read = (lang: string): Record<string, string> =>
    JSON.parse(readFileSync(path.join(dir, `${lang}.json`), 'utf8')) as Record<string, string>;
  return { en: read('en'), pl: read('pl') };
}

/** Each object literal a `back` expression can evaluate to — through `?:` and parentheses. */
function backObjects(node: ts.Node): ts.ObjectLiteralExpression[] {
  if (ts.isParenthesizedExpression(node)) return backObjects(node.expression);
  if (ts.isConditionalExpression(node)) return [...backObjects(node.whenTrue), ...backObjects(node.whenFalse)];
  if (ts.isObjectLiteralExpression(node)) return [node];
  return [];
}

function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) return property.initializer;
  }
  return null;
}

/** `t('key')` calls under `node`, as `[function, key]`. */
function translationCalls(node: ts.Node): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      const first = child.arguments[0];
      if (first !== undefined && ts.isStringLiteralLike(first)) out.push([child.expression.text, first.text]);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return out;
}

/**
 * `file:line kind key` for every PageHeader `back` label that does not name its destination:
 * `generic-label` (a bare "Back" to a known screen), `named-returnTo` (a destination only
 * `?returnTo=` knows, given a name), `back-wording` ("Back to …", "All …") and `unresolved`
 * (a key absent from the bundle its translation function reads).
 */
export function backLabelFindings(file: string, source: string, bundles: Bundles = moduleBundles): string[] {
  if (!/<PageHeader\b/.test(source)) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const namespaces = new Map<string, string>();
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(sf) === 'useTranslation'
    ) {
      const first = node.initializer.arguments[0];
      if (first && ts.isStringLiteralLike(first) && !namespaces.has(node.name.text)) namespaces.set(node.name.text, first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const objects: ts.ObjectLiteralExpression[] = [];
  const collect = (node: ts.Node): void => {
    if (tagOf(node) === 'PageHeader') {
      const opening = ts.isJsxElement(node) ? node.openingElement : (node as ts.JsxSelfClosingElement);
      for (const attribute of opening.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(sf) !== 'back') continue;
        const initializer = attribute.initializer;
        if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) continue;
        let value: ts.Node = initializer.expression;
        if (ts.isIdentifier(value)) value = initializerOf(sf, value.text) ?? value;
        for (const object of backObjects(value)) if (!objects.includes(object)) objects.push(object);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  for (const object of objects) {
    const label = propertyOf(object, 'label');
    const to = propertyOf(object, 'to');
    if (!label || !to) continue;
    const toReturnTo = /returnTo/.test(to.getText(sf));
    const line = sf.getLineAndCharacterOfPosition(object.getStart(sf)).line + 1;
    const calls = translationCalls(label);
    const generic = calls.some(([, key]) => key === GENERIC_BACK_KEY);
    if (generic && !toReturnTo) found.push(`${file}:${line} generic-label ${GENERIC_BACK_KEY}`);
    if (!generic && toReturnTo) found.push(`${file}:${line} named-returnTo ${to.getText(sf)}`);
    for (const [fn, key] of calls) {
      if (key === GENERIC_BACK_KEY) continue;
      const bundle = bundles(namespaces.get(fn) ?? '');
      const en = bundle?.en[key];
      const pl = bundle?.pl[key];
      if (en === undefined || pl === undefined) found.push(`${file}:${line} unresolved ${key}`);
      else if (BACK_WORDING.test(en) || BACK_WORDING.test(pl)) found.push(`${file}:${line} back-wording ${key}`);
    }
  }
  return found;
}

function findings(): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const root of roots()) {
    for (const file of walk(root)) {
      const hits = handRolledBackLinks(file, readFileSync(path.join(repoRoot, file), 'utf8'));
      if (hits.length > 0) found[file] = hits;
    }
  }
  return found;
}

describe('the way back is the PageHeader back prop, not a hand-made link (#1549)', () => {
  it('recognises the shapes it refuses', () => {
    expect(
      handRolledBackLinks('a.tsx', '<><Link to="/o"><ArrowLeft />{t(\'create.back\')}</Link><PageHeader title="x" /></>'),
    ).toEqual(['a.tsx:1 back-above-header', 'a.tsx:1 arrow']);
    expect(handRolledBackLinks('a.tsx', '<div><BackLink /><PageHeader title="x" /></div>')).toEqual([
      'a.tsx:1 back-above-header',
    ]);
    expect(
      handRolledBackLinks(
        'a.tsx',
        '<PageHeader title="x" actions={<Button asChild variant="outline"><Link to="/o">{t(\'common.action.back\')}</Link></Button>} />',
      ),
    ).toEqual(['a.tsx:1 back-in-header']);
    expect(
      handRolledBackLinks(
        'a.tsx',
        'const backLink = (<Link to="/o">{t(\'x.backToList\')}</Link>);\nconst el = <PageHeader title="x" actions={backLink} />;',
      ),
    ).toEqual(['a.tsx:1 back-in-header']);
    expect(handRolledBackLinks('a.tsx', '<><PageHeader title="x" /><Button onClick={() => navigate(-1)}>Back</Button></>')).toEqual([
      'a.tsx:1 navigate-back',
    ]);
  });

  it('leaves the back prop, a link elsewhere on the page and a page without a PageHeader alone', () => {
    expect(handRolledBackLinks('a.tsx', '<PageHeader title="x" back={{ label: t(\'x.back\'), to: \'/o\' }} />')).toEqual([]);
    expect(
      handRolledBackLinks('a.tsx', '<><PageHeader title="x" /><Alert><Link to="/o">{t(\'x.back\')}</Link></Alert></>'),
    ).toEqual([]);
    expect(handRolledBackLinks('a.tsx', '<><Link to="/o">{t(\'x.back\')}</Link><h1>x</h1></>')).toEqual([]);
    expect(
      handRolledBackLinks('a.tsx', '<><Link to="/o">{t(\'x.feedback\')}</Link><PageHeader title="x" /></>'),
    ).toEqual([]);
  });

  const found = findings();

  it('finds no hand-made back link outside the ledger', () => {
    const unlisted = Object.entries(found)
      .filter(([file]) => !(file in LEDGER))
      .flatMap(([, hits]) => hits);
    expect(unlisted, 'use <PageHeader back={{ label, to }} /> (packages/admin-kit/README.md)').toEqual([]);
  });

  it('holds no stale entry: each count matches its file', () => {
    const stale = Object.entries(LEDGER)
      .filter(([file, entry]) => (found[file]?.length ?? 0) !== entry.count)
      .map(([file, entry]) => `${file}: ledger ${entry.count}, found ${found[file]?.length ?? 0}`);
    expect(stale, 'a migrated screen deletes its ledger entry').toEqual([]);
  });
});

describe('the back label names its destination; "Back" only for ?returnTo= (follow-up of #1549)', () => {
  const bundles: Bundles = (namespace) =>
    namespace === 'm'
      ? {
          en: { 'list.title': 'Organizations', 'x.back': 'Back to organizations', 'x.all': 'All entries', 'r.title': 'Returns' },
          pl: { 'list.title': 'Organizacje', 'x.back': 'Wróć do organizacji', 'x.all': 'Wszystkie wpisy', 'r.title': 'Zwroty' },
        }
      : null;
  const page = (back: string): string =>
    `const t = useTranslation('m');\nconst tCore = useTranslation('core');\nconst el = <PageHeader title="x" back={${back}} />;`;

  it('accepts the destination name, a record name and Back to a returnTo', () => {
    expect(backLabelFindings('a.tsx', page("{ label: t('list.title'), to: '/o' }"), bundles)).toEqual([]);
    expect(backLabelFindings('a.tsx', page("{ label: feed.name, to: `/f/${feed.id}` }"), bundles)).toEqual([]);
    // A destination whose name merely starts like the wording ("Returns") is a name.
    expect(backLabelFindings('a.tsx', page("{ label: t('r.title'), to: '/r' }"), bundles)).toEqual([]);
    expect(
      backLabelFindings(
        'a.tsx',
        page("returnTo ? { label: tCore('common.action.back'), to: returnTo } : { label: t('list.title'), to: '/o' }"),
        bundles,
      ),
    ).toEqual([]);
  });

  it('refuses "Back to …", "All …", a bare Back to a known screen and a name for a returnTo', () => {
    expect(backLabelFindings('a.tsx', page("{ label: t('x.back'), to: '/o' }"), bundles)).toEqual([
      'a.tsx:3 back-wording x.back',
    ]);
    expect(backLabelFindings('a.tsx', page("{ label: t('x.all'), to: '/o' }"), bundles)).toEqual([
      'a.tsx:3 back-wording x.all',
    ]);
    expect(backLabelFindings('a.tsx', page("{ label: tCore('common.action.back'), to: '/o' }"), bundles)).toEqual([
      'a.tsx:3 generic-label common.action.back',
    ]);
    expect(backLabelFindings('a.tsx', page("{ label: t('list.title'), to: returnTo }"), bundles)).toEqual([
      'a.tsx:3 named-returnTo returnTo',
    ]);
    expect(backLabelFindings('a.tsx', page("{ label: t('missing'), to: '/o' }"), bundles)).toEqual([
      'a.tsx:3 unresolved missing',
    ]);
  });

  it('holds on every admin screen', () => {
    const offending: string[] = [];
    for (const root of roots()) {
      for (const file of walk(root)) offending.push(...backLabelFindings(file, readFileSync(path.join(repoRoot, file), 'utf8')));
    }
    expect(offending, 'name the destination (packages/admin-kit/README.md, PageHeader back)').toEqual([]);
  });
});
