/**
 * The one-time pre-publication scan — what it finds, where it says it found it,
 * and the one property everything else is subordinate to: **it never prints a
 * matched value** (`specs/136-open-source-publication/` GAP-1, FR-001 … FR-004;
 * `contracts/pre-publication-scan.md`).
 *
 * ## Why every fixture value below is assembled at run time
 *
 * This file is public, and the scan it tests reads the public tip. A literal
 * credential shape, a personal address or a C2 vocabulary term written here
 * would be a finding in the report this file exists to keep honest — and a
 * credential shape would also trip every upstream secret scanner the public
 * repository is pushed past. So each synthetic value is joined from parts, and
 * the assertions are made against the joined value: the report is searched for
 * the very string the fixture planted, which is the only way *"never the
 * matched value"* is a measurement rather than a promise.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CLASS_SURFACES,
  detectContent,
  detectForPath,
  formatFinding,
  formatScanReport,
  formatStaleReview,
  gitleaksArguments,
  isLicenceFileName,
  isPersonalEmail,
  parseGitleaksReport,
  parsePaidIds,
  parseReviewedRecord,
  reviewedCandidates,
  reviewedRecordInsideRepo,
  type ReviewedRecord,
  runScan,
  type ScanContext,
  scanExitCode,
  type ScanReport,
  type TarballInput,
  vacuousScanReason,
  verdictOf,
  validNip,
  validPesel,
} from '../../../scripts/pre-publication-scan.js';

const j = (...parts: string[]): string => parts.join('');

/** A GitLab personal access token shape, invented. */
const FAKE_GITLAB_TOKEN = j('gl', 'pat-', 'Zq7Rk2'.repeat(4));
/** An npm automation token shape, invented. */
const FAKE_NPM_TOKEN = j('np', 'm_', 'A1b2C3d4E5'.repeat(3), 'F6g7H8');
/** A personal address at an invented, non-reserved domain. */
const FAKE_PERSON = j('jan.kowal', 'ski', '@', 'firma-realna', '.pl');
/** An internal host this scan is configured with, at run time. */
const INTERNAL_HOST = j('git', '.internal-corp', '.example');
/** A private address with a port. */
const PRIVATE_ADDRESS = j('192.', '168.', '12.', '7', ':', '5432');
/** A C2 term the vocabulary knows. */
const C2_WORD = j('pi', 'lot');
const STATUS_PHRASE = j('pa', 'id mod', 'ule');

const CTX: ScanContext = {
  paidIds: ['acme_pay'],
  internalHosts: [INTERNAL_HOST],
  internalZones: [],
};

function everyValue(): string[] {
  return [FAKE_GITLAB_TOKEN, FAKE_NPM_TOKEN, FAKE_PERSON, INTERNAL_HOST, PRIVATE_ADDRESS];
}

describe('content detection names a class, a rule and a line — and carries no text', () => {
  const text = [
    'first line',
    `token = "${FAKE_GITLAB_TOKEN}"`,
    `NPM_TOKEN=${FAKE_NPM_TOKEN}`,
    `contact: ${FAKE_PERSON}`,
    `registry: https://${INTERNAL_HOST}/api`,
    `db: ${PRIVATE_ADDRESS}`,
    `our first ${C2_WORD} customer`,
  ].join('\n');

  it('finds each planted class on its own line', () => {
    const hits = detectContent(text, CTX);
    const by = (klass: string) => hits.filter((h) => h.klass === klass);
    expect(by('S').map((h) => [h.rule, h.line])).toEqual(
      expect.arrayContaining([
        ['gitlab-token', 2],
        ['npm-token', 3],
      ]),
    );
    expect(by('P').map((h) => [h.rule, h.line])).toEqual([['email', 4]]);
    expect(by('H').map((h) => [h.rule, h.line]).sort()).toEqual([
      ['internal-host', 5],
      ['private-address', 6],
    ]);
    expect(by('C2').map((h) => h.line)).toEqual([7]);
  });

  it('holds no matched value anywhere in what it returns', () => {
    const serialised = JSON.stringify(detectContent(text, CTX));
    for (const value of everyValue()) expect(serialised).not.toContain(value);
    // The vocabulary's rule id *is* its term, and that is a rule, not a value;
    // the sentence it matched is what must not travel.
    expect(serialised).not.toContain(`first ${C2_WORD}`);
  });

  it('does not take an environment reference for a credential', () => {
    const hits = detectContent(
      [
        '//registry/:_authToken=${ENDORA_NPM_TOKEN}',
        'ENDORA_NPM_TOKEN: $CI_JOB_TOKEN',
        // The same reference, escaped inside a template literal in source.
        'lines.push(`//registry/:_authToken=\\${${TOKEN_VARIABLE}}`);',
      ].join('\n'),
      CTX,
    );
    expect(hits.filter((h) => h.klass === 'S')).toEqual([]);
  });

  it('takes a literal value assigned to the registry token for one', () => {
    const literal = j('ENDORA_NPM', '_TOKEN=', 'q'.repeat(8), 'W3'.repeat(6));
    const hits = detectContent(literal, CTX);
    expect(hits.filter((h) => h.klass === 'S').map((h) => h.rule)).toContain('endora-npm-token');
    expect(JSON.stringify(hits)).not.toContain(literal);
  });
});

