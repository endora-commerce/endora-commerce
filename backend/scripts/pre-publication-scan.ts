/**
 * The **one-time** pre-publication scan over what the public history would
 * carry (`specs/136-open-source-publication/` GAP-1, FR-001 … FR-004, plan
 * W2.3 / W2.5; normative contract `contracts/pre-publication-scan.md`, its C4
 * rows as amended by owner ruling D-265).
 *
 * ## What it is, and what it is deliberately not
 *
 * A migration tool, like `public-history-filter.ts` beside it: it runs over
 * that filter's **dry-run projection** — the repository that would be pushed —
 * once as a rehearsal whenever anybody likes, and once for real on the final
 * dry run, whose report a human reads before the push. **It is not a
 * `check-*` script and must never be named like one** (129 FR-014, contract
 * §5): that namespace is a standing instrument with a read-size ledger, and this
 * one will not exist to be measured. What it keeps from that estate is the
 * refusal of a vacuous green — **exit 2** on an empty or short walk (126
 * FR-014) — and the per-class report with the zeros in it
 * (`specs/conventions/commercial-data.md` §4(d)).
 *
 * ## The one property everything else is subordinate to
 *
 * **It never prints a matched value** (FR-002). A report that contains a
 * secret is itself a disclosure, and this report is quoted in the merge request
 * that performs the migration. So the model below has no field that could hold
 * one: a hit is a class, a rule id, a path, a line number and — for history — a
 * commit. The commercial vocabulary returns the matched line; that text is
 * dropped at the boundary. The secret scanner's report carries `Secret`,
 * `Match`, `Author`, `Email` and `Message`; {@link parseGitleaksReport} reads
 * four other fields and nothing else, and the raw report is deleted as soon as
 * it is parsed.
 *
 * ## The three surfaces and the nine classes
 *
 * T (the tip), Y (every reachable blob, deduplicated by blob id, and every
 * commit message) and K (every file of every tarball the first publish would
 * produce), against S, H, P, C1–C3, C4 (two rows), L and R —
 * {@link CLASS_SURFACES} is the contract's §3 matrix as data, and the report
 * prints one row for every cell of it. A cell that did not run reads *not
 * scanned* with its reason and makes the verdict **incomplete**; it is never a
 * zero.
 *
 * Two rows are **located, not judged**. D-265 turned D-253's predicate from a
 * definition into a locator: a C4 partition hit is a sentence about the paid
 * tier, to be read against `commercial-data.md` §3 N4's *inform, never press*
 * condition and for truth at the tip. The C4 *other* row is the same kind of
 * aid for the contract's hand review. Both are counted and listed; neither is
 * a finding on its own.
 *
 * ## Secrets: a maintained scanner, run as a container
 *
 * The plan's Complexity Tracking row rules it: a secret scanner as a
 * **container image**, never a workspace dependency — a hand-written regex set
 * has an unknown recall, and a missed credential is public forever. This script
 * runs `gitleaks` (pinned by digest in {@link GITLEAKS_IMAGE}) through the local
 * container runtime, three times: `git` over Y, `dir` over an export of T, `dir`
 * over the extracted tarballs. With no runtime, or with `--no-scanner`, the S
 * rows read *not scanned* and the provider-token patterns the estate already
 * knows ({@link SECRET_PATTERNS}) still run — reported beside the reason, never
 * in its place.
 *
 * Usage, **through the package script**, which is the spelling that keeps the
 * exit code (`public-history-filter.ts` measured why):
 *
 *   `pnpm --filter backend run history:filter`   # writes the projection
 *   `pnpm --filter backend run history:scan -- [--repo <dir>] [--out <dir>]`
 *   `    [--pack | --tarballs <dir>] [--no-scanner] [--internal-zone <zone>]...`
 *   `    [--paid-ids <a,b,…>] [--rehearsal]`
 *
 * `--repo` defaults to the filter's projection, `<git-dir>/endora-public-history/projection`,
 * and the filter's `report.json` beside it is the population floor: a scan
 * reading fewer tip files or commits than the filter printed exits 2. `--pack`
 * packs every publishable workspace member of **this** checkout (build first:
 * `pnpm pack` packs what is on disk). `--rehearsal` lets an incomplete run exit
 * on its findings instead of 2; the verdict line still says *incomplete*.
 *
 * Exit codes: `0` every cell scanned and no finding; `1` findings (they are for
 * a human — FR-004 says what an S finding costs); `2` a vacuous or incomplete
 * run.
 */
/* eslint-disable no-console -- CLI tool: stdout/stderr is the interface. */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { scanCommercialVocabulary, TERMS } from './lib/commercial-vocabulary.js';
import { classifyWorkspaceMembers, nodeWorkspaceFs } from './lib/workspace-packages.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PREFIX = '[pre-publication-scan]';

/**
 * The scanner image, pinned by digest so the rehearsal and the final run use
 * the same rules. `ENDORA_GITLEAKS_IMAGE` overrides it for a newer pin.
 */
export const GITLEAKS_IMAGE =
  'ghcr.io/gitleaks/gitleaks:v8.28.0@sha256:cdbb7c955abce02001a9f6c9f602fb195b7fadc1e812065883f695d1eeaba854';

/**
 * Where the paid-id population is recorded. One record (D-100): this scan reads
 * it at run time and never repeats it. It is a private document, which is
 * right — the scan runs before the migration, in the private checkout.
 */
export const PAID_ID_RECORD = 'specs/134-paid-module-extraction/spec.md';

// --- the model --------------------------------------------------------------

export type ScanClass =
  | 'S'
  | 'H'
  | 'P'
  | 'C1'
  | 'C2'
  | 'C3'
  | 'C4-partition'
  | 'C4-other'
  | 'L'
  | 'R';
export type Surface = 'T' | 'Y' | 'K';
/** `reported` — counted and listed, but the contract accepts it (not redacted). */
export type CellMode = 'scanned' | 'reported';

/** Contract §3 as data: which surfaces each class is scanned on. */
export const CLASS_SURFACES: Readonly<Record<ScanClass, Partial<Record<Surface, CellMode>>>> = {
  S: { T: 'scanned', Y: 'scanned', K: 'scanned' },
  H: { T: 'scanned', Y: 'reported', K: 'scanned' },
  P: { T: 'scanned', Y: 'scanned', K: 'scanned' },
  C1: { T: 'scanned', Y: 'scanned', K: 'scanned' },
  C2: { T: 'scanned', Y: 'scanned', K: 'scanned' },
  C3: { T: 'scanned', Y: 'scanned', K: 'scanned' },
  'C4-partition': { T: 'scanned', Y: 'reported', K: 'scanned' },
  'C4-other': { T: 'scanned' },
  L: { T: 'scanned', K: 'scanned' },
  R: { T: 'scanned', K: 'scanned' },
};

