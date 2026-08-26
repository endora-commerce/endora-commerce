/**
 * Parser for the provider taxonomy files — feature 067 / FR-077, FR-088.
 *
 * It parses the same bytes whichever way they arrived: the files vendored
 * inside the module (`data/taxonomies/…`, loaded at boot) and the bytes a
 * taxonomy check downloaded (`taxonomy-source-fetcher.ts`). The vendored files
 * are kept **verbatim** so a data drop is a plain download and the provenance
 * stays auditable, which is also what lets one tolerant parser serve both paths
 * rather than a hand-massaged intermediate format nobody can re-derive:
 *
 *   Google  `1 - Animals & Pet Supplies > Pet Supplies`
 *   Meta    `1,food & beverages > food > soups & broths`
 *
 * Both reduce to (external id, path segments). Comment lines (`#`, which is how
 * Google stamps its revision), a CSV header line, a UTF-8 BOM and blank lines
 * are skipped.
 *
 * Pure and synchronous: file reading is the reconciler's job, so this is unit
 * testable against a three-line fixture instead of a 500 KB shipped asset.
 */

/**
 * Google stamps its revision inside the file, as a comment
 * `# Google_Product_Taxonomy_Version: 2021-09-21`, which `parseTaxonomyFile`
 * skips along with every other comment. Meta stamps nothing at all.
 *
 * A separate export rather than a second return value from `parseTaxonomyFile`
 * on purpose: that function's behaviour and signature are relied on by the boot
 * reconciler and by its own tests, and widening them to serve the refresh path
 * would make one of the two callers pay for the other's needs.
 */
const GOOGLE_VERSION_HEADER_RE = /^#\s*google_product_taxonomy_version\s*:\s*(.+?)\s*$/i;

export function parseTaxonomyHeader(content: string): string | null {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (line === '') continue;
    // The stamp is in the file's preamble; once real data starts there is no
    // point walking a 5 600-line file looking for a comment.
    if (!line.startsWith('#')) return null;
    const match = GOOGLE_VERSION_HEADER_RE.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}

export interface ParsedTaxonomyLine {
  externalId: string;
  /** Root → leaf. */
  pathSegments: string[];
}

/** Provider path separator; both publish ` > `. */
const PATH_SEPARATOR = '>';

/** Google: `<id> - <path>`. The separator is space-hyphen-space, and a path segment may itself contain a hyphen. */
const GOOGLE_LINE_RE = /^(\d+)\s+-\s+(.*)$/;

/** Meta: `<id>,<path>`. */
const DELIMITED_LINE_RE = /^([^,]+),(.*)$/;

export class TaxonomyFileFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaxonomyFileFormatError';
  }
}

function splitPath(raw: string): string[] {
  return raw
    .split(PATH_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
}

export function parseTaxonomyFile(content: string): ParsedTaxonomyLine[] {
  const out: ParsedTaxonomyLine[] = [];
  const seen = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    // A BOM only ever appears on the first line, but stripping it per line is
    // cheaper than special-casing the first iteration.
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (line === '') continue;
    // Google stamps the revision as `# Google_Product_Taxonomy_Version: …`.
    if (line.startsWith('#')) continue;

    const google = GOOGLE_LINE_RE.exec(line);
    const delimited = google ? null : DELIMITED_LINE_RE.exec(line);
    const match = google ?? delimited;
    if (!match) continue;

    const externalId = (match[1] ?? '').trim();
    const pathSegments = splitPath(match[2] ?? '');
    // The CSV header (`category_id,category`) parses as a line whose id is not
    // numeric and whose path is a single word — drop it rather than importing
    // a node called "category".
    if (!/^\d+$/.test(externalId)) continue;
    if (pathSegments.length === 0) continue;
    // A duplicated id would silently overwrite a real node on load.
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    out.push({ externalId, pathSegments });
  }

  if (out.length === 0) {
    throw new TaxonomyFileFormatError('No taxonomy nodes could be parsed from the file.');
  }
  return out;
}

export interface TaxonomyNodeDraft {
  externalId: string;
  parentExternalId: string | null;
  /** Per-language leaf label. */
  label: Record<string, string>;
  /** Per-language full `A > B > C` path. */
  fullPath: Record<string, string>;
  depth: number;
}

/**
 * Merges one parsed file per language into the node rows the reconciler writes.
 *
 * The **first** language listed is authoritative for the tree's structure: ids,
 * parentage and depth come from it, and every other language contributes labels
 * only. That is what makes a mapping language-independent — a node's identity
 * is its provider id, and switching the admin language can only change what is
 * rendered, never what was stored (FR-085).
 *
 * A node present in a translation but absent from the authoritative language is
 * ignored rather than invented: providers publish translations at their own
 * pace, and a half-present node would be unmappable anyway.
 */
export function buildTaxonomyNodes(
  filesByLanguage: ReadonlyArray<{ language: string; lines: ParsedTaxonomyLine[] }>,
): TaxonomyNodeDraft[] {
  const authoritative = filesByLanguage[0];
  if (!authoritative) {
    throw new TaxonomyFileFormatError('No taxonomy language files were supplied.');
  }

  // Path prefix → external id, so a child can find its parent by dropping its
  // own last segment. Built from the authoritative language only.
  const idByPath = new Map<string, string>();
  for (const line of authoritative.lines) {
    idByPath.set(line.pathSegments.join(` ${PATH_SEPARATOR} `), line.externalId);
  }

  const linesById = new Map<string, Map<string, ParsedTaxonomyLine>>();
  for (const file of filesByLanguage) {
    for (const line of file.lines) {
      const perLanguage = linesById.get(line.externalId) ?? new Map();
      perLanguage.set(file.language, line);
      linesById.set(line.externalId, perLanguage);
    }
  }

  const drafts: TaxonomyNodeDraft[] = [];
  for (const line of authoritative.lines) {
    const perLanguage = linesById.get(line.externalId);
    const label: Record<string, string> = {};
    const fullPath: Record<string, string> = {};
    for (const [language, localized] of perLanguage ?? []) {
      const segments = localized.pathSegments;
      label[language] = segments[segments.length - 1] ?? '';
      fullPath[language] = segments.join(` ${PATH_SEPARATOR} `);
    }

    const parentPath = line.pathSegments.slice(0, -1).join(` ${PATH_SEPARATOR} `);
    drafts.push({
      externalId: line.externalId,
      parentExternalId: parentPath === '' ? null : (idByPath.get(parentPath) ?? null),
      label,
      fullPath,
      depth: Math.max(0, line.pathSegments.length - 1),
    });
  }
  return drafts;
}
