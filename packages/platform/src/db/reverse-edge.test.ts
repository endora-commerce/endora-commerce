import { describe, expect, it } from 'vitest';
import { requiredModulesOf, reverseEdgeClause } from './reverse-edge.js';

/**
 * `specs/178-extensible-columns/` D-291 R-A7 (tasks.md T072) — the one
 * predicate that says when module W may destroy, in a `down()`, what module O
 * owns: O cannot be present when W's revert runs. Shared by the guard,
 * `composer:generate` and `backend/test/unit/db/foreign-column-ddl.test.ts`.
 */
describe('reverseEdgeClause', () => {
  const dependencies = new Map<string, readonly string[]>([
    ['promotions', ['taxes']],
    ['taxes', []],
    ['organizations', []],
    ['quote_requests', ['organizations']],
    ['dictionaries', []],
    ['languages', []],
  ]);
  const required = new Set(['dictionaries', 'languages', 'organizations']);
  const clause = (writer: string, owner: string, req: ReadonlySet<string> = required) =>
    reverseEdgeClause({ writer, owner, dependencies, required: req });

  it('(a) the owner depends on the writer, transitively — dependents-block removes it first', () => {
    expect(clause('taxes', 'promotions')).toBe('owner-depends-on-writer');
  });

  it('(b) the writer is core', () => {
    expect(clause('core', 'organizations')).toBe('writer-is-core');
  });

  it('(c) both are non-deactivatable — the revert is unreachable (D-69)', () => {
    expect(clause('dictionaries', 'languages')).toBe('both-required');
  });

  it('refuses otherwise: quote_requests dropping what organizations owns', () => {
    expect(clause('quote_requests', 'organizations')).toBeNull();
  });

  it('re-reds when a lock is withdrawn', () => {
    expect(clause('dictionaries', 'languages', new Set(['languages']))).toBeNull();
  });

  it('derives the required set from activation.nonDeactivatable', () => {
    expect(
      requiredModulesOf([
        { id: 'a', manifest: { activation: { nonDeactivatable: true } } },
        { id: 'b', manifest: { activation: { nonDeactivatable: false } } },
        { id: 'c', manifest: {} },
      ]),
    ).toEqual(new Set(['a']));
  });
});