export const CLASS_ORDER: readonly ScanClass[] = Object.keys(CLASS_SURFACES) as ScanClass[];
const SURFACE_ORDER: readonly Surface[] = ['T', 'Y', 'K'];

/** Located for a human, never a finding on its own (D-265). */
const LOCATOR_CLASSES = new Set<ScanClass>(['C4-partition', 'C4-other']);

/** One hit. There is no field that could carry the matched text. */
export interface Hit {
  readonly klass: ScanClass;
  readonly rule: string;
  /** 1-based; 0 when the hit is about the file rather than a line. */
  readonly line: number;
}

export interface ScanContext {
  readonly paidIds: readonly string[];
  readonly internalHosts: readonly string[];
  readonly internalZones: readonly string[];
}

// --- content detection ------------------------------------------------------

/**
 * Provider-token shapes the estate already knows (contract §3 S). They are the
 * floor under the scanner, not a substitute for it.
 */
export const SECRET_PATTERNS: readonly { rule: string; pattern: RegExp }[] = [
  { rule: 'gitlab-token', pattern: /\bgl(?:pat|dt|rt|ptt|cbt|oas|imt|agent|soat)-[0-9A-Za-z_-]{20,}/g },
  { rule: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  // A literal assigned to the registry-token variable; an environment reference
  // (`${…}`, `$…`, `<…>`, or `\${…}` escaped inside a template literal) or a
  // masked value is not one.
  {
    rule: 'endora-npm-token',
    pattern: /\bENDORA_NPM_TOKEN\s*[=:]\s*["'`]?(?![\\$<{*])[A-Za-z0-9_-]{16,}/g,
  },
  { rule: 'npmrc-auth-literal', pattern: /_authToken\s*=\s*["']?(?![\\$<{*])[^\s"'`]{16,}/g },
];

/** The hosts the contract names, built from parts so this file is not its own H finding. */
export const DEFAULT_INTERNAL_HOSTS: readonly string[] = ['gitlab', 'npm'].map((h) =>
  [h, 'endora', 'pl'].join('.'),
);

const PRIVATE_ADDRESS =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d{2,5}\b/g;

// The local part may not follow `/`, `@` or a word character, which keeps a
// scoped package specifier with a version (`@scope/name@1.2.3-rc.x`) out.
const EMAIL = /(?<![\w/@.%+-])[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24})\b/g;
const PHONE = /(?<![\w+])\+\d{2,3}[ -]?\d{2,3}[ -]?\d{3}[ -]?\d{3,4}\b/g;
const ELEVEN_DIGITS = /(?<!\d)\d{11}(?!\d)/g;
const NIP_SHAPE = /(?<![\d-])(\d{3}-?\d{3}-?\d{2}-?\d{2}|\d{3}-\d{2}-\d{2}-\d{3})(?![\d-])/g;
const PESEL_CONTEXT = /pesel/i;
const NIP_CONTEXT = /\b(?:nip|vat|tax[ _-]?id|taxId)\b/i;

/** Domains nobody lives at: RFC 2606 / 6761 reserved names and the example domains. */
const RESERVED_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost|local)$/i;
/** Role addresses — a mailbox, not a person. */
const ROLE_LOCAL_PART =
  /^(?:no-?reply|do-?not-?reply|security|support|info|contact|hello|admin|abuse|privacy|legal|conduct|postmaster|webmaster|git|noreply\+[\w.-]+)$/i;

export function isPersonalEmail(address: string): boolean {
  const at = address.lastIndexOf('@');
  if (at <= 0) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (RESERVED_DOMAIN.test(domain)) return false;
  if (ROLE_LOCAL_PART.test(local)) return false;
  // A label that is all digits is a version, not a host.
  if (domain.split('.').some((label) => /^\d+$/.test(label))) return false;
  return true;
}

export function validPesel(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  const d = [...value].map(Number);
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = weights.reduce((acc, w, i) => acc + w * d[i]!, 0);
  if ((10 - (sum % 10)) % 10 !== d[10]) return false;
  const month = (d[2]! * 10 + d[3]!) % 20;
  const day = d[4]! * 10 + d[5]!;
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

export function validNip(value: string): boolean {
  const digits = value.replace(/-/g, '');
  if (!/^\d{10}$/.test(digits)) return false;
  const d = [...digits].map(Number);
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const check = weights.reduce((acc, w, i) => acc + w * d[i]!, 0) % 11;
  return check !== 10 && check === d[9];
}

/** Line lookup built only when a text has a hit. */
class Lines {
  private starts: number[] | null = null;
  constructor(private readonly text: string) {}
  at(index: number): number {
    if (this.starts === null) {
      const starts = [0];
      for (let i = this.text.indexOf('\n'); i !== -1; i = this.text.indexOf('\n', i + 1)) {
        starts.push(i + 1);
      }
      this.starts = starts;
    }
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
  line(n: number): string {
    this.at(0);
    const starts = this.starts!;
    const start = starts[n - 1] ?? 0;
    const end = n < starts.length ? starts[n]! - 1 : this.text.length;
    return this.text.slice(start, end);
  }
}

function eachMatch(pattern: RegExp, text: string, visit: (m: RegExpExecArray) => void): void {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    visit(m);
    if (m[0].length === 0) re.lastIndex += 1;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The vocabulary's prefilter: any line a term *could* match. It is a superset
 * (case-folded), and every candidate line is then judged by
 * {@link scanCommercialVocabulary} itself — one statement of the rule, imported.
 */
const VOCABULARY_PREFILTER = new RegExp(TERMS.map((t) => `(?:${t.pattern.source})`).join('|'), 'i');
const CLEARANCE_LINE = /commercial-data:\s*cleared/i;

/**
 * D-253's status phrase, generalised as research R-7 did — the C4 partition
 * **locator** (D-265). Built from parts so the slug is not a literal here.
 */
export const STATUS_PHRASE = new RegExp(
  [
    ['paid', 'module', 'extraction'].join('-'),
    'paid[ -](?:modules?|packages?|tiers?|repositor|subset)',
    'commercially licen[sc]ed',
    'leav(?:es|ing) (?:this|the) (?:repository|monorepo)',
    'bound for the paid',
  ].join('|'),
  'gi',
);
const PARTITION_WINDOW = 10;

/**
 * D-265 clause 3 as a locator for the hand review: a purchase prompt, a trial,
 * an unlock. `purchase` alone is absent on purpose — this is commerce software
 * and the purchase order is its domain.
 */
const PRESS_LOCATOR =
  /\b(?:upgrade to (?:the )?(?:pro|premium|paid|commercial|enterprise)|unlock(?:s|ed)? (?:with|by|the)|free trial|trial version|premium (?:version|edition|feature)|pro edition|enterprise edition|licen[cs]e key|buy (?:a|the) licen[cs]e)\b/i;

/** Every path-independent hit in one text. The text never leaves this function. */
export function detectContent(text: string, ctx: ScanContext): Hit[] {
  const hits: Hit[] = [];
  const lines = new Lines(text);

  for (const { rule, pattern } of SECRET_PATTERNS) {
    eachMatch(pattern, text, (m) => hits.push({ klass: 'S', rule, line: lines.at(m.index) }));
  }

  const hosts = [...ctx.internalHosts];
  if (hosts.length > 0 || ctx.internalZones.length > 0) {
    const alternatives = [
      ...hosts.map((h) => escapeRegExp(h)),
      ...ctx.internalZones.map((z) => `[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.${escapeRegExp(z.replace(/^\./, ''))}`),
    ];
    const hostPattern = new RegExp(`(?<![A-Za-z0-9-])(?:${alternatives.join('|')})(?![A-Za-z0-9-])`, 'gi');
    eachMatch(hostPattern, text, (m) =>
      hits.push({ klass: 'H', rule: 'internal-host', line: lines.at(m.index) }),
    );
  }
  eachMatch(PRIVATE_ADDRESS, text, (m) =>
    hits.push({ klass: 'H', rule: 'private-address', line: lines.at(m.index) }),
  );

  eachMatch(EMAIL, text, (m) => {
    if (isPersonalEmail(m[0])) hits.push({ klass: 'P', rule: 'email', line: lines.at(m.index) });
  });
  eachMatch(PHONE, text, (m) => hits.push({ klass: 'P', rule: 'phone', line: lines.at(m.index) }));
  if (PESEL_CONTEXT.test(text)) {
    eachMatch(ELEVEN_DIGITS, text, (m) => {
      if (!validPesel(m[0])) return;
      const line = lines.at(m.index);
      if (PESEL_CONTEXT.test(lines.line(line))) hits.push({ klass: 'P', rule: 'pesel', line });
    });
  }
  if (NIP_CONTEXT.test(text)) {
    eachMatch(NIP_SHAPE, text, (m) => {
      if (!validNip(m[0])) return;
      const line = lines.at(m.index);
      if (NIP_CONTEXT.test(lines.line(line))) hits.push({ klass: 'P', rule: 'nip', line });
    });
  }

  if (VOCABULARY_PREFILTER.test(text)) {
    // Only the candidate lines and the clearance annotations are handed to the
    // rule, with their numbers kept: the rule is per line, so this is the same
    // verdict at a fraction of the cost over a history of large files.
    const all = text.split('\n');
    const kept: number[] = [];
    for (let i = 0; i < all.length; i += 1) {
      const l = all[i]!;
      if (VOCABULARY_PREFILTER.test(l) || CLEARANCE_LINE.test(l)) kept.push(i);
    }
    const scan = scanCommercialVocabulary(kept.map((i) => all[i]!).join('\n'));
    for (const hit of scan.hits) {
      const line = kept[hit.line - 1]! + 1;
      const klass: ScanClass = hit.klass === 'C4' ? 'C4-other' : hit.klass;
      hits.push({ klass, rule: hit.term, line });
    }
  }
  if (PRESS_LOCATOR.test(text)) {
    eachMatch(PRESS_LOCATOR, text, (m) =>
      hits.push({ klass: 'C4-other', rule: 'press-locator', line: lines.at(m.index) }),
    );
  }

  if (ctx.paidIds.length > 0) {
    const statusLines: number[] = [];
    eachMatch(STATUS_PHRASE, text, (m) => statusLines.push(lines.at(m.index)));
    if (statusLines.length > 0) {
      const spellings = new Set<string>();
      for (const id of ctx.paidIds) {
        spellings.add(id);
        spellings.add(id.replace(/_/g, '-'));
        spellings.add(id.replace(/-/g, '_'));
      }
      const idPattern = new RegExp(
        `(?<![A-Za-z0-9])(?:${[...spellings].map(escapeRegExp).join('|')})(?![A-Za-z0-9])`,
        'g',
      );
      const idLines: number[] = [];
      eachMatch(idPattern, text, (m) => idLines.push(lines.at(m.index)));
      for (const line of new Set(statusLines)) {
        if (idLines.some((l) => Math.abs(l - line) <= PARTITION_WINDOW)) {
          hits.push({ klass: 'C4-partition', rule: 'status-near-paid-id', line });
        }
      }
    }
  }
  return hits;
}

// --- path-dependent classes -------------------------------------------------

/** Shipped documents (contract §3 R): where a link a public reader cannot follow is a finding. */
export function isShippedDocument(path: string, surface: Surface): boolean {
  if (surface === 'K') return /\.mdx?$/i.test(path);
  return (
    path === 'README.md' ||
    path.startsWith('docs/') ||
    /^packages\/(?:.+\/)?docs\//.test(path) ||
    /^packages\/.+\/(?:README|CHANGELOG)\.md$/.test(path)
  );
}

/**
 * The hand-review population of the C4 *other* row, as D-265 widened it: the
 * front documents, the docs site, every CHANGELOG, the admin and storefront
 * i18n bundles and the CLI's output strings.
 */
export function isHandReviewPath(path: string): boolean {
  if (/(?:^|\/)(?:test|tests|__tests__|fixtures)\//.test(path) || /\.test\.[cm]?[jt]sx?$/.test(path)) {
    return false;
  }
  if (path.startsWith('specs/')) return false;
  return (
    path === 'README.md' ||
    path === 'CONTRIBUTING.md' ||
    path.startsWith('docs/') ||
    /(?:^|\/)CHANGELOG\.md$/.test(path) ||
    (/(?:^|\/)i18n\//.test(path) && /\.(?:json|ts)$/.test(path)) ||
    path.startsWith('packages/cli/src/')
  );
}

const SPECS_LINK = /\]\(\s*<?[^)\s]*?\bspecs\/\d{3}[^)\s]*\)|^\s*\[[^\]]+\]:\s*\S*\bspecs\/\d{3}/gm;
const EXTRACTION_SLUG = new RegExp(['paid', 'module', 'extraction'].join('-'), 'g');
const MIT_TEXT = /Permission is hereby granted, free of charge/;

function licenceHits(path: string, text: string): Hit[] {
  const name = basename(path);
  if (name === 'package.json') {
    let manifest: unknown;
    try {
      manifest = JSON.parse(text);
    } catch {
      return [];
    }
    const licence = (manifest as { license?: unknown } | null)?.license;
    if (typeof licence !== 'string') return [];
    if (/^SEE LICEN[CS]E IN\b/i.test(licence)) return [{ klass: 'L', rule: 'see-licence-in', line: 0 }];
    if (licence !== 'MIT') return [{ klass: 'L', rule: 'non-mit-licence', line: 0 }];
    return [];
  }
  if (/^LICEN[CS]E/i.test(name) && !MIT_TEXT.test(text)) {
    return [{ klass: 'L', rule: 'non-mit-licence-file', line: 0 }];
  }
  return [];
}

function referenceHits(path: string, text: string, surface: Surface): Hit[] {
  if (!isShippedDocument(path, surface) && !(surface !== 'K' && /^(?:docs|packages\/(?:.+\/)?docs)\//.test(path))) {
    return [];
  }
  const hits: Hit[] = [];
  const lines = new Lines(text);
  if (/\.mdx?$/i.test(path)) {
    eachMatch(SPECS_LINK, text, (m) => hits.push({ klass: 'R', rule: 'specs-link', line: lines.at(m.index) }));
  }
  eachMatch(EXTRACTION_SLUG, text, (m) =>
    hits.push({ klass: 'R', rule: 'extraction-slug', line: lines.at(m.index) }),
  );
  return hits;
}

function insidePaidPackage(path: string, ctx: ScanContext): boolean {
  const m = /^packages\/modules\/([^/]+)\//.exec(path);
  if (m === null) return false;
  const dir = m[1]!.replace(/-/g, '_');
  return ctx.paidIds.some((id) => id.replace(/-/g, '_') === dir);
}

/**
 * Every hit for one file on one surface: the content hits, the path-dependent
 * classes, and the contract's surface matrix applied. `content` is the cached
 * result of {@link detectContent} for the same blob, when the caller has one.
 */
export function detectForPath(
  path: string,
  text: string,
  surface: Surface,
  ctx: ScanContext,
  content?: readonly Hit[],
): Hit[] {
  const out: Hit[] = [];
  for (const hit of content ?? detectContent(text, ctx)) {
    if (CLASS_SURFACES[hit.klass][surface] === undefined) continue;
    if (hit.klass === 'C4-other' && !isHandReviewPath(path)) continue;
    if (hit.klass === 'C4-partition' && insidePaidPackage(path, ctx)) continue;
    out.push(hit);
  }
  if (surface !== 'Y') {
    out.push(...licenceHits(path, text), ...referenceHits(path, text, surface));
  }
  return out;
}

/** The paid ids, from the first fenced block after the record's `**The fifteen.**` line. */
export function parsePaidIds(record: string): string[] {
  const at = record.indexOf('**The fifteen.**');
  if (at === -1) return [];
  const open = record.indexOf('```', at);
  if (open === -1) return [];
  const bodyStart = record.indexOf('\n', open) + 1;
  const close = record.indexOf('```', bodyStart);
  if (bodyStart === 0 || close === -1) return [];
  return record
    .slice(bodyStart, close)
    .split(/\s+/)
    .filter((id) => /^[a-z][a-z0-9_-]*$/.test(id));
}

// --- the secret scanner -----------------------------------------------------

export interface ScannerLocation {
  readonly rule: string;
  readonly path: string;
  readonly commit: string | null;
  readonly line: number;
}

/**
 * The scanner's JSON report, read for **location only**. Every other field —
 * `Secret`, `Match`, `Author`, `Email`, `Message`, `Fingerprint` — is dropped
 * here, redacted or not.
 */
export function parseGitleaksReport(raw: string): ScannerLocation[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('the scanner report is not a JSON array');
  return parsed.map((entry) => {
    const e = entry as Record<string, unknown>;
    const commit = typeof e['Commit'] === 'string' && e['Commit'] !== '' ? e['Commit'] : null;
    return {
      rule: String(e['RuleID'] ?? 'unknown'),
      path: String(e['File'] ?? ''),
      commit,
      line: typeof e['StartLine'] === 'number' ? e['StartLine'] : 0,
    };
  });
}

/** The scanner's arguments. `--redact` and `--ignore-gitleaks-allow` are not optional. */
export function gitleaksArguments(input: {
  mode: 'git' | 'dir';
  target: string;
  report: string;
}): string[] {
  const common = [
    '--redact',
    '--ignore-gitleaks-allow',
    '--no-banner',
    '--log-level=error',
    '--exit-code=0',
    '--report-format=json',
    `--report-path=${input.report}`,
  ];
  return input.mode === 'git'
    ? ['git', '--log-opts=--all', ...common, input.target]
    : ['dir', ...common, input.target];
}

export interface ScannerOptions {
  readonly runtime: string;
  readonly image: string;
  /** A scratch directory the container writes its report into. */
  readonly workDir: string;
}

function runGitleaks(
  scanner: ScannerOptions,
  mounts: readonly [string, string][],
  mode: 'git' | 'dir',
  target: string,
  reportName: string,
): { ok: true; locations: ScannerLocation[] } | { ok: false; reason: string } {
  const outDir = join(scanner.workDir, 'scanner');
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, reportName);
  rmSync(reportPath, { force: true });
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 0;
  const args = [
    'run',
    '--rm',
    '--network=none',
    `--user=${uid}:${gid}`,
    '-e',
    'GIT_CONFIG_COUNT=1',
    '-e',
    'GIT_CONFIG_KEY_0=safe.directory',
    '-e',
    'GIT_CONFIG_VALUE_0=*',
    '-e',
    'HOME=/tmp',
    '-v',
    `${outDir}:/out`,
    ...mounts.flatMap(([host, inner]) => ['-v', `${host}:${inner}:ro`]),
    scanner.image,
    ...gitleaksArguments({ mode, target, report: `/out/${reportName}` }),
  ];
  // The scanner's own stdout/stderr is never forwarded: redacted or not, it
  // names authors and e-mail addresses beside each finding.
  const result = spawnSync(scanner.runtime, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0 || !existsSync(reportPath)) {
    return {
      ok: false,
      reason: `the scanner (${mode}) exited ${String(result.status)} without a report`,
    };
  }
  try {
    const locations = parseGitleaksReport(readFileSync(reportPath, 'utf8'));
    return { ok: true, locations };
  } catch (error) {
    return { ok: false, reason: `the scanner report was unreadable: ${(error as Error).message}` };
  } finally {
    rmSync(reportPath, { force: true });
  }
}

/** Whether a container runtime answers; the reason when it does not. */
export function containerRuntimeReason(runtime: string): string | null {
  const probe = spawnSync(runtime, ['info'], { stdio: 'ignore' });
  if (probe.error !== undefined) return `no container runtime: \`${runtime}\` is not on this machine`;
  if (probe.status !== 0) return `the container runtime \`${runtime} info\` exited ${String(probe.status)}`;
  return null;
}

// --- the walk ---------------------------------------------------------------

export interface Finding {
  readonly surface: Surface;
  readonly klass: ScanClass;
  readonly rule: string;
  /** A path at the tip, in history, in a tarball, or `commit-message`. */
  readonly path: string;
  readonly lines: readonly number[];
  /** Y: the commit that introduced the blob, or the commit whose message it is. */
  readonly introduced?: string | null;
  /** Y: the commit that removed the blob; `null` when it is still at the tip or unknown. */
  readonly removed?: string | null;
  readonly method: 'patterns' | 'scanner';
}

export interface TarballInput {
  readonly tarball: string;
  /** The member's directory in the repository, so K paths read like T paths. */
  readonly memberDir: string | null;
}

export interface ScanSizes {
  readonly tipFiles: number;
  readonly blobs: number;
  readonly textBlobs: number;
  readonly binaryBlobs: number;
  readonly commits: number;
  readonly tarballs: number;
  readonly tarballFiles: number;
  readonly tarballsRequested: boolean;
}

export interface ScanReport {
  readonly repo: string;
  readonly head: string;
  readonly sizes: ScanSizes;
  readonly paidIds: number;
  readonly internalHosts: number;
  readonly internalZones: number;
  /** Cells not scanned, keyed `klass/surface`, with the reason. */
  readonly notScanned: ReadonlyMap<string, string>;
  readonly scanner: string;
  readonly findings: readonly Finding[];
  readonly floor: FilterFloor | null;
}

export interface FilterFloor {
  readonly keptFiles: number;
  readonly survivingCommits: number;
}

export interface RunScanOptions {
  readonly repo: string;
  readonly ctx: ScanContext;
  readonly scanner: ScannerOptions | null;
  /** Why the scanner is absent, when it is. */
  readonly scannerAbsentReason?: string;
  readonly tarballs: readonly TarballInput[] | null;
  readonly workDir?: string;
  readonly floor?: FilterFloor | null;
}

function git(cwd: string, args: readonly string[], input?: string): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  });
}

