/**
 * The transformation: a copy of the reference storefront that names nothing
 * above its own directory.
 *
 * ## What a rewrite is keyed on
 *
 * **The shape of the declaration, never which file or which package writes it.**
 * `specs/071-modular-packaging/roadmap.md` § *F7* enumerated the declarations
 * once and the enumeration was stale within a day; a tool carrying it would have
 * rewritten a dependency that had been deleted and copied three later ones out
 * unchanged. So every rule below reads a *kind* of declaration — a `workspace:`
 * protocol range, a `tsconfig` `extends`, an import from a configuration file, a
 * Tailwind `@source` glob — and the population it runs over is
 * {@link outwardReferences}' answer for this checkout, on this run.
 *
 * ## The refusal is the load-bearing half
 *
 * An outward reference no rule classifies is {@link UnclassifiedReferenceError},
 * exit 1, naming the file and the specifier. That is what stops this command
 * from doing quietly what the roadmap's own sentence did loudly: copy a
 * monorepo-relative declaration out of the repository and call it a storefront.
 * A green run therefore means *"every declaration naming something above this
 * directory was rewritten"*, and never *"the ones I knew about were"*.
 *
 * ## The four rules, and why each is the shape it is
 *
 * 1. **`workspace:` → published semver.** pnpm's own publish semantics, applied
 *    to the version the named package declares: `workspace:*` is that version
 *    exactly, `workspace:^` and `workspace:~` are it with the operator, and
 *    `workspace:<range>` is the range as written. This is the rewrite
 *    publication makes real; until the packages are published a consumer
 *    substitutes a tarball, which is what the acceptance criterion does.
 * 2. **Vendor a referenced configuration file, and make the copy standalone.**
 *    One mechanism for all three configuration references. The copy is then
 *    walked for its *own* outward references, and each is dropped when its
 *    target cannot come with it — for `tsconfig.base.json` that is the whole
 *    `compilerOptions.paths` block, whose every target names a directory under
 *    `packages/`; for the vitest base it is this repository's issue-#255
 *    workspace-resolution guard, whose closure reaches a package the scaffold
 *    does not install and which returns without doing anything outside a
 *    checkout by its own author's design.
 * 3. **Retarget a glob that names the workspace's package tree** at where those
 *    packages are installed in a standalone application: `node_modules/<scope>`.
 *    A `@source` glob whose prefix does not exist is not an error in Tailwind —
 *    it contributes nothing, silently — which is the failure mode
 *    `app/globals.css`' own comment describes and the reason this rule is a
 *    rewrite rather than a deletion.
 * 4. **A file whose outward reference cannot be made standalone is not copied,
 *    and is reported.** It is reported rather than dropped in silence, and it is
 *    refused outright when it sits under one of the application's own source
 *    roots — a test asserting a property of *this repository's* layout has no
 *    subject in a scaffold, an application file that reached out has no answer
 *    at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

import {
  DEPENDENCY_FIELDS,
  globPrefix,
  outwardReferences,
  StorefrontInputError,
  workspaceRanges,
  type OutwardReference,
  type StorefrontReference,
} from './reference.js';

/** An outward reference no rule below classifies. */
export class UnclassifiedReferenceError extends StorefrontInputError {}

/** A file the scaffold writes: either copied bytes or rewritten text. */
export interface PlannedFile {
  /** Where it lands, scaffold-relative, with `/` separators. */
  readonly path: string;
  /** The source it is copied from, absolute, or `null` for authored text. */
  readonly source: string | null;
  /** The text to write, or `null` to copy `source` byte for byte. */
  readonly content: string | null;
  /** What this run did to it, for the report and for `--dry-run`. */
  readonly note: string | null;
}

