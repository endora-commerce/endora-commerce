import { readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createMovedModuleTreeFixture,
  createSplitModuleTreeFixture,
  KEPT_MODULE,
  runCheckInThisCheckout,
} from '../../helpers/moved-module-tree-fixture.js';

/**
 * `check:custom-field-writes`, spawned the way CI spawns it
 * (`specs/175-buyer-input-custom-fields/` T075; research R-11,
 * `contracts/admin-panel-and-check.md` §4).
 *
 * The rule's shapes — one red proof per finding kind — are in
 * `packages/cli/test/custom-field-writes-rule.test.ts` and in the inventory's
 * red proofs. What this file holds is the **host**: the exit code over this
 * repository, over a tree with one finding in it, and the three ways a run
 * could not see the tree — a module walk that came back short, a registry it
 * could not read, contracts that are not built — each of which is exit 2 and
 * never a green (issue #113).
 */

const SCRIPT = 'check-custom-field-writes.ts';
const PREFIX = '[custom-field-writes]';

function readLines(output: string): string[] {
  return output.split('\n').filter((line) => line.startsWith(`${PREFIX} read:`));
}

describe('check-custom-field-writes — over this repository', () => {
  it('exits 0 and prints exactly one read line', () => {
    const result = runCheckInThisCheckout(SCRIPT);
    expect(result.status, result.output).toBe(0);
    const lines = readLines(result.output);
    expect(lines, result.output).toHaveLength(1);
    expect(lines[0]).toMatch(/files=\d+ sites=\d+ sources=entity-types:(\d+)\/\1,manifest-index:(\d+)\/\2/);
    // The exemptions it honoured are printed with their reasons, never silently.
    expect(result.output).toContain('exempt: catalog product create');
    expect(result.output).toContain('host-managed');
  }, 120_000);
});

describe('check-custom-field-writes — a finding is exit 1', () => {
  it('exits 1 over a tree whose declaration names another body than its route validates', () => {
    const fixture = createSplitModuleTreeFixture({ packaged: [] });
    try {
      const manifest = join(fixture.root, 'packages', 'modules', 'tasks', 'src', 'manifest.ts');
      const text = readFileSync(manifest, 'utf8');
      expect(text).toContain("body: 'UpdateTaskBodySchema'");
      writeFileSync(manifest, text.replace("body: 'UpdateTaskBodySchema'", "body: 'CreateTaskBodySchema'"));
      // This check reads the declaration out of the manifest **source**, but the
      // module layout it resolves is read out of the emitted one, and that loader
      // refuses an emitted manifest its source has outrun (issue #104). The edit
      // changes nothing the layout reads, so the emitted file is stamped as
      // rebuilt: the fixture stands for an author who ran the build.
      const later = new Date(Date.now() + 60_000);
      utimesSync(join(fixture.root, 'packages', 'modules', 'tasks', 'dist', 'manifest.js'), later, later);

      const result = fixture.run(SCRIPT);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain('[declared-route-missing]');
      expect(result.output).toContain('PATCH /api/v1/admin/tasks/:id');
      expect(readLines(result.output)).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  }, 240_000);
});

describe('check-custom-field-writes — it refuses a vacuous pass', () => {
  it('exits 2 over a module walk that came back short', () => {
    const fixture = createMovedModuleTreeFixture();
    try {
      const result = fixture.run(SCRIPT);
      expect(result.status, result.output).toBe(2);
      expect(result.output).toContain(PREFIX);
      expect(result.output).toMatch(/the walk read \d+ file\(s\)/);
    } finally {
      fixture.cleanup();
    }
  }, 120_000);

  it('exits 2 when the custom-field registry is not there to read', () => {
    // The registry agrees with the one module the tree holds, so the module
    // floor is satisfied and the run reaches the registry, which is gone with
    // `custom_fields`.
    const fixture = createMovedModuleTreeFixture({ registeredIds: [KEPT_MODULE] });
    try {
      const result = fixture.run(SCRIPT);
      expect(result.status, result.output).toBe(2);
      expect(result.output).toContain('input-surface registry');
    } finally {
      fixture.cleanup();
    }
  }, 120_000);

  it('exits 2 when the contracts it introspects are not built', () => {
    const fixture = createMovedModuleTreeFixture({ registeredIds: [KEPT_MODULE] });
    try {
      const dist = join(fixture.root, 'packages', 'contracts', 'dist');
      // Only ever the fixture's own copy.
      expect(dist.startsWith(fixture.root)).toBe(true);
      rmSync(dist, { recursive: true, force: true });

      const result = fixture.run(SCRIPT);
      expect(result.status, result.output).toBe(2);
      expect(result.output).toContain('build:packages');
    } finally {
      fixture.cleanup();
    }
  }, 120_000);
});