describe('personal data: an address is personal unless it is reserved or a role', () => {
  it('lets reserved and example domains through', () => {
    for (const domain of ['example.com', 'shop.example.org', 'x.test', 'acme.example', 'a.invalid', 'b.localhost']) {
      expect(isPersonalEmail(j('someone', '@', domain))).toBe(false);
    }
  });

  it('lets a role address through, whatever the domain', () => {
    expect(isPersonalEmail(j('no', 'reply', '@', 'vendor-real', '.com'))).toBe(false);
    expect(isPersonalEmail(j('secu', 'rity', '@', 'vendor-real', '.com'))).toBe(false);
  });

  it('reports a person at a real-looking domain', () => {
    expect(isPersonalEmail(FAKE_PERSON)).toBe(true);
  });

  it('does not read a package specifier with a version as an address', () => {
    const hits = detectContent('"@endora-commerce/platform@0.100.0-rc.alpha"', CTX);
    expect(hits.filter((h) => h.klass === 'P')).toEqual([]);
  });

  it('validates national identifiers by checksum, and only beside their name', () => {
    // The published specimen number, whose checksum is valid by construction.
    const validOne = [j('440514', '01359')].find(validPesel);
    expect(validOne).toBeDefined();
    expect(validPesel('44051401358')).toBe(false);
    expect(validNip('1234563218')).toBe(true);
    expect(validNip('1234563219')).toBe(false);
    const beside = detectContent(`pesel: "${validOne!}"`, CTX).filter((h) => h.klass === 'P');
    expect(beside.map((h) => h.rule)).toEqual(['pesel']);
    const alone = detectContent(`timestamp: ${validOne!}`, CTX).filter((h) => h.klass === 'P');
    expect(alone).toEqual([]);
  });
});

describe('C4 partition: the locator, not a verdict', () => {
  it('locates a status phrase within ten lines of a paid id', () => {
    const text = ['// acme-pay adapter', '', `// this is a ${STATUS_PHRASE}`].join('\n');
    const hits = detectContent(text, CTX).filter((h) => h.klass === 'C4-partition');
    expect(hits.map((h) => h.line)).toEqual([3]);
  });

  it('does not locate one further away than the window', () => {
    const text = ['acme_pay', ...Array.from({ length: 12 }, () => ''), STATUS_PHRASE].join('\n');
    expect(detectContent(text, CTX).filter((h) => h.klass === 'C4-partition')).toEqual([]);
  });

  it('is not scanned inside the paid module package itself', () => {
    const text = `acme_pay is a ${STATUS_PHRASE}`;
    const inside = detectForPath('packages/modules/acme_pay/README.md', text, 'T', CTX);
    expect(inside.filter((h) => h.klass === 'C4-partition')).toEqual([]);
    const outside = detectForPath('packages/modules/orders/README.md', text, 'T', CTX);
    expect(outside.filter((h) => h.klass === 'C4-partition')).toHaveLength(1);
  });

  it('reads the paid-id population from its record, and only from a fenced block', () => {
    const record = ['intro', '**The fifteen.** Final', '', '```', 'acme_pay  beta-ship', '```', 'after'].join('\n');
    expect(parsePaidIds(record)).toEqual(['acme_pay', 'beta-ship']);
    expect(parsePaidIds('no record here')).toEqual([]);
  });
});