/** One `workspace:` range and what it became. */
export interface RangeRewrite {
  readonly field: string;
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

/** A file the copy leaves behind, with the reason. */
export interface OmittedFile {
  readonly path: string;
  readonly reason: string;
}

export interface StorefrontPlan {
  readonly files: readonly PlannedFile[];
  readonly ranges: readonly RangeRewrite[];
  /** Every outward reference this run rewrote, with what it became. */
  readonly rewrites: readonly (OutwardReference & { readonly to: string })[];
  readonly omitted: readonly OmittedFile[];
}

/**
 * `workspace:<protocol>` as pnpm itself publishes it.
 *
 * The version comes from the named package's own manifest, so a repository that
 * has started versioning its packages produces real ranges with no change here.
 */
export function publishedRange(declared: string, version: string): string {
  const tail = declared.slice('workspace:'.length);
  if (tail === '*' || tail === '') return version;
  if (tail === '^') return `^${version}`;
  if (tail === '~') return `~${version}`;
  return tail;
}

/** The version a workspace member declares, or `null` when it is not a member. */
export function memberVersion(
  memberDirs: readonly string[],
  name: string,
): { version: string; dir: string } | null {
  for (const dir of memberDirs) {
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    let manifest: { name?: unknown; version?: unknown };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest;
    } catch {
      continue;
    }
    if (manifest.name !== name) continue;
    if (typeof manifest.version !== 'string') return null;
    return { version: manifest.version, dir };
  }
  return null;
}

/** The single npm scope the workspace's `@`-scoped members publish under. */
export function workspaceScope(memberDirs: readonly string[]): string | null {
  const scopes = new Set<string>();
  for (const dir of memberDirs) {
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    let name: unknown;
    try {
      name = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }).name;
    } catch {
      continue;
    }
    if (typeof name !== 'string' || !name.startsWith('@')) continue;
    const slash = name.indexOf('/');
    if (slash > 0) scopes.add(name.slice(0, slash));
  }
  const only = [...scopes];
  return only.length === 1 ? only[0]! : null;
}

/** Rule 1 — the manifest, with every `workspace:` range published. */
export function rewriteManifest(
  reference: StorefrontReference,
  memberDirs: readonly string[],
): { text: string; ranges: readonly RangeRewrite[] } {
  const manifest = JSON.parse(JSON.stringify(reference.manifest)) as Record<string, unknown>;
  const ranges: RangeRewrite[] = [];
  for (const range of workspaceRanges(reference.manifest)) {
    const member = memberVersion(memberDirs, range.name);
    if (member === null) {
      throw new StorefrontInputError(
        `${range.field}.${range.name} is declared "${range.declared}", but no workspace member ` +
          `of this checkout is called "${range.name}" with a version. A \`workspace:\` range is ` +
          `rewritten from the version its own package declares, and this command will not ` +
          `invent one: a scaffold carrying a range nothing resolves is a storefront that ` +
          `cannot install.`,
      );
    }
    const to = publishedRange(range.declared, member.version);
    (manifest[range.field] as Record<string, string>)[range.name] = to;
    ranges.push({ field: range.field, name: range.name, from: range.declared, to });
  }
  return { text: `${JSON.stringify(manifest, null, 2)}\n`, ranges };
}

/** What rule 2 does to one vendored configuration file. */
interface VendorPlan {
  /** Where the vendored copy lands, scaffold-relative. */
  readonly path: string;
  /** Its text, already made standalone. */
  readonly content: string;
  /** What the referring file's specifier becomes. */
  readonly specifier: string;
  readonly note: string;
}

/**
 * Rule 2 — vendor a configuration file the storefront extends, and cut the
 * declarations that cannot come with it.
 *
 * The cut is derived, not listed: each of the vendored file's *own* relative
 * references is resolved, and one whose target is outside the set being vendored
 * is removed together with the declaration that uses it. A JSON `paths` entry
 * and an ES import are the two shapes that occur; anything else is refused, so
 * a base configuration that grows a third shape stops this command rather than
 * being copied out half-rewritten.
 */
