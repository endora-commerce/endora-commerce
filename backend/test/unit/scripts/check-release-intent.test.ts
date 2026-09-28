import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  analyzeReleaseIntent,
  changelogSections,
  checkBranchIntent,
  checkReleaseIntent,
  compilesPath,
  groupMembers,
  matchesPattern,
  matchesTsGlob,
  normalizeRelative,
  parseChangeset,
  publicationExemptionLine,
  publicationExemptions,
  publicRegistryExemptions,
  publishScope,
  publicRegistryLicence,
  readChangesetDocument,
  readPublishedSurface,
  readReleaseIntent,
  unreadablePattern,
  unservableScope,
  type PublishScope,
  type ReleaseIntentFinding,
  type ReleaseIntentFindingKind,
} from '../../../scripts/check-release-intent.js';
import { nodeWorkspaceFs } from '../../../scripts/lib/workspace-packages.js';
import { scanCommercialVocabulary } from '../../../scripts/lib/commercial-vocabulary.js';
import {
  branch,
  checkout,
  configuredAs,
  FIXTURE_ROOT,
  HOST_SOURCED_PACKAGE,
  NESTED_FAMILY_PACKAGE,
  PRIVATE_BETA,
  PUBLISHED_ALPHA,
  publishedAlphaAs,
  type BranchOptions,
  type FileMap,
} from '../../helpers/release-intent-check-fixture.js';

/**
 * Companion test for `check-release-intent` (feature 080, T043).
 *
 * The check exists because the release gate's failure mode is **silence**:
 * every way `.changeset/config.json` can be wrong makes `changeset status` exit
 * 0 with an empty release plan, which is byte-identical to a clean branch. So
 * the shapes asserted here are not "does it find a violation" — they are the
 * eight distinct ways the flow stops asking, each proven separately, because a
 * check that went blind on seven of them behind the eighth's red would read
 * exactly as green as this file's subject does today.
 *
 * Every fixture is a whole synthetic checkout. The derivation under test is
 * *which workspace entries produce a library family and which name one
 * application*, and a fixture that pre-declared that answer would leave it
 * unproven — which matters more than usual here, because the answer has to
 * survive 66 module packages arriving under a second scope and a directory
 * deeper (D-160.2).
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function findings(overrides: Parameters<typeof checkout>[0] = {}): readonly ReleaseIntentFinding[] {
  const tree = checkout(overrides);
  const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
  if ('reason' in result) {
    throw new Error(`expected a verdict, got a refusal: ${result.reason}`);
  }
  return result.findings;
}

function refusal(overrides: Parameters<typeof checkout>[0] = {}): string {
  const tree = checkout(overrides);
  const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
  if (!('reason' in result)) {
    throw new Error(`expected a refusal, got ${String(result.findings.length)} finding(s)`);
  }
  return result.reason;
}

const kinds = (found: readonly ReleaseIntentFinding[]): readonly ReleaseIntentFindingKind[] =>
  found.map((finding) => finding.kind);

describe('check-release-intent — the default checkout passes', () => {
  it('reports nothing for a workspace whose configuration is right', () => {
    expect(findings()).toEqual([]);
  });

  /**
   * The proofs above can only show the analyser *can* go red. This is the other
   * half: the tree CI actually runs it over is clean, so a green in the
   * pipeline is a statement about this repository and not about a fixture.
   */
  it('reports nothing for this repository, which is the tree CI runs it over', () => {
    const result = checkReleaseIntent(REPO_ROOT.replace(/\/$/, ''), nodeWorkspaceFs(), (dir) =>
      readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name),
    );
    expect('reason' in result ? result.reason : kinds(result.findings)).toEqual([]);
  });
});

describe('check-release-intent — the four lines that look like boilerplate', () => {
  /**
   * The headline. Measured against the real five manifests with a branch that
   * changes `packages/contracts/src/index.ts` and carries no changeset:
   * `version: true` exits 1, `version: false` exits 0 with an empty plan, and
   * the block deleted exits 0 too. Nothing in the repository read those four
   * lines before this check.
   */
  it('reports `privatePackages.version: false` — the config default', () => {
    const found = findings({
      // The precondition, explicit since the ruling of 2026-09-05 made the
      // fixture's default the compliant shape: this rule asks its question
      // *while a versionable package is private*.
      ...PRIVATE_BETA,
      ...configuredAs((config) => {
        config['privatePackages'] = { version: false, tag: false };
      }),
    });
    expect(kinds(found)).toContain('version-disabled');
  });

  it('reports `privatePackages` omitted entirely, which is the same value', () => {
    const found = findings({
      ...PRIVATE_BETA,
      ...configuredAs((config) => {
        delete config['privatePackages'];
      }),
    });
    expect(kinds(found)).toContain('version-disabled');
  });

  it('says which setting and what it is, not merely that something is wrong', () => {
    const found = findings({
      ...PRIVATE_BETA,
      ...configuredAs((config) => {
        config['privatePackages'] = { version: false, tag: false };
      }),
    });
    const finding = found.find((candidate) => candidate.kind === 'version-disabled');
    expect(finding?.subject).toBe('privatePackages.version');
    expect(finding?.message).toContain('@changesets/config@4');
  });

  /**
   * The discrimination: the requirement is derived from the manifests, not
   * asserted. A workspace whose library packages are all public does not need
   * `privatePackages.version` at all, and demanding it there would be a rule
   * about a value rather than about a consequence.
   */
  it('does not require the setting when no versionable package is private', () => {
    const found = findings(
      configuredAs((config) => {
        config['privatePackages'] = { version: false, tag: true };
      }),
    );
    expect(kinds(found)).not.toContain('version-disabled');
    expect(kinds(found)).not.toContain('tag-policy-unstated');
  });
});

describe('check-release-intent — publication: every versionable package publishes', () => {
  /**
   * The centre, and the direction this question now has a subject in.
   *
   * It has had three. `publishable-package` refused every public member, which
   * D-203 made fire four times on a correct tree. `unexpected-public-package`
   * asked *may this package be public* against the closure of what a client
   * obtains directly; the owner's ruling of 2026-09-05 made that answer
   * constant — every `@endora-commerce` package publishes, because a deployment
   * builds its own instance (D-208) — so the closure stopped discriminating and
   * the finding inverted.
   *
   * What it now catches is a hazard the old rule could not see and the module
   * manifest generator's own default used to produce: `changeset publish` skips
   * a private package **in silence**, while `pnpm pack` has already rewritten
   * every sibling's `workspace:*` to its exact version.
   */
  it('reports a versionable package that is private', () => {
    const found = findings(PRIVATE_BETA);
    expect(kinds(found)).toContain('unpublished-package');
    expect(found.find((f) => f.kind === 'unpublished-package')?.subject).toBe('@fx/beta');
  });

  /**
   * The discrimination that makes it worth having: a public, fit package is not
   * a finding. Without this the rule could be satisfied by a check that refuses
   * every member, which is `publishable-package` arriving a third time.
   */
  it('reports nothing for a public package that is fit to be published', () => {
    expect(findings(PUBLISHED_ALPHA)).toEqual([]);
  });

  /**
   * The retirement, asserted rather than assumed. This is the old rule's own
   * red fixture — a public package the reference storefront does not reach —
   * and it has to be **green** now, or the closure is still being consulted
   * somewhere and the ruling landed in the prose only.
   */
  it('reports nothing for a public package no application depends on', () => {
    expect(kinds(findings())).not.toContain('unpublished-package');
    expect(findings()).toEqual([]);
  });

  /**
   * An application is not a package anybody installs by version, so `private`
   * on it is not this rule's business. It is the discrimination that matters
   * most in *this* direction: `backend`, `admin`, `storefront` and `docs` are
   * all private and all `ignore`d, so a predicate widened to every member would
   * report four findings on a correct tree and be switched off within a day.
   */
  it('does not report a private application', () => {
    const found = findings({
      'apps/host/package.json': JSON.stringify({
        name: 'host',
        version: '0.0.0',
        private: true,
        scripts: { build: 'next build' },
        dependencies: { next: '^15.0.0' },
      }),
    });
    expect(kinds(found)).not.toContain('unpublished-package');
  });

  /**
   * Every private member, not the first one. The state this ruling was made in
   * had **75** of them, and a rule that reported one would send its reader to
   * flip one package and run again — which is the shape of the failure it is
   * about, since a single package left behind is what makes every sibling's
   * packed manifest pin a version the registry does not have.
   */
  it('reports every private versionable member', () => {
    const found = findings({
      ...PRIVATE_BETA,
      'packages/alpha/package.json': '{ "name": "@fx/alpha", "version": "1.0.0", "private": true }',
    });
    expect(
      found.filter((f) => f.kind === 'unpublished-package').map((f) => f.subject).sort(),
    ).toEqual(['@fx/alpha', '@fx/beta']);
  });

  /**
   * And the message says what the reader has to do about it, because this
   * finding's remedy is a decision rather than an edit: publishing is the
   * default and *not* publishing is what now takes a merge request that says
   * so. A finding that only named the package would be read as "add `private`
   * back", which is the inverse of the ruling.
   */
  it('tells the reader that not publishing is its own decision', () => {
    const message = findings(PRIVATE_BETA).find((f) => f.kind === 'unpublished-package')?.message;
    expect(message).toContain('change this check in the same commit');
  });
});

/**
 * D-267 — the one private member the tree may hold, and why the exemption is
 * derived rather than declared.
 *
 * `create-endora-commerce` is unscoped, so it cannot be green as either state:
 * public, it is `unresolvable-scope` (the GitLab endpoint turns a scope into a
 * namespace path, and it has none) and `publishScope()` refuses it; private, it
 * is `unpublished-package`. The ruling's exemption is the conjunction of two
 * facts this check already computes — the configured target cannot serve the
 * name, **and** no workspace member depends on it, so the finding's harm (a
 * dependent's packed manifest pinning a version the registry never receives)
 * cannot occur. No package name appears in the check. Its expiry is the
 * `--publish-registry` refusal below: the day the target is public npmjs, the
 * exempted member stops being private or the publish does not happen.
 *
 * The fixture's unscoped member is `create-fx`, not the real name: the rule is
 * about a shape, and a fixture carrying the real name would read as a claim
 * about it.
 */
