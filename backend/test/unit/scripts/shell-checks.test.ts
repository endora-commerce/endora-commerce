import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createShellCheckFixture,
  type ShellCheckFixture,
} from '../../helpers/shell-check-fixture.js';

/**
 * The two toolchain-free checks' own tests (issue #113).
 *
 * `check-naming.sh` and `check-language.sh` are the whole of the
 * `quality:static` job, they run on every push, and neither had a test. Their
 * headers claim two properties — they refuse a file list that came back empty,
 * and they exit 2 rather than pass when git is unusable — of which only the
 * second was implemented; a full-tree run over an empty listing reported
 * "✓ OK (full mode)".
 *
 * Each case builds a synthetic repository in a temp directory, copies the real
 * script into it and runs it — see `test/helpers/shell-check-fixture.ts`, which
 * the inventory meta-test reuses for its red proof of the same two scripts.
 */

/**
 * The fixture the language check must flag, in a template literal: this file is
 * scanned by that very check, and its citation blanking strips a backticked run
 * from a line. Writing the same bytes in an ordinary quoted string makes the
 * test file its own finding.
 */
const POLISH_COMMENT = `// Zwraca zamówienie klienta.\nexport const a = 1;\n`;

/**
 * The opt-out marker, assembled rather than spelled. `report_violations` greps
 * for it anywhere in a file, so writing it out once exempts this whole file
 * from the check it is testing — which is exactly the silent hole issue #113 is
 * about, arriving through the back door.
 */
const OPT_OUT_MARKER = ['check-language', 'allow-non-english'].join(': ');

let fixture: ShellCheckFixture;

beforeEach(() => {
  fixture = createShellCheckFixture();
});

afterEach(() => {
  fixture.cleanup();
});

