import { mkdirSync, mkdtempSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  compareArtifact,
  containmentSites,
  coveredArtifactPaths,
  deriveWorkspacePackages,
  examineArtifact,
  permittedRoots,
  vacuousContainmentPopulation,
  type PermittedRoots,
} from '../../../scripts/check-overlay-determinism.js';
import {
  renderEntitiesRegistry,
  type SourceTree,
} from '../../../scripts/generate-composer.js';
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

const PATH = '/repo/backend/src/modules/_lifecycle/manifest-index.generated.ts';
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

  function generatedFilesUnder(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) generatedFilesUnder(full, out);
      else if (name.endsWith('.generated.ts')) out.push(full);
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
    expect(generatedFilesUnder(srcRoot).sort()).toEqual([...coveredArtifactPaths()].sort());
  });

  it('names one override manifest per deployment on disk, plus bare core', () => {
    // The half the sweep above cannot show on its own: it compares two lists
    // that would agree just as well if both had lost the same deployment.
    const manifests = [...coveredArtifactPaths()].filter((p) =>
      p.includes('override-manifest'),
    );
    expect(manifests.some((p) => p.endsWith('overlay/override-manifest.core.generated.ts'))).toBe(
      true,
    );
    for (const deployment of deploymentsOnDisk()) {
      expect(
        manifests.some((p) => p.endsWith(join('apps', deployment, 'override-manifest.generated.ts'))),
        `no override manifest covered for deployment '${deployment}'`,
      ).toBe(true);
    }
    expect(manifests).toHaveLength(deploymentsOnDisk().length + 1);
  });
});

// --- the `foreign` verdict (feature 080, T030a; D-155.6) -------------------

const REPO_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const ROOTS = permittedRoots(REPO_ROOT);

/** Where the entity registry is rendered to, so a specifier resolves from `src/db/`. */
const REGISTRY_PATH = renderEntitiesRegistry(new Map()).outputPath;

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
    // `@b2b/page-builder-core` is named on purpose: it is the member that was
    // missing from `tsconfig.base.json`'s hand-written `paths` block for long
    // enough to type-check one branch and execute another (issue #255). A
    // derivation off the workspace globs has all five whether or not anybody
    // remembered the sixth list.
    const names = deriveWorkspacePackages(REPO_ROOT).map((p) => p.name);
    expect(names).toContain('@b2b/contracts');
    expect(names).toContain('backend');
    expect(names).toContain('@b2b/page-builder-core');
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
    const sources: SourceTree = new Map([
      [
        'node_modules/@vendor/mod-blog/dist/probe.entity.ts',
        '@Entity()\nexport class VendorProbe {}\n',
      ],
    ]);
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
      artefactImporting('@b2b/contracts/src/index.js'),
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
    // population this verdict exists over. All of them are in the core tree
    // today, and a run that classified none of them would be the vacuous pass
    // the floor below refuses.
    const entities = renderEntitiesRegistry().content;
    const sites = containmentSites(REGISTRY_PATH, entities, ROOTS);
    expect(sites.length).toBeGreaterThan(100);
    expect(sites.every((site) => site.verdict === 'core')).toBe(true);
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
