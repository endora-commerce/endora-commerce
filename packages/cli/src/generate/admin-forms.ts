/**
 * `endora generate`'s admin-forms half (`specs/193-admin-form-extensions/`
 * FR-012, `contracts/field-slots.md` §6): the instance's population for the
 * analysis `check:admin-forms` runs in the platform repository.
 *
 * Kept beside `./overlay-admin.ts`, which does the same for palette coverage:
 * the analysis and every reader are `../lib/admin-forms.js`', and what is here is
 * only where an instance keeps them —
 *
 *  - the **installed packages** as the base composition: each manifest through
 *    the package's own export, each admin layer as the source text of the file
 *    its admin subpath ships. Their slots and controls are judged here, because
 *    the combination is this instance's — two packages placing a slot on one
 *    anchor with one weight are `ambiguous-slot-order` only together. Their
 *    **renders** are not: a package's host screens are compiled into its release
 *    and were judged there, so no package form is reported unrendered here;
 *  - each deployment under `apps/` over that base, with its overlay modules'
 *    manifests, admin layers and admin sources, where every form an overlay
 *    lists must be rendered and every form an overlay renders must be listed.
 *
 * The verdict is printed and refuses the run after the artefacts are written,
 * as the divergence report and palette coverage do.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { collectAdminContributions } from '../lib/admin-artefacts.js';
import {
  ADMIN_FORMS_REMEDIES,
  adminFormsReport,
  deploymentsUnder,
  formsModuleFromManifest,
  judgeAdminForms,
  readAdminLayerForms,
  readOverlayDeployment,
  type AdminFormsJudgement,
  type AdminFormsPopulation,
  type FormsLayer,
  type FormsModule,
} from '../lib/admin-forms.js';
import { publishedManifestEntryOf, type ModulePackage } from '../lib/module-packages.js';

export type { AdminFormsJudgement };

/** The file an installed package's admin layer specifier names, or `null`. */
function adminLayerFileOf(pkg: ModulePackage, specifier: string): string | null {
  const subpath = `.${specifier.slice(pkg.name.length)}`;
  const target = pkg.exports.get(subpath);
  if (target !== undefined) return join(pkg.dir, target);
  // A package that ships its sources is imported at a source path.
  const direct = join(pkg.dir, specifier.slice(pkg.name.length + 1));
  return existsSync(direct) ? direct : null;
}

/** The installed packages, as the base composition. */
async function installedPopulation(root: string, packages: readonly ModulePackage[]): Promise<AdminFormsPopulation> {
  const modules: FormsModule[] = [];
  const layers: FormsLayer[] = [];
  const unreadable: string[] = [];
  let files = 0;
  for (const pkg of packages) {
    try {
      const { manifestPath } = publishedManifestEntryOf(pkg);
      const loaded = (await import(pathToFileURL(manifestPath).href)) as { manifest?: unknown };
      const read = formsModuleFromManifest(loaded.manifest, pkg.name);
      unreadable.push(...read.unreadable);
      if (read.module !== null) modules.push(read.module);
    } catch (error: unknown) {
      unreadable.push(`${pkg.name}: its manifest could not be imported (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  const byModule = new Map(packages.map((pkg) => [pkg.moduleId, pkg] as const));
  for (const entry of collectAdminContributions(packages)) {
    const pkg = byModule.get(entry.moduleId);
    const file = pkg === undefined ? null : adminLayerFileOf(pkg, entry.specifier);
    if (file === null || !existsSync(file)) {
      unreadable.push(`${entry.specifier}: the admin layer the registry imports is not on disk, so its slots cannot be read`);
      continue;
    }
    files += 1;
    const read = readAdminLayerForms(entry.moduleId, relative(root, file), readFileSync(file, 'utf8'));
    layers.push(read.layer);
    unreadable.push(...read.unreadable);
  }
  return { modules, layers, renders: [], unreadable, files };
}

/** The base composition and every deployment under `apps/`, judged. */
export async function instanceAdminForms(
  root: string,
  packages: readonly ModulePackage[],
): Promise<readonly AdminFormsJudgement[]> {
  const base = await installedPopulation(root, packages);
  const appsRoot = join(root, 'apps');
  const deployments = [];
  for (const deployment of deploymentsUnder(appsRoot)) {
    deployments.push({ deployment, population: await readOverlayDeployment(appsRoot, deployment, root) });
  }
  return judgeAdminForms(base, deployments, { baseRendersJudged: false });
}

/** The report lines, one summary per composition that declares anything. */
export function adminFormsLines(judgements: readonly AdminFormsJudgement[]): readonly string[] {
  return adminFormsReport(judgements).map((line) =>
    line.replace('admin forms of the base composition', 'admin forms of the installed packages'),
  );
}

/**
 * Why the admin-forms half of this run is not a success, or `null`. Warnings
 * (`ambiguous-slot-order`, `deprecated-anchor`) are printed and refuse nothing.
 */
export function adminFormsSection(judgements: readonly AdminFormsJudgement[]): string[] | null {
  const refusals = judgements.flatMap((judgement) => judgement.findings.filter((finding) => finding.severity === 'refusal'));
  const unreadable = judgements.flatMap((judgement) => judgement.unreadable);
  if (refusals.length === 0 && unreadable.length === 0) return null;
  const lines = [
    `the admin forms are not clean: ${String(refusals.length)} refusal(s)` +
      (unreadable.length === 0 ? '' : ` and ${String(unreadable.length)} declaration(s) not written as literals`) +
      '. Each is listed above with the file it is about; what each kind asks for:',
  ];
  for (const kind of [...new Set(refusals.map((finding) => finding.kind))].sort()) {
    lines.push(`  [${kind}]`, `    ${ADMIN_FORMS_REMEDIES[kind]}`);
  }
  if (unreadable.length > 0) {
    lines.push(
      '  [admin-forms-unreadable]',
      '    A slot, a control, a form declaration or a rendered form is not written so this check can',
      '    read it without running it. Write it as literals, or as a same-file constant.',
    );
  }
  return lines;
}
