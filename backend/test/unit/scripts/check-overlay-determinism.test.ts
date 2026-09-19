import { mkdirSync, mkdtempSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  compareArtifact,
  containmentSites,
  coveredArtifactPaths,
  deriveWorkspacePackages,
  examineArtifact,
  permittedRoots,
  unreadableCssEntryLines,
  vacuousContainmentPopulation,
  type PermittedRoots,
} from '../../../scripts/check-overlay-determinism.js';
import {
  coreSources,
  renderEntitiesRegistry,
  type SourceTree,
} from '../../../scripts/generate-composer.js';
import { findAliasMember } from '../../../scripts/lib/admin-surfaces.js';
import { entityIndexOutputPathIn } from '../../../scripts/lib/entity-index-artefact.js';
import { platformSourceRootAt } from '../../../scripts/lib/platform-root.js';
import { MODULE_REFERENCE_CATEGORY, resolveDocsLayout } from '../../../scripts/lib/module-docs.js';
import {
  nodeWorkspaceFs,
  workspaceMembers,
} from '../../../scripts/lib/workspace-packages.js';
import { deploymentsOnDisk } from '../../../src/overlay/overlay-roots.js';

/**
 * The determinism gate's own test (issue #113).
 *
 * `overlay:check` is the only thing standing between a stale generated artifact
 * and `master`, and it had no test: its comparison lived inside a function that
 * read the disk and wrote to stderr, so the only way to see it fail was to
 * corrupt a committed file. The comparison is now injectable, and these cases
 * are the three ways an artifact can be wrong plus the one way the check itself
 * can be wrong.
 *
 * The fourth verdict, `foreign`, is the containment half (feature 080 T030a,
 * D-155.6). Determinism cannot see it: `overlay:check` renders the artefact
 * twice and compares, so **two renders of a wrong generator agree** and the
 * check goes green. The cases below are therefore about where an entry *lands*,
 * not about whether two strings match.
 */

const PATH = '/repo/backend/src/manifest-index.generated.ts';
const RENDERED = 'export const DISCOVERED_MANIFESTS = [];\n';

