import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Command-coverage check — feature 054 (FR-009 / FR-010, Constitution Principle XIII).
 *
 * `pnpm --filter backend run check:command-coverage -- [--strict] [--module <name> ...]`
 *
 * Flags, **per method/function** in service files (`modules/<m>/services/*.ts`):
 *   1. an **unaudited sensitive write** — a method that performs a mutation call
 *      (`persist*`, `nativeUpdate`, `nativeDelete`, `remove*`, `flush`) but
 *      neither runs a Command (`commandBus.run(...)`) nor writes audit
 *      (`.record*(...)`) in the same method;
 *   2. a **double-audit** — a method that BOTH runs a Command AND writes audit by
 *      hand (a converted write must remove its manual audit call, FR-010).
 *
 * Method-level (not file-level) so a partially-migrated file is judged per
 * method: a converted `adjust` no longer masks an unaudited `grant` in the same
 * file, and a Command in one method is not mistaken for a double-audit against a
 * legacy `record()` in another.
 *
 * Escape hatch: a genuinely non-sensitive write (bookkeeping rows — progress
 * counters, cache, queue state) can be exempted by putting a
 * `command-coverage-ignore: <reason>` comment anywhere in the method. This keeps
 * "build-breaking per module" honest without forcing audit onto non-domain writes,
 * mirroring the audited `withSystemScope` escape hatch for tenancy.
 *
 * ## The escape hatch is a two-way ratchet (issue #116)
 *
 * 185 methods carry that comment, and until now nothing ever re-read one. An
 * ignore written for a write that has since moved elsewhere — into a Command, or
 * into another module's audited service — went on reading as a considered
 * decision about a write that is no longer there, and the next person to add a
 * write to that method inherited the exemption silently.
 *
 * So a marker on a method that **no longer writes at all** is reported as
 * `stale-ignore`, in the idiom of `PORT_CATCHES_TO_DRAIN` and
 * `BARE_SUBSCRIPTIONS_TO_DRAIN`: an unledgered violation fails the build, and an
 * entry that no longer describes one fails it too. MR !532's marker in
 * `orders/order-completion-reactor.ts` — added because a refactor made an
 * *existing* write visible to this check — is exactly the entry that has to be
 * re-verified rather than trusted, and now it is, on every run.
 *
 * **The staleness half looks for writes more widely than the flagging half**,
 * and the asymmetry is deliberate: both errors then fall on the safe side. The
 * flagging half only flags an ORM mutation call it is sure about; the staleness
 * half additionally counts a raw SQL write statement (`conn.execute` with an
 * `update`/`insert into`/`delete from`) and any write reached transitively
 * through `this.<name>(…)` in the same file — so a marker guarding a real write
 * this check cannot itself see is left alone, and only a marker guarding nothing
 * is reported.
 *
 * Scope & staging: build-breaks (exit 1) for **migrated modules**
 * (`MIGRATED_MODULES` below, or `--module`); any other module would be
 * report-only. The platform-wide rollout is COMPLETE — every module is migrated
 * (see the list below) and CI runs with `--strict`, so a finding in ANY module,
 * including a brand-new one not yet in the list, fails the build.
 */

/**
 * Modules whose service writes are converted to Commands / audited / escape-hatched
 * (build-breaking). The rollout is complete: this is the full module set. New
 * modules should be added here as they land, but CI's `--strict` flag already
 * fails on findings in unlisted modules too, so coverage cannot silently regress.
 */
export const MIGRATED_MODULES: readonly string[] = [
  'credit_limits',
  'price_lists',
  'catalog',
  'orders',
  'inventory',
  'returns',
  'quote_requests',
  'organizations',
  'promotions',
  'carts',
  'customer_accounts',
  'assets_library',
  'shopping_lists',
  'dictionaries',
  'currencies',
  'languages',
  'mfa',
  'stripe',
  'tpay',
  'payu',
  'transactional_emails',
  'invoices',
  'newsletter',
  'admin_users',
  'payments',
  'shipments',
  'payment_methods',
  'delivery_methods',
  'addresses',
  'auth',
  'customers',
  'taxes',
  'api_keys',
  'admin_roles',
  'seo',
  'webhooks',
  'settings',
  'comparisons',
  'pwa',
  'prompt_actions',
  'analytics',
  'search',
  'cms',
  'admin_notifications',
  'admin_actions',
  '_i18n',
  'credentials',
  'ksef',
  'product_feeds',
  'pim_ergonode',
];

