/**
 * The admin has one modal dialog: the kit's `ModalDialog` (issue #1444, DS-11).
 *
 * A hand-drawn overlay — a `fixed inset-0` scrim, a `position: 'fixed'` style
 * object, a `createPortal` call, or a `role="dialog"` / `role="alertdialog"`
 * written onto a `<div>` — is what the 2026-11-17 audit found thirteen times
 * without a focus trap, mostly without Escape and sometimes without a dialog
 * role or a name (SALES-09, CONTENT-03). `ModalDialog` carries all of that, and
 * since DS-11 it also portals to `document.body` and has a `layer="overlay"`
 * above the fullscreen Page Builder, which is why the builder chrome drew its
 * own. `useConfirmDialog` / `ConfirmDialog` are the yes/no form of it.
 *
 * The population is every non-test `.ts` / `.tsx` source of the admin SPA, the
 * shell, the kit, the page-builder chrome, and every module's `src/admin/` and
 * `src/admin-ui/`.
 *
 * `LEDGER` is a two-way ledger, per file and shape: an unlisted finding fails,
 * and so does an entry whose count no longer matches the file — so a migration
 * that removes a hand-rolled overlay has to delete its entry here, and an entry
 * cannot be widened silently. An entry names why the shape stays, or the open
 * issue that migrates it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type OverlayShape = 'fixed-inset' | 'position-fixed' | 'create-portal' | 'role-dialog';

const DRAWER = 'side drawer (b2b-drawer) with its own scrim, trap and Escape; not a centred modal — no kit drawer primitive exists yet';
const FULLSCREEN = 'the builder\'s fullscreen mode: a page surface, not an overlay';
const ACTION_BAR = 'Puck floating action bar placed next to the selected block; not a dialog';

/**
 * What stays, and why. Keyed by repo-relative file, then by shape, with the
 * number of findings of that shape in the file.
 */
const LEDGER: Record<string, { shapes: Partial<Record<OverlayShape, number>>; reason: string }> = {
  // The primitive itself.
  'packages/admin-kit/src/components/modal-dialog/ModalDialog.tsx': {
    shapes: { 'fixed-inset': 1, 'create-portal': 1, 'role-dialog': 1 },
    reason: 'the one modal dialog of the admin',
  },
  'packages/admin-kit/src/components/confirm-dialog/ConfirmDialog.tsx': {
    shapes: { 'create-portal': 1 },
    reason: 'wraps ModalDialog; the portal is redundant since DS-11 and goes when #1581 (which edits this file) has merged',
  },
  'packages/admin-kit/src/components/product-browser/ProductBrowserDialog.tsx': {
    shapes: { 'role-dialog': 1 },
    reason: DRAWER,
  },
  'packages/admin-shell/src/components/AppShell.tsx': {
    shapes: { 'role-dialog': 2 },
    reason: 'the ⌘K command palette (b2b-palette), a combobox dialog with its own keyboard model',
  },
  'packages/admin-shell/src/components/AdminFeedback.tsx': {
    shapes: { 'create-portal': 1 },
    reason: 'portals a ModalDialog-based dialog out of the sidebar drawer; redundant since DS-11, harmless',
  },
  'packages/modules/cms/src/admin/components/BrandPreview.tsx': {
    shapes: { 'create-portal': 1 },
    reason: 'renders the brand sample into a shadow root; not an overlay',
  },
  'packages/modules/cms/src/admin/components/PageBuilderEditor.tsx': { shapes: { 'fixed-inset': 1 }, reason: FULLSCREEN },
  'packages/modules/cms/src/admin/components/PageBuilderActionBar.tsx': {
    shapes: { 'position-fixed': 1, 'create-portal': 1 },
    reason: ACTION_BAR,
  },
  'packages/modules/document_templates/src/admin/pages/DocumentTemplateEditor.tsx': {
    shapes: { 'fixed-inset': 1 },
    reason: `${FULLSCREEN}; the editor moves to the shared shell under CONTENT-12 (#1532)`,
  },
  'packages/modules/price_lists/src/admin/pages/DisplayModeOverridesPage.tsx': { shapes: { 'role-dialog': 1 }, reason: DRAWER },
  'packages/modules/product_feeds/src/admin/components/RevisionImpactDrawer.tsx': { shapes: { 'role-dialog': 1 }, reason: DRAWER },
  'packages/modules/product_feeds/src/admin/components/TemplatePreviewController.tsx': { shapes: { 'role-dialog': 1 }, reason: DRAWER },
  'packages/modules/product_feeds/src/admin/components/ConsequenceDialog.tsx': {
    shapes: { 'role-dialog': 1 },
    reason: 'product_feeds confirmation alertdialog with its own trap; to be replaced by ConfirmDialog (follow-up to #1444)',
  },
  'packages/modules/product_feeds/src/admin/pages/FeedTemplateEditorPage.tsx': {
    shapes: { 'role-dialog': 2 },
    reason: 'the inspector drawer below desktop, and an alertdialog with its own trap; the latter to ConfirmDialog (follow-up to #1444)',
  },
  'packages/page-builder-admin/src/email/EmailBuilderActionBar.tsx': {
    shapes: { 'position-fixed': 1, 'create-portal': 1 },
    reason: ACTION_BAR,
  },
  'packages/page-builder-admin/src/email/EmailEditorPane.tsx': { shapes: { 'fixed-inset': 1 }, reason: FULLSCREEN },
};

