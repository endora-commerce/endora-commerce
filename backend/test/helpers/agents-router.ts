import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The structure of `AGENTS.md` as a router: one home, one pointer, and a ceiling.
 *
 * ## What this holds
 *
 * `AGENTS.md` is loaded before the first tool call of every session and of every
 * subagent — a dozen agents in a day is close to a million tokens of instructions
 * before anybody does anything. On 2026-09-11 it was 1936 lines and roughly
 * 60 000 tokens, of which two sections were 64%, both of them reference consulted
 * while doing a specific thing rather than read start to finish. The owner
 * approved splitting it: what stays is what an agent needs whatever it was sent
 * to do, and what leaves is opened when the task calls for it.
 *
 * A one-off tidy-up drifts back within a month, which is why this exists rather
 * than a note asking people to be careful. It answers four questions, and the
 * fourth is the one with teeth:
 *
 * 1. Does every routed document have **exactly one pointer** from `AGENTS.md`?
 * 2. Does every pointer **resolve** to a file that is there?
 * 3. Has a routed subject **come back** into `AGENTS.md` as a heading?
 * 4. Has `AGENTS.md` **grown back**?
 *
 * ## Two independent derivations, which is what stops a vacuous green
 *
 * The population is *not* a list written down here (D-100). It is derived twice,
 * by two authors that do not read each other:
 *
 *   - the **documents**, by reading the directory;
 *   - the **pointers**, by parsing `AGENTS.md`'s routing table.
 *
 * Equality of those two sets is the assertion. Either derivation collapsing is a
 * *refusal* and never a pass: an empty directory is `no-document-read`, a routing
 * table that parsed to nothing is `no-pointer-read`. That is the exit-2
 * discipline the `check-*` estate has, in a unit test — a green here must never
 * be able to mean "I found no documents". `gate-coverage.test.ts` and
 * `check-inventory.test.ts` are the precedent for parsing repository structure
 * inside a test rather than adding a script: a check would owe an inventory
 * entry, an `endora check` estate verdict, a companion test and a recorded read
 * size, and buy nothing this cannot do.
 *
 * ## Why there is no index file in the routed directory
 *
 * `specs/conventions/` deliberately holds no `README.md`. An index would be a
 * second enumeration of a population `ls` already answers, and a second
 * enumeration is the thing that goes stale (D-100). `AGENTS.md`'s routing table
 * is the one index, and this file is what keeps it honest.
 *
 * ## What it cannot see
 *
 * It compares *headings*, not prose. A rule copied back into `AGENTS.md` as a
 * paragraph under an existing heading is invisible here and is caught by the
 * ceiling only if it is long enough to breach it. That bound is stated rather
 * than discovered later; the ceiling is the backstop for it, and is the reason
 * the ceiling is over the body rather than over the whole file.
 */

/** Where the routed documents live. */
export const CONVENTIONS_DIR = 'specs/conventions';

/** The router itself. */
export const ROUTER_FILE = 'AGENTS.md';

/**
 * The marker `update-agent-context.sh` appends below. Everything from here down
 * is speckit's and grows on its own, so the ceiling is measured **above** it — a
 * ceiling over the whole file would eventually go red on a `/speckit.plan` run
 * through no fault of the author who triggered it.
 */
export const APPENDIX_MARKER = '<!-- Everything below is appended automatically';

/**
 * The ceiling on `AGENTS.md`'s body, in lines above {@link APPENDIX_MARKER}.
 *
 * The body was **310** lines on the day the split landed, against a target of
 * roughly 250–300. Twenty lines of headroom is room for a genuine addition — a
 * new binding principle, a new trap that catches an agent who was not looking
 * for it. A bigger one means the material has a home among the routed documents
 * or deserves a new one.
 *
 * **Never raise this to make a run pass.** Extract instead; that is the whole
 * point of the number.
 */
export const ROUTER_BODY_CEILING = 330;