function isBinary(data: Buffer): boolean {
  const end = Math.min(data.length, 8000);
  for (let i = 0; i < end; i += 1) if (data[i] === 0) return true;
  return false;
}

/** Streams `git cat-file --batch` for a list of blob ids. */
function streamBlobs(
  cwd: string,
  oids: readonly string[],
  visit: (oid: string, data: Buffer) => void,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let chunks: Buffer[] = [];
    let length = 0;
    let need: { oid: string; size: number } | null = null;
    let failed: Error | null = null;
    const flatten = (): Buffer => {
      const all = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, length);
      chunks = [all];
      return all;
    };
    const keep = (rest: Buffer): void => {
      chunks = rest.length > 0 ? [rest] : [];
      length = rest.length;
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (failed !== null) return;
      chunks.push(chunk);
      length += chunk.length;
      for (;;) {
        if (need === null) {
          if (length === 0) return;
          const all = flatten();
          const newline = all.indexOf(10);
          if (newline === -1) return;
          const header = all.subarray(0, newline).toString('utf8').split(' ');
          keep(all.subarray(newline + 1));
          if (header[1] === 'missing' || header.length < 3) {
            failed = new Error(`git cat-file could not read ${header[0] ?? '?'}`);
            child.kill();
            return;
          }
          need = { oid: header[0]!, size: Number(header[2]) };
        }
        if (length < need.size + 1) return;
        const all = flatten();
        const body = all.subarray(0, need.size);
        keep(all.subarray(need.size + 1));
        const oid = need.oid;
        need = null;
        try {
          visit(oid, body);
        } catch (error) {
          failed = error as Error;
          child.kill();
          return;
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (failed !== null) reject(failed);
      else if (code !== 0) reject(new Error(`git cat-file exited ${String(code)}`));
      else resolvePromise();
    });
    child.stdin.end(oids.length > 0 ? `${oids.join('\n')}\n` : '');
  });
}

