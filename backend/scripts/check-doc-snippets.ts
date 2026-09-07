/**
 * check-doc-snippets — assert that documentation code blocks are quotations,
 * not paraphrases.
 *
 * Why this exists: `specs/072-module-kernel-di/quickstart.md` accumulated **six**
 * wrong signatures across three implementation batches — `defineModuleRoutes`
 * with three arguments, `defineModuleWorker` taking a queue name, a
 * `ctx.routes(registrar)` that does not type-check, `asClass().scoped()` that
 * throws under awilix `strict`, and an `expectModuleAbsent` call naming
 * surfaces the harness does not have. None of them was wrong when written; each
 * was written from a plan and never re-read against the merged code.
 *
 * Those files are copied 65 times by feature 072's module sweep and 57 times by
 * feature 073's gating batches, so a wrong snippet is not a documentation defect
 * — it is a defect scheduled for mass production.
 *
 * The fix is to stop paraphrasing. A block marked
 *
 *     <!-- verbatim-from: backend/src/modules/blog/backend.ts -->
 *     ```ts
 *     …
 *     ```
 *
 * must appear **verbatim** in that file, as a contiguous run of lines. The
 * source is ordinary code that `tsc` already compiles and the suite already
 * runs, so a signature change breaks the build here rather than being
 * discovered by the next person who copies it.
 *
 * Uniform indentation is normalised, so a block may be dedented for reading.
 * Nothing else is: if the code changed, the document is wrong and says so.
 *
 * ## Its population is the documents, not the module tree (feature 080, T010)
 *
 * Wave 1 of feature 080 re-roots every check whose population is
 * `backend/src/modules` onto the resolved module list, so a moved module tree
 * exits 2 instead of reporting clean over the residue. **This check is not one
 * of them, and re-rooting it would be wrong.** What it walks is the markdown
 * under {@link DOCUMENT_ROOTS}; the module tree appears only as the *target* of
 * a citation, and a target that moved is the `cited file does not exist`
 * finding below — exit 1, naming the document and the path. The one failure
 * mode #215 is about, a walk that comes back short and reports clean, cannot
 * arise from the module tree here at all.
 *
 * It can arise from the **document** roots, and there the floor was the wrong
 * one for the same reason. `documents.length === 0` catches only the total
 * loss. Measured when this paragraph was written: `docs/docs` holds 92 of the
 * 943 markdown files and one of the seven citing documents, so a docs tree that
 * moved left a walk of 851 files that reads `6 document(s) checked, every cited
 * block is a quotation` and exits 0 — and 851 is inside the read-size band's
 * −10% edge, so nothing downstream would have caught it either. So the floor is
 * per declared root: every root in {@link DOCUMENT_ROOTS} must contribute at
 * least one markdown file. It is derived from the check's own declaration
 * rather than from a second author, which is why `sources=` stays
 * `self-reported` — nothing in this repository enumerates which documents ought
 * to cite a source.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveModuleDocs } from './lib/module-docs.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/**
 * Where a citing document may live. Everything under these roots is walked.
 *
 * Membership used to be an opt-in list of two files, and one of the two carried
 * no marker at all while a third document that did (`d37-relocation-plan.md`)
 * was not on it — so the check reported "2 documents checked" over one document
 * that participated (issue #113). A marker is now the only thing that enrols a
 * file: writing one is the act of asking for the guarantee, which is what the
 * marker already reads as.
 */
export const DOCUMENT_ROOTS: readonly string[] = ['docs/docs', 'specs'];

/**
 * The roots this run actually walks: {@link DOCUMENT_ROOTS} plus every module's
 * own `docs/` layer (feature 100 Phase 2, FR-019).
 *
 * The pages **followed the modules**. 76 of the 78 pages under the site's
 * modules category now live in the package that owns them, so a population
 * still spelled `docs/docs` would walk the two that stayed and report on a
 * document tree it is not reading — the header's own failure mode, arriving
 * through a move nobody would connect to this file. The per-root floor holds
 * over the widened list, so a module docs layer that stops resolving is exit 2
 * rather than a quieter walk.
 *
 * The roots are derived: the modules from the generated manifest index, the
 * directory each keeps its pages in from that module's own manifest. Nothing
 * here names a package or a directory (D-100).
 */
