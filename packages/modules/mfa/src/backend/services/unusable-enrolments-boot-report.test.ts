import { describe, expect, it } from 'vitest';
import { reportUnusableEnrolments } from './unusable-enrolments-boot-report.js';

/**
 * Issue #948 — an enrolment made while the instance held its encryption key
 * cannot be checked once the key is gone, so sign-in asks for no second factor
 * from its holder (owner ruling Q6, 2026-11-08). The operator is told at every
 * boot, at error level, how many enrolments that is, by kind of account.
 */
function harness(hasEncryptionKey: boolean, counts: { admin: number; customer: number }) {
  const errors: Array<[Record<string, unknown>, string]> = [];
  let read = 0;
  return {
    errors,
    reads: () => read,
    run: () =>
      reportUnusableEnrolments({
        hasEncryptionKey,
        countActiveEnrolments: async () => {
          read += 1;
          return counts;
        },
        error: (fields, message) => {
          errors.push([fields, message]);
        },
      }),
  };
}

describe('the boot report for enrolments no key can check', () => {
  it('names how many administrator and customer enrolments are not checked', async () => {
    const h = harness(false, { admin: 2, customer: 5 });
    await h.run();
    expect(h.errors).toHaveLength(1);
    const [fields, message] = h.errors[0]!;
    expect(fields).toEqual({ unusableEnrolments: { admin: 2, customer: 5 } });
    expect(message).toContain('MFA_SECRET_ENCRYPTION_KEY');
    expect(message).toContain('2 administrator');
    expect(message).toContain('5 customer');
    expect(message).toContain('password alone');
  });

  it('says nothing when no enrolment exists', async () => {
    const h = harness(false, { admin: 0, customer: 0 });
    await h.run();
    expect(h.errors).toEqual([]);
  });

  it('reads nothing when the key is configured', async () => {
    const h = harness(true, { admin: 2, customer: 5 });
    await h.run();
    expect(h.errors).toEqual([]);
    expect(h.reads()).toBe(0);
  });
});
