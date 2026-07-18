import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Command-coverage check — feature 054 (FR-009 / FR-010, Constitution Principle XIII).
 *
 * `pnpm --filter backend run check:command-coverage -- [--strict] [--module <name> ...]`
 *
 * Flags, in service files (`modules/<m>/services/*.ts`):
 *   1. an **unaudited sensitive write** — a mutation call (`persist*`,
 *      `nativeUpdate`, `nativeDelete`, `remove*`, `flush`) in a file that neither
 *      runs a Command (`commandBus.run(...)`) nor writes audit (`.record*(...)`);
 *   2. a **double-audit** — a file that BOTH runs a Command AND writes audit by
 *      hand (a converted write must remove its manual audit call, FR-010).
 *
 * Scope & staging: the check build-breaks (exit 1) only for **migrated modules**
 * (`MIGRATED_MODULES` below, or `--module`); every other module is report-only,
 * so coverage is enforced module-by-module as writes are converted (spec Assumptions).
 * `--strict` build-breaks on any finding regardless of module.
 *
 * NOTE: this is a deliberately file-level heuristic (like the repo's
 * `i18n-hardcoded-strings` static check), not a full data-flow analysis — it
 * catches the regression shapes cheaply without a type checker.
 */

/** Modules whose service writes have been converted to Commands (build-breaking). Grows over time. */
export const MIGRATED_MODULES: readonly string[] = [];

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

export interface FileAnalysis {
  /** Performs at least one entity-mutation call. */
  hasMutation: boolean;
  /** Calls an audit writer (`.record(` / `.recordWithin(`). */
  hasAuditWrite: boolean;
  /** Runs a Command through the bus (`commandBus.run(`). */
  runsCommand: boolean;
  /** Line of the first mutation, for reporting. */
  firstMutationLine: number | null;
}

/** Static, dependency-free analysis of a single source file. */
export function analyzeSource(filePath: string, source: string): FileAnalysis {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const analysis: FileAnalysis = {
    hasMutation: false,
    hasAuditWrite: false,
    runsCommand: false,
    firstMutationLine: null,
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      const receiverText = receiver.getText(sf);

      if (MUTATION_METHODS.has(method)) {
        analysis.hasMutation = true;
        if (analysis.firstMutationLine === null) {
          analysis.firstMutationLine =
            sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        }
      }
      if ((method === 'record' || method === 'recordWithin') && AUDIT_RECEIVER.test(receiverText)) {
        analysis.hasAuditWrite = true;
      }
      if (method === 'run' && /commandBus$/.test(receiverText)) {
        analysis.runsCommand = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return analysis;
}

export type FindingKind = 'unaudited-sensitive-write' | 'double-audit';

export interface CoverageFinding {
  filePath: string;
  line: number | null;
  kind: FindingKind;
  message: string;
}

/** Turn one file's analysis into findings (pure — no disk). */
export function findingsFor(filePath: string, a: FileAnalysis): CoverageFinding[] {
  const out: CoverageFinding[] = [];
  if (a.hasMutation && !a.runsCommand && !a.hasAuditWrite) {
    out.push({
      filePath,
      line: a.firstMutationLine,
      kind: 'unaudited-sensitive-write',
      message: 'sensitive mutation neither runs a Command nor records an audit entry',
    });
  }
  if (a.runsCommand && a.hasAuditWrite) {
    out.push({
      filePath,
      line: a.firstMutationLine,
      kind: 'double-audit',
      message: 'file runs a Command AND writes audit by hand (remove the manual record() — FR-010)',
    });
  }
  return out;
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
    const analysis = analyzeSource(rel, readFileSync(file, 'utf8'));
    const findings = findingsFor(rel, analysis);
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
