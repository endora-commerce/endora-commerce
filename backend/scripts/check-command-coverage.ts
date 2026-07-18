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
 * Scope & staging: build-breaks (exit 1) only for **migrated modules**
 * (`MIGRATED_MODULES` below, or `--module`); every other module is report-only.
 * `--strict` build-breaks on any finding.
 */

/** Modules whose service writes have been converted to Commands (build-breaking). Grows over time. */
export const MIGRATED_MODULES: readonly string[] = ['credit_limits', 'price_lists', 'catalog', 'orders'];

const MUTATION_METHODS = new Set([
  'persist',
  'persistAndFlush',
  'nativeUpdate',
  'nativeDelete',
  'remove',
  'removeAndFlush',
  'flush',
]);

const AUDIT_RECEIVER = /(auditLog|auditLogService|auditService|AuditLogService|cartAuditService)$/;
const SUPPRESS_TOKEN = 'command-coverage-ignore';

export type FindingKind = 'unaudited-sensitive-write' | 'double-audit';

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
  };
  const visit = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n) && isCommandLiteral(n)) {
      scan.definesCommand = true;
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const receiver = n.expression.expression;
      const receiverText = receiver.getText(sf);
      if (MUTATION_METHODS.has(method)) {
        scan.hasMutation = true;
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
      units.push({ name: unitName(root), node: root, suppressed: nodeSuppressed(root, sf) });
      return; // do NOT recurse — inline callbacks belong to this unit
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return units;
}

function nodeSuppressed(node: ts.Node, sf: ts.SourceFile): boolean {
  if (node.getFullText(sf).includes(SUPPRESS_TOKEN)) return true;
  const leading = ts.getLeadingCommentRanges(sf.getFullText(), node.getFullStart()) ?? [];
  return leading.some((r) => sf.getFullText().slice(r.pos, r.end).includes(SUPPRESS_TOKEN));
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

  const findings: CoverageFinding[] = [];
  for (const u of units) {
    if (u.suppressed) continue;
    const s = u.scan;
    const covered =
      s.runsCommand ||
      s.definesCommand ||
      s.hasAuditWrite ||
      [...s.callsThis].some((n) => runnerNames.has(n));
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

function collectServiceFiles(root: string): string[] {
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
