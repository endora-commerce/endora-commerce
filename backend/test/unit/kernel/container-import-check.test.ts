import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  collectModuleFiles,
  isContainerSpecifier,
  moduleOf,
} from '../../../scripts/check-container-imports.js';
import { resolveModuleLayout } from '../../../scripts/lib/module-roots.js';

/**
 * The container-import rule (feature 072, T041 / FR-032).
 *
 * Most of this file proves the analyzer can go **red**, because a check that
 * only ever agrees with a clean tree proves nothing.
 *
 * The last case is the opposite assertion — the real tree is clean — and it
 * exists because the tree was *not*: the conversion sweep that added
 * `src/modules/google_tag_manager/backend.test.ts` made that module a container
 * importer, and `quality` stayed red on `master` for two days while work
 * continued (issue #93). The gate lived only in CI, and the working agreement
 * asks for typecheck + lint + tests before a push, not for the static checks.
 * Asserting it here puts the same gate inside the suite a developer runs.
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

  it('flags a test file colocated inside a module — the rule is about the folder, not the file kind', () => {
    // Deliberate: a module composition test needs container-level registration
    // (another module's port, registered before the ModuleContext exists), which
    // is precisely what a module may not do. Such a test belongs under
    // `backend/test/`, next to the dictionaries and _i18n ones, not under
    // `src/modules/`. Narrowing the check to exclude `*.test.ts` would turn a
    // real seam into a decorative one.
    expect(
      analyzeSource(
        "import { asValue } from 'awilix';\n",
        '/repo/backend/src/modules/blog/backend.test.ts',
      ),
    ).toHaveLength(1);
  });
});

describe('the tree itself', () => {
  it('has no module importing the container', async () => {
    // The roots are resolved rather than spelled (feature 080, T040a), and the
    // CLI resolves the same ones — so a module that has left `src/modules` for
    // a package of its own is judged here too, instead of being a module this
    // assertion silently stopped covering.
    const layout = await resolveModuleLayout();
    const findings = collectModuleFiles(layout.moduleWalkRoots).flatMap((file) =>
      analyzeSource(readFileSync(file, 'utf8'), file),
    );
    expect(findings.map((f) => `${f.moduleId}: ${layout.displayOf(f.file)}:${f.line}`)).toEqual([]);
  });
});