describe('path-dependent classes: L, R and the hand-review population', () => {
  it('reports a non-MIT package licence and a SEE LICENSE IN declaration', () => {
    const hits = detectForPath(
      'packages/modules/x/package.json',
      JSON.stringify({ name: '@s/x', license: 'SEE LICENSE IN LICENSE.md' }),
      'T',
      CTX,
    );
    expect(hits.filter((h) => h.klass === 'L').map((h) => h.rule)).toEqual(['see-licence-in']);
    const mit = detectForPath('packages/x/package.json', JSON.stringify({ license: 'MIT' }), 'T', CTX);
    expect(mit.filter((h) => h.klass === 'L')).toEqual([]);
  });

  it('reports a LICENSE file whose text is not the MIT licence', () => {
    const hits = detectForPath('packages/x/LICENSE', 'All rights reserved.', 'T', CTX);
    expect(hits.filter((h) => h.klass === 'L').map((h) => h.rule)).toEqual(['non-mit-licence-file']);
    const mit = detectForPath(
      'LICENSE',
      'MIT License\n\nPermission is hereby granted, free of charge, to any person',
      'T',
      CTX,
    );
    expect(mit.filter((h) => h.klass === 'L')).toEqual([]);
  });

  // D-276: the L predicate reads a file name the way GitHub's detector does.
  describe('a licence file is any name licensee scores above zero (D-276)', () => {
    const NOT_MIT = 'This document explains how the project is distributed.\n';
    const lRules = (path: string, text: string) =>
      detectForPath(path, text, 'T', CTX)
        .filter((h) => h.klass === 'L')
        .map((h) => h.rule);

    it('reports LICENSE-COMMERCIAL.md with non-MIT text, and not LICENSING.md', () => {
      expect(lRules('LICENSE-COMMERCIAL.md', NOT_MIT)).toEqual(['non-mit-licence-file']);
      expect(lRules('LICENSING.md', NOT_MIT)).toEqual([]);
    });

    it('reports MIT-LICENSE and COPYING with non-MIT text', () => {
      expect(lRules('MIT-LICENSE', NOT_MIT)).toEqual(['non-mit-licence-file']);
      expect(lRules('COPYING', NOT_MIT)).toEqual(['non-mit-licence-file']);
    });

    it('does not report a COPYRIGHT file holding only a copyright line', () => {
      expect(lRules('COPYRIGHT', 'Copyright (c) 2026 Example Maintainers\n')).toEqual([]);
      expect(
        lRules('COPYRIGHT', 'Copyright (c) 2026 Example Maintainers\n\nAll rights reserved by contract.\n'),
      ).toEqual(['non-mit-licence-file']);
    });

    it('does not report LICENSE with MIT text', () => {
      expect(
        lRules('LICENSE', 'MIT License\n\nPermission is hereby granted, free of charge, to any person'),
      ).toEqual([]);
    });

    it('scores the names licensee scores, and nothing else', () => {
      const scored = [
        'LICENSE', 'LICENCE', 'UNLICENSE', 'license.txt', 'LICENSE.textile', 'LICENSE-MIT',
        'LICENSE_APACHE.md', 'COPYING', 'COPYING.md', 'COPYING.lesser', 'COPYING-GPL', 'MIT-COPYING',
        'MIT-LICENSE', 'OFL', 'OFL.md', 'OFL.textile', 'COPYRIGHT', 'COPYRIGHT.txt', 'COPYRIGHT-MIT',
        'PATENTS', 'PATENTS.txt',
      ];
      const unscored = [
        'LICENSING.md', 'LICENSE.spdx', 'README.md', 'CONTRIBUTING.md', 'licence-hits.test.ts', 'PATENTS.sh',
      ];
      expect(scored.filter((n) => !isLicenceFileName(n))).toEqual([]);
      expect(unscored.filter((n) => isLicenceFileName(n))).toEqual([]);
    });
  });

  it('reports a link into specs/NNN in a shipped document and not in code', () => {
    const link = '[the plan](../../specs/123-some-feature/plan.md)';
    expect(detectForPath('docs/docs/a.md', link, 'T', CTX).filter((h) => h.klass === 'R')).toHaveLength(1);
    expect(
      detectForPath('packages/x/README.md', link, 'T', CTX).filter((h) => h.klass === 'R'),
    ).toHaveLength(1);
    expect(
      detectForPath('backend/src/x.ts', `// ${link}`, 'T', CTX).filter((h) => h.klass === 'R'),
    ).toEqual([]);
  });

  it('reports the self-describing slug in a shipped document and not in code', () => {
    const slug = j('specs/134-', 'paid-module', '-extraction/');
    expect(
      detectForPath('packages/x/CHANGELOG.md', `see ${slug}`, 'T', CTX).map((h) => h.rule),
    ).toContain('extraction-slug');
    expect(detectForPath('backend/src/x.ts', `// see ${slug}`, 'T', CTX).filter((h) => h.klass === 'R')).toEqual([]);
  });

  it('keeps each class to the surfaces the contract gives it', () => {
    const shipped = detectForPath(
      'docs/docs/a.md',
      `[x](specs/001-a/spec.md) https://${INTERNAL_HOST}/`,
      'Y',
      CTX,
    );
    // R and L are T and K only; H in history is reported, not redacted.
    expect(shipped.filter((h) => h.klass === 'R')).toEqual([]);
    expect(CLASS_SURFACES['H']).toEqual({ T: 'scanned', Y: 'reported', K: 'scanned' });
    expect(CLASS_SURFACES['C4-other']).toEqual({ T: 'scanned' });
  });
});

describe('the secret scanner: its output is parsed for location only', () => {
  it('drops the secret and the match even when the scanner did not redact them', () => {
    const raw = JSON.stringify([
      {
        RuleID: 'gitlab-pat',
        File: 'config/old.env',
        Commit: 'a'.repeat(40),
        StartLine: 3,
        Secret: FAKE_GITLAB_TOKEN,
        Match: `token=${FAKE_GITLAB_TOKEN}`,
        Author: 'Somebody',
        Email: FAKE_PERSON,
        Message: `a message carrying ${FAKE_GITLAB_TOKEN}`,
      },
    ]);
    const parsed = parseGitleaksReport(raw);
    expect(parsed).toEqual([
      { rule: 'gitlab-pat', path: 'config/old.env', commit: 'a'.repeat(40), line: 3 },
    ]);
    expect(JSON.stringify(parsed)).not.toContain(FAKE_GITLAB_TOKEN);
    expect(JSON.stringify(parsed)).not.toContain(FAKE_PERSON);
  });

  it('asks the scanner to redact and to ignore in-tree allow comments', () => {
    const args = gitleaksArguments({ mode: 'git', target: '/repo', report: '/out/y.json' });
    expect(args).toEqual(expect.arrayContaining(['git', '--redact', '--ignore-gitleaks-allow']));
    expect(args.join(' ')).toContain('--log-opts=--all');
    const dir = gitleaksArguments({ mode: 'dir', target: '/tip', report: '/out/t.json' });
    expect(dir[0]).toBe('dir');
  });
});