describe('check-naming.sh', () => {
  it('passes on a clean fixture — the baseline every red case is measured against', () => {
    expect(fixture.run('check-naming.sh').status).toBe(0);
  });

  it('goes red on a module folder that is not snake_case', () => {
    fixture.write('backend/src/modules/BadName/thing.ts', 'export const a = 1;\n');
    fixture.lists(['backend/src/modules/BadName/thing.ts']);
    const result = fixture.run('check-naming.sh');
    expect(result.status).toBe(1);
    expect(result.output).toContain('BadName');
  });

  it('goes red on a module folder that reads singular', () => {
    fixture.write('backend/src/modules/widget/thing.ts', 'export const a = 1;\n');
    fixture.lists(['backend/src/modules/widget/thing.ts']);
    const result = fixture.run('check-naming.sh');
    expect(result.status).toBe(1);
    expect(result.output).toContain('looks singular');
  });

  it('goes red on a migration naming a camelCase column', () => {
    fixture.write(
      'backend/src/modules/orders/migrations/20260901T000000_orders_add.ts',
      "export class M { up() { this.addSql(createTable('orderItems')); } }\n",
    );
    fixture.lists(['backend/src/modules/orders/migrations/20260901T000000_orders_add.ts']);
    expect(fixture.run('check-naming.sh').status).toBe(1);
  });

  it('goes red on a snake_case key in a Zod contract', () => {
    fixture.write(
      'packages/contracts/src/orders.ts',
      'export const s = z.object({\n  order_id: z.string(),\n});\n',
    );
    fixture.lists(['packages/contracts/src/orders.ts']);
    const result = fixture.run('check-naming.sh');
    expect(result.status).toBe(1);
    expect(result.output).toContain('order_id');
  });

  // The fourth of the script's four rules, and the last one with no red fixture
  // anywhere in the repository until issue #130.
  it('goes red on a non-kebab-case URL segment in a route registration', () => {
    fixture.write(
      'backend/src/modules/orders/routes.admin.ts',
      "app.get('/api/v1/orderItems', handler);\n",
    );
    fixture.lists(['backend/src/modules/orders/routes.admin.ts']);
    const result = fixture.run('check-naming.sh');
    expect(result.status).toBe(1);
    expect(result.output).toContain('orderItems');
  });

  it('goes red on a migration class scoped by the wrong module', () => {
    fixture.write(
      'backend/src/modules/orders/migrations/20270101T000000_orders_probe.ts',
      'export class Migration20270101T000000CatalogProbe extends Migration {}\n',
    );
    const result = fixture.run('check-naming.sh');
    expect(result.status).toBe(1);
    expect(result.output).toContain('Migration20270101T000000CatalogProbe');
    expect(result.output).toContain('Migration<STAMP>Orders');
  });

  it('accepts an underscore-prefixed module id by its segment', () => {
    // The control for the rule above: `_i18n`'s segment is `i18n`, so `I18n`
    // is correct and a rule that compared the raw id would flag it.
    fixture.write(
      'backend/src/modules/_i18n/migrations/20270101T000000_i18n_probe.ts',
      'export class Migration20270101T000000I18nProbe extends Migration {}\n',
    );
    expect(fixture.run('check-naming.sh').status).toBe(0);
  });

  it('exits 2 when the tree holds no migration at all', () => {
    // The class-scope rule reads the filesystem rather than the listing, so a
    // tree with no migration would have it judge nothing while the other four
    // rules reported clean.
    rmSync(join(fixture.root, 'backend/src/modules/orders/migrations'), {
      recursive: true,
      force: true,
    });
    const result = fixture.run('check-naming.sh');
    expect(result.status).toBe(2);
    expect(result.output).toContain('vacuous');
  });

  it('exits 2 on an empty full-tree listing instead of reporting a clean tree', () => {
    fixture.lists([]);
    const result = fixture.run('check-naming.sh');
    expect(result.status).toBe(2);
    expect(result.output).toContain('vacuous');
  });

  it('exits 2 when git cannot answer', () => {
    const result = fixture.run('check-naming.sh', [], { FAKE_GIT_IN_WORKTREE: '1' });
    expect(result.status).toBe(2);
    expect(result.output).toContain('needs git');
  });

  it('says how many files it read, and what corroborates that number', () => {
    // Issue #244. Every rule below printed a verdict and none printed an input
    // size, so a run that judged two files and a run that judged five thousand
    // ended in the same green tick.
    const result = fixture.run('check-naming.sh');
    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(/\[naming] read: files=\d+ sources=manifest-index:1\/1/);
  });

  it('exits 2 on a full-mode listing that misses a registered module', () => {
    // The *short* walk, which is a different predicate from the empty one: the
    // listing below is non-empty, every existing floor passes on it, and the
    // module the index registers contributed nothing to it.
    fixture.listsExactly(['backend/src/kernel/thing.ts']);
    const result = fixture.run('check-naming.sh');
    expect(result.status, result.output).toBe(2);
    expect(result.output).toContain('residue of its population');
  });

  it('exits 2 when the manifest index it derives the expectation from is gone', () => {
    // An expectation derived from a missing file is not an expectation, and a
    // check that quietly fell back to "self-reported" would be back where it
    // started.
    fixture.removeManifestIndex();
    const result = fixture.run('check-naming.sh');
    expect(result.status, result.output).toBe(2);
    expect(result.output).toContain('manifest index');
  });

  it('does not refuse an empty --diff listing — the one population allowed to be empty', () => {
    // The carve-out, asserted rather than assumed: in --diff mode the
    // population is the merge request, so zero is "this one touched nothing in
    // scope". Refusing it would fail the pipeline on a docs-only change. Full
    // mode is the test above, and the two must not converge.
    fixture.listsExactly([]);
    const result = fixture.run('check-naming.sh', ['--diff'], { FAKE_GIT_HAS_BASE_REF: '0' });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('[naming] read: files=0 sources=self-reported');
  });

  it('exits 2 when the module tree is gone but the listing is not (issue #215)', () => {
    // Three of the five rules read the module tree off the filesystem rather
    // than off the listing, so a moved module tree left them iterating nothing
    // while the other two reported on the residue — and the script printed
    // "✓ Naming conventions OK (full mode)". Measured on the real tree: with
    // `src/modules` moved out of `src`, it exited 0.
    //
    // The listing is deliberately non-empty here, so the empty-listing guard
    // above cannot be what fires. Since T012 the root is resolved from the
    // generated index, so a tree that is *gone* is refused at the resolution,
    // before any rule runs.
    fixture.removeModuleTree();
    fixture.lists(['backend/src/kernel/thing.ts']);
    const result = fixture.run('check-naming.sh');
    expect(result.status, result.output).toBe(2);
    expect(result.output).toContain('no generated manifest index');
  });

  it('exits 2 when the module root resolves twice, rather than picking one', () => {
    // Feature 080, T012. Two indexes is two candidate roots, and a scan
    // narrowed to whichever sorted first would report on one tree while
    // claiming the repository. It is the same refusal `check-port-shape` makes
    // when its input has two answers: guessing is the thing that cannot be
    // detected afterwards.
    fixture.write(
      'backend/src/legacy-modules/_lifecycle/manifest-index.generated.ts',
      "import { manifest as manifest0 } from '../orders/manifest.js';\n",
    );
    const result = fixture.run('check-naming.sh');
    expect(result.status, result.output).toBe(2);
    expect(result.output).toContain('more than one generated manifest index');
  });

  it('follows the module tree when it moves, instead of reporting a clean repository', () => {
    // The one T012 is for, and the discrimination against the two refusals
    // above: the tree has *moved*, not gone, and the check must go on judging
    // it. Measured against the script this replaced, which spelled
    // `backend/src/modules` in eight places: this fixture exited **2** — the
    // #215 floor firing, correctly, on a check that could no longer find
    // anything to judge. That is the right answer for a tree that is gone and
    // the wrong one for a tree that moved, and until the root was resolved the
    // two were the same event. The finding below is what a resolved root buys:
    // the module folder rule still ran, and it still found `BadName`.
    const moved = fixture.moveModuleTree('domain_modules');
    fixture.write(`${moved}/BadName/thing.ts`, 'export const a = 1;\n');
    fixture.listsExactly([`${moved}/orders/order-service.ts`, `${moved}/BadName/thing.ts`]);

    const result = fixture.run('check-naming.sh');

    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('BadName');
    // Named at its new address, not the old one: a message that still said
    // `backend/src/modules` would be an instruction to look where the file is
    // not.
    expect(result.output).toContain(`${moved}/BadName`);
    // And the population it reconciled against moved with it.
    expect(result.output).toMatch(/\[naming] read: files=2 sources=manifest-index:1\/1/);
  });

  it('goes on enforcing the migration class scope at the moved root', () => {
    // The fifth rule derives the owning module id by stripping the root off the
    // path, which is the one place a re-rooting can be half-done: strip the old
    // literal off a path that no longer starts with it and the id comes out as
    // `src/domain_modules/orders`, so every class name reads unscoped and the
    // rule fails on everything at once. The second assertion is that shape,
    // named rather than left to a passing exit code.
    const moved = fixture.moveModuleTree('domain_modules');
    fixture.write(
      `${moved}/orders/migrations/20270101T000000_orders_probe.ts`,
      'export class Migration20270101T000000CatalogProbe extends Migration {}\n',
    );
    fixture.listsExactly([`${moved}/orders/order-service.ts`]);

    const result = fixture.run('check-naming.sh');

    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('Migration<STAMP>Orders');
    expect(result.output).not.toContain('Migration<STAMP>SrcDomainModules');
  });
});

