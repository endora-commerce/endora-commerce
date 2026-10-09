import { describe, expect, it } from 'vitest';
import { updateAdminUserSelfRequestSchema } from './admin.js';

/**
 * `PATCH /api/v1/admin/me` — the self-update payload.
 *
 * A new password is a credential change, so the payload that carries one has
 * to carry the current password too. The rule is on the schema because the
 * schema is the published request shape: an API client reads it there.
 */
describe('updateAdminUserSelfRequestSchema', () => {
  it('accepts a profile-only update without any password', () => {
    const parsed = updateAdminUserSelfRequestSchema.safeParse({ firstName: 'Ada' });
    expect(parsed.success).toBe(true);
  });

  it('accepts a new password accompanied by the current one', () => {
    const parsed = updateAdminUserSelfRequestSchema.safeParse({
      password: 'a-new-strong-pass-123!',
      currentPassword: 'whatever-it-was',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a new password without the current one, and names the field', () => {
    const parsed = updateAdminUserSelfRequestSchema.safeParse({
      firstName: 'Ada',
      password: 'a-new-strong-pass-123!',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['currentPassword']]);
  });

  it('refuses an empty current password', () => {
    const parsed = updateAdminUserSelfRequestSchema.safeParse({
      password: 'a-new-strong-pass-123!',
      currentPassword: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('still refuses fields the self-update does not expose', () => {
    const parsed = updateAdminUserSelfRequestSchema.safeParse({ email: 'other@example.com' });
    expect(parsed.success).toBe(false);
  });
});