describe('check-release-intent — D-267: a private member the target cannot serve', () => {
  const UNSCOPED_PRIVATE = JSON.stringify({
    name: 'create-fx',
    version: '0.0.0',
    private: true,
    license: 'MIT',
    repository: { type: 'git', url: 'https://example.invalid/fx.git', directory: 'packages/gamma' },
    publishConfig: { access: 'public' },
    bin: { 'create-fx': './dist/bin.js' },
    dependencies: { '@fx/alpha': 'workspace:*' },
  });
  const FRONT_DOOR: FileMap = { 'packages/gamma/package.json': UNSCOPED_PRIVATE };

  function inputsOf(files: FileMap) {
    const tree = checkout(files);
    const inputs = readReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in inputs) throw new Error(`expected inputs, got a refusal: ${inputs.reason}`);
    return inputs;
  }

  it('does not report a private unscoped member nothing depends on', () => {
    const found = findings(FRONT_DOOR);
    expect(found.filter((f) => f.kind === 'unpublished-package').map((f) => f.subject)).toEqual([]);
    expect(found).toEqual([]);
  });

  it('names every exempted member and why, so nothing is skipped in silence', () => {
    const exempt = publicationExemptions(inputsOf(FRONT_DOOR).members);
    expect(exempt.map((entry) => entry.name)).toEqual(['create-fx']);
    expect(exempt[0]!.dir).toBe('packages/gamma');
    expect(exempt[0]!.reason).toContain('unscoped');
    const line = publicationExemptionLine(exempt);
    expect(line).toContain('exempt-private=1');
    expect(line).toContain('create-fx');
    expect(line).toContain('D-267');
  });

  it('prints a zero when nothing is exempted, rather than printing nothing', () => {
    expect(publicationExemptions(inputsOf({}).members)).toEqual([]);
    expect(publicationExemptionLine([])).toContain('exempt-private=0');
  });

  /**
   * The negative the ruling asks for by name: a private **scoped** member is
   * the finding's own subject, and the `@endora-commerce` scope is always
   * servable — so the owner's ruling of 2026-09-05 (every `@endora-commerce`
   * package publishes) loses nothing to this exemption.
   */
  it('still reports a private scoped member, whose scope the target can serve', () => {
    const found = findings({ ...FRONT_DOOR, ...PRIVATE_BETA });
    expect(found.filter((f) => f.kind === 'unpublished-package').map((f) => f.subject)).toEqual([
      '@fx/beta',
    ]);
    expect(publicationExemptions(inputsOf({ ...FRONT_DOOR, ...PRIVATE_BETA }).members).map((e) => e.name)).toEqual([
      'create-fx',
    ]);
  });

  it('still reports it the moment any member depends on it, in any dependency field', () => {
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const found = findings({
        ...FRONT_DOOR,
        'packages/beta/package.json': JSON.stringify({
          name: '@fx/beta',
          version: '1.0.0',
          license: 'MIT',
          repository: { type: 'git', url: 'https://example.invalid/fx.git', directory: 'packages/beta' },
          publishConfig: { access: 'public' },
          [field]: { 'create-fx': 'workspace:*' },
        }),
      });
      expect(
        found.filter((f) => f.kind === 'unpublished-package').map((f) => f.subject),
        field,
      ).toEqual(['create-fx']);
    }
  });

  it('counts an application depending on it as a dependent too', () => {
    const found = findings({
      ...FRONT_DOOR,
      'apps/host/package.json': JSON.stringify({
        name: 'host',
        version: '0.0.0',
        private: true,
        scripts: { build: 'next build' },
        dependencies: { next: '^15.0.0', 'create-fx': 'workspace:*' },
      }),
    });
    expect(found.map((f) => f.subject)).toContain('create-fx');
  });

  it('exempts nothing public — a public unscoped member is still `unresolvable-scope`', () => {
    const found = findings({
      'packages/gamma/package.json': UNSCOPED_PRIVATE.replace('"private":true,', ''),
    });
    expect(found.map((f) => `${f.kind} ${f.subject}`)).toContain('unresolvable-scope create-fx');
  });

  describe('--publish-registry: the exemption expires where its reason does', () => {
    it('refuses public npmjs while a member is exempted, naming it and 136 §5.3', () => {
      for (const registry of ['https://registry.npmjs.org/', 'https://REGISTRY.npmjs.com']) {
        const verdict = publicRegistryExemptions(inputsOf(FRONT_DOOR).members, registry);
        expect(verdict.publicRegistry, registry).toBe(true);
        expect(verdict.exempt, registry).toEqual(['create-fx']);
        expect(verdict.refusal, registry).toContain('create-fx');
        expect(verdict.refusal, registry).toContain('§5.3');
      }
    });

    it('lets the rehearsal on the private registry through untouched', () => {
      const verdict = publicRegistryExemptions(
        inputsOf(FRONT_DOOR).members,
        'https://gitlab.example.invalid/api/v4/projects/1/packages/npm/',
      );
      expect(verdict.publicRegistry).toBe(false);
      expect(verdict.refusal).toBe('');
    });

    it('lets public npmjs through once nothing is exempted', () => {
      const verdict = publicRegistryExemptions(inputsOf({}).members, 'https://registry.npmjs.org/');
      expect(verdict.exempt).toEqual([]);
      expect(verdict.refusal).toBe('');
    });

    it('refuses a registry it cannot read as a URL rather than guessing', () => {
      const verdict = publicRegistryExemptions(inputsOf(FRONT_DOOR).members, 'not a url');
      expect(verdict.publicRegistry).toBeNull();
      expect(verdict.refusal).toContain('not a URL');
    });
  });
});

describe('check-release-intent — is a public package fit to be published', () => {
  it('reports a public package that declares no `repository`', () => {
    const found = findings(
      publishedAlphaAs((manifest) => {
        delete manifest['repository'];
      }),
    );
    expect(kinds(found)).toContain('incomplete-public-package');
    expect(found.find((f) => f.kind === 'incomplete-public-package')?.message).toContain(
      '`repository`',
    );
  });

  it('reports a public package that declares no `publishConfig.access`', () => {
    const found = findings(
      publishedAlphaAs((manifest) => {
        delete manifest['publishConfig'];
      }),
    );
    expect(found.find((f) => f.kind === 'incomplete-public-package')?.message).toContain(
      '`publishConfig.access`',
    );
  });

  /**
   * `license` is judged, and by a kind of its own — this assertion used to read
   * *"does not report a public package that declares no `license`"*, on D-203's
   * amendment deferring it to the merge request that makes a package public on
   * npmjs. That merge request is the owner's licensing ruling of 2026-09-06,
   * and what it changes here is only which finding carries it: `repository` and
   * `publishConfig.access` have one correct value each and a generator writes
   * them, while a licence is a decision, so folding it into this list would
   * make one number stand for three fields with three different remedies.
   */
  it('does not fold the licence into `incomplete-public-package`', () => {
    const found = findings(
      publishedAlphaAs((manifest) => {
        delete manifest['license'];
      }),
    );
    expect(kinds(found)).toContain('unlicensed-package');
    expect(kinds(found)).not.toContain('incomplete-public-package');
  });

  /**
   * The value the rehearsal cannot exercise. GitLab ignores `--access` and takes
   * a package's visibility from the project, so nothing about a private-registry
   * publish would reveal this before the first public one — which is the publish
   * that cannot be taken back.
   */
  it('reports `access: restricted` declared by the package itself', () => {
    const found = findings(
      publishedAlphaAs((manifest) => {
        manifest['publishConfig'] = { access: 'restricted' };
      }),
    );
    expect(kinds(found)).toContain('restricted-public-package');
  });

  it('reports `access: restricted` inherited from `.changeset/config.json`', () => {
    const found = findings({
      ...publishedAlphaAs((manifest) => {
        delete manifest['publishConfig'];
      }),
      ...configuredAs((config) => {
        config['access'] = 'restricted';
      }),
    });
    expect(kinds(found)).toContain('restricted-public-package');
  });

  /**
   * And the state that arrives by omission, which is the one that ships: neither
   * the package nor the configuration states an access, and changesets defaults
   * to `restricted`. A rule that read "no value" as "nothing to judge" would be
   * silent for exactly the tree that publishes to nobody.
   */
  it('reports the changesets default when nobody states an access at all', () => {
    const found = findings({
      ...publishedAlphaAs((manifest) => {
        delete manifest['publishConfig'];
      }),
      ...configuredAs((config) => {
        delete config['access'];
      }),
    });
    expect(kinds(found)).toContain('restricted-public-package');
  });

  it('does not report a package whose access resolves to public', () => {
    expect(kinds(findings(PUBLISHED_ALPHA))).not.toContain('restricted-public-package');
  });
});

describe('check-release-intent — the licence a published package declares', () => {
  /**
   * The owner's licensing ruling of 2026-09-06: the split is by **package** —
   * the open core is `MIT`, a paid package carries the SPDX `SEE LICENSE IN`
   * form — and entitlement is contractual rather than a registry gate, so both
   * kinds publish to the same registry and nothing at runtime reads the field.
   *
   * What is enforced here is that every published package *has* an answer, and
   * never which answer it has: which modules are paid is a product decision
   * nobody has taken, and a check that preferred one value would be taking it.
   */
  it('reports a public package that declares no licence', () => {
    const found = findings(
      publishedAlphaAs((manifest) => {
        delete manifest['license'];
      }),
    );
    expect(kinds(found)).toContain('unlicensed-package');
  });

  /**
   * And the way it arrives from somebody who thought they had answered. npm
   * reads `""` exactly as it reads an absent field, so a blank licence states
   * no terms while looking as though it states some — which is the worse of the
   * two states, because it survives a reader's glance.
   */
  it('reads an empty or whitespace licence as no licence at all', () => {
    for (const value of ['', '   ']) {
      const found = findings(
        publishedAlphaAs((manifest) => {
          manifest['license'] = value;
        }),
      );
      expect(kinds(found)).toContain('unlicensed-package');
    }
  });

  it('does not report a package that declares one', () => {
    expect(kinds(findings(PUBLISHED_ALPHA))).not.toContain('unlicensed-package');
  });

  /**
   * A **private** versionable package is outside this rule, and that is the
   * same population every other fitness question uses rather than a carve-out:
   * `changeset publish` skips it, so it reaches no consumer and owes none a
   * licence. It has a finding of its own — `unpublished-package` — and two
   * findings for one package would be two numbers waiting to disagree about
   * what is wrong with it.
   */
  it('does not report a private versionable package', () => {
    const found = findings(PRIVATE_BETA);
    expect(kinds(found)).toContain('unpublished-package');
    expect(found.filter((f) => f.subject === '@fx/beta').map((f) => f.kind)).not.toContain(
      'unlicensed-package',
    );
  });

  /**
   * The paid half, and the only licence value that makes a **second** claim.
   * `SEE LICENSE IN <file>` is SPDX's spelling for terms that are not a
   * standard identifier, and it names a file: without that file the consumer is
   * pointed at nothing, and the package is less informative than one carrying
   * no licence at all, because a scanner reads the field as answered.
   */
  it('reports a `SEE LICENSE IN` licence whose file is not in the package', () => {
    const found = findings(
      publishedAlphaAs((manifest) => {
        manifest['license'] = 'SEE LICENSE IN LICENSE.md';
      }),
    );
    expect(kinds(found)).toContain('unresolvable-license-file');
    expect(kinds(found)).not.toContain('unlicensed-package');
  });

  it('does not report one whose file is there', () => {
    const found = findings({
      ...publishedAlphaAs((manifest) => {
        manifest['license'] = 'SEE LICENSE IN LICENSE.md';
      }),
      'packages/alpha/LICENSE.md': 'Proprietary. All rights reserved.\n',
    });
    expect(kinds(found)).not.toContain('unresolvable-license-file');
    expect(kinds(found)).not.toContain('unlicensed-package');
  });

  /**
   * The vocabulary is deliberately not judged. An SPDX identifier list is a
   * derived fact written down (D-100) that moves without this repository, and
   * `UNLICENSED` is a legitimate npm value meaning "you may not use this" —
   * refusing it would be this check taking a licensing decision.
   */
  it('says nothing about which identifier a package chose', () => {
    for (const value of ['MIT', 'Apache-2.0', 'UNLICENSED', 'MIT OR Apache-2.0']) {
      const found = findings(
        publishedAlphaAs((manifest) => {
          manifest['license'] = value;
        }),
      );
      expect(kinds(found)).not.toContain('unlicensed-package');
      expect(kinds(found)).not.toContain('unresolvable-license-file');
    }
  });
});

