import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { PermissionScanRoot } from '../../../packages/modules/admin_roles/src/backend/permission-inventory.js';
import type { ReadSizeInput } from '../../scripts/lib/read-size.js';

/**
 * The organization-permission half of the permission inventory
 * (`specs/170-organization-roles/` WP-01, T012/T020;
 * `contracts/organization-permissions-manifest.md` §4; FR-020, FR-021, FR-022).
 *
 * Two independent authors, reconciled:
 *
 *  - **the declarations** — every manifest's `organizationPermissions`, read
 *    from the generated manifest index, with the declaring module's bundles;
 *  - **the checks** — every call that names a code: the route guard
 *    `organizationPermissionPreHandler(getPort, code, …)` and the port's
 *    `can(subject, code)`, `assert(subject, code, …)` and
 *    `rolesHolding(organizationId, code)`, found by a walk over the same roots
 *    the operator scan reads.
 *
 * Its findings, each red on a synthetic fixture in the inventory test:
 *
 * | Kind | Meaning |
 * | --- | --- |
 * | `cross-vocabulary` | a string declared both as an operator and as an organization code |
 * | `foreign-declarer` | an organization code whose prefix is not its declaring module |
 * | `undeclared-check` | a code a guard or a port call names that no manifest declares |
 * | `unchecked-declaration` | a declared code nothing names — a grant that enforces nothing |
 * | `missing-label` | no `label` / `description` key in the reference language |
 * | `split-label` | the key in one shipped language and not another |
 * | `unresolved-argument` | a code argument the scanner cannot read — reported, never dropped |
 *
 * **What it reads as a code.** A string literal (or a template literal without
 * an interpolation); an identifier bound to one by a module-local `const`, or
 * by a `const` in a file the call's file imports by a relative path; a member
 * read `NAME.key` of a `const` object literal of such strings. An identifier
 * the file binds as a typed parameter or loop variable is a **runtime value**
 * — an implementation forwarding its own argument, such as the port's `assert`
 * calling `this.can(subject, code)` — and carries no literal to check here; the
 * literal is checked at its caller, a site this walk also reads. Anything else
 * is `unresolved-argument`.
 *
 * **Which `can` / `assert` / `rolesHolding` calls count.** Only member calls
 * (`x.can(…)`, `this.port().assert(…)`), and only in a file that names the
 * port (`OrganizationPermissionPort` or `organizationPermissionPort`): those
 * method names are generic, and a file that never reaches the port cannot be
 * calling it. Comments are blanked first, so a doc comment quoting a guard is
 * not a guard. Tests are not enforcement sites (the operator scan's rule).
 */

export type OrganizationPermissionFindingKind =
  | 'cross-vocabulary'
  | 'foreign-declarer'
  | 'undeclared-check'
  | 'unchecked-declaration'
  | 'missing-label'
  | 'split-label'
  | 'unresolved-argument';

export interface OrganizationPermissionDeclarationRow {
  readonly moduleId: string;
  readonly code: string;
}

export interface OrganizationPermissionSite {
  /** Path relative to the first bare-string scan root, for a message that can be acted on. */
  readonly file: string;
  readonly callee: 'organizationPermissionPreHandler' | 'can' | 'assert' | 'rolesHolding';
  /** The code argument's text, normalised to one line. */
  readonly expression: string;
  readonly resolution: 'code' | 'runtime-value' | 'unresolved';
  /** The codes this site names; empty unless `resolution === 'code'`. */
  readonly codes: readonly string[];
}

export interface OrganizationPermissionInventoryInput {
  readonly declarations: readonly OrganizationPermissionDeclarationRow[];
  /** The operator vocabulary — `PermissionCatalogueService.listKnownCodes()`. */
  readonly operatorCodes: ReadonlySet<string>;
  readonly sites: readonly OrganizationPermissionSite[];
  /** Per declaring module: per language, the bundle keys it ships. */
  readonly bundles: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;
  /** Shipped languages; the first is the reference language. */
  readonly languages: readonly string[];
}

