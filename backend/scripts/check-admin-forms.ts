/**
 * CI check — field slots, admin forms and input controls, judged across bare
 * core and every deployment on disk (`specs/193-admin-form-extensions/`
 * FR-002, FR-012, FR-031; `contracts/field-slots.md` §6). **Repository-scope
 * host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/lib/admin-forms.js` — one analysis,
 * two readers: this file supplies this repository's population and
 * `endora generate` supplies an instance's (`packages/cli/src/generate/admin-forms.ts`).
 *
 * ## Why a check of its own
 *
 * What composition can decide is the platform's `FormRegistry.seal`, and it
 * refuses before the first boot hook. What it cannot see is the **admin half**:
 * the slot fields and input-control components an admin layer contributes and
 * the forms a host screen renders. No process that composes the backend reads
 * an admin layer, so a slot anchored on a key nobody declares renders nowhere
 * with no error anywhere — the failure `check:admin-zones` exists for, one
 * mechanism over. Widening that check was considered and rejected: its
 * population is zone names and translation scopes, and a slot is neither.
 *
 * ## The population, and its independent authors
 *
 *  - the **manifests**, imported through the generated manifest index — each
 *    module's `fieldSets`, `adminForms`, `inputControls` and `dependencies`;
 *    reconciled as `manifest-index`, every registered module's manifest read;
 *  - the **module admin layers** the generated admin registry names, read as
 *    source text, and every host source under them and under the admin
 *    application's own host roots; reconciled as `module-admin`, every layer
 *    the registry names opened (`lib/module-admin-layers.ts`, the floor
 *    `check:admin-zones` and `check:admin-surface` share);
 *  - each **deployment**'s overlay modules — manifest, admin layer and admin
 *    sources — read by the same function `endora generate` uses; reconciled as
 *    `deployment-admin`, every layer a generated deployment registry imports
 *    opened. Omitted rather than printed `0/0` where no deployment ships one
 *    (`read-size.ts` refuses `expected=0`).
 *
 * `residueGuard: not-a-module-walk` in the inventory, and it is a statement
 * about the population's shape rather than an exemption: the module half is
 * the generated registry's list of layers, each reconciled, not a walk of the
 * module roots — a moved module tree leaves the manifest import or a registry
 * layer unread, and both are a short walk here (exit 2).
 *
 * ## What it cannot see, stated rather than discovered
 *
 *  - a slot or control whose fields are not literals or same-file constants —
 *    reported as unreadable, never skipped;
 *  - a form handed to `DeclaredFormProvider` other than as an imported
 *    declaration, a member of one, a same-file constant or a conditional of
 *    those — unreadable likewise;
 *  - an overlay manifest's declarations imported from another file —
 *    unreadable: the instance reader cannot import TypeScript, and this host
 *    reads overlays with the instance's reader.
 *
 * Usage: `tsx scripts/check-admin-forms.ts [--list]`
 * Exit 0 = no refusal (warnings — `ambiguous-slot-order`, `deprecated-anchor` —
 * are printed and fail nothing); exit 1 = at least one refusal or unreadable
 * declaration; exit 2 = the run could not see the population it judges — see
 * {@link vacuousAdminFormsReason}.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import {
  ADMIN_FORMS_REMEDIES,
  adminFormsExitCode,
  formsModuleFromManifest,
  hostSourcesUnder,
  judgeAdminForms,
  readAdminLayerForms,
  readOverlayDeployment,
  readRenders,
  type AdminFormsFinding,
  type AdminFormsPopulation,
  type FormsLayer,
  type FormsModule,
} from '@endora-commerce/cli/lib/admin-forms.js';

import { deploymentsOnDisk, overlayModulesRootFor } from '../src/overlay/overlay-roots.js';
import { DEPLOYMENT_REGISTRY_DIRECTORY, deploymentRegistryFileName } from './lib/admin-artefacts.js';
import { adminRegistryPathOf } from './lib/admin-surfaces.js';
import {
  checkEmittedFreshness,
  emittingPackages,
  refuseStaleEmittedArtefacts,
} from './lib/emitted-freshness.js';
import { adminRegistryPresent, moduleAdminLayers } from './lib/module-admin-layers.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize, type ReadCoverage } from './lib/read-size.js';
import { nodeWorkspaceFs, workspaceMembers } from './lib/workspace-packages.js';

export * from '@endora-commerce/cli/lib/admin-forms.js';

export const PREFIX = '[admin-forms]';

/** What the run read before judging anything — the inputs of every exit-2 refusal. */
export interface AdminFormsReadRecord {
  /** Whether a workspace member declares the admin application. */
  readonly adminApplication: boolean;
  /** Whether the generated admin contribution registry is on disk. */
  readonly registryPresent: boolean;
  /** How many module admin layers it names. */
  readonly registryLayers: number;
  /** How many manifests the generated index yielded. */
  readonly manifests: number;
  /** How many host sources the render walk opened. */
  readonly hostFiles: number;
}