describe('compareArtifact', () => {
  it('accepts a byte-identical committed file', () => {
    expect(compareArtifact(PATH, RENDERED, () => RENDERED)).toEqual({ ok: true });
  });

  it('refuses a committed file that drifted', () => {
    const verdict = compareArtifact(PATH, RENDERED, () => 'export const DISCOVERED_MANIFESTS = [1];\n');
    expect(verdict).toMatchObject({ ok: false, reason: 'stale' });
  });

  it('refuses a trailing-newline difference — the artifact is compared by bytes', () => {
    expect(compareArtifact(PATH, RENDERED, () => RENDERED.trimEnd())).toMatchObject({
      ok: false,
      reason: 'stale',
    });
  });

  it('refuses a committed file that is gone', () => {
    const verdict = compareArtifact(PATH, RENDERED, () => {
      throw new Error('ENOENT');
    });
    expect(verdict).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('refuses an artifact the generator rendered empty, whatever is on disk', () => {
    // Two empty strings compare equal. A generator whose tree walk found no
    // module would otherwise report every artifact deterministic and current,
    // which is the shape of green this whole issue is about.
    expect(compareArtifact(PATH, '', () => '')).toMatchObject({ ok: false, reason: 'empty' });
    expect(compareArtifact(PATH, '   \n', () => '   \n')).toMatchObject({
      ok: false,
      reason: 'empty',
    });
  });
});

describe('coveredArtifactPaths', () => {
  const srcRoot = resolve(fileURLToPath(new URL('../../../src', import.meta.url)));
  /**
   * The **admin's** source root, resolved the way every admin instrument
   * resolves it: the workspace member declaring the `"@/*"` tsconfig alias.
   *
   * The sweep below used to walk `backend/src` alone, which stopped being the
   * whole population when feature 091's fifth artefact landed in the admin. It
   * is derived here rather than spelled for `lib/admin-surfaces.ts`' reason —
   * the alias is what `tsc` and Vite both resolve the admin's own imports
   * through, and zero or two members declaring it is a refusal rather than a
   * walk quietly narrowed to whichever sorted first.
   */
  const adminSourceRoot = ((): string => {
    const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
    const { member, target } = findAliasMember(workspaceMembers(repoRoot, nodeWorkspaceFs()));
    return resolve(member.dir, target);
  })();

  /**
   * The documentation site's own root, derived the way the generator derives it
   * (feature 100): the workspace member holding a Docusaurus configuration.
   *
   * A third root, because the two documentation artefacts are the first that
   * live outside a source tree — and the first that are not `.ts`. A sweep that
   * kept looking only under `backend/src` and the admin would have agreed with
   * itself perfectly while two committed generated files drifted with nothing
   * watching, which is exactly the state this ratchet exists to refuse.
   */
  const docsRoot = ((): string => {
    const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
    return resolveDocsLayout(repoRoot).member.dir;
  })();

  /**
   * The generated reference pages' category (feature 100 Phase 3).
   *
   * A **directory** rather than a filename suffix, because these artefacts are
   * pages a reader lands on: `module-reference/catalog.generated` would put the
   * word in a public URL to satisfy a sweep. Every page in that category is
   * generated from a manifest, so the category *is* the population — and
   * sweeping it keeps the ratchet two-way in the direction that matters most
   * here: a page for a module that has gone is on disk, named by no render, and
   * is exactly what this comparison reports.
   */
  /**
   * The platform package's own source root, derived the way the generator
   * derives it: the workspace member declaring `endora.type: "platform"`.
   *
   * A **fourth** root, because the published baseline list
   * (`specs/110-instance-repository/` R1.5) is the first artefact that lands
   * inside a package rather than in an application's tree — the frozen
   * historical prefix is data about this platform's history, and a client
   * receives it by installing the platform. Without it this sweep would agree
   * with itself perfectly while that artefact drifted with nothing watching,
   * which is the state it exists to refuse. A workspace with no such member is a
   * refusal rather than a walk quietly narrowed.
   */
  const platformSourceRoot = ((): string => {
    const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
    const root = platformSourceRootAt(repoRoot);
    if (root === null) {
      throw new Error(
        'no workspace member declares `endora.type: "platform"`, so the sweep below would ' +
          'not look at the published baseline list at all',
      );
    }
    return root;
  })();

  /**
   * The backend member's **test** tree — the one root that is not a source tree,
   * and a fifth because of the entity index (`specs/109-backend-test-kit/` T065).
   *
   * That artefact lands outside every `src` for a reason its own generator states:
   * the member's tsconfig sets `include: ['src']` with `rootDir: 'src'`, so a
   * `.ts` placed there would join the production build. A sweep of the four
   * source trees therefore could not see it, and that is not a detail — it is
   * why nothing caught the merge that added the artefact to `renderAll` and not
   * to `generatedArtifactPaths`. This comparison is the estate's only *path*
   * level answer to "is every committed artefact covered", and a root it does
   * not walk is an artefact it agrees about vacuously.
   *
   * Derived from the artefact's own path function rather than spelled as
   * `backend/test` (D-100): if the index ever moves, this root moves with it in
   * the same edit instead of leaving a sweep watching an empty directory.
   */
  const backendTestRoot = ((): string => {
    const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
    return dirname(entityIndexOutputPathIn(repoRoot));
  })();

  const referenceRoot = ((): string => {
    const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
    return join(resolveDocsLayout(repoRoot).contentRoot, MODULE_REFERENCE_CATEGORY);
  })();

  function referencePagesOnDisk(): string[] {
    return readdirSync(referenceRoot)
      .filter((name) => name.endsWith('.md') || name.endsWith('.mdx'))
      .map((name) => join(referenceRoot, name));
  }

  /**
   * Every committed generated file under `dir`, by suffix rather than by
   * extension.
   *
   * `.generated.js` and `.generated.md` are the documentation registry's; the
   * build outputs are skipped by name, because `build/` and `.docusaurus/` hold
   * copies of the site's own tree and a sweep that read them would report each
   * artefact several times over.
   */
  const SKIPPED = new Set(['node_modules', 'dist', 'build', '.docusaurus']);
  // `.generated.css` is the eighth artefact's (feature 110, T124). The suffix
  // list is what makes this ratchet two-way, so it grows in the merge request
  // that adds a rendering of a new kind — this one went red on arrival, which
  // is the ratchet doing its job.
  const GENERATED = ['.generated.ts', '.generated.js', '.generated.md', '.generated.css'];

  function generatedFilesUnder(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (SKIPPED.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) generatedFilesUnder(full, out);
      else if (GENERATED.some((suffix) => name.endsWith(suffix))) out.push(full);
    }
    return out;
  }

  it('covers every committed generated artifact, and names nothing else', () => {
    // The two-way ratchet the check itself cannot have: a generator that starts
    // emitting a fifth file, or a check that quietly stops comparing one, is a
    // committed artifact drifting from the tree with nothing watching.
    //
    // Env-independent on both sides since issue #120. A deployment's override
    // manifest is a committed audit record at its own path, so the gate renders
    // every deployment's rather than only the one `DEPLOYMENT` selects; before
    // that, `example`'s was uncommitted and its line read `missing` on every run
    // that set the variable and did not exist on every run that did not.
    const onDisk = [
      ...generatedFilesUnder(srcRoot),
      ...generatedFilesUnder(adminSourceRoot),
      ...generatedFilesUnder(platformSourceRoot),
      ...generatedFilesUnder(docsRoot),
      ...generatedFilesUnder(backendTestRoot),
      ...referencePagesOnDisk(),
    ].sort();
    expect(onDisk).toEqual([...coveredArtifactPaths()].sort());
  });

  it('names both renderings of one divergence report per deployment, plus bare core', () => {
    // The half the sweep above cannot show on its own: it compares two lists
    // that would agree just as well if both had lost the same deployment.
    //
    // **Both** renderings, because one derivation emits two (feature 107,
    // FR-015) and the `.md` is the one a human reads: a gate covering only the
    // `.ts` would leave the human rendering free to drift, which is the one
    // artefact whose drift nobody would catch by reading it.
    const reports = [...coveredArtifactPaths()].filter((p) => p.includes('divergence.'));
    for (const extension of ['ts', 'md']) {
      expect(
        reports.some((p) => p.endsWith(`overlay/divergence.core.generated.${extension}`)),
        `bare core's .${extension} rendering is covered by no determinism gate`,
      ).toBe(true);
      for (const deployment of deploymentsOnDisk()) {
        expect(
          reports.some((p) =>
            p.endsWith(join('apps', deployment, `divergence.generated.${extension}`)),
          ),
          `no .${extension} divergence rendering covered for deployment '${deployment}'`,
        ).toBe(true);
      }
    }
    expect(reports).toHaveLength((deploymentsOnDisk().length + 1) * 2);
  });
});

// --- the `foreign` verdict (feature 080, T030a; D-155.6) -------------------

const REPO_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const ROOTS = permittedRoots(REPO_ROOT);

/** Where the entity registry is rendered to, so a specifier resolves from `src/db/`. */
const REGISTRY_PATH = renderEntitiesRegistry(coreSources({})).outputPath;

/** A rendered artefact carrying exactly the specifiers a case is about. */
function artefactImporting(...specifiers: readonly string[]): string {
  const imports = specifiers.map((s, i) => `import { E${i} } from '${s}';`).join('\n');
  return `${imports}\n\nexport const ALL_ENTITIES = [] as const;\n`;
}

function verdictsFor(content: string, roots: PermittedRoots = ROOTS): string[] {
  return containmentSites(REGISTRY_PATH, content, roots).map((site) => site.verdict);
}

describe('deriveWorkspacePackages', () => {
  it('names every workspace member this repository declares', () => {
    // The discriminator's whole input. A derivation that came back empty would
    // make every bare specifier read as an installed package, which is a red
    // this run could not justify — hence the floor below.
    //
    // `@endora-commerce/page-builder-core` is named on purpose: it is the member that was
    // missing from `tsconfig.base.json`'s hand-written `paths` block for long
    // enough to type-check one branch and execute another (issue #255). A
    // derivation off the workspace globs has all five whether or not anybody
    // remembered the sixth list.
    const names = deriveWorkspacePackages(REPO_ROOT).map((p) => p.name);
    expect(names).toContain('@endora-commerce/contracts');
    expect(names).toContain('backend');
    expect(names).toContain('@endora-commerce/page-builder-core');
  });

  it('reads nothing from a tree with no workspace file, rather than guessing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'endora-no-workspace-'));
    expect(deriveWorkspacePackages(empty)).toEqual([]);
  });
});

