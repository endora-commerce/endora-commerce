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