export interface OrganizationPermissionFinding {
  readonly kind: OrganizationPermissionFindingKind;
  readonly code: string;
  readonly module?: string;
  readonly file?: string;
  readonly language?: string;
  readonly detail: string;
}

export interface OrganizationPermissionDeclarationWalk {
  readonly declarations: readonly OrganizationPermissionDeclarationRow[];
  readonly bundles: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;
  /** Bundle files opened, across the declaring modules. */
  readonly bundleFiles: number;
  /** Manifests the index lists — the independent expectation. */
  readonly manifests: number;
  /** Of those, the ones whose module directory the walk located. */
  readonly located: number;
}

export interface OrganizationPermissionSiteScan {
  /** Source files the walk opened. */
  readonly files: number;
  readonly sites: readonly OrganizationPermissionSite[];
}

/** The bundle key prefix a code's label and description sit under. */
export const ORGANIZATION_PERMISSION_LABEL_PREFIX = 'organizationPermissions.';

const LABEL_FIELDS = ['label', 'description'] as const;

// --- the declarations -----------------------------------------------------------

interface ManifestEntryLike {
  readonly manifest: {
    readonly id: string;
    readonly organizationPermissions?: ReadonlyArray<{ readonly code: string }> | undefined;
    readonly i18n?: { readonly bundlesDir: string } | undefined;
  };
  readonly filePath: string;
}

/**
 * Every declared code, with the declaring module's bundle keys under
 * {@link ORGANIZATION_PERMISSION_LABEL_PREFIX}. Bundles are opened for
 * declaring modules only: a label nobody declared is the operator sweep's kind
 * of question, not this one.
 */
export function walkOrganizationPermissionDeclarations(
  entries: ReadonlyArray<ManifestEntryLike>,
): OrganizationPermissionDeclarationWalk {
  const declarations: OrganizationPermissionDeclarationRow[] = [];
  const bundles = new Map<string, Map<string, ReadonlySet<string>>>();
  let bundleFiles = 0;
  let located = 0;

  for (const entry of entries) {
    const moduleDir = dirname(entry.filePath);
    if (existsSync(moduleDir)) located += 1;
    const declared = entry.manifest.organizationPermissions ?? [];
    if (declared.length === 0) continue;
    for (const { code } of declared) declarations.push({ moduleId: entry.manifest.id, code });

    const byLanguage = new Map<string, ReadonlySet<string>>();
    const bundlesDir = entry.manifest.i18n?.bundlesDir;
    if (bundlesDir !== undefined) {
      const dir = join(moduleDir, bundlesDir);
      for (const name of existsSync(dir) ? readdirSync(dir) : []) {
        const match = /^([a-z]{2}(?:-[A-Z]{2})?)\.json$/.exec(name);
        if (match === null) continue;
        bundleFiles += 1;
        const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
        byLanguage.set(
          match[1]!,
          new Set(Object.keys(parsed).filter((key) => key.startsWith(ORGANIZATION_PERMISSION_LABEL_PREFIX))),
        );
      }
    }
    bundles.set(entry.manifest.id, byLanguage);
  }

  return { declarations, bundles, bundleFiles, manifests: entries.length, located };
}

// --- the checks -------------------------------------------------------------------

/** Every check site under `roots`. A root object names its module; the file walk is the same either way. */
export function scanOrganizationPermissionSites(
  roots: ReadonlyArray<string | PermissionScanRoot>,
): OrganizationPermissionSiteScan {
  // Sites are reported relative to the application's own source root — the
  // first bare-string root, by construction of `permissionScanRoots()` — and
  // absolute when there is none, rather than relative to an invented one.
  const base = roots.find((entry): entry is string => typeof entry === 'string');
  const seen = new Set<string>();
  const sites: OrganizationPermissionSite[] = [];
  let files = 0;
  for (const entry of roots) {
    const dir = typeof entry === 'string' ? entry : entry.dir;
    for (const file of walkSources(dir, seen)) {
      files += 1;
      const source = readFileSync(file, 'utf8');
      if (!MENTION_RE.test(source)) continue;
      sites.push(
        ...scanOrganizationPermissionSource(source, base === undefined ? file : relative(base, file), (specifier) =>
          readRelativeImport(file, specifier),
        ),
      );
    }
  }
  return { files, sites };
}

