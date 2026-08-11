import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  isContainerSpecifier,
  moduleOf,
} from '../../../scripts/check-container-imports.js';

/**
 * The container-import rule (feature 072, T041 / FR-032).
 *
 * The tree satisfies it today — the kernel is the only place `awilix` is
 * imported — so this check's own test has to prove it can go **red**, not that
 * it agrees with a tree in which nothing is wrong yet.
 */

const MODULE_FILE = '/repo/backend/src/modules/blog/backend.ts';

describe('moduleOf', () => {
  it('reads the module id out of a core module path', () => {
    expect(moduleOf(MODULE_FILE)).toBe('blog');
  });

  it('reads it out of a deployment overlay path too (feature 057)', () => {
    expect(moduleOf('/repo/backend/src/apps/acme/modules/acme_pricing/backend.ts')).toBe(
      'acme_pricing',
    );
  });

  it('returns null for the kernel, which is where the container lives', () => {
    expect(moduleOf('/repo/backend/src/kernel/container.ts')).toBeNull();
  });
});

describe('isContainerSpecifier', () => {
  it('matches the package and its subpaths', () => {
    expect(isContainerSpecifier('awilix')).toBe(true);
    expect(isContainerSpecifier('awilix/lib/container')).toBe(true);
  });

  it('does not match a package that merely starts with the same letters', () => {
    expect(isContainerSpecifier('awilix-manager')).toBe(false);
  });
});

describe('analyzeSource', () => {
  it('flags a value import', () => {
    const findings = analyzeSource("import { asClass } from 'awilix';\n", MODULE_FILE);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ moduleId: 'blog', specifier: 'awilix', line: 1 });
  });

  it('flags a type-only import — the seam is about what a module knows, not what it emits', () => {
    const findings = analyzeSource("import type { Resolver } from 'awilix';\n", MODULE_FILE);
    expect(findings).toHaveLength(1);
  });

  it('flags a re-export', () => {
    const findings = analyzeSource("export { asClass } from 'awilix';\n", MODULE_FILE);
    expect(findings).toHaveLength(1);
  });

  it('flags a dynamic import and a require', () => {
    expect(analyzeSource("const a = await import('awilix');\n", MODULE_FILE)).toHaveLength(1);
    expect(analyzeSource("const a = require('awilix');\n", MODULE_FILE)).toHaveLength(1);
  });

  it('ignores a mention in a comment or a string — this is a parse, not a grep', () => {
    const source = [
      "// Never import 'awilix' here; use ModuleContext.",
      "const note = 'awilix';",
      "import type { ModuleContext } from '../../kernel/index.js';",
      'export type X = ModuleContext;',
    ].join('\n');
    expect(analyzeSource(source, MODULE_FILE)).toEqual([]);
  });

  it('ignores the kernel, which is the one place the container may be imported', () => {
    expect(
      analyzeSource("import { asClass } from 'awilix';\n", '/repo/backend/src/kernel/container.ts'),
    ).toEqual([]);
  });
});
