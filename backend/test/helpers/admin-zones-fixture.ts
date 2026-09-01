/**
 * `check:admin-zones` driven from **source text**, which is where a real run
 * enters (issue #130).
 *
 * The check's own analysis is `checkAdminZones`, whose input is sites and
 * declared names — and handing those in directly would prove the six
 * classifiers while leaving every parser above them unproven, which is the
 * exact hole the `check-entry-scope` proof had: a fixture that enters below the
 * defect cannot catch it. So this helper does what `main()` does — parses the
 * declaration source, walks each file for renders, contributions, visibility
 * gates and translation scopes, then classifies — and every proof written
 * against it enters at the top.
 *
 * Shared by `test/unit/scripts/check-admin-zones.test.ts` and the inventory,
 * because two similar drivers are two answers waiting to disagree.
 */
import {
  checkAdminZones,
  translationScopeSites,
  visibilityGateSites,
  zoneContributionSites,
  zoneRenderSites,
  readZoneDeclarations,
  type AdminZoneFinding,
  type AdminZoneFindingKind,
  type AdminZonesResult,
  type ModuleIdSite,
} from '../../scripts/check-admin-zones.js';
import type { ForeignModuleIdLedger } from '../../scripts/ledgers/foreign-module-ids.js';

/** One file the fixture walk opens. */
export interface AdminZoneFixtureFile {
  /** Repo-relative, exactly as the check keys a site. */
  readonly path: string;
  readonly source: string;
  /**
   * Which populations this file belongs to, mirroring `main()`'s three walks.
   *
   * `host` — a screen that may render a zone or declare a contribution;
   * `kit` — a kit source, whose `useTranslation` namespace is population 2;
   * `admin` — an attributed admin surface file, populations 1 and 3.
   */
  readonly roles?: readonly ('host' | 'kit' | 'admin')[];
  /** The module owning the file, for an `admin` role. */
  readonly owner?: string;
}

export interface AdminZoneFixture {
  /** The source of `packages/contracts/src/admin-contributions.ts`. */
  readonly declarations: string;
  readonly files: readonly AdminZoneFixtureFile[];
  /** Module ids the generated manifest index registers. */
  readonly registered: readonly string[];
  readonly ledger?: ForeignModuleIdLedger;
}

/** A minimal but real declaration source — a `z.enum` and the props interface. */
export function declarationSource(
  zones: readonly string[],
  propsKeys: readonly string[] = zones,
): string {
  return [
    "import { z } from 'zod';",
    'export const AdminZoneNameSchema = z.enum([',
    ...zones.map((zone) => `  '${zone}',`),
    ']);',
    'export type AdminZoneName = z.infer<typeof AdminZoneNameSchema>;',
    'export interface AdminZonePropsMap extends Record<AdminZoneName, object> {',
    ...propsKeys.map((key) => `  '${key}': { readonly productId: string };`),
    '}',
  ].join('\n');
}

/** The whole chain, from source text to findings. */
export function runAdminZones(fixture: AdminZoneFixture): AdminZonesResult {
  const { zoneNames, propsMapKeys } = readZoneDeclarations(fixture.declarations);
  const registered = new Set(fixture.registered);

  const renders = [];
  const contributions = [];
  const moduleIds: ModuleIdSite[] = [];

  for (const file of fixture.files) {
    const roles = file.roles ?? ['host'];
    if (roles.includes('host') || roles.includes('kit') || roles.includes('admin')) {
      renders.push(...zoneRenderSites(file.source, file.path));
      contributions.push(...zoneContributionSites(file.source, file.path, file.owner ?? null));
    }
    if (roles.includes('kit')) {
      for (const site of translationScopeSites(file.source, file.path)) {
        if (site.named !== null && !registered.has(site.named)) continue;
        moduleIds.push({
          file: file.path,
          line: site.line,
          named: site.named,
          owner: null,
          population: 'kit-namespace',
        });
      }
    }
    if (roles.includes('admin') && file.owner !== undefined) {
      for (const site of translationScopeSites(file.source, file.path)) {
        if (site.named === null || !registered.has(site.named) || site.named === file.owner) {
          continue;
        }
        moduleIds.push({
          file: file.path,
          line: site.line,
          named: site.named,
          owner: file.owner,
          population: 'module-namespace',
        });
      }
      for (const site of visibilityGateSites(file.source, file.path)) {
        if (!registered.has(site.named) || site.named === file.owner) continue;
        moduleIds.push({
          file: file.path,
          line: site.line,
          named: site.named,
          owner: file.owner,
          population: 'visibility-gate',
        });
      }
    }
  }

  return checkAdminZones(
    { zoneNames, propsMapKeys, renders, contributions, moduleIds },
    fixture.ledger ?? {},
  );
}

/** Findings of one kind — what a red proof counts. */
export function adminZoneFindings(
  fixture: AdminZoneFixture,
  kind: AdminZoneFindingKind,
): AdminZoneFinding[] {
  return runAdminZones(fixture).findings.filter((finding) => finding.kind === kind);
}

/** How many findings of one kind the fixture produced — the proof's return value. */
export function adminZoneFindingCount(
  fixture: AdminZoneFixture,
  kind: AdminZoneFindingKind,
): number {
  return adminZoneFindings(fixture, kind).length;
}