/** Introduced / removed commit for each blob of interest, in one pass over the raw log. */
function blobCommits(
  cwd: string,
  oids: ReadonlySet<string>,
): Map<string, { introduced: string | null; removed: string | null }> {
  const result = new Map<string, { introduced: string | null; removed: string | null }>();
  if (oids.size === 0) return result;
  const out = git(cwd, ['log', '--all', '--reverse', '--no-renames', '--raw', '--no-abbrev', '--format=@@%H']);
  let commit = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('@@')) {
      commit = line.slice(2);
      continue;
    }
    if (!line.startsWith(':')) continue;
    const fields = line.slice(1).split('\t')[0]!.split(' ');
    const before = fields[2];
    const after = fields[3];
    if (after !== undefined && oids.has(after)) {
      const entry = result.get(after) ?? { introduced: null, removed: null };
      if (entry.introduced === null) entry.introduced = commit;
      result.set(after, entry);
    }
    if (before !== undefined && before !== after && oids.has(before)) {
      const entry = result.get(before) ?? { introduced: null, removed: null };
      if (entry.removed === null) entry.removed = commit;
      result.set(before, entry);
    }
  }
  return result;
}

function walkFiles(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full, { throwIfNoEntry: false });
    if (stat === undefined) continue;
    if (stat.isDirectory()) out.push(...walkFiles(full, base));
    else if (stat.isFile()) out.push(relative(base, full));
  }
  return out;
}