describe('check-release-intent — a scope the registry can serve', () => {
  /**
   * R2/R2.1: the instance endpoint turns a **scope** into a top-level namespace
   * path, and a scope that resolves to none is not an error — the request is
   * forwarded to npmjs and the client is told the package is not in the npm
   * registry. Every case below is therefore invisible to any install anyone
   * could run, which is why they are static findings.
   */
  it('reports an unscoped public package', () => {
    const found = findings({
      ...PUBLISHED_ALPHA,
      'apps/host/package.json': JSON.stringify({
        name: 'host',
        version: '0.0.0',
        private: true,
        scripts: { build: 'next build' },
        dependencies: { next: '^15.0.0', alpha: 'workspace:*' },
      }),
      'packages/alpha/package.json': JSON.stringify({
        name: 'alpha',
        version: '1.0.0',
        repository: { url: 'https://example.invalid/fx.git' },
        publishConfig: { access: 'public' },
      }),
    });
    expect(kinds(found)).toContain('unresolvable-scope');
    expect(found.find((f) => f.kind === 'unresolvable-scope')?.message).toContain('unscoped');
  });

  it('reports a scope GitLab reserves as a top-level route', () => {
    const found = findings({
      ...PUBLISHED_ALPHA,
      'apps/host/package.json': JSON.stringify({
        name: 'host',
        version: '0.0.0',
        private: true,
        scripts: { build: 'next build' },
        dependencies: { next: '^15.0.0', '@api/alpha': 'workspace:*' },
      }),
      'packages/alpha/package.json': JSON.stringify({
        name: '@api/alpha',
        version: '1.0.0',
        repository: { url: 'https://example.invalid/fx.git' },
        publishConfig: { access: 'public' },
      }),
    });
    expect(found.find((f) => f.kind === 'unresolvable-scope')?.message).toContain('reserved');
  });

  it('reports a scope that is not spellable as a namespace path', () => {
    expect(unservableScope('@fx~one/alpha')).toContain('namespace path');
    expect(unservableScope('@fx.git/alpha')).toContain('`.git`');
    expect(unservableScope('@endora-commerce/contracts')).toBeNull();
  });

  /**
   * The client holds one `.npmrc` line per scope (R3) and the scaffold writes
   * one, so a second scope resolves through whatever the client's default
   * registry is — which serves none of them, in the same sentence as a package
   * that does not exist.
   */
  it('reports two public packages published under two scopes', () => {
    const found = findings({
      ...PUBLISHED_ALPHA,
      'apps/host/package.json': JSON.stringify({
        name: 'host',
        version: '0.0.0',
        private: true,
        scripts: { build: 'next build' },
        dependencies: { next: '^15.0.0', '@fx/alpha': 'workspace:*', '@other/beta': 'workspace:*' },
      }),
      'packages/beta/package.json': JSON.stringify({
        name: '@other/beta',
        version: '1.0.0',
        repository: { url: 'https://example.invalid/fx.git' },
        publishConfig: { access: 'public' },
      }),
    });
    expect(found.find((f) => f.kind === 'unresolvable-scope')?.subject).toBe('fx, other');
  });
});

describe('check-release-intent — the tag policy, in both states', () => {
  it('reports tagging turned on while a versionable package is private', () => {
    const found = findings({
      ...PRIVATE_BETA,
      ...configuredAs((config) => {
        config['privatePackages'] = { version: true, tag: true };
      }),
    });
    expect(kinds(found)).toContain('tag-policy-unstated');
  });

  /**
   * **The regression the old rule had built into it.** `tag-without-publication`
   * asked its question under `privateVersionable.length === versionable.length`,
   * so the first public package made it stop firing in *either* direction and
   * nothing then held `privatePackages.tag` at all — the estate's own failure,
   * a check that quietly stops asking, arriving through the repair that made
   * three packages public. In the mixed state the private remainder is still
   * tagged, so the rule still has a subject.
   */
  it('keeps asking in the mixed state, where the old rule went quiet', () => {
    const found = findings({
      ...PUBLISHED_ALPHA,
      // The mixed state itself: one public package and one private remainder.
      ...PRIVATE_BETA,
      ...configuredAs((config) => {
        config['privatePackages'] = { version: true, tag: true };
      }),
    });
    expect(kinds(found)).toContain('tag-policy-unstated');
    expect(found.find((f) => f.kind === 'tag-policy-unstated')?.message).toContain(
      'versionable package(s) are private',
    );
  });

  /**
   * The other state, and the reason the rule is *total*: once no versionable
   * package is private the field governs nothing — `changeset publish` tags a
   * public package whatever it says — so an absent field is the
   * `@changesets/config@4` default rather than anybody's decision. There is no
   * configuration of that field, in either state, for which no rule applies.
   */
  it('reports an unstated tag policy once nothing versionable is private', () => {
    const found = findings({
      ...PUBLISHED_ALPHA,
      ...configuredAs((config) => {
        config['privatePackages'] = { version: true };
      }),
    });
    expect(kinds(found)).toContain('tag-policy-unstated');
    expect(found.find((f) => f.kind === 'tag-policy-unstated')?.message).toContain('is not stated');
  });

  it('accepts a stated policy in that state, whichever way it is stated', () => {
    const allPublic = (tag: boolean): FileMap => ({
      ...PUBLISHED_ALPHA,
      'packages/beta/package.json': JSON.stringify({
        name: '@fx/beta',
        version: '1.0.0',
        repository: { url: 'https://example.invalid/fx.git' },
        publishConfig: { access: 'public' },
      }),
      'apps/host/package.json': JSON.stringify({
        name: 'host',
        version: '0.0.0',
        private: true,
        scripts: { build: 'next build' },
        dependencies: { next: '^15.0.0', '@fx/alpha': 'workspace:*', '@fx/beta': 'workspace:*' },
      }),
      ...configuredAs((config) => {
        config['privatePackages'] = { version: true, tag };
      }),
    });
    expect(kinds(findings(allPublic(true)))).not.toContain('tag-policy-unstated');
    expect(kinds(findings(allPublic(false)))).not.toContain('tag-policy-unstated');
  });
});


describe('check-release-intent — the ignore list, both directions', () => {
  /**
   * The 67-package failure mode, written as it would actually arrive: one
   * `ignore` entry under the new scope, and every module package silently
   * stops needing a changeset while `changeset status` goes on exiting 0.
   */
  it('reports a scope-wide ignore that swallows a library family', () => {
    const found = findings(
      configuredAs((config) => {
        config['ignore'] = ['host', '@fx/*'];
      }),
    );
    expect(kinds(found).filter((kind) => kind === 'ignored-family-member')).toHaveLength(2);
  });

  it('reports an application that no ignore pattern covers', () => {
    const found = findings(
      configuredAs((config) => {
        config['ignore'] = [];
      }),
    );
    expect(kinds(found)).toContain('unignored-application');
    expect(found.find((f) => f.kind === 'unignored-application')?.subject).toBe('host');
  });

  it('reports an ignore entry that matches no package at all', () => {
    const found = findings(
      configuredAs((config) => {
        // A path written where a name belongs. `ignore` is glob-matched against
        // names, so this matches nothing and `host` stops being ignored — which
        // is the second finding, and the reason a typo here fails safe.
        config['ignore'] = ['packages/*'];
      }),
    );
    expect(kinds(found)).toContain('stale-ignore-entry');
    expect(kinds(found)).toContain('unignored-application');
  });

  /**
   * A member matched by both a literal entry and a family glob counts as
   * family. That is the failing-safe direction — a versionable package demands
   * a changeset and an ignored one demands nothing — and a fixture is the only
   * thing that keeps it from being flipped by a plausible-looking edit.
   */
  it('treats a member matched by both a literal and a glob entry as family', () => {
    const found = findings({
      'pnpm-workspace.yaml': 'packages:\n  - apps/host\n  - packages/alpha\n  - packages/*\n',
      ...configuredAs((config) => {
        config['ignore'] = ['host', '@fx/alpha'];
      }),
    });
    expect(kinds(found)).toContain('ignored-family-member');
    expect(kinds(found)).not.toContain('unignored-application');
  });
});

describe('check-release-intent — groups and written intent', () => {
  it('reports a linked group naming a package that is not a member', () => {
    const found = findings(
      configuredAs((config) => {
        config['linked'] = [['@fx/alpha', '@fx/gone']];
      }),
    );
    expect(kinds(found)).toContain('stale-group-member');
    expect(found.find((f) => f.kind === 'stale-group-member')?.subject).toBe('@fx/gone');
  });

  it('reads `fixed` groups as well as `linked` ones', () => {
    const found = findings(
      configuredAs((config) => {
        config['fixed'] = [['@fx/absent']];
      }),
    );
    expect(found.find((f) => f.kind === 'stale-group-member')?.subject).toBe('@fx/absent');
  });

  it('reports a changeset naming a package that is not a member', () => {
    const found = findings({ '.changeset/x.md': '---\n"@fx/nope": minor\n---\n\nsomething\n' });
    expect(kinds(found)).toContain('unversionable-changeset');
  });

  it('reports a changeset naming an ignored package, whose bump will never apply', () => {
    const found = findings({ '.changeset/x.md': '---\n"host": minor\n---\n\nsomething\n' });
    expect(kinds(found)).toContain('unversionable-changeset');
  });

  /**
   * An empty changeset — `pnpm changeset --empty` — names no package and is the
   * sanctioned way to say "no release meaning". It must not be a finding, or
   * the escape hatch the whole gate depends on becomes unusable.
   */
  it('does not report an empty changeset', () => {
    expect(findings({ '.changeset/x.md': '---\n---\n\n' })).toEqual([]);
  });

  it('reads the front matter and not the prose below it', () => {
    const releases = parseChangeset(
      'x.md',
      '---\n"@fx/alpha": minor\n---\n\nRenamed `thing: patch` in the docs, see @fx/beta: no change.\n',
    );
    expect(releases).toEqual([{ file: 'x.md', packageName: '@fx/alpha', bump: 'minor' }]);
  });
});

/**
 * D-225, FR-017. No package leaves `0.x` before the move to public npmjs, and
 * the rule is refused rather than remembered because the failure is **silent**:
 * a `major` changeset sits in `.changeset/` for weeks and is applied by a
 * release nobody is watching. `changeset status` reports it as ordinary intent,
 * and nothing else in the repository reads a bump level at all.
 *
 * The discrimination is the whole rule — the predicate is derived **per
 * package**, from that package's own `version` — so the first two proofs are
 * one changeset over two manifests. The fixture's default is `1.0.0`, which is
 * why the `0.x` case is the override: a fixture whose default were `0.x` would
 * leave the negative unproven, and a check that reported *every* `major` would
 * pass every positive proof in this file.
 */