export function vendorConfiguration(
  reference: OutwardReference,
  storefrontDir: string,
): VendorPlan {
  const source = resolveTarget(reference.target);
  if (source === null) {
    throw new UnclassifiedReferenceError(
      `${reference.file} names "${reference.specifier}", which resolves to ${reference.target} ` +
        `— and there is no file there. A reference the scaffold cannot resolve cannot be made ` +
        `standalone.`,
    );
  }
  const base = source.split(sep).pop()!;
  // The vendored file lands under its own name; the *specifier* keeps the
  // extension the referring file wrote. `vitest.config.mts` names the base
  // configuration `../vitest.config.base.js` although the file is `.ts`, which
  // is the ESM spelling TypeScript requires — rewriting it to `./…​.ts` would be
  // `allowImportingTsExtensions` territory and a type error in the copy.
  const spelt = reference.specifier.split('/').pop()!;
  const text = readFileSync(source, 'utf8');

  if (source.endsWith('.json')) {
    const cut = cutForeignJsonPaths(text, dirname(source), storefrontDir);
    return {
      path: base,
      content: cut.text,
      specifier: `./${spelt}`,
      note:
        cut.dropped.length === 0
          ? `vendored from ${base}`
          : `vendored from ${base}, without ${String(cut.dropped.length)} ` +
            `${cut.dropped.length === 1 ? 'declaration' : 'declarations'} whose ` +
            `${cut.dropped.length === 1 ? 'target names' : 'targets name'} a directory of the ` +
            `platform repository that a standalone storefront does not have ` +
            `(${cut.dropped.join(', ')})`,
    };
  }

  const cut = cutForeignImports(text, dirname(source), storefrontDir);
  return {
    path: base,
    content: cut.text,
    specifier: `./${spelt}`,
    note:
      cut.dropped.length === 0
        ? `vendored from ${base}`
        : `vendored from ${base}, without its import of ${cut.dropped.join(', ')} — ` +
          `${cut.dropped.length === 1 ? 'that module reaches' : 'those modules reach'} into ` +
          `the platform repository, and a standalone storefront installs no part of it`,
  };
}

/** `../x.js` may be written for `../x.ts`; try the extensions TypeScript does. */
function resolveTarget(target: string): string | null {
  if (existsSync(target) && !target.endsWith(sep)) return target;
  const swapped = target.replace(/\.js$/, '');
  for (const extension of ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs']) {
    if (existsSync(swapped + extension)) return swapped + extension;
  }
  return null;
}

/**
 * Drop every `compilerOptions.paths` entry whose target leaves the scaffold.
 *
 * `paths` is the one declaration in a shared `tsconfig` that is repository
 * geometry rather than compiler policy: its targets are directories under
 * `packages/`, which a standalone storefront replaces with installed packages.
 * Left in place they are dead configuration pointing at nothing; TypeScript
 * falls back to node resolution and the scaffold's author is left reading a
 * block that describes a tree they do not have.
 */
export function cutForeignJsonPaths(
  text: string,
  configDir: string,
  storefrontDir: string,
): { text: string; dropped: readonly string[] } {
  const parsed = JSON.parse(text) as {
    compilerOptions?: { paths?: Record<string, readonly string[]> };
  };
  const paths = parsed.compilerOptions?.paths;
  if (paths === undefined) return { text, dropped: [] };
  const kept: Record<string, readonly string[]> = {};
  const dropped: string[] = [];
  for (const [key, targets] of Object.entries(paths)) {
    const inside = targets.every((target) => {
      const absolute = resolve(configDir, globPrefix(target));
      return absolute === storefrontDir || absolute.startsWith(storefrontDir + sep);
    });
    if (inside) kept[key] = targets;
    else dropped.push(`paths."${key}"`);
  }
  if (dropped.length === 0) return { text, dropped: [] };
  if (Object.keys(kept).length === 0) delete parsed.compilerOptions!.paths;
  else parsed.compilerOptions!.paths = kept;
  return { text: `${JSON.stringify(parsed, null, 2)}\n`, dropped };
}

/**
 * Drop an ES import whose target leaves the scaffold, and the statements that
 * use what it bound.
 *
 * Deliberately narrow: it removes the import line and any *expression statement*
 * that is a bare call of a removed binding, which is the shape a configuration
 * file's side-effecting guard takes. A removed binding used anywhere else is a
 * refusal — rewriting an expression is not something this command does, and
 * emitting a configuration with a dangling identifier would be worse than
 * stopping.
 */
