#!/usr/bin/env tsx
/**
 * CI check — a deployment's divergence from core is derived, owned and explained
 * (`specs/107-override-report-and-ladder/contracts/divergence-report.md` §4–§5).
 *
 * **Why it is a check of its own and not an arm of `overlay:check`.** These are
 * not determinism questions. That gate renders each artefact and byte-compares,
 * which answers "is the committed file what the tree would produce" — and *two
 * renders of a wrong derivation agree*. A report can be perfectly deterministic
 * and record a decoration nobody explained, name a registration no module
 * registers, or target an endpoint no route serves. That is the same reasoning
 * D-155.6 used to add the `foreign` verdict rather than trust the other three.
 *
 * **No acknowledgement ledger, deliberately (FR-021).** Every finding it can
 * raise is a file the deployment owns and one edit from compliance; an entry
 * could only license the thing the report exists to surface. It lands with none.
 *
 * Usage: `tsx scripts/check-divergence.ts [--list]`
 * Exit 0 = every divergence is derived, owned and explained; exit 1 = at least
 * one is not; exit 2 = the run could not see the population it judges.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { deploymentsOnDisk } from '../src/overlay/overlay-roots.js';
import {
  divergenceEnvironment,
  divergenceOutputPaths,
  overlayTreeSpellsASeamCall,
  PREFIX,
  renderDivergence,
} from './generate-divergence.js';
import {
  DIVERGENCE_REMEDIES,
  divergenceRefusal,
  selfContradictingSubjects,
  SEAM_CLASSIFICATION,
  type DivergenceFinding,
  type DivergenceFindingKind,
} from './lib/divergence.js';
import {
  checkEmittedFreshness,
  emittingPackages,
  refuseStaleEmittedArtefacts,
} from './lib/emitted-freshness.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { reportReadSize } from './lib/read-size.js';

export * from './lib/divergence.js';

/** Stop the run rather than report a pass over an input it never read. */
function refuse(message: string): never {
  console.error(`${PREFIX} ${message}`);
  process.exit(2);
}

/**
 * Committed per-deployment reports on disk, whatever `src/apps/` still holds.
 *
 * Read from the directory rather than from the deployments the walk found: the
 * state refusal 1 exists for is exactly the one where those two disagree.
 */