describe('the walk refuses to be vacuous', () => {
  const sizes = { tipFiles: 10, blobs: 40, commits: 5, tarballs: 0, tarballsRequested: false };

  it('refuses a zero anywhere it read', () => {
    expect(vacuousScanReason({ ...sizes, tipFiles: 0 }, null)).toMatch(/tip/);
    expect(vacuousScanReason({ ...sizes, commits: 0 }, null)).toMatch(/commit/);
    expect(vacuousScanReason({ ...sizes, tarballsRequested: true }, null)).toMatch(/tarball/);
    expect(vacuousScanReason(sizes, null)).toBeNull();
  });

  it("refuses a walk below the filter report's own population", () => {
    expect(vacuousScanReason(sizes, { keptFiles: 11, survivingCommits: 5 })).toMatch(/11/);
    expect(vacuousScanReason(sizes, { keptFiles: 10, survivingCommits: 6 })).toMatch(/6/);
    expect(vacuousScanReason(sizes, { keptFiles: 10, survivingCommits: 5 })).toBeNull();
  });
});

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'endora-pre-publication-scan-'));
  created.push(dir);
  return dir;
}

interface Fixture {
  root: string;
  git: (args: string[]) => string;
  write: (p: string, c: string) => void;
  commit: (message: string) => string;
  blob: (path: string) => string;
}

function fixture(): Fixture {
  const root = scratch();
  const git = (args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', root], { stdio: 'ignore' });
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'commit.gpgsign', 'false']);
  const write = (path: string, content: string): void => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  };
  const commit = (message: string): string => {
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', message]);
    return git(['rev-parse', 'HEAD']).trim();
  };
  const blob = (path: string): string => git(['rev-parse', `HEAD:${path}`]).trim();
  return { root, git, write, commit, blob };
}

describe('a fixture history — a key in a blob deleted before the tip (spec §10 scenario 2)', () => {
  it('reports the path, the class and the commits, and never the key or the address', async () => {
    const f = fixture();
    f.write('README.md', '# fixture\n');
    f.write('config/old.env', `REGISTRY_TOKEN=${FAKE_GITLAB_TOKEN}\nOWNER=${FAKE_PERSON}\n`);
    f.git(['add', '-A']);
    f.git(['commit', '--quiet', '-m', 'add configuration']);
    const introduced = f.git(['rev-parse', 'HEAD']).trim();
    unlinkSync(join(f.root, 'config/old.env'));
    f.git(['add', '-A']);
    f.git(['commit', '--quiet', '-m', `remove configuration, it held ${FAKE_NPM_TOKEN}`]);
    const removed = f.git(['rev-parse', 'HEAD']).trim();

    const report = await runScan({ repo: f.root, ctx: CTX, scanner: null, tarballs: null });
    const lines = formatScanReport(report).join('\n');
    const findings = JSON.stringify(report.findings);

    const y = report.findings.filter((x) => x.surface === 'Y' && x.klass === 'S');
    expect(y.map((x) => x.path)).toContain('config/old.env');
    const blob = y.find((x) => x.path === 'config/old.env')!;
    expect(blob.introduced).toBe(introduced);
    expect(blob.removed).toBe(removed);
    // The message is a Y location of its own, attributed to its commit.
    expect(y.some((x) => x.path === 'commit-message' && x.introduced === removed)).toBe(true);
    // The tip no longer carries it.
    expect(report.findings.filter((x) => x.surface === 'T' && x.klass === 'S')).toEqual([]);

    expect(lines).toContain('config/old.env');
    expect(lines).toContain(introduced.slice(0, 12));
    for (const value of everyValue()) {
      expect(lines).not.toContain(value);
      expect(findings).not.toContain(value);
    }
  });

  it('writes a row for every class on every surface the contract gives it, zeros and not-scanned included', async () => {
    const f = fixture();
    f.write('README.md', '# fixture\n');
    f.git(['add', '-A']);
    f.git(['commit', '--quiet', '-m', 'initial']);
    const report = await runScan({ repo: f.root, ctx: CTX, scanner: null, tarballs: null });
    const lines = formatScanReport(report).join('\n');
    for (const [klass, surfaces] of Object.entries(CLASS_SURFACES)) {
      for (const surface of Object.keys(surfaces)) {
        expect(lines).toMatch(new RegExp(`\\b${klass}\\s+${surface}\\b`));
      }
    }
    // No scanner and no tarballs: said, with the reason, and never folded into a zero.
    expect(lines).toMatch(/S\s+Y\s+not scanned/);
    expect(lines).toMatch(/L\s+K\s+not scanned/);
    expect(lines).toMatch(/verdict: incomplete/);
    expect(report.sizes.tipFiles).toBe(1);
    expect(report.sizes.commits).toBe(1);
  });
});

// --- the reviewed-findings record (contract §4, amendment of 2026-09-27) -----

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TSX = join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = join(BACKEND_ROOT, 'scripts', 'pre-publication-scan.ts');
/** The vocabulary's clearance annotation, assembled so this file does not carry one. */
const clearance = (term: string, reason: string): string =>
  j('<!-- commercial', '-data: cleared `', term, '` — ', reason, ' -->');

const CTX_PLAIN: ScanContext = { paidIds: [], internalHosts: [], internalZones: [] };