export function cutForeignImports(
  text: string,
  fileDir: string,
  storefrontDir: string,
): { text: string; dropped: readonly string[] } {
  const lines = text.split('\n');
  const dropped: string[] = [];
  const removedBindings = new Set<string>();
  const removedLines = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const specifier = /^\s*import\s+([\s\S]*?)\s*from\s*['"](\.[^'"]*)['"];?\s*$/.exec(
      lines[index]!,
    );
    // A multi-line import: join forward until the `from` clause closes.
    let clause = specifier?.[1];
    let path = specifier?.[2];
    let last = index;
    if (specifier === null && /^\s*import\s*\{\s*$/.test(lines[index]!)) {
      const parts: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length && !/\}\s*from\s*['"]/.test(lines[cursor]!)) {
        parts.push(lines[cursor]!);
        cursor += 1;
      }
      const closing = /^\s*\}\s*from\s*['"]([^'"]+)['"];?\s*$/.exec(lines[cursor] ?? '');
      if (closing !== null && closing[1]!.startsWith('.')) {
        clause = `{ ${parts.join(' ')} }`;
        path = closing[1]!;
        last = cursor;
      }
    }
    if (clause === undefined || path === undefined) continue;
    const target = resolve(fileDir, globPrefix(path));
    if (target === storefrontDir || target.startsWith(storefrontDir + sep)) continue;
    for (let line = index; line <= last; line += 1) removedLines.add(line);
    for (const name of bindingsOf(clause)) removedBindings.add(name);
    dropped.push(path);
    index = last;
  }
  if (dropped.length === 0) return { text, dropped: [] };

  for (let index = 0; index < lines.length; index += 1) {
    if (removedLines.has(index)) continue;
    const call = /^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*;?\s*$/.exec(lines[index]!);
    if (call !== null && removedBindings.has(call[1]!)) {
      removedLines.add(index);
      continue;
    }
    for (const binding of removedBindings) {
      if (new RegExp(`\\b${binding}\\b`).test(lines[index]!)) {
        throw new UnclassifiedReferenceError(
          `the configuration this command vendors uses \`${binding}\` on line ` +
            `${String(index + 1)}, and \`${binding}\` comes from an import that reaches into ` +
            `the platform repository. This command removes such an import and a bare call of ` +
            `what it bound, and nothing else: rewriting the expression would be inventing ` +
            `configuration nobody reviewed.`,
        );
      }
    }
  }
  const kept = lines.filter((_, index) => !removedLines.has(index));
  return { text: collapseBlankRun(kept).join('\n'), dropped };
}

function bindingsOf(clause: string): readonly string[] {
  const names: string[] = [];
  const braces = /\{([\s\S]*)\}/.exec(clause);
  if (braces !== null) {
    for (const part of braces[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name !== undefined && name.length > 0) names.push(name);
    }
  }
  const outside = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s+as\s+/, '');
  for (const part of outside.split(',')) {
    const name = part.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
  }
  return names;
}

/** Two blank lines left by a removed import read as an editing accident. */
function collapseBlankRun(lines: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && out.length > 0 && out[out.length - 1]!.trim() === '') continue;
    out.push(line);
  }
  return out;
}

/**
 * Rule 3 — a glob naming the workspace's package tree, retargeted at where a
 * standalone application finds those packages.
 *
 * `null` when the glob names something else, so the caller refuses it rather
 * than this function guessing.
 */
export function retargetPackageGlob(
  reference: OutwardReference,
  repoRoot: string,
  memberDirs: readonly string[],
  referringFileDir: string,
  scaffoldDir: string,
): string | null {
  const scope = workspaceScope(memberDirs);
  if (scope === null) return null;
  const prefix = reference.target;
  const covers = memberDirs.some((dir) => dir === prefix || dir.startsWith(prefix + sep));
  if (!covers) return null;
  const tail = reference.specifier.slice(globPrefix(reference.specifier).length);
  const installed = join(scaffoldDir, 'node_modules', scope);
  const relativePath = relative(referringFileDir, installed).split(sep).join(posix.sep);
  void repoRoot;
  return `${relativePath.startsWith('.') ? relativePath : `./${relativePath}`}${tail}`;
}

/** The application's own source roots, from its tsconfig `include`. */
export function sourceRoots(reference: StorefrontReference): readonly string[] {
  const configPath = join(reference.dir, 'tsconfig.json');
  if (!existsSync(configPath)) return [];
  let include: unknown;
  try {
    include = (JSON.parse(readFileSync(configPath, 'utf8')) as { include?: unknown }).include;
  } catch {
    return [];
  }
  if (!Array.isArray(include)) return [];
  return include
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => globPrefix(entry))
    .filter((entry) => entry.length > 0 && !entry.startsWith('.'));
}

/**
 * The whole plan: every file the scaffold writes, and what each rewrite did.
 *
 * @param scaffoldDir where the copy will live, used only to express a retargeted
 *   glob relative to the file that writes it.
 */