/** The scan, over a repository and optionally a set of tarballs. */
export async function runScan(options: RunScanOptions): Promise<ScanReport> {
  const { repo, ctx } = options;
  const findings: Finding[] = [];
  const notScanned = new Map<string, string>();
  const workDir = options.workDir ?? join(repo, '.git', 'endora-pre-publication-scan');

  const head = git(repo, ['rev-parse', 'HEAD']).trim();

  // T — the tip, path → blob.
  const tipByOid = new Map<string, string[]>();
  let tipFiles = 0;
  for (const entry of git(repo, ['ls-tree', '-r', '-z', 'HEAD']).split('\0')) {
    if (entry === '') continue;
    const tab = entry.indexOf('\t');
    const [, type, oid] = entry.slice(0, tab).split(' ');
    if (type !== 'blob' || oid === undefined) continue;
    tipFiles += 1;
    const list = tipByOid.get(oid) ?? [];
    list.push(entry.slice(tab + 1));
    tipByOid.set(oid, list);
  }

  // Y — every reachable blob, deduplicated by id, with the first path it was seen at.
  const objects = git(repo, ['rev-list', '--all', '--objects']);
  const checked = git(
    repo,
    ['cat-file', '--batch-check=%(objecttype) %(objectname) %(rest)'],
    objects,
  );
  const historyPath = new Map<string, string>();
  for (const line of checked.split('\n')) {
    if (!line.startsWith('blob ')) continue;
    const rest = line.slice(5);
    const space = rest.indexOf(' ');
    const oid = space === -1 ? rest : rest.slice(0, space);
    const path = space === -1 ? '' : rest.slice(space + 1);
    if (!historyPath.has(oid)) historyPath.set(oid, path);
  }

  const yHits: { oid: string; path: string; hits: Hit[] }[] = [];
  let textBlobs = 0;
  let binaryBlobs = 0;
  await streamBlobs(repo, [...historyPath.keys()], (oid, data) => {
    if (isBinary(data)) {
      binaryBlobs += 1;
      return;
    }
    textBlobs += 1;
    const text = data.toString('utf8');
    const content = detectContent(text, ctx);
    const path = historyPath.get(oid) ?? '';
    const y = detectForPath(path, text, 'Y', ctx, content);
    if (y.length > 0) yHits.push({ oid, path, hits: y });
    for (const tipPath of tipByOid.get(oid) ?? []) {
      const t = detectForPath(tipPath, text, 'T', ctx, content);
      pushGrouped(findings, 'T', tipPath, t, {});
    }
  });
  const commitsOf = blobCommits(repo, new Set(yHits.map((h) => h.oid)));
  for (const { oid, path, hits } of yHits) {
    const commits = commitsOf.get(oid) ?? { introduced: null, removed: null };
    pushGrouped(findings, 'Y', path, hits, {
      introduced: commits.introduced,
      removed: tipByOid.has(oid) ? null : commits.removed,
    });
  }

  // Y — every commit message.
  let commits = 0;
  for (const block of git(repo, ['log', '--all', '-z', '--format=%H%n%B']).split('\0')) {
    if (block === '') continue;
    const newline = block.indexOf('\n');
    const sha = newline === -1 ? block : block.slice(0, newline);
    const message = newline === -1 ? '' : block.slice(newline + 1);
    commits += 1;
    const hits = detectForPath('commit-message', message, 'Y', ctx);
    pushGrouped(findings, 'Y', 'commit-message', hits, { introduced: sha, removed: null });
  }

  // K — the tarballs.
  let tarballFiles = 0;
  let tarballs = 0;
  const kDir = join(workDir, 'tarballs');
  const kRoots: { root: string; memberDir: string }[] = [];
  if (options.tarballs === null) {
    for (const klass of CLASS_ORDER) {
      if (CLASS_SURFACES[klass].K !== undefined) {
        notScanned.set(`${klass}/K`, 'no tarballs: pass --pack or --tarballs <dir>');
      }
    }
  } else {
    rmSync(kDir, { recursive: true, force: true });
    for (const [index, input] of options.tarballs.entries()) {
      const root = join(kDir, String(index));
      mkdirSync(root, { recursive: true });
      execFileSync('tar', ['-xzf', input.tarball, '-C', root]);
      tarballs += 1;
      const packageRoot = join(root, 'package');
      const files = existsSync(packageRoot) ? walkFiles(packageRoot) : [];
      const memberDir = input.memberDir ?? `tarball:${basename(input.tarball)}`;
      kRoots.push({ root: packageRoot, memberDir });
      if (!files.some((f) => /^LICEN[CS]E/i.test(f))) {
        findings.push({
          surface: 'K',
          klass: 'L',
          rule: 'tarball-without-licence',
          path: `${memberDir}/`,
          lines: [0],
          method: 'patterns',
        });
      }
      for (const file of files) {
        tarballFiles += 1;
        const data = readFileSync(join(packageRoot, file));
        if (isBinary(data)) continue;
        const path = `${memberDir}/${file}`;
        pushGrouped(findings, 'K', path, detectForPath(path, data.toString('utf8'), 'K', ctx), {});
      }
    }
  }

  if (ctx.paidIds.length === 0) {
    for (const surface of SURFACE_ORDER) {
      if (CLASS_SURFACES['C4-partition'][surface] !== undefined) {
        notScanned.set(`C4-partition/${surface}`, `no paid-id population (\`${PAID_ID_RECORD}\` or --paid-ids)`);
      }
    }
  }

  // S — the scanner.
  let scannerLine: string;
  if (options.scanner === null) {
    const reason = options.scannerAbsentReason ?? 'the secret scanner was not requested';
    scannerLine = `not scanned: ${reason}`;
    for (const surface of SURFACE_ORDER) {
      if (!notScanned.has(`S/${surface}`)) notScanned.set(`S/${surface}`, `scanner: ${reason}`);
    }
  } else {
    const scanner = { ...options.scanner, workDir };
    const ran: string[] = [];
    const y = runGitleaks(scanner, [[resolve(repo), '/repo']], 'git', '/repo', 'y.json');
    if (y.ok) {
      ran.push('Y');
      for (const loc of y.locations) {
        findings.push({
          surface: 'Y',
          klass: 'S',
          rule: `gitleaks:${loc.rule}`,
          path: loc.path,
          lines: [loc.line],
          introduced: loc.commit,
          removed: null,
          method: 'scanner',
        });
      }
    } else notScanned.set('S/Y', `scanner: ${y.reason}`);

    const tipDir = join(workDir, 'tip');
    rmSync(tipDir, { recursive: true, force: true });
    mkdirSync(tipDir, { recursive: true });
    const tipTar = join(workDir, 'tip.tar');
    git(repo, ['archive', '--format=tar', '-o', tipTar, 'HEAD']);
    execFileSync('tar', ['-xf', tipTar, '-C', tipDir]);
    rmSync(tipTar, { force: true });
    const t = runGitleaks(scanner, [[tipDir, '/tip']], 'dir', '/tip', 't.json');
    if (t.ok) {
      ran.push('T');
      for (const loc of t.locations) {
        findings.push({
          surface: 'T',
          klass: 'S',
          rule: `gitleaks:${loc.rule}`,
          path: loc.path.replace(/^\/?tip\//, ''),
          lines: [loc.line],
          method: 'scanner',
        });
      }
    } else notScanned.set('S/T', `scanner: ${t.reason}`);
    rmSync(tipDir, { recursive: true, force: true });

    if (options.tarballs !== null) {
      const k = runGitleaks(scanner, [[kDir, '/k']], 'dir', '/k', 'k.json');
      if (k.ok) {
        ran.push('K');
        for (const loc of k.locations) {
          const inner = loc.path.replace(/^\/?k\//, '');
          const match = /^(\d+)\/package\/(.*)$/.exec(inner);
          const member = match === null ? null : kRoots[Number(match[1])];
          findings.push({
            surface: 'K',
            klass: 'S',
            rule: `gitleaks:${loc.rule}`,
            path: member == null ? inner : `${member.memberDir}/${match![2]!}`,
            lines: [loc.line],
            method: 'scanner',
          });
        }
      } else notScanned.set('S/K', `scanner: ${k.reason}`);
    }
    scannerLine = `${scanner.image} ran on ${ran.length === 0 ? 'nothing' : ran.join(', ')}`;
  }

  return {
    repo,
    head,
    sizes: {
      tipFiles,
      blobs: historyPath.size,
      textBlobs,
      binaryBlobs,
      commits,
      tarballs,
      tarballFiles,
      tarballsRequested: options.tarballs !== null,
    },
    paidIds: ctx.paidIds.length,
    internalHosts: ctx.internalHosts.length,
    internalZones: ctx.internalZones.length,
    notScanned,
    scanner: scannerLine,
    findings,
    floor: options.floor ?? null,
  };
}

function pushGrouped(
  findings: Finding[],
  surface: Surface,
  path: string,
  hits: readonly Hit[],
  commits: { introduced?: string | null; removed?: string | null },
): void {
  const groups = new Map<string, { klass: ScanClass; rule: string; lines: number[] }>();
  for (const hit of hits) {
    const key = `${hit.klass} ${hit.rule}`;
    const group = groups.get(key) ?? { klass: hit.klass, rule: hit.rule, lines: [] };
    group.lines.push(hit.line);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    findings.push({ surface, path, ...group, ...commits, method: 'patterns' });
  }
}

// --- the verdict and the report ---------------------------------------------

/** Exit 2's reason, or `null`: an empty walk, or one below the filter's own population. */
export function vacuousScanReason(
  sizes: Pick<ScanSizes, 'tipFiles' | 'blobs' | 'commits' | 'tarballs' | 'tarballsRequested'>,
  floor: FilterFloor | null,
): string | null {
  if (sizes.tipFiles === 0) return 'the tip holds no file, so there is nothing the scan read at T';
  if (sizes.blobs === 0) return 'the history holds no blob, so there is nothing the scan read at Y';
  if (sizes.commits === 0) return 'no commit message was read at Y';
  if (sizes.tarballsRequested && sizes.tarballs === 0) {
    return 'tarballs were asked for and no tarball was read at K';
  }
  if (floor !== null) {
    if (sizes.tipFiles < floor.keptFiles) {
      return `the tip read ${sizes.tipFiles} files and the filter's report printed ${floor.keptFiles}`;
    }
    if (sizes.commits < floor.survivingCommits) {
      return `the walk read ${sizes.commits} commits and the filter's report printed ${floor.survivingCommits}`;
    }
  }
  return null;
}

type FindingMode = 'finding' | 'located' | 'reported';

function modeOf(f: Finding): FindingMode {
  if (CLASS_SURFACES[f.klass][f.surface] === 'reported') return 'reported';
  if (LOCATOR_CLASSES.has(f.klass)) return 'located';
  return 'finding';
}

export interface Verdict {
  readonly findings: number;
  readonly located: number;
  readonly reported: number;
  readonly notScanned: number;
  readonly status: 'clean' | 'findings' | 'incomplete';
}

export function verdictOf(report: ScanReport): Verdict {
  let findings = 0;
  let located = 0;
  let reported = 0;
  for (const f of report.findings) {
    const mode = modeOf(f);
    if (mode === 'finding') findings += 1;
    else if (mode === 'located') located += 1;
    else reported += 1;
  }
  const notScanned = report.notScanned.size;
  const status = notScanned > 0 ? 'incomplete' : findings > 0 ? 'findings' : 'clean';
  return { findings, located, reported, notScanned, status };
}

const short = (sha: string | null | undefined): string => (sha == null ? '-' : sha.slice(0, 12));

/** One finding as a line. Paths, classes, rules, line numbers and commits — nothing else. */
export function formatFinding(f: Finding): string {
  const lines = f.lines.filter((l) => l > 0);
  const where =
    lines.length === 0
      ? ''
      : `:${lines.slice(0, 5).join(',')}${lines.length > 5 ? `,…(+${lines.length - 5})` : ''}`;
  const commits =
    f.surface === 'Y'
      ? f.path === 'commit-message'
        ? ` commit=${short(f.introduced)}`
        : ` introduced=${short(f.introduced)} removed=${f.removed === null ? 'at-tip-or-unknown' : short(f.removed)}`
      : '';
  return `${f.surface} ${f.klass} ${modeOf(f)} ${f.rule} ${f.path}${where}${commits}`;
}

/** The report: header, one row per class per surface, top paths, verdict. */
export function formatScanReport(report: ScanReport, options: { top?: number } = {}): string[] {
  const top = options.top ?? 10;
  const out: string[] = [];
  const p = (s: string): number => out.push(s);
  const s = report.sizes;
  p(`${PREFIX} repo=${report.repo} head=${report.head}`);
  p(
    `${PREFIX} read: tip-files=${s.tipFiles} distinct-blobs=${s.blobs} text-blobs=${s.textBlobs} ` +
      `binary-blobs=${s.binaryBlobs} commits=${s.commits} tarballs=${s.tarballs} ` +
      `tarball-files=${s.tarballFiles}`,
  );
  p(
    `${PREFIX} floor: ${
      report.floor === null
        ? "none — no filter report beside the repository (a rehearsal over a repository the filter did not write)"
        : `filter printed files=${report.floor.keptFiles} commits=${report.floor.survivingCommits}`
    }`,
  );
  p(
    `${PREFIX} inputs: paid-ids=${report.paidIds} internal-hosts=${report.internalHosts} ` +
      `internal-zones=${report.internalZones} (values not printed)`,
  );
  p(`${PREFIX} secret scanner: ${report.scanner}`);
  p(`${PREFIX} no matched value is printed anywhere in this report (FR-002).`);
  p('');
  p('class         surface  status          locations  sites');
  for (const klass of CLASS_ORDER) {
    for (const surface of SURFACE_ORDER) {
      const mode = CLASS_SURFACES[klass][surface];
      if (mode === undefined) continue;
      const cell = report.findings.filter((f) => f.klass === klass && f.surface === surface);
      const sites = cell.reduce((sum, f) => sum + f.lines.length, 0);
      const reason = report.notScanned.get(`${klass}/${surface}`);
      const status =
        reason !== undefined
          ? `not scanned (${reason})${cell.length > 0 ? ' — patterns only:' : ''}`
          : mode === 'reported'
            ? 'reported'
            : LOCATOR_CLASSES.has(klass)
              ? 'located'
              : 'scanned';
      const counts = reason !== undefined && cell.length === 0 ? '' : ` ${cell.length} ${sites}`;
      p(`${klass.padEnd(13)} ${surface.padEnd(8)} ${status}${counts}`);
    }
  }
  p('');
  p(`${PREFIX} top paths per class and surface (at most ${top}; locations, sites):`);
  for (const klass of CLASS_ORDER) {
    for (const surface of SURFACE_ORDER) {
      const cell = report.findings.filter((f) => f.klass === klass && f.surface === surface);
      if (cell.length === 0) continue;
      const byPath = new Map<string, { locations: number; sites: number }>();
      for (const f of cell) {
        const entry = byPath.get(f.path) ?? { locations: 0, sites: 0 };
        entry.locations += 1;
        entry.sites += f.lines.length;
        byPath.set(f.path, entry);
      }
      const ranked = [...byPath].sort((a, b) => b[1].sites - a[1].sites || a[0].localeCompare(b[0]));
      p(`  ${klass}/${surface}: ${byPath.size} path(s)`);
      for (const [path, n] of ranked.slice(0, top)) p(`    ${path} (${n.locations}, ${n.sites})`);
    }
  }
  const y = report.findings.filter((f) => f.surface === 'Y' && f.klass === 'S' && f.path !== 'commit-message');
  if (y.length > 0) {
    p(`${PREFIX} S in history — revoke at the issuer first (FR-004):`);
    for (const f of y.slice(0, 50)) p(`  ${formatFinding(f)}`);
  }
  const v = verdictOf(report);
  p('');
  p(
    `${PREFIX} verdict: ${v.status} — findings=${v.findings} located-for-review=${v.located} ` +
      `reported=${v.reported} cells-not-scanned=${v.notScanned}`,
  );
  return out;
}

// --- the CLI ----------------------------------------------------------------

function valuesOf(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  argv.forEach((arg, i) => {
    if (arg === flag && argv[i + 1] !== undefined) values.push(argv[i + 1]!);
  });
  return values;
}

function refuse(message: string): never {
  console.error(`${PREFIX} ${message}`);
  process.exit(2);
}

function readFloor(repo: string): FilterFloor | null {
  const path = join(repo, '..', 'report.json');
  if (!existsSync(path)) return null;
  const report = JSON.parse(readFileSync(path, 'utf8')) as {
    keptFiles?: number;
    sizes?: { survivingCommits?: number };
  };
  return {
    keptFiles: report.keptFiles ?? 0,
    survivingCommits: report.sizes?.survivingCommits ?? 0,
  };
}

/** `pnpm pack` for every publishable member of this checkout. */
function packPublishable(outDir: string): TarballInput[] {
  const { members } = classifyWorkspaceMembers(REPO_ROOT, nodeWorkspaceFs());
  const publishable = members.filter((m) => m.family && m.manifest['private'] !== true);
  if (publishable.length === 0) refuse('no publishable workspace member, so K has no population');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const inputs: TarballInput[] = [];
  for (const member of publishable) {
    const before = new Set(readdirSync(outDir));
    const result = spawnSync('pnpm', ['pack', '--pack-destination', outDir], {
      cwd: member.dir,
      encoding: 'utf8',
    });
    const produced = readdirSync(outDir).filter((name) => !before.has(name));
    if (result.status !== 0 || produced.length !== 1) {
      refuse(`\`pnpm pack\` in ${relative(REPO_ROOT, member.dir)} produced ${produced.length} tarball(s)`);
    }
    inputs.push({ tarball: join(outDir, produced[0]!), memberDir: relative(REPO_ROOT, member.dir) });
  }
  return inputs;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const rehearsal = argv.includes('--rehearsal');
  const gitDir = git(REPO_ROOT, ['rev-parse', '--absolute-git-dir']).trim();
  const defaultRepo = join(gitDir, 'endora-public-history', 'projection');
  const repo = resolve(valuesOf(argv, '--repo')[0] ?? defaultRepo);
  if (!existsSync(repo)) {
    refuse(
      `no repository at ${repo}. The scan reads the filter's projection: run ` +
        '`pnpm --filter backend run history:filter` first, or pass --repo',
    );
  }
  const out = resolve(valuesOf(argv, '--out')[0] ?? join(repo, '..', 'scan'));
  mkdirSync(out, { recursive: true });

  const paidFlag = valuesOf(argv, '--paid-ids')[0];
  const recordPath = join(REPO_ROOT, PAID_ID_RECORD);
  const paidIds =
    paidFlag !== undefined
      ? paidFlag.split(',').map((id) => id.trim()).filter((id) => id !== '')
      : existsSync(recordPath)
        ? parsePaidIds(readFileSync(recordPath, 'utf8'))
        : [];
  const ctx: ScanContext = {
    paidIds,
    internalHosts: DEFAULT_INTERNAL_HOSTS,
    internalZones: valuesOf(argv, '--internal-zone'),
  };

  let tarballs: TarballInput[] | null = null;
  if (argv.includes('--pack')) {
    console.error(`${PREFIX} packing every publishable member of ${REPO_ROOT}`);
    tarballs = packPublishable(join(out, 'packed'));
  } else {
    const dir = valuesOf(argv, '--tarballs')[0];
    if (dir !== undefined) {
      tarballs = readdirSync(dir)
        .filter((name) => name.endsWith('.tgz'))
        .map((name) => ({ tarball: join(dir, name), memberDir: null }));
    }
  }

  const runtime = process.env['ENDORA_CONTAINER_RUNTIME'] ?? 'docker';
  const image = process.env['ENDORA_GITLEAKS_IMAGE'] ?? GITLEAKS_IMAGE;
  let scanner: ScannerOptions | null = null;
  let scannerAbsentReason: string | undefined;
  if (argv.includes('--no-scanner')) scannerAbsentReason = 'disabled by --no-scanner';
  else {
    scannerAbsentReason = containerRuntimeReason(runtime) ?? undefined;
    if (scannerAbsentReason === undefined) scanner = { runtime, image, workDir: out };
  }

  const floor = readFloor(repo);
  if (floor === null && repo === defaultRepo) {
    refuse(`the filter's report.json is missing beside ${repo}, so the walk has no floor`);
  }
  console.error(`${PREFIX} scanning ${repo} (this reads every reachable blob; it takes minutes)`);
  const report = await runScan({
    repo,
    ctx,
    scanner,
    ...(scannerAbsentReason === undefined ? {} : { scannerAbsentReason }),
    tarballs,
    workDir: out,
    floor,
  });

  const lines = formatScanReport(report);
  for (const line of lines) console.log(line);
  writeFileSync(join(out, 'scan-report.txt'), `${lines.join('\n')}\n`, 'utf8');
  writeFileSync(
    join(out, 'scan-findings.txt'),
    `${report.findings.map(formatFinding).join('\n')}\n`,
    'utf8',
  );
  rmSync(join(out, 'tarballs'), { recursive: true, force: true });
  console.log(`${PREFIX} full list: ${join(out, 'scan-findings.txt')}`);

  const vacuous = vacuousScanReason(report.sizes, floor);
  if (vacuous !== null) refuse(`refusing a vacuous run: ${vacuous}`);
  const verdict = verdictOf(report);
  if (verdict.status === 'incomplete' && !rehearsal) {
    refuse(`${verdict.notScanned} cell(s) not scanned; a rehearsal passes --rehearsal`);
  }
  process.exit(verdict.findings > 0 ? 1 : 0);
}

// Run as CLI only — importing this module from a unit test must not scan anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`${PREFIX} failed: ${(error as Error).message}`);
    process.exit(2);
  });
}