/** A tip with one planted token on line 2, committed once. */
function tokenFixture(): Fixture & { oid: string } {
  const f = fixture();
  f.write('README.md', '# fixture\n');
  f.write('config/app.env', `# app\nREGISTRY_TOKEN=${FAKE_GITLAB_TOKEN}\n`);
  f.commit('add configuration');
  return { ...f, oid: f.blob('config/app.env') };
}

function sRow(oid: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    class: 'S',
    rule: 'gitlab-token',
    path: 'config/app.env',
    blobs: [oid],
    lines: [2],
    review: 'synthetic',
    reason: 'an invented token planted by this fixture',
    ref: 'T1',
    ...over,
  };
}

function record(rows: readonly Record<string, unknown>[]): ReviewedRecord {
  return parseReviewedRecord(JSON.stringify({ rows }), 'reviewed-findings.json');
}

async function scanWith(
  f: { root: string },
  rows: readonly Record<string, unknown>[] | null,
  extra: { tarballs?: TarballInput[] } = {},
): Promise<ScanReport> {
  return runScan({
    repo: f.root,
    ctx: CTX_PLAIN,
    scanner: null,
    tarballs: extra.tarballs ?? null,
    workDir: scratch(),
    reviewed: rows === null ? null : record(rows),
  });
}