describe('containmentSites', () => {
  it('accepts an entry in the core tree', () => {
    expect(verdictsFor(artefactImporting('../modules/blog/entities/post.entity.js'))).toEqual([
      'core',
    ]);
  });

  it('refuses an entry the generator resolved into node_modules', () => {
    // The leak D-155.6 names, entering where a real run enters: a `SourceTree`
    // holding a `node_modules/…` path, rendered by the real generator. Today
    // only `readSourceTree`'s `name === 'node_modules'` skip stops this, and
    // D-146 (one module-root derivation) and D-141 (`packages/modules/<id>/`,
    // symlinked into `node_modules`) both aim at it.
    const sources: SourceTree = coreSources({
      'node_modules/@vendor/mod-blog/dist/probe.entity.ts':
        '@Entity()\nexport class VendorProbe {}\n',
    });
    const rendered = renderEntitiesRegistry(sources);
    const sites = containmentSites(rendered.outputPath, rendered.content, ROOTS);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ verdict: 'foreign' });
    expect(sites[0]?.detail).toContain('node_modules');
  });

  it('accepts a bare specifier naming a workspace member', () => {
    // D-149: a workspace module package is committed with a bare specifier and
    // is *not* foreign. Getting this backwards fails the build on this
    // repository's own packages the day the layout moves.
    const sites = containmentSites(
      REGISTRY_PATH,
      artefactImporting('@endora-commerce/contracts/src/index.js'),
      ROOTS,
    );
    expect(sites[0]).toMatchObject({ verdict: 'workspace-package' });
  });

  it('refuses a bare specifier naming an installed package', () => {
    // Same syntax as the case above, opposite verdict. The discrimination is
    // the whole difficulty: pnpm links a workspace member into `node_modules`
    // too, so "the path goes through node_modules" answers neither.
    const sites = containmentSites(REGISTRY_PATH, artefactImporting('zod/index.js'), ROOTS);
    expect(sites[0]).toMatchObject({ verdict: 'foreign' });
  });

  it('refuses a bare specifier that resolves to no package at all', () => {
    // Fails closed: an entry the committed artefact cannot resolve is not
    // contained by anything, whatever it was meant to name.
    const sites = containmentSites(
      REGISTRY_PATH,
      artefactImporting('@nobody/never-installed/index.js'),
      ROOTS,
    );
    expect(sites[0]).toMatchObject({ verdict: 'foreign' });
    expect(sites[0]?.detail).toContain('no package');
  });

  it('follows a symlinked directory out of the core tree', () => {
    // The lexical answer here is `core`; the real one is a vendor package. A
    // containment test that normalised the path and stopped would report the
    // leak as contained.
    const root = mkdtempSync(join(tmpdir(), 'endora-symlink-escape-'));
    mkdirSync(join(root, 'core/src/db'), { recursive: true });
    mkdirSync(join(root, 'core/src/modules'), { recursive: true });
    mkdirSync(join(root, 'node_modules/@vendor/mod-blog/entities'), { recursive: true });
    symlinkSync(join(root, 'node_modules/@vendor/mod-blog'), join(root, 'core/src/modules/blog'));
    const roots: PermittedRoots = {
      repoRoot: root,
      coreRoot: join(root, 'core/src'),
      workspacePackages: [{ name: 'core', dir: join(root, 'core') }],
    };
    const sites = containmentSites(
      join(root, 'core/src/db/entities-registry.generated.ts'),
      artefactImporting('../modules/blog/entities/post.entity.js'),
      roots,
    );
    expect(sites[0]).toMatchObject({ verdict: 'foreign' });
  });

  it('reads every specifier the committed entity registry actually carries', () => {
    // Not a synthetic case: the registry on disk, whose entries are the
    // population this verdict exists over. A run that classified none of them
    // would be the vacuous pass the floor below refuses.
    //
    // **Two verdicts are correct here and one is not.** `core` is the
    // application's own tree; `workspace-package` is a module this repository
    // has moved into `packages/` and baked in with a bare specifier, which
    // D-149 commits and D-155.6 permits by **real path**. `foreign` is the one
    // that must never appear: an installed package is discovered at runtime and
    // baking it in registers it twice. Both permitted verdicts are asserted as
    // present, so this cannot pass by the classification collapsing to one.
    const entities = renderEntitiesRegistry().content;
    const sites = containmentSites(REGISTRY_PATH, entities, ROOTS);
    //
    // **The floor is the artefact's own import count, not a number.** The two
    // verdicts carry only presence, because the `core` share is a *draining*
    // population by construction: T040b moves modules out of the application
    // tree one batch at a time and its terminal value is zero. The **total**
    // drains for the same reason and this assertion did not say so — packaging
    // collapses a module's N entity imports into one `entities` array import,
    // so batch five's six modules took it from 111 to 99 and a `> 100` floor
    // went red on correct work. Re-recording it downward each batch is the
    // number-editing the read-size rule forbids, so the floor is derived
    // instead: every `import` line the rendered registry carries must have been
    // classified. That is this test's own title, it is what issue #215 is
    // about — a walk of the right length whose result is discarded — and it
    // does not move when a module becomes a package.
    const importLines = entities.split('\n').filter((line) => line.startsWith('import ')).length;
    expect(importLines).toBeGreaterThan(0);
    expect(sites.length).toBe(importLines);
    expect(sites.filter((site) => site.verdict === 'core').length).toBeGreaterThan(0);
    expect(sites.filter((site) => site.verdict === 'workspace-package').length).toBeGreaterThan(0);
    expect(sites.filter((site) => site.verdict === 'foreign')).toEqual([]);
    expect(
      sites.every((site) => site.verdict === 'core' || site.verdict === 'workspace-package'),
    ).toBe(true);
  });
});

