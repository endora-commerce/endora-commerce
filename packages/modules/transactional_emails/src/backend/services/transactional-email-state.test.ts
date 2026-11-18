import { describe, expect, it, vi } from 'vitest';
import { TransactionalEmailStateService } from './transactional-email-state.js';

/**
 * `specs/180-off-platform-complaints/` T109 (D-11, research R-21): whether a transactional
 * e-mail is switched on — the one fact the returns form needs before it promises a
 * confirmation.
 */
describe('TransactionalEmailStateService.isActive', () => {
  const rows: Record<string, { active: boolean }> = { return_submitted: { active: true }, return_comment_added: { active: false } };
  const service = new TransactionalEmailStateService(() => ({
    findOne: vi.fn(async (_entity: unknown, where: { code: string }) => rows[where.code] ?? null),
  }) as never);

  it('answers true for an active e-mail', async () => {
    expect(await service.isActive('return_submitted')).toBe(true);
  });

  it('answers false for a deactivated e-mail and for an unknown code', async () => {
    expect(await service.isActive('return_comment_added')).toBe(false);
    expect(await service.isActive('no_such_email')).toBe(false);
  });
});