const MUTATION_METHODS = new Set([
  'persist',
  'persistAndFlush',
  'nativeUpdate',
  'nativeDelete',
  'remove',
  'removeAndFlush',
  'flush',
]);

/**
 * A SQL statement that writes, as it appears in a string or template literal
 * handed to `conn.execute` / `em.execute`.
 *
 * Only the staleness half reads this. Matching prose in a literal
 * (`'update the row'`) marks the unit as writing, which suppresses a staleness
 * report — the safe direction, since the cost is a marker left standing rather
 * than a marker deleted off a live write.
 */
const SQL_WRITE = /\b(insert\s+into|update\s+["`']?[a-z_]|delete\s+from|truncate\s+table)/i;

const AUDIT_RECEIVER =
  /(auditLog|auditLogService|auditService|AuditLogService|cartAuditService|\.audit)$/;
const SUPPRESS_TOKEN = 'command-coverage-ignore';

export type FindingKind = 'unaudited-sensitive-write' | 'double-audit' | 'stale-ignore';

export interface CoverageFinding {
  filePath: string;
  line: number | null;
  method: string;
  kind: FindingKind;
  message: string;
}

interface UnitScan {
  hasMutation: boolean;
  mutationLine: number | null;
  hasAuditWrite: boolean;
  runsCommand: boolean;
  /** Contains a `Command` object literal (has `action` + `run` properties). */
  definesCommand: boolean;
  /** Names of `this.<name>(...)` methods this unit calls (for runner delegation). */
  callsThis: Set<string>;
  /**
   * Writes anything at all, by the widest reading: an ORM mutation call OR a raw
   * SQL write statement. Only the staleness sweep uses it — see the header.
   */
  writesAnything: boolean;
}

/** Whether an object literal is a Command definition (`action` + `run` props). */
function isCommandLiteral(node: ts.ObjectLiteralExpression): boolean {
  const names = new Set(
    node.properties
      .map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : null))
      .filter((n): n is string => n !== null),
  );
  return names.has('action') && names.has('run');
}

/** Scan a single method/function subtree for mutation / audit / command calls. */
function scanUnit(node: ts.Node, sf: ts.SourceFile): UnitScan {
  const scan: UnitScan = {
    hasMutation: false,
    mutationLine: null,
    hasAuditWrite: false,
    runsCommand: false,
    definesCommand: false,
    callsThis: new Set(),
    writesAnything: false,
  };
  const visit = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n) && isCommandLiteral(n)) {
      scan.definesCommand = true;
    }
    if (ts.isStringLiteralLike(n) && SQL_WRITE.test(n.text)) {
      scan.writesAnything = true;
    }
    // The sanctioned free-function audit primitive (commands/audit-from-context):
    // `recordAuditFromContext(auditLog, em, …)` writes a co-transactional entry.
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'recordAuditFromContext'
    ) {
      scan.hasAuditWrite = true;
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const receiver = n.expression.expression;
      const receiverText = receiver.getText(sf);
      if (MUTATION_METHODS.has(method)) {
        scan.hasMutation = true;
        scan.writesAnything = true;
        if (scan.mutationLine === null) {
          scan.mutationLine = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        }
      }
      if ((method === 'record' || method === 'recordWithin') && AUDIT_RECEIVER.test(receiverText)) {
        scan.hasAuditWrite = true;
      }
      if (method === 'run' && /commandBus$/.test(receiverText)) {
        scan.runsCommand = true;
      }
      // `this.<name>(...)` — a candidate delegation to an audited runner.
      if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
        scan.callsThis.add(method);
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return scan;
}

/** A named method/function unit and whether it opted out via the escape-hatch comment. */
interface Unit {
  name: string;
  node: ts.Node;
  suppressed: boolean;
  /** Where the `command-coverage-ignore` comment sits, so a stale one is findable. */
  suppressedLine: number | null;
}

function unitName(node: ts.Node): string {
  if (
    (ts.isMethodDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText();
  }
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isPropertyDeclaration(node) && node.name) return node.name.getText();
  if (ts.isVariableDeclaration(node) && node.name) return node.name.getText();
  return '<anonymous>';
}