describe('check-release-intent — the series stays in `0.x` (D-225)', () => {
  const ZERO_SERIES: FileMap = {
    'packages/alpha/package.json': JSON.stringify({
      name: '@fx/alpha',
      version: '0.7.0',
      license: 'MIT',
      repository: { type: 'git', url: 'https://example.invalid/fx.git', directory: 'packages/alpha' },
      publishConfig: { access: 'public' },
    }),
  };

  const MAJOR_CHANGESET: FileMap = {
    '.changeset/x.md': '---\n"@fx/alpha": major\n---\n\nThe port takes an id, not an entity.\n',
  };

  it('reports a `major` declared for a package whose own version is `0.y.z` (A12)', () => {
    const found = findings({ ...ZERO_SERIES, ...MAJOR_CHANGESET });
    expect(kinds(found)).toContain('major-bump-in-a-zero-series');
    const finding = found.find((entry) => entry.kind === 'major-bump-in-a-zero-series');
    expect(finding?.subject).toBe('x.md:@fx/alpha');
    // The message has to carry the remedy and the ruling, because there is no
    // ledger and no override: the escape is deletion, in the merge request that
    // performs the npmjs move.
    expect(finding?.message).toContain('D-225');
    expect(finding?.message).toContain('0.7.0');
  });

  it('reports nothing for the same `major` on a package at `1.y.z` (A13)', () => {
    // The default fixture's packages are at `1.0.0`. One changeset, one
    // manifest changed between the two cases, opposite verdicts.
    expect(kinds(findings(MAJOR_CHANGESET))).not.toContain('major-bump-in-a-zero-series');
  });

  it('judges a mixed estate package by package, not estate-wide', () => {
    const found = findings({
      ...ZERO_SERIES,
      '.changeset/x.md': '---\n"@fx/alpha": major\n"@fx/beta": major\n---\n\nboth\n',
    });
    // `@fx/beta` is still at `1.0.0`, so it is not judged — which is the same
    // derivation that retires this rule one package at a time when the npmjs
    // move happens.
    expect(
      found
        .filter((entry) => entry.kind === 'major-bump-in-a-zero-series')
        .map((entry) => entry.subject),
    ).toEqual(['x.md:@fx/alpha']);
  });

  it('leaves `minor` and `patch` alone in the same series', () => {
    const found = findings({
      ...ZERO_SERIES,
      '.changeset/x.md': '---\n"@fx/alpha": minor\n---\n\nbody\n',
      '.changeset/y.md': '---\n"@fx/alpha": patch\n---\n\nbody\n',
    });
    expect(kinds(found)).not.toContain('major-bump-in-a-zero-series');
  });

  /**
   * A15, and the trap this task was written around. `parseChangeset` returns
   * `[]` for an empty changeset **correctly**, so a refusal keyed on *"the front
   * matter yielded no entry"* refuses every one of them — ten of the eighty-four
   * files pending when this landed. The discriminator is the presence of the
   * `---` delimiters, not the entry count.
   */
  it('leaves an empty changeset alone — no finding and no refusal (A15)', () => {
    const tree = checkout({
      ...ZERO_SERIES,
      '.changeset/empty.md': '---\n---\n\nThis change carries no release meaning.\n',
    });
    const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in result) throw new Error(`expected a verdict, got a refusal: ${result.reason}`);
    expect(result.findings).toEqual([]);
  });

  it('tells an empty changeset from a file with no front matter at all', () => {
    expect(readChangesetDocument('empty.md', '---\n---\n\nbody\n')).toEqual({
      file: 'empty.md',
      hasFrontMatter: true,
      frontMatterLines: 0,
      releases: [],
      // The closing `---` is matched without its newline, so the body starts
      // with it. Recorded as it is rather than trimmed: what R3 reads is the
      // text, and a reader of this assertion should see the same bytes.
      body: '\n\nbody\n',
    });
    // The body of a file with no delimiters is the whole source — R3 reads
    // prose, and a file the front-matter reader cannot parse is exactly the one
    // whose prose nobody has looked at. The two questions stay apart:
    // `hasFrontMatter` is still `false` and still carries its own refusal.
    expect(readChangesetDocument('prose.md', 'just a summary, no delimiters\n')).toEqual({
      file: 'prose.md',
      hasFrontMatter: false,
      frontMatterLines: 0,
      releases: [],
      body: 'just a summary, no delimiters\n',
    });
  });

  /**
   * The closing delimiter is the **first** line that is exactly `---` after the
   * opening one, so a horizontal rule in the summary is body text and not a
   * second block.
   */
  it('does not read a `---` in the summary as a front-matter delimiter', () => {
    const document = readChangesetDocument(
      'x.md',
      '---\n"@fx/alpha": major\n---\n\nbefore\n\n---\n\n"@fx/beta": major\n',
    );
    expect(document.releases).toEqual([{ file: 'x.md', packageName: '@fx/alpha', bump: 'major' }]);
  });
});

describe('check-release-intent — four ways the series rule refuses (FR-017)', () => {
  /**
   * A14's first half, and a correction to FR-017: this refusal was recorded
   * there as one the check already made, and it was not. `checkBranchIntent`
   * refuses a workspace with no versionable package because the `--since` mode
   * has no published surface to attribute a diff to; the default mode had no
   * such refusal, so a workspace of nothing but applications answered every
   * question above — this one included — vacuously clean.
   */
  it('refuses a workspace with no versionable package at all', () => {
    expect(
      refusal({
        'pnpm-workspace.yaml': 'packages:\n  - apps/host\n',
        'packages/alpha/package.json': null,
        'packages/beta/package.json': null,
      }),
    ).toContain('no versionable package');
  });

  /**
   * And the discrimination that keeps that refusal from eating this check's
   * most valuable finding. A family every `ignore` pattern swallows is the
   * 67-package failure mode — `ignored-family-member` — and not a workspace
   * with no library in it, so the refusal is keyed on the family and not on
   * "family and not ignored". Measured the other way round, this configuration
   * refused and the finding disappeared.
   */
  it('reports a family swallowed by `ignore` rather than refusing for want of a package', () => {
    const found = findings(
      configuredAs((config) => {
        config['ignore'] = ['host', '@fx/*'];
      }),
    );
    expect(kinds(found)).toContain('ignored-family-member');
  });

  /**
   * Issue #113: reading a file this check cannot parse as *"no `major` declared
   * here"* agrees with the defect.
   */
  it('refuses a changeset file that carries no `---` front-matter block', () => {
    expect(refusal({ '.changeset/x.md': 'a summary with no front matter at all\n' })).toContain(
      'no `---` front-matter block',
    );
  });

  it('refuses an entry naming a package whose `version` has no readable major', () => {
    expect(
      refusal({
        'packages/alpha/package.json': JSON.stringify({
          name: '@fx/alpha',
          version: 'nightly',
          license: 'MIT',
          repository: { url: 'https://example.invalid/fx.git' },
          publishConfig: { access: 'public' },
        }),
        '.changeset/x.md': '---\n"@fx/alpha": minor\n---\n\nbody\n',
      }),
    ).toContain('which series');
  });

  it('refuses a manifest that declares no `version` at all, rather than reading it as not `0.x`', () => {
    expect(
      refusal({
        'packages/alpha/package.json': JSON.stringify({
          name: '@fx/alpha',
          license: 'MIT',
          repository: { url: 'https://example.invalid/fx.git' },
          publishConfig: { access: 'public' },
        }),
        '.changeset/x.md': '---\n"@fx/alpha": major\n---\n\nbody\n',
      }),
    ).toContain('no `version`');
  });

  /**
   * Issue #237's shape over this population: the walk opened the files and the
   * **entry reader** produced nothing. It is keyed on the front-matter lines
   * rather than on the files, because a tree of nothing but empty changesets
   * yields zero entries honestly and must not refuse.
   */
  it('refuses front-matter text that parsed to no entry at all', () => {
    expect(
      refusal({ '.changeset/x.md': '---\nthis is not an entry line at all\n---\n\nbody\n' }),
    ).toContain('gone blind');
  });

  it('does not refuse a tree whose only changesets are empty ones', () => {
    const tree = checkout({
      '.changeset/a.md': '---\n---\n\none\n',
      '.changeset/b.md': '---\n---\n\ntwo\n',
    });
    const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    expect('reason' in result ? result.reason : result.findings).toEqual([]);
  });

  /**
   * The ordering is the design. A library tree that moved leaves no versionable
   * package either, and issue #215's floor is the more specific diagnosis of
   * that tree — so the series refusals are asked **after** it, or a workspace
   * whose only defect is one glob that stopped resolving would be told it has
   * no versionable package.
   */
  it('still answers a short walk with the short walk, not with the series refusal', () => {
    expect(
      refusal({ 'packages/alpha/package.json': null, 'packages/beta/package.json': null }),
    ).toContain('residue of its population');
  });
});

describe('check-release-intent — eight ways it refuses to report on what it did not read', () => {
  it('refuses a missing `.changeset/config.json`', () => {
    expect(refusal({ '.changeset/config.json': null })).toContain('missing');
  });

  it('refuses a `.changeset/config.json` that does not parse', () => {
    expect(refusal({ '.changeset/config.json': '{ nope' })).toContain('does not parse');
  });

  /**
   * `workspace-packages.ts` is a block-sequence reader, so a flow-style list
   * yields no globs. That must be a refusal and not an empty workspace: an
   * empty one makes every question above vacuously true.
   */
  it('refuses a flow-style `pnpm-workspace.yaml`', () => {
    expect(refusal({ 'pnpm-workspace.yaml': 'packages: [apps/host, packages/*]\n' })).toContain(
      'no `packages:` entries',
    );
  });

  it('refuses a workspace whose globs match no package', () => {
    expect(
      refusal({
        'apps/host/package.json': null,
        'packages/alpha/package.json': null,
        'packages/beta/package.json': null,
      }),
    ).toContain('matched no package');
  });

  /**
   * Issue #215 over this population. The library tree moving does not empty the
   * walk — the application manifests are still there, and every predicate above
   * still answers over them — so the floor is per workspace entry.
   */
  it('refuses when one workspace entry produced no member — the short walk', () => {
    expect(
      refusal({ 'packages/alpha/package.json': null, 'packages/beta/package.json': null }),
    ).toContain('residue of its population');
  });

  it('refuses an ignore pattern in a grammar it does not implement', () => {
    expect(
      refusal(
        configuredAs((config) => {
          config['ignore'] = ['{backend,admin}'];
        }),
      ),
    ).toContain('glob grammar');
  });

  /**
   * Feature 104's two went with the closure they guarded (the ruling of
   * 2026-09-05): *which packages may be public* had a constant answer, so a
   * checkout with no reference storefront — or two — has nothing left to be
   * undecidable about, and this check no longer reads the application's
   * dependency graph at all.
   *
   * Asserted as the **retirement** rather than deleted in silence, because a
   * refusal that stopped firing and a refusal that was removed look identical
   * in a green run. A checkout with no Next application answers every remaining
   * predicate, so it is a clean run and not a refusal.
   */
  it('does not refuse a checkout with no reference storefront', () => {
    expect(
      findings({
        ...PUBLISHED_ALPHA,
        'apps/host/package.json': '{ "name": "host", "version": "0.0.0", "private": true }',
      }),
    ).toEqual([]);
  });

  it('does not refuse a checkout with two of them', () => {
    expect(
      findings({
        ...PUBLISHED_ALPHA,
        'packages/beta/package.json': JSON.stringify({
          name: '@fx/beta',
          version: '1.0.0',
          license: 'MIT',
          repository: { url: 'https://example.invalid/fx.git' },
          publishConfig: { access: 'public' },
          scripts: { build: 'next build' },
          dependencies: { next: '^15.0.0' },
        }),
      }),
    ).toEqual([]);
  });
});

describe('check-release-intent — the pattern reader', () => {
  /**
   * `@` and `+` are metacharacters in micromatch **only** before a `(`. A
   * reader that refused them outright would refuse `@endora-commerce/*`, which
   * is precisely the pattern the most valuable finding exists to catch — and
   * an exit 2 an author clears by removing the check from the job.
   */
  it('reads a scope wildcard, which is what the 67-package case looks like', () => {
    expect(unreadablePattern(['@endora-commerce/*'])).toBeNull();
    expect(matchesPattern('@endora-commerce/*', '@endora-commerce/blog')).toBe(true);
    // The negative case has to be a name in *another* scope, and `@endora/` is
    // the one that matters: it is reserved for the company's other npm packages
    // (D-153, D-161), so a reader that matched across the hyphen would ignore a
    // package this repository does not own. It used to be `@b2b/contracts` —
    // this workspace's own second scope until T042e renamed the five packages,
    // which left the assertion with no scope to be other than.
    expect(matchesPattern('@endora-commerce/*', '@endora/contracts')).toBe(false);
  });

  it('matches across the scope separator, because a name is not a path', () => {
    expect(matchesPattern('@fx/*', '@fx/alpha')).toBe(true);
    expect(matchesPattern('*', 'anything')).toBe(true);
  });

  it('names the constructs it cannot read rather than matching them badly', () => {
    expect(unreadablePattern(['a{b,c}'])).toBe('a{b,c}');
    expect(unreadablePattern(['!backend'])).toBe('!backend');
    expect(unreadablePattern(['@(a|b)'])).toBe('@(a|b)');
    expect(unreadablePattern(['[ab]'])).toBe('[ab]');
  });
});

