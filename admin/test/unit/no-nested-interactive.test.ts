/**
 * No button inside a link, and no link inside a button (issue #1465, UX audit
 * CONTENT-07).
 *
 * `<Link><Button>New</Button></Link>` renders `<a><button>`: two tab stops for
 * one action, and an accessibility tree that HTML does not allow — interactive
 * content may not nest, so a screen reader announces either the link or the
 * button, depending on the browser. The kit's answer is `<Button asChild>`
 * around the link, which renders one `<a>` styled as a button (WCAG 2.2 SC
 * 4.1.2).
 *
 * The population is every non-test `.tsx` source of the admin SPA, the shell,
 * the kit, the page-builder chrome and every module's `src/admin/`. A link is
 * `a`, `Link` or `NavLink`; a button is `button` or `Button`, and a `Button`
 * with `asChild` is not one — it is the element it wraps.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const LINKS = new Set(['a', 'Link', 'NavLink']);
const BUTTONS = new Set(['button', 'Button']);

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
    if (statSync(path.join(repoRoot, rel)).isDirectory()) out.push(...walk(rel));
    else if (entry.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(entry)) out.push(rel);
  }
  return out;
}

type Kind = 'link' | 'button' | null;

function kindOf(node: ts.JsxOpeningLikeElement): Kind {
  const tag = node.tagName.getText();
  if (LINKS.has(tag)) return 'link';
  if (!BUTTONS.has(tag)) return null;
  const asChild = node.attributes.properties.some(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'asChild',
  );
  return asChild ? null : 'button';
}

/** `file:line inner-in-outer` for every link/button nested in the other. */
export function nestedInteractive(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node, outer: Kind): void => {
    let inside = outer;
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening) {
      const kind = kindOf(opening);
      if (kind !== null && outer !== null) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        found.push(`${file}:${line} ${kind}-in-${outer}`);
      }
      if (kind !== null) inside = kind;
    }
    // A component handed in as a prop (`icon={<Button/>}`) is rendered wherever
    // the receiver puts it, not here — only children nest.
    if (ts.isJsxAttribute(node)) return;
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(sf, null);
  return found;
}

describe('no nested interactive elements in the admin (#1465)', () => {
  it('recognises the shapes it refuses, and leaves Button asChild alone', () => {
    expect(nestedInteractive('a.tsx', '<Link to="/x"><Button>New</Button></Link>')).toEqual(['a.tsx:1 button-in-link']);
    expect(nestedInteractive('a.tsx', '<a href="/x"><button>Go</button></a>')).toEqual(['a.tsx:1 button-in-link']);
    expect(nestedInteractive('a.tsx', '<button><a href="/x">Go</a></button>')).toEqual(['a.tsx:1 link-in-button']);
    expect(nestedInteractive('a.tsx', '<Button asChild><Link to="/x">New</Link></Button>')).toEqual([]);
    expect(nestedInteractive('a.tsx', '<Link to="/x"><span>New</span></Link>')).toEqual([]);
  });

  it('finds none in the admin sources', () => {
    const found: string[] = [];
    for (const root of roots()) {
      if (!existsSync(path.join(repoRoot, root))) continue;
      for (const file of walk(root)) {
        const source = readFileSync(path.join(repoRoot, file), 'utf8');
        if (!/<(?:a|Link|NavLink)\b/.test(source)) continue;
        found.push(...nestedInteractive(file, source));
      }
    }
    expect(found).toEqual([]);
  });
});