export type RouterFindingKind =
  /** A document in the routed directory that `AGENTS.md` points at from nowhere. */
  | 'unrouted-document'
  /** A pointer naming a file that is not on disk. */
  | 'dangling-pointer'
  /** `AGENTS.md` names one routed document more than once. */
  | 'duplicate-pointer'
  /** A routed document's heading has re-appeared in `AGENTS.md`. */
  | 'relocated-heading'
  /** Two routed documents carry the same heading — two homes for one subject. */
  | 'duplicate-subject'
  /** A routing-table row that does not say *when* to open the document. */
  | 'routeless-row'
  /** `AGENTS.md`'s body has grown past {@link ROUTER_BODY_CEILING}. */
  | 'oversized-router';

export interface RouterFinding {
  readonly kind: RouterFindingKind;
  readonly subject: string;
  readonly detail: string;
}

export interface RoutingRow {
  readonly when: string;
  readonly subject: string;
  readonly target: string;
}

export interface RouterInputs {
  /** `AGENTS.md`'s full text. */
  readonly routerText: string;
  /** The routed documents, keyed by file name, valued by their full text. */
  readonly documents: ReadonlyMap<string, string>;
}

export interface RouterAnalysis {
  readonly findings: readonly RouterFinding[];
  readonly rows: readonly RoutingRow[];
  readonly bodyLines: number;
  readonly headingCount: number;
}

/**
 * Read the real tree. Kept apart from {@link analyseRouter} so that a fixture
 * enters at the top of the analysis rather than below the part it is meant to
 * protect (issue #130).
 */