describe('check-release-intent — what it reads, beside what it finds', () => {
  it('counts the files it opened and the decisions it took inside them', () => {
    const tree = checkout({ '.changeset/x.md': '---\n"@fx/alpha": minor\n---\n\nsomething\n' });
    const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in result) throw new Error(result.reason);
    // config.json + pnpm-workspace.yaml + three manifests. **Not the changeset**
    // — see the pair below.
    expect(result.inputs.files).toBe(5);
    // three members, one ignore pattern, two linked members, two settings —
    // plus, since the ruling of 2026-09-05, one publication decision per
    // versionable member (2) and four fitness decisions per public one (8),
    // with one more for the scope agreement across the set. The fourth fitness
    // decision is the licensing ruling of 2026-09-06: is this package licensed,
    // and — for the one licence form that names a file — is that file there.
    expect(result.sites).toBe(19);
    expect(result.coverage).toEqual([
      { source: 'workspace-globs', expected: 2, covered: 2 },
      // The changeset names one subject, so the second author is on the line.
      { source: 'changeset-subjects', expected: 1, covered: 1 },
    ]);
  });

  /**
   * T3-G. After a release `.changeset/` holds `config.json` and `README.md` and
   * nothing else, and `read-size.ts` refuses `expected=0` as `no-expectation` —
   * so a token printed `0/0` would exit 2 on **every post-release tree**, which
   * is a refusal about the calendar rather than about the tree.
   * `check:action-route-permissions`' `emitted-manifests` is the precedent for
   * both halves: present when there is a population, absent when there is not.
   */
  it('omits `changeset-subjects` rather than printing `0/0` when no changeset names a subject', () => {
    const tree = checkout();
    const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in result) throw new Error(result.reason);
    expect(result.coverage.map((entry) => entry.source)).toEqual(['workspace-globs']);
  });

  /**
   * An empty changeset names no subject, so a tree of nothing but empty ones is
   * the post-release state as far as this token is concerned — and it must not
   * refuse there either.
   */
  it('omits it for a tree of empty changesets, which name nothing', () => {
    const tree = checkout({ '.changeset/x.md': '---\n---\n\nno release meaning\n' });
    const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in result) throw new Error(result.reason);
    expect(result.coverage.map((entry) => entry.source)).toEqual(['workspace-globs']);
  });

  /**
   * The token counts **distinct names**, not entries: it is the reconciliation
   * of what the changeset authors wrote against the members the workspace globs
   * produce, and one package named by two changesets is one subject.
   */
  it('counts the distinct subjects the changesets name, not the entries', () => {
    const tree = checkout({
      '.changeset/a.md': '---\n"@fx/alpha": minor\n"@fx/beta": patch\n---\n\none\n',
      '.changeset/b.md': '---\n"@fx/alpha": patch\n---\n\ntwo\n',
    });
    const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in result) throw new Error(result.reason);
    expect(result.coverage).toContainEqual({
      source: 'changeset-subjects',
      expected: 2,
      covered: 2,
    });
  });

  /**
   * The reported size must not move with the number of pending changesets, and
   * this pair is why the numbers above are what they are.
   *
   * Both counts used to fold in `.changeset/*.md`, whose population follows the
   * release cycle rather than the repository. Measured on `a059e56e`: at 30
   * pending changesets `files` was 51, sitting exactly on its recorded band's
   * +50% ceiling, so the next merge request to add one failed — and a release
   * consuming all thirty would have dropped it to 17, under the −10% floor, in
   * the same week. A band cannot bound a quantity that oscillates in both
   * directions.
   *
   * The changesets are still read and still judged; they are reported beside
   * these numbers as `changesets=`, which is the figure that is *supposed* to
   * move with the release cycle.
   */
  it('reports the same size whether there are no changesets or many', () => {
    const size = (files: Record<string, string>): { files: number; sites: number } => {
      const tree = checkout(files);
      const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
      if ('reason' in result) throw new Error(result.reason);
      return { files: result.inputs.files, sites: result.sites };
    };

    const none = size({});
    const many = size(
      Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          `.changeset/c${i}.md`,
          '---\n"@fx/alpha": patch\n---\n\nsomething\n',
        ]),
      ),
    );

    expect(many).toEqual(none);
  });

  it('still reads the changesets it does not count', () => {
    const tree = checkout({
      '.changeset/a.md': '---\n"@fx/alpha": minor\n---\n\none\n',
      '.changeset/b.md': '---\n"@fx/alpha": patch\n---\n\ntwo\n',
    });
    const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in result) throw new Error(result.reason);
    // Excluding them from the reported size must not turn into not reading
    // them, which is the failure this whole read-size discipline exists for.
    expect(result.inputs.changesets).toHaveLength(2);
  });
});

describe('the release-gate suite is still run by something', () => {
  /**
   * `backend/test/release/` is excluded from both backend vitest configs
   * because it needs **git**, which `node:22.18-slim` does not ship — so its
   * one caller is a line in `release:changeset`. A root nothing runs is a test
   * file that has quietly stopped being a gate, and it would look exactly like
   * a green pipeline. This is the two-way link, in a suite that runs on every
   * merge request regardless of what the diff touches.
   */
  it('is named by the `release:changeset` job', () => {
    const ci = readFileSync(`${REPO_ROOT}.gitlab-ci.yml`, 'utf8');
    expect(ci).toContain('pnpm --filter backend run test:release-gate');
  });

  it('has a config, a script and at least one file to run', () => {
    const scripts = JSON.parse(
      readFileSync(`${REPO_ROOT}backend/package.json`, 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(scripts.scripts['test:release-gate']).toContain('vitest.release.config.ts');
    expect(
      readdirSync(`${REPO_ROOT}backend/test/release`).filter((name) => name.endsWith('.test.ts')),
    ).not.toEqual([]);
  });
});

describe('check-release-intent — the analysis is pure over what the reader produced', () => {
  /**
   * The CLI and every proof above run one function over one shape. This asserts
   * the seam itself, so a future refactor cannot leave the CLI analysing
   * something the proofs never see.
   */
  it('gives the same findings through the reader as through the whole check', () => {
    const overrides = configuredAs((config) => {
      config['privatePackages'] = { version: false, tag: false };
    });
    const tree = checkout(overrides);
    const inputs = readReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in inputs) throw new Error(inputs.reason);
    expect(kinds(analyzeReleaseIntent(inputs))).toEqual(kinds(findings(overrides)));
  });

  it('collects every group member from both `linked` and `fixed`', () => {
    expect(groupMembers({ linked: [['a', 'b']], fixed: [['c']] })).toEqual(['a', 'b', 'c']);
    expect(groupMembers({})).toEqual([]);
  });
});

/**
 * `--since` — the finding `changeset status` structurally cannot produce.
 *
 * The CLI attributes a changed file to a package by the package's own
 * directory. `@endora-commerce/platform` compiles `backend/src`, so on !891's
 * branch a commit editing a file the host publishes exits 0 and a commit editing
 * `packages/platform/README.md`, which ships in nothing, exits 1. The fixture
 * reproduces that shape as a *configuration* — two tsconfigs, with `include` in
 * the extended one — so the derivation under test runs rather than being handed
 * its own answer.
 */
describe('check-release-intent --since — a published surface the gate cannot see', () => {
  const diff = (
    changedPaths: readonly string[],
    addedChangesets: readonly string[] = [],
    containedInBaseline = false,
  ): BranchOptions => ({ changedPaths, addedChangesets, containedInBaseline });

  function surfaceFindings(overrides: FileMap, options: BranchOptions): readonly ReleaseIntentFinding[] {
    const fixture = branch(overrides, options);
    const result = checkBranchIntent(
      FIXTURE_ROOT,
      fixture.tree.fs,
      fixture.tree.listChangesets,
      fixture.paths,
      fixture.probe,
    );
    if ('contained' in result) throw new Error('expected a verdict, got a containment answer');
    if ('reason' in result) throw new Error(`expected a verdict, got a refusal: ${result.reason}`);
    return result.findings;
  }

  function surfaceRefusal(overrides: FileMap, options: BranchOptions): string {
    const fixture = branch(overrides, options);
    const result = checkBranchIntent(
      FIXTURE_ROOT,
      fixture.tree.fs,
      fixture.tree.listChangesets,
      fixture.paths,
      fixture.probe,
    );
    if (!('reason' in result)) throw new Error('expected a refusal, got a verdict');
    return result.reason;
  }

  function surfaceContainment(overrides: FileMap, options: BranchOptions): string {
    const fixture = branch(overrides, options);
    const result = checkBranchIntent(
      FIXTURE_ROOT,
      fixture.tree.fs,
      fixture.tree.listChangesets,
      fixture.paths,
      fixture.probe,
    );
    if (!('contained' in result)) throw new Error('expected a containment answer, got a verdict');
    return result.contained;
  }

  it('reports a change to a package whose sources live in an ignored application', () => {
    const found = surfaceFindings(
      HOST_SOURCED_PACKAGE,
      diff(['apps/host/src/kernel/settings/settings-cache.ts']),
    );

    expect(kinds(found)).toEqual(['unattributed-published-change']);
    expect(found[0]?.subject).toBe('@fx/beta');
    expect(found[0]?.message).toContain('apps/host/src/kernel/settings/settings-cache.ts');
  });

  it('reports nothing once the branch carries a changeset', () => {
    expect(
      surfaceFindings(
        HOST_SOURCED_PACKAGE,
        diff(['apps/host/src/kernel/settings/settings-cache.ts'], ['.changeset/a.md']),
      ),
    ).toEqual([]);
  });

  /**
   * The other half of the inversion, and why this is a *second* question rather
   * than a replacement: a change inside the package's own directory is already
   * the CLI's, and reporting it here would demand a changeset twice.
   */
  it('says nothing about a change the CLI can already attribute', () => {
    expect(surfaceFindings({}, diff(['packages/alpha/src/index.ts']))).toEqual([]);
  });

  it('says nothing about an application file no package compiles', () => {
    expect(surfaceFindings(HOST_SOURCED_PACKAGE, diff(['apps/host/src/routes/index.ts']))).toEqual([]);
  });

  /** `exclude` is part of the compilation, so a test file the build drops is not published. */
  it('honours `exclude`, so a file the build drops is not a published change', () => {
    expect(
      surfaceFindings(HOST_SOURCED_PACKAGE, diff(['apps/host/src/kernel/settings/cache.test.ts'])),
    ).toEqual([]);
  });

  it('refuses a versionable package whose build configuration it cannot read', () => {
    expect(
      surfaceRefusal({ 'packages/alpha/tsconfig.build.json': null }, diff(['apps/host/src/a.ts'])),
    ).toContain('could not be read');
  });

  it('refuses a build configuration whose `extends` chain declares no `include`', () => {
    expect(
      surfaceRefusal(
        { 'packages/alpha/tsconfig.build.json': '{ "compilerOptions": { "rootDir": "./src" } }' },
        diff(['apps/host/src/a.ts']),
      ),
    ).toContain('declare no `include`');
  });

  it('refuses an `extends` it cannot follow rather than reading it as absent', () => {
    expect(
      surfaceRefusal(
        { 'packages/alpha/tsconfig.build.json': '{ "extends": "@fx/tsconfig/base" }' },
        diff(['apps/host/src/a.ts']),
      ),
    ).toContain('not a relative path');
  });

  it('refuses a branch with an empty diff rather than reporting a vacuous pass', () => {
    expect(surfaceRefusal({}, diff([]))).toContain('changes no file at all');
  });

  /**
   * The split pipeline 11491 forced (see `ReleaseIntentContainment`): an empty
   * diff is two different facts, and only one of them is a refusal. Driven here
   * as well as over real branches in `test/release/changeset-gate.test.ts`,
   * because the branch that decides it lives at the top of the analysis and a
   * red proof has to be able to enter where a real run enters.
   */
  describe('an empty diff is two facts', () => {
    it('answers rather than refuses when the baseline already contains the branch', () => {
      const message = surfaceContainment({}, diff([], [], true));

      expect(message).toContain('already contained in `origin/master`');
      expect(message).toContain('adds no file to it');
    });

    it('keeps refusing an empty diff from a branch the baseline does not contain', () => {
      const reason = surfaceRefusal({}, diff([], [], false));

      expect(reason).toContain('changes no file at all');
      expect(reason).toContain('not already contained in `origin/master`');
    });

    /**
     * Containment is answered before anything is read, so a checkout this mode
     * could not otherwise judge — an unreadable build configuration, an empty
     * workspace — does not turn a contained branch into a refusal. There is
     * nothing to attribute either way, and the config half runs in `quality`.
     */
    it('answers containment before it reads the workspace at all', () => {
      expect(
        surfaceContainment({ 'packages/alpha/tsconfig.build.json': null }, diff([], [], true)),
      ).toContain('already contained');
    });

    /** The ref is the one that was measured against, never a name written down. */
    it('names the baseline it was given', () => {
      expect(
        surfaceContainment({}, { baseline: 'origin/release-2026-09', containedInBaseline: true }),
      ).toContain('`origin/release-2026-09`');
    });
  });
});

describe('check-release-intent --since — the derivation underneath', () => {
  it('resolves a build configuration through its `extends`', () => {
    const tree = checkout(HOST_SOURCED_PACKAGE);
    const surface = readPublishedSurface(FIXTURE_ROOT, 'packages/beta', '@fx/beta', tree.fs);
    if ('reason' in surface) throw new Error(surface.reason);

    expect(surface.include).toEqual(['apps/host/src/kernel/**/*']);
    expect(surface.exclude).toContain('apps/host/src/**/*.test.ts');
    // `dist` is never a source: a rebuilt artefact is not a published change.
    expect(surface.exclude).toContain('packages/beta/dist');
    expect(compilesPath(surface, 'apps/host/src/kernel/a.ts')).toBe(true);
    expect(compilesPath(surface, 'apps/host/src/kernel/a.test.ts')).toBe(false);
    expect(compilesPath(surface, 'apps/host/src/http/a.ts')).toBe(false);
  });

  it('reads the three tsconfig glob constructs, and a bare directory as all of it', () => {
    expect(matchesTsGlob('src/**/*', 'src/a/b/c.ts')).toBe(true);
    expect(matchesTsGlob('src/**/*', 'src/a.ts')).toBe(true);
    expect(matchesTsGlob('src/**/*', 'test/a.ts')).toBe(false);
    expect(matchesTsGlob('src/*.ts', 'src/a/b.ts')).toBe(false);
    expect(matchesTsGlob('src/*.ts', 'src/a.ts')).toBe(true);
    expect(matchesTsGlob('src/a?.ts', 'src/ab.ts')).toBe(true);
    expect(matchesTsGlob('src', 'src/a/b.ts')).toBe(true);
    expect(matchesTsGlob('src/**/*.test.ts', 'src/a/b.test.ts')).toBe(true);
    expect(matchesTsGlob('src/**/*.test.ts', 'src/a/b.ts')).toBe(false);
  });

  it('collapses `..` without asking the filesystem where the checkout is', () => {
    expect(normalizeRelative('packages/platform/../../backend/src/kernel/**/*')).toBe(
      'backend/src/kernel/**/*',
    );
    expect(normalizeRelative('packages/alpha/./src/**/*')).toBe('packages/alpha/src/**/*');
  });

  /**
   * The tree CI runs it over, so a green in the pipeline is a statement about
   * this repository: every versionable package resolves, and each publishes only
   * its own directory today — which is exactly what makes the host package's
   * arrival the change this mode exists for.
   */
  it('resolves every versionable package in this repository', () => {
    const result = checkBranchIntent(
      REPO_ROOT.replace(/\/$/, ''),
      nodeWorkspaceFs(),
      (dir) =>
        readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name),
      {
        baseline: 'origin/master',
        containedInBaseline: false,
        changedPaths: ['README.md'],
        addedChangesets: [],
        deletedChangesets: [],
      },
      // The branch changes one file at the repository root, so no versionable
      // package is touched and the artefact walk reads nothing — a reader that
      // refused every call is still right here, and saying so is what keeps this
      // case a statement about the *surfaces*. The CLI answer is stubbed clean
      // because an ordinary branch is asked one, and asking the real one would
      // make a unit test spawn a release tool.
      {
        readSide: () => null,
        askChangesetStatus: () => ({ status: 0, output: 'stubbed: this case is about surfaces' }),
      },
    );
    if ('contained' in result) throw new Error('expected a verdict, got a containment answer');
    if ('reason' in result) throw new Error(result.reason);

    expect(result.surfaces.length).toBeGreaterThan(0);
    expect(result.coverage).toEqual([
      {
        source: 'versionable-packages',
        expected: result.surfaces.length,
        covered: result.surfaces.length,
      },
    ]);
    expect(result.findings).toEqual([]);
  });
});