export function planStorefront(
  reference: StorefrontReference,
  memberDirs: readonly string[],
  scaffoldDir: string,
): StorefrontPlan {
  const references = outwardReferences(reference);
  const byFile = new Map<string, OutwardReference[]>();
  for (const entry of references) {
    byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry]);
  }

  const vendored = new Map<string, VendorPlan>();
  const rewrites: (OutwardReference & { to: string })[] = [];
  const rewrittenText = new Map<string, string>();
  const omitted: OmittedFile[] = [];
  const roots = sourceRoots(reference);

  for (const [file, entries] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    let text = readFileSync(join(reference.dir, file), 'utf8');
    let omit: string | null = null;
    for (const entry of entries) {
      if (entry.kind === 'css-source') {
        const to = retargetPackageGlob(
          entry,
          reference.repoRoot,
          memberDirs,
          dirname(join(scaffoldDir, file)),
          scaffoldDir,
        );
        if (to === null) {
          throw new UnclassifiedReferenceError(refusal(entry));
        }
        text = replaceOnce(text, entry.specifier, to);
        rewrites.push({ ...entry, to });
        continue;
      }
      if (isConfiguration(file)) {
        const plan = vendorConfiguration(entry, reference.dir);
        vendored.set(plan.path, plan);
        text = replaceOnce(text, entry.specifier, plan.specifier);
        rewrites.push({ ...entry, to: plan.specifier });
        continue;
      }
      // Rule 4 — a file that reaches into the repository and is not a
      // configuration the scaffold can vendor.
      if (roots.some((root) => file === root || file.startsWith(`${root}/`))) {
        if (!file.startsWith('test/')) {
          throw new UnclassifiedReferenceError(refusal(entry));
        }
      }
      omit =
        `it imports "${entry.specifier}", a script of the platform repository whose own ` +
        `imports reach a package a standalone storefront does not install. What it asserts ` +
        `is a property of this repository's layout, which a scaffolded storefront does not have`;
    }
    if (omit !== null) omitted.push({ path: file, reason: omit });
    else rewrittenText.set(file, text);
  }

  const manifest = rewriteManifest(reference, memberDirs);
  const omittedPaths = new Set(omitted.map((entry) => entry.path));

  const files: PlannedFile[] = [];
  for (const file of [...reference.files].sort()) {
    if (omittedPaths.has(file)) continue;
    if (file === 'package.json') {
      files.push({
        path: file,
        source: null,
        content: manifest.text,
        note: `${String(manifest.ranges.length)} workspace: ${
          manifest.ranges.length === 1 ? 'range' : 'ranges'
        } published`,
      });
      continue;
    }
    const text = rewrittenText.get(file);
    if (text !== undefined) {
      const notes = (byFile.get(file) ?? []).map((entry) => entry.specifier);
      files.push({
        path: file,
        source: join(reference.dir, file),
        content: text,
        note: `rewrote ${notes.join(', ')}`,
      });
      continue;
    }
    files.push({ path: file, source: join(reference.dir, file), content: null, note: null });
  }
  for (const [path, plan] of [...vendored].sort(([a], [b]) => a.localeCompare(b))) {
    files.push({ path, source: null, content: plan.content, note: plan.note });
  }

  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    ranges: manifest.ranges,
    rewrites,
    omitted,
  };
}

function refusal(entry: OutwardReference): string {
  return (
    `${entry.file} names "${entry.specifier}", which resolves to ${entry.target} — above the ` +
    `storefront directory. This command rewrites a \`workspace:\` range, a configuration file ` +
    `the storefront extends, and a glob naming the workspace's package tree; "${entry.specifier}" ` +
    `is none of those. Copying it out unchanged would produce a storefront that names a ` +
    `directory of the platform repository, which is the one thing this command exists to ` +
    `prevent. Either make the declaration internal to the storefront, or add the rule that ` +
    `makes it standalone and its red proof.`
  );
}

/** A configuration file is one the application is configured by, not built from. */
function isConfiguration(file: string): boolean {
  return !file.includes('/') && /(^|\.)(tsconfig[^/]*\.json|[^/]*\.config\.[cm]?[jt]s)$/.test(file);
}

function replaceOnce(text: string, from: string, to: string): string {
  const index = text.indexOf(from);
  if (index === -1) {
    throw new UnclassifiedReferenceError(
      `"${from}" is no longer in the text this run is rewriting. That cannot happen unless two ` +
        `rules edited one file; it is reported rather than written out.`,
    );
  }
  return text.slice(0, index) + to + text.slice(index + from.length);
}

export { DEPENDENCY_FIELDS };