describe("containmentSites over a stylesheet's own @import (feature 110, T124)", () => {
  /** The eighth artefact's grammar: CSS's at-rule, double quotes, no binding. */
  const stylesheet = (...specifiers: readonly string[]): string =>
    `${specifiers.map((s) => `@import "${s}";`).join('\n')}\n`;

  const cssVerdicts = (content: string): string[] =>
    containmentSites(REGISTRY_PATH, content, ROOTS, { kind: 'css-specifier' }).map(
      (site) => site.verdict,
    );

  it('accepts a bare specifier naming a workspace member', () => {
    // The same question and the same classifier as the JavaScript artefacts':
    // *where does the file this entry names really live*. Answering it twice
    // would be two answers waiting to disagree about what `foreign` means.
    expect(cssVerdicts(stylesheet('@endora-commerce/contracts/tailwind.css'))).toEqual([
      'workspace-package',
    ]);
  });

  it('refuses a bare specifier naming an installed package', () => {
    // R3.3 of `contracts/instance-repository.md` applies here too: an
    // installed package is discovered at runtime, so baking one into a
    // committed artefact registers it twice.
    expect(cssVerdicts(stylesheet('zod/tailwind.css'))).toEqual(['foreign']);
  });

  it('reads no entry out of a JavaScript artefact, and none out of prose', () => {
    // The two grammars are kept apart deliberately: `@import` is CSS's and
    // bare `import` is JavaScript's, and a recogniser that took both would
    // report a JavaScript artefact's entries under a CSS artefact's rules.
    expect(cssVerdicts(artefactImporting('@endora-commerce/contracts/src/index.js'))).toEqual([]);
    expect(cssVerdicts('/* the line below is prose about @import */\n')).toEqual([]);
  });

  it('reports an @import line it could not read a specifier out of', () => {
    // The unreadable-line half, which is what stops a shape a future emitter
    // grows from being silently absent from the population.
    expect(unreadableCssEntryLines('@import url(../elsewhere.css);\n')).toEqual([
      '@import url(../elsewhere.css);',
    ]);
    expect(unreadableCssEntryLines(stylesheet('@endora-commerce/contracts/tailwind.css'))).toEqual(
      [],
    );
  });
});