describe('check-language.sh', () => {
  it('passes on a clean fixture', () => {
    expect(fixture.run('check-language.sh').status).toBe(0);
  });

  it('goes red on a non-English comment in a source file', () => {
    fixture.write('backend/src/modules/orders/order-service.ts', POLISH_COMMENT);
    const result = fixture.run('check-language.sh');
    expect(result.status).toBe(1);
    expect(result.output).toContain('Non-English comment');
  });

  it('does not flag a cited term — a comment may quote a label it cannot translate', () => {
    fixture.write(
      'backend/src/modules/orders/order-service.ts',
      '// The status renders as `Zamówienie złożone` in the Polish bundle.\nexport const a = 1;\n',
    );
    expect(fixture.run('check-language.sh').status).toBe(0);
  });

  it('does not flag a string literal — only comments are in scope', () => {
    fixture.write(
      'backend/src/modules/orders/order-service.ts',
      "export const label = 'Zamówienie złożone';\n",
    );
    expect(fixture.run('check-language.sh').status).toBe(0);
  });

  it('goes red on a non-English docs page', () => {
    fixture.write('docs/docs/intro.md', '# Wstęp\n\nTo jest opis modułu.\n');
    const result = fixture.run('check-language.sh');
    expect(result.status).toBe(1);
    expect(result.output).toContain('Non-English characters in docs file');
  });

  it('honours the documented opt-out marker', () => {
    fixture.write('docs/docs/intro.md', `---\n${OPT_OUT_MARKER}\n---\n\n# Wstęp\n`);
    expect(fixture.run('check-language.sh').status).toBe(0);
  });

  it('exits 2 on an empty full-tree source listing', () => {
    fixture.lists([], ['docs/docs/intro.md']);
    const result = fixture.run('check-language.sh');
    expect(result.status).toBe(2);
    expect(result.output).toContain('vacuous');
  });

  it('exits 2 on an empty full-tree docs listing', () => {
    fixture.lists(['backend/src/modules/orders/order-service.ts'], []);
    const result = fixture.run('check-language.sh');
    expect(result.status).toBe(2);
    expect(result.output).toContain('vacuous');
  });

  it('exits 2 when git cannot answer', () => {
    const result = fixture.run('check-language.sh', [], { FAKE_GIT_IN_WORKTREE: '1' });
    expect(result.status).toBe(2);
    expect(result.output).toContain('needs git');
  });

  it('says how many files it read, over both of its scopes', () => {
    // Issue #244. `files` is the source listing plus the docs listing, because
    // the two scans are one run and one green tick covers both.
    const result = fixture.run('check-language.sh');
    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(/\[language] read: files=2 sources=manifest-index:1\/1/);
  });

  it('exits 2 on a full-mode listing that misses a registered module', () => {
    fixture.listsExactly(['backend/src/kernel/thing.ts']);
    const result = fixture.run('check-language.sh');
    expect(result.status, result.output).toBe(2);
    expect(result.output).toContain('residue of its population');
  });

  it('exits 2 when the manifest index it derives the expectation from is gone', () => {
    fixture.removeManifestIndex();
    const result = fixture.run('check-language.sh');
    expect(result.status, result.output).toBe(2);
    expect(result.output).toContain('manifest index');
  });

  it('does not refuse an empty --diff listing', () => {
    fixture.listsExactly([], []);
    const result = fixture.run('check-language.sh', ['--diff'], { FAKE_GIT_HAS_BASE_REF: '0' });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('[language] read: files=0 sources=self-reported');
  });
});