export async function documentRoots(
  repoRoot: string = REPO_ROOT,
): Promise<{ roots: readonly string[]; copies: ReadonlySet<string> }> {
  const layout = await requireModuleLayout('[doc-snippets]');
  const resolved = await resolveModuleDocs(repoRoot, layout.manifestIndexPath);
  return {
    roots: [
      ...DOCUMENT_ROOTS,
      ...resolved.sources.map((source) => relative(repoRoot, source.root)).sort(),
    ],
    // The site's copies of those same pages. They are not committed, so a fresh
    // checkout has none and a machine that has run the site build has all of
    // them — a walk that counted them would be a different size on the two, and
    // would check every module page twice under a path its author cannot edit.
    copies: resolved.copies,
  };
}

const MARKER = /^<!--\s*verbatim-from:\s*(\S+?)\s*-->$/;

/** The substring that makes a file worth parsing — see {@link MARKER} for the shape. */
const MARKER_HINT = 'verbatim-from:';

/**
 * Every markdown file under {@link DOCUMENT_ROOTS} that cites a source file,
 * as a path relative to the repository root, sorted for a stable report.
 *
 * `read` is injected so the discovery itself can be driven over a synthetic
 * tree; `list` is the directory walk, for the same reason.
 */
export function discoverCitingDocuments(
  repoRoot: string = REPO_ROOT,
  read: (p: string) => string = (p) => readFileSync(p, 'utf8'),
  roots: readonly string[] = DOCUMENT_ROOTS,
  copies: ReadonlySet<string> = new Set(),
): string[] {
  return markdownDocuments(repoRoot, roots, copies)
    .filter((path) => read(join(repoRoot, path)).includes(MARKER_HINT))
    .sort();
}

/**
 * Every markdown file under {@link DOCUMENT_ROOTS}, cited or not — the walk
 * itself, as a path relative to the repository root.
 *
 * Split out of {@link discoverCitingDocuments} so the check can print what it
 * *read* and not only what enrolled (issue #244): "7 documents checked" is the
 * same sentence whether the walk covered 400 markdown files or four, and the
 * roots moving is exactly the failure this check's own header describes.
 */
export function markdownDocuments(
  repoRoot: string = REPO_ROOT,
  roots: readonly string[] = DOCUMENT_ROOTS,
  copies: ReadonlySet<string> = new Set(),
): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === 'node_modules' || name === 'build' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith('.md')) continue;
      if (copies.has(full)) continue;
      found.push(relative(repoRoot, full));
    }
  };
  for (const root of roots) walk(join(repoRoot, root));
  return found;
}

/**
 * Why this run may not report on what it read, or `null`.
 *
 * A declared root that contributed no file is the shortfall this check can
 * actually suffer (see the header): the walk stays large, the citing documents
 * that survive still check out, and the exit code is 0. Pure and over the walk
 * itself, so a proof enters where a real run enters (issue #130).
 */
export function vacuousDocumentPopulation(
  files: readonly string[],
  roots: readonly string[] = DOCUMENT_ROOTS,
): string | null {
  // The roots are written with forward slashes and the walk returns whatever
  // the platform's `relative` produced, so the comparison normalises — a root
  // that matched nothing because of a separator would read as a missing root.
  const walked = files.map((file) => file.split('\\').join('/'));
  const empty = roots.filter(
    (root) => !walked.some((file) => file === root || file.startsWith(`${root}/`)),
  );
  if (empty.length === 0) return null;
  return (
    `the walk read ${files.length} markdown file(s) but none under ` +
    `${empty.join(', ')} — it is reading part of the document tree, not the tree; ` +
    'refusing to report a vacuous pass'
  );
}

export interface SnippetFinding {
  readonly doc: string;
  readonly docLine: number;
  readonly source: string;
  readonly message: string;
}

/** Strip the smallest common indent so a block may be dedented for reading. */
function dedent(lines: readonly string[]): string[] {
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.length - l.trimStart().length);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((l) => (l.trim().length === 0 ? '' : l.slice(common)));
}

/**
 * Does `needle` appear as a contiguous run of lines in `haystack`?
 *
 * Both sides are dedented independently, so a block quoted out of a nested
 * position — inside `registerModule`, say — matches when it is flattened for
 * reading. Relative indentation inside the block still has to agree: that is
 * structure, not presentation.
 */