/** A quick pre-filter: a file naming none of these calls nothing this scan reads. */
const MENTION_RE = /organizationPermissionPreHandler|\.\s*(?:can|assert|rolesHolding)\b/;

/** A file that names the port — where a generic `can` / `assert` is the port's. */
const PORT_MENTION_RE = /\b(?:OrganizationPermissionPort|organizationPermissionPort)\b/;

/**
 * The sites in one source text. `readImport` answers the source of a file the
 * text imports by a relative specifier, or `null`; the fixtures pass none.
 */
export function scanOrganizationPermissionSource(
  rawSource: string,
  file: string,
  readImport: (specifier: string) => string | null = () => null,
): OrganizationPermissionSite[] {
  const source = blankComments(rawSource);
  const sites: OrganizationPermissionSite[] = [];
  const constants = new ConstantTable(source, readImport);
  const bound = runtimeBindings(source);
  const portFile = PORT_MENTION_RE.test(source);

  const callRe = /(\.\s*)?\b(organizationPermissionPreHandler|can|assert|rolesHolding)\s*(?:\?\.)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(source)) !== null) {
    const callee = m[2] as OrganizationPermissionSite['callee'];
    const isMember = m[1] !== undefined;
    if (callee === 'organizationPermissionPreHandler') {
      // A declaration (`function organizationPermissionPreHandler(`) or an
      // import is not a call; a member call of it is still one.
      const before = source.slice(Math.max(0, m.index - 12), m.index);
      if (/function\s*$/.test(before)) continue;
    } else if (!isMember || !portFile) {
      continue;
    }
    const open = source.indexOf('(', m.index + m[0].length - 1);
    const args = splitArguments(readBalanced(source, open));
    // A parameter list — the method's own signature in an interface or class.
    if (PARAMETER_LIST_RE.test(args[0] ?? '')) continue;
    const argument = (args[1] ?? '').trim();
    const expression = argument.replace(/\s+/g, ' ');
    sites.push({ file, callee, expression, ...classify(argument, constants, bound) });
  }
  return sites;
}