/**
 * Why this run may not report on the admin forms at all, or `null`.
 *
 * One reason per input whose absence would make a predicate vacuously clean:
 * with no admin application there is no host to render a form and no layer to
 * contribute a slot; with no registry, or one naming no layer, every slot reads
 * as absent; with no manifest every slot's field set is unknown — a finding
 * about the run dressed as one about the tree; with no host file opened no
 * form is rendered, and every declared one would be `unrendered-form`.
 */
export function vacuousAdminFormsReason(record: AdminFormsReadRecord): string | null {
  if (!record.adminApplication) {
    return 'no workspace member declares the admin application, so no admin layer contributes a slot and no host renders a form; refusing to report a vacuous pass';
  }
  if (!record.registryPresent) {
    return 'the generated admin contribution registry is not on disk (run `composer:generate`), so no module admin layer can be read; refusing to report a vacuous pass';
  }
  if (record.registryLayers === 0) {
    return 'the generated admin contribution registry names no module admin layer, so every slot would read as absent; refusing to report a vacuous pass';
  }
  if (record.manifests === 0) {
    return 'the generated manifest index yielded no manifest, so every field set and form would read as undeclared; refusing to report a vacuous pass';
  }
  if (record.hostFiles === 0) {
    return 'the render walk opened no host source, so every declared form would read as unrendered; refusing to report a vacuous pass';
  }
  return null;
}

/** The overlay module ids a generated deployment registry imports. */
export function deploymentRegistryModules(source: string): string[] {
  const tree = ts.createSourceFile('registry.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const ids: string[] = [];
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const match = /\/modules\/([^/]+)\/admin\/index\.js$/.exec(statement.moduleSpecifier.text);
    if (match !== null) ids.push(match[1]!);
  }
  return ids.sort();
}

