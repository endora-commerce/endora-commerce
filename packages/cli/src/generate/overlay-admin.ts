/**
 * `endora generate`'s overlay admin half (`specs/190-overlay-full-modules/` FR-080 –
 * FR-082, FR-085; `contracts/overlay-cli.md` §4, `contracts/overlay-admin-layer.md`).
 *
 * Kept beside `./index.ts` rather than inside it: the renderers are
 * `../lib/admin-artefacts.js`' and the analysis is `../lib/palette-coverage.js`',
 * the same programs this repository's `composer:generate` and admin test run, and
 * what is here is only the instance's population — `apps/` at the workspace root,
 * and the installed packages' manifests.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import {
  adminSourceRootIn,
  collectOverlayAdminSources,
  DeploymentAdminLayerError,
  renderDeploymentAdminRegistriesInto,
} from '../lib/admin-artefacts.js';
import { publishedManifestEntryOf, type ModulePackage } from '../lib/module-packages.js';
import {
  deploymentPaletteCoverage,
  describeFinding,
  type CoverageAction,
  type DeploymentPaletteCoverage,
} from '../lib/palette-coverage.js';

export type { DeploymentPaletteCoverage };

/** A deployment tree whose admin registries cannot be rendered — the operator's to fix. */
export class OverlayAdminInputError extends Error {
  override readonly name = 'OverlayAdminInputError';
}

/** One rendered deployment registry, in the shape `runGenerate` writes. */
export interface DeploymentRegistryArtefact {
  readonly path: string;
  readonly content: string;
  readonly label: string;
}

/** Every deployment's admin registry and the overlay `@source` lines, rendered for `root`. */
export function renderInstanceOverlayAdmin(
  root: string,
  header: string,
): { readonly registries: readonly DeploymentRegistryArtefact[]; readonly sources: readonly string[] } {
  const adminSourceRoot = adminSourceRootIn(root);
  const appsRoot = join(root, 'apps');
  try {
    return {
      registries: renderDeploymentAdminRegistriesInto(adminSourceRoot, appsRoot, header).map((rendered) => ({
        path: rendered.outputPath,
        content: rendered.content,
        label:
          rendered.deployment === null
            ? 'the admin registry of bare core (no DEPLOYMENT)'
            : `the admin registry of the deployment ${rendered.deployment} ` +
              `(${String(rendered.modules)} overlay module(s))`,
      })),
      sources: collectOverlayAdminSources(adminSourceRoot, appsRoot),
    };
  } catch (error: unknown) {
    if (error instanceof DeploymentAdminLayerError) throw new OverlayAdminInputError(error.message);
    throw error;
  }
}

/**
 * The installed packages' palette actions, read through each package's own
 * manifest export. A package whose manifest cannot be imported contributes no
 * action and is named, rather than silently covering nothing.
 */
async function installedActions(
  packages: readonly ModulePackage[],
): Promise<{ actions: readonly CoverageAction[]; unreadable: readonly string[] }> {
  const actions: CoverageAction[] = [];
  const unreadable: string[] = [];
  for (const pkg of packages) {
    try {
      const { manifestPath } = publishedManifestEntryOf(pkg);
      const loaded = (await import(pathToFileURL(manifestPath).href)) as {
        manifest?: { id?: string; actions?: ReadonlyArray<{ id: string; targetRoute: string }> };
      };
      for (const action of loaded.manifest?.actions ?? []) {
        actions.push({ moduleId: pkg.moduleId, id: action.id, targetRoute: action.targetRoute });
      }
    } catch (error: unknown) {
      unreadable.push(`${pkg.name}: its manifest could not be imported (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return { actions, unreadable };
}

/** Palette coverage of every deployment under `apps/`, over its overlay admin layers. */
export async function instancePaletteCoverage(
  root: string,
  packages: readonly ModulePackage[],
): Promise<readonly DeploymentPaletteCoverage[]> {
  const installed = await installedActions(packages);
  return deploymentPaletteCoverage(join(root, 'apps'), installed.actions).map((result) => ({
    ...result,
    unreadable: [...installed.unreadable, ...result.unreadable].map((line) =>
      line.split(`${root}/`).join(''),
    ),
  }));
}

/** The report lines: one per deployment that ships an admin layer, then each finding. */
export function paletteReport(palette: readonly DeploymentPaletteCoverage[]): readonly string[] {
  const lines: string[] = [];
  for (const result of palette) {
    if (result.surfaces === 0 && result.unreadable.length === 0) continue;
    const clean = result.findings.length === 0 && result.unreadable.length === 0;
    lines.push(
      `palette coverage of ${result.deployment}: ${String(result.surfaces)} overlay admin layer(s), ` +
        (clean ? 'clean' : `${String(result.findings.length + result.unreadable.length)} finding(s)`),
    );
    for (const finding of result.findings) lines.push(`  [palette] ${describeFinding(finding)}`);
    for (const line of result.unreadable) lines.push(`  [palette-unreadable] ${line}`);
  }
  return lines;
}

/**
 * Why the palette half of this run is not a success, or `null` (Principle XVI,
 * FR-085). The artefacts are written first: the remedy is an action in an
 * overlay manifest, and the admin those artefacts build is what shows it.
 */
export function paletteRefusal(palette: readonly DeploymentPaletteCoverage[]): string | null {
  const failing = palette.filter((result) => result.findings.length > 0 || result.unreadable.length > 0);
  if (failing.length === 0) return null;
  const lines = [
    `palette coverage is not clean for ${failing.map((result) => result.deployment).join(', ')}. ` +
      `Every admin page an overlay module contributes is reachable from the command palette ` +
      `(⌘K / CTRL+K):`,
  ];
  for (const result of failing) {
    for (const finding of result.findings) {
      lines.push(
        `  - ${describeFinding(finding)} — add an \`actions\` entry with \`targetRoute: '${finding.path}'\` ` +
          `to apps/${result.deployment}/modules/${finding.moduleId}/manifest.ts`,
      );
    }
    for (const line of result.unreadable) {
      lines.push(`  - ${line} — write it as a literal, so this check can read it without running it`);
    }
  }
  lines.push('Fix them and run `pnpm run generate` again.');
  return lines.join('\n');
}
