import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * `pnpm --filter backend run i18n:hardcoded -- <path> [--strict]` — feature 021.
 *
 * Walks the admin SPA's `.tsx` source for hard-coded user-visible strings.
 * Flags two shapes:
 *   1. JSX text nodes whose trimmed value contains a non-whitespace English
 *      letter (a-z), e.g. `<Button>Save changes</Button>`.
 *   2. JSX attribute values whose attribute name is in `USER_VISIBLE_ATTRS`
 *      (title, aria-label, placeholder, alt) and whose value is a string
 *      literal, e.g. `<input placeholder="Search…" />`.
 *
 * False-positive controls:
 *   - Ignore strings made entirely of code-style characters: identifiers
 *     with dots or underscores, paths, regex shapes, UUID/hex.
 *   - Ignore JSX inside <code>...</code> (technical identifier display).
 *   - Ignore very short strings (single character, punctuation only).
 *   - Ignore strings already wrapped in `t(...)` — they are JSX expressions,
 *     not text nodes, so the AST walker doesn't see them anyway.
 *
 * Output: one finding per line as `<path>:<line>:<col> → "<text>"`.
 * Exit code 1 in `--strict` mode when any finding is reported.
 */

const USER_VISIBLE_ATTRS = new Set([
  'title',
  'aria-label',
  'placeholder',
  'alt',
]);

interface Finding {
  filePath: string;
  line: number;
  column: number;
  text: string;
  kind: 'jsx-text' | 'jsx-attr';
}

function isLikelyCodeIdentifier(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return true;
  if (!/[A-Za-z]/.test(t)) return true; // no letters → punctuation / digits only
  if (t.length < 2) return true;
  if (/^[A-Za-z0-9_./-]+$/.test(t) && !/\s/.test(t)) return true; // code-shaped token
  return false;
}

function walkFile(filePath: string, findings: Finding[]): void {
  const source = readFileSync(filePath, 'utf8');
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function isInsideCodeElement(node: ts.Node): boolean {
    let p: ts.Node | undefined = node.parent;
    while (p) {
      if (ts.isJsxElement(p) || ts.isJsxOpeningElement(p)) {
        const tagName = ts.isJsxElement(p)
          ? p.openingElement.tagName
          : p.tagName;
        if (ts.isIdentifier(tagName) && tagName.text === 'code') return true;
      }
      p = p.parent;
    }
    return false;
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      const trimmed = node.text.trim();
      if (trimmed.length > 0 && !isLikelyCodeIdentifier(trimmed) && !isInsideCodeElement(node)) {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        findings.push({
          filePath,
          line: line + 1,
          column: character + 1,
          text: trimmed,
          kind: 'jsx-text',
        });
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : '';
      if (USER_VISIBLE_ATTRS.has(name) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const value = node.initializer.text;
        if (!isLikelyCodeIdentifier(value)) {
          const { line, character } = sf.getLineAndCharacterOfPosition(node.initializer.getStart(sf));
          findings.push({
            filePath,
            line: line + 1,
            column: character + 1,
            text: value,
            kind: 'jsx-attr',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
}

function collectTsxFiles(root: string, out: string[]): void {
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'build' || entry.startsWith('.')) continue;
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectTsxFiles(full, out);
    } else if (st.isFile() && entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const roots = positional.length > 0 ? positional : ['admin/src'];

  const files: string[] = [];
  for (const r of roots) {
    try {
      const st = statSync(r);
      if (st.isDirectory()) collectTsxFiles(r, files);
      else if (r.endsWith('.tsx')) files.push(r);
    } catch {
      process.stderr.write(`[i18n:hardcoded] path not found: ${r}\n`);
    }
  }

  const findings: Finding[] = [];
  for (const f of files) walkFile(f, findings);

  const cwd = process.cwd();
  for (const f of findings) {
    const rel = relative(cwd, f.filePath);
    const text = f.text.length > 80 ? `${f.text.slice(0, 77)}...` : f.text;
    process.stdout.write(`${rel}:${f.line}:${f.column} → "${text}" (${f.kind})\n`);
  }
  process.stdout.write(`\n[i18n:hardcoded] ${findings.length} finding(s) across ${files.length} file(s)\n`);

  if (strict && findings.length > 0) process.exit(1);
}

main();
