import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `specs/177-tax-id-scope/` T041a (FR-021; research R-6) — every write of
 * `organizations.tax_id` or `path` is answered with a 409 when the database
 * refuses it, never a 500.
 *
 * `per-tree-root`'s constraint is deferred, so it fires at `COMMIT`, after the
 * Command's `run` returned; only a wrapper around `commandBus.run` sees it. So
 * the population is fixed here and each member held to its wrapper:
 *
 * - the Commands that insert an organization or rewrite paths are exactly
 *   `organization.create` and the re-parent pair (`set_parent`, `move`, one
 *   factory) — a new one fails the first test until it is listed and wrapped;
 * - every call site of their factories runs them through `runOrganizationWrite`;
 * - registration is the `organization.register` Command since
 *   `specs/176-command-hooks-outbox/` P1 (177's WP-R): it maps the flush's
 *   refusal inside its run and the deferred one around `commandBus.run`, like
 *   the others.
 *
 * `personal-organization-service.ts` inserts too, but only personal rows,
 * whose `tax_id` is null and outside both constraints.
 */
const BACKEND = fileURLToPath(new URL('.', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

const WRITES = /em\.create\(Organization\b|applyReparentPaths\(|\borg\.taxId = /;
const FACTORIES = /\bmake(CreateOrganization|SetParent|Move|ConvertToCompany|ChangeTaxId|RegisterOrganization)Command\b/;

describe('the writes of organizations.tax_id and path', () => {
  it('are the create and re-parent Commands', () => {
    const commands = sources(join(BACKEND, 'commands'))
      .filter((path) => WRITES.test(readFileSync(path, 'utf8')))
      .map((path) => relative(BACKEND, path))
      .sort();
    expect(commands).toEqual([
      'commands/change-tax-id.command.ts',
      'commands/convert-to-company.command.ts',
      'commands/create-organization.command.ts',
      'commands/register-organization.command.ts',
      'commands/set-parent.command.ts',
    ]);
  });

  it('run those Commands through runOrganizationWrite at every call site', () => {
    const callers = sources(BACKEND).filter((path) => {
      if (path.includes(`${join(BACKEND, 'commands')}/`)) return false;
      return FACTORIES.test(readFileSync(path, 'utf8'));
    });
    expect(callers.map((path) => relative(BACKEND, path)).sort()).toEqual([
      'routes.admin.ts',
      'services/organization-command-port.ts',
      'services/organization-write-port.ts',
      'services/registration-service.ts',
    ]);
    for (const path of callers) {
      const text = readFileSync(path, 'utf8');
      expect(text, relative(BACKEND, path)).toContain('runOrganizationWrite(');
      expect(text).not.toMatch(/\.run\(\s*make(CreateOrganization|SetParent|Move|ConvertToCompany|ChangeTaxId|RegisterOrganization)Command\(/);
      expect(text).not.toMatch(/commandBus\.run\(\s*command\s*\)/);
    }
  });
});