function isArrowOrFn(node: ts.Node | undefined): boolean {
  return !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

/** Collect top-level method/function units (not inline callbacks). */
function collectUnits(sf: ts.SourceFile): Unit[] {
  const units: Unit[] = [];
  const walk = (node: ts.Node): void => {
    let root: ts.Node | null = null;
    if (
      ts.isMethodDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      root = node;
    } else if (ts.isPropertyDeclaration(node) && isArrowOrFn(node.initializer)) {
      root = node; // class field arrow method
    } else if (
      ts.isVariableDeclaration(node) &&
      isArrowOrFn(node.initializer) &&
      // only top-level `const x = () => …`, not locals inside a method
      node.parent?.parent?.parent !== undefined &&
      ts.isSourceFile(node.parent.parent.parent)
    ) {
      root = node;
    }

    if (root) {
      const suppressedLine = suppressionLine(root, sf);
      units.push({
        name: unitName(root),
        node: root,
        suppressed: suppressedLine !== null,
        suppressedLine,
      });
      return; // do NOT recurse — inline callbacks belong to this unit
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return units;
}

/** The 1-based line of this unit's `command-coverage-ignore`, or `null`. */
function suppressionLine(node: ts.Node, sf: ts.SourceFile): number | null {
  const full = sf.getFullText();
  const start = node.getFullStart();
  const offset = full.indexOf(SUPPRESS_TOKEN, start);
  if (offset !== -1 && offset < node.getEnd()) {
    return sf.getLineAndCharacterOfPosition(offset).line + 1;
  }
  const leading = ts.getLeadingCommentRanges(full, start) ?? [];
  for (const r of leading) {
    const at = full.indexOf(SUPPRESS_TOKEN, r.pos);
    if (at !== -1 && at < r.end) return sf.getLineAndCharacterOfPosition(at).line + 1;
  }
  return null;
}

/** Static, dependency-free per-method analysis of a single source file. */
export function analyzeSource(filePath: string, source: string): CoverageFinding[] {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const units = collectUnits(sf).map((u) => ({ ...u, scan: scanUnit(u.node, sf) }));

  // Pass 1 — a "runner" method executes writes through the Command Bus (calls
  // commandBus.run, or defines a Command literal the bus will run). A method that
  // delegates to a runner (`this.<runner>(...)`) is therefore audited too.
  const runnerNames = new Set(
    units.filter((u) => u.scan.runsCommand || u.scan.definesCommand).map((u) => u.name),
  );
  // …and a "recorder" method writes audit by hand (`auditLog.record(...)` /
  // `.recordWithin(...)`). A very common shape is a public write that mutates and
  // then calls a private `this.writeAudit()` helper which records — the mutation
  // and the audit call live in different methods. Recognizing delegation to a
  // recorder (symmetric with runner delegation) clears that legitimate pattern
  // instead of flagging an already-audited write as unaudited.
  const recorderNames = new Set(units.filter((u) => u.scan.hasAuditWrite).map((u) => u.name));

  // A unit is directly covered if it runs a Command, defines one, records audit,
  // or forward-delegates to a runner/recorder.
  const isDirectlyCovered = (u: (typeof units)[number]): boolean =>
    u.scan.runsCommand ||
    u.scan.definesCommand ||
    u.scan.hasAuditWrite ||
    [...u.scan.callsThis].some((n) => runnerNames.has(n) || recorderNames.has(n));

  // Reverse delegation — a mutating PRIVATE helper (`applyGlobal`, `applyProduct`)
  // that is invoked by a covered public method is part of that method's audited
  // unit of work: its `em.persist` only flushes when the covered caller flushes,
  // co-transactionally with the caller's audit/Command. Collect every method name
  // called via `this.<name>()` from a covered unit and treat those as covered too.
  const coveredCallees = new Set<string>();
  for (const u of units) {
    if (isDirectlyCovered(u)) for (const n of u.scan.callsThis) coveredCallees.add(n);
  }

  // The staleness half. A unit still writes if it writes itself, or if anything
  // it calls as `this.<name>(…)` in this file does — `reserve()` delegating to
  // `#reserveFlat()`, a reaper delegating to `release()`. Memoised over the
  // recursion so a cycle terminates.
  const byName = new Map(units.map((u) => [u.name, u]));
  const reachesWrite = (name: string, seen = new Set<string>()): boolean => {
    if (seen.has(name)) return false;
    seen.add(name);
    const unit = byName.get(name);
    if (!unit) return false;
    if (unit.scan.writesAnything) return true;
    return [...unit.scan.callsThis].some((callee) => reachesWrite(callee, seen));
  };

  const findings: CoverageFinding[] = [];
  for (const u of units) {
    if (u.suppressed) {
      if (!reachesWrite(u.name)) {
        findings.push({
          filePath,
          line: u.suppressedLine,
          method: u.name,
          kind: 'stale-ignore',
          message:
            `${u.name}() carries a command-coverage-ignore but writes nothing — ` +
            'the write it exempted has moved or gone. Delete the marker; keep the ' +
            'sentence as an ordinary comment if it still explains something',
        });
      }
      continue;
    }
    const s = u.scan;
    const covered = isDirectlyCovered(u) || coveredCallees.has(u.name);
    if (s.hasMutation && !covered) {
      findings.push({
        filePath,
        line: s.mutationLine,
        method: u.name,
        kind: 'unaudited-sensitive-write',
        message: `${u.name}() mutates without a Command or an audit entry`,
      });
    }
    if (s.runsCommand && s.hasAuditWrite) {
      findings.push({
        filePath,
        line: s.mutationLine,
        method: u.name,
        kind: 'double-audit',
        message: `${u.name}() runs a Command AND records audit by hand (remove the manual record() — FR-010)`,
      });
    }
  }
  return findings;
}

/** Whether a repo-relative service path belongs to a build-breaking (migrated) module. */
export function isMigratedServicePath(
  relPath: string,
  migrated: readonly string[] = MIGRATED_MODULES,
): boolean {
  const m = /modules\/([^/]+)\/services\//.exec(relPath.replaceAll('\\', '/'));
  return m !== null && migrated.includes(m[1]!);
}

// ---- CLI (disk-backed) ----------------------------------------------------

/**
 * Every service file the check judges, under `root` (normally `src/modules`).
 *
 * Exported so the check's own test can assert the **real** tree is clean rather
 * than only that the analyzer can go red on a fixture — the scan scope then has
 * one definition, shared by the CLI and the test.
 */
export function collectServiceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === 'dist' || name === 'migrations') continue;
        walk(full);
      } else if (
        /\/services\/[^/]+\.ts$/.test(full.replaceAll('\\', '/')) &&
        !full.endsWith('.d.ts') &&
        !full.endsWith('.test.ts') &&
        !full.includes('/audit_logs/')
      ) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

function main(): void {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const moduleArgs = argv.reduce<string[]>((acc, arg, i) => {
    if (arg === '--module' && argv[i + 1]) acc.push(argv[i + 1]!);
    return acc;
  }, []);
  const migrated = moduleArgs.length > 0 ? moduleArgs : MIGRATED_MODULES;

  const modulesRoot = join(process.cwd(), 'src', 'modules');
  const files = collectServiceFiles(modulesRoot);
  if (files.length === 0) {
    // Run from the wrong directory, or after a layout change, the walk finds
    // nothing and every write in the platform passes unexamined. Exit 2: a
    // green line here would say "no unaudited write", which is not what it
    // would mean.
    process.stderr.write(
      `[command-coverage] no service files under ${modulesRoot} — refusing to report a vacuous pass\n`,
    );
    process.exit(2);
  }

  let blocking = 0;
  let reportOnly = 0;
  for (const file of files) {
    const rel = relative(process.cwd(), file);
    const findings = analyzeSource(rel, readFileSync(file, 'utf8'));
    if (findings.length === 0) continue;
    const isBlocking = strict || isMigratedServicePath(rel, migrated);
    for (const f of findings) {
      const tag = isBlocking ? 'ERROR' : 'report';
      process.stdout.write(`[${tag}] ${f.filePath}:${f.line ?? '?'} → ${f.kind}: ${f.message}\n`);
      if (isBlocking) blocking += 1;
      else reportOnly += 1;
    }
  }

  process.stdout.write(
    `\ncommand-coverage: ${blocking} blocking, ${reportOnly} report-only ` +
      `(migrated modules: ${migrated.length > 0 ? migrated.join(', ') : 'none'})\n`,
  );
  if (blocking > 0) process.exit(1);
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main();
