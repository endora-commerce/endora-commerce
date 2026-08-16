import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeOverlayModulesRoot } from '../../overlay/overlay-roots.js';

/**
 * Static inventory of the permission codes the backend actually enforces.
 *
 * It exists so `/admin-roles` can never advertise less than the server checks:
 * a code enforced at a gate but absent from the assignable catalogue is a screen
 * only a `'*'` role can open, and nothing else in the tree notices.
 *
 * The scanner therefore has to read the gate call in **every shape the tree
 * writes it**, not the one shape it was first written against. It previously
 * required an optional-call dot before the argument list, so a plain
 * `requireAdmin('code')` — nearly the whole tree — was invisible to it, and it
 * read clean while modules gated screens on codes no role could hold. The shapes are
 * enumerated on `collectFromSource` and each is covered by a fixture in
 * `test/unit/admin_roles/permission-inventory-scanner.test.ts`; an argument the
 * scanner cannot resolve is reported as `unresolved` rather than dropped,
 * because a silently dropped gate is exactly the failure this file guards.
 */

/** `backend/src` — this file lives at `backend/src/modules/admin_roles/`. */
const BACKEND_SRC = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** `packages/contracts/src` — permission maps shared across modules live here. */
const CONTRACTS_SRC = resolve(BACKEND_SRC, '..', '..', 'packages', 'contracts', 'src');

/** How a gate site resolves to a permission code. */
export type GateResolution =
  /** The argument resolved to one or more literal permission codes. */
  | 'code'
  /** `requireAdmin()` — any authenticated admin, no code to check. */
  | 'authenticated-admin'
  /**
   * The argument is a value bound at runtime — a guard implementation consuming
   * its own parameter, a delegating re-registration forwarding one, or a
   * registry entry supplying a code its contributing module writes elsewhere.
   * There is no literal to check here; the literal is checked where it is
   * written, which is a site this scan also reads.
   */
  | 'runtime-value'
  /** An argument the scanner could not resolve — reported, never dropped. */
  | 'unresolved';

export interface EnforcedGateSite {
  /** Path relative to `backend/src`, for a failure message that can be acted on. */
  readonly file: string;
  /** The module directory owning the file, or `null` outside a module tree. */
  readonly moduleId: string | null;
  /** The raw argument text, normalised to a single line. */
  readonly expression: string;
  readonly resolution: GateResolution;
  /** Codes this site enforces; empty unless `resolution === 'code'`. */
  readonly codes: readonly string[];
}

export interface PermissionScanResult {
  readonly codes: Set<string>;
  readonly sites: readonly EnforcedGateSite[];
  readonly unresolved: readonly EnforcedGateSite[];
  readonly runtimeValue: readonly EnforcedGateSite[];
  readonly authenticatedAdminOnly: readonly EnforcedGateSite[];
}

/**
 * The roots a bare-core build enforces gates in, plus the active deployment's
 * overlay modules (feature 057 — an overlay module is an ordinary lifecycle
 * participant, so its gates count for that deployment and for no other).
 *
 * `src/apps` is skipped during the walk rather than excluded by name: a
 * deployment that is not the selected one is not part of this build, and its
 * permissions are not assignable here.
 */
export function defaultScanRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const overlayRoot = activeOverlayModulesRoot(env);
  return overlayRoot === null ? [BACKEND_SRC] : [BACKEND_SRC, overlayRoot];
}

/**
 * Distinct permission codes referenced by an enforcement site under the scan
 * roots. Kept for callers that only need the set (SC-001).
 */
export function scanEnforcedPermissionCodes(roots?: readonly string[]): Set<string> {
  return scanEnforcedPermissionGates(roots).codes;
}

/** Every enforcement site under `roots`, classified. */
export function scanEnforcedPermissionGates(
  roots: readonly string[] = defaultScanRoots(),
): PermissionScanResult {
  const sites: EnforcedGateSite[] = [];
  const seen = new Set<string>();
  const resolver = new ConstantResolver();
  for (const root of roots) {
    for (const file of walkSources(root, seen)) {
      collectFromFile(file, root, resolver, sites);
    }
  }
  const codes = new Set<string>();
  for (const site of sites) for (const code of site.codes) codes.add(code);
  return {
    codes,
    sites,
    unresolved: sites.filter((s) => s.resolution === 'unresolved'),
    runtimeValue: sites.filter((s) => s.resolution === 'runtime-value'),
    authenticatedAdminOnly: sites.filter((s) => s.resolution === 'authenticated-admin'),
  };
}

