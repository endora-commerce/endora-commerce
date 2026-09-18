import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { runCheck } from '@endora-commerce/cli/checks';
import {
  analyzeSource,
  classifyFindings,
  walk,
  ENTITY_DECORATOR_HINT,
  type EntityFinding,
} from '../../../scripts/check-entity-tenant-classification.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';

/** Every root the check itself walks — resolved, never spelled (T040a). */
const MODULE_LAYOUT = await requireModuleLayout('[classification-check]');

/**
 * Feature 050 (FR-012 / SC-001) — the CI classification check must flag entities
 * that carry no (or multiple) tenant-scope classification, and ignore non-entity
 * classes. This protects the build gate that keeps the classification total.
 */
describe('check-entity-tenant-classification / analyzeSource', () => {
  it('reports a classified entity with exactly one decorator', () => {
    const src = `
      @OrgScoped()
      @Entity({ tableName: 'orders' })
      export class Order {}
    `;
    const [f] = analyzeSource(src, 'order.entity.ts');
    expect(f).toMatchObject({ className: 'Order', classifications: ['OrgScoped'] });
  });

  it('flags an entity with NO classification (would fail CI)', () => {
    const src = `
      @Entity({ tableName: 'widgets' })
      export class Widget {}
    `;
    const [f] = analyzeSource(src, 'widget.entity.ts');
    expect(f?.classifications).toEqual([]);
  });

  it('flags an entity with MULTIPLE classifications', () => {
    const src = `
      @OrgScoped()
      @GlobalEntity()
      @Entity({ tableName: 'x' })
      export class X {}
    `;
    const [f] = analyzeSource(src, 'x.entity.ts');
    expect(f?.classifications.length).toBe(2);
  });

  it('ignores classes that are not MikroORM entities', () => {
    const src = `export class NotAnEntity {}`;
    expect(analyzeSource(src, 'plain.ts')).toEqual([]);
  });

  it('recognizes all five classification decorators', () => {
    for (const dec of ['OrgScoped', 'CustomerScoped', 'GlobalEntity', 'TransitivelyScoped', 'RuleScoped']) {
      const src = `@${dec}()\n@Entity({ tableName: 't' })\nexport class T {}`;
      expect(analyzeSource(src, 't.entity.ts')[0]?.classifications).toEqual([dec]);
    }
  });

  it('reads an entity out of a file with no entity suffix', () => {
    // The walk was scoped to `*.entity.ts`, so an entity declared anywhere else
    // was not unclassified as far as this check went — it was unread (#113).
    const src = `@Entity({ tableName: 'widgets' })\nexport class Widget {}`;
    expect(analyzeSource(src, 'src/modules/catalog/entities/index.ts')[0]?.className).toBe('Widget');
  });
});

/**
 * The scan scope, which is what decides whether the check is total. A green run
 * over a file list that no longer contains the entities is the failure this
 * whole issue is about, so the list and the pre-filter are asserted directly.
 */
describe('the scan scope', () => {
  // The population is **every** root the check walks, not `backend/src` alone:
  // since feature 080's T040b a module's entities live in its own package, so a
  // test rooted at the application tree measures a shrinking share of the very
  // thing the floor exists to protect — 92 entity files of 225 when this was
  // measured, which is a floor going red for the wrong reason and, one batch
  // later, a floor passing over a third of the tree.
  const walkAll = (): string[] => MODULE_LAYOUT.sourceRoots.flatMap((root) => walk(root));

  it('walks the whole tree, not one filename convention', () => {
    const files = walkAll();
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => !f.endsWith('.entity.ts'))).toBe(true);
    expect(files.every((f) => !f.endsWith('.test.ts'))).toBe(true);
  });

  it('keeps every file that declares an entity, and finds hundreds of them', () => {
    const entityFiles = walkAll().filter((f) =>
      ENTITY_DECORATOR_HINT.test(readFileSync(f, 'utf8')),
    );
    expect(entityFiles.length).toBeGreaterThan(100);
    const entities = entityFiles.flatMap((f) => analyzeSource(readFileSync(f, 'utf8'), f));
    expect(entities.length).toBeGreaterThan(100);
    expect(entities.filter((e) => e.classifications.length !== 1)).toEqual([]);
  });
});