function roots(): string[] {
  const fixed = ['admin/src', 'packages/admin-shell/src', 'packages/admin-kit/src', 'packages/page-builder-admin/src'];
  const modules = readdirSync(path.join(repoRoot, 'packages/modules')).flatMap((id) =>
    [`packages/modules/${id}/src/admin`, `packages/modules/${id}/src/admin-ui`].filter((dir) =>
      existsSync(path.join(repoRoot, dir)),
    ),
  );
  return [...fixed, ...modules];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(path.join(repoRoot, rel)).isDirectory()) {
      out.push(...walk(rel));
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(rel);
    }
  }
  return out;
}

function hasFixedInset(text: string): boolean {
  const tokens = text.split(/\s+/);
  return tokens.includes('fixed') && tokens.includes('inset-0');
}

/** Every hand-rolled overlay shape in one source, as `line shape`. */
export function overlayFindings(file: string, source: string): Array<{ line: number; shape: OverlayShape }> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Array<{ line: number; shape: OverlayShape }> = [];
  const add = (node: ts.Node, shape: OverlayShape): void => {
    found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, shape });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (hasFixedInset(node.text)) add(node, 'fixed-inset');
    } else if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ');
      if (hasFixedInset(text)) add(node, 'fixed-inset');
    } else if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
      if (name === 'position' && ts.isStringLiteralLike(node.initializer) && node.initializer.text === 'fixed') {
        add(node, 'position-fixed');
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        (ts.isIdentifier(callee) && callee.text === 'createPortal') ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'createPortal')
      ) {
        add(node, 'create-portal');
      }
    } else if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'role' && node.initializer) {
      const init = node.initializer;
      const value = ts.isStringLiteral(init)
        ? init.text
        : ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)
          ? init.expression.text
          : null;
      if (value === 'dialog' || value === 'alertdialog') add(node, 'role-dialog');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function scan(): Map<string, Array<{ line: number; shape: OverlayShape }>> {
  const byFile = new Map<string, Array<{ line: number; shape: OverlayShape }>>();
  for (const root of roots()) {
    if (!existsSync(path.join(repoRoot, root))) continue;
    for (const file of walk(root)) {
      const source = readFileSync(path.join(repoRoot, file), 'utf8');
      // Parse only a file that could hold a finding: most of the tree does not.
      if (!/inset-0|createPortal|position|dialog/.test(source)) continue;
      const findings = overlayFindings(file, source);
      if (findings.length > 0) byFile.set(file, findings);
    }
  }
  return byFile;
}

function countShapes(findings: Array<{ shape: OverlayShape }>): Partial<Record<OverlayShape, number>> {
  const counts: Partial<Record<OverlayShape, number>> = {};
  for (const { shape } of findings) counts[shape] = (counts[shape] ?? 0) + 1;
  return counts;
}

function sameCounts(a: Partial<Record<OverlayShape, number>>, b: Partial<Record<OverlayShape, number>>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as OverlayShape[]);
  return [...keys].every((key) => (a[key] ?? 0) === (b[key] ?? 0));
}

describe('no hand-rolled overlays in the admin (#1444, DS-11)', () => {
  it('recognises the shapes it is meant to refuse', () => {
    const shapes = (source: string): OverlayShape[] => overlayFindings('a.tsx', source).map((f) => f.shape);
    expect(shapes(`<div className="fixed inset-0 z-50 bg-black/40" />`)).toEqual(['fixed-inset']);
    expect(shapes('<div className={`fixed inset-0 ${open ? "z-50" : ""}`} />')).toEqual(['fixed-inset']);
    expect(shapes(`cn('space-y-3', full && 'fixed inset-0 z-50')`)).toEqual(['fixed-inset']);
    expect(shapes(`const S = { position: 'fixed', inset: 0 };`)).toEqual(['position-fixed']);
    expect(shapes(`createPortal(<div />, document.body); ReactDOM.createPortal(x, y);`)).toEqual(['create-portal', 'create-portal']);
    expect(shapes(`<div role="dialog" aria-modal="true" /><div role={'alertdialog'} />`)).toEqual(['role-dialog', 'role-dialog']);
  });

  it('leaves what is not an overlay alone', () => {
    const shapes = (source: string): OverlayShape[] => overlayFindings('a.tsx', source).map((f) => f.shape);
    expect(shapes(`<div className="fixed inset-x-0 bottom-0 z-40" />`)).toEqual([]);
    expect(shapes(`<div className="sticky top-0" role="region" />`)).toEqual([]);
    expect(shapes(`<button aria-haspopup="dialog" />`)).toEqual([]);
    expect(shapes(`const width = { mode: 'fixed' };`)).toEqual([]);
    expect(shapes(`<ModalDialog title="x" onClose={close} />`)).toEqual([]);
  });

  it('finds none outside the ledger, and every ledger entry still matches its file', () => {
    const byFile = scan();
    const unledgered = [...byFile.entries()]
      .filter(([file, findings]) => !LEDGER[file] || !sameCounts(LEDGER[file].shapes, countShapes(findings)))
      .flatMap(([file, findings]) => findings.map((f) => `${file}:${f.line} ${f.shape}`));
    expect(unledgered, 'use ModalDialog / useConfirmDialog from @endora-commerce/admin-kit/components').toEqual([]);
    const stale = Object.entries(LEDGER)
      .filter(([file, entry]) => !sameCounts(entry.shapes, countShapes(byFile.get(file) ?? [])))
      .map(([file]) => file);
    expect(stale).toEqual([]);
  });
});