describe('examineArtifact', () => {
  it('reports a foreign entry ahead of a stale file', () => {
    // Order matters for what an author is told to do: regenerating a stale
    // artefact whose render holds a leak commits the leak.
    const content = artefactImporting('../node_modules/@vendor/mod-blog/dist/probe.entity.js');
    const examined = examineArtifact(REGISTRY_PATH, content, () => 'something else\n', ROOTS);
    expect(examined.verdict).toMatchObject({ ok: false, reason: 'foreign' });
  });

  it('passes an artefact whose every entry is contained, and counts them', () => {
    const content = artefactImporting('../modules/blog/entities/post.entity.js');
    const examined = examineArtifact(REGISTRY_PATH, content, () => content, ROOTS);
    expect(examined.verdict).toEqual({ ok: true });
    expect(examined.sites).toHaveLength(1);
  });
});

describe('vacuousContainmentPopulation', () => {
  const examinedFor = (content: string): ReturnType<typeof examineArtifact> =>
    examineArtifact(REGISTRY_PATH, content, () => content, ROOTS);

  it('refuses a run in which an artefact contributed no entry', () => {
    // The vacuous pass this verdict can suffer: the emitter changes shape, the
    // specifier parser matches nothing, and every artefact reports contained.
    const reason = vacuousContainmentPopulation(
      [examinedFor('export const ALL_ENTITIES = [] as const;\n')],
      ROOTS,
    );
    expect(reason).not.toBeNull();
    expect(reason).toContain('entities-registry.generated.ts');
  });

  it('refuses a run whose workspace derivation named no package', () => {
    // With no workspace member known, every bare specifier reads as installed:
    // the check would go red, and be unable to justify it.
    const reason = vacuousContainmentPopulation(
      [examinedFor(artefactImporting('../modules/blog/entities/post.entity.js'))],
      { ...ROOTS, workspacePackages: [] },
    );
    expect(reason).not.toBeNull();
    expect(reason).toContain('workspace');
  });

  it('refuses a run holding an entry it could not read', () => {
    // A specifier the parser cannot see is indistinguishable from one that is
    // not there — and the per-artefact floor above cannot catch it while the
    // other entries in the same file parse.
    const reason = vacuousContainmentPopulation(
      [examinedFor("import { A } from './a.js';\nimport {\n  B,\n} from './b.js';\n")],
      ROOTS,
    );
    expect(reason).not.toBeNull();
    expect(reason).toContain('could not read');
  });

  it('accepts a run in which every artefact contributed a readable entry', () => {
    expect(
      vacuousContainmentPopulation(
        [examinedFor(artefactImporting('../modules/blog/entities/post.entity.js'))],
        ROOTS,
      ),
    ).toBeNull();
  });
});