function* walkSources(dir: string, seen: Set<string>): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // `apps` is reached through `defaultScanRoots`, and only for the selected
      // deployment; `node_modules` is never ours.
      if (entry.name === 'node_modules' || entry.name === 'apps') continue;
      yield* walkSources(path, seen);
      continue;
    }
    if (!entry.isFile() || !/\.(ts|js)$/.test(entry.name)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    yield path;
  }
}

/** The module directory owning `file`, for attribution in failure messages. */
function moduleIdFor(file: string, root: string): string | null {
  const rel = relative(root, file);
  const segments = rel.split(/[\\/]/);
  if (segments[0] === 'modules') return segments[1] ?? null;
  // An overlay root IS the modules root, so the first segment is the module id.
  return segments.length > 1 ? (segments[0] ?? null) : null;
}

function collectFromFile(
  file: string,
  root: string,
  resolver: ConstantResolver,
  out: EnforcedGateSite[],
): void {
  const source = resolver.sourceOf(file);
  if (source === null) return;
  if (!/requireAdmin|hasPermission/.test(source)) return;
  const moduleId = moduleIdFor(file, root);
  const relFile = relative(BACKEND_SRC, file);
  for (const site of collectFromSource(source, file, resolver)) {
    out.push({ ...site, file: relFile, moduleId });
  }
}

type PartialSite = Omit<EnforcedGateSite, 'file' | 'moduleId'>;

/**
 * The enforcement shapes this recognises, all of them present in the tree:
 *
 * - `requireAdmin('code')`, and the same call reached through a dependency bag
 *   or a container cradle (`deps.requireAdmin(…)`, `cradle().requireAdmin(…)`);
 * - the optional-call form `requireAdmin?.('code')`;
 * - `requireAdminAny(['a', 'b'])` in either of the above positions;
 * - a constant argument, resolved module-locally, through a relative import, or
 *   through `@b2b/contracts`, including a member read of a permission map;
 * - `permissionService.hasPermission(actor, 'code')` — the capability check a
 *   service uses where there is no route to hang a `preHandler` on.
 *
 * Comments and regular-expression literals are blanked first: a doc comment
 * quoting a gate is not a gate, several files quote one, and this file's own
 * matcher would otherwise read itself as a call site.
 */
