/**
 * The Developer Certificate of Origin gate: every non-merge commit a pull
 * request adds carries a `Signed-off-by:` trailer whose address is the commit
 * author's (`specs/136-open-source-publication/` W6.3; owner decision O-7 —
 * DCO enforced by a GitHub check, no CLA). `CONTRIBUTING.md` § *Sign your
 * commits* is the rule a contributor reads; this is the instrument.
 *
 * ## Why it is a script and not a GitHub App
 *
 * The DCO app is a third party granted read access to every pull request, and
 * this check needs nothing it offers: `git log` already parses trailers, so the
 * whole verdict is one format string and a string comparison. The script has no
 * dependency and uses only erasable TypeScript, so the workflow runs it with
 * `node` straight after checkout — no install, no build, seconds per run.
 *
 * ## What counts as a sign-off
 *
 * A **trailer**, as git parses it — `%(trailers:key=Signed-off-by)` — never a
 * line of body prose that happens to start with the key. It must name the
 * **author's address**, compared case-insensitively; the display name is not
 * compared, because the same person writes it differently across machines and
 * the address is the identity git records — except for a GitHub App identity
 * (`name[bot]`), which signs off at a different address from the one it
 * authors at and is matched by name instead. A merge commit is not asked: it
 * adds no authored change of its own, and the commits it brings in are in the
 * range and are judged individually.
 *
 * ## Exit codes
 *
 * `0` every commit signed off; `1` findings, each naming the commit and the
 * remedy; `2` a refused input — a missing argument, an unresolvable ref, or a
 * range holding no commit at all. The last one is deliberate: an empty range is
 * a check that read nothing, and a green that means "not looking" is the
 * failure this repository's check estate refuses everywhere else (issue #244).
 *
 * Usage: `node backend/scripts/dco-signoff.ts <base> <head>`
 */
/* eslint-disable no-console -- CLI: stdout/stderr is the interface. */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** One commit of the range, as the log format below reads it. */
export interface CommitRecord {
  readonly sha: string;
  /** How many parents the commit has; more than one is a merge. */
  readonly parents: number;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly subject: string;
  /** Every `Signed-off-by` trailer value, in order. */
  readonly signoffs: readonly string[];
}

export type SignoffFindingKind = 'missing-signoff' | 'foreign-signoff';

export interface SignoffFinding {
  readonly kind: SignoffFindingKind;
  readonly sha: string;
  readonly subject: string;
  readonly authorEmail: string;
  readonly signoffs: readonly string[];
}

const FIELD = '\x00';
const RECORD = '\x1e';
const TRAILER = '\x1f';

/**
 * The `git log` format the parser reads: sha, parents, author name, author
 * address, subject, then the sign-off trailers joined by a unit separator.
 * NUL and the record separator cannot occur in any of those fields.
 */
export const LOG_FORMAT =
  '%H%x00%P%x00%an%x00%ae%x00%s%x00' +
  '%(trailers:key=Signed-off-by,valueonly,unfold,separator=%x1f)%x1e';

export function parseCommitLog(raw: string): CommitRecord[] {
  return raw
    .split(RECORD)
    .map((record) => record.replace(/^\n+/, ''))
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [sha, parents, authorName, authorEmail, subject, trailers] = record.split(FIELD);
      return {
        sha: sha!,
        parents: parents!.trim() === '' ? 0 : parents!.trim().split(/\s+/).length,
        authorName: authorName!,
        authorEmail: authorEmail!,
        subject: subject!,
        signoffs: (trailers ?? '')
          .split(TRAILER)
          .map((value) => value.trim())
          .filter((value) => value !== ''),
      };
    });
}

function addressOf(signoff: string): string | null {
  const match = /<([^<>\s]+)>\s*$/.exec(signoff);
  return match === null ? null : match[1]!.toLowerCase();
}

function nameOf(signoff: string): string {
  return signoff.replace(/<[^<>]*>\s*$/, '').trim();
}

/** A GitHub App's commit identity: `dependabot[bot]`, `github-actions[bot]`. */
const BOT_NAME = /\[bot\]$/;

function signedOffByAuthor(commit: CommitRecord): boolean {
  const author = commit.authorEmail.toLowerCase();
  if (commit.signoffs.some((signoff) => addressOf(signoff) === author)) return true;
  // A GitHub App authors at its `users.noreply.github.com` address and signs
  // off at another (Dependabot: `support@github.com`), so the address rule
  // alone would refuse every dependency update `.github/dependabot.yml` opens.
  // The name is compared for those identities only; a person's sign-off at a
  // second address is still refused, because the address is the identity.
  return (
    BOT_NAME.test(commit.authorName) &&
    commit.signoffs.some((signoff) => nameOf(signoff) === commit.authorName)
  );
}

export function signoffFindings(commits: readonly CommitRecord[]): SignoffFinding[] {
  const findings: SignoffFinding[] = [];
  for (const commit of commits) {
    if (commit.parents > 1) continue;
    if (signedOffByAuthor(commit)) continue;
    findings.push({
      kind: commit.signoffs.length === 0 ? 'missing-signoff' : 'foreign-signoff',
      sha: commit.sha,
      subject: commit.subject,
      authorEmail: commit.authorEmail,
      signoffs: commit.signoffs,
    });
  }
  return findings;
}

function refuse(message: string): number {
  console.error(`dco-signoff: ${message}`);
  return 2;
}

export function main(argv: readonly string[]): number {
  const [base, head] = argv;
  if (base === undefined || head === undefined || argv.length !== 2) {
    return refuse('usage: dco-signoff.ts <base> <head>');
  }
  const log = spawnSync('git', ['log', `--format=${LOG_FORMAT}`, `${base}..${head}`], {
    encoding: 'utf8',
  });
  if (log.status !== 0) {
    return refuse(`git log ${base}..${head} failed: ${(log.stderr ?? '').trim()}`);
  }
  const commits = parseCommitLog(log.stdout);
  if (commits.length === 0) {
    return refuse(
      `the range ${base}..${head} holds no commit, so there is nothing to judge. ` +
        'A pull request always adds at least one; an empty range means the refs are wrong.',
    );
  }
  const findings = signoffFindings(commits);
  const judged = commits.filter((commit) => commit.parents <= 1).length;
  console.log(
    `dco-signoff: commits=${commits.length} judged=${judged} merges=${commits.length - judged} ` +
      `findings=${findings.length}`,
  );
  if (findings.length === 0) return 0;

  for (const finding of findings) {
    const seen =
      finding.signoffs.length === 0 ? 'no Signed-off-by trailer' : finding.signoffs.join('; ');
    console.log(
      `  ${finding.kind}  ${finding.sha.slice(0, 12)}  ${finding.subject}\n` +
        `    author ${finding.authorEmail}; found: ${seen}`,
    );
  }
  console.log(
    '\nEvery commit must end with a sign-off by its author, certifying the Developer Certificate\n' +
      'of Origin (https://developercertificate.org/) — see CONTRIBUTING.md § Sign your commits.\n' +
      'Commit with `git commit -s`. To sign off the commits already on this branch:\n\n' +
      `  git rebase --signoff ${base}\n  git push --force-with-lease\n`,
  );
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
