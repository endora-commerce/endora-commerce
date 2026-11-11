import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readWorkflowJobs } from '../../helpers/actions-workflows.js';
import { readJobs } from '../../helpers/ci-jobs.js';

/**
 * `specs/177-tax-id-scope/` FR-027 (research R-16) — the organizations suites
 * run in **both** tax-ID scopes. `test:backend` covers `global`; one job per
 * host covers `per-tree-root`, and this holds that it exists, sets the
 * variable the template seed reads, and runs the organizations directories and
 * the module's own tests. Dropping either half would leave one scope's
 * behaviour untested while every job stayed green.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

const SUITES = [
  'pnpm --filter backend exec vitest run test/contract/organizations test/integration/organizations',
  'pnpm --filter @endora-commerce/mod-organizations exec vitest run',
];

describe('the per-tree-root organizations job', () => {
  it('runs on GitLab with ORGANIZATIONS_TAX_ID_SCOPE=per-tree-root', () => {
    const job = readJobs(read('.gitlab-ci.yml')).find((candidate) => candidate.name === 'test:backend:organizations-per-tree-root');
    expect(job, 'the GitLab job is missing').toBeDefined();
    expect(job!.body).toMatch(/^ {4}ORGANIZATIONS_TAX_ID_SCOPE: per-tree-root$/m);
    for (const suite of SUITES) expect(job!.script).toContain(suite);
  });

  it('runs on GitHub Actions with ORGANIZATIONS_TAX_ID_SCOPE=per-tree-root', () => {
    const source = read('.github/workflows/backend-suite.yml');
    const job = readWorkflowJobs(source).find((candidate) => candidate.name === 'test:backend:organizations-per-tree-root');
    expect(job, 'the Actions job is missing').toBeDefined();
    expect(job!.runLines).toEqual(expect.arrayContaining(SUITES));
    const block = source.slice(source.indexOf('  test-backend-organizations-per-tree-root:'));
    expect(block).toMatch(/^ {6}ORGANIZATIONS_TAX_ID_SCOPE: per-tree-root$/m);
  });

  it('is the variable the template seed reads', () => {
    expect(read('backend/test/template-seed.ts')).toContain("TAX_ID_SCOPE_ENV = 'ORGANIZATIONS_TAX_ID_SCOPE'");
  });
});