function committedReportsUnderApps(): string[] {
  const appsRoot = dirname(divergenceOutputPaths('any').module);
  const parent = dirname(appsRoot);
  let entries: string[];
  try {
    entries = readdirSync(parent);
  } catch {
    return [];
  }
  return entries
    .map((name) => divergenceOutputPaths(name).module)
    .filter((path) => existsSync(path));
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const shared = await divergenceEnvironment();

  // Refusal 5, **first**: issue #215's shared floor. A moved module tree leaves
  // the owner map short rather than empty, and a short owner map reports every
  // decoration as `unowned-subject` — a finding about the run dressed as a
  // finding about the tree. Asked before every other refusal so a moved tree is
  // named as one.
  const coverage = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: shared.layout.manifestIndexPath,
    files: shared.moduleFiles,
    moduleIdOf: shared.moduleIdOfFile,
  });

  // Refusal 7 — the owner map reads an installed package's `./backend`
  // artefact, so this run can be answered about a previous build.
  refuseStaleEmittedArtefacts(
    PREFIX,
    checkEmittedFreshness({
      read: shared.manifestLocations,
      packages: emittingPackages(shared.layout.repoRoot),
    }),
    shared.layout.displayOf,
  );

  const deployments = deploymentsOnDisk();

  // Refusal 1's input: a committed deployment report is a file this run can find
  // whether or not the deployment that owns it is still there, which is the
  // whole of issue #120's shape. The names come off the committed artefacts on
  // disk rather than off a list — `divergenceOutputPaths` is the same derivation
  // the generator writes them with, applied to the directory that would hold
  // them.
  const committedDeploymentArtefacts = committedReportsUnderApps();

  const targets: ReadonlyArray<string | null> = [null, ...deployments];
  const findings: DivergenceFinding[] = [];
  let sites = 0;
  let overlayFiles = 0;
  let spellsASeamCall = false;
  let discoveredOverlayModules = 0;
  let sourcedOverlayModules = 0;
  const contradicted = new Set<string>();

  for (const deployment of targets) {
    const rendered = await renderDivergence(
      deployment === null ? {} : ({ DEPLOYMENT: deployment } as NodeJS.ProcessEnv),
    );
    findings.push(...rendered.result.findings);
    sites += rendered.result.sites.length;
    overlayFiles += rendered.overlayFilesRead;

    const declared = rendered.result.report.overlayModules;
    discoveredOverlayModules += declared.length;
    if (overlayTreeSpellsASeamCall(rendered.overlaySources)) spellsASeamCall = true;
    // Refusal 8's input, per rendering: the contradiction is inside **one**
    // file, so it is derived from that rendering's own result and accumulated
    // rather than asked of the union (`specs/124-instance-customisation-gap/`
    // FR-010).
    for (const name of selfContradictingSubjects(rendered.result)) contradicted.add(name);
    const withSources = new Set(rendered.result.sites.map((site) => site.moduleId));
    for (const source of rendered.overlaySources) withSources.add(source.moduleId);
    sourcedOverlayModules += declared.filter((id) => withSources.has(id)).length;

    if (listMode) {
      console.log(
        `  ${rendered.deployment.padEnd(14)} overlayModules=${declared.length} ` +
          `entries=${rendered.result.report.entries.length} ` +
          `sites=${rendered.result.sites.length}`,
      );
      for (const entry of rendered.result.report.entries) {
        console.log(
          `      ${String(entry.rung ?? '-')} ${entry.kind.padEnd(14)} ${entry.key}` +
            ` [owner: ${entry.owner ?? 'root'}]`,
        );
      }
    }
  }

  // Refusals 1, 3, 4, 6 and 8, from the one pure predicate that decides them
  // (`lib/divergence.ts`), so a red proof enters where this run enters.
  //
  // (Refusal 2 — a discovered overlay module the walk opened no source for — is
  // the `overlay-modules` coverage below: `read-size.ts` refuses a covered count
  // short of its expectation, so it is one refusal in one place rather than a
  // second derivation of the same shortfall. Refusal 5 and refusal 7 were asked
  // above, by the shared helpers that own them.)
  const refusal = divergenceRefusal({
    deployments,
    committedDeploymentArtefacts,
    sites,
    overlaySpellsASeamCall: spellsASeamCall,
    ownersResolved: shared.owners.size,
    seamsClassified: Object.keys(SEAM_CLASSIFICATION).length,
    selfContradictingSubjects: [...contradicted].sort(),
  });
  if (refusal !== null) refuse(refusal.message);

  reportReadSize({
    prefix: PREFIX,
    files: shared.filesRead + overlayFiles,
    sites,
    coverage: [
      {
        source: 'overlay-modules',
        expected: discoveredOverlayModules,
        covered: sourcedOverlayModules,
      },
      coverage,
      {
        // `ModuleContext`'s own members against the members this run examined.
        // Expected and covered are the same number on purpose: a member the rung
        // table does not classify is the `unclassified-seam` **finding**, never a
        // blind run, and a platform whose interface this run could not read at
        // all is `expected: 0`, which the shared reporter refuses.
        source: 'seam-kinds',
        expected: shared.seams.length,
        covered: shared.seams.length,
      },
    ],
  });

  console.log(
    `${PREFIX} deployments=${targets.length} sites=${sites} findings=${findings.length}`,
  );

  if (findings.length === 0) process.exit(0);

  const kinds = [...new Set(findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds as DivergenceFindingKind[]) {
    console.error(`\n[${kind}]\n${DIVERGENCE_REMEDIES[kind]}\n`);
    for (const finding of findings.filter((candidate) => candidate.kind === kind)) {
      console.error(`  - (${finding.deployment}) ${finding.where}\n      ${finding.detail}`);
    }
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
