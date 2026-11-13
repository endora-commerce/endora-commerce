import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Issue #355 — a test environment the storefront's suite names is one the
 * storefront declares.
 *
 * Server components are tested server-render only (`renderToString`, node
 * environment). A `'use client'` component's interaction — what a click sends,
 * what an input does on blur — is tested under `// @vitest-environment jsdom`
 * with raw `react-dom/client` + `act`, as the admin does. Those files already
 * existed while `jsdom` was not a storefront dependency: vitest found it only
 * because another workspace member's copy happened to sit in pnpm's hidden
 * hoist, so the suite passed on borrowed resolution that any change to the
 * admin's tree could take away.
 *
 * Testing Library stays out on purpose: the storefront drives React directly,
 * so the harness is the same one a reviewer reads in every such file.
 */
const STOREFRONT = resolve(__dirname, '..');
const TEST_ROOT = join(STOREFRONT, 'test');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

function annotatedEnvironment(source: string): string | null {
  const match = /^\s*\/\/\s*@vitest-environment\s+(\S+)/m.exec(source.slice(0, 400));
  return match ? match[1]! : null;
}

const manifest = JSON.parse(readFileSync(join(STOREFRONT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const declared = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
]);

describe('storefront test environments', () => {
  it('declares every non-node environment a test file asks for', () => {
    const undeclared = walk(TEST_ROOT)
      .map((file) => ({ file: relative(STOREFRONT, file), env: annotatedEnvironment(readFileSync(file, 'utf8')) }))
      .filter((entry): entry is { file: string; env: string } => entry.env !== null && entry.env !== 'node')
      .filter((entry) => !declared.has(entry.env))
      .map((entry) => `${entry.file}: ${entry.env}`);

    expect(undeclared).toEqual([]);
  });

  it('declares jsdom as a test-only dependency', () => {
    expect(manifest.devDependencies?.jsdom).toBeDefined();
    expect(manifest.dependencies?.jsdom).toBeUndefined();
  });

  it('does not take on Testing Library', () => {
    expect([...declared].filter((name) => name.startsWith('@testing-library/'))).toEqual([]);
  });
});