/**
 * `--print-publish-scope` — the derivation `publish:packages` used to keep.
 *
 * The job writes one `.npmrc` line per scope *before* `changeset publish` runs,
 * so it has to name the scope in advance. It derived it itself, with a
 * `readdir("packages")` one level deep, and that is the `build:packages`
 * single-star problem arriving a second time through a `readdir`:
 * `packages/modules` carries no `package.json`, the read threw, the `catch`
 * swallowed it, and every module package under it was invisible. Measured on the
 * tree that repaired it: 9 directories walked, one of them the parent of 70
 * members the derivation never saw.
 *
 * **A green run proves nothing about it**, which is why the proofs below are
 * shaped the way they are: the retired derivation is *correct* for the three
 * top-level public packages this repository has today, and stays correct until
 * the first module package goes public. So the discriminating fixture is a
 * checkout whose only public package sits a directory deeper, and the red proof
 * runs the retired predicate over that same fixture to show it answers nothing.
 */
describe('check-release-intent — the publish scope', () => {
  function scopeOfCheckout(overrides: Parameters<typeof checkout>[0] = {}): PublishScope {
    const tree = checkout(overrides);
    const inputs = readReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in inputs) throw new Error(`expected inputs, got a refusal: ${inputs.reason}`);
    return publishScope(inputs.members);
  }

  /**
   * The derivation exactly as `.gitlab-ci.yml` carried it, over the fixture's
   * filesystem. It is reproduced here rather than imported because it is
   * *deleted*: what this asserts is that the fixture discriminates, and a proof
   * that cannot show the old answer differing from the new one is a proof of
   * nothing.
   */
  function retiredReaddirDerivation(overrides: Parameters<typeof checkout>[0] = {}): string[] {
    const tree = checkout(overrides);
    const scopes = new Set<string>();
    for (const entry of tree.fs.listDirectories(`${FIXTURE_ROOT}/packages`)) {
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(
          tree.fs.readText(`${FIXTURE_ROOT}/packages/${entry}/package.json`) ?? 'null',
        ) as Record<string, unknown>;
      } catch {
        continue;
      }
      // The `catch` above is the one that swallowed `packages/modules`; a `null`
      // parse is the same absence arriving without a throw.
      if (manifest === null || manifest['private'] === true) continue;
      const name = manifest['name'];
      if (typeof name === 'string' && name.startsWith('@')) scopes.add(name.split('/')[0]!);
    }
    return [...scopes].sort();
  }

  it('resolves the scope of the public packages', () => {
    const resolved = scopeOfCheckout(PUBLISHED_ALPHA);
    expect(resolved.refusal).toBe('');
    expect(resolved.scope).toBe('fx');
    // Both, since the ruling of 2026-09-05 made public the fixture's default:
    // the scope is derived from every package that would be published, and a
    // derivation that named only the one an application depends on is the
    // closure this check stopped consulting.
    expect(resolved.packages).toEqual(['@fx/alpha', '@fx/beta']);
  });

  /** The red proof: the shape that was broken, and the two answers over it. */
  it('sees a public package a second workspace glob puts a directory deeper', () => {
    const resolved = scopeOfCheckout(NESTED_FAMILY_PACKAGE);
    expect(resolved.refusal).toBe('');
    expect(resolved.scope).toBe('fx');
    expect(resolved.packages).toEqual(['@fx/gamma']);
  });

  it('is the answer the retired one-level `readdir` could not give', () => {
    // Same checkout, same filesystem, the derivation this branch deleted: the
    // nested member is not under `packages/<name>/package.json`, so it is not
    // seen, and the job would have authenticated for no scope at all.
    expect(retiredReaddirDerivation(NESTED_FAMILY_PACKAGE)).toEqual([]);
    // While the top-level shape it *was* written for still answers, which is
    // why nothing in this repository has gone wrong yet.
    expect(retiredReaddirDerivation(PUBLISHED_ALPHA)).toEqual(['@fx']);
  });

  it('refuses an empty member set rather than resolving a scope over nothing', () => {
    // The CLI mode cannot reach this through a real checkout — `readReleaseIntent`
    // refuses a `pnpm-workspace.yaml` that yields no entry first, and the mode
    // exits 2 on that refusal, which is asserted below. The branch is here
    // because `publishScope` is exported and a second caller would otherwise
    // resolve a scope over an empty population.
    const resolved = publishScope([]);
    expect(resolved.scope).toBeNull();
    expect(resolved.refusal).toContain('no member at all');
  });

  it('is refused upstream for a workspace that declares no member', () => {
    // A flow-style `packages:` list reads as no entry (`lib/workspace-packages.ts`).
    const tree = checkout({ 'pnpm-workspace.yaml': 'packages: [apps/host, packages/*]\n' });
    const inputs = readReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    expect('reason' in inputs ? inputs.reason : '').toContain('no `packages:` entries');
  });

  it('refuses a checkout in which nothing is public', () => {
    // Explicitly all-private, since the fixture's default is now the compliant
    // shape. The refusal is what stops the publish job authenticating against a
    // scope it derived from nothing — it survives the ruling unchanged, because
    // a workspace *can* still be all-private and this mode must not guess.
    const resolved = scopeOfCheckout({
      'packages/alpha/package.json': '{ "name": "@fx/alpha", "version": "1.0.0", "private": true }',
      'packages/beta/package.json': '{ "name": "@fx/beta", "version": "1.0.0", "private": true }',
    });
    expect(resolved.scope).toBeNull();
    expect(resolved.refusal).toContain('no versionable package is public');
  });

  it('refuses a public package with no scope, rather than skipping it', () => {
    const resolved = scopeOfCheckout(
      publishedAlphaAs((manifest) => {
        manifest['name'] = 'alpha';
      }),
    );
    expect(resolved.scope).toBeNull();
    expect(resolved.refusal).toContain('unscoped');
  });

  it('refuses two scopes, which one `.npmrc` line cannot cover', () => {
    const resolved = scopeOfCheckout({
      ...PUBLISHED_ALPHA,
      'packages/beta/package.json': JSON.stringify({
        name: '@other/beta',
        version: '1.0.0',
        repository: 'https://example.invalid/fx.git',
        publishConfig: { access: 'public' },
      }),
    });
    expect(resolved.scope).toBeNull();
    expect(resolved.refusal).toContain('2 scopes');
  });

  /**
   * And over the tree the job actually runs it on, so a green here is a
   * statement about this repository rather than about a fixture.
   */
  it('resolves this repository to one scope over every workspace member', () => {
    const root = REPO_ROOT.replace(/\/$/, '');
    const inputs = readReleaseIntent(root, nodeWorkspaceFs(), (dir) =>
      readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name),
    );
    if ('reason' in inputs) throw new Error(inputs.reason);
    const resolved = publishScope(inputs.members);

    expect(resolved.scope).toBe('endora-commerce');
    // The population is the whole workspace, module packages included — the
    // number the retired derivation could not reach was 9 directories.
    expect(inputs.members.length).toBeGreaterThan(70);
    expect(
      inputs.members.filter((member) => member.dir.startsWith('packages/modules/')).length,
    ).toBeGreaterThan(0);
  });
});

