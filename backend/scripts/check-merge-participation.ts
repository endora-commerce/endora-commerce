/**
 * CI check — every persisted reference to a mergeable record is declared by
 * its owner (`specs/192-organization-merge/` FR-045, SC-008, R-9).
 * **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/merge-participation.js` and its
 * coverage in `@endora-commerce/contracts`' `analyseMergeCoverage`, which the
 * platform's runtime twin runs too (one analysis, two hosts — the static check
 * and the boot-time refusal of a merge start). This file supplies this
 * repository's population — every `@Entity()` class under the module roots and
 * the platform, attributed by `lib/module-roots.ts` — its declarations, read
 * from the generated manifest index plus the kernel's own, and the pending
 * ledger (`ledgers/merge-participation-pending.ts`), which may only shrink.
 *
 * Installed packages are not walked here: the package host (`endora check`)
 * holds a package's own sources to the rule, and the runtime twin holds every
 * composed entity, installed or not, before a merge may start.
 *
 * Usage: `tsx scripts/check-merge-participation.ts [--undeclared]`
 * Exit 0 = every reference covered; exit 1 = a finding; exit 2 = nothing read.
 * `--undeclared` prints the uncovered references as ledger entries (for seeding).
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MergeDeclarationWithModule, MergePopulationEntity, ModuleManifest } from '@endora-commerce/contracts';
import { KERNEL_MERGE_PARTICIPATIONS } from '@endora-commerce/platform/composition';
import {
  ENTITY_HINT,
  PREFIX,
  checkMergeParticipation,
  describeFinding,
  entityTablesFromSource,
  persistedEntitiesFromSource,
  referenceWriteFindings,
  type EntityTable,
  type MergeParticipationResult,
  type ReferenceWriteFinding,
} from '@endora-commerce/cli/rules/merge-participation.js';
import { walk } from '@endora-commerce/cli/rules/entity-tenant-classification.js';
import { MERGE_PARTICIPATION_PENDING } from './ledgers/merge-participation-pending.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { reportReadSize } from './lib/read-size.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { overlayManifestEntries } from './check-port-dependencies.js';

export * from '@endora-commerce/cli/rules/merge-participation.js';

/** Every composed module's participations, with its id, plus the kernel's. */
export function declarationsFrom(manifests: readonly ModuleManifest[]): MergeDeclarationWithModule[] {
  return [
    ...manifests.flatMap((manifest) =>
      (manifest.merge?.participates ?? []).map((participation) => ({
        moduleId: manifest.id,
        host: participation.host,
        key: participation.key,
        phase: participation.phase,
        freeze: participation.freeze,
        references: participation.references,
      })),
    ),
    ...KERNEL_MERGE_PARTICIPATIONS,
  ];
}

export function report(result: MergeParticipationResult, files: number, writes: readonly ReferenceWriteFinding[] = []): number {
  const findings = result.findings.length + writes.length;
  console.log(
    `${PREFIX} files=${files} entities=${result.entities} references=${result.sites} findings=${findings} ` +
      `pending=${MERGE_PARTICIPATION_PENDING.length}`,
  );
  for (const finding of result.findings) console.error(`  - ${describeFinding(finding)}`);
  for (const finding of writes) console.error(`  - [${finding.kind}] ${finding.moduleId} ${finding.entity}.${finding.property}: ${finding.message}`);
  return findings > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const layout = await requireModuleLayout(PREFIX);
  const files = layout.sourceRoots.flatMap((root) => walk(root)).filter((file) => !/\.test\.tsx?$/.test(file));
  const coverage = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });
  const platformRoot = layout.platformRoot;
  const population: MergePopulationEntity[] = [];
  const tables: (EntityTable & { moduleId: string })[] = [];
  const sources: { file: string; moduleId: string; text: string }[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const moduleId =
      layout.moduleIdOfPath(file) ?? (platformRoot !== null && file.startsWith(`${platformRoot}/`) ? 'core' : null);
    if (moduleId === null) continue;
    sources.push({ file: relative(resolve(process.cwd(), '..'), file), moduleId, text });
    if (!ENTITY_HINT.test(text)) continue;
    for (const entity of persistedEntitiesFromSource(text, file)) population.push({ moduleId, ...entity });
    for (const table of entityTablesFromSource(text, file)) tables.push({ moduleId, ...table });
  }
  if (population.length === 0) {
    console.error(`${PREFIX} no persisted entity found in a tree that has hundreds — refusing a vacuous pass`);
    process.exit(2);
  }

  const index = (await import(pathToFileURL(layout.manifestIndexPath).href)) as {
    DISCOVERED_MANIFESTS: ReadonlyArray<{ manifest: ModuleManifest }>;
  };
  // Every deployment's overlay manifests too (issue #210's rule for port edges):
  // the walk reads `src/apps/` as well, so an overlay module's entities are in the
  // population, and the manifest index — bare core by construction — never
  // carries the declaration that covers them.
  const overlays = await overlayManifestEntries();
  const declarations = declarationsFrom([...index.DISCOVERED_MANIFESTS, ...overlays].map((entry) => entry.manifest));

  if (process.argv.includes('--undeclared')) {
    const bare = checkMergeParticipation({ population, declarations });
    for (const finding of bare.findings.filter((f) => f.kind === 'undeclared-reference')) {
      console.log(`  { moduleId: '${finding.moduleId}', entity: '${finding.entity}', property: '${finding.property}' },`);
    }
    process.exit(0);
  }

  const result = checkMergeParticipation({ population, declarations, pending: MERGE_PARTICIPATION_PENDING });
  // FR-047: a reference set outside an ORM flush is guarded where it is set.
  const writes = referenceWriteFindings({ tables, declarations, files: sources });
  reportReadSize({ prefix: PREFIX, files: files.length, sites: result.sites, coverage: [coverage] });
  process.exit(report(result, files.length, writes));
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