function classify(
  argument: string,
  constants: ConstantTable,
  bound: ReadonlySet<string>,
): Pick<OrganizationPermissionSite, 'resolution' | 'codes'> {
  const literal = stringLiteral(argument);
  if (literal !== null) return { resolution: 'code', codes: [literal] };

  const identifier = /^[A-Za-z_$][\w$]*$/.test(argument) ? argument : null;
  const member = /^([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)$/.exec(argument);
  const value = identifier
    ? constants.lookup(identifier, null)
    : member
      ? constants.lookup(member[1]!, member[2]!)
      : null;
  if (value !== null) return { resolution: 'code', codes: [value] };

  const root = identifier ?? member?.[1] ?? null;
  if (root !== null && bound.has(root)) return { resolution: 'runtime-value', codes: [] };
  return { resolution: 'unresolved', codes: [] };
}

/** `'x'`, `"x"` or `` `x` `` with no interpolation; otherwise `null`. */
function stringLiteral(text: string): string | null {
  const m = /^(['"`])([^'"`\\$]*)\1$/.exec(text.trim());
  return m ? m[2]! : null;
}

/**
 * Module-local `const` bindings to a string, or to an object literal of
 * strings, plus the same from files imported by a relative specifier.
 */
class ConstantTable {
  readonly #values = new Map<string, string>();
  readonly #objects = new Map<string, Map<string, string>>();
  readonly #imports = new Map<string, { readonly specifier: string; readonly original: string }>();

  readonly #readImport: (specifier: string) => string | null;

  constructor(source: string, readImport: (specifier: string) => string | null) {
    this.#readImport = readImport;
    this.#collect(source);
    const importRe = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(source)) !== null) {
      for (const part of m[1]!.split(',')) {
        const names = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
        if (names) this.#imports.set(names[2] ?? names[1]!, { specifier: m[2]!, original: names[1]! });
      }
    }
  }

  lookup(name: string, key: string | null): string | null {
    const local = key === null ? this.#values.get(name) : this.#objects.get(name)?.get(key);
    if (local !== undefined) return local;
    const imported = this.#imports.get(name);
    if (imported === undefined) return null;
    const { specifier, original } = imported;
    const source = this.#readImport(specifier);
    if (source === null) return null;
    const table = new ConstantTable(blankComments(source), () => null);
    return table.lookup(original, key);
  }

  #collect(source: string): void {
    const valueRe = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(['"`])([^'"`\\$]*)\2/g;
    let m: RegExpExecArray | null;
    while ((m = valueRe.exec(source)) !== null) this.#values.set(m[1]!, m[3]!);
    const objectRe = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*\{/g;
    while ((m = objectRe.exec(source)) !== null) {
      const body = readBalanced(source, source.indexOf('{', m.index + m[0].length - 1));
      const members = new Map<string, string>();
      const memberRe = /([A-Za-z_$][\w$]*)\s*:\s*(['"`])([^'"`\\$]*)\2/g;
      let mm: RegExpExecArray | null;
      while ((mm = memberRe.exec(body)) !== null) members.set(mm[1]!, mm[3]!);
      if (members.size > 0) this.#objects.set(m[1]!, members);
    }
  }
}

/** A leading `name:` or `name?:` marks a parameter list rather than arguments. */
const PARAMETER_LIST_RE = /^\s*(?:readonly\s+)?[A-Za-z_$][\w$]*\s*\??\s*:/;

/** Identifiers bound to a runtime value: typed parameters, untyped arrow parameters, loop variables. */
function runtimeBindings(source: string): Set<string> {
  const bound = new Set<string>();
  let m: RegExpExecArray | null;
  const typedParamRe = /[(,]\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/g;
  while ((m = typedParamRe.exec(source)) !== null) bound.add(m[1]!);
  const arrowHeadRe = /\(([^()]*)\)\s*=>/g;
  while ((m = arrowHeadRe.exec(source)) !== null) {
    for (const part of m[1]!.split(',')) {
      const name = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(part);
      if (name) bound.add(name[1]!);
    }
  }
  const loopRe = /for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+(?:of|in)\b/g;
  while ((m = loopRe.exec(source)) !== null) bound.add(m[1]!);
  return bound;
}

/** Comments replaced by spaces, strings and template literals kept, offsets preserved. */
function blankComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const stop = skipString(source, i) + 1;
      out += source.slice(i, stop);
      i = stop;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Text between the bracket at `openIndex` and its match, strings respected. */
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

/** Split on top-level commas only. */
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
  return source.length - 1;
}

/** The operator scan's walk: sources only, never a test, never `dist`, `node_modules` or another deployment. */
function* walkSources(dir: string, seen: Set<string>): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'apps' || entry.name === 'dist') continue;
      yield* walkSources(path, seen);
      continue;
    }
    if (!entry.isFile() || !/\.(ts|tsx|js)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx|js)$/.test(entry.name)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    yield path;
  }
}

/** The source of a relatively imported `.ts` file, by its `.js` (or bare) specifier. */
function readRelativeImport(fromFile: string, specifier: string): string | null {
  const target = resolve(dirname(fromFile), specifier);
  for (const candidate of [target.replace(/\.js$/, '.ts'), `${target}.ts`, join(target, 'index.ts'), target]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        return readFileSync(candidate, 'utf8');
      } catch {
        // A directory or an unreadable path is not an import this scan can read.
      }
    }
  }
  return null;
}