function refuse(message: string): never {
  console.error(`${PREFIX} ${message}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout(PREFIX);
  const admin = await layout.adminSurfaces();
  const members = workspaceMembers(layout.repoRoot, nodeWorkspaceFs());
  const registryFile = adminRegistryPathOf(members);
  const registryLayers = adminRegistryPresent(registryFile) ? moduleAdminLayers(layout, registryFile!) : [];

  // The manifests, imported: a module package resolves at its build output, so
  // the freshness refusal below is what stops this run answering about the
  // previous build (D-164).
  let entries: ReadonlyArray<{ id?: string; manifestPath?: string; manifest?: unknown }>;
  try {
    const index = (await import(pathToFileURL(layout.manifestIndexPath).href)) as {
      DISCOVERED_MANIFESTS?: ReadonlyArray<{ id?: string; manifestPath?: string; manifest?: unknown }>;
    };
    entries = index.DISCOVERED_MANIFESTS ?? [];
  } catch (error: unknown) {
    refuse(`the manifest index at ${layout.displayOf(layout.manifestIndexPath)} could not be imported (${String(error)}); refusing to report a vacuous pass`);
  }
  const modules: FormsModule[] = [];
  const unreadable: string[] = [];
  const registered = new Set(layout.registeredIds);
  const manifestsRead = new Set<string>();
  for (const entry of entries) {
    const where = entry.manifestPath === undefined ? String(entry.id) : layout.displayOf(entry.manifestPath);
    const read = formsModuleFromManifest(entry.manifest, where);
    unreadable.push(...read.unreadable);
    if (read.module === null) continue;
    modules.push(read.module);
    if (registered.has(read.module.moduleId)) manifestsRead.add(read.module.moduleId);
  }
  refuseStaleEmittedArtefacts(
    PREFIX,
    checkEmittedFreshness({
      read: entries.map((entry) => entry.manifestPath).filter((path): path is string => path !== undefined),
      packages: emittingPackages(layout.repoRoot),
    }),
    layout.displayOf,
  );

  // The module admin layers the registry names, and every host source.
  const layers: FormsLayer[] = [];
  const hostFiles = new Set<string>();
  let layerFiles = 0;
  let coveredLayers = 0;
  for (const layer of registryLayers) {
    const entry = ['index.tsx', 'index.ts'].map((name) => join(layer.directory, name)).find((path) => existsSync(path));
    const sources = hostSourcesUnder(layer.directory);
    for (const file of sources) hostFiles.add(resolve(file));
    if (entry === undefined) {
      unreadable.push(`${layout.displayOf(layer.directory)}: the registry names this admin layer and it has no index source`);
      continue;
    }
    layerFiles += 1;
    if (sources.length > 0) coveredLayers += 1;
    const read = readAdminLayerForms(layer.moduleId, layout.displayOf(entry), readFileSync(entry, 'utf8'));
    layers.push(read.layer);
    unreadable.push(...read.unreadable);
  }
  for (const root of admin?.hostRoots ?? []) for (const file of hostSourcesUnder(root)) hostFiles.add(resolve(file));

  const vacuous = vacuousAdminFormsReason({
    adminApplication: admin !== null,
    registryPresent: adminRegistryPresent(registryFile),
    registryLayers: registryLayers.length,
    manifests: modules.length,
    hostFiles: hostFiles.size,
  });
  if (vacuous !== null) refuse(vacuous);

  const rendered = await readRenders([...hostFiles].sort(), layout.displayOf);
  const base: AdminFormsPopulation = {
    modules,
    layers,
    renders: rendered.renders,
    unreadable: [...unreadable, ...rendered.unreadable],
    files: layerFiles + hostFiles.size,
  };

  // Every deployment on disk, over bare core.
  const deployments: { deployment: string; population: AdminFormsPopulation }[] = [];
  let expectedOverlayLayers = 0;
  let coveredOverlayLayers = 0;
  for (const deployment of deploymentsOnDisk()) {
    const appsRoot = dirname(dirname(overlayModulesRootFor(deployment)));
    const population = await readOverlayDeployment(appsRoot, deployment, layout.repoRoot);
    deployments.push({ deployment, population });
    const registry = admin === null ? null : join(admin.sourceRoot, DEPLOYMENT_REGISTRY_DIRECTORY, deploymentRegistryFileName(deployment));
    if (registry !== null && existsSync(registry)) {
      const expected = deploymentRegistryModules(readFileSync(registry, 'utf8'));
      const read = new Set(population.layers.map((layer) => layer.moduleId));
      expectedOverlayLayers += expected.length;
      coveredOverlayLayers += expected.filter((id) => read.has(id)).length;
    }
  }

  const judgements = judgeAdminForms(base, deployments);

  if (listMode) {
    for (const judgement of judgements) {
      console.log(`${judgement.deployment ?? 'core'}: ${String(judgement.sites)} declaration(s), ${String(judgement.findings.length)} finding(s)`);
    }
    console.log('');
  }

  const coverage: ReadCoverage[] = [
    { source: 'manifest-index', expected: registered.size, covered: manifestsRead.size },
    { source: 'module-admin', expected: registryLayers.length, covered: coveredLayers },
  ];
  // Omitted rather than `0/0` where no deployment ships an admin layer.
  if (expectedOverlayLayers > 0) {
    coverage.push({ source: 'deployment-admin', expected: expectedOverlayLayers, covered: coveredOverlayLayers });
  }
  reportReadSize({
    prefix: PREFIX,
    files: base.files + deployments.reduce((sum, { population }) => sum + population.files, 0),
    sites: judgements.reduce((sum, judgement) => sum + judgement.sites, 0),
    coverage,
  });

  const findings: AdminFormsFinding[] = judgements.flatMap((judgement) => [...judgement.findings]);
  const unreadableAll = judgements.flatMap((judgement) => [...judgement.unreadable]);
  const refusals = findings.filter((finding) => finding.severity === 'refusal');
  const warnings = findings.filter((finding) => finding.severity === 'warning');
  console.log(
    `${PREFIX} compositions=${String(judgements.length)} refusals=${String(refusals.length)} ` +
      `warnings=${String(warnings.length)} unreadable=${String(unreadableAll.length)}`,
  );
  if (warnings.length > 0) {
    console.log('warnings:');
    for (const finding of warnings) console.log(`  [${finding.kind}] ${finding.where}: ${finding.detail}`);
  }

  const exit = adminFormsExitCode(findings, unreadableAll);
  if (exit === 0) process.exit(0);

  for (const kind of [...new Set(refusals.map((finding) => finding.kind))].sort()) {
    console.error(`\n[${kind}]\n${ADMIN_FORMS_REMEDIES[kind]}\n`);
    for (const finding of refusals.filter((candidate) => candidate.kind === kind)) {
      console.error(`  - ${finding.where}\n      ${finding.detail}`);
    }
  }
  if (unreadableAll.length > 0) {
    console.error('\n[unreadable]\nWrite these as literals or same-file constants, so this check can read them without running them.\n');
    for (const line of unreadableAll) console.error(`  - ${line}`);
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
