/**
 * The tests the fast job runs from **outside** `test/unit` and `src`, named one
 * by one (feature 112, FR-007; `specs/112-test-tree-membership/`).
 *
 * The exact mirror of `service-dependent-unit-tests.ts`, and it exists for the
 * same reason read the other way round. That list is a **(a)**-scope file that
 * needs a service, subtracted from the fast run; this one is a **(b)**-scope
 * file that needs none, added to it. Both are the same rule:
 *
 *   - **scope names the tree** — Constitution III's (a) domain logic,
 *     (b) public API shape, (c) exercises the real database and the real module
 *     boundary;
 *   - **service need names the job**, and it is *declared*, never inferred from
 *     the directory a file sits in;
 *   - where the two disagree the **job's include set** moves, and the file does
 *     not.
 *
 * So nothing here is misfiled and nothing here is a candidate for `git mv`.
 * Both entries are genuine contract tests: one asserts a wire-level permission
 * vocabulary, the other the shape of the platform's composition roots. Moving
 * either into `test/unit` to change which job runs it would misdescribe it,
 * which is the sentence `service-dependent-unit-tests.ts` has carried since
 * issue #211 — this file is that sentence applied in the other direction.
 *
 * **Being service-free does not earn a place here.** 48 other files under
 * `test/contract` and `test/integration` run to a verdict with no service
 * present, and they cost ≤ 18.8 % of every merge request's fast run against the
 * ≤ 3.2 % this feature spends. The criterion is narrower and is written per
 * entry: a **cross-cutting platform invariant**, whose red is attributable to no
 * single module and blocks everybody. `research.md` D5 records the rejected
 * larger set and the condition under which the question reopens.
 *
 * **Membership of the service-free population is decided by executing the file
 * under `BACKEND_TEST_SERVICES=none`, never by a source scan** (FR-005). Two of
 * fifty statically-screened service-free files reach Postgres through
 * `execFile('pnpm', ['exec', 'tsx', …])`, which no import walk can see — the
 * direction a static predicate fails in is *open*. `test/declared-services.ts`
 * is the seam that refuses in-process; a file added here without being run first
 * is a file nobody has checked.
 *
 * `test/unit/harness/service-dependent-ledger.test.ts` keeps this list honest in
 * both directions, exactly as it does its mirror: an entry whose file has gone
 * or moved tree fails, and an entry that has started dialling a service fails at
 * the seam in the fast run itself.
 */

export interface ServiceFreeOuterTest {
  /** Path relative to `backend/`, exactly as vitest reports it. */
  readonly path: string;
  /**
   * Which of Constitution III's three trees the file's **scope** puts it in.
   * It is here because its service need disagrees with its tree's usual one —
   * so recording the tree is recording that the disagreement was noticed and
   * ruled on, not overlooked.
   */
  readonly tree: 'contract' | 'integration';
  /**
   * Why this file earns a place on **every merge request** — not that it happens
   * to need no service, which is true of 48 others.
   */
  readonly reason: string;
}

export const SERVICE_FREE_OUTER_TESTS: readonly ServiceFreeOuterTest[] = [
  {
    path: 'test/contract/kernel/harness-parity.test.ts',
    tree: 'contract',
    reason:
      'The composition roots held to each other, and since feature 112 to every seam a ' +
      'module of the generated list uses. A root that does not offer one composes nothing ' +
      'at all — the failure is total, it belongs to no module, and `tsc` cannot see it ' +
      'because the option field is optional and its seam throws. It was the third of three ' +
      'reds on `master` that no merge-request pipeline could have shown.',
  },
  {
    path: 'test/contract/admin_users/permission-inventory.test.ts',
    tree: 'contract',
    reason:
      'The platform permission vocabulary swept in both directions — enforced ⇒ grantable, ' +
      'grantable ⇒ enforced — plus label coverage and the `requires` reconciliation. A gate ' +
      'added without its manifest declaration locks an operator out of a screen, and the ' +
      'only job that ran this file is `test:backend:deployment`, default-branch-only since ' +
      'D-198.',
  },
];

/** Paths only, in the shape vitest's `include` wants. */
export const SERVICE_FREE_OUTER_TEST_PATHS: readonly string[] = SERVICE_FREE_OUTER_TESTS.map(
  (entry) => entry.path,
);
