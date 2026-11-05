import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A `'use client'` module must not reach `next/headers` through its value imports.
 *
 * `next build` refuses such a graph ("You're importing a component that needs
 * next/headers"). `tsc`, `vitest` and `next dev` before the route is opened
 * all accept it, so the first place the defect showed up was the demo image
 * build after #736: `RoleEditorForm.tsx` imported a pure role-vocabulary module
 * that imported `StorefrontApiError` from `lib/api/client.ts`.
 *
 * The walk follows relative value imports only. It stops at a `'use server'`
 * module, which a client component may import because it receives action
 * references, not the module's code. `import type` and `export type` are
 * erased and are not edges. Package specifiers are not followed;
 * `next/headers` is matched by name.
 */

const ROOT = resolve(__dirname, '..');
const SOURCE_DIRS = ['app', 'components', 'lib'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];
const SERVER_ONLY = new Set(['next/headers']);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (EXTENSIONS.some((ext) => path.endsWith(ext))) out.push(path);
  }
  return out;
}

/** Specifiers of the module's value imports and re-exports. */
function valueSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?([^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const m of source.matchAll(re)) {
    if (m[2]) continue; // `import type …` / `export type …`
    if (m[1] === 'export' && !m[3]) continue;
    specs.push(m[4]!);
  }
  return specs;
}

function resolveRelative(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  const candidates = [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => join(base, 'index' + e))];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function hasDirective(source: string, directive: 'use client' | 'use server'): boolean {
  return new RegExp(`^\\s*(?:\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/\\s*)*['"]${directive}['"]`).test(source);
}

/** The import chain from `entry` to a server-only specifier, or null. */
function serverOnlyChain(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }];
  while (stack.length > 0) {
    const { file, chain } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    // A `'use server'` module is a legal edge: the client receives action references, not its code.
    if (file !== entry && hasDirective(source, 'use server')) continue;
    for (const spec of valueSpecifiers(source)) {
      if (SERVER_ONLY.has(spec)) return [...chain, spec];
      if (!spec.startsWith('.')) continue;
      const next = resolveRelative(file, spec);
      if (next !== null) stack.push({ file: next, chain: [...chain, next] });
    }
  }
  return null;
}

describe('client/server module boundary', () => {
  const files = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d), []));
  const clientModules = files.filter((f) => hasDirective(readFileSync(f, 'utf8'), 'use client'));

  it('finds the client modules it guards', () => {
    expect(clientModules.length).toBeGreaterThan(20);
  });

  it('no client module reaches next/headers through a value import', () => {
    const offenders = clientModules
      .map((f) => serverOnlyChain(f))
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.map((p) => (p.startsWith('/') ? relative(ROOT, p) : p)).join(' -> '));
    expect(offenders).toEqual([]);
  });
});
