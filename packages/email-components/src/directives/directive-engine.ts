// Magento-2-style directive engine (feature 047, research R3).
//
// Supports exactly three directives over a rendered string:
//   {{var path}}                         -> substitute a (nested) context value
//   {{if path}} ... {{/if}}              -> include block when value is truthy
//   {{for alias in path}} ... {{/for}}   -> repeat block per list item
//
// Runs AFTER component rendering, so a {{for}} body may span multiple rendered
// components. In HTML mode, {{var}} values are HTML-escaped; in text/subject
// mode they are raw. Unknown/missing paths resolve to empty (var) / falsy
// (if/for), and never throw — a missing value must never break a send (FR-012).

import { escapeHtml } from '../render/escape-html.js';

export type DirectiveContext = Record<string, unknown>;

export interface RenderDirectivesOptions {
  /** Escape substituted values for HTML output. Default false (text/subject). */
  escape?: boolean;
}

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'var'; path: string }
  | { kind: 'if'; path: string; body: Node[] }
  | { kind: 'for'; alias: string; path: string; body: Node[] };

const TOKEN = /\{\{\s*(\/?)(var|if|for)\b([^}]*?)\s*\}\}/g;

interface Token {
  index: number;
  length: number;
  closing: boolean;
  keyword: 'var' | 'if' | 'for';
  rest: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(input)) !== null) {
    tokens.push({
      index: m.index,
      length: m[0].length,
      closing: m[1] === '/',
      keyword: m[2] as Token['keyword'],
      rest: (m[3] ?? '').trim(),
    });
  }
  return tokens;
}

function parse(input: string): Node[] {
  const tokens = tokenize(input);
  let cursor = 0; // position in input consumed so far
  let ti = 0; // token index

  function parseUntil(closer: 'if' | 'for' | null): Node[] {
    const nodes: Node[] = [];
    while (ti < tokens.length) {
      const tok = tokens[ti];
      if (!tok) break;
      // Emit literal text before this token.
      if (tok.index > cursor) {
        nodes.push({ kind: 'text', value: input.slice(cursor, tok.index) });
      }
      cursor = tok.index + tok.length;
      ti += 1;

      if (tok.closing) {
        if (closer && tok.keyword === closer) return nodes;
        // Unbalanced closer for the current scope: ignore (treat as nothing).
        continue;
      }

      if (tok.keyword === 'var') {
        nodes.push({ kind: 'var', path: tok.rest });
      } else if (tok.keyword === 'if') {
        const body = parseUntil('if');
        nodes.push({ kind: 'if', path: tok.rest, body });
      } else if (tok.keyword === 'for') {
        const parsed = parseForHeader(tok.rest);
        const body = parseUntil('for');
        nodes.push({ kind: 'for', alias: parsed.alias, path: parsed.path, body });
      }
    }
    // Trailing literal text.
    if (closer === null && cursor < input.length) {
      nodes.push({ kind: 'text', value: input.slice(cursor) });
    }
    return nodes;
  }

  return parseUntil(null);
}

function parseForHeader(rest: string): { alias: string; path: string } {
  // Expected: "alias in path"
  const m = /^(\w+)\s+in\s+(.+)$/.exec(rest);
  if (!m || !m[1] || !m[2]) return { alias: '', path: rest };
  return { alias: m[1], path: m[2].trim() };
}

function resolvePath(ctx: DirectiveContext, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
}

function renderNodes(
  nodes: Node[],
  ctx: DirectiveContext,
  escape: boolean,
): string {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out += node.value;
        break;
      case 'var': {
        const v = stringify(resolvePath(ctx, node.path));
        out += escape ? escapeHtml(v) : v;
        break;
      }
      case 'if': {
        if (isTruthy(resolvePath(ctx, node.path))) {
          out += renderNodes(node.body, ctx, escape);
        }
        break;
      }
      case 'for': {
        const list = resolvePath(ctx, node.path);
        if (Array.isArray(list)) {
          for (const item of list) {
            out += renderNodes(node.body, { ...ctx, [node.alias]: item }, escape);
          }
        }
        break;
      }
    }
  }
  return out;
}

export function renderDirectives(
  input: string,
  ctx: DirectiveContext,
  opts: RenderDirectivesOptions = {},
): string {
  if (!input.includes('{{')) return input;
  const ast = parse(input);
  return renderNodes(ast, ctx, opts.escape ?? false);
}
