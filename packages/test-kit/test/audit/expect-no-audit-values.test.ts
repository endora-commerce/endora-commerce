/**
 * `./audit` — the sentinel assertion every Command that writes a tenant-scoped
 * record is held to (`specs/conventions/audit-state.md` §6, D-288, issue #470).
 *
 * The helper is the one shared check of the module sweep, so what it must
 * catch is pinned here rather than in each module's test: a value at any depth,
 * a value under an object key, a number stored as a string, a value in a
 * different case — and what it must refuse to be: a check that passes because
 * it had nothing to look at.
 */
import { AssertionError } from 'node:assert';
import { describe, expect, it } from 'vitest';
import { expectNoAuditValues, findAuditValues } from '../../src/audit/index.js';

const SENTINELS = ['S470-TITLE', 'S470-DESC', 470470.47, 's470@example.test'] as const;

describe('expectNoAuditValues', () => {
  it('passes for names and structure only', () => {
    expect(() =>
      expectNoAuditValues(
        [
          {
            action: 'crm.opportunity.update',
            stateBefore: { number: 'OPP-000001', statusCode: 'new', version: 1 },
            stateAfter: {
              number: 'OPP-000001',
              statusCode: 'new',
              changedFields: ['description', 'manualValue', 'title'],
              changedCustomFields: ['risk_profile'],
              valueChangeId: '5f0c6a8e-3d1b-4d55-9e1e-1b2c3d4e5f60',
            },
          },
        ],
        SENTINELS,
      ),
    ).not.toThrow();
  });

  it('finds a string sentinel at any depth, and names where', () => {
    const leaks = findAuditValues(
      [
        {
          action: 'crm.opportunity.create',
          stateBefore: null,
          stateAfter: { customFieldCarry: { skipped: [{ key: 'k', note: 'about S470-DESC here' }] } },
        },
      ],
      SENTINELS,
    );
    expect(leaks).toEqual([
      {
        entry: 0,
        action: 'crm.opportunity.create',
        path: 'stateAfter.customFieldCarry.skipped[0].note',
        sentinel: 'S470-DESC',
      },
    ]);
  });

  it('finds a sentinel used as an object key', () => {
    const leaks = findAuditValues([{ stateAfter: { tags: { 'S470-TITLE': true } } }], SENTINELS);
    expect(leaks.map((leak) => leak.path)).toEqual(['stateAfter.tags{S470-TITLE}']);
  });

  it('matches a string sentinel in any case — an e-mail is often stored lower-cased', () => {
    const leaks = findAuditValues([{ stateAfter: { email: 'S470@EXAMPLE.TEST' } }], SENTINELS);
    expect(leaks.map((leak) => leak.sentinel)).toEqual(['s470@example.test']);
  });

  it('finds a number sentinel stored as a number or as a decimal string', () => {
    const leaks = findAuditValues(
      [{ stateBefore: { manualValue: '470470.47' }, stateAfter: { total: 470470.47 } }],
      SENTINELS,
    );
    expect(leaks.map((leak) => leak.path)).toEqual(['stateBefore.manualValue', 'stateAfter.total']);
  });

  it('reads `before` / `after` as well, the shape a Command outcome and a history entry have', () => {
    const leaks = findAuditValues([{ before: { title: 'S470-TITLE' }, after: null }], SENTINELS);
    expect(leaks.map((leak) => leak.path)).toEqual(['before.title']);
  });

  it('fails with every leak in the message', () => {
    let thrown: unknown;
    try {
      expectNoAuditValues(
        [
          { action: 'x.update', stateBefore: { title: 'S470-TITLE' }, stateAfter: { manualValue: '470470.47' } },
        ],
        SENTINELS,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AssertionError);
    const message = (thrown as Error).message;
    expect(message).toContain('stateBefore.title');
    expect(message).toContain('stateAfter.manualValue');
    expect(message).toContain('x.update');
  });

  it('refuses to pass with nothing to inspect — a Command that skipped its audit proves nothing', () => {
    expect(() => expectNoAuditValues([], SENTINELS)).toThrow(/no audit entry/i);
  });

  it('refuses an empty sentinel list, and an empty string sentinel that would match everything', () => {
    const entries = [{ stateAfter: { statusCode: 'new' } }];
    expect(() => expectNoAuditValues(entries, [])).toThrow(/sentinel/i);
    expect(() => expectNoAuditValues(entries, [''])).toThrow(/sentinel/i);
  });
});