/**
 * `--publish-registry <url>` — a package whose terms are its own never goes to
 * public npmjs (`specs/136-open-source-publication/` FR-011).
 *
 * A `SEE LICENSE IN` package is legitimately published to the private registry,
 * and the same workflow publishes to whichever registry its environment names —
 * so the question is asked about the pair, never about the package alone. The
 * refusal names the packages it read, and the code names none: after the
 * migration the population is empty by construction, and this is the belt for
 * the day it is not.
 */
describe('check-release-intent — own licence terms on the public registry', () => {
  function verdictFor(files: FileMap, registry: string) {
    const tree = checkout(files);
    const inputs = readReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in inputs) throw new Error(`expected inputs, got a refusal: ${inputs.reason}`);
    return publicRegistryLicence(inputs.members, registry);
  }

  const OWN_TERMS: FileMap = {
    ...publishedAlphaAs((manifest) => {
      manifest['license'] = 'SEE LICENSE IN LICENSE.md';
    }),
    'packages/alpha/LICENSE.md': 'All rights reserved.\n',
  };

  it('refuses a public package declaring its own terms on registry.npmjs.org', () => {
    const verdict = verdictFor(OWN_TERMS, 'https://registry.npmjs.org/');
    expect(verdict.publicRegistry).toBe(true);
    expect(verdict.ownLicence).toEqual(['@fx/alpha']);
    expect(verdict.refusal).toContain('@fx/alpha');
  });

  it('recognises the public registry however its URL is spelled', () => {
    for (const registry of [
      'https://registry.npmjs.org',
      'https://REGISTRY.npmjs.org/',
      'http://registry.npmjs.org/',
      'https://registry.npmjs.com/',
    ]) {
      expect(verdictFor(OWN_TERMS, registry).refusal, registry).not.toBe('');
    }
  });

  it('lets the same package publish to a private registry', () => {
    const verdict = verdictFor(
      OWN_TERMS,
      'https://gitlab.example.invalid/api/v4/projects/1/packages/npm/',
    );
    expect(verdict.publicRegistry).toBe(false);
    expect(verdict.ownLicence).toEqual(['@fx/alpha']);
    expect(verdict.refusal).toBe('');
  });

  it('lets a package taking a standard identifier publish to npmjs', () => {
    for (const license of ['MIT', 'Apache-2.0', 'UNLICENSED']) {
      const verdict = verdictFor(
        publishedAlphaAs((manifest) => {
          manifest['license'] = license;
        }),
        'https://registry.npmjs.org/',
      );
      expect(verdict.ownLicence, license).toEqual([]);
      expect(verdict.refusal, license).toBe('');
    }
  });

  it('ignores a private member, which `changeset publish` never packs', () => {
    const verdict = verdictFor(
      {
        ...OWN_TERMS,
        'packages/beta/package.json': JSON.stringify({
          name: '@fx/beta',
          version: '1.0.0',
          private: true,
          license: 'SEE LICENSE IN LICENSE.md',
        }),
      },
      'https://registry.npmjs.org/',
    );
    expect(verdict.ownLicence).toEqual(['@fx/alpha']);
  });

  it('refuses a registry it cannot read as a URL rather than guessing it is private', () => {
    for (const registry of ['', 'registry.npmjs.org', 'not a url']) {
      const verdict = verdictFor(OWN_TERMS, registry);
      expect(verdict.publicRegistry, registry).toBeNull();
      expect(verdict.refusal, registry).toContain('not a URL');
    }
  });
});

/**
 * The release-shape classification (feature 114, D-212; contract §8).
 *
 * One proof per shape the classification claims to answer, each entering at the
 * **top** of the analysis with a synthetic diff and a two-sided reader — never a
 * pre-computed classification, which is the defect issue #130 records for
 * `check-entry-scope`, where the fixture entered below the classifier and the
 * classifier therefore never ran.
 *
 * The proofs are the contract's table, in its order, and the two that matter
 * most are the last two of the first six: proof 4 is the half nothing else in
 * this repository can see (a `version` moved beside an `exports` narrowed), and
 * proof 6 is the one that makes the whole thing worth landing — without it the
 * classification would accept the one-file lockpick `research.md` §3.3 measured,
 * which is an empty changeset turning a release-shaped branch green and, for the
 * history landing, taking it out of the release class entirely.
 */
describe('check-release-intent --since — the release shape (D-212)', () => {
  interface Judged {
    readonly shape: 'release' | 'vacuous' | 'ordinary';
    readonly kinds: readonly ReleaseIntentFindingKind[];
    readonly asked: number;
  }

  function judge(files: FileMap, options: BranchOptions): Judged {
    const fixture = branch(files, options);
    const result = checkBranchIntent(
      FIXTURE_ROOT,
      fixture.tree.fs,
      fixture.tree.listChangesets,
      fixture.paths,
      fixture.probe,
    );
    if ('contained' in result) throw new Error('expected a verdict, got a containment answer');
    if ('reason' in result) throw new Error(`expected a verdict, got a refusal: ${result.reason}`);
    return { shape: result.shape, kinds: kinds(result.findings), asked: fixture.asked() };
  }

  function refused(files: FileMap, options: BranchOptions): string {
    const fixture = branch(files, options);
    const result = checkBranchIntent(
      FIXTURE_ROOT,
      fixture.tree.fs,
      fixture.tree.listChangesets,
      fixture.paths,
      fixture.probe,
    );
    if (!('reason' in result)) throw new Error('expected a refusal, got a verdict');
    return result.reason;
  }

  /** The two manifests of the default checkout, at a version the branch left behind. */
  const atVersion = (version: string): Readonly<Record<string, string>> => ({
    'packages/alpha/package.json': JSON.stringify({
      name: '@fx/alpha',
      version,
      license: 'MIT',
      repository: { type: 'git', url: 'https://example.invalid/fx.git', directory: 'packages/alpha' },
      publishConfig: { access: 'public' },
    }),
    'packages/beta/package.json': JSON.stringify({
      name: '@fx/beta',
      version,
      license: 'MIT',
      repository: { type: 'git', url: 'https://example.invalid/fx.git', directory: 'packages/beta' },
      publishConfig: { access: 'public' },
    }),
  });

  const MANIFESTS = ['packages/alpha/package.json', 'packages/beta/package.json'];
  const CHANGELOGS = ['packages/alpha/CHANGELOG.md', 'packages/beta/CHANGELOG.md'];

  /**
   * Proof 1 — the refusal, unchanged in substance from the shell it replaces:
   * changeset files deleted and no artefact of any kind. This is the
   * `privatePackages.version: false` no-op arriving through the other door — a
   * human ran it, it reported success, wrote nothing, and they deleted the
   * files while tidying up.
   */
  it('refuses a branch that consumed changesets and produced nothing', () => {
    const judged = judge(
      {},
      { changedPaths: ['.changeset/a.md'], deletedChangesets: ['.changeset/a.md'] },
    );

    expect(judged.shape).toBe('vacuous');
    expect(judged.kinds).toEqual(['vacuous-release']);
  });

  /**
   * Proof 2 — the history landing (D-213): every pending changeset consumed,
   * one `## <version>` section written per released package, and **no version
   * moved**. 214 and 79 in this repository; two and two here, because the
   * property is the classification and not the arithmetic.
   *
   * Under the superseded rule this branch was classified a release and then
   * refused for having moved no version — the inverted question, aimed at a
   * silent no-op, fired at the largest release-shaped change in this
   * repository's history.
   */
  it('passes the history landing, which moves no version and writes changelogs', () => {
    const judged = judge(
      {},
      {
        changedPaths: [...CHANGELOGS, '.changeset/a.md', '.changeset/b.md'],
        deletedChangesets: ['.changeset/a.md', '.changeset/b.md'],
        // The baseline carries no changelog at all: the landing creates one per
        // released package, which is the `''` side {@link SideReader} exists to
        // tell apart from a read that failed.
        after: {
          'packages/alpha/CHANGELOG.md': '# @fx/alpha\n\n## 1.0.0\n\n- a change\n',
          'packages/beta/CHANGELOG.md': '# @fx/beta\n\n## 1.0.0\n\n- a change\n',
        },
      },
    );

    expect(judged.shape).toBe('release');
    expect(judged.kinds).toEqual([]);
    // FR-003's other half: a release is not asked the ordinary question, so a
    // pass here is a verdict rather than the CLI's silence.
    expect(judged.asked).toBe(0);
  });

  /**
   * Proof 3 — the hand-set release (D-210's first act): every `version` moved,
   * nothing consumed, no changelog. `changeset status` refuses it, because it
   * attributes any changed file under `packages/<p>/` to that package —
   * including the one file whose change **is** the release.
   */
  it('passes a branch that moved versions and consumed nothing', () => {
    const judged = judge(
      {},
      { changedPaths: MANIFESTS, before: atVersion('0.9.0') },
    );

    expect(judged.shape).toBe('release');
    expect(judged.kinds).toEqual([]);
    expect(judged.asked).toBe(0);
  });

  /**
   * Proof 4 — the half nothing else in this repository can see (FR-004). A
   * `version` field is release-neutral and every other key of a manifest is
   * consumer-facing: `exports` compiles into nothing, so the published-surface
   * pass cannot see it move and `changeset status` attributes it to the package
   * whose release this branch claims to be.
   *
   * Release-neutrality is part of *being* a release, so this branch is not
   * exempt from the ordinary question either — the contract's expectation is
   * both the finding and §4.1 being asked.
   */
  it('refuses a branch that moved a version and narrowed an `exports` map', () => {
    const judged = judge(
      {},
      {
        changedPaths: ['packages/alpha/package.json'],
        before: {
          'packages/alpha/package.json': JSON.stringify({
            name: '@fx/alpha',
            version: '0.9.0',
            license: 'MIT',
            repository: {
              type: 'git',
              url: 'https://example.invalid/fx.git',
              directory: 'packages/alpha',
            },
            publishConfig: { access: 'public' },
            exports: { '.': './dist/index.js', './lib': './dist/lib.js' },
          }),
        },
      },
    );

    expect(judged.shape).toBe('ordinary');
    expect(judged.kinds).toContain('manifest-changed-beyond-version');
    expect(judged.asked).toBe(1);
  });

  /**
   * Proof 5 — the ordinary branch, which is the overwhelming majority and the
   * one this whole classification exists to leave alone. The CLI's exit is
   * attributed rather than relayed, so the reader of a red pipeline is told
   * which question was asked and why this branch was asked it.
   */
  it('asks `changeset status` of an ordinary branch and attributes its exit', () => {
    const judged = judge(
      {},
      {
        changedPaths: ['packages/alpha/src/index.ts'],
        changesetStatus: {
          status: 1,
          output: 'Some packages have been changed but no changesets were found',
        },
      },
    );

    expect(judged.shape).toBe('ordinary');
    expect(judged.kinds).toEqual(['unattributed-package-change']);
    expect(judged.asked).toBe(1);
  });

  /**
   * Proof 6 — the lockpick, closed. Measured under the superseded rule: one
   * empty changeset made both unrecognised shapes exit 0, and for the history
   * landing it removed the branch from the release class entirely, so nothing
   * anywhere asked whether it had released anything. The classification is over
   * artefacts and consults the added-changeset list nowhere.
   */
  it('is not reclassified by an added empty changeset', () => {
    const judged = judge(
      {},
      {
        changedPaths: ['.changeset/a.md', '.changeset/empty.md'],
        deletedChangesets: ['.changeset/a.md'],
        addedChangesets: ['.changeset/empty.md'],
      },
    );

    expect(judged.shape).toBe('vacuous');
    expect(judged.kinds).toEqual(['vacuous-release']);
  });

  /**
   * Proof 7 — contract §7.1. An artefact question answered by a silence is not
   * an answer, and the silence reads as *"no release"*, which is the direction
   * that agrees with the defect: the branch would be classified ordinary and
   * refused for something it did not do.
   */
  it('refuses a changelog whose baseline side could not be read', () => {
    const reason = refused(
      {},
      {
        changedPaths: ['packages/alpha/CHANGELOG.md'],
        before: { 'packages/alpha/CHANGELOG.md': null },
        after: { 'packages/alpha/CHANGELOG.md': '## 1.0.0\n' },
      },
    );

    expect(reason).toContain('packages/alpha/CHANGELOG.md');
    expect(reason).toContain('could not be read');
  });

  /**
   * Proof 8 — contract §7.2, the same defect on the other file kind. Never
   * "changed beyond version" and never "release-neutral": both readings are
   * verdicts this run has no basis for.
   */
  it('refuses a manifest that does not parse, on either side', () => {
    expect(
      refused(
        {},
        {
          changedPaths: ['packages/alpha/package.json'],
          before: { 'packages/alpha/package.json': '{ "name": "@fx/alpha", ' },
        },
      ),
    ).toContain('does not parse');

    expect(
      refused(
        {},
        {
          changedPaths: ['packages/alpha/package.json'],
          after: { 'packages/alpha/package.json': 'not json at all' },
        },
      ),
    ).toContain('does not parse');
  });

  /**
   * Contract §7.3 — the walk having stopped matching the tree. The population
   * is not the walk's own: it is the changed files that *carry* a release,
   * sitting where a versionable package sits, and the refusal fires only when
   * the walk attributed none of them to any member.
   */
  it('refuses a release-bearing file under the library tree that no member claims', () => {
    const reason = refused({}, { changedPaths: ['packages/gamma/package.json'] });

    expect(reason).toContain('packages/gamma/package.json');
    expect(reason).toContain('attributed none of them');
  });

  /**
   * Contract §7.4 — the invocation that did not run, which is not the same fact
   * as the exit code 1 that is a finding. An answer this run never obtained is
   * not a verdict about the branch.
   */
  it('refuses a `changeset status` that could not be run at all', () => {
    const reason = refused(
      {},
      { changedPaths: ['packages/alpha/src/index.ts'], changesetStatus: null },
    );

    expect(reason).toContain('could not be run at all');
  });

  /**
   * The discrimination proof 1 is worth nothing without: the *same* consumed
   * changesets, with a release actually performed. Proving only the refusal
   * would be satisfied by a check that refuses every release branch, which is
   * the state this feature repairs.
   */
  it('tells the vacuous release from the real one on the same consumed set', () => {
    const consumed = { changedPaths: ['.changeset/a.md'], deletedChangesets: ['.changeset/a.md'] };

    expect(judge({}, consumed).shape).toBe('vacuous');
    expect(
      judge({}, {
        ...consumed,
        changedPaths: [...consumed.changedPaths, ...MANIFESTS],
        before: atVersion('0.9.0'),
      }).shape,
    ).toBe('release');
  });

  /**
   * And the classification's own vocabulary, at its own level: a heading is a
   * release section because it is a **version**, not because it is a level-two
   * heading. A changelog is ordinary markdown, and `## Unreleased` is something
   * somebody wrote by hand.
   */
  it('reads a `## <version>` section and not every level-two heading', () => {
    expect(changelogSections('## 0.7.0\n\n## Unreleased\n\n## v1.2.3-rc.1\n')).toEqual([
      '0.7.0',
      '1.2.3-rc.1',
    ]);
  });
});

