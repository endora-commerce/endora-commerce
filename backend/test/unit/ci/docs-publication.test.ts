import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { commandLines, readJobs, type CiJob } from '../../helpers/ci-jobs.js';

/**
 * The documentation site is published by a job that publishes a build a gate
 * has already judged, onto a host where a reader never sees half of it.
 *
 * `specs/133-docs-site-publication/contracts/publication-pipeline.md` §2 states
 * nine properties and this file asserts all nine, by reading `.gitlab-ci.yml`,
 * `deploy/publish-docs.sh` and `docs/docusaurus.config.js`.
 *
 * ## Why nine and not five
 *
 * The first five are the **shape of a job** — a stage, a `needs:`, an
 * `environment`, a rules block — and they are what a reviewer notices missing.
 * Properties 6–9 are **logic**: the transfer's flags, the serialisation pair,
 * the flip form, and the one Docusaurus setting that turns a broken link into a
 * red pipeline. A five-assertion version of this file left FR-024, FR-025,
 * FR-026 and FR-017 shipping executable behaviour with no instrument at all,
 * which the spec's Constitution Check does not allow: every requirement traces
 * to an automated check or a recorded repeatable verification, and Principle III
 * is non-negotiable.
 *
 * ## And strings are not the guard
 *
 * Everything here is text about a file. The one branch whose *logic* can be
 * wrong while every string above is present is the stale-pipeline comparison,
 * and it is the branch that decides whether an older build overwrites a newer
 * site. `docs-publication-guard.test.ts` beside this file **executes** it.
 *
 * ## The hidden job, and why the rules are read through it
 *
 * `build:docs` and `publish:docs` share one `rules:` block, `!reference`d from
 * `.docs-rules` in the idiom `.backend-test-rules` already establishes. The
 * reason is mundane and structural: `publish:docs` declares
 * `needs: [build:docs]`, so a pipeline that creates the publication without the
 * build fails on an unresolvable `needs:` — which is what two blocks free to
 * drift eventually produce.
 *
 * `publish:docs` narrows that block by one rung, and the narrowing is asserted
 * rather than tolerated. The contract says "identical"; identical rules would
 * create a deploy job on every documentation **merge request** and publish an
 * unmerged branch to the live site. What the sharing is *for* is that
 * `publish:docs`'s rule set can never be wider than `build:docs`'s, so that is
 * what property 5 asserts here: the same referenced block, plus refusals only.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CI_SOURCE = readFileSync(join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8');
const PUBLISH_SCRIPT = readFileSync(join(REPO_ROOT, 'deploy/publish-docs.sh'), 'utf8');
const DOCUSAURUS_CONFIG = readFileSync(join(REPO_ROOT, 'docs/docusaurus.config.js'), 'utf8');

const JOBS = readJobs(CI_SOURCE);

/** The public origin, read from the site's own configuration and nowhere else. */
const CONFIGURED_URL = /^\s*url:\s*'([^']+)'/m.exec(DOCUSAURUS_CONFIG)?.[1] ?? '';

function job(name: string): CiJob {
  const found = JOBS.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`\`${name}\` is not a job in .gitlab-ci.yml`);
  return found;
}

/**
 * A top-level block by name, hidden jobs included.
 *
 * `readJobs` deliberately sees only real jobs — a leading `.` is how GitLab
 * marks a template, and every existing caller asks questions about jobs that
 * run. The shared rules block is a template by construction, so it is read
 * here, in the one file that has a question about it.
 */