function* collectFromSource(
  source: string,
  file: string,
  resolver: ConstantResolver,
): Generator<PartialSite> {
  const bound = collectRuntimeBindings(source);

  const callRe = /(?:[\w$]+\s*\??\.\s*)*(requireAdmin(?:Any)?|hasPermission)\s*(?:\?\.)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(source)) !== null) {
    const callee = m[1] ?? '';
    const open = source.indexOf('(', m.index + m[0].length - 1);
    if (open === -1) continue;
    const args = readBalanced(source, open);
    // A parameter list, not an argument list: the guard's own signature in an
    // interface or an implementation. Nothing is enforced by a declaration.
    if (PARAMETER_LIST_RE.test(args)) continue;
    // `hasPermission(actor, 'code')` puts the code second; the guards put it first.
    const argument = (callee === 'hasPermission' ? lastArgument(args) : firstArgument(args)).trim();
    const expression = argument.replace(/\s+/g, ' ');

    if (argument === '') {
      if (callee === 'hasPermission') continue;
      yield { expression: '', resolution: 'authenticated-admin', codes: [] };
      continue;
    }

    // `permission ?? ''` is the same runtime value with a default.
    const normalised = argument.replace(/\s*\?\?\s*(['"]).*?\1\s*$/, '').trim();

    if (/^['"[]/.test(normalised)) {
      const codes = [...normalised.matchAll(/(['"])([^'"]*)\1/g)]
        .map((lit) => lit[2] ?? '')
        .filter((code) => code.length > 0);
      yield codes.length > 0
        ? { expression, resolution: 'code', codes }
        : { expression, resolution: 'unresolved', codes: [] };
      continue;
    }

    // Resolve before classifying: a constant that happens to share a name with
    // a parameter somewhere in the file is still a constant.
    const identifier = /^[A-Za-z_$][\w$]*$/.test(normalised) ? normalised : null;
    const member = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(normalised);
    const value = identifier
      ? resolver.lookup(file, identifier, null)
      : member?.[1] && member[2]
        ? resolver.lookup(file, member[1], member[2])
        : null;
    if (value !== null) {
      yield { expression, resolution: 'code', codes: [value] };
      continue;
    }

    const rootName = identifier ?? member?.[1] ?? null;
    yield rootName !== null && bound.has(rootName)
      ? { expression, resolution: 'runtime-value', codes: [] }
      : { expression, resolution: 'unresolved', codes: [] };
  }
}

/** A leading `name:` or `name?:` marks a parameter list rather than arguments. */
const PARAMETER_LIST_RE = /^\s*(?:readonly\s+)?[A-Za-z_$][\w$]*\s*\??\s*:/;

/**
 * Identifiers the file binds to a value only known at runtime: function and
 * arrow parameters, `for (const x of …)` loop variables, and a `const` whose
 * initialiser is not a string literal (a registry lookup, say). An argument
 * rooted in one of these carries no literal to check; the literal — if there is
 * one — is written at the caller or the contributor, a site this scan reads
 * separately. Resolution is attempted first, so a genuine constant that shares
 * a name with a binding is still read as a constant.
 */
function collectRuntimeBindings(source: string): Set<string> {
  const bound = new Set<string>();
  let m: RegExpExecArray | null;

  const computedBindingRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+)?=\s*(?!['"])/g;
  while ((m = computedBindingRe.exec(source)) !== null) {
    if (m[1]) bound.add(m[1]);
  }

  const typedParamRe = /[(,]\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/g;
  while ((m = typedParamRe.exec(source)) !== null) {
    if (m[1]) bound.add(m[1]);
  }

  const arrowHeadRe = /\(([^()]*)\)\s*=>/g;
  while ((m = arrowHeadRe.exec(source)) !== null) {
    for (const part of (m[1] ?? '').split(',')) {
      const name = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(part);
      if (name?.[1]) bound.add(name[1]);
    }
  }

  const loopBindingRe = /for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+(?:of|in)\b/g;
  while ((m = loopBindingRe.exec(source)) !== null) {
    if (m[1]) bound.add(m[1]);
  }

  return bound;
}

/** Text between `openIndex`'s bracket and its match, quotes respected. */
function readBalanced(source: string, openIndex: number): string {
  let depth = 0;
  let i = openIndex;
  for (; i < source.length; i += 1) {
    const c = source[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) break;
    } else if (c === "'" || c === '"' || c === '`') {
      i = skipString(source, i);
    }
  }
  return source.slice(openIndex + 1, i);
}

/** Split on top-level commas only — an array or object argument keeps its own. */
function splitArguments(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const c = args[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === "'" || c === '"' || c === '`') i = skipString(args, i);
    else if (c === ',' && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts;
}

function firstArgument(args: string): string {
  return splitArguments(args)[0] ?? '';
}

function lastArgument(args: string): string {
  const parts = splitArguments(args);
  return parts[parts.length - 1] ?? '';
}

/** Index of the closing quote of the string starting at `i`. */
function skipString(source: string, i: number): number {
  const quote = source[i];
  let j = i + 1;
  while (j < source.length) {
    if (source[j] === '\\') {
      j += 2;
      continue;
    }
    if (source[j] === quote) return j;
    j += 1;
  }
  return j;
}

interface FileFacts {
  readonly source: string;
  readonly scalars: Map<string, string>;
  readonly objects: Map<string, Map<string, string>>;
  readonly imports: Map<string, { exportedAs: string; specifier: string }>;
}

/**
 * Resolves a constant argument to its literal, following at most a few hops:
 * module-local, a relative import, or `@b2b/contracts`. Deeper indirection has
 * never appeared, and pretending to resolve it would hide the same gate the
 * `unresolved` bucket is there to surface.
 */
class ConstantResolver {
  readonly #facts = new Map<string, FileFacts | null>();
  #contractsFiles: string[] | null = null;

  sourceOf(file: string): string | null {
    return this.#factsFor(file)?.source ?? null;
  }

  lookup(file: string, name: string, property: string | null, depth = 0): string | null {
    if (depth > 4) return null;
    const facts = this.#factsFor(file);
    if (!facts) return null;

    if (property === null) {
      const scalar = facts.scalars.get(name);
      if (scalar !== undefined) return scalar;
    } else {
      const value = facts.objects.get(name)?.get(property);
      if (value !== undefined) return value;
    }

    const imported = facts.imports.get(name);
    if (!imported) return null;
    for (const target of this.#resolveSpecifier(file, imported.specifier)) {
      const value = this.lookup(target, imported.exportedAs, property, depth + 1);
      if (value !== null) return value;
    }
    return null;
  }

  #factsFor(file: string): FileFacts | null {
    if (this.#facts.has(file)) return this.#facts.get(file) ?? null;
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      this.#facts.set(file, null);
      return null;
    }
    const source = blankComments(raw);
    const facts: FileFacts = {
      source,
      scalars: collectScalars(source),
      objects: collectObjects(source),
      imports: collectImports(source),
    };
    this.#facts.set(file, facts);
    return facts;
  }

  /** Candidate files a specifier may resolve to, in preference order. */
  #resolveSpecifier(from: string, specifier: string): string[] {
    if (specifier === '@b2b/contracts') return this.#contractsSources();
    if (!specifier.startsWith('.')) return [];
    const base = resolve(dirname(from), specifier);
    const candidates = [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts'), base];
    return candidates.filter((c) => existsSync(c) && statSync(c).isFile());
  }

  /**
   * `@b2b/contracts` re-exports everything from its barrel, so following the
   * barrel would mean parsing every `export *`. Scanning the package's own
   * sources for the constant reaches the same answer in one hop.
   */
  #contractsSources(): string[] {
    if (this.#contractsFiles !== null) return this.#contractsFiles;
    const files: string[] = [];
    if (existsSync(CONTRACTS_SRC)) {
      for (const entry of readdirSync(CONTRACTS_SRC, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.ts')) files.push(join(CONTRACTS_SRC, entry.name));
      }
    }
    this.#contractsFiles = files;
    return files;
  }
}

/**
 * Replace comment and regular-expression bodies with spaces, preserving offsets
 * and string literals.
 *
 * A regex literal is a `/` in a position where an expression may start (after an
 * operator, a bracket or a keyword), which is what distinguishes it from
 * division — division follows a value. Blanking them keeps a matcher written as
 * a pattern, this file's included, from reading as the thing it matches.
 */
function blankComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next !== '/' && next !== '*' && startsExpression(out)) {
      const end = skipRegex(source, i);
      out += '/';
      for (let k = i + 1; k < end; k += 1) out += source[k] === '\n' ? '\n' : ' ';
      out += end < source.length ? '/' : '';
      i = end + 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const end = skipString(source, i);
      out += source.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** True when the last significant character allows an expression to start. */
function startsExpression(emitted: string): boolean {
  const trimmed = emitted.replace(/\s+$/, '');
  if (trimmed.length === 0) return true;
  const last = trimmed[trimmed.length - 1] ?? '';
  if ('([{,;:=!&|?+-*%~^<>'.includes(last)) return true;
  return /\b(?:return|typeof|case|in|of|new|delete|void|do|else)$/.test(trimmed);
}

/** Index of the closing `/` of the regex literal starting at `i`. */
function skipRegex(source: string, i: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < source.length) {
    const c = source[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '\n') return j - 1;
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return j;
    j += 1;
  }
  return j;
}

function collectScalars(source: string): Map<string, string> {
  const scalars = new Map<string, string>();
  const re = /(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+)?=\s*(['"])([^'"]*)\2/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[1] && m[3] !== undefined) scalars.set(m[1], m[3]);
  }
  return scalars;
}

/** Flat `{ KEY: 'code' }` permission maps; nothing in the tree nests one. */
function collectObjects(source: string): Map<string, Map<string, string>> {
  const objects = new Map<string, Map<string, string>>();
  const re = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^={;]+)?=\s*\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    const body = m[2];
    if (!name || body === undefined) continue;
    const entries = new Map<string, string>();
    const propRe = /([A-Za-z_$][\w$]*)\s*:\s*(['"])([^'"]*)\2/g;
    let p: RegExpExecArray | null;
    while ((p = propRe.exec(body)) !== null) {
      if (p[1] && p[3] !== undefined) entries.set(p[1], p[3]);
    }
    if (entries.size > 0) objects.set(name, entries);
  }
  return objects;
}

function collectImports(source: string): Map<string, { exportedAs: string; specifier: string }> {
  const imports = new Map<string, { exportedAs: string; specifier: string }>();
  const re = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const clause = m[1];
    const specifier = m[2];
    if (!clause || !specifier) continue;
    for (const part of clause.split(',')) {
      const named = /^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(
        part.trim(),
      );
      if (!named?.[1]) continue;
      imports.set(named[2] ?? named[1], { exportedAs: named[1], specifier });
    }
  }
  return imports;
}
