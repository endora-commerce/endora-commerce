import { describe, expect, it } from 'vitest';
import { adminPatchOrganizationRequestSchema } from '../src/organizations.js';

/**
 * Issue #1468 (SALES-01, DEC-07) — `PATCH /api/v1/admin/organizations/:id` is no longer a
 * writer of the organization status. Moderation is (`…/approve`, `…/reject`, `…/block`,
 * `…/unblock`), because only it checks the state machine, stamps the dates, emits
 * `organization.status_changed.v1` and sends the customer e-mail.
 *
 * `status` is **refused**, not silently stripped: a strip would answer `200` to an integrator
 * who believes they blocked an organization.
 */
describe('adminPatchOrganizationRequestSchema', () => {
  it('refuses status, with the issue at status and a message naming the moderation endpoints', () => {
    const result = adminPatchOrganizationRequestSchema.safeParse({ status: 'blocked' });
    expect(result.success).toBe(false);
    const issues = result.error?.issues ?? [];
    expect(issues.map((issue) => issue.path.join('.'))).toEqual(['status']);
    expect(issues[0]?.message).toMatch(/approve/);
    expect(issues[0]?.message).toMatch(/reject/);
    expect(issues[0]?.message).toMatch(/unblock/);
  });

  it('refuses the whole body when status travels with other fields', () => {
    const result = adminPatchOrganizationRequestSchema.safeParse({
      status: 'active',
      orderConfirmationEmails: ['ops@example.com'],
    });
    expect(result.success).toBe(false);
  });

  it('still parses every other field, vatStatus included', () => {
    const body = {
      name: 'Acme',
      vatStatus: 'reverse_charge',
      orderConfirmationEmails: ['ops@example.com'],
      fulfilmentStrategy: 'defined_order',
      fulfilmentStrategyWarehouseOrder: ['00000000-0000-4000-8000-00000000e003'],
      customFieldValues: { account_manager: 'Ada' },
      expectedUpdatedAt: '2026-05-01T09:00:00.000Z',
    };
    const result = adminPatchOrganizationRequestSchema.safeParse(body);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data).toEqual(body);
    expect(result.data).not.toHaveProperty('status');
  });
});