/**
 * The C2 term these fixtures plant, assembled at run time: this file is public
 * and the pre-publication scan reads it, and since D-277 an annotation in one
 * fixture no longer clears the same word in the next one.
 */
const C2_TERM = ['pi', 'lot'].join('');

/**
 * **R3 — the vocabulary rule over changeset prose** (129 T017 / FR-031).
 *
 * The rule is a term list and it is the weakest instrument in this estate:
 * precision ≈ 28 % and **recall unknown**. These tests exist to hold the two
 * things that make it usable anyway — the two ruled narrowings, which are what
 * keep its false-positive rate tolerable — and the clearing mechanism, which is
 * the only sanctioned way to answer a false positive. Widening the term list is
 * not clearing, and no test here may be made to pass by doing it.
 */
describe('R3 over changeset prose', () => {
  it('finds a counterparty, a cost, a money figure and a strategy line, and says which class', () => {
    const scan = scanCommercialVocabulary(
      `Bumped for the ${C2_TERM}, whose contract lands before the sales event.\n` +
        'The work is 3–5 person-days and the margin on it is thin.\n',
    );
    expect(scan.perClass).toEqual({ C1: 2, C2: 1, C3: 1, C4: 1 });
    expect(scan.hits.map((h) => h.term).sort()).toEqual([
      'day-range',
      'margin',
      'person-day',
      C2_TERM,
      'sales-event',
    ]);
  });

  /**
   * §4(d) is a rule, not a reporting preference: a class a measurement did not
   * scan for is reported as a zero indistinguishable from a real one. So the
   * per-class record carries **every** class, and a clean text is four zeros
   * rather than an empty object.
   */
  it('reports every class including the zeros, over a clean text', () => {
    const scan = scanCommercialVocabulary('Adds a product-list block to the page builder.\n');
    expect(scan.perClass).toEqual({ C1: 0, C2: 0, C3: 0, C4: 0 });
    expect(scan.hits).toEqual([]);
  });

  /** §4(b): effort *measured* is not effort *priced*. */
  it('does not flag a backward observation of effort', () => {
    expect(scanCommercialVocabulary('The sweep took two person-days.\n').hits).toEqual([]);
  });

  it('still flags a forward commitment of the same effort', () => {
    expect(
      scanCommercialVocabulary('The sweep is two person-days.\n').hits.map((h) => h.term),
    ).toEqual(['person-day']);
  });

  /**
   * §4(b) narrows **C1 alone**. A counterparty named in the past tense is still
   * a counterparty named, and a rule that suppressed it would have cleared the
   * one real disclosure this estate found — which was written in the present
   * tense about a party, not about an effort.
   */
  it('narrows C1 only — a counterparty in the past tense still fires', () => {
    expect(
      scanCommercialVocabulary(`We measured this against the ${C2_TERM}.\n`).hits.map((h) => h.klass),
    ).toEqual(['C2']);
  });

  /**
   * §4(c): product prices are the domain this software is about. There is no
   * amount regex at all, and this test is what stops one being added.
   */
  it('does not flag a currency code, an amount or a credit limit', () => {
    expect(
      scanCommercialVocabulary(
        "Channel default currency 'PLN'; the fixture grants 50 000.00 PLN of credit at 12,50 PLN.\n",
      ).hits,
    ).toEqual([]);
  });

  it('clears a hit by annotation, and counts the clearance rather than hiding it', () => {
    const scan = scanCommercialVocabulary(
      'Adds the pilot-programme module.\n' +
        '<!-- commercial-data: cleared `pilot` — the module is named pilot, no party is -->\n',
    );
    expect(scan.hits).toEqual([]);
    expect(scan.cleared.map((h) => h.term)).toEqual(['pilot']);
  });

  it('refuses a clearance with no reason worth reading', () => {
    const scan = scanCommercialVocabulary(
      'Adds the pilot-programme module.\n<!-- commercial-data: cleared `pilot` — ok -->\n',
    );
    expect(scan.hits.map((h) => h.term)).toEqual([C2_TERM]);
  });

  /** The ledger's other direction: a clearance that has stopped clearing anything. */
  it('reports a clearance naming a term the body no longer contains', () => {
    const scan = scanCommercialVocabulary(
      'An ordinary change.\n' +
        '<!-- commercial-data: cleared `pilot` — the module is named pilot, no party is -->\n',
    );
    expect(scan.staleClearances.map((c) => c.term)).toEqual(['pilot']);
  });

  /**
   * D-277: an annotation reaches its own block — the run of non-blank lines
   * that holds it — and not the document. The term is assembled at run time so
   * that these fixtures add no hit of their own to the file that holds them.
   */
  describe('a clearance reaches its own block only (D-277)', () => {
    const term = C2_TERM;
    const clearance = `<!-- commercial-data: cleared \`${term}\` — the module is named so, no party is -->`;

    it('clears the term in its own paragraph and judges it again in the next one', () => {
      const scan = scanCommercialVocabulary(
        [`Adds the ${term}-programme module.`, clearance, '', `Bumped for the ${term} customer.`, ''].join(
          '\n',
        ),
      );
      expect(scan.cleared.map((h) => [h.term, h.line])).toEqual([[term, 1]]);
      expect(scan.hits.map((h) => [h.term, h.line])).toEqual([[term, 4]]);
      expect(scan.staleClearances).toEqual([]);
    });

    it('does not let an annotation inside a fixture template literal clear prose elsewhere', () => {
      const source = [
        `// Signed with the ${term} customer last week.`,
        '',
        'const fixture = `',
        `Adds the ${term}-programme module.`,
        clearance,
        '`;',
        '',
      ].join('\n');
      const scan = scanCommercialVocabulary(source);
      expect(scan.hits.map((h) => h.line)).toEqual([1]);
      expect(scan.cleared.map((h) => h.line)).toEqual([4]);
    });

    it('reports a clearance whose own block lost its hit, while the term survives in another block', () => {
      const scan = scanCommercialVocabulary(
        ['An ordinary change.', clearance, '', `Bumped for the ${term} customer.`, ''].join('\n'),
      );
      expect(scan.staleClearances.map((c) => [c.term, c.line])).toEqual([[term, 2]]);
      expect(scan.hits.map((h) => h.line)).toEqual([4]);
      expect(scan.cleared).toEqual([]);
    });

    it('tells the author to clear it beside the paragraph that carries it', () => {
      const found = findings({
        '.changeset/x.md': `---\n---\n\nBumped for the ${term} customer.\n`,
      }).filter((finding) => finding.kind === 'commercial-disclosure-in-changeset');
      expect(found).toHaveLength(1);
      expect(found[0]!.message).toContain('clear it **beside the paragraph that carries it**');
      expect(found[0]!.message).not.toContain('in the changeset body');
    });
  });
});

describe('a changeset document keeps the prose R3 reads', () => {
  it('splits the front matter from the body at the closing delimiter', () => {
    const document = readChangesetDocument(
      'x.md',
      "---\n'@endora-commerce/contracts': patch\n---\n\nThe summary, with a --- inside it.\n",
    );
    expect(document.hasFrontMatter).toBe(true);
    expect(document.releases.map((r) => r.bump)).toEqual(['patch']);
    expect(document.body.trim()).toBe('The summary, with a --- inside it.');
  });

  /**
   * A file the front-matter reader cannot parse is exactly the one whose prose
   * nobody has looked at, so its body is the whole source rather than nothing.
   * The two questions stay apart: `hasFrontMatter` keeps its own refusal.
   */
  it('reads the whole source as the body when there is no front matter', () => {
    const document = readChangesetDocument('x.md', `Just prose about the ${C2_TERM}.\n`);
    expect(document.hasFrontMatter).toBe(false);
    expect(document.body).toBe(`Just prose about the ${C2_TERM}.\n`);
  });
});
