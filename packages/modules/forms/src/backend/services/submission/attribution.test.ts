import { describe, expect, it, vi } from 'vitest';
import { resolveEntryOwner, type SubmissionActor } from './attribution.js';

/**
 * `specs/170-forms-module/` T047 — who owns an entry (FR-045, research § Principle XI review): a
 * signed-in customer's entry carries their account and the organisation the accounts port resolves
 * for it — never one read from anywhere else; anybody else's entry carries neither. An account that
 * does not resolve refuses the write rather than writing half an attribution.
 */

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const ORGANIZATION = '00000000-0000-4000-8000-0000000000aa';

function accounts(found: { organizationId: string } | null) {
  return { findById: vi.fn(async () => found as never) };
}

describe('resolveEntryOwner', () => {
  it('stamps a signed-in customer and the organisation the port resolves', async () => {
    const port = accounts({ organizationId: ORGANIZATION });
    // The session's organisation is not the one stamped: the port's answer is.
    const actor: SubmissionActor = { kind: 'customer', customerAccountId: ACCOUNT, organizationId: '' };
    await expect(resolveEntryOwner(actor, port)).resolves.toEqual({
      customerAccountId: ACCOUNT,
      organizationId: ORGANIZATION,
    });
    expect(port.findById).toHaveBeenCalledWith(ACCOUNT);
  });

  it.each<[string, SubmissionActor | undefined]>([
    ['an anonymous visitor', { kind: 'anonymous' }],
    ['no actor at all', undefined],
    ['an administrator', { kind: 'admin', adminUserId: '00000000-0000-4000-8000-0000000000b1' }],
  ])('stamps nobody for %s, and asks the port nothing', async (_name, actor) => {
    const port = accounts({ organizationId: ORGANIZATION });
    await expect(resolveEntryOwner(actor, port)).resolves.toEqual({ customerAccountId: null, organizationId: null });
    expect(port.findById).not.toHaveBeenCalled();
  });

  it('refuses an account that does not resolve rather than writing an owner with no organisation', async () => {
    const actor: SubmissionActor = { kind: 'customer', customerAccountId: ACCOUNT, organizationId: ORGANIZATION };
    await expect(resolveEntryOwner(actor, accounts(null))).rejects.toThrow(/does not resolve/);
  });
});