/**
 * SC-002 — one analysis, two hosts, one finding set
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6).
 *
 * This is the assertion the whole split stands on, and it is the one that would
 * have caught every way of getting the split wrong: `endora check` over a module
 * package must produce the same findings, for this rule, as this repository's run
 * of it restricted to that module. A disagreement is a defect in the split, never
 * in either host.
 *
 * It is worth having here rather than only in the CLI's fixture proofs because
 * the two hosts read **different files** for this rule — the repository reads
 * decorated TypeScript, the package reads the emitted `__decorate` call the
 * platform loads (§4) — and a fixture cannot tell you that `tsc`'s real output
 * agrees with its own input. Only this tree's built packages can.
 *
 * Preconditions are asserted rather than assumed: a run over packages whose
 * `dist` is absent would agree vacuously, so the number of packages compared and
 * the number of entity classes read both carry a floor.
 */
describe('SC-002 — the repository host and the package host agree', () => {
  const PACKAGE_ROOTS = MODULE_LAYOUT.moduleRoots.filter(
    (root) => root.origin === 'workspace-package',
  );

  /** Every entity class the repository host reads out of a package's sources. */
  const repositoryEntities = (directory: string): readonly EntityFinding[] =>
    walk(directory)
      .filter((file) => ENTITY_DECORATOR_HINT.test(readFileSync(file, 'utf8')))
      .flatMap((file) => analyzeSource(readFileSync(file, 'utf8'), file));

  it('reads the same entity population out of every built module package', () => {
    let compared = 0;
    let entitiesRead = 0;
    const disagreements: string[] = [];

    for (const root of PACKAGE_ROOTS) {
      const run = runCheck({ cwd: root.directory, rules: ['check-entity-tenant-classification'] });
      const result = run.report.results[0];
      if (result === undefined) throw new Error(`no result for ${root.directory}`);
      // A package that publishes no entity class is `not-applicable` on both
      // sides. `unreadable` is **not** skipped: every package in this checkout is
      // built, so an `unreadable` here is the package host refusing an input it
      // should have had — and skipping it would hide exactly the failure this
      // test exists for. Measured while writing it: a deliberately broken
      // emitted reader turned six packages `unreadable` through the
      // declared-entities floor and left the comparison green over the rest,
      // which is the vacuous shape a `continue` buys.
      if (result.verdict === 'unreadable') {
        disagreements.push(`${run.report.packageName}: unreadable — ${result.explanation}`);
        continue;
      }
      if (result.verdict !== 'ran') continue;
      compared += 1;

      // **The population, not the findings.** Both sides report no finding over
      // this tree — every entity here is classified — so a comparison of finding
      // sets alone would be `[] === []` on every package and would assert
      // nothing at all. The number of entity classes each host *read* is the
      // non-vacuous half, and it is the half a broken emitted reader would move.
      const fromRepository = repositoryEntities(root.directory);
      entitiesRead += fromRepository.length;
      const fromPackage = result.readSize?.sites ?? 0;
      if (fromPackage !== fromRepository.length) {
        disagreements.push(
          `${run.report.packageName}: package read ${fromPackage} entity class(es), ` +
            `repository read ${fromRepository.length}`,
        );
      }

      // And the findings, which is SC-002 as written: the same finding set, per
      // rule. Vacuous today by the argument above, and it is here for the day it
      // is not — a red on this line and a green on the one above is the split
      // diverging on the *predicate* rather than on the walk.
      const { unclassified, multiple } = classifyFindings(fromRepository);
      const expectedClasses = [...unclassified, ...multiple]
        .map((finding) => finding.className)
        .sort();
      const reportedClasses = result.findings
        .map((finding) => finding.message.split(' ')[0] ?? '')
        .sort();
      if (JSON.stringify(reportedClasses) !== JSON.stringify(expectedClasses)) {
        disagreements.push(
          `${run.report.packageName}: package reported ${JSON.stringify(reportedClasses)}, ` +
            `repository reported ${JSON.stringify(expectedClasses)}`,
        );
      }
    }

    // The floors. Without them a checkout with no `dist` would pass this by
    // comparing nothing, which is the vacuous green the estate exists against.
    expect(compared).toBeGreaterThan(20);
    expect(entitiesRead).toBeGreaterThan(100);
    expect(disagreements).toEqual([]);
  });
});
