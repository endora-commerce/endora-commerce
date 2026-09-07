/**
 * What the operator reads at the end of a demo run (feature 113 Phase 0,
 * `contracts/module-demo-data-layer.md` §3.7).
 *
 * *"The command MUST report per module what was contributed and per composition
 * step what was skipped and why. An absent module is a reported skip, never an
 * error and never a silence."*
 *
 * Formatting lives apart from the running so that the report is assertable
 * without invoking anything, and so that a module's body never formats: it
 * returns counts and the runner lays them out once. A client's scaffolded
 * composition therefore does not have to know how the platform prints
 * credentials.
 */
import type { DemoRunResult } from './runner.js';

function countLine(entity: { entity: string; count: number }): string {
  return `${entity.entity} ${entity.count}`;
}

/**
 * The two quiet states of §1.2, as one sentence.
 *
 * Counted rather than listed: 57 lines saying "this module has nothing to
 * demonstrate" is a report nobody reads, and neither state is a skip — there
 * was nothing to run. They are printed at all because *"nobody has decided"* is
 * a real state an operator may want to see the size of.
 */
function quietStates(result: DemoRunResult): string | undefined {
  const parts: string[] = [];
  if (result.counts.declaredNone > 0) {
    parts.push(`${result.counts.declaredNone} declares none`);
  }
  if (result.counts.undecided > 0) {
    parts.push(`${result.counts.undecided} has not decided`);
  }
  return parts.length === 0 ? undefined : `Modules with no demo data: ${parts.join(', ')}.`;
}

export function formatDemoReport(result: DemoRunResult): string {
  const verb = result.mode === 'seed' ? 'seeded' : 'withdrawn';
  const lines: string[] = [];

  if (result.modules.length === 0) {
    lines.push(`No module contributed demo data — nothing was ${verb}.`);
  } else {
    lines.push(`Demo ${verb}, module by module:`);
    for (const module of result.modules) {
      const counts = module.entities.map(countLine).join(', ');
      lines.push(`  ${module.moduleId} — ${module.summary}${counts ? ` (${counts})` : ''}`);
      for (const note of module.notes) lines.push(`      note: ${note}`);
    }
  }

  if (result.skipped.length > 0) {
    lines.push('');
    lines.push('Skipped, and why:');
    for (const skip of result.skipped) {
      lines.push(
        `  ${skip.moduleId} — not present in this instance (either not installed, or ` +
          `switched off by an operator).`,
      );
    }
  }

  if (result.composition) {
    lines.push('');
    if (result.composition.applied.length > 0) {
      lines.push(`Composition ${result.mode === 'seed' ? 'applied' : 'withdrawn'}:`);
      for (const step of result.composition.applied) lines.push(`  ${step}`);
    }
    if (result.composition.skipped.length > 0) {
      lines.push('Composition steps skipped, and why:');
      for (const skip of result.composition.skipped) {
        lines.push(`  ${skip.step} — ${skip.reason}`);
      }
    }
  }

  const quiet = quietStates(result);
  if (quiet) {
    lines.push('');
    lines.push(quiet);
  }

  if (result.credentials.length > 0) {
    lines.push('');
    lines.push('Sign in with:');
    for (const credential of result.credentials) {
      lines.push(`  ${credential.label}: ${credential.value}`);
    }
  }

  for (const diagnostic of result.diagnostics) {
    lines.push('');
    lines.push(diagnostic);
  }

  return `${lines.join('\n')}\n`;
}
