// Overlay resolution — build-time contract check (FR-003, SC-004).
//
// A `service` overlay MUST satisfy the core unit's documented interface. We
// verify this with the TypeScript compiler API (already a devDependency): a
// synthesized type-level assertion `OverlayClass extends CoreInterface ? …`
// is compiled in-memory. If the overlay is not assignable to the interface,
// the assertion fails to type-check and we report a contract mismatch — the
// build fails rather than shipping a stale/incompatible override.
//
// No construction, no temp files: a virtual source file is injected via a
// custom CompilerHost. Contract drift (core changes the interface, the overlay
// does not) surfaces here at build time, never as a per-deployment runtime bug.

import { dirname, join, relative, sep } from 'node:path';
import ts from 'typescript';
import { repoRoot } from './overlay-roots.js';

export interface ContractCheckTarget {
  /** Absolute path to the overlay service file. */
  overlayFilePath: string;
  /** Exported class/const name in the overlay file that must satisfy the contract. */
  overlayExportName: string;
  /** Absolute path to the core interface file. */
  interfaceFilePath: string;
  /** Exported interface/type name the overlay must implement. */
  interfaceName: string;
}

export interface ContractCheckFailure {
  target: ContractCheckTarget;
  messages: string[];
}

export interface ContractCheckResult {
  ok: boolean;
  failures: ContractCheckFailure[];
}

const VIRTUAL_DIR = 'src'; // virtual assertion file lives at backend/src/__overlay_contract_check__.ts

function importSpecifier(fromDir: string, targetFile: string): string {
  let rel = relative(fromDir, targetFile).replace(/\.ts$/, '.js');
  if (sep !== '/') rel = rel.split(sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function baseCompilerOptions(backendDir: string): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    baseUrl: backendDir,
    paths: {
      '@core/*': ['src/*'],
      '@b2b/contracts': ['../packages/contracts/src/index.ts'],
      '@b2b/contracts/*': ['../packages/contracts/src/*'],
    },
  };
}

/**
 * Check one service overlay against its core interface. Returns the diagnostic
 * messages attributable to the assertion when it fails, else an empty list.
 */
export function checkContractTarget(
  target: ContractCheckTarget,
  backendDir = join(repoRoot(), 'backend'),
): string[] {
  const virtualDir = join(backendDir, VIRTUAL_DIR);
  const virtualPath = join(virtualDir, '__overlay_contract_check__.ts');
  const ifaceSpec = importSpecifier(virtualDir, target.interfaceFilePath);
  const overlaySpec = importSpecifier(virtualDir, target.overlayFilePath);

  // Class name in type position = instance type; `extends` is structural.
  const virtualSource = [
    `import type { ${target.interfaceName} as __Iface } from '${ifaceSpec}';`,
    `import type { ${target.overlayExportName} as __Overlay } from '${overlaySpec}';`,
    `type __Assert = __Overlay extends __Iface`,
    `  ? true`,
    `  : { OVERLAY_DOES_NOT_SATISFY_CORE_INTERFACE: ['${target.interfaceName}'] };`,
    `const __check: __Assert = true;`,
    `void __check;`,
    ``,
  ].join('\n');

  const options = baseCompilerOptions(backendDir);
  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (fileName === virtualPath) {
      return ts.createSourceFile(fileName, virtualSource, languageVersion, true);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  host.readFile = (fileName) => (fileName === virtualPath ? virtualSource : originalReadFile(fileName));
  host.fileExists = (fileName) => (fileName === virtualPath ? true : originalFileExists(fileName));

  const program = ts.createProgram([virtualPath], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const messages: string[] = [];
  for (const d of diagnostics) {
    if (d.file && d.file.fileName === virtualPath) {
      messages.push(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    }
  }
  return messages;
}

/** Check every service override target; aggregate failures. */
export function checkCoreContracts(
  targets: readonly ContractCheckTarget[],
  backendDir = join(repoRoot(), 'backend'),
): ContractCheckResult {
  const failures: ContractCheckFailure[] = [];
  for (const target of targets) {
    const messages = checkContractTarget(target, backendDir);
    if (messages.length > 0) failures.push({ target, messages });
  }
  return { ok: failures.length === 0, failures };
}

/** Derive contract targets from resolved service overrides (interface path known). */
export function contractTargetsFor(
  overrides: ReadonlyArray<{
    moduleId: string;
    relPath: string;
    overlayPath: string;
    corePath: string;
    interfaceRelPath: string | null;
    kind: string;
  }>,
  coreRoot: string,
  overlayExportName = 'default',
): ContractCheckTarget[] {
  const targets: ContractCheckTarget[] = [];
  for (const o of overrides) {
    if (o.kind !== 'service' || o.interfaceRelPath === null) continue;
    targets.push({
      overlayFilePath: o.overlayPath,
      overlayExportName,
      interfaceFilePath: join(coreRoot, o.moduleId, o.interfaceRelPath),
      interfaceName: deriveInterfaceName(o.interfaceRelPath),
    });
  }
  void dirname; // reserved for future per-target dir resolution
  return targets;
}

/** `services/pricing-service.interface.ts` → `PricingServiceContract` (convention). */
function deriveInterfaceName(interfaceRelPath: string): string {
  const base = interfaceRelPath.split('/').pop() ?? interfaceRelPath;
  const stem = base.replace(/\.interface\.ts$/, '');
  const pascal = stem
    .split(/[-_.]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  return `${pascal}Contract`;
}
