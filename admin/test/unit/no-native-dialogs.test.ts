/**
 * The admin asks its questions in its own dialogs, not the browser's (issue #313).
 *
 * A native `confirm()` / `alert()` / `prompt()` looks like the browser rather
 * than the admin, cannot show a busy state or an error, gives no control over
 * focus, and is silently suppressed after *"Don't allow this page to show more
 * dialogs"* — after which `confirm()` answers `false` and the action does
 * nothing. The replacement is the kit's `ConfirmDialog` / `useConfirmDialog`
 * (`@endora-commerce/admin-kit/components`), an inline notice for an alert and a
 * one-field `ModalDialog` for a prompt.
 *
 * The population is every non-test `.ts` / `.tsx` source of the admin SPA, the
 * shell, the kit, the page-builder chrome and every module's `src/admin/`. A
 * call counts when it is `window.<name>(…)` / `globalThis.<name>(…)`, or a bare
 * `<name>(…)` in a file that declares no binding of that name — a local
 * `confirm` (the hook's, or a dialog's own handler) is not the browser's.
 *
 * `EXCEPTIONS` is a two-way ledger: an unlisted call fails, and so does an
 * entry whose count no longer matches the file.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const NATIVE = new Set(['confirm', 'alert', 'prompt']);
const GLOBAL_RECEIVERS = new Set(['window', 'globalThis', 'self']);

/**
 * Native dialogs that stay, with why (issue #313, "Legitimate exceptions"). The
 * unsaved-changes guard's capture-phase link interceptor must decide inside the
 * event whether to `preventDefault()`, which an asynchronous modal cannot
 * answer; moving it means blocking the navigation and replaying it, which is
 * its own change. The settings screen's discard-on-channel-switch question is
 * the same kind of guard and moves with it.
 */
const EXCEPTIONS: Record<string, { count: number; reason: string }> = {
  'packages/admin-kit/src/lib/use-unsaved-changes-prompt.ts': {
    count: 2,
    reason: 'unsaved-changes navigation guard; must answer synchronously inside the click/popstate handler',
  },
  'packages/modules/settings/src/admin/pages/SettingsPage.tsx': {
    count: 1,
    reason: 'discard-on-channel-switch guard; the same kind of guard, moves together with the hook above',
  },
  // Not an exception: the rejection-reason prompt is issue #311's, replaced in
  // its own pull request (#1079). Whichever of the two merges second deletes
  // this entry — the ledger is two-way, so it fails here once the prompt is gone.
  'packages/modules/returns/src/admin/pages/ReturnDetail.tsx': {
    count: 1,
    reason: 'rejection-reason window.prompt, replaced by issue #311 (PR #1079)',
  },
};

function roots(): string[] {
  const fixed = ['admin/src', 'packages/admin-shell/src', 'packages/admin-kit/src', 'packages/page-builder-admin/src'];
  const modules = readdirSync(path.join(repoRoot, 'packages/modules'))
    .map((id) => `packages/modules/${id}/src/admin`)
    .filter((dir) => existsSync(path.join(repoRoot, dir)));
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

function declaredNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const bind = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) bind(node.name);
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) names.add(node.name.text);
    if (ts.isImportSpecifier(node)) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

/** `file:line name` for every native dialog call in one source. */
export function nativeDialogCalls(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const declared = declaredNames(sf);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let name: string | null = null;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        GLOBAL_RECEIVERS.has(callee.expression.text) &&
        NATIVE.has(callee.name.text)
      ) {
        name = callee.name.text;
      } else if (ts.isIdentifier(callee) && NATIVE.has(callee.text) && !declared.has(callee.text)) {
        name = callee.text;
      }
      if (name) found.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${name}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('no native browser dialogs in the admin (#313)', () => {
  it('recognises the shapes it is meant to refuse, and leaves a local `confirm` alone', () => {
    expect(nativeDialogCalls('a.tsx', `if (!window.confirm('x')) return;`)).toEqual(['a.tsx:1 confirm']);
    expect(nativeDialogCalls('a.tsx', `if (!confirm('x')) return; alert('y'); prompt('z');`)).toHaveLength(3);
    expect(
      nativeDialogCalls('a.tsx', `const { confirm } = useConfirmDialog(); async function f() { await confirm({ message: 'x' }); }`),
    ).toEqual([]);
    expect(nativeDialogCalls('a.tsx', `const confirm = async () => {}; void confirm();`)).toEqual([]);
  });

  it('finds none outside the ledgered navigation guards', () => {
    const byFile = new Map<string, string[]>();
    for (const root of roots()) {
      if (!existsSync(path.join(repoRoot, root))) continue;
      for (const file of walk(root)) {
        const source = readFileSync(path.join(repoRoot, file), 'utf8');
        // Parse only a file that could hold a call: most of the tree does not.
        if (!/\b(?:confirm|alert|prompt)\s*\(/.test(source)) continue;
        const calls = nativeDialogCalls(file, source);
        if (calls.length > 0) byFile.set(file, calls);
      }
    }
    const unledgered = [...byFile.entries()]
      .filter(([file, calls]) => EXCEPTIONS[file]?.count !== calls.length)
      .flatMap(([, calls]) => calls);
    expect(unledgered).toEqual([]);
    const stale = Object.entries(EXCEPTIONS)
      .filter(([file, entry]) => (byFile.get(file)?.length ?? 0) !== entry.count)
      .map(([file]) => file);
    expect(stale).toEqual([]);
  });
});