/**
 * The footprint gate (Constitution IV). It had no test and two silent exits:
 * a missing `du` and an uninstalled `pdfmake` both printed "skipping" and
 * returned 0, so the one situation in which it measures nothing was also the
 * one in which it reported success. Both now exit 2.
 */
describe('check-pdfmake-footprint.sh', () => {
  const MAX_BYTES = 32 * 1024 * 1024;

  it('passes on an install inside the budget', () => {
    fixture.installPdfmake(15 * 1024 * 1024);
    const result = fixture.run('check-pdfmake-footprint.sh');
    expect(result.status).toBe(0);
    expect(result.output).toContain('OK');
  });

  it('goes red when the install grows past the threshold', () => {
    fixture.installPdfmake(MAX_BYTES + 8 * 1024 * 1024);
    const result = fixture.run('check-pdfmake-footprint.sh');
    expect(result.status).toBe(1);
    expect(result.output).toContain('FAIL');
  });

  // The layout this repository actually installs. The gate lists it first and
  // falls back to the top-level path; a fixture that only ever builds the
  // fallback proves the fallback.
  it('measures a pnpm-hoisted install too, not only a top-level one', () => {
    fixture.installPdfmake(MAX_BYTES + 8 * 1024 * 1024, 'hoisted');
    const result = fixture.run('check-pdfmake-footprint.sh');
    expect(result.status).toBe(1);
    expect(result.output).toContain('.pnpm');
  });

  it('exits 2 when pdfmake is not installed, rather than reporting a pass', () => {
    const result = fixture.run('check-pdfmake-footprint.sh');
    expect(result.status).toBe(2);
    expect(result.output).toContain('nothing was measured');
  });

  it('says how many files it measured, not only how many bytes', () => {
    // Issue #244: `du` on a directory that exists and holds almost nothing
    // reports a small size, which this gate reads as "under budget". The file
    // count is what tells a pruned install from a healthy one.
    fixture.installPdfmake(15 * 1024 * 1024);
    const result = fixture.run('check-pdfmake-footprint.sh');
    expect(result.output).toMatch(/\[pdfmake-gate] read: files=\d+ sources=self-reported/);
  });
});
