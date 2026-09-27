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
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CLASS_SURFACES,
  detectContent,
  detectForPath,
  formatScanReport,
  gitleaksArguments,
  isPersonalEmail,
  parseGitleaksReport,
  parsePaidIds,
  runScan,
  type ScanContext,
  vacuousScanReason,
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

describe('a fixture history — a key in a blob deleted before the tip (spec §10 scenario 2)', () => {
  const created: string[] = [];
  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function fixture(): { root: string; git: (args: string[]) => string; write: (p: string, c: string) => void } {
    const root = mkdtempSync(join(tmpdir(), 'endora-pre-publication-scan-'));
    created.push(root);
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
    return { root, git, write };
  }

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