function cli(args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync(TSX, [SCRIPT, ...args], { cwd: BACKEND_ROOT, encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

describe('amendment 1: one record, kept outside the scanned tree', () => {
  it('knows a record inside the repository from one outside it', () => {
    const f = tokenFixture();
    expect(reviewedRecordInsideRepo(join(f.root, 'reviewed.json'), f.root)).toBe(true);
    expect(reviewedRecordInsideRepo(join(f.root, 'nested', 'reviewed.json'), f.root)).toBe(true);
    expect(reviewedRecordInsideRepo(join(scratch(), 'reviewed.json'), f.root)).toBe(false);
  });

  it('exits 2 when --reviewed resolves inside --repo, because the scanned tree must not vouch for itself', () => {
    const f = tokenFixture();
    const inside = join(f.root, 'reviewed.json');
    writeFileSync(inside, JSON.stringify({ rows: [sRow(f.oid)] }), 'utf8');
    const run = cli(['--repo', f.root, '--out', scratch(), '--no-scanner', '--rehearsal', '--reviewed', inside]);
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/inside --repo/);
  });

  it('exits 2 on a record outside the repository that the schema refuses', () => {
    const f = tokenFixture();
    const outside = join(scratch(), 'reviewed.json');
    writeFileSync(outside, JSON.stringify({ rows: [sRow(f.oid, { review: 'looked-fine' })] }), 'utf8');
    const run = cli(['--repo', f.root, '--out', scratch(), '--no-scanner', '--rehearsal', '--reviewed', outside]);
    expect(run.status).toBe(2);
  });
});

describe('amendment 2: keyed by content, never by value', () => {
  it('carries the blob id on every T and Y finding, and prints it', async () => {
    const f = tokenFixture();
    const report = await scanWith(f, null);
    const s = report.findings.filter((x) => x.klass === 'S');
    expect(s.map((x) => [x.surface, x.blob])).toEqual(
      expect.arrayContaining([
        ['T', f.oid],
        ['Y', f.oid],
      ]),
    );
    for (const x of s) expect(formatFinding(x)).toContain(`blob=${f.oid}`);
  });

  it('carries package, version and SHA-256 on every K finding, and prints them', async () => {
    const f = tokenFixture();
    const dir = scratch();
    const body = `export const token = "${FAKE_GITLAB_TOKEN}";\n`;
    mkdirSync(join(dir, 'package'), { recursive: true });
    writeFileSync(join(dir, 'package', 'package.json'), JSON.stringify({ name: '@s/x', version: '1.2.3', license: 'MIT' }));
    writeFileSync(join(dir, 'package', 'LICENSE'), 'Permission is hereby granted, free of charge');
    writeFileSync(join(dir, 'package', 'lib.js'), body);
    const tgz = join(dir, 'x.tgz');
    execFileSync('tar', ['-czf', tgz, '-C', dir, 'package']);
    const report = await scanWith(f, null, { tarballs: [{ tarball: tgz, memberDir: 'packages/x' }] });
    const k = report.findings.find((x) => x.surface === 'K' && x.klass === 'S')!;
    const sha256 = createHash('sha256').update(body).digest('hex');
    expect(k.path).toBe('packages/x/lib.js');
    expect(k.tarballFile).toEqual({ package: '@s/x', version: '1.2.3', sha256 });
    expect(formatFinding(k)).toContain(`tarball=@s/x@1.2.3 sha256=${sha256}`);

    const reviewed = await scanWith(f, [
      {
        class: 'S',
        rule: 'gitlab-token',
        path: 'packages/x/lib.js',
        tarballFiles: [{ package: '@s/x', version: '1.2.3', sha256 }],
        lines: [1],
        review: 'synthetic',
        reason: 'the compiled fixture token',
        ref: 'K1',
      },
      sRow(f.oid),
    ], { tarballs: [{ tarball: tgz, memberDir: 'packages/x' }] });
    expect(reviewed.findings.find((x) => x.surface === 'K' && x.klass === 'S')!.mark).toBe('reviewed');
  });

  it('matches one blob wherever the scan reads it, at the tip and in history', async () => {
    const f = tokenFixture();
    const report = await scanWith(f, [sRow(f.oid)]);
    const s = report.findings.filter((x) => x.klass === 'S');
    expect(s.map((x) => [x.surface, x.mark, x.ref])).toEqual(
      expect.arrayContaining([
        ['T', 'reviewed', 'T1'],
        ['Y', 'reviewed', 'T1'],
      ]),
    );
  });

  it('returns the site as a finding once one byte of the file changes (a new blob)', async () => {
    const f = tokenFixture();
    const reviewedOid = f.oid;
    f.write('config/app.env', `# app!\nREGISTRY_TOKEN=${FAKE_GITLAB_TOKEN}\n`);
    f.commit('touch configuration');
    const report = await scanWith(f, [sRow(reviewedOid)]);
    const tip = report.findings.find((x) => x.surface === 'T' && x.klass === 'S')!;
    expect(tip.blob).not.toBe(reviewedOid);
    expect(tip.mark).toBeUndefined();
    // The old blob is still in history, still reviewed, so the row is not stale.
    const old = report.findings.find((x) => x.surface === 'Y' && x.blob === reviewedOid)!;
    expect(old.mark).toBe('reviewed');
    expect(report.staleReviews).toEqual([]);
    expect(verdictOf(report).findings).toBeGreaterThan(0);
  });

  it('refuses an unknown field in a row and at the top, so no column can hold a value', () => {
    const oid = 'a'.repeat(40);
    expect(() => record([sRow(oid, { match: 'anything' })])).toThrow(/unrecognized|unknown/i);
    expect(() =>
      parseReviewedRecord(JSON.stringify({ rows: [sRow(oid)], values: [] }), 'r.json'),
    ).toThrow(/unrecognized|unknown/i);
  });

  it('refuses a row keyed by neither content nor both', () => {
    const oid = 'a'.repeat(40);
    const { blobs: _blobs, ...unkeyed } = sRow(oid);
    expect(() => record([unkeyed])).toThrow(/blobs|tarballFiles/);
    expect(() =>
      record([sRow(oid, { tarballFiles: [{ package: '@s/x', version: '1.0.0', sha256: 'b'.repeat(64) }] })]),
    ).toThrow(/blobs|tarballFiles/);
    expect(() => record([sRow('not-a-blob-id')])).toThrow();
  });

  it('prints the record name, its SHA-256 and its row count in the header', async () => {
    const f = tokenFixture();
    const raw = JSON.stringify({ rows: [sRow(f.oid)] });
    const parsed = parseReviewedRecord(raw, 'reviewed-findings.json');
    expect(parsed.sha256).toBe(createHash('sha256').update(raw).digest('hex'));
    const report = await runScan({
      repo: f.root,
      ctx: CTX_PLAIN,
      scanner: null,
      tarballs: null,
      workDir: scratch(),
      reviewed: parsed,
    });
    expect(formatScanReport(report).join('\n')).toContain(
      `reviewed record: reviewed-findings.json sha256=${parsed.sha256} rows=1`,
    );
    const none = await scanWith(f, null);
    expect(formatScanReport(none).join('\n')).toMatch(/reviewed record: none/);
  });
});

describe('amendment 3: the rules for each class, inside the one record', () => {
  const oid = 'c'.repeat(40);

  it('admits each class only its own review values', () => {
    expect(() => record([sRow(oid, { review: 'not-a-secret' })])).not.toThrow();
    expect(() => record([sRow(oid, { review: 'not-personal' })])).toThrow(/review/);
    expect(() =>
      record([{ class: 'P', rule: 'email', path: 'a.ts', blobs: [oid], review: 'not-personal', reason: 'a role mailbox' }]),
    ).not.toThrow();
    expect(() =>
      record([{ class: 'P', rule: 'email', path: 'a.ts', blobs: [oid], review: 'not-a-secret', reason: 'a role mailbox' }]),
    ).toThrow(/review/);
    for (const basis of ['§1', 'N1', 'N4', '§4(a)', '§4(c)']) {
      expect(() =>
        record([{ class: 'C2', rule: 'the-client', path: 'a.ts', blobs: [oid], review: basis, reason: 'the software client role' }]),
      ).not.toThrow();
    }
    expect(() =>
      record([{ class: 'C2', rule: 'the-client', path: 'a.ts', blobs: [oid], review: 'synthetic', reason: 'the software client role' }]),
    ).toThrow(/review/);
  });

  it('has no review value that records a real credential, person or disclosure', () => {
    for (const review of ['real', 'real-credential', 'revoked', 'c', '(c)', 'accepted']) {
      expect(() => record([sRow(oid, { review })])).toThrow(/review/);
    }
  });

  it('refuses a reason shorter than eight characters', () => {
    expect(() => record([sRow(oid, { reason: 'fixture' })])).toThrow(/reason/);
    expect(() => record([sRow(oid, { reason: '   fixture   ' })])).toThrow(/reason/);
    expect(() => record([sRow(oid, { reason: 'a fixture' })])).not.toThrow();
  });

  it('refuses a row of H, L, R or C4, which are not recordable', () => {
    for (const klass of ['H', 'L', 'R', 'C4-partition', 'C4-other', 'C4']) {
      expect(() => record([sRow(oid, { class: klass })])).toThrow(/class|recordable/);
    }
  });

  it('refuses an S row without lines, because S is recorded one site at a time', () => {
    const { lines: _lines, ...lineless } = sRow(oid);
    expect(() => record([lineless])).toThrow(/lines/);
  });
});

describe('amendment 4: a reviewed site is counted, never silenced', () => {
  it('keeps the site in its row, marks it reviewed with the ref, and takes it out of findings only', async () => {
    const f = tokenFixture();
    const bare = await scanWith(f, null);
    const report = await scanWith(f, [sRow(f.oid)]);
    const text = formatScanReport(report).join('\n');
    // No scanner here, so the S rows read *not scanned* and carry the pattern counts.
    expect(text).toMatch(/\nS\s+T\s+[^\n]* 1 1 reviewed 1 1\n/);
    expect(text).toMatch(/\nS\s+Y\s+[^\n]* 1 1 reviewed 1 1\n/);
    expect(verdictOf(report).findings).toBe(verdictOf(bare).findings - 2);
    expect(verdictOf(report).reviewed).toBe(2);
    expect(text).toMatch(/reviewed=2 stale-review=0/);
    const line = formatFinding(report.findings.find((x) => x.surface === 'T' && x.klass === 'S')!);
    expect(line).toMatch(/^T S reviewed gitlab-token config\/app\.env:2 /);
    expect(line).toContain('ref=T1');
  });

  it('reviews only the recorded lines of a location and leaves the others findings', async () => {
    const f = fixture();
    f.write('config/two.env', `A=${FAKE_GITLAB_TOKEN}\nB=${FAKE_GITLAB_TOKEN}\n`);
    f.commit('two tokens');
    const oid = f.blob('config/two.env');
    const report = await scanWith(f, [sRow(oid, { path: 'config/two.env', lines: [1] })]);
    const tip = report.findings.filter((x) => x.surface === 'T' && x.klass === 'S');
    expect(tip.map((x) => [x.lines, x.mark ?? 'finding'])).toEqual(
      expect.arrayContaining([
        [[1], 'reviewed'],
        [[2], 'finding'],
      ]),
    );
  });
});

describe('amendment 5: stale rows fail', () => {
  it('lists a row that matches nothing as stale-review and makes the verdict findings', async () => {
    const f = tokenFixture();
    const report = await scanWith(f, [sRow(f.oid), sRow('d'.repeat(40), { ref: 'T2' })]);
    expect(report.staleReviews.map((s) => [s.ref, s.what])).toEqual([['T2', 'row']]);
    expect(verdictOf(report).staleReview).toBe(1);
    expect(formatStaleReview(report.staleReviews[0]!)).toMatch(/^stale-review S gitlab-token config\/app\.env row ref=T2/);
  });

  it('lists an unmatched blob and an unmatched line inside a matching row', async () => {
    const f = tokenFixture();
    const ghost = 'e'.repeat(40);
    const report = await scanWith(f, [sRow(f.oid, { blobs: [f.oid, ghost], lines: [2, 7] })]);
    expect(report.staleReviews.map((s) => [s.what, s.blob ?? null, s.line ?? null])).toEqual(
      expect.arrayContaining([
        ['blob', ghost, null],
        ['line', null, 7],
      ]),
    );
    expect(report.staleReviews).toHaveLength(2);
  });

  it('is findings, and therefore exit 1, with no finding but a stale row', async () => {
    const f = fixture();
    f.write('README.md', '# fixture\n');
    f.commit('initial');
    const report = await scanWith(f, [sRow('d'.repeat(40))]);
    const v = verdictOf(report);
    expect(v.findings).toBe(0);
    expect(v.staleReview).toBe(1);
    expect(scanExitCode(v)).toBe(1);
    expect(scanExitCode({ ...v, staleReview: 0 })).toBe(0);
  });
});

describe('amendment 6: inline vocabulary clearances are counted as cleared, not dropped', () => {
  it('counts a cleared hit in the reviewed column with the mode cleared', async () => {
    const f = fixture();
    f.write('docs/a.md', [clearance(C2_WORD, 'names the programme module, not a client'), `the ${C2_WORD} module`, ''].join('\n'));
    f.commit('a doc');
    const hits = detectContent(`${clearance(C2_WORD, 'names the programme module')}\nthe ${C2_WORD} module`, CTX_PLAIN);
    expect(hits.filter((h) => h.klass === 'C2').map((h) => [h.line, h.mark])).toEqual([[2, 'cleared']]);

    const report = await scanWith(f, null);
    const c2 = report.findings.filter((x) => x.klass === 'C2');
    expect(c2.map((x) => [x.surface, x.mark])).toEqual(
      expect.arrayContaining([
        ['T', 'cleared'],
        ['Y', 'cleared'],
      ]),
    );
    expect(verdictOf(report).findings).toBe(0);
    expect(formatScanReport(report).join('\n')).toMatch(/\nC2\s+T\s+scanned 1 1 reviewed 1 1\n/);
    expect(formatFinding(c2[0]!)).toMatch(/ C2 cleared /);
  });

  it('lists a stale clearance without counting it toward the exit code', async () => {
    const f = fixture();
    f.write('docs/a.md', `${clearance(C2_WORD, 'the term left this page long ago')}\nnothing here\n`);
    f.commit('a doc');
    const report = await scanWith(f, null);
    const stale = report.findings.filter((x) => x.mark === 'stale-clearance');
    expect(stale.length).toBeGreaterThan(0);
    const v = verdictOf(report);
    expect(v.staleClearance).toBe(stale.length);
    expect(v.findings).toBe(0);
    expect(scanExitCode(v)).toBe(0);
  });

  /**
   * D-277: a clearance reaches its own block. The scan hands the rule only the
   * candidate lines, so it must keep the blank lines between blocks, or every
   * annotation would reach the whole file again.
   */
  it('clears a term only in the block the annotation sits in (D-277)', () => {
    const text = [
      `// Signed with the ${C2_WORD} customer last week.`,
      '',
      'const fixture = `',
      `the ${C2_WORD} module`,
      clearance(C2_WORD, 'names the programme module, not a client'),
      '`;',
      '',
    ].join('\n');
    const c2 = detectContent(text, CTX_PLAIN).filter((h) => h.klass === 'C2');
    expect(c2.map((h) => [h.line, h.mark ?? 'finding'])).toEqual([
      [1, 'finding'],
      [4, 'cleared'],
    ]);
  });

  it('reports a clearance whose own block lost its hit as stale (D-277)', () => {
    const text = [clearance(C2_WORD, 'the term left this paragraph'), 'nothing here', '', `the ${C2_WORD} module`].join(
      '\n',
    );
    const c2 = detectContent(text, CTX_PLAIN).filter((h) => h.klass === 'C2');
    expect(c2.map((h) => [h.line, h.mark ?? 'finding'])).toEqual([
      [4, 'finding'],
      [1, 'stale-clearance'],
    ]);
  });
});

describe('amendment 7: what the record does not change', () => {
  it('cannot silence the same rule and line in other content', async () => {
    const f = tokenFixture();
    f.write('config/other.env', `# other\nREGISTRY_TOKEN=${FAKE_GITLAB_TOKEN}\n`);
    f.commit('a second file');
    const report = await scanWith(f, [sRow(f.oid)]);
    const other = report.findings.filter((x) => x.path === 'config/other.env' && x.klass === 'S');
    expect(other.length).toBeGreaterThan(0);
    for (const x of other) expect(x.mark).toBeUndefined();
  });

  it('cannot silence another rule in the recorded content', async () => {
    const f = fixture();
    f.write('config/app.env', `# app\nREGISTRY_TOKEN=${FAKE_GITLAB_TOKEN}\nNPM=${FAKE_NPM_TOKEN}\n`);
    f.commit('two kinds');
    const report = await scanWith(f, [sRow(f.blob('config/app.env'))]);
    const npm = report.findings.filter((x) => x.rule === 'npm-token');
    expect(npm.length).toBeGreaterThan(0);
    for (const x of npm) expect(x.mark).toBeUndefined();
  });

  it('never records a commit-message finding', async () => {
    const f = tokenFixture();
    f.write('README.md', '# fixture, again\n');
    f.commit(`a message carrying ${FAKE_NPM_TOKEN}`);
    const report = await scanWith(f, [sRow(f.blob('config/app.env'))]);
    const message = report.findings.find((x) => x.path === 'commit-message' && x.klass === 'S')!;
    expect(message.mark).toBeUndefined();
    expect(message.blob).toBeUndefined();
    expect(reviewedCandidates(report).some((row) => row.path === 'commit-message')).toBe(false);
  });

  it('writes the unreviewed recordable groups as candidates with review and reason absent', async () => {
    const f = tokenFixture();
    f.write('people.md', `owner: ${FAKE_PERSON}\n`);
    f.write('hosts.md', `db: ${PRIVATE_ADDRESS}\n`);
    f.commit('more');
    const report = await scanWith(f, null);
    const candidates = reviewedCandidates(report);
    const s = candidates.find((row) => row.class === 'S')!;
    expect(s).toEqual({ class: 'S', rule: 'gitlab-token', path: 'config/app.env', blobs: [f.oid], lines: [2] });
    const p = candidates.find((row) => row.class === 'P')!;
    expect(p.lines).toBeUndefined();
    expect(candidates.some((row) => (row.class as string) === 'H')).toBe(false);
    for (const row of candidates) {
      expect('review' in row).toBe(false);
      expect('reason' in row).toBe(false);
    }
    // A candidate applies only once a person writes both.
    expect(() => record([s])).toThrow();
    expect(() => record([{ ...s, review: 'synthetic', reason: 'an invented fixture token' }])).not.toThrow();
  });

  it('holds no matched value in the report, the findings, the stale list or the candidates', async () => {
    const f = tokenFixture();
    f.write('people.md', `owner: ${FAKE_PERSON}\n`);
    f.commit(`more, with ${FAKE_NPM_TOKEN}`);
    const report = await scanWith(f, [sRow(f.oid), sRow('d'.repeat(40), { ref: 'T2' })]);
    const everything = [
      formatScanReport(report).join('\n'),
      report.findings.map(formatFinding).join('\n'),
      report.staleReviews.map(formatStaleReview).join('\n'),
      JSON.stringify(reviewedCandidates(report)),
    ].join('\n');
    for (const value of everyValue()) expect(everything).not.toContain(value);
  });
});