function findRun(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0) return -1;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    const window = dedent(haystack.slice(i, i + needle.length));
    let hit = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (window[j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}

/**
 * The first line of `needle` that is not present in `haystack` at all — the
 * most useful thing to print, because it is usually the changed signature.
 */
function firstUnknownLine(haystack: readonly string[], needle: readonly string[]): string | null {
  const known = new Set(haystack.map((l) => l.trim()));
  return needle.find((l) => l.trim().length > 0 && !known.has(l.trim())) ?? null;
}

export function checkDocument(docPath: string, readFile: (p: string) => string): SnippetFinding[] {
  const findings: SnippetFinding[] = [];
  const lines = readFile(join(REPO_ROOT, docPath)).split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const marker = MARKER.exec(lines[i]!.trim());
    if (!marker) continue;

    const source = marker[1]!;
    // The fence may be separated from the marker by blank lines only.
    let f = i + 1;
    while (f < lines.length && lines[f]!.trim() === '') f += 1;
    if (f >= lines.length || !lines[f]!.trimStart().startsWith('```')) {
      findings.push({
        doc: docPath,
        docLine: i + 1,
        source,
        message: 'marker is not followed by a fenced code block',
      });
      continue;
    }

    const close = lines.findIndex((l, n) => n > f && l.trimStart().startsWith('```'));
    if (close === -1) {
      findings.push({ doc: docPath, docLine: f + 1, source, message: 'unterminated code fence' });
      continue;
    }

    const block = dedent(lines.slice(f + 1, close));

    // Reading is the only injected seam, so a missing file surfaces the same
    // way in a test as in a real run. An earlier version checked `existsSync`
    // separately and the unit tests could not reach that branch at all.
    let haystack: string[];
    try {
      haystack = readFile(join(REPO_ROOT, source)).split('\n');
    } catch {
      findings.push({
        doc: docPath,
        docLine: i + 1,
        source,
        message: 'cited file does not exist — it was probably moved or renamed',
      });
      i = close;
      continue;
    }

    if (findRun(haystack, block) === -1) {
      const unknown = firstUnknownLine(haystack, block);
      findings.push({
        doc: docPath,
        docLine: f + 2,
        source,
        message: unknown
          ? `block is not a verbatim quotation; this line is nowhere in the source:\n      ${unknown.trim()}`
          : 'block is not a contiguous run in the source (every line exists, the order or spacing differs)',
      });
    }

    i = close;
  }

  return findings;
}

async function main(): Promise<void> {
  const read = (p: string): string => readFileSync(p, 'utf8');
  const { roots, copies } = await documentRoots();
  const walked = markdownDocuments(REPO_ROOT, roots, copies);
  // The root floor comes first: a root that vanished takes its citing documents
  // with it, so the guard below would still see the ones that remain and call
  // the run clean.
  const vacuous = vacuousDocumentPopulation(walked, roots);
  if (vacuous !== null) {
    console.error(`[doc-snippets] ${vacuous}`);
    process.exit(2);
  }
  const documents = discoverCitingDocuments(REPO_ROOT, read, roots, copies);
  if (documents.length === 0) {
    // Discovery finding nothing is indistinguishable, on the exit code, from
    // every quotation being correct. It means the walk broke or the roots
    // moved, and the guarantee is off for every document at once.
    console.error(
      `[doc-snippets] no document under ${roots.join(', ')} cites a source file — ` +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  const findings = documents.flatMap((d) => checkDocument(d, read));

  for (const f of findings) {
    console.error(`[doc-snippets] ${f.doc}:${f.docLine} → cites ${f.source}\n      ${f.message}`);
  }

  const scanned = documents.length;
  if (findings.length > 0) {
    console.error(
      `\n[doc-snippets] ${findings.length} stale snippet(s) across ${scanned} document(s).\n` +
        `A cited block must appear verbatim in the file it names. If the code changed, ` +
        `update the document — these snippets are copied by every module conversion, so a ` +
        `wrong one is reproduced dozens of times before anyone notices.`,
    );
    process.exit(1);
  }

  // What was read, beside what was found (issue #244): the markdown walk, and
  // the documents inside it that enrol by carrying a marker. `self-reported`:
  // nothing derives "every document that should cite a source".
  reportReadSize({ prefix: '[doc-snippets]', files: walked.length, sites: scanned });
  console.log(`[doc-snippets] ${scanned} document(s) checked, every cited block is a quotation`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export { REPO_ROOT, relative };