function topLevelBlock(name: string): string {
  const lines = CI_SOURCE.split('\n');
  const start = lines.findIndex((line) => line === `${name}:`);
  if (start < 0) throw new Error(`\`${name}\` is not a top-level block in .gitlab-ci.yml`);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !/^\s/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

/** A two-space key's inline value and the indented lines that follow it. */
function keyOf(body: string, key: string): { readonly inline: string; readonly block: string } {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^ {2}${key}:`).test(line));
  if (start < 0) return { inline: '', block: '' };
  const inline = lines[start]!.slice(`  ${key}:`.length).trim();
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !/^ {3,}/.test(line)) break;
    block.push(line);
  }
  return { inline, block: block.join('\n') };
}

/** Comments and blank lines dropped, indentation levelled, so two blocks compare. */
function significantLines(text: string): readonly string[] {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  const indents = lines.map((line) => line.length - line.trimStart().length);
  const indent = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(indent));
}

const REFERENCE = /^!reference\s+\[\s*(\.[\w.-]+)\s*,\s*rules\s*\]$/;

/** Which hidden block a `rules:` text defers to, whole or as one list item. */
function referencedTemplates(rulesText: string): readonly string[] {
  return significantLines(rulesText)
    .map((line) => REFERENCE.exec(line.replace(/^-\s*/, ''))?.[1])
    .filter((name): name is string => name !== undefined);
}

/** A job's rules, with every `!reference` to a hidden block expanded in place. */
function resolvedRules(name: string): readonly string[] {
  const { inline, block } = keyOf(ownBlock(job(name)), 'rules');
  if (inline !== '') {
    const template = REFERENCE.exec(inline)?.[1];
    if (template === undefined) return significantLines(inline);
    return significantLines(keyOf(topLevelBlock(template), 'rules').block);
  }
  return significantLines(block).flatMap((line) => {
    const template = REFERENCE.exec(line.replace(/^-\s*/, ''))?.[1];
    if (template === undefined) return [line];
    return significantLines(keyOf(topLevelBlock(template), 'rules').block);
  });
}

/**
 * A job's own indented block.
 *
 * `readJobs` keeps a column-0 comment inside the block it follows, because a
 * comment continues a job rather than closing it — so a job's `body` carries the
 * prose written above the *next* job, and the prose above `publish:packages`
 * says the words "when: manual" about a different job entirely. That is a
 * substring assertion reading a neighbour's documentation, which is the shape
 * `check-inventory.test.ts` was bitten by once already.
 */
function ownBlock(candidate: CiJob): string {
  const kept: string[] = [];
  for (const line of candidate.body.split('\n')) {
    if (line.trim() !== '' && !/^\s/.test(line)) break;
    kept.push(line);
  }
  return kept.join('\n');
}

const SHARED_RULES = significantLines(keyOf(topLevelBlock('.docs-rules'), 'rules').block);
const PUBLISH_BODY = ownBlock(job('publish:docs'));
const BUILD_BODY = ownBlock(job('build:docs'));
const PUBLISH = job('publish:docs');
const BUILD = job('build:docs');
/** Comments dropped: the prose above a command names things the command must not do. */
const PUBLISH_COMMANDS = commandLines([PUBLISH]).join('\n');

describe('the publication pipeline parsed a population that looks like this file', () => {
  /**
   * The floor (issue #244). Every assertion below is a statement about two jobs
   * and a template, and an empty parse would satisfy several of them silently.
   */
  it('found both jobs, the shared template and the configured origin', () => {
    expect(JOBS.map((candidate) => candidate.name)).toEqual(
      expect.arrayContaining(['build:docs', 'publish:docs']),
    );
    expect(PUBLISH.script.trim()).not.toEqual('');
    expect(SHARED_RULES.length).toBeGreaterThanOrEqual(3);
    expect(CONFIGURED_URL).toMatch(/^https:\/\//);
    expect(PUBLISH_SCRIPT.length).toBeGreaterThan(500);
  });
});

describe('the nine properties of contracts/publication-pipeline.md §2', () => {
  it('1 — the job publishes to the origin the site was built for', () => {
    const environment = keyOf(PUBLISH_BODY, 'environment');
    const url = /^\s*url:\s*(\S+)\s*$/m.exec(environment.block)?.[1] ?? '';
    expect(/^\s*name:\s*docs\s*$/m.test(environment.block)).toBe(true);
    expect(
      url,
      "the environment URL and the site's configured `url` are one origin written in two " +
        'files. A deployment history pointing somewhere the build never claimed to be is a ' +
        'drift nothing else in this repository can see.',
    ).toBe(CONFIGURED_URL);
  });

  it('2 — it is automatic, and it consumes the build', () => {
    expect(
      /when:\s*manual/.test(PUBLISH_BODY),
      'publish:docs must not be manual (FR-020): a documentation typo corrected on the default ' +
        'branch must not wait for somebody to click a button.',
    ).toBe(false);
    const needs = keyOf(PUBLISH_BODY, 'needs');
    expect(needs.block).toMatch(/job:\s*build:docs/);
    expect(
      needs.block,
      'the artefact is what makes FR-024 structural — a failed build cannot satisfy this ' +
        '`needs:`, so it publishes nothing without anything here having to check.',
    ).toMatch(/artifacts:\s*true/);
  });

  it('3 — it touches neither the application stack nor its directory', () => {
    expect(
      /\bdocker\b|\bcompose\b/.test(PUBLISH_COMMANDS),
      'a documentation release and an application release are independent events (FR-023). ' +
        'Nothing here pulls an image, recreates a container or restarts the stack.',
    ).toBe(false);
    expect(
      /\$\{?DEPLOY_PATH\b/.test(PUBLISH_COMMANDS),
      "$DEPLOY_PATH is the application stack's directory (FR-022). This job has its own " +
        'destination variable, $DOCS_DEPLOY_PATH, and the two must never be the same path.',
    ).toBe(false);
    expect(PUBLISH_COMMANDS).toContain('$DOCS_DEPLOY_PATH');
  });

  it('4 — the build still gates the merge request, and its output survives it', () => {
    expect(
      /^ {2}stage:\s*test\s*$/m.test(BUILD_BODY),
      'build:docs stays at `stage: test` (FR-018): `build` runs only on the default branch, and ' +
        'this job has to fail the merge request that breaks a link.',
    ).toBe(true);
    const artifacts = keyOf(BUILD_BODY, 'artifacts');
    expect(artifacts.block).toMatch(/- docs\/build\s*$/m);
    expect(artifacts.block).toMatch(/expire_in:/);
    expect(BUILD.script).toContain('pnpm --filter backend run verify:docs-build');
  });

  it('5 — one rules block, referenced by both, narrowed by the publication only', () => {
    expect(referencedTemplates(keyOf(BUILD_BODY, 'rules').inline)).toEqual(['.docs-rules']);
    expect(referencedTemplates(keyOf(PUBLISH_BODY, 'rules').block)).toEqual(['.docs-rules']);

    expect(
      resolvedRules('build:docs'),
      'build:docs takes the shared block whole. The `changes:` list is written once, in ' +
        '`.docs-rules`, because a pipeline that built and did not publish — or published and ' +
        'did not build — is what two lists free to drift produce.',
    ).toEqual([...SHARED_RULES]);

    const publishRules = resolvedRules('publish:docs');
    const extra = publishRules.slice(0, publishRules.length - SHARED_RULES.length);
    expect(
      publishRules.slice(extra.length),
      'publish:docs must end in the same shared block, so its rule set can never be wider than ' +
        "build:docs's and no pipeline can create it with an unresolvable `needs:`.",
    ).toEqual([...SHARED_RULES]);
    expect(extra.length).toBeGreaterThan(0);
    expect(
      extra.filter((line) => /when:/.test(line) && !/when:\s*never/.test(line)),
      'the only rungs publish:docs may add ahead of the shared block are refusals. A rung that ' +
        'ran anything would widen the job past the build it depends on.',
    ).toEqual([]);
    expect(
      extra.join('\n'),
      'the refusal is what keeps the publication on the default branch. Literally identical ' +
        'rules would create this deploy job on every documentation merge request and publish an ' +
        'unmerged branch to the live site.',
    ).toContain('$CI_COMMIT_BRANCH != $CI_DEFAULT_BRANCH');
    expect(BUILD_BODY).not.toMatch(/^ {4,}changes:/m);
    expect(PUBLISH_BODY).not.toMatch(/^ {4,}changes:/m);
  });

  it('6 — the transfer is a fresh release directory, hard-linked and pruned of what went', () => {
    const transfer = PUBLISH_COMMANDS.split('\n').find((line) => /^\s*-\s*rsync\s/.test(line));
    if (transfer === undefined) throw new Error('the publish job has no rsync transfer line');
    expect(transfer).toContain('releases/$CI_COMMIT_SHA/');
    expect(
      transfer,
      "FR-025's deletion-correctness comes from the release directory being **fresh**, not from " +
        'this flag — but a same-SHA pipeline retry rsyncs into a directory the first attempt ' +
        'already populated, and there the flag alone decides whether a page deleted in that very ' +
        'commit keeps being served.',
    ).toContain('--delete');
    expect(
      transfer,
      'the pair pins the release-directory idiom itself: an editor who later simplifies this ' +
        'into an in-place transfer into `current/` — where `--delete` would be the whole of ' +
        'FR-025 — has to remove an assertion rather than drift past one. The path is ' +
        "`../../current` and not the contract's `../current` because rsync resolves a relative " +
        '`--link-dest` against the destination directory, which is `releases/<sha>/`, and ' +
        '`current` sits one level above `releases/`. A link-dest that resolves to nothing is not ' +
        'an error: it silently hard-links nothing and transfers the whole tree.',
    ).toContain('--link-dest=../../current');
  });

  it('7 — two publications never interleave, and none is cancelled halfway', () => {
    expect(
      /^ {2}resource_group:\s*docs-publish\s*$/m.test(PUBLISH_BODY),
      'without it two publications transfer into the same release tree at once (FR-026).',
    ).toBe(true);
    expect(
      /^ {2}interruptible:\s*false\s*$/m.test(PUBLISH_BODY),
      'the pipeline default at the top of this file is `interruptible: true`, so without this a ' +
        'newer pipeline cancels a running transfer and leaves a partial release directory.',
    ).toBe(true);
  });

  it('8 — the host script orders publications, and flips atomically', () => {
    expect(PUBLISH_SCRIPT).toContain('.published');
    expect(PUBLISH_SCRIPT).toContain('CI_COMMIT_TIMESTAMP');
    expect(
      PUBLISH_SCRIPT,
      'a stale pipeline declines and exits 0 (FR-026): a non-zero exit would red a pipeline for ' +
        'doing the right thing, and be indistinguishable from a transfer that failed. ' +
        '`docs-publication-guard.test.ts` executes this branch.',
    ).toMatch(/exit 0/);
    expect(PUBLISH_SCRIPT).toContain('mv -Tf current.tmp current');
    const bareFlip = PUBLISH_SCRIPT.split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .filter((line) => /\bln\s+-sfn\b/.test(line) && /\bcurrent\s*$/.test(line));
    expect(
      bareFlip,
      'never a bare `ln -sfn … current`. Onto an existing symlink-to-directory that is not ' +
        'atomic, and where the name resolves to a directory it creates the link *inside* it ' +
        'rather than replacing it — leaving the document root untouched and a `releases` entry ' +
        'inside the live tree. `mv -Tf` is one `rename(2)` over the symlink itself.',
    ).toEqual([]);
  });

  it('9 — a broken internal link still fails the build', () => {
    expect(
      /onBrokenLinks:\s*'throw'/.test(DOCUSAURUS_CONFIG),
      "nothing else in this repository asserts that `onBrokenLinks: 'throw'` survives, and it " +
        'is the whole of FR-017: relaxed to `warn`, `build:docs` goes green over a link that ' +
        'resolves nowhere and the publication ships it (SC-011).',
    ).toBe(true);
  });
});