export function readRouterInputs(repoRoot: string): RouterInputs {
  const routerText = readFileSync(join(repoRoot, ROUTER_FILE), 'utf8');
  const documents = new Map<string, string>();
  for (const entry of readdirSync(join(repoRoot, CONVENTIONS_DIR), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    documents.set(entry.name, readFileSync(join(repoRoot, CONVENTIONS_DIR, entry.name), 'utf8'));
  }
  return { routerText, documents };
}

/**
 * A heading, reduced to the thing two spellings of one subject have in common:
 * no leading hashes, no backticks, no emphasis, no case, no runs of spaces.
 */
export function normaliseHeading(line: string): string {
  return line
    .replace(/^#+\s*/, '')
    .replace(/[`*_]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function headingsOf(text: string): readonly string[] {
  return text
    .split('\n')
    .filter((line) => /^#{1,6}\s/.test(line))
    .map(normaliseHeading)
    .filter((h) => h.length > 0);
}

/** Every `specs/conventions/<file>.md` this text names, in order, with repeats. */
export function pointersIn(text: string): readonly string[] {
  return [...text.matchAll(/specs\/conventions\/([A-Za-z0-9._-]+\.md)/g)].map((m) => m[1]!);
}

/**
 * The routing table's rows. A row is a three-column markdown row whose last cell
 * is a pointer; the header and the `| --- |` separator are not rows.
 */
export function routingRows(text: string): readonly RoutingRow[] {
  const rows: RoutingRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || !line.includes(CONVENTIONS_DIR)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 3) continue;
    const target = cells[2]!.replace(/`/g, '').trim();
    if (!target.startsWith(`${CONVENTIONS_DIR}/`)) continue;
    rows.push({ when: cells[0]!, subject: cells[1]!, target: target.slice(CONVENTIONS_DIR.length + 1) });
  }
  return rows;
}

/** The lines of `AGENTS.md` above the speckit appendix. */
export function bodyLineCount(routerText: string): number {
  const lines = routerText.split('\n');
  const marker = lines.findIndex((l) => l.includes(APPENDIX_MARKER));
  return marker === -1 ? lines.length : marker;
}

/**
 * The states in which a verdict would be vacuous. Each is a refusal and never a
 * pass: with no document every pointer is dangling and with no pointer every
 * document is unrouted, so in both directions "nothing wrong" would be a
 * statement about the walk dressed as one about the tree.
 */
export function vacuousRouterPopulation(inputs: RouterInputs): string | null {
  if (inputs.routerText.trim().length === 0) return 'the router file is empty';
  if (inputs.documents.size === 0) return `no document under ${CONVENTIONS_DIR}/`;
  if (!inputs.routerText.includes(APPENDIX_MARKER)) {
    return `the router carries no speckit appendix marker, so its body cannot be measured`;
  }
  if (routingRows(inputs.routerText).length === 0) return 'the routing table parsed to no row';
  return null;
}

/**
 * The whole rule, over injected inputs.
 *
 * Callers must ask {@link vacuousRouterPopulation} first; this function judges
 * what it is given and has no opinion about whether that was everything.
 */
export function analyseRouter(inputs: RouterInputs): RouterAnalysis {
  const findings: RouterFinding[] = [];
  const rows = routingRows(inputs.routerText);
  const pointers = pointersIn(inputs.routerText);

  const seen = new Map<string, number>();
  for (const p of pointers) seen.set(p, (seen.get(p) ?? 0) + 1);

  for (const [target, count] of seen) {
    if (count > 1) {
      findings.push({
        kind: 'duplicate-pointer',
        subject: target,
        detail:
          `${ROUTER_FILE} names it ${count} times. One home, one pointer: a second mention is ` +
          `a second place to keep correct. Route through the table and cite the table.`,
      });
    }
    if (!inputs.documents.has(target)) {
      findings.push({
        kind: 'dangling-pointer',
        subject: target,
        detail: `${ROUTER_FILE} points at ${CONVENTIONS_DIR}/${target}, which is not there.`,
      });
    }
  }

  for (const name of [...inputs.documents.keys()].sort()) {
    if (!seen.has(name)) {
      findings.push({
        kind: 'unrouted-document',
        subject: name,
        detail:
          `${CONVENTIONS_DIR}/${name} is a document nothing routes to. An agent reaches it only ` +
          `by guessing it exists. Add a row to ${ROUTER_FILE}'s routing table saying when to open it.`,
      });
    }
  }

  for (const row of rows) {
    if (row.when.length < 15 || row.subject.length === 0) {
      findings.push({
        kind: 'routeless-row',
        subject: row.target,
        detail:
          `the routing row says when="${row.when}" subject="${row.subject}". A pointer that does ` +
          `not say when to open it is worthless — "see X for modules" routes nobody.`,
      });
    }
  }

  const routerHeadings = new Set(headingsOf(inputs.routerText));
  const homeOf = new Map<string, string>();
  for (const name of [...inputs.documents.keys()].sort()) {
    for (const heading of headingsOf(inputs.documents.get(name)!)) {
      if (routerHeadings.has(heading)) {
        findings.push({
          kind: 'relocated-heading',
          subject: `${name}:${heading}`,
          detail:
            `"${heading}" is a heading in ${CONVENTIONS_DIR}/${name} and in ${ROUTER_FILE}. ` +
            `Relocation is not duplication: the rule has one home and the router points at it.`,
        });
      }
      const prior = homeOf.get(heading);
      if (prior !== undefined && prior !== name) {
        findings.push({
          kind: 'duplicate-subject',
          subject: heading,
          detail:
            `"${heading}" heads a section in both ${prior} and ${name} — two homes for one ` +
            `subject, waiting to disagree.`,
        });
      } else {
        homeOf.set(heading, name);
      }
    }
  }

  const bodyLines = bodyLineCount(inputs.routerText);
  if (bodyLines > ROUTER_BODY_CEILING) {
    findings.push({
      kind: 'oversized-router',
      subject: ROUTER_FILE,
      detail:
        `${bodyLines} lines above the appendix, ceiling ${ROUTER_BODY_CEILING}. Extract to a ` +
        `routed document; never raise the ceiling to make a run pass.`,
    });
  }

  return { findings, rows, bodyLines, headingCount: routerHeadings.size };
}