// --- the rules ----------------------------------------------------------------------

export function findOrganizationPermissionDefects(
  input: OrganizationPermissionInventoryInput,
): OrganizationPermissionFinding[] {
  const findings: OrganizationPermissionFinding[] = [];
  const declared = new Set(input.declarations.map((d) => d.code));
  const checked = new Set<string>();
  for (const site of input.sites) for (const code of site.codes) checked.add(code);
  const [reference] = input.languages;

  for (const { moduleId, code } of input.declarations) {
    if (input.operatorCodes.has(code)) {
      findings.push({
        kind: 'cross-vocabulary',
        code,
        module: moduleId,
        detail: 'declared as an organization permission and as an operator code — the two vocabularies never meet (FR-020)',
      });
    }
    const prefix = code.includes('.') ? code.slice(0, code.indexOf('.')) : code;
    if (prefix !== moduleId) {
      findings.push({
        kind: 'foreign-declarer',
        code,
        module: moduleId,
        detail: `declared by "${moduleId}", whose codes are "${moduleId}.<action>" — a code is declared by the module whose action it gates (R-2)`,
      });
    }
    if (!checked.has(code)) {
      findings.push({
        kind: 'unchecked-declaration',
        code,
        module: moduleId,
        detail: 'no guard and no port call names it — a grant that enforces nothing (grantable ⇒ enforced)',
      });
    }
    const byLanguage = input.bundles.get(moduleId) ?? new Map<string, ReadonlySet<string>>();
    for (const field of LABEL_FIELDS) {
      const key = `${ORGANIZATION_PERMISSION_LABEL_PREFIX}${code}.${field}`;
      const holding = input.languages.filter((language) => byLanguage.get(language)?.has(key) ?? false);
      if (reference !== undefined && !holding.includes(reference)) {
        findings.push({
          kind: 'missing-label',
          code,
          module: moduleId,
          language: reference,
          detail: `"${key}" is not in ${moduleId}'s ${reference} bundle`,
        });
        continue;
      }
      for (const language of input.languages.filter((l) => !holding.includes(l))) {
        findings.push({
          kind: 'split-label',
          code,
          module: moduleId,
          language,
          detail: `"${key}" is in ${holding.join(', ')} and not in ${language}`,
        });
      }
    }
  }

  for (const site of input.sites) {
    if (site.resolution === 'unresolved') {
      findings.push({
        kind: 'unresolved-argument',
        code: site.expression,
        file: site.file,
        detail: `${site.callee}'s code argument cannot be read — write it as a literal or a resolvable constant`,
      });
      continue;
    }
    for (const code of site.codes) {
      if (declared.has(code)) continue;
      findings.push({
        kind: 'undeclared-check',
        code,
        file: site.file,
        detail: `${site.callee} names a code no manifest's organizationPermissions declares`,
      });
    }
  }

  return findings;
}

/**
 * What the sweep read, in the estate's grammar (issue #244). `files` is every
 * source file and bundle the two walks opened; `sites` the check sites found;
 * the independent derivation is the manifest index — every manifest it lists
 * against the module directories the walk located, so a tree that moved reads
 * `short-walk` rather than clean. It is the manifests and not the *declaring*
 * manifests on purpose: the population is empty while no module declares a
 * code, and an expectation of zero corroborates nothing.
 */
export function organizationPermissionReadSize(
  walk: OrganizationPermissionDeclarationWalk,
  scan: OrganizationPermissionSiteScan,
): ReadSizeInput {
  return {
    prefix: '[organization-permissions]',
    files: scan.files + walk.bundleFiles,
    sites: scan.sites.length,
    coverage: [{ source: 'manifest-index', expected: walk.manifests, covered: walk.located }],
  };
}
